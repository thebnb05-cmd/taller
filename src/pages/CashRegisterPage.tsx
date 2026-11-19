import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Calculator,
  CheckCircle2,
  CreditCard,
  Landmark,
  Lock,
  Plus,
  Unlock,
} from 'lucide-react';
import { ModalShell } from '../components/ModalShell';
import { useToast } from '../components/ToastProvider';
import { generateDocId, stripUndefined, upsertRow } from '../lib/db';
import type {
  PurchaseRecord,
  RepairRecord,
  SaleRecord,
  TaskRecord,
  WorkshopProfile,
} from '../types/workshop';
import {
  computeShiftFinancials,
  isCashShiftTask,
  parseCashShiftFromTask,
  serializeCashShiftToTask,
  type CashMovement,
  type CashMovementType,
  type CashShiftData,
} from '../utils/cashRegister';
import { formatCompactCurrency, formatCurrency, formatDateShort, todayISO } from '../utils/formatters';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../utils/payment';
import {
  parseSafePositiveNumber,
  sanitizeDbErrorMessage,
  sanitizePlainLine,
  sanitizeText,
} from '../utils/validation';
import { parseWorkshopMeta } from '../utils/workshopMeta';

interface CashRegisterPageProps {
  ownerId: string;
  tasks: TaskRecord[];
  sales: SaleRecord[];
  repairs: RepairRecord[];
  purchases: PurchaseRecord[];
  profile?: WorkshopProfile | null;
}

export const CashRegisterPage: React.FC<CashRegisterPageProps> = ({
  ownerId,
  tasks,
  sales,
  repairs,
  profile,
}) => {
  const { notify } = useToast();
  const baseCurrency = useMemo(() => parseWorkshopMeta(profile).currency, [profile]);

  const shifts = useMemo(() => {
    return tasks
      .filter((t) => isCashShiftTask(t))
      .map((t) => parseCashShiftFromTask(t))
      .filter((s): s is CashShiftData => s !== null)
      .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  }, [tasks]);

  const activeShift = useMemo(
    () => shifts.find((s) => s.status === 'abierta') || null,
    [shifts]
  );

  const closedShifts = useMemo(
    () => shifts.filter((s) => s.status === 'cerrada'),
    [shifts]
  );

  // If no shift is open, compute "Hoy" preview from midnight so counter always has live numbers
  const windowBounds = useMemo(() => {
    if (activeShift) {
      const startMs = Date.parse(activeShift.openedAt) || Date.now();
      return {
        startMs,
        openingCash: activeShift.openingCash,
        movements: activeShift.movements,
      };
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return {
      startMs: todayStart.getTime(),
      openingCash: 0,
      movements: [] as CashMovement[],
    };
  }, [activeShift]);

  const financials = useMemo(
    () =>
      computeShiftFinancials({
        startMs: windowBounds.startMs,
        endMs: Date.now(),
        openingCash: windowBounds.openingCash,
        movements: windowBounds.movements,
        sales,
        repairs,
      }),
    [windowBounds, sales, repairs]
  );

  const manualCashStats = useMemo(() => {
    let cashIn = 0;
    let cashOut = 0;
    for (const m of windowBounds.movements) {
      if (m.method !== 'efectivo') continue;
      if (m.type === 'ingreso') cashIn += m.amount;
      else cashOut += m.amount;
    }
    const cashCollections = Math.max(
      0,
      Math.round((financials.totalsByMethod.efectivo - cashIn) * 100) / 100
    );
    return {
      cashIn: Math.round(cashIn * 100) / 100,
      cashOut: Math.round(cashOut * 100) / 100,
      cashCollections,
    };
  }, [windowBounds.movements, financials.totalsByMethod.efectivo]);

  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openingCashInput, setOpeningCashInput] = useState('0');
  const [openedByInput, setOpenedByInput] = useState('');

  const [showMovementModal, setShowMovementModal] = useState(false);
  const [movementType, setMovementType] = useState<CashMovementType>('egreso');
  const [movementMethod, setMovementMethod] = useState<PaymentMethod>('efectivo');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementConcept, setMovementConcept] = useState('');

  const [showCloseModal, setShowCloseModal] = useState(false);
  const [countedCashInput, setCountedCashInput] = useState('');
  const [closingNoteInput, setClosingNoteInput] = useState('');

  const [saving, setSaving] = useState(false);

  const totalCollectedAllMethods =
    financials.totalsByMethod.efectivo +
    financials.totalsByMethod.transferencia +
    financials.totalsByMethod.tarjeta;

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activeShift) {
      notify('Ya tenés una caja abierta en curso.', 'error');
      return;
    }
    const openingCash = parseSafePositiveNumber(openingCashInput, 0);
    const shift: CashShiftData = {
      id: generateDocId('cash'),
      shiftDate: todayISO(),
      openedAt: new Date().toISOString(),
      openedBy: sanitizePlainLine(openedByInput || profile?.firstName || '', 80),
      openingCash: Math.round(openingCash * 100) / 100,
      movements: [],
      status: 'abierta',
    };
    setSaving(true);
    try {
      const payload = serializeCashShiftToTask({ ownerId, shift });
      await upsertRow('tasks', stripUndefined({ ...payload, createdAt: new Date().toISOString() }));
      setShowOpenModal(false);
      setOpeningCashInput('0');
      setOpenedByInput('');
      notify('Caja abierta. Ya podés registrar movimientos y realizar el arqueo.');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo abrir la caja.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift) {
      notify('Abrí la caja primero para registrar ingresos o retiros manuales.', 'error');
      return;
    }
    const cleanAmt = parseSafePositiveNumber(movementAmount, 0);
    const cleanConcept = sanitizePlainLine(movementConcept, 140);
    if (cleanAmt <= 0) {
      notify('Ingresá un monto mayor a 0.', 'error');
      return;
    }
    if (!cleanConcept) {
      notify('Ingresá un concepto o motivo del movimiento.', 'error');
      return;
    }

    const mv: CashMovement = {
      id: `mv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: movementType,
      amount: Math.round(cleanAmt * 100) / 100,
      method: movementMethod,
      concept: cleanConcept,
      at: new Date().toISOString(),
    };

    const nextShift: CashShiftData = {
      ...activeShift,
      movements: [...activeShift.movements, mv],
    };

    setSaving(true);
    try {
      const payload = serializeCashShiftToTask({ ownerId, shift: nextShift });
      await upsertRow('tasks', stripUndefined(payload));
      setShowMovementModal(false);
      setMovementAmount('');
      setMovementConcept('');
      notify(
        movementType === 'ingreso'
          ? 'Ingreso registrado en caja.'
          : 'Retiro / egreso registrado en caja.'
      );
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo guardar el movimiento.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openCloseShiftModal = () => {
    setCountedCashInput(String(financials.expectedCashInDrawer));
    setClosingNoteInput('');
    setShowCloseModal(true);
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift) return;

    const countedCash = Math.max(0, parseSafePositiveNumber(countedCashInput, 0));
    const expectedCash = financials.expectedCashInDrawer;
    const discrepancy = Math.round((countedCash - expectedCash) * 100) / 100;

    const closedShift: CashShiftData = {
      ...activeShift,
      closedAt: new Date().toISOString(),
      countedCash: Math.round(countedCash * 100) / 100,
      expectedCash,
      discrepancy,
      closingNote: sanitizeText(closingNoteInput, 300),
      status: 'cerrada',
    };

    setSaving(true);
    try {
      const payload = serializeCashShiftToTask({ ownerId, shift: closedShift });
      await upsertRow('tasks', stripUndefined(payload));
      setShowCloseModal(false);
      notify('Arqueo guardado y caja cerrada correctamente.');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo cerrar la caja.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  };

  const previewDiscrepancy =
    Math.round((parseSafePositiveNumber(countedCashInput, 0) - financials.expectedCashInDrawer) * 100) /
    100;

  return (
    <div className="space-y-5">
      {/* Header & Shift Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Caja diaria y arqueo
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {activeShift
              ? `Turno abierto · ${formatDateShort(activeShift.shiftDate)} desde las ${formatTime(activeShift.openedAt)}${activeShift.openedBy ? ` · ${activeShift.openedBy}` : ''}`
              : 'Mostrando movimientos de hoy · Abrí la caja para controlar efectivo y cierre'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeShift ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setMovementType('ingreso');
                  setMovementMethod('efectivo');
                  setShowMovementModal(true);
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:border-emerald-500 hover:text-emerald-700 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <Plus className="h-4 w-4 text-emerald-600" />
                Ingreso
              </button>
              <button
                type="button"
                onClick={() => {
                  setMovementType('egreso');
                  setMovementMethod('efectivo');
                  setShowMovementModal(true);
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:border-rose-500 hover:text-rose-700 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <ArrowUpRight className="h-4 w-4 text-rose-600" />
                Retiro / Gasto
              </button>
              <button
                type="button"
                onClick={openCloseShiftModal}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-[#0072BB] dark:hover:bg-[#005f9c]"
              >
                <Lock className="h-4 w-4" />
                Cerrar y arquear caja
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setOpeningCashInput('0');
                setOpenedByInput(profile?.firstName || '');
                setShowOpenModal(true);
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] whitespace-nowrap shrink-0"
            >
              <Unlock className="h-4 w-4" />
              Abrir caja del turno
            </button>
          )}
        </div>
      </div>

      {/* Primary KPI Grid: Drawer Cash + Methods */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>Efectivo esperado en caja</span>
            <Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-1.5 font-mono-num text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(financials.expectedCashInDrawer, baseCurrency)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {activeShift
              ? `Inicial ${formatCompactCurrency(activeShift.openingCash)} · Cobros ${formatCompactCurrency(financials.totalsByMethod.efectivo)}`
              : 'Abrí turno para sumar saldo inicial'}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>Transferencias / QR</span>
            <Landmark className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
          </div>
          <div className="mt-1.5 font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white">
            {formatCurrency(financials.totalsByMethod.transferencia, baseCurrency)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Acreditado en banco / billetera
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>Tarjetas / Point</span>
            <CreditCard className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="mt-1.5 font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white">
            {formatCurrency(financials.totalsByMethod.tarjeta, baseCurrency)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Débito, crédito y posnet
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>Total ingresos del período</span>
            <Calculator className="h-4 w-4 text-slate-500" />
          </div>
          <div className="mt-1.5 font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white">
            {formatCurrency(totalCollectedAllMethods, baseCurrency)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Ventas {formatCompactCurrency(financials.salesTotal)} · Taller{' '}
            {formatCompactCurrency(financials.repairsTotal)}
          </div>
        </div>
      </div>

      {/* Main Split: Chronological Ledger + Recent Closures */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Movimientos {activeShift ? 'del turno actual' : 'de hoy'}
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {financials.entries.length}{' '}
                  {financials.entries.length === 1 ? 'movimiento' : 'movimientos'} registrados
                </p>
              </div>
              {financials.manualOutTotal > 0 && (
                <span className="font-mono-num text-xs font-semibold text-rose-600 dark:text-rose-400">
                  Egresos: -{formatCurrency(financials.manualOutTotal, baseCurrency)}
                </span>
              )}
            </div>

            {financials.entries.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Todavía no hay cobros ni movimientos registrados en este período.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {financials.entries.map((entry) => {
                  const isOut = entry.direction === 'out';
                  const sourceLabel =
                    entry.source === 'venta'
                      ? 'Venta'
                      : entry.source === 'reparacion'
                        ? 'Taller'
                        : 'Caja manual';
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                            isOut
                              ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
                              : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                          }`}
                        >
                          {isOut ? (
                            <ArrowUpRight className="h-4 w-4" />
                          ) : (
                            <ArrowDownLeft className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-slate-900 dark:text-white">
                            {entry.title}
                          </div>
                          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {formatTime(entry.at)} · {sourceLabel} · {PAYMENT_METHOD_LABELS[entry.method]}
                            {entry.subtitle ? ` · ${entry.subtitle}` : ''}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`shrink-0 font-mono-num text-sm font-bold ${
                          isOut
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {isOut ? '-' : '+'}
                        {formatCurrency(entry.amount, baseCurrency)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* History of closed shifts */}
        <div>
          <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Historial de cierres
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Últimos arqueos guardados
              </p>
            </div>
            {closedShifts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Aún no registraste cierres de caja.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {closedShifts.slice(0, 10).map((shift) => {
                  const diff = Number(shift.discrepancy || 0);
                  const balanced = Math.abs(diff) < 0.01;
                  return (
                    <div key={shift.id} className="space-y-1 px-4 py-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {formatDateShort(shift.shiftDate)}
                        </span>
                        <span
                          className={`font-mono-num font-bold ${
                            balanced
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : diff > 0
                                ? 'text-sky-600 dark:text-sky-400'
                                : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {balanced
                            ? 'Cuadrada'
                            : diff > 0
                              ? `Sobrante +${formatCurrency(diff, baseCurrency)}`
                              : `Faltante ${formatCurrency(diff, baseCurrency)}`}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>
                          {formatTime(shift.openedAt)} – {shift.closedAt ? formatTime(shift.closedAt) : ''}
                          {shift.openedBy ? ` · ${shift.openedBy}` : ''}
                        </span>
                        <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-200">
                          Contado: {formatCurrency(shift.countedCash ?? 0, baseCurrency)}
                        </span>
                      </div>
                      {shift.closingNote && (
                        <p className="text-[11px] italic text-slate-500 dark:text-slate-400">
                          {shift.closingNote}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal: Abrir caja */}
      <ModalShell open={showOpenModal} onClose={() => setShowOpenModal(false)} title="Abrir caja del turno" maxWidth="md">
        <form onSubmit={handleOpenShift} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Efectivo inicial en caja ({baseCurrency})
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={openingCashInput}
              onChange={(e) => setOpeningCashInput(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Contá el cambio inicial que dejás en el cajón antes de empezar a cobrar.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Responsable del turno (opcional)
            </label>
            <input
              type="text"
              value={openedByInput}
              onChange={(e) => setOpenedByInput(e.target.value)}
              placeholder="Ej: Lucas / Turno mañana"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setShowOpenModal(false)}
              className="h-10 flex-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-10 flex-1 rounded-xl bg-[#0072BB] text-xs font-semibold text-white hover:bg-[#005f9c]"
            >
              {saving ? 'Abriendo...' : 'Abrir caja'}
            </button>
          </div>
        </form>
      </ModalShell>

      {/* Modal: Movimiento manual */}
      <ModalShell
        open={showMovementModal}
        onClose={() => setShowMovementModal(false)}
        title={movementType === 'ingreso' ? 'Registrar ingreso en caja' : 'Registrar retiro / egreso'}
        maxWidth="md"
      >
        <form onSubmit={handleAddMovement} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMovementType('ingreso')}
              className={`h-9 rounded-xl border text-xs font-semibold ${
                movementType === 'ingreso'
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              Ingreso manual
            </button>
            <button
              type="button"
              onClick={() => setMovementType('egreso')}
              className={`h-9 rounded-xl border text-xs font-semibold ${
                movementType === 'egreso'
                  ? 'border-rose-600 bg-rose-600 text-white'
                  : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              Retiro / Gasto menor
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Monto ({baseCurrency}) *
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={movementAmount}
                onChange={(e) => setMovementAmount(e.target.value)}
                placeholder="5000"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Medio
              </label>
              <select
                value={movementMethod}
                onChange={(e) => setMovementMethod(e.target.value as PaymentMethod)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Concepto *
            </label>
            <input
              type="text"
              required
              value={movementConcept}
              onChange={(e) => setMovementConcept(e.target.value)}
              placeholder={
                movementType === 'egreso'
                  ? 'Ej: Envío moto, artículos limpieza, retiro de socio'
                  : 'Ej: Refuerzo de cambio o cobro externo'
              }
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setShowMovementModal(false)}
              className="h-10 flex-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-10 flex-1 rounded-xl bg-[#0072BB] text-xs font-semibold text-white hover:bg-[#005f9c]"
            >
              {saving ? 'Guardando...' : 'Guardar movimiento'}
            </button>
          </div>
        </form>
      </ModalShell>

      {/* Modal: Cerrar y arquear caja */}
      <ModalShell
        open={showCloseModal}
        onClose={() => setShowCloseModal(false)}
        title="Cierre y arqueo de caja"
        maxWidth="md"
      >
        <form onSubmit={handleCloseShift} className="space-y-4">
          <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex justify-between text-slate-600 dark:text-slate-300">
              <span>Efectivo inicial</span>
              <span className="font-mono-num font-semibold">
                {formatCurrency(activeShift?.openingCash ?? 0, baseCurrency)}
              </span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-300">
              <span>Cobros en efectivo (ventas y reparaciones)</span>
              <span className="font-mono-num font-semibold text-emerald-600 dark:text-emerald-400">
                +{formatCurrency(manualCashStats.cashCollections, baseCurrency)}
              </span>
            </div>
            {manualCashStats.cashIn > 0 && (
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Ingresos manuales en efectivo</span>
                <span className="font-mono-num font-semibold text-emerald-600 dark:text-emerald-400">
                  +{formatCurrency(manualCashStats.cashIn, baseCurrency)}
                </span>
              </div>
            )}
            {manualCashStats.cashOut > 0 && (
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Retiros / egresos en efectivo</span>
                <span className="font-mono-num font-semibold text-rose-600 dark:text-rose-400">
                  -{formatCurrency(manualCashStats.cashOut, baseCurrency)}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-900 dark:border-slate-700 dark:text-white">
              <span>Efectivo esperado en cajón</span>
              <span className="font-mono-num">
                {formatCurrency(financials.expectedCashInDrawer, baseCurrency)}
              </span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Efectivo real contado ({baseCurrency}) *
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={countedCashInput}
              onChange={(e) => setCountedCashInput(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <div className="mt-1.5 flex items-center justify-between text-xs">
              <span className="text-slate-500">Diferencia de arqueo:</span>
              <span
                className={`inline-flex items-center gap-1 font-mono-num font-bold ${
                  Math.abs(previewDiscrepancy) < 0.01
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : previewDiscrepancy > 0
                      ? 'text-sky-600 dark:text-sky-400'
                      : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {Math.abs(previewDiscrepancy) < 0.01 ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Sin diferencia (cuadrada)
                  </>
                ) : previewDiscrepancy > 0 ? (
                  `+${formatCurrency(previewDiscrepancy, baseCurrency)} sobrante`
                ) : (
                  `${formatCurrency(previewDiscrepancy, baseCurrency)} faltante`
                )}
              </span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Observaciones del cierre (opcional)
            </label>
            <textarea
              rows={2}
              value={closingNoteInput}
              onChange={(e) => setClosingNoteInput(e.target.value)}
              placeholder="Ej: Dejado $10.000 de cambio para mañana"
              className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setShowCloseModal(false)}
              className="h-10 flex-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-10 flex-1 rounded-xl bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-[#0072BB] dark:hover:bg-[#005f9c]"
            >
              {saving ? 'Cerrando...' : 'Confirmar cierre'}
            </button>
          </div>
        </form>
      </ModalShell>
    </div>
  );
};
