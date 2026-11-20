import React, { useEffect, useState } from 'react';
import { Edit3, MessageCircle, Phone, Plus, ShoppingBag, Trash2, Wrench } from 'lucide-react';
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
import { parseSalePaymentInfo } from '../utils/saleMeta';
import {
  isValidEmail,
  sanitizeDbErrorMessage,
  sanitizeDni,
  sanitizeEmail,
  sanitizePhone,
  sanitizePlainLine,
} from '../utils/validation';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';
import { useI18n } from '../utils/i18n';
import {
  CLIENT_TYPE_LABELS,
  parseClientMeta,
  serializeClientNotes,
  type ClientType,
} from '../utils/clientMeta';

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
  const { tr } = useI18n();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [altPhone, setAltPhone] = useState('');
  const [clientType, setClientType] = useState<ClientType>('particular');
  const [dni, setDni] = useState('');
  const [cuit, setCuit] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [existingNotes, setExistingNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const meta = parseClientMeta(editClient);
    setName(editClient?.name || '');
    setPhone(editClient?.phone || '');
    setAltPhone(meta.altPhone);
    setClientType(meta.clientType);
    setDni(editClient?.dni || '');
    setCuit(meta.cuit);
    setEmail(editClient?.email || '');
    setAddress(editClient?.address || '');
    setNeighborhood(meta.neighborhood);
    setExistingNotes(meta.notes);
  }, [open, editClient]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sanitizePlainLine(name, 160);
    if (!cleanName) {
      notify('Ingresá el nombre del cliente.', 'error');
      return;
    }
    const cleanEmail = sanitizeEmail(email, 200);
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      notify('El correo electrónico del cliente no tiene un formato válido.', 'error');
      return;
    }
    setSaving(true);
    try {
      const encodedNotes = serializeClientNotes({
        altPhone,
        clientType,
        cuit,
        neighborhood,
        notes: existingNotes,
      });
      const updatePayload = stripUndefined({
        name: cleanName,
        phone: sanitizePhone(phone, 60),
        dni: sanitizeDni(dni, 40),
        email: cleanEmail,
        address: clampStr(sanitizePlainLine(address, 240), 240),
        notes: clampStr(encodedNotes, 2000),
      });
      if (editClient) {
        const path = `clients/${editClient.id}`;
        try {
          await updateRow('clients', editClient.id, updatePayload);
          notify('Cliente actualizado.');
          onClose();
        } catch (err) {
          notify(sanitizeDbErrorMessage(err, 'No se pudo guardar el cliente.'), 'error');
          void handleDbError(err, OperationType.UPDATE, path).catch(() => {});
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
          onClose();
        } catch (err) {
          notify(sanitizeDbErrorMessage(err, 'No se pudo guardar el cliente.'), 'error');
          void handleDbError(err, OperationType.CREATE, path).catch(() => {});
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const clientTypeLabel = (type: ClientType) => {
    if (type === 'empresa') return tr('Empresa', 'Company', 'Empresa');
    if (type === 'gremio') return tr('Gremio', 'Trade', 'Parceiro');
    return tr('Particular', 'Individual', 'Particular');
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={
        editClient
          ? tr('Editar cliente', 'Edit client', 'Editar cliente')
          : tr('Nuevo cliente', 'New client', 'Novo cliente')
      }
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            {tr('Tipo de cliente', 'Client type', 'Tipo de cliente')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['particular', 'empresa', 'gremio'] as const).map((type) => {
              const active = clientType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setClientType(type)}
                  className={`h-9 rounded-xl border px-2 text-xs font-semibold transition ${
                    active
                      ? 'border-[#0072BB] bg-[#0072BB] text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {clientTypeLabel(type) || CLIENT_TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            {clientType === 'empresa'
              ? tr('Nombre / Razón social *', 'Company name *', 'Nome / Razão social *')
              : tr('Nombre completo *', 'Full name *', 'Nome completo *')}
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              clientType === 'empresa'
                ? tr('Ej: TechStore SRL', 'e.g. TechStore LLC', 'Ex: TechStore Ltda')
                : tr('Nombre completo', 'Full name', 'Nome completo')
            }
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('Teléfono principal', 'Primary phone', 'Telefone principal')}
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
              {tr('Teléfono alternativo', 'Alternate phone', 'Telefone alternativo')}
            </label>
            <input
              type="tel"
              value={altPhone}
              onChange={(e) => setAltPhone(e.target.value)}
              placeholder={tr('Familiar o contacto secundario', 'Family or secondary contact', 'Familiar ou contato secundário')}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('DNI', 'ID / SSN', 'RG / CPF')}
            </label>
            <input
              type="text"
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              placeholder="Ej: 35.123.456"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('CUIT / CUIL', 'Tax ID', 'CNPJ / CPF')}
            </label>
            <input
              type="text"
              value={cuit}
              onChange={(e) => setCuit(e.target.value)}
              placeholder="Ej: 20-12345678-9"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            {tr('Email', 'Email', 'E-mail')}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@ejemplo.com"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('Dirección', 'Address', 'Endereço')}
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={tr('Calle y altura', 'Street & number', 'Rua e número')}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('Localidad / Barrio', 'City / Neighborhood', 'Cidade / Bairro')}
            </label>
            <input
              type="text"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              placeholder={tr('Ej: Centro, Palermo...', 'e.g. Downtown...', 'Ex: Centro...')}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            {tr('Notas / Observaciones', 'Notes / Remarks', 'Notas / Observações')}
          </label>
          <textarea
            rows={2}
            value={existingNotes}
            onChange={(e) => setExistingNotes(e.target.value)}
            placeholder={tr(
              'Preferencias de contacto, horarios, acuerdos de gremio...',
              'Contact preferences, hours, trade agreements...',
              'Preferências de contato, horários, acordos...'
            )}
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {tr('Cancelar', 'Cancel', 'Cancelar')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c] disabled:opacity-60"
          >
            {saving ? tr('Guardando...', 'Saving...', 'Salvando...') : tr('Guardar', 'Save', 'Salvar')}
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

function buildPhoneActionLinks(rawPhone: string | undefined): {
  telHref: string | null;
  waHref: string | null;
} {
  const digits = (rawPhone || '').replace(/[^\d]/g, '');
  if (!digits || digits.length < 6) return { telHref: null, waHref: null };
  return {
    telHref: `tel:${digits}`,
    waHref: `https://wa.me/${digits}`,
  };
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
  const { tr } = useI18n();
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
  }, [client]);

  if (!client) return null;

  const clientMeta = parseClientMeta(client);
  const clientTypeText =
    clientMeta.clientType === 'empresa'
      ? tr('Empresa', 'Company', 'Empresa')
      : clientMeta.clientType === 'gremio'
        ? tr('Gremio', 'Trade', 'Parceiro')
        : tr('Particular', 'Individual', 'Particular');
  const primaryLinks = buildPhoneActionLinks(client.phone);
  const altLinks = buildPhoneActionLinks(clientMeta.altPhone);

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
      notify(sanitizeDbErrorMessage(err, 'No se pudo eliminar el cliente.'), 'error');
      void handleDbError(err, OperationType.DELETE, path).catch(() => {});
    }
  };

  return (
    <ModalShell
      open={Boolean(client)}
      onClose={onClose}
      title={client.name}
      subtitle={`${clientTypeText} · ${clientRepairs.length} ${tr('reparaciones', 'repairs', 'reparos')} · ${clientSales.length} ${tr('ventas', 'sales', 'vendas')} · Total ${formatCurrency(totalSpent)}`}
      maxWidth="2xl"
    >
      <div className="space-y-5">
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-800/40">
          <div>
            <span className="text-slate-500">{tr('Tipo de cliente:', 'Client type:', 'Tipo de cliente:')} </span>
            <strong className="text-slate-900 dark:text-white">{clientTypeText}</strong>
          </div>
          <div>
            <span className="text-slate-500">{tr('Email:', 'Email:', 'E-mail:')} </span>
            <strong className="text-slate-900 dark:text-white">{client.email || '—'}</strong>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div>
              <span className="text-slate-500">{tr('Teléfono principal:', 'Primary phone:', 'Telefone principal:')} </span>
              <strong className="font-mono-num text-slate-900 dark:text-white">
                {client.phone || '—'}
              </strong>
            </div>
            {(primaryLinks.waHref || primaryLinks.telHref) && (
              <div className="flex items-center gap-1">
                {primaryLinks.waHref && (
                  <a
                    href={primaryLinks.waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-6 items-center gap-1 rounded-md bg-emerald-600 px-2 text-[10px] font-semibold text-white hover:bg-emerald-700"
                  >
                    <MessageCircle className="h-3 w-3" />
                    WhatsApp
                  </a>
                )}
                {primaryLinks.telHref && (
                  <a
                    href={primaryLinks.telHref}
                    className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <Phone className="h-3 w-3" />
                    {tr('Llamar', 'Call', 'Ligar')}
                  </a>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div>
              <span className="text-slate-500">{tr('Teléfono alternativo:', 'Alternate phone:', 'Telefone alternativo:')} </span>
              <strong className="font-mono-num text-slate-900 dark:text-white">
                {clientMeta.altPhone || '—'}
              </strong>
            </div>
            {(altLinks.waHref || altLinks.telHref) && (
              <div className="flex items-center gap-1">
                {altLinks.waHref && (
                  <a
                    href={altLinks.waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-6 items-center gap-1 rounded-md bg-emerald-600 px-2 text-[10px] font-semibold text-white hover:bg-emerald-700"
                  >
                    <MessageCircle className="h-3 w-3" />
                    WhatsApp
                  </a>
                )}
                {altLinks.telHref && (
                  <a
                    href={altLinks.telHref}
                    className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <Phone className="h-3 w-3" />
                    {tr('Llamar', 'Call', 'Ligar')}
                  </a>
                )}
              </div>
            )}
          </div>
          <div>
            <span className="text-slate-500">{tr('DNI:', 'ID / SSN:', 'RG / CPF:')} </span>
            <strong className="font-mono-num text-slate-900 dark:text-white">
              {client.dni || '—'}
            </strong>
          </div>
          <div>
            <span className="text-slate-500">{tr('CUIT / CUIL:', 'Tax ID:', 'CNPJ / CPF:')} </span>
            <strong className="font-mono-num text-slate-900 dark:text-white">
              {clientMeta.cuit || '—'}
            </strong>
          </div>
          <div>
            <span className="text-slate-500">{tr('Dirección:', 'Address:', 'Endereço:')} </span>
            <strong className="text-slate-900 dark:text-white">{client.address || '—'}</strong>
          </div>
          <div>
            <span className="text-slate-500">{tr('Localidad / Barrio:', 'City / Neighborhood:', 'Cidade / Bairro:')} </span>
            <strong className="text-slate-900 dark:text-white">
              {clientMeta.neighborhood || '—'}
            </strong>
          </div>
          {clientMeta.notes && (
            <div className="border-t border-slate-200/80 pt-2 sm:col-span-2 dark:border-slate-700/60">
              <span className="text-slate-500">{tr('Notas:', 'Notes:', 'Notas:')} </span>
              <span className="whitespace-pre-line font-medium text-slate-800 dark:text-slate-200">
                {clientMeta.notes}
              </span>
            </div>
          )}
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
            {tr('Nueva reparación para este cliente', 'New repair for this client', 'Novo reparo para este cliente')}
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
            {tr('Editar datos', 'Edit details', 'Editar dados')}
          </button>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">
            {tr('Historial de reparaciones', 'Repair history', 'Histórico de reparos')}
          </h3>
          {clientRepairs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-800">
              {tr('Sin reparaciones registradas todavía.', 'No repairs recorded yet.', 'Nenhum reparo registrado ainda.')}
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

        <div>
          <h3 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">
            {tr('Historial de ventas', 'Sales history', 'Histórico de vendas')}
          </h3>
          {clientSales.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-800">
              {tr('Sin ventas registradas todavía.', 'No sales recorded yet.', 'Nenhuma venda registrada ainda.')}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {clientSales.map((s) => {
                const info = parseSalePaymentInfo(s);
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <ShoppingBag className="h-3.5 w-3.5" />
                        <span className="font-mono-num font-semibold">{s.invoice}</span>
                        <span>·</span>
                        <span>{formatDateShort(s.dueDate)}</span>
                      </div>
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {s.productName
                          ? `${s.productName}${s.quantity ? ` × ${s.quantity}` : ''}`
                          : tr('Venta de mostrador', 'Counter sale', 'Venda no balcão')}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold ${
                          info.isPaid
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                        }`}
                      >
                        {info.isPaid
                          ? tr('Cobrado', 'Paid', 'Pago')
                          : info.deposit > 0
                            ? tr('Señado', 'Deposit', 'Sinal')
                            : tr('Pendiente', 'Pending', 'Pendente')}
                      </span>
                      <span className="font-mono-num text-xs font-bold text-slate-900 dark:text-white">
                        {formatCurrency(s.amount)}
                      </span>
                    </div>
                  </div>
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
              {tr('Eliminar cliente', 'Delete client', 'Excluir cliente')}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                {tr('¿Eliminar este cliente?', 'Delete this client?', 'Excluir este cliente?')}
              </span>
              <button
                type="button"
                onClick={handleDelete}
                className="h-8 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white"
              >
                {tr('Confirmar', 'Confirm', 'Confirmar')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                {tr('Cancelar', 'Cancel', 'Cancelar')}
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
};
