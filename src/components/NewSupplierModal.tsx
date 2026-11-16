import React, { useEffect, useState } from 'react';
import {
  generateDocId,
  stripUndefined,
  updateRow,
  upsertRow,
} from '../lib/db';
import type { SupplierRecord } from '../types/workshop';
import {
  isValidEmail,
  parseSafePositiveNumber,
  sanitizeDbErrorMessage,
  sanitizeEmail,
  sanitizePhone,
  sanitizePlainLine,
} from '../utils/validation';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';

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
    const cleanName = sanitizePlainLine(name, 160);
    if (!cleanName) {
      notify('Ingresá el nombre del proveedor.', 'error');
      return;
    }
    const cleanEmail = sanitizeEmail(email, 200);
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      notify('El correo electrónico del proveedor no es válido.', 'error');
      return;
    }
    setSaving(true);
    try {
      const baseFields = stripUndefined({
        name: cleanName,
        category: sanitizePlainLine(category || 'Repuestos', 80) || 'Repuestos',
        contact: sanitizePlainLine(contact, 120),
        phone: sanitizePhone(phone, 60),
        email: cleanEmail,
        leadTime: sanitizePlainLine(leadTime, 60),
        balance: parseSafePositiveNumber(balance, 0),
      });
      if (editSupplier) {
        await updateRow('suppliers', editSupplier.id, baseFields);
        notify('Proveedor actualizado.');
      } else {
        const supplierId = generateDocId('suppliers');
        await upsertRow('suppliers', {
          id: supplierId,
          ...baseFields,
          ownerId,
        });
        notify('Proveedor guardado.');
      }
      onClose();
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo guardar el proveedor.'), 'error');
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
