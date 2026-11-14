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
  _brandName?: string,
  _repairCode?: string,
  _clientName?: string,
  _amount?: number
): string {
  const link = cfg.paymentLink.trim();
  return link || '';
}

export function buildTransferWhatsAppText(
  cfg: TransferConfig,
  params: {
    brandName: string;
    code: string;
    clientName: string;
    amount: number;
  }
): string {
  const lines = [
    `Hola ${params.clientName}, te pasamos los datos de ${params.brandName || 'TH3 BNB'} para abonar por transferencia (${params.code}):`,
    `• Monto: $${params.amount.toLocaleString('es-AR', { minimumFractionDigits: params.amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`,
  ];
  if (cfg.alias.trim()) lines.push(`• Alias: ${cfg.alias.trim()}`);
  if (cfg.cbu.trim()) lines.push(`• CBU/CVU: ${cfg.cbu.trim()}`);
  if (cfg.holder.trim()) lines.push(`• Titular: ${cfg.holder.trim()}`);
  if (cfg.paymentLink.trim()) lines.push(`• Link de pago: ${cfg.paymentLink.trim()}`);
  lines.push('Cuando realices el pago, enviános el comprobante por acá.');
  return lines.join('\n');
}
