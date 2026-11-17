import React, { useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Crown,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  createSubscriptionCheckout,
  formatArs,
  getPlanDisplayName,
  getSubscriptionRemaining,
  SUBSCRIPTION_PLANS,
  verifySubscriptionPayment,
  type SignedSubscriptionRecord,
  type SubscriptionPlanId,
} from '../utils/subscription';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';

export const PENDING_SUB_STORAGE_KEY = 'th3bnb_pending_mp_subscription';

export interface PendingCheckoutState {
  planId: SubscriptionPlanId;
  providerId: string;
  kind: 'preapproval' | 'preference';
  externalReference: string;
  checkoutUrl: string;
}

interface SubscriptionModalProps {
  open: boolean;
  blocking?: boolean;
  onClose: () => void;
  subscriptionRecord: SignedSubscriptionRecord | null;
  mpConfigured: boolean;
  nowMs: number;
  onSubscriptionUpdated: (next: SignedSubscriptionRecord) => void;
  onSignOut?: () => void;
}

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  open,
  blocking = false,
  onClose,
  subscriptionRecord,
  mpConfigured,
  nowMs,
  onSubscriptionUpdated,
  onSignOut,
}) => {
  const { notify } = useToast();
  const [loadingPlan, setLoadingPlan] = useState<SubscriptionPlanId | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckoutState | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  const payload = subscriptionRecord?.payload ?? null;
  const remaining = getSubscriptionRemaining(payload, nowMs);
  const isExempt = Boolean(payload?.isExemptAnnual);
  const planName = payload ? getPlanDisplayName(payload.planId, payload.isExemptAnnual) : 'Suscripción';

  useEffect(() => {
    if (!open) {
      setCheckoutError('');
      setLoadingPlan(null);
      return;
    }
    try {
      const savedRaw = window.sessionStorage.getItem(PENDING_SUB_STORAGE_KEY);
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw) as PendingCheckoutState;
        if (parsed && parsed.externalReference) {
          setPendingCheckout(parsed);
        }
      }
    } catch {
      // Ignore storage read errors
    }
  }, [open]);

  // Automatic check every 4s while user completes checkout in Mercado Pago tab
  useEffect(() => {
    if (!open || !pendingCheckout || isExempt) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await verifySubscriptionPayment({
          planId: pendingCheckout.planId,
          providerId: pendingCheckout.providerId,
          kind: pendingCheckout.kind,
          externalReference: pendingCheckout.externalReference,
          subscriptionToken: subscriptionRecord,
        });
        if (cancelled) return;
        if (res.ok && res.paid && res.subscription) {
          try {
            window.sessionStorage.removeItem(PENDING_SUB_STORAGE_KEY);
          } catch {
            // Ignore
          }
          setPendingCheckout(null);
          onSubscriptionUpdated(res.subscription);
          notify('Suscripción activada con Mercado Pago.');
        }
      } catch {
        // Silent retry on next tick
      }
    };

    const timer = window.setInterval(() => {
      void tick();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, pendingCheckout, isExempt, subscriptionRecord, onSubscriptionUpdated, notify]);

  const handleStartCheckout = async (planId: SubscriptionPlanId) => {
    if (isExempt) return;
    setLoadingPlan(planId);
    setCheckoutError('');

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('mp_sub', 'return');
      const res = await createSubscriptionCheckout({
        planId,
        backUrl: url.toString(),
      });

      if (!res.ok || !res.checkoutUrl) {
        const msg = res.error || 'No se pudo iniciar la suscripción en Mercado Pago.';
        setCheckoutError(msg);
        notify(msg, 'error');
        return;
      }

      const nextPending: PendingCheckoutState = {
        planId,
        providerId: res.providerId || '',
        kind: res.kind || 'preapproval',
        externalReference: res.externalReference || '',
        checkoutUrl: res.checkoutUrl,
      };
      setPendingCheckout(nextPending);
      try {
        window.sessionStorage.setItem(PENDING_SUB_STORAGE_KEY, JSON.stringify(nextPending));
      } catch {
        // Ignore storage errors
      }
    } catch {
      setCheckoutError('Error de red al conectar con Mercado Pago.');
      notify('Error al iniciar suscripción.', 'error');
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleVerifyNow = async () => {
    if (!pendingCheckout) return;
    setVerifying(true);
    setCheckoutError('');
    try {
      const res = await verifySubscriptionPayment({
        planId: pendingCheckout.planId,
        providerId: pendingCheckout.providerId,
        kind: pendingCheckout.kind,
        externalReference: pendingCheckout.externalReference,
        subscriptionToken: subscriptionRecord,
      });

      if (!res.ok) {
        const msg = res.error || 'No se pudo consultar el estado en Mercado Pago.';
        setCheckoutError(msg);
        notify(msg, 'error');
        return;
      }

      if (res.paid && res.subscription) {
        try {
          window.sessionStorage.removeItem(PENDING_SUB_STORAGE_KEY);
        } catch {
          // Ignore
        }
        setPendingCheckout(null);
        onSubscriptionUpdated(res.subscription);
        notify('Pago verificado. Suscripción activada correctamente.');
        if (!blocking) {
          onClose();
        }
      } else {
        notify('Todavía figura pendiente en Mercado Pago. Completá el pago e intentá nuevamente.', 'info');
      }
    } catch {
      setCheckoutError('Error de red al verificar la suscripción.');
    } finally {
      setVerifying(false);
    }
  };

  const expiryFormatted = payload?.expiresAt
    ? new Date(payload.expiresAt).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—';

  return (
    <ModalShell
      open={open}
      onClose={blocking ? () => {} : onClose}
      title="Suscripción y Planes"
      subtitle={
        blocking
          ? 'Tu período de prueba o suscripción finalizó. Elegí un plan para seguir operando.'
          : 'Administrá el estado de tu taller y elegí el plan que mejor se adapte.'
      }
      maxWidth="2xl"
    >
      <div className="space-y-5">
        {/* Current subscription status & remaining time */}
        <div
          className={`rounded-2xl border p-4 ${
            isExempt
              ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30'
              : remaining.isExpired
                ? 'border-red-200 bg-red-50/80 dark:border-red-900/60 dark:bg-red-950/30'
                : remaining.days <= 5
                  ? 'border-amber-200 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/30'
                  : 'border-sky-200 bg-sky-50/60 dark:border-sky-900/60 dark:bg-sky-950/30'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  isExempt
                    ? 'bg-emerald-600 text-white'
                    : remaining.isExpired
                      ? 'bg-red-600 text-white'
                      : 'bg-[#0072BB] text-white'
                }`}
              >
                {isExempt ? (
                  <Crown className="h-5 w-5" />
                ) : (
                  <CalendarClock className="h-5 w-5" />
                )}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-white font-display">
                    {planName}
                  </span>
                  <span
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-bold ${
                      isExempt || !remaining.isExpired
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-200'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/70 dark:text-red-200'
                    }`}
                  >
                    {remaining.isExpired ? 'Vencida' : 'Activa'}
                  </span>
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {remaining.detailLabel}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {isExempt
                    ? `Renovación anual automática sin costo ($0) el ${expiryFormatted}`
                    : remaining.isExpired
                      ? `Venció el ${expiryFormatted}`
                      : `Vigente hasta el ${expiryFormatted}`}
                </div>
              </div>
            </div>

            <div className="text-right font-mono-num">
              <div className="text-lg font-extrabold text-slate-900 dark:text-white">
                {remaining.isExpired ? '0 días' : `${remaining.days}d ${remaining.hours}h`}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Tiempo restante
              </div>
            </div>
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/80 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all ${
                isExempt
                  ? 'bg-emerald-500'
                  : remaining.isExpired
                    ? 'bg-red-500'
                    : remaining.days <= 5
                      ? 'bg-amber-500'
                      : 'bg-[#0072BB]'
              }`}
              style={{ width: `${remaining.progressPercent}%` }}
            />
          </div>

          {isExempt && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200/80 bg-white/75 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800/60 dark:bg-slate-900/60 dark:text-emerald-200">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                Tu cuenta (<strong>{payload?.email}</strong>) tiene{' '}
                <strong>renovación anual automática sin costo</strong>. Al cumplirse el año se
                renueva sola sin generar cobros.
              </span>
            </div>
          )}
        </div>

        {/* Active checkout waiting box */}
        {pendingCheckout && !isExempt && (
          <div className="space-y-3 rounded-2xl border border-sky-300 bg-sky-50/70 p-4 dark:border-sky-800 dark:bg-sky-950/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                <Loader2 className="h-4 w-4 animate-spin text-[#0072BB] dark:text-sky-400" />
                <span>Suscripción en curso con Mercado Pago</span>
              </div>
              <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                {pendingCheckout.externalReference}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Completá el pago en la ventana segura de Mercado Pago. Apenas se apruebe, tu plan se
              activa automáticamente.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={pendingCheckout.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white transition hover:bg-[#005f9c]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Ir a pagar en Mercado Pago
              </a>
              <button
                type="button"
                disabled={verifying}
                onClick={() => void handleVerifyNow()}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${verifying ? 'animate-spin' : ''}`} />
                Ya pagué · Verificar ahora
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingCheckout(null);
                  try {
                    window.sessionStorage.removeItem(PENDING_SUB_STORAGE_KEY);
                  } catch {
                    // Ignore
                  }
                }}
                className="inline-flex h-10 items-center rounded-xl px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                Cancelar intento
              </button>
            </div>
          </div>
        )}

        {checkoutError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {checkoutError}
          </div>
        )}

        {!mpConfigured && !isExempt && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            El administrador de la plataforma aún debe cargar el Access Token central de Mercado
            Pago (<span className="font-mono-num font-semibold">PLATFORM_MERCADOPAGO_ACCESS_TOKEN</span>)
            para procesar nuevos pagos de suscripción.
          </div>
        )}

        {/* 3 Plan Cards */}
        <div className="grid gap-3.5 sm:grid-cols-3">
          {SUBSCRIPTION_PLANS.map((plan) => {
            const isCurrentPaid =
              !isExempt &&
              !remaining.isExpired &&
              payload?.planId === plan.id &&
              payload?.provider === 'mercadopago';
            const isRecommended = plan.id === 'semestral';

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col justify-between rounded-2xl border p-4 transition ${
                  isRecommended
                    ? 'border-[#0072BB] bg-sky-50/40 shadow-sm dark:border-sky-500 dark:bg-sky-950/20'
                    : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-white font-display">
                      {plan.name}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-2 py-0.5 font-mono-num text-[10px] font-extrabold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                      <Sparkles className="h-2.5 w-2.5" />
                      {plan.discountPercent}% OFF
                    </span>
                  </div>

                  {plan.badge && (
                    <div className="mt-1 text-[11px] font-semibold text-[#0072BB] dark:text-sky-400">
                      {plan.badge}
                    </div>
                  )}

                  <div className="mt-3">
                    <div className="font-mono-num text-xs text-slate-400 line-through">
                      {formatArs(plan.originalPrice)}
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white">
                        {formatArs(plan.discountedPrice)}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        / {plan.durationLabel}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono-num text-[11px] text-emerald-700 dark:text-emerald-400">
                      Equivale a {formatArs(plan.monthlyEquivalent)} por mes
                    </div>
                  </div>

                  <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {plan.description}
                  </p>
                </div>

                <div className="mt-4 pt-2">
                  {isExempt ? (
                    <div className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Incluido sin costo
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={loadingPlan !== null}
                      onClick={() => void handleStartCheckout(plan.id)}
                      className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition disabled:opacity-60 ${
                        isRecommended
                          ? 'bg-[#0072BB] text-white hover:bg-[#005f9c]'
                          : 'border border-[#0072BB] text-[#0072BB] hover:bg-sky-50 dark:border-sky-500 dark:text-sky-300 dark:hover:bg-sky-950/40'
                      }`}
                    >
                      {loadingPlan === plan.id ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Conectando...
                        </>
                      ) : isCurrentPaid ? (
                        'Extender con Mercado Pago'
                      ) : (
                        'Suscribirme con Mercado Pago'
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          {blocking && onSignOut ? (
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              Cerrar sesión
            </button>
          ) : (
            <span className="text-[11px] text-slate-400">
              Cobro procesado mediante Suscripciones de Mercado Pago.
            </span>
          )}

          {!blocking && (
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
};
