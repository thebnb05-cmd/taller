import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Banknote,
  CheckCircle2,
  Coins,
  Copy,
  CreditCard,
  Landmark,
  Loader2,
  Package,
  Printer,
  QrCode,
  RefreshCw,
  Settings2,
  Smartphone,
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
  cancelMercadoPagoOrder,
  checkMercadoPagoOrderStatus,
  createMercadoPagoOrder,
  hydrateMercadoPagoConfig,
  loadMercadoPagoConfig,
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
import { serializeSaleStatus } from '../utils/saleMeta';
import { parseWorkshopMeta, syncMercadoPagoConfigFromProfile } from '../utils/workshopMeta';
import {
  parseSafeNonNegativeInt,
  parseSafePositiveNumber,
  sanitizeAlias,
  sanitizeCbu,
  sanitizeDbErrorMessage,
  sanitizeImageDataUrl,
  sanitizePlainLine,
  sanitizeSafeUrl,
} from '../utils/validation';
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
  profile?: WorkshopProfile | null;
  brandName?: string;
  onCreated?: (sale: SaleRecord) => void;
}

function roundCurrencyValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
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
}

export const NewSaleModal: React.FC<NewSaleModalProps> = ({
  open,
  onClose,
  ownerId,
  clients,
  products = [],
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

  const [selectedProductId, setSelectedProductId] = useState<string>('');
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
  const [mpConfig, setMpConfig] = useState<MercadoPagoConfig>(() => loadMercadoPagoConfig(ownerId));
  const [showMpSettings, setShowMpSettings] = useState(false);
  const [mpOrder, setMpOrder] = useState<ActiveMpOrder | null>(null);
  const [mpBusy, setMpBusy] = useState(false);

  const selectedProduct = useMemo(() => {
    if (preselectedProduct) return preselectedProduct;
    if (!selectedProductId) return null;
    return products.find((p) => p.id === selectedProductId) || null;
  }, [preselectedProduct, selectedProductId, products]);

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
    setSelectedProductId(preselectedProduct?.id || '');
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
    setMpConfig(loadMercadoPagoConfig(ownerId));
    setMpOrder(null);
    setMpBusy(false);
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
    };
  }, [open, ownerId, preselectedProduct, baseCurrency, profile]);

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

  // Automatic status polling for active Mercado Pago QR or Point orders
  useEffect(() => {
    if (!open || !mpOrder || mpOrder.status !== 'pending' || !mpConfig.accessToken.trim()) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await checkMercadoPagoOrderStatus({
          accessToken: mpConfig.accessToken.trim(),
          orderId: mpOrder.orderId,
          apiFamily: mpOrder.apiFamily,
          externalReference: mpOrder.externalReference,
        });
        if (cancelled || !res.ok) return;

        if (res.isPaid) {
          setMpOrder((prev) =>
            prev && prev.orderId === mpOrder.orderId
              ? {
                  ...prev,
                  status: 'paid',
                  statusText: 'Pago aprobado y acreditado en Mercado Pago.',
                }
              : prev
          );
          setStatus('cobrado');
          setDeposit(amount);
          notify('¡Pago aprobado en Mercado Pago!');
        } else if (res.isCanceled) {
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
      } catch {
        // Keep polling on transient network error
      }
    };

    const timer = window.setInterval(() => {
      void poll();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, mpOrder, mpConfig.accessToken, amount, notify]);

  const handleSelectProduct = (nextProdId: string) => {
    setSelectedProductId(nextProdId);
    const chosen = products.find((p) => p.id === nextProdId);
    if (!chosen) return;
    const cleanQty = Math.max(1, quantity);
    const baseTotal = chosen.price * cleanQty;
    const convertedTotal = isSecondaryCurrency
      ? roundCurrencyValue(convertFromBaseCurrency(baseTotal, activeRate))
      : roundCurrencyValue(baseTotal);
    const nextAmtStr = String(convertedTotal);
    setAmount(nextAmtStr);
    if (status === 'cobrado') {
      setDeposit(nextAmtStr);
    }
  };

  const handleCurrencyChange = (nextRaw: string) => {
    const nextCode = sanitizeCurrencyCode(nextRaw);
    if (nextCode === selectedCurrency) return;
    const nextRate =
      getCurrencyRateFromBase(nextCode, baseCurrency, secondaryCurrencies) ?? 1;

    if (selectedProduct) {
      const baseTotal = selectedProduct.price * Math.max(1, quantity);
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
    if (selectedProduct) {
      const baseTotal = selectedProduct.price * clean;
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
      selectedProduct &&
      selectedProduct.trackStock &&
      !selectedProduct.allowNoStock &&
      cleanQty > selectedProduct.stock
    ) {
      notify(`Stock insuficiente (disponible: ${selectedProduct.stock} u.).`, 'error');
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
        productId: clampStr(selectedProduct?.id, 128),
        productName: sanitizePlainLine(selectedProduct?.name || '', 200),
        quantity: selectedProduct ? cleanQty : undefined,
        amount: cleanAmount,
        status: serializedStatus,
        dueDate: finalDueDate,
      });

      await upsertRow('sales', salePayload);

      if (selectedProduct && selectedProduct.trackStock) {
        await updateRow('products', selectedProduct.id, {
          stock: Math.max(0, selectedProduct.stock - cleanQty),
        });
      }

      const createdRecord: SaleRecord = {
        id: saleId,
        ownerId,
        clientId: resolvedClientId,
        clientName: cleanClientName,
        invoice: finalInvoice,
        productId: selectedProduct?.id,
        productName: selectedProduct?.name,
        quantity: selectedProduct ? cleanQty : undefined,
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
    if (mode === 'qr' && !mpConfig.posExternalId.trim()) {
      notify('Ingresá el ID de punto de venta / Caja para generar el QR dinámico.', 'error');
      setShowMpSettings(true);
      return;
    }
    if (mode === 'point' && !mpConfig.terminalId.trim()) {
      notify('Ingresá el ID del dispositivo Point para enviar el cobro.', 'error');
      setShowMpSettings(true);
      return;
    }

    const cleanQty = Math.max(1, parseSafeNonNegativeInt(quantity, 1, 10_000));
    const description = selectedProduct
      ? `${selectedProduct.name} x${cleanQty}`
      : `Venta ${invoice || effectiveBrandName}`;
    const extRef = `${(invoice || 'FV').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'FV'}-${Date.now().toString().slice(-6)}`;

    setMpBusy(true);
    try {
      const res = await createMercadoPagoOrder({
        accessToken: mpConfig.accessToken.trim(),
        mode,
        amount: mpChargeAmount,
        description,
        externalReference: extRef,
        posExternalId: mpConfig.posExternalId.trim(),
        terminalId: mpConfig.terminalId.trim(),
        printOnTerminal: mpConfig.printOnTerminal,
      });

      if (!res.ok || !res.orderId) {
        notify(res.error || 'No se pudo iniciar la orden en Mercado Pago.', 'error');
        return;
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
            ? 'QR dinámico activo · Esperando que el cliente escanee y pague...'
            : `Orden enviada a ${mpConfig.terminalId} · Esperando tarjeta en el Point...`,
      });

      notify(
        mode === 'qr'
          ? 'QR dinámico de Mercado Pago generado.'
          : 'Orden enviada al dispositivo Point.'
      );
    } catch {
      notify('Error de conexión con el servidor de Mercado Pago.', 'error');
    } finally {
      setMpBusy(false);
    }
  };

  const handleCheckMpStatusOnce = async () => {
    if (!mpOrder || !mpConfig.accessToken.trim()) return;
    setMpBusy(true);
    try {
      const res = await checkMercadoPagoOrderStatus({
        accessToken: mpConfig.accessToken.trim(),
        orderId: mpOrder.orderId,
        apiFamily: mpOrder.apiFamily,
        externalReference: mpOrder.externalReference,
      });
      if (!res.ok) {
        notify(res.error || 'No se pudo consultar el estado.', 'error');
        return;
      }
      if (res.isPaid) {
        setMpOrder((prev) =>
          prev
            ? {
                ...prev,
                status: 'paid',
                statusText: 'Pago aprobado y acreditado en Mercado Pago.',
              }
            : prev
        );
        setStatus('cobrado');
        setDeposit(amount);
        notify('¡Pago aprobado en Mercado Pago!');
      } else if (res.isCanceled) {
        setMpOrder((prev) =>
          prev
            ? {
                ...prev,
                status: 'canceled',
                statusText: 'Orden cancelada o vencida.',
              }
            : prev
        );
      } else if (res.isFailed) {
        setMpOrder((prev) =>
          prev
            ? {
                ...prev,
                status: 'failed',
                statusText: 'Pago rechazado o con error.',
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
    setMpBusy(true);
    try {
      const res = await cancelMercadoPagoOrder({
        accessToken: mpConfig.accessToken.trim(),
        orderId: mpOrder.orderId,
        apiFamily: mpOrder.apiFamily,
        terminalId: mpConfig.terminalId.trim(),
        posExternalId: mpConfig.posExternalId.trim(),
      });
      if (!res.ok) {
        notify(res.error || 'No se pudo cancelar la orden en Mercado Pago.', 'error');
        return;
      }
      setMpOrder(null);
      notify('Orden cancelada en Mercado Pago.');
    } finally {
      setMpBusy(false);
    }
  };

  return (
    <ModalShell open={open} onClose={onClose} title="Nueva venta" maxWidth="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {!preselectedProduct && products.length > 0 && (
          <div>
            <label
              htmlFor="sale-product-select"
              className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              Producto del inventario (opcional)
            </label>
            <select
              id="sale-product-select"
              value={selectedProductId}
              onChange={(e) => handleSelectProduct(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="">Venta libre / concepto manual</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatCurrency(p.price, baseCurrency)}
                  {p.trackStock ? ` (Stock: ${p.stock} u.)` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedProduct && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50/70 p-3.5 dark:border-sky-900/60 dark:bg-sky-950/30">
            <div className="flex min-w-0 items-center gap-2.5">
              <Package className="h-5 w-5 shrink-0 text-[#0072BB] dark:text-sky-400" />
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                  {selectedProduct.name}
                </div>
                <div className="text-xs text-slate-500">
                  {formatCurrency(
                    isSecondaryCurrency
                      ? roundCurrencyValue(convertFromBaseCurrency(selectedProduct.price, activeRate))
                      : selectedProduct.price,
                    selectedCurrency
                  )}{' '}
                  c/u{selectedProduct.trackStock ? ` · Stock: ${selectedProduct.stock}` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-20">
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
              {!preselectedProduct && (
                <button
                  type="button"
                  onClick={() => setSelectedProductId('')}
                  title="Quitar producto seleccionado"
                  aria-label="Quitar producto"
                  className="mt-3.5 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
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
                    onClick={() => {
                      setPaymentMethod(id);
                      if (mpOrder && mpOrder.status !== 'paid') {
                        setMpOrder(null);
                      }
                    }}
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
                Configurar Point / Token
              </button>
            </div>

            {!mpConfig.accessToken.trim() || !mpConfig.terminalId.trim() ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-sky-300 bg-white/80 p-3 text-xs text-slate-600 dark:border-sky-800 dark:bg-slate-900/70 dark:text-slate-300">
                <span>
                  Ingresá tu Access Token y el ID de tu dispositivo Point para enviar cobros directo a la terminal.
                </span>
                <button
                  type="button"
                  onClick={() => setShowMpSettings(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0072BB] px-3 text-[11px] font-semibold text-white hover:bg-[#005f9c]"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Configurar pagos
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <span>
                    Terminal conectada:{' '}
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
                      Enviar orden al Point
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
                          Verificar estado
                        </button>
                        <button
                          type="button"
                          disabled={mpBusy}
                          onClick={() => void handleCancelMpOrder()}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-400"
                        >
                          <X className="h-3 w-3" />
                          Cancelar en el Point
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
                    QR Dinámico Mercado Pago · {formatCurrency(mpChargeAmount, baseCurrency)}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {mpConfig.accessToken.trim() && mpConfig.posExternalId.trim()
                      ? `Caja POS: ${mpConfig.posExternalId}`
                      : 'Generá un QR oficial con el monto exacto automático'}
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
                  Configurar MP
                </button>
                {mpConfig.accessToken.trim() && mpConfig.posExternalId.trim() && (
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
                    {mpOrder?.mode === 'qr' ? 'Regenerar QR MP' : 'Generar QR MP'}
                  </button>
                )}
              </div>
            </div>

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
                    alt="QR dinámico Mercado Pago"
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
                  {mpOrder.status === 'pending' && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={mpBusy}
                        onClick={() => void handleCheckMpStatusOnce()}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Verificar pago
                      </button>
                      <button
                        type="button"
                        disabled={mpBusy}
                        onClick={() => void handleCancelMpOrder()}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-400"
                      >
                        <X className="h-3 w-3" />
                        Cancelar QR
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
