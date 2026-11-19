import React, { useEffect, useMemo, useState } from 'react';
import { Coins, PackagePlus, Plus, Trash2 } from 'lucide-react';
import {
  clampStr,
  generateDocId,
  stripUndefined,
  updateRow,
  upsertRow,
} from '../lib/db';
import type { ProductRecord, SupplierRecord, WorkshopProfile } from '../types/workshop';
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
import { formatCurrency, todayISO } from '../utils/formatters';
import {
  PURCHASE_CATEGORY_LABELS,
  serializePurchaseStatus,
  type PurchaseCategory,
  type PurchaseStockLine,
} from '../utils/purchaseMeta';
import { parseWorkshopMeta } from '../utils/workshopMeta';
import {
  parseSafePositiveNumber,
  sanitizeDbErrorMessage,
  sanitizePlainLine,
  sanitizeText,
} from '../utils/validation';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';

interface NewPurchaseModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  suppliers: SupplierRecord[];
  products?: ProductRecord[];
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
  products = [],
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
  const [category, setCategory] = useState<PurchaseCategory>('repuestos');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState(todayISO());

  // Optional inventory stock entry lines
  const [stockLines, setStockLines] = useState<PurchaseStockLine[]>([]);
  const [pickedProductId, setPickedProductId] = useState('');
  const [pickedQty, setPickedQty] = useState('1');
  const [pickedCost, setPickedCost] = useState('');

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
    setCategory('repuestos');
    setNote('');
    setDueDate(todayISO());
    setStockLines([]);
    setPickedProductId('');
    setPickedQty('1');
    setPickedCost('');
  }, [open, baseCurrency]);

  const numericAmount = parseSafePositiveNumber(amount, 0);
  const baseEquivalentAmount = isSecondaryCurrency
    ? roundCurrencyValue(convertToBaseCurrency(numericAmount, activeRate))
    : numericAmount;

  const handleCurrencyChange = (nextRaw: string) => {
    const nextCode = sanitizeCurrencyCode(nextRaw);
    if (nextCode === selectedCurrency) return;
    const convertVal = (val: number) =>
      roundCurrencyValue(
        convertBetweenCurrencies(
          val,
          selectedCurrency,
          nextCode,
          baseCurrency,
          secondaryCurrencies
        )
      );
    if (amount.trim() && Number(amount) > 0) {
      setAmount(String(convertVal(Number(amount))));
    }
    if (pickedCost.trim() && Number(pickedCost) > 0) {
      setPickedCost(String(convertVal(Number(pickedCost))));
    }
    setStockLines((prev) =>
      prev.map((l) => ({
        ...l,
        unitCost: l.unitCost > 0 ? convertVal(l.unitCost) : l.unitCost,
      }))
    );
    setSelectedCurrency(nextCode);
  };

  const handleAddStockLine = () => {
    const prod = products.find((p) => p.id === pickedProductId);
    if (!prod) {
      notify('Elegí un producto del inventario para sumar stock.', 'error');
      return;
    }
    const qty = Math.max(1, Math.round(parseSafePositiveNumber(pickedQty, 1)));
    const fallbackCostDisplay =
      prod.cost > 0
        ? isSecondaryCurrency
          ? roundCurrencyValue(convertFromBaseCurrency(prod.cost, activeRate))
          : prod.cost
        : 0;
    const unitCost = parseSafePositiveNumber(pickedCost, fallbackCostDisplay);

    const nextLines = [...stockLines];
    const existingIdx = nextLines.findIndex((l) => l.productId === prod.id);
    if (existingIdx >= 0) {
      nextLines[existingIdx] = {
        ...nextLines[existingIdx],
        qty: nextLines[existingIdx].qty + qty,
        unitCost: unitCost > 0 ? unitCost : nextLines[existingIdx].unitCost,
      };
    } else {
      nextLines.push({
        productId: prod.id,
        name: prod.name,
        qty,
        unitCost: roundCurrencyValue(unitCost),
      });
    }
    setStockLines(nextLines);

    // Suggest total amount from stock lines if user hasn't manually entered an amount
    const linesSum = nextLines.reduce((sum, l) => sum + l.qty * l.unitCost, 0);
    if (linesSum > 0 && (!amount.trim() || Number(amount) <= 0)) {
      setAmount(String(roundCurrencyValue(linesSum)));
    }
    setPickedProductId('');
    setPickedQty('1');
    setPickedCost('');
  };

  const handleRemoveStockLine = (productId: string) => {
    setStockLines((prev) => prev.filter((l) => l.productId !== productId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSupplier = sanitizePlainLine(supplierName, 160);
    if (!cleanSupplier) {
      notify('Ingresá el proveedor o comercio.', 'error');
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

    const baseStockLines: PurchaseStockLine[] = stockLines.map((l) => ({
      ...l,
      unitCost: isSecondaryCurrency
        ? roundCurrencyValue(convertToBaseCurrency(l.unitCost, activeRate))
        : l.unitCost,
    }));

    const serializedStatus = serializePurchaseStatus({
      status,
      currency: selectedCurrency,
      rate: isSecondaryCurrency ? activeRate : undefined,
      category,
      note: sanitizeText(note, 400),
      stockItems: baseStockLines,
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

      // Increment stock and update unit cost for linked inventory items
      for (const line of baseStockLines) {
        const prod = products.find((p) => p.id === line.productId);
        if (!prod) continue;
        const updates: Partial<ProductRecord> = {};
        if (prod.trackStock) {
          updates.stock = Math.max(0, Number(prod.stock || 0) + line.qty);
        }
        if (line.unitCost > 0) {
          updates.cost = line.unitCost;
        }
        if (Object.keys(updates).length > 0) {
          await updateRow('products', prod.id, updates);
        }
      }

      notify(
        baseStockLines.length > 0
          ? 'Compra guardada y stock actualizado en inventario.'
          : 'Compra / gasto registrado.'
      );
      onClose();
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo guardar la compra.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell open={open} onClose={onClose} title="Nueva compra o gasto" maxWidth="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {secondaryCurrencies.length > 0 && (
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
              {isSecondaryCurrency && (
                <span className="font-mono-num text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  1 {currencySymbol} = {formatCurrency(activeRate, baseCurrency)}
                </span>
              )}
            </div>
            <select
              id="new-purchase-currency-select"
              value={selectedCurrency}
              onChange={(e) => handleCurrencyChange(e.target.value)}
              className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value={baseCurrency}>{baseCurrencyOption.label} · Base</option>
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
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Proveedor / Comercio *
            </label>
            <input
              type="text"
              required
              list="purchase-suppliers-datalist"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="Ej: Mayorista Repuestos, Edesur, Alquiler"
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
              Categoría del gasto
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as PurchaseCategory)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              {(Object.keys(PURCHASE_CATEGORY_LABELS) as PurchaseCategory[]).map((cat) => (
                <option key={cat} value={cat}>
                  {PURCHASE_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

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

        {/* Optional Inventory Stock Increment */}
        {products.length > 0 && (
          <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
              <PackagePlus className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
              <span>Ingresar mercadería al stock (opcional)</span>
            </div>

            <div className="grid gap-2 sm:grid-cols-12">
              <div className="sm:col-span-6">
                <select
                  value={pickedProductId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setPickedProductId(id);
                    const p = products.find((item) => item.id === id);
                    if (p && p.cost > 0) {
                      const costDisplay = isSecondaryCurrency
                        ? roundCurrencyValue(convertFromBaseCurrency(p.cost, activeRate))
                        : p.cost;
                      setPickedCost(String(costDisplay));
                    } else {
                      setPickedCost('');
                    }
                  }}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  <option value="">Elegir producto del inventario...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Stock actual: {p.stock})
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <input
                  type="number"
                  min="1"
                  value={pickedQty}
                  onChange={(e) => setPickedQty(e.target.value)}
                  placeholder="Cant."
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-center font-mono-num text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={pickedCost}
                  onChange={(e) => setPickedCost(e.target.value)}
                  placeholder={`Costo ${currencySymbol}`}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-right font-mono-num text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleAddStockLine}
                  className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-lg bg-[#0072BB] px-2 text-xs font-semibold text-white hover:bg-[#005f9c]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Sumar
                </button>
              </div>
            </div>

            {stockLines.length > 0 && (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                {stockLines.map((line) => (
                  <div
                    key={line.productId}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                  >
                    <span className="truncate font-semibold text-slate-800 dark:text-slate-100">
                      {line.name} ·{' '}
                      <span className="font-mono-num text-[#0072BB] dark:text-sky-400">
                        +{line.qty} u.
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      {line.unitCost > 0 && (
                        <span className="font-mono-num text-slate-500">
                          Costo c/u {formatCurrency(line.unitCost, selectedCurrency)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveStockLine(line.productId)}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Nota / Concepto (opcional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej: Compra de módulos OLED, factura luz o alquiler local"
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
