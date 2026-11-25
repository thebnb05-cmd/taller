import type { RepairRecord, PublicTicketRecord } from '../types/workshop';
import type { PaymentMethod } from './payment';
import { STATUS_META } from '../data/catalog';
import { sanitizePlainLine, sanitizeText } from './validation';

const RMEDIA_RE = /\n?<!--TH3BNB_MEDIA:[\s\S]*?-->/g;
const RMETA_START = '<!--TH3BNB_RMETA:';
const RMETA_RE = /\n?<!--TH3BNB_RMETA:([\s\S]*?)-->/;
const RPAY_START = '<!--TH3BNB_RPAY:';
const RPAY_RE = /\n?<!--TH3BNB_RPAY:([\s\S]*?)-->/;
const RSIG_RE = /\n?<!--TH3BNB_SIG:[\s\S]*?-->/;
const MARKER_END = '-->';

export type RepairQuoteStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface RepairTimelineEntry {
  id: string;
  status: string;
  label: string;
  at: string;
  note?: string;
}

export interface RepairQuoteMeta {
  status: RepairQuoteStatus;
  amount?: number;
  requestedAt?: string;
  respondedAt?: string;
  clientNote?: string;
}

export interface RepairPublicMeta {
  timeline: RepairTimelineEntry[];
  quote: RepairQuoteMeta;
  warrantyDays?: number;
  deliveredAt?: string;
  parentRepairId?: string;
  parentRepairCode?: string;
}

export interface RepairPaymentEntry {
  id: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  note?: string;
  mpChannel?: 'mp_point' | 'mp_qr';
  mpOrderId?: string;
  mpExternalReference?: string;
}

export function createRepairMetaId(prefix = 'rm'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function getStatusLabelForTimeline(status: string): string {
  const meta = (STATUS_META as Record<string, { label: string } | undefined>)[status];
  return meta?.label || sanitizePlainLine(status, 40) || 'Actualización';
}

export function parseRepairPublicMeta(workDetail?: string | null): RepairPublicMeta {
  const empty: RepairPublicMeta = {
    timeline: [],
    quote: { status: 'none' },
  };
  if (!workDetail || typeof workDetail !== 'string') return empty;
  const match = RMETA_RE.exec(workDetail);
  if (!match?.[1]) return empty;
  try {
    const parsed = JSON.parse(match[1]) as Partial<RepairPublicMeta>;
    const timeline: RepairTimelineEntry[] = Array.isArray(parsed.timeline)
      ? parsed.timeline
          .slice(-40)
          .filter((e) => e && typeof e.at === 'string')
          .map((e, idx) => ({
            id: sanitizePlainLine(String(e.id || `tl-${idx}`), 64) || `tl-${idx}`,
            status: sanitizePlainLine(String(e.status || ''), 40),
            label: sanitizePlainLine(String(e.label || getStatusLabelForTimeline(String(e.status || ''))), 80),
            at: sanitizePlainLine(String(e.at), 40),
            ...(e.note ? { note: sanitizePlainLine(String(e.note), 200) } : {}),
          }))
      : [];

    const rawQuote = parsed.quote;
    const quoteStatus: RepairQuoteStatus =
      rawQuote?.status === 'pending' ||
      rawQuote?.status === 'approved' ||
      rawQuote?.status === 'rejected'
        ? rawQuote.status
        : 'none';
    const quote: RepairQuoteMeta = {
      status: quoteStatus,
      ...(rawQuote?.amount !== undefined && Number.isFinite(Number(rawQuote.amount))
        ? { amount: Math.max(0, Math.round(Number(rawQuote.amount) * 100) / 100) }
        : {}),
      ...(rawQuote?.requestedAt ? { requestedAt: sanitizePlainLine(String(rawQuote.requestedAt), 40) } : {}),
      ...(rawQuote?.respondedAt ? { respondedAt: sanitizePlainLine(String(rawQuote.respondedAt), 40) } : {}),
      ...(rawQuote?.clientNote ? { clientNote: sanitizeText(String(rawQuote.clientNote), 300) } : {}),
    };

    const warrantyDays =
      parsed.warrantyDays !== undefined && Number.isFinite(Number(parsed.warrantyDays))
        ? Math.max(0, Math.min(3650, Math.round(Number(parsed.warrantyDays))))
        : undefined;

    return {
      timeline,
      quote,
      ...(warrantyDays !== undefined ? { warrantyDays } : {}),
      ...(parsed.deliveredAt ? { deliveredAt: sanitizePlainLine(String(parsed.deliveredAt), 40) } : {}),
      ...(parsed.parentRepairId
        ? { parentRepairId: sanitizePlainLine(String(parsed.parentRepairId), 120) }
        : {}),
      ...(parsed.parentRepairCode
        ? { parentRepairCode: sanitizePlainLine(String(parsed.parentRepairCode), 40) }
        : {}),
    };
  } catch {
    return empty;
  }
}

export function mergeWorkDetailPublicMeta(
  currentWorkDetail: string | null | undefined,
  updater: (prev: RepairPublicMeta) => RepairPublicMeta
): string {
  const prev = parseRepairPublicMeta(currentWorkDetail);
  const next = updater(prev);
  const baseWithoutRmeta = String(currentWorkDetail || '').replace(RMETA_RE, '').trim();

  const cleanMeta: RepairPublicMeta = {
    timeline: (next.timeline || []).slice(-40).map((t) => ({
      id: sanitizePlainLine(t.id, 64) || createRepairMetaId('tl'),
      status: sanitizePlainLine(t.status, 40),
      label: sanitizePlainLine(t.label, 80).replace(/-->/g, ''),
      at: sanitizePlainLine(t.at, 40) || new Date().toISOString(),
      ...(t.note ? { note: sanitizePlainLine(t.note, 200).replace(/-->/g, '') } : {}),
    })),
    quote: {
      status: next.quote?.status || 'none',
      ...(next.quote?.amount !== undefined
        ? { amount: Math.max(0, Math.round(Number(next.quote.amount) * 100) / 100) }
        : {}),
      ...(next.quote?.requestedAt ? { requestedAt: sanitizePlainLine(next.quote.requestedAt, 40) } : {}),
      ...(next.quote?.respondedAt ? { respondedAt: sanitizePlainLine(next.quote.respondedAt, 40) } : {}),
      ...(next.quote?.clientNote
        ? { clientNote: sanitizeText(next.quote.clientNote, 300).replace(/-->/g, '') }
        : {}),
    },
    ...(next.warrantyDays !== undefined && next.warrantyDays > 0
      ? { warrantyDays: Math.min(3650, Math.round(next.warrantyDays)) }
      : {}),
    ...(next.deliveredAt ? { deliveredAt: sanitizePlainLine(next.deliveredAt, 40) } : {}),
    ...(next.parentRepairId ? { parentRepairId: sanitizePlainLine(next.parentRepairId, 120) } : {}),
    ...(next.parentRepairCode ? { parentRepairCode: sanitizePlainLine(next.parentRepairCode, 40) } : {}),
  };

  const hasContent =
    cleanMeta.timeline.length > 0 ||
    cleanMeta.quote.status !== 'none' ||
    (cleanMeta.warrantyDays !== undefined && cleanMeta.warrantyDays > 0) ||
    Boolean(cleanMeta.deliveredAt) ||
    Boolean(cleanMeta.parentRepairId) ||
    Boolean(cleanMeta.parentRepairCode);

  if (!hasContent) return baseWithoutRmeta;

  const marker = `${RMETA_START}${JSON.stringify(cleanMeta)}${MARKER_END}`;
  return baseWithoutRmeta ? `${baseWithoutRmeta}\n${marker}` : marker;
}

export function stripAllWorkDetailMarkers(raw?: string | null): string {
  if (!raw) return '';
  return sanitizeText(
    raw.replace(RMETA_RE, '').replace(RMEDIA_RE, '').trim(),
    2000
  );
}

export function appendTimelineEntry(
  meta: RepairPublicMeta,
  status: string,
  note?: string,
  atIso = new Date().toISOString()
): RepairPublicMeta {
  const last = meta.timeline[meta.timeline.length - 1];
  if (last && last.status === status && !note) {
    // Avoid spamming duplicate consecutive entries for the exact same status unless a note is given
    const diffMs = Math.abs(new Date(atIso).getTime() - new Date(last.at).getTime());
    if (Number.isFinite(diffMs) && diffMs < 60_000) {
      return meta;
    }
  }
  const entry: RepairTimelineEntry = {
    id: createRepairMetaId('tl'),
    status,
    label: getStatusLabelForTimeline(status),
    at: atIso,
    ...(note ? { note: sanitizePlainLine(note, 200) } : {}),
  };
  return {
    ...meta,
    timeline: [...meta.timeline, entry].slice(-40),
  };
}

export function computeWarrantyInfo(
  repairOrTicket: Pick<RepairRecord | PublicTicketRecord, 'status' | 'workDetail' | 'updatedAt'>
): {
  warrantyDays: number;
  deliveredAt: string | null;
  expiresAt: Date | null;
  isActive: boolean;
  daysLeft: number;
} {
  const meta = parseRepairPublicMeta(repairOrTicket.workDetail);
  const days = meta.warrantyDays ?? 0;
  if (days <= 0) {
    return { warrantyDays: 0, deliveredAt: meta.deliveredAt || null, expiresAt: null, isActive: false, daysLeft: 0 };
  }
  let baseMs: number | null = null;
  if (meta.deliveredAt) {
    const t = Date.parse(meta.deliveredAt);
    if (!Number.isNaN(t)) baseMs = t;
  } else if (repairOrTicket.status === 'entregado' && repairOrTicket.updatedAt) {
    baseMs = repairOrTicket.updatedAt;
  }
  if (!baseMs) {
    return { warrantyDays: days, deliveredAt: null, expiresAt: null, isActive: false, daysLeft: days };
  }
  const expiresMs = baseMs + days * 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((expiresMs - Date.now()) / (24 * 60 * 60 * 1000));
  return {
    warrantyDays: days,
    deliveredAt: new Date(baseMs).toISOString(),
    expiresAt: new Date(expiresMs),
    isActive: daysLeft > 0,
    daysLeft,
  };
}

export function parseRepairPaymentLedger(checkoutState?: string | null): RepairPaymentEntry[] {
  if (!checkoutState || typeof checkoutState !== 'string') return [];
  const match = RPAY_RE.exec(checkoutState);
  if (!match?.[1]) return [];
  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(-40)
      .filter((p) => p && Number(p.amount || 0) > 0)
      .map((p, idx) => ({
        id: sanitizePlainLine(String(p.id || `rpay-${idx}`), 64) || `rpay-${idx}`,
        amount: Math.max(0, Math.round(Number(p.amount) * 100) / 100),
        method:
          p.method === 'transferencia' || p.method === 'tarjeta' || p.method === 'efectivo'
            ? p.method
            : 'efectivo',
        date: sanitizePlainLine(String(p.date || ''), 40) || new Date().toISOString(),
        ...(p.note ? { note: sanitizePlainLine(String(p.note), 120) } : {}),
        ...(p.mpChannel === 'mp_point' || p.mpChannel === 'mp_qr' ? { mpChannel: p.mpChannel } : {}),
        ...(p.mpOrderId ? { mpOrderId: sanitizePlainLine(String(p.mpOrderId), 80) } : {}),
        ...(p.mpExternalReference
          ? { mpExternalReference: sanitizePlainLine(String(p.mpExternalReference), 80) }
          : {}),
      }));
  } catch {
    return [];
  }
}

export function mergeCheckoutPaymentLedger(
  currentCheckoutState: string | null | undefined,
  entries: RepairPaymentEntry[]
): string {
  const baseWithoutRpay = String(currentCheckoutState || '').replace(RPAY_RE, '').trim();
  const cleanEntries = entries
    .filter((e) => Number(e.amount || 0) > 0)
    .slice(-40)
    .map((e) => ({
      id: sanitizePlainLine(e.id, 64) || createRepairMetaId('pay'),
      amount: Math.max(0, Math.round(Number(e.amount) * 100) / 100),
      method: e.method,
      date: sanitizePlainLine(e.date, 40) || new Date().toISOString(),
      ...(e.note ? { note: sanitizePlainLine(e.note, 120).replace(/-->/g, '') } : {}),
      ...(e.mpChannel === 'mp_point' || e.mpChannel === 'mp_qr' ? { mpChannel: e.mpChannel } : {}),
      ...(e.mpOrderId ? { mpOrderId: sanitizePlainLine(e.mpOrderId, 80).replace(/-->/g, '') } : {}),
      ...(e.mpExternalReference
        ? { mpExternalReference: sanitizePlainLine(e.mpExternalReference, 80).replace(/-->/g, '') }
        : {}),
    }));

  if (cleanEntries.length === 0) return baseWithoutRpay;

  const marker = `${RPAY_START}${JSON.stringify(cleanEntries)}${MARKER_END}`;
  // Preserve signature marker ordering cleanly
  const sigMatch = RSIG_RE.exec(baseWithoutRpay);
  if (sigMatch) {
    const textPart = baseWithoutRpay.replace(RSIG_RE, '').trim();
    const sigPart = sigMatch[0].trim();
    return [textPart, sigPart, marker].filter(Boolean).join('\n');
  }
  return baseWithoutRpay ? `${baseWithoutRpay}\n${marker}` : marker;
}
