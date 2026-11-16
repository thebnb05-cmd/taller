import React, { useMemo, useState } from 'react';
import { Plus, Search, Users } from 'lucide-react';
import type { ClientRecord, RepairRecord, SaleRecord } from '../types/workshop';
import { parseClientMeta } from '../utils/clientMeta';
import { formatCurrency } from '../utils/formatters';

interface ClientsPageProps {
  clients: ClientRecord[];
  repairs: RepairRecord[];
  sales: SaleRecord[];
  onNewClient: () => void;
  onSelectClient: (client: ClientRecord) => void;
}

export const ClientsPage: React.FC<ClientsPageProps> = ({
  clients,
  repairs,
  sales,
  onNewClient,
  onSelectClient,
}) => {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...clients]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((c) => {
        if (!q) return true;
        const meta = parseClientMeta(c);
        return (
          c.name.toLowerCase().includes(q) ||
          (c.phone || '').toLowerCase().includes(q) ||
          meta.altPhone.toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.dni || '').toLowerCase().includes(q) ||
          meta.cuit.toLowerCase().includes(q) ||
          meta.neighborhood.toLowerCase().includes(q)
        );
      });
  }, [clients, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Clientes
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {clients.length} clientes en base de datos
          </p>
        </div>
        <button
          type="button"
          onClick={onNewClient}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          Nuevo cliente
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, teléfono, DNI, CUIT, barrio o email..."
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-800 dark:bg-slate-900 dark:text-white"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <Users className="mx-auto h-7 w-7 text-slate-400" />
          <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
            Sin clientes para mostrar
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const meta = parseClientMeta(c);
            const cRepairs = repairs.filter(
              (r) =>
                r.clientId === c.id ||
                r.clientName.trim().toLowerCase() === c.name.trim().toLowerCase()
            );
            const cSales = sales.filter(
              (s) =>
                s.clientId === c.id ||
                s.clientName.trim().toLowerCase() === c.name.trim().toLowerCase()
            );
            const total =
              cRepairs.reduce((s, r) => s + Number(r.price || 0), 0) +
              cSales.reduce((s, x) => s + Number(x.amount || 0), 0);

            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectClient(c)}
                className="flex items-start gap-3.5 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-[#0072BB]/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/40"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {c.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-bold text-slate-900 dark:text-white">
                      {c.name}
                    </span>
                    {meta.clientType !== 'particular' && (
                      <span className="shrink-0 rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                        {meta.clientType === 'empresa' ? 'Empresa' : 'Gremio'}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate font-mono-num text-xs text-slate-500 dark:text-slate-400">
                    {c.phone || meta.altPhone || c.email || 'Sin teléfono'}
                  </div>
                  {meta.neighborhood && (
                    <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">
                      {meta.neighborhood}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono-num">{cRepairs.length} órd.</span>
                    <span>·</span>
                    <span className="font-mono-num font-semibold text-slate-900 dark:text-white">
                      {formatCurrency(total)}
                    </span>
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
