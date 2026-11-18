import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MP_API_BASE = 'https://api.mercadopago.com';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fjkxnvqqmhxfycqbkmqy.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZDUlk1JOyzUt-VpYIcnM2Q_5Vdqyyrz';
const TRIAL_DAYS = 15;
const TRIAL_LAUNCH_EPOCH = Date.parse('2026-11-17T00:00:00Z');
const SUBSCRIPTION_SIGNING_SECRET =
  process.env.SUBSCRIPTION_SIGNING_SECRET ||
  crypto
    .createHash('sha256')
    .update(`${SUPABASE_URL}::th3bnb-sub-hmac-v1-c7e8b751`)
    .digest('hex');

const EXEMPT_ANNUAL_EMAILS = new Set(
  [
    'thebnb05@gmail.com',
    ...String(process.env.PLATFORM_EXEMPT_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ].map((email) => email.toLowerCase())
);

type ServerSubscriptionPlanId = 'mensual' | 'semestral' | 'anual';

const SERVER_PLANS: Record<
  ServerSubscriptionPlanId,
  { name: string; months: number; originalPrice: number; price: number }
> = {
  mensual: {
    name: 'Plan Mensual (1 mes)',
    months: 1,
    originalPrice: 7000,
    price: 3655,
  },
  semestral: {
    name: 'Plan 6 Meses',
    months: 6,
    originalPrice: 42000,
    price: 21930,
  },
  anual: {
    name: 'Plan Anual (12 meses)',
    months: 12,
    originalPrice: 84000,
    price: 43860,
  },
};

interface ServerSubscriptionPayload {
  userId: string;
  email: string;
  planId: 'trial' | ServerSubscriptionPlanId;
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

interface ServerSignedSubscription {
  payload: ServerSubscriptionPayload;
  sig: string;
}

interface MpErrorPayload {
  message?: string;
  error?: string;
  errors?: Array<{ message?: string; description?: string; code?: string }>;
  causes?: Array<{ description?: string; code?: string }>;
}

export type ApiIncomingRequest = IncomingMessage & {
  body?: unknown;
  originalUrl?: string;
  query?: Record<string, unknown>;
};

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: ApiIncomingRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body as Record<string, unknown>;
  }
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (Buffer.isBuffer(req.body)) {
    try {
      const parsed = JSON.parse(req.body.toString('utf8'));
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (req.readableEnded) {
    return {};
  }

  const chunks: Buffer[] = [];
  let totalLen = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalLen += buf.length;
    if (totalLen > 1024 * 1024) {
      throw new Error('El cuerpo de la solicitud supera el límite permitido.');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function addMonthsMs(baseMs: number, months: number): number {
  const date = new Date(baseMs);
  const targetDay = date.getDate();
  date.setMonth(date.getMonth() + months);
  if (date.getDate() < targetDay) {
    date.setDate(0);
  }
  return date.getTime();
}

function signSubscriptionPayload(payload: ServerSubscriptionPayload): ServerSignedSubscription {
  const canonical = JSON.stringify(payload);
  const sig = crypto
    .createHmac('sha256', SUBSCRIPTION_SIGNING_SECRET)
    .update(canonical)
    .digest('hex');
  return { payload, sig };
}

function verifySignedSubscription(
  raw: unknown,
  expectedUserId: string
): ServerSignedSubscription | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { payload?: ServerSubscriptionPayload; sig?: unknown };
  if (
    !candidate.payload ||
    typeof candidate.payload !== 'object' ||
    typeof candidate.sig !== 'string'
  ) {
    return null;
  }
  if (candidate.payload.userId !== expectedUserId) {
    return null;
  }
  const canonical = JSON.stringify(candidate.payload);
  const expectedSig = crypto
    .createHmac('sha256', SUBSCRIPTION_SIGNING_SECRET)
    .update(canonical)
    .digest('hex');
  const sigBuf = Buffer.from(candidate.sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  return { payload: candidate.payload, sig: candidate.sig };
}

async function verifySupabaseSessionUser(
  req: ApiIncomingRequest
): Promise<{ userId: string; email: string; createdAt: number } | null> {
  const rawAuth = req.headers.authorization;
  const authHeader = Array.isArray(rawAuth) ? rawAuth[0] || '' : rawAuth || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const jwt = match?.[1]?.trim() || '';
  if (!jwt) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string; email?: string; created_at?: string };
    const userId = String(data.id || '').trim();
    const email = String(data.email || '').trim().toLowerCase();
    if (!userId || !email) return null;
    const createdAt = Date.parse(String(data.created_at || '')) || Date.now();
    return { userId, email, createdAt };
  } catch {
    return null;
  }
}

function resolvePlatformMpToken(): string {
  let raw = process.env.PLATFORM_MERCADOPAGO_ACCESS_TOKEN;
  if (!raw) {
    for (const [k, v] of Object.entries(process.env)) {
      const normalizedKey = k.trim().toUpperCase();
      if (
        (normalizedKey === 'PLATFORM_MERCADOPAGO_ACCESS_TOKEN' ||
          normalizedKey === 'PLATFORM_MERCADO_PAGO_ACCESS_TOKEN') &&
        v
      ) {
        raw = v;
        break;
      }
    }
  }
  return String(raw || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
}

function resolveUserSubscriptionState(
  user: { userId: string; email: string; createdAt: number },
  existingRaw: unknown
): ServerSignedSubscription {
  const now = Date.now();
  const verifiedExisting = verifySignedSubscription(existingRaw, user.userId);
  const isExempt = EXEMPT_ANNUAL_EMAILS.has(user.email.toLowerCase());

  if (isExempt) {
    if (
      verifiedExisting &&
      verifiedExisting.payload.isExemptAnnual &&
      verifiedExisting.payload.expiresAt > now
    ) {
      return signSubscriptionPayload({
        ...verifiedExisting.payload,
        email: user.email,
        status: 'active',
        updatedAt: now,
      });
    }

    const startedAt = now;
    const expiresAt = addMonthsMs(startedAt, 12);
    return signSubscriptionPayload({
      userId: user.userId,
      email: user.email,
      planId: 'anual',
      status: 'active',
      startedAt,
      expiresAt,
      isExemptAnnual: true,
      autoRenewFree: true,
      provider: 'exempt',
      updatedAt: now,
    });
  }

  if (verifiedExisting && !verifiedExisting.payload.isExemptAnnual) {
    const resolvedExpiresAt =
      verifiedExisting.payload.planId === 'trial'
        ? Math.max(
            verifiedExisting.payload.expiresAt,
            verifiedExisting.payload.startedAt + TRIAL_DAYS * 24 * 60 * 60 * 1000
          )
        : verifiedExisting.payload.expiresAt;
    const isActive = resolvedExpiresAt > now;
    return signSubscriptionPayload({
      ...verifiedExisting.payload,
      expiresAt: resolvedExpiresAt,
      email: user.email,
      status: isActive ? 'active' : 'expired',
      updatedAt: now,
    });
  }

  const trialStart = Math.max(user.createdAt, TRIAL_LAUNCH_EPOCH);
  const trialExpires = trialStart + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  return signSubscriptionPayload({
    userId: user.userId,
    email: user.email,
    planId: 'trial',
    status: trialExpires > now ? 'active' : 'expired',
    startedAt: trialStart,
    expiresAt: trialExpires,
    isExemptAnnual: false,
    autoRenewFree: false,
    provider: 'trial',
    updatedAt: now,
  });
}

function resolveAccessToken(bodyToken: unknown): string {
  return typeof bodyToken === 'string' ? bodyToken.trim() : '';
}

function resolvePosId(bodyPosId: unknown): string {
  return typeof bodyPosId === 'string' ? bodyPosId.trim() : '';
}

function resolveTerminalId(bodyTerminalId: unknown): string {
  return typeof bodyTerminalId === 'string' ? bodyTerminalId.trim() : '';
}

function extractMpErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const err = payload as MpErrorPayload;
  if (Array.isArray(err.errors) && err.errors.length > 0) {
    const first = err.errors[0];
    if (first?.message || first?.description) {
      return String(first.message || first.description);
    }
  }
  if (Array.isArray(err.causes) && err.causes.length > 0) {
    const first = err.causes[0];
    if (first?.description) return String(first.description);
  }
  if (err.message) return String(err.message);
  if (err.error) return String(err.error);
  return fallback;
}

async function mpFetch(
  endpointPath: string,
  token: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    body?: Record<string, unknown>;
    idempotencyKey?: string;
  } = {}
): Promise<{ status: number; ok: boolean; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.idempotencyKey) {
    headers['X-Idempotency-Key'] = options.idempotencyKey;
  }

  const response = await fetch(`${MP_API_BASE}${endpointPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { raw: text };
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    data: parsed,
  };
}

function normalizeOrderStatus(
  statusRaw: unknown,
  statusDetailRaw?: unknown
): {
  status: string;
  statusDetail: string;
  isPaid: boolean;
  isCanceled: boolean;
  isFailed: boolean;
} {
  const status = String(statusRaw || '').trim();
  const statusLower = status.toLowerCase();
  const statusDetail = String(statusDetailRaw || '').trim();
  const detailLower = statusDetail.toLowerCase();

  const isPaid =
    statusLower === 'processed' ||
    statusLower === 'finished' ||
    statusLower === 'approved' ||
    statusLower === 'paid' ||
    detailLower === 'accredited';

  const isCanceled =
    statusLower === 'canceled' ||
    statusLower === 'cancelled' ||
    statusLower === 'expired' ||
    statusLower === 'abandoned';

  const isFailed =
    statusLower === 'failed' ||
    statusLower === 'error' ||
    statusLower === 'rejected' ||
    statusLower === 'action_required';

  return { status, statusDetail, isPaid, isCanceled, isFailed };
}

function resolveRequestOrigin(req: ApiIncomingRequest): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (typeof host === 'string' && host.trim()) {
    const protoHeader = req.headers['x-forwarded-proto'];
    const protoRaw = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
    const proto = protoRaw === 'http' ? 'http' : 'https';
    return `${proto}://${host.trim()}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

function resolveApiPath(req: ApiIncomingRequest): string {
  const rawUrl = req.originalUrl || req.url || '/';
  const parsedUrl = new URL(rawUrl, 'http://localhost');
  const rewrittenPath = parsedUrl.searchParams.get('__path');
  if (rewrittenPath) {
    return `/api/${rewrittenPath.replace(/^\/+/, '')}`;
  }
  if (req.query && typeof req.query.__path === 'string' && req.query.__path) {
    return `/api/${req.query.__path.replace(/^\/+/, '')}`;
  }
  return parsedUrl.pathname.replace(/\/+$/, '') || '/';
}

const LOGIN_GUARD_COOKIE = 'th3bnb_lg';
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;
const LOGIN_ATTEMPT_WINDOW_MS = 30 * 60 * 1000;

function parseCookies(req: ApiIncomingRequest): Record<string, string> {
  const raw = req.headers.cookie;
  const header = Array.isArray(raw) ? raw.join(';') : raw || '';
  const map: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) map[key] = val;
  }
  return map;
}

function hashLoginEmail(email: string): string {
  return crypto
    .createHmac('sha256', SUBSCRIPTION_SIGNING_SECRET)
    .update(`lg:${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 24);
}

type LoginGuardMap = Record<string, { n: number; u: number; t: number }>;

function readLoginGuardCookie(req: ApiIncomingRequest): LoginGuardMap {
  try {
    const raw = parseCookies(req)[LOGIN_GUARD_COOKIE];
    if (!raw) return {};
    const dot = raw.indexOf('.');
    if (dot <= 0) return {};
    const b64 = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expectedSig = crypto
      .createHmac('sha256', SUBSCRIPTION_SIGNING_SECRET)
      .update(b64)
      .digest('hex');
    const sigBuf = Buffer.from(sig, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return {};
    }
    const parsed = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as LoginGuardMap;
    if (!parsed || typeof parsed !== 'object') return {};
    const now = Date.now();
    const clean: LoginGuardMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v.n !== 'number' || typeof v.t !== 'number') continue;
      const lockedUntil = typeof v.u === 'number' && Number.isFinite(v.u) ? v.u : 0;
      // Expired 5-minute lockout resets cleanly
      if (lockedUntil > 0 && now >= lockedUntil) continue;
      // Expired pre-lockout attempt window resets cleanly
      if (lockedUntil === 0 && now - v.t >= LOGIN_ATTEMPT_WINDOW_MS) continue;
      clean[k] = {
        n: Math.max(0, Math.min(MAX_LOGIN_ATTEMPTS, Math.floor(v.n))),
        u: lockedUntil,
        t: v.t,
      };
    }
    return clean;
  } catch {
    return {};
  }
}

function writeLoginGuardCookie(req: ApiIncomingRequest, res: ServerResponse, map: LoginGuardMap): void {
  const entries = Object.entries(map)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, 8);
  const compact = Object.fromEntries(entries);
  const b64 = Buffer.from(JSON.stringify(compact), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SUBSCRIPTION_SIGNING_SECRET)
    .update(b64)
    .digest('hex');
  const isHttps =
    req.headers['x-forwarded-proto'] === 'https' ||
    String(req.headers.origin || '').startsWith('https://') ||
    Boolean(process.env.VERCEL);
  const sameSite = isHttps ? 'SameSite=None; Secure' : 'SameSite=Lax';
  const maxAge = entries.length === 0 ? 0 : Math.floor(LOGIN_ATTEMPT_WINDOW_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${LOGIN_GUARD_COOKIE}=${b64}.${sig}; Path=/; Max-Age=${maxAge}; HttpOnly; ${sameSite}`
  );
}

function buildLoginGuardResponse(entry: { n: number; u: number; t: number } | undefined, now: number) {
  if (!entry || (entry.u > 0 && now >= entry.u)) {
    return {
      ok: true,
      attempts: 0,
      remainingAttempts: MAX_LOGIN_ATTEMPTS,
      requiresOtp: false,
      lockedUntil: null,
      lockRemainingSec: 0,
    };
  }
  const locked = entry.u > now || entry.n >= MAX_LOGIN_ATTEMPTS;
  const lockedUntil = locked ? (entry.u > now ? entry.u : now + LOGIN_LOCKOUT_MS) : null;
  const lockRemainingSec = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  return {
    ok: true,
    attempts: entry.n,
    remainingAttempts: Math.max(0, MAX_LOGIN_ATTEMPTS - entry.n),
    requiresOtp: locked,
    lockedUntil,
    lockRemainingSec,
  };
}

export async function handleApiRequest(
  req: ApiIncomingRequest,
  res: ServerResponse
): Promise<boolean> {
  const apiPath = resolveApiPath(req);
  if (!apiPath.startsWith('/api')) {
    return false;
  }

  const method = (req.method || 'GET').toUpperCase();

  if (apiPath === '/api/health' && method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      mpConfigured: Boolean(resolvePlatformMpToken()),
    });
    return true;
  }

  if (method !== 'POST') {
    sendJson(res, 404, { ok: false, error: 'Ruta de API no encontrada.' });
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, {
      ok: false,
      error: err instanceof Error ? err.message : 'JSON inválido en la solicitud.',
    });
    return true;
  }

  if (apiPath === '/api/auth/login-guard') {
    const rawEmail = String(body.email || '').trim().toLowerCase();
    const action = String(body.action || 'status').trim();
    if (!rawEmail || !rawEmail.includes('@')) {
      sendJson(res, 400, { ok: false, error: 'Correo inválido.' });
      return true;
    }
    const now = Date.now();
    const emailHash = hashLoginEmail(rawEmail);
    const guardMap = readLoginGuardCookie(req);
    const current = guardMap[emailHash];

    if (action === 'reset') {
      const user = await verifySupabaseSessionUser(req);
      if (!user || user.email.toLowerCase() !== rawEmail) {
        sendJson(res, 401, {
          ok: false,
          error: 'Se requiere sesión verificada para restablecer los intentos.',
        });
        return true;
      }
      delete guardMap[emailHash];
      writeLoginGuardCookie(req, res, guardMap);
      sendJson(res, 200, buildLoginGuardResponse(undefined, now));
      return true;
    }

    if (action === 'fail') {
      if (current && current.u > now) {
        sendJson(res, 200, buildLoginGuardResponse(current, now));
        return true;
      }
      const baseAttempts = current && current.u === 0 ? current.n : 0;
      const nextAttempts = Math.min(MAX_LOGIN_ATTEMPTS, baseAttempts + 1);
      const lockedUntil = nextAttempts >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : 0;
      const nextEntry = { n: nextAttempts, u: lockedUntil, t: now };
      guardMap[emailHash] = nextEntry;
      writeLoginGuardCookie(req, res, guardMap);
      sendJson(res, 200, buildLoginGuardResponse(nextEntry, now));
      return true;
    }

    sendJson(res, 200, buildLoginGuardResponse(current, now));
    return true;
  }

  if (apiPath === '/api/mercadopago/test') {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      sendJson(res, 401, { ok: false, error: 'Iniciá sesión para probar Mercado Pago.' });
      return true;
    }
    const token = resolveAccessToken(body.accessToken);
    if (!token) {
      sendJson(res, 400, {
        ok: false,
        error: 'Ingresá un Access Token de Mercado Pago para probar la conexión.',
      });
      return true;
    }

    try {
      const meRes = await mpFetch('/users/me', token);
      if (!meRes.ok) {
        sendJson(res, meRes.status >= 400 ? meRes.status : 401, {
          ok: false,
          error: extractMpErrorMessage(
            meRes.data,
            'Access Token inválido o sin permisos en Mercado Pago.'
          ),
        });
        return true;
      }

      const sellerId = String(meRes.data.id || '');
      const nickname = String(meRes.data.nickname || '');
      const email = String(meRes.data.email || '');
      const siteId = String(meRes.data.site_id || '');

      const terminalsMap = new Map<
        string,
        { id: string; posId: string; storeId: string; operatingMode: string; externalPosId: string }
      >();

      const v1Terminals = await mpFetch('/terminals/v1/list?limit=50', token);
      if (v1Terminals.ok) {
        const list = Array.isArray(v1Terminals.data.data)
          ? v1Terminals.data.data
          : Array.isArray((v1Terminals.data.data as { terminals?: unknown[] } | undefined)?.terminals)
            ? ((v1Terminals.data.data as { terminals?: unknown[] }).terminals as unknown[])
            : [];
        for (const item of list) {
          if (!item || typeof item !== 'object') continue;
          const row = item as Record<string, unknown>;
          const id = String(row.id || '').trim();
          if (!id) continue;
          terminalsMap.set(id, {
            id,
            posId: String(row.pos_id || ''),
            storeId: String(row.store_id || ''),
            operatingMode: String(row.operating_mode || ''),
            externalPosId: String(row.external_pos_id || ''),
          });
        }
      }

      const legacyDevices = await mpFetch('/point/integration-api/devices?limit=50', token);
      if (legacyDevices.ok && Array.isArray(legacyDevices.data.devices)) {
        for (const item of legacyDevices.data.devices) {
          if (!item || typeof item !== 'object') continue;
          const row = item as Record<string, unknown>;
          const id = String(row.id || '').trim();
          if (!id || terminalsMap.has(id)) continue;
          terminalsMap.set(id, {
            id,
            posId: String(row.pos_id || ''),
            storeId: String(row.store_id || ''),
            operatingMode: String(row.operating_mode || ''),
            externalPosId: String(row.external_pos_id || ''),
          });
        }
      }

      const posList: Array<{
        id: string;
        externalId: string;
        name: string;
        storeId: string;
      }> = [];
      const posRes = await mpFetch('/pos?limit=50', token);
      if (posRes.ok && Array.isArray(posRes.data.results)) {
        for (const item of posRes.data.results) {
          if (!item || typeof item !== 'object') continue;
          const row = item as Record<string, unknown>;
          const externalId = String(row.external_id || '').trim();
          const id = String(row.id || '').trim();
          if (!externalId && !id) continue;
          posList.push({
            id,
            externalId: externalId || id,
            name: String(row.name || externalId || `Caja ${id}`),
            storeId: String(row.store_id || ''),
          });
        }
      }

      sendJson(res, 200, {
        ok: true,
        account: {
          sellerId,
          nickname,
          email,
          siteId,
        },
        terminals: Array.from(terminalsMap.values()),
        posList,
      });
      return true;
    } catch (err) {
      sendJson(res, 502, {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'No se pudo conectar con los servidores de Mercado Pago.',
      });
      return true;
    }
  }

  if (apiPath === '/api/mercadopago/orders') {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      sendJson(res, 401, { ok: false, error: 'Sesión inválida o expirada.' });
      return true;
    }
    const token = resolveAccessToken(body.accessToken);
    const mode = body.mode === 'point' ? 'point' : body.mode === 'qr' ? 'qr' : null;
    const rawAmount = Number(body.amount);
    const description =
      String(body.description || 'Venta de taller').trim().slice(0, 120) || 'Venta de taller';
    const externalReference =
      String(body.externalReference || `SALE-${Date.now()}`).trim().slice(0, 64) ||
      `SALE-${Date.now()}`;
    const posExternalId = resolvePosId(body.posExternalId);
    const terminalId = resolveTerminalId(body.terminalId);
    const printOnTerminal = Boolean(body.printOnTerminal);

    if (!token) {
      sendJson(res, 400, {
        ok: false,
        error: 'Falta configurar el Access Token de Mercado Pago.',
      });
      return true;
    }
    if (!mode) {
      sendJson(res, 400, { ok: false, error: 'Modo de cobro inválido.' });
      return true;
    }
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      sendJson(res, 400, { ok: false, error: 'El monto debe ser mayor a 0.' });
      return true;
    }

    const formattedAmount = rawAmount.toFixed(2);
    const idempotencyKey = crypto.randomUUID();

    try {
      if (mode === 'qr') {
        if (!posExternalId) {
          sendJson(res, 400, {
            ok: false,
            error: 'Falta configurar el ID de punto de venta / Caja para generar el QR.',
          });
          return true;
        }

        const orderRes = await mpFetch('/v1/orders', token, {
          method: 'POST',
          idempotencyKey,
          body: {
            type: 'qr',
            external_reference: externalReference,
            expiration_time: 'PT15M',
            total_amount: formattedAmount,
            description,
            config: {
              qr: {
                external_pos_id: posExternalId,
                mode: 'dynamic',
              },
            },
            transactions: {
              payments: [{ amount: formattedAmount }],
            },
            items: [
              {
                title: description,
                unit_price: formattedAmount,
                quantity: 1,
                unit_measure: 'unit',
              },
            ],
          },
        });

        const typeResp = orderRes.data.type_response as { qr_data?: string } | undefined;
        const qrData = String(typeResp?.qr_data || orderRes.data.qr_data || '').trim();

        if (orderRes.ok && qrData) {
          const normalized = normalizeOrderStatus(orderRes.data.status, orderRes.data.status_detail);
          sendJson(res, 200, {
            ok: true,
            mode: 'qr',
            apiFamily: 'orders_v1',
            orderId: String(orderRes.data.id || ''),
            externalReference,
            qrData,
            ...normalized,
          });
          return true;
        }

        const meRes = await mpFetch('/users/me', token);
        const sellerId = String(meRes.data.id || '').trim();
        if (sellerId) {
          const legacyQrRes = await mpFetch(
            `/instore/orders/qr/seller/collectors/${encodeURIComponent(sellerId)}/pos/${encodeURIComponent(posExternalId)}/qrs`,
            token,
            {
              method: 'POST',
              body: {
                external_reference: externalReference,
                title: description,
                description,
                total_amount: Number(formattedAmount),
                items: [
                  {
                    title: description,
                    unit_price: Number(formattedAmount),
                    quantity: 1,
                    unit_measure: 'unit',
                    total_amount: Number(formattedAmount),
                  },
                ],
              },
            }
          );

          const legacyQrData = String(legacyQrRes.data.qr_data || '').trim();
          if (legacyQrRes.ok && legacyQrData) {
            sendJson(res, 200, {
              ok: true,
              mode: 'qr',
              apiFamily: 'legacy_qr',
              orderId: String(legacyQrRes.data.in_store_order_id || externalReference),
              externalReference,
              sellerId,
              qrData: legacyQrData,
              status: 'created',
              statusDetail: 'created',
              isPaid: false,
              isCanceled: false,
              isFailed: false,
            });
            return true;
          }

          sendJson(res, legacyQrRes.status >= 400 ? legacyQrRes.status : 400, {
            ok: false,
            error: extractMpErrorMessage(
              legacyQrRes.data,
              extractMpErrorMessage(orderRes.data, 'No se pudo generar el QR dinámico en Mercado Pago.')
            ),
          });
          return true;
        }

        sendJson(res, orderRes.status >= 400 ? orderRes.status : 400, {
          ok: false,
          error: extractMpErrorMessage(
            orderRes.data,
            'No se pudo generar el QR dinámico en Mercado Pago.'
          ),
        });
        return true;
      }

      if (!terminalId) {
        sendJson(res, 400, {
          ok: false,
          error: 'Falta configurar el ID del dispositivo físico Point.',
        });
        return true;
      }

      const pointOrderRes = await mpFetch('/v1/orders', token, {
        method: 'POST',
        idempotencyKey,
        body: {
          type: 'point',
          external_reference: externalReference,
          expiration_time: 'PT15M',
          processing_mode: 'automatic',
          total_amount: formattedAmount,
          description,
          config: {
            point: {
              terminal_id: terminalId,
              print_on_terminal: printOnTerminal ? 'seller_ticket' : 'no_ticket',
            },
          },
          transactions: {
            payments: [{ amount: formattedAmount }],
          },
          items: [
            {
              title: description,
              unit_price: formattedAmount,
              quantity: 1,
              unit_measure: 'unit',
            },
          ],
        },
      });

      if (pointOrderRes.ok) {
        const normalized = normalizeOrderStatus(
          pointOrderRes.data.status,
          pointOrderRes.data.status_detail
        );
        sendJson(res, 200, {
          ok: true,
          mode: 'point',
          apiFamily: 'orders_v1',
          orderId: String(pointOrderRes.data.id || ''),
          externalReference,
          ...normalized,
        });
        return true;
      }

      const legacyIntentRes = await mpFetch(
        `/point/integration-api/devices/${encodeURIComponent(terminalId)}/payment-intents`,
        token,
        {
          method: 'POST',
          body: {
            amount: Math.round(rawAmount * 100),
            description,
            additional_info: {
              external_reference: externalReference,
              print_on_terminal: printOnTerminal,
            },
          },
        }
      );

      if (legacyIntentRes.ok) {
        sendJson(res, 200, {
          ok: true,
          mode: 'point',
          apiFamily: 'legacy_intent',
          orderId: String(legacyIntentRes.data.id || ''),
          externalReference,
          status: 'OPEN',
          statusDetail: 'sent_to_terminal',
          isPaid: false,
          isCanceled: false,
          isFailed: false,
        });
        return true;
      }

      sendJson(res, pointOrderRes.status >= 400 ? pointOrderRes.status : 400, {
        ok: false,
        error: extractMpErrorMessage(
          pointOrderRes.data,
          extractMpErrorMessage(
            legacyIntentRes.data,
            'No se pudo enviar la orden al dispositivo Point.'
          )
        ),
      });
      return true;
    } catch (err) {
      sendJson(res, 502, {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Error de red al comunicarse con Mercado Pago.',
      });
      return true;
    }
  }

  if (apiPath === '/api/mercadopago/orders/status') {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      sendJson(res, 401, { ok: false, error: 'Sesión inválida o expirada.' });
      return true;
    }
    const token = resolveAccessToken(body.accessToken);
    const orderId = String(body.orderId || '').trim();
    const apiFamily = String(body.apiFamily || 'orders_v1');
    const externalReference = String(body.externalReference || '').trim();

    if (!token || (!orderId && !externalReference)) {
      sendJson(res, 400, { ok: false, error: 'Datos insuficientes para consultar la orden.' });
      return true;
    }

    try {
      if (apiFamily === 'legacy_intent') {
        const intentRes = await mpFetch(
          `/point/integration-api/payment-intents/${encodeURIComponent(orderId)}`,
          token
        );
        if (!intentRes.ok) {
          sendJson(res, intentRes.status, {
            ok: false,
            error: extractMpErrorMessage(intentRes.data, 'No se pudo consultar el estado del Point.'),
          });
          return true;
        }
        const normalized = normalizeOrderStatus(
          intentRes.data.state || intentRes.data.status,
          intentRes.data.status_detail
        );
        sendJson(res, 200, { ok: true, id: orderId, ...normalized });
        return true;
      }

      if (apiFamily === 'legacy_qr' && externalReference) {
        const merchantRes = await mpFetch(
          `/merchant_orders?external_reference=${encodeURIComponent(externalReference)}`,
          token
        );
        if (!merchantRes.ok) {
          sendJson(res, merchantRes.status, {
            ok: false,
            error: extractMpErrorMessage(merchantRes.data, 'No se pudo consultar el estado del QR.'),
          });
          return true;
        }
        const elements = Array.isArray(merchantRes.data.elements) ? merchantRes.data.elements : [];
        const latest = (elements[0] as Record<string, unknown> | undefined) || {};
        const orderStatus = String(latest.order_status || latest.status || 'opened');
        const isPaid = orderStatus === 'paid';
        const isCanceled = orderStatus === 'expired' || orderStatus === 'canceled';
        sendJson(res, 200, {
          ok: true,
          id: String(latest.id || orderId),
          status: orderStatus,
          statusDetail: orderStatus,
          isPaid,
          isCanceled,
          isFailed: false,
        });
        return true;
      }

      const orderRes = await mpFetch(`/v1/orders/${encodeURIComponent(orderId)}`, token);
      if (!orderRes.ok) {
        sendJson(res, orderRes.status, {
          ok: false,
          error: extractMpErrorMessage(orderRes.data, 'No se pudo consultar la orden en Mercado Pago.'),
        });
        return true;
      }

      const normalized = normalizeOrderStatus(orderRes.data.status, orderRes.data.status_detail);
      sendJson(res, 200, {
        ok: true,
        id: String(orderRes.data.id || orderId),
        ...normalized,
      });
      return true;
    } catch (err) {
      sendJson(res, 502, {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Error de red al verificar estado en Mercado Pago.',
      });
      return true;
    }
  }

  if (apiPath === '/api/mercadopago/orders/cancel') {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      sendJson(res, 401, { ok: false, error: 'Sesión inválida o expirada.' });
      return true;
    }
    const token = resolveAccessToken(body.accessToken);
    const orderId = String(body.orderId || '').trim();
    const apiFamily = String(body.apiFamily || 'orders_v1');
    const terminalId = resolveTerminalId(body.terminalId);
    const posExternalId = resolvePosId(body.posExternalId);

    if (!token || !orderId) {
      sendJson(res, 400, { ok: false, error: 'Faltan datos para cancelar la orden.' });
      return true;
    }

    try {
      if (apiFamily === 'legacy_intent' && terminalId) {
        const cancelRes = await mpFetch(
          `/point/integration-api/devices/${encodeURIComponent(terminalId)}/payment-intents/${encodeURIComponent(orderId)}`,
          token,
          { method: 'DELETE' }
        );
        if (!cancelRes.ok) {
          sendJson(res, cancelRes.status, {
            ok: false,
            error: extractMpErrorMessage(cancelRes.data, 'No se pudo cancelar la intención en el Point.'),
          });
          return true;
        }
        sendJson(res, 200, { ok: true });
        return true;
      }

      if (apiFamily === 'legacy_qr' && posExternalId) {
        const meRes = await mpFetch('/users/me', token);
        const sellerId = String(meRes.data.id || '').trim();
        if (sellerId) {
          await mpFetch(
            `/instore/qr/seller/collectors/${encodeURIComponent(sellerId)}/pos/${encodeURIComponent(posExternalId)}/orders`,
            token,
            { method: 'DELETE' }
          );
        }
        sendJson(res, 200, { ok: true });
        return true;
      }

      const cancelRes = await mpFetch(`/v1/orders/${encodeURIComponent(orderId)}/cancel`, token, {
        method: 'POST',
        idempotencyKey: crypto.randomUUID(),
      });
      if (!cancelRes.ok) {
        sendJson(res, cancelRes.status, {
          ok: false,
          error: extractMpErrorMessage(cancelRes.data, 'No se pudo cancelar la orden en Mercado Pago.'),
        });
        return true;
      }
      sendJson(res, 200, { ok: true });
      return true;
    } catch (err) {
      sendJson(res, 502, {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Error de red al cancelar la orden en Mercado Pago.',
      });
      return true;
    }
  }

  if (apiPath === '/api/subscriptions/status') {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      sendJson(res, 401, { ok: false, error: 'Sesión inválida o expirada.' });
      return true;
    }
    const subscription = resolveUserSubscriptionState(user, body.subscriptionToken);
    sendJson(res, 200, {
      ok: true,
      subscription,
      mpConfigured: Boolean(resolvePlatformMpToken()),
    });
    return true;
  }

  if (apiPath === '/api/subscriptions/checkout') {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      sendJson(res, 401, { ok: false, error: 'Sesión inválida o expirada.' });
      return true;
    }

    if (EXEMPT_ANNUAL_EMAILS.has(user.email.toLowerCase())) {
      const subscription = resolveUserSubscriptionState(user, null);
      sendJson(res, 200, {
        ok: true,
        exemptRenewed: true,
        subscription,
      });
      return true;
    }

    const planId = String(body.planId || '') as ServerSubscriptionPlanId;
    const plan = SERVER_PLANS[planId];
    if (!plan) {
      sendJson(res, 400, { ok: false, error: 'Plan de suscripción inválido.' });
      return true;
    }

    const platformToken = resolvePlatformMpToken();
    if (!platformToken) {
      sendJson(res, 503, {
        ok: false,
        error:
          'El administrador de la plataforma aún no configuró el Access Token central de suscripciones en Mercado Pago (PLATFORM_MERCADOPAGO_ACCESS_TOKEN).',
      });
      return true;
    }

    const rawBackUrl = String(body.backUrl || '').trim();
    const safeBackUrl =
      rawBackUrl.startsWith('https://') || rawBackUrl.startsWith('http://')
        ? rawBackUrl
        : `${resolveRequestOrigin(req)}/?mp_sub=return`;
    const externalReference = `TH3SUB|${user.userId}|${planId}|${Date.now()}`;

    try {
      const preapprovalRes = await mpFetch('/preapproval', platformToken, {
        method: 'POST',
        body: {
          reason: `TH3 BNB Taller - ${plan.name}`,
          external_reference: externalReference,
          payer_email: user.email,
          auto_recurring: {
            frequency: plan.months,
            frequency_type: 'months',
            transaction_amount: plan.price,
            currency_id: 'ARS',
          },
          back_url: safeBackUrl,
          status: 'pending',
        },
      });

      const preapprovalUrl = String(
        preapprovalRes.data.init_point || preapprovalRes.data.sandbox_init_point || ''
      ).trim();

      if (preapprovalRes.ok && preapprovalUrl) {
        sendJson(res, 200, {
          ok: true,
          checkoutUrl: preapprovalUrl,
          providerId: String(preapprovalRes.data.id || ''),
          kind: 'preapproval',
          externalReference,
          planId,
        });
        return true;
      }

      const prefRes = await mpFetch('/checkout/preferences', platformToken, {
        method: 'POST',
        body: {
          external_reference: externalReference,
          items: [
            {
              id: `sub-${planId}`,
              title: `TH3 BNB Taller - ${plan.name}`,
              description: `Suscripción ${plan.name} con descuento promocional`,
              quantity: 1,
              currency_id: 'ARS',
              unit_price: plan.price,
            },
          ],
          payer: {
            email: user.email,
          },
          back_urls: {
            success: safeBackUrl,
            pending: safeBackUrl,
            failure: safeBackUrl,
          },
          ...(safeBackUrl.startsWith('https://') ? { auto_return: 'approved' } : {}),
        },
      });

      const prefUrl = String(
        prefRes.data.init_point || prefRes.data.sandbox_init_point || ''
      ).trim();

      if (!prefRes.ok || !prefUrl) {
        sendJson(res, prefRes.status >= 400 ? prefRes.status : 400, {
          ok: false,
          error: extractMpErrorMessage(
            preapprovalRes.data || prefRes.data,
            'Mercado Pago no permitió generar el link de suscripción.'
          ),
        });
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        checkoutUrl: prefUrl,
        providerId: String(prefRes.data.id || ''),
        kind: 'preference',
        externalReference,
        planId,
      });
      return true;
    } catch (err) {
      sendJson(res, 502, {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Error de red al crear la suscripción en Mercado Pago.',
      });
      return true;
    }
  }

  if (apiPath === '/api/subscriptions/verify') {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      sendJson(res, 401, { ok: false, error: 'Sesión inválida o expirada.' });
      return true;
    }

    if (EXEMPT_ANNUAL_EMAILS.has(user.email.toLowerCase())) {
      const subscription = resolveUserSubscriptionState(user, body.subscriptionToken);
      sendJson(res, 200, { ok: true, paid: true, subscription });
      return true;
    }

    const platformToken = resolvePlatformMpToken();
    if (!platformToken) {
      sendJson(res, 503, {
        ok: false,
        error: 'Falta configurar PLATFORM_MERCADOPAGO_ACCESS_TOKEN en el servidor.',
      });
      return true;
    }

    const requestedPlanId = String(body.planId || '') as ServerSubscriptionPlanId;
    const providerId = String(body.providerId || '').trim();
    const kind = String(body.kind || '').trim();
    const externalReference = String(body.externalReference || '').trim();

    if (!providerId && !externalReference) {
      sendJson(res, 400, { ok: false, error: 'Faltan referencias para verificar el pago.' });
      return true;
    }

    try {
      let paid = false;
      let mpStatus = 'pending';
      let confirmedPlanId: ServerSubscriptionPlanId | null = SERVER_PLANS[requestedPlanId]
        ? requestedPlanId
        : null;
      let confirmedProviderId = providerId;
      let confirmedRef = externalReference;

      const parsePlanFromRef = (ref: string): ServerSubscriptionPlanId | null => {
        const parts = ref.split('|');
        if (parts.length >= 3 && parts[0] === 'TH3SUB' && parts[1] === user.userId) {
          const maybePlan = parts[2] as ServerSubscriptionPlanId;
          if (SERVER_PLANS[maybePlan]) return maybePlan;
        }
        return null;
      };

      if (providerId && (kind === 'preapproval' || !kind)) {
        const preRes = await mpFetch(`/preapproval/${encodeURIComponent(providerId)}`, platformToken);
        if (preRes.ok) {
          const ref = String(preRes.data.external_reference || '');
          const refBelongsToUser = !ref || ref.startsWith(`TH3SUB|${user.userId}|`);
          if (refBelongsToUser) {
            mpStatus = String(preRes.data.status || 'pending');
            if (mpStatus === 'authorized' || mpStatus === 'active') {
              paid = true;
              confirmedProviderId = String(preRes.data.id || providerId);
              confirmedRef = ref || confirmedRef;
              confirmedPlanId = parsePlanFromRef(ref) || confirmedPlanId;
            }
          }
        }
      }

      if (!paid && externalReference) {
        const paySearch = await mpFetch(
          `/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}&sort=date_created&criteria=desc`,
          platformToken
        );
        if (paySearch.ok && Array.isArray(paySearch.data.results)) {
          for (const item of paySearch.data.results) {
            if (!item || typeof item !== 'object') continue;
            const row = item as Record<string, unknown>;
            const rowRef = String(row.external_reference || externalReference);
            if (!rowRef.startsWith(`TH3SUB|${user.userId}|`)) continue;
            mpStatus = String(row.status || mpStatus);
            if (mpStatus === 'approved') {
              paid = true;
              confirmedProviderId = String(row.id || confirmedProviderId);
              confirmedRef = rowRef;
              confirmedPlanId = parsePlanFromRef(rowRef) || confirmedPlanId;
              break;
            }
          }
        }
      }

      if (!paid && providerId && /^\d+$/.test(providerId)) {
        const payRes = await mpFetch(`/v1/payments/${encodeURIComponent(providerId)}`, platformToken);
        if (payRes.ok) {
          const ref = String(payRes.data.external_reference || '');
          if (ref.startsWith(`TH3SUB|${user.userId}|`)) {
            mpStatus = String(payRes.data.status || mpStatus);
            if (mpStatus === 'approved') {
              paid = true;
              confirmedProviderId = String(payRes.data.id || providerId);
              confirmedRef = ref;
              confirmedPlanId = parsePlanFromRef(ref) || confirmedPlanId;
            }
          }
        }
      }

      if (!paid) {
        sendJson(res, 200, { ok: true, paid: false, mpStatus });
        return true;
      }

      const finalPlanId: ServerSubscriptionPlanId = confirmedPlanId || 'mensual';
      const plan = SERVER_PLANS[finalPlanId];
      const now = Date.now();
      const existing = verifySignedSubscription(body.subscriptionToken, user.userId);
      const anchorStart =
        existing && !existing.payload.isExemptAnnual && existing.payload.expiresAt > now
          ? existing.payload.expiresAt
          : now;
      const expiresAt = addMonthsMs(anchorStart, plan.months);

      const signed = signSubscriptionPayload({
        userId: user.userId,
        email: user.email,
        planId: finalPlanId,
        status: 'active',
        startedAt: now,
        expiresAt,
        isExemptAnnual: false,
        autoRenewFree: false,
        provider: 'mercadopago',
        providerSubscriptionId: confirmedProviderId,
        externalReference: confirmedRef,
        updatedAt: now,
      });

      sendJson(res, 200, {
        ok: true,
        paid: true,
        mpStatus,
        subscription: signed,
      });
      return true;
    } catch (err) {
      sendJson(res, 502, {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Error de red al verificar la suscripción en Mercado Pago.',
      });
      return true;
    }
  }

  if (apiPath === '/api/subscriptions/verify-platform-token') {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      sendJson(res, 401, {
        ok: false,
        configured: false,
        valid: false,
        error: 'Sesión inválida o expirada.',
      });
      return true;
    }

    const isPlatformAdmin = EXEMPT_ANNUAL_EMAILS.has(user.email.toLowerCase());
    if (!isPlatformAdmin) {
      sendJson(res, 403, {
        ok: false,
        configured: false,
        valid: false,
        error: 'Solo la cuenta administradora de la plataforma puede verificar el token central.',
      });
      return true;
    }
    const platformToken = resolvePlatformMpToken();
    if (!platformToken) {
      sendJson(res, 200, {
        ok: false,
        configured: false,
        valid: false,
        error:
          'No se encontró PLATFORM_MERCADOPAGO_ACCESS_TOKEN configurado en las variables de entorno del servidor.',
      });
      return true;
    }

    try {
      const meRes = await mpFetch('/users/me', platformToken);
      if (!meRes.ok) {
        sendJson(res, 200, {
          ok: false,
          configured: true,
          valid: false,
          error: extractMpErrorMessage(
            meRes.data,
            'Mercado Pago rechazó las credenciales de PLATFORM_MERCADOPAGO_ACCESS_TOKEN.'
          ),
        });
        return true;
      }

      const preSearchRes = await mpFetch('/preapproval/search?limit=1', platformToken);
      const mode: 'production' | 'test' = platformToken.startsWith('TEST-')
        ? 'test'
        : 'production';

      sendJson(res, 200, {
        ok: true,
        configured: true,
        valid: true,
        mode,
        subscriptionsReady: preSearchRes.ok,
        ...(isPlatformAdmin
          ? {
              account: {
                sellerId: String(meRes.data.id || ''),
                nickname: String(meRes.data.nickname || ''),
                email: String(meRes.data.email || ''),
                siteId: String(meRes.data.site_id || ''),
              },
            }
          : {}),
      });
      return true;
    } catch (err) {
      sendJson(res, 502, {
        ok: false,
        configured: true,
        valid: false,
        error:
          err instanceof Error
            ? err.message
            : 'Error de red al probar PLATFORM_MERCADOPAGO_ACCESS_TOKEN contra Mercado Pago.',
      });
      return true;
    }
  }

  if (apiPath === '/api/subscriptions/test-checkout') {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      sendJson(res, 401, { ok: false, error: 'Sesión inválida o expirada.' });
      return true;
    }

    if (!EXEMPT_ANNUAL_EMAILS.has(user.email.toLowerCase())) {
      sendJson(res, 403, {
        ok: false,
        error: 'Solo la cuenta administradora de la plataforma puede generar links de prueba.',
      });
      return true;
    }

    const platformToken = resolvePlatformMpToken();
    if (!platformToken) {
      sendJson(res, 503, {
        ok: false,
        error:
          'No se encontró PLATFORM_MERCADOPAGO_ACCESS_TOKEN configurado en las variables de entorno del servidor.',
      });
      return true;
    }

    const rawBackUrl = String(body.backUrl || '').trim();
    const safeBackUrl =
      rawBackUrl.startsWith('https://') || rawBackUrl.startsWith('http://')
        ? rawBackUrl
        : `${resolveRequestOrigin(req)}/?mp_test=return`;

    try {
      const prefRes = await mpFetch('/checkout/preferences', platformToken, {
        method: 'POST',
        body: {
          external_reference: `TH3TEST|${user.userId}|${Date.now()}`,
          items: [
            {
              id: 'th3bnb-test-payment',
              title: 'Prueba de cobro TH3 BNB Suscripciones',
              description: 'Verificación de integración Checkout Mercado Pago',
              quantity: 1,
              currency_id: 'ARS',
              unit_price: 100,
            },
          ],
          back_urls: {
            success: safeBackUrl,
            pending: safeBackUrl,
            failure: safeBackUrl,
          },
          ...(safeBackUrl.startsWith('https://') ? { auto_return: 'approved' } : {}),
        },
      });

      const checkoutUrl = String(
        prefRes.data.init_point || prefRes.data.sandbox_init_point || ''
      ).trim();

      if (!prefRes.ok || !checkoutUrl) {
        sendJson(res, prefRes.status >= 400 ? prefRes.status : 400, {
          ok: false,
          error: extractMpErrorMessage(
            prefRes.data,
            'Mercado Pago no permitió generar el link de pago de prueba.'
          ),
        });
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        checkoutUrl,
        preferenceId: String(prefRes.data.id || ''),
        mode: platformToken.startsWith('TEST-') ? 'test' : 'production',
        amount: 100,
      });
      return true;
    } catch (err) {
      sendJson(res, 502, {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Error de red al crear la prueba de pago en Mercado Pago.',
      });
      return true;
    }
  }

  if (apiPath === '/api/subscriptions/diagnose-platform-token') {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      sendJson(res, 401, {
        ok: false,
        error: 'Sesión inválida o expirada.',
        timestamp: new Date().toISOString(),
        runtime: 'restricted',
        vercelEnv: null,
        envStatus: 'missing',
        detectedKey: null,
        tokenLength: 0,
        prefixType: 'none',
        hadQuotesOrWhitespace: false,
        checks: [
          {
            id: 'auth_session',
            label: 'Autenticación de sesión',
            status: 'fail',
            httpStatus: 401,
            detail: 'El token de sesión JWT no fue enviado o expiró. Recargá la app o cerrá e iniciá sesión.',
          },
        ],
        hints: ['Recargá la página o cerrá sesión y volvé a ingresar para renovar tu JWT.'],
      });
      return true;
    }

    if (!EXEMPT_ANNUAL_EMAILS.has(user.email.toLowerCase())) {
      sendJson(res, 403, {
        ok: false,
        error: 'Solo la cuenta administradora de la plataforma puede ejecutar el diagnóstico.',
        timestamp: new Date().toISOString(),
        runtime: 'restricted',
        vercelEnv: null,
        envStatus: 'missing',
        detectedKey: null,
        tokenLength: 0,
        prefixType: 'none',
        hadQuotesOrWhitespace: false,
        checks: [],
        hints: [],
      });
      return true;
    }

    const timestamp = new Date().toISOString();
    const runtime = process.env.VERCEL ? 'vercel' : 'node';
    const vercelEnv = process.env.VERCEL_ENV || null;

    let detectedKey: string | null = null;
    let rawEnvValue: string | undefined = undefined;
    const misnamedKeys: string[] = [];

    for (const [k, v] of Object.entries(process.env)) {
      const trimmedKey = k.trim();
      const upperKey = trimmedKey.toUpperCase();
      if (trimmedKey === 'PLATFORM_MERCADOPAGO_ACCESS_TOKEN') {
        detectedKey = k;
        rawEnvValue = v;
      } else if (
        upperKey === 'PLATFORM_MERCADOPAGO_ACCESS_TOKEN' ||
        upperKey === 'PLATFORM_MERCADO_PAGO_ACCESS_TOKEN'
      ) {
        if (!detectedKey) {
          detectedKey = k;
          rawEnvValue = v;
        }
        misnamedKeys.push(k);
      } else if (
        upperKey === 'VITE_PLATFORM_MERCADOPAGO_ACCESS_TOKEN' ||
        upperKey === 'MERCADOPAGO_PLATFORM_ACCESS_TOKEN'
      ) {
        if (v && v.trim()) misnamedKeys.push(k);
      }
    }

    const resolvedToken = resolvePlatformMpToken();
    const hadQuotesOrWhitespace =
      typeof rawEnvValue === 'string' && rawEnvValue !== resolvedToken && rawEnvValue.length > 0;
    const isEmptyString = detectedKey !== null && resolvedToken.length === 0;
    const envStatus: 'loaded' | 'empty_string' | 'missing' = resolvedToken
      ? 'loaded'
      : isEmptyString
        ? 'empty_string'
        : 'missing';

    const prefixType: 'APP_USR' | 'TEST' | 'unknown' | 'none' = !resolvedToken
      ? 'none'
      : resolvedToken.startsWith('APP_USR-')
        ? 'APP_USR'
        : resolvedToken.startsWith('TEST-')
          ? 'TEST'
          : 'unknown';

    const checks: Array<{
      id: string;
      label: string;
      status: 'pass' | 'warn' | 'fail';
      httpStatus?: number;
      detail: string;
    }> = [];
    const hints: string[] = [];

    if (envStatus === 'missing') {
      checks.push({
        id: 'env_presence',
        label: 'Variable de entorno en servidor',
        status: 'fail',
        detail:
          'No existe PLATFORM_MERCADOPAGO_ACCESS_TOKEN en process.env de este servidor.',
      });
      if (misnamedKeys.length > 0) {
        hints.push(
          `Se detectaron variables con nombre similar (${misnamedKeys.join(', ')}). Renombrala exactamente a PLATFORM_MERCADOPAGO_ACCESS_TOKEN.`
        );
      } else {
        hints.push(
          'Cargá PLATFORM_MERCADOPAGO_ACCESS_TOKEN en Settings → Environment Variables (tildando Production) y luego hacé Redeploy.'
        );
      }
      sendJson(res, 200, {
        ok: false,
        timestamp,
        runtime,
        vercelEnv,
        envStatus,
        detectedKey,
        tokenLength: 0,
        prefixType,
        hadQuotesOrWhitespace,
        checks,
        hints,
      });
      return true;
    }

    if (envStatus === 'empty_string') {
      checks.push({
        id: 'env_presence',
        label: 'Variable de entorno en servidor',
        status: 'fail',
        detail: `La variable ${detectedKey || 'PLATFORM_MERCADOPAGO_ACCESS_TOKEN'} está definida pero contiene una cadena vacía o solo espacios.`,
      });
      hints.push(
        'Pegá el Access Token real en el campo Value de PLATFORM_MERCADOPAGO_ACCESS_TOKEN (actualmente está vacío) y hacé Redeploy.'
      );
      sendJson(res, 200, {
        ok: false,
        timestamp,
        runtime,
        vercelEnv,
        envStatus,
        detectedKey,
        tokenLength: 0,
        prefixType,
        hadQuotesOrWhitespace,
        checks,
        hints,
      });
      return true;
    }

    checks.push({
      id: 'env_presence',
      label: 'Variable de entorno en servidor',
      status: detectedKey === 'PLATFORM_MERCADOPAGO_ACCESS_TOKEN' ? 'pass' : 'warn',
      detail:
        detectedKey === 'PLATFORM_MERCADOPAGO_ACCESS_TOKEN'
          ? `Cargada correctamente (${resolvedToken.length} caracteres).`
          : `Cargada con nombre aproximado "${detectedKey}" (${resolvedToken.length} caracteres). Conviene usar el nombre exacto PLATFORM_MERCADOPAGO_ACCESS_TOKEN.`,
    });

    if (prefixType === 'unknown' || hadQuotesOrWhitespace) {
      checks.push({
        id: 'token_format',
        label: 'Formato del Access Token',
        status: prefixType === 'unknown' ? 'fail' : 'warn',
        detail:
          prefixType === 'unknown'
            ? 'El token no comienza con APP_USR- ni TEST-. Puede que hayas copiado el Public Key o Client Secret en lugar del Access Token.'
            : 'El valor tenía espacios o comillas alrededor que fueron limpiados automáticamente.',
      });
      if (prefixType === 'unknown') {
        hints.push(
          'Asegurate de copiar el "Access Token" (no la Public Key ni el Client Secret) desde Mercado Pago Developers → Credenciales.'
        );
      }
    } else {
      checks.push({
        id: 'token_format',
        label: 'Formato del Access Token',
        status: 'pass',
        detail: `Prefijo válido (${prefixType}- · ${prefixType === 'TEST' ? 'Prueba' : 'Producción'}).`,
      });
    }

    try {
      const meRes = await mpFetch('/users/me', resolvedToken);
      if (!meRes.ok) {
        checks.push({
          id: 'users_me_auth',
          label: 'Autenticación básica (/users/me)',
          status: 'fail',
          httpStatus: meRes.status,
          detail: extractMpErrorMessage(
            meRes.data,
            `Mercado Pago rechazó el token con HTTP ${meRes.status}.`
          ),
        });
        hints.push(
          'El Access Token es inválido, fue revocado o está mal copiado. Generá o copiá nuevamente las credenciales en Mercado Pago Developers.'
        );
        sendJson(res, 200, {
          ok: false,
          timestamp,
          runtime,
          vercelEnv,
          envStatus,
          detectedKey,
          tokenLength: resolvedToken.length,
          prefixType,
          hadQuotesOrWhitespace,
          checks,
          hints,
        });
        return true;
      }

      checks.push({
        id: 'users_me_auth',
        label: 'Autenticación básica (/users/me)',
        status: 'pass',
        httpStatus: meRes.status,
        detail: `Token autenticado correctamente en Mercado Pago (${String(meRes.data.site_id || 'MP')}).`,
      });

      const [preRes, payRes] = await Promise.all([
        mpFetch('/preapproval/search?limit=1', resolvedToken),
        mpFetch('/v1/payments/search?limit=1', resolvedToken),
      ]);

      if (preRes.ok) {
        checks.push({
          id: 'preapproval_scope',
          label: 'Permisos de Suscripciones (/preapproval)',
          status: 'pass',
          httpStatus: preRes.status,
          detail: 'La aplicación tiene permisos habilitados para crear y consultar suscripciones.',
        });
      } else {
        const isPermError = preRes.status === 401 || preRes.status === 403;
        checks.push({
          id: 'preapproval_scope',
          label: 'Permisos de Suscripciones (/preapproval)',
          status: isPermError ? 'fail' : 'warn',
          httpStatus: preRes.status,
          detail: extractMpErrorMessage(
            preRes.data,
            isPermError
              ? `Faltan permisos/scopes de Suscripciones (HTTP ${preRes.status}).`
              : `Respuesta inesperada al consultar Suscripciones (HTTP ${preRes.status}).`
          ),
        });
        if (isPermError) {
          hints.push(
            'Tu aplicación en Mercado Pago Developers no tiene permisos de Suscripciones (Preapproval) o usaste una credencial restringida. Verificá los scopes/productos habilitados en tu app de Mercado Pago.'
          );
        }
      }

      if (payRes.ok) {
        checks.push({
          id: 'payments_scope',
          label: 'Permisos de Pagos (/v1/payments)',
          status: 'pass',
          httpStatus: payRes.status,
          detail: 'Lectura y verificación de pagos habilitada correctamente.',
        });
      } else {
        const isPermError = payRes.status === 401 || payRes.status === 403;
        checks.push({
          id: 'payments_scope',
          label: 'Permisos de Pagos (/v1/payments)',
          status: isPermError ? 'fail' : 'warn',
          httpStatus: payRes.status,
          detail: extractMpErrorMessage(
            payRes.data,
            `Error al consultar pagos (HTTP ${payRes.status}).`
          ),
        });
        if (isPermError) {
          hints.push(
            'El token no tiene permisos de lectura de pagos (payments). Verificá que la app de Mercado Pago sea de tipo "Pagos online".'
          );
        }
      }

      const allPassed = checks.every((c) => c.status !== 'fail');
      sendJson(res, 200, {
        ok: allPassed,
        timestamp,
        runtime,
        vercelEnv,
        envStatus,
        detectedKey,
        tokenLength: resolvedToken.length,
        prefixType,
        hadQuotesOrWhitespace,
        checks,
        hints,
      });
      return true;
    } catch (err) {
      checks.push({
        id: 'network',
        label: 'Conexión saliente a api.mercadopago.com',
        status: 'fail',
        detail:
          err instanceof Error
            ? err.message
            : 'No se pudo establecer conexión con api.mercadopago.com.',
      });
      sendJson(res, 502, {
        ok: false,
        timestamp,
        runtime,
        vercelEnv,
        envStatus,
        detectedKey,
        tokenLength: resolvedToken.length,
        prefixType,
        hadQuotesOrWhitespace,
        checks,
        hints,
      });
      return true;
    }
  }

  sendJson(res, 404, { ok: false, error: 'Ruta de API no encontrada.' });
  return true;
}

export default async function handler(
  req: ApiIncomingRequest,
  res: ServerResponse
): Promise<void> {
  try {
    const handled = await handleApiRequest(req, res);
    if (!handled) {
      sendJson(res, 404, { ok: false, error: 'Ruta de API no encontrada.' });
    }
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Error interno del servidor.',
    });
  }
}
