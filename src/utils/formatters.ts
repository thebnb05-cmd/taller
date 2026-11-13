import type { RepairRecord } from '../types/workshop';
import { STATUS_META } from '../data/catalog';

export function formatCurrency(value: number | undefined | null): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '$0';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: num % 1 === 0 ? 0 : 2,
  }).format(num);
}

export function formatCompactCurrency(value: number | undefined | null): string {
  const num = Number(value || 0);
  if (Math.abs(num) >= 1_000_000) {
    return `$${(num / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(num) >= 10_000) {
    return `$${(num / 1_000).toFixed(1)}k`;
  }
  return formatCurrency(num);
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
  return new Intl.DateTimeFormat('es-AR', {
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
  return STATUS_META[status as keyof typeof STATUS_META]?.label ?? status;
}

export function getStatusMeta(status: string) {
  return (
    STATUS_META[status as keyof typeof STATUS_META] ?? {
      label: status,
      defaultProgress: 20,
      badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
      barClass: 'bg-slate-500',
    }
  );
}

export function computeProductPricing(params: {
  cost: number;
  marginMode: string;
  margin: number;
  vat: number;
  rounding: number;
}): { netPrice: number; finalPrice: number } {
  const cost = Math.max(0, Number(params.cost || 0));
  const margin = Number(params.margin || 0);
  const vat = Math.max(0, Number(params.vat || 0));
  const rounding = Math.max(0, Number(params.rounding || 0));

  const netRaw =
    params.marginMode === 'fixed' ? cost + margin : cost * (1 + margin / 100);
  const netPrice = Math.max(0, Math.round(netRaw * 100) / 100);
  let finalRaw = netPrice * (1 + vat / 100);

  if (rounding > 0) {
    finalRaw = Math.round(finalRaw / rounding) * rounding;
  } else {
    finalRaw = Math.round(finalRaw * 100) / 100;
  }

  return {
    netPrice,
    finalPrice: Math.max(0, finalRaw),
  };
}

export async function compressImageToDataUrl(
  file: File,
  maxDimension = 720,
  quality = 0.82
): Promise<string> {
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
          resolve(String(reader.result));
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
