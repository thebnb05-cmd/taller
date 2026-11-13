import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { Package } from 'lucide-react';
import {
  clampStr,
  db,
  generateDocId,
  handleFirestoreError,
  OperationType,
  stripUndefined,
} from '../lib/db';
import type { ClientRecord, ProductRecord, SupplierRecord } from '../types/workshop';
import { formatCurrency, todayISO } from '../utils/formatters';
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
    const path = `tasks/${taskId}`;
    try {
      await setDoc(
        doc(db, 'tasks', taskId),
        stripUndefined({
          ownerId,
          title: clampStr(title, 200),
          taskType,
          priority,
          assignee: clampStr(assignee, 100),
          dueDate: clampStr(dueDate, 40),
          status,
          notes: clampStr(notes, 1500),
          createdAt: serverTimestamp(),
        })
      );
      notify('Tarea agregada a la agenda.');
      onClose();
    } catch (err) {
      notify('No se pudo guardar la tarea.', 'error');
      handleFirestoreError(err, OperationType.CREATE, path);
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
        const path = `suppliers/${editSupplier.id}`;
        try {
          await updateDoc(doc(db, 'suppliers', editSupplier.id), baseFields);
          notify('Proveedor actualizado.');
        } catch (err) {
          notify('No se pudo guardar el proveedor.', 'error');
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        const supplierId = generateDocId('suppliers');
        const path = `suppliers/${supplierId}`;
        try {
          await setDoc(doc(db, 'suppliers', supplierId), {
            ...baseFields,
            ownerId,
            createdAt: serverTimestamp(),
          });
          notify('Proveedor guardado.');
        } catch (err) {
          notify('No se pudo guardar el proveedor.', 'error');
          handleFirestoreError(err, OperationType.CREATE, path);
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
}

export const NewSaleModal: React.FC<NewSaleModalProps> = ({
  open,
  onClose,
  ownerId,
  clients,
  preselectedProduct,
}) => {
  const { notify } = useToast();
  const [clientName, setClientName] = useState('');
  const [invoice, setInvoice] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<'pendiente' | 'cobrado'>('cobrado');
  const [dueDate, setDueDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClientName('');
    setInvoice(`FV-${Math.floor(1000 + Math.random() * 9000)}`);
    setQuantity(1);
    setAmount(preselectedProduct ? String(preselectedProduct.price) : '');
    setStatus('cobrado');
    setDueDate(todayISO());
  }, [open, preselectedProduct]);

  const handleQtyChange = (val: number) => {
    const clean = Math.max(1, Math.floor(val || 1));
    setQuantity(clean);
    if (preselectedProduct) {
      setAmount(String(preselectedProduct.price * clean));
    }
  };

  const matchedClient = clients.find(
    (c) => c.name.trim().toLowerCase() === clientName.trim().toLowerCase()
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

    setSaving(true);
    try {
      const batch = writeBatch(db);
      let resolvedClientId = matchedClient?.id;

      if (!resolvedClientId) {
        resolvedClientId = generateDocId('clients');
        batch.set(
          doc(db, 'clients', resolvedClientId),
          stripUndefined({
            ownerId,
            name: clampStr(clientName, 160),
            createdAt: serverTimestamp(),
          })
        );
      }

      const saleId = generateDocId('sales');
      batch.set(
        doc(db, 'sales', saleId),
        stripUndefined({
          ownerId,
          clientId: clampStr(resolvedClientId, 128),
          clientName: clampStr(clientName, 160),
          invoice: clampStr(invoice || `FV-${Date.now().toString().slice(-4)}`, 60),
          productId: clampStr(preselectedProduct?.id, 128),
          productName: clampStr(preselectedProduct?.name, 200),
          quantity: preselectedProduct ? quantity : undefined,
          amount: cleanAmount,
          status,
          dueDate: clampStr(dueDate, 40),
          createdAt: serverTimestamp(),
        })
      );

      if (preselectedProduct && preselectedProduct.trackStock) {
        batch.update(doc(db, 'products', preselectedProduct.id), {
          stock: Math.max(0, preselectedProduct.stock - quantity),
        });
      }

      await batch.commit();
      notify('Venta registrada.');
      onClose();
    } catch (err) {
      notify('No se pudo guardar la venta.', 'error');
      handleFirestoreError(err, OperationType.WRITE, 'sales');
    } finally {
      setSaving(false);
    }
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
              Monto *
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25000"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Estado
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'pendiente' | 'cobrado')}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="cobrado">Cobrado</option>
              <option value="pendiente">Pendiente</option>
            </select>
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
            {saving ? 'Guardando...' : 'Guardar venta'}
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
    const path = `purchases/${purchaseId}`;
    try {
      const matched = suppliers.find(
        (s) => s.name.trim().toLowerCase() === supplierName.trim().toLowerCase()
      );
      await setDoc(
        doc(db, 'purchases', purchaseId),
        stripUndefined({
          ownerId,
          supplierId: clampStr(matched?.id, 128),
          supplierName: clampStr(supplierName, 160),
          invoice: clampStr(invoice || `FC-${Date.now().toString().slice(-4)}`, 60),
          amount: cleanAmount,
          status,
          dueDate: clampStr(dueDate, 40),
          createdAt: serverTimestamp(),
        })
      );
      notify('Compra registrada.');
      onClose();
    } catch (err) {
      notify('No se pudo guardar la compra.', 'error');
      handleFirestoreError(err, OperationType.CREATE, path);
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
