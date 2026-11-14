import type { RepairRecord } from '../types/workshop';

export type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
};

export interface TransferConfig {
  alias: string;
  cbu: string;
  holder: string;
  paymentLink: string;
  qrImageDataUrl: string;
}

const EMPTY_TRANSFER_CONFIG: TransferConfig = {
  alias: '',
  cbu: '',
  holder: '',
  paymentLink: '',
  qrImageDataUrl: '',
};

export function parsePaymentInfo(repair: RepairRecord): {
  isPaid: boolean;
  method: PaymentMethod | null;
  methodLabel: string | null;
} {
  const raw = (repair.paymentStatus || '').toLowerCase().trim();
  const price = Number(repair.price || 0);
  const deposit = Number(repair.deposit || 0);
  const pending = Math.max(0, price - deposit);

  let method: PaymentMethod | null = null;
  if (raw.includes('efectivo')) method = 'efectivo';
  else if (raw.includes('transferencia')) method = 'transferencia';
  else if (raw.includes('tarjeta')) method = 'tarjeta';

  const isPaid =
    raw.startsWith('pagado') || (price > 0 && pending === 0);

  return {
    isPaid,
    method,
    methodLabel: method ? PAYMENT_METHOD_LABELS[method] : null,
  };
}

export function loadTransferConfig(ownerId: string): TransferConfig {
  if (!ownerId || typeof window === 'undefined') return EMPTY_TRANSFER_CONFIG;
  try {
    const raw = window.localStorage.getItem(`th3bnb_transfer_cfg_${ownerId}`);
    if (!raw) return EMPTY_TRANSFER_CONFIG;
    const parsed = JSON.parse(raw) as Partial<TransferConfig>;
    return {
      alias: parsed.alias || '',
      cbu: parsed.cbu || '',
      holder: parsed.holder || '',
      paymentLink: parsed.paymentLink || '',
      qrImageDataUrl: parsed.qrImageDataUrl || '',
    };
  } catch {
    return EMPTY_TRANSFER_CONFIG;
  }
}

export function saveTransferConfig(ownerId: string, config: TransferConfig): void {
  if (!ownerId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`th3bnb_transfer_cfg_${ownerId}`, JSON.stringify(config));
  } catch {
    // Ignore storage quota issues
  }
}

export function buildTransferQrPayload(
  cfg: TransferConfig,
  brandName: string,
  repairCode: string,
  clientName: string,
  amount: number
): string {
  if (cfg.paymentLink.trim()) {
    return cfg.paymentLink.trim();
  }
  const lines = [
    `PAGO TRANSFERENCIA - ${brandName || 'TH3 BNB'}`,
    `Orden: ${repairCode}`,
    `Cliente: ${clientName}`,
    `Monto: $${amount.toFixed(2)}`,
  ];
  if (cfg.alias.trim()) lines.push(`Alias: ${cfg.alias.trim()}`);
  if (cfg.cbu.trim()) lines.push(`CBU/CVU: ${cfg.cbu.trim()}`);
  if (cfg.holder.trim()) lines.push(`Titular: ${cfg.holder.trim()}`);
  return lines.join('\n');
}
