import type { RepairRecord } from '../types/workshop';
import { decryptJsonValue, encryptJsonValue, isEncryptedValue } from './crypto';
import { formatCurrency } from './formatters';
import {
  isSafeId,
  sanitizeAlias,
  sanitizeCbu,
  sanitizeImageDataUrl,
  sanitizePlainLine,
  sanitizeSafeUrl,
} from './validation';

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

const transferConfigCache = new Map<string, TransferConfig>();

function sanitizeTransferConfig(cfg: Partial<TransferConfig> | null | undefined): TransferConfig {
  if (!cfg || typeof cfg !== 'object') return { ...EMPTY_TRANSFER_CONFIG };
  return {
    alias: sanitizeAlias(cfg.alias || ''),
    cbu: sanitizeCbu(cfg.cbu || ''),
    holder: sanitizePlainLine(cfg.holder || '', 120),
    paymentLink: sanitizeSafeUrl(cfg.paymentLink || '', 400),
    qrImageDataUrl: sanitizeImageDataUrl(cfg.qrImageDataUrl || '', 1_200_000),
  };
}

function getStorageKey(ownerId: string): string {
  return `th3bnb_transfer_cfg_${ownerId}`;
}

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
  if (!ownerId || !isSafeId(ownerId) || typeof window === 'undefined') {
    return { ...EMPTY_TRANSFER_CONFIG };
  }
  const cached = transferConfigCache.get(ownerId);
  if (cached) return { ...cached };

  try {
    const raw = window.localStorage.getItem(getStorageKey(ownerId));
    if (!raw) return { ...EMPTY_TRANSFER_CONFIG };
    if (isEncryptedValue(raw)) {
      // Encrypted value will be populated as soon as hydrateTransferConfig completes
      return { ...EMPTY_TRANSFER_CONFIG };
    }
    const parsed = JSON.parse(raw) as Partial<TransferConfig>;
    const clean = sanitizeTransferConfig(parsed);
    transferConfigCache.set(ownerId, clean);
    return { ...clean };
  } catch {
    return { ...EMPTY_TRANSFER_CONFIG };
  }
}

export async function hydrateTransferConfig(ownerId: string): Promise<TransferConfig> {
  if (!ownerId || !isSafeId(ownerId) || typeof window === 'undefined') {
    return { ...EMPTY_TRANSFER_CONFIG };
  }
  try {
    const raw = window.localStorage.getItem(getStorageKey(ownerId));
    if (!raw) {
      const empty = { ...EMPTY_TRANSFER_CONFIG };
      transferConfigCache.set(ownerId, empty);
      return empty;
    }

    if (isEncryptedValue(raw)) {
      const parsed = await decryptJsonValue<Partial<TransferConfig>>(
        raw,
        ownerId,
        EMPTY_TRANSFER_CONFIG
      );
      const clean = sanitizeTransferConfig(parsed);
      transferConfigCache.set(ownerId, clean);
      return { ...clean };
    }

    // Legacy plaintext config found: parse & migrate immediately to AES-256-GCM
    const parsed = JSON.parse(raw) as Partial<TransferConfig>;
    const clean = sanitizeTransferConfig(parsed);
    transferConfigCache.set(ownerId, clean);
    const encrypted = await encryptJsonValue(clean, ownerId);
    if (encrypted) {
      window.localStorage.setItem(getStorageKey(ownerId), encrypted);
    }
    return { ...clean };
  } catch {
    return { ...EMPTY_TRANSFER_CONFIG };
  }
}

export function saveTransferConfig(ownerId: string, config: TransferConfig): void {
  if (!ownerId || !isSafeId(ownerId) || typeof window === 'undefined') return;
  const clean = sanitizeTransferConfig(config);
  transferConfigCache.set(ownerId, clean);

  void encryptJsonValue(clean, ownerId)
    .then((encrypted) => {
      try {
        window.localStorage.setItem(getStorageKey(ownerId), encrypted);
      } catch {
        // Ignore storage quota issues
      }
    })
    .catch(() => {
      // Ignore crypto failure
    });
}

export function clearTransferConfigCache(ownerId?: string): void {
  if (ownerId) {
    transferConfigCache.delete(ownerId);
  } else {
    transferConfigCache.clear();
  }
}

export function buildTransferQrPayload(
  cfg: TransferConfig,
  _brandName?: string,
  _repairCode?: string,
  _clientName?: string,
  _amount?: number
): string {
  return sanitizeSafeUrl(cfg.paymentLink, 400);
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
  const safeAmount = Number.isFinite(params.amount) ? Math.max(0, params.amount) : 0;
  const lines = [
    `Hola ${sanitizePlainLine(params.clientName, 120)}, te pasamos los datos de ${sanitizePlainLine(params.brandName || 'TH3 BNB', 80)} para abonar por transferencia (${sanitizePlainLine(params.code, 40)}):`,
    `• Monto: ${formatCurrency(safeAmount)}`,
  ];
  if (cfg.alias.trim()) lines.push(`• Alias: ${cfg.alias.trim()}`);
  if (cfg.cbu.trim()) lines.push(`• CBU/CVU: ${cfg.cbu.trim()}`);
  if (cfg.holder.trim()) lines.push(`• Titular: ${cfg.holder.trim()}`);
  const safeLink = sanitizeSafeUrl(cfg.paymentLink, 400);
  if (safeLink) lines.push(`• Link de pago: ${safeLink}`);
  lines.push('Cuando realices el pago, enviános el comprobante por acá.');
  return lines.join('\n');
}
