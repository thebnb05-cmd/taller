import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Banknote, CreditCard, Landmark, Package, Printer } from 'lucide-react';
import {
  clampStr,
  generateDocId,
  stripUndefined,
  updateRow,
  upsertRow,
} from '../lib/db';
import type {
  ClientRecord,
  ProductRecord,
  SaleRecord,
  SupplierRecord,
} from '../types/workshop';
import { formatCurrency, todayISO } from '../utils/formatters';
import {
  buildTransferQrPayload,
  loadTransferConfig,
  type PaymentMethod,
} from '../utils/payment';
import { serializeSaleStatus } from '../utils/saleMeta';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';

interface NewTaskModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
}

export const NewTaskModal: React.FC<NewTaskModalProps> = ({ open, onClose, ownerId }) => {
  const { notify } = useToast();
  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState('seguimiento');
  const [priority, setPriority] = useState('media');
  const [assignee, setAssignee] = useState('Equipo');
  const [dueDate, setDueDate] = useState(todayISO());
  const [status, setStatus] = useState('pendiente');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setTaskType('seguimiento');
    setPriority('media');
    setAssignee('Equipo');
    setDueDate(todayISO());
    setStatus('pendiente');
    setNotes('');
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      notify('Ingresá un título para la tarea.', 'error');
      return;
    }
    setSaving(true);
    const taskId = generateDocId('tasks');
    try {
      await upsertRow(
        'tasks',
        stripUndefined({
          id: taskId,
          ownerId,
          title: clampStr(title, 200),
          taskType,
          priority,
          assignee: clampStr(assignee, 100),
          dueDate: clampStr(dueDate, 40),
          status,
          notes: clampStr(notes, 1500),
        })
      );
      notify('Tarea agregada a la agenda.');
      onClose();
    } catch (err) {
      console.error(err);
      notify('No se pudo guardar la tarea.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell open={open} onClose={onClose} title="Nueva tarea" maxWidth="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Título *
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Confirmar repuesto, seguimiento, cobro..."
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Tipo
            </label>
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="seguimiento">Seguimiento</option>
              <option value="proveedor">Proveedor</option>
              <option value="finanzas">Finanzas</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Prioridad
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Responsable
            </label>
            <input
              type="text"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Fecha
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Estado
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="pendiente">Pendiente</option>
            <option value="hoy">Hoy</option>
            <option value="completado">Completada</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Notas
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Detalles, seguimiento o comentarios..."
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c]"
          >
            {saving ? 'Guardando...' : 'Guardar tarea'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

interface NewSupplierModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  editSupplier?: SupplierRecord | null;
}

export const NewSupplierModal: React.FC<NewSupplierModalProps> = ({
  open,
  onClose,
  ownerId,
  editSupplier,
}) => {
  const { notify } = useToast();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Repuestos');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [leadTime, setLeadTime] = useState('48h');
  const [balance, setBalance] = useState('0');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editSupplier) {
      setName(editSupplier.name);
      setCategory(editSupplier.category);
      setContact(editSupplier.contact || '');
      setPhone(editSupplier.phone || '');
      setEmail(editSupplier.email || '');
      setLeadTime(editSupplier.leadTime || '48h');
      setBalance(String(editSupplier.balance ?? 0));
    } else {
      setName('');
      setCategory('Repuestos');
      setContact('');
      setPhone('');
      setEmail('');
      setLeadTime('48h');
      setBalance('0');
    }
  }, [open, editSupplier]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      notify('Ingresá el nombre del proveedor.', 'error');
      return;
    }
    setSaving(true);
    try {
      const baseFields = stripUndefined({
        name: clampStr(name, 160),
        category: clampStr(category || 'Repuestos', 80) || 'Repuestos',
        contact: clampStr(contact, 120),
        phone: clampStr(phone, 60),
        email: clampStr(email, 200),
        leadTime: clampStr(leadTime, 60),
        balance: Math.max(0, Number(balance || 0)),
      });
      if (editSupplier) {
        try {
          await updateRow('suppliers', editSupplier.id, baseFields);
          notify('Proveedor actualizado.');
        } catch (err) {
          console.error(err);
          notify('No se pudo guardar el proveedor.', 'error');
        }
      } else {
        const supplierId = generateDocId('suppliers');
        try {
          await upsertRow('suppliers', {
            id: supplierId,
            ...baseFields,
            ownerId,
          });
          notify('Proveedor guardado.');
        } catch (err) {
          console.error(err);
          notify('No se pudo guardar el proveedor.', 'error');
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
      title={editSupplier ? 'Editar proveedor' : 'Nuevo proveedor'}
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Nombre *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="TechParts SRL"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Categoría
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="Repuestos">Repuestos</option>
              <option value="Accesorios">Accesorios</option>
              <option value="Baterías">Baterías</option>
              <option value="Servicio">Servicio</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Contacto
            </label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="María Gómez"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Teléfono
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="11-5555-2200"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ventas@proveedor.com"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Plazo de entrega
            </label>
            <input
              type="text"
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
              placeholder="48h"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Saldo pendiente
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c]"
          >
            {saving ? 'Guardando...' : 'Guardar proveedor'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

interface NewSaleModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  clients: ClientRecord[];
  preselectedProduct?: ProductRecord | null;
  brandName?: string;
  onCreated?: (sale: SaleRecord) => void;
}

export const NewSaleModal: React.FC<NewSaleModalProps> = ({
  open,
  onClose,
  ownerId,
  clients,
  preselectedProduct,
  brandName,
  onCreated,
}) => {
  const { notify } = useToast();
  const [clientName, setClientName] = useState('');
  const [invoice, setInvoice] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [amount, setAmount] = useState('');
  const [deposit, setDeposit] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo');
  const [status, setStatus] = useState<'pendiente' | 'cobrado'>('cobrado');
  const [dueDate, setDueDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [transferQrDataUrl, setTransferQrDataUrl] = useState('');

  const transferCfg = useMemo(() => loadTransferConfig(ownerId), [ownerId, open]);

  useEffect(() => {
    if (!open) return;
    const initialAmount = preselectedProduct ? String(preselectedProduct.price) : '';
    setClientName('');
    setInvoice(`FV-${Math.floor(1000 + Math.random() * 9000)}`);
    setQuantity(1);
    setAmount(initialAmount);
    setDeposit(initialAmount);
    setPaymentMethod('efectivo');
    setStatus('cobrado');
    setDueDate(todayISO());
  }, [open, preselectedProduct]);

  const numericAmount = Math.max(0, Number(amount || 0));
  const numericDeposit =
    status === 'cobrado'
      ? numericAmount
      : Math.min(numericAmount > 0 ? numericAmount : Number(deposit || 0), Math.max(0, Number(deposit || 0)));
  const pendingBalance = Math.max(0, numericAmount - numericDeposit);
  const qrChargeAmount = status === 'cobrado' ? numericAmount : numericDeposit > 0 ? numericDeposit : numericAmount;

  useEffect(() => {
    if (!open || paymentMethod !== 'transferencia') {
      setTransferQrDataUrl('');
      return;
    }
    if (transferCfg.qrImageDataUrl) {
      setTransferQrDataUrl(transferCfg.qrImageDataUrl);
      return;
    }
    const payload = buildTransferQrPayload(
      transferCfg,
      brandName || 'TH3 BNB',
      invoice || 'VENTA',
      clientName.trim() || 'Cliente',
      qrChargeAmount
    );
    let cancelled = false;
    QRCode.toDataURL(payload, {
      width: 180,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setTransferQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setTransferQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, paymentMethod, transferCfg, brandName, invoice, clientName, qrChargeAmount]);

  const handleQtyChange = (val: number) => {
    const clean = Math.max(1, Math.floor(val || 1));
    setQuantity(clean);
    if (preselectedProduct) {
      const nextAmt = String(preselectedProduct.price * clean);
      setAmount(nextAmt);
      if (status === 'cobrado') {
        setDeposit(nextAmt);
      }
    }
  };

  const handleAmountChange = (val: string) => {
    setAmount(val);
    if (status === 'cobrado') {
      setDeposit(val);
    }
  };

  const handleDepositChange = (val: string) => {
    setDeposit(val);
    const numVal = Math.max(0, Number(val || 0));
    if (numericAmount > 0 && numVal >= numericAmount) {
      setStatus('cobrado');
    } else if (numericAmount > 0 && numVal < numericAmount) {
      setStatus('pendiente');
    }
  };

  const handleStatusChange = (nextStatus: 'pendiente' | 'cobrado') => {
    setStatus(nextStatus);
    if (nextStatus === 'cobrado') {
      setDeposit(amount);
    } else if (Number(deposit || 0) >= numericAmount) {
      setDeposit('0');
    }
  };

  const matchedClient = clients.find(
    (c) => c.name.trim().toLowerCase() === clientName.trim().toLowerCase()
  );

  const submitSale = async (openPrintAfter: boolean) => {
    if (!clientName.trim()) {
      notify('Ingresá el nombre del cliente.', 'error');
      return;
    }
    const cleanAmount = Math.max(0, Number(amount || 0));
    if (cleanAmount <= 0) {
      notify('Ingresá un monto mayor a 0.', 'error');
      return;
    }

    if (
      preselectedProduct &&
      preselectedProduct.trackStock &&
      !preselectedProduct.allowNoStock &&
      quantity > preselectedProduct.stock
    ) {
      notify(`Stock insuficiente (disponible: ${preselectedProduct.stock} u.).`, 'error');
      return;
    }

    const cleanDeposit =
      status === 'cobrado'
        ? cleanAmount
        : Math.min(cleanAmount, Math.max(0, Number(deposit || 0)));

    const serializedStatus = serializeSaleStatus({
      status,
      method: paymentMethod,
      deposit: cleanDeposit,
      amount: cleanAmount,
    });

    setSaving(true);
    try {
      let resolvedClientId = matchedClient?.id;

      if (!resolvedClientId) {
        resolvedClientId = generateDocId('clients');
        await upsertRow(
          'clients',
          stripUndefined({
            id: resolvedClientId,
            ownerId,
            name: clampStr(clientName, 160),
          })
        );
      }

      const saleId = generateDocId('sales');
      const finalInvoice = clampStr(invoice || `FV-${Date.now().toString().slice(-4)}`, 60);
      const finalDueDate = clampStr(dueDate, 40);
      const salePayload = stripUndefined({
        id: saleId,
        ownerId,
        clientId: clampStr(resolvedClientId, 128),
        clientName: clampStr(clientName, 160),
        invoice: finalInvoice,
        productId: clampStr(preselectedProduct?.id, 128),
        productName: clampStr(preselectedProduct?.name, 200),
        quantity: preselectedProduct ? quantity : undefined,
        amount: cleanAmount,
        status: serializedStatus,
        dueDate: finalDueDate,
      });

      await upsertRow('sales', salePayload);

      if (preselectedProduct && preselectedProduct.trackStock) {
        await updateRow('products', preselectedProduct.id, {
          stock: Math.max(0, preselectedProduct.stock - quantity),
        });
      }

      const createdRecord: SaleRecord = {
        id: saleId,
        ownerId,
        clientId: resolvedClientId,
        clientName: clampStr(clientName, 160),
        invoice: finalInvoice,
        productId: preselectedProduct?.id,
        productName: preselectedProduct?.name,
        quantity: preselectedProduct ? quantity : undefined,
        amount: cleanAmount,
        status: serializedStatus,
        dueDate: finalDueDate,
        createdAt: Date.now(),
      };

      notify('Venta registrada.');
      onClose();
      if (openPrintAfter) {
        onCreated?.(createdRecord);
      }
    } catch (err) {
      console.error(err);
      notify('No se pudo guardar la venta.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitSale(false);
  };

  return (
    <ModalShell open={open} onClose={onClose} title="Nueva venta" maxWidth="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {preselectedProduct && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50/70 p-3.5 dark:border-sky-900/60 dark:bg-sky-950/30">
            <div className="flex min-w-0 items-center gap-2.5">
              <Package className="h-5 w-5 shrink-0 text-[#0072BB] dark:text-sky-400" />
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                  {preselectedProduct.name}
                </div>
                <div className="text-xs text-slate-500">
                  {formatCurrency(preselectedProduct.price)} c/u · Stock: {preselectedProduct.stock}
                </div>
              </div>
            </div>
            <div className="w-20 shrink-0">
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">
                Cantidad
              </label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => handleQtyChange(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-center font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Nombre del cliente *
          </label>
          <input
            type="text"
            required
            list="sale-clients-datalist"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Escribí o seleccioná un cliente"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <datalist id="sale-clients-datalist">
            {clients.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <p className="mt-1 text-[11px] text-slate-500">
            {matchedClient
              ? 'Cliente existente seleccionado.'
              : 'Si es nuevo, se agregará automáticamente a Clientes.'}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Comprobante / Factura
            </label>
            <input
              type="text"
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Fecha / Vencimiento
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Monto total *
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="25000"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Anticipo / Seña
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={status === 'cobrado' ? amount : deposit}
              onChange={(e) => handleDepositChange(e.target.value)}
              placeholder="0"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">Saldo pendiente:</span>
              <span
                className={`font-mono-num font-bold ${
                  pendingBalance > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {formatCurrency(pendingBalance)}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Medio de pago
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'efectivo', label: 'Efectivo', icon: Banknote },
                  { id: 'transferencia', label: 'Transfer.', icon: Landmark },
                  { id: 'tarjeta', label: 'Tarjeta', icon: CreditCard },
                ] as const
              ).map(({ id, label, icon: Icon }) => {
                const active = paymentMethod === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPaymentMethod(id)}
                    className={`flex h-10 items-center justify-center gap-1 rounded-xl border px-2 text-xs font-semibold transition ${
                      active
                        ? 'border-[#0072BB] bg-[#0072BB] text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Estado del cobro
            </label>
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value as 'pendiente' | 'cobrado')}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="cobrado">Cobrado (total)</option>
              <option value="pendiente">Pendiente / Con seña</option>
            </select>
          </div>
        </div>

        {paymentMethod === 'transferencia' && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900/60 dark:bg-sky-950/30">
            {transferQrDataUrl && (
              <img
                src={transferQrDataUrl}
                alt="QR de transferencia"
                className="h-20 w-20 shrink-0 rounded-xl border border-slate-200 bg-white p-1"
              />
            )}
            <div className="min-w-0 flex-1 text-xs">
              <div className="font-bold text-slate-900 dark:text-white">
                Transferencia · {formatCurrency(qrChargeAmount)}
              </div>
              {transferCfg.alias && (
                <div className="mt-0.5 text-slate-600 dark:text-slate-300">
                  Alias: <strong className="font-mono-num">{transferCfg.alias}</strong>
                </div>
              )}
              {transferCfg.cbu && (
                <div className="text-slate-600 dark:text-slate-300">
                  CBU/CVU: <strong className="font-mono-num">{transferCfg.cbu}</strong>
                </div>
              )}
              {transferCfg.holder && (
                <div className="text-slate-500 dark:text-slate-400">
                  Titular: {transferCfg.holder}
                </div>
              )}
              {!transferCfg.alias && !transferCfg.cbu && !transferCfg.paymentLink && (
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Podés configurar tu Alias/CBU o QR propio desde el detalle de cualquier reparación al cobrar por transferencia.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-xl border border-[#0072BB] px-3 text-sm font-semibold text-[#0072BB] hover:bg-sky-50 dark:border-sky-500 dark:text-sky-400 dark:hover:bg-sky-950/40"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submitSale(true)}
            className="inline-flex h-11 flex-[1.3] items-center justify-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-sm font-semibold text-white hover:bg-[#005f9c]"
          >
            <Printer className="h-4 w-4 shrink-0" />
            <span>{saving ? 'Guardando...' : 'Guardar e imprimir'}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

interface NewPurchaseModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  suppliers: SupplierRecord[];
}

export const NewPurchaseModal: React.FC<NewPurchaseModalProps> = ({
  open,
  onClose,
  ownerId,
  suppliers,
}) => {
  const { notify } = useToast();
  const [supplierName, setSupplierName] = useState('');
  const [invoice, setInvoice] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<'pendiente' | 'pagado'>('pendiente');
  const [dueDate, setDueDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplierName('');
    setInvoice(`FC-${Math.floor(100 + Math.random() * 900)}`);
    setAmount('');
    setStatus('pendiente');
    setDueDate(todayISO());
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierName.trim()) {
      notify('Ingresá el proveedor.', 'error');
      return;
    }
    const cleanAmount = Math.max(0, Number(amount || 0));
    if (cleanAmount <= 0) {
      notify('Ingresá un monto mayor a 0.', 'error');
      return;
    }
    setSaving(true);
    const purchaseId = generateDocId('purchases');
    try {
      const matched = suppliers.find(
        (s) => s.name.trim().toLowerCase() === supplierName.trim().toLowerCase()
      );
      await upsertRow(
        'purchases',
        stripUndefined({
          id: purchaseId,
          ownerId,
          supplierId: clampStr(matched?.id, 128),
          supplierName: clampStr(supplierName, 160),
          invoice: clampStr(invoice || `FC-${Date.now().toString().slice(-4)}`, 60),
          amount: cleanAmount,
          status,
          dueDate: clampStr(dueDate, 40),
        })
      );
      notify('Compra registrada.');
      onClose();
    } catch (err) {
      console.error(err);
      notify('No se pudo guardar la compra.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell open={open} onClose={onClose} title="Nueva compra" maxWidth="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Proveedor *
            </label>
            <input
              type="text"
              required
              list="purchase-suppliers-datalist"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="Nombre del proveedor"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <datalist id="purchase-suppliers-datalist">
              {suppliers.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Factura
            </label>
            <input
              type="text"
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Monto *
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="18000"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Estado
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'pendiente' | 'pagado')}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="pendiente">Pendiente</option>
              <option value="pagado">Pagado</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Vencimiento
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c]"
          >
            {saving ? 'Guardando...' : 'Guardar compra'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
