import type { SaleRecord } from '../types/workshop';
import { isValidCurrencyCode, type CurrencyCode } from './currency';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from './payment';
import { sanitizePlainLine, sanitizeText } from './validation';

const SALE_META_MARKER = '<!--TH3BNB_SALE:';
const SALE_META_END = '-->';

export type SaleAdjustmentType = 'percent' | 'fixed';

export interface SaleCartItem {
  id: string;
  productId?: string;
  name: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface SalePaymentEntry {
  id: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  note?: string;
}

export type MpPaymentChannel = 'mp_point' | 'mp_qr';

export interface SaleExtraMeta {
  items?: SaleCartItem[];
  subtotal?: number;
  discountType?: SaleAdjustmentType;
  discountValue?: number;
  discountAmount?: number;
  surchargeType?: SaleAdjustmentType;
  surchargeValue?: number;
  surchargeAmount?: number;
  payments?: SalePaymentEntry[];
  note?: string;
  mpChannel?: MpPaymentChannel;
  mpOrderId?: string;
  mpExternalReference?: string;
  mpPaymentId?: string;
}

export interface ParsedSaleDetails {
  items: SaleCartItem[];
  subtotal: number;
  discountType: SaleAdjustmentType;
  discountValue: number;
  discountAmount: number;
  surchargeType: SaleAdjustmentType;
  surchargeValue: number;
  surchargeAmount: number;
  payments: SalePaymentEntry[];
  note: string;
  mpChannel?: MpPaymentChannel;
  mpOrderId?: string;
  mpExternalReference?: string;
  mpPaymentId?: string;
  hasStructuredMeta: boolean;
}

export interface ParsedSalePaymentInfo {
  isPaid: boolean;
  baseStatus: 'cobrado' | 'pendiente';
  method: PaymentMethod | null;
  methodLabel: string | null;
  deposit: number;
  pending: number;
  currency: CurrencyCode | null;
  rate: number | null;
}

function splitSaleStatusAndMeta(rawStatus?: string | null): {
  statusHead: string;
  metaJson: string | null;
} {
  const full = String(rawStatus || '');
  const idx = full.indexOf(SALE_META_MARKER);
  if (idx === -1) {
    return { statusHead: full, metaJson: null };
  }
  const statusHead = full.slice(0, idx).trim();
  const after = full.slice(idx + SALE_META_MARKER.length);
  const endIdx = after.lastIndexOf(SALE_META_END);
  const metaJson = (endIdx !== -1 ? after.slice(0, endIdx) : after).trim();
  return { statusHead, metaJson };
}

function safeRoundMoney(n: unknown): number {
  const val = Number(n);
  if (!Number.isFinite(val) || val < 0) return 0;
  return Math.round(val * 100) / 100;
}

function sanitizeMethod(raw: unknown): PaymentMethod {
  if (raw === 'transferencia' || raw === 'tarjeta' || raw === 'efectivo') {
    return raw;
  }
  return 'efectivo';
}

export function parseSalePaymentInfo(
  sale: Pick<SaleRecord, 'status' | 'amount'>
): ParsedSalePaymentInfo {
  const { statusHead } = splitSaleStatusAndMeta(sale.status);
  const raw = statusHead.toLowerCase().trim();
  const amount = Math.max(0, Number(sale.amount || 0));

  let method: PaymentMethod | null = null;
  if (raw.includes('efectivo')) method = 'efectivo';
  else if (raw.includes('transferencia')) method = 'transferencia';
  else if (raw.includes('tarjeta')) method = 'tarjeta';

  let parsedDeposit = 0;
  const senaMatch = raw.match(/sena=([0-9]+(?:\.[0-9]+)?)/);
  if (senaMatch) {
    const val = Number(senaMatch[1]);
    if (Number.isFinite(val) && val > 0) {
      parsedDeposit = Math.min(amount > 0 ? amount : val, val);
    }
  }

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

  const isCobrado = raw.startsWith('cobrado') || (amount > 0 && parsedDeposit >= amount);
  const deposit = isCobrado ? amount : parsedDeposit;
  const pending = Math.max(0, amount - deposit);

  return {
    isPaid: isCobrado,
    baseStatus: isCobrado ? 'cobrado' : 'pendiente',
    method,
    methodLabel: method ? PAYMENT_METHOD_LABELS[method] : null,
    deposit,
    pending,
    currency,
    rate,
  };
}

export function parseSaleDetails(
  sale: Pick<SaleRecord, 'status' | 'amount' | 'productId' | 'productName' | 'quantity'>
): ParsedSaleDetails {
  const { metaJson } = splitSaleStatusAndMeta(sale.status);
  const fallbackQty = Math.max(1, Math.round(Number(sale.quantity || 1)));
  const fallbackTotal = safeRoundMoney(sale.amount);
  const fallbackUnit =
    fallbackQty > 0 ? Math.round((fallbackTotal / fallbackQty) * 100) / 100 : fallbackTotal;
  const fallbackItem: SaleCartItem = {
    id: 'legacy-item-1',
    productId: sale.productId || undefined,
    name: sanitizePlainLine(sale.productName || 'Venta de mostrador', 160) || 'Venta de mostrador',
    quantity: fallbackQty,
    unitPrice: fallbackUnit,
    subtotal: fallbackTotal,
  };

  if (!metaJson) {
    return {
      items: [fallbackItem],
      subtotal: fallbackTotal,
      discountType: 'percent',
      discountValue: 0,
      discountAmount: 0,
      surchargeType: 'percent',
      surchargeValue: 0,
      surchargeAmount: 0,
      payments: [],
      note: '',
      hasStructuredMeta: false,
    };
  }

  try {
    const parsed = JSON.parse(metaJson) as SaleExtraMeta;
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items: SaleCartItem[] = rawItems
      .slice(0, 60)
      .map((item, idx) => {
        const qty = Math.max(1, Math.round(Number(item?.quantity || 1)));
        const unitPrice = safeRoundMoney(item?.unitPrice);
        const subtotal = safeRoundMoney(
          item?.subtotal !== undefined ? item.subtotal : qty * unitPrice
        );
        return {
          id: sanitizePlainLine(String(item?.id || `item-${idx + 1}`), 64) || `item-${idx + 1}`,
          productId: item?.productId ? sanitizePlainLine(String(item.productId), 120) : undefined,
          name: sanitizePlainLine(String(item?.name || 'Ítem'), 160) || 'Ítem',
          sku: item?.sku ? sanitizePlainLine(String(item.sku), 60) : undefined,
          quantity: qty,
          unitPrice,
          subtotal,
        };
      });

    const resolvedItems = items.length > 0 ? items : [fallbackItem];
    const computedSubtotal = resolvedItems.reduce((sum, item) => sum + item.subtotal, 0);
    const subtotal =
      parsed.subtotal !== undefined ? safeRoundMoney(parsed.subtotal) : safeRoundMoney(computedSubtotal);

    const payments: SalePaymentEntry[] = Array.isArray(parsed.payments)
      ? parsed.payments
          .slice(0, 40)
          .filter((p) => Number(p?.amount || 0) > 0)
          .map((p, idx) => ({
            id: sanitizePlainLine(String(p.id || `pay-${idx + 1}`), 64) || `pay-${idx + 1}`,
            amount: safeRoundMoney(p.amount),
            method: sanitizeMethod(p.method),
            date: sanitizePlainLine(String(p.date || ''), 40) || new Date().toISOString(),
            note: p.note ? sanitizePlainLine(String(p.note), 120) : undefined,
          }))
      : [];

    const mpChannel: MpPaymentChannel | undefined =
      parsed.mpChannel === 'mp_point' || parsed.mpChannel === 'mp_qr'
        ? parsed.mpChannel
        : undefined;

    return {
      items: resolvedItems,
      subtotal,
      discountType: parsed.discountType === 'fixed' ? 'fixed' : 'percent',
      discountValue: safeRoundMoney(parsed.discountValue),
      discountAmount: safeRoundMoney(parsed.discountAmount),
      surchargeType: parsed.surchargeType === 'fixed' ? 'fixed' : 'percent',
      surchargeValue: safeRoundMoney(parsed.surchargeValue),
      surchargeAmount: safeRoundMoney(parsed.surchargeAmount),
      payments,
      note: parsed.note ? sanitizeText(String(parsed.note), 400) : '',
      ...(mpChannel ? { mpChannel } : {}),
      ...(parsed.mpOrderId ? { mpOrderId: sanitizePlainLine(String(parsed.mpOrderId), 80) } : {}),
      ...(parsed.mpExternalReference
        ? { mpExternalReference: sanitizePlainLine(String(parsed.mpExternalReference), 80) }
        : {}),
      ...(parsed.mpPaymentId ? { mpPaymentId: sanitizePlainLine(String(parsed.mpPaymentId), 80) } : {}),
      hasStructuredMeta: true,
    };
  } catch {
    return {
      items: [fallbackItem],
      subtotal: fallbackTotal,
      discountType: 'percent',
      discountValue: 0,
      discountAmount: 0,
      surchargeType: 'percent',
      surchargeValue: 0,
      surchargeAmount: 0,
      payments: [],
      note: '',
      hasStructuredMeta: false,
    };
  }
}

export function serializeSaleStatus(params: {
  status: 'cobrado' | 'pendiente';
  method: PaymentMethod;
  deposit?: number;
  amount: number;
  currency?: CurrencyCode | null;
  rate?: number | null;
  meta?: SaleExtraMeta;
}): string {
  const cleanAmount = Math.max(0, Number(params.amount || 0));
  const cleanDeposit = Math.max(0, Number(params.deposit || 0));

  let base: string;
  if (params.status === 'cobrado' || (cleanAmount > 0 && cleanDeposit >= cleanAmount)) {
    base = `cobrado:${params.method}`;
  } else if (cleanDeposit > 0) {
    const capped = cleanAmount > 0 ? Math.min(cleanAmount, cleanDeposit) : cleanDeposit;
    base = `pendiente:${params.method}:sena=${Number(capped.toFixed(2))}`;
  } else {
    base = `pendiente:${params.method}`;
  }

  const extras: string[] = [];
  if (params.currency && isValidCurrencyCode(params.currency)) {
    extras.push(`cur=${params.currency.toUpperCase()}`);
  }
  if (params.rate && Number.isFinite(params.rate) && params.rate > 0 && params.rate !== 1) {
    extras.push(`rate=${Math.round(params.rate * 1_000_000) / 1_000_000}`);
  }

  const head = extras.length > 0 ? `${base}:${extras.join(':')}` : base;

  const meta = params.meta;
  if (!meta) return head;

  const cleanMeta: SaleExtraMeta = {};
  if (meta.items && meta.items.length > 0) {
    cleanMeta.items = meta.items.slice(0, 60).map((it) => ({
      id: sanitizePlainLine(it.id, 64) || 'it',
      ...(it.productId ? { productId: sanitizePlainLine(it.productId, 120) } : {}),
      name: sanitizePlainLine(it.name, 140).replace(/-->/g, '') || 'Ítem',
      ...(it.sku ? { sku: sanitizePlainLine(it.sku, 60).replace(/-->/g, '') } : {}),
      quantity: Math.max(1, Math.round(Number(it.quantity || 1))),
      unitPrice: safeRoundMoney(it.unitPrice),
      subtotal: safeRoundMoney(it.subtotal),
    }));
  }
  if (meta.subtotal !== undefined) cleanMeta.subtotal = safeRoundMoney(meta.subtotal);
  if (meta.discountAmount && meta.discountAmount > 0) {
    cleanMeta.discountType = meta.discountType === 'fixed' ? 'fixed' : 'percent';
    cleanMeta.discountValue = safeRoundMoney(meta.discountValue);
    cleanMeta.discountAmount = safeRoundMoney(meta.discountAmount);
  }
  if (meta.surchargeAmount && meta.surchargeAmount > 0) {
    cleanMeta.surchargeType = meta.surchargeType === 'fixed' ? 'fixed' : 'percent';
    cleanMeta.surchargeValue = safeRoundMoney(meta.surchargeValue);
    cleanMeta.surchargeAmount = safeRoundMoney(meta.surchargeAmount);
  }
  if (meta.payments && meta.payments.length > 0) {
    cleanMeta.payments = meta.payments
      .filter((p) => Number(p.amount || 0) > 0)
      .slice(0, 40)
      .map((p) => ({
        id: sanitizePlainLine(p.id, 64) || 'pay',
        amount: safeRoundMoney(p.amount),
        method: sanitizeMethod(p.method),
        date: sanitizePlainLine(p.date, 40) || new Date().toISOString(),
        ...(p.note
          ? { note: sanitizePlainLine(p.note, 120).replace(/-->/g, '') }
          : {}),
      }));
  }
  const cleanNote = meta.note ? sanitizeText(meta.note, 400).replace(/-->/g, '').trim() : '';
  if (cleanNote) {
    cleanMeta.note = cleanNote;
  }
  if (meta.mpChannel === 'mp_point' || meta.mpChannel === 'mp_qr') {
    cleanMeta.mpChannel = meta.mpChannel;
  }
  if (meta.mpOrderId) {
    cleanMeta.mpOrderId = sanitizePlainLine(meta.mpOrderId, 80).replace(/-->/g, '');
  }
  if (meta.mpExternalReference) {
    cleanMeta.mpExternalReference = sanitizePlainLine(meta.mpExternalReference, 80).replace(/-->/g, '');
  }
  if (meta.mpPaymentId) {
    cleanMeta.mpPaymentId = sanitizePlainLine(meta.mpPaymentId, 80).replace(/-->/g, '');
  }

  if (Object.keys(cleanMeta).length === 0) {
    return head;
  }

  return `${head}\n${SALE_META_MARKER}${JSON.stringify(cleanMeta)}${SALE_META_END}`;
}

export function summarizeSaleItemsLabel(items: SaleCartItem[], fallbackName?: string): string {
  if (!items || items.length === 0) {
    return sanitizePlainLine(fallbackName || 'Venta de mostrador', 160) || 'Venta de mostrador';
  }
  const first = items[0];
  const firstText =
    first.quantity > 1 ? `${first.name} (x${first.quantity})` : first.name;
  if (items.length === 1) {
    return sanitizePlainLine(firstText, 160);
  }
  return sanitizePlainLine(`${firstText} +${items.length - 1} más`, 160);
}
