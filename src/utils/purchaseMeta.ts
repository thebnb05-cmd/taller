import type { PurchaseRecord } from '../types/workshop';
import { isValidCurrencyCode, type CurrencyCode } from './currency';

export interface ParsedPurchaseInfo {
  isPaid: boolean;
  baseStatus: 'pendiente' | 'pagado';
  currency: CurrencyCode | null;
  rate: number | null;
}

export function parsePurchaseInfo(purchase: Pick<PurchaseRecord, 'status'>): ParsedPurchaseInfo {
  const raw = (purchase.status || '').toLowerCase().trim();
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

  return {
    isPaid,
    baseStatus: isPaid ? 'pagado' : 'pendiente',
    currency,
    rate,
  };
}

export function serializePurchaseStatus(params: {
  status: 'pendiente' | 'pagado';
  currency?: CurrencyCode | null;
  rate?: number | null;
}): string {
  const extras: string[] = [];
  if (params.currency && isValidCurrencyCode(params.currency)) {
    extras.push(`cur=${params.currency.toUpperCase()}`);
  }
  if (params.rate && Number.isFinite(params.rate) && params.rate > 0 && params.rate !== 1) {
    extras.push(`rate=${Math.round(params.rate * 1_000_000) / 1_000_000}`);
  }
  return extras.length > 0 ? `${params.status}:${extras.join(':')}` : params.status;
}
