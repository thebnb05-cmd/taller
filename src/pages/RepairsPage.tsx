import React, { useMemo, useState } from 'react';
import { Plus, Search, Wrench } from 'lucide-react';
import type { RepairRecord, WorkshopProfile } from '../types/workshop';
import { extractBatchRef } from '../utils/batchRef';
import { convertFromBaseCurrency } from '../utils/currency';
import {
  formatCurrency,
  formatDateShort,
  getStatusMeta,
  isActiveRepairStatus,
} from '../utils/formatters';
import { parsePaymentInfo } from '../utils/payment';
import { parseWorkshopMeta } from '../utils/workshopMeta';

interface RepairsPageProps {
  repairs: RepairRecord[];
  profile?: WorkshopProfile | null;
  onNewRepair: () => void;
  onSelectRepair: (repair: RepairRecord) => void;
}

export const RepairsPage: React.FC<RepairsPageProps> = ({
  repairs,
  profile,
  onNewRepair,
  onSelectRepair,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'activas' | 'listas' | 'entregadas'>('all');
  const baseCurrency = useMemo(() => parseWorkshopMeta(profile).currency, [profile]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...repairs]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((r) => {
        if (filter === 'activas' && !isActiveRepairStatus(r.status)) return false;
        if (filter === 'listas' && r.status !== 'listo') return false;
        if (filter === 'entregadas' && r.status !== 'entregado') return false;
        if (!q) return true;
        return (
          r.code.toLowerCase().includes(q) ||
          r.clientName.toLowerCase().includes(q) ||
          r.brand.toLowerCase().includes(q) ||
          r.model.toLowerCase().includes(q) ||
          (r.imei || '').toLowerCase().includes(q) ||
          (r.notes || '').toLowerCase().includes(q) ||
          r.problem.toLowerCase().includes(q)
        );
      });
  }, [filter, repairs, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Reparaciones
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {repairs.length} órdenes registradas en el taller
          </p>
        </div>
        <button
          type="button"
          onClick={onNewRepair}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          Nueva reparación
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por orden, cliente, marca, modelo o IMEI..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
          {[
            { id: 'all', label: 'Todas' },
            { id: 'activas', label: 'Activas' },
            { id: 'listas', label: 'Listas' },
            { id: 'entregadas', label: 'Entregadas' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as typeof filter)}
              className={`h-9 rounded-lg px-3 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <Wrench className="mx-auto h-7 w-7 text-slate-400" />
          <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
            No se encontraron reparaciones
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Probá con otro filtro o ingresá un nuevo equipo.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((r) => {
            const meta = getStatusMeta(r.status);
            const balance = Math.max(0, Number(r.price || 0) - Number(r.deposit || 0));
            const batchRef = extractBatchRef(r.notes);
            const paymentInfo = parsePaymentInfo(r);
            const hasForeignCurrency = Boolean(
              paymentInfo.currency &&
                paymentInfo.currency !== baseCurrency &&
                paymentInfo.rate &&
                paymentInfo.rate > 0
            );
            const foreignPrice =
              hasForeignCurrency && paymentInfo.rate
                ? convertFromBaseCurrency(Number(r.price || 0), paymentInfo.rate)
                : 0;

            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRepair(r)}
                className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-[#0072BB]/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono-num font-bold text-slate-700 dark:text-slate-200">
                        {r.code}
                      </span>
                      {batchRef && (
                        <span className="rounded bg-sky-50 px-1.5 py-0.5 font-mono-num text-[10px] font-bold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                          {batchRef}
                        </span>
                      )}
                      <span>·</span>
                      <span>{formatDateShort(r.dateIn)}</span>
                      <span>·</span>
                      <span className="capitalize">Prioridad {r.priority}</span>
                    </div>
                    <h3 className="mt-1 truncate text-base font-bold text-slate-900 dark:text-white">
                      {r.deviceIcon || '📱'} {r.brand} {r.model}
                    </h3>
                    <p className="truncate text-xs font-medium text-slate-600 dark:text-slate-300">
                      {r.clientName}
                      {r.clientPhone ? ` · ${r.clientPhone}` : ''}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${meta.badgeClass}`}
                  >
                    {meta.label}
                  </span>
                </div>

                <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                  {r.problem}
                </p>

                <div className="space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500">
                      Progreso <strong className="font-mono-num">{r.progress}%</strong>
                    </span>
                    <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                      {formatCurrency(r.price)}
                      {hasForeignCurrency && paymentInfo.currency && (
                        <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                          {formatCurrency(foreignPrice, paymentInfo.currency)}
                        </span>
                      )}
                      {balance > 0 && (
                        <span className="ml-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          (Resta {formatCurrency(balance)})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full ${meta.barClass}`}
                      style={{ width: `${Math.min(100, Math.max(0, r.progress))}%` }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
