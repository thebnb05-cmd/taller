import React, { useEffect, useState } from 'react';
import { Edit3, Plus, Trash2, Wrench } from 'lucide-react';
import {
  clampStr,
  deleteRow,
  generateDocId,
  handleDbError,
  OperationType,
  stripUndefined,
  updateRow,
  upsertRow,
} from '../lib/db';
import type { ClientRecord, RepairRecord, SaleRecord } from '../types/workshop';
import { formatCurrency, formatDateShort, getStatusMeta } from '../utils/formatters';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';

interface NewClientModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  editClient?: ClientRecord | null;
}

export const NewClientModal: React.FC<NewClientModalProps> = ({
  open,
  onClose,
  ownerId,
  editClient,
}) => {
  const { notify } = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [dni, setDni] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editClient?.name || '');
    setPhone(editClient?.phone || '');
    setDni(editClient?.dni || '');
    setEmail(editClient?.email || '');
    setAddress(editClient?.address || '');
  }, [open, editClient]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      notify('Ingresá el nombre del cliente.', 'error');
      return;
    }
    setSaving(true);
    try {
      const updatePayload = stripUndefined({
        name: clampStr(name, 160),
        phone: clampStr(phone, 60),
        dni: clampStr(dni, 40),
        email: clampStr(email, 200),
        address: clampStr(address, 240),
      });
      if (editClient) {
        const path = `clients/${editClient.id}`;
        try {
          await updateRow('clients', editClient.id, updatePayload);
          notify('Cliente actualizado.');
        } catch (err) {
          notify('No se pudo guardar el cliente.', 'error');
          await handleDbError(err, OperationType.UPDATE, path);
        }
      } else {
        const clientId = generateDocId('clients');
        const path = `clients/${clientId}`;
        try {
          await upsertRow('clients', {
            id: clientId,
            ...updatePayload,
            ownerId,
            createdAt: new Date().toISOString(),
          });
          notify('Cliente guardado.');
        } catch (err) {
          notify('No se pudo guardar el cliente.', 'error');
          await handleDbError(err, OperationType.CREATE, path);
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={editClient ? 'Editar cliente' : 'Nuevo cliente'}
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Nombre *
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre completo"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Teléfono
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="11-1234-5678"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              DNI
            </label>
            <input
              type="text"
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              placeholder="DNI"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@ejemplo.com"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Dirección
          </label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Dirección"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c] disabled:opacity-60"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

interface ClientDetailModalProps {
  client: ClientRecord | null;
  repairs: RepairRecord[];
  sales: SaleRecord[];
  onClose: () => void;
  onEdit: (client: ClientRecord) => void;
  onNewRepairForClient: (client: ClientRecord) => void;
  onSelectRepair: (repair: RepairRecord) => void;
}

export const ClientDetailModal: React.FC<ClientDetailModalProps> = ({
  client,
  repairs,
  sales,
  onClose,
  onEdit,
  onNewRepairForClient,
  onSelectRepair,
}) => {
  const { notify } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
  }, [client]);

  if (!client) return null;

  const clientRepairs = repairs.filter(
    (r) =>
      r.clientId === client.id ||
      r.clientName.trim().toLowerCase() === client.name.trim().toLowerCase()
  );
  const clientSales = sales.filter(
    (s) =>
      s.clientId === client.id ||
      s.clientName.trim().toLowerCase() === client.name.trim().toLowerCase()
  );
  const totalSpent =
    clientRepairs.reduce((sum, r) => sum + Number(r.price || 0), 0) +
    clientSales.reduce((sum, s) => sum + Number(s.amount || 0), 0);

  const handleDelete = async () => {
    const path = `clients/${client.id}`;
    try {
      await deleteRow('clients', client.id);
      notify('Cliente eliminado.');
      onClose();
    } catch (err) {
      notify('No se pudo eliminar el cliente.', 'error');
      await handleDbError(err, OperationType.DELETE, path);
    }
  };

  return (
    <ModalShell
      open={Boolean(client)}
      onClose={onClose}
      title={client.name}
      subtitle={`${clientRepairs.length} reparaciones · Total acumulado ${formatCurrency(totalSpent)}`}
      maxWidth="2xl"
    >
      <div className="space-y-5">
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-800/40">
          <div>
            <span className="text-slate-500">Teléfono: </span>
            <strong className="font-mono-num text-slate-900 dark:text-white">
              {client.phone || '—'}
            </strong>
          </div>
          <div>
            <span className="text-slate-500">DNI: </span>
            <strong className="font-mono-num text-slate-900 dark:text-white">
              {client.dni || '—'}
            </strong>
          </div>
          <div>
            <span className="text-slate-500">Email: </span>
            <strong className="text-slate-900 dark:text-white">{client.email || '—'}</strong>
          </div>
          <div>
            <span className="text-slate-500">Dirección: </span>
            <strong className="text-slate-900 dark:text-white">{client.address || '—'}</strong>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              onNewRepairForClient(client);
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
          >
            <Plus className="h-4 w-4" />
            Nueva reparación para este cliente
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onEdit(client);
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Edit3 className="h-3.5 w-3.5" />
            Editar datos
          </button>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">
            Historial de reparaciones
          </h3>
          {clientRepairs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-800">
              Sin reparaciones registradas todavía.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {clientRepairs.map((r) => {
                const meta = getStatusMeta(r.status);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      onClose();
                      onSelectRepair(r);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Wrench className="h-3.5 w-3.5" />
                        <span className="font-mono-num font-semibold">{r.code}</span>
                        <span>·</span>
                        <span>{formatDateShort(r.dateIn)}</span>
                      </div>
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {r.brand} {r.model}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}>
                        {meta.label}
                      </span>
                      <span className="font-mono-num text-xs font-bold text-slate-900 dark:text-white">
                        {formatCurrency(r.price)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar cliente
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                ¿Eliminar este cliente?
              </span>
              <button
                type="button"
                onClick={handleDelete}
                className="h-8 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
};
