import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Calculator,
  CheckCircle2,
  CreditCard,
  Landmark,
  Lock,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Unlock,
  X,
} from 'lucide-react';
import { ModalShell } from '../components/ModalShell';
import { useToast } from '../components/ToastProvider';
import { generateDocId, stripUndefined, upsertRow } from '../lib/db';
import type {
  ProductRecord,
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
import {
  checkMercadoPagoOrderStatus,
  fetchRecentMercadoPagoPayments,
  hydrateMercadoPagoConfig,
  loadMercadoPagoConfig,
  resolvePointDisplayName,
} from '../utils/mercadoPago';
import {
  syncAllElectronicPaymentsToPurchases,
  syncRecoveredEntryToPurchase,
} from '../utils/mpPurchasesSync';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../utils/payment';
import {
  dismissRecoveredPayment,
  forceReconcilePaymentAttempt,
  getPendingFailedAttempts,
  getUnreconciledPayments,
  mergeSyncedMpPayments,
  recordRecoveredPayment,
  retrySaveRecoveredSale,
  useRecoveredPayments,
  type RecoveredPaymentEntry,
} from '../utils/paymentLedger';
import {
  parseSafePositiveNumber,
  sanitizeDbErrorMessage,
  sanitizePlainLine,
  sanitizeText,
} from '../utils/validation';
import { parseWorkshopMeta } from '../utils/workshopMeta';
import { useI18n } from '../utils/i18n';

interface CashRegisterPageProps {
  ownerId: string;
  tasks: TaskRecord[];
  sales: SaleRecord[];
  repairs: RepairRecord[];
  purchases: PurchaseRecord[];
  products?: ProductRecord[];
  profile?: WorkshopProfile | null;
}

export const CashRegisterPage: React.FC<CashRegisterPageProps> = ({
  ownerId,
  tasks,
  sales,
  repairs,
  purchases,
  products = [],
  profile,
}) => {
  const { notify } = useToast();
  const { locale, tr } = useI18n();
  const baseCurrency = useMemo(() => parseWorkshopMeta(profile).currency, [profile]);

  const recoveredEntries = useRecoveredPayments(ownerId);
  const unreconciledRecovered = useMemo(
    () => getUnreconciledPayments(recoveredEntries, sales, repairs),
    [recoveredEntries, sales, repairs]
  );
  const allPendingFailedAttempts = useMemo(
    () => getPendingFailedAttempts(recoveredEntries, sales, repairs),
    [recoveredEntries, sales, repairs]
  );

  const [mpAccessToken, setMpAccessToken] = useState<string>(() => {
    const local = loadMercadoPagoConfig(ownerId);
    return local.accessToken || parseWorkshopMeta(profile).mercadoPago?.accessToken || '';
  });
  const [syncingMp, setSyncingMp] = useState(false);
  const [lastMpSyncAt, setLastMpSyncAt] = useState<string | null>(null);
  const [verifyingAttemptId, setVerifyingAttemptId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const syncingMpRef = useRef(false);

  // Forced reconciliation modal state (both for an existing failed attempt or manual entry)
  const [forceModalTarget, setForceModalTarget] = useState<RecoveredPaymentEntry | null>(null);
  const [showForceManualModal, setShowForceManualModal] = useState(false);
  const [forceChannel, setForceChannel] = useState<'efectivo' | 'transferencia' | 'tarjeta' | 'mp_point' | 'mp_qr'>('mp_point');
  const [forceSource, setForceSource] = useState<'venta' | 'reparacion'>('venta');
  const [forceAmountInput, setForceAmountInput] = useState('');
  const [forceClientInput, setForceClientInput] = useState('');
  const [forceTitleInput, setForceTitleInput] = useState('');
  const [forceNoteInput, setForceNoteInput] = useState('');

  useEffect(() => {
    let active = true;
    void hydrateMercadoPagoConfig(ownerId).then((cfg) => {
      if (!active) return;
      const token = cfg.accessToken || parseWorkshopMeta(profile).mercadoPago?.accessToken || '';
      setMpAccessToken(token);
    });
    return () => {
      active = false;
    };
  }, [ownerId, profile]);

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

  const periodFailedAttempts = useMemo(
    () =>
      allPendingFailedAttempts.filter((item) => {
        const atMs = Number.isFinite(item.createdAt) ? item.createdAt : Date.parse(item.at);
        return !Number.isNaN(atMs) && atMs >= windowBounds.startMs - 5 * 60 * 1000;
      }),
    [allPendingFailedAttempts, windowBounds.startMs]
  );

  const verifySingleAttemptWithMp = useCallback(
    async (attempt: RecoveredPaymentEntry, silent = false): Promise<boolean> => {
      const token =
        mpAccessToken ||
        loadMercadoPagoConfig(ownerId).accessToken ||
        parseWorkshopMeta(profile).mercadoPago?.accessToken ||
        '';
      if (!token || (!attempt.mpOrderId && !attempt.mpCompanionOrderId)) {
        if (!silent) {
          notify('Este intento no tiene orden de Mercado Pago vinculada. Podés usar Reconciliación forzada.', 'error');
        }
        return false;
      }

      setVerifyingAttemptId(attempt.id);
      try {
        let paid = false;
        let paidViaCompanion = false;

        if (attempt.mpOrderId) {
          const res = await checkMercadoPagoOrderStatus({
            accessToken: token,
            orderId: attempt.mpOrderId,
            apiFamily: attempt.mpApiFamily,
            externalReference: attempt.mpExternalReference,
          });
          if (res.ok && res.isPaid) {
            paid = true;
          }
        }

        if (!paid && attempt.mpCompanionOrderId) {
          const ptRes = await checkMercadoPagoOrderStatus({
            accessToken: token,
            orderId: attempt.mpCompanionOrderId,
            apiFamily: 'orders_v1',
            externalReference: attempt.mpExternalReference,
          });
          if (ptRes.ok && ptRes.isPaid) {
            paid = true;
            paidViaCompanion = true;
          }
        }

        if (paid) {
          recordRecoveredPayment({
            ...attempt,
            attemptStatus: 'approved',
            mpChannel: paidViaCompanion ? 'mp_point' : attempt.mpChannel,
            rawError: undefined,
            dismissed: false,
            subtitle: paidViaCompanion
              ? 'Verificado y aprobado vía QR en Point Smart'
              : 'Verificado y aprobado en Mercado Pago',
          });
          if (!silent) {
            notify('¡Cobro confirmado en Mercado Pago y consolidado en Caja diaria!');
          }
          return true;
        }

        if (!silent) {
          notify('Mercado Pago aún no registra el cobro aprobado. Si el cliente tiene el comprobante, usá Reconciliación forzada.');
        }
        return false;
      } catch {
        if (!silent) {
          notify('No se pudo verificar el intento con Mercado Pago.', 'error');
        }
        return false;
      } finally {
        setVerifyingAttemptId(null);
      }
    },
    [mpAccessToken, notify, ownerId, profile]
  );

  const handleSyncMercadoPago = useCallback(
    async (silent = false) => {
      if (syncingMpRef.current) return;
      const token =
        mpAccessToken ||
        loadMercadoPagoConfig(ownerId).accessToken ||
        parseWorkshopMeta(profile).mercadoPago?.accessToken ||
        '';
      if (!token) {
        if (!silent) {
          notify('Configurá tu Access Token de Mercado Pago en Configuración para sincronizar.', 'error');
        }
        return;
      }
      syncingMpRef.current = true;
      setSyncingMp(true);
      try {
        const sinceDate = new Date(windowBounds.startMs);
        sinceDate.setMinutes(sinceDate.getMinutes() - 5);
        const res = await fetchRecentMercadoPagoPayments({
          accessToken: token,
          sinceIso: sinceDate.toISOString(),
        });
        if (!res.ok) {
          if (!silent) {
            notify(res.error || 'No se pudieron consultar los cobros de Mercado Pago.', 'error');
          }
          return;
        }
        const list = res.payments || [];
        const updatedLedger = mergeSyncedMpPayments(ownerId, list);
        void syncAllElectronicPaymentsToPurchases({
          ownerId,
          sales,
          repairs,
          purchases,
          recoveredEntries: updatedLedger,
          mpPayments: list,
          mpConfig: loadMercadoPagoConfig(ownerId),
        });

        // Auto-check recent pending/failed attempts with orderId against MP orders API
        let promotedCount = 0;
        for (const attempt of periodFailedAttempts.slice(0, 6)) {
          if (attempt.mpOrderId || attempt.mpCompanionOrderId) {
            const promoted = await verifySingleAttemptWithMp(attempt, true);
            if (promoted) promotedCount += 1;
          }
        }

        setLastMpSyncAt(new Date().toISOString());
        if (!silent || promotedCount > 0) {
          if (promotedCount > 0) {
            notify(`Auto-conciliado(s) ${promotedCount} cobro(s) pendiente(s) confirmado(s) en Mercado Pago.`);
          } else if (!silent) {
            notify(
              list.length > 0
                ? `Consolidados ${list.length} cobro(s) aprobados de Mercado Pago (Point y QR).`
                : 'No se encontraron cobros nuevos en Mercado Pago para este período.'
            );
          }
        }
      } catch {
        if (!silent) {
          notify('Error de conexión al sincronizar con Mercado Pago.', 'error');
        }
      } finally {
        syncingMpRef.current = false;
        setSyncingMp(false);
      }
    },
    [
      mpAccessToken,
      notify,
      ownerId,
      periodFailedAttempts,
      profile,
      purchases,
      repairs,
      sales,
      verifySingleAttemptWithMp,
      windowBounds.startMs,
    ]
  );

  // Automatic initial & periodic MP consolidation while CashRegisterPage is active
  useEffect(() => {
    if (!mpAccessToken) return;
    void handleSyncMercadoPago(true);
    const timer = window.setInterval(() => {
      void handleSyncMercadoPago(true);
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [mpAccessToken, handleSyncMercadoPago]);

  const openForceReconcileForAttempt = (attempt: RecoveredPaymentEntry) => {
    setForceModalTarget(attempt);
    setForceChannel(
      attempt.mpChannel === 'mp_point'
        ? 'mp_point'
        : attempt.mpChannel === 'mp_qr'
          ? 'mp_qr'
          : attempt.method
    );
    setForceNoteInput(
      attempt.rawError
        ? `Confirmado por cliente (${attempt.rawError.slice(0, 60)})`
        : 'Comprobante confirmado por el cliente en mostrador'
    );
    setShowForceManualModal(true);
  };

  const openManualForceReconcile = () => {
    setForceModalTarget(null);
    setForceSource('venta');
    setForceChannel('mp_point');
    setForceAmountInput('');
    setForceClientInput('');
    setForceTitleInput('');
    setForceNoteInput('Cobro confirmado por el cliente tras intento fallido');
    setShowForceManualModal(true);
  };

  const handleConfirmForceReconcile = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedMethod: PaymentMethod =
      forceChannel === 'mp_point' || forceChannel === 'tarjeta'
        ? 'tarjeta'
        : forceChannel === 'mp_qr' || forceChannel === 'transferencia'
          ? 'transferencia'
          : 'efectivo';
    const resolvedMpChannel =
      forceChannel === 'mp_point' || forceChannel === 'mp_qr' ? forceChannel : undefined;
    const cleanNote =
      sanitizePlainLine(forceNoteInput, 180) ||
      'Confirmado por el cliente (reconciliación forzada)';

    if (forceModalTarget) {
      const updated = forceReconcilePaymentAttempt({
        ownerId,
        entryId: forceModalTarget.id,
        clientConfirmedNote: cleanNote,
        methodOverride: resolvedMethod,
        mpChannelOverride: resolvedMpChannel,
      });
      if (updated) {
        const cfg = loadMercadoPagoConfig(ownerId);
        if (updated.method !== 'efectivo' || updated.mpChannel) {
          void syncRecoveredEntryToPurchase(
            ownerId,
            {
              ...updated,
              mpPointName:
                updated.mpPointName ||
                (updated.mpChannel ? resolvePointDisplayName(cfg) : undefined),
            },
            cfg
          );
        }
        if (updated.draftSalePayload) {
          const retry = await retrySaveRecoveredSale(updated, products);
          if (retry.ok) {
            notify('Reconciliación forzada aplicada y venta guardada en la nube.');
          } else {
            notify('Reconciliación forzada aplicada e incluida en el arqueo diario.');
          }
        } else {
          notify('Reconciliación forzada aplicada e incluida en el arqueo diario.');
        }
      }
      setShowForceManualModal(false);
      setForceModalTarget(null);
      return;
    }

    const amt = parseSafePositiveNumber(forceAmountInput, 0);
    if (amt <= 0) {
      notify('Ingresá un monto válido mayor a 0 para conciliar.', 'error');
      return;
    }
    const cfg = loadMercadoPagoConfig(ownerId);
    const created = forceReconcilePaymentAttempt({
      ownerId,
      clientConfirmedNote: cleanNote,
      manualAttempt: {
        source: forceSource,
        method: resolvedMethod,
        mpChannel: resolvedMpChannel,
        amount: amt,
        clientName: sanitizePlainLine(forceClientInput, 120) || 'Mostrador',
        title:
          sanitizePlainLine(forceTitleInput, 120) ||
          (resolvedMpChannel === 'mp_point'
            ? 'Cobro Point fallido confirmado'
            : resolvedMpChannel === 'mp_qr'
              ? 'Cobro QR fallido confirmado'
              : 'Cobro fallido confirmado por cliente'),
        subtitle: cleanNote,
      },
    });
    if (created) {
      if (resolvedMethod !== 'efectivo' || resolvedMpChannel) {
        void syncRecoveredEntryToPurchase(
          ownerId,
          {
            ...created,
            mpPointName: resolvedMpChannel ? resolvePointDisplayName(cfg) : undefined,
          },
          cfg
        );
      }
      notify('Cobro capturado por reconciliación forzada y sumado al arqueo diario.');
      setShowForceManualModal(false);
    }
  };

  const handleRetrySaveRecovered = async (entry: RecoveredPaymentEntry) => {
    setRetryingId(entry.id);
    try {
      const result = await retrySaveRecoveredSale(entry, products);
      if (result.ok) {
        notify('Venta guardada en la nube y conciliada con Caja diaria.');
      } else {
        notify(result.error || 'Todavía no se pudo guardar en la nube. Seguirá resguardado acá.', 'error');
      }
    } finally {
      setRetryingId(null);
    }
  };

  const financials = useMemo(
    () =>
      computeShiftFinancials({
        startMs: windowBounds.startMs,
        endMs: Date.now(),
        openingCash: windowBounds.openingCash,
        movements: windowBounds.movements,
        sales,
        repairs,
        recoveredPayments: unreconciledRecovered,
      }),
    [windowBounds, sales, repairs, unreconciledRecovered]
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
    if (mpAccessToken) {
      void handleSyncMercadoPago(true);
    }
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
      mpPointTotal: financials.mpPointTotal,
      mpQrTotal: financials.mpQrTotal,
      forceReconciledCount: financials.forceReconciledCount,
      forceReconciledTotal: financials.forceReconciledTotal,
      totalPeriodIncome: Math.round(totalCollectedAllMethods * 100) / 100,
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
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
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
            {tr('Caja diaria y arqueo', 'Daily cash register', 'Caixa diário e fechamento')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {activeShift
              ? `${tr('Turno abierto', 'Open shift', 'Turno aberto')} · ${formatDateShort(activeShift.shiftDate)} ${tr('desde las', 'since', 'desde')} ${formatTime(activeShift.openedAt)}${activeShift.openedBy ? ` · ${activeShift.openedBy}` : ''}`
              : tr(
                  'Mostrando movimientos de hoy · Abrí la caja para controlar efectivo y cierre',
                  'Showing today movements · Open register to track cash & closing',
                  'Exibindo movimentações de hoje · Abra o caixa para controlar dinheiro e fechamento'
                )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mpAccessToken && (
            <button
              type="button"
              disabled={syncingMp}
              onClick={() => void handleSyncMercadoPago(false)}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50/70 px-3.5 text-xs font-semibold text-[#0072BB] hover:border-sky-400 hover:bg-sky-100/70 disabled:opacity-60 whitespace-nowrap shrink-0 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingMp ? 'animate-spin' : ''}`} />
              {syncingMp
                ? tr('Sincronizando MP...', 'Syncing MP...', 'Sincronizando MP...')
                : tr('Sincronizar MP', 'Sync MP', 'Sincronizar MP')}
            </button>
          )}
          <button
            type="button"
            onClick={openManualForceReconcile}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50/80 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 whitespace-nowrap shrink-0 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {tr('Reconciliación forzada', 'Force reconcile', 'Reconciliação forçada')}
          </button>
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
                {tr('Ingreso', 'Cash in', 'Entrada')}
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
                {tr('Retiro / Gasto', 'Cash out / Expense', 'Retirada / Despesa')}
              </button>
              <button
                type="button"
                onClick={openCloseShiftModal}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-[#0072BB] dark:hover:bg-[#005f9c]"
              >
                <Lock className="h-4 w-4" />
                {tr('Cerrar y arquear caja', 'Close & reconcile', 'Fechar caixa')}
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
              {tr('Abrir caja del turno', 'Open register shift', 'Abrir caixa do turno')}
            </button>
          )}
        </div>
      </div>

      {/* Primary KPI Grid: Drawer Cash + Methods */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>{tr('Efectivo esperado en caja', 'Expected cash in drawer', 'Dinheiro esperado no caixa')}</span>
            <Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-1.5 font-mono-num text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(financials.expectedCashInDrawer, baseCurrency)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {activeShift
              ? `${tr('Inicial', 'Opening', 'Inicial')} ${formatCompactCurrency(activeShift.openingCash)} · ${tr('Cobros', 'Collections', 'Recebimentos')} ${formatCompactCurrency(financials.totalsByMethod.efectivo)}`
              : tr(
                  'Abrí turno para sumar saldo inicial',
                  'Open shift to add opening balance',
                  'Abra o turno para incluir saldo inicial'
                )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>{tr('Transferencias / QR', 'Bank transfers / QR', 'Transferências / PIX')}</span>
            <Landmark className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
          </div>
          <div className="mt-1.5 font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white">
            {formatCurrency(financials.totalsByMethod.transferencia, baseCurrency)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {financials.mpQrTotal > 0 ? (
              <span className="font-semibold text-[#0072BB] dark:text-sky-400">
                QR Mercado Pago: {formatCompactCurrency(financials.mpQrTotal, baseCurrency)}
              </span>
            ) : (
              tr('Acreditado en banco / billetera', 'Credited to bank / wallet', 'Creditado em banco / carteira')
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>{tr('Tarjetas / Point', 'Cards / POS', 'Cartões / Maquininha')}</span>
            <CreditCard className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="mt-1.5 font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white">
            {formatCurrency(financials.totalsByMethod.tarjeta, baseCurrency)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {financials.mpPointTotal > 0 ? (
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                MP Point: {formatCompactCurrency(financials.mpPointTotal, baseCurrency)}
              </span>
            ) : (
              tr('Débito, crédito y posnet', 'Debit, credit and card terminal', 'Débito, crédito e maquininha')
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>{tr('Total ingresos del período', 'Total period income', 'Total de entradas do período')}</span>
            <Calculator className="h-4 w-4 text-slate-500" />
          </div>
          <div className="mt-1.5 font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white">
            {formatCurrency(totalCollectedAllMethods, baseCurrency)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {tr('Ventas', 'Sales', 'Vendas')} {formatCompactCurrency(financials.salesTotal)} ·{' '}
            {tr('Taller', 'Workshop', 'Oficina')} {formatCompactCurrency(financials.repairsTotal)}
            {financials.recoveredCount > 0 && (
              <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">
                · {financials.recoveredCount} recup.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Consolidated Mercado Pago + Methods Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200/80 bg-sky-50/50 px-4 py-3 text-xs dark:border-sky-900/50 dark:bg-sky-950/20">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0072BB]/10 text-[#0072BB] dark:bg-sky-900/40 dark:text-sky-300">
              <Smartphone className="h-3.5 w-3.5" />
            </span>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Consolidado Mercado Pago (Point + QR)
              </div>
              <div className="font-mono-num text-sm font-extrabold text-slate-900 dark:text-white">
                {formatCurrency(financials.mpTotal, baseCurrency)}
                <span className="ml-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  (Point: {formatCompactCurrency(financials.mpPointTotal, baseCurrency)} · QR:{' '}
                  {formatCompactCurrency(financials.mpQrTotal, baseCurrency)})
                </span>
              </div>
            </div>
          </div>

          <div className="hidden h-7 w-px bg-sky-200 dark:bg-sky-800 sm:block" />

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Otros medios (Efectivo + Banco/Posnet)
            </div>
            <div className="font-mono-num text-sm font-extrabold text-slate-900 dark:text-white">
              {formatCurrency(
                Math.max(0, totalCollectedAllMethods - financials.mpTotal),
                baseCurrency
              )}
              {financials.forceReconciledCount > 0 && (
                <span className="ml-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  · {financials.forceReconciledCount} forc. (
                  {formatCompactCurrency(financials.forceReconciledTotal, baseCurrency)})
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          {mpAccessToken ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-[#0072BB] dark:text-sky-300">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Auto-consolidación MP activa
              {lastMpSyncAt ? ` · ${formatTime(lastMpSyncAt)}` : ''}
            </span>
          ) : (
            <span>Sin token MP · Consolidando cobros locales</span>
          )}
        </div>
      </div>

      {/* Failed / Pending Payment Attempts Queue (Reconciliación forzada) */}
      {periodFailedAttempts.length > 0 && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50/75 p-4 dark:border-rose-900/60 dark:bg-rose-950/25">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-rose-900 dark:text-rose-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>
                {periodFailedAttempts.length}{' '}
                {periodFailedAttempts.length === 1
                  ? 'intento de pago fallido o pendiente de confirmar'
                  : 'intentos de pago fallidos o pendientes de confirmar'}
              </span>
            </div>
            <span className="font-mono-num text-xs font-extrabold text-rose-800 dark:text-rose-300">
              En revisión:{' '}
              {formatCurrency(
                periodFailedAttempts.reduce((s, e) => s + e.amount, 0),
                baseCurrency
              )}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-rose-800/90 dark:text-rose-300/80">
            Estos intentos todavía NO suman a la Caja diaria. Verificalos contra Mercado Pago o usá <strong>Reconciliación forzada</strong> si el cliente confirmó el pago con comprobante.
          </p>
          <div className="mt-3 space-y-2">
            {periodFailedAttempts.slice(0, 8).map((attempt) => (
              <div
                key={attempt.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200/80 bg-white/95 px-3 py-2 text-xs dark:border-rose-900/50 dark:bg-slate-900/90"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold text-slate-900 dark:text-white">
                      {attempt.clientName} · {attempt.title}
                    </span>
                    {attempt.mpChannel === 'mp_point' && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                        <Smartphone className="h-2.5 w-2.5" /> Point MP
                      </span>
                    )}
                    {attempt.mpChannel === 'mp_qr' && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                        <QrCode className="h-2.5 w-2.5" /> QR MP
                      </span>
                    )}
                    <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                      {attempt.attemptStatus === 'pending_verification' ? 'Pendiente MP' : 'Intento fallido'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {formatTime(attempt.at)} · {PAYMENT_METHOD_LABELS[attempt.method]}
                    {attempt.rawError ? ` · ${attempt.rawError}` : attempt.subtitle ? ` · ${attempt.subtitle}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono-num mr-1 text-sm font-extrabold text-slate-900 dark:text-white">
                    {formatCurrency(attempt.amount, baseCurrency)}
                  </span>
                  {mpAccessToken && (attempt.mpOrderId || attempt.mpCompanionOrderId) && (
                    <button
                      type="button"
                      disabled={verifyingAttemptId === attempt.id}
                      onClick={() => void verifySingleAttemptWithMp(attempt, false)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 text-[11px] font-semibold text-[#0072BB] hover:bg-sky-100 disabled:opacity-60 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                    >
                      <RefreshCw className={`h-3 w-3 ${verifyingAttemptId === attempt.id ? 'animate-spin' : ''}`} />
                      Verificar MP
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openForceReconcileForAttempt(attempt)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg bg-amber-600 px-2.5 text-[11px] font-semibold text-white hover:bg-amber-700"
                  >
                    <ShieldCheck className="h-3 w-3" />
                    Reconciliación forzada
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissRecoveredPayment(ownerId, attempt.id)}
                    title="Descartar intento no pagado"
                    aria-label="Descartar intento no pagado"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600 dark:border-slate-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recovered Payments Banner (Error al guardar / MP Point & QR sin venta) */}
      {unreconciledRecovered.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/75 p-4 dark:border-amber-900/60 dark:bg-amber-950/25">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                {unreconciledRecovered.length}{' '}
                {unreconciledRecovered.length === 1
                  ? 'cobro resguardado o conciliado (sumado al arqueo)'
                  : 'cobros resguardados o conciliados (sumados al arqueo)'}
              </span>
            </div>
            <span className="font-mono-num text-xs font-extrabold text-amber-800 dark:text-amber-300">
              Total:{' '}
              {formatCurrency(
                unreconciledRecovered.reduce((s, e) => s + e.amount, 0),
                baseCurrency
              )}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-amber-800/90 dark:text-amber-300/80">
            Estos cobros ya están sumados automáticamente a la Caja diaria, Ventas, Inicio y Reportes para que no pierdas ningún pago del cliente aunque haya fallado el guardado o se haya cobrado directo por Point / QR.
          </p>
          <div className="mt-3 space-y-2">
            {unreconciledRecovered.slice(0, 8).map((rec) => (
              <div
                key={rec.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200/80 bg-white/95 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-slate-900/90"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold text-slate-900 dark:text-white">
                      {rec.clientName} · {rec.title}
                    </span>
                    {rec.mpChannel === 'mp_point' && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                        <Smartphone className="h-2.5 w-2.5" /> Point MP
                      </span>
                    )}
                    {rec.mpChannel === 'mp_qr' && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                        <QrCode className="h-2.5 w-2.5" /> QR MP
                      </span>
                    )}
                    {rec.forceReconciled && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                        <ShieldCheck className="h-2.5 w-2.5" /> Reconciliación forzada
                      </span>
                    )}
                    {rec.saveFailed && (
                      <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                        Error al guardar
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {formatTime(rec.at)} · {PAYMENT_METHOD_LABELS[rec.method]}
                    {rec.saveError ? ` · ${rec.saveError}` : rec.subtitle ? ` · ${rec.subtitle}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono-num text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(rec.amount, baseCurrency)}
                  </span>
                  {rec.draftSalePayload && (
                    <button
                      type="button"
                      disabled={retryingId === rec.id}
                      onClick={() => void handleRetrySaveRecovered(rec)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#0072BB] px-2.5 text-[11px] font-semibold text-white hover:bg-[#005f9c] disabled:opacity-60"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {retryingId === rec.id ? 'Guardando...' : 'Guardar en Ventas'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => dismissRecoveredPayment(ownerId, rec.id)}
                    title="Ocultar aviso"
                    aria-label="Descartar cobro recuperado"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600 dark:border-slate-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Split: Chronological Ledger + Recent Closures */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  {activeShift
                    ? tr('Movimientos del turno actual', 'Current shift movements', 'Movimentações do turno atual')
                    : tr('Movimientos de hoy', 'Today movements', 'Movimentações de hoje')}
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
                        : entry.source === 'recuperado'
                          ? entry.saveFailed
                            ? 'Cobro recuperado'
                            : 'Mercado Pago'
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
                              : entry.saveFailed
                                ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400'
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
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-xs font-bold text-slate-900 dark:text-white">
                              {entry.title}
                            </span>
                            {entry.mpChannel === 'mp_point' && (
                              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                                Point MP
                              </span>
                            )}
                            {entry.mpChannel === 'mp_qr' && (
                              <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                                QR MP
                              </span>
                            )}
                            {entry.forceReconciled && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                <ShieldCheck className="h-2.5 w-2.5" /> Forzada
                              </span>
                            )}
                            {entry.saveFailed && (
                              <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                                Error al guardar
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {formatTime(entry.at)} · {sourceLabel} · {PAYMENT_METHOD_LABELS[entry.method]}
                            {entry.subtitle ? ` · ${entry.subtitle}` : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {entry.recoveredEntry?.draftSalePayload && (
                          <button
                            type="button"
                            disabled={retryingId === entry.recoveredEntry.id}
                            onClick={() => void handleRetrySaveRecovered(entry.recoveredEntry!)}
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#0072BB] px-2 text-[10px] font-semibold text-white hover:bg-[#005f9c]"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Guardar
                          </button>
                        )}
                        <span
                          className={`font-mono-num text-sm font-bold ${
                            isOut
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {isOut ? '-' : '+'}
                          {formatCurrency(entry.amount, baseCurrency)}
                        </span>
                      </div>
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
                      {((shift.mpPointTotal || 0) > 0 ||
                        (shift.mpQrTotal || 0) > 0 ||
                        (shift.forceReconciledCount || 0) > 0) && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5 text-[10px]">
                          {(shift.mpPointTotal || 0) > 0 && (
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                              Point: {formatCompactCurrency(shift.mpPointTotal || 0, baseCurrency)}
                            </span>
                          )}
                          {(shift.mpQrTotal || 0) > 0 && (
                            <span className="rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-[#0072BB] dark:bg-sky-950/50 dark:text-sky-300">
                              QR: {formatCompactCurrency(shift.mpQrTotal || 0, baseCurrency)}
                            </span>
                          )}
                          {(shift.forceReconciledCount || 0) > 0 && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                              {shift.forceReconciledCount} concil. forz.
                            </span>
                          )}
                        </div>
                      )}
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
            <div className="flex justify-between text-slate-600 dark:text-slate-300">
              <span>Transferencias / QR MP</span>
              <span className="font-mono-num font-semibold">
                {formatCurrency(financials.totalsByMethod.transferencia, baseCurrency)}
              </span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-300">
              <span>Tarjetas / Point MP</span>
              <span className="font-mono-num font-semibold">
                {formatCurrency(financials.totalsByMethod.tarjeta, baseCurrency)}
              </span>
            </div>
            {financials.forceReconciledCount > 0 && (
              <div className="flex justify-between text-amber-700 dark:text-amber-300">
                <span>Reconciliaciones forzadas incluidas ({financials.forceReconciledCount})</span>
                <span className="font-mono-num font-semibold">
                  {formatCurrency(financials.forceReconciledTotal, baseCurrency)}
                </span>
              </div>
            )}
          </div>

          {periodFailedAttempts.length > 0 && (
            <div className="rounded-xl border border-rose-300 bg-rose-50/80 p-3 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
              <div className="flex items-center justify-between gap-2 font-bold">
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                  Hay {periodFailedAttempts.length} intento(s) de cobro sin confirmar
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setShowCloseModal(false);
                    openForceReconcileForAttempt(periodFailedAttempts[0]);
                  }}
                  className="rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"
                >
                  Reconciliar antes de cerrar
                </button>
              </div>
              <p className="mt-1 text-[11px] opacity-90">
                Si alguno de esos intentos fue pagado por el cliente, reconcilialo antes de confirmar el cierre para evitar diferencias en el arqueo.
              </p>
            </div>
          )}

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

      {/* Modal: Reconciliación forzada (intento fallido confirmado por cliente) */}
      <ModalShell
        open={showForceManualModal}
        onClose={() => {
          setShowForceManualModal(false);
          setForceModalTarget(null);
        }}
        title="Reconciliación forzada · Confirmado por cliente"
        maxWidth="md"
      >
        <form onSubmit={handleConfirmForceReconcile} className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50/75 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            Capturá un intento de pago que figuró como fallido o interrumpido pero que el cliente ya abonó y confirmó con comprobante, evitando diferencias en el arqueo diario.
          </div>

          {forceModalTarget ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center justify-between gap-2 font-bold text-slate-900 dark:text-white">
                <span>
                  {forceModalTarget.clientName} · {forceModalTarget.title}
                </span>
                <span className="font-mono-num text-sm text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(forceModalTarget.amount, baseCurrency)}
                </span>
              </div>
              {forceModalTarget.rawError && (
                <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                  Error original: {forceModalTarget.rawError}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Origen
                  </label>
                  <select
                    value={forceSource}
                    onChange={(e) =>
                      setForceSource(e.target.value === 'reparacion' ? 'reparacion' : 'venta')
                    }
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="venta">Venta mostrador</option>
                    <option value="reparacion">Reparación / Taller</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Monto confirmado ({baseCurrency}) *
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={forceAmountInput}
                    onChange={(e) => setForceAmountInput(e.target.value)}
                    placeholder="15000"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Cliente
                  </label>
                  <input
                    type="text"
                    value={forceClientInput}
                    onChange={(e) => setForceClientInput(e.target.value)}
                    placeholder="Ej: Juan Pérez / Mostrador"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Concepto / Producto
                  </label>
                  <input
                    type="text"
                    value={forceTitleInput}
                    onChange={(e) => setForceTitleInput(e.target.value)}
                    placeholder="Ej: Módulo / Orden #104"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Canal de cobro confirmado
            </label>
            <select
              value={forceChannel}
              onChange={(e) =>
                setForceChannel(
                  e.target.value as
                    | 'efectivo'
                    | 'transferencia'
                    | 'tarjeta'
                    | 'mp_point'
                    | 'mp_qr'
                )
              }
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="mp_point">Mercado Pago Point Smart (Tarjeta)</option>
              <option value="mp_qr">Mercado Pago QR (Transferencia)</option>
              <option value="transferencia">Transferencia bancaria directa</option>
              <option value="tarjeta">Tarjeta / Otro posnet</option>
              <option value="efectivo">Efectivo en cajón</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Comprobante / Referencia de confirmación *
            </label>
            <input
              type="text"
              required
              value={forceNoteInput}
              onChange={(e) => setForceNoteInput(e.target.value)}
              placeholder="Ej: Comprobante MP #884129 visto en celular del cliente"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowForceManualModal(false);
                setForceModalTarget(null);
              }}
              className="h-10 flex-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-600 text-xs font-semibold text-white hover:bg-amber-700"
            >
              <ShieldCheck className="h-4 w-4" />
              Confirmar y consolidar
            </button>
          </div>
        </form>
      </ModalShell>
    </div>
  );
};
