import type { SaleRecord } from '../types/workshop';
import { isValidCurrencyCode, type CurrencyCode } from './currency';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from './payment';

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

export function parseSalePaymentInfo(sale: Pick<SaleRecord, 'status' | 'amount'>): ParsedSalePaymentInfo {
  const raw = (sale.status || '').toLowerCase().trim();
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

export function serializeSaleStatus(params: {
  status: 'cobrado' | 'pendiente';
  method: PaymentMethod;
  deposit?: number;
  amount: number;
  currency?: CurrencyCode | null;
  rate?: number | null;
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

  return extras.length > 0 ? `${base}:${extras.join(':')}` : base;
}
