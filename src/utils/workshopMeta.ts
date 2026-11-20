import { clampStr, stripUndefined, updateRow } from '../lib/db';
import type { WorkshopProfile } from '../types/workshop';
import {
  DEFAULT_CURRENCY,
  sanitizeCurrencyCode,
  sanitizeSecondaryCurrencies,
  type CurrencyCode,
  type SecondaryCurrencyConfig,
} from './currency';
import {
  DEFAULT_LANGUAGE,
  isValidLanguageCode,
  sanitizeLanguageCode,
  type LanguageCode,
} from './i18n';
import {
  saveMercadoPagoConfig,
  sanitizeMercadoPagoConfig,
  type MercadoPagoConfig,
} from './mercadoPago';
import type { SignedSubscriptionRecord } from './subscription';

export interface WorkshopReceiptMeta {
  subtitle: string;
  hours: string;
  social: string;
  taxId: string;
  businessEmail: string;
  footerNote: string;
  currency: CurrencyCode;
  language: LanguageCode;
  hasExplicitLanguage?: boolean;
  secondaryCurrencies: SecondaryCurrencyConfig[];
  techniciansEnabled: boolean;
  technicians: string[];
  mercadoPago?: MercadoPagoConfig;
  subscription?: SignedSubscriptionRecord;
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

function hasMercadoPagoFields(cfg?: MercadoPagoConfig | null): boolean {
  if (!cfg) return false;
  return Boolean(
    cfg.accessToken ||
      cfg.posExternalId ||
      cfg.terminalId ||
      cfg.printOnTerminal ||
      cfg.sellerNickname ||
      cfg.sellerEmail
  );
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
        l: string;
        sc: unknown;
        te: boolean;
        ts: unknown;
        mp: Partial<{
          at: string;
          pos: string;
          tid: string;
          pr: boolean;
          sn: string;
          se: string;
        }>;
        sub: SignedSubscriptionRecord;
      }>;
      const currency = sanitizeCurrencyCode(parsed.c);
      const hasExplicitLanguage = isValidLanguageCode(parsed.l);
      const language = sanitizeLanguageCode(parsed.l);
      const mp =
        parsed.mp && typeof parsed.mp === 'object'
          ? sanitizeMercadoPagoConfig({
              accessToken: parsed.mp.at,
              posExternalId: parsed.mp.pos,
              terminalId: parsed.mp.tid,
              printOnTerminal: parsed.mp.pr,
              sellerNickname: parsed.mp.sn,
              sellerEmail: parsed.mp.se,
            })
          : undefined;
      const sub =
        parsed.sub &&
        typeof parsed.sub === 'object' &&
        parsed.sub.payload &&
        typeof parsed.sub.sig === 'string'
          ? parsed.sub
          : undefined;

      return {
        subtitle: typeof parsed.s === 'string' ? parsed.s : '',
        hours: typeof parsed.h === 'string' ? parsed.h : '',
        social: typeof parsed.r === 'string' ? parsed.r : '',
        taxId: typeof parsed.t === 'string' ? parsed.t : '',
        businessEmail:
          typeof parsed.e === 'string' && parsed.e.trim() ? parsed.e.trim() : baseEmail,
        footerNote: typeof parsed.f === 'string' ? parsed.f : '',
        currency,
        language,
        hasExplicitLanguage,
        secondaryCurrencies: sanitizeSecondaryCurrencies(parsed.sc, currency),
        techniciansEnabled: Boolean(parsed.te),
        technicians: sanitizeTechnicianList(parsed.ts),
        ...(hasMercadoPagoFields(mp) ? { mercadoPago: mp } : {}),
        ...(sub ? { subscription: sub } : {}),
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
    language: DEFAULT_LANGUAGE,
    hasExplicitLanguage: false,
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
  language?: LanguageCode;
  secondaryCurrencies?: SecondaryCurrencyConfig[];
  techniciansEnabled?: boolean;
  technicians?: string[];
  mercadoPago?: MercadoPagoConfig;
  subscription?: SignedSubscriptionRecord;
}): string {
  const s = meta.subtitle.trim().slice(0, 120);
  const h = meta.hours.trim().slice(0, 120);
  const r = meta.social.trim().slice(0, 120);
  const t = meta.taxId.trim().slice(0, 80);
  const e = meta.businessEmail.trim().slice(0, 120);
  const f = meta.footerNote.trim().slice(0, 220);
  const c = sanitizeCurrencyCode(meta.currency);
  const l = sanitizeLanguageCode(meta.language);
  const sc = sanitizeSecondaryCurrencies(meta.secondaryCurrencies, c).map((item) => ({
    c: item.code,
    r: item.rate,
  }));
  const te = Boolean(meta.techniciansEnabled);
  const ts = sanitizeTechnicianList(meta.technicians);
  const cleanMp = meta.mercadoPago ? sanitizeMercadoPagoConfig(meta.mercadoPago) : undefined;
  const includeMp = hasMercadoPagoFields(cleanMp);
  const sub =
    meta.subscription && meta.subscription.payload && typeof meta.subscription.sig === 'string'
      ? meta.subscription
      : undefined;

  if (
    !h &&
    !r &&
    !t &&
    !e &&
    !f &&
    c === DEFAULT_CURRENCY &&
    l === DEFAULT_LANGUAGE &&
    sc.length === 0 &&
    !te &&
    ts.length === 0 &&
    !includeMp &&
    !sub
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
    ...(l !== DEFAULT_LANGUAGE ? { l } : {}),
    ...(sc.length > 0 ? { sc } : {}),
    ...(te ? { te: true } : {}),
    ...(ts.length > 0 ? { ts } : {}),
    ...(includeMp && cleanMp
      ? {
          mp: {
            ...(cleanMp.accessToken ? { at: cleanMp.accessToken } : {}),
            ...(cleanMp.posExternalId ? { pos: cleanMp.posExternalId } : {}),
            ...(cleanMp.terminalId ? { tid: cleanMp.terminalId } : {}),
            ...(cleanMp.printOnTerminal ? { pr: true } : {}),
            ...(cleanMp.sellerNickname ? { sn: cleanMp.sellerNickname } : {}),
            ...(cleanMp.sellerEmail ? { se: cleanMp.sellerEmail } : {}),
          },
        }
      : {}),
    ...(sub ? { sub } : {}),
  });
}

export function syncMercadoPagoConfigFromProfile(
  ownerId: string,
  profile?: Partial<WorkshopProfile> | null
): MercadoPagoConfig | null {
  if (!ownerId || !profile) return null;
  const parsed = parseWorkshopMeta(profile);
  if (!parsed.mercadoPago) return null;
  return saveMercadoPagoConfig(ownerId, parsed.mercadoPago);
}

export async function saveMercadoPagoConfigToProfile(
  profile: WorkshopProfile,
  config: MercadoPagoConfig
): Promise<MercadoPagoConfig> {
  const ownerId = profile.ownerId || profile.id;
  const savedLocal = saveMercadoPagoConfig(ownerId, config);
  const currentMeta = parseWorkshopMeta(profile);
  const encodedSubtitle = serializeWorkshopSubtitle({
    ...currentMeta,
    mercadoPago: savedLocal,
  });

  await updateRow(
    'workshop_profiles',
    profile.id,
    stripUndefined({
      subtitle: clampStr(encodedSubtitle, 8000),
      updatedAt: new Date().toISOString(),
    })
  );

  return savedLocal;
}

export async function saveSubscriptionToProfile(
  profile: WorkshopProfile,
  subscription: SignedSubscriptionRecord
): Promise<void> {
  const currentMeta = parseWorkshopMeta(profile);
  const encodedSubtitle = serializeWorkshopSubtitle({
    ...currentMeta,
    subscription,
  });

  await updateRow(
    'workshop_profiles',
    profile.id,
    stripUndefined({
      subtitle: clampStr(encodedSubtitle, 8000),
      updatedAt: new Date().toISOString(),
    })
  );
}
