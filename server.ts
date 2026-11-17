import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type Request, type Response } from 'express';

const PORT = Number(process.env.PORT || 3000);
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
  if (!candidate.payload || typeof candidate.payload !== 'object' || typeof candidate.sig !== 'string') {
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
  req: Request
): Promise<{ userId: string; email: string; createdAt: number } | null> {
  const authHeader = req.headers.authorization || '';
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
  return (process.env.PLATFORM_MERCADOPAGO_ACCESS_TOKEN || '').trim();
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
      const refreshed: ServerSubscriptionPayload = {
        ...verifiedExisting.payload,
        email: user.email,
        status: 'active',
        updatedAt: now,
      };
      return signSubscriptionPayload(refreshed);
    }

    // First time or expired: automatically activate / renew 1 full year without cost
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

  // Initial 15-day trial anchored to account creation (or platform subscription launch)
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

interface MpErrorPayload {
  message?: string;
  error?: string;
  errors?: Array<{ message?: string; description?: string; code?: string }>;
  causes?: Array<{ description?: string; code?: string }>;
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/mercadopago/test', async (req: Request, res: Response) => {
    const token = resolveAccessToken(req.body?.accessToken);
    if (!token) {
      res.status(400).json({
        ok: false,
        error: 'Ingresá un Access Token de Mercado Pago para probar la conexión.',
      });
      return;
    }

    try {
      const meRes = await mpFetch('/users/me', token);
      if (!meRes.ok) {
        res.status(meRes.status >= 400 ? meRes.status : 401).json({
          ok: false,
          error: extractMpErrorMessage(
            meRes.data,
            'Access Token inválido o sin permisos en Mercado Pago.'
          ),
        });
        return;
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

      res.json({
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
    } catch (err) {
      res.status(502).json({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'No se pudo conectar con los servidores de Mercado Pago.',
      });
    }
  });

  app.post('/api/mercadopago/orders', async (req: Request, res: Response) => {
    const token = resolveAccessToken(req.body?.accessToken);
    const mode = req.body?.mode === 'point' ? 'point' : req.body?.mode === 'qr' ? 'qr' : null;
    const rawAmount = Number(req.body?.amount);
    const description =
      String(req.body?.description || 'Venta de taller').trim().slice(0, 120) || 'Venta de taller';
    const externalReference =
      String(req.body?.externalReference || `SALE-${Date.now()}`).trim().slice(0, 64) ||
      `SALE-${Date.now()}`;
    const posExternalId = resolvePosId(req.body?.posExternalId);
    const terminalId = resolveTerminalId(req.body?.terminalId);
    const printOnTerminal = Boolean(req.body?.printOnTerminal);

    if (!token) {
      res.status(400).json({
        ok: false,
        error: 'Falta configurar el Access Token de Mercado Pago.',
      });
      return;
    }
    if (!mode) {
      res.status(400).json({ ok: false, error: 'Modo de cobro inválido.' });
      return;
    }
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      res.status(400).json({ ok: false, error: 'El monto debe ser mayor a 0.' });
      return;
    }

    const formattedAmount = rawAmount.toFixed(2);
    const idempotencyKey = crypto.randomUUID();

    try {
      if (mode === 'qr') {
        if (!posExternalId) {
          res.status(400).json({
            ok: false,
            error: 'Falta configurar el ID de punto de venta / Caja para generar el QR.',
          });
          return;
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
          res.json({
            ok: true,
            mode: 'qr',
            apiFamily: 'orders_v1',
            orderId: String(orderRes.data.id || ''),
            externalReference,
            qrData,
            ...normalized,
          });
          return;
        }

        // Fallback to legacy Instore QR dynamic endpoint if needed by account config
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
            res.json({
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
            return;
          }

          res.status(legacyQrRes.status >= 400 ? legacyQrRes.status : 400).json({
            ok: false,
            error: extractMpErrorMessage(
              legacyQrRes.data,
              extractMpErrorMessage(orderRes.data, 'No se pudo generar el QR dinámico en Mercado Pago.')
            ),
          });
          return;
        }

        res.status(orderRes.status >= 400 ? orderRes.status : 400).json({
          ok: false,
          error: extractMpErrorMessage(
            orderRes.data,
            'No se pudo generar el QR dinámico en Mercado Pago.'
          ),
        });
        return;
      }

      // mode === 'point'
      if (!terminalId) {
        res.status(400).json({
          ok: false,
          error: 'Falta configurar el ID del dispositivo físico Point.',
        });
        return;
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
        res.json({
          ok: true,
          mode: 'point',
          apiFamily: 'orders_v1',
          orderId: String(pointOrderRes.data.id || ''),
          externalReference,
          ...normalized,
        });
        return;
      }

      // Legacy fallback for Point devices configured on Payment Intents API
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
        res.json({
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
        return;
      }

      res.status(pointOrderRes.status >= 400 ? pointOrderRes.status : 400).json({
        ok: false,
        error: extractMpErrorMessage(
          pointOrderRes.data,
          extractMpErrorMessage(
            legacyIntentRes.data,
            'No se pudo enviar la orden al dispositivo Point.'
          )
        ),
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Error de red al comunicarse con Mercado Pago.',
      });
    }
  });

  app.post('/api/mercadopago/orders/status', async (req: Request, res: Response) => {
    const token = resolveAccessToken(req.body?.accessToken);
    const orderId = String(req.body?.orderId || '').trim();
    const apiFamily = String(req.body?.apiFamily || 'orders_v1');
    const externalReference = String(req.body?.externalReference || '').trim();

    if (!token || (!orderId && !externalReference)) {
      res.status(400).json({ ok: false, error: 'Datos insuficientes para consultar la orden.' });
      return;
    }

    try {
      if (apiFamily === 'legacy_intent') {
        const intentRes = await mpFetch(
          `/point/integration-api/payment-intents/${encodeURIComponent(orderId)}`,
          token
        );
        if (!intentRes.ok) {
          res.status(intentRes.status).json({
            ok: false,
            error: extractMpErrorMessage(intentRes.data, 'No se pudo consultar el estado del Point.'),
          });
          return;
        }
        const normalized = normalizeOrderStatus(
          intentRes.data.state || intentRes.data.status,
          intentRes.data.status_detail
        );
        res.json({ ok: true, id: orderId, ...normalized });
        return;
      }

      if (apiFamily === 'legacy_qr' && externalReference) {
        const merchantRes = await mpFetch(
          `/merchant_orders?external_reference=${encodeURIComponent(externalReference)}`,
          token
        );
        if (!merchantRes.ok) {
          res.status(merchantRes.status).json({
            ok: false,
            error: extractMpErrorMessage(merchantRes.data, 'No se pudo consultar el estado del QR.'),
          });
          return;
        }
        const elements = Array.isArray(merchantRes.data.elements) ? merchantRes.data.elements : [];
        const latest = (elements[0] as Record<string, unknown> | undefined) || {};
        const orderStatus = String(latest.order_status || latest.status || 'opened');
        const isPaid = orderStatus === 'paid';
        const isCanceled = orderStatus === 'expired' || orderStatus === 'canceled';
        res.json({
          ok: true,
          id: String(latest.id || orderId),
          status: orderStatus,
          statusDetail: orderStatus,
          isPaid,
          isCanceled,
          isFailed: false,
        });
        return;
      }

      const orderRes = await mpFetch(`/v1/orders/${encodeURIComponent(orderId)}`, token);
      if (!orderRes.ok) {
        res.status(orderRes.status).json({
          ok: false,
          error: extractMpErrorMessage(orderRes.data, 'No se pudo consultar la orden en Mercado Pago.'),
        });
        return;
      }

      const normalized = normalizeOrderStatus(orderRes.data.status, orderRes.data.status_detail);
      res.json({
        ok: true,
        id: String(orderRes.data.id || orderId),
        ...normalized,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Error de red al verificar estado en Mercado Pago.',
      });
    }
  });

  app.post('/api/mercadopago/orders/cancel', async (req: Request, res: Response) => {
    const token = resolveAccessToken(req.body?.accessToken);
    const orderId = String(req.body?.orderId || '').trim();
    const apiFamily = String(req.body?.apiFamily || 'orders_v1');
    const terminalId = resolveTerminalId(req.body?.terminalId);
    const posExternalId = resolvePosId(req.body?.posExternalId);

    if (!token || !orderId) {
      res.status(400).json({ ok: false, error: 'Faltan datos para cancelar la orden.' });
      return;
    }

    try {
      if (apiFamily === 'legacy_intent' && terminalId) {
        const cancelRes = await mpFetch(
          `/point/integration-api/devices/${encodeURIComponent(terminalId)}/payment-intents/${encodeURIComponent(orderId)}`,
          token,
          { method: 'DELETE' }
        );
        if (!cancelRes.ok) {
          res.status(cancelRes.status).json({
            ok: false,
            error: extractMpErrorMessage(cancelRes.data, 'No se pudo cancelar la intención en el Point.'),
          });
          return;
        }
        res.json({ ok: true });
        return;
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
        res.json({ ok: true });
        return;
      }

      const cancelRes = await mpFetch(`/v1/orders/${encodeURIComponent(orderId)}/cancel`, token, {
        method: 'POST',
        idempotencyKey: crypto.randomUUID(),
      });
      if (!cancelRes.ok) {
        res.status(cancelRes.status).json({
          ok: false,
          error: extractMpErrorMessage(cancelRes.data, 'No se pudo cancelar la orden en Mercado Pago.'),
        });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Error de red al cancelar la orden en Mercado Pago.',
      });
    }
  });

  app.post('/api/subscriptions/status', async (req: Request, res: Response) => {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Sesión inválida o expirada.' });
      return;
    }
    const subscription = resolveUserSubscriptionState(user, req.body?.subscriptionToken);
    res.json({
      ok: true,
      subscription,
      mpConfigured: Boolean(resolvePlatformMpToken()),
    });
  });

  app.post('/api/subscriptions/checkout', async (req: Request, res: Response) => {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Sesión inválida o expirada.' });
      return;
    }

    if (EXEMPT_ANNUAL_EMAILS.has(user.email.toLowerCase())) {
      const subscription = resolveUserSubscriptionState(user, null);
      res.json({
        ok: true,
        exemptRenewed: true,
        subscription,
      });
      return;
    }

    const planId = String(req.body?.planId || '') as ServerSubscriptionPlanId;
    const plan = SERVER_PLANS[planId];
    if (!plan) {
      res.status(400).json({ ok: false, error: 'Plan de suscripción inválido.' });
      return;
    }

    const platformToken = resolvePlatformMpToken();
    if (!platformToken) {
      res.status(503).json({
        ok: false,
        error:
          'El administrador de la plataforma aún no configuró el Access Token central de suscripciones en Mercado Pago (PLATFORM_MERCADOPAGO_ACCESS_TOKEN).',
      });
      return;
    }

    const rawBackUrl = String(req.body?.backUrl || '').trim();
    const safeBackUrl =
      rawBackUrl.startsWith('https://') || rawBackUrl.startsWith('http://')
        ? rawBackUrl
        : `${process.env.APP_URL || 'http://localhost:3000'}/?mp_sub=return`;
    const externalReference = `TH3SUB|${user.userId}|${planId}|${Date.now()}`;

    try {
      // 1) Primary flow: Mercado Pago Subscriptions (Preapproval)
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
        res.json({
          ok: true,
          checkoutUrl: preapprovalUrl,
          providerId: String(preapprovalRes.data.id || ''),
          kind: 'preapproval',
          externalReference,
          planId,
        });
        return;
      }

      // 2) Fallback: Mercado Pago Checkout Pro preference for test/non-https environments
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
        res.status(prefRes.status >= 400 ? prefRes.status : 400).json({
          ok: false,
          error: extractMpErrorMessage(
            preapprovalRes.data || prefRes.data,
            'Mercado Pago no permitió generar el link de suscripción.'
          ),
        });
        return;
      }

      res.json({
        ok: true,
        checkoutUrl: prefUrl,
        providerId: String(prefRes.data.id || ''),
        kind: 'preference',
        externalReference,
        planId,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Error de red al crear la suscripción en Mercado Pago.',
      });
    }
  });

  app.post('/api/subscriptions/verify', async (req: Request, res: Response) => {
    const user = await verifySupabaseSessionUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Sesión inválida o expirada.' });
      return;
    }

    if (EXEMPT_ANNUAL_EMAILS.has(user.email.toLowerCase())) {
      const subscription = resolveUserSubscriptionState(user, req.body?.subscriptionToken);
      res.json({ ok: true, paid: true, subscription });
      return;
    }

    const platformToken = resolvePlatformMpToken();
    if (!platformToken) {
      res.status(503).json({
        ok: false,
        error: 'Falta configurar PLATFORM_MERCADOPAGO_ACCESS_TOKEN en el servidor.',
      });
      return;
    }

    const requestedPlanId = String(req.body?.planId || '') as ServerSubscriptionPlanId;
    const providerId = String(req.body?.providerId || '').trim();
    const kind = String(req.body?.kind || '').trim();
    const externalReference = String(req.body?.externalReference || '').trim();

    if (!providerId && !externalReference) {
      res.status(400).json({ ok: false, error: 'Faltan referencias para verificar el pago.' });
      return;
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
        res.json({ ok: true, paid: false, mpStatus });
        return;
      }

      const finalPlanId: ServerSubscriptionPlanId = confirmedPlanId || 'mensual';
      const plan = SERVER_PLANS[finalPlanId];
      const now = Date.now();
      const existing = verifySignedSubscription(req.body?.subscriptionToken, user.userId);
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

      res.json({
        ok: true,
        paid: true,
        mpStatus,
        subscription: signed,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Error de red al verificar la suscripción en Mercado Pago.',
      });
    }
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: false,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
