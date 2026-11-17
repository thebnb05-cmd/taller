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
