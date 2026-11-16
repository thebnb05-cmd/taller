import type { WorkshopProfile } from '../types/workshop';
import {
  DEFAULT_CURRENCY,
  sanitizeCurrencyCode,
  sanitizeSecondaryCurrencies,
  type CurrencyCode,
  type SecondaryCurrencyConfig,
} from './currency';

export interface WorkshopReceiptMeta {
  subtitle: string;
  hours: string;
  social: string;
  taxId: string;
  businessEmail: string;
  footerNote: string;
  currency: CurrencyCode;
  secondaryCurrencies: SecondaryCurrencyConfig[];
  techniciansEnabled: boolean;
  technicians: string[];
}

const DEFAULT_SUBTITLE = 'Servicio técnico';

export function sanitizeTechnicianList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const clean = entry
      .replace(/[:\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 25) break;
  }
  return out;
}

export function parseWorkshopMeta(
  profile?: Partial<WorkshopProfile> | null
): WorkshopReceiptMeta {
  const raw = (profile?.subtitle || '').trim();
  const baseEmail = (profile?.email || '').trim();

  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Partial<{
        s: string;
        h: string;
        r: string;
        t: string;
        e: string;
        f: string;
        c: string;
        sc: unknown;
        te: boolean;
        ts: unknown;
      }>;
      const currency = sanitizeCurrencyCode(parsed.c);
      return {
        subtitle: typeof parsed.s === 'string' ? parsed.s : '',
        hours: typeof parsed.h === 'string' ? parsed.h : '',
        social: typeof parsed.r === 'string' ? parsed.r : '',
        taxId: typeof parsed.t === 'string' ? parsed.t : '',
        businessEmail:
          typeof parsed.e === 'string' && parsed.e.trim() ? parsed.e.trim() : baseEmail,
        footerNote: typeof parsed.f === 'string' ? parsed.f : '',
        currency,
        secondaryCurrencies: sanitizeSecondaryCurrencies(parsed.sc, currency),
        techniciansEnabled: Boolean(parsed.te),
        technicians: sanitizeTechnicianList(parsed.ts),
      };
    } catch {
      // Fallback to treating raw as plain subtitle
    }
  }

  return {
    subtitle: raw || DEFAULT_SUBTITLE,
    hours: '',
    social: '',
    taxId: '',
    businessEmail: baseEmail,
    footerNote: '',
    currency: DEFAULT_CURRENCY,
    secondaryCurrencies: [],
    techniciansEnabled: false,
    technicians: [],
  };
}

export function serializeWorkshopSubtitle(meta: {
  subtitle: string;
  hours: string;
  social: string;
  taxId: string;
  businessEmail: string;
  footerNote: string;
  currency?: CurrencyCode;
  secondaryCurrencies?: SecondaryCurrencyConfig[];
  techniciansEnabled?: boolean;
  technicians?: string[];
}): string {
  const s = meta.subtitle.trim().slice(0, 120);
  const h = meta.hours.trim().slice(0, 120);
  const r = meta.social.trim().slice(0, 120);
  const t = meta.taxId.trim().slice(0, 80);
  const e = meta.businessEmail.trim().slice(0, 120);
  const f = meta.footerNote.trim().slice(0, 220);
  const c = sanitizeCurrencyCode(meta.currency);
  const sc = sanitizeSecondaryCurrencies(meta.secondaryCurrencies, c).map((item) => ({
    c: item.code,
    r: item.rate,
  }));
  const te = Boolean(meta.techniciansEnabled);
  const ts = sanitizeTechnicianList(meta.technicians);

  if (
    !h &&
    !r &&
    !t &&
    !e &&
    !f &&
    c === DEFAULT_CURRENCY &&
    sc.length === 0 &&
    !te &&
    ts.length === 0
  ) {
    return s || DEFAULT_SUBTITLE;
  }

  return JSON.stringify({
    ...(s ? { s } : {}),
    ...(h ? { h } : {}),
    ...(r ? { r } : {}),
    ...(t ? { t } : {}),
    ...(e ? { e } : {}),
    ...(f ? { f } : {}),
    ...(c !== DEFAULT_CURRENCY ? { c } : {}),
    ...(sc.length > 0 ? { sc } : {}),
    ...(te ? { te: true } : {}),
    ...(ts.length > 0 ? { ts } : {}),
  });
}
