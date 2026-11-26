import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Banknote,
  Camera,
  CheckCircle2,
  Coins,
  Copy,
  CreditCard,
  Landmark,
  Loader2,
  Minus,
  Package,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  ScanBarcode,
  Search,
  Settings2,
  Smartphone,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
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
  WorkshopProfile,
} from '../types/workshop';
import {
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
  cancelMercadoPagoOrder,
  checkMercadoPagoOrderStatus,
  createMercadoPagoOrder,
  hydrateMercadoPagoConfig,
  loadMercadoPagoConfig,
  resolvePointDisplayName,
  saveMercadoPagoConfig,
  type MercadoPagoConfig,
} from '../utils/mercadoPago';
import {
  buildTransferQrPayload,
  hydrateTransferConfig,
  loadTransferConfig,
  saveTransferConfig,
  type PaymentMethod,
  type TransferConfig,
} from '../utils/payment';
import {
  parseSaleDetails,
  parseSalePaymentInfo,
  serializeSaleStatus,
  summarizeSaleItemsLabel,
  type SaleAdjustmentType,
  type SaleCartItem,
  type SalePaymentEntry,
} from '../utils/saleMeta';
import {
  dismissRecoveredPayment,
  markPaymentReconciled,
  recordPaymentAttempt,
  recordRecoveredPayment,
} from '../utils/paymentLedger';
import {
  syncRecoveredEntryToPurchase,
  syncSaleToPurchases,
} from '../utils/mpPurchasesSync';
import {
  loadSavedTransferQrIvaPct,
  saveTransferQrIvaPct,
  TRANSFER_QR_IVA_PRESETS,
} from '../utils/repairMeta';
import {
  parseWorkshopMeta,
  saveMercadoPagoConfigToProfile,
  syncMercadoPagoConfigFromProfile,
} from '../utils/workshopMeta';
import {
  parseSafePositiveNumber,
  sanitizeAlias,
  sanitizeCbu,
  sanitizeDbErrorMessage,
  sanitizeImageDataUrl,
  sanitizePlainLine,
  sanitizeSafeUrl,
  sanitizeText,
} from '../utils/validation';
import { useI18n } from '../utils/i18n';
import { ModalShell } from './ModalShell';
import { PaymentSettingsModal } from './PaymentSettingsPanel';
import { useToast } from './ToastProvider';

interface NewSaleModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  clients: ClientRecord[];
  products?: ProductRecord[];
  preselectedProduct?: ProductRecord | null;
  preselectedCartItems?: Array<{ product: ProductRecord; quantity: number }>;
  editSale?: SaleRecord | null;
  profile?: WorkshopProfile | null;
  brandName?: string;
  onCreated?: (sale: SaleRecord) => void;
  onSaved?: (sale: SaleRecord) => void;
}

function roundCurrencyValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function makeCartItemId(): string {
  return `ci-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

interface ActiveMpOrder {
  mode: 'qr' | 'point';
  apiFamily: 'orders_v1' | 'legacy_qr' | 'legacy_intent';
  orderId: string;
  externalReference: string;
  amount: number;
  qrImageDataUrl?: string;
  status: 'pending' | 'paid' | 'canceled' | 'failed';
  statusText: string;
  companionPointOrderId?: string;
  companionPointApiFamily?: 'orders_v1';
  companionPointExternalReference?: string;
  companionPointWarning?: string;
}

export const NewSaleModal: React.FC<NewSaleModalProps> = ({
  open,
  onClose,
  ownerId,
  clients,
  products = [],
  preselectedProduct,
  preselectedCartItems,
  editSale,
  profile,
  brandName,
  onCreated,
  onSaved,
}) => {
  const { notify } = useToast();
  const { tr } = useI18n();
  const activeCurrency = useActiveCurrency();
  const workshopMeta = useMemo(() => parseWorkshopMeta(profile), [profile]);
  const baseCurrency: CurrencyCode = profile ? workshopMeta.currency : activeCurrency;
  const secondaryCurrencies = workshopMeta.secondaryCurrencies;

  const editPayInfo = useMemo(
    () => (editSale ? parseSalePaymentInfo(editSale) : null),
    [editSale]
  );

  const selectableCurrencies = useMemo(() => {
    const list: Array<{ code: CurrencyCode; rate: number; isBase: boolean }> = [
      { code: baseCurrency, rate: 1, isBase: true },
    ];
    for (const sec of secondaryCurrencies) {
      if (sec.code !== baseCurrency && !list.some((item) => item.code === sec.code)) {
        list.push({ code: sec.code, rate: sec.rate, isBase: false });
      }
    }
    if (
      editPayInfo?.currency &&
      editPayInfo.currency !== baseCurrency &&
      !list.some((item) => item.code === editPayInfo.currency) &&
      editPayInfo.rate &&
      editPayInfo.rate > 0
    ) {
      list.push({
        code: editPayInfo.currency,
        rate: editPayInfo.rate,
        isBase: false,
      });
    }
    return list;
  }, [baseCurrency, secondaryCurrencies, editPayInfo?.currency, editPayInfo?.rate]);

  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>(baseCurrency);
  const [secondaryPreviewCode, setSecondaryPreviewCode] = useState<CurrencyCode | null>(
    secondaryCurrencies[0]?.code ?? null
  );
  const initSessionKeyRef = useRef<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [invoice, setInvoice] = useState('');
  const [cartItems, setCartItems] = useState<SaleCartItem[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualQty, setManualQty] = useState('1');
  const [manualPrice, setManualPrice] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);

  const [discountType, setDiscountType] = useState<SaleAdjustmentType>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [surchargeType, setSurchargeType] = useState<SaleAdjustmentType>('percent');
  const [surchargeValue, setSurchargeValue] = useState('');
  const [applyTransferQrIva, setApplyTransferQrIva] = useState(false);
  const [transferQrIvaPct, setTransferQrIvaPct] = useState(() =>
    String(loadSavedTransferQrIvaPct())
  );
  const [ivaTouchedManually, setIvaTouchedManually] = useState(false);
  const [saleNote, setSaleNote] = useState('');

  const [deposit, setDeposit] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo');
  const [status, setStatus] = useState<'pendiente' | 'cobrado'>('cobrado');
  const [dueDate, setDueDate] = useState(todayISO());
  const [existingPayments, setExistingPayments] = useState<SalePaymentEntry[]>([]);
  const [saving, setSaving] = useState(false);

  // Camera barcode scanner state
  const [scanning, setScanning] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);

  const [transferQrDataUrl, setTransferQrDataUrl] = useState('');
  const [transferCfg, setTransferCfg] = useState<TransferConfig>(() => loadTransferConfig(ownerId));
  const [editingTransferCfg, setEditingTransferCfg] = useState(false);
  const [mpConfig, setMpConfig] = useState<MercadoPagoConfig>(() => loadMercadoPagoConfig(ownerId));
  const [showMpSettings, setShowMpSettings] = useState(false);
  const [mpOrder, setMpOrder] = useState<ActiveMpOrder | null>(null);
  const [mpBusy, setMpBusy] = useState(false);
  const [showQrOnPointSmart, setShowQrOnPointSmart] = useState(true);

  const selectedCurrencyOption = getCurrencyOption(selectedCurrency);
  const baseCurrencyOption = getCurrencyOption(baseCurrency);
  const currencySymbol = selectedCurrencyOption.symbol;

  const getRateForCode = (code: CurrencyCode): number | null => {
    if (code === baseCurrency) return 1;
    const configured = getCurrencyRateFromBase(code, baseCurrency, secondaryCurrencies);
    if (configured && configured > 0) return configured;
    if (editPayInfo?.currency === code && editPayInfo.rate && editPayInfo.rate > 0) {
      return editPayInfo.rate;
    }
    return null;
  };

  const activeRate = getRateForCode(selectedCurrency) ?? 1;
  const isSecondaryCurrency = selectedCurrency !== baseCurrency && activeRate !== 1;

  const stopScanner = () => {
    if (scanTimerRef.current !== null) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    if (!open) {
      initSessionKeyRef.current = null;
      stopScanner();
      return;
    }

    const preselectedCartKey =
      preselectedCartItems && preselectedCartItems.length > 0
        ? preselectedCartItems.map((it) => `${it.product.id}:${it.quantity}`).join(',')
        : '';
    const sessionKey = `${ownerId}|${editSale?.id || ''}|${preselectedProduct?.id || ''}|${preselectedCartKey}`;
    if (initSessionKeyRef.current === sessionKey) {
      return;
    }
    initSessionKeyRef.current = sessionKey;

    const loadedCfg = loadTransferConfig(ownerId);
    setTransferCfg(loadedCfg);
    setMpConfig(loadMercadoPagoConfig(ownerId));
    setMpOrder(null);
    setMpBusy(false);
    setProductQuery('');
    setManualName('');
    setManualQty('1');
    setManualPrice('');
    setScannerStatus('');
    setEditingTransferCfg(
      !loadedCfg.alias.trim() &&
        !loadedCfg.cbu.trim() &&
        !loadedCfg.paymentLink.trim() &&
        !loadedCfg.qrImageDataUrl
    );

    if (editSale) {
      const payInfo = parseSalePaymentInfo(editSale);
      const details = parseSaleDetails(editSale);
      const editCur = payInfo.currency || baseCurrency;
      const editRate =
        getCurrencyRateFromBase(editCur, baseCurrency, secondaryCurrencies) ??
        payInfo.rate ??
        1;
      const convertForDisplay = editCur !== baseCurrency && editRate > 0 && editRate !== 1;
      const toDisplay = (baseVal: number) =>
        convertForDisplay
          ? roundCurrencyValue(convertFromBaseCurrency(baseVal, editRate))
          : roundCurrencyValue(baseVal);

      setSelectedCurrency(editCur);
      setSecondaryPreviewCode(
        editCur !== baseCurrency ? editCur : (secondaryCurrencies[0]?.code ?? null)
      );
      setClientName(editSale.clientName || '');
      setInvoice(editSale.invoice || '');
      setDueDate(editSale.dueDate || todayISO());
      setPaymentMethod(payInfo.method || 'efectivo');
      setStatus(payInfo.isPaid ? 'cobrado' : 'pendiente');
      setExistingPayments(details.payments);
      setSaleNote(details.note || '');
      setDiscountType(details.discountType);
      setDiscountValue(
        details.discountValue > 0
          ? String(
              details.discountType === 'fixed'
                ? toDisplay(details.discountValue)
                : details.discountValue
            )
          : ''
      );
      setSurchargeType(details.surchargeType);
      setSurchargeValue(
        details.surchargeValue > 0
          ? String(
              details.surchargeType === 'fixed'
                ? toDisplay(details.surchargeValue)
                : details.surchargeValue
            )
          : ''
      );
      if (details.transferQrIvaPct > 0 && details.transferQrIvaAmount > 0) {
        setApplyTransferQrIva(true);
        setTransferQrIvaPct(String(details.transferQrIvaPct));
        setIvaTouchedManually(true);
      } else {
        setApplyTransferQrIva(false);
        setTransferQrIvaPct(String(loadSavedTransferQrIvaPct()));
        setIvaTouchedManually(false);
      }
      setCartItems(
        details.items.map((it) => {
          const unitDisplay = toDisplay(it.unitPrice);
          return {
            ...it,
            unitPrice: unitDisplay,
            subtotal: roundCurrencyValue(unitDisplay * it.quantity),
          };
        })
      );
      setDeposit(String(toDisplay(payInfo.deposit)));
      setShowManualForm(false);
    } else if (preselectedCartItems && preselectedCartItems.length > 0) {
      setSelectedCurrency(baseCurrency);
      setSecondaryPreviewCode(secondaryCurrencies[0]?.code ?? null);
      setClientName('');
      setInvoice(`FV-${Math.floor(1000 + Math.random() * 9000)}`);
      setDueDate(todayISO());
      setPaymentMethod('efectivo');
      setStatus('cobrado');
      setExistingPayments([]);
      setSaleNote('');
      setDiscountType('percent');
      setDiscountValue('');
      setSurchargeType('percent');
      setSurchargeValue('');
      setApplyTransferQrIva(false);
      setTransferQrIvaPct(String(loadSavedTransferQrIvaPct()));
      setIvaTouchedManually(false);
      const initialCart: SaleCartItem[] = preselectedCartItems.map((entry, idx) => {
        const qty = Math.max(1, Math.round(Number(entry.quantity || 1)));
        const unitPrice = roundCurrencyValue(Number(entry.product.price || 0));
        return {
          id: `${makeCartItemId()}-${idx}`,
          productId: entry.product.id,
          name: entry.product.name,
          sku: entry.product.sku || entry.product.barcode || undefined,
          quantity: qty,
          unitPrice,
          subtotal: roundCurrencyValue(qty * unitPrice),
        };
      });
      const initialTotal = roundCurrencyValue(
        initialCart.reduce((sum, it) => sum + it.subtotal, 0)
      );
      setCartItems(initialCart);
      setDeposit(String(initialTotal));
      setShowManualForm(false);
    } else if (preselectedProduct) {
      setSelectedCurrency(baseCurrency);
      setSecondaryPreviewCode(secondaryCurrencies[0]?.code ?? null);
      setClientName('');
      setInvoice(`FV-${Math.floor(1000 + Math.random() * 9000)}`);
      setDueDate(todayISO());
      setPaymentMethod('efectivo');
      setStatus('cobrado');
      setExistingPayments([]);
      setSaleNote('');
      setDiscountType('percent');
      setDiscountValue('');
      setSurchargeType('percent');
      setSurchargeValue('');
      setApplyTransferQrIva(false);
      setTransferQrIvaPct(String(loadSavedTransferQrIvaPct()));
      setIvaTouchedManually(false);
      const unitPrice = roundCurrencyValue(Number(preselectedProduct.price || 0));
      setCartItems([
        {
          id: makeCartItemId(),
          productId: preselectedProduct.id,
          name: preselectedProduct.name,
          sku: preselectedProduct.sku || preselectedProduct.barcode || undefined,
          quantity: 1,
          unitPrice,
          subtotal: unitPrice,
        },
      ]);
      setDeposit(String(unitPrice));
      setShowManualForm(false);
    } else {
      setSelectedCurrency(baseCurrency);
      setSecondaryPreviewCode(secondaryCurrencies[0]?.code ?? null);
      setClientName('');
      setInvoice(`FV-${Math.floor(1000 + Math.random() * 9000)}`);
      setDueDate(todayISO());
      setPaymentMethod('efectivo');
      setStatus('cobrado');
      setExistingPayments([]);
      setSaleNote('');
      setDiscountType('percent');
      setDiscountValue('');
      setSurchargeType('percent');
      setSurchargeValue('');
      setApplyTransferQrIva(false);
      setTransferQrIvaPct(String(loadSavedTransferQrIvaPct()));
      setIvaTouchedManually(false);
      setCartItems([]);
      setDeposit('');
      setShowManualForm(products.length === 0);
    }

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
    void hydrateMercadoPagoConfig(ownerId).then((hydratedMp) => {
      if (cancelled) return;
      if (!hydratedMp.accessToken && !hydratedMp.terminalId && !hydratedMp.posExternalId) {
        const synced = syncMercadoPagoConfigFromProfile(ownerId, profile);
        setMpConfig(synced || hydratedMp);
      } else {
        setMpConfig(hydratedMp);
      }
    });
    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [
    open,
    ownerId,
    preselectedProduct,
    preselectedCartItems,
    editSale,
    baseCurrency,
    secondaryCurrencies,
    profile,
    products.length,
  ]);

  const subtotalDisplay = useMemo(
    () =>
      roundCurrencyValue(
        cartItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
      ),
    [cartItems]
  );

  const rawDiscountVal = parseSafePositiveNumber(discountValue, 0);
  const discountAmountDisplay = useMemo(() => {
    if (subtotalDisplay <= 0 || rawDiscountVal <= 0) return 0;
    const raw =
      discountType === 'percent'
        ? (subtotalDisplay * Math.min(100, rawDiscountVal)) / 100
        : rawDiscountVal;
    return roundCurrencyValue(Math.min(subtotalDisplay, raw));
  }, [subtotalDisplay, discountType, rawDiscountVal]);

  const afterDiscount = Math.max(0, subtotalDisplay - discountAmountDisplay);

  const rawSurchargeVal = parseSafePositiveNumber(surchargeValue, 0);
  const surchargeAmountDisplay = useMemo(() => {
    if (afterDiscount <= 0 || rawSurchargeVal <= 0) return 0;
    const raw =
      surchargeType === 'percent'
        ? (afterDiscount * Math.min(500, rawSurchargeVal)) / 100
        : rawSurchargeVal;
    return roundCurrencyValue(raw);
  }, [afterDiscount, surchargeType, rawSurchargeVal]);

  const afterAdjustmentsDisplay = roundCurrencyValue(afterDiscount + surchargeAmountDisplay);
  const parsedTransferQrIvaPct = Math.max(
    0,
    Math.min(100, parseSafePositiveNumber(transferQrIvaPct, 0))
  );
  const transferQrIvaAmountDisplay =
    applyTransferQrIva && afterAdjustmentsDisplay > 0 && parsedTransferQrIvaPct > 0
      ? roundCurrencyValue(afterAdjustmentsDisplay * (parsedTransferQrIvaPct / 100))
      : 0;

  const totalDisplay = roundCurrencyValue(afterAdjustmentsDisplay + transferQrIvaAmountDisplay);

  useEffect(() => {
    if (status === 'cobrado') {
      setDeposit(totalDisplay > 0 ? String(totalDisplay) : '');
    }
  }, [totalDisplay, status]);

  const rawDeposit = parseSafePositiveNumber(deposit, 0);
  const numericDeposit =
    status === 'cobrado'
      ? totalDisplay
      : Math.min(totalDisplay > 0 ? totalDisplay : rawDeposit, rawDeposit);
  const pendingBalance = Math.max(0, roundCurrencyValue(totalDisplay - numericDeposit));
  const qrChargeAmount =
    status === 'cobrado' ? totalDisplay : numericDeposit > 0 ? numericDeposit : totalDisplay;
  const baseEquivalentAmount = isSecondaryCurrency
    ? roundCurrencyValue(convertToBaseCurrency(totalDisplay, activeRate))
    : totalDisplay;

  const effectiveSecondaryTarget = useMemo(() => {
    if (isSecondaryCurrency) {
      return { code: selectedCurrency, rate: activeRate };
    }
    if (secondaryCurrencies.length === 0) return null;
    const matched = secondaryPreviewCode
      ? secondaryCurrencies.find((item) => item.code === secondaryPreviewCode)
      : undefined;
    return matched ?? secondaryCurrencies[0];
  }, [isSecondaryCurrency, selectedCurrency, activeRate, secondaryCurrencies, secondaryPreviewCode]);

  const dualCurrencySummary = useMemo(() => {
    if (!effectiveSecondaryTarget || effectiveSecondaryTarget.rate <= 0) return null;
    const baseAmount = isSecondaryCurrency
      ? baseEquivalentAmount
      : roundCurrencyValue(totalDisplay);
    const secondaryAmount = isSecondaryCurrency
      ? roundCurrencyValue(totalDisplay)
      : roundCurrencyValue(
          convertFromBaseCurrency(totalDisplay, effectiveSecondaryTarget.rate)
        );
    const pendingCounterpartAmount = isSecondaryCurrency
      ? roundCurrencyValue(convertToBaseCurrency(pendingBalance, activeRate))
      : roundCurrencyValue(
          convertFromBaseCurrency(pendingBalance, effectiveSecondaryTarget.rate)
        );
    return {
      secondaryCode: effectiveSecondaryTarget.code,
      secondaryOption: getCurrencyOption(effectiveSecondaryTarget.code),
      rate: effectiveSecondaryTarget.rate,
      baseAmount,
      secondaryAmount,
      pendingCounterpartAmount,
      pendingCounterpartCode: isSecondaryCurrency
        ? baseCurrency
        : effectiveSecondaryTarget.code,
    };
  }, [
    effectiveSecondaryTarget,
    isSecondaryCurrency,
    baseEquivalentAmount,
    totalDisplay,
    pendingBalance,
    activeRate,
    baseCurrency,
  ]);

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

  // Automatic status polling for active Mercado Pago QR, companion Point QR, or Point card orders
  useEffect(() => {
    if (!open || !mpOrder || mpOrder.status !== 'pending' || !mpConfig.accessToken.trim()) {
      return;
    }

    let cancelled = false;
    const token = mpConfig.accessToken.trim();

    const handlePaidConfirmation = (viaCompanionPoint: boolean) => {
      const mpChannel = mpOrder.mode === 'point' ? 'mp_point' : 'mp_qr';
      const methodForOrder: PaymentMethod = mpOrder.mode === 'point' ? 'tarjeta' : 'transferencia';
      const itemSummary =
        cartItems.length > 0
          ? summarizeSaleItemsLabel(cartItems)
          : manualName.trim() || (mpOrder.mode === 'point' ? 'Cobro Point Smart' : 'Cobro QR Mercado Pago');

      const pointDisplayName = resolvePointDisplayName(mpConfig);
      const recovered = recordRecoveredPayment({
        id: mpOrder.orderId,
        ownerId,
        source: 'venta',
        method: methodForOrder,
        mpChannel,
        mpPointName: pointDisplayName,
        amount: mpOrder.amount,
        totalAmount: mpOrder.amount,
        clientName: clientName.trim() || 'Mostrador',
        title: itemSummary,
        subtitle: viaCompanionPoint
          ? 'Aprobado vía QR en Point Smart (pendiente de guardar venta)'
          : mpOrder.mode === 'point'
            ? 'Aprobado en Point Smart (pendiente de guardar venta)'
            : 'Aprobado vía QR Mercado Pago (pendiente de guardar venta)',
        invoice: invoice.trim() || undefined,
        mpOrderId: mpOrder.orderId,
        mpCompanionOrderId: mpOrder.companionPointOrderId,
        mpExternalReference: mpOrder.externalReference,
        saveFailed: false,
      });
      if (recovered) {
        void syncRecoveredEntryToPurchase(ownerId, recovered, mpConfig);
      }

      // Cancel the counterpart order so the customer cannot pay twice
      if (viaCompanionPoint && mpOrder.orderId) {
        void cancelMercadoPagoOrder({
          accessToken: token,
          orderId: mpOrder.orderId,
          apiFamily: mpOrder.apiFamily,
          posExternalId: mpConfig.posExternalId.trim(),
        }).catch(() => {});
      } else if (!viaCompanionPoint && mpOrder.companionPointOrderId) {
        void cancelMercadoPagoOrder({
          accessToken: token,
          orderId: mpOrder.companionPointOrderId,
          apiFamily: mpOrder.companionPointApiFamily || 'orders_v1',
          terminalId: mpConfig.terminalId.trim(),
        }).catch(() => {});
      }

      setMpOrder((prev) =>
        prev && prev.orderId === mpOrder.orderId
          ? {
              ...prev,
              status: 'paid',
              statusText: viaCompanionPoint
                ? 'Pago aprobado vía QR en Point Smart y acreditado en Mercado Pago.'
                : 'Pago aprobado y acreditado en Mercado Pago.',
            }
          : prev
      );
      setStatus('cobrado');
      setDeposit(String(totalDisplay));
      notify('¡Pago aprobado en Mercado Pago!');
    };

    const poll = async () => {
      try {
        const res = await checkMercadoPagoOrderStatus({
          accessToken: token,
          orderId: mpOrder.orderId,
          apiFamily: mpOrder.apiFamily,
          externalReference: mpOrder.externalReference,
        });
        if (cancelled) return;

        if (res.ok && res.isPaid) {
          handlePaidConfirmation(false);
          return;
        }

        if (mpOrder.companionPointOrderId) {
          const ptRes = await checkMercadoPagoOrderStatus({
            accessToken: token,
            orderId: mpOrder.companionPointOrderId,
            apiFamily: mpOrder.companionPointApiFamily || 'orders_v1',
            externalReference: mpOrder.companionPointExternalReference,
          });
          if (cancelled) return;
          if (ptRes.ok && ptRes.isPaid) {
            handlePaidConfirmation(true);
            return;
          }
          if (res.ok && res.isCanceled && (!ptRes.ok || ptRes.isCanceled)) {
            setMpOrder((prev) =>
              prev && prev.orderId === mpOrder.orderId
                ? {
                    ...prev,
                    status: 'canceled',
                    statusText: 'La orden fue cancelada o expiró.',
                  }
                : prev
            );
            return;
          }
          if (res.ok && res.isFailed && (!ptRes.ok || ptRes.isFailed)) {
            recordPaymentAttempt({
              id: mpOrder.orderId,
              ownerId,
              source: 'venta',
              method: mpOrder.mode === 'point' ? 'tarjeta' : 'transferencia',
              mpChannel: mpOrder.mode === 'point' ? 'mp_point' : 'mp_qr',
              amount: mpOrder.amount,
              totalAmount: mpOrder.amount,
              clientName: clientName.trim() || 'Mostrador',
              title:
                cartItems.length > 0
                  ? summarizeSaleItemsLabel(cartItems)
                  : manualName.trim() || 'Intento de cobro MP',
              subtitle: 'Intento fallido o rechazado en Mercado Pago',
              invoice: invoice.trim() || undefined,
              mpOrderId: mpOrder.orderId,
              mpCompanionOrderId: mpOrder.companionPointOrderId,
              mpExternalReference: mpOrder.externalReference,
              mpApiFamily: mpOrder.apiFamily,
              attemptStatus: 'failed_attempt',
              rawError: 'El pago fue rechazado o requiere acción en Mercado Pago.',
            });
            setMpOrder((prev) =>
              prev && prev.orderId === mpOrder.orderId
                ? {
                    ...prev,
                    status: 'failed',
                    statusText: 'El pago fue rechazado o requiere acción.',
                  }
                : prev
            );
            return;
          }
        } else if (res.ok) {
          if (res.isCanceled) {
            setMpOrder((prev) =>
              prev && prev.orderId === mpOrder.orderId
                ? {
                    ...prev,
                    status: 'canceled',
                    statusText: 'La orden fue cancelada o expiró.',
                  }
                : prev
            );
          } else if (res.isFailed) {
            recordPaymentAttempt({
              id: mpOrder.orderId,
              ownerId,
              source: 'venta',
              method: mpOrder.mode === 'point' ? 'tarjeta' : 'transferencia',
              mpChannel: mpOrder.mode === 'point' ? 'mp_point' : 'mp_qr',
              amount: mpOrder.amount,
              totalAmount: mpOrder.amount,
              clientName: clientName.trim() || 'Mostrador',
              title:
                cartItems.length > 0
                  ? summarizeSaleItemsLabel(cartItems)
                  : manualName.trim() || 'Intento de cobro MP',
              subtitle: 'Intento fallido o rechazado en Mercado Pago',
              invoice: invoice.trim() || undefined,
              mpOrderId: mpOrder.orderId,
              mpCompanionOrderId: mpOrder.companionPointOrderId,
              mpExternalReference: mpOrder.externalReference,
              mpApiFamily: mpOrder.apiFamily,
              attemptStatus: 'failed_attempt',
              rawError: 'El pago fue rechazado o requiere acción en Mercado Pago.',
            });
            setMpOrder((prev) =>
              prev && prev.orderId === mpOrder.orderId
                ? {
                    ...prev,
                    status: 'failed',
                    statusText: 'El pago fue rechazado o requiere acción.',
                  }
                : prev
            );
          }
        }
      } catch {
        // Ignore transient poll failure
      }
    };

    const timer = window.setInterval(() => {
      void poll();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    open,
    mpOrder,
    mpConfig.accessToken,
    mpConfig.posExternalId,
    mpConfig.terminalId,
    totalDisplay,
    notify,
    ownerId,
    cartItems,
    manualName,
    clientName,
    invoice,
  ]);

  const addProductToCart = (product: ProductRecord) => {
    const unitDisplay = isSecondaryCurrency
      ? roundCurrencyValue(convertFromBaseCurrency(product.price, activeRate))
      : roundCurrencyValue(product.price);

    setCartItems((prev) => {
      const existing = prev.find((it) => it.productId === product.id);
      if (existing) {
        const nextQty = existing.quantity + 1;
        return prev.map((it) =>
          it.id === existing.id
            ? {
                ...it,
                quantity: nextQty,
                subtotal: roundCurrencyValue(nextQty * it.unitPrice),
              }
            : it
        );
      }
      return [
        ...prev,
        {
          id: makeCartItemId(),
          productId: product.id,
          name: product.name,
          sku: product.sku || product.barcode || undefined,
          quantity: 1,
          unitPrice: unitDisplay,
          subtotal: unitDisplay,
        },
      ];
    });
    setProductQuery('');
  };

  const handleAddManualItem = () => {
    const cleanName = sanitizePlainLine(manualName, 140);
    const cleanPrice = parseSafePositiveNumber(manualPrice, 0);
    const cleanQty = Math.max(1, Math.round(parseSafePositiveNumber(manualQty, 1)));
    if (!cleanName) {
      notify('Ingresá una descripción para el ítem manual.', 'error');
      return;
    }
    if (cleanPrice <= 0) {
      notify('Ingresá un precio unitario mayor a 0.', 'error');
      return;
    }
    setCartItems((prev) => [
      ...prev,
      {
        id: makeCartItemId(),
        name: cleanName,
        quantity: cleanQty,
        unitPrice: roundCurrencyValue(cleanPrice),
        subtotal: roundCurrencyValue(cleanQty * cleanPrice),
      },
    ]);
    setManualName('');
    setManualQty('1');
    setManualPrice('');
    setShowManualForm(false);
  };

  const handleUpdateCartQty = (itemId: string, nextQty: number) => {
    const cleanQty = Math.max(1, Math.min(10_000, Math.round(nextQty || 1)));
    setCartItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              quantity: cleanQty,
              subtotal: roundCurrencyValue(cleanQty * it.unitPrice),
            }
          : it
      )
    );
  };

  const handleUpdateCartUnitPrice = (itemId: string, rawPrice: string) => {
    const cleanPrice = parseSafePositiveNumber(rawPrice, 0);
    setCartItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              unitPrice: roundCurrencyValue(cleanPrice),
              subtotal: roundCurrencyValue(it.quantity * cleanPrice),
            }
          : it
      )
    );
  };

  const handleRemoveCartItem = (itemId: string) => {
    setCartItems((prev) => prev.filter((it) => it.id !== itemId));
  };

  const handleCurrencyChange = (nextRaw: string) => {
    const nextCode = sanitizeCurrencyCode(nextRaw);
    if (nextCode === selectedCurrency) return;

    const fromRate = getRateForCode(selectedCurrency) ?? 1;
    const toRate = getRateForCode(nextCode) ?? 1;
    const convertVal = (val: number) => {
      if (!Number.isFinite(val)) return 0;
      if (fromRate === toRate) return roundCurrencyValue(val);
      return roundCurrencyValue((val * fromRate) / toRate);
    };

    setCartItems((prev) =>
      prev.map((it) => {
        const product = it.productId ? products.find((p) => p.id === it.productId) : undefined;
        const nextUnit = product
          ? nextCode === baseCurrency
            ? roundCurrencyValue(product.price)
            : roundCurrencyValue(convertFromBaseCurrency(product.price, toRate))
          : convertVal(it.unitPrice);
        return {
          ...it,
          unitPrice: nextUnit,
          subtotal: roundCurrencyValue(nextUnit * it.quantity),
        };
      })
    );

    if (discountType === 'fixed' && discountValue.trim() && Number(discountValue) > 0) {
      setDiscountValue(String(convertVal(Number(discountValue))));
    }
    if (surchargeType === 'fixed' && surchargeValue.trim() && Number(surchargeValue) > 0) {
      setSurchargeValue(String(convertVal(Number(surchargeValue))));
    }
    if (status !== 'cobrado' && deposit.trim() && Number(deposit) > 0) {
      setDeposit(String(convertVal(Number(deposit))));
    }
    if (nextCode !== baseCurrency) {
      setSecondaryPreviewCode(nextCode);
    }
    setSelectedCurrency(nextCode);
  };

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return products.slice(0, 8);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q) ||
          (p.internalCode || '').toLowerCase().includes(q) ||
          (p.brand || '').toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [products, productQuery]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const q = productQuery.trim().toLowerCase();
    if (!q) return;
    const exactMatch = products.find(
      (p) =>
        (p.barcode || '').trim().toLowerCase() === q ||
        (p.sku || '').trim().toLowerCase() === q ||
        (p.internalCode || '').trim().toLowerCase() === q
    );
    const chosen = exactMatch || (filteredProducts.length === 1 ? filteredProducts[0] : null);
    if (chosen) {
      e.preventDefault();
      addProductToCart(chosen);
      notify(`Sumado: ${chosen.name}`);
    }
  };

  const handleDetectedBarcode = (code: string) => {
    const trimmed = code.trim().toLowerCase();
    const matched = products.find(
      (p) =>
        (p.barcode || '').trim().toLowerCase() === trimmed ||
        (p.sku || '').trim().toLowerCase() === trimmed ||
        (p.internalCode || '').trim().toLowerCase() === trimmed
    );
    if (matched) {
      addProductToCart(matched);
      setScannerStatus(
        tr(
          `Agregado al carrito: ${matched.name}`,
          `Added to cart: ${matched.name}`,
          `Adicionado ao carrinho: ${matched.name}`
        )
      );
      notify(tr(`Escaneado: ${matched.name}`, `Scanned: ${matched.name}`, `Escaneado: ${matched.name}`));
    } else {
      setProductQuery(code);
      setScannerStatus(
        tr(
          `Código ${code} leído (sin coincidencia exacta en inventario).`,
          `Code ${code} scanned (no exact match in inventory).`,
          `Código ${code} lido (sem correspondência exata no estoque).`
        )
      );
    }
    stopScanner();
  };

  const startScanner = async () => {
    if (scanning) {
      stopScanner();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerStatus(
        tr(
          'Cámara no disponible en este navegador. Usá lector USB o buscador.',
          'Camera unavailable in this browser. Use a USB scanner or search.',
          'Câmera indisponível neste navegador. Use leitor USB ou busca.'
        )
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setScanning(true);
      setScannerStatus(
        tr(
          'Apuntá la cámara al código de barras...',
          'Point the camera at the barcode...',
          'Aponte a câmera para o código de barras...'
        )
      );

      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);

      const BarcodeDetectorCtor = (
        window as unknown as {
          BarcodeDetector?: new (opts: { formats: string[] }) => {
            detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
          };
        }
      ).BarcodeDetector;

      if (!BarcodeDetectorCtor) {
        setScannerStatus(
          tr(
            'Cámara activa, pero este navegador no soporta BarcodeDetector nativo.',
            'Camera active, but this browser does not support native BarcodeDetector.',
            'Câmera ativa, mas este navegador não suporta BarcodeDetector nativo.'
          )
        );
        return;
      }

      const detector = new BarcodeDetectorCtor({
        formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'qr_code'],
      });

      scanTimerRef.current = window.setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const detected = await detector.detect(videoRef.current);
          if (detected.length > 0 && detected[0].rawValue) {
            handleDetectedBarcode(detected[0].rawValue);
          }
        } catch {
          // Ignore single-frame detection errors
        }
      }, 350);
    } catch {
      setScannerStatus(
        tr(
          'No se pudo acceder a la cámara. Verificá los permisos.',
          'Could not access the camera. Check permissions.',
          'Não foi possível acessar a câmera. Verifique as permissões.'
        )
      );
    }
  };

  const handleDepositChange = (val: string) => {
    setDeposit(val);
    const numVal = Math.max(0, Number(val || 0));
    if (totalDisplay > 0 && numVal >= totalDisplay) {
      setStatus('cobrado');
    } else if (totalDisplay > 0 && numVal < totalDisplay) {
      setStatus('pendiente');
    }
  };

  const handleStatusChange = (nextStatus: 'pendiente' | 'cobrado') => {
    setStatus(nextStatus);
    if (nextStatus === 'cobrado') {
      setDeposit(String(totalDisplay));
    } else if (Number(deposit || 0) >= totalDisplay) {
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

    // If user typed a quick manual item but didn't hit "+ Agregar", include it automatically if cart is empty
    let resolvedItems = [...cartItems];
    if (resolvedItems.length === 0 && manualName.trim() && parseSafePositiveNumber(manualPrice, 0) > 0) {
      const mQty = Math.max(1, Math.round(parseSafePositiveNumber(manualQty, 1)));
      const mPrice = roundCurrencyValue(parseSafePositiveNumber(manualPrice, 0));
      resolvedItems = [
        {
          id: makeCartItemId(),
          name: sanitizePlainLine(manualName, 140),
          quantity: mQty,
          unitPrice: mPrice,
          subtotal: roundCurrencyValue(mQty * mPrice),
        },
      ];
    }

    if (resolvedItems.length === 0) {
      notify('Agregá al menos un producto o ítem a la venta.', 'error');
      return;
    }

    const subtotal = roundCurrencyValue(
      resolvedItems.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0)
    );
    const discAmt =
      rawDiscountVal > 0 && subtotal > 0
        ? roundCurrencyValue(
            Math.min(
              subtotal,
              discountType === 'percent'
                ? (subtotal * Math.min(100, rawDiscountVal)) / 100
                : rawDiscountVal
            )
          )
        : 0;
    const afterDisc = Math.max(0, subtotal - discAmt);
    const surAmt =
      rawSurchargeVal > 0 && afterDisc > 0
        ? roundCurrencyValue(
            surchargeType === 'percent'
              ? (afterDisc * Math.min(500, rawSurchargeVal)) / 100
              : rawSurchargeVal
          )
        : 0;
    const afterAdjust = roundCurrencyValue(afterDisc + surAmt);
    const ivaAmt =
      applyTransferQrIva && afterAdjust > 0 && parsedTransferQrIvaPct > 0
        ? roundCurrencyValue(afterAdjust * (parsedTransferQrIvaPct / 100))
        : 0;
    const cleanTxAmount = roundCurrencyValue(afterAdjust + ivaAmt);

    if (cleanTxAmount <= 0) {
      notify('El monto total debe ser mayor a 0.', 'error');
      return;
    }

    // Stock delta validation across all inventory items
    const prevQtyByProduct = new Map<string, number>();
    if (editSale) {
      const prevDetails = parseSaleDetails(editSale);
      for (const it of prevDetails.items) {
        if (it.productId) {
          prevQtyByProduct.set(it.productId, (prevQtyByProduct.get(it.productId) || 0) + it.quantity);
        }
      }
    }
    const nextQtyByProduct = new Map<string, number>();
    for (const it of resolvedItems) {
      if (it.productId) {
        nextQtyByProduct.set(it.productId, (nextQtyByProduct.get(it.productId) || 0) + it.quantity);
      }
    }

    const allTouchedProductIds = new Set([
      ...prevQtyByProduct.keys(),
      ...nextQtyByProduct.keys(),
    ]);
    for (const prodId of allTouchedProductIds) {
      const product = products.find((p) => p.id === prodId);
      if (!product || !product.trackStock || product.allowNoStock) continue;
      const oldQty = prevQtyByProduct.get(prodId) || 0;
      const newQty = nextQtyByProduct.get(prodId) || 0;
      const delta = newQty - oldQty;
      if (delta > 0 && delta > product.stock) {
        notify(
          `Stock insuficiente para "${product.name}" (disponible: ${product.stock} u.).`,
          'error'
        );
        return;
      }
    }

    if (paymentMethod === 'transferencia' && transferCfg.paymentLink.trim()) {
      if (!sanitizeSafeUrl(transferCfg.paymentLink, 400)) {
        notify('El link de pago debe empezar con https:// o http://', 'error');
        return;
      }
    }

    const toBase = (val: number) =>
      isSecondaryCurrency ? roundCurrencyValue(convertToBaseCurrency(val, activeRate)) : roundCurrencyValue(val);

    const baseItems: SaleCartItem[] = resolvedItems.map((it) => {
      const baseUnit = toBase(it.unitPrice);
      return {
        ...it,
        unitPrice: baseUnit,
        subtotal: roundCurrencyValue(baseUnit * it.quantity),
      };
    });
    const baseSubtotal = toBase(subtotal);
    const baseDiscountAmount = toBase(discAmt);
    const baseDiscountValue = discountType === 'fixed' ? toBase(rawDiscountVal) : rawDiscountVal;
    const baseSurchargeAmount = toBase(surAmt);
    const baseSurchargeValue = surchargeType === 'fixed' ? toBase(rawSurchargeVal) : rawSurchargeVal;
    const baseTransferQrIvaAmount = toBase(ivaAmt);
    const cleanAmount = toBase(cleanTxAmount);

    const cleanTxDeposit =
      status === 'cobrado'
        ? cleanTxAmount
        : Math.min(cleanTxAmount, parseSafePositiveNumber(deposit, 0));
    const cleanDeposit =
      status === 'cobrado' ? cleanAmount : Math.min(cleanAmount, toBase(cleanTxDeposit));

    // Update payment ledger entries
    const prevDepositBase = editSale ? parseSalePaymentInfo(editSale).deposit : 0;
    let nextPayments = [...existingPayments];
    const nowIso = new Date().toISOString();
    const makePayId = () =>
      `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    if (!editSale) {
      if (cleanDeposit > 0) {
        nextPayments = [
          {
            id: makePayId(),
            amount: cleanDeposit,
            method: paymentMethod,
            date: nowIso,
            note: status === 'cobrado' ? 'Cobro en mostrador' : 'Seña / anticipo',
          },
        ];
      }
    } else if (cleanDeposit <= 0.001) {
      nextPayments = [];
    } else if (cleanDeposit > prevDepositBase + 0.01) {
      nextPayments.push({
        id: makePayId(),
        amount: roundCurrencyValue(cleanDeposit - prevDepositBase),
        method: paymentMethod,
        date: nowIso,
        note: 'Actualización de cobro',
      });
    } else if (cleanDeposit < prevDepositBase - 0.01) {
      const trimmed: SalePaymentEntry[] = [];
      let remaining = cleanDeposit;
      for (const entry of nextPayments) {
        if (remaining <= 0.001) break;
        const take = Math.min(remaining, Math.max(0, Number(entry.amount || 0)));
        if (take > 0.001) {
          trimmed.push({ ...entry, amount: roundCurrencyValue(take) });
          remaining = roundCurrencyValue(remaining - take);
        }
      }
      nextPayments =
        trimmed.length > 0
          ? trimmed
          : [
              {
                id: makePayId(),
                amount: cleanDeposit,
                method: paymentMethod,
                date: nowIso,
                note: 'Ajuste de cobro',
              },
            ];
    }

    const mpPaidChannel =
      mpOrder &&
      (mpOrder.status === 'paid' ||
        (status === 'cobrado' &&
          ((mpOrder.mode === 'point' && paymentMethod === 'tarjeta') ||
            (mpOrder.mode === 'qr' && paymentMethod === 'transferencia'))))
        ? mpOrder.mode === 'point'
          ? ('mp_point' as const)
          : ('mp_qr' as const)
        : undefined;

    const existingDetails = editSale ? parseSaleDetails(editSale) : null;
    const effectiveMpChannel = mpPaidChannel || existingDetails?.mpChannel;
    const effectiveMpOrderId = mpOrder?.orderId || existingDetails?.mpOrderId;
    const effectiveMpExtRef = mpOrder?.externalReference || existingDetails?.mpExternalReference;
    const effectiveMpPointName =
      existingDetails?.mpPointName ||
      (effectiveMpChannel ||
      (paymentMethod === 'tarjeta' && (mpConfig.terminalId || mpConfig.pointName))
        ? resolvePointDisplayName(mpConfig)
        : undefined);

    const serializedStatus = serializeSaleStatus({
      status,
      method: paymentMethod,
      deposit: cleanDeposit,
      amount: cleanAmount,
      currency: selectedCurrency,
      rate: isSecondaryCurrency ? activeRate : undefined,
      meta: {
        items: baseItems,
        subtotal: baseSubtotal,
        ...(baseDiscountAmount > 0
          ? {
              discountType,
              discountValue: baseDiscountValue,
              discountAmount: baseDiscountAmount,
            }
          : {}),
        ...(baseSurchargeAmount > 0
          ? {
              surchargeType,
              surchargeValue: baseSurchargeValue,
              surchargeAmount: baseSurchargeAmount,
            }
          : {}),
        ...(baseTransferQrIvaAmount > 0
          ? {
              transferQrIvaPct: parsedTransferQrIvaPct,
              transferQrIvaAmount: baseTransferQrIvaAmount,
            }
          : {}),
        payments: nextPayments,
        note: sanitizeText(saleNote, 400),
        ...(effectiveMpChannel ? { mpChannel: effectiveMpChannel } : {}),
        ...(effectiveMpOrderId ? { mpOrderId: effectiveMpOrderId } : {}),
        ...(effectiveMpExtRef ? { mpExternalReference: effectiveMpExtRef } : {}),
        ...(effectiveMpPointName ? { mpPointName: effectiveMpPointName } : {}),
      },
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

    const totalQuantity = Math.max(
      1,
      resolvedItems.reduce((sum, it) => sum + Math.max(1, it.quantity), 0)
    );
    const firstProductItem = resolvedItems.find((it) => Boolean(it.productId));
    const summaryProductLabel = summarizeSaleItemsLabel(baseItems);

    const needsNewClient = !(matchedClient?.id || editSale?.clientId);
    const resolvedClientId = matchedClient?.id || editSale?.clientId || generateDocId('clients');
    const draftClientPayload = needsNewClient
      ? stripUndefined({
          id: resolvedClientId,
          ownerId,
          name: cleanClientName,
        })
      : undefined;

    const saleId = editSale?.id || generateDocId('sales');
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
      productId: clampStr(firstProductItem?.productId, 128),
      productName: summaryProductLabel,
      quantity: totalQuantity,
      amount: cleanAmount,
      status: serializedStatus,
      dueDate: finalDueDate,
    });

    const stockDeltas: Array<{ productId: string; delta: number }> = [];
    for (const prodId of allTouchedProductIds) {
      const product = products.find((p) => p.id === prodId);
      if (!product || !product.trackStock) continue;
      const oldQty = prevQtyByProduct.get(prodId) || 0;
      const newQty = nextQtyByProduct.get(prodId) || 0;
      const delta = newQty - oldQty;
      if (delta !== 0) {
        stockDeltas.push({ productId: product.id, delta });
      }
    }

    setSaving(true);
    try {
      if (draftClientPayload) {
        await upsertRow('clients', draftClientPayload);
      }

      await upsertRow('sales', salePayload);

      // Apply stock delta per inventory product
      for (const sd of stockDeltas) {
        const product = products.find((p) => p.id === sd.productId);
        if (!product || !product.trackStock) continue;
        await updateRow('products', product.id, {
          stock: Math.max(0, Number(product.stock || 0) - sd.delta),
        });
      }

      markPaymentReconciled({
        ownerId,
        saleId,
        ledgerId: saleId,
        mpOrderId: effectiveMpOrderId,
        mpCompanionOrderId: mpOrder?.companionPointOrderId,
        mpExternalReference: effectiveMpExtRef,
      });

      const savedRecord: SaleRecord = {
        id: saleId,
        ownerId,
        clientId: resolvedClientId,
        clientName: cleanClientName,
        invoice: finalInvoice,
        productId: firstProductItem?.productId,
        productName: summaryProductLabel,
        quantity: totalQuantity,
        amount: cleanAmount,
        status: serializedStatus,
        dueDate: finalDueDate,
        createdAt: editSale?.createdAt || Date.now(),
      };

      void syncSaleToPurchases(ownerId, savedRecord, mpConfig);

      notify(editSale ? 'Venta actualizada.' : 'Venta registrada.');
      onClose();
      onSaved?.(savedRecord);
      if (openPrintAfter) {
        onCreated?.(savedRecord);
      }
    } catch (err) {
      const safeErrMsg = sanitizeDbErrorMessage(err, 'No se pudo guardar la venta.');
      const collectedNow = editSale
        ? Math.max(0, roundCurrencyValue(cleanDeposit - prevDepositBase))
        : cleanDeposit;

      if (collectedNow > 0) {
        const recFailed = recordRecoveredPayment({
          id: effectiveMpOrderId || saleId,
          ownerId,
          source: 'venta',
          method: paymentMethod,
          ...(effectiveMpChannel ? { mpChannel: effectiveMpChannel } : {}),
          ...(effectiveMpPointName ? { mpPointName: effectiveMpPointName } : {}),
          amount: collectedNow,
          totalAmount: cleanAmount,
          clientName: cleanClientName,
          title: summaryProductLabel,
          subtitle: `${finalInvoice} · Error al guardar en la nube`,
          invoice: finalInvoice,
          ...(effectiveMpOrderId ? { mpOrderId: effectiveMpOrderId } : {}),
          ...(mpOrder?.companionPointOrderId
            ? { mpCompanionOrderId: mpOrder.companionPointOrderId }
            : {}),
          ...(effectiveMpExtRef ? { mpExternalReference: effectiveMpExtRef } : {}),
          saveFailed: true,
          saveError: safeErrMsg,
          ...(draftClientPayload ? { draftClientPayload } : {}),
          ...(!editSale
            ? {
                draftSalePayload: salePayload,
                draftStockDeltas: stockDeltas,
              }
            : {}),
        });
        if (recFailed) {
          void syncRecoveredEntryToPurchase(ownerId, recFailed, mpConfig);
        }
        notify(
          `${safeErrMsg} El cobro de ${formatCurrency(collectedNow, baseCurrency)} quedó resguardado en Caja Diaria para no perderlo.`,
          'error'
        );
      } else {
        notify(safeErrMsg, 'error');
      }
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

  const mpChargeAmount = isSecondaryCurrency
    ? roundCurrencyValue(convertToBaseCurrency(qrChargeAmount, activeRate))
    : roundCurrencyValue(qrChargeAmount);

  const handleCreateMercadoPagoOrder = async (mode: 'qr' | 'point') => {
    if (mpChargeAmount <= 0) {
      notify('Ingresá un monto mayor a 0 antes de generar el cobro.', 'error');
      return;
    }
    if (!mpConfig.accessToken.trim()) {
      notify('Configurá tu Access Token de Mercado Pago primero.', 'error');
      setShowMpSettings(true);
      return;
    }
    if (mode === 'point' && !mpConfig.terminalId.trim()) {
      notify('Ingresá el ID del dispositivo Point para enviar el cobro.', 'error');
      setShowMpSettings(true);
      return;
    }

    const token = mpConfig.accessToken.trim();
    if (mpOrder && mpOrder.status === 'pending') {
      void cancelMercadoPagoOrder({
        accessToken: token,
        orderId: mpOrder.orderId,
        apiFamily: mpOrder.apiFamily,
        terminalId: mpConfig.terminalId.trim(),
        posExternalId: mpConfig.posExternalId.trim(),
      }).catch(() => {});
      if (mpOrder.companionPointOrderId) {
        void cancelMercadoPagoOrder({
          accessToken: token,
          orderId: mpOrder.companionPointOrderId,
          apiFamily: mpOrder.companionPointApiFamily || 'orders_v1',
          terminalId: mpConfig.terminalId.trim(),
        }).catch(() => {});
      }
    }

    const effectivePosId = mpConfig.posExternalId.trim() || 'CAJA01';
    const description =
      cartItems.length > 0
        ? summarizeSaleItemsLabel(cartItems)
        : `Venta ${invoice || effectiveBrandName}`;
    const extRef = `${(invoice || 'FV').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'FV'}-${Date.now().toString().slice(-6)}`;
    const alsoShowOnPoint =
      mode === 'qr' && showQrOnPointSmart && Boolean(mpConfig.terminalId.trim());

    setMpBusy(true);
    try {
      const res = await createMercadoPagoOrder({
        accessToken: token,
        mode,
        amount: mpChargeAmount,
        description,
        externalReference: extRef,
        posExternalId: effectivePosId,
        terminalId: mpConfig.terminalId.trim(),
        printOnTerminal: mpConfig.printOnTerminal,
        alsoShowOnPoint,
      });

      if (!res.ok || !res.orderId) {
        recordPaymentAttempt({
          id: `fail-sale-${extRef}`,
          ownerId,
          source: 'venta',
          method: mode === 'point' ? 'tarjeta' : 'transferencia',
          mpChannel: mode === 'point' ? 'mp_point' : 'mp_qr',
          amount: mpChargeAmount,
          totalAmount: mpChargeAmount,
          clientName: clientName.trim() || 'Mostrador',
          title: description,
          subtitle: 'Error al iniciar cobro en Mercado Pago',
          invoice: invoice.trim() || undefined,
          mpExternalReference: extRef,
          attemptStatus: 'failed_attempt',
          rawError: res.error || 'No se pudo iniciar la orden en Mercado Pago.',
        });
        notify(res.error || 'No se pudo iniciar la orden en Mercado Pago.', 'error');
        return;
      }

      if (mode === 'qr' && res.posExternalId && res.posExternalId !== mpConfig.posExternalId) {
        const updatedMp = { ...mpConfig, posExternalId: res.posExternalId };
        setMpConfig(updatedMp);
        saveMercadoPagoConfig(ownerId, updatedMp);
        if (profile) {
          void saveMercadoPagoConfigToProfile(profile, updatedMp).catch(() => {});
        }
      }

      let qrImageDataUrl: string | undefined;
      if (mode === 'qr' && res.qrData) {
        try {
          qrImageDataUrl = await QRCode.toDataURL(res.qrData, {
            width: 240,
            margin: 1,
            color: { dark: '#0f172a', light: '#ffffff' },
          });
        } catch {
          qrImageDataUrl = undefined;
        }
      }

      const shownOnPoint = Boolean(res.companionPointOrderId);
      if (!res.isPaid) {
        recordPaymentAttempt({
          id: res.orderId,
          ownerId,
          source: 'venta',
          method: mode === 'point' ? 'tarjeta' : 'transferencia',
          mpChannel: mode === 'point' ? 'mp_point' : 'mp_qr',
          amount: mpChargeAmount,
          totalAmount: mpChargeAmount,
          clientName: clientName.trim() || 'Mostrador',
          title: description,
          subtitle: shownOnPoint
            ? 'QR enviado a pantalla y Point Smart (pendiente de confirmar)'
            : mode === 'point'
              ? 'Orden enviada al Point Smart (pendiente de confirmar)'
              : 'QR MP generado (pendiente de confirmar)',
          invoice: invoice.trim() || undefined,
          mpOrderId: res.orderId,
          mpCompanionOrderId: res.companionPointOrderId,
          mpExternalReference: res.externalReference || extRef,
          mpApiFamily: res.apiFamily || 'orders_v1',
          attemptStatus: 'pending_verification',
        });
      }

      setMpOrder({
        mode,
        apiFamily: res.apiFamily || 'orders_v1',
        orderId: res.orderId,
        externalReference: res.externalReference || extRef,
        amount: mpChargeAmount,
        qrImageDataUrl,
        status: res.isPaid ? 'paid' : 'pending',
        statusText:
          mode === 'qr'
            ? shownOnPoint
              ? tr(
                  'QR activo en pantalla y en el Point Smart · Esperando pago...',
                  'QR active on screen and Point Smart · Waiting for payment...',
                  'QR ativo na tela e no Point Smart · Aguardando pagamento...'
                )
              : tr(
                  'QR dinámico activo · Esperando que el cliente escanee y pague...',
                  'Dynamic QR active · Waiting for customer to scan and pay...',
                  'QR dinâmico ativo · Aguardando o cliente escanear e pagar...'
                )
            : tr(
                `Orden enviada a ${mpConfig.terminalId} · Esperando tarjeta en el Point...`,
                `Order sent to ${mpConfig.terminalId} · Waiting for card on Point...`,
                `Pedido enviado para ${mpConfig.terminalId} · Aguardando cartão no Point...`
              ),
        ...(res.companionPointOrderId ? { companionPointOrderId: res.companionPointOrderId } : {}),
        ...(res.companionPointApiFamily
          ? { companionPointApiFamily: res.companionPointApiFamily }
          : {}),
        ...(res.companionPointExternalReference
          ? { companionPointExternalReference: res.companionPointExternalReference }
          : {}),
        ...(res.companionPointWarning ? { companionPointWarning: res.companionPointWarning } : {}),
      });

      notify(
        mode === 'qr'
          ? shownOnPoint
            ? 'QR dinámico generado en pantalla y enviado al Point Smart.'
            : 'QR dinámico de Mercado Pago generado.'
          : 'Orden enviada al dispositivo Point.'
      );
    } catch {
      recordPaymentAttempt({
        id: `err-sale-${extRef}`,
        ownerId,
        source: 'venta',
        method: mode === 'point' ? 'tarjeta' : 'transferencia',
        mpChannel: mode === 'point' ? 'mp_point' : 'mp_qr',
        amount: mpChargeAmount,
        totalAmount: mpChargeAmount,
        clientName: clientName.trim() || 'Mostrador',
        title: description,
        subtitle: 'Error de red al conectar con Mercado Pago',
        invoice: invoice.trim() || undefined,
        mpExternalReference: extRef,
        attemptStatus: 'failed_attempt',
        rawError: 'Error de conexión con el servidor de Mercado Pago.',
      });
      notify('Error de conexión con el servidor de Mercado Pago.', 'error');
    } finally {
      setMpBusy(false);
    }
  };

  const handleCheckMpStatusOnce = async () => {
    if (!mpOrder || !mpConfig.accessToken.trim()) return;
    const token = mpConfig.accessToken.trim();
    setMpBusy(true);
    try {
      const res = await checkMercadoPagoOrderStatus({
        accessToken: token,
        orderId: mpOrder.orderId,
        apiFamily: mpOrder.apiFamily,
        externalReference: mpOrder.externalReference,
      });

      let companionPaid = false;
      if ((!res.ok || !res.isPaid) && mpOrder.companionPointOrderId) {
        const ptRes = await checkMercadoPagoOrderStatus({
          accessToken: token,
          orderId: mpOrder.companionPointOrderId,
          apiFamily: mpOrder.companionPointApiFamily || 'orders_v1',
          externalReference: mpOrder.companionPointExternalReference,
        });
        if (ptRes.ok && ptRes.isPaid) {
          companionPaid = true;
        }
      }

      if (!res.ok && !companionPaid) {
        notify(res.error || 'No se pudo consultar el estado.', 'error');
        return;
      }

      if ((res.ok && res.isPaid) || companionPaid) {
        const mpChannel = mpOrder.mode === 'point' ? 'mp_point' : 'mp_qr';
        const methodForOrder: PaymentMethod = mpOrder.mode === 'point' ? 'tarjeta' : 'transferencia';
        const itemSummary =
          cartItems.length > 0
            ? summarizeSaleItemsLabel(cartItems)
            : manualName.trim() || (mpOrder.mode === 'point' ? 'Cobro Point Smart' : 'Cobro QR Mercado Pago');

        const pointDisplayName = resolvePointDisplayName(mpConfig);
        const recOnce = recordRecoveredPayment({
          id: mpOrder.orderId,
          ownerId,
          source: 'venta',
          method: methodForOrder,
          mpChannel,
          mpPointName: pointDisplayName,
          amount: mpOrder.amount,
          totalAmount: mpOrder.amount,
          clientName: clientName.trim() || 'Mostrador',
          title: itemSummary,
          subtitle: companionPaid
            ? 'Aprobado vía QR en Point Smart (pendiente de guardar venta)'
            : mpOrder.mode === 'point'
              ? 'Aprobado en Point Smart (pendiente de guardar venta)'
              : 'Aprobado vía QR Mercado Pago (pendiente de guardar venta)',
          invoice: invoice.trim() || undefined,
          mpOrderId: mpOrder.orderId,
          mpCompanionOrderId: mpOrder.companionPointOrderId,
          mpExternalReference: mpOrder.externalReference,
          saveFailed: false,
        });
        if (recOnce) {
          void syncRecoveredEntryToPurchase(ownerId, recOnce, mpConfig);
        }

        if (companionPaid) {
          void cancelMercadoPagoOrder({
            accessToken: token,
            orderId: mpOrder.orderId,
            apiFamily: mpOrder.apiFamily,
            posExternalId: mpConfig.posExternalId.trim(),
          }).catch(() => {});
        } else if (mpOrder.companionPointOrderId) {
          void cancelMercadoPagoOrder({
            accessToken: token,
            orderId: mpOrder.companionPointOrderId,
            apiFamily: mpOrder.companionPointApiFamily || 'orders_v1',
            terminalId: mpConfig.terminalId.trim(),
          }).catch(() => {});
        }

        setMpOrder((prev) =>
          prev
            ? {
                ...prev,
                status: 'paid',
                statusText: tr(
                  'Pago aprobado y acreditado en Mercado Pago.',
                  'Payment approved and credited in Mercado Pago.',
                  'Pagamento aprovado e creditado no Mercado Pago.'
                ),
              }
            : prev
        );
        setStatus('cobrado');
        setDeposit(String(totalDisplay));
        notify('¡Pago aprobado en Mercado Pago!');
      } else if (res.isCanceled) {
        setMpOrder((prev) =>
          prev
            ? {
                ...prev,
                status: 'canceled',
                statusText: tr(
                  'Orden cancelada o vencida.',
                  'Order canceled or expired.',
                  'Pedido cancelado ou expirado.'
                ),
              }
            : prev
        );
      } else if (res.isFailed) {
        setMpOrder((prev) =>
          prev
            ? {
                ...prev,
                status: 'failed',
                statusText: tr(
                  'Pago rechazado o con error.',
                  'Payment declined or failed.',
                  'Pagamento recusado ou com erro.'
                ),
              }
            : prev
        );
      } else {
        notify('El pago todavía está pendiente en Mercado Pago.');
      }
    } finally {
      setMpBusy(false);
    }
  };

  const handleCancelMpOrder = async () => {
    if (!mpOrder || !mpConfig.accessToken.trim()) {
      setMpOrder(null);
      return;
    }
    const token = mpConfig.accessToken.trim();
    setMpBusy(true);
    try {
      const res = await cancelMercadoPagoOrder({
        accessToken: token,
        orderId: mpOrder.orderId,
        apiFamily: mpOrder.apiFamily,
        terminalId: mpConfig.terminalId.trim(),
        posExternalId: mpConfig.posExternalId.trim(),
      });
      if (mpOrder.companionPointOrderId) {
        await cancelMercadoPagoOrder({
          accessToken: token,
          orderId: mpOrder.companionPointOrderId,
          apiFamily: mpOrder.companionPointApiFamily || 'orders_v1',
          terminalId: mpConfig.terminalId.trim(),
        }).catch(() => {});
      }
      if (!res.ok) {
        notify(res.error || 'No se pudo cancelar la orden en Mercado Pago.', 'error');
        return;
      }
      dismissRecoveredPayment(ownerId, mpOrder.orderId);
      setMpOrder(null);
      notify('Orden cancelada en Mercado Pago.');
    } finally {
      setMpBusy(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={
        editSale
          ? tr(`Editar venta · ${editSale.invoice}`, `Edit sale · ${editSale.invoice}`, `Editar venda · ${editSale.invoice}`)
          : tr('Nueva venta de mostrador', 'New counter sale', 'Nova venda de balcão')
      }
      maxWidth="2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Product Quick Search + Barcode Scanner + Manual Concept */}
        <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
              <ScanBarcode className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
              <span>
                {tr(
                  `Productos e ítems (${cartItems.length})`,
                  `Products & items (${cartItems.length})`,
                  `Produtos e itens (${cartItems.length})`
                )}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void startScanner()}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition whitespace-nowrap shrink-0 ${
                  scanning
                    ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <Camera className="h-3.5 w-3.5" />
                {scanning
                  ? tr('Detener cámara', 'Stop camera', 'Parar câmera')
                  : tr('Escanear código', 'Scan barcode', 'Escanear código')}
              </button>
              <button
                type="button"
                onClick={() => setShowManualForm((prev) => !prev)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <Plus className="h-3.5 w-3.5" />
                {tr('Ítem manual', 'Manual item', 'Item manual')}
              </button>
            </div>
          </div>

          {scanning && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-black dark:border-slate-700">
              <video ref={videoRef} className="h-36 w-full object-cover" muted playsInline />
            </div>
          )}
          {scannerStatus && (
            <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
              {scannerStatus}
            </p>
          )}

          {products.length > 0 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={tr(
                  'Buscar por nombre, SKU o escanear código de barras (Enter)...',
                  'Search by name, SKU, or scan barcode (Enter)...',
                  'Buscar por nome, SKU ou escanear código de barras (Enter)...'
                )}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
              {productQuery && (
                <button
                  type="button"
                  onClick={() => setProductQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {productQuery.trim().length > 0 && (
            <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
              {filteredProducts.length === 0 ? (
                <div className="px-3 py-2.5 text-xs text-slate-500">
                  {tr(
                    `No encontramos productos para "${productQuery}". Podés agregarlo como ítem manual.`,
                    `No products found for "${productQuery}". You can add it as a manual item.`,
                    `Não encontramos produtos para "${productQuery}". Você pode adicionar como item manual.`
                  )}
                </div>
              ) : (
                filteredProducts.map((p) => {
                  const displayPrice = isSecondaryCurrency
                    ? roundCurrencyValue(convertFromBaseCurrency(p.price, activeRate))
                    : roundCurrencyValue(p.price);
                  const outOfStock = p.trackStock && !p.allowNoStock && p.stock <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={outOfStock}
                      onClick={() => addProductToCart(p)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition hover:bg-sky-50/70 disabled:opacity-50 dark:hover:bg-sky-950/30"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900 dark:text-white">
                          {p.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {p.sku || p.barcode ? `${p.sku || p.barcode} · ` : ''}
                          {p.trackStock
                            ? tr(`Stock: ${p.stock} u.`, `Stock: ${p.stock} u.`, `Estoque: ${p.stock} un.`)
                            : tr('Sin control de stock', 'No stock tracking', 'Sem controle de estoque')}
                          {outOfStock ? tr(' · Agotado', ' · Out of stock', ' · Esgotado') : ''}
                        </div>
                      </div>
                      <span className="shrink-0 font-mono-num font-bold text-[#0072BB] dark:text-sky-400">
                        + {formatCurrency(displayPrice, selectedCurrency)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {showManualForm && (
            <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-2.5 sm:grid-cols-12 dark:border-slate-700 dark:bg-slate-900">
              <div className="sm:col-span-6">
                <input
                  type="text"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder={tr(
                    'Descripción del servicio o producto...',
                    'Service or product description...',
                    'Descrição do serviço ou produto...'
                  )}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <input
                  type="number"
                  min="1"
                  value={manualQty}
                  onChange={(e) => setManualQty(e.target.value)}
                  placeholder={tr('Cant.', 'Qty', 'Qtd.')}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-center font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualPrice}
                  onChange={(e) => setManualPrice(e.target.value)}
                  placeholder={tr(`Precio (${currencySymbol})`, `Price (${currencySymbol})`, `Preço (${currencySymbol})`)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-right font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleAddManualItem}
                  className="h-9 w-full rounded-lg bg-[#0072BB] px-2 text-xs font-semibold text-white hover:bg-[#005f9c]"
                >
                  {tr('Sumar', 'Add', 'Adicionar')}
                </button>
              </div>
            </div>
          )}

          {/* Cart Items List */}
          {cartItems.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
              {cartItems.map((item) => {
                const prod = item.productId
                  ? products.find((p) => p.id === item.productId)
                  : undefined;
                return (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Package className="h-4 w-4 shrink-0 text-[#0072BB] dark:text-sky-400" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-slate-900 dark:text-white">
                          {item.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {prod?.trackStock
                            ? tr(`Stock: ${prod.stock} u.`, `Stock: ${prod.stock} u.`, `Estoque: ${prod.stock} un.`)
                            : tr('Ítem manual', 'Manual item', 'Item manual')}
                          {item.sku ? ` · ${item.sku}` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                        <button
                          type="button"
                          onClick={() => handleUpdateCartQty(item.id, item.quantity - 1)}
                          className="flex h-full w-7 items-center justify-center text-slate-600 hover:text-slate-900 dark:text-slate-300"
                          aria-label={tr('Restar cantidad', 'Decrease quantity', 'Diminuir quantidade')}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="min-w-[26px] text-center font-mono-num text-xs font-bold text-slate-900 dark:text-white">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateCartQty(item.id, item.quantity + 1)}
                          className="flex h-full w-7 items-center justify-center text-slate-600 hover:text-slate-900 dark:text-slate-300"
                          aria-label={tr('Sumar cantidad', 'Increase quantity', 'Aumentar quantidade')}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>

                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => handleUpdateCartUnitPrice(item.id, e.target.value)}
                        aria-label={tr('Precio unitario', 'Unit price', 'Preço unitário')}
                        className="h-8 w-24 rounded-lg border border-slate-200 bg-white px-2 text-right font-mono-num text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />

                      <span className="min-w-[78px] text-right font-mono-num text-xs font-bold text-slate-900 dark:text-white">
                        {formatCurrency(item.quantity * item.unitPrice, selectedCurrency)}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleRemoveCartItem(item.id)}
                        aria-label={tr('Quitar ítem', 'Remove item', 'Remover item')}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Client + Invoice + Date */}
        <div className="grid gap-3 sm:grid-cols-12">
          <div className="sm:col-span-6">
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('Nombre del cliente *', 'Client name *', 'Nome do cliente *')}
            </label>
            <input
              type="text"
              required
              list="sale-clients-datalist"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder={tr('Escribí o seleccioná un cliente', 'Type or select a client', 'Digite ou selecione um cliente')}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <datalist id="sale-clients-datalist">
              {clients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            <p className="mt-1 text-[11px] text-slate-500">
              {matchedClient
                ? tr('Cliente existente seleccionado.', 'Existing client selected.', 'Cliente existente selecionado.')
                : tr('Si es nuevo, se guardará automáticamente.', 'If new, it will be saved automatically.', 'Se for novo, será salvo automaticamente.')}
            </p>
          </div>
          <div className="sm:col-span-3">
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('Comprobante', 'Receipt #', 'Comprovante')}
            </label>
            <input
              type="text"
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div className="sm:col-span-3">
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('Fecha', 'Date', 'Data')}
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>

        {/* Currency Selector & Configured Conversion Rates */}
        {selectableCurrencies.length > 1 && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <label
                  htmlFor="new-sale-currency-select"
                  className="text-xs font-bold text-slate-800 dark:text-slate-100"
                >
                  {tr('Moneda y conversión', 'Currency & conversion', 'Moeda e conversão')}
                </label>
              </div>
              {dualCurrencySummary && (
                <span className="font-mono-num text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  1 {dualCurrencySummary.secondaryOption.symbol} ={' '}
                  {formatCurrency(dualCurrencySummary.rate, baseCurrency)}
                </span>
              )}
            </div>

            <div
              className={`mt-2 grid gap-2 ${
                !isSecondaryCurrency && secondaryCurrencies.length > 1
                  ? 'sm:grid-cols-2'
                  : 'grid-cols-1'
              }`}
            >
              <div>
                {!isSecondaryCurrency && secondaryCurrencies.length > 1 && (
                  <label
                    htmlFor="new-sale-currency-select"
                    className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    {tr('Divisa de carga', 'Entry currency', 'Moeda de lançamento')}
                  </label>
                )}
                <select
                  id="new-sale-currency-select"
                  value={selectedCurrency}
                  onChange={(e) => handleCurrencyChange(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  {selectableCurrencies.map((choice) => {
                    const opt = getCurrencyOption(choice.code);
                    if (choice.isBase) {
                      return (
                        <option key={choice.code} value={choice.code}>
                          {opt.label} · Base
                        </option>
                      );
                    }
                    return (
                      <option key={choice.code} value={choice.code}>
                        {opt.label} · 1 {opt.symbol} = {formatCurrency(choice.rate, baseCurrency)}
                      </option>
                    );
                  })}
                </select>
              </div>

              {!isSecondaryCurrency && secondaryCurrencies.length > 1 && effectiveSecondaryTarget && (
                <div>
                  <label
                    htmlFor="new-sale-secondary-preview-select"
                    className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    {tr('Moneda secundaria a mostrar', 'Secondary currency display', 'Moeda secundária exibida')}
                  </label>
                  <select
                    id="new-sale-secondary-preview-select"
                    value={effectiveSecondaryTarget.code}
                    onChange={(e) => setSecondaryPreviewCode(sanitizeCurrencyCode(e.target.value))}
                    className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  >
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
            </div>

            {dualCurrencySummary && (
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                {isSecondaryCurrency
                  ? tr(
                      `Cargás los importes en ${selectedCurrencyOption.code} y se guardan convertidos a ${baseCurrencyOption.code} según la tasa configurada.`,
                      `Amounts are entered in ${selectedCurrencyOption.code} and saved converted to ${baseCurrencyOption.code} at the configured rate.`,
                      `Os valores são lançados em ${selectedCurrencyOption.code} e salvos convertidos para ${baseCurrencyOption.code} pela taxa configurada.`
                    )
                  : tr(
                      `Precios en ${baseCurrencyOption.code} con total automático en ${dualCurrencySummary.secondaryCode} junto a la moneda base.`,
                      `Prices in ${baseCurrencyOption.code} with automatic ${dualCurrencySummary.secondaryCode} total alongside the base currency.`,
                      `Preços em ${baseCurrencyOption.code} com total automático em ${dualCurrencySummary.secondaryCode} junto à moeda base.`
                    )}
              </p>
            )}
          </div>
        )}

        {/* Discount, Surcharge & Summary */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    {tr('Descuento', 'Discount', 'Desconto')}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setDiscountType((t) => (t === 'percent' ? 'fixed' : 'percent'))
                    }
                    className="rounded border border-slate-200 px-1.5 py-0.5 font-mono-num text-[10px] font-bold text-slate-600 hover:border-[#0072BB] dark:border-slate-700 dark:text-slate-300"
                  >
                    {discountType === 'percent' ? '%' : currencySymbol}
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder="0"
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono-num text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    {tr('Recargo', 'Surcharge', 'Acréscimo')}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setSurchargeType((t) => (t === 'percent' ? 'fixed' : 'percent'))
                    }
                    className="rounded border border-slate-200 px-1.5 py-0.5 font-mono-num text-[10px] font-bold text-slate-600 hover:border-[#0072BB] dark:border-slate-700 dark:text-slate-300"
                  >
                    {surchargeType === 'percent' ? '%' : currencySymbol}
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={surchargeValue}
                  onChange={(e) => setSurchargeValue(e.target.value)}
                  placeholder="0"
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono-num text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            <div className="mt-2.5 space-y-1 border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
              <div className="flex justify-between text-slate-500">
                <span>{tr('Subtotal ítems', 'Items subtotal', 'Subtotal itens')}</span>
                <span className="font-mono-num">
                  {formatCurrency(subtotalDisplay, selectedCurrency)}
                </span>
              </div>
              {discountAmountDisplay > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>{tr('Descuento', 'Discount', 'Desconto')}</span>
                  <span className="font-mono-num">
                    -{formatCurrency(discountAmountDisplay, selectedCurrency)}
                  </span>
                </div>
              )}
              {surchargeAmountDisplay > 0 && (
                <div className="flex justify-between text-amber-600 dark:text-amber-400">
                  <span>{tr('Recargo', 'Surcharge', 'Acréscimo')}</span>
                  <span className="font-mono-num">
                    +{formatCurrency(surchargeAmountDisplay, selectedCurrency)}
                  </span>
                </div>
              )}
              {transferQrIvaAmountDisplay > 0 && (
                <div className="flex justify-between text-[#0072BB] dark:text-sky-400">
                  <span>
                    {tr(
                      `IVA Transf./QR (${parsedTransferQrIvaPct}%)`,
                      `Transfer/QR VAT (${parsedTransferQrIvaPct}%)`,
                      `IVA Transf./QR (${parsedTransferQrIvaPct}%)`
                    )}
                  </span>
                  <span className="font-mono-num">
                    +{formatCurrency(transferQrIvaAmountDisplay, selectedCurrency)}
                  </span>
                </div>
              )}
              <div className="pt-1">
                <div className="flex items-baseline justify-between gap-2 text-sm font-extrabold text-slate-900 dark:text-white">
                  <span>{tr('Total final', 'Final total', 'Total final')}</span>
                  {!dualCurrencySummary && (
                    <span className="font-mono-num">
                      {formatCurrency(totalDisplay, selectedCurrency)}
                    </span>
                  )}
                </div>

                {dualCurrencySummary && (
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <div
                      className={`min-w-0 rounded-xl border px-2.5 py-1.5 ${
                        !isSecondaryCurrency
                          ? 'border-[#0072BB]/35 bg-sky-50/70 dark:border-sky-500/40 dark:bg-sky-950/30'
                          : 'border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <span>{baseCurrencyOption.code}</span>
                        <span>{tr('Base', 'Base', 'Base')}</span>
                      </div>
                      <div className="mt-0.5 truncate font-mono-num text-sm font-extrabold text-slate-900 dark:text-white">
                        {formatCurrency(dualCurrencySummary.baseAmount, baseCurrency)}
                      </div>
                    </div>

                    <div
                      className={`min-w-0 rounded-xl border px-2.5 py-1.5 ${
                        isSecondaryCurrency
                          ? 'border-emerald-400/50 bg-emerald-50/70 dark:border-emerald-500/40 dark:bg-emerald-950/30'
                          : 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        <span>{dualCurrencySummary.secondaryCode}</span>
                        <span className="truncate font-mono-num">
                          1={formatCurrency(dualCurrencySummary.rate, baseCurrency)}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate font-mono-num text-sm font-extrabold text-emerald-700 dark:text-emerald-300">
                        {formatCurrency(
                          dualCurrencySummary.secondaryAmount,
                          dualCurrencySummary.secondaryCode
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                {tr('Estado del cobro', 'Payment status', 'Status do pagamento')}
              </label>
              <select
                value={status}
                onChange={(e) => handleStatusChange(e.target.value as 'pendiente' | 'cobrado')}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="cobrado">{tr('Cobrado (total)', 'Paid (full)', 'Pago (total)')}</option>
                <option value="pendiente">{tr('Pendiente / Con seña', 'Pending / Partial', 'Pendente / Com sinal')}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                {tr(`Importe abonado / Seña (${currencySymbol})`, `Amount paid / Deposit (${currencySymbol})`, `Valor pago / Sinal (${currencySymbol})`)}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={status === 'cobrado' ? String(totalDisplay || '') : deposit}
                onChange={(e) => handleDepositChange(e.target.value)}
                placeholder="0"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono-num text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-500">{tr('Saldo pendiente:', 'Balance due:', 'Saldo pendente:')}</span>
                <div className="text-right">
                  <span
                    className={`font-mono-num font-bold ${
                      pendingBalance > 0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {formatCurrency(pendingBalance, selectedCurrency)}
                  </span>
                  {pendingBalance > 0 && dualCurrencySummary && (
                    <span className="ml-1.5 font-mono-num text-[10px] text-slate-500 dark:text-slate-400">
                      (
                      {formatCurrency(
                        dualCurrencySummary.pendingCounterpartAmount,
                        dualCurrencySummary.pendingCounterpartCode
                      )}
                      )
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                {tr('Nota interna / garantía (opcional)', 'Internal note / warranty (optional)', 'Nota interna / garantia (opcional)')}
              </label>
              <input
                type="text"
                value={saleNote}
                onChange={(e) => setSaleNote(e.target.value)}
                placeholder={tr(
                  'Ej: Garantía 30 días o detalle de entrega',
                  'E.g.: 30-day warranty or delivery note',
                  'Ex.: Garantia de 30 dias ou detalhe da entrega'
                )}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>
        </div>

        {/* IVA Transferencia / QR */}
        <div
          className={`space-y-2 rounded-2xl border p-3 transition ${
            applyTransferQrIva
              ? 'border-sky-300 bg-sky-50/80 dark:border-sky-800 dark:bg-sky-950/35'
              : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/50'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
              <input
                type="checkbox"
                checked={applyTransferQrIva}
                onChange={(e) => {
                  setIvaTouchedManually(true);
                  setApplyTransferQrIva(e.target.checked);
                }}
                className="h-4 w-4 rounded border-slate-300 text-[#0072BB] focus:ring-[#0072BB]"
              />
              <QrCode className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
              <span>
                {tr(
                  'Agregar IVA Transferencia / QR',
                  'Add Transfer / QR VAT',
                  'Adicionar IVA Transferência / QR'
                )}
              </span>
              <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-[#0072BB] dark:bg-slate-800 dark:text-sky-300">
                {tr('Solo Transf. / QR', 'Transfer / QR only', 'Só Transf. / QR')}
              </span>
            </label>

            {applyTransferQrIva && (
              <div className="flex flex-wrap items-center gap-1.5">
                {TRANSFER_QR_IVA_PRESETS.map((presetPct) => {
                  const isPresetActive = Math.abs(parsedTransferQrIvaPct - presetPct) < 0.01;
                  return (
                    <button
                      key={presetPct}
                      type="button"
                      onClick={() => {
                        const saved = saveTransferQrIvaPct(presetPct);
                        setTransferQrIvaPct(String(saved));
                      }}
                      className={`h-7 rounded-lg border px-2 font-mono-num text-[11px] font-semibold transition ${
                        isPresetActive
                          ? 'border-[#0072BB] bg-[#0072BB] text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {presetPct === 6.5 ? '6.5% MP' : `${presetPct}%`}
                    </button>
                  );
                })}
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={transferQrIvaPct}
                    onChange={(e) => {
                      setTransferQrIvaPct(e.target.value);
                      const num = Number(e.target.value);
                      if (Number.isFinite(num) && num > 0 && num <= 100) {
                        saveTransferQrIvaPct(num);
                      }
                    }}
                    aria-label={tr('Porcentaje IVA Transferencia / QR', 'Transfer / QR VAT percentage', 'Porcentagem IVA Transferência / QR')}
                    className="h-7 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center font-mono-num text-xs font-semibold text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">%</span>
                </div>
              </div>
            )}
          </div>

          {applyTransferQrIva && (
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              {tr(
                `Solo aplica por Transferencia o QR (${parsedTransferQrIvaPct}% semejante a Mercado Pago${transferQrIvaAmountDisplay > 0 ? ` · +${formatCurrency(transferQrIvaAmountDisplay, selectedCurrency)}` : ''}). En Efectivo queda sin IVA.`,
                `Only applies to Transfer or QR (${parsedTransferQrIvaPct}% Mercado Pago equivalent). Cash payments have no VAT surcharge.`,
                `Aplica-se somente para Transferência ou QR (${parsedTransferQrIvaPct}% equivalente ao Mercado Pago). Em dinheiro fica sem IVA.`
              )}
            </p>
          )}
        </div>

        {/* Payment Method */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            {tr('Método de pago', 'Payment method', 'Forma de pagamento')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'efectivo', label: tr('Efectivo', 'Cash', 'Dinheiro'), icon: Banknote },
                { id: 'tarjeta', label: tr('Tarjeta', 'Card', 'Cartão'), icon: CreditCard },
                { id: 'transferencia', label: tr('Transferencia', 'Transfer', 'Transferência'), icon: Landmark },
              ] as const
            ).map(({ id, label, icon: Icon }) => {
              const active = paymentMethod === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setPaymentMethod(id);
                    if (!ivaTouchedManually) {
                      setApplyTransferQrIva(id === 'transferencia');
                    }
                    if (mpOrder && mpOrder.status !== 'paid') {
                      setMpOrder(null);
                    }
                  }}
                  className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
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

        {paymentMethod === 'tarjeta' && (
          <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/70 p-3.5 dark:border-sky-900/60 dark:bg-sky-950/30">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  Mercado Pago Point · {formatCurrency(mpChargeAmount, baseCurrency)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowMpSettings(true)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
              >
                <Settings2 className="h-3 w-3" />
                {tr('Configurar Point / Token', 'Configure Point / Token', 'Configurar Point / Token')}
              </button>
            </div>

            {!mpConfig.accessToken.trim() || !mpConfig.terminalId.trim() ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-sky-300 bg-white/80 p-3 text-xs text-slate-600 dark:border-sky-800 dark:bg-slate-900/70 dark:text-slate-300">
                <span>
                  {tr(
                    'Ingresá tu Access Token y el ID de tu dispositivo Point para enviar cobros directo a la terminal.',
                    'Enter your Access Token and Point device ID to send charges directly to the terminal.',
                    'Informe seu Access Token e o ID do dispositivo Point para enviar cobranças direto para a maquininha.'
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setShowMpSettings(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0072BB] px-3 text-[11px] font-semibold text-white hover:bg-[#005f9c]"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {tr('Configurar pagos', 'Payment settings', 'Configurar pagamentos')}
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <span>
                    {tr('Terminal conectada:', 'Connected terminal:', 'Terminal conectado:')}{' '}
                    <strong className="font-mono-num text-slate-900 dark:text-white">
                      {mpConfig.terminalId}
                    </strong>
                  </span>
                  {(!mpOrder || mpOrder.mode !== 'point' || mpOrder.status !== 'pending') && (
                    <button
                      type="button"
                      disabled={mpBusy || mpChargeAmount <= 0}
                      onClick={() => void handleCreateMercadoPagoOrder('point')}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-50"
                    >
                      {mpBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Smartphone className="h-3.5 w-3.5" />
                      )}
                      {tr('Enviar orden al Point', 'Send order to Point', 'Enviar pedido ao Point')}
                    </button>
                  )}
                </div>

                {mpOrder && mpOrder.mode === 'point' && (
                  <div
                    className={`space-y-2 rounded-xl border p-3 text-xs ${
                      mpOrder.status === 'paid'
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : mpOrder.status === 'canceled' || mpOrder.status === 'failed'
                          ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
                          : 'border-sky-200 bg-white text-slate-800 dark:border-sky-800 dark:bg-slate-900 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-semibold">
                        {mpOrder.status === 'paid' ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        ) : mpOrder.status === 'pending' ? (
                          <Loader2 className="h-4 w-4 animate-spin text-[#0072BB] dark:text-sky-400" />
                        ) : null}
                        <span>{mpOrder.statusText}</span>
                      </div>
                      <span className="font-mono-num text-[10px] opacity-70">
                        #{mpOrder.orderId.slice(-8)}
                      </span>
                    </div>

                    {mpOrder.status === 'pending' && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={mpBusy}
                          onClick={() => void handleCheckMpStatusOnce()}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <RefreshCw className="h-3 w-3" />
                          {tr('Verificar estado', 'Check status', 'Verificar status')}
                        </button>
                        <button
                          type="button"
                          disabled={mpBusy}
                          onClick={() => void handleCancelMpOrder()}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-400"
                        >
                          <X className="h-3 w-3" />
                          {tr('Cancelar en el Point', 'Cancel on Point', 'Cancelar no Point')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {paymentMethod === 'transferencia' && (
          <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/70 p-3.5 dark:border-sky-900/60 dark:bg-sky-950/30">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200/80 bg-white/85 px-3 py-2.5 dark:border-sky-900/60 dark:bg-slate-900/75">
              <div className="flex items-center gap-2 text-xs">
                <QrCode className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">
                    {tr('QR Dinámico Mercado Pago', 'Dynamic Mercado Pago QR', 'QR Dinâmico Mercado Pago')} · {formatCurrency(mpChargeAmount, baseCurrency)}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {mpConfig.accessToken.trim()
                      ? `${tr('Caja POS:', 'POS Box:', 'Caixa POS:')} ${mpConfig.posExternalId.trim() || 'CAJA01 (automática)'}`
                      : tr(
                          'Generá un QR oficial con el monto exacto automático',
                          'Generate an official QR with the exact automatic amount',
                          'Gere um QR oficial com o valor exato automático'
                        )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowMpSettings(true)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <Settings2 className="h-3 w-3" />
                  {tr('Configurar MP', 'Configure MP', 'Configurar MP')}
                </button>
                {mpConfig.accessToken.trim() && (
                  <button
                    type="button"
                    disabled={mpBusy || mpChargeAmount <= 0}
                    onClick={() => void handleCreateMercadoPagoOrder('qr')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0072BB] px-3 text-[11px] font-semibold text-white hover:bg-[#005f9c] disabled:opacity-50"
                  >
                    {mpBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <QrCode className="h-3.5 w-3.5" />
                    )}
                    {mpOrder?.mode === 'qr'
                      ? tr('Regenerar QR MP', 'Regenerate MP QR', 'Gerar novo QR MP')
                      : tr('Generar QR MP', 'Generate MP QR', 'Gerar QR MP')}
                  </button>
                )}
              </div>
            </div>

            {mpConfig.accessToken.trim() && mpConfig.terminalId.trim() && (
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-sky-200/70 bg-white/60 px-3 py-2 text-[11px] font-medium text-slate-700 dark:border-sky-900/50 dark:bg-slate-900/50 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={showQrOnPointSmart}
                  onChange={(e) => setShowQrOnPointSmart(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-[#0072BB] focus:ring-[#0072BB]"
                />
                <Smartphone className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                <span>
                  {tr(
                    `Mostrar este QR también en el Point Smart (${mpConfig.terminalId}) por si las dudas`,
                    `Also show this QR on Point Smart (${mpConfig.terminalId})`,
                    `Mostrar este QR também no Point Smart (${mpConfig.terminalId})`
                  )}
                </span>
              </label>
            )}

            {mpOrder && mpOrder.mode === 'qr' && (
              <div
                className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-xs ${
                  mpOrder.status === 'paid'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : mpOrder.status === 'canceled' || mpOrder.status === 'failed'
                      ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
                      : 'border-sky-200 bg-white text-slate-800 dark:border-sky-800 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                {mpOrder.qrImageDataUrl && (
                  <img
                    src={mpOrder.qrImageDataUrl}
                    alt={tr('QR dinámico Mercado Pago', 'Dynamic Mercado Pago QR', 'QR dinâmico Mercado Pago')}
                    className="h-28 w-28 shrink-0 rounded-xl border border-slate-200 bg-white p-1.5"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2 font-semibold">
                    {mpOrder.status === 'paid' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : mpOrder.status === 'pending' ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0072BB] dark:text-sky-400" />
                    ) : null}
                    <span>{mpOrder.statusText}</span>
                  </div>
                  <div className="font-mono-num text-[11px] opacity-75">
                    Ref: {mpOrder.externalReference} · {formatCurrency(mpOrder.amount, baseCurrency)}
                  </div>
                  {mpOrder.companionPointOrderId && mpOrder.status === 'pending' && (
                    <div className="inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-2 py-1 text-[11px] font-semibold text-[#0072BB] dark:bg-sky-950/50 dark:text-sky-300">
                      <Smartphone className="h-3.5 w-3.5" />
                      <span>QR también activo en Point Smart ({mpConfig.terminalId})</span>
                    </div>
                  )}
                  {mpOrder.companionPointWarning && mpOrder.status === 'pending' && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                      {mpOrder.companionPointWarning}
                    </div>
                  )}
                  {mpOrder.status === 'pending' && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={mpBusy}
                        onClick={() => void handleCheckMpStatusOnce()}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        <RefreshCw className="h-3 w-3" />
                        {tr('Verificar pago', 'Verify payment', 'Verificar pagamento')}
                      </button>
                      <button
                        type="button"
                        disabled={mpBusy}
                        onClick={() => void handleCancelMpOrder()}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-400"
                      >
                        <X className="h-3 w-3" />
                        {tr('Cancelar QR', 'Cancel QR', 'Cancelar QR')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-start gap-3">
              {transferQrDataUrl && (
                <img
                  src={transferQrDataUrl}
                  alt={tr('QR de transferencia', 'Transfer QR', 'QR de transferência')}
                  className="h-20 w-20 shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-1"
                />
              )}
              <div className="min-w-0 flex-1 space-y-1.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 dark:text-white">
                    {tr('Datos de transferencia', 'Transfer details', 'Dados de transferência')} · {formatCurrency(qrChargeAmount, selectedCurrency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingTransferCfg((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                  >
                    <Settings2 className="h-3 w-3" />
                    {editingTransferCfg
                      ? tr('Ocultar edición', 'Hide editor', 'Ocultar edição')
                      : tr('Editar Alias / CBU / QR', 'Edit Alias / Bank / QR', 'Editar Chave / Conta / QR')}
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
                      {tr('Copiar', 'Copy', 'Copiar')}
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
                      {tr('Copiar', 'Copy', 'Copiar')}
                    </button>
                  </div>
                )}

                {transferCfg.holder.trim() && (
                  <div className="text-[11px] text-slate-600 dark:text-slate-300">
                    {tr('Titular:', 'Account holder:', 'Titular:')} <strong>{transferCfg.holder}</strong>
                  </div>
                )}

                {!hasTransferData && !editingTransferCfg && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr(
                      'Cargá tu Alias o CBU/CVU para que aparezca en la boleta impresa.',
                      'Add your alias or bank details to display on the printed receipt.',
                      'Adicione sua chave ou dados bancários para aparecer no comprovante impresso.'
                    )}
                  </div>
                )}
              </div>
            </div>

            {editingTransferCfg && (
              <div className="space-y-2.5 border-t border-sky-200/80 pt-3 dark:border-sky-900/60">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      {tr('Alias', 'Alias / Pix', 'Apelido / Pix')}
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
                      placeholder={tr('22 dígitos', '22 digits', '22 dígitos')}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      {tr('Titular (opcional)', 'Account holder (optional)', 'Titular (opcional)')}
                    </label>
                    <input
                      type="text"
                      value={transferCfg.holder}
                      onChange={(e) =>
                        setTransferCfg((prev) => ({ ...prev, holder: e.target.value }))
                      }
                      placeholder={tr('Nombre o razón social', 'Name or business', 'Nome ou razão social')}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      {tr('Link de pago MP (opcional)', 'MP payment link (optional)', 'Link de pagamento MP (opcional)')}
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
                      {tr('Subir QR (MP / Banco)', 'Upload QR (MP / Bank)', 'Enviar QR (MP / Banco)')}
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
                        {tr('Quitar QR', 'Remove QR', 'Remover QR')}
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveTransferCfg}
                    className="h-8 rounded-lg bg-[#0072BB] px-3 text-[11px] font-semibold text-white hover:bg-[#005f9c]"
                  >
                    {tr('Guardar datos', 'Save details', 'Salvar dados')}
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
            {tr('Cancelar', 'Cancel', 'Cancelar')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-xl border border-[#0072BB] px-3 text-sm font-semibold text-[#0072BB] hover:bg-sky-50 dark:border-sky-500 dark:text-sky-400 dark:hover:bg-sky-950/40"
          >
            {saving
              ? tr('Guardando...', 'Saving...', 'Salvando...')
              : editSale
                ? tr('Guardar cambios', 'Save changes', 'Salvar alterações')
                : tr('Guardar', 'Save', 'Salvar')}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submitSale(true)}
            className="inline-flex h-11 flex-[1.3] items-center justify-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-sm font-semibold text-white hover:bg-[#005f9c]"
          >
            <Printer className="h-4 w-4 shrink-0" />
            <span>
              {saving
                ? tr('Guardando...', 'Saving...', 'Salvando...')
                : tr('Guardar e imprimir', 'Save & print', 'Salvar e imprimir')}
            </span>
          </button>
        </div>
      </form>

      <PaymentSettingsModal
        open={showMpSettings}
        onClose={() => setShowMpSettings(false)}
        ownerId={ownerId}
        profile={profile}
        onSaved={(saved) => setMpConfig(saved)}
      />
    </ModalShell>
  );
};
