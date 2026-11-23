import { supabase } from '../lib/db';

export type SubscriptionPlanId = 'mensual' | 'semestral' | 'anual';

export const PENDING_SUB_STORAGE_KEY = 'th3bnb_pending_mp_subscription';

export interface PendingCheckoutState {
  planId: SubscriptionPlanId;
  providerId: string;
  kind: 'preapproval' | 'preference';
  externalReference: string;
  checkoutUrl: string;
}

export interface SubscriptionPlanDef {
  id: SubscriptionPlanId;
  name: string;
  badge?: string;
  durationLabel: string;
  months: number;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
  monthlyEquivalent: number;
  description: string;
}

export const SUBSCRIPTION_PLANS: SubscriptionPlanDef[] = [
  {
    id: 'mensual',
    name: 'Plan Mensual',
    durationLabel: '1 mes',
    months: 1,
    originalPrice: 7000,
    discountedPrice: 3655,
    discountPercent: 48,
    monthlyEquivalent: 3655,
    description: 'Acceso completo al taller, órdenes, Kanban, inventario, ventas y boletas.',
  },
  {
    id: 'semestral',
    name: 'Plan 6 Meses',
    badge: 'Recomendado',
    durationLabel: '6 meses',
    months: 6,
    originalPrice: 42000,
    discountedPrice: 21930,
    discountPercent: 48,
    monthlyEquivalent: 3655,
    description: 'Congelás la tarifa promocional por medio año con todas las funciones.',
  },
  {
    id: 'anual',
    name: 'Plan Anual',
    badge: '1 año completo',
    durationLabel: '12 meses',
    months: 12,
    originalPrice: 84000,
    discountedPrice: 43860,
    discountPercent: 48,
    monthlyEquivalent: 3655,
    description: 'Cobertura anual sin interrupciones con ahorro garantizado todo el año.',
  },
];

export type ActivePlanKind = SubscriptionPlanId | 'trial';

export interface SubscriptionPayload {
  userId: string;
  email: string;
  planId: ActivePlanKind;
  status: 'active' | 'expired';
  startedAt: number;
  expiresAt: number;
  isExemptAnnual: boolean;
  autoRenewFree: boolean;
  provider: 'trial' | 'mercadopago' | 'exempt';
  providerSubscriptionId?: string;
  externalReference?: string;
  updatedAt: number;
}

export interface SignedSubscriptionRecord {
  payload: SubscriptionPayload;
  sig: string;
}

export interface SubscriptionRemainingInfo {
  remainingMs: number;
  isExpired: boolean;
  days: number;
  hours: number;
  minutes: number;
  progressPercent: number;
  shortLabel: string;
  detailLabel: string;
}

export function getPlanById(planId: string | undefined | null): SubscriptionPlanDef | null {
  return SUBSCRIPTION_PLANS.find((p) => p.id === planId) || null;
}

export function getPlanDisplayName(planId: ActivePlanKind, isExemptAnnual?: boolean): string {
  if (isExemptAnnual) return 'Plan Anual · Cortesía';
  if (planId === 'trial') return 'Prueba gratis';
  return getPlanById(planId)?.name || 'Suscripción';
}

export function formatArs(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value);
}

export function getSubscriptionRemaining(
  sub: SubscriptionPayload | null | undefined,
  nowMs = Date.now()
): SubscriptionRemainingInfo {
  if (!sub) {
    return {
      remainingMs: 0,
      isExpired: false,
      days: 0,
      hours: 0,
      minutes: 0,
      progressPercent: 100,
      shortLabel: 'Verificando...',
      detailLabel: 'Consultando estado de suscripción...',
    };
  }

  const totalSpan = Math.max(1, sub.expiresAt - sub.startedAt);
  const rawRemaining = sub.expiresAt - nowMs;

  if (rawRemaining <= 0) {
    return {
      remainingMs: 0,
      isExpired: true,
      days: 0,
      hours: 0,
      minutes: 0,
      progressPercent: 0,
      shortLabel: 'Vencida',
      detailLabel: 'Tu período actual finalizó. Elegí un plan para continuar.',
    };
  }

  const totalMinutes = Math.floor(rawRemaining / 60000);
  const days = Math.floor(rawRemaining / (24 * 60 * 60 * 1000));
  const hours = Math.floor((rawRemaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.max(1, totalMinutes % 60);
  const progressPercent = Math.max(
    2,
    Math.min(100, Math.round((rawRemaining / totalSpan) * 100))
  );

  const shortLabel =
    days >= 1
      ? `Faltan ${days} ${days === 1 ? 'día' : 'días'}`
      : hours >= 1
        ? `Faltan ${hours} ${hours === 1 ? 'hora' : 'horas'}`
        : `Faltan ${minutes} min`;

  const detailLabel =
    days >= 1
      ? `Faltan ${days} ${days === 1 ? 'día' : 'días'} y ${hours} ${hours === 1 ? 'hora' : 'horas'}`
      : hours >= 1
        ? `Faltan ${hours} ${hours === 1 ? 'hora' : 'horas'} y ${minutes} min`
        : `Faltan ${minutes} minutos`;

  return {
    remainingMs: rawRemaining,
    isExpired: false,
    days,
    hours,
    minutes,
    progressPercent,
    shortLabel,
    detailLabel,
  };
}

async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    let session = (await supabase.auth.getSession()).data?.session ?? null;
    const nowSec = Math.floor(Date.now() / 1000);
    const isNearExpiry = Boolean(session?.expires_at && session.expires_at - nowSec < 60);
    if (forceRefresh || !session?.access_token || isNearExpiry) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.data?.session?.access_token) {
        session = refreshed.data.session;
      }
    }
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch {
    // Ignore session read error
  }
  return headers;
}

async function fetchAuthedSubscriptionPost(
  url: string,
  body: Record<string, unknown>
): Promise<Response> {
  const headers = await getAuthHeaders(false);
  let res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    const freshHeaders = await getAuthHeaders(true);
    if (freshHeaders.Authorization && freshHeaders.Authorization !== headers.Authorization) {
      res = await fetch(url, {
        method: 'POST',
        headers: freshHeaders,
        body: JSON.stringify(body),
      });
    }
  }
  return res;
}

export async function fetchSubscriptionStatus(
  existingToken?: SignedSubscriptionRecord | null
): Promise<{
  ok: boolean;
  subscription?: SignedSubscriptionRecord;
  mpConfigured?: boolean;
  error?: string;
}> {
  const res = await fetchAuthedSubscriptionPost('/api/subscriptions/status', {
    subscriptionToken: existingToken || null,
  });
  return (await res.json().catch(() => ({ ok: false, error: 'Error de red' }))) as {
    ok: boolean;
    subscription?: SignedSubscriptionRecord;
    mpConfigured?: boolean;
    error?: string;
  };
}

export async function createSubscriptionCheckout(params: {
  planId: SubscriptionPlanId;
  backUrl: string;
}): Promise<{
  ok: boolean;
  checkoutUrl?: string;
  providerId?: string;
  kind?: 'preapproval' | 'preference';
  externalReference?: string;
  planId?: SubscriptionPlanId;
  error?: string;
}> {
  const res = await fetchAuthedSubscriptionPost('/api/subscriptions/checkout', params);
  return (await res.json().catch(() => ({ ok: false, error: 'Error de red' }))) as {
    ok: boolean;
    checkoutUrl?: string;
    providerId?: string;
    kind?: 'preapproval' | 'preference';
    externalReference?: string;
    planId?: SubscriptionPlanId;
    error?: string;
  };
}

export async function verifySubscriptionPayment(params: {
  planId?: SubscriptionPlanId;
  providerId?: string;
  kind?: 'preapproval' | 'preference';
  externalReference?: string;
  subscriptionToken?: SignedSubscriptionRecord | null;
}): Promise<{
  ok: boolean;
  paid?: boolean;
  mpStatus?: string;
  subscription?: SignedSubscriptionRecord;
  error?: string;
}> {
  const res = await fetchAuthedSubscriptionPost('/api/subscriptions/verify', params);
  return (await res.json().catch(() => ({ ok: false, error: 'Error de red' }))) as {
    ok: boolean;
    paid?: boolean;
    mpStatus?: string;
    subscription?: SignedSubscriptionRecord;
    error?: string;
  };
}
