import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { ArrowLeft, CheckCircle2, Clock, Phone, Search, Smartphone, Wrench } from 'lucide-react';
import { db, handleFirestoreError, OperationType, toMillis } from '../lib/db';
import { formatCurrency, formatDateShort, getStatusMeta } from '../utils/formatters';
import type { PublicTicketRecord } from '../types/workshop';

interface PublicTrackingViewProps {
  initialCode: string;
  onExitTracking?: () => void;
}

const ORDERED_STEPS = [
  { key: 'recibido', label: 'Recibido' },
  { key: 'diagnostico', label: 'Diagnóstico' },
  { key: 'espera_repuesto', label: 'Repuesto' },
  { key: 'en_progreso', label: 'En taller' },
  { key: 'listo', label: 'Listo' },
  { key: 'entregado', label: 'Entregado' },
];

const VALID_TRACKING_CODE_RE = /^[a-zA-Z0-9_-]{1,40}$/;

export const PublicTrackingView: React.FC<PublicTrackingViewProps> = ({
  initialCode,
  onExitTracking,
}) => {
  const [searchInput, setSearchInput] = useState(initialCode);
  const [activeCode, setActiveCode] = useState(initialCode.trim().toUpperCase());
  const [ticket, setTicket] = useState<PublicTicketRecord | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!activeCode) {
      setTicket(undefined);
      setIsLoading(false);
      setErrorMsg('');
      return;
    }

    if (!VALID_TRACKING_CODE_RE.test(activeCode)) {
      setTicket(undefined);
      setIsLoading(false);
      setErrorMsg('');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    const path = `publicTickets/${activeCode}`;
    const unsubscribe = onSnapshot(
      doc(db, 'publicTickets', activeCode),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setTicket({
            ...(data as Omit<PublicTicketRecord, 'id' | 'updatedAt'>),
            id: snap.id,
            updatedAt: toMillis(data.updatedAt),
          });
        } else {
          setTicket(undefined);
        }
        setIsLoading(false);
      },
      (err) => {
        setIsLoading(false);
        setErrorMsg(err.message || 'No se pudo consultar el seguimiento.');
        try {
          handleFirestoreError(err, OperationType.GET, path);
        } catch {
          // Error already logged in structured JSON format
        }
      }
    );

    return () => unsubscribe();
  }, [activeCode]);

  const statusMeta = ticket ? getStatusMeta(ticket.status) : null;
  const activeStepIndex = ticket
    ? Math.max(
        0,
        ORDERED_STEPS.findIndex((s) => s.key === ticket.status)
      )
    : 0;

  const pendingBalance = ticket
    ? Math.max(0, Number(ticket.price || 0) - Number(ticket.deposit || 0))
    : 0;

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = searchInput.trim().toUpperCase();
    if (!cleaned) return;
    setActiveCode(cleaned);
    const url = new URL(window.location.href);
    url.searchParams.set('track', cleaned);
    window.history.replaceState({}, '', url.toString());
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-slate-950">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0072BB] text-white">
              <Smartphone className="h-4 w-4" />
            </span>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display">
                {ticket?.businessName || 'TH3 BNB Servicio Técnico'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Seguimiento en vivo de tu equipo
              </p>
            </div>
          </div>

          {onExitTracking && (
            <button
              type="button"
              onClick={onExitTracking}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver al taller
            </button>
          )}
        </div>

        <form
          onSubmit={handleLookup}
          className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xs dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Ingresá tu código de seguimiento (ej. TK-8A2F9C)"
              className="h-10 w-full rounded-xl bg-transparent pl-9 pr-3 font-mono-num text-sm uppercase text-slate-900 outline-none dark:text-white"
            />
          </div>
          <button
            type="submit"
            className="h-10 shrink-0 rounded-xl bg-[#0072BB] px-4 text-sm font-semibold text-white transition hover:bg-[#005f9c]"
          >
            Consultar
          </button>
        </form>

        {!activeCode ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
            <Wrench className="mx-auto h-8 w-8 text-slate-400" />
            <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">
              Consultá el estado de tu reparación
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Escribí el código impreso en tu boleta para ver el progreso en tiempo real.
            </p>
          </div>
        ) : isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm text-slate-500 dark:text-slate-400">Buscando orden {activeCode}...</p>
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
            Error al consultar el seguimiento: {errorMsg}
          </div>
        ) : !ticket ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
            <p className="text-base font-semibold text-slate-900 dark:text-white">
              No encontramos una orden con el código {activeCode}
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Verificá el código en tu comprobante o comunicate con el taller.
            </p>
          </div>
        ) : (
          <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                    {ticket.repairCode}
                  </span>
                  <span>·</span>
                  <span className="font-mono-num">{ticket.trackingCode}</span>
                </div>
                <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white font-display">
                  {ticket.brand} {ticket.model}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{ticket.deviceType}</p>
              </div>
              {statusMeta && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${statusMeta.badgeClass}`}
                >
                  {ticket.status === 'listo' || ticket.status === 'entregado' ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Clock className="h-3.5 w-3.5" />
                  )}
                  {statusMeta.label}
                </span>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Progreso de reparación</span>
                <span className="font-mono-num font-bold">{ticket.progress}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    statusMeta?.barClass || 'bg-[#0072BB]'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, ticket.progress))}%` }}
                />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {ORDERED_STEPS.map((st, idx) => {
                  const done = idx <= activeStepIndex;
                  return (
                    <div
                      key={st.key}
                      className={`rounded-xl border px-2 py-2 text-center text-[11px] font-medium ${
                        done
                          ? 'border-[#0072BB]/30 bg-sky-50 text-[#0072BB] dark:border-sky-500/30 dark:bg-sky-950/50 dark:text-sky-300'
                          : 'border-slate-100 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-500'
                      }`}
                    >
                      {st.label}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 dark:border-slate-800">
              <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/50">
                <div className="text-xs text-slate-500 dark:text-slate-400">Falla reportada</div>
                <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
                  {ticket.problemSummary || 'Revisión técnica general'}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/50">
                <div className="text-xs text-slate-500 dark:text-slate-400">Fechas</div>
                <div className="mt-1 space-y-0.5 text-sm text-slate-900 dark:text-white">
                  <div>Ingreso: {formatDateShort(ticket.dateIn)}</div>
                  <div>Entrega estimada: {formatDateShort(ticket.dateEst)}</div>
                </div>
              </div>
            </div>

            {ticket.workDetail && (
              <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Detalle del trabajo realizado
                </div>
                <p className="mt-1 text-sm text-slate-800 dark:text-slate-200">{ticket.workDetail}</p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-center dark:border-slate-800">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Presupuesto</div>
                <div className="mt-0.5 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {formatCurrency(ticket.price)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Seña / Anticipo</div>
                <div className="mt-0.5 font-mono-num text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(ticket.deposit)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Saldo pendiente</div>
                <div className="mt-0.5 font-mono-num text-sm font-bold text-[#0072BB] dark:text-sky-400">
                  {formatCurrency(pendingBalance)}
                </div>
              </div>
            </div>

            {ticket.businessPhone && (
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
                <span>¿Tenés dudas sobre tu equipo?</span>
                <a
                  href={`tel:${ticket.businessPhone}`}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {ticket.businessPhone}
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
