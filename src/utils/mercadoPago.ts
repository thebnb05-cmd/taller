import { supabase } from '../lib/db';
import { decryptJsonValue, encryptJsonValue, isEncryptedValue } from './crypto';
import { isSafeId, sanitizePlainLine } from './validation';

export interface MercadoPagoConfig {
  accessToken: string;
  posExternalId: string;
  terminalId: string;
  printOnTerminal: boolean;
  sellerNickname: string;
  sellerEmail: string;
}

export interface MpTerminalSummary {
  id: string;
  posId: string;
  storeId: string;
  operatingMode: string;
  externalPosId: string;
}

export interface MpPosSummary {
  id: string;
  externalId: string;
  name: string;
  storeId: string;
}

export interface MpTestConnectionResult {
  ok: boolean;
  error?: string;
  account?: {
    sellerId: string;
    nickname: string;
    email: string;
    siteId: string;
  };
  terminals?: MpTerminalSummary[];
  posList?: MpPosSummary[];
}

export interface MpOrderResponse {
  ok: boolean;
  error?: string;
  mode?: 'qr' | 'point';
  apiFamily?: 'orders_v1' | 'legacy_qr' | 'legacy_intent';
  orderId?: string;
  externalReference?: string;
  qrData?: string;
  status?: string;
  statusDetail?: string;
  isPaid?: boolean;
  isCanceled?: boolean;
  isFailed?: boolean;
}

export interface MpOrderStatusResponse {
  ok: boolean;
  error?: string;
  id?: string;
  status?: string;
  statusDetail?: string;
  isPaid?: boolean;
  isCanceled?: boolean;
  isFailed?: boolean;
}

export interface MpPlatformTokenVerificationResult {
  ok: boolean;
  configured: boolean;
  valid: boolean;
  forbidden?: boolean;
  mode?: 'production' | 'test';
  subscriptionsReady?: boolean;
  error?: string;
  account?: {
    sellerId: string;
    nickname: string;
    email: string;
    siteId: string;
  };
}

const EMPTY_MP_CONFIG: MercadoPagoConfig = {
  accessToken: '',
  posExternalId: '',
  terminalId: '',
  printOnTerminal: false,
  sellerNickname: '',
  sellerEmail: '',
};

const mpConfigCache = new Map<string, MercadoPagoConfig>();

function getStorageKey(ownerId: string): string {
  return `th3bnb_mp_cfg_${ownerId}`;
}

export function sanitizeMercadoPagoConfig(
  cfg: Partial<MercadoPagoConfig> | null | undefined
): MercadoPagoConfig {
  if (!cfg || typeof cfg !== 'object') return { ...EMPTY_MP_CONFIG };
  return {
    accessToken: String(cfg.accessToken || '').trim().slice(0, 260),
    posExternalId: sanitizePlainLine(cfg.posExternalId || '', 80),
    terminalId: sanitizePlainLine(cfg.terminalId || '', 120),
    printOnTerminal: Boolean(cfg.printOnTerminal),
    sellerNickname: sanitizePlainLine(cfg.sellerNickname || '', 80),
    sellerEmail: sanitizePlainLine(cfg.sellerEmail || '', 120),
  };
}

export function loadMercadoPagoConfig(ownerId: string): MercadoPagoConfig {
  if (!ownerId || !isSafeId(ownerId) || typeof window === 'undefined') {
    return { ...EMPTY_MP_CONFIG };
  }
  const cached = mpConfigCache.get(ownerId);
  if (cached) return { ...cached };

  try {
    const raw = window.localStorage.getItem(getStorageKey(ownerId));
    if (!raw || isEncryptedValue(raw)) {
      return { ...EMPTY_MP_CONFIG };
    }
    const parsed = JSON.parse(raw) as Partial<MercadoPagoConfig>;
    const clean = sanitizeMercadoPagoConfig(parsed);
    mpConfigCache.set(ownerId, clean);
    return { ...clean };
  } catch {
    return { ...EMPTY_MP_CONFIG };
  }
}

export async function hydrateMercadoPagoConfig(ownerId: string): Promise<MercadoPagoConfig> {
  if (!ownerId || !isSafeId(ownerId) || typeof window === 'undefined') {
    return { ...EMPTY_MP_CONFIG };
  }
  try {
    const raw = window.localStorage.getItem(getStorageKey(ownerId));
    if (!raw) {
      const empty = { ...EMPTY_MP_CONFIG };
      mpConfigCache.set(ownerId, empty);
      return empty;
    }

    if (isEncryptedValue(raw)) {
      const parsed = await decryptJsonValue<Partial<MercadoPagoConfig>>(
        raw,
        ownerId,
        EMPTY_MP_CONFIG
      );
      const clean = sanitizeMercadoPagoConfig(parsed);
      mpConfigCache.set(ownerId, clean);
      return { ...clean };
    }

    const parsed = JSON.parse(raw) as Partial<MercadoPagoConfig>;
    const clean = sanitizeMercadoPagoConfig(parsed);
    mpConfigCache.set(ownerId, clean);
    const encrypted = await encryptJsonValue(clean, ownerId);
    if (encrypted) {
      window.localStorage.setItem(getStorageKey(ownerId), encrypted);
    }
    return { ...clean };
  } catch {
    return { ...EMPTY_MP_CONFIG };
  }
}

export function saveMercadoPagoConfig(ownerId: string, config: MercadoPagoConfig): MercadoPagoConfig {
  const clean = sanitizeMercadoPagoConfig(config);
  if (!ownerId || !isSafeId(ownerId) || typeof window === 'undefined') return clean;
  mpConfigCache.set(ownerId, clean);

  void encryptJsonValue(clean, ownerId)
    .then((encrypted) => {
      try {
        window.localStorage.setItem(getStorageKey(ownerId), encrypted);
      } catch {
        // Ignore storage quota errors
      }
    })
    .catch(() => {
      // Ignore crypto errors
    });

  return clean;
}

export function clearMercadoPagoConfigCache(ownerId?: string): void {
  if (ownerId) {
    mpConfigCache.delete(ownerId);
  } else {
    mpConfigCache.clear();
  }
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  return data;
}

export async function testMercadoPagoConnection(
  accessToken: string
): Promise<MpTestConnectionResult> {
  return postJson<MpTestConnectionResult>('/api/mercadopago/test', { accessToken });
}

export async function createMercadoPagoOrder(params: {
  accessToken: string;
  mode: 'qr' | 'point';
  amount: number;
  description: string;
  externalReference: string;
  posExternalId?: string;
  terminalId?: string;
  printOnTerminal?: boolean;
}): Promise<MpOrderResponse> {
  return postJson<MpOrderResponse>('/api/mercadopago/orders', params);
}

export async function checkMercadoPagoOrderStatus(params: {
  accessToken: string;
  orderId: string;
  apiFamily?: string;
  externalReference?: string;
}): Promise<MpOrderStatusResponse> {
  return postJson<MpOrderStatusResponse>('/api/mercadopago/orders/status', params);
}

export async function cancelMercadoPagoOrder(params: {
  accessToken: string;
  orderId: string;
  apiFamily?: string;
  terminalId?: string;
  posExternalId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return postJson<{ ok: boolean; error?: string }>('/api/mercadopago/orders/cancel', params);
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
    // Ignore session refresh error
  }
  return headers;
}

async function fetchAuthedPost(url: string, body: Record<string, unknown>): Promise<Response> {
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

/**
 * Verifica si PLATFORM_MERCADOPAGO_ACCESS_TOKEN configurado en el servidor es válido
 * realizando una llamada de prueba autenticada a la API de Mercado Pago (/users/me).
 */
export async function verifyPlatformMercadoPagoToken(): Promise<MpPlatformTokenVerificationResult> {
  try {
    const res = await fetchAuthedPost('/api/subscriptions/verify-platform-token', {});

    const contentType = res.headers.get('content-type') || '';
    const parsed = (await res.json().catch(() => null)) as MpPlatformTokenVerificationResult | null;
    if (!parsed || typeof parsed !== 'object') {
      return {
        ok: false,
        configured: false,
        valid: false,
        error: contentType.includes('text/html')
          ? 'El servidor /api no está desplegado o actualizado en este dominio (devolvió HTML en vez de JSON).'
          : `Respuesta inválida del servidor (HTTP ${res.status}) al verificar el token de la plataforma.`,
      };
    }
    return parsed;
  } catch {
    return {
      ok: false,
      configured: false,
      valid: false,
      error: 'Error de red al verificar PLATFORM_MERCADOPAGO_ACCESS_TOKEN.',
    };
  }
}

export interface MpTestCheckoutResult {
  ok: boolean;
  checkoutUrl?: string;
  preferenceId?: string;
  mode?: 'production' | 'test';
  amount?: number;
  error?: string;
}

export async function testPlatformSubscriptionCheckout(
  backUrl?: string
): Promise<MpTestCheckoutResult> {
  try {
    const res = await fetchAuthedPost('/api/subscriptions/test-checkout', {
      backUrl: backUrl || window.location.href,
    });
    const parsed = (await res.json().catch(() => null)) as MpTestCheckoutResult | null;
    if (!parsed || typeof parsed !== 'object') {
      return {
        ok: false,
        error: `Respuesta inválida del servidor (HTTP ${res.status}) al generar la prueba de pago.`,
      };
    }
    return parsed;
  } catch {
    return {
      ok: false,
      error: 'Error de red al generar la prueba de pago en Mercado Pago.',
    };
  }
}

export interface MpPlatformDiagnosticCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  httpStatus?: number;
  detail: string;
}

export interface MpPlatformDiagnosticResult {
  ok: boolean;
  timestamp: string;
  runtime: string;
  vercelEnv?: string | null;
  envStatus: 'loaded' | 'empty_string' | 'missing';
  detectedKey: string | null;
  tokenLength: number;
  prefixType: 'APP_USR' | 'TEST' | 'unknown' | 'none';
  hadQuotesOrWhitespace: boolean;
  checks: MpPlatformDiagnosticCheck[];
  hints: string[];
  error?: string;
}

/**
 * Ejecuta un diagnóstico detallado en el servidor sobre PLATFORM_MERCADOPAGO_ACCESS_TOKEN
 * (existencia, cadenas vacías, formato y scopes/permisos en Mercado Pago) y registra el resultado en consola.
 */
export async function diagnosePlatformMercadoPagoToken(): Promise<MpPlatformDiagnosticResult> {
  try {
    const res = await fetchAuthedPost('/api/subscriptions/diagnose-platform-token', {});

    const contentType = res.headers.get('content-type') || '';
    const parsed = (await res.json().catch(() => null)) as MpPlatformDiagnosticResult | null;
    if (!parsed || typeof parsed !== 'object') {
      const fallback: MpPlatformDiagnosticResult = {
        ok: false,
        timestamp: new Date().toISOString(),
        runtime: 'unknown',
        envStatus: 'missing',
        detectedKey: null,
        tokenLength: 0,
        prefixType: 'none',
        hadQuotesOrWhitespace: false,
        checks: [
          {
            id: 'api_reachability',
            label: 'Respuesta del endpoint de diagnóstico',
            status: 'fail',
            httpStatus: res.status,
            detail: contentType.includes('text/html')
              ? 'El servidor devolvió HTML en lugar de JSON (el backend /api no está actualizado).'
              : `Respuesta inválida del servidor (HTTP ${res.status}).`,
          },
        ],
        hints: ['Verificá que la última versión del backend esté desplegada correctamente.'],
        error: `HTTP ${res.status}`,
      };
      console.error('[TH3 BNB · Diagnóstico Mercado Pago]', fallback);
      return fallback;
    }

    console.info('[TH3 BNB · Diagnóstico Mercado Pago]', parsed);
    return parsed;
  } catch (err) {
    const networkFailure: MpPlatformDiagnosticResult = {
      ok: false,
      timestamp: new Date().toISOString(),
      runtime: 'unknown',
      envStatus: 'missing',
      detectedKey: null,
      tokenLength: 0,
      prefixType: 'none',
      hadQuotesOrWhitespace: false,
      checks: [
        {
          id: 'network_error',
          label: 'Conexión con el servidor',
          status: 'fail',
          detail: err instanceof Error ? err.message : 'Error de red al consultar el servidor.',
        },
      ],
      hints: ['Comprobá tu conexión a internet y recargá la aplicación.'],
      error: 'Error de red',
    };
    console.error('[TH3 BNB · Diagnóstico Mercado Pago]', networkFailure);
    return networkFailure;
  }
}
