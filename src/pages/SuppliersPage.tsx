import React from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { deleteRow } from '../lib/db';
import type { SupplierRecord } from '../types/workshop';
import { formatCurrency } from '../utils/formatters';
import { sanitizeDbErrorMessage } from '../utils/validation';

interface SuppliersPageProps {
  suppliers: SupplierRecord[];
  onNewSupplier: () => void;
  onEditSupplier: (supplier: SupplierRecord) => void;
}

export const SuppliersPage: React.FC<SuppliersPageProps> = ({
  suppliers,
  onNewSupplier,
  onEditSupplier,
}) => {
  const { notify } = useToast();
  const totalDebt = suppliers.reduce((s, x) => s + Number(x.balance || 0), 0);

  const handleDelete = async (s: SupplierRecord) => {
    try {
      await deleteRow('suppliers', s.id);
      notify('Proveedor eliminado.');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo eliminar el proveedor.'), 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Proveedores
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Agenda de distribuidores, plazos y cuentas corrientes
          </p>
        </div>
        <button
          type="button"
          onClick={onNewSupplier}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
        >
          <Plus className="h-4 w-4" />
          Agregar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
            {suppliers.length}
          </div>
          <div className="text-xs text-slate-500">Proveedores</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-2xl font-bold text-amber-600 dark:text-amber-400">
            {formatCurrency(totalDebt)}
          </div>
          <div className="text-xs text-slate-500">Saldo pendiente</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {suppliers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500 md:col-span-2 dark:border-slate-800 dark:bg-slate-900">
            No hay proveedores registrados.
          </div>
        ) : (
          suppliers.map((s) => (
            <div
              key={s.id}
              className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-bold text-slate-900 dark:text-white">{s.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {s.category}
                    {s.leadTime ? ` · Plazo: ${s.leadTime}` : ''}
                  </div>
                  {(s.contact || s.phone || s.email) && (
                    <div className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">
                      {[s.contact, s.phone, s.email].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-slate-500">Saldo</div>
                  <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                    {formatCurrency(s.balance)}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => onEditSupplier(s)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(s)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Eliminar
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
