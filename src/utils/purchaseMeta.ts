import type { PurchaseRecord } from '../types/workshop';
import { isValidCurrencyCode, type CurrencyCode } from './currency';
import { sanitizePlainLine, sanitizeText } from './validation';

const PUR_META_MARKER = '<!--TH3BNB_PUR:';
const PUR_META_END = '-->';

export type PurchaseCategory = 'repuestos' | 'gasto_fijo' | 'herramientas' | 'otro';

export const PURCHASE_CATEGORY_LABELS: Record<PurchaseCategory, string> = {
  repuestos: 'Repuestos / Stock',
  gasto_fijo: 'Gasto fijo / Servicios',
  herramientas: 'Herramientas / Taller',
  otro: 'Otro gasto',
};

export interface PurchaseStockLine {
  productId: string;
  name: string;
  qty: number;
  unitCost: number;
}

export interface PurchaseExtraMeta {
  category?: PurchaseCategory;
  note?: string;
  stockItems?: PurchaseStockLine[];
}

export interface ParsedPurchaseInfo {
  isPaid: boolean;
  baseStatus: 'pendiente' | 'pagado';
  currency: CurrencyCode | null;
  rate: number | null;
  category: PurchaseCategory;
  note: string;
  stockItems: PurchaseStockLine[];
}

function splitPurchaseStatusAndMeta(rawStatus?: string | null): {
  head: string;
  metaJson: string | null;
} {
  const full = String(rawStatus || '');
  const idx = full.indexOf(PUR_META_MARKER);
  if (idx === -1) return { head: full, metaJson: null };
  const head = full.slice(0, idx).trim();
  const after = full.slice(idx + PUR_META_MARKER.length);
  const endIdx = after.lastIndexOf(PUR_META_END);
  const metaJson = (endIdx !== -1 ? after.slice(0, endIdx) : after).trim();
  return { head, metaJson };
}

function sanitizeCategory(raw: unknown): PurchaseCategory {
  if (
    raw === 'repuestos' ||
    raw === 'gasto_fijo' ||
    raw === 'herramientas' ||
    raw === 'otro'
  ) {
    return raw;
  }
  return 'repuestos';
}

export function parsePurchaseInfo(purchase: Pick<PurchaseRecord, 'status'>): ParsedPurchaseInfo {
  const { head, metaJson } = splitPurchaseStatusAndMeta(purchase.status);
  const raw = head.toLowerCase().trim();
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

  let category: PurchaseCategory = 'repuestos';
  let note = '';
  let stockItems: PurchaseStockLine[] = [];

  if (metaJson) {
    try {
      const parsed = JSON.parse(metaJson) as PurchaseExtraMeta;
      category = sanitizeCategory(parsed.category);
      note = parsed.note ? sanitizeText(String(parsed.note), 400) : '';
      if (Array.isArray(parsed.stockItems)) {
        stockItems = parsed.stockItems
          .slice(0, 40)
          .filter((s) => s && s.productId && Number(s.qty || 0) > 0)
          .map((s) => ({
            productId: sanitizePlainLine(String(s.productId), 120),
            name: sanitizePlainLine(String(s.name || 'Producto'), 140),
            qty: Math.max(1, Math.round(Number(s.qty || 1))),
            unitCost: Math.max(0, Math.round(Number(s.unitCost || 0) * 100) / 100),
          }));
      }
    } catch {
      // Fallback safely on corrupted meta
    }
  }

  return {
    isPaid,
    baseStatus: isPaid ? 'pagado' : 'pendiente',
    currency,
    rate,
    category,
    note,
    stockItems,
  };
}

export function serializePurchaseStatus(params: {
  status: 'pendiente' | 'pagado';
  currency?: CurrencyCode | null;
  rate?: number | null;
  category?: PurchaseCategory;
  note?: string;
  stockItems?: PurchaseStockLine[];
}): string {
  const extras: string[] = [];
  if (params.currency && isValidCurrencyCode(params.currency)) {
    extras.push(`cur=${params.currency.toUpperCase()}`);
  }
  if (params.rate && Number.isFinite(params.rate) && params.rate > 0 && params.rate !== 1) {
    extras.push(`rate=${Math.round(params.rate * 1_000_000) / 1_000_000}`);
  }
  const head = extras.length > 0 ? `${params.status}:${extras.join(':')}` : params.status;

  const cleanCategory = sanitizeCategory(params.category);
  const cleanNote = params.note ? sanitizeText(params.note, 400).replace(/-->/g, '').trim() : '';
  const cleanStockItems = (params.stockItems || [])
    .filter((s) => s.productId && s.qty > 0)
    .slice(0, 40)
    .map((s) => ({
      productId: sanitizePlainLine(s.productId, 120),
      name: sanitizePlainLine(s.name, 140).replace(/-->/g, ''),
      qty: Math.max(1, Math.round(s.qty)),
      unitCost: Math.max(0, Math.round(Number(s.unitCost || 0) * 100) / 100),
    }));

  if (cleanCategory === 'repuestos' && !cleanNote && cleanStockItems.length === 0) {
    return head;
  }

  const meta: PurchaseExtraMeta = {
    category: cleanCategory,
    ...(cleanNote ? { note: cleanNote } : {}),
    ...(cleanStockItems.length > 0 ? { stockItems: cleanStockItems } : {}),
  };

  return `${head}\n${PUR_META_MARKER}${JSON.stringify(meta)}${PUR_META_END}`;
}
