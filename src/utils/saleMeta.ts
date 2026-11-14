import type { SaleRecord } from '../types/workshop';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from './payment';

export interface ParsedSalePaymentInfo {
  isPaid: boolean;
  baseStatus: 'cobrado' | 'pendiente';
  method: PaymentMethod | null;
  methodLabel: string | null;
  deposit: number;
  pending: number;
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
  };
}

export function serializeSaleStatus(params: {
  status: 'cobrado' | 'pendiente';
  method: PaymentMethod;
  deposit?: number;
  amount: number;
}): string {
  const cleanAmount = Math.max(0, Number(params.amount || 0));
  const cleanDeposit = Math.max(0, Number(params.deposit || 0));

  if (params.status === 'cobrado' || (cleanAmount > 0 && cleanDeposit >= cleanAmount)) {
    return `cobrado:${params.method}`;
  }

  if (cleanDeposit > 0) {
    const capped = cleanAmount > 0 ? Math.min(cleanAmount, cleanDeposit) : cleanDeposit;
    return `pendiente:${params.method}:sena=${Number(capped.toFixed(2))}`;
  }

  return `pendiente:${params.method}`;
}
