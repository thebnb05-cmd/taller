import type { ClientRecord } from '../types/workshop';
import {
  sanitizeDni,
  sanitizePhone,
  sanitizePlainLine,
  sanitizeText,
} from './validation';

export type ClientType = 'particular' | 'empresa' | 'gremio';

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  particular: 'Particular',
  empresa: 'Empresa / Comercio',
  gremio: 'Gremio / Técnico',
};

export interface ClientMeta {
  altPhone: string;
  clientType: ClientType;
  cuit: string;
  neighborhood: string;
  notes: string;
}

function normalizeClientType(raw: unknown): ClientType {
  if (raw === 'empresa' || raw === 'gremio' || raw === 'particular') {
    return raw;
  }
  return 'particular';
}

export function parseClientMeta(client?: Partial<ClientRecord> | null): ClientMeta {
  const raw = (client?.notes || '').trim();

  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Partial<{
        ap: string;
        ct: string;
        cu: string;
        nb: string;
        n: string;
      }>;
      return {
        altPhone: sanitizePhone(parsed.ap || '', 60),
        clientType: normalizeClientType(parsed.ct),
        cuit: sanitizeDni(parsed.cu || '', 40),
        neighborhood: sanitizePlainLine(parsed.nb || '', 120),
        notes: sanitizeText(parsed.n || '', 1000),
      };
    } catch {
      // Fallback to treating raw as plain notes text
    }
  }

  return {
    altPhone: '',
    clientType: 'particular',
    cuit: '',
    neighborhood: '',
    notes: raw,
  };
}

export function serializeClientNotes(meta: Partial<ClientMeta>): string {
  const ap = sanitizePhone(meta.altPhone || '', 60);
  const ct = normalizeClientType(meta.clientType);
  const cu = sanitizeDni(meta.cuit || '', 40);
  const nb = sanitizePlainLine(meta.neighborhood || '', 120);
  const n = sanitizeText(meta.notes || '', 1000);

  if (!ap && ct === 'particular' && !cu && !nb) {
    return n;
  }

  return JSON.stringify({
    ...(ap ? { ap } : {}),
    ...(ct !== 'particular' ? { ct } : {}),
    ...(cu ? { cu } : {}),
    ...(nb ? { nb } : {}),
    ...(n ? { n } : {}),
  });
}
