import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Banknote, Coins, Copy, CreditCard, Landmark, Package, Printer, Settings2, Upload } from 'lucide-react';
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
  WorkshopProfile,
} from '../types/workshop';
import {
  convertBetweenCurrencies,
  convertFromBaseCurrency,
  convertToBaseCurrency,
  getCurrencyOption,
  getCurrencyRateFromBase,
  sanitizeCurrencyCode,
  useActiveCurrency,
  type CurrencyCode,
} from '../utils/currency';
import { compressImageToDataUrl, formatCurrency, todayISO } from '../utils/formatters';
import {
  buildTransferQrPayload,
  hydrateTransferConfig,
  loadTransferConfig,
  saveTransferConfig,
  type PaymentMethod,
  type TransferConfig,
} from '../utils/payment';
import { serializeSaleStatus } from '../utils/saleMeta';
import { parseWorkshopMeta } from '../utils/workshopMeta';
import {
  isValidEmail,
  parseSafeNonNegativeInt,
  parseSafePositiveNumber,
  sanitizeAlias,
  sanitizeCbu,
  sanitizeDbErrorMessage,
  sanitizeEmail,
  sanitizeImageDataUrl,
  sanitizePhone,
  sanitizePlainLine,
  sanitizeSafeUrl,
  sanitizeText,
} from '../utils/validation';
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
    const cleanTitle = sanitizePlainLine(title, 200);
    if (!cleanTitle) {
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
          title: cleanTitle,
          taskType,
          priority,
          assignee: sanitizePlainLine(assignee, 100),
          dueDate: clampStr(dueDate, 40),
          status,
          notes: sanitizeText(notes, 1500),
        })
      );
      notify('Tarea agregada a la agenda.');
      onClose();
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo guardar la tarea.'), 'error');
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

interface NewSaleModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  clients: ClientRecord[];
  preselectedProduct?: ProductRecord | null;
  profile?: WorkshopProfile | null;
  brandName?: string;
  onCreated?: (sale: SaleRecord) => void;
}

function roundCurrencyValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export const NewSaleModal: React.FC<NewSaleModalProps> = ({
  open,
  onClose,
  ownerId,
  clients,
  preselectedProduct,
  profile,
  brandName,
  onCreated,
}) => {
  const { notify } = useToast();
  const activeCurrency = useActiveCurrency();
  const workshopMeta = useMemo(() => parseWorkshopMeta(profile), [profile]);
  const baseCurrency: CurrencyCode = profile ? workshopMeta.currency : activeCurrency;
  const secondaryCurrencies = workshopMeta.secondaryCurrencies;

  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>(baseCurrency);
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
  const [transferCfg, setTransferCfg] = useState<TransferConfig>(() => loadTransferConfig(ownerId));
  const [editingTransferCfg, setEditingTransferCfg] = useState(false);

  const selectedCurrencyOption = getCurrencyOption(selectedCurrency);
  const baseCurrencyOption = getCurrencyOption(baseCurrency);
  const currencySymbol = selectedCurrencyOption.symbol;
  const activeRate =
    getCurrencyRateFromBase(selectedCurrency, baseCurrency, secondaryCurrencies) ?? 1;
  const isSecondaryCurrency = selectedCurrency !== baseCurrency && activeRate !== 1;

  useEffect(() => {
    if (!open) return;
    const initialAmount = preselectedProduct ? String(preselectedProduct.price) : '';
    const loadedCfg = loadTransferConfig(ownerId);
    setSelectedCurrency(baseCurrency);
    setClientName('');
    setInvoice(`FV-${Math.floor(1000 + Math.random() * 9000)}`);
    setQuantity(1);
    setAmount(initialAmount);
    setDeposit(initialAmount);
    setPaymentMethod('efectivo');
    setStatus('cobrado');
    setDueDate(todayISO());
    setTransferCfg(loadedCfg);
    setEditingTransferCfg(
      !loadedCfg.alias.trim() &&
        !loadedCfg.cbu.trim() &&
        !loadedCfg.paymentLink.trim() &&
        !loadedCfg.qrImageDataUrl
    );

    let cancelled = false;
    void hydrateTransferConfig(ownerId).then((hydrated) => {
      if (cancelled) return;
      setTransferCfg(hydrated);
      setEditingTransferCfg(
        !hydrated.alias.trim() &&
          !hydrated.cbu.trim() &&
          !hydrated.paymentLink.trim() &&
          !hydrated.qrImageDataUrl
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, ownerId, preselectedProduct, baseCurrency]);

  const numericAmount = parseSafePositiveNumber(amount, 0);
  const rawDeposit = parseSafePositiveNumber(deposit, 0);
  const numericDeposit =
    status === 'cobrado'
      ? numericAmount
      : Math.min(numericAmount > 0 ? numericAmount : rawDeposit, rawDeposit);
  const pendingBalance = Math.max(0, numericAmount - numericDeposit);
  const qrChargeAmount = status === 'cobrado' ? numericAmount : numericDeposit > 0 ? numericDeposit : numericAmount;
  const baseEquivalentAmount = isSecondaryCurrency
    ? roundCurrencyValue(convertToBaseCurrency(numericAmount, activeRate))
    : numericAmount;
  const effectiveBrandName = profile?.brandName || brandName || 'TH3 BNB';

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
      effectiveBrandName,
      invoice || 'VENTA',
      clientName.trim() || 'Cliente',
      qrChargeAmount
    );
    if (!payload) {
      setTransferQrDataUrl('');
      return;
    }
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
  }, [open, paymentMethod, transferCfg, effectiveBrandName, invoice, clientName, qrChargeAmount]);

  const handleCurrencyChange = (nextRaw: string) => {
    const nextCode = sanitizeCurrencyCode(nextRaw);
    if (nextCode === selectedCurrency) return;
    const nextRate =
      getCurrencyRateFromBase(nextCode, baseCurrency, secondaryCurrencies) ?? 1;

    if (preselectedProduct) {
      const baseTotal = preselectedProduct.price * Math.max(1, quantity);
      const nextAmountNum =
        nextCode === baseCurrency
          ? roundCurrencyValue(baseTotal)
          : roundCurrencyValue(convertFromBaseCurrency(baseTotal, nextRate));
      const nextAmtStr = String(nextAmountNum);
      setAmount(nextAmtStr);
      if (status === 'cobrado') {
        setDeposit(nextAmtStr);
      } else if (deposit.trim() && Number(deposit) > 0) {
        const convertedDep = roundCurrencyValue(
          convertBetweenCurrencies(
            Number(deposit),
            selectedCurrency,
            nextCode,
            baseCurrency,
            secondaryCurrencies
          )
        );
        setDeposit(String(convertedDep));
      }
    } else {
      if (amount.trim() && Number(amount) > 0) {
        const convertedAmt = roundCurrencyValue(
          convertBetweenCurrencies(
            Number(amount),
            selectedCurrency,
            nextCode,
            baseCurrency,
            secondaryCurrencies
          )
        );
        const nextAmtStr = String(convertedAmt);
        setAmount(nextAmtStr);
        if (status === 'cobrado') {
          setDeposit(nextAmtStr);
        }
      }
      if (status !== 'cobrado' && deposit.trim() && Number(deposit) > 0) {
        const convertedDep = roundCurrencyValue(
          convertBetweenCurrencies(
            Number(deposit),
            selectedCurrency,
            nextCode,
            baseCurrency,
            secondaryCurrencies
          )
        );
        setDeposit(String(convertedDep));
      }
    }

    setSelectedCurrency(nextCode);
  };

  const handleQtyChange = (val: number) => {
    const clean = Math.max(1, Math.floor(val || 1));
    setQuantity(clean);
    if (preselectedProduct) {
      const baseTotal = preselectedProduct.price * clean;
      const convertedTotal = isSecondaryCurrency
        ? roundCurrencyValue(convertFromBaseCurrency(baseTotal, activeRate))
        : roundCurrencyValue(baseTotal);
      const nextAmt = String(convertedTotal);
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
    const cleanClientName = sanitizePlainLine(clientName, 160);
    if (!cleanClientName) {
      notify('Ingresá el nombre del cliente.', 'error');
      return;
    }
    const cleanTxAmount = parseSafePositiveNumber(amount, 0);
    if (cleanTxAmount <= 0) {
      notify('Ingresá un monto mayor a 0.', 'error');
      return;
    }
    const cleanQty = Math.max(1, parseSafeNonNegativeInt(quantity, 1, 10_000));

    if (
      preselectedProduct &&
      preselectedProduct.trackStock &&
      !preselectedProduct.allowNoStock &&
      cleanQty > preselectedProduct.stock
    ) {
      notify(`Stock insuficiente (disponible: ${preselectedProduct.stock} u.).`, 'error');
      return;
    }

    if (paymentMethod === 'transferencia' && transferCfg.paymentLink.trim()) {
      if (!sanitizeSafeUrl(transferCfg.paymentLink, 400)) {
        notify('El link de pago debe empezar con https:// o http://', 'error');
        return;
      }
    }

    const cleanTxDeposit =
      status === 'cobrado'
        ? cleanTxAmount
        : Math.min(cleanTxAmount, parseSafePositiveNumber(deposit, 0));

    const cleanAmount = isSecondaryCurrency
      ? roundCurrencyValue(convertToBaseCurrency(cleanTxAmount, activeRate))
      : cleanTxAmount;
    const cleanDeposit =
      status === 'cobrado'
        ? cleanAmount
        : Math.min(
            cleanAmount,
            isSecondaryCurrency
              ? roundCurrencyValue(convertToBaseCurrency(cleanTxDeposit, activeRate))
              : cleanTxDeposit
          );

    const serializedStatus = serializeSaleStatus({
      status,
      method: paymentMethod,
      deposit: cleanDeposit,
      amount: cleanAmount,
      currency: selectedCurrency,
      rate: isSecondaryCurrency ? activeRate : undefined,
    });

    if (paymentMethod === 'transferencia') {
      saveTransferConfig(ownerId, {
        alias: sanitizeAlias(transferCfg.alias),
        cbu: sanitizeCbu(transferCfg.cbu),
        holder: sanitizePlainLine(transferCfg.holder, 120),
        paymentLink: sanitizeSafeUrl(transferCfg.paymentLink, 400),
        qrImageDataUrl: sanitizeImageDataUrl(transferCfg.qrImageDataUrl, 1_200_000),
      });
    }

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
            name: cleanClientName,
          })
        );
      }

      const saleId = generateDocId('sales');
      const finalInvoice = sanitizePlainLine(
        invoice || `FV-${Date.now().toString().slice(-4)}`,
        60
      );
      const finalDueDate = clampStr(dueDate, 40);
      const salePayload = stripUndefined({
        id: saleId,
        ownerId,
        clientId: clampStr(resolvedClientId, 128),
        clientName: cleanClientName,
        invoice: finalInvoice,
        productId: clampStr(preselectedProduct?.id, 128),
        productName: sanitizePlainLine(preselectedProduct?.name || '', 200),
        quantity: preselectedProduct ? cleanQty : undefined,
        amount: cleanAmount,
        status: serializedStatus,
        dueDate: finalDueDate,
      });

      await upsertRow('sales', salePayload);

      if (preselectedProduct && preselectedProduct.trackStock) {
        await updateRow('products', preselectedProduct.id, {
          stock: Math.max(0, preselectedProduct.stock - cleanQty),
        });
      }

      const createdRecord: SaleRecord = {
        id: saleId,
        ownerId,
        clientId: resolvedClientId,
        clientName: cleanClientName,
        invoice: finalInvoice,
        productId: preselectedProduct?.id,
        productName: preselectedProduct?.name,
        quantity: preselectedProduct ? cleanQty : undefined,
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
      notify(sanitizeDbErrorMessage(err, 'No se pudo guardar la venta.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitSale(false);
  };

  const handleCopyTransferValue = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copiado.`);
    } catch {
      notify('No se pudo copiar al portapapeles.', 'error');
    }
  };

  const handleSaveTransferCfg = () => {
    const rawLink = transferCfg.paymentLink.trim();
    const safeLink = sanitizeSafeUrl(rawLink, 400);
    if (rawLink && !safeLink) {
      notify('El link de pago debe empezar con https:// o http://', 'error');
      return;
    }
    const cleaned: TransferConfig = {
      alias: sanitizeAlias(transferCfg.alias),
      cbu: sanitizeCbu(transferCfg.cbu),
      holder: sanitizePlainLine(transferCfg.holder, 120),
      paymentLink: safeLink,
      qrImageDataUrl: sanitizeImageDataUrl(transferCfg.qrImageDataUrl, 1_200_000),
    };
    setTransferCfg(cleaned);
    saveTransferConfig(ownerId, cleaned);
    setEditingTransferCfg(false);
    notify('Datos de transferencia guardados (cifrados).');
  };

  const handleUploadTransferQr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Usá una imagen PNG, JPG o WebP.', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      notify('La imagen del QR no puede superar 2 MB.', 'error');
      return;
    }
    try {
      const dataUrl = await compressImageToDataUrl(file, 480, 0.85);
      const safeQr = sanitizeImageDataUrl(dataUrl, 1_200_000);
      if (!safeQr) {
        notify('La imagen procesada supera el límite permitido.', 'error');
        return;
      }
      const nextCfg = { ...transferCfg, qrImageDataUrl: safeQr };
      setTransferCfg(nextCfg);
      saveTransferConfig(ownerId, nextCfg);
      notify('Captura del QR guardada.');
    } catch {
      notify('No se pudo procesar la imagen del QR.', 'error');
    }
  };

  const hasTransferData = Boolean(
    transferCfg.alias.trim() ||
      transferCfg.cbu.trim() ||
      transferCfg.holder.trim() ||
      transferCfg.paymentLink.trim() ||
      transferCfg.qrImageDataUrl
  );

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
                  {formatCurrency(
                    isSecondaryCurrency
                      ? roundCurrencyValue(convertFromBaseCurrency(preselectedProduct.price, activeRate))
                      : preselectedProduct.price,
                    selectedCurrency
                  )}{' '}
                  c/u · Stock: {preselectedProduct.stock}
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

        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <label
                htmlFor="new-sale-currency-select"
                className="text-xs font-bold text-slate-800 dark:text-slate-100"
              >
                Divisa de la transacción
              </label>
            </div>
            {isSecondaryCurrency ? (
              <span className="rounded-lg bg-emerald-50 px-2 py-0.5 font-mono-num text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                1 {currencySymbol} = {formatCurrency(activeRate, baseCurrency)}
              </span>
            ) : (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Moneda base del taller
              </span>
            )}
          </div>
          <select
            id="new-sale-currency-select"
            value={selectedCurrency}
            onChange={(e) => handleCurrencyChange(e.target.value)}
            className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          >
            <option value={baseCurrency}>
              {baseCurrencyOption.label} · Base
            </option>
            {secondaryCurrencies.map((sec) => {
              const secOpt = getCurrencyOption(sec.code);
              return (
                <option key={sec.code} value={sec.code}>
                  {secOpt.label} · 1 {secOpt.symbol} = {formatCurrency(sec.rate, baseCurrency)}
                </option>
              );
            })}
          </select>
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
              Monto total ({currencySymbol}) *
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
            {isSecondaryCurrency && numericAmount > 0 && (
              <div className="mt-1 font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                Equivale a {formatCurrency(baseEquivalentAmount, baseCurrency)} ({baseCurrencyOption.code})
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Anticipo / Seña ({currencySymbol})
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
                {formatCurrency(pendingBalance, selectedCurrency)}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Método de pago
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'efectivo', label: 'Efectivo', icon: Banknote },
                  { id: 'tarjeta', label: 'Tarjeta', icon: CreditCard },
                  { id: 'transferencia', label: 'Transferencia', icon: Landmark },
                ] as const
              ).map(({ id, label, icon: Icon }) => {
                const active = paymentMethod === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPaymentMethod(id)}
                    className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-semibold transition ${
                      active
                        ? 'border-[#0072BB] bg-[#0072BB] text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
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
          <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/70 p-3.5 dark:border-sky-900/60 dark:bg-sky-950/30">
            <div className="flex flex-wrap items-start gap-3">
              {transferQrDataUrl && (
                <img
                  src={transferQrDataUrl}
                  alt="QR de transferencia"
                  className="h-20 w-20 shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-1"
                />
              )}
              <div className="min-w-0 flex-1 space-y-1.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 dark:text-white">
                    Datos de transferencia · {formatCurrency(qrChargeAmount, selectedCurrency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingTransferCfg((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                  >
                    <Settings2 className="h-3 w-3" />
                    {editingTransferCfg ? 'Ocultar edición' : 'Editar Alias / CBU / QR'}
                  </button>
                </div>

                {transferCfg.alias.trim() && (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-2.5 py-1 dark:bg-slate-900/70">
                    <span className="truncate text-slate-700 dark:text-slate-200">
                      Alias: <strong className="font-mono-num">{transferCfg.alias}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyTransferValue(transferCfg.alias.trim(), 'Alias')}
                      className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                    >
                      <Copy className="h-3 w-3" />
                      Copiar
                    </button>
                  </div>
                )}

                {transferCfg.cbu.trim() && (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-2.5 py-1 dark:bg-slate-900/70">
                    <span className="truncate text-slate-700 dark:text-slate-200">
                      CBU/CVU: <strong className="font-mono-num">{transferCfg.cbu}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyTransferValue(transferCfg.cbu.trim(), 'CBU/CVU')}
                      className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                    >
                      <Copy className="h-3 w-3" />
                      Copiar
                    </button>
                  </div>
                )}

                {transferCfg.holder.trim() && (
                  <div className="text-[11px] text-slate-600 dark:text-slate-300">
                    Titular: <strong>{transferCfg.holder}</strong>
                  </div>
                )}

                {!hasTransferData && !editingTransferCfg && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Cargá tu Alias o CBU/CVU para que aparezca en la boleta impresa.
                  </div>
                )}
              </div>
            </div>

            {editingTransferCfg && (
              <div className="space-y-2.5 border-t border-sky-200/80 pt-3 dark:border-sky-900/60">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      Alias
                    </label>
                    <input
                      type="text"
                      value={transferCfg.alias}
                      onChange={(e) =>
                        setTransferCfg((prev) => ({ ...prev, alias: e.target.value }))
                      }
                      placeholder="ej: taller.th3bnb"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      CBU / CVU
                    </label>
                    <input
                      type="text"
                      value={transferCfg.cbu}
                      onChange={(e) =>
                        setTransferCfg((prev) => ({ ...prev, cbu: e.target.value }))
                      }
                      placeholder="22 dígitos"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      Titular (opcional)
                    </label>
                    <input
                      type="text"
                      value={transferCfg.holder}
                      onChange={(e) =>
                        setTransferCfg((prev) => ({ ...prev, holder: e.target.value }))
                      }
                      placeholder="Nombre o razón social"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      Link de pago MP (opcional)
                    </label>
                    <input
                      type="url"
                      value={transferCfg.paymentLink}
                      onChange={(e) =>
                        setTransferCfg((prev) => ({ ...prev, paymentLink: e.target.value }))
                      }
                      placeholder="https://mpago.la/..."
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      <Upload className="h-3.5 w-3.5" />
                      Subir QR (MP / Banco)
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleUploadTransferQr}
                        className="hidden"
                      />
                    </label>
                    {transferCfg.qrImageDataUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          const nextCfg = { ...transferCfg, qrImageDataUrl: '' };
                          setTransferCfg(nextCfg);
                          saveTransferConfig(ownerId, nextCfg);
                        }}
                        className="text-[11px] font-semibold text-red-600 hover:underline dark:text-red-400"
                      >
                        Quitar QR
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveTransferCfg}
                    className="h-8 rounded-lg bg-[#0072BB] px-3 text-[11px] font-semibold text-white hover:bg-[#005f9c]"
                  >
                    Guardar datos
                  </button>
                </div>
              </div>
            )}
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
  const activeCurrency = useActiveCurrency();
  const currencySymbol = getCurrencyOption(activeCurrency).symbol;
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
    const cleanSupplier = sanitizePlainLine(supplierName, 160);
    if (!cleanSupplier) {
      notify('Ingresá el proveedor.', 'error');
      return;
    }
    const cleanAmount = parseSafePositiveNumber(amount, 0);
    if (cleanAmount <= 0) {
      notify('Ingresá un monto mayor a 0.', 'error');
      return;
    }
    setSaving(true);
    const purchaseId = generateDocId('purchases');
    try {
      const matched = suppliers.find(
        (s) => s.name.trim().toLowerCase() === cleanSupplier.toLowerCase()
      );
      await upsertRow(
        'purchases',
        stripUndefined({
          id: purchaseId,
          ownerId,
          supplierId: clampStr(matched?.id, 128),
          supplierName: cleanSupplier,
          invoice: sanitizePlainLine(
            invoice || `FC-${Date.now().toString().slice(-4)}`,
            60
          ),
          amount: cleanAmount,
          status,
          dueDate: clampStr(dueDate, 40),
        })
      );
      notify('Compra registrada.');
      onClose();
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo guardar la compra.'), 'error');
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
              Monto ({currencySymbol}) *
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
