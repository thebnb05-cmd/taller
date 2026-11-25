import { useEffect, useState } from 'react';
import { stripUndefined, updateRow, upsertRow } from '../lib/db';
import type { ProductRecord, RepairRecord, SaleRecord } from '../types/workshop';
import type { MpRecentPayment } from './mercadoPago';
import type { PaymentMethod } from './payment';
import {
  parseSaleDetails,
  parseSalePaymentInfo,
  serializeSaleStatus,
  type MpPaymentChannel,
} from './saleMeta';
import { isSafeId, sanitizePlainLine, sanitizeText } from './validation';

const LEDGER_EVENT = 'th3bnb-payment-ledger-changed';
const MAX_LEDGER_ENTRIES = 300;
const RETENTION_MS = 45 * 24 * 60 * 60 * 1000;

export interface DraftStockDelta {
  productId: string;
  delta: number;
}

export interface RecoveredPaymentEntry {
  id: string;
  ownerId: string;
  createdAt: number;
  at: string;
  source: 'venta' | 'reparacion' | 'mp_sync';
  method: PaymentMethod;
  mpChannel?: MpPaymentChannel;
  amount: number;
  totalAmount?: number;
  clientName: string;
  title: string;
  subtitle?: string;
  invoice?: string;
  mpOrderId?: string;
  mpCompanionOrderId?: string;
  mpExternalReference?: string;
  mpPaymentId?: string;
  saveFailed: boolean;
  saveError?: string;
  dismissed?: boolean;
  reconciledSaleId?: string;
  reconciledRepairId?: string;
  draftClientPayload?: Record<string, unknown>;
  draftSalePayload?: Record<string, unknown>;
  draftStockDeltas?: DraftStockDelta[];
}

function getStorageKey(ownerId: string): string {
  return `th3bnb_pay_ledger_${ownerId}`;
}

function normalizeExtRef(ref?: string | null): string {
  return String(ref || '')
    .trim()
    .replace(/-PT$/i, '');
}

function safeMoney(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.round(v * 100) / 100;
}

function normalizeMethod(raw: unknown): PaymentMethod {
  if (raw === 'transferencia' || raw === 'tarjeta' || raw === 'efectivo') {
    return raw;
  }
  return 'efectivo';
}

function sanitizeEntry(raw: Partial<RecoveredPaymentEntry>, ownerId: string): RecoveredPaymentEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const amount = safeMoney(raw.amount);
  if (amount <= 0) return null;
  const createdAt = Number.isFinite(Number(raw.createdAt))
    ? Number(raw.createdAt)
    : Date.parse(String(raw.at || '')) || Date.now();
  const at =
    sanitizePlainLine(String(raw.at || ''), 40) || new Date(createdAt).toISOString();
  const mpChannel: MpPaymentChannel | undefined =
    raw.mpChannel === 'mp_point' || raw.mpChannel === 'mp_qr'
      ? raw.mpChannel
      : undefined;

  return {
    id: sanitizePlainLine(String(raw.id || `rec-${createdAt}`), 80) || `rec-${createdAt}`,
    ownerId,
    createdAt,
    at,
    source:
      raw.source === 'reparacion'
        ? 'reparacion'
        : raw.source === 'mp_sync'
          ? 'mp_sync'
          : 'venta',
    method: normalizeMethod(raw.method),
    ...(mpChannel ? { mpChannel } : {}),
    amount,
    ...(raw.totalAmount !== undefined ? { totalAmount: safeMoney(raw.totalAmount) } : {}),
    clientName: sanitizePlainLine(String(raw.clientName || 'Mostrador'), 120) || 'Mostrador',
    title: sanitizePlainLine(String(raw.title || 'Cobro registrado'), 140) || 'Cobro registrado',
    ...(raw.subtitle ? { subtitle: sanitizePlainLine(String(raw.subtitle), 200) } : {}),
    ...(raw.invoice ? { invoice: sanitizePlainLine(String(raw.invoice), 60) } : {}),
    ...(raw.mpOrderId ? { mpOrderId: sanitizePlainLine(String(raw.mpOrderId), 80) } : {}),
    ...(raw.mpCompanionOrderId
      ? { mpCompanionOrderId: sanitizePlainLine(String(raw.mpCompanionOrderId), 80) }
      : {}),
    ...(raw.mpExternalReference
      ? { mpExternalReference: sanitizePlainLine(String(raw.mpExternalReference), 80) }
      : {}),
    ...(raw.mpPaymentId ? { mpPaymentId: sanitizePlainLine(String(raw.mpPaymentId), 80) } : {}),
    saveFailed: Boolean(raw.saveFailed),
    ...(raw.saveError ? { saveError: sanitizeText(String(raw.saveError), 240) } : {}),
    ...(raw.dismissed ? { dismissed: true } : {}),
    ...(raw.reconciledSaleId
      ? { reconciledSaleId: sanitizePlainLine(String(raw.reconciledSaleId), 120) }
      : {}),
    ...(raw.reconciledRepairId
      ? { reconciledRepairId: sanitizePlainLine(String(raw.reconciledRepairId), 120) }
      : {}),
    ...(raw.draftClientPayload && typeof raw.draftClientPayload === 'object'
      ? { draftClientPayload: raw.draftClientPayload }
      : {}),
    ...(raw.draftSalePayload && typeof raw.draftSalePayload === 'object'
      ? { draftSalePayload: raw.draftSalePayload }
      : {}),
    ...(Array.isArray(raw.draftStockDeltas)
      ? {
          draftStockDeltas: raw.draftStockDeltas
            .filter((d) => d && typeof d.productId === 'string' && Number(d.delta) !== 0)
            .slice(0, 60)
            .map((d) => ({
              productId: sanitizePlainLine(String(d.productId), 120),
              delta: Math.round(Number(d.delta)),
            })),
        }
      : {}),
  };
}

export function loadRecoveredPayments(ownerId: string): RecoveredPaymentEntry[] {
  if (!ownerId || !isSafeId(ownerId) || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(ownerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - RETENTION_MS;
    return parsed
      .map((item) => sanitizeEntry(item as Partial<RecoveredPaymentEntry>, ownerId))
      .filter((item): item is RecoveredPaymentEntry => item !== null && item.createdAt >= cutoff)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_LEDGER_ENTRIES);
  } catch {
    return [];
  }
}

function saveRecoveredPayments(ownerId: string, entries: RecoveredPaymentEntry[]): void {
  if (!ownerId || !isSafeId(ownerId) || typeof window === 'undefined') return;
  try {
    const cutoff = Date.now() - RETENTION_MS;
    const trimmed = entries
      .filter((item) => item.createdAt >= cutoff)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_LEDGER_ENTRIES);
    window.localStorage.setItem(getStorageKey(ownerId), JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent(LEDGER_EVENT, { detail: { ownerId } }));
  } catch {
    // Ignore localStorage quota issues
  }
}

function matchesLedgerEntry(
  existing: RecoveredPaymentEntry,
  incoming: Partial<RecoveredPaymentEntry>
): boolean {
  if (incoming.id && existing.id === incoming.id) return true;
  if (incoming.mpPaymentId && existing.mpPaymentId && existing.mpPaymentId === incoming.mpPaymentId) {
    return true;
  }
  if (
    incoming.mpOrderId &&
    (existing.mpOrderId === incoming.mpOrderId || existing.mpCompanionOrderId === incoming.mpOrderId)
  ) {
    return true;
  }
  if (
    incoming.mpCompanionOrderId &&
    (existing.mpOrderId === incoming.mpCompanionOrderId ||
      existing.mpCompanionOrderId === incoming.mpCompanionOrderId)
  ) {
    return true;
  }
  const incExt = normalizeExtRef(incoming.mpExternalReference);
  const exExt = normalizeExtRef(existing.mpExternalReference);
  if (incExt && exExt && incExt === exExt) return true;
  return false;
}

export function recordRecoveredPayment(
  input: Omit<RecoveredPaymentEntry, 'createdAt' | 'at'> & {
    createdAt?: number;
    at?: string;
  }
): RecoveredPaymentEntry | null {
  if (!input.ownerId || !isSafeId(input.ownerId)) return null;
  const current = loadRecoveredPayments(input.ownerId);
  const nowMs = input.createdAt ?? Date.now();
  const clean = sanitizeEntry(
    {
      ...input,
      createdAt: nowMs,
      at: input.at || new Date(nowMs).toISOString(),
    },
    input.ownerId
  );
  if (!clean) return null;

  const existingIdx = current.findIndex((item) => matchesLedgerEntry(item, clean));
  if (existingIdx >= 0) {
    const prev = current[existingIdx];
    const merged: RecoveredPaymentEntry = {
      ...prev,
      ...clean,
      id: prev.id,
      createdAt: Math.min(prev.createdAt, clean.createdAt),
      reconciledSaleId: prev.reconciledSaleId || clean.reconciledSaleId,
      reconciledRepairId: prev.reconciledRepairId || clean.reconciledRepairId,
      dismissed: prev.dismissed && !clean.saveFailed ? prev.dismissed : clean.dismissed,
      draftSalePayload: clean.draftSalePayload || prev.draftSalePayload,
      draftClientPayload: clean.draftClientPayload || prev.draftClientPayload,
      draftStockDeltas: clean.draftStockDeltas || prev.draftStockDeltas,
    };
    const next = [...current];
    next[existingIdx] = merged;
    saveRecoveredPayments(input.ownerId, next);
    return merged;
  }

  const next = [clean, ...current];
  saveRecoveredPayments(input.ownerId, next);
  return clean;
}

export function markPaymentReconciled(params: {
  ownerId: string;
  saleId?: string;
  repairId?: string;
  mpOrderId?: string;
  mpCompanionOrderId?: string;
  mpExternalReference?: string;
  mpPaymentId?: string;
  ledgerId?: string;
}): void {
  const { ownerId } = params;
  if (!ownerId || !isSafeId(ownerId)) return;
  const current = loadRecoveredPayments(ownerId);
  if (current.length === 0) return;

  let changed = false;
  const next = current.map((entry) => {
    const matched = matchesLedgerEntry(entry, {
      id: params.ledgerId,
      mpOrderId: params.mpOrderId,
      mpCompanionOrderId: params.mpCompanionOrderId,
      mpExternalReference: params.mpExternalReference,
      mpPaymentId: params.mpPaymentId,
    });
    if (!matched) return entry;
    changed = true;
    return {
      ...entry,
      saveFailed: false,
      saveError: undefined,
      ...(params.saleId ? { reconciledSaleId: params.saleId } : {}),
      ...(params.repairId ? { reconciledRepairId: params.repairId } : {}),
    };
  });

  if (changed) {
    saveRecoveredPayments(ownerId, next);
  }
}

export function dismissRecoveredPayment(ownerId: string, entryId: string): void {
  if (!ownerId || !isSafeId(ownerId)) return;
  const current = loadRecoveredPayments(ownerId);
  const next = current.map((entry) =>
    entry.id === entryId ? { ...entry, dismissed: true } : entry
  );
  saveRecoveredPayments(ownerId, next);
}

export function mergeSyncedMpPayments(
  ownerId: string,
  mpPayments: MpRecentPayment[]
): RecoveredPaymentEntry[] {
  if (!ownerId || !isSafeId(ownerId)) return [];
  const current = loadRecoveredPayments(ownerId);
  const next = [...current];
  let changed = false;

  for (const mp of mpPayments) {
    if (!mp || Number(mp.amount || 0) <= 0) continue;
    const atMs = Date.parse(mp.dateApproved || '') || Date.now();
    const candidate: RecoveredPaymentEntry = {
      id: `mp-${mp.paymentId || mp.orderId || atMs}`,
      ownerId,
      createdAt: atMs,
      at: mp.dateApproved || new Date(atMs).toISOString(),
      source: 'mp_sync',
      method: mp.appMethod,
      mpChannel: mp.mpChannel,
      amount: safeMoney(mp.amount),
      totalAmount: safeMoney(mp.amount),
      clientName: 'Mercado Pago',
      title:
        mp.description ||
        (mp.mpChannel === 'mp_point' ? 'Cobro Point Smart' : 'Cobro QR Mercado Pago'),
      subtitle: [
        mp.mpChannel === 'mp_point' ? 'Mercado Pago Point' : 'Mercado Pago QR',
        mp.paymentMethodId ? mp.paymentMethodId.toUpperCase() : '',
        mp.externalReference ? `Ref ${mp.externalReference}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      ...(mp.orderId ? { mpOrderId: sanitizePlainLine(mp.orderId, 80) } : {}),
      ...(mp.externalReference
        ? { mpExternalReference: sanitizePlainLine(mp.externalReference, 80) }
        : {}),
      ...(mp.paymentId ? { mpPaymentId: sanitizePlainLine(mp.paymentId, 80) } : {}),
      saveFailed: false,
    };

    const existingIdx = next.findIndex((item) => matchesLedgerEntry(item, candidate));
    if (existingIdx >= 0) {
      const prev = next[existingIdx];
      // Enrich missing MP metadata on existing local entry without reviving reconciled/dismissed state
      if (
        !prev.mpPaymentId ||
        (!prev.mpOrderId && candidate.mpOrderId) ||
        (!prev.mpChannel && candidate.mpChannel)
      ) {
        next[existingIdx] = {
          ...prev,
          mpPaymentId: prev.mpPaymentId || candidate.mpPaymentId,
          mpOrderId: prev.mpOrderId || candidate.mpOrderId,
          mpExternalReference: prev.mpExternalReference || candidate.mpExternalReference,
          mpChannel: prev.mpChannel || candidate.mpChannel,
        };
        changed = true;
      }
    } else {
      next.unshift(candidate);
      changed = true;
    }
  }

  if (changed) {
    saveRecoveredPayments(ownerId, next);
  }
  return loadRecoveredPayments(ownerId);
}

export function getUnreconciledPayments(
  entries: RecoveredPaymentEntry[],
  sales: SaleRecord[],
  repairs: RepairRecord[]
): RecoveredPaymentEntry[] {
  const savedSaleIds = new Set(sales.map((s) => s.id));
  const savedRepairIds = new Set(repairs.map((r) => r.id));

  const savedOrderIds = new Set<string>();
  const savedExtRefs = new Set<string>();
  const savedPaymentIds = new Set<string>();

  // Track saved sales that have no MP orderId yet so synced MP records match 1-to-1
  const unmatchedSalesForFuzzy: Array<{
    id: string;
    createdAt: number;
    amount: number;
    method: PaymentMethod | null;
    used: boolean;
  }> = [];

  for (const s of sales) {
    const details = parseSaleDetails(s);
    const info = parseSalePaymentInfo(s);
    if (details.mpOrderId) savedOrderIds.add(details.mpOrderId);
    if (details.mpExternalReference) {
      savedExtRefs.add(normalizeExtRef(details.mpExternalReference));
    }
    if (details.mpPaymentId) savedPaymentIds.add(details.mpPaymentId);

    if (!details.mpOrderId && !details.mpPaymentId && info.deposit > 0) {
      unmatchedSalesForFuzzy.push({
        id: s.id,
        createdAt: Number(s.createdAt || 0),
        amount: safeMoney(info.deposit),
        method: info.method,
        used: false,
      });
    }
  }

  return entries.filter((entry) => {
    if (entry.dismissed) return false;
    if (entry.reconciledSaleId && savedSaleIds.has(entry.reconciledSaleId)) return false;
    if (entry.reconciledSaleId && !entry.saveFailed) return false;
    if (entry.reconciledRepairId && savedRepairIds.has(entry.reconciledRepairId)) return false;
    if (entry.reconciledRepairId && !entry.saveFailed) return false;

    if (entry.mpOrderId && savedOrderIds.has(entry.mpOrderId)) return false;
    if (entry.mpCompanionOrderId && savedOrderIds.has(entry.mpCompanionOrderId)) return false;
    if (entry.mpPaymentId && savedPaymentIds.has(entry.mpPaymentId)) return false;

    const normExt = normalizeExtRef(entry.mpExternalReference);
    if (normExt && savedExtRefs.has(normExt)) return false;

    // 1-to-1 fuzzy match ONLY for auto-synced MP entries against legacy/saved sales without mpOrderId
    if (entry.source === 'mp_sync') {
      const match = unmatchedSalesForFuzzy.find(
        (cand) =>
          !cand.used &&
          cand.method === entry.method &&
          Math.abs(cand.amount - entry.amount) < 0.05 &&
          Math.abs(cand.createdAt - entry.createdAt) <= 20 * 60 * 1000
      );
      if (match) {
        match.used = true;
        return false;
      }
    }

    return true;
  });
}

export function toSyntheticSalesFromRecovered(
  unreconciled: RecoveredPaymentEntry[]
): SaleRecord[] {
  return unreconciled
    .filter((entry) => entry.source !== 'reparacion')
    .map((entry) => {
      const total = safeMoney(entry.totalAmount || entry.amount);
      const deposit = Math.min(total || entry.amount, entry.amount);
      const isPaid = total <= 0 || deposit >= total;
      return {
        id: `rec-sale-${entry.id}`,
        ownerId: entry.ownerId,
        clientId: 'recovered',
        clientName: entry.clientName || 'Mostrador',
        invoice:
          entry.invoice ||
          (entry.mpChannel === 'mp_point'
            ? 'MP-POINT'
            : entry.mpChannel === 'mp_qr'
              ? 'MP-QR'
              : 'RECUP'),
        productName: entry.title,
        quantity: 1,
        amount: total || entry.amount,
        status: serializeSaleStatus({
          status: isPaid ? 'cobrado' : 'pendiente',
          method: entry.method,
          deposit,
          amount: total || entry.amount,
          meta: {
            payments: [
              {
                id: `recpay-${entry.id}`,
                amount: entry.amount,
                method: entry.method,
                date: entry.at,
                note: entry.saveFailed ? 'Cobro recuperado (pendiente de guardar)' : 'Cobro Mercado Pago',
              },
            ],
            ...(entry.mpChannel ? { mpChannel: entry.mpChannel } : {}),
            ...(entry.mpOrderId ? { mpOrderId: entry.mpOrderId } : {}),
            ...(entry.mpExternalReference
              ? { mpExternalReference: entry.mpExternalReference }
              : {}),
            ...(entry.mpPaymentId ? { mpPaymentId: entry.mpPaymentId } : {}),
            note: entry.subtitle || entry.saveError || '',
          },
        }),
        dueDate: entry.at.slice(0, 10),
        createdAt: entry.createdAt,
      };
    });
}

export async function retrySaveRecoveredSale(
  entry: RecoveredPaymentEntry,
  products: ProductRecord[]
): Promise<{ ok: boolean; saleId?: string; error?: string }> {
  if (!entry.draftSalePayload) {
    return { ok: false, error: 'Este cobro no tiene un borrador de venta completo para reintentar.' };
  }
  try {
    if (entry.draftClientPayload) {
      await upsertRow('clients', stripUndefined(entry.draftClientPayload));
    }
    await upsertRow('sales', stripUndefined(entry.draftSalePayload));
    const saleId = String(entry.draftSalePayload.id || '');

    if (entry.draftStockDeltas && entry.draftStockDeltas.length > 0) {
      for (const sd of entry.draftStockDeltas) {
        const matched = products.find((p) => p.id === sd.productId);
        if (matched && matched.trackStock && sd.delta !== 0) {
          await updateRow('products', matched.id, {
            stock: Math.max(0, Number(matched.stock || 0) - sd.delta),
          });
        }
      }
    }

    markPaymentReconciled({
      ownerId: entry.ownerId,
      saleId,
      ledgerId: entry.id,
      mpOrderId: entry.mpOrderId,
      mpCompanionOrderId: entry.mpCompanionOrderId,
      mpExternalReference: entry.mpExternalReference,
      mpPaymentId: entry.mpPaymentId,
    });
    return { ok: true, saleId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'No se pudo guardar la venta en la nube.',
    };
  }
}

export function useRecoveredPayments(ownerId: string): RecoveredPaymentEntry[] {
  const [entries, setEntries] = useState<RecoveredPaymentEntry[]>(() =>
    loadRecoveredPayments(ownerId)
  );

  useEffect(() => {
    setEntries(loadRecoveredPayments(ownerId));
    if (typeof window === 'undefined') return;

    const handleCustom = (ev: Event) => {
      const detail = (ev as CustomEvent<{ ownerId?: string }>).detail;
      if (!detail?.ownerId || detail.ownerId === ownerId) {
        setEntries(loadRecoveredPayments(ownerId));
      }
    };
    const handleStorage = (ev: StorageEvent) => {
      if (!ev.key || ev.key === getStorageKey(ownerId)) {
        setEntries(loadRecoveredPayments(ownerId));
      }
    };

    window.addEventListener(LEDGER_EVENT, handleCustom);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(LEDGER_EVENT, handleCustom);
      window.removeEventListener('storage', handleStorage);
    };
  }, [ownerId]);

  return entries;
}
