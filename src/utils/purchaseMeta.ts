import type { PurchaseRecord } from '../types/workshop';
import { isValidCurrencyCode, type CurrencyCode } from './currency';
import type { PaymentMethod } from './payment';
import { sanitizePlainLine, sanitizeText } from './validation';

const PUR_META_MARKER = '<!--TH3BNB_PUR:';
const PUR_META_END = '-->';

export type PurchaseCategory = 'repuestos' | 'gasto_fijo' | 'herramientas' | 'otro';
export type PurchaseOriginType = 'manual' | 'venta' | 'reparacion' | 'mp_sync';

export const PURCHASE_CATEGORY_LABELS: Record<PurchaseCategory, string> = {
  repuestos: 'Repuestos / Stock',
  gasto_fijo: 'Gasto fijo / Servicios',
  herramientas: 'Herramientas / Taller',
  otro: 'Otro gasto',
};

export const PURCHASE_ORIGIN_LABELS: Record<PurchaseOriginType, string> = {
  manual: 'Compra / Gasto',
  venta: 'Venta / Mostrador',
  reparacion: 'Reparación',
  mp_sync: 'Mercado Pago',
};

export interface PurchaseStockLine {
  productId: string;
  name: string;
  qty: number;
  unitCost: number;
}

export interface PurchaseExtraMeta {
  category?: PurchaseCategory;
  note?: string;
  stockItems?: PurchaseStockLine[];
  paymentMethod?: PaymentMethod;
  mpChannel?: 'mp_point' | 'mp_qr';
  mpPointName?: string;
  mpOrderId?: string;
  mpPaymentId?: string;
  mpExternalReference?: string;
  originType?: PurchaseOriginType;
  originRecordId?: string;
}

export interface ParsedPurchaseInfo {
  isPaid: boolean;
  baseStatus: 'pendiente' | 'pagado';
  currency: CurrencyCode | null;
  rate: number | null;
  category: PurchaseCategory;
  note: string;
  stockItems: PurchaseStockLine[];
  paymentMethod?: PaymentMethod;
  mpChannel?: 'mp_point' | 'mp_qr';
  mpPointName?: string;
  mpOrderId?: string;
  mpPaymentId?: string;
  mpExternalReference?: string;
  originType: PurchaseOriginType;
  originRecordId?: string;
}

export function isMirroredIncomePurchase(
  info: Pick<ParsedPurchaseInfo, 'originType'>
): boolean {
  return (
    info.originType === 'venta' ||
    info.originType === 'reparacion' ||
    info.originType === 'mp_sync'
  );
}

function splitPurchaseStatusAndMeta(rawStatus?: string | null): {
  head: string;
  metaJson: string | null;
} {
  const full = String(rawStatus || '');
  const idx = full.indexOf(PUR_META_MARKER);
  if (idx === -1) return { head: full, metaJson: null };
  const head = full.slice(0, idx).trim();
  const after = full.slice(idx + PUR_META_MARKER.length);
  const endIdx = after.lastIndexOf(PUR_META_END);
  const metaJson = (endIdx !== -1 ? after.slice(0, endIdx) : after).trim();
  return { head, metaJson };
}

function sanitizeCategory(raw: unknown): PurchaseCategory {
  if (
    raw === 'repuestos' ||
    raw === 'gasto_fijo' ||
    raw === 'herramientas' ||
    raw === 'otro'
  ) {
    return raw;
  }
  return 'repuestos';
}

function sanitizeOriginType(raw: unknown): PurchaseOriginType {
  if (raw === 'venta' || raw === 'reparacion' || raw === 'mp_sync' || raw === 'manual') {
    return raw;
  }
  return 'manual';
}

function sanitizePurchaseMethod(raw: unknown): PaymentMethod | undefined {
  if (raw === 'efectivo' || raw === 'transferencia' || raw === 'tarjeta') {
    return raw;
  }
  return undefined;
}

export function parsePurchaseInfo(purchase: Pick<PurchaseRecord, 'status'>): ParsedPurchaseInfo {
  const { head, metaJson } = splitPurchaseStatusAndMeta(purchase.status);
  const raw = head.toLowerCase().trim();
  const isPaid = raw.startsWith('pagado');

  let currency: CurrencyCode | null = null;
  const curMatch = raw.match(/cur=([a-z]{3})/);
  if (curMatch) {
    const upper = curMatch[1].toUpperCase();
    if (isValidCurrencyCode(upper)) {
      currency = upper;
    }
  }

  let rate: number | null = null;
  const rateMatch = raw.match(/rate=([0-9]+(?:\.[0-9]+)?)/);
  if (rateMatch) {
    const parsedRate = Number(rateMatch[1]);
    if (Number.isFinite(parsedRate) && parsedRate > 0) {
      rate = parsedRate;
    }
  }

  let category: PurchaseCategory = 'repuestos';
  let note = '';
  let stockItems: PurchaseStockLine[] = [];
  let paymentMethod: PaymentMethod | undefined;
  let mpChannel: 'mp_point' | 'mp_qr' | undefined;
  let mpPointName: string | undefined;
  let mpOrderId: string | undefined;
  let mpPaymentId: string | undefined;
  let mpExternalReference: string | undefined;
  let originType: PurchaseOriginType = 'manual';
  let originRecordId: string | undefined;

  if (metaJson) {
    try {
      const parsed = JSON.parse(metaJson) as PurchaseExtraMeta;
      category = sanitizeCategory(parsed.category);
      note = parsed.note ? sanitizeText(String(parsed.note), 400) : '';
      paymentMethod = sanitizePurchaseMethod(parsed.paymentMethod);
      if (parsed.mpChannel === 'mp_point' || parsed.mpChannel === 'mp_qr') {
        mpChannel = parsed.mpChannel;
      }
      if (parsed.mpPointName) {
        mpPointName = sanitizePlainLine(String(parsed.mpPointName), 120) || undefined;
      }
      if (parsed.mpOrderId) {
        mpOrderId = sanitizePlainLine(String(parsed.mpOrderId), 80) || undefined;
      }
      if (parsed.mpPaymentId) {
        mpPaymentId = sanitizePlainLine(String(parsed.mpPaymentId), 80) || undefined;
      }
      if (parsed.mpExternalReference) {
        mpExternalReference = sanitizePlainLine(String(parsed.mpExternalReference), 80) || undefined;
      }
      originType = sanitizeOriginType(parsed.originType);
      if (parsed.originRecordId) {
        originRecordId = sanitizePlainLine(String(parsed.originRecordId), 120) || undefined;
      }
      if (Array.isArray(parsed.stockItems)) {
        stockItems = parsed.stockItems
          .slice(0, 40)
          .filter((s) => s && s.productId && Number(s.qty || 0) > 0)
          .map((s) => ({
            productId: sanitizePlainLine(String(s.productId), 120),
            name: sanitizePlainLine(String(s.name || 'Producto'), 140),
            qty: Math.max(1, Math.round(Number(s.qty || 1))),
            unitCost: Math.max(0, Math.round(Number(s.unitCost || 0) * 100) / 100),
          }));
      }
    } catch {
      // Fallback safely on corrupted meta
    }
  }

  return {
    isPaid,
    baseStatus: isPaid ? 'pagado' : 'pendiente',
    currency,
    rate,
    category,
    note,
    stockItems,
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(mpChannel ? { mpChannel } : {}),
    ...(mpPointName ? { mpPointName } : {}),
    ...(mpOrderId ? { mpOrderId } : {}),
    ...(mpPaymentId ? { mpPaymentId } : {}),
    ...(mpExternalReference ? { mpExternalReference } : {}),
    originType,
    ...(originRecordId ? { originRecordId } : {}),
  };
}

export function serializePurchaseStatus(params: {
  status: 'pendiente' | 'pagado';
  currency?: CurrencyCode | null;
  rate?: number | null;
  category?: PurchaseCategory;
  note?: string;
  stockItems?: PurchaseStockLine[];
  paymentMethod?: PaymentMethod;
  mpChannel?: 'mp_point' | 'mp_qr';
  mpPointName?: string;
  mpOrderId?: string;
  mpPaymentId?: string;
  mpExternalReference?: string;
  originType?: PurchaseOriginType;
  originRecordId?: string;
}): string {
  const extras: string[] = [];
  if (params.currency && isValidCurrencyCode(params.currency)) {
    extras.push(`cur=${params.currency.toUpperCase()}`);
  }
  if (params.rate && Number.isFinite(params.rate) && params.rate > 0 && params.rate !== 1) {
    extras.push(`rate=${Math.round(params.rate * 1_000_000) / 1_000_000}`);
  }
  const head = extras.length > 0 ? `${params.status}:${extras.join(':')}` : params.status;

  const cleanCategory = sanitizeCategory(params.category);
  const cleanNote = params.note ? sanitizeText(params.note, 400).replace(/-->/g, '').trim() : '';
  const cleanStockItems = (params.stockItems || [])
    .filter((s) => s.productId && s.qty > 0)
    .slice(0, 40)
    .map((s) => ({
      productId: sanitizePlainLine(s.productId, 120),
      name: sanitizePlainLine(s.name, 140).replace(/-->/g, ''),
      qty: Math.max(1, Math.round(s.qty)),
      unitCost: Math.max(0, Math.round(Number(s.unitCost || 0) * 100) / 100),
    }));

  const cleanMethod = sanitizePurchaseMethod(params.paymentMethod);
  const cleanChannel =
    params.mpChannel === 'mp_point' || params.mpChannel === 'mp_qr'
      ? params.mpChannel
      : undefined;
  const cleanPointName = params.mpPointName
    ? sanitizePlainLine(params.mpPointName, 120).replace(/-->/g, '')
    : '';
  const cleanOrderId = params.mpOrderId
    ? sanitizePlainLine(params.mpOrderId, 80).replace(/-->/g, '')
    : '';
  const cleanPaymentId = params.mpPaymentId
    ? sanitizePlainLine(params.mpPaymentId, 80).replace(/-->/g, '')
    : '';
  const cleanExtRef = params.mpExternalReference
    ? sanitizePlainLine(params.mpExternalReference, 80).replace(/-->/g, '')
    : '';
  const cleanOrigin = sanitizeOriginType(params.originType);
  const cleanOriginRecordId = params.originRecordId
    ? sanitizePlainLine(params.originRecordId, 120).replace(/-->/g, '')
    : '';

  if (
    cleanCategory === 'repuestos' &&
    !cleanNote &&
    cleanStockItems.length === 0 &&
    !cleanMethod &&
    !cleanChannel &&
    !cleanPointName &&
    !cleanOrderId &&
    !cleanPaymentId &&
    !cleanExtRef &&
    cleanOrigin === 'manual' &&
    !cleanOriginRecordId
  ) {
    return head;
  }

  const meta: PurchaseExtraMeta = {
    category: cleanCategory,
    ...(cleanNote ? { note: cleanNote } : {}),
    ...(cleanStockItems.length > 0 ? { stockItems: cleanStockItems } : {}),
    ...(cleanMethod ? { paymentMethod: cleanMethod } : {}),
    ...(cleanChannel ? { mpChannel: cleanChannel } : {}),
    ...(cleanPointName ? { mpPointName: cleanPointName } : {}),
    ...(cleanOrderId ? { mpOrderId: cleanOrderId } : {}),
    ...(cleanPaymentId ? { mpPaymentId: cleanPaymentId } : {}),
    ...(cleanExtRef ? { mpExternalReference: cleanExtRef } : {}),
    ...(cleanOrigin !== 'manual' ? { originType: cleanOrigin } : {}),
    ...(cleanOriginRecordId ? { originRecordId: cleanOriginRecordId } : {}),
  };

  return `${head}\n${PUR_META_MARKER}${JSON.stringify(meta)}${PUR_META_END}`;
}
