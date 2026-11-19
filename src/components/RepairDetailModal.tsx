import React, { useEffect, useMemo, useState } from 'react';
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
  MessageCircle,
  Package,
  PenTool,
  Printer,
  QrCode,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
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
import { parseWorkshopMeta } from '../utils/workshopMeta';
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
import { ModalShell } from './ModalShell';
import { PatternLock } from './PatternLock';
import { RepairPrintDocuments } from './RepairPrintDocuments';
import { useToast } from './ToastProvider';

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
    setShowLinkInput(false);
    setMediaLinkUrl('');
    setLightboxImage(null);
    setPartSearch('');
    setSyncPartPrice(true);
  }, [repair?.id, initialTab]);

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
      notify(sanitizeDbErrorMessage(err, 'No se pudo registrar el pago.'), 'error');
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
      notify(sanitizeDbErrorMessage(err, 'No se pudo registrar el abono.'), 'error');
    } finally {
      setSavingPartial(false);
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
        subtitle={`Orden ${repair.code} · Cliente: ${repair.clientName}`}
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
              Detalle
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
              Técnico
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
              Imprimir
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
                Boleta lote ({batchRef})
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
              Copiar link
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
                    Estado actual · Prioridad {repair.priority}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold ${statusMeta.badgeClass}`}
                    >
                      {statusMeta.label}
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
                        Firmada por el cliente ✓
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-right">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Presupuesto</div>
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
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Seña</div>
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
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Pendiente</div>
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
                      Registrar pago · Elegí el medio de pago
                    </span>
                    <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                      {(
                        [
                          { id: 'efectivo', label: 'Efectivo', icon: Banknote },
                          { id: 'transferencia', label: 'Transferencia', icon: QrCode },
                          { id: 'tarjeta', label: 'Tarjeta', icon: CreditCard },
                        ] as const
                      ).map(({ id, label, icon: Icon }) => {
                        const active = paymentMethod === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setPaymentMethod(id)}
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
                                Cobro por transferencia
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
                                  Copiar
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
                                  Copiar
                                </button>
                              </div>
                            )}

                            {transferConfig.paymentLink.trim() && (
                              <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800">
                                <span className="truncate text-slate-700 dark:text-slate-200">
                                  <strong>Link de pago:</strong> {transferConfig.paymentLink.trim()}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleCopyText(transferConfig.paymentLink.trim(), 'Link')
                                  }
                                  className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
                                >
                                  <Copy className="h-3 w-3" />
                                  Copiar
                                </button>
                              </div>
                            )}

                            {transferConfig.holder && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                Titular: <strong>{transferConfig.holder}</strong>
                              </div>
                            )}

                            {!hasAnyData && (
                              <p className="rounded-lg bg-amber-50/80 px-2.5 py-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                                Cargá tu <strong>Alias / CBU</strong> para enviarlo al cliente por WhatsApp, o subí una captura de <strong>Tu QR de Mercado Pago</strong> / pegá un <strong>Link de pago</strong>.
                              </p>
                            )}

                            {hasAnyData && !hasOfficialQr && !hasLinkQr && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Mercado Pago no genera QR directo desde un Alias: copiá los datos o envialos por WhatsApp, o subí la captura de tu QR oficial desde Configurar.
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
                                    Copiar datos + monto
                                  </button>

                                  <a
                                    href={transferWaHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
                                  >
                                    <MessageCircle className="h-3 w-3" />
                                    Enviar por WhatsApp
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
                                  ? 'Ocultar configuración'
                                  : 'Configurar Alias / QR Mercado Pago'}
                              </button>
                            </div>
                          </div>
                        </div>

                        {editingTransferConfig && (
                          <div className="mt-3 space-y-2.5 border-t border-slate-200 pt-3 dark:border-slate-800">
                            <div className="rounded-lg bg-sky-50/70 px-2.5 py-2 text-[11px] text-slate-600 dark:bg-sky-950/30 dark:text-slate-300">
                              Para que funcione con el escáner de <strong>Mercado Pago</strong>, subí la imagen de <strong>Tu QR</strong> (descargada desde la app de Mercado Pago o tu banco) o pegá un <strong>Link de pago</strong> (<code>mpago.la/...</code>).
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <input
                                type="text"
                                value={transferConfig.alias}
                                onChange={(e) =>
                                  setTransferConfig((p) => ({ ...p, alias: e.target.value }))
                                }
                                placeholder="Alias (ej: taller.th3bnb)"
                                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              />
                              <input
                                type="text"
                                value={transferConfig.cbu}
                                onChange={(e) =>
                                  setTransferConfig((p) => ({ ...p, cbu: e.target.value }))
                                }
                                placeholder="CBU / CVU (22 dígitos)"
                                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              />
                              <input
                                type="text"
                                value={transferConfig.holder}
                                onChange={(e) =>
                                  setTransferConfig((p) => ({ ...p, holder: e.target.value }))
                                }
                                placeholder="Nombre del titular"
                                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              />
                              <input
                                type="url"
                                value={transferConfig.paymentLink}
                                onChange={(e) =>
                                  setTransferConfig((p) => ({ ...p, paymentLink: e.target.value }))
                                }
                                placeholder="Link de pago MP (https://mpago.la/...)"
                                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                              />
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                  <Upload className="h-3.5 w-3.5" />
                                  Subir captura QR (Mercado Pago / Banco)
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
                                    Quitar QR
                                  </button>
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={handleSaveTransferConfig}
                                className="h-8 rounded-lg bg-[#0072BB] px-3 text-[11px] font-semibold text-white hover:bg-[#005f9c]"
                              >
                                Guardar datos
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="space-y-2.5 border-t border-slate-200/80 pt-3 dark:border-slate-700/60">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        <span>
                          Registrar seña o abono parcial ({getCurrencyOption(partialCurrency).symbol})
                        </span>
                        {isPartialSecondary && partialInputNum > 0 && (
                          <span className="font-mono-num text-[#0072BB] dark:text-sky-300">
                            Equivale a {formatCurrency(partialBaseEquivalent, baseCurrency)}
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
                          placeholder="Monto"
                          className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        {partialSelectableCurrencies.length > 1 && (
                          <select
                            value={partialCurrency}
                            onChange={(e) => setPartialCurrency(sanitizeCurrencyCode(e.target.value))}
                            aria-label="Moneda del abono parcial"
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
                          <option value="efectivo">Efectivo</option>
                          <option value="transferencia">Transferencia</option>
                          <option value="tarjeta">Tarjeta</option>
                        </select>
                        <input
                          type="text"
                          value={partialNote}
                          onChange={(e) => setPartialNote(e.target.value)}
                          placeholder="Nota opcional (ej: seña repuesto)"
                          maxLength={80}
                          className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        <button
                          type="button"
                          disabled={savingPartial}
                          onClick={() => void handleRegisterPartialPayment()}
                          className="h-9 rounded-lg border border-[#0072BB] bg-sky-50 px-3 text-xs font-bold text-[#0072BB] hover:bg-sky-100 disabled:opacity-60 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-300"
                        >
                          {savingPartial ? 'Guardando...' : 'Abonar'}
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
                          ? 'Registrando pago...'
                          : `Cancelar saldo (${formatCurrency(pendingBalance, baseCurrency)}${
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
                        PAGO · {repair.clientName}
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
                      Imprimir boleta con sello PAGO
                    </button>
                  </div>
                )
              )}

              {paymentLedger.length > 0 && (
                <div className="border-t border-slate-200/80 pt-2.5 dark:border-slate-700/60">
                  <div className="mb-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    Movimientos de cobro registrados
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

            {/* Presupuesto online, Plantillas WhatsApp y Garantía */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    Presupuesto online y WhatsApp
                  </h4>
                  {detailMeta.quote.status === 'approved' && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <ThumbsUp className="h-3 w-3" />
                      Aprobado
                    </span>
                  )}
                  {detailMeta.quote.status === 'rejected' && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      <ThumbsDown className="h-3 w-3" />
                      Rechazado
                    </span>
                  )}
                  {detailMeta.quote.status === 'pending' && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      <Clock className="h-3 w-3" />
                      Pendiente
                    </span>
                  )}
                </div>

                {detailMeta.quote.status === 'pending' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                    Presupuesto de{' '}
                    <strong className="font-mono-num">
                      {formatCurrency(detailMeta.quote.amount ?? repair.price, baseCurrency)}
                    </strong>{' '}
                    habilitado para que el cliente lo apruebe desde el link de seguimiento.
                  </div>
                )}

                {detailMeta.quote.status === 'approved' && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-2.5 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
                    <div className="font-semibold">
                      Cliente aprobó{' '}
                      <span className="font-mono-num">
                        {formatCurrency(detailMeta.quote.amount ?? repair.price, baseCurrency)}
                      </span>
                      {detailMeta.quote.respondedAt
                        ? ` el ${formatDateShort(detailMeta.quote.respondedAt)}`
                        : ''}
                    </div>
                    {detailMeta.quote.clientNote && (
                      <div className="mt-1 text-[11px] opacity-90">
                        Nota: "{detailMeta.quote.clientNote}"
                      </div>
                    )}
                  </div>
                )}

                {detailMeta.quote.status === 'rejected' && (
                  <div className="rounded-xl border border-red-200 bg-red-50/70 p-2.5 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                    <div className="font-semibold">
                      Cliente rechazó{' '}
                      <span className="font-mono-num">
                        {formatCurrency(detailMeta.quote.amount ?? repair.price, baseCurrency)}
                      </span>
                      {detailMeta.quote.respondedAt
                        ? ` el ${formatDateShort(detailMeta.quote.respondedAt)}`
                        : ''}
                    </div>
                    {detailMeta.quote.clientNote && (
                      <div className="mt-1 text-[11px] opacity-90">
                        Motivo: "{detailMeta.quote.clientNote}"
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
                      ? 'Habilitando...'
                      : detailMeta.quote.status === 'pending'
                        ? 'Actualizar presupuesto online'
                        : detailMeta.quote.status === 'rejected'
                          ? 'Enviar nuevo presupuesto online'
                          : 'Enviar presupuesto para aprobación online'}
                  </button>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <select
                      value={waTemplate}
                      onChange={(e) => setWaTemplate(e.target.value as WhatsAppTemplateId)}
                      aria-label="Plantilla de WhatsApp"
                      className="h-9 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="auto">
                        Automática (
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
                        Enviar
                      </a>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Plantilla activa:{' '}
                    {WHATSAPP_TEMPLATE_OPTIONS.find((o) => o.id === resolvedWaTemplateId)?.label}
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-between space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                      <ShieldCheck className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                      Garantía y reingresos
                    </h4>
                    {warrantyInfo.warrantyDays > 0 && (
                      <span className="font-mono-num text-xs font-bold text-slate-900 dark:text-white">
                        {warrantyInfo.warrantyDays} días
                      </span>
                    )}
                  </div>

                  {warrantyInfo.warrantyDays <= 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Sin garantía configurada. Podés establecer los días de cobertura desde la
                      pestaña <strong>Técnico</strong>.
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
                          ? `Garantía vigente · quedan ${warrantyInfo.daysLeft} días`
                          : 'Garantía vencida'}
                      </div>
                      {warrantyInfo.expiresAt && (
                        <div className="mt-0.5 font-mono-num text-[11px] opacity-85">
                          Entregado: {formatDateShort(warrantyInfo.deliveredAt)} · Vence:{' '}
                          {formatDateShort(warrantyInfo.expiresAt.toISOString())}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-2.5 text-xs text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200">
                      Cobertura de <strong className="font-mono-num">{warrantyInfo.warrantyDays} días</strong>{' '}
                      (se activa automáticamente al marcar como Entregado).
                    </div>
                  )}

                  {detailMeta.parentRepairCode && (
                    <div className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      Reingreso por garantía de la orden{' '}
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
                    Reingreso por garantía
                  </button>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  Equipo y seguimiento
                </h4>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Tipo:</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">{repair.deviceType}</dd>
                  </div>
                  {repair.color && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Color:</dt>
                      <dd className="font-medium text-slate-900 dark:text-white">{repair.color}</dd>
                    </div>
                  )}
                  {repair.capacity && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">
                        {repair.deviceType === 'Parlante' || repair.deviceType === 'Auriculares'
                          ? 'Tipo / Formato:'
                          : repair.deviceType === 'Consola / joystick'
                            ? 'Edición / Capacidad:'
                            : repair.deviceType === 'Smartwatch'
                              ? 'Medida / Caja:'
                              : repair.deviceType === 'Notebook'
                                ? 'Almacenamiento:'
                                : repair.deviceType === 'Otros equipos'
                                  ? 'Categoría / Tipo:'
                                  : 'Capacidad:'}
                      </dt>
                      <dd className="font-medium text-slate-900 dark:text-white">{repair.capacity}</dd>
                    </div>
                  )}
                  {repair.imei && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">IMEI / Serie:</dt>
                      <dd className="font-mono-num font-medium text-slate-900 dark:text-white">
                        {repair.imei}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Ingreso:</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">
                      {formatDateShort(repair.dateIn)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Entrega est.:</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">
                      {formatDateShort(repair.dateEst)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Código público:</dt>
                    <dd className="font-mono-num font-bold text-[#0072BB] dark:text-sky-400">
                      {repair.trackingCode}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">Cliente</h4>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Nombre:</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">{repair.clientName}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Teléfono:</dt>
                    <dd className="font-mono-num font-medium text-slate-900 dark:text-white">
                      {repair.clientPhone || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">DNI:</dt>
                    <dd className="font-mono-num font-medium text-slate-900 dark:text-white">
                      {repair.clientDni || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Email:</dt>
                    <dd className="truncate font-medium text-slate-900 dark:text-white">
                      {repair.clientEmail || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Dirección:</dt>
                    <dd className="truncate font-medium text-slate-900 dark:text-white">
                      {repair.clientAddress || '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Problema reportado
              </h4>
              <p className="mt-1 text-sm text-slate-900 dark:text-white">{repair.problem}</p>
              {detailWork.text && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <h5 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    Trabajo realizado
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
                      Fotos y videos enviados al seguimiento
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
                                Abrir video
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
                  <h5 className="text-xs font-bold text-slate-500 dark:text-slate-400">Notas</h5>
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
                      Accesorios entregados
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
                      Repuestos asignados
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
                      CHECK OUT · Estado físico
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
                      CHECK OUT · Estado funcional
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
                  Seguridad del equipo
                </h4>
                {repair.securityType === 'pattern' &&
                repair.securityPattern &&
                repair.securityPattern.length > 0 ? (
                  <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:gap-5">
                    <PatternLock value={repair.securityPattern} readOnly size={150} />
                    <div className="font-mono-num text-xs text-slate-600 dark:text-slate-300">
                      Secuencia: {repair.securityPattern.join(' → ')}
                    </div>
                  </div>
                ) : (
                  <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                    PIN / Clave: {repair.securityPin}
                  </div>
                )}
              </div>
            )}

            {detailMeta.timeline.length > 0 && (
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <h4 className="mb-3 flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                  <Clock className="h-3.5 w-3.5" />
                  Historial de avances
                </h4>
                <div className="space-y-2.5">
                  {[...detailMeta.timeline].reverse().map((ev, idx) => (
                    <div key={ev.id} className="flex items-start gap-2.5 text-xs">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          idx === 0 ? 'bg-[#0072BB] dark:bg-sky-400' : 'bg-slate-300 dark:bg-slate-600'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {ev.label}
                          </span>
                          <span className="font-mono-num text-[11px] text-slate-400">
                            {formatDateShort(ev.at)}
                          </span>
                        </div>
                        {ev.note && (
                          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                            {ev.note}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
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
                  Eliminar orden
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-red-600 dark:text-red-400">
                    ¿Confirmar eliminación?
                  </span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="h-9 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700"
                  >
                    Sí, eliminar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setTab('edit')}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Técnico
              </button>
            </div>
          </div>
        )}

        {tab === 'edit' && (
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Estado
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
                  <option value="recibido">Recibido</option>
                  <option value="diagnostico">Diagnóstico</option>
                  <option value="espera_repuesto">Espera repuesto</option>
                  <option value="en_progreso">En progreso</option>
                  <option value="listo">Listo para entregar</option>
                  <option value="entregado">Entregado</option>
                </select>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span>Progreso</span>
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
                    Técnico asignado (opcional)
                  </label>
                  <select
                    value={technician}
                    onChange={(e) => setTechnician(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Sin asignar / Dueño del taller</option>
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
                Trabajo realizado
              </label>
              <textarea
                rows={2}
                value={workDetail}
                onChange={(e) => setWorkDetail(e.target.value)}
                placeholder="Describí el trabajo técnico efectuado..."
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="space-y-3 rounded-2xl border border-sky-200/80 bg-sky-50/40 p-4 dark:border-sky-900/50 dark:bg-sky-950/20">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                    <Camera className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
                    <span>Enviar imagen o video al Seguimiento en línea</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Fotos o videos cortos (hasta 6 MB) o un enlace externo para que el cliente lo vea en vivo.
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
                  {sendingMedia ? 'Enviando...' : 'Enviar al seguimiento'}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                  <ImageIcon className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                  <span>{mediaBusy ? 'Procesando...' : 'Subir / sacar foto'}</span>
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
                  <span>{mediaBusy ? 'Procesando...' : 'Subir / grabar video'}</span>
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
                  <span>Pegar enlace</span>
                </button>
              </div>

              {showLinkInput && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
                  <select
                    value={mediaLinkType}
                    onChange={(e) => setMediaLinkType(e.target.value as 'video' | 'image')}
                    className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="video">Video</option>
                    <option value="image">Imagen</option>
                  </select>
                  <input
                    type="url"
                    value={mediaLinkUrl}
                    onChange={(e) => setMediaLinkUrl(e.target.value)}
                    placeholder="https://... (YouTube, Google Drive o URL directa)"
                    className="h-9 min-w-[200px] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddMediaLink}
                    className="h-9 rounded-lg bg-[#0072BB] px-3 text-xs font-semibold text-white hover:bg-[#005f9c]"
                  >
                    Agregar
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
                                Enlace de video
                                <ExternalLink className="h-3 w-3" />
                              </span>
                            </a>
                          ) : null}

                          <button
                            type="button"
                            onClick={() =>
                              setMediaItems((prev) => prev.filter((m) => m.id !== item.id))
                            }
                            aria-label="Quitar archivo"
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
                            placeholder="Descripción opcional para el cliente..."
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
                Notas internas
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
                  CHECK OUT · Estado físico
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
                  CHECK OUT · Estado funcional
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
                        Repuestos del inventario ({selectedPartIds.length})
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Agregá o quitá repuestos de la orden; el stock se ajusta automáticamente al guardar.
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
                    Ajustar presupuesto al marcar
                  </label>
                </div>

                {spareParts.length > 6 && (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={partSearch}
                      onChange={(e) => setPartSearch(e.target.value)}
                      placeholder="Buscar repuesto por nombre, marca o SKU..."
                      className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                )}

                {missingAssignedParts.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      Repuestos ya asignados (no figuran en inventario actual)
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
                                  ? 'Sin stock (no descontará)'
                                  : lowStock
                                    ? `Stock bajo: ${part.stock} u.`
                                    : `Stock: ${part.stock} u.`
                                : 'Sin control de stock'}
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
                      No hay repuestos que coincidan con "{partSearch}".
                    </p>
                  )
                )}

                {selectedOutOfStockParts.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span>
                        Sin stock en inventario para:{' '}
                        <strong>{selectedOutOfStockParts.map((p) => p.name).join(', ')}</strong>. No
                        se descontará unidad hasta reponer.
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
                        Pasar a Espera repuesto
                      </button>
                    )}
                  </div>
                )}

                {(addedPartIds.length > 0 || removedPartIds.length > 0) && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2 text-[11px] font-semibold text-[#0072BB] dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300">
                    <span>Cambios pendientes al guardar:</span>
                    {addedPartIds.length > 0 && (
                      <span>
                        +{addedPartIds.length}{' '}
                        {addedPartIds.length === 1 ? 'repuesto a descontar' : 'repuestos a descontar'}
                      </span>
                    )}
                    {removedPartIds.length > 0 && (
                      <span>
                        -{removedPartIds.length}{' '}
                        {removedPartIds.length === 1
                          ? 'repuesto a devolver al stock'
                          : 'repuestos a devolver al stock'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Presupuesto y pagos
                </div>
                {editSelectableCurrencies.length > 1 && (
                  <div className="flex items-center gap-1.5">
                    <Coins className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      Moneda:
                    </span>
                    <select
                      value={editCurrency}
                      onChange={(e) => handleEditCurrencyChange(e.target.value)}
                      aria-label="Moneda del presupuesto"
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
                    Presupuesto ({editCurrencySymbol})
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
                    Anticipo / Pagado ({editCurrencySymbol})
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
                  <label className="mb-1 block text-xs text-slate-500">Total pendiente</label>
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
                    Tasa: 1 {editCurrency} = {formatCurrency(editRate, baseCurrency)}
                  </span>
                  <span className="font-mono-num font-bold">
                    Equivalente en {baseCurrency}: Presup.{' '}
                    {formatCurrency(editBaseBudgetPreview, baseCurrency)} · Pagado{' '}
                    {formatCurrency(editBaseDepositPreview, baseCurrency)}
                  </span>
                </div>
              )}

              <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Garantía del trabajo (días desde la entrega)
                  </label>
                  <span className="font-mono-num text-xs font-bold text-[#0072BB] dark:text-sky-400">
                    {warrantyDays > 0 ? `${warrantyDays} días` : 'Sin garantía'}
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
                      {preset === 0 ? 'Sin garantía' : `${preset} días`}
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
                    aria-label="Días de garantía personalizados"
                    className="h-8 w-24 rounded-lg border border-slate-200 bg-white px-2.5 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Datos del cliente y entrega
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nombre y apellido"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="Celular"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="text"
                  value={clientDni}
                  onChange={(e) => setClientDni(e.target.value)}
                  placeholder="DNI"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="Email"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="text"
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  placeholder="Dirección"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 sm:col-span-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="text"
                  value={checkoutState}
                  onChange={(e) => setCheckoutState(e.target.value)}
                  placeholder="Estado de entrega / conformidad del cliente"
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
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c] disabled:opacity-60"
              >
                {saving ? 'Guardando...' : 'Guardar cambios'}
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

      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-xs"
        >
          <button
            type="button"
            onClick={() => setLightboxImage(null)}
            aria-label="Cerrar vista ampliada"
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxImage}
            alt="Vista ampliada"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-full rounded-2xl object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
};
