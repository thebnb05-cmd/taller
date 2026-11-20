import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, Coins, PackagePlus, Plus, Trash2 } from 'lucide-react';
import {
  clampStr,
  generateDocId,
  stripUndefined,
  updateRow,
  upsertRow,
} from '../lib/db';
import type {
  ProductRecord,
  PurchaseRecord,
  SupplierRecord,
  TaskRecord,
  WorkshopProfile,
} from '../types/workshop';
import {
  appendMovementToOpenCashShift,
  findOpenCashShift,
} from '../utils/cashRegister';
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
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../utils/payment';
import {
  parsePurchaseInfo,
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
import { useI18n } from '../utils/i18n';

interface NewPurchaseModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  suppliers: SupplierRecord[];
  products?: ProductRecord[];
  tasks?: TaskRecord[];
  profile?: WorkshopProfile | null;
  editPurchase?: PurchaseRecord | null;
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
  tasks = [],
  profile,
  editPurchase = null,
}) => {
  const { notify } = useToast();
  const { tr } = useI18n();
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

  // Optional cash register egreso when marking as paid
  const [deductFromCash, setDeductFromCash] = useState(false);
  const [cashMethod, setCashMethod] = useState<PaymentMethod>('efectivo');

  const [saving, setSaving] = useState(false);

  const openShift = useMemo(() => findOpenCashShift(tasks), [tasks]);
  const editParsedInfo = useMemo(
    () => (editPurchase ? parsePurchaseInfo(editPurchase) : null),
    [editPurchase]
  );

  const selectableCurrencies: CurrencyCode[] = useMemo(
    () =>
      Array.from(
        new Set([
          baseCurrency,
          ...secondaryCurrencies.map((c) => c.code),
          ...(editParsedInfo?.currency ? [editParsedInfo.currency] : []),
        ])
      ),
    [baseCurrency, secondaryCurrencies, editParsedInfo?.currency]
  );

  const selectedCurrencyOption = getCurrencyOption(selectedCurrency);
  const baseCurrencyOption = getCurrencyOption(baseCurrency);
  const currencySymbol = selectedCurrencyOption.symbol;
  const activeRate =
    getCurrencyRateFromBase(selectedCurrency, baseCurrency, secondaryCurrencies) ??
    (editParsedInfo?.currency === selectedCurrency && editParsedInfo.rate
      ? editParsedInfo.rate
      : 1);
  const isSecondaryCurrency = selectedCurrency !== baseCurrency && activeRate !== 1;

  useEffect(() => {
    if (!open) return;
    if (editPurchase) {
      const info = parsePurchaseInfo(editPurchase);
      const hasConfigured =
        info.currency &&
        (info.currency === baseCurrency ||
          secondaryCurrencies.some((c) => c.code === info.currency) ||
          Boolean(info.rate));
      const initCur: CurrencyCode =
        hasConfigured && info.currency ? info.currency : baseCurrency;
      const initRate =
        getCurrencyRateFromBase(initCur, baseCurrency, secondaryCurrencies) ??
        (info.currency === initCur && info.rate ? info.rate : 1);
      const initIsSec = initCur !== baseCurrency && initRate !== 1;

      setSelectedCurrency(initCur);
      setSupplierName(editPurchase.supplierName || '');
      setInvoice(editPurchase.invoice || '');
      setAmount(
        String(
          initIsSec
            ? roundCurrencyValue(
                convertFromBaseCurrency(Number(editPurchase.amount || 0), initRate)
              )
            : Number(editPurchase.amount || 0)
        )
      );
      setStatus(info.isPaid ? 'pagado' : 'pendiente');
      setCategory(info.category);
      setNote(info.note);
      setDueDate(editPurchase.dueDate || todayISO());
      setStockLines(
        info.stockItems.map((l) => ({
          ...l,
          unitCost:
            initIsSec && l.unitCost > 0
              ? roundCurrencyValue(convertFromBaseCurrency(l.unitCost, initRate))
              : l.unitCost,
        }))
      );
    } else {
      setSelectedCurrency(baseCurrency);
      setSupplierName('');
      setInvoice(`FC-${Math.floor(100 + Math.random() * 900)}`);
      setAmount('');
      setStatus('pendiente');
      setCategory('repuestos');
      setNote('');
      setDueDate(todayISO());
      setStockLines([]);
    }
    setPickedProductId('');
    setPickedQty('1');
    setPickedCost('');
    setDeductFromCash(false);
    setCashMethod('efectivo');
  }, [open, editPurchase, baseCurrency, secondaryCurrencies]);

  const numericAmount = parseSafePositiveNumber(amount, 0);
  const baseEquivalentAmount = isSecondaryCurrency
    ? roundCurrencyValue(convertToBaseCurrency(numericAmount, activeRate))
    : numericAmount;

  const canOfferCashDeduction = Boolean(
    openShift &&
      status === 'pagado' &&
      (!editPurchase || !editParsedInfo?.isPaid)
  );

  const handleCurrencyChange = (nextRaw: string) => {
    const nextCode = sanitizeCurrencyCode(nextRaw);
    if (nextCode === selectedCurrency) return;
    const nextRate =
      getCurrencyRateFromBase(nextCode, baseCurrency, secondaryCurrencies) ??
      (editParsedInfo?.currency === nextCode && editParsedInfo.rate ? editParsedInfo.rate : 1);

    const convertVal = (val: number) => {
      if (
        getCurrencyRateFromBase(selectedCurrency, baseCurrency, secondaryCurrencies) &&
        getCurrencyRateFromBase(nextCode, baseCurrency, secondaryCurrencies)
      ) {
        return roundCurrencyValue(
          convertBetweenCurrencies(
            val,
            selectedCurrency,
            nextCode,
            baseCurrency,
            secondaryCurrencies
          )
        );
      }
      const inBase =
        selectedCurrency === baseCurrency ? val : convertToBaseCurrency(val, activeRate);
      const inNext =
        nextCode === baseCurrency ? inBase : convertFromBaseCurrency(inBase, nextRate);
      return roundCurrencyValue(inNext);
    };

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

    const cleanInvoice = sanitizePlainLine(
      invoice || `FC-${Date.now().toString().slice(-4)}`,
      60
    );

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
    try {
      const matched = suppliers.find(
        (s) => s.name.trim().toLowerCase() === cleanSupplier.toLowerCase()
      );
      const recordData = stripUndefined({
        supplierId: clampStr(matched?.id, 128),
        supplierName: cleanSupplier,
        invoice: cleanInvoice,
        amount: cleanBaseAmount,
        status: serializedStatus,
        dueDate: clampStr(dueDate, 40),
      });

      if (editPurchase) {
        await updateRow('purchases', editPurchase.id, recordData);
      } else {
        const purchaseId = generateDocId('purchases');
        await upsertRow(
          'purchases',
          stripUndefined({
            id: purchaseId,
            ownerId,
            ...recordData,
          })
        );
      }

      // Reconcile stock delta and update unit cost for linked inventory items
      const prevQtyByProduct = new Map<string, number>();
      if (editPurchase) {
        for (const prevLine of parsePurchaseInfo(editPurchase).stockItems) {
          if (!prevLine.productId) continue;
          prevQtyByProduct.set(
            prevLine.productId,
            (prevQtyByProduct.get(prevLine.productId) || 0) + prevLine.qty
          );
        }
      }
      const nextLineByProduct = new Map<string, PurchaseStockLine>();
      for (const nextLine of baseStockLines) {
        if (!nextLine.productId) continue;
        nextLineByProduct.set(nextLine.productId, nextLine);
      }
      const touchedIds = new Set<string>([
        ...prevQtyByProduct.keys(),
        ...nextLineByProduct.keys(),
      ]);

      let stockTouched = false;
      for (const productId of touchedIds) {
        const prod = products.find((p) => p.id === productId);
        if (!prod) continue;
        const prevQty = prevQtyByProduct.get(productId) || 0;
        const nextLine = nextLineByProduct.get(productId);
        const nextQty = nextLine?.qty || 0;
        const delta = nextQty - prevQty;
        const updates: Partial<ProductRecord> = {};
        if (prod.trackStock && delta !== 0) {
          updates.stock = Math.max(0, Number(prod.stock || 0) + delta);
          stockTouched = true;
        }
        if (nextLine && nextLine.unitCost > 0) {
          updates.cost = nextLine.unitCost;
        }
        if (Object.keys(updates).length > 0) {
          await updateRow('products', prod.id, updates);
        }
      }

      let recordedCashEgreso = false;
      if (canOfferCashDeduction && deductFromCash && cleanBaseAmount > 0) {
        const cashRes = await appendMovementToOpenCashShift({
          ownerId,
          tasks,
          movement: {
            type: 'egreso',
            amount: cleanBaseAmount,
            method: cashMethod,
            concept: `Compra: ${cleanSupplier}${cleanInvoice ? ` (${cleanInvoice})` : ''}`,
          },
        });
        recordedCashEgreso = cashRes.ok;
      }

      if (editPurchase) {
        notify(
          recordedCashEgreso
            ? 'Compra actualizada y egreso registrado en caja abierta.'
            : stockTouched
              ? 'Compra actualizada y stock ajustado en inventario.'
              : 'Compra actualizada.'
        );
      } else {
        notify(
          recordedCashEgreso
            ? 'Compra guardada y egreso registrado en la caja abierta.'
            : baseStockLines.length > 0
              ? 'Compra guardada y stock actualizado en inventario.'
              : 'Compra / gasto registrado.'
        );
      }
      onClose();
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo guardar la compra.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={
        editPurchase
          ? tr('Editar compra o gasto', 'Edit purchase or expense', 'Editar compra ou despesa')
          : tr('Nueva compra o gasto', 'New purchase or expense', 'Nova compra ou despesa')
      }
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {(secondaryCurrencies.length > 0 || selectableCurrencies.length > 1) && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <label
                  htmlFor="new-purchase-currency-select"
                  className="text-xs font-bold text-slate-800 dark:text-slate-100"
                >
                  {tr('Divisa de la compra', 'Purchase currency', 'Moeda da compra')}
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
              {selectableCurrencies.map((code) => {
                const opt = getCurrencyOption(code);
                if (code === baseCurrency) {
                  return (
                    <option key={code} value={code}>
                      {opt.label} · Base
                    </option>
                  );
                }
                const rate =
                  getCurrencyRateFromBase(code, baseCurrency, secondaryCurrencies) ??
                  (editParsedInfo?.currency === code && editParsedInfo.rate
                    ? editParsedInfo.rate
                    : 1);
                return (
                  <option key={code} value={code}>
                    {opt.label} · 1 {opt.symbol} = {formatCurrency(rate, baseCurrency)}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('Proveedor / Comercio *', 'Supplier / Merchant *', 'Fornecedor / Loja *')}
            </label>
            <input
              type="text"
              required
              list="purchase-suppliers-datalist"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder={tr('Ej: Mayorista Repuestos, Edesur, Alquiler', 'e.g. Parts Wholesale, Rent, Utilities', 'Ex: Atacado de Peças, Energia, Aluguel')}
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
              {tr('Categoría del gasto', 'Expense category', 'Categoria da despesa')}
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
              {tr('Comprobante / Factura', 'Receipt / Invoice', 'Comprovante / Fatura')}
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
              {tr('Fecha / Vencimiento', 'Date / Due date', 'Data / Vencimento')}
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
              {tr('Monto total', 'Total amount', 'Valor total')} ({currencySymbol}) *
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
                {tr('Equivale a', 'Equals', 'Equivale a')} {formatCurrency(baseEquivalentAmount, baseCurrency)} ({baseCurrencyOption.code})
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('Estado', 'Status', 'Status')}
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'pendiente' | 'pagado')}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="pendiente">{tr('Pendiente', 'Pending', 'Pendente')}</option>
              <option value="pagado">{tr('Pagado', 'Paid', 'Pago')}</option>
            </select>
          </div>
        </div>

        {canOfferCashDeduction && openShift && (
          <div className="space-y-2 rounded-2xl border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900/60 dark:bg-sky-950/30">
            <label className="flex cursor-pointer items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                <Banknote className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
                <span>
                  {tr(
                    `Registrar egreso en la caja diaria abierta (${openShift.shiftDate})`,
                    `Record expense in open cash register (${openShift.shiftDate})`,
                    `Registrar saída no caixa aberto (${openShift.shiftDate})`
                  )}
                </span>
              </span>
              <input
                type="checkbox"
                checked={deductFromCash}
                onChange={(e) => setDeductFromCash(e.target.checked)}
                className="h-4 w-4 rounded accent-[#0072BB]"
              />
            </label>
            {deductFromCash && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sky-200/80 pt-2 text-xs dark:border-sky-900/50">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-600 dark:text-slate-300">
                    {tr('Medio de pago:', 'Payment method:', 'Forma de pagamento:')}
                  </span>
                  <select
                    value={cashMethod}
                    onChange={(e) => setCashMethod(e.target.value as PaymentMethod)}
                    className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  >
                    {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </div>
                {baseEquivalentAmount > 0 && (
                  <span className="font-mono-num font-bold text-red-600 dark:text-red-400">
                    -{formatCurrency(baseEquivalentAmount, baseCurrency)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Optional Inventory Stock Increment */}
        {products.length > 0 && (
          <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
              <PackagePlus className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
              <span>{tr('Ingresar mercadería al stock (opcional)', 'Add items to inventory stock (optional)', 'Adicionar itens ao estoque (opcional)')}</span>
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
                  <option value="">{tr('Elegir producto del inventario...', 'Choose product from inventory...', 'Escolher produto do estoque...')}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({tr('Stock actual:', 'Current stock:', 'Estoque atual:')} {p.stock})
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
                  placeholder={tr('Cant.', 'Qty', 'Qtd.')}
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
                  placeholder={`${tr('Costo', 'Cost', 'Custo')} ${currencySymbol}`}
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
                  {tr('Sumar', 'Add', 'Somar')}
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
                        +{line.qty} {tr('u.', 'u.', 'un.')}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      {line.unitCost > 0 && (
                        <span className="font-mono-num text-slate-500">
                          {tr('Costo c/u', 'Unit cost', 'Custo un.')} {formatCurrency(line.unitCost, selectedCurrency)}
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
            {tr('Nota / Concepto (opcional)', 'Note / Concept (optional)', 'Nota / Descrição (opcional)')}
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tr('Ej: Compra de módulos OLED, factura luz o alquiler local', 'e.g. OLED screens purchase, electricity bill or rent', 'Ex: Compra de telas OLED, conta de luz ou aluguel')}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
          >
            {tr('Cancelar', 'Cancel', 'Cancelar')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c]"
          >
            {saving
              ? tr('Guardando...', 'Saving...', 'Salvando...')
              : editPurchase
                ? tr('Guardar cambios', 'Save changes', 'Salvar alterações')
                : tr('Guardar compra', 'Save purchase', 'Salvar compra')}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

