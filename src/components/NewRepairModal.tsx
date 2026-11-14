import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, UserCheck } from 'lucide-react';
import {
  clampStr,
  generateDocId,
  stripUndefined,
  updateRow,
  upsertRow,
} from '../lib/db';
import {
  BRAND_LIST,
  CAPACITY_OPTIONS,
  DEVICE_OPTIONS,
  MODELS_BY_BRAND,
  STATUS_META,
} from '../data/catalog';
import type {
  ClientRecord,
  DeviceType,
  ProductRecord,
  RepairRecord,
  RepairStatus,
  WorkshopProfile,
} from '../types/workshop';
import {
  formatCurrency,
  generateRepairCode,
  generateTrackingCode,
  todayISO,
} from '../utils/formatters';
import { getFunctionalCheckFields, getPhysicalCheckFields } from '../utils/checkFields';
import { ModalShell } from './ModalShell';
import { PatternLock } from './PatternLock';
import { useToast } from './ToastProvider';

interface NewRepairModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (repair: RepairRecord) => void;
  ownerId: string;
  profile?: WorkshopProfile | null;
  clients: ClientRecord[];
  repairs: RepairRecord[];
  products: ProductRecord[];
  preselectedClient?: ClientRecord | null;
}

const DEFAULT_ACCESSORIES = [
  'Caja',
  'Cargador',
  'Cable',
  'Chip',
  'Funda',
  'Memoria SD',
  'Vidrio',
  'Otro',
];
const NOTEBOOK_ACCESSORIES = [
  'Cargador / Fuente',
  'Cable poder',
  'Funda / Mochila',
  'Mouse',
  'Adaptador / Dongle',
  'Caja',
  'Otro',
];
const NOTEBOOK_BRAND_SUGGESTIONS = [
  'Lenovo',
  'HP',
  'Dell',
  'Asus',
  'Acer',
  'Apple (MacBook)',
  'Banghó',
  'Exo',
  'Noblex',
  'Samsung',
  'MSI',
  'Toshiba',
  'Positivo BGH',
  'Genérico',
];
const NOTEBOOK_MODEL_SUGGESTIONS = [
  'IdeaPad / ThinkPad',
  'HP 15 / Pavilion / Victus',
  'Dell Inspiron / Latitude',
  'Asus VivoBook / TUF / ROG',
  'Acer Aspire / Nitro',
  'MacBook Air / Pro',
  'Exo Smart / Banghó Max',
];
const NOTEBOOK_STORAGE_OPTIONS = [
  '240 / 256 GB SSD',
  '480 / 512 GB SSD',
  '1 TB SSD / HDD',
  '120 / 128 GB SSD',
  '500 GB HDD',
  '64 GB eMMC',
  'Sin disco',
  'No indica',
];
const PC_ACCESSORIES = [
  'Cable poder',
  'Cable HDMI / VGA',
  'Teclado',
  'Mouse',
  'Monitor',
  'Otro',
];
const SPEAKER_ACCESSORIES = [
  'Cargador',
  'Cable USB / Tipo C',
  'Cable poder (220V)',
  'Cable Auxiliar',
  'Micrófono',
  'Control remoto',
  'Caja',
  'Otro',
];
const SPEAKER_BRAND_SUGGESTIONS = [
  'JBL',
  'Sony',
  'Marshall',
  'Bose',
  'Xiaomi',
  'Philips',
  'Noblex',
  'Philco',
  'Aiwa',
  'Stromberg',
  'Logitech',
  'Genérico',
];
const SPEAKER_FORMAT_OPTIONS = [
  'Portátil Bluetooth',
  'Torre / Bafle',
  'Barra de sonido',
  'Subwoofer / Auto',
  'Parlante inteligente',
  'Otro',
];
const CONSOLE_BRAND_SUGGESTIONS = [
  'Sony PlayStation',
  'Microsoft Xbox',
  'Nintendo',
  'Logitech',
  'Redragon',
  'Razer',
  'Genérico',
];
const CONSOLE_MODEL_SUGGESTIONS = [
  'PlayStation 5',
  'DualSense (PS5)',
  'PlayStation 4',
  'DualShock 4 (PS4)',
  'PlayStation 3',
  'Xbox Series X / S',
  'Xbox One',
  'Xbox 360',
  'Nintendo Switch',
  'Joy-Con / Pro Controller',
];
const CONSOLE_EDITION_OPTIONS = [
  'Joystick / Control',
  'Consola · 500 GB',
  'Consola · 825 GB / 1 TB',
  'Consola · 2 TB',
  'Consola · Digital (sin lectora)',
  'Consola · Con lectora',
  'Portátil (Switch / PSP)',
  'Otro',
];
const SMARTWATCH_ACCESSORIES = [
  'Cargador magnético',
  'Cable USB',
  'Malla / Correa',
  'Protector / Case',
  'Caja',
  'Otro',
];
const SMARTWATCH_BRAND_SUGGESTIONS = [
  'Apple',
  'Samsung',
  'Xiaomi',
  'Amazfit',
  'Huawei',
  'Garmin',
  'Haylou',
  'Colmi',
  'Genérico',
];
const SMARTWATCH_MODEL_SUGGESTIONS = [
  'Apple Watch SE / Series',
  'Apple Watch Ultra',
  'Galaxy Watch 4 / 5 / 6',
  'Xiaomi Watch / Mi Band',
  'Amazfit GTS / GTR / Bip',
  'Huawei Watch GT / Fit',
  'Genérico (T500 / W26 / HK9)',
];
const SMARTWATCH_SIZE_OPTIONS = [
  '38 / 40 mm',
  '41 / 42 mm',
  '44 / 45 mm',
  '46 / 47 mm',
  '49 mm (Ultra)',
  'Redondo estándar',
  'Rectangular estándar',
  'Otro',
];
const HEADPHONES_ACCESSORIES = [
  'Estuche de carga',
  'Cable USB / Tipo C',
  'Cable Auxiliar 3.5mm',
  'Almohadillas extra',
  'Adaptador / Dongle',
  'Caja',
  'Otro',
];
const HEADPHONES_BRAND_SUGGESTIONS = [
  'Apple',
  'Samsung',
  'Sony',
  'JBL',
  'Xiaomi',
  'Beats',
  'HyperX',
  'Logitech',
  'Redragon',
  'QCY',
  'Soundpeats',
  'Genérico',
];
const HEADPHONES_MODEL_SUGGESTIONS = [
  'AirPods / AirPods Pro',
  'Galaxy Buds',
  'JBL Tune / Wave',
  'Sony WH / WF',
  'Redmi Buds',
  'QCY T13 / HT05',
  'Vincha Gamer',
];
const HEADPHONES_FORMAT_OPTIONS = [
  'In-ear TWS (Bluetooth)',
  'Vincha Bluetooth (Over/On-ear)',
  'Vincha Gamer (Cable / USB)',
  'Deportivos (Band / Neck)',
  'Cableados 3.5mm / Tipo C',
  'Otro',
];

export const NewRepairModal: React.FC<NewRepairModalProps> = ({
  open,
  onClose,
  onCreated,
  ownerId,
  profile,
  clients,
  repairs,
  products,
  preselectedClient,
}) => {
  const { notify } = useToast();
  const [step, setStep] = useState<'device' | 'details'>('device');
  const [deviceType, setDeviceType] = useState<DeviceType | ''>('');
  const [deviceIcon, setDeviceIcon] = useState('📱');

  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientDni, setClientDni] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');

  const [brand, setBrand] = useState('Samsung');
  const [customBrand, setCustomBrand] = useState('');
  const [modelSelect, setModelSelect] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [color, setColor] = useState('');
  const [capacity, setCapacity] = useState('128 GB');
  const [imei, setImei] = useState('');

  const [problem, setProblem] = useState('');
  const [priority, setPriority] = useState<'alta' | 'media' | 'baja'>('media');
  const [dateIn, setDateIn] = useState(todayISO());
  const [dateEst, setDateEst] = useState('');
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const [price, setPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const [status, setStatus] = useState<RepairStatus>('recibido');

  const [accessories, setAccessories] = useState<string[]>([]);
  const [consoleAcc, setConsoleAcc] = useState<Record<string, string>>({
    'Joystick 1': 'No',
    'Joystick 2': 'No',
    'Cable HDMI': 'No',
    'Cable de poder': 'No',
    'Cable USB / Carga': 'No',
    'Fuente / Transformador': 'No',
  });
  const [physicalCheck, setPhysicalCheck] = useState<Record<string, string>>({});
  const [functionalCheck, setFunctionalCheck] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  const [securityTab, setSecurityTab] = useState<'pin' | 'pattern'>('pin');
  const [securityPin, setSecurityPin] = useState('');
  const [securityPattern, setSecurityPattern] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const spareParts = useMemo(
    () => products.filter((p) => p.category === 'Repuesto'),
    [products]
  );

  const selectedPartsTotal = useMemo(
    () =>
      spareParts
        .filter((p) => selectedPartIds.includes(p.id))
        .reduce((sum, p) => sum + Math.max(0, Number(p.price || 0)), 0),
    [spareParts, selectedPartIds]
  );

  useEffect(() => {
    if (!open) return;
    setStep('device');
    setDeviceType('');
    setDeviceIcon('📱');
    if (preselectedClient) {
      setClientId(preselectedClient.id);
      setClientName(preselectedClient.name);
      setClientPhone(preselectedClient.phone || '');
      setClientDni(preselectedClient.dni || '');
      setClientEmail(preselectedClient.email || '');
      setClientAddress(preselectedClient.address || '');
    } else {
      setClientId('');
      setClientName('');
      setClientPhone('');
      setClientDni('');
      setClientEmail('');
      setClientAddress('');
    }
    setBrand('Samsung');
    setCustomBrand('');
    setModelSelect('');
    setCustomModel('');
    setColor('');
    setCapacity('128 GB');
    setImei('');
    setProblem('');
    setPriority('media');
    setDateIn(todayISO());
    setDateEst('');
    setSelectedPartIds([]);
    setPrice('');
    setDeposit('');
    setStatus('recibido');
    setAccessories([]);
    setConsoleAcc({
      'Joystick 1': 'No',
      'Joystick 2': 'No',
      'Cable HDMI': 'No',
      'Cable de poder': 'No',
      'Cable USB / Carga': 'No',
      'Fuente / Transformador': 'No',
    });
    setPhysicalCheck({});
    setFunctionalCheck({});
    setNotes('');
    setSecurityTab('pin');
    setSecurityPin('');
    setSecurityPattern([]);
  }, [open, preselectedClient]);

  const isNotebookOrCustom =
    deviceType === 'Notebook' ||
    deviceType === 'PC de escritorio' ||
    deviceType === 'Parlante' ||
    deviceType === 'Consola / joystick' ||
    deviceType === 'Smartwatch' ||
    deviceType === 'Auriculares' ||
    deviceType === 'Otros equipos';

  const isConsole = deviceType === 'Consola / joystick';
  const isNotebook = deviceType === 'Notebook';
  const isDesktopPc = deviceType === 'PC de escritorio';
  const isSpeaker = deviceType === 'Parlante';
  const isSmartwatch = deviceType === 'Smartwatch';
  const isHeadphones = deviceType === 'Auriculares';
  const showCapacity =
    deviceType === 'Celular' || deviceType === 'Tablet' || deviceType === 'Smartwatch';

  const manualBudget = Math.max(0, Number(price || 0));
  const totalBudget = manualBudget + selectedPartsTotal;
  const pendingBalance = Math.max(0, totalBudget - Math.max(0, Number(deposit || 0)));

  const physicalFields = useMemo(() => getPhysicalCheckFields(deviceType), [deviceType]);

  const functionalFields = useMemo(() => getFunctionalCheckFields(deviceType), [deviceType]);

  const handleSelectExistingClient = (selectedId: string) => {
    setClientId(selectedId);
    const found = clients.find((c) => c.id === selectedId);
    if (found) {
      setClientName(found.name);
      setClientPhone(found.phone || '');
      setClientDni(found.dni || '');
      setClientEmail(found.email || '');
      setClientAddress(found.address || '');
    }
  };

  const togglePart = (part: ProductRecord) => {
    setSelectedPartIds((prev) =>
      prev.includes(part.id) ? prev.filter((idVal) => idVal !== part.id) : [...prev, part.id]
    );
  };

  const toggleAccessory = (acc: string) => {
    setAccessories((prev) =>
      prev.includes(acc) ? prev.filter((a) => a !== acc) : [...prev, acc]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceType) {
      notify('Seleccioná un tipo de equipo.', 'error');
      return;
    }
    if (!clientName.trim()) {
      notify('Ingresá el nombre del cliente.', 'error');
      return;
    }

    const finalBrand = isNotebookOrCustom
      ? customBrand.trim() || 'Genérico'
      : brand === 'Otro'
      ? customBrand.trim() || 'Otro'
      : brand;

    const finalModel = isNotebookOrCustom
      ? customModel.trim() || deviceType
      : modelSelect === 'Otro modelo' || !modelSelect
      ? customModel.trim() || modelSelect || deviceType
      : modelSelect;

    if (!problem.trim()) {
      notify('Describí el problema reportado del equipo.', 'error');
      return;
    }

    setSaving(true);
    try {
      const repairId = generateDocId('repairs');
      const repairCode = clampStr(generateRepairCode(repairs), 40);
      const trackingCode = clampStr(generateTrackingCode(), 40);
      const budget = totalBudget;
      const advance = Math.max(0, Number(deposit || 0));
      const selectedParts = products.filter((p) => selectedPartIds.includes(p.id)).slice(0, 30);

      let resolvedClientId = clientId;

      if (!resolvedClientId) {
        const matched = clients.find(
          (c) => c.name.trim().toLowerCase() === clientName.trim().toLowerCase()
        );
        if (matched) {
          resolvedClientId = matched.id;
        } else {
          resolvedClientId = generateDocId('clients');
          await upsertRow(
            'clients',
            stripUndefined({
              id: resolvedClientId,
              ownerId,
              name: clampStr(clientName, 160),
              phone: clampStr(clientPhone, 60),
              dni: clampStr(clientDni, 40),
              email: clampStr(clientEmail, 200),
              address: clampStr(clientAddress, 240),
            })
          );
        }
      }

      const defaultProgress = STATUS_META[status]?.defaultProgress ?? 15;
      const paymentStatus =
        budget === 0 ? 'pendiente' : advance >= budget ? 'pagado' : advance > 0 ? 'parcial' : 'pendiente';
      const cleanBrand = clampStr(finalBrand, 80) || 'Genérico';
      const cleanModel = clampStr(finalModel, 120) || deviceType;
      const cleanProblem = clampStr(problem, 2000);
      const cleanDateIn = clampStr(dateIn || todayISO(), 40);
      const cleanDateEst = clampStr(dateEst, 40);

      const repairPayload: Omit<RepairRecord, 'id' | 'createdAt' | 'updatedAt'> = {
        ownerId,
        code: repairCode,
        trackingCode,
        clientId: clampStr(resolvedClientId, 128),
        clientName: clampStr(clientName, 160),
        clientPhone: clampStr(clientPhone, 60),
        clientDni: clampStr(clientDni, 40),
        clientEmail: clampStr(clientEmail, 200),
        clientAddress: clampStr(clientAddress, 240),
        deviceType: clampStr(deviceType, 60),
        deviceIcon: clampStr(deviceIcon, 16),
        brand: cleanBrand,
        model: cleanModel,
        color: clampStr(color, 60),
        capacity:
          showCapacity || isSpeaker || isConsole || isHeadphones || isNotebook
            ? clampStr(capacity, 40)
            : '',
        imei: clampStr(imei, 80),
        problem: cleanProblem,
        priority,
        status,
        progress: defaultProgress,
        dateIn: cleanDateIn,
        dateEst: cleanDateEst,
        price: budget,
        deposit: advance,
        paidAmount: advance,
        paymentStatus,
        partIds: selectedParts.map((p) => p.id),
        partNames: selectedParts.map((p) => p.name),
        accessories: isConsole ? [] : accessories.slice(0, 30),
        consoleAccessories: isConsole ? consoleAcc : undefined,
        physicalCheck,
        functionalCheck,
        securityType:
          securityTab === 'pattern' && securityPattern.length > 0
            ? 'pattern'
            : securityPin.trim()
            ? 'pin'
            : 'none',
        securityPin: securityTab === 'pin' ? clampStr(securityPin, 80) : '',
        securityPattern: securityTab === 'pattern' ? securityPattern.slice(0, 9) : [],
        notes: clampStr(notes, 2000),
        workDetail: '',
        checkoutState: '',
      };

      const nowIso = new Date().toISOString();

      await upsertRow(
        'repairs',
        stripUndefined({
          id: repairId,
          ...repairPayload,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
      );

      await upsertRow(
        'public_tickets',
        stripUndefined({
          id: trackingCode,
          ownerId,
          repairId,
          trackingCode,
          repairCode,
          businessName: clampStr(profile?.brandName || 'TH3 BNB Servicio Técnico', 80) || 'TH3 BNB Servicio Técnico',
          businessPhone: clampStr(profile?.businessPhone, 50),
          deviceType: clampStr(deviceType, 60),
          brand: cleanBrand,
          model: cleanModel,
          status,
          progress: defaultProgress,
          dateIn: cleanDateIn,
          dateEst: cleanDateEst,
          problemSummary: cleanProblem,
          workDetail: '',
          price: budget,
          deposit: advance,
          updatedAt: nowIso,
        })
      );

      // Deduct stock for used spare parts if trackStock is enabled
      for (const part of selectedParts) {
        if (part.trackStock && part.stock > 0) {
          await updateRow('products', part.id, {
            stock: Math.max(0, part.stock - 1),
          });
        }
      }

      notify(`Reparación ${repairCode} registrada con éxito.`);
      const nowMs = Date.now();
      const createdRepair: RepairRecord = {
        id: repairId,
        ...repairPayload,
        createdAt: nowMs,
        updatedAt: nowMs,
      };
      onClose();
      onCreated?.(createdRepair);
    } catch (err) {
      console.error(err);
      notify('No se pudo guardar la reparación.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Nueva reparación"
      subtitle={
        step === 'device'
          ? 'Paso 1 de 2 · Seleccioná el tipo de equipo'
          : `Paso 2 de 2 · ${deviceIcon} ${deviceType}`
      }
      maxWidth="3xl"
    >
      {step === 'device' ? (
        <div className="space-y-6">
          <div>
            <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
              ¿Qué equipo querés arreglar?
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {DEVICE_OPTIONS.map((opt) => {
                const selected = deviceType === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      if (deviceType !== opt.type) {
                        setAccessories([]);
                        setPhysicalCheck({});
                        setFunctionalCheck({});
                        setCapacity(
                          opt.type === 'Parlante'
                            ? 'Portátil Bluetooth'
                            : opt.type === 'Consola / joystick'
                              ? 'Consola · 500 GB'
                              : opt.type === 'Smartwatch'
                                ? '44 / 45 mm'
                                : opt.type === 'Auriculares'
                                  ? 'In-ear TWS (Bluetooth)'
                                  : opt.type === 'Notebook'
                                    ? '240 / 256 GB SSD'
                                    : '128 GB'
                        );
                      }
                      setDeviceType(opt.type);
                      setDeviceIcon(opt.icon);
                    }}
                    className={`flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-2xl border p-4 text-center transition ${
                      selected
                        ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] ring-2 ring-[#0072BB]/20 dark:border-sky-400 dark:bg-sky-950/50 dark:text-sky-300'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="text-2xl">{opt.icon}</span>
                    <span className="text-xs font-semibold">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!deviceType}
              onClick={() => setStep('details')}
              className="h-11 rounded-xl bg-[#0072BB] px-6 text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Continuar
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex items-center justify-between rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-3 dark:border-sky-900/60 dark:bg-sky-950/30">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">{deviceIcon}</span>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Equipo seleccionado</div>
                <div className="text-sm font-bold text-slate-900 dark:text-white">{deviceType}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStep('device')}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-[#0072BB] hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Cambiar tipo
            </button>
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                Datos del cliente
              </h3>
              {clients.length > 0 && (
                <div className="flex items-center gap-2">
                  <UserCheck className="h-3.5 w-3.5 text-slate-400" />
                  <select
                    value={clientId}
                    onChange={(e) => handleSelectExistingClient(e.target.value)}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="">Cliente nuevo / elegir existente...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Nombre completo *
                </label>
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => {
                    setClientName(e.target.value);
                    if (clientId) setClientId('');
                  }}
                  placeholder="Nombre completo"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Teléfono
                </label>
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="11-1234-5678"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  DNI
                </label>
                <input
                  type="text"
                  value={clientDni}
                  onChange={(e) => setClientDni(e.target.value)}
                  placeholder="DNI"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Email
                </label>
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Dirección
                </label>
                <input
                  type="text"
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  placeholder="Dirección"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
              Datos del equipo
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Marca
                </label>
                {isNotebookOrCustom ? (
                  <>
                    <input
                      type="text"
                      list={
                        isSpeaker
                          ? 'speaker-brands-datalist'
                          : isConsole
                            ? 'console-brands-datalist'
                            : isSmartwatch
                              ? 'smartwatch-brands-datalist'
                              : isHeadphones
                                ? 'headphones-brands-datalist'
                                : isNotebook
                                  ? 'notebook-brands-datalist'
                                  : undefined
                      }
                      value={customBrand}
                      onChange={(e) => setCustomBrand(e.target.value)}
                      placeholder={
                        isSpeaker
                          ? 'Ej: JBL, Sony, Noblex, Philips...'
                          : isConsole
                            ? 'Ej: Sony PlayStation, Xbox, Nintendo...'
                            : isSmartwatch
                              ? 'Ej: Apple, Samsung, Xiaomi, Amazfit...'
                              : isHeadphones
                                ? 'Ej: Apple, JBL, Sony, Xiaomi, HyperX...'
                                : isNotebook
                                  ? 'Ej: Lenovo, HP, Dell, Asus, MacBook...'
                                  : `Marca de ${deviceType}`
                      }
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    {isSpeaker && (
                      <datalist id="speaker-brands-datalist">
                        {SPEAKER_BRAND_SUGGESTIONS.map((b) => (
                          <option key={b} value={b} />
                        ))}
                      </datalist>
                    )}
                    {isConsole && (
                      <datalist id="console-brands-datalist">
                        {CONSOLE_BRAND_SUGGESTIONS.map((b) => (
                          <option key={b} value={b} />
                        ))}
                      </datalist>
                    )}
                    {isSmartwatch && (
                      <datalist id="smartwatch-brands-datalist">
                        {SMARTWATCH_BRAND_SUGGESTIONS.map((b) => (
                          <option key={b} value={b} />
                        ))}
                      </datalist>
                    )}
                    {isHeadphones && (
                      <datalist id="headphones-brands-datalist">
                        {HEADPHONES_BRAND_SUGGESTIONS.map((b) => (
                          <option key={b} value={b} />
                        ))}
                      </datalist>
                    )}
                    {isNotebook && (
                      <datalist id="notebook-brands-datalist">
                        {NOTEBOOK_BRAND_SUGGESTIONS.map((b) => (
                          <option key={b} value={b} />
                        ))}
                      </datalist>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={brand}
                      onChange={(e) => {
                        setBrand(e.target.value);
                        setModelSelect('');
                      }}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      {BRAND_LIST.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    {brand === 'Otro' && (
                      <input
                        type="text"
                        value={customBrand}
                        onChange={(e) => setCustomBrand(e.target.value)}
                        placeholder="Especificar marca"
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Modelo
                </label>
                {isNotebookOrCustom ? (
                  <>
                    <input
                      type="text"
                      list={
                        isConsole
                          ? 'console-models-datalist'
                          : isSmartwatch
                            ? 'smartwatch-models-datalist'
                            : isHeadphones
                              ? 'headphones-models-datalist'
                              : isNotebook
                                ? 'notebook-models-datalist'
                                : undefined
                      }
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      placeholder={
                        isSpeaker
                          ? 'Ej: Flip 6, Charge 5, Torre 15"...'
                          : isConsole
                            ? 'Ej: PS4 Slim, PS5, DualSense, Xbox Series S...'
                            : isSmartwatch
                              ? 'Ej: Watch Series 8, Galaxy Watch 5, Amazfit GTS...'
                              : isHeadphones
                                ? 'Ej: AirPods Pro, Galaxy Buds, JBL Tune 510...'
                                : isNotebook
                                  ? 'Ej: IdeaPad 3, Pavilion 15, Inspiron, MacBook Air...'
                                  : `Modelo de ${deviceType}`
                      }
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    {isConsole && (
                      <datalist id="console-models-datalist">
                        {CONSOLE_MODEL_SUGGESTIONS.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    )}
                    {isSmartwatch && (
                      <datalist id="smartwatch-models-datalist">
                        {SMARTWATCH_MODEL_SUGGESTIONS.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    )}
                    {isHeadphones && (
                      <datalist id="headphones-models-datalist">
                        {HEADPHONES_MODEL_SUGGESTIONS.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    )}
                    {isNotebook && (
                      <datalist id="notebook-models-datalist">
                        {NOTEBOOK_MODEL_SUGGESTIONS.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={modelSelect}
                      onChange={(e) => setModelSelect(e.target.value)}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="">Seleccioná un modelo</option>
                      {(MODELS_BY_BRAND[brand] || ['Otro modelo']).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    {(modelSelect === 'Otro modelo' || !modelSelect) && (
                      <input
                        type="text"
                        value={customModel}
                        onChange={(e) => setCustomModel(e.target.value)}
                        placeholder="O escribí el modelo exacto"
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Color
                </label>
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="Negro / Blanco"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {(showCapacity || isSpeaker || isConsole || isHeadphones || isNotebook) && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {isSpeaker || isHeadphones
                      ? 'Tipo / Formato'
                      : isConsole
                        ? 'Edición / Capacidad'
                        : isSmartwatch
                          ? 'Medida / Caja'
                          : isNotebook
                            ? 'Almacenamiento'
                            : 'Capacidad'}
                  </label>
                  <select
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {(isSpeaker
                      ? SPEAKER_FORMAT_OPTIONS
                      : isHeadphones
                        ? HEADPHONES_FORMAT_OPTIONS
                        : isConsole
                          ? CONSOLE_EDITION_OPTIONS
                          : isSmartwatch
                            ? SMARTWATCH_SIZE_OPTIONS
                            : isNotebook
                              ? NOTEBOOK_STORAGE_OPTIONS
                              : CAPACITY_OPTIONS
                    ).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div
                className={
                  showCapacity || isSpeaker || isConsole || isHeadphones || isNotebook
                    ? 'sm:col-span-2'
                    : ''
                }
              >
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {deviceType === 'Celular' || deviceType === 'Tablet'
                    ? 'IMEI'
                    : 'Número de serie'}
                </label>
                <input
                  type="text"
                  value={imei}
                  onChange={(e) => setImei(e.target.value)}
                  placeholder="IMEI o número de serie"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
              Falla, prioridad y presupuesto
            </h3>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Problema reportado *
              </label>
              <textarea
                rows={3}
                required
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                placeholder="Describí la falla del equipo"
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Prioridad
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as 'alta' | 'media' | 'baja')}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Fecha de ingreso
                </label>
                <input
                  type="date"
                  value={dateIn}
                  onChange={(e) => setDateIn(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Entrega estimada
                </label>
                <input
                  type="date"
                  value={dateEst}
                  onChange={(e) => setDateEst(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            {spareParts.length > 0 && (
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span>Repuestos asociados del inventario</span>
                  {selectedPartIds.length > 0 && (
                    <span className="font-mono-num text-[#0072BB] dark:text-sky-300">
                      {selectedPartIds.length}{' '}
                      {selectedPartIds.length === 1 ? 'repuesto' : 'repuestos'} ·{' '}
                      {formatCurrency(selectedPartsTotal)} sumado al total
                    </span>
                  )}
                </div>
                <div className="grid max-h-36 gap-2 overflow-y-auto rounded-xl border border-slate-200 p-2.5 sm:grid-cols-2 dark:border-slate-800">
                  {spareParts.map((part) => {
                    const checked = selectedPartIds.includes(part.id);
                    return (
                      <button
                        key={part.id}
                        type="button"
                        onClick={() => togglePart(part)}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${
                          checked
                            ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-300'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="truncate font-medium">{part.name}</span>
                        <span className="ml-2 flex shrink-0 items-center gap-1.5 font-mono-num">
                          <span>{formatCurrency(part.price)}</span>
                          {checked && <Check className="h-3.5 w-3.5" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Presupuesto
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Anticipo / Seña
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  placeholder="0"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Total pendiente
                </label>
                <input
                  type="text"
                  readOnly
                  value={formatCurrency(pendingBalance)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono-num text-sm font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Estado inicial
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as RepairStatus)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="recibido">Recibido</option>
                  <option value="diagnostico">Diagnóstico</option>
                  <option value="espera_repuesto">Espera repuesto</option>
                  <option value="en_progreso">En progreso</option>
                  <option value="listo">Listo para entregar</option>
                </select>
              </div>
            </div>

            {selectedPartIds.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-slate-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-slate-200">
                <span>
                  Presupuesto (<strong className="font-mono-num">{formatCurrency(manualBudget)}</strong>) +
                  Repuestos (<strong className="font-mono-num">{formatCurrency(selectedPartsTotal)}</strong>)
                </span>
                <span className="font-mono-num font-bold text-[#0072BB] dark:text-sky-300">
                  Total: {formatCurrency(totalBudget)}
                </span>
              </div>
            )}
          </section>

          <section className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
              Accesorios entregados
            </h3>
            {isConsole ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.keys(consoleAcc).map((item) => (
                  <div
                    key={item}
                    className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800"
                  >
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {item}
                    </span>
                    <div className="flex gap-1.5">
                      {['No', 'Sí'].map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            setConsoleAcc((prev) => ({ ...prev, [item]: opt }))
                          }
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                            consoleAcc[item] === opt
                              ? 'bg-[#0072BB] text-white'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(isDesktopPc
                  ? PC_ACCESSORIES
                  : isSpeaker
                    ? SPEAKER_ACCESSORIES
                    : isSmartwatch
                      ? SMARTWATCH_ACCESSORIES
                      : isHeadphones
                        ? HEADPHONES_ACCESSORIES
                        : isNotebook
                          ? NOTEBOOK_ACCESSORIES
                          : DEFAULT_ACCESSORIES
                ).map((acc) => {
                  const active = accessories.includes(acc);
                  return (
                    <button
                      key={acc}
                      type="button"
                      onClick={() => toggleAccessory(acc)}
                      className={`h-9 rounded-xl border px-3 text-xs font-medium transition ${
                        active
                          ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] dark:border-sky-400 dark:bg-sky-950/50 dark:text-sky-300'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {acc}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-4 border-t border-slate-100 pt-5 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
              Check-in · Estado físico y funcional
            </h3>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2.5 rounded-2xl border border-slate-200 p-3.5 dark:border-slate-800">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Estado físico
                </div>
                {physicalFields.map((field) => (
                  <div key={field.key} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-slate-600 dark:text-slate-400">{field.label}</span>
                    <div className="flex flex-wrap gap-1">
                      {field.options.map((opt) => (
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
                            physicalCheck[field.key] === opt
                              ? 'bg-[#0072BB] text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2.5 rounded-2xl border border-slate-200 p-3.5 dark:border-slate-800">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Estado funcional
                </div>
                {functionalFields.map((field) => (
                  <div key={field.key} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-slate-600 dark:text-slate-400">{field.label}</span>
                    <div className="flex flex-wrap gap-1">
                      {field.options.map((opt) => (
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
                            functionalCheck[field.key] === opt
                              ? 'bg-[#0072BB] text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Notas internas o de entrega
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observaciones adicionales..."
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                Seguridad del equipo
              </h3>
              <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setSecurityTab('pin')}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                    securityTab === 'pin'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  PIN / Clave
                </button>
                <button
                  type="button"
                  onClick={() => setSecurityTab('pattern')}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                    securityTab === 'pattern'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  Patrón
                </button>
              </div>
            </div>

            {securityTab === 'pin' ? (
              <input
                type="text"
                value={securityPin}
                onChange={(e) => setSecurityPin(e.target.value)}
                placeholder="PIN, contraseña o sin clave"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            ) : (
              <div className="flex justify-center py-2">
                <PatternLock value={securityPattern} onChange={setSecurityPattern} size={220} />
              </div>
            )}
          </section>

          <div className="flex gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Guardar reparación'}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
};
