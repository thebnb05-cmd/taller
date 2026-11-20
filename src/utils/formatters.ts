import type { RepairRecord } from '../types/workshop';
import { STATUS_META } from '../data/catalog';
import { getActiveCurrency, getCurrencyOption, type CurrencyCode } from './currency';
import { getIntlLocale, getTranslatedStatusLabel } from './i18n';

export function formatCurrency(
  value: number | undefined | null,
  currencyCode?: CurrencyCode | string | null
): string {
  const opt = getCurrencyOption(currencyCode ?? getActiveCurrency());
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return `${opt.symbol} 0`;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  const hasDecimals = Math.round(abs * 100) % 100 !== 0;
  const formattedNumber = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(abs);
  return `${sign}${opt.symbol} ${formattedNumber}`;
}

export function formatCompactCurrency(
  value: number | undefined | null,
  currencyCode?: CurrencyCode | string | null
): string {
  const code = currencyCode ?? getActiveCurrency();
  const opt = getCurrencyOption(code);
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return `${opt.symbol} 0`;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1_000_000) {
    return `${sign}${opt.symbol}${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 10_000) {
    return `${sign}${opt.symbol}${(abs / 1_000).toFixed(1)}k`;
  }
  return formatCurrency(num, code);
}

export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateShort(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  const parsed = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

export function generateRepairCode(existingRepairs: RepairRecord[]): string {
  let maxNum = 10000;
  for (const r of existingRepairs) {
    const match = /^R-(\d+)$/i.exec(r.code || '');
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  return `R-${maxNum + 1}`;
}

export function generateTrackingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'TK-';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function generateInternalProductCode(): string {
  return `PRD-${Math.floor(100000 + Math.random() * 900000)}`;
}

export function getStatusLabel(status: string): string {
  return getTranslatedStatusLabel(status);
}

export function getStatusMeta(status: string) {
  const base =
    STATUS_META[status as keyof typeof STATUS_META] ?? {
      label: status,
      defaultProgress: 20,
      badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
      barClass: 'bg-slate-500',
    };
  return {
    ...base,
    label: getTranslatedStatusLabel(status),
  };
}

export function computeProductPricing(params: {
  cost: number;
  marginMode: string;
  margin: number;
  vat: number;
  rounding: number;
}): { netPrice: number; finalPrice: number } {
  const safeCost = Number.isFinite(Number(params.cost)) ? Math.max(0, Number(params.cost)) : 0;
  const safeMargin = Number.isFinite(Number(params.margin)) ? Number(params.margin) : 0;
  const safeVat = Number.isFinite(Number(params.vat)) ? Math.max(0, Number(params.vat)) : 0;
  const safeRounding = Number.isFinite(Number(params.rounding)) ? Math.max(0, Number(params.rounding)) : 0;

  const netRaw =
    params.marginMode === 'fixed' ? safeCost + safeMargin : safeCost * (1 + safeMargin / 100);
  const netPrice = Number.isFinite(netRaw) ? Math.max(0, Math.round(netRaw * 100) / 100) : 0;
  let finalRaw = netPrice * (1 + safeVat / 100);

  if (safeRounding > 0) {
    finalRaw = Math.round(finalRaw / safeRounding) * safeRounding;
  } else {
    finalRaw = Math.round(finalRaw * 100) / 100;
  }

  return {
    netPrice,
    finalPrice: Number.isFinite(finalRaw) ? Math.max(0, finalRaw) : 0,
  };
}

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function compressImageToDataUrl(
  file: File,
  maxDimension = 720,
  quality = 0.82
): Promise<string> {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    throw new Error('Usá una imagen PNG, JPG o WebP.');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato de imagen no compatible.'));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No se pudo procesar la imagen.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/webp';
        resolve(canvas.toDataURL(mime, quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function isActiveRepairStatus(status: string): boolean {
  return status !== 'listo' && status !== 'entregado';
}
