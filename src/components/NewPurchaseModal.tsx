import React, { useEffect, useMemo, useState } from 'react';
import { Coins } from 'lucide-react';
import {
  clampStr,
  generateDocId,
  stripUndefined,
  upsertRow,
} from '../lib/db';
import type { SupplierRecord, WorkshopProfile } from '../types/workshop';
import {
  convertBetweenCurrencies,
  convertToBaseCurrency,
  getCurrencyOption,
  getCurrencyRateFromBase,
  sanitizeCurrencyCode,
  useActiveCurrency,
  type CurrencyCode,
} from '../utils/currency';
import { formatCurrency, todayISO } from '../utils/formatters';
import { serializePurchaseStatus } from '../utils/purchaseMeta';
import { parseWorkshopMeta } from '../utils/workshopMeta';
import {
  parseSafePositiveNumber,
  sanitizeDbErrorMessage,
  sanitizePlainLine,
} from '../utils/validation';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';

interface NewPurchaseModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  suppliers: SupplierRecord[];
  profile?: WorkshopProfile | null;
}

function roundCurrencyValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export const NewPurchaseModal: React.FC<NewPurchaseModalProps> = ({
  open,
  onClose,
  ownerId,
  suppliers,
  profile,
}) => {
  const { notify } = useToast();
  const activeCurrency = useActiveCurrency();
  const workshopMeta = useMemo(() => parseWorkshopMeta(profile), [profile]);
  const baseCurrency: CurrencyCode = profile ? workshopMeta.currency : activeCurrency;
  const secondaryCurrencies = workshopMeta.secondaryCurrencies;

  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>(baseCurrency);
  const [supplierName, setSupplierName] = useState('');
  const [invoice, setInvoice] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<'pendiente' | 'pagado'>('pendiente');
  const [dueDate, setDueDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  const selectedCurrencyOption = getCurrencyOption(selectedCurrency);
  const baseCurrencyOption = getCurrencyOption(baseCurrency);
  const currencySymbol = selectedCurrencyOption.symbol;
  const activeRate =
    getCurrencyRateFromBase(selectedCurrency, baseCurrency, secondaryCurrencies) ?? 1;
  const isSecondaryCurrency = selectedCurrency !== baseCurrency && activeRate !== 1;

  useEffect(() => {
    if (!open) return;
    setSelectedCurrency(baseCurrency);
    setSupplierName('');
    setInvoice(`FC-${Math.floor(100 + Math.random() * 900)}`);
    setAmount('');
    setStatus('pendiente');
    setDueDate(todayISO());
  }, [open, baseCurrency]);

  const numericAmount = parseSafePositiveNumber(amount, 0);
  const baseEquivalentAmount = isSecondaryCurrency
    ? roundCurrencyValue(convertToBaseCurrency(numericAmount, activeRate))
    : numericAmount;

  const handleCurrencyChange = (nextRaw: string) => {
    const nextCode = sanitizeCurrencyCode(nextRaw);
    if (nextCode === selectedCurrency) return;
    if (amount.trim() && Number(amount) > 0) {
      const converted = roundCurrencyValue(
        convertBetweenCurrencies(
          Number(amount),
          selectedCurrency,
          nextCode,
          baseCurrency,
          secondaryCurrencies
        )
      );
      setAmount(String(converted));
    }
    setSelectedCurrency(nextCode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSupplier = sanitizePlainLine(supplierName, 160);
    if (!cleanSupplier) {
      notify('Ingresá el proveedor.', 'error');
      return;
    }
    const cleanTxAmount = parseSafePositiveNumber(amount, 0);
    if (cleanTxAmount <= 0) {
      notify('Ingresá un monto mayor a 0.', 'error');
      return;
    }

    const cleanBaseAmount = isSecondaryCurrency
      ? roundCurrencyValue(convertToBaseCurrency(cleanTxAmount, activeRate))
      : cleanTxAmount;

    const serializedStatus = serializePurchaseStatus({
      status,
      currency: selectedCurrency,
      rate: isSecondaryCurrency ? activeRate : undefined,
    });

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
          amount: cleanBaseAmount,
          status: serializedStatus,
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
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <label
                htmlFor="new-purchase-currency-select"
                className="text-xs font-bold text-slate-800 dark:text-slate-100"
              >
                Divisa de la compra
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
            id="new-purchase-currency-select"
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
            {isSecondaryCurrency && numericAmount > 0 && (
              <div className="mt-1 font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                Equivale a {formatCurrency(baseEquivalentAmount, baseCurrency)} ({baseCurrencyOption.code})
              </div>
            )}
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
