import { upsertRow } from '../lib/db';
import type { RepairRecord, SaleRecord, TaskRecord } from '../types/workshop';
import type { PaymentMethod } from './payment';
import { parsePaymentInfo } from './payment';
import type { RecoveredPaymentEntry } from './paymentLedger';
import { parseRepairPaymentLedger } from './repairMeta';
import { parseSaleDetails, parseSalePaymentInfo, type MpPaymentChannel } from './saleMeta';
import { sanitizePlainLine, sanitizeText } from './validation';

export const CASH_SHIFT_TASK_TYPE = '__cash_shift__';

export type CashMovementType = 'ingreso' | 'egreso';

export interface CashMovement {
  id: string;
  type: CashMovementType;
  amount: number;
  method: PaymentMethod;
  concept: string;
  at: string;
}

export interface CashShiftData {
  id: string;
  shiftDate: string;
  openedAt: string;
  openedBy?: string;
  openingCash: number;
  closedAt?: string;
  countedCash?: number;
  expectedCash?: number;
  discrepancy?: number;
  closingNote?: string;
  movements: CashMovement[];
  status: 'abierta' | 'cerrada';
}

export interface ShiftLedgerEntry {
  id: string;
  at: string;
  atMs: number;
  source: 'venta' | 'reparacion' | 'manual' | 'recuperado';
  direction: 'in' | 'out';
  method: PaymentMethod;
  mpChannel?: MpPaymentChannel;
  amount: number;
  title: string;
  subtitle?: string;
  isRecovered?: boolean;
  saveFailed?: boolean;
  saveError?: string;
  recoveredEntry?: RecoveredPaymentEntry;
}

export interface ShiftFinancialSummary {
  totalsByMethod: Record<PaymentMethod, number>;
  mpPointTotal: number;
  mpQrTotal: number;
  recoveredTotal: number;
  recoveredCount: number;
  salesTotal: number;
  repairsTotal: number;
  manualInTotal: number;
  manualOutTotal: number;
  expectedCashInDrawer: number;
  entries: ShiftLedgerEntry[];
}

export function isCashShiftTask(task: Pick<TaskRecord, 'taskType'>): boolean {
  return task.taskType === CASH_SHIFT_TASK_TYPE;
}

export function parseCashShiftFromTask(task: TaskRecord): CashShiftData | null {
  if (!isCashShiftTask(task)) return null;
  try {
    const parsed = JSON.parse(task.notes || '{}') as Partial<CashShiftData>;
    const movements: CashMovement[] = Array.isArray(parsed.movements)
      ? parsed.movements
          .filter((m) => m && Number(m.amount || 0) > 0)
          .map((m, idx) => ({
            id: sanitizePlainLine(String(m.id || `mv-${idx}`), 64) || `mv-${idx}`,
            type: m.type === 'egreso' ? 'egreso' : 'ingreso',
            amount: Math.max(0, Math.round(Number(m.amount) * 100) / 100),
            method:
              m.method === 'transferencia' || m.method === 'tarjeta' || m.method === 'efectivo'
                ? m.method
                : 'efectivo',
            concept: sanitizePlainLine(String(m.concept || 'Movimiento'), 140) || 'Movimiento',
            at: sanitizePlainLine(String(m.at || ''), 40) || new Date(task.createdAt || Date.now()).toISOString(),
          }))
      : [];

    return {
      id: task.id,
      shiftDate:
        sanitizePlainLine(String(parsed.shiftDate || task.dueDate || ''), 20) ||
        new Date(task.createdAt || Date.now()).toISOString().slice(0, 10),
      openedAt:
        sanitizePlainLine(String(parsed.openedAt || ''), 40) ||
        new Date(task.createdAt || Date.now()).toISOString(),
      ...(parsed.openedBy ? { openedBy: sanitizePlainLine(String(parsed.openedBy), 80) } : {}),
      openingCash: Math.max(0, Math.round(Number(parsed.openingCash || 0) * 100) / 100),
      ...(parsed.closedAt ? { closedAt: sanitizePlainLine(String(parsed.closedAt), 40) } : {}),
      ...(parsed.countedCash !== undefined
        ? { countedCash: Math.max(0, Math.round(Number(parsed.countedCash) * 100) / 100) }
        : {}),
      ...(parsed.expectedCash !== undefined
        ? { expectedCash: Math.round(Number(parsed.expectedCash) * 100) / 100 }
        : {}),
      ...(parsed.discrepancy !== undefined
        ? { discrepancy: Math.round(Number(parsed.discrepancy) * 100) / 100 }
        : {}),
      ...(parsed.closingNote ? { closingNote: sanitizeText(String(parsed.closingNote), 300) } : {}),
      movements,
      status: task.status === 'cerrada' || parsed.status === 'cerrada' ? 'cerrada' : 'abierta',
    };
  } catch {
    return null;
  }
}

export function serializeCashShiftToTask(params: {
  ownerId: string;
  shift: CashShiftData;
}): Omit<TaskRecord, 'createdAt'> {
  const { shift, ownerId } = params;
  return {
    id: shift.id,
    ownerId,
    title: `Caja ${shift.shiftDate}`,
    taskType: CASH_SHIFT_TASK_TYPE,
    priority: 'media',
    assignee: shift.openedBy || '',
    dueDate: shift.shiftDate,
    status: shift.status,
    notes: JSON.stringify(shift),
  };
}

export function computeShiftFinancials(params: {
  startMs: number;
  endMs: number;
  openingCash: number;
  movements: CashMovement[];
  sales: SaleRecord[];
  repairs: RepairRecord[];
  recoveredPayments?: RecoveredPaymentEntry[];
}): ShiftFinancialSummary {
  const {
    startMs,
    endMs,
    openingCash,
    movements,
    sales,
    repairs,
    recoveredPayments = [],
  } = params;
  const totalsByMethod: Record<PaymentMethod, number> = {
    efectivo: 0,
    transferencia: 0,
    tarjeta: 0,
  };
  let mpPointTotal = 0;
  let mpQrTotal = 0;
  let recoveredTotal = 0;
  let recoveredCount = 0;
  let salesTotal = 0;
  let repairsTotal = 0;
  let manualInTotal = 0;
  let manualOutTotal = 0;
  const entries: ShiftLedgerEntry[] = [];

  const inWindow = (ms: number) => ms >= startMs && ms <= endMs;

  // 1. Sales collections
  for (const s of sales) {
    const details = parseSaleDetails(s);
    const payInfo = parseSalePaymentInfo(s);
    const mpChannel = details.mpChannel;
    if (details.payments.length > 0) {
      for (const p of details.payments) {
        const atMs = Date.parse(p.date);
        if (!Number.isNaN(atMs) && inWindow(atMs) && p.amount > 0) {
          totalsByMethod[p.method] += p.amount;
          salesTotal += p.amount;
          const entryMpChannel =
            mpChannel ||
            undefined;
          if (entryMpChannel === 'mp_point') mpPointTotal += p.amount;
          else if (entryMpChannel === 'mp_qr') mpQrTotal += p.amount;
          entries.push({
            id: `sale-${s.id}-${p.id}`,
            at: p.date,
            atMs,
            source: 'venta',
            direction: 'in',
            method: p.method,
            ...(entryMpChannel ? { mpChannel: entryMpChannel } : {}),
            amount: p.amount,
            title: s.clientName || 'Mostrador',
            subtitle: `${s.invoice || 'Venta'}${p.note ? ` · ${p.note}` : ''}`,
          });
        }
      }
    } else if (payInfo.deposit > 0 && inWindow(s.createdAt)) {
      const method: PaymentMethod = payInfo.method || 'efectivo';
      totalsByMethod[method] += payInfo.deposit;
      salesTotal += payInfo.deposit;
      if (mpChannel === 'mp_point') mpPointTotal += payInfo.deposit;
      else if (mpChannel === 'mp_qr') mpQrTotal += payInfo.deposit;
      entries.push({
        id: `sale-${s.id}`,
        at: new Date(s.createdAt).toISOString(),
        atMs: s.createdAt,
        source: 'venta',
        direction: 'in',
        method,
        ...(mpChannel ? { mpChannel } : {}),
        amount: payInfo.deposit,
        title: s.clientName || 'Mostrador',
        subtitle: s.productName || s.invoice || 'Venta',
      });
    }
  }

  // 2. Repair deposits & payments
  for (const r of repairs) {
    const ledger = parseRepairPaymentLedger(r.checkoutState);
    if (ledger.length > 0) {
      for (const p of ledger) {
        const atMs = Date.parse(p.date);
        if (!Number.isNaN(atMs) && inWindow(atMs) && p.amount > 0) {
          totalsByMethod[p.method] += p.amount;
          repairsTotal += p.amount;
          entries.push({
            id: `rep-${r.id}-${p.id}`,
            at: p.date,
            atMs,
            source: 'reparacion',
            direction: 'in',
            method: p.method,
            amount: p.amount,
            title: `${r.code} · ${r.clientName}`,
            subtitle: `${r.brand} ${r.model}${p.note ? ` · ${p.note}` : ''}`,
          });
        }
      }
    } else {
      const paid = Math.max(0, Number(r.deposit || r.paidAmount || 0));
      if (paid > 0 && inWindow(r.createdAt)) {
        const payInfo = parsePaymentInfo(r);
        const method: PaymentMethod = payInfo.method || 'efectivo';
        totalsByMethod[method] += paid;
        repairsTotal += paid;
        entries.push({
          id: `rep-${r.id}`,
          at: new Date(r.createdAt).toISOString(),
          atMs: r.createdAt,
          source: 'reparacion',
          direction: 'in',
          method,
          amount: paid,
          title: `${r.code} · ${r.clientName}`,
          subtitle: `${r.brand} ${r.model} (Seña inicial)`,
        });
      }
    }
  }

  // 3. Unreconciled / recovered payments (failed save or MP Point/QR paid directly)
  for (const rec of recoveredPayments) {
    if (rec.amount <= 0) continue;
    const atMs = Number.isFinite(rec.createdAt) ? rec.createdAt : Date.parse(rec.at);
    if (Number.isNaN(atMs) || !inWindow(atMs)) continue;

    totalsByMethod[rec.method] += rec.amount;
    if (rec.source === 'reparacion') {
      repairsTotal += rec.amount;
    } else {
      salesTotal += rec.amount;
    }
    if (rec.mpChannel === 'mp_point') mpPointTotal += rec.amount;
    else if (rec.mpChannel === 'mp_qr') mpQrTotal += rec.amount;

    recoveredTotal += rec.amount;
    recoveredCount += 1;

    entries.push({
      id: `rec-${rec.id}`,
      at: rec.at,
      atMs,
      source: 'recuperado',
      direction: 'in',
      method: rec.method,
      ...(rec.mpChannel ? { mpChannel: rec.mpChannel } : {}),
      amount: rec.amount,
      title: rec.clientName ? `${rec.clientName} · ${rec.title}` : rec.title,
      subtitle: rec.saveFailed
        ? rec.saveError || 'Cobrado · Error al guardar en la nube'
        : rec.subtitle || 'Cobro acreditado en Mercado Pago',
      isRecovered: true,
      saveFailed: rec.saveFailed,
      saveError: rec.saveError,
      recoveredEntry: rec,
    });
  }

  // 4. Manual cash movements
  let manualCashDelta = 0;
  for (const m of movements) {
    const atMs = Date.parse(m.at) || startMs;
    if (m.type === 'ingreso') {
      manualInTotal += m.amount;
      totalsByMethod[m.method] += m.amount;
      if (m.method === 'efectivo') manualCashDelta += m.amount;
    } else {
      manualOutTotal += m.amount;
      if (m.method === 'efectivo') manualCashDelta -= m.amount;
    }
    entries.push({
      id: `mv-${m.id}`,
      at: m.at,
      atMs,
      source: 'manual',
      direction: m.type === 'egreso' ? 'out' : 'in',
      method: m.method,
      amount: m.amount,
      title: m.concept,
      subtitle: m.type === 'egreso' ? 'Retiro / egreso de caja' : 'Ingreso manual',
    });
  }

  // Note: totalsByMethod.efectivo already includes cash sales + cash repairs + manual cash ingresos.
  // Subtract manual cash egresos for expected cash in drawer.
  const cashEgresos = movements
    .filter((m) => m.type === 'egreso' && m.method === 'efectivo')
    .reduce((sum, m) => sum + m.amount, 0);
  void manualCashDelta;
  const expectedCashInDrawer = Math.round((openingCash + totalsByMethod.efectivo - cashEgresos) * 100) / 100;

  entries.sort((a, b) => b.atMs - a.atMs);

  return {
    totalsByMethod,
    mpPointTotal: Math.round(mpPointTotal * 100) / 100,
    mpQrTotal: Math.round(mpQrTotal * 100) / 100,
    recoveredTotal: Math.round(recoveredTotal * 100) / 100,
    recoveredCount,
    salesTotal: Math.round(salesTotal * 100) / 100,
    repairsTotal: Math.round(repairsTotal * 100) / 100,
    manualInTotal: Math.round(manualInTotal * 100) / 100,
    manualOutTotal: Math.round(manualOutTotal * 100) / 100,
    expectedCashInDrawer,
    entries,
  };
}

export function findOpenCashShift(tasks: TaskRecord[]): CashShiftData | null {
  const shifts = tasks
    .map(parseCashShiftFromTask)
    .filter((s): s is CashShiftData => s !== null && s.status === 'abierta')
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  return shifts[0] || null;
}

export async function appendMovementToOpenCashShift(params: {
  ownerId: string;
  tasks: TaskRecord[];
  movement: {
    type: CashMovementType;
    amount: number;
    method: PaymentMethod;
    concept: string;
    at?: string;
  };
}): Promise<{ ok: boolean; shift?: CashShiftData; noOpenShift?: boolean }> {
  const openShift = findOpenCashShift(params.tasks);
  if (!openShift) {
    return { ok: false, noOpenShift: true };
  }
  const cleanAmount = Math.max(0, Math.round(Number(params.movement.amount || 0) * 100) / 100);
  if (cleanAmount <= 0) {
    return { ok: false };
  }
  const nextMovement: CashMovement = {
    id: `mv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: params.movement.type === 'egreso' ? 'egreso' : 'ingreso',
    amount: cleanAmount,
    method: params.movement.method,
    concept: sanitizePlainLine(params.movement.concept, 140) || 'Movimiento',
    at: params.movement.at || new Date().toISOString(),
  };
  const updatedShift: CashShiftData = {
    ...openShift,
    movements: [...openShift.movements, nextMovement],
  };
  await upsertRow(
    'tasks',
    serializeCashShiftToTask({ ownerId: params.ownerId, shift: updatedShift })
  );
  return { ok: true, shift: updatedShift };
}
