import { clampStr, stripUndefined, updateRow, upsertRow } from '../lib/db';
import type {
  PurchaseRecord,
  RepairRecord,
  SaleRecord,
} from '../types/workshop';
import {
  loadMercadoPagoConfig,
  resolvePointDisplayName,
  type MercadoPagoConfig,
  type MpRecentPayment,
} from './mercadoPago';
import { parsePaymentInfo, type PaymentMethod } from './payment';
import type { RecoveredPaymentEntry } from './paymentLedger';
import {
  isMirroredIncomePurchase,
  parsePurchaseInfo,
  serializePurchaseStatus,
  type PurchaseCategory,
  type PurchaseMpChannel,
  type PurchaseOriginType,
} from './purchaseMeta';
import { parseRepairPaymentLedger } from './repairMeta';
import { parseSaleDetails, parseSalePaymentInfo } from './saleMeta';
import { isSafeId, sanitizePlainLine } from './validation';

const DISMISSED_SYNC_STORAGE_PREFIX = 'th3bnb_mp_pur_dismissed_';

function normalizeExtRef(ref?: string | null): string {
  return String(ref || '')
    .trim()
    .replace(/-PT$/i, '')
    .toUpperCase();
}

function safeMoney(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.round(v * 100) / 100;
}

function slugIdPart(raw: string, maxLen = 64): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.slice(0, maxLen) || 'item';
}

export function makeMirroredPurchaseId(originRecordId: string): string {
  return `mppur_${slugIdPart(originRecordId, 100)}`.slice(0, 118);
}

function toIsoDateOnly(tsOrIso: number | string | undefined): string {
  if (typeof tsOrIso === 'string') {
    const trimmed = tsOrIso.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  } else if (typeof tsOrIso === 'number' && Number.isFinite(tsOrIso) && tsOrIso > 0) {
    return new Date(tsOrIso).toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function toTimestampMs(tsOrIso: number | string | undefined): number {
  if (typeof tsOrIso === 'number' && Number.isFinite(tsOrIso) && tsOrIso > 0) {
    return tsOrIso;
  }
  if (typeof tsOrIso === 'string') {
    const parsed = Date.parse(tsOrIso);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return Date.now();
}

function loadDismissedOriginIds(ownerId: string): Set<string> {
  if (!ownerId || !isSafeId(ownerId) || typeof window === 'undefined') {
    return new Set();
  }
  try {
    const raw = window.localStorage.getItem(`${DISMISSED_SYNC_STORAGE_PREFIX}${ownerId}`);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function markMirroredPurchaseDismissed(
  ownerId: string,
  purchase: Pick<PurchaseRecord, 'id' | 'status'>
): void {
  if (!ownerId || !isSafeId(ownerId) || typeof window === 'undefined') return;
  const info = parsePurchaseInfo(purchase);
  if (!isMirroredIncomePurchase(info)) return;
  const set = loadDismissedOriginIds(ownerId);
  set.add(purchase.id);
  if (info.originRecordId) set.add(info.originRecordId);
  if (info.mpPaymentId) set.add(`mp_pay_${info.mpPaymentId}`);
  if (info.mpOrderId) set.add(`mp_ord_${info.mpOrderId}`);
  try {
    const trimmed = Array.from(set).slice(-300);
    window.localStorage.setItem(
      `${DISMISSED_SYNC_STORAGE_PREFIX}${ownerId}`,
      JSON.stringify(trimmed)
    );
  } catch {
    // Ignore storage errors
  }
}

export function clearMirroredPurchaseDismissed(ownerId: string): void {
  if (!ownerId || !isSafeId(ownerId) || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${DISMISSED_SYNC_STORAGE_PREFIX}${ownerId}`);
  } catch {
    // Ignore storage errors
  }
}

export interface ElectronicPurchaseDescriptor {
  originType: Exclude<PurchaseOriginType, 'manual'>;
  originRecordId: string;
  paymentMethod: PaymentMethod;
  mpChannel?: PurchaseMpChannel;
  mpPointName?: string;
  mpOrderId?: string;
  mpPaymentId?: string;
  mpExternalReference?: string;
  isOutflow?: boolean;
  category?: PurchaseCategory;
  amount: number;
  counterparty: string;
  invoice: string;
  dueDate: string;
  createdAtMs: number;
  note: string;
}

function buildSupplierLabel(desc: ElectronicPurchaseDescriptor): string {
  const cleanParty = sanitizePlainLine(desc.counterparty || 'Cliente', 90) || 'Cliente';
  const cleanPoint = sanitizePlainLine(desc.mpPointName || '', 70);

  if (desc.mpChannel === 'mp_meli' || desc.originType === 'mp_meli') {
    const base =
      cleanPoint && cleanPoint.toLowerCase() !== 'mercado libre'
        ? `Mercado Libre · ${cleanPoint}`
        : 'Mercado Libre';
    return clampStr(
      cleanParty && cleanParty.toLowerCase() !== 'mercado libre' && cleanParty.toLowerCase() !== 'mercado pago'
        ? `${base} (${cleanParty})`
        : base,
      160
    );
  }
  if (desc.mpChannel === 'mp_point') {
    const base = cleanPoint ? `Point Smart · ${cleanPoint}` : 'Point Smart';
    return clampStr(
      cleanParty && cleanParty.toLowerCase() !== 'mercado pago'
        ? `${base} (${cleanParty})`
        : base,
      160
    );
  }
  if (desc.mpChannel === 'mp_qr') {
    const base = cleanPoint ? `QR Mercado Pago · ${cleanPoint}` : 'QR Mercado Pago';
    return clampStr(
      cleanParty && cleanParty.toLowerCase() !== 'mercado pago'
        ? `${base} (${cleanParty})`
        : base,
      160
    );
  }
  if (desc.mpChannel === 'mp_transfer' || desc.paymentMethod === 'transferencia') {
    const prefix = desc.isOutflow ? 'Transferencia enviada' : 'Transferencia';
    return clampStr(`${prefix} · ${cleanParty}`, 160);
  }
  return clampStr(
    cleanPoint ? `Tarjeta · ${cleanPoint} (${cleanParty})` : `Tarjeta · ${cleanParty}`,
    160
  );
}

function buildPurchasePayloadFromDescriptor(
  ownerId: string,
  desc: ElectronicPurchaseDescriptor,
  purchaseIdOverride?: string
): Record<string, unknown> {
  const id = purchaseIdOverride || makeMirroredPurchaseId(desc.originRecordId);
  const status = serializePurchaseStatus({
    status: 'pagado',
    category: desc.category || (desc.isOutflow ? 'repuestos' : 'otro'),
    note: desc.note,
    paymentMethod: desc.paymentMethod,
    mpChannel: desc.mpChannel,
    mpPointName: desc.mpPointName,
    mpOrderId: desc.mpOrderId,
    mpPaymentId: desc.mpPaymentId,
    mpExternalReference: desc.mpExternalReference,
    originType: desc.originType,
    originRecordId: desc.originRecordId,
    isOutflow: desc.isOutflow,
  });

  return stripUndefined({
    id,
    ownerId,
    supplierName: buildSupplierLabel(desc),
    invoice: clampStr(desc.invoice || 'MP-CTA', 60) || 'MP-CTA',
    amount: safeMoney(desc.amount),
    status,
    dueDate: clampStr(desc.dueDate, 40) || toIsoDateOnly(desc.createdAtMs),
    createdAt: new Date(desc.createdAtMs).toISOString(),
  });
}

function extractDescriptorsFromSale(
  sale: SaleRecord,
  mpConfig?: Partial<MercadoPagoConfig> | null
): ElectronicPurchaseDescriptor[] {
  const info = parseSalePaymentInfo(sale);
  const details = parseSaleDetails(sale);
  const out: ElectronicPurchaseDescriptor[] = [];

  const resolvedPointName =
    details.mpPointName ||
    (details.mpChannel ? resolvePointDisplayName(mpConfig) : undefined);

  if (details.payments.length > 0) {
    details.payments.forEach((pay, idx) => {
      if (pay.amount <= 0) return;
      const isElectronic =
        pay.method === 'transferencia' ||
        pay.method === 'tarjeta' ||
        Boolean(details.mpChannel);
      if (!isElectronic) return;
      const inferredChannel: 'mp_point' | 'mp_qr' | undefined =
        details.mpChannel ||
        (pay.note?.toLowerCase().includes('point')
          ? 'mp_point'
          : pay.note?.toLowerCase().includes('qr')
            ? 'mp_qr'
            : undefined);
      const payPointName =
        resolvedPointName ||
        (inferredChannel ? resolvePointDisplayName(mpConfig) : undefined);

      out.push({
        originType: 'venta',
        originRecordId: `sale_${sale.id}_${pay.id || idx}`,
        paymentMethod: pay.method,
        mpChannel: inferredChannel,
        mpPointName: payPointName,
        mpOrderId: details.mpOrderId,
        mpPaymentId: details.mpPaymentId,
        mpExternalReference: details.mpExternalReference,
        amount: safeMoney(pay.amount),
        counterparty: sale.clientName || 'Mostrador',
        invoice: sale.invoice || 'FV',
        dueDate: sale.dueDate || toIsoDateOnly(pay.date || sale.createdAt),
        createdAtMs: toTimestampMs(pay.date || sale.createdAt),
        note: [sale.productName, pay.note].filter(Boolean).join(' · '),
      });
    });
    return out;
  }

  if (
    info.deposit > 0 &&
    (info.method === 'transferencia' || info.method === 'tarjeta' || details.mpChannel)
  ) {
    out.push({
      originType: 'venta',
      originRecordId: `sale_${sale.id}_main`,
      paymentMethod: info.method || (details.mpChannel === 'mp_point' ? 'tarjeta' : 'transferencia'),
      mpChannel: details.mpChannel,
      mpPointName: resolvedPointName,
      mpOrderId: details.mpOrderId,
      mpPaymentId: details.mpPaymentId,
      mpExternalReference: details.mpExternalReference,
      amount: safeMoney(info.deposit),
      counterparty: sale.clientName || 'Mostrador',
      invoice: sale.invoice || 'FV',
      dueDate: sale.dueDate || toIsoDateOnly(sale.createdAt),
      createdAtMs: toTimestampMs(sale.createdAt),
      note: sale.productName || 'Venta de mostrador',
    });
  }

  return out;
}

function extractDescriptorsFromRepair(
  repair: RepairRecord,
  mpConfig?: Partial<MercadoPagoConfig> | null
): ElectronicPurchaseDescriptor[] {
  const out: ElectronicPurchaseDescriptor[] = [];
  const ledger = parseRepairPaymentLedger(repair.checkoutState);
  const repairInfo = parsePaymentInfo(repair);
  const deviceLabel = `${repair.brand || ''} ${repair.model || ''}`.trim() || repair.deviceType;

  if (ledger.length > 0) {
    ledger.forEach((entry, idx) => {
      if (entry.amount <= 0) return;
      const isElectronic =
        entry.method === 'transferencia' ||
        entry.method === 'tarjeta' ||
        Boolean(entry.mpChannel);
      if (!isElectronic) return;

      const inferredChannel: 'mp_point' | 'mp_qr' | undefined =
        entry.mpChannel ||
        (entry.note?.toLowerCase().includes('point')
          ? 'mp_point'
          : entry.note?.toLowerCase().includes('qr')
            ? 'mp_qr'
            : undefined);

      const pointName =
        entry.mpPointName ||
        (inferredChannel ? resolvePointDisplayName(mpConfig) : undefined);

      out.push({
        originType: 'reparacion',
        originRecordId: `rep_${repair.id}_${entry.id || idx}`,
        paymentMethod: entry.method,
        mpChannel: inferredChannel,
        mpPointName: pointName,
        mpOrderId: entry.mpOrderId,
        mpExternalReference: entry.mpExternalReference,
        amount: safeMoney(entry.amount),
        counterparty: repair.clientName || 'Cliente',
        invoice: repair.code || 'ORD',
        dueDate: toIsoDateOnly(entry.date || repair.createdAt),
        createdAtMs: toTimestampMs(entry.date || repair.createdAt),
        note: [deviceLabel, entry.note].filter(Boolean).join(' · '),
      });
    });
    return out;
  }

  const paidAmt = Math.min(
    Number(repair.price || 0) || Number(repair.deposit || 0),
    Number(repair.deposit || 0)
  );
  if (
    paidAmt > 0 &&
    (repairInfo.method === 'transferencia' || repairInfo.method === 'tarjeta')
  ) {
    out.push({
      originType: 'reparacion',
      originRecordId: `rep_${repair.id}_main`,
      paymentMethod: repairInfo.method,
      amount: safeMoney(paidAmt),
      counterparty: repair.clientName || 'Cliente',
      invoice: repair.code || 'ORD',
      dueDate: toIsoDateOnly(repair.updatedAt || repair.createdAt),
      createdAtMs: toTimestampMs(repair.updatedAt || repair.createdAt),
      note: `${deviceLabel} · Cobro de reparación`,
    });
  }

  return out;
}

function extractDescriptorFromRecovered(
  entry: RecoveredPaymentEntry,
  mpConfig?: Partial<MercadoPagoConfig> | null
): ElectronicPurchaseDescriptor | null {
  if (entry.dismissed) return null;
  if (
    (entry.attemptStatus === 'failed_attempt' ||
      entry.attemptStatus === 'pending_verification') &&
    !entry.forceReconciled &&
    !entry.saveFailed
  ) {
    return null;
  }
  const isElectronic =
    entry.method === 'transferencia' ||
    entry.method === 'tarjeta' ||
    Boolean(entry.mpChannel);
  if (!isElectronic || entry.amount <= 0) return null;

  const isMeli = Boolean(entry.mpChannel === 'mp_meli' || entry.isMercadoLibre);
  const originType: Exclude<PurchaseOriginType, 'manual'> = isMeli
    ? 'mp_meli'
    : entry.source === 'reparacion'
      ? 'reparacion'
      : entry.source === 'mp_sync'
        ? 'mp_sync'
        : 'venta';

  const pointName =
    entry.mpPointName ||
    (isMeli
      ? 'Mercado Libre'
      : entry.mpChannel === 'mp_point' || entry.mpChannel === 'mp_qr'
        ? resolvePointDisplayName(mpConfig)
        : undefined);

  const uniqueKey = entry.mpPaymentId
    ? `mp_pay_${entry.mpPaymentId}`
    : entry.mpOrderId
      ? `mp_ord_${entry.mpOrderId}`
      : `led_${entry.id}`;

  return {
    originType,
    originRecordId: uniqueKey,
    paymentMethod: entry.method,
    mpChannel: entry.mpChannel,
    mpPointName: pointName,
    mpOrderId: entry.mpOrderId,
    mpPaymentId: entry.mpPaymentId,
    mpExternalReference: entry.mpExternalReference,
    isOutflow: Boolean(entry.isOutflow || isMeli),
    category: entry.isOutflow || isMeli ? 'repuestos' : 'otro',
    amount: safeMoney(entry.amount),
    counterparty: entry.clientName || (isMeli ? 'Mercado Libre' : 'Mercado Pago'),
    invoice:
      entry.invoice ||
      (isMeli
        ? 'ML-COMPRA'
        : entry.mpChannel === 'mp_point'
          ? 'MP-POINT'
          : entry.mpChannel === 'mp_qr'
            ? 'MP-QR'
            : 'TRANSF'),
    dueDate: toIsoDateOnly(entry.at || entry.createdAt),
    createdAtMs: toTimestampMs(entry.at || entry.createdAt),
    note: [entry.title, entry.subtitle].filter(Boolean).join(' · '),
  };
}

function extractDescriptorFromMpRecent(
  mp: MpRecentPayment,
  mpConfig?: Partial<MercadoPagoConfig> | null
): ElectronicPurchaseDescriptor | null {
  if (!mp || Number(mp.amount || 0) <= 0) return null;
  const isMeli = Boolean(mp.mpChannel === 'mp_meli' || mp.isMercadoLibre);
  const resolvedPurchaseChannel: PurchaseMpChannel | undefined =
    mp.mpChannel === 'mp_point' ||
    mp.mpChannel === 'mp_qr' ||
    mp.mpChannel === 'mp_meli' ||
    mp.mpChannel === 'mp_transfer'
      ? mp.mpChannel
      : undefined;

  const pointName = isMeli
    ? mp.pointName || mp.posName || mp.terminalId || 'Mercado Libre'
    : mp.mpChannel === 'mp_transfer'
      ? mp.pointName || (mp.isOutflow ? 'Transferencia enviada MP' : 'Transferencia recibida MP')
      : resolvePointDisplayName(
          mpConfig,
          mp.pointName || mp.posName || mp.terminalId
        );

  const uniqueKey = mp.paymentId
    ? `mp_pay_${mp.paymentId}`
    : mp.orderId
      ? `mp_ord_${mp.orderId}`
      : `mp_ts_${Date.parse(mp.dateApproved || '') || Date.now()}`;

  return {
    originType: isMeli ? 'mp_meli' : 'mp_sync',
    originRecordId: uniqueKey,
    paymentMethod: mp.appMethod,
    mpChannel: resolvedPurchaseChannel,
    mpPointName: pointName,
    mpOrderId: mp.orderId || undefined,
    mpPaymentId: mp.paymentId || undefined,
    mpExternalReference: mp.externalReference || undefined,
    isOutflow: Boolean(mp.isOutflow || isMeli),
    category: mp.isOutflow || isMeli ? 'repuestos' : 'otro',
    amount: safeMoney(mp.amount),
    counterparty: mp.payerLabel || (isMeli ? 'Mercado Libre' : 'Mercado Pago'),
    invoice:
      mp.externalReference ||
      (isMeli
        ? 'ML-COMPRA'
        : mp.mpChannel === 'mp_point'
          ? 'MP-POINT'
          : mp.mpChannel === 'mp_qr'
            ? 'MP-QR'
            : mp.mpChannel === 'mp_transfer'
              ? 'MP-TRANSF'
              : 'MP-TARJ'),
    dueDate: toIsoDateOnly(mp.dateApproved),
    createdAtMs: toTimestampMs(mp.dateApproved),
    note: [
      mp.description ||
        (isMeli
          ? 'Compra en Mercado Libre'
          : mp.mpChannel === 'mp_point'
            ? mp.isOutflow
              ? 'Pago Point Smart'
              : 'Cobro Point Smart'
            : mp.mpChannel === 'mp_qr'
              ? 'Cobro QR Mercado Pago'
              : mp.mpChannel === 'mp_transfer'
                ? 'Transferencia Mercado Pago'
                : 'Pago con Tarjeta'),
      mp.paymentMethodId ? mp.paymentMethodId.toUpperCase() : '',
      mp.cardLastFour ? `****${mp.cardLastFour}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

export async function syncSaleToPurchases(
  ownerId: string,
  sale: SaleRecord,
  mpConfig?: Partial<MercadoPagoConfig> | null
): Promise<number> {
  if (!ownerId || !isSafeId(ownerId)) return 0;
  const cfg = mpConfig || loadMercadoPagoConfig(ownerId);
  const descriptors = extractDescriptorsFromSale(sale, cfg);
  let synced = 0;
  for (const desc of descriptors) {
    try {
      await upsertRow('purchases', buildPurchasePayloadFromDescriptor(ownerId, desc));
      synced += 1;
    } catch {
      // Non-fatal sync
    }
  }
  return synced;
}

export async function syncRepairToPurchases(
  ownerId: string,
  repair: RepairRecord,
  mpConfig?: Partial<MercadoPagoConfig> | null
): Promise<number> {
  if (!ownerId || !isSafeId(ownerId)) return 0;
  const cfg = mpConfig || loadMercadoPagoConfig(ownerId);
  const descriptors = extractDescriptorsFromRepair(repair, cfg);
  let synced = 0;
  for (const desc of descriptors) {
    try {
      await upsertRow('purchases', buildPurchasePayloadFromDescriptor(ownerId, desc));
      synced += 1;
    } catch {
      // Non-fatal sync
    }
  }
  return synced;
}

export async function syncRecoveredEntryToPurchase(
  ownerId: string,
  entry: RecoveredPaymentEntry,
  mpConfig?: Partial<MercadoPagoConfig> | null
): Promise<boolean> {
  if (!ownerId || !isSafeId(ownerId)) return false;
  const cfg = mpConfig || loadMercadoPagoConfig(ownerId);
  const desc = extractDescriptorFromRecovered(entry, cfg);
  if (!desc) return false;
  try {
    await upsertRow('purchases', buildPurchasePayloadFromDescriptor(ownerId, desc));
    return true;
  } catch {
    return false;
  }
}

export async function syncAllElectronicPaymentsToPurchases(params: {
  ownerId: string;
  sales: SaleRecord[];
  repairs: RepairRecord[];
  purchases: PurchaseRecord[];
  recoveredEntries?: RecoveredPaymentEntry[];
  mpPayments?: MpRecentPayment[];
  mpConfig?: Partial<MercadoPagoConfig> | null;
  respectDismissed?: boolean;
}): Promise<{ created: number; updated: number }> {
  const {
    ownerId,
    sales,
    repairs,
    purchases,
    recoveredEntries = [],
    mpPayments = [],
    respectDismissed = true,
  } = params;
  if (!ownerId || !isSafeId(ownerId)) return { created: 0, updated: 0 };

  const cfg = params.mpConfig || loadMercadoPagoConfig(ownerId);
  const dismissed = respectDismissed ? loadDismissedOriginIds(ownerId) : new Set<string>();

  const existingById = new Map<string, { row: PurchaseRecord; info: ReturnType<typeof parsePurchaseInfo> }>();
  const existingByOriginId = new Map<string, { row: PurchaseRecord; info: ReturnType<typeof parsePurchaseInfo> }>();
  const existingByMpPaymentId = new Map<string, { row: PurchaseRecord; info: ReturnType<typeof parsePurchaseInfo> }>();
  const existingByMpOrderId = new Map<string, { row: PurchaseRecord; info: ReturnType<typeof parsePurchaseInfo> }>();
  const existingByExtRef = new Map<string, { row: PurchaseRecord; info: ReturnType<typeof parsePurchaseInfo> }>();

  for (const p of purchases) {
    const info = parsePurchaseInfo(p);
    const wrap = { row: p, info };
    existingById.set(p.id, wrap);
    if (info.originRecordId) existingByOriginId.set(info.originRecordId, wrap);
    if (info.mpPaymentId) existingByMpPaymentId.set(info.mpPaymentId, wrap);
    if (info.mpOrderId) existingByMpOrderId.set(info.mpOrderId, wrap);
    const normExt = normalizeExtRef(info.mpExternalReference);
    if (normExt) existingByExtRef.set(normExt, wrap);
  }

  // Track MP identifiers already linked to saved Sales/Repairs so mp_sync doesn't duplicate them
  const savedOrderIds = new Set<string>();
  const savedPaymentIds = new Set<string>();
  const savedExtRefs = new Set<string>();

  const candidates: ElectronicPurchaseDescriptor[] = [];

  for (const sale of sales) {
    const details = parseSaleDetails(sale);
    if (details.mpOrderId) savedOrderIds.add(details.mpOrderId);
    if (details.mpPaymentId) savedPaymentIds.add(details.mpPaymentId);
    const normExt = normalizeExtRef(details.mpExternalReference);
    if (normExt) savedExtRefs.add(normExt);
    candidates.push(...extractDescriptorsFromSale(sale, cfg));
  }

  for (const repair of repairs) {
    const ledger = parseRepairPaymentLedger(repair.checkoutState);
    for (const entry of ledger) {
      if (entry.mpOrderId) savedOrderIds.add(entry.mpOrderId);
      const normExt = normalizeExtRef(entry.mpExternalReference);
      if (normExt) savedExtRefs.add(normExt);
    }
    candidates.push(...extractDescriptorsFromRepair(repair, cfg));
  }

  for (const rec of recoveredEntries) {
    if (rec.reconciledSaleId && sales.some((s) => s.id === rec.reconciledSaleId)) continue;
    if (rec.reconciledRepairId && repairs.some((r) => r.id === rec.reconciledRepairId)) continue;
    if (rec.mpOrderId && savedOrderIds.has(rec.mpOrderId)) continue;
    if (rec.mpCompanionOrderId && savedOrderIds.has(rec.mpCompanionOrderId)) continue;
    if (rec.mpPaymentId && savedPaymentIds.has(rec.mpPaymentId)) continue;
    const normExt = normalizeExtRef(rec.mpExternalReference);
    if (normExt && savedExtRefs.has(normExt)) continue;

    const desc = extractDescriptorFromRecovered(rec, cfg);
    if (desc) candidates.push(desc);
  }

  for (const mp of mpPayments) {
    if (mp.orderId && savedOrderIds.has(mp.orderId)) continue;
    if (mp.paymentId && savedPaymentIds.has(mp.paymentId)) continue;
    const normExt = normalizeExtRef(mp.externalReference);
    if (normExt && savedExtRefs.has(normExt)) continue;
    const desc = extractDescriptorFromMpRecent(mp, cfg);
    if (desc) candidates.push(desc);
  }

  const processedKeys = new Set<string>();
  let created = 0;
  let updated = 0;

  for (const desc of candidates) {
    if (desc.amount <= 0) continue;
    const targetId = makeMirroredPurchaseId(desc.originRecordId);
    if (processedKeys.has(targetId)) continue;
    processedKeys.add(targetId);

    if (
      dismissed.has(targetId) ||
      dismissed.has(desc.originRecordId) ||
      (desc.mpPaymentId && dismissed.has(`mp_pay_${desc.mpPaymentId}`)) ||
      (desc.mpOrderId && dismissed.has(`mp_ord_${desc.mpOrderId}`))
    ) {
      continue;
    }

    const normExt = normalizeExtRef(desc.mpExternalReference);
    const existing =
      existingById.get(targetId) ||
      existingByOriginId.get(desc.originRecordId) ||
      (desc.mpPaymentId ? existingByMpPaymentId.get(desc.mpPaymentId) : undefined) ||
      (desc.mpOrderId ? existingByMpOrderId.get(desc.mpOrderId) : undefined) ||
      (normExt ? existingByExtRef.get(normExt) : undefined);

    if (existing) {
      const needsPointEnrich = Boolean(desc.mpPointName && !existing.info.mpPointName);
      const needsPaymentIdEnrich = Boolean(desc.mpPaymentId && !existing.info.mpPaymentId);
      const needsChannelEnrich = Boolean(desc.mpChannel && !existing.info.mpChannel);
      const needsOutflowEnrich = Boolean(desc.isOutflow && !existing.info.isOutflow);
      const needsAmountUpdate =
        (isMirroredIncomePurchase(existing.info) || existing.info.originType === 'mp_meli') &&
        Math.abs(Number(existing.row.amount || 0) - desc.amount) > 0.01;

      if (
        needsPointEnrich ||
        needsPaymentIdEnrich ||
        needsChannelEnrich ||
        needsOutflowEnrich ||
        needsAmountUpdate
      ) {
        const nextStatus = serializePurchaseStatus({
          status: existing.info.baseStatus,
          currency: existing.info.currency,
          rate: existing.info.rate,
          category: existing.info.category,
          note: existing.info.note || desc.note,
          stockItems: existing.info.stockItems,
          paymentMethod: existing.info.paymentMethod || desc.paymentMethod,
          mpChannel: existing.info.mpChannel || desc.mpChannel,
          mpPointName: existing.info.mpPointName || desc.mpPointName,
          mpOrderId: existing.info.mpOrderId || desc.mpOrderId,
          mpPaymentId: existing.info.mpPaymentId || desc.mpPaymentId,
          mpExternalReference: existing.info.mpExternalReference || desc.mpExternalReference,
          originType:
            existing.info.originType === 'mp_sync' && desc.originType === 'mp_meli'
              ? 'mp_meli'
              : existing.info.originType,
          originRecordId: existing.info.originRecordId || desc.originRecordId,
          isOutflow: existing.info.isOutflow || desc.isOutflow,
        });
        try {
          await updateRow('purchases', existing.row.id, {
            amount: needsAmountUpdate ? desc.amount : existing.row.amount,
            supplierName:
              (needsPointEnrich || needsChannelEnrich) &&
              (isMirroredIncomePurchase(existing.info) || existing.info.originType === 'mp_meli')
                ? buildSupplierLabel(desc)
                : existing.row.supplierName,
            status: nextStatus,
          });
          updated += 1;
        } catch {
          // Non-fatal update
        }
      }
      continue;
    }

    try {
      const payload = buildPurchasePayloadFromDescriptor(ownerId, desc, targetId);
      await upsertRow('purchases', payload);
      existingById.set(targetId, {
        row: payload as unknown as PurchaseRecord,
        info: parsePurchaseInfo({ status: String(payload.status || '') }),
      });
      if (desc.mpPaymentId) {
        existingByMpPaymentId.set(desc.mpPaymentId, existingById.get(targetId)!);
      }
      if (desc.mpOrderId) {
        existingByMpOrderId.set(desc.mpOrderId, existingById.get(targetId)!);
      }
      created += 1;
    } catch {
      // Non-fatal sync error
    }
  }

  return { created, updated };
}
