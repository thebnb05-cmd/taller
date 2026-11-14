import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Banknote,
  Camera,
  CheckCircle2,
  Copy,
  CreditCard,
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  MessageCircle,
  Printer,
  QrCode,
  Send,
  Settings2,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import {
  clampStr,
  deleteRow,
  fetchPublicTicketByCode,
  stripUndefined,
  updateRow,
  upsertRow,
} from '../lib/db';
import { STATUS_META } from '../data/catalog';
import type {
  ClientRecord,
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
  loadTransferConfig,
  PAYMENT_METHOD_LABELS,
  parsePaymentInfo,
  saveTransferConfig,
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
import { buildTrackingUrl } from '../utils/tracking';
import { getFunctionalCheckFields, getPhysicalCheckFields } from '../utils/checkFields';
import { ModalShell } from './ModalShell';
import { PatternLock } from './PatternLock';
import { RepairPrintDocuments } from './RepairPrintDocuments';
import { useToast } from './ToastProvider';

interface RepairDetailModalProps {
  repair: RepairRecord | null;
  clients?: ClientRecord[];
  profile?: WorkshopProfile | null;
  initialTab?: 'detail' | 'edit' | 'receipt';
  justCreated?: boolean;
  onClose: () => void;
}

export const RepairDetailModal: React.FC<RepairDetailModalProps> = ({
  repair,
  clients = [],
  profile,
  initialTab = 'detail',
  justCreated = false,
  onClose,
}) => {
  const { notify } = useToast();
  const [tab, setTab] = useState<'detail' | 'edit' | 'receipt'>(initialTab);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit state
  const [status, setStatus] = useState<RepairStatus>('recibido');
  const [progress, setProgress] = useState(15);
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
  const [saving, setSaving] = useState(false);

  // Payment state in Detalle tab
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo');
  const [paying, setPaying] = useState(false);
  const [justPaid, setJustPaid] = useState(false);
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
    setEditingTransferConfig(false);
    setShowLinkInput(false);
    setMediaLinkUrl('');
    setLightboxImage(null);
  }, [repair?.id, initialTab]);

  useEffect(() => {
    if (!repair) return;
    setStatus((repair.status as RepairStatus) || 'recibido');
    setProgress(repair.progress ?? 15);
    setNotes(repair.notes || '');
    setClientName(repair.clientName || '');
    setClientPhone(repair.clientPhone || '');
    setClientDni(repair.clientDni || '');
    setClientEmail(repair.clientEmail || '');
    setClientAddress(repair.clientAddress || '');
    setPrice(String(repair.price ?? 0));
    setDeposit(String(repair.deposit ?? 0));
    const parsedWork = parseWorkDetailAndMedia(repair.workDetail);
    setWorkDetail(parsedWork.text);
    setMediaItems(parsedWork.media);
    setCheckoutState(repair.checkoutState || '');
    setPhysicalCheck({ ...(repair.physicalCheck || {}) });
    setFunctionalCheck({ ...(repair.functionalCheck || {}) });
    setTransferConfig(loadTransferConfig(repair.ownerId));
  }, [repair]);

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
  const detailWork = parseWorkDetailAndMedia(repair.workDetail);
  const editPendingBalance = Math.max(0, Number(price || 0) - Number(deposit || 0));
  const trackingUrl = buildTrackingUrl(repair.trackingCode, profile?.trackingBaseUrl);

  const cleanPhoneForWa = (repair.clientPhone || '').replace(/[^\d]/g, '');
  const whatsappMessage = encodeURIComponent(
    `Hola ${repair.clientName}, te escribimos de ${
      profile?.brandName || 'TH3 BNB Servicio Técnico'
    }. Tu ${repair.brand} ${repair.model} (Orden ${repair.code}) está en estado: ${
      statusMeta.label
    } (${repair.progress}%). Podés seguir el estado acá: ${trackingUrl}`
  );
  const whatsappHref = cleanPhoneForWa
    ? `https://wa.me/${cleanPhoneForWa}?text=${whatsappMessage}`
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
    setSaving(true);
    try {
      const budget = Math.max(0, Number(price || 0));
      const advance = Math.max(0, Number(deposit || 0));
      const existingPaidStatus =
        repair.paymentStatus && repair.paymentStatus.startsWith('pagado')
          ? repair.paymentStatus
          : 'pagado';
      const paymentStatus =
        budget === 0
          ? 'pendiente'
          : advance >= budget
          ? existingPaidStatus
          : advance > 0
          ? 'parcial'
          : 'pendiente';
      const cleanName = clampStr(clientName || repair.clientName, 160) || repair.clientName;
      const combinedWorkDetail = serializeWorkDetailAndMedia(workDetail, mediaItems);
      const nowIso = new Date().toISOString();

      await updateRow(
        'repairs',
        repair.id,
        stripUndefined({
          status,
          progress,
          notes: clampStr(notes, 2000),
          clientName: cleanName,
          clientPhone: clampStr(clientPhone, 60),
          clientDni: clampStr(clientDni, 40),
          clientEmail: clampStr(clientEmail, 200),
          clientAddress: clampStr(clientAddress, 240),
          price: budget,
          deposit: advance,
          paidAmount: advance,
          paymentStatus,
          workDetail: combinedWorkDetail,
          checkoutState: clampStr(checkoutState, 500),
          physicalCheck,
          functionalCheck,
          updatedAt: nowIso,
        })
      );

      if (repair.trackingCode) {
        const ticket = await fetchPublicTicketByCode<{ id: string }>(repair.trackingCode);
        if (ticket) {
          await updateRow(
            'public_tickets',
            repair.trackingCode,
            stripUndefined({
              status,
              progress,
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
              progress,
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
            phone: clampStr(clientPhone, 60),
            dni: clampStr(clientDni, 40),
            email: clampStr(clientEmail, 200),
            address: clampStr(clientAddress, 240),
          })
        );
      }

      notify('Reparación actualizada.');
      setTab('detail');
    } catch (err) {
      console.error(err);
      notify('No se pudieron guardar los cambios.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const syncMediaToTracking = async (nextMedia: TechMediaItem[], successMessage: string) => {
    setSendingMedia(true);
    try {
      const combinedWorkDetail = serializeWorkDetailAndMedia(workDetail, nextMedia);
      const nowIso = new Date().toISOString();
      await updateRow('repairs', repair.id, {
        workDetail: combinedWorkDetail,
        updatedAt: nowIso,
      });
      if (repair.trackingCode) {
        const ticket = await fetchPublicTicketByCode<{ id: string }>(repair.trackingCode);
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
      console.error(err);
      notify('No se pudo actualizar el seguimiento en línea.', 'error');
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
        if (file.size > 12 * 1024 * 1024) {
          notify(`"${file.name}" supera 12 MB.`, 'error');
          continue;
        }
        const compressed = await compressPhotoForTracking(file);
        created.push({
          id: createMediaId(),
          type: 'image',
          url: compressed,
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
      setMediaItems((prev) => [
        ...prev,
        {
          id: createMediaId(),
          type: 'video',
          url: dataUrl,
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
    const trimmed = mediaLinkUrl.trim();
    if (!trimmed) return;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        notify('Ingresá una URL válida que empiece con https://', 'error');
        return;
      }
    } catch {
      notify('El enlace ingresado no es válido.', 'error');
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
        url: trimmed,
        createdAt: Date.now(),
      },
    ]);
    setMediaLinkUrl('');
    setShowLinkInput(false);
    notify('Enlace agregado. Tocá "Enviar al seguimiento" o "Guardar cambios".');
  };

  const handleRegisterFullPayment = async () => {
    const budget = Math.max(0, Number(repair.price || 0));
    if (budget <= 0) {
      notify('Definí un presupuesto mayor a 0 en la pestaña Técnico antes de cobrar.', 'error');
      return;
    }
    setPaying(true);
    setDeposit(String(budget));
    const nowIso = new Date().toISOString();
    const nextPaymentStatus = `pagado:${paymentMethod}`;
    try {
      await updateRow('repairs', repair.id, {
        deposit: budget,
        paidAmount: budget,
        paymentStatus: nextPaymentStatus,
        updatedAt: nowIso,
      });

      if (repair.trackingCode) {
        const ticket = await fetchPublicTicketByCode<{ id: string }>(repair.trackingCode);
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
      console.error(err);
      notify('No se pudo registrar el pago.', 'error');
    } finally {
      setPaying(false);
    }
  };

  const handleUploadTransferQr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      notify('La imagen del QR no puede superar 1,5 MB.', 'error');
      return;
    }
    try {
      const compressed = await compressImageToDataUrl(file, 420, 0.9);
      const nextCfg = { ...transferConfig, qrImageDataUrl: compressed };
      setTransferConfig(nextCfg);
      saveTransferConfig(repair.ownerId, nextCfg);
      notify('Imagen QR guardada.');
    } catch {
      notify('No se pudo cargar la imagen del QR.', 'error');
    }
  };

  const handleSaveTransferConfig = () => {
    saveTransferConfig(repair.ownerId, transferConfig);
    setEditingTransferConfig(false);
    notify('Datos de transferencia guardados.');
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
        const ticket = await fetchPublicTicketByCode<{ id: string }>(repair.trackingCode);
        if (ticket) {
          await deleteRow('public_tickets', repair.trackingCode);
        }
      }

      notify(`Orden ${repair.code} eliminada.`);
      onClose();
    } catch (err) {
      console.error(err);
      notify('No se pudo eliminar la reparación.', 'error');
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
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold ${statusMeta.badgeClass}`}
                    >
                      {statusMeta.label}
                    </span>
                    <span className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                      {repair.progress}%
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-right">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Presupuesto</div>
                    <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                      {formatCurrency(repair.price)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Seña</div>
                    <div className="font-mono-num text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(repair.deposit)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Pendiente</div>
                    <div className="font-mono-num text-sm font-bold text-[#0072BB] dark:text-sky-400">
                      {formatCurrency(pendingBalance)}
                    </div>
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
                                {formatCurrency(pendingBalance)}
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
                        : `Registrar pago (${formatCurrency(pendingBalance)}) · ${PAYMENT_METHOD_LABELS[paymentMethod]}`}
                    </button>
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
                      const embedUrl = item.type === 'video' ? getEmbedVideoUrl(item.url) : null;
                      const isDirectVideo =
                        item.type === 'video' &&
                        (item.url.startsWith('data:video/') ||
                          /\.(mp4|webm|mov|m4v|ogg)(\?.*)?$/i.test(item.url));
                      return (
                        <div
                          key={item.id}
                          className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40"
                        >
                          {item.type === 'image' ? (
                            <button
                              type="button"
                              onClick={() => setLightboxImage(item.url)}
                              className="block w-full overflow-hidden text-left"
                            >
                              <img
                                src={item.url}
                                alt={item.caption || 'Foto técnica'}
                                className="h-40 w-full object-cover transition hover:opacity-90"
                              />
                            </button>
                          ) : embedUrl ? (
                            <div className="aspect-video w-full bg-black">
                              <iframe
                                src={embedUrl}
                                title={item.caption || 'Video técnico'}
                                className="h-full w-full"
                                allowFullScreen
                              />
                            </div>
                          ) : isDirectVideo ? (
                            <video
                              src={item.url}
                              controls
                              playsInline
                              preload="metadata"
                              className="h-40 w-full bg-black object-contain"
                            />
                          ) : (
                            <a
                              href={item.url}
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
                          )}
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
                    const embedUrl = item.type === 'video' ? getEmbedVideoUrl(item.url) : null;
                    const isDirectVideo =
                      item.type === 'video' &&
                      (item.url.startsWith('data:video/') ||
                        /\.(mp4|webm|mov|m4v|ogg)(\?.*)?$/i.test(item.url));
                    return (
                      <div
                        key={item.id}
                        className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                      >
                        <div className="relative">
                          {item.type === 'image' ? (
                            <button
                              type="button"
                              onClick={() => setLightboxImage(item.url)}
                              className="block w-full overflow-hidden text-left"
                            >
                              <img
                                src={item.url}
                                alt={item.caption || 'Foto adjunta'}
                                className="h-36 w-full object-cover"
                              />
                            </button>
                          ) : embedUrl ? (
                            <div className="aspect-video w-full bg-black">
                              <iframe
                                src={embedUrl}
                                title={item.caption || 'Video adjunto'}
                                className="h-full w-full"
                                allowFullScreen
                              />
                            </div>
                          ) : isDirectVideo ? (
                            <video
                              src={item.url}
                              controls
                              playsInline
                              preload="metadata"
                              className="h-36 w-full bg-black object-contain"
                            />
                          ) : (
                            <a
                              href={item.url}
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
                          )}

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

            <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Presupuesto y pagos
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Presupuesto</label>
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
                  <label className="mb-1 block text-xs text-slate-500">Anticipo / Pagado</label>
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
                    value={formatCurrency(editPendingBalance)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono-num text-sm font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white"
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
