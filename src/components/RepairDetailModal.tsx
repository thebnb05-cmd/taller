import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  Banknote,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Coins,
  Copy,
  CreditCard,
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageCircle,
  Package,
  PenTool,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Smartphone,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  User,
  Video,
  X,
} from 'lucide-react';
import {
  clampStr,
  deleteRow,
  fetchSingleById,
  stripUndefined,
  updateRow,
  upsertRow,
} from '../lib/db';
import { STATUS_META } from '../data/catalog';
import type {
  ClientRecord,
  ProductRecord,
  RepairRecord,
  RepairStatus,
  WorkshopProfile,
} from '../types/workshop';
import {
  compressImageToDataUrl,
  formatCurrency,
  formatDateShort,
  getStatusMeta,
} from '../utils/formatters';
import {
  buildTransferQrPayload,
  buildTransferWhatsAppText,
  hydrateTransferConfig,
  loadTransferConfig,
  PAYMENT_METHOD_LABELS,
  parsePaymentInfo,
  saveTransferConfig,
  serializeRepairPaymentStatus,
  type PaymentMethod,
  type TransferConfig,
} from '../utils/payment';
import {
  dismissRecoveredPayment,
  markPaymentReconciled,
  recordPaymentAttempt,
  recordRecoveredPayment,
} from '../utils/paymentLedger';
import {
  cancelMercadoPagoOrder,
  checkMercadoPagoOrderStatus,
  createMercadoPagoOrder,
  hydrateMercadoPagoConfig,
  loadMercadoPagoConfig,
  saveMercadoPagoConfig,
  type MercadoPagoConfig,
} from '../utils/mercadoPago';
import {
  compressPhotoForTracking,
  createMediaId,
  getEmbedVideoUrl,
  MAX_INLINE_VIDEO_BYTES,
  parseWorkDetailAndMedia,
  readVideoAsDataUrl,
  serializeWorkDetailAndMedia,
  type TechMediaItem,
} from '../utils/techMedia';
import { extractBatchRef } from '../utils/batchRef';
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
import { buildTrackingUrl } from '../utils/tracking';
import { getFunctionalCheckFields, getPhysicalCheckFields } from '../utils/checkFields';
import {
  parseCheckoutAndSignature,
  serializeCheckoutAndSignature,
} from '../utils/signatureMeta';
import {
  appendTimelineEntry,
  computeWarrantyInfo,
  createRepairMetaId,
  mergeCheckoutPaymentLedger,
  mergeWorkDetailPublicMeta,
  parseRepairPaymentLedger,
  parseRepairPublicMeta,
  type RepairPublicMeta,
} from '../utils/repairMeta';
import {
  buildRepairWhatsAppMessage,
  resolveDefaultTemplateForStatus,
  WHATSAPP_TEMPLATE_OPTIONS,
  type WhatsAppTemplateId,
} from '../utils/whatsappTemplates';
import {
  parseWorkshopMeta,
  saveMercadoPagoConfigToProfile,
  syncMercadoPagoConfigFromProfile,
} from '../utils/workshopMeta';
import {
  isValidEmail,
  parseSafePositiveNumber,
  sanitizeAlias,
  sanitizeCbu,
  sanitizeDbErrorMessage,
  sanitizeDni,
  sanitizeEmail,
  sanitizeImageDataUrl,
  sanitizeMediaUrl,
  sanitizePhone,
  sanitizePlainLine,
  sanitizeSafeUrl,
  sanitizeText,
} from '../utils/validation';
import { getTranslatedStatusLabel, useI18n } from '../utils/i18n';
import { ModalShell } from './ModalShell';
import { PatternLock } from './PatternLock';
import { RepairPrintDocuments } from './RepairPrintDocuments';
import { RepairStatusTimeline } from './RepairStatusTimeline';
import { PaymentSettingsModal } from './PaymentSettingsPanel';
import { useToast } from './ToastProvider';

interface ActiveRepairMpOrder {
  mode: 'qr' | 'point';
  apiFamily?: 'orders_v1' | 'legacy_qr' | 'legacy_intent';
  orderId: string;
  externalReference: string;
  amount: number;
  qrImageDataUrl?: string;
  status: 'pending' | 'paid' | 'canceled' | 'failed';
  statusText: string;
  companionPointOrderId?: string;
  companionPointApiFamily?: 'orders_v1' | 'legacy_qr' | 'legacy_intent';
  companionPointExternalReference?: string;
  companionPointWarning?: string;
}

interface RepairDetailModalProps {
  repair: RepairRecord | null;
  clients?: ClientRecord[];
  products?: ProductRecord[];
  profile?: WorkshopProfile | null;
  initialTab?: 'detail' | 'edit' | 'receipt';
  justCreated?: boolean;
  onOpenBatch?: (batchRef: string) => void;
  onWarrantyReentry?: (repair: RepairRecord) => void;
  onClose: () => void;
}

export const RepairDetailModal: React.FC<RepairDetailModalProps> = ({
  repair,
  clients = [],
  products = [],
  profile,
  initialTab = 'detail',
  justCreated = false,
  onOpenBatch,
  onWarrantyReentry,
  onClose,
}) => {
  const { notify } = useToast();
  const { tr } = useI18n();
  const activeCurrency = useActiveCurrency();
  const workshopMeta = useMemo(() => parseWorkshopMeta(profile), [profile]);
  const baseCurrency: CurrencyCode = profile ? workshopMeta.currency : activeCurrency;
  const secondaryCurrencies = workshopMeta.secondaryCurrencies;
  const [editCurrency, setEditCurrency] = useState<CurrencyCode>(baseCurrency);
  const [tab, setTab] = useState<'detail' | 'edit' | 'receipt'>(initialTab);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit state
  const [status, setStatus] = useState<RepairStatus>('recibido');
  const [progress, setProgress] = useState(15);
  const [technician, setTechnician] = useState('');
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const [partSearch, setPartSearch] = useState('');
  const [syncPartPrice, setSyncPartPrice] = useState(true);
  const [notes, setNotes] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientDni, setClientDni] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [price, setPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const [workDetail, setWorkDetail] = useState('');
  const [mediaItems, setMediaItems] = useState<TechMediaItem[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [mediaLinkUrl, setMediaLinkUrl] = useState('');
  const [mediaLinkType, setMediaLinkType] = useState<'video' | 'image'>('video');
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [checkoutState, setCheckoutState] = useState('');
  const [physicalCheck, setPhysicalCheck] = useState<Record<string, string>>({});
  const [functionalCheck, setFunctionalCheck] = useState<Record<string, string>>({});
  const [warrantyDays, setWarrantyDays] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  // Payment, quote & WhatsApp template state in Detalle tab
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo');
  const [paying, setPaying] = useState(false);
  const [justPaid, setJustPaid] = useState(false);
  const [partialAmount, setPartialAmount] = useState('');
  const [partialCurrency, setPartialCurrency] = useState<CurrencyCode>(baseCurrency);
  const [partialMethod, setPartialMethod] = useState<PaymentMethod>('efectivo');
  const [partialNote, setPartialNote] = useState('');
  const [savingPartial, setSavingPartial] = useState(false);
  const [waTemplate, setWaTemplate] = useState<WhatsAppTemplateId>('auto');
  const [sendingQuote, setSendingQuote] = useState(false);
  const [transferConfig, setTransferConfig] = useState<TransferConfig>(() =>
    loadTransferConfig(repair?.ownerId || '')
  );
  const [editingTransferConfig, setEditingTransferConfig] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [mpConfig, setMpConfig] = useState<MercadoPagoConfig>(() =>
    loadMercadoPagoConfig(repair?.ownerId || '')
  );
  const [showMpSettings, setShowMpSettings] = useState(false);
  const [mpOrder, setMpOrder] = useState<ActiveRepairMpOrder | null>(null);
  const [mpBusy, setMpBusy] = useState(false);
  const [showQrOnPointSmart, setShowQrOnPointSmart] = useState(true);
  const [mpChargeTarget, setMpChargeTarget] = useState<'full' | 'partial'>('full');
  const handledMpOrdersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!repair?.id) return;
    setTab(initialTab);
    setConfirmDelete(false);
    setJustPaid(false);
    setPaymentMethod('efectivo');
    setPartialAmount('');
    setPartialMethod('efectivo');
    setPartialNote('');
    setWaTemplate('auto');
    setEditingTransferConfig(false);
    setMpOrder(null);
    setMpBusy(false);
    setMpChargeTarget('full');
    setShowMpSettings(false);
    setShowLinkInput(false);
    setMediaLinkUrl('');
    setLightboxImage(null);
    setPartSearch('');
    setSyncPartPrice(true);
  }, [repair?.id, initialTab]);

  useEffect(() => {
    const targetOwnerId = repair?.ownerId || '';
    if (!targetOwnerId) return;
    let cancelled = false;
    const localMp = loadMercadoPagoConfig(targetOwnerId);
    const syncedMp = syncMercadoPagoConfigFromProfile(targetOwnerId, profile);
    setMpConfig(
      syncedMp && (syncedMp.accessToken || syncedMp.terminalId || syncedMp.posExternalId)
        ? syncedMp
        : localMp
    );
    void hydrateMercadoPagoConfig(targetOwnerId).then((cfg) => {
      if (cancelled) return;
      if (cfg.accessToken || cfg.terminalId || cfg.posExternalId) {
        setMpConfig(cfg);
        return;
      }
      const fromProfile = syncMercadoPagoConfigFromProfile(targetOwnerId, profile);
      if (
        fromProfile &&
        (fromProfile.accessToken || fromProfile.terminalId || fromProfile.posExternalId)
      ) {
        setMpConfig(fromProfile);
      } else {
        setMpConfig(cfg);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [repair?.ownerId, profile]);

  useEffect(() => {
    if (!repair) return;
    const parsedInfo = parsePaymentInfo(repair);
    const hasConfigured =
      parsedInfo.currency &&
      (parsedInfo.currency === baseCurrency ||
        secondaryCurrencies.some((c) => c.code === parsedInfo.currency) ||
        Boolean(parsedInfo.rate));
    const initialCur: CurrencyCode =
      hasConfigured && parsedInfo.currency ? parsedInfo.currency : baseCurrency;
    const initialRate =
      getCurrencyRateFromBase(initialCur, baseCurrency, secondaryCurrencies) ??
      (parsedInfo.currency === initialCur && parsedInfo.rate ? parsedInfo.rate : 1);
    const initialIsSecondary = initialCur !== baseCurrency && initialRate !== 1;

    setEditCurrency(initialCur);
    setPartialCurrency(initialCur);
    setStatus((repair.status as RepairStatus) || 'recibido');
    setProgress(repair.progress ?? 15);
    setTechnician(parsedInfo.technician || '');
    setSelectedPartIds([...(repair.partIds || [])]);
    setNotes(repair.notes || '');
    setClientName(repair.clientName || '');
    setClientPhone(repair.clientPhone || '');
    setClientDni(repair.clientDni || '');
    setClientEmail(repair.clientEmail || '');
    setClientAddress(repair.clientAddress || '');
    setPrice(
      String(
        initialIsSecondary
          ? Math.round(convertFromBaseCurrency(Number(repair.price ?? 0), initialRate) * 100) / 100
          : (repair.price ?? 0)
      )
    );
    setDeposit(
      String(
        initialIsSecondary
          ? Math.round(convertFromBaseCurrency(Number(repair.deposit ?? 0), initialRate) * 100) /
              100
          : (repair.deposit ?? 0)
      )
    );
    const parsedWork = parseWorkDetailAndMedia(repair.workDetail);
    const parsedMeta = parseRepairPublicMeta(repair.workDetail);
    setWorkDetail(parsedWork.text);
    setMediaItems(parsedWork.media);
    setWarrantyDays(parsedMeta.warrantyDays ?? 0);
    setCheckoutState(parseCheckoutAndSignature(repair.checkoutState).text);
    setPhysicalCheck({ ...(repair.physicalCheck || {}) });
    setFunctionalCheck({ ...(repair.functionalCheck || {}) });
    setTransferConfig(loadTransferConfig(repair.ownerId));

    let cancelled = false;
    void hydrateTransferConfig(repair.ownerId).then((cfg) => {
      if (!cancelled) setTransferConfig(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, [repair, baseCurrency, secondaryCurrencies]);

  const currentPendingBalance = repair
    ? Math.max(0, Number(repair.price || 0) - Number(repair.deposit || 0))
    : 0;

  useEffect(() => {
    if (!repair || paymentMethod !== 'transferencia' || transferConfig.qrImageDataUrl) {
      setQrDataUrl('');
      return;
    }
    const payload = buildTransferQrPayload(
      transferConfig,
      profile?.brandName || 'TH3 BNB',
      repair.code,
      repair.clientName,
      currentPendingBalance
    );
    if (!payload) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(payload, {
      width: 240,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [repair, paymentMethod, transferConfig, profile?.brandName, currentPendingBalance]);

  const commitApprovedMpPayment = useCallback(
    async (orderSnapshot: ActiveRepairMpOrder, paidViaCompanionPoint: boolean) => {
      if (!repair) return;
      if (handledMpOrdersRef.current.has(orderSnapshot.orderId)) return;
      handledMpOrdersRef.current.add(orderSnapshot.orderId);

      const mpChannel: 'mp_point' | 'mp_qr' =
        orderSnapshot.mode === 'point' || paidViaCompanionPoint ? 'mp_point' : 'mp_qr';
      const methodForOrder: PaymentMethod =
        orderSnapshot.mode === 'point' ? 'tarjeta' : 'transferencia';
      const paidAmt = Math.max(0, Math.round(Number(orderSnapshot.amount || 0) * 100) / 100);
      const budget = Math.max(0, Number(repair.price || 0));
      const prevDeposit = Math.max(0, Number(repair.deposit || 0));
      const rawNextDeposit = Math.round((prevDeposit + paidAmt) * 100) / 100;
      const isFullNow = budget > 0 ? rawNextDeposit >= budget - 0.01 : true;
      const nextDeposit = budget > 0 && isFullNow ? budget : rawNextDeposit;
      const nextBaseStatus: 'pendiente' | 'parcial' | 'pagado' = isFullNow ? 'pagado' : 'parcial';
      const nowIso = new Date().toISOString();

      const channelNote = paidViaCompanionPoint
        ? 'Cobro aprobado QR en Point Smart [Point MP]'
        : orderSnapshot.mode === 'point'
          ? 'Cobro aprobado Point Smart [Point MP]'
          : 'Cobro aprobado QR MP [QR MP]';

      if (paidAmt > 0 && repair.ownerId) {
        recordRecoveredPayment({
          id: orderSnapshot.orderId,
          ownerId: repair.ownerId,
          source: 'reparacion',
          method: methodForOrder,
          mpChannel,
          amount: paidAmt,
          totalAmount: budget || paidAmt,
          clientName: repair.clientName || 'Cliente',
          title: `${repair.code} · ${repair.brand} ${repair.model}`,
          subtitle: paidViaCompanionPoint
            ? 'Aprobado vía QR en Point Smart (pendiente de guardar orden)'
            : orderSnapshot.mode === 'point'
              ? 'Aprobado en Point Smart (pendiente de guardar orden)'
              : 'Aprobado vía QR Mercado Pago (pendiente de guardar orden)',
          mpOrderId: orderSnapshot.orderId,
          mpCompanionOrderId: orderSnapshot.companionPointOrderId,
          mpExternalReference: orderSnapshot.externalReference,
          saveFailed: false,
        });
      }

      const token = mpConfig.accessToken.trim();
      if (token) {
        if (paidViaCompanionPoint) {
          void cancelMercadoPagoOrder({
            accessToken: token,
            orderId: orderSnapshot.orderId,
            apiFamily: orderSnapshot.apiFamily,
            posExternalId: mpConfig.posExternalId.trim(),
          }).catch(() => {});
        } else if (orderSnapshot.companionPointOrderId) {
          void cancelMercadoPagoOrder({
            accessToken: token,
            orderId: orderSnapshot.companionPointOrderId,
            apiFamily: orderSnapshot.companionPointApiFamily || 'orders_v1',
            terminalId: mpConfig.terminalId.trim(),
          }).catch(() => {});
        }
      }

      const parsedCurr = parsePaymentInfo(repair);
      const prevLedger = parseRepairPaymentLedger(repair.checkoutState);
      const nextCheckoutState = mergeCheckoutPaymentLedger(repair.checkoutState, [
        ...prevLedger,
        {
          id: createRepairMetaId('pay'),
          amount: paidAmt,
          method: methodForOrder,
          date: nowIso,
          mpChannel,
          mpOrderId: orderSnapshot.orderId,
          mpExternalReference: orderSnapshot.externalReference,
          note: isFullNow
            ? prevDeposit > 0
              ? `Cancelación de saldo · ${channelNote}`
              : `Pago total · ${channelNote}`
            : `Seña / Abono · ${channelNote}`,
        },
      ]);

      const nextPaymentStatus = serializeRepairPaymentStatus({
        base: nextBaseStatus,
        method: nextBaseStatus === 'pagado' ? methodForOrder : parsedCurr.method,
        currency:
          parsedCurr.currency && parsedCurr.currency !== baseCurrency
            ? parsedCurr.currency
            : undefined,
        rate:
          parsedCurr.currency && parsedCurr.currency !== baseCurrency
            ? parsedCurr.rate
            : undefined,
        technician: parsedCurr.technician || undefined,
      });

      setMpOrder((prev) =>
        prev
          ? {
              ...prev,
              status: 'paid',
              statusText: paidViaCompanionPoint
                ? tr(
                    '¡Pago QR aprobado desde el Point Smart!',
                    'QR payment approved on Point Smart!',
                    'Pagamento QR aprovado no Point Smart!'
                  )
                : orderSnapshot.mode === 'point'
                  ? tr(
                      '¡Pago aprobado en el Point!',
                      'Payment approved on Point!',
                      'Pagamento aprovado no Point!'
                    )
                  : tr(
                      '¡Pago QR aprobado y acreditado!',
                      'QR payment approved and credited!',
                      'Pagamento QR aprovado e creditado!'
                    ),
            }
          : prev
      );

      try {
        await updateRow('repairs', repair.id, {
          deposit: nextDeposit,
          paidAmount: nextDeposit,
          paymentStatus: nextPaymentStatus,
          checkoutState: nextCheckoutState,
          updatedAt: nowIso,
        });

        if (repair.trackingCode) {
          const ticket = await fetchSingleById<{ id: string }>('public_tickets', repair.trackingCode);
          if (ticket) {
            await updateRow('public_tickets', repair.trackingCode, {
              deposit: nextDeposit,
              updatedAt: nowIso,
            });
          }
        }

        if (repair.ownerId) {
          markPaymentReconciled({
            ownerId: repair.ownerId,
            mpOrderId: orderSnapshot.orderId,
            mpCompanionOrderId: orderSnapshot.companionPointOrderId,
            mpExternalReference: orderSnapshot.externalReference,
            repairId: repair.id,
          });
        }

        const localRate =
          parsedCurr.currency && parsedCurr.currency !== baseCurrency && parsedCurr.rate
            ? parsedCurr.rate
            : 1;
        setDeposit(
          String(
            localRate !== 1
              ? Math.round(convertFromBaseCurrency(nextDeposit, localRate) * 100) / 100
              : nextDeposit
          )
        );
        if (!isFullNow) {
          setPartialAmount('');
          setPartialNote('');
          setMpChargeTarget('full');
        }

        notify(
          paidViaCompanionPoint
            ? '¡Pago QR aprobado en el Point Smart y registrado en la orden!'
            : orderSnapshot.mode === 'point'
              ? '¡Pago aprobado en el Point Smart y registrado en la orden!'
              : '¡Pago QR de Mercado Pago aprobado y registrado en la orden!'
        );
        if (isFullNow) {
          setJustPaid(true);
          setTab('receipt');
        }
      } catch (err) {
        const msg = sanitizeDbErrorMessage(err, 'No se pudo guardar el cobro en la orden.');
        if (paidAmt > 0 && repair.ownerId) {
          recordRecoveredPayment({
            id: orderSnapshot.orderId,
            ownerId: repair.ownerId,
            source: 'reparacion',
            method: methodForOrder,
            mpChannel,
            amount: paidAmt,
            totalAmount: budget || paidAmt,
            clientName: repair.clientName || 'Cliente',
            title: `${repair.code} · ${repair.brand} ${repair.model}`,
            subtitle: `${channelNote} (error al guardar en nube)`,
            mpOrderId: orderSnapshot.orderId,
            mpCompanionOrderId: orderSnapshot.companionPointOrderId,
            mpExternalReference: orderSnapshot.externalReference,
            saveFailed: true,
            saveError: msg,
          });
          notify(`${msg} El cobro aprobado quedó resguardado en Caja diaria.`, 'error');
        } else {
          notify(msg, 'error');
        }
      }
    },
    [repair, mpConfig.accessToken, mpConfig.posExternalId, mpConfig.terminalId, baseCurrency, notify, tr]
  );

  useEffect(() => {
    if (!repair || !mpOrder || mpOrder.status !== 'pending' || !mpConfig.accessToken.trim()) {
      return;
    }
    let cancelled = false;
    const token = mpConfig.accessToken.trim();
    const orderSnapshot = mpOrder;

    const poll = async () => {
      const res = await checkMercadoPagoOrderStatus({
        accessToken: token,
        orderId: orderSnapshot.orderId,
        apiFamily: orderSnapshot.apiFamily,
        externalReference: orderSnapshot.externalReference,
      });
      if (cancelled) return;

      if (res.ok && res.isPaid) {
        await commitApprovedMpPayment(orderSnapshot, false);
        return;
      }

      if (orderSnapshot.companionPointOrderId) {
        const ptRes = await checkMercadoPagoOrderStatus({
          accessToken: token,
          orderId: orderSnapshot.companionPointOrderId,
          apiFamily: orderSnapshot.companionPointApiFamily || 'orders_v1',
          externalReference: orderSnapshot.companionPointExternalReference,
        });
        if (cancelled) return;
        if (ptRes.ok && ptRes.isPaid) {
          await commitApprovedMpPayment(orderSnapshot, true);
          return;
        }
      }

      if (!res.ok) return;
      if (res.isCanceled) {
        setMpOrder((prev) =>
          prev && prev.orderId === orderSnapshot.orderId
            ? {
                ...prev,
                status: 'canceled',
                statusText: tr(
                  'La orden fue cancelada o venció.',
                  'Order was canceled or expired.',
                  'O pedido foi cancelado ou expirou.'
                ),
              }
            : prev
        );
      } else if (res.isFailed) {
        if (repair.ownerId) {
          recordPaymentAttempt({
            id: orderSnapshot.orderId,
            ownerId: repair.ownerId,
            source: 'reparacion',
            method: orderSnapshot.mode === 'point' ? 'tarjeta' : 'transferencia',
            mpChannel: orderSnapshot.mode === 'point' ? 'mp_point' : 'mp_qr',
            amount: orderSnapshot.amount,
            totalAmount: Number(repair.price || orderSnapshot.amount),
            clientName: repair.clientName || 'Cliente',
            title: `${repair.code} · ${repair.brand} ${repair.model}`,
            subtitle: 'Intento fallido o rechazado en Mercado Pago',
            mpOrderId: orderSnapshot.orderId,
            mpCompanionOrderId: orderSnapshot.companionPointOrderId,
            mpExternalReference: orderSnapshot.externalReference,
            mpApiFamily: orderSnapshot.apiFamily,
            attemptStatus: 'failed_attempt',
            rawError: 'El pago fue rechazado o falló en Mercado Pago.',
          });
        }
        setMpOrder((prev) =>
          prev && prev.orderId === orderSnapshot.orderId
            ? {
                ...prev,
                status: 'failed',
                statusText: tr(
                  'El pago fue rechazado o falló en Mercado Pago.',
                  'Payment was declined or failed on Mercado Pago.',
                  'O pagamento foi recusado ou falhou no Mercado Pago.'
                ),
              }
            : prev
        );
      }
    };

    const timer = window.setInterval(() => {
      void poll();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [repair, mpOrder, mpConfig.accessToken, commitApprovedMpPayment, tr]);

  if (!repair) return null;

  const statusMeta = getStatusMeta(repair.status);
  const pendingBalance = currentPendingBalance;
  const paymentInfo = parsePaymentInfo(repair);
  const savedCurrency = paymentInfo.currency;
  const savedRate =
    (savedCurrency
      ? getCurrencyRateFromBase(savedCurrency, baseCurrency, secondaryCurrencies)
      : null) ?? paymentInfo.rate;
  const hasForeignDisplay = Boolean(
    savedCurrency &&
      savedCurrency !== baseCurrency &&
      savedRate &&
      Number.isFinite(savedRate) &&
      savedRate > 0 &&
      savedRate !== 1
  );

  const editRate =
    getCurrencyRateFromBase(editCurrency, baseCurrency, secondaryCurrencies) ??
    (paymentInfo.currency === editCurrency && paymentInfo.rate ? paymentInfo.rate : 1);
  const isEditSecondary = editCurrency !== baseCurrency && editRate !== 1;
  const editCurrencySymbol = getCurrencyOption(editCurrency).symbol;
  const editSelectableCurrencies: CurrencyCode[] = Array.from(
    new Set([
      baseCurrency,
      ...secondaryCurrencies.map((c) => c.code),
      ...(paymentInfo.currency ? [paymentInfo.currency] : []),
    ])
  );

  const partialSelectableCurrencies = editSelectableCurrencies;
  const partialRate =
    getCurrencyRateFromBase(partialCurrency, baseCurrency, secondaryCurrencies) ??
    (paymentInfo.currency === partialCurrency && paymentInfo.rate ? paymentInfo.rate : 1);
  const isPartialSecondary = partialCurrency !== baseCurrency && partialRate !== 1;
  const partialInputNum = parseSafePositiveNumber(partialAmount, 0);
  const partialBaseEquivalent = isPartialSecondary
    ? Math.round(convertToBaseCurrency(partialInputNum, partialRate) * 100) / 100
    : partialInputNum;

  const detailWork = parseWorkDetailAndMedia(repair.workDetail);
  const detailMeta = parseRepairPublicMeta(repair.workDetail);
  const warrantyInfo = computeWarrantyInfo(repair);
  const paymentLedger = parseRepairPaymentLedger(repair.checkoutState);
  const initialPartIds = repair.partIds || [];
  const initialPartNames = repair.partNames || [];
  const spareParts = products.filter((p) => p.category === 'Repuesto');
  const missingAssignedParts = initialPartIds
    .map((id, idx) => ({
      id,
      name: initialPartNames[idx] || 'Repuesto asignado',
    }))
    .filter((item) => !spareParts.some((p) => p.id === item.id));
  const partSearchTerm = partSearch.trim().toLowerCase();
  const filteredSpareParts = partSearchTerm
    ? spareParts.filter(
        (p) =>
          p.name.toLowerCase().includes(partSearchTerm) ||
          (p.sku || '').toLowerCase().includes(partSearchTerm) ||
          (p.brand || '').toLowerCase().includes(partSearchTerm)
      )
    : spareParts;
  const addedPartIds = selectedPartIds.filter((id) => !initialPartIds.includes(id));
  const removedPartIds = initialPartIds.filter((id) => !selectedPartIds.includes(id));
  const selectedOutOfStockParts = spareParts.filter(
    (p) =>
      selectedPartIds.includes(p.id) &&
      Boolean(p.trackStock) &&
      Number(p.stock || 0) <= 0
  );

  const canAssignTechnician =
    (workshopMeta.techniciansEnabled && workshopMeta.technicians.length > 0) ||
    Boolean(paymentInfo.technician) ||
    Boolean(technician);
  const technicianOptions = Array.from(
    new Set([
      ...(workshopMeta.technicians || []),
      ...(paymentInfo.technician ? [paymentInfo.technician] : []),
      ...(technician ? [technician] : []),
    ])
  );

  const toggleEditPart = (part: ProductRecord) => {
    const isCurrentlySelected = selectedPartIds.includes(part.id);
    if (!isCurrentlySelected && selectedPartIds.length >= 30) {
      notify('Podés asignar hasta 30 repuestos por orden.', 'error');
      return;
    }
    setSelectedPartIds((prev) =>
      isCurrentlySelected ? prev.filter((idVal) => idVal !== part.id) : [...prev, part.id]
    );
    const basePartPrice = Math.max(0, Number(part.price || 0));
    if (syncPartPrice && basePartPrice > 0) {
      const partDeltaDisplay = isEditSecondary
        ? Math.round(convertFromBaseCurrency(basePartPrice, editRate) * 100) / 100
        : basePartPrice;
      setPrice((prev) => {
        const curr = parseSafePositiveNumber(prev, 0);
        const next = isCurrentlySelected
          ? Math.max(0, curr - partDeltaDisplay)
          : curr + partDeltaDisplay;
        return String(Math.round(next * 100) / 100);
      });
    }
  };

  const toggleMissingPart = (partId: string) => {
    setSelectedPartIds((prev) =>
      prev.includes(partId) ? prev.filter((idVal) => idVal !== partId) : [...prev, partId]
    );
  };

  const editBudgetNum = parseSafePositiveNumber(price, 0);
  const editDepositNum = parseSafePositiveNumber(deposit, 0);
  const editPendingBalance = Math.max(0, Math.round((editBudgetNum - editDepositNum) * 100) / 100);
  const editBaseBudgetPreview = isEditSecondary
    ? Math.round(convertToBaseCurrency(editBudgetNum, editRate) * 100) / 100
    : editBudgetNum;
  const editBaseDepositPreview = isEditSecondary
    ? Math.round(convertToBaseCurrency(editDepositNum, editRate) * 100) / 100
    : editDepositNum;

  const handleEditCurrencyChange = (nextRaw: string) => {
    const nextCode = sanitizeCurrencyCode(nextRaw);
    if (nextCode === editCurrency) return;
    const nextRate =
      getCurrencyRateFromBase(nextCode, baseCurrency, secondaryCurrencies) ??
      (paymentInfo.currency === nextCode && paymentInfo.rate ? paymentInfo.rate : 1);
    const convertAmount = (valStr: string) => {
      const n = parseSafePositiveNumber(valStr, 0);
      if (n <= 0) return valStr;
      if (
        getCurrencyRateFromBase(editCurrency, baseCurrency, secondaryCurrencies) &&
        getCurrencyRateFromBase(nextCode, baseCurrency, secondaryCurrencies)
      ) {
        return String(
          Math.round(
            convertBetweenCurrencies(n, editCurrency, nextCode, baseCurrency, secondaryCurrencies) *
              100
          ) / 100
        );
      }
      const inBase = editCurrency === baseCurrency ? n : convertToBaseCurrency(n, editRate);
      const inNext = nextCode === baseCurrency ? inBase : convertFromBaseCurrency(inBase, nextRate);
      return String(Math.round(inNext * 100) / 100);
    };
    if (price.trim()) setPrice(convertAmount(price));
    if (deposit.trim()) setDeposit(convertAmount(deposit));
    setEditCurrency(nextCode);
  };

  const trackingUrl = buildTrackingUrl(
    repair.trackingCode,
    profile?.trackingBaseUrl,
    baseCurrency
  );

  const cleanPhoneForWa = (repair.clientPhone || '').replace(/[^\d]/g, '');
  const resolvedWaTemplateId =
    waTemplate === 'auto' ? resolveDefaultTemplateForStatus(repair.status) : waTemplate;
  const whatsappText = buildRepairWhatsAppMessage({
    templateId: waTemplate,
    repair,
    profile: profile || null,
    trackingUrl,
  });
  const whatsappHref = cleanPhoneForWa
    ? `https://wa.me/${cleanPhoneForWa}?text=${encodeURIComponent(whatsappText)}`
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
    const cleanEmail = sanitizeEmail(clientEmail, 200);
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      notify('El correo electrónico del cliente no es válido.', 'error');
      return;
    }
    setSaving(true);
    try {
      const budgetInput = parseSafePositiveNumber(price, 0);
      const advanceInput = parseSafePositiveNumber(deposit, 0);
      const budget = isEditSecondary
        ? Math.round(convertToBaseCurrency(budgetInput, editRate) * 100) / 100
        : budgetInput;
      const advance = isEditSecondary
        ? Math.round(convertToBaseCurrency(advanceInput, editRate) * 100) / 100
        : advanceInput;
      const safeProgress = Math.min(100, Math.max(0, Math.round(Number(progress) || 0)));
      const basePaymentStatus: 'pendiente' | 'parcial' | 'pagado' =
        budget === 0
          ? 'pendiente'
          : advance >= budget
            ? 'pagado'
            : advance > 0
              ? 'parcial'
              : 'pendiente';
      const paymentStatus = serializeRepairPaymentStatus({
        base: basePaymentStatus,
        method: basePaymentStatus === 'pagado' ? paymentInfo.method || 'efectivo' : null,
        currency: isEditSecondary ? editCurrency : undefined,
        rate: isEditSecondary ? editRate : undefined,
        technician: technician || undefined,
      });
      const cleanName = sanitizePlainLine(clientName || repair.clientName, 160) || repair.clientName;
      const cleanPhone = sanitizePhone(clientPhone, 60);
      const cleanDni = sanitizeDni(clientDni, 40);
      const cleanAddress = sanitizePlainLine(clientAddress, 240);
      const nowIso = new Date().toISOString();
      const workDetailWithMeta = mergeWorkDetailPublicMeta(repair.workDetail, (prev) => {
        let nextMeta: RepairPublicMeta = {
          ...prev,
          warrantyDays:
            warrantyDays > 0 ? Math.min(3650, Math.round(warrantyDays)) : undefined,
        };
        if (status !== repair.status) {
          nextMeta = appendTimelineEntry(nextMeta, status, undefined, nowIso);
        }
        if (status === 'entregado' && !nextMeta.deliveredAt) {
          nextMeta = { ...nextMeta, deliveredAt: nowIso };
        }
        return nextMeta;
      });
      const combinedWorkDetail = serializeWorkDetailAndMedia(
        workDetail,
        mediaItems,
        workDetailWithMeta
      );

      const nextPartIds = selectedPartIds.slice(0, 30);
      const nextPartNames = nextPartIds
        .map((id) => {
          const found = products.find((p) => p.id === id);
          if (found) return found.name;
          const origIdx = initialPartIds.indexOf(id);
          return (origIdx >= 0 && initialPartNames[origIdx]) || 'Repuesto';
        })
        .slice(0, 30);

      for (const addedId of addedPartIds) {
        const part = products.find((p) => p.id === addedId);
        if (part && part.trackStock && Number(part.stock || 0) > 0) {
          await updateRow('products', part.id, {
            stock: Math.max(0, Number(part.stock || 0) - 1),
          });
        }
      }

      for (const removedId of removedPartIds) {
        const part = products.find((p) => p.id === removedId);
        if (part && part.trackStock) {
          await updateRow('products', part.id, {
            stock: Number(part.stock || 0) + 1,
          });
        }
      }

      const prevDeposit = Math.max(0, Number(repair.deposit || 0));
      let nextCheckoutState = serializeCheckoutAndSignature(
        checkoutState,
        parseCheckoutAndSignature(repair.checkoutState).signatureDataUrl,
        repair.checkoutState
      );
      if (Math.abs(advance - prevDeposit) > 0.01) {
        const existingLedger = parseRepairPaymentLedger(nextCheckoutState);
        const fallbackMethod: PaymentMethod = paymentInfo.method || 'efectivo';
        if (advance <= 0.001) {
          nextCheckoutState = mergeCheckoutPaymentLedger(nextCheckoutState, []);
        } else if (advance > prevDeposit + 0.01) {
          const deltaAmt = Math.round((advance - prevDeposit) * 100) / 100;
          nextCheckoutState = mergeCheckoutPaymentLedger(nextCheckoutState, [
            ...existingLedger,
            {
              id: createRepairMetaId('pay'),
              amount: deltaAmt,
              method: fallbackMethod,
              date: nowIso,
              note: prevDeposit > 0 ? 'Ajuste de seña / pago' : 'Seña registrada en edición',
            },
          ]);
        } else {
          const trimmed: typeof existingLedger = [];
          let remaining = Math.round(advance * 100) / 100;
          for (const entry of existingLedger) {
            if (remaining <= 0.001) break;
            const take = Math.min(remaining, Math.max(0, Number(entry.amount || 0)));
            if (take > 0.001) {
              trimmed.push({ ...entry, amount: Math.round(take * 100) / 100 });
              remaining = Math.round((remaining - take) * 100) / 100;
            }
          }
          nextCheckoutState = mergeCheckoutPaymentLedger(
            nextCheckoutState,
            trimmed.length > 0
              ? trimmed
              : [
                  {
                    id: createRepairMetaId('pay'),
                    amount: Math.round(advance * 100) / 100,
                    method: fallbackMethod,
                    date: nowIso,
                    note: 'Ajuste de seña / pago',
                  },
                ]
          );
        }
      }

      await updateRow(
        'repairs',
        repair.id,
        stripUndefined({
          status,
          progress: safeProgress,
          notes: sanitizeText(notes, 2000),
          clientName: cleanName,
          clientPhone: cleanPhone,
          clientDni: cleanDni,
          clientEmail: cleanEmail,
          clientAddress: cleanAddress,
          price: budget,
          deposit: advance,
          paidAmount: advance,
          paymentStatus,
          partIds: nextPartIds,
          partNames: nextPartNames,
          workDetail: combinedWorkDetail,
          checkoutState: nextCheckoutState,
          physicalCheck,
          functionalCheck,
          updatedAt: nowIso,
        })
      );

      if (repair.trackingCode) {
        const ticket = await fetchSingleById<{ id: string }>('public_tickets', repair.trackingCode);
        if (ticket) {
          await updateRow(
            'public_tickets',
            repair.trackingCode,
            stripUndefined({
              status,
              progress: safeProgress,
              workDetail: combinedWorkDetail,
              price: budget,
              deposit: advance,
              updatedAt: nowIso,
            })
          );
        } else {
          await upsertRow(
            'public_tickets',
            stripUndefined({
              id: repair.trackingCode,
              ownerId: repair.ownerId,
              repairId: repair.id,
              trackingCode: repair.trackingCode,
              repairCode: repair.code,
              businessName: profile?.brandName || 'TH3 BNB Servicio Técnico',
              businessPhone: profile?.businessPhone || '',
              deviceType: repair.deviceType,
              brand: repair.brand,
              model: repair.model,
              status,
              progress: safeProgress,
              dateIn: repair.dateIn,
              dateEst: repair.dateEst || '',
              problemSummary: clampStr(repair.problem, 200),
              workDetail: combinedWorkDetail,
              price: budget,
              deposit: advance,
              updatedAt: nowIso,
            })
          );
        }
      }

      if (repair.clientId && clients.some((c) => c.id === repair.clientId)) {
        await updateRow(
          'clients',
          repair.clientId,
          stripUndefined({
            name: cleanName,
            phone: cleanPhone,
            dni: cleanDni,
            email: cleanEmail,
            address: cleanAddress,
          })
        );
      }

      notify('Reparación actualizada.');
      setTab('detail');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudieron guardar los cambios.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const syncMediaToTracking = async (nextMedia: TechMediaItem[], successMessage: string) => {
    setSendingMedia(true);
    try {
      const combinedWorkDetail = serializeWorkDetailAndMedia(
        workDetail,
        nextMedia,
        repair.workDetail
      );
      const nowIso = new Date().toISOString();
      await updateRow('repairs', repair.id, {
        workDetail: combinedWorkDetail,
        updatedAt: nowIso,
      });
      if (repair.trackingCode) {
        const ticket = await fetchSingleById<{ id: string }>('public_tickets', repair.trackingCode);
        if (ticket) {
          await updateRow('public_tickets', repair.trackingCode, {
            workDetail: combinedWorkDetail,
            updatedAt: nowIso,
          });
        } else {
          await upsertRow(
            'public_tickets',
            stripUndefined({
              id: repair.trackingCode,
              ownerId: repair.ownerId,
              repairId: repair.id,
              trackingCode: repair.trackingCode,
              repairCode: repair.code,
              businessName: profile?.brandName || 'TH3 BNB Servicio Técnico',
              businessPhone: profile?.businessPhone || '',
              deviceType: repair.deviceType,
              brand: repair.brand,
              model: repair.model,
              status: repair.status,
              progress: repair.progress,
              dateIn: repair.dateIn,
              dateEst: repair.dateEst || '',
              problemSummary: clampStr(repair.problem, 200),
              workDetail: combinedWorkDetail,
              price: Number(repair.price || 0),
              deposit: Number(repair.deposit || 0),
              updatedAt: nowIso,
            })
          );
        }
      }
      notify(successMessage);
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo actualizar el seguimiento en línea.'), 'error');
    } finally {
      setSendingMedia(false);
    }
  };

  const handleAddPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    if (mediaItems.length + files.length > 10) {
      notify('Podés adjuntar hasta 10 archivos por orden.', 'error');
      return;
    }
    setMediaBusy(true);
    try {
      const created: TechMediaItem[] = [];
      for (const file of files) {
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
          notify(`"${file.name}": formato no permitido (usá JPG, PNG o WebP).`, 'error');
          continue;
        }
        if (file.size > 12 * 1024 * 1024) {
          notify(`"${file.name}" supera 12 MB.`, 'error');
          continue;
        }
        const compressed = await compressPhotoForTracking(file);
        const safeUrl = sanitizeMediaUrl(compressed, 'image');
        if (!safeUrl) continue;
        created.push({
          id: createMediaId(),
          type: 'image',
          url: safeUrl,
          createdAt: Date.now(),
        });
      }
      if (created.length > 0) {
        setMediaItems((prev) => [...prev, ...created]);
        notify(
          `${created.length === 1 ? 'Foto agregada' : `${created.length} fotos agregadas`}. Tocá "Enviar al seguimiento" o "Guardar cambios".`
        );
      }
    } catch {
      notify('No se pudo procesar la imagen seleccionada.', 'error');
    } finally {
      setMediaBusy(false);
    }
  };

  const handleAddVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'].includes(file.type)) {
      notify('Formato de video no soportado. Usá MP4, WebM o MOV.', 'error');
      return;
    }
    if (mediaItems.length >= 10) {
      notify('Podés adjuntar hasta 10 archivos por orden.', 'error');
      return;
    }
    if (file.size > MAX_INLINE_VIDEO_BYTES) {
      notify(
        'El video supera 6 MB. Grabá un clip más corto o pegá el enlace de Google Drive / YouTube.',
        'error'
      );
      return;
    }
    setMediaBusy(true);
    try {
      const dataUrl = await readVideoAsDataUrl(file);
      const safeUrl = sanitizeMediaUrl(dataUrl, 'video');
      if (!safeUrl) {
        notify('El video seleccionado no es válido.', 'error');
        return;
      }
      setMediaItems((prev) => [
        ...prev,
        {
          id: createMediaId(),
          type: 'video',
          url: safeUrl,
          createdAt: Date.now(),
        },
      ]);
      notify('Video agregado. Tocá "Enviar al seguimiento" o "Guardar cambios".');
    } catch {
      notify('No se pudo cargar el video seleccionado.', 'error');
    } finally {
      setMediaBusy(false);
    }
  };

  const handleAddMediaLink = () => {
    const safeLink = sanitizeSafeUrl(mediaLinkUrl, 1000);
    if (!mediaLinkUrl.trim()) return;
    if (!safeLink) {
      notify('Ingresá una URL válida que empiece con https:// o http://', 'error');
      return;
    }
    if (mediaItems.length >= 10) {
      notify('Podés adjuntar hasta 10 archivos por orden.', 'error');
      return;
    }
    setMediaItems((prev) => [
      ...prev,
      {
        id: createMediaId(),
        type: mediaLinkType,
        url: safeLink,
        createdAt: Date.now(),
      },
    ]);
    setMediaLinkUrl('');
    setShowLinkInput(false);
    notify('Enlace agregado. Tocá "Enviar al seguimiento" o "Guardar cambios".');
  };

  const handleRegisterFullPayment = async () => {
    const budget = parseSafePositiveNumber(repair.price, 0);
    if (budget <= 0) {
      notify('Definí un presupuesto mayor a 0 en la pestaña Técnico antes de cobrar.', 'error');
      return;
    }
    setPaying(true);
    setDeposit(
      String(
        isEditSecondary
          ? Math.round(convertFromBaseCurrency(budget, editRate) * 100) / 100
          : budget
      )
    );
    const nowIso = new Date().toISOString();
    const prevDeposit = parseSafePositiveNumber(repair.deposit, 0);
    const paidNow = Math.max(0, Math.round((budget - prevDeposit) * 100) / 100) || budget;
    const prevLedger = parseRepairPaymentLedger(repair.checkoutState);
    const nextCheckoutState = mergeCheckoutPaymentLedger(repair.checkoutState, [
      ...prevLedger,
      {
        id: createRepairMetaId('pay'),
        amount: paidNow,
        method: paymentMethod,
        date: nowIso,
        note: prevDeposit > 0 ? 'Cancelación de saldo' : 'Pago total',
      },
    ]);
    const nextPaymentStatus = serializeRepairPaymentStatus({
      base: 'pagado',
      method: paymentMethod,
      currency:
        paymentInfo.currency && paymentInfo.currency !== baseCurrency
          ? paymentInfo.currency
          : undefined,
      rate:
        paymentInfo.currency && paymentInfo.currency !== baseCurrency
          ? paymentInfo.rate
          : undefined,
      technician: paymentInfo.technician || undefined,
    });
    try {
      await updateRow('repairs', repair.id, {
        deposit: budget,
        paidAmount: budget,
        paymentStatus: nextPaymentStatus,
        checkoutState: nextCheckoutState,
        updatedAt: nowIso,
      });

      if (repair.trackingCode) {
        const ticket = await fetchSingleById<{ id: string }>('public_tickets', repair.trackingCode);
        if (ticket) {
          await updateRow('public_tickets', repair.trackingCode, {
            deposit: budget,
            updatedAt: nowIso,
          });
        }
      }

      notify(`Pago en ${PAYMENT_METHOD_LABELS[paymentMethod]} registrado.`);
      setJustPaid(true);
      setTab('receipt');
    } catch (err) {
      const msg = sanitizeDbErrorMessage(err, 'No se pudo registrar el pago.');
      if (paidNow > 0 && repair.ownerId) {
        recordRecoveredPayment({
          id: `rec-rep-${repair.id}-${Date.now()}`,
          ownerId: repair.ownerId,
          source: 'reparacion',
          method: paymentMethod,
          amount: paidNow,
          totalAmount: budget,
          clientName: repair.clientName || 'Cliente',
          title: `${repair.code} · ${repair.brand} ${repair.model}`,
          subtitle: prevDeposit > 0 ? 'Cancelación de saldo (error al guardar en nube)' : 'Pago total (error al guardar en nube)',
          saveFailed: true,
          saveError: msg,
        });
        notify(`${msg} El cobro quedó resguardado en Caja diaria.`, 'error');
      } else {
        notify(msg, 'error');
      }
    } finally {
      setPaying(false);
    }
  };

  const handleRegisterPartialPayment = async () => {
    const inputAmt = parseSafePositiveNumber(partialAmount, 0);
    if (inputAmt <= 0 || partialBaseEquivalent <= 0) {
      notify('Ingresá un monto de seña o abono mayor a 0.', 'error');
      return;
    }
    const amt = partialBaseEquivalent;
    setSavingPartial(true);
    try {
      const nowIso = new Date().toISOString();
      const prevDeposit = Math.max(0, Number(repair.deposit || 0));
      const budget = Math.max(0, Number(repair.price || 0));
      const nextDeposit = Math.round((prevDeposit + amt) * 100) / 100;
      const nextBaseStatus: 'pendiente' | 'parcial' | 'pagado' =
        budget > 0 && nextDeposit >= budget ? 'pagado' : 'parcial';

      const cleanNoteInput = sanitizePlainLine(partialNote, 90);
      const ledgerNote = isPartialSecondary
        ? cleanNoteInput
          ? `${cleanNoteInput} (${formatCurrency(inputAmt, partialCurrency)})`
          : `Seña / Abono (${formatCurrency(inputAmt, partialCurrency)})`
        : cleanNoteInput || 'Seña / Abono parcial';

      const prevLedger = parseRepairPaymentLedger(repair.checkoutState);
      const nextCheckoutState = mergeCheckoutPaymentLedger(repair.checkoutState, [
        ...prevLedger,
        {
          id: createRepairMetaId('pay'),
          amount: amt,
          method: partialMethod,
          date: nowIso,
          note: ledgerNote,
        },
      ]);

      const nextPaymentStatus = serializeRepairPaymentStatus({
        base: nextBaseStatus,
        method: nextBaseStatus === 'pagado' ? partialMethod : null,
        currency:
          paymentInfo.currency && paymentInfo.currency !== baseCurrency
            ? paymentInfo.currency
            : undefined,
        rate:
          paymentInfo.currency && paymentInfo.currency !== baseCurrency
            ? paymentInfo.rate
            : undefined,
        technician: paymentInfo.technician || undefined,
      });

      await updateRow('repairs', repair.id, {
        deposit: nextDeposit,
        paidAmount: nextDeposit,
        paymentStatus: nextPaymentStatus,
        checkoutState: nextCheckoutState,
        updatedAt: nowIso,
      });

      if (repair.trackingCode) {
        const ticket = await fetchSingleById<{ id: string }>('public_tickets', repair.trackingCode);
        if (ticket) {
          await updateRow('public_tickets', repair.trackingCode, {
            deposit: nextDeposit,
            updatedAt: nowIso,
          });
        }
      }

      setDeposit(
        String(
          isEditSecondary
            ? Math.round(convertFromBaseCurrency(nextDeposit, editRate) * 100) / 100
            : nextDeposit
        )
      );
      setPartialAmount('');
      setPartialNote('');
      notify(
        isPartialSecondary
          ? `Abono de ${formatCurrency(inputAmt, partialCurrency)} (${formatCurrency(amt, baseCurrency)}) · ${PAYMENT_METHOD_LABELS[partialMethod]} registrado.`
          : `Abono de ${formatCurrency(amt, baseCurrency)} (${PAYMENT_METHOD_LABELS[partialMethod]}) registrado.`
      );
      if (nextBaseStatus === 'pagado') {
        setJustPaid(true);
      }
    } catch (err) {
      const msg = sanitizeDbErrorMessage(err, 'No se pudo registrar el abono.');
      if (amt > 0 && repair.ownerId) {
        recordRecoveredPayment({
          id: `rec-rep-part-${repair.id}-${Date.now()}`,
          ownerId: repair.ownerId,
          source: 'reparacion',
          method: partialMethod,
          amount: amt,
          totalAmount: Number(repair.price || amt),
          clientName: repair.clientName || 'Cliente',
          title: `${repair.code} · ${repair.brand} ${repair.model}`,
          subtitle: 'Seña / abono parcial (error al guardar en nube)',
          saveFailed: true,
          saveError: msg,
        });
        notify(`${msg} El abono quedó resguardado en Caja diaria.`, 'error');
      } else {
        notify(msg, 'error');
      }
    } finally {
      setSavingPartial(false);
    }
  };

  const hasValidPartialForMp =
    partialBaseEquivalent > 0 && partialBaseEquivalent < pendingBalance;
  const effectiveMpTarget = hasValidPartialForMp ? mpChargeTarget : 'full';
  const mpChargeAmount = Math.max(
    0,
    Math.round(
      (effectiveMpTarget === 'partial' ? partialBaseEquivalent : pendingBalance) * 100
    ) / 100
  );

  const handleCreateMercadoPagoOrder = async (mode: 'qr' | 'point') => {
    if (!mpConfig.accessToken.trim()) {
      notify('Configurá tu Access Token de Mercado Pago primero.', 'error');
      setShowMpSettings(true);
      return;
    }
    if (mode === 'point' && !mpConfig.terminalId.trim()) {
      notify('Ingresá el ID del dispositivo Point para cobrar con tarjeta.', 'error');
      setShowMpSettings(true);
      return;
    }
    if (mpChargeAmount <= 0) {
      notify('El monto a cobrar debe ser mayor a 0.', 'error');
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

    setMpBusy(true);
    const extRef = `REP-${(repair.code || repair.id.slice(0, 6)).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20)}-${Date.now().toString(36).toUpperCase()}`;
    try {
      const res = await createMercadoPagoOrder({
        mode,
        accessToken: token,
        amount: mpChargeAmount,
        description: `${repair.code} · ${repair.brand} ${repair.model}`,
        externalReference: extRef,
        terminalId: mpConfig.terminalId.trim(),
        posExternalId: mpConfig.posExternalId.trim() || 'CAJA01',
        printOnTerminal: Boolean(mpConfig.printOnTerminal),
        alsoShowOnPoint:
          mode === 'qr' && showQrOnPointSmart && Boolean(mpConfig.terminalId.trim()),
      });

      if (!res.ok || !res.orderId) {
        if (repair.ownerId) {
          recordPaymentAttempt({
            id: `fail-rep-${extRef}`,
            ownerId: repair.ownerId,
            source: 'reparacion',
            method: mode === 'point' ? 'tarjeta' : 'transferencia',
            mpChannel: mode === 'point' ? 'mp_point' : 'mp_qr',
            amount: mpChargeAmount,
            totalAmount: Number(repair.price || mpChargeAmount),
            clientName: repair.clientName || 'Cliente',
            title: `${repair.code} · ${repair.brand} ${repair.model}`,
            subtitle: 'Error al iniciar cobro en Mercado Pago',
            mpExternalReference: extRef,
            attemptStatus: 'failed_attempt',
            rawError: res.error || 'No se pudo generar el cobro en Mercado Pago.',
          });
        }
        notify(res.error || 'No se pudo generar el cobro en Mercado Pago.', 'error');
        return;
      }

      if (mode === 'qr' && res.posExternalId && res.posExternalId !== mpConfig.posExternalId.trim()) {
        const nextCfg = saveMercadoPagoConfig(repair.ownerId, {
          ...mpConfig,
          posExternalId: res.posExternalId,
        });
        setMpConfig(nextCfg);
        if (profile) {
          void saveMercadoPagoConfigToProfile(profile, nextCfg).catch(() => {});
        }
      }

      let qrImageDataUrl: string | undefined;
      if (mode === 'qr' && res.qrData) {
        try {
          qrImageDataUrl = await QRCode.toDataURL(res.qrData, {
            width: 260,
            margin: 1,
            color: { dark: '#0f172a', light: '#ffffff' },
          });
        } catch {
          qrImageDataUrl = undefined;
        }
      }

      const shownOnPoint = Boolean(res.companionPointOrderId);
      if (!res.isPaid && repair.ownerId) {
        recordPaymentAttempt({
          id: res.orderId,
          ownerId: repair.ownerId,
          source: 'reparacion',
          method: mode === 'point' ? 'tarjeta' : 'transferencia',
          mpChannel: mode === 'point' ? 'mp_point' : 'mp_qr',
          amount: mpChargeAmount,
          totalAmount: Number(repair.price || mpChargeAmount),
          clientName: repair.clientName || 'Cliente',
          title: `${repair.code} · ${repair.brand} ${repair.model}`,
          subtitle: shownOnPoint
            ? 'QR enviado a pantalla y Point Smart (pendiente de confirmar)'
            : mode === 'point'
              ? 'Orden enviada al Point Smart (pendiente de confirmar)'
              : 'QR MP generado (pendiente de confirmar)',
          mpOrderId: res.orderId,
          mpCompanionOrderId: res.companionPointOrderId,
          mpExternalReference: res.externalReference || extRef,
          mpApiFamily: res.apiFamily || 'orders_v1',
          attemptStatus: 'pending_verification',
        });
      }

      const nextOrder: ActiveRepairMpOrder = {
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
      };

      setMpOrder(nextOrder);
      if (res.isPaid) {
        await commitApprovedMpPayment(nextOrder, false);
      } else {
        notify(
          mode === 'qr'
            ? shownOnPoint
              ? 'QR dinámico generado en pantalla y enviado al Point Smart.'
              : 'QR dinámico de Mercado Pago generado.'
            : 'Orden enviada al dispositivo Point.'
        );
      }
    } catch {
      if (repair.ownerId) {
        recordPaymentAttempt({
          id: `err-rep-${extRef}`,
          ownerId: repair.ownerId,
          source: 'reparacion',
          method: mode === 'point' ? 'tarjeta' : 'transferencia',
          mpChannel: mode === 'point' ? 'mp_point' : 'mp_qr',
          amount: mpChargeAmount,
          totalAmount: Number(repair.price || mpChargeAmount),
          clientName: repair.clientName || 'Cliente',
          title: `${repair.code} · ${repair.brand} ${repair.model}`,
          subtitle: 'Error de red al conectar con Mercado Pago',
          mpExternalReference: extRef,
          attemptStatus: 'failed_attempt',
          rawError: 'Error de conexión con el servidor de Mercado Pago.',
        });
      }
      notify('Error de conexión con el servidor de Mercado Pago.', 'error');
    } finally {
      setMpBusy(false);
    }
  };

  const handleCheckMpStatusOnce = async () => {
    if (!mpOrder || !mpConfig.accessToken.trim()) return;
    const token = mpConfig.accessToken.trim();
    const orderSnapshot = mpOrder;
    setMpBusy(true);
    try {
      const res = await checkMercadoPagoOrderStatus({
        accessToken: token,
        orderId: orderSnapshot.orderId,
        apiFamily: orderSnapshot.apiFamily,
        externalReference: orderSnapshot.externalReference,
      });

      let companionPaid = false;
      if ((!res.ok || !res.isPaid) && orderSnapshot.companionPointOrderId) {
        const ptRes = await checkMercadoPagoOrderStatus({
          accessToken: token,
          orderId: orderSnapshot.companionPointOrderId,
          apiFamily: orderSnapshot.companionPointApiFamily || 'orders_v1',
          externalReference: orderSnapshot.companionPointExternalReference,
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
        await commitApprovedMpPayment(orderSnapshot, companionPaid);
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
        notify(res.error || 'No se pudo cancelar en Mercado Pago.', 'error');
        return;
      }
      if (repair.ownerId) {
        dismissRecoveredPayment(repair.ownerId, mpOrder.orderId);
      }
      setMpOrder(null);
      notify('Orden de Mercado Pago cancelada.');
    } finally {
      setMpBusy(false);
    }
  };

  const handleSendOnlineQuote = async () => {
    const budget = parseSafePositiveNumber(repair.price, 0);
    if (budget <= 0) {
      notify('Definí un presupuesto mayor a 0 en la pestaña Técnico antes de enviarlo.', 'error');
      return;
    }
    setSendingQuote(true);
    try {
      const nowIso = new Date().toISOString();
      const nextWorkDetail = mergeWorkDetailPublicMeta(repair.workDetail, (prev) =>
        appendTimelineEntry(
          {
            ...prev,
            quote: {
              status: 'pending',
              amount: budget,
              requestedAt: nowIso,
            },
          },
          repair.status,
          `Presupuesto (${formatCurrency(budget, baseCurrency)}) enviado para aprobación online`,
          nowIso
        )
      );

      await updateRow('repairs', repair.id, {
        workDetail: nextWorkDetail,
        updatedAt: nowIso,
      });

      if (repair.trackingCode) {
        const ticket = await fetchSingleById<{ id: string }>('public_tickets', repair.trackingCode);
        if (ticket) {
          await updateRow('public_tickets', repair.trackingCode, {
            workDetail: nextWorkDetail,
            price: budget,
            updatedAt: nowIso,
          });
        } else {
          await upsertRow(
            'public_tickets',
            stripUndefined({
              id: repair.trackingCode,
              ownerId: repair.ownerId,
              repairId: repair.id,
              trackingCode: repair.trackingCode,
              repairCode: repair.code,
              businessName: profile?.brandName || 'TH3 BNB Servicio Técnico',
              businessPhone: profile?.businessPhone || '',
              deviceType: repair.deviceType,
              brand: repair.brand,
              model: repair.model,
              status: repair.status,
              progress: repair.progress,
              dateIn: repair.dateIn,
              dateEst: repair.dateEst || '',
              problemSummary: clampStr(repair.problem, 200),
              workDetail: nextWorkDetail,
              price: budget,
              deposit: Number(repair.deposit || 0),
              updatedAt: nowIso,
            })
          );
        }
      }

      setWaTemplate('quote_pending');
      notify('Presupuesto habilitado para aprobación en el seguimiento online.');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo habilitar el presupuesto online.'), 'error');
    } finally {
      setSendingQuote(false);
    }
  };

  const handleUploadTransferQr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Usá una imagen PNG, JPG o WebP.', 'error');
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      notify('La imagen del QR no puede superar 1,5 MB.', 'error');
      return;
    }
    try {
      const compressed = await compressImageToDataUrl(file, 420, 0.9);
      const safeQr = sanitizeImageDataUrl(compressed, 1_200_000);
      if (!safeQr) {
        notify('La imagen procesada supera el límite permitido.', 'error');
        return;
      }
      const nextCfg = { ...transferConfig, qrImageDataUrl: safeQr };
      setTransferConfig(nextCfg);
      saveTransferConfig(repair.ownerId, nextCfg);
      notify('Imagen QR guardada (cifrada).');
    } catch {
      notify('No se pudo cargar la imagen del QR.', 'error');
    }
  };

  const handleSaveTransferConfig = () => {
    const rawLink = transferConfig.paymentLink.trim();
    const safeLink = sanitizeSafeUrl(rawLink, 400);
    if (rawLink && !safeLink) {
      notify('El link de pago debe empezar con https:// o http://', 'error');
      return;
    }
    const cleaned: TransferConfig = {
      alias: sanitizeAlias(transferConfig.alias),
      cbu: sanitizeCbu(transferConfig.cbu),
      holder: sanitizePlainLine(transferConfig.holder, 120),
      paymentLink: safeLink,
      qrImageDataUrl: sanitizeImageDataUrl(transferConfig.qrImageDataUrl, 1_200_000),
    };
    setTransferConfig(cleaned);
    saveTransferConfig(repair.ownerId, cleaned);
    setEditingTransferConfig(false);
    notify('Datos de transferencia guardados (cifrados).');
  };

  const handleCopyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copiado.`);
    } catch {
      notify(`No se pudo copiar el ${label.toLowerCase()}.`, 'error');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteRow('repairs', repair.id);

      if (repair.trackingCode) {
        const ticket = await fetchSingleById<{ id: string }>('public_tickets', repair.trackingCode);
        if (ticket) {
          await deleteRow('public_tickets', repair.trackingCode);
        }
      }

      notify(`Orden ${repair.code} eliminada.`);
      onClose();
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo eliminar la reparación.'), 'error');
    }
  };

  return (
    <>
      <ModalShell
        open={Boolean(repair)}
        onClose={onClose}
        title={`${repair.deviceIcon || '📱'} ${repair.brand} ${repair.model}`}
        subtitle={tr(
          `Orden ${repair.code} · Cliente: ${repair.clientName}`,
          `Order ${repair.code} · Client: ${repair.clientName}`,
          `Ordem ${repair.code} · Cliente: ${repair.clientName}`
        )}
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
              {tr('Detalle', 'Details', 'Detalhes')}
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
              {tr('Técnico', 'Technician', 'Técnico')}
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
              {tr('Imprimir', 'Print', 'Imprimir')}
            </button>
          </div>
          {(() => {
            const batchRef = extractBatchRef(repair.notes);
            if (!batchRef || !onOpenBatch) return null;
            return (
              <button
                type="button"
                onClick={() => onOpenBatch(batchRef)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-[#0072BB] hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300"
              >
                {tr(`Boleta lote (${batchRef})`, `Batch receipt (${batchRef})`, `Comprovante lote (${batchRef})`)}
              </button>
            );
          })()}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyTrackingLink}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Copy className="h-3.5 w-3.5" />
              {tr('Copiar link', 'Copy link', 'Copiar link')}
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
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {tr('Estado actual · Prioridad', 'Current status · Priority', 'Status atual · Prioridade')}{' '}
                    {repair.priority === 'alta'
                      ? tr('alta', 'high', 'alta')
                      : repair.priority === 'baja'
                        ? tr('baja', 'low', 'baixa')
                        : tr('media', 'medium', 'média')}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold ${statusMeta.badgeClass}`}
                    >
                      {getTranslatedStatusLabel(repair.status) || statusMeta.label}
                    </span>
                    <span className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                      {repair.progress}%
                    </span>
                    {paymentInfo.technician && (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        <User className="h-3 w-3 text-[#0072BB] dark:text-sky-400" />
                        {paymentInfo.technician}
                      </span>
                    )}
                    {parseCheckoutAndSignature(repair.checkoutState).signatureDataUrl && (
                      <button
                        type="button"
                        onClick={() => setTab('receipt')}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        <PenTool className="h-3 w-3" />
                        {tr('Firmada por el cliente ✓', 'Signed by client ✓', 'Assinado pelo cliente ✓')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-right">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {tr('Presupuesto', 'Estimate', 'Orçamento')}
                    </div>
                    <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                      {formatCurrency(repair.price, baseCurrency)}
                    </div>
                    {hasForeignDisplay && savedCurrency && savedRate && (
                      <div className="font-mono-num text-[10px] font-semibold text-[#0072BB] dark:text-sky-300">
                        {formatCurrency(convertFromBaseCurrency(repair.price, savedRate), savedCurrency)}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {tr('Seña', 'Deposit', 'Sinal')}
                    </div>
                    <div className="font-mono-num text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(repair.deposit, baseCurrency)}
                    </div>
                    {hasForeignDisplay && savedCurrency && savedRate && (
                      <div className="font-mono-num text-[10px] font-semibold text-emerald-700/80 dark:text-emerald-300/80">
                        {formatCurrency(
                          convertFromBaseCurrency(repair.deposit, savedRate),
                          savedCurrency
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {tr('Pendiente', 'Balance due', 'Pendente')}
                    </div>
                    <div className="font-mono-num text-sm font-bold text-[#0072BB] dark:text-sky-400">
                      {formatCurrency(pendingBalance, baseCurrency)}
                    </div>
                    {hasForeignDisplay && savedCurrency && savedRate && (
                      <div className="font-mono-num text-[10px] font-semibold text-[#0072BB]/80 dark:text-sky-300/80">
                        {formatCurrency(
                          convertFromBaseCurrency(pendingBalance, savedRate),
                          savedCurrency
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {pendingBalance > 0 ? (
                <div className="space-y-3 border-t border-slate-200/80 pt-3 dark:border-slate-700/60">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      {tr('Registrar pago · Elegí el medio de pago', 'Record payment · Select payment method', 'Registrar pagamento · Escolha a forma')}
                    </span>
                    <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                      {(
                        [
                          { id: 'efectivo', label: tr('Efectivo', 'Cash', 'Dinheiro'), icon: Banknote },
                          { id: 'transferencia', label: tr('Transferencia', 'Transfer', 'Transferência'), icon: QrCode },
                          { id: 'tarjeta', label: tr('Tarjeta', 'Card', 'Cartão'), icon: CreditCard },
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
                            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition ${
                              active
                                ? 'bg-[#0072BB] text-white'
                                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            <span>{label}</span>
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

                      {hasValidPartialForMp && (
                        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-sky-200/80 bg-white/80 p-1.5 text-[11px] dark:border-sky-900/50 dark:bg-slate-900/70">
                          <span className="px-1.5 font-semibold text-slate-600 dark:text-slate-300">
                            {tr('Monto a enviar:', 'Amount to charge:', 'Valor a cobrar:')}
                          </span>
                          <button
                            type="button"
                            onClick={() => setMpChargeTarget('full')}
                            className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                              effectiveMpTarget === 'full'
                                ? 'bg-[#0072BB] text-white'
                                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                            }`}
                          >
                            {tr('Saldo', 'Balance', 'Saldo')} ({formatCurrency(pendingBalance, baseCurrency)})
                          </button>
                          <button
                            type="button"
                            onClick={() => setMpChargeTarget('partial')}
                            className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                              effectiveMpTarget === 'partial'
                                ? 'bg-[#0072BB] text-white'
                                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                            }`}
                          >
                            {tr('Seña / abono', 'Deposit', 'Sinal')} ({formatCurrency(partialBaseEquivalent, baseCurrency)})
                          </button>
                        </div>
                      )}

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

                  {paymentMethod === 'transferencia' && (() => {
                    const hasOfficialQr = Boolean(transferConfig.qrImageDataUrl);
                    const hasLinkQr = Boolean(!hasOfficialQr && transferConfig.paymentLink.trim() && qrDataUrl);
                    const hasAnyData = Boolean(
                      transferConfig.alias.trim() ||
                        transferConfig.cbu.trim() ||
                        transferConfig.paymentLink.trim() ||
                        hasOfficialQr
                    );
                    const transferWaText = buildTransferWhatsAppText(transferConfig, {
                      brandName: profile?.brandName || 'TH3 BNB Servicio Técnico',
                      code: repair.code,
                      clientName: repair.clientName,
                      amount: pendingBalance,
                      currencyCode: baseCurrency,
                    });
                    const transferWaHref = cleanPhoneForWa
                      ? `https://wa.me/${cleanPhoneForWa}?text=${encodeURIComponent(transferWaText)}`
                      : `https://wa.me/?text=${encodeURIComponent(transferWaText)}`;

                    return (
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

                        {hasValidPartialForMp && (
                          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-sky-200/80 bg-white/80 p-1.5 text-[11px] dark:border-sky-900/50 dark:bg-slate-900/70">
                            <span className="px-1.5 font-semibold text-slate-600 dark:text-slate-300">
                              {tr('Monto del QR:', 'QR amount:', 'Valor do QR:')}
                            </span>
                            <button
                              type="button"
                              onClick={() => setMpChargeTarget('full')}
                              className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                                effectiveMpTarget === 'full'
                                  ? 'bg-[#0072BB] text-white'
                                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                              }`}
                            >
                              {tr('Saldo', 'Balance', 'Saldo')} ({formatCurrency(pendingBalance, baseCurrency)})
                            </button>
                            <button
                              type="button"
                              onClick={() => setMpChargeTarget('partial')}
                              className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                                effectiveMpTarget === 'partial'
                                  ? 'bg-[#0072BB] text-white'
                                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                              }`}
                            >
                              {tr('Seña / abono', 'Deposit', 'Sinal')} ({formatCurrency(partialBaseEquivalent, baseCurrency)})
                            </button>
                          </div>
                        )}

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

                        <div className="rounded-xl border border-sky-200 bg-white p-3.5 dark:border-sky-900/60 dark:bg-slate-900">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          {(hasOfficialQr || hasLinkQr) && (
                            <div className="flex shrink-0 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-2">
                              <img
                                src={hasOfficialQr ? transferConfig.qrImageDataUrl : qrDataUrl}
                                alt={
                                  hasOfficialQr
                                    ? 'QR oficial de Mercado Pago / Banco'
                                    : 'QR de link de pago'
                                }
                                className="h-32 w-32 object-contain"
                              />
                              <span className="mt-1 text-center text-[10px] font-semibold text-slate-500">
                                {hasOfficialQr ? 'QR oficial MP / Banco' : 'QR Link de pago'}
                              </span>
                            </div>
                          )}

                          <div className="min-w-0 flex-1 space-y-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-900 dark:text-white">
                                {tr('Cobro por transferencia', 'Transfer payment', 'Pagamento por transferência')}
                              </span>
                              <span className="font-mono-num text-sm font-extrabold text-[#0072BB] dark:text-sky-400">
                                {formatCurrency(pendingBalance, baseCurrency)}
                                {hasForeignDisplay && savedCurrency && savedRate && (
                                  <span className="ml-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                    (
                                    {formatCurrency(
                                      convertFromBaseCurrency(pendingBalance, savedRate),
                                      savedCurrency
                                    )}
                                    )
                                  </span>
                                )}
                              </span>
                            </div>

                            {transferConfig.alias && (
                              <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800">
                                <span className="truncate text-slate-700 dark:text-slate-200">
                                  <strong>Alias:</strong> {transferConfig.alias}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleCopyText(transferConfig.alias, 'Alias')}
                                  className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                                >
                                  <Copy className="h-3 w-3" />
                                  {tr('Copiar', 'Copy', 'Copiar')}
                                </button>
                              </div>
                            )}

                            {transferConfig.cbu && (
                              <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800">
                                <span className="truncate font-mono-num text-slate-700 dark:text-slate-200">
                                  <strong>CBU/CVU:</strong> {transferConfig.cbu}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleCopyText(transferConfig.cbu, 'CBU/CVU')}
                                  className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                                >
                                  <Copy className="h-3 w-3" />
                                  {tr('Copiar', 'Copy', 'Copiar')}
                                </button>
                              </div>
                            )}

                            {transferConfig.paymentLink.trim() && (
                              <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800">
                                <span className="truncate text-slate-700 dark:text-slate-200">
                                  <strong>{tr('Link de pago:', 'Payment link:', 'Link de pagamento:')}</strong> {transferConfig.paymentLink.trim()}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleCopyText(transferConfig.paymentLink.trim(), 'Link')
                                  }
                                  className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                                >
                                  <Copy className="h-3 w-3" />
                                  {tr('Copiar', 'Copy', 'Copiar')}
                                </button>
                              </div>
                            )}

                            {transferConfig.holder && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {tr('Titular:', 'Holder:', 'Titular:')} <strong>{transferConfig.holder}</strong>
                              </div>
                            )}

                            {!hasAnyData && (
                              <p className="rounded-lg bg-amber-50/80 px-2.5 py-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                                {tr(
                                  'Cargá tu Alias / CBU para enviarlo al cliente por WhatsApp, o subí una captura de Tu QR de Mercado Pago / pegá un Link de pago.',
                                  'Add your bank alias/details to send via WhatsApp, or upload a QR image / payment link.',
                                  'Adicione sua chave Pix/dados bancários para enviar por WhatsApp ou suba a imagem do QR / link.'
                                )}
                              </p>
                            )}

                            <div className="flex flex-wrap items-center gap-2 pt-0.5">
                              {hasAnyData && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleCopyText(transferWaText, 'Datos de transferencia')
                                    }
                                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                  >
                                    <Copy className="h-3 w-3" />
                                    {tr('Copiar datos + monto', 'Copy details + amount', 'Copiar dados + valor')}
                                  </button>

                                  <a
                                    href={transferWaHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
                                  >
                                    <MessageCircle className="h-3 w-3" />
                                    {tr('Enviar por WhatsApp', 'Send via WhatsApp', 'Enviar por WhatsApp')}
                                  </a>
                                </>
                              )}

                              <button
                                type="button"
                                onClick={() => setEditingTransferConfig((prev) => !prev)}
                                className="inline-flex h-8 items-center gap-1 text-[11px] font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                              >
                                <Settings2 className="h-3 w-3" />
                                {editingTransferConfig
                                  ? tr('Ocultar configuración', 'Hide settings', 'Ocultar configuração')
                                  : tr('Configurar Alias / QR Mercado Pago', 'Configure Alias / QR', 'Configurar Chave / QR')}
                              </button>
                            </div>
                          </div>
                        </div>

                        {editingTransferConfig && (
                          <div className="mt-3 space-y-2.5 border-t border-slate-200 pt-3 dark:border-slate-800">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <input
                                type="text"
                                value={transferConfig.alias}
                                onChange={(e) =>
                                  setTransferConfig((p) => ({ ...p, alias: e.target.value }))
                                }
                                placeholder={tr('Alias (ej: taller.th3bnb)', 'Alias / Pix', 'Apelido / Pix')}
                                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              />
                              <input
                                type="text"
                                value={transferConfig.cbu}
                                onChange={(e) =>
                                  setTransferConfig((p) => ({ ...p, cbu: e.target.value }))
                                }
                                placeholder={tr('CBU / CVU (22 dígitos)', 'Bank / Account number', 'Conta bancária')}
                                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              />
                              <input
                                type="text"
                                value={transferConfig.holder}
                                onChange={(e) =>
                                  setTransferConfig((p) => ({ ...p, holder: e.target.value }))
                                }
                                placeholder={tr('Nombre del titular', 'Account holder name', 'Nome do titular')}
                                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              />
                              <input
                                type="url"
                                value={transferConfig.paymentLink}
                                onChange={(e) =>
                                  setTransferConfig((p) => ({ ...p, paymentLink: e.target.value }))
                                }
                                placeholder={tr('Link de pago MP (https://mpago.la/...)', 'Payment link (https://...)', 'Link de pagamento (https://...)')}
                                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              />
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                  <Upload className="h-3.5 w-3.5" />
                                  {tr('Subir captura QR (Mercado Pago / Banco)', 'Upload QR image', 'Enviar imagem QR')}
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    onChange={handleUploadTransferQr}
                                    className="hidden"
                                  />
                                </label>
                                {transferConfig.qrImageDataUrl && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextCfg = { ...transferConfig, qrImageDataUrl: '' };
                                      setTransferConfig(nextCfg);
                                      saveTransferConfig(repair.ownerId, nextCfg);
                                    }}
                                    className="text-[11px] font-semibold text-red-600 hover:underline dark:text-red-400"
                                  >
                                    {tr('Quitar QR', 'Remove QR', 'Remover QR')}
                                  </button>
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={handleSaveTransferConfig}
                                className="h-8 rounded-lg bg-[#0072BB] px-3 text-[11px] font-semibold text-white hover:bg-[#005f9c]"
                              >
                                {tr('Guardar datos', 'Save details', 'Salvar dados')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      </div>
                    );
                  })()}

                  <div className="space-y-2.5 border-t border-slate-200/80 pt-3 dark:border-slate-700/60">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        <span>
                          {tr(
                            `Registrar seña o abono parcial (${getCurrencyOption(partialCurrency).symbol})`,
                            `Record partial payment / deposit (${getCurrencyOption(partialCurrency).symbol})`,
                            `Registrar sinal ou pagamento parcial (${getCurrencyOption(partialCurrency).symbol})`
                          )}
                        </span>
                        {isPartialSecondary && partialInputNum > 0 && (
                          <span className="font-mono-num text-[#0072BB] dark:text-sky-300">
                            {tr('Equivale a', 'Equivalent to', 'Equivale a')} {formatCurrency(partialBaseEquivalent, baseCurrency)}
                          </span>
                        )}
                      </div>
                      <div
                        className={`grid gap-2 ${
                          partialSelectableCurrencies.length > 1
                            ? 'sm:grid-cols-[110px_96px_125px_1fr_auto]'
                            : 'sm:grid-cols-[120px_130px_1fr_auto]'
                        }`}
                      >
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={partialAmount}
                          onChange={(e) => setPartialAmount(e.target.value)}
                          placeholder={tr('Monto', 'Amount', 'Valor')}
                          className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        {partialSelectableCurrencies.length > 1 && (
                          <select
                            value={partialCurrency}
                            onChange={(e) => setPartialCurrency(sanitizeCurrencyCode(e.target.value))}
                            aria-label={tr('Moneda del abono parcial', 'Partial payment currency', 'Moeda do pagamento parcial')}
                            className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-800 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          >
                            {partialSelectableCurrencies.map((code) => {
                              const opt = getCurrencyOption(code);
                              return (
                                <option key={code} value={code}>
                                  {opt.code} ({opt.symbol})
                                </option>
                              );
                            })}
                          </select>
                        )}
                        <select
                          value={partialMethod}
                          onChange={(e) => setPartialMethod(e.target.value as PaymentMethod)}
                          className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-800 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="efectivo">{tr('Efectivo', 'Cash', 'Dinheiro')}</option>
                          <option value="transferencia">{tr('Transferencia', 'Transfer', 'Transferência')}</option>
                          <option value="tarjeta">{tr('Tarjeta', 'Card', 'Cartão')}</option>
                        </select>
                        <input
                          type="text"
                          value={partialNote}
                          onChange={(e) => setPartialNote(e.target.value)}
                          placeholder={tr('Nota opcional (ej: seña repuesto)', 'Optional note (e.g. parts deposit)', 'Nota opcional (ex: sinal peça)')}
                          maxLength={80}
                          className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        <button
                          type="button"
                          disabled={savingPartial}
                          onClick={() => void handleRegisterPartialPayment()}
                          className="h-9 rounded-lg border border-[#0072BB] bg-sky-50 px-3 text-xs font-bold text-[#0072BB] hover:bg-sky-100 disabled:opacity-60 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-300"
                        >
                          {savingPartial ? tr('Guardando...', 'Saving...', 'Salvando...') : tr('Abonar', 'Apply', 'Pagar')}
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={paying}
                        onClick={() => void handleRegisterFullPayment()}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {paying
                          ? tr('Registrando pago...', 'Recording payment...', 'Registrando pagamento...')
                          : `${tr('Cancelar saldo', 'Pay balance', 'Quitar saldo')} (${formatCurrency(pendingBalance, baseCurrency)}${
                              hasForeignDisplay && savedCurrency && savedRate
                                ? ` / ${formatCurrency(
                                    convertFromBaseCurrency(pendingBalance, savedRate),
                                    savedCurrency
                                  )}`
                                : ''
                            }) · ${PAYMENT_METHOD_LABELS[paymentMethod]}`}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                paymentInfo.isPaid && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-3 dark:border-slate-700/60">
                    <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>
                        {tr('PAGO', 'PAID', 'PAGO')} · {repair.clientName}
                        {paymentInfo.methodLabel ? ` (${paymentInfo.methodLabel})` : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setJustPaid(true);
                        setTab('receipt');
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      {tr('Imprimir boleta con sello PAGO', 'Print receipt with PAID stamp', 'Imprimir comprovante com carimbo PAGO')}
                    </button>
                  </div>
                )
              )}

              {paymentLedger.length > 0 && (
                <div className="border-t border-slate-200/80 pt-2.5 dark:border-slate-700/60">
                  <div className="mb-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    {tr('Movimientos de cobro registrados', 'Recorded payments', 'Pagamentos registrados')}
                  </div>
                  <div className="space-y-1">
                    {paymentLedger.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs dark:bg-slate-900"
                      >
                        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                          <span className="font-semibold">
                            {PAYMENT_METHOD_LABELS[entry.method]}
                          </span>
                          {entry.note && (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              · {entry.note}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono-num text-[11px] text-slate-400">
                            {formatDateShort(entry.date)}
                          </span>
                          <span className="font-mono-num font-bold text-emerald-700 dark:text-emerald-400">
                            {formatCurrency(entry.amount, baseCurrency)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <RepairStatusTimeline key={repair.id} repair={repair} timeline={detailMeta.timeline} />

            {/* Presupuesto online, Plantillas WhatsApp y Garantía */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    {tr('Presupuesto online y WhatsApp', 'Online quote & WhatsApp', 'Orçamento online e WhatsApp')}
                  </h4>
                  {detailMeta.quote.status === 'approved' && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <ThumbsUp className="h-3 w-3" />
                      {tr('Aprobado', 'Approved', 'Aprovado')}
                    </span>
                  )}
                  {detailMeta.quote.status === 'rejected' && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      <ThumbsDown className="h-3 w-3" />
                      {tr('Rechazado', 'Rejected', 'Recusado')}
                    </span>
                  )}
                  {detailMeta.quote.status === 'pending' && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      <Clock className="h-3 w-3" />
                      {tr('Pendiente', 'Pending', 'Pendente')}
                    </span>
                  )}
                </div>

                {detailMeta.quote.status === 'pending' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                    {tr('Presupuesto de', 'Quote of', 'Orçamento de')}{' '}
                    <strong className="font-mono-num">
                      {formatCurrency(detailMeta.quote.amount ?? repair.price, baseCurrency)}
                    </strong>{' '}
                    {tr(
                      'habilitado para que el cliente lo apruebe desde el link de seguimiento.',
                      'enabled for client approval from the tracking link.',
                      'habilitado para aprovação do cliente pelo link de acompanhamento.'
                    )}
                  </div>
                )}

                {detailMeta.quote.status === 'approved' && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-2.5 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
                    <div className="font-semibold">
                      {tr('Cliente aprobó', 'Client approved', 'Cliente aprovou')}{' '}
                      <span className="font-mono-num">
                        {formatCurrency(detailMeta.quote.amount ?? repair.price, baseCurrency)}
                      </span>
                      {detailMeta.quote.respondedAt
                        ? ` · ${formatDateShort(detailMeta.quote.respondedAt)}`
                        : ''}
                    </div>
                    {detailMeta.quote.clientNote && (
                      <div className="mt-1 text-[11px] opacity-90">
                        {tr('Nota:', 'Note:', 'Nota:')} "{detailMeta.quote.clientNote}"
                      </div>
                    )}
                  </div>
                )}

                {detailMeta.quote.status === 'rejected' && (
                  <div className="rounded-xl border border-red-200 bg-red-50/70 p-2.5 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                    <div className="font-semibold">
                      {tr('Cliente rechazó', 'Client rejected', 'Cliente recusou')}{' '}
                      <span className="font-mono-num">
                        {formatCurrency(detailMeta.quote.amount ?? repair.price, baseCurrency)}
                      </span>
                      {detailMeta.quote.respondedAt
                        ? ` · ${formatDateShort(detailMeta.quote.respondedAt)}`
                        : ''}
                    </div>
                    {detailMeta.quote.clientNote && (
                      <div className="mt-1 text-[11px] opacity-90">
                        {tr('Motivo:', 'Reason:', 'Motivo:')} "{detailMeta.quote.clientNote}"
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={sendingQuote}
                    onClick={() => void handleSendOnlineQuote()}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-[#0072BB] bg-sky-50 px-3 text-xs font-bold text-[#0072BB] transition hover:bg-sky-100 disabled:opacity-60 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-300"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {sendingQuote
                      ? tr('Habilitando...', 'Enabling...', 'Habilitando...')
                      : detailMeta.quote.status === 'pending'
                        ? tr('Actualizar presupuesto online', 'Update online quote', 'Atualizar orçamento online')
                        : detailMeta.quote.status === 'rejected'
                          ? tr('Enviar nuevo presupuesto online', 'Send new online quote', 'Enviar novo orçamento online')
                          : tr('Enviar presupuesto para aprobación online', 'Send quote for online approval', 'Enviar orçamento para aprovação online')}
                  </button>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <select
                      value={waTemplate}
                      onChange={(e) => setWaTemplate(e.target.value as WhatsAppTemplateId)}
                      aria-label={tr('Plantilla de WhatsApp', 'WhatsApp template', 'Modelo de WhatsApp')}
                      className="h-9 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="auto">
                        {tr('Automática', 'Automatic', 'Automático')} (
                        {WHATSAPP_TEMPLATE_OPTIONS.find(
                          (o) => o.id === resolveDefaultTemplateForStatus(repair.status)
                        )?.label || 'Seguimiento'}
                        )
                      </option>
                      {WHATSAPP_TEMPLATE_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {whatsappHref && (
                      <a
                        href={whatsappHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        {tr('Enviar', 'Send', 'Enviar')}
                      </a>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {tr('Plantilla activa:', 'Active template:', 'Modelo ativo:')}{' '}
                    {WHATSAPP_TEMPLATE_OPTIONS.find((o) => o.id === resolvedWaTemplateId)?.label}
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-between space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                      <ShieldCheck className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                      {tr('Garantía y reingresos', 'Warranty & re-entries', 'Garantia e reingressos')}
                    </h4>
                    {warrantyInfo.warrantyDays > 0 && (
                      <span className="font-mono-num text-xs font-bold text-slate-900 dark:text-white">
                        {warrantyInfo.warrantyDays} {tr('días', 'days', 'dias')}
                      </span>
                    )}
                  </div>

                  {warrantyInfo.warrantyDays <= 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {tr(
                        'Sin garantía configurada. Podés establecer los días de cobertura desde la pestaña Técnico.',
                        'No warranty configured. You can set coverage days from the Technician tab.',
                        'Sem garantia configurada. Você pode definir os dias de cobertura na aba Técnico.'
                      )}
                    </p>
                  ) : warrantyInfo.deliveredAt ? (
                    <div
                      className={`rounded-xl border p-2.5 text-xs ${
                        warrantyInfo.isActive
                          ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
                          : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300'
                      }`}
                    >
                      <div className="font-semibold">
                        {warrantyInfo.isActive
                          ? tr(
                              `Garantía vigente · quedan ${warrantyInfo.daysLeft} días`,
                              `Active warranty · ${warrantyInfo.daysLeft} days left`,
                              `Garantia vigente · restam ${warrantyInfo.daysLeft} dias`
                            )
                          : tr('Garantía vencida', 'Warranty expired', 'Garantia expirada')}
                      </div>
                      {warrantyInfo.expiresAt && (
                        <div className="mt-0.5 font-mono-num text-[11px] opacity-85">
                          {tr('Entregado:', 'Delivered:', 'Entregue:')} {formatDateShort(warrantyInfo.deliveredAt)} · {tr('Vence:', 'Expires:', 'Vence:')}{' '}
                          {formatDateShort(warrantyInfo.expiresAt.toISOString())}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-2.5 text-xs text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200">
                      {tr('Cobertura de', 'Coverage of', 'Cobertura de')}{' '}
                      <strong className="font-mono-num">
                        {warrantyInfo.warrantyDays} {tr('días', 'days', 'dias')}
                      </strong>{' '}
                      {tr(
                        '(se activa automáticamente al marcar como Entregado).',
                        '(activates automatically when marked Delivered).',
                        '(ativa automaticamente ao marcar como Entregue).'
                      )}
                    </div>
                  )}

                  {detailMeta.parentRepairCode && (
                    <div className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      {tr('Reingreso por garantía de la orden', 'Warranty re-entry from order', 'Reingresso por garantia da ordem')}{' '}
                      <span className="font-mono-num">{detailMeta.parentRepairCode}</span>
                    </div>
                  )}
                </div>

                {onWarrantyReentry && (
                  <button
                    type="button"
                    onClick={() => onWarrantyReentry(repair)}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition hover:border-[#0072BB] hover:bg-sky-50 hover:text-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-400 dark:hover:text-sky-300"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {tr('Reingreso por garantía', 'Warranty re-entry', 'Reingresso por garantia')}
                  </button>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  {tr('Equipo y seguimiento', 'Device & tracking', 'Aparelho e acompanhamento')}
                </h4>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{tr('Tipo:', 'Type:', 'Tipo:')}</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">{repair.deviceType}</dd>
                  </div>
                  {repair.color && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">{tr('Color:', 'Color:', 'Cor:')}</dt>
                      <dd className="font-medium text-slate-900 dark:text-white">{repair.color}</dd>
                    </div>
                  )}
                  {repair.capacity && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">
                        {repair.deviceType === 'Parlante' || repair.deviceType === 'Auriculares'
                          ? tr('Tipo / Formato:', 'Type / Format:', 'Tipo / Formato:')
                          : repair.deviceType === 'Consola / joystick'
                            ? tr('Edición / Capacidad:', 'Edition / Capacity:', 'Edição / Capacidade:')
                            : repair.deviceType === 'Smartwatch'
                              ? tr('Medida / Caja:', 'Size / Case:', 'Tamanho / Caixa:')
                              : repair.deviceType === 'Notebook'
                                ? tr('Almacenamiento:', 'Storage:', 'Armazenamento:')
                                : repair.deviceType === 'Otros equipos'
                                  ? tr('Categoría / Tipo:', 'Category / Type:', 'Categoria / Tipo:')
                                  : tr('Capacidad:', 'Capacity:', 'Capacidade:')}
                      </dt>
                      <dd className="font-medium text-slate-900 dark:text-white">{repair.capacity}</dd>
                    </div>
                  )}
                  {repair.imei && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">{tr('IMEI / Serie:', 'IMEI / Serial:', 'IMEI / Série:')}</dt>
                      <dd className="font-mono-num font-medium text-slate-900 dark:text-white">
                        {repair.imei}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{tr('Ingreso:', 'Check-in:', 'Entrada:')}</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">
                      {formatDateShort(repair.dateIn)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{tr('Entrega est.:', 'Est. delivery:', 'Prev. entrega:')}</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">
                      {formatDateShort(repair.dateEst)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{tr('Código público:', 'Tracking code:', 'Código público:')}</dt>
                    <dd className="font-mono-num font-bold text-[#0072BB] dark:text-sky-400">
                      {repair.trackingCode}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  {tr('Cliente', 'Client', 'Cliente')}
                </h4>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{tr('Nombre:', 'Name:', 'Nome:')}</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">{repair.clientName}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{tr('Teléfono:', 'Phone:', 'Telefone:')}</dt>
                    <dd className="font-mono-num font-medium text-slate-900 dark:text-white">
                      {repair.clientPhone || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{tr('DNI:', 'ID:', 'CPF/RG:')}</dt>
                    <dd className="font-mono-num font-medium text-slate-900 dark:text-white">
                      {repair.clientDni || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{tr('Email:', 'Email:', 'E-mail:')}</dt>
                    <dd className="truncate font-medium text-slate-900 dark:text-white">
                      {repair.clientEmail || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{tr('Dirección:', 'Address:', 'Endereço:')}</dt>
                    <dd className="truncate font-medium text-slate-900 dark:text-white">
                      {repair.clientAddress || '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {tr('Problema reportado', 'Reported issue', 'Problema relatado')}
              </h4>
              <p className="mt-1 text-sm text-slate-900 dark:text-white">{repair.problem}</p>
              {detailWork.text && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <h5 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    {tr('Trabajo realizado', 'Work performed', 'Serviço realizado')}
                  </h5>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-800 dark:text-slate-200">
                    {detailWork.text}
                  </p>
                </div>
              )}
              {detailWork.media.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="mb-2 flex items-center justify-between">
                    <h5 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      {tr('Fotos y videos enviados al seguimiento', 'Photos & videos shared on tracking', 'Fotos e vídeos enviados ao acompanhamento')}
                    </h5>
                    <span className="font-mono-num text-[11px] text-slate-400">
                      {detailWork.media.length}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {detailWork.media.map((item) => {
                      const safeUrl = sanitizeMediaUrl(item.url, item.type);
                      if (!safeUrl) return null;
                      const embedUrl = item.type === 'video' ? getEmbedVideoUrl(safeUrl) : null;
                      const safeExternalHref = sanitizeSafeUrl(safeUrl, 1000);
                      const isDirectVideo =
                        item.type === 'video' &&
                        (safeUrl.startsWith('data:video/') ||
                          /\.(mp4|webm|mov|m4v|ogg)(\?.*)?$/i.test(safeUrl));
                      return (
                        <div
                          key={item.id}
                          className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40"
                        >
                          {item.type === 'image' ? (
                            <button
                              type="button"
                              onClick={() => setLightboxImage(safeUrl)}
                              className="block w-full overflow-hidden text-left"
                            >
                              <img
                                src={safeUrl}
                                alt={item.caption || 'Foto técnica'}
                                referrerPolicy="no-referrer"
                                className="h-40 w-full object-cover transition hover:opacity-90"
                              />
                            </button>
                          ) : embedUrl ? (
                            <div className="aspect-video w-full bg-black">
                              <iframe
                                src={embedUrl}
                                title={item.caption || 'Video técnico'}
                                className="h-full w-full"
                                sandbox="allow-scripts allow-same-origin allow-presentation"
                                referrerPolicy="strict-origin-when-cross-origin"
                                allowFullScreen
                              />
                            </div>
                          ) : isDirectVideo ? (
                            <video
                              src={safeUrl}
                              controls
                              playsInline
                              preload="metadata"
                              className="h-40 w-full bg-black object-contain"
                            />
                          ) : safeExternalHref ? (
                            <a
                              href={safeExternalHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex h-28 flex-col items-center justify-center gap-1.5 text-xs font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                            >
                              <Video className="h-5 w-5" />
                              <span className="inline-flex items-center gap-1">
                                {tr('Abrir video', 'Open video', 'Abrir vídeo')}
                                <ExternalLink className="h-3 w-3" />
                              </span>
                            </a>
                          ) : null}
                          {item.caption && (
                            <div className="border-t border-slate-200/80 px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700/60 dark:text-slate-200">
                              {item.caption}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {repair.notes && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <h5 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    {tr('Notas', 'Notes', 'Notas')}
                  </h5>
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
                      {tr('Accesorios entregados', 'Accessories included', 'Acessórios entregues')}
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
                      {tr('Repuestos asignados', 'Assigned parts', 'Peças atribuídas')}
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
                      {tr('CHECK OUT · Estado físico', 'CHECK OUT · Physical condition', 'CHECK OUT · Estado físico')}
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
                      {tr('CHECK OUT · Estado funcional', 'CHECK OUT · Functional condition', 'CHECK OUT · Estado funcional')}
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
                  {tr('Seguridad del equipo', 'Device security', 'Segurança do aparelho')}
                </h4>
                {repair.securityType === 'pattern' &&
                repair.securityPattern &&
                repair.securityPattern.length > 0 ? (
                  <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:gap-5">
                    <PatternLock value={repair.securityPattern} readOnly size={150} />
                    <div className="font-mono-num text-xs text-slate-600 dark:text-slate-300">
                      {tr('Secuencia:', 'Sequence:', 'Sequência:')} {repair.securityPattern.join(' → ')}
                    </div>
                  </div>
                ) : (
                  <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                    {tr('PIN / Clave:', 'PIN / Password:', 'PIN / Senha:')} {repair.securityPin}
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
                  {tr('Eliminar orden', 'Delete order', 'Excluir ordem')}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-red-600 dark:text-red-400">
                    {tr('¿Confirmar eliminación?', 'Confirm deletion?', 'Confirmar exclusão?')}
                  </span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="h-9 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700"
                  >
                    {tr('Sí, eliminar', 'Yes, delete', 'Sim, excluir')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
                  >
                    {tr('Cancelar', 'Cancel', 'Cancelar')}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setTab('edit')}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
              >
                <Edit3 className="h-3.5 w-3.5" />
                {tr('Técnico', 'Technician', 'Técnico')}
              </button>
            </div>
          </div>
        )}

        {tab === 'edit' && (
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('Estado', 'Status', 'Status')}
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
                  <option value="recibido">{tr('Recibido', 'Received', 'Recebido')}</option>
                  <option value="diagnostico">{tr('Diagnóstico', 'Diagnosis', 'Diagnóstico')}</option>
                  <option value="espera_repuesto">{tr('Espera repuesto', 'Waiting for part', 'Aguardando peça')}</option>
                  <option value="en_progreso">{tr('En progreso', 'In progress', 'Em andamento')}</option>
                  <option value="listo">{tr('Listo para entregar', 'Ready for pickup', 'Pronto para entrega')}</option>
                  <option value="entregado">{tr('Entregado', 'Delivered', 'Entregue')}</option>
                </select>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span>{tr('Progreso', 'Progress', 'Progresso')}</span>
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
              {canAssignTechnician && (
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {tr('Técnico asignado (opcional)', 'Assigned technician (optional)', 'Técnico responsável (opcional)')}
                  </label>
                  <select
                    value={technician}
                    onChange={(e) => setTechnician(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">
                      {tr('Sin asignar / Dueño del taller', 'Unassigned / Shop owner', 'Sem atribuição / Dono da oficina')}
                    </option>
                    {technicianOptions.map((techName) => (
                      <option key={techName} value={techName}>
                        {techName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Trabajo realizado', 'Work performed', 'Serviço realizado')}
              </label>
              <textarea
                rows={2}
                value={workDetail}
                onChange={(e) => setWorkDetail(e.target.value)}
                placeholder={tr('Describí el trabajo técnico efectuado...', 'Describe technical work done...', 'Descreva o serviço técnico realizado...')}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="space-y-3 rounded-2xl border border-sky-200/80 bg-sky-50/40 p-4 dark:border-sky-900/50 dark:bg-sky-950/20">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                    <Camera className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
                    <span>
                      {tr(
                        'Enviar imagen o video al Seguimiento en línea',
                        'Send image or video to Online Tracking',
                        'Enviar imagem ou vídeo ao Acompanhamento online'
                      )}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {tr(
                      'Fotos o videos cortos (hasta 6 MB) o un enlace externo para que el cliente lo vea en vivo.',
                      'Photos or short videos (up to 6 MB) or an external link for live client viewing.',
                      'Fotos ou vídeos curtos (até 6 MB) ou um link externo para o cliente ver ao vivo.'
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={sendingMedia || mediaBusy}
                  onClick={() =>
                    void syncMediaToTracking(
                      mediaItems,
                      'Fotos/videos actualizados en Seguimiento en línea.'
                    )
                  }
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-[#0072BB] px-3 text-xs font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
                >
                  <Send className="h-3.5 w-3.5" />
                  {sendingMedia
                    ? tr('Enviando...', 'Sending...', 'Enviando...')
                    : tr('Enviar al seguimiento', 'Send to tracking', 'Enviar ao acompanhamento')}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                  <ImageIcon className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                  <span>{mediaBusy ? tr('Procesando...', 'Processing...', 'Processando...') : tr('Subir / sacar foto', 'Upload / take photo', 'Enviar / tirar foto')}</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={mediaBusy}
                    onChange={handleAddPhotos}
                    className="hidden"
                  />
                </label>

                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                  <Video className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                  <span>{mediaBusy ? tr('Procesando...', 'Processing...', 'Processando...') : tr('Subir / grabar video', 'Upload / record video', 'Enviar / gravar vídeo')}</span>
                  <input
                    type="file"
                    accept="video/*"
                    disabled={mediaBusy}
                    onChange={handleAddVideo}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setShowLinkInput((prev) => !prev)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Link2 className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                  <span>{tr('Pegar enlace', 'Paste link', 'Colar link')}</span>
                </button>
              </div>

              {showLinkInput && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
                  <select
                    value={mediaLinkType}
                    onChange={(e) => setMediaLinkType(e.target.value as 'video' | 'image')}
                    className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="video">{tr('Video', 'Video', 'Vídeo')}</option>
                    <option value="image">{tr('Imagen', 'Image', 'Imagem')}</option>
                  </select>
                  <input
                    type="url"
                    value={mediaLinkUrl}
                    onChange={(e) => setMediaLinkUrl(e.target.value)}
                    placeholder="https://... (YouTube, Google Drive, URL)"
                    className="h-9 min-w-[200px] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddMediaLink}
                    className="h-9 rounded-lg bg-[#0072BB] px-3 text-xs font-semibold text-white hover:bg-[#005f9c]"
                  >
                    {tr('Agregar', 'Add', 'Adicionar')}
                  </button>
                </div>
              )}

              {mediaItems.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {mediaItems.map((item) => {
                    const safeUrl = sanitizeMediaUrl(item.url, item.type);
                    if (!safeUrl) return null;
                    const embedUrl = item.type === 'video' ? getEmbedVideoUrl(safeUrl) : null;
                    const safeExternalHref = sanitizeSafeUrl(safeUrl, 1000);
                    const isDirectVideo =
                      item.type === 'video' &&
                      (safeUrl.startsWith('data:video/') ||
                        /\.(mp4|webm|mov|m4v|ogg)(\?.*)?$/i.test(safeUrl));
                    return (
                      <div
                        key={item.id}
                        className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                      >
                        <div className="relative">
                          {item.type === 'image' ? (
                            <button
                              type="button"
                              onClick={() => setLightboxImage(safeUrl)}
                              className="block w-full overflow-hidden text-left"
                            >
                              <img
                                src={safeUrl}
                                alt={item.caption || 'Foto adjunta'}
                                referrerPolicy="no-referrer"
                                className="h-36 w-full object-cover"
                              />
                            </button>
                          ) : embedUrl ? (
                            <div className="aspect-video w-full bg-black">
                              <iframe
                                src={embedUrl}
                                title={item.caption || 'Video adjunto'}
                                className="h-full w-full"
                                sandbox="allow-scripts allow-same-origin allow-presentation"
                                referrerPolicy="strict-origin-when-cross-origin"
                                allowFullScreen
                              />
                            </div>
                          ) : isDirectVideo ? (
                            <video
                              src={safeUrl}
                              controls
                              playsInline
                              preload="metadata"
                              className="h-36 w-full bg-black object-contain"
                            />
                          ) : safeExternalHref ? (
                            <a
                              href={safeExternalHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex h-28 flex-col items-center justify-center gap-1 bg-slate-100 text-xs font-semibold text-[#0072BB] dark:bg-slate-800 dark:text-sky-400"
                            >
                              <Video className="h-5 w-5" />
                              <span className="inline-flex items-center gap-1">
                                {tr('Enlace de video', 'Video link', 'Link do vídeo')}
                                <ExternalLink className="h-3 w-3" />
                              </span>
                            </a>
                          ) : null}

                          <button
                            type="button"
                            onClick={() =>
                              setMediaItems((prev) => prev.filter((m) => m.id !== item.id))
                            }
                            aria-label={tr('Quitar archivo', 'Remove file', 'Remover arquivo')}
                            className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900/75 text-white transition hover:bg-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="border-t border-slate-100 p-2 dark:border-slate-800">
                          <input
                            type="text"
                            maxLength={140}
                            value={item.caption || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setMediaItems((prev) =>
                                prev.map((m) =>
                                  m.id === item.id ? { ...m, caption: val } : m
                                )
                              );
                            }}
                            placeholder={tr('Descripción opcional para el cliente...', 'Optional client caption...', 'Descrição opcional para o cliente...')}
                            className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Notas internas', 'Internal notes', 'Notas internas')}
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2.5 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                  {tr('CHECK OUT · Estado físico', 'CHECK OUT · Physical condition', 'CHECK OUT · Estado físico')}
                </div>
                {getPhysicalCheckFields(repair.deviceType).map((field) => (
                  <div
                    key={field.key}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="text-xs text-slate-600 dark:text-slate-400">
                      {field.label}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {field.options.map((opt) => {
                        const selected = physicalCheck[field.key] === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() =>
                              setPhysicalCheck((prev) => {
                                const next = { ...prev };
                                if (next[field.key] === opt) {
                                  delete next[field.key];
                                } else {
                                  next[field.key] = opt;
                                }
                                return next;
                              })
                            }
                            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                              selected
                                ? 'bg-[#0072BB] text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2.5 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                  {tr('CHECK OUT · Estado funcional', 'CHECK OUT · Functional condition', 'CHECK OUT · Estado funcional')}
                </div>
                {getFunctionalCheckFields(repair.deviceType).map((field) => (
                  <div
                    key={field.key}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="text-xs text-slate-600 dark:text-slate-400">
                      {field.label}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {field.options.map((opt) => {
                        const selected = functionalCheck[field.key] === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() =>
                              setFunctionalCheck((prev) => {
                                const next = { ...prev };
                                if (next[field.key] === opt) {
                                  delete next[field.key];
                                } else {
                                  next[field.key] = opt;
                                }
                                return next;
                              })
                            }
                            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                              selected
                                ? 'bg-[#0072BB] text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {(spareParts.length > 0 || missingAssignedParts.length > 0) && (
              <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
                    <div>
                      <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                        {tr(`Repuestos del inventario (${selectedPartIds.length})`, `Inventory parts (${selectedPartIds.length})`, `Peças do estoque (${selectedPartIds.length})`)}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {tr(
                          'Agregá o quitá repuestos de la orden; el stock se ajusta automáticamente al guardar.',
                          'Add or remove parts from this order; stock adjusts automatically when saved.',
                          'Adicione ou remova peças da ordem; o estoque ajusta automaticamente ao salvar.'
                        )}
                      </p>
                    </div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={syncPartPrice}
                      onChange={(e) => setSyncPartPrice(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-[#0072BB]"
                    />
                    {tr('Ajustar presupuesto al marcar', 'Adjust estimate on selection', 'Ajustar orçamento ao selecionar')}
                  </label>
                </div>

                {spareParts.length > 6 && (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={partSearch}
                      onChange={(e) => setPartSearch(e.target.value)}
                      placeholder={tr('Buscar repuesto por nombre, marca o SKU...', 'Search part by name, brand or SKU...', 'Buscar peça por nome, marca ou SKU...')}
                      className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                )}

                {missingAssignedParts.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      {tr(
                        'Repuestos ya asignados (no figuran en inventario actual)',
                        'Already assigned parts (not in current inventory)',
                        'Peças já atribuídas (não constam no estoque atual)'
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {missingAssignedParts.map((item) => {
                        const checked = selectedPartIds.includes(item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => toggleMissingPart(item.id)}
                            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${
                              checked
                                ? 'border-amber-300 bg-amber-50/70 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
                                : 'border-slate-200 text-slate-500 line-through dark:border-slate-700 dark:text-slate-400'
                            }`}
                          >
                            <span className="truncate font-medium">{item.name}</span>
                            {checked && <Check className="ml-2 h-3.5 w-3.5 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {filteredSpareParts.length > 0 ? (
                  <div className="grid max-h-44 gap-2 overflow-y-auto rounded-xl border border-slate-200 p-2 sm:grid-cols-2 dark:border-slate-700">
                    {filteredSpareParts.map((part) => {
                      const checked = selectedPartIds.includes(part.id);
                      const partDisplayPrice = isEditSecondary
                        ? Math.round(
                            convertFromBaseCurrency(Number(part.price || 0), editRate) * 100
                          ) / 100
                        : Number(part.price || 0);
                      const outOfStock = Boolean(part.trackStock && Number(part.stock || 0) <= 0);
                      const lowStock = Boolean(
                        part.trackStock &&
                          !outOfStock &&
                          Number(part.minStock || 0) > 0 &&
                          Number(part.stock || 0) <= Number(part.minStock || 0)
                      );
                      return (
                        <button
                          key={part.id}
                          type="button"
                          onClick={() => toggleEditPart(part)}
                          className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${
                            checked
                              ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-300'
                              : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{part.name}</div>
                            <div
                              className={`text-[10px] ${
                                outOfStock
                                  ? 'font-semibold text-red-600 dark:text-red-400'
                                  : lowStock
                                    ? 'font-semibold text-amber-600 dark:text-amber-400'
                                    : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {part.trackStock
                                ? outOfStock
                                  ? tr('Sin stock (no descontará)', 'Out of stock (won\'t deduct)', 'Sem estoque (não descontará)')
                                  : lowStock
                                    ? tr(`Stock bajo: ${part.stock} u.`, `Low stock: ${part.stock} u.`, `Estoque baixo: ${part.stock} un.`)
                                    : tr(`Stock: ${part.stock} u.`, `Stock: ${part.stock} u.`, `Estoque: ${part.stock} un.`)
                                : tr('Sin control de stock', 'No stock tracking', 'Sem controle de estoque')}
                            </div>
                          </div>
                          <span className="flex shrink-0 items-center gap-1.5 font-mono-num font-semibold">
                            <span>{formatCurrency(partDisplayPrice, editCurrency)}</span>
                            {checked && <Check className="h-3.5 w-3.5" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  spareParts.length > 0 && (
                    <p className="text-xs text-slate-500">
                      {tr(
                        `No hay repuestos que coincidan con "${partSearch}".`,
                        `No parts matching "${partSearch}".`,
                        `Nenhuma peça correspondente a "${partSearch}".`
                      )}
                    </p>
                  )
                )}

                {selectedOutOfStockParts.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span>
                        {tr('Sin stock en inventario para:', 'Out of stock in inventory for:', 'Sem estoque para:')}{' '}
                        <strong>{selectedOutOfStockParts.map((p) => p.name).join(', ')}</strong>.{' '}
                        {tr('No se descontará unidad hasta reponer.', 'Units won\'t deduct until restocked.', 'Não será descontado até repor.')}
                      </span>
                    </div>
                    {status !== 'espera_repuesto' && (
                      <button
                        type="button"
                        onClick={() => {
                          setStatus('espera_repuesto');
                          setProgress(STATUS_META.espera_repuesto?.defaultProgress ?? progress);
                        }}
                        className="h-8 shrink-0 rounded-lg border border-amber-400 bg-white px-2.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-950/60"
                      >
                        {tr('Pasar a Espera repuesto', 'Move to Waiting for part', 'Mover para Aguardando peça')}
                      </button>
                    )}
                  </div>
                )}

                {(addedPartIds.length > 0 || removedPartIds.length > 0) && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2 text-[11px] font-semibold text-[#0072BB] dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300">
                    <span>{tr('Cambios pendientes al guardar:', 'Pending changes on save:', 'Alterações pendentes ao salvar:')}</span>
                    {addedPartIds.length > 0 && (
                      <span>
                        +{addedPartIds.length}{' '}
                        {addedPartIds.length === 1
                          ? tr('repuesto a descontar', 'part to deduct', 'peça a descontar')
                          : tr('repuestos a descontar', 'parts to deduct', 'peças a descontar')}
                      </span>
                    )}
                    {removedPartIds.length > 0 && (
                      <span>
                        -{removedPartIds.length}{' '}
                        {removedPartIds.length === 1
                          ? tr('repuesto a devolver al stock', 'part to restock', 'peça a devolver ao estoque')
                          : tr('repuestos a devolver al stock', 'parts to restock', 'peças a devolver ao estoque')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {tr('Presupuesto y pagos', 'Estimate & payments', 'Orçamento e pagamentos')}
                </div>
                {editSelectableCurrencies.length > 1 && (
                  <div className="flex items-center gap-1.5">
                    <Coins className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {tr('Moneda:', 'Currency:', 'Moeda:')}
                    </span>
                    <select
                      value={editCurrency}
                      onChange={(e) => handleEditCurrencyChange(e.target.value)}
                      aria-label={tr('Moneda del presupuesto', 'Estimate currency', 'Moeda do orçamento')}
                      className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      {editSelectableCurrencies.map((code) => {
                        const opt = getCurrencyOption(code);
                        return (
                          <option key={code} value={code}>
                            {opt.code} ({opt.symbol})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">
                    {tr(`Presupuesto (${editCurrencySymbol})`, `Estimate (${editCurrencySymbol})`, `Orçamento (${editCurrencySymbol})`)}
                  </label>
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
                  <label className="mb-1 block text-xs text-slate-500">
                    {tr(`Anticipo / Pagado (${editCurrencySymbol})`, `Deposit / Paid (${editCurrencySymbol})`, `Sinal / Pago (${editCurrencySymbol})`)}
                  </label>
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
                  <label className="mb-1 block text-xs text-slate-500">
                    {tr('Total pendiente', 'Balance due', 'Saldo pendente')}
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={formatCurrency(editPendingBalance, editCurrency)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono-num text-sm font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white"
                  />
                </div>
              </div>
              {isEditSecondary && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  <span>
                    {tr('Tasa:', 'Rate:', 'Taxa:')} 1 {editCurrency} = {formatCurrency(editRate, baseCurrency)}
                  </span>
                  <span className="font-mono-num font-bold">
                    {tr('Equivalente en', 'Equivalent in', 'Equivalente em')} {baseCurrency}:{' '}
                    {tr('Presup.', 'Est.', 'Orçam.')} {formatCurrency(editBaseBudgetPreview, baseCurrency)} ·{' '}
                    {tr('Pagado', 'Paid', 'Pago')} {formatCurrency(editBaseDepositPreview, baseCurrency)}
                  </span>
                </div>
              )}

              <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {tr('Garantía del trabajo (días desde la entrega)', 'Service warranty (days from delivery)', 'Garantia do serviço (dias após entrega)')}
                  </label>
                  <span className="font-mono-num text-xs font-bold text-[#0072BB] dark:text-sky-400">
                    {warrantyDays > 0
                      ? `${warrantyDays} ${tr('días', 'days', 'dias')}`
                      : tr('Sin garantía', 'No warranty', 'Sem garantia')}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[0, 30, 60, 90].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setWarrantyDays(preset)}
                      className={`h-8 rounded-lg px-2.5 text-xs font-semibold transition ${
                        warrantyDays === preset
                          ? 'bg-[#0072BB] text-white'
                          : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {preset === 0
                        ? tr('Sin garantía', 'No warranty', 'Sem garantia')
                        : `${preset} ${tr('días', 'days', 'dias')}`}
                    </button>
                  ))}
                  <input
                    type="number"
                    min="0"
                    max="3650"
                    value={warrantyDays}
                    onChange={(e) =>
                      setWarrantyDays(
                        Math.max(0, Math.min(3650, Math.round(Number(e.target.value) || 0)))
                      )
                    }
                    aria-label={tr('Días de garantía personalizados', 'Custom warranty days', 'Dias personalizados de garantia')}
                    className="h-8 w-24 rounded-lg border border-slate-200 bg-white px-2.5 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {tr('Datos del cliente y entrega', 'Client & delivery details', 'Dados do cliente e entrega')}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder={tr('Nombre y apellido', 'Full name', 'Nome e sobrenome')}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder={tr('Celular', 'Phone', 'Celular')}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="text"
                  value={clientDni}
                  onChange={(e) => setClientDni(e.target.value)}
                  placeholder={tr('DNI', 'ID Number', 'CPF / RG')}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder={tr('Email', 'Email', 'E-mail')}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="text"
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  placeholder={tr('Dirección', 'Address', 'Endereço')}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 sm:col-span-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="text"
                  value={checkoutState}
                  onChange={(e) => setCheckoutState(e.target.value)}
                  placeholder={tr('Estado de entrega / conformidad del cliente', 'Delivery condition / client sign-off', 'Estado de entrega / conformidade do cliente')}
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
                {tr('Cancelar', 'Cancel', 'Cancelar')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c] disabled:opacity-60"
              >
                {saving
                  ? tr('Guardando...', 'Saving...', 'Salvando...')
                  : tr('Guardar cambios', 'Save changes', 'Salvar alterações')}
              </button>
            </div>
          </form>
        )}

        {tab === 'receipt' && (
          <RepairPrintDocuments
            repair={repair}
            profile={profile}
            trackingUrl={trackingUrl}
            justCreated={justCreated}
            justPaid={justPaid}
          />
        )}
      </ModalShell>

      <PaymentSettingsModal
        open={showMpSettings}
        onClose={() => setShowMpSettings(false)}
        ownerId={repair.ownerId}
        profile={profile}
        onSaved={(nextCfg) => setMpConfig(nextCfg)}
      />

      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-xs"
        >
          <button
            type="button"
            onClick={() => setLightboxImage(null)}
            aria-label={tr('Cerrar vista ampliada', 'Close enlarged view', 'Fechar visualização ampliada')}
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxImage}
            alt={tr('Vista ampliada', 'Enlarged view', 'Visualização ampliada')}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-full rounded-2xl object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
};
