import React, { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  CheckCircle2,
  Copy,
  Edit3,
  MessageCircle,
  Printer,
  Trash2,
} from 'lucide-react';
import { clampStr, db, handleFirestoreError, OperationType, stripUndefined } from '../lib/db';
import { DEFAULT_RECEIPT_TERMS, STATUS_META } from '../data/catalog';
import type {
  ClientRecord,
  RepairRecord,
  RepairStatus,
  WorkshopProfile,
} from '../types/workshop';
import { formatCurrency, formatDateShort, getStatusMeta } from '../utils/formatters';
import { BrandMark } from './BrandMark';
import { ModalShell } from './ModalShell';
import { PatternLock } from './PatternLock';
import { useToast } from './ToastProvider';

interface RepairDetailModalProps {
  repair: RepairRecord | null;
  clients?: ClientRecord[];
  profile?: WorkshopProfile | null;
  onClose: () => void;
}

export const RepairDetailModal: React.FC<RepairDetailModalProps> = ({
  repair,
  clients = [],
  profile,
  onClose,
}) => {
  const { notify } = useToast();
  const [tab, setTab] = useState<'detail' | 'edit' | 'receipt'>('detail');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit state
  const [status, setStatus] = useState<RepairStatus>('recibido');
  const [progress, setProgress] = useState(15);
  const [notes, setNotes] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientDni, setClientDni] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [price, setPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const [workDetail, setWorkDetail] = useState('');
  const [checkoutState, setCheckoutState] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!repair) return;
    setTab('detail');
    setConfirmDelete(false);
    setStatus((repair.status as RepairStatus) || 'recibido');
    setProgress(repair.progress ?? 15);
    setNotes(repair.notes || '');
    setClientName(repair.clientName || '');
    setClientPhone(repair.clientPhone || '');
    setClientDni(repair.clientDni || '');
    setClientEmail(repair.clientEmail || '');
    setClientAddress(repair.clientAddress || '');
    setPrice(String(repair.price ?? 0));
    setDeposit(String(repair.deposit ?? 0));
    setWorkDetail(repair.workDetail || '');
    setCheckoutState(repair.checkoutState || '');
  }, [repair]);

  if (!repair) return null;

  const statusMeta = getStatusMeta(repair.status);
  const pendingBalance = Math.max(0, Number(repair.price || 0) - Number(repair.deposit || 0));
  const editPendingBalance = Math.max(0, Number(price || 0) - Number(deposit || 0));
  const baseUrl = (profile?.trackingBaseUrl || window.location.origin).replace(/\/$/, '');
  const trackingUrl = `${baseUrl}/?track=${encodeURIComponent(repair.trackingCode)}`;

  const cleanPhoneForWa = (repair.clientPhone || '').replace(/[^\d]/g, '');
  const whatsappMessage = encodeURIComponent(
    `Hola ${repair.clientName}, te escribimos de ${
      profile?.brandName || 'TH3 BNB Servicio Técnico'
    }. Tu ${repair.brand} ${repair.model} (Orden ${repair.code}) está en estado: ${
      statusMeta.label
    } (${repair.progress}%). Podés seguir el estado acá: ${trackingUrl}`
  );
  const whatsappHref = cleanPhoneForWa
    ? `https://wa.me/${cleanPhoneForWa}?text=${whatsappMessage}`
    : '';

  const copyTrackingLink = async () => {
    try {
      await navigator.clipboard.writeText(trackingUrl);
      notify('Enlace de seguimiento copiado.');
    } catch {
      notify('No se pudo copiar automáticamente.', 'error');
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const repairPath = `repairs/${repair.id}`;
    try {
      const budget = Math.max(0, Number(price || 0));
      const advance = Math.max(0, Number(deposit || 0));
      const paymentStatus =
        budget === 0 ? 'pendiente' : advance >= budget ? 'pagado' : advance > 0 ? 'parcial' : 'pendiente';
      const cleanName = clampStr(clientName || repair.clientName, 160) || repair.clientName;
      const cleanWorkDetail = clampStr(workDetail, 2000);

      const batch = writeBatch(db);
      batch.update(
        doc(db, 'repairs', repair.id),
        stripUndefined({
          status,
          progress,
          notes: clampStr(notes, 2000),
          clientName: cleanName,
          clientPhone: clampStr(clientPhone, 60),
          clientDni: clampStr(clientDni, 40),
          clientEmail: clampStr(clientEmail, 200),
          clientAddress: clampStr(clientAddress, 240),
          price: budget,
          deposit: advance,
          paidAmount: advance,
          paymentStatus,
          workDetail: cleanWorkDetail,
          checkoutState: clampStr(checkoutState, 500),
          updatedAt: serverTimestamp(),
        })
      );

      if (repair.trackingCode) {
        const ticketRef = doc(db, 'publicTickets', repair.trackingCode);
        const ticketSnap = await getDoc(ticketRef);
        if (ticketSnap.exists()) {
          batch.update(
            ticketRef,
            stripUndefined({
              status,
              progress,
              workDetail: cleanWorkDetail,
              price: budget,
              deposit: advance,
              updatedAt: serverTimestamp(),
            })
          );
        }
      }

      if (repair.clientId && clients.some((c) => c.id === repair.clientId)) {
        batch.update(
          doc(db, 'clients', repair.clientId),
          stripUndefined({
            name: cleanName,
            phone: clampStr(clientPhone, 60),
            dni: clampStr(clientDni, 40),
            email: clampStr(clientEmail, 200),
            address: clampStr(clientAddress, 240),
          })
        );
      }

      await batch.commit();
      notify('Reparación actualizada.');
      setTab('detail');
    } catch (err) {
      notify('No se pudieron guardar los cambios.', 'error');
      handleFirestoreError(err, OperationType.UPDATE, repairPath);
    } finally {
      setSaving(false);
    }
  };

  const handleRegisterFullPayment = async () => {
    const budget = Math.max(0, Number(price || 0));
    setDeposit(String(budget));
    const repairPath = `repairs/${repair.id}`;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'repairs', repair.id), {
        deposit: budget,
        paidAmount: budget,
        paymentStatus: 'pagado',
        updatedAt: serverTimestamp(),
      });

      if (repair.trackingCode) {
        const ticketRef = doc(db, 'publicTickets', repair.trackingCode);
        const ticketSnap = await getDoc(ticketRef);
        if (ticketSnap.exists()) {
          batch.update(ticketRef, {
            deposit: budget,
            updatedAt: serverTimestamp(),
          });
        }
      }

      await batch.commit();
      notify('Pago completo registrado.');
    } catch (err) {
      notify('No se pudo registrar el pago.', 'error');
      handleFirestoreError(err, OperationType.UPDATE, repairPath);
    }
  };

  const handleDelete = async () => {
    const repairPath = `repairs/${repair.id}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'repairs', repair.id));

      if (repair.trackingCode) {
        const ticketRef = doc(db, 'publicTickets', repair.trackingCode);
        const ticketSnap = await getDoc(ticketRef);
        if (ticketSnap.exists()) {
          batch.delete(ticketRef);
        }
      }

      await batch.commit();
      notify(`Orden ${repair.code} eliminada.`);
      onClose();
    } catch (err) {
      notify('No se pudo eliminar la reparación.', 'error');
      handleFirestoreError(err, OperationType.DELETE, repairPath);
    }
  };

  return (
    <>
      <ModalShell
        open={Boolean(repair)}
        onClose={onClose}
        title={`${repair.deviceIcon || '📱'} ${repair.brand} ${repair.model}`}
        subtitle={`Orden ${repair.code} · Cliente: ${repair.clientName}`}
        maxWidth="3xl"
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setTab('detail')}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === 'detail'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Detalle
            </button>
            <button
              type="button"
              onClick={() => setTab('edit')}
              className={`inline-flex items-center gap-1 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === 'edit'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Edit3 className="h-3.5 w-3.5" />
              Editar
            </button>
            <button
              type="button"
              onClick={() => setTab('receipt')}
              className={`inline-flex items-center gap-1 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === 'receipt'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Printer className="h-3.5 w-3.5" />
              Boleta
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyTrackingLink}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Copy className="h-3.5 w-3.5" />
              Copiar link
            </button>
            {whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </a>
            )}
          </div>
        </div>

        {tab === 'detail' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Estado actual · Prioridad {repair.priority}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold ${statusMeta.badgeClass}`}
                  >
                    {statusMeta.label}
                  </span>
                  <span className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                    {repair.progress}%
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 text-right">
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Presupuesto</div>
                  <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                    {formatCurrency(repair.price)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Seña</div>
                  <div className="font-mono-num text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(repair.deposit)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Pendiente</div>
                  <div className="font-mono-num text-sm font-bold text-[#0072BB] dark:text-sky-400">
                    {formatCurrency(pendingBalance)}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  Equipo y seguimiento
                </h4>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Tipo:</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">{repair.deviceType}</dd>
                  </div>
                  {repair.color && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Color:</dt>
                      <dd className="font-medium text-slate-900 dark:text-white">{repair.color}</dd>
                    </div>
                  )}
                  {repair.capacity && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Capacidad:</dt>
                      <dd className="font-medium text-slate-900 dark:text-white">{repair.capacity}</dd>
                    </div>
                  )}
                  {repair.imei && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">IMEI / Serie:</dt>
                      <dd className="font-mono-num font-medium text-slate-900 dark:text-white">
                        {repair.imei}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Ingreso:</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">
                      {formatDateShort(repair.dateIn)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Entrega est.:</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">
                      {formatDateShort(repair.dateEst)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Código público:</dt>
                    <dd className="font-mono-num font-bold text-[#0072BB] dark:text-sky-400">
                      {repair.trackingCode}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">Cliente</h4>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Nombre:</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">{repair.clientName}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Teléfono:</dt>
                    <dd className="font-mono-num font-medium text-slate-900 dark:text-white">
                      {repair.clientPhone || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">DNI:</dt>
                    <dd className="font-mono-num font-medium text-slate-900 dark:text-white">
                      {repair.clientDni || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Email:</dt>
                    <dd className="truncate font-medium text-slate-900 dark:text-white">
                      {repair.clientEmail || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Dirección:</dt>
                    <dd className="truncate font-medium text-slate-900 dark:text-white">
                      {repair.clientAddress || '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Problema reportado
              </h4>
              <p className="mt-1 text-sm text-slate-900 dark:text-white">{repair.problem}</p>
              {repair.workDetail && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <h5 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    Trabajo realizado
                  </h5>
                  <p className="mt-1 text-sm text-slate-800 dark:text-slate-200">
                    {repair.workDetail}
                  </p>
                </div>
              )}
              {repair.notes && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <h5 className="text-xs font-bold text-slate-500 dark:text-slate-400">Notas</h5>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{repair.notes}</p>
                </div>
              )}
            </div>

            {((repair.accessories && repair.accessories.length > 0) ||
              (repair.consoleAccessories && Object.keys(repair.consoleAccessories).length > 0) ||
              (repair.partNames && repair.partNames.length > 0)) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {((repair.accessories && repair.accessories.length > 0) ||
                  (repair.consoleAccessories &&
                    Object.keys(repair.consoleAccessories).length > 0)) && (
                  <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      Accesorios entregados
                    </h4>
                    <p className="mt-1.5 text-xs text-slate-800 dark:text-slate-200">
                      {repair.accessories && repair.accessories.length > 0
                        ? repair.accessories.join(', ')
                        : Object.entries(repair.consoleAccessories || {})
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' · ')}
                    </p>
                  </div>
                )}

                {repair.partNames && repair.partNames.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      Repuestos asignados
                    </h4>
                    <p className="mt-1.5 text-xs text-slate-800 dark:text-slate-200">
                      {repair.partNames.join(', ')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {((repair.physicalCheck && Object.keys(repair.physicalCheck).length > 0) ||
              (repair.functionalCheck && Object.keys(repair.functionalCheck).length > 0)) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {repair.physicalCheck && Object.keys(repair.physicalCheck).length > 0 && (
                  <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                    <h4 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                      Check-in físico
                    </h4>
                    <div className="space-y-1 text-xs">
                      {Object.entries(repair.physicalCheck).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-slate-500">{k}</span>
                          <span className="font-semibold text-slate-900 dark:text-white">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {repair.functionalCheck && Object.keys(repair.functionalCheck).length > 0 && (
                  <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                    <h4 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                      Check-in funcional
                    </h4>
                    <div className="space-y-1 text-xs">
                      {Object.entries(repair.functionalCheck).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-slate-500">{k}</span>
                          <span className="font-semibold text-slate-900 dark:text-white">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {repair.securityType && repair.securityType !== 'none' && (
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <h4 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                  Seguridad del equipo
                </h4>
                {repair.securityType === 'pattern' &&
                repair.securityPattern &&
                repair.securityPattern.length > 0 ? (
                  <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:gap-5">
                    <PatternLock value={repair.securityPattern} readOnly size={150} />
                    <div className="font-mono-num text-xs text-slate-600 dark:text-slate-300">
                      Secuencia: {repair.securityPattern.join(' → ')}
                    </div>
                  </div>
                ) : (
                  <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                    PIN / Clave: {repair.securityPin}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar orden
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-red-600 dark:text-red-400">
                    ¿Confirmar eliminación?
                  </span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="h-9 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700"
                  >
                    Sí, eliminar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setTab('edit')}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Editar reparación
              </button>
            </div>
          </div>
        )}

        {tab === 'edit' && (
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Estado
                </label>
                <select
                  value={status}
                  onChange={(e) => {
                    const nextStatus = e.target.value as RepairStatus;
                    setStatus(nextStatus);
                    setProgress(STATUS_META[nextStatus]?.defaultProgress ?? progress);
                  }}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="recibido">Recibido</option>
                  <option value="diagnostico">Diagnóstico</option>
                  <option value="espera_repuesto">Espera repuesto</option>
                  <option value="en_progreso">En progreso</option>
                  <option value="listo">Listo para entregar</option>
                  <option value="entregado">Entregado</option>
                </select>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span>Progreso</span>
                  <span className="font-mono-num">{progress}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={progress}
                  onChange={(e) => setProgress(Number(e.target.value))}
                  className="mt-2 w-full accent-[#0072BB]"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Trabajo realizado
              </label>
              <textarea
                rows={2}
                value={workDetail}
                onChange={(e) => setWorkDetail(e.target.value)}
                placeholder="Describí el trabajo técnico efectuado..."
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Notas internas
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Presupuesto y pagos
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Presupuesto</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Anticipo / Pagado</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={deposit}
                    onChange={(e) => setDeposit(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Total pendiente</label>
                  <input
                    type="text"
                    readOnly
                    value={formatCurrency(editPendingBalance)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono-num text-sm font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white"
                  />
                </div>
              </div>
              {editPendingBalance > 0 && (
                <button
                  type="button"
                  onClick={handleRegisterFullPayment}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Registrar pago total ({formatCurrency(editPendingBalance)})
                </button>
              )}
            </div>

            <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Datos del cliente y entrega
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nombre y apellido"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="Celular"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="text"
                  value={clientDni}
                  onChange={(e) => setClientDni(e.target.value)}
                  placeholder="DNI"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="Email"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="text"
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  placeholder="Dirección"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 sm:col-span-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="text"
                  value={checkoutState}
                  onChange={(e) => setCheckoutState(e.target.value)}
                  placeholder="Estado de entrega / conformidad del cliente"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 sm:col-span-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setTab('detail')}
                className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c] disabled:opacity-60"
              >
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}

        {tab === 'receipt' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
              >
                <Printer className="h-4 w-4" />
                Imprimir boleta
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <BrandMark profile={profile} size="lg" />
                  <p className="mt-1 text-xs text-slate-500">
                    {profile?.businessAddress || 'Servicio técnico especializado'}
                    {profile?.businessPhone ? ` · Tel: ${profile.businessPhone}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <div className="font-mono-num text-base font-bold text-slate-900">
                    Orden {repair.code}
                  </div>
                  <div className="font-mono-num text-xs text-slate-500">
                    Seguimiento: {repair.trackingCode}
                  </div>
                  <div className="text-xs text-slate-500">
                    Ingreso: {formatDateShort(repair.dateIn)}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
                <div>
                  <div className="font-bold text-slate-500">Cliente</div>
                  <div className="mt-1 font-semibold text-slate-900">{repair.clientName}</div>
                  {repair.clientPhone && <div>Tel: {repair.clientPhone}</div>}
                  {repair.clientDni && <div>DNI: {repair.clientDni}</div>}
                </div>
                <div>
                  <div className="font-bold text-slate-500">Equipo</div>
                  <div className="mt-1 font-semibold text-slate-900">
                    {repair.deviceType} · {repair.brand} {repair.model}
                  </div>
                  {repair.imei && <div className="font-mono-num">IMEI/Serie: {repair.imei}</div>}
                  {repair.color && <div>Color: {repair.color}</div>}
                </div>
              </div>

              <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs">
                <div className="font-bold text-slate-600">Falla declarada</div>
                <div className="mt-0.5 text-slate-900">{repair.problem}</div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 border-y border-slate-200 py-3 text-center text-xs">
                <div>
                  <div className="text-slate-500">Presupuesto</div>
                  <div className="font-mono-num text-sm font-bold">
                    {formatCurrency(repair.price)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Seña / Anticipo</div>
                  <div className="font-mono-num text-sm font-bold">
                    {formatCurrency(repair.deposit)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Saldo pendiente</div>
                  <div className="font-mono-num text-sm font-bold">
                    {formatCurrency(pendingBalance)}
                  </div>
                </div>
              </div>

              <div className="mt-3 text-[11px] leading-relaxed whitespace-pre-line text-slate-600">
                {profile?.receiptTerms || DEFAULT_RECEIPT_TERMS}
              </div>

              <div className="mt-4 border-t border-dashed border-slate-300 pt-3 text-[11px] text-slate-500">
                Seguimiento en línea: <span className="font-mono-num">{trackingUrl}</span>
              </div>
            </div>
          </div>
        )}
      </ModalShell>

      {/* Clean print-only sheet when user clicks Imprimir boleta */}
      {tab === 'receipt' && (
        <div className="print-only hidden p-8 text-slate-900">
          <div className="flex items-start justify-between border-b border-slate-300 pb-4">
            <div>
              <h1 className="text-2xl font-extrabold">{profile?.brandName || 'TH3 BNB'}</h1>
              <p className="text-xs text-slate-600">
                {profile?.businessAddress} {profile?.businessPhone ? `· ${profile.businessPhone}` : ''}
              </p>
            </div>
            <div className="text-right">
              <div className="font-mono-num text-lg font-bold">Orden {repair.code}</div>
              <div className="font-mono-num text-xs">Código: {repair.trackingCode}</div>
              <div className="text-xs">Ingreso: {formatDateShort(repair.dateIn)}</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
            <div>
              <strong>Cliente:</strong> {repair.clientName}
              {repair.clientPhone && <div>Tel: {repair.clientPhone}</div>}
              {repair.clientDni && <div>DNI: {repair.clientDni}</div>}
            </div>
            <div>
              <strong>Equipo:</strong> {repair.deviceType} {repair.brand} {repair.model}
              {repair.imei && <div>IMEI/Serie: {repair.imei}</div>}
            </div>
          </div>
          <div className="mt-4 border border-slate-300 p-3 text-xs">
            <strong>Falla:</strong> {repair.problem}
          </div>
          <div className="mt-4 grid grid-cols-3 border-y border-slate-300 py-2 text-center text-xs">
            <div>
              Presupuesto: <strong>{formatCurrency(repair.price)}</strong>
            </div>
            <div>
              Anticipo: <strong>{formatCurrency(repair.deposit)}</strong>
            </div>
            <div>
              Saldo: <strong>{formatCurrency(pendingBalance)}</strong>
            </div>
          </div>
          <div className="mt-4 text-[10px] leading-relaxed whitespace-pre-line text-slate-700">
            {profile?.receiptTerms || DEFAULT_RECEIPT_TERMS}
          </div>
          <div className="mt-6 flex justify-between border-t border-slate-300 pt-8 text-xs">
            <span>Firma del cliente: _______________________</span>
            <span>Seguimiento: {trackingUrl}</span>
          </div>
        </div>
      )}
    </>
  );
};
