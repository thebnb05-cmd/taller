import type { RepairRecord } from '../types/workshop';
import { isValidCurrencyCode, type CurrencyCode } from './currency';
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

export function parsePaymentInfo(repair: Pick<RepairRecord, 'paymentStatus' | 'price' | 'deposit'>): {
  isPaid: boolean;
  method: PaymentMethod | null;
  methodLabel: string | null;
  currency: CurrencyCode | null;
  rate: number | null;
} {
  const raw = (repair.paymentStatus || '').toLowerCase().trim();
  const price = Number(repair.price || 0);
  const deposit = Number(repair.deposit || 0);
  const pending = Math.max(0, price - deposit);

  let method: PaymentMethod | null = null;
  if (raw.includes('efectivo')) method = 'efectivo';
  else if (raw.includes('transferencia')) method = 'transferencia';
  else if (raw.includes('tarjeta')) method = 'tarjeta';

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

  const isPaid =
    raw.startsWith('pagado') || (price > 0 && pending === 0);

  return {
    isPaid,
    method,
    methodLabel: method ? PAYMENT_METHOD_LABELS[method] : null,
    currency,
    rate,
  };
}

export function serializeRepairPaymentStatus(params: {
  base: 'pendiente' | 'parcial' | 'pagado';
  method?: PaymentMethod | null;
  currency?: CurrencyCode | null;
  rate?: number | null;
}): string {
  const parts: string[] = [params.base];
  if (params.method) {
    parts.push(params.method);
  }
  if (params.currency && isValidCurrencyCode(params.currency)) {
    parts.push(`cur=${params.currency.toUpperCase()}`);
  }
  if (params.rate && Number.isFinite(params.rate) && params.rate > 0 && params.rate !== 1) {
    parts.push(`rate=${Math.round(params.rate * 1_000_000) / 1_000_000}`);
  }
  return parts.join(':');
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
    currencyCode?: string | null;
  }
): string {
  const safeAmount = Number.isFinite(params.amount) ? Math.max(0, params.amount) : 0;
  const lines = [
    `Hola ${sanitizePlainLine(params.clientName, 120)}, te pasamos los datos de ${sanitizePlainLine(params.brandName || 'TH3 BNB', 80)} para abonar por transferencia (${sanitizePlainLine(params.code, 40)}):`,
    `• Monto: ${formatCurrency(safeAmount, params.currencyCode)}`,
  ];
  if (cfg.alias.trim()) lines.push(`• Alias: ${cfg.alias.trim()}`);
  if (cfg.cbu.trim()) lines.push(`• CBU/CVU: ${cfg.cbu.trim()}`);
  if (cfg.holder.trim()) lines.push(`• Titular: ${cfg.holder.trim()}`);
  const safeLink = sanitizeSafeUrl(cfg.paymentLink, 400);
  if (safeLink) lines.push(`• Link de pago: ${safeLink}`);
  lines.push('Cuando realices el pago, enviános el comprobante por acá.');
  return lines.join('\n');
}
