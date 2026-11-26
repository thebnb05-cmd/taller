import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Coins,
  Layers,
  Plus,
  QrCode,
  Trash2,
  UserCheck,
} from 'lucide-react';
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
  convertBetweenCurrencies,
  convertFromBaseCurrency,
  convertToBaseCurrency,
  getCurrencyOption,
  getCurrencyRateFromBase,
  sanitizeCurrencyCode,
  useActiveCurrency,
  type CurrencyCode,
} from '../utils/currency';
import {
  formatCurrency,
  generateRepairCode,
  generateTrackingCode,
  todayISO,
} from '../utils/formatters';
import {
  PAYMENT_METHOD_LABELS,
  serializeRepairPaymentStatus,
  type PaymentMethod,
} from '../utils/payment';
import { loadMercadoPagoConfig } from '../utils/mercadoPago';
import { syncRepairToPurchases } from '../utils/mpPurchasesSync';
import { recordRecoveredPayment } from '../utils/paymentLedger';
import {
  appendTimelineEntry,
  createRepairMetaId,
  loadSavedTransferQrIvaPct,
  mergeCheckoutPaymentLedger,
  mergeWorkDetailPublicMeta,
  saveTransferQrIvaPct,
  TRANSFER_QR_IVA_PRESETS,
} from '../utils/repairMeta';
import { parseWorkshopMeta } from '../utils/workshopMeta';
import { appendBatchRefToNotes, generateBatchRef } from '../utils/batchRef';
import { getFunctionalCheckFields, getPhysicalCheckFields } from '../utils/checkFields';
import {
  CLIENT_TYPE_LABELS,
  parseClientMeta,
  serializeClientNotes,
  type ClientType,
} from '../utils/clientMeta';
import {
  isValidEmail,
  parseSafePositiveNumber,
  sanitizeDbErrorMessage,
  sanitizeDni,
  sanitizeEmail,
  sanitizeImei,
  sanitizePhone,
  sanitizePlainLine,
  sanitizeText,
} from '../utils/validation';
import { useI18n } from '../utils/i18n';
import { ModalShell } from './ModalShell';
import { PatternLock } from './PatternLock';
import { useToast } from './ToastProvider';

interface NewRepairModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (repair: RepairRecord) => void;
  onBatchCreated?: (repairs: RepairRecord[], batchRef: string) => void;
  ownerId: string;
  profile?: WorkshopProfile | null;
  clients: ClientRecord[];
  repairs: RepairRecord[];
  products: ProductRecord[];
  preselectedClient?: ClientRecord | null;
  warrantyFromRepair?: RepairRecord | null;
}

interface DraftRepairItem {
  id: string;
  deviceType: DeviceType;
  deviceIcon: string;
  brand: string;
  model: string;
  color: string;
  capacity: string;
  imei: string;
  problem: string;
  priority: 'alta' | 'media' | 'baja';
  dateIn: string;
  dateEst: string;
  selectedPartIds: string[];
  budget: number;
  deposit: number;
  depositMethod: PaymentMethod;
  transferQrIvaPct: number;
  transferQrIvaAmount: number;
  currency: CurrencyCode;
  rate: number;
  status: RepairStatus;
  technician: string;
  warrantyDays: number;
  accessories: string[];
  consoleAcc: Record<string, string>;
  physicalCheck: Record<string, string>;
  functionalCheck: Record<string, string>;
  notes: string;
  securityTab: 'pin' | 'pattern';
  securityPin: string;
  securityPattern: number[];
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
const OTHER_DEVICE_ACCESSORIES = [
  'Cable poder / 220V',
  'Fuente / Transformador',
  'Control remoto',
  'Cables (HDMI / USB / Audio)',
  'Batería / Pilas',
  'Caja / Bolso',
  'Otro',
];
const OTHER_DEVICE_TYPE_SUGGESTIONS = [
  'TV / Smart TV',
  'Monitor',
  'Impresora / Escáner',
  'Router / Módem / Repetidor',
  'Cámara / DVR / Seguridad',
  'Fuente / Cargador',
  'Electrodoméstico pequeño',
  'Herramienta eléctrica',
  'Placa electrónica',
  'Otro equipo',
];
const OTHER_DEVICE_BRAND_SUGGESTIONS = [
  'Samsung',
  'LG',
  'Sony',
  'Philips',
  'HP',
  'Epson',
  'Canon',
  'Brother',
  'TP-Link',
  'Hikvision',
  'Noblex',
  'BGH',
  'Xiaomi',
  'Genérico',
];
const OTHER_DEVICE_MODEL_SUGGESTIONS = [
  'Smart TV 32" / 43" / 50"',
  'Monitor 24" / 27"',
  'Epson L3210 / L3250',
  'Router / Módem WiFi',
  'Cámara IP / DVR',
  'Fuente 12V / 24V',
];

export const NewRepairModal: React.FC<NewRepairModalProps> = ({
  open,
  onClose,
  onCreated,
  onBatchCreated,
  ownerId,
  profile,
  clients,
  repairs,
  products,
  preselectedClient,
  warrantyFromRepair,
}) => {
  const { notify } = useToast();
  const { tr } = useI18n();
  const activeCurrency = useActiveCurrency();
  const workshopMeta = useMemo(() => parseWorkshopMeta(profile), [profile]);
  const baseCurrency: CurrencyCode = profile ? workshopMeta.currency : activeCurrency;
  const secondaryCurrencies = workshopMeta.secondaryCurrencies;
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>(baseCurrency);

  const activeRate = useMemo(
    () => getCurrencyRateFromBase(selectedCurrency, baseCurrency, secondaryCurrencies) ?? 1,
    [selectedCurrency, baseCurrency, secondaryCurrencies]
  );
  const isSecondaryCurrency = selectedCurrency !== baseCurrency && activeRate !== 1;
  const currencySymbol = getCurrencyOption(selectedCurrency).symbol;

  const [step, setStep] = useState<'device' | 'details'>('device');
  const [deviceType, setDeviceType] = useState<DeviceType | ''>('');
  const [deviceIcon, setDeviceIcon] = useState('📱');
  const [queuedItems, setQueuedItems] = useState<DraftRepairItem[]>([]);

  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientAltPhone, setClientAltPhone] = useState('');
  const [clientType, setClientType] = useState<ClientType>('particular');
  const [clientDni, setClientDni] = useState('');
  const [clientCuit, setClientCuit] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientNeighborhood, setClientNeighborhood] = useState('');

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
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>('efectivo');
  const [applyTransferQrIva, setApplyTransferQrIva] = useState(false);
  const [transferQrIvaPct, setTransferQrIvaPct] = useState(() =>
    String(loadSavedTransferQrIvaPct())
  );
  const [ivaTouchedManually, setIvaTouchedManually] = useState(false);
  const [status, setStatus] = useState<RepairStatus>('recibido');
  const [technician, setTechnician] = useState('');
  const [warrantyDays, setWarrantyDays] = useState<number>(0);

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

  const selectedPartsTotalBase = useMemo(
    () =>
      spareParts
        .filter((p) => selectedPartIds.includes(p.id))
        .reduce((sum, p) => sum + Math.max(0, Number(p.price || 0)), 0),
    [spareParts, selectedPartIds]
  );

  const selectedPartsTotalDisplay = useMemo(
    () =>
      isSecondaryCurrency
        ? Math.round(convertFromBaseCurrency(selectedPartsTotalBase, activeRate) * 100) / 100
        : selectedPartsTotalBase,
    [isSecondaryCurrency, selectedPartsTotalBase, activeRate]
  );

  const selectedOutOfStockParts = useMemo(
    () =>
      spareParts.filter(
        (p) =>
          selectedPartIds.includes(p.id) &&
          Boolean(p.trackStock) &&
          Number(p.stock || 0) <= 0
      ),
    [spareParts, selectedPartIds]
  );

  useEffect(() => {
    if (!open) return;
    setSelectedCurrency(baseCurrency);
    setQueuedItems([]);
    setSelectedPartIds([]);
    setPrice('');
    setDeposit('');
    setDepositMethod('efectivo');
    setApplyTransferQrIva(false);
    setTransferQrIvaPct(String(loadSavedTransferQrIvaPct()));
    setIvaTouchedManually(false);
    setStatus('recibido');
    setTechnician('');
    setWarrantyDays(0);
    setDateIn(todayISO());
    setDateEst('');
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

    if (warrantyFromRepair) {
      const matchedClient = warrantyFromRepair.clientId
        ? clients.find((c) => c.id === warrantyFromRepair.clientId)
        : undefined;
      const cMeta = matchedClient ? parseClientMeta(matchedClient) : null;
      const devType = (warrantyFromRepair.deviceType as DeviceType) || 'Celular';
      const iconMatch = DEVICE_OPTIONS.find((d) => d.type === devType)?.icon || warrantyFromRepair.deviceIcon || '📱';

      setStep('details');
      setDeviceType(devType);
      setDeviceIcon(iconMatch);
      setClientId(warrantyFromRepair.clientId || '');
      setClientName(warrantyFromRepair.clientName || '');
      setClientPhone(warrantyFromRepair.clientPhone || '');
      setClientAltPhone(cMeta?.altPhone || '');
      setClientType(cMeta?.clientType || 'particular');
      setClientDni(warrantyFromRepair.clientDni || '');
      setClientCuit(cMeta?.cuit || '');
      setClientEmail(warrantyFromRepair.clientEmail || '');
      setClientAddress(warrantyFromRepair.clientAddress || '');
      setClientNeighborhood(cMeta?.neighborhood || '');

      const rawBrand = warrantyFromRepair.brand || 'Samsung';
      const isKnownBrand = BRAND_LIST.includes(rawBrand);
      setBrand(isKnownBrand ? rawBrand : 'Otro');
      setCustomBrand(rawBrand);

      const rawModel = warrantyFromRepair.model || '';
      const modelOptions = isKnownBrand ? MODELS_BY_BRAND[rawBrand] || [] : [];
      if (modelOptions.includes(rawModel)) {
        setModelSelect(rawModel);
        setCustomModel(rawModel);
      } else {
        setModelSelect('Otro modelo');
        setCustomModel(rawModel);
      }
      setColor(warrantyFromRepair.color || '');
      setCapacity(warrantyFromRepair.capacity || '128 GB');
      setImei(warrantyFromRepair.imei || '');
      setProblem(`Garantía s/orden ${warrantyFromRepair.code}: `);
      setPriority('alta');
      setNotes(`Reingreso por garantía de la orden ${warrantyFromRepair.code}.`);
      return;
    }

    setStep('device');
    setDeviceType('');
    setDeviceIcon('📱');
    if (preselectedClient) {
      const meta = parseClientMeta(preselectedClient);
      setClientId(preselectedClient.id);
      setClientName(preselectedClient.name);
      setClientPhone(preselectedClient.phone || '');
      setClientAltPhone(meta.altPhone);
      setClientType(meta.clientType);
      setClientDni(preselectedClient.dni || '');
      setClientCuit(meta.cuit);
      setClientEmail(preselectedClient.email || '');
      setClientAddress(preselectedClient.address || '');
      setClientNeighborhood(meta.neighborhood);
    } else {
      setClientId('');
      setClientName('');
      setClientPhone('');
      setClientAltPhone('');
      setClientType('particular');
      setClientDni('');
      setClientCuit('');
      setClientEmail('');
      setClientAddress('');
      setClientNeighborhood('');
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
  }, [open, preselectedClient, warrantyFromRepair, baseCurrency, clients]);

  const resetEquipmentFields = () => {
    setDeviceType('');
    setDeviceIcon('📱');
    setBrand('Samsung');
    setCustomBrand('');
    setModelSelect('');
    setCustomModel('');
    setColor('');
    setCapacity('128 GB');
    setImei('');
    setProblem('');
    setSelectedPartIds([]);
    setPrice('');
    setDeposit('');
    setDepositMethod('efectivo');
    setApplyTransferQrIva(false);
    setTransferQrIvaPct(String(loadSavedTransferQrIvaPct()));
    setIvaTouchedManually(false);
    setSelectedCurrency(baseCurrency);
    setStatus('recibido');
    setTechnician('');
    setWarrantyDays(0);
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
  };

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
  const isOtherDevice = deviceType === 'Otros equipos';
  const showCapacity =
    deviceType === 'Celular' || deviceType === 'Tablet' || deviceType === 'Smartwatch';

  const manualBudget = parseSafePositiveNumber(price, 0);
  const subtotalBudgetDisplay = Math.round((manualBudget + selectedPartsTotalDisplay) * 100) / 100;
  const parsedTransferQrIvaPct = Math.max(
    0,
    Math.min(100, parseSafePositiveNumber(transferQrIvaPct, 0))
  );
  const transferQrIvaDisplay =
    applyTransferQrIva && subtotalBudgetDisplay > 0 && parsedTransferQrIvaPct > 0
      ? Math.round(subtotalBudgetDisplay * (parsedTransferQrIvaPct / 100) * 100) / 100
      : 0;
  const totalBudgetDisplay = Math.round((subtotalBudgetDisplay + transferQrIvaDisplay) * 100) / 100;
  const depositDisplay = parseSafePositiveNumber(deposit, 0);
  const pendingBalanceDisplay = Math.max(
    0,
    Math.round((totalBudgetDisplay - depositDisplay) * 100) / 100
  );
  const subtotalBase = isSecondaryCurrency
    ? Math.round(
        (convertToBaseCurrency(manualBudget, activeRate) + selectedPartsTotalBase) * 100
      ) / 100
    : Math.round((manualBudget + selectedPartsTotalBase) * 100) / 100;
  const transferQrIvaBase =
    applyTransferQrIva && subtotalBase > 0 && parsedTransferQrIvaPct > 0
      ? Math.round(subtotalBase * (parsedTransferQrIvaPct / 100) * 100) / 100
      : 0;
  const baseBudget = Math.round((subtotalBase + transferQrIvaBase) * 100) / 100;
  const baseDeposit = isSecondaryCurrency
    ? Math.round(convertToBaseCurrency(depositDisplay, activeRate) * 100) / 100
    : depositDisplay;

  const handleCurrencyChange = (nextRaw: string) => {
    const nextCode = sanitizeCurrencyCode(nextRaw);
    if (nextCode === selectedCurrency) return;
    if (price.trim()) {
      const currentPrice = parseSafePositiveNumber(price, 0);
      if (currentPrice > 0) {
        const converted =
          Math.round(
            convertBetweenCurrencies(
              currentPrice,
              selectedCurrency,
              nextCode,
              baseCurrency,
              secondaryCurrencies
            ) * 100
          ) / 100;
        setPrice(String(converted));
      }
    }
    if (deposit.trim()) {
      const currentDeposit = parseSafePositiveNumber(deposit, 0);
      if (currentDeposit > 0) {
        const convertedDep =
          Math.round(
            convertBetweenCurrencies(
              currentDeposit,
              selectedCurrency,
              nextCode,
              baseCurrency,
              secondaryCurrencies
            ) * 100
          ) / 100;
        setDeposit(String(convertedDep));
      }
    }
    setSelectedCurrency(nextCode);
  };

  const physicalFields = useMemo(() => getPhysicalCheckFields(deviceType), [deviceType]);

  const functionalFields = useMemo(() => getFunctionalCheckFields(deviceType), [deviceType]);

  const handleSelectExistingClient = (selectedId: string) => {
    setClientId(selectedId);
    const found = clients.find((c) => c.id === selectedId);
    if (found) {
      const meta = parseClientMeta(found);
      setClientName(found.name);
      setClientPhone(found.phone || '');
      setClientAltPhone(meta.altPhone);
      setClientType(meta.clientType);
      setClientDni(found.dni || '');
      setClientCuit(meta.cuit);
      setClientEmail(found.email || '');
      setClientAddress(found.address || '');
      setClientNeighborhood(meta.neighborhood);
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

  const buildCurrentDraft = (): DraftRepairItem | null => {
    if (!deviceType) {
      notify('Seleccioná un tipo de equipo.', 'error');
      return null;
    }
    const cleanClientName = sanitizePlainLine(clientName, 160);
    if (!cleanClientName) {
      notify('Ingresá el nombre del cliente.', 'error');
      return null;
    }
    const cleanClientEmail = sanitizeEmail(clientEmail, 200);
    if (cleanClientEmail && !isValidEmail(cleanClientEmail)) {
      notify('El correo electrónico del cliente no es válido.', 'error');
      return null;
    }
    const cleanProblem = sanitizeText(problem, 2000);
    if (!cleanProblem) {
      notify('Describí el problema reportado del equipo.', 'error');
      return null;
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

    return {
      id: generateDocId('draft'),
      deviceType,
      deviceIcon,
      brand: sanitizePlainLine(finalBrand, 80) || 'Genérico',
      model: sanitizePlainLine(finalModel, 120) || deviceType,
      color: sanitizePlainLine(color, 60),
      capacity:
        showCapacity || isSpeaker || isConsole || isHeadphones || isNotebook || isOtherDevice
          ? sanitizePlainLine(capacity, 60)
          : '',
      imei: sanitizeImei(imei, 80),
      problem: cleanProblem,
      priority,
      dateIn: clampStr(dateIn || todayISO(), 40),
      dateEst: clampStr(dateEst, 40),
      selectedPartIds: [...selectedPartIds],
      budget: baseBudget,
      deposit: baseDeposit,
      depositMethod,
      transferQrIvaPct: applyTransferQrIva ? parsedTransferQrIvaPct : 0,
      transferQrIvaAmount: transferQrIvaBase,
      currency: selectedCurrency,
      rate: activeRate,
      status,
      technician: sanitizePlainLine(technician, 60),
      warrantyDays: Math.max(0, Math.min(3650, Math.round(Number(warrantyDays) || 0))),
      accessories: isConsole ? [] : accessories.slice(0, 30),
      consoleAcc: { ...consoleAcc },
      physicalCheck: { ...physicalCheck },
      functionalCheck: { ...functionalCheck },
      notes: sanitizeText(notes, 1800),
      securityTab: isOtherDevice ? 'pin' : securityTab,
      securityPin: isOtherDevice || securityTab === 'pin' ? sanitizePlainLine(securityPin, 80) : '',
      securityPattern: !isOtherDevice && securityTab === 'pattern' ? securityPattern.slice(0, 9) : [],
    };
  };

  const handleAddAnotherDevice = () => {
    if (queuedItems.length >= 30) {
      notify('Máximo 30 equipos por boleta en lote.', 'error');
      return;
    }
    const draft = buildCurrentDraft();
    if (!draft) return;
    const nextCount = queuedItems.length + 1;
    setQueuedItems((prev) => [...prev, draft]);
    resetEquipmentFields();
    setStep('device');
    notify(`Equipo #${nextCount} sumado al lote. Elegí el siguiente equipo para ${sanitizePlainLine(clientName, 80)}.`);
  };

  const handleRemoveQueuedItem = (draftId: string) => {
    setQueuedItems((prev) => prev.filter((item) => item.id !== draftId));
  };

  const saveAllRepairs = async (includeCurrentForm: boolean) => {
    let itemsToSave: DraftRepairItem[] = [...queuedItems];

    if (includeCurrentForm) {
      const currentDraft = buildCurrentDraft();
      if (!currentDraft) return;
      itemsToSave = [...itemsToSave, currentDraft];
    }

    if (itemsToSave.length === 0) {
      notify('Agregá al menos un equipo para guardar.', 'error');
      return;
    }
    const cleanClientName = sanitizePlainLine(clientName, 160);
    if (!cleanClientName) {
      notify('Ingresá el nombre del cliente.', 'error');
      return;
    }
    const cleanClientEmail = sanitizeEmail(clientEmail, 200);
    if (cleanClientEmail && !isValidEmail(cleanClientEmail)) {
      notify('El correo electrónico del cliente no es válido.', 'error');
      return;
    }
    const cleanClientPhone = sanitizePhone(clientPhone, 60);
    const cleanClientDni = sanitizeDni(clientDni, 40);
    const cleanClientAddress = sanitizePlainLine(clientAddress, 240);

    setSaving(true);
    const createdRepairs: RepairRecord[] = [];
    try {
      let resolvedClientId = clientId;
      if (!resolvedClientId) {
        const matched = clients.find(
          (c) => c.name.trim().toLowerCase() === cleanClientName.toLowerCase()
        );
        if (matched) {
          resolvedClientId = matched.id;
        } else {
          resolvedClientId = generateDocId('clients');
          const encodedClientNotes = serializeClientNotes({
            altPhone: clientAltPhone,
            clientType,
            cuit: clientCuit,
            neighborhood: clientNeighborhood,
            notes: '',
          });
          await upsertRow(
            'clients',
            stripUndefined({
              id: resolvedClientId,
              ownerId,
              name: cleanClientName,
              phone: cleanClientPhone,
              dni: cleanClientDni,
              email: cleanClientEmail,
              address: cleanClientAddress,
              notes: clampStr(encodedClientNotes, 2000),
            })
          );
        }
      }

      const isBatch = itemsToSave.length > 1;
      const batchRef = isBatch ? generateBatchRef(repairs) : '';
      const runningRepairs: RepairRecord[] = [...repairs];
      const stockRemaining = new Map<string, number>();
      for (const p of products) {
        stockRemaining.set(p.id, Number(p.stock || 0));
      }

      const brandLabel =
        clampStr(profile?.brandName || 'TH3 BNB Servicio Técnico', 80) || 'TH3 BNB Servicio Técnico';

      for (let i = 0; i < itemsToSave.length; i++) {
        const item = itemsToSave[i];
        const repairId = generateDocId('repairs');
        const repairCode = clampStr(generateRepairCode(runningRepairs), 40);
        const trackingCode = clampStr(generateTrackingCode(), 40);
        const selectedParts = products.filter((p) => item.selectedPartIds.includes(p.id)).slice(0, 30);
        const defaultProgress = STATUS_META[item.status]?.defaultProgress ?? 15;
        const basePaymentStatus: 'pendiente' | 'parcial' | 'pagado' =
          item.budget === 0
            ? 'pendiente'
            : item.deposit >= item.budget
              ? 'pagado'
              : item.deposit > 0
                ? 'parcial'
                : 'pendiente';
        const useSecondaryForItem = item.currency !== baseCurrency && item.rate !== 1;
        const paymentStatus = serializeRepairPaymentStatus({
          base: basePaymentStatus,
          method:
            basePaymentStatus === 'pagado' || item.deposit > 0
              ? item.depositMethod || 'efectivo'
              : null,
          currency: useSecondaryForItem ? item.currency : undefined,
          rate: useSecondaryForItem ? item.rate : undefined,
          technician: item.technician || undefined,
        });
        const finalNotes = isBatch
          ? clampStr(appendBatchRefToNotes(item.notes, batchRef, i + 1, itemsToSave.length), 2000)
          : clampStr(item.notes, 2000);

        const nowIso = new Date().toISOString();
        const initialWorkDetail = mergeWorkDetailPublicMeta('', (prev) => {
          const withBase = {
            ...prev,
            ...(item.warrantyDays > 0 ? { warrantyDays: item.warrantyDays } : {}),
            ...(item.transferQrIvaPct > 0
              ? {
                  transferQrIvaPct: item.transferQrIvaPct,
                  transferQrIvaAmount: item.transferQrIvaAmount,
                }
              : {}),
            ...(warrantyFromRepair
              ? {
                  parentRepairId: warrantyFromRepair.id,
                  parentRepairCode: warrantyFromRepair.code,
                }
              : {}),
          };
          return appendTimelineEntry(
            withBase,
            item.status,
            warrantyFromRepair
              ? `Reingreso por garantía de orden ${warrantyFromRepair.code}`
              : 'Equipo recibido en el taller',
            nowIso
          );
        });

        const initialCheckoutState =
          item.deposit > 0
            ? mergeCheckoutPaymentLedger('', [
                {
                  id: createRepairMetaId('pay'),
                  amount: item.deposit,
                  method: item.depositMethod || 'efectivo',
                  date: nowIso,
                  note: 'Seña inicial al ingreso',
                },
              ])
            : '';

        const repairPayload: Omit<RepairRecord, 'id' | 'createdAt' | 'updatedAt'> = {
          ownerId,
          code: repairCode,
          trackingCode,
          clientId: clampStr(resolvedClientId, 128),
          clientName: cleanClientName,
          clientPhone: cleanClientPhone,
          clientDni: cleanClientDni,
          clientEmail: cleanClientEmail,
          clientAddress: cleanClientAddress,
          deviceType: clampStr(item.deviceType, 60),
          deviceIcon: clampStr(item.deviceIcon, 16),
          brand: item.brand,
          model: item.model,
          color: item.color,
          capacity: item.capacity,
          imei: item.imei,
          problem: item.problem,
          priority: item.priority,
          status: item.status,
          progress: defaultProgress,
          dateIn: item.dateIn,
          dateEst: item.dateEst,
          price: item.budget,
          deposit: item.deposit,
          paidAmount: item.deposit,
          paymentStatus,
          partIds: selectedParts.map((p) => p.id),
          partNames: selectedParts.map((p) => p.name),
          accessories: item.deviceType === 'Consola / joystick' ? [] : item.accessories,
          consoleAccessories:
            item.deviceType === 'Consola / joystick' ? item.consoleAcc : undefined,
          physicalCheck: item.physicalCheck,
          functionalCheck: item.functionalCheck,
          securityType:
            item.securityTab === 'pattern' && item.securityPattern.length > 0
              ? 'pattern'
              : item.securityPin.trim()
                ? 'pin'
                : 'none',
          securityPin: item.securityTab === 'pin' ? item.securityPin : '',
          securityPattern: item.securityTab === 'pattern' ? item.securityPattern : [],
          notes: finalNotes,
          workDetail: initialWorkDetail,
          checkoutState: initialCheckoutState,
        };

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
            businessName: brandLabel,
            businessPhone: clampStr(profile?.businessPhone, 50),
            deviceType: clampStr(item.deviceType, 60),
            brand: item.brand,
            model: item.model,
            status: item.status,
            progress: defaultProgress,
            dateIn: item.dateIn,
            dateEst: item.dateEst,
            problemSummary: item.problem,
            workDetail: initialWorkDetail,
            price: item.budget,
            deposit: item.deposit,
            updatedAt: nowIso,
          })
        );

        for (const part of selectedParts) {
          const currentStock = stockRemaining.get(part.id) ?? 0;
          if (part.trackStock && currentStock > 0) {
            const nextStock = Math.max(0, currentStock - 1);
            stockRemaining.set(part.id, nextStock);
            await updateRow('products', part.id, { stock: nextStock });
          }
        }

        const nowMs = Date.now();
        const createdRepair: RepairRecord = {
          id: repairId,
          ...repairPayload,
          createdAt: nowMs,
          updatedAt: nowMs,
        };
        if (
          item.deposit > 0 &&
          (item.depositMethod === 'transferencia' || item.depositMethod === 'tarjeta')
        ) {
          void syncRepairToPurchases(ownerId, createdRepair, loadMercadoPagoConfig(ownerId));
        }
        createdRepairs.push(createdRepair);
        runningRepairs.push(createdRepair);
      }

      if (createdRepairs.length === 1) {
        notify(`Reparación ${createdRepairs[0].code} registrada con éxito.`);
        onClose();
        onCreated?.(createdRepairs[0]);
      } else {
        notify(`Lote ${batchRef} guardado (${createdRepairs.length} órdenes creadas).`);
        onClose();
        if (onBatchCreated) {
          onBatchCreated(createdRepairs, batchRef);
        } else {
          onCreated?.(createdRepairs[0]);
        }
      }
    } catch (err) {
      const msg = sanitizeDbErrorMessage(err, 'No se pudo guardar la reparación.');
      const unsavedWithDeposit = itemsToSave
        .slice(createdRepairs.length)
        .filter((item) => Number(item.deposit || 0) > 0);
      if (unsavedWithDeposit.length > 0 && ownerId) {
        unsavedWithDeposit.forEach((item, idx) => {
          recordRecoveredPayment({
            id: `rec-newrep-${Date.now()}-${idx}`,
            ownerId,
            source: 'reparacion',
            method: item.depositMethod || 'efectivo',
            amount: Number(item.deposit),
            totalAmount: Number(item.budget || item.deposit),
            clientName: cleanClientName,
            title: `Seña · ${item.brand || ''} ${item.model || ''}`.trim() || 'Seña de ingreso',
            subtitle: 'Seña inicial (error al guardar orden en nube)',
            saveFailed: true,
            saveError: msg,
          });
        });
        notify(`${msg} La seña cobrada quedó resguardada en Caja diaria.`, 'error');
      } else {
        notify(msg, 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveAllRepairs(true);
  };

  const queuedTotalBudget = useMemo(
    () => queuedItems.reduce((sum, item) => sum + item.budget, 0),
    [queuedItems]
  );

  const renderQueuedBatchSummary = () => {
    if (queuedItems.length === 0) return null;
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
            <span className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
              {tr(
                `Lote para ${clientName.trim() || 'este cliente'} · ${queuedItems.length} ${queuedItems.length === 1 ? 'equipo agregado' : 'equipos agregados'}`,
                `Batch for ${clientName.trim() || 'this client'} · ${queuedItems.length} ${queuedItems.length === 1 ? 'device added' : 'devices added'}`,
                `Lote para ${clientName.trim() || 'este cliente'} · ${queuedItems.length} ${queuedItems.length === 1 ? 'aparelho adicionado' : 'aparelhos adicionados'}`
              )}
            </span>
          </div>
          <span className="font-mono-num text-xs font-bold text-emerald-800 dark:text-emerald-300">
            {tr('Subtotal lote:', 'Batch subtotal:', 'Subtotal do lote:')} {formatCurrency(queuedTotalBudget, baseCurrency)}
          </span>
        </div>
        <div className="mt-2 space-y-1.5">
          {queuedItems.map((item, idx) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200/80 bg-white/90 px-2.5 py-1.5 text-xs dark:border-emerald-900/50 dark:bg-slate-900/80"
            >
              <div className="min-w-0 truncate text-slate-800 dark:text-slate-200">
                <strong className="font-mono-num text-emerald-700 dark:text-emerald-300">
                  #{idx + 1}
                </strong>{' '}
                {item.deviceIcon} {item.deviceType} · {item.brand} {item.model}
                <span className="text-slate-500 dark:text-slate-400">
                  {' '}
                  — {item.problem}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                  {formatCurrency(item.budget, baseCurrency)}
                  {item.currency !== baseCurrency && item.rate !== 1 && (
                    <span className="ml-1 text-[10px] font-medium text-slate-500">
                      ({formatCurrency(convertFromBaseCurrency(item.budget, item.rate), item.currency)})
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveQueuedItem(item.id)}
                  title={tr('Quitar equipo del lote', 'Remove device from batch', 'Remover aparelho do lote')}
                  className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={
        warrantyFromRepair
          ? tr(
              `Reingreso por garantía (${warrantyFromRepair.code})`,
              `Warranty re-entry (${warrantyFromRepair.code})`,
              `Reingresso por garantia (${warrantyFromRepair.code})`
            )
          : queuedItems.length > 0
            ? tr(
                `Nueva reparación · Lote (${queuedItems.length + (step === 'details' ? 1 : 0)} equipos)`,
                `New repair · Batch (${queuedItems.length + (step === 'details' ? 1 : 0)} devices)`,
                `Novo reparo · Lote (${queuedItems.length + (step === 'details' ? 1 : 0)} aparelhos)`
              )
            : tr('Nueva reparación', 'New repair', 'Novo reparo')
      }
      subtitle={
        warrantyFromRepair
          ? tr(
              `Equipo vinculado a la orden ${warrantyFromRepair.code}`,
              `Device linked to order ${warrantyFromRepair.code}`,
              `Aparelho vinculado à ordem ${warrantyFromRepair.code}`
            )
          : step === 'device'
            ? queuedItems.length > 0
              ? tr(
                  `Paso 1 de 2 · Elegí el próximo equipo para ${clientName.trim() || 'el mismo cliente'}`,
                  `Step 1 of 2 · Choose next device for ${clientName.trim() || 'the same client'}`,
                  `Etapa 1 de 2 · Escolha o próximo aparelho para ${clientName.trim() || 'o mesmo cliente'}`
                )
              : tr(
                  'Paso 1 de 2 · Seleccioná el tipo de equipo',
                  'Step 1 of 2 · Select device type',
                  'Etapa 1 de 2 · Selecione o tipo de aparelho'
                )
            : tr(`Paso 2 de 2 · ${deviceIcon} ${deviceType}`, `Step 2 of 2 · ${deviceIcon} ${deviceType}`, `Etapa 2 de 2 · ${deviceIcon} ${deviceType}`)
      }
      maxWidth="3xl"
    >
      {step === 'device' ? (
        <div className="space-y-6">
          {renderQueuedBatchSummary()}

          <div>
            <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
              {queuedItems.length > 0
                ? tr(
                    `¿Qué otro equipo querés agregar para ${clientName.trim() || 'este cliente'}?`,
                    `What other device do you want to add for ${clientName.trim() || 'this client'}?`,
                    `Qual outro aparelho deseja adicionar para ${clientName.trim() || 'este cliente'}?`
                  )
                : tr('¿Qué equipo querés arreglar?', 'What device are you repairing?', 'Qual aparelho deseja consertar?')}
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
                                    : opt.type === 'Otros equipos'
                                      ? ''
                                      : '128 GB'
                        );
                        if (opt.type === 'Otros equipos') {
                          setSecurityTab('pin');
                          setSecurityPattern([]);
                        }
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

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {tr('Cancelar', 'Cancel', 'Cancelar')}
            </button>
            {queuedItems.length > 0 && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveAllRepairs(false)}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                <Layers className="h-4 w-4" />
                {saving
                  ? tr('Guardando...', 'Saving...', 'Salvando...')
                  : tr(
                      `Finalizar y emitir boleta (${queuedItems.length})`,
                      `Finish & issue receipt (${queuedItems.length})`,
                      `Finalizar e emitir comprovante (${queuedItems.length})`
                    )}
              </button>
            )}
            <button
              type="button"
              disabled={!deviceType}
              onClick={() => setStep('details')}
              className="h-11 rounded-xl bg-[#0072BB] px-6 text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {tr('Continuar', 'Continue', 'Continuar')}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {renderQueuedBatchSummary()}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-3 dark:border-sky-900/60 dark:bg-sky-950/30">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">{deviceIcon}</span>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {queuedItems.length > 0
                    ? tr(
                        `Equipo #${queuedItems.length + 1} del lote`,
                        `Device #${queuedItems.length + 1} in batch`,
                        `Aparelho #${queuedItems.length + 1} do lote`
                      )
                    : tr('Equipo seleccionado', 'Selected device', 'Aparelho selecionado')}
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-white">{deviceType}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleAddAnotherDevice}
                className="inline-flex items-center gap-1 rounded-lg border border-[#0072BB]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[#0072BB] hover:bg-sky-100 dark:border-sky-700/60 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-sky-900/40"
              >
                <Plus className="h-3.5 w-3.5" />
                {tr('Sumar otro equipo', 'Add another device', 'Adicionar outro aparelho')}
              </button>
              <button
                type="button"
                onClick={() => setStep('device')}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-[#0072BB] hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {tr('Cambiar tipo', 'Change type', 'Trocar tipo')}
              </button>
            </div>
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                {tr('Datos del cliente', 'Client details', 'Dados do cliente')}
              </h3>
              {clients.length > 0 && (
                <div className="flex items-center gap-2">
                  <UserCheck className="h-3.5 w-3.5 text-slate-400" />
                  <select
                    value={clientId}
                    onChange={(e) => handleSelectExistingClient(e.target.value)}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="">
                      {tr('Cliente nuevo / elegir existente...', 'New client / pick existing...', 'Cliente novo / escolher existente...')}
                    </option>
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
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('Tipo de cliente', 'Client type', 'Tipo de cliente')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['particular', 'empresa', 'gremio'] as const).map((type) => {
                    const active = clientType === type;
                    const labelMap = {
                      particular: tr('Particular', 'Individual', 'Particular'),
                      empresa: tr('Empresa', 'Business', 'Empresa'),
                      gremio: tr('Gremio / Revendedor', 'Trade / Reseller', 'Lojista / Revendedor'),
                    };
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setClientType(type)}
                        className={`h-9 rounded-xl border px-2 text-xs font-semibold transition ${
                          active
                            ? 'border-[#0072BB] bg-[#0072BB] text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        {labelMap[type] || CLIENT_TYPE_LABELS[type]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {clientType === 'empresa'
                    ? tr('Nombre / Razón social *', 'Company / Business name *', 'Nome / Razão social *')
                    : tr('Nombre completo *', 'Full name *', 'Nome completo *')}
                </label>
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => {
                    setClientName(e.target.value);
                    if (clientId) setClientId('');
                  }}
                  placeholder={
                    clientType === 'empresa'
                      ? tr('Ej: TechStore SRL', 'E.g.: TechStore LLC', 'Ex.: TechStore Ltda')
                      : tr('Nombre completo', 'Full name', 'Nome completo')
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('Teléfono principal', 'Primary phone', 'Telefone principal')}
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
                  {tr('Teléfono alternativo', 'Alternate phone', 'Telefone alternativo')}
                </label>
                <input
                  type="tel"
                  value={clientAltPhone}
                  onChange={(e) => setClientAltPhone(e.target.value)}
                  placeholder={tr('Familiar o contacto secundario', 'Family or secondary contact', 'Familiar ou contato secundário')}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('DNI', 'ID Number', 'CPF / RG')}
                </label>
                <input
                  type="text"
                  value={clientDni}
                  onChange={(e) => setClientDni(e.target.value)}
                  placeholder="Ej: 35.123.456"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('CUIT / CUIL', 'Tax ID', 'CNPJ / CPF')}
                </label>
                <input
                  type="text"
                  value={clientCuit}
                  onChange={(e) => setClientCuit(e.target.value)}
                  placeholder="Ej: 20-12345678-9"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('Email', 'Email', 'E-mail')}
                </label>
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('Dirección', 'Address', 'Endereço')}
                </label>
                <input
                  type="text"
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  placeholder={tr('Calle y altura', 'Street address', 'Rua e número')}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('Localidad / Barrio', 'City / Neighborhood', 'Cidade / Bairro')}
                </label>
                <input
                  type="text"
                  value={clientNeighborhood}
                  onChange={(e) => setClientNeighborhood(e.target.value)}
                  placeholder={tr('Ej: Centro, Palermo...', 'E.g.: Downtown...', 'Ex.: Centro...')}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
              {tr('Datos del equipo', 'Device details', 'Dados do aparelho')}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('Marca', 'Brand', 'Marca')}
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
                                  : isOtherDevice
                                    ? 'other-brands-datalist'
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
                                  : isOtherDevice
                                    ? 'Ej: Samsung, LG, Epson, TP-Link, Genérico...'
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
                    {isOtherDevice && (
                      <datalist id="other-brands-datalist">
                        {OTHER_DEVICE_BRAND_SUGGESTIONS.map((b) => (
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
                        placeholder={tr('Especificar marca', 'Specify brand', 'Especificar marca')}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('Modelo', 'Model', 'Modelo')}
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
                                : isOtherDevice
                                  ? 'other-models-datalist'
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
                                  : isOtherDevice
                                    ? 'Ej: Smart TV 43", L3250, Archer C6, Fuente 12V...'
                                    : `${tr('Modelo de', 'Model of', 'Modelo de')} ${deviceType}`
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
                    {isOtherDevice && (
                      <datalist id="other-models-datalist">
                        {OTHER_DEVICE_MODEL_SUGGESTIONS.map((m) => (
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
                      <option value="">{tr('Seleccioná un modelo', 'Select a model', 'Selecione um modelo')}</option>
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
                        placeholder={tr('O escribí el modelo exacto', 'Or enter exact model', 'Ou digite o modelo exato')}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('Color', 'Color', 'Cor')}
                </label>
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder={tr('Negro / Blanco', 'Black / White', 'Preto / Branco')}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {(showCapacity || isSpeaker || isConsole || isHeadphones || isNotebook || isOtherDevice) && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {isSpeaker || isHeadphones
                      ? tr('Tipo / Formato', 'Type / Format', 'Tipo / Formato')
                      : isConsole
                        ? tr('Edición / Capacidad', 'Edition / Capacity', 'Edição / Capacidade')
                        : isSmartwatch
                          ? tr('Medida / Caja', 'Size / Case', 'Tamanho / Caixa')
                          : isNotebook
                            ? tr('Almacenamiento', 'Storage', 'Armazenamento')
                            : isOtherDevice
                              ? tr('Categoría / Tipo de equipo', 'Category / Device type', 'Categoria / Tipo de aparelho')
                              : tr('Capacidad', 'Capacity', 'Capacidade')}
                  </label>
                  {isOtherDevice ? (
                    <>
                      <input
                        type="text"
                        list="other-device-types-datalist"
                        value={capacity}
                        onChange={(e) => setCapacity(e.target.value)}
                        placeholder="Ej: Smart TV, Monitor, Impresora, Router, Microondas..."
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      <datalist id="other-device-types-datalist">
                        {OTHER_DEVICE_TYPE_SUGGESTIONS.map((opt) => (
                          <option key={opt} value={opt} />
                        ))}
                      </datalist>
                    </>
                  ) : (
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
                  )}
                </div>
              )}

              <div
                className={
                  showCapacity || isSpeaker || isConsole || isHeadphones || isNotebook || isOtherDevice
                    ? 'sm:col-span-2'
                    : ''
                }
              >
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {deviceType === 'Celular' || deviceType === 'Tablet'
                    ? 'IMEI'
                    : tr('Número de serie', 'Serial number', 'Número de série')}
                </label>
                <input
                  type="text"
                  value={imei}
                  onChange={(e) => setImei(e.target.value)}
                  placeholder={tr('IMEI o número de serie', 'IMEI or serial number', 'IMEI ou número de série')}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                {tr('Falla, prioridad y presupuesto', 'Issue, priority & estimate', 'Defeito, prioridade e orçamento')}
              </h3>
              {secondaryCurrencies.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Coins className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {tr('Moneda:', 'Currency:', 'Moeda:')}
                  </span>
                  <select
                    value={selectedCurrency}
                    onChange={(e) => handleCurrencyChange(e.target.value)}
                    aria-label={tr('Moneda de la reparación', 'Repair currency', 'Moeda do reparo')}
                    className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {[baseCurrency, ...secondaryCurrencies.map((c) => c.code)].map((code) => {
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

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Problema reportado *', 'Reported issue *', 'Problema relatado *')}
              </label>
              <textarea
                rows={3}
                required
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                placeholder={tr('Describí la falla del equipo', 'Describe the device issue', 'Descreva o defeito do aparelho')}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('Prioridad', 'Priority', 'Prioridade')}
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as 'alta' | 'media' | 'baja')}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="alta">{tr('Alta', 'High', 'Alta')}</option>
                  <option value="media">{tr('Media', 'Medium', 'Média')}</option>
                  <option value="baja">{tr('Baja', 'Low', 'Baixa')}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('Fecha de ingreso', 'Check-in date', 'Data de entrada')}
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
                  {tr('Entrega estimada', 'Estimated delivery', 'Previsão de entrega')}
                </label>
                <input
                  type="date"
                  value={dateEst}
                  onChange={(e) => setDateEst(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            {workshopMeta.techniciansEnabled && workshopMeta.technicians.length > 0 && (
              <div>
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
                  {workshopMeta.technicians.map((techName) => (
                    <option key={techName} value={techName}>
                      {techName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {spareParts.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span>{tr('Repuestos asociados del inventario', 'Linked inventory parts', 'Peças associadas do estoque')}</span>
                  {selectedPartIds.length > 0 && (
                    <span className="font-mono-num text-[#0072BB] dark:text-sky-300">
                      {selectedPartIds.length}{' '}
                      {selectedPartIds.length === 1
                        ? tr('repuesto', 'part', 'peça')
                        : tr('repuestos', 'parts', 'peças')}{' '}
                      · {formatCurrency(selectedPartsTotalDisplay, selectedCurrency)}{' '}
                      {tr('sumado al total', 'added to total', 'somado ao total')}
                    </span>
                  )}
                </div>
                <div className="grid max-h-40 gap-2 overflow-y-auto rounded-xl border border-slate-200 p-2.5 sm:grid-cols-2 dark:border-slate-800">
                  {spareParts.map((part) => {
                    const checked = selectedPartIds.includes(part.id);
                    const partDisplayPrice = isSecondaryCurrency
                      ? Math.round(convertFromBaseCurrency(Number(part.price || 0), activeRate) * 100) /
                        100
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
                        onClick={() => togglePart(part)}
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
                          <span>{formatCurrency(partDisplayPrice, selectedCurrency)}</span>
                          {checked && <Check className="h-3.5 w-3.5" />}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {selectedOutOfStockParts.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span>
                        {tr('Sin stock en inventario para:', 'Out of stock in inventory for:', 'Sem estoque para:')}{' '}
                        <strong>{selectedOutOfStockParts.map((p) => p.name).join(', ')}</strong>.{' '}
                        {tr(
                          'No se descontará unidad hasta reponer.',
                          'Units will not be deducted until restocked.',
                          'Não será descontado até repor.'
                        )}
                      </span>
                    </div>
                    {status !== 'espera_repuesto' && (
                      <button
                        type="button"
                        onClick={() => setStatus('espera_repuesto')}
                        className="h-8 shrink-0 rounded-lg border border-amber-400 bg-white px-2.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-950/60"
                      >
                        {tr('Pasar a Espera repuesto', 'Move to Waiting for part', 'Mover para Aguardando peça')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr(`Presupuesto (${currencySymbol})`, `Estimate (${currencySymbol})`, `Orçamento (${currencySymbol})`)}
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
                  {tr(`Anticipo / Seña (${currencySymbol})`, `Deposit / Advance (${currencySymbol})`, `Sinal / Adiantamento (${currencySymbol})`)}
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
                  {tr('Total pendiente', 'Balance due', 'Saldo pendente')}
                </label>
                <input
                  type="text"
                  readOnly
                  value={formatCurrency(pendingBalanceDisplay, selectedCurrency)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono-num text-sm font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tr('Estado inicial', 'Initial status', 'Status inicial')}
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as RepairStatus)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="recibido">{tr('Recibido', 'Received', 'Recebido')}</option>
                  <option value="diagnostico">{tr('Diagnóstico', 'Diagnosis', 'Diagnóstico')}</option>
                  <option value="espera_repuesto">{tr('Espera repuesto', 'Waiting for part', 'Aguardando peça')}</option>
                  <option value="en_progreso">{tr('En progreso', 'In progress', 'Em andamento')}</option>
                  <option value="listo">{tr('Listo para entregar', 'Ready for pickup', 'Pronto para entrega')}</option>
                </select>
              </div>
            </div>

            {depositDisplay > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/50 px-3 py-2.5 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                  {tr(
                    `Medio de pago de la seña (${formatCurrency(depositDisplay, selectedCurrency)}):`,
                    `Deposit payment method (${formatCurrency(depositDisplay, selectedCurrency)}):`,
                    `Forma de pagamento do sinal (${formatCurrency(depositDisplay, selectedCurrency)}):`
                  )}
                </span>
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                  {(['efectivo', 'transferencia', 'tarjeta'] as const).map((methodKey) => {
                    const active = depositMethod === methodKey;
                    const methodLabel =
                      methodKey === 'efectivo'
                        ? tr('Efectivo', 'Cash', 'Dinheiro')
                        : methodKey === 'transferencia'
                          ? tr('Transferencia', 'Transfer', 'Transferência')
                          : tr('Tarjeta', 'Card', 'Cartão');
                    return (
                      <button
                        key={methodKey}
                        type="button"
                        onClick={() => {
                          setDepositMethod(methodKey);
                          if (!ivaTouchedManually) {
                            setApplyTransferQrIva(methodKey === 'transferencia');
                          }
                        }}
                        className={`h-8 rounded-lg px-2.5 text-xs font-semibold transition ${
                          active
                            ? 'bg-[#0072BB] text-white'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        {methodLabel || PAYMENT_METHOD_LABELS[methodKey]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div
              className={`space-y-2.5 rounded-xl border p-3 transition ${
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
                        aria-label={tr('Porcentaje de IVA Transferencia / QR', 'Transfer / QR VAT percentage', 'Porcentagem de IVA Transferência / QR')}
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
                    `Solo aplica por Transferencia o QR (porcentaje equivalente a Mercado Pago: ${parsedTransferQrIvaPct}%). Si paga en Efectivo queda sin IVA.`,
                    `Only applies to Transfer or QR (${parsedTransferQrIvaPct}% Mercado Pago equivalent). Cash payments have no VAT surcharge.`,
                    `Aplica-se somente para Transferência ou QR (${parsedTransferQrIvaPct}% equivalente ao Mercado Pago). Pagamento em dinheiro fica sem acréscimo.`
                  )}
                </p>
              )}
            </div>

            {(subtotalBudgetDisplay > 0 || depositDisplay > 0 || applyTransferQrIva) && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {selectedPartIds.length > 0
                        ? tr('Presup. + Repuestos', 'Est. + Parts', 'Orçam. + Peças')
                        : tr('Presupuesto', 'Estimate', 'Orçamento')}
                    </div>
                    <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                      {formatCurrency(subtotalBudgetDisplay, selectedCurrency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {applyTransferQrIva
                        ? tr(`IVA Transf./QR (${parsedTransferQrIvaPct}%)`, `Transfer/QR VAT (${parsedTransferQrIvaPct}%)`, `IVA Transf./QR (${parsedTransferQrIvaPct}%)`)
                        : tr('IVA Transf./QR', 'Transfer/QR VAT', 'IVA Transf./QR')}
                    </div>
                    <div
                      className={`font-mono-num text-sm font-bold ${
                        transferQrIvaDisplay > 0
                          ? 'text-[#0072BB] dark:text-sky-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {transferQrIvaDisplay > 0
                        ? `+${formatCurrency(transferQrIvaDisplay, selectedCurrency)}`
                        : formatCurrency(0, selectedCurrency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {tr('Seña', 'Deposit', 'Sinal')}
                    </div>
                    <div className="font-mono-num text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(depositDisplay, selectedCurrency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {depositDisplay > 0
                        ? tr('Total / Pendiente', 'Total / Balance', 'Total / Pendente')
                        : tr('Total', 'Total', 'Total')}
                    </div>
                    <div className="font-mono-num text-sm font-extrabold text-[#0072BB] dark:text-sky-300">
                      {formatCurrency(totalBudgetDisplay, selectedCurrency)}
                      {depositDisplay > 0 && (
                        <span className="ml-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          ({tr('rest.', 'bal.', 'rest.')} {formatCurrency(pendingBalanceDisplay, selectedCurrency)})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isSecondaryCurrency && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                <span>
                  {tr('Conversión', 'Conversion', 'Conversão')} (1 {selectedCurrency} = {formatCurrency(activeRate, baseCurrency)}):
                </span>
                <span className="font-mono-num font-bold">
                  {tr('Total base', 'Base total', 'Total base')} {formatCurrency(baseBudget, baseCurrency)}
                  {baseDeposit > 0 ? ` · ${tr('Seña', 'Deposit', 'Sinal')} ${formatCurrency(baseDeposit, baseCurrency)}` : ''}
                </span>
              </div>
            )}

            {selectedPartIds.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-slate-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-slate-200">
                <span>
                  {tr('Mano de obra', 'Labor', 'Mão de obra')} (
                  <strong className="font-mono-num">
                    {formatCurrency(manualBudget, selectedCurrency)}
                  </strong>
                  ) + {tr('Repuestos', 'Parts', 'Peças')} (
                  <strong className="font-mono-num">
                    {formatCurrency(selectedPartsTotalDisplay, selectedCurrency)}
                  </strong>
                  )
                  {transferQrIvaDisplay > 0 && (
                    <>
                      {' '}
                      + IVA Transf./QR (
                      <strong className="font-mono-num">
                        {formatCurrency(transferQrIvaDisplay, selectedCurrency)}
                      </strong>
                      )
                    </>
                  )}
                </span>
                <span className="font-mono-num font-bold text-[#0072BB] dark:text-sky-300">
                  Total: {formatCurrency(totalBudgetDisplay, selectedCurrency)}
                </span>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {tr('Garantía del trabajo (se activa al entregar)', 'Service warranty (starts on delivery)', 'Garantia do serviço (ativa na entrega)')}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { days: 0, label: tr('Sin garantía', 'No warranty', 'Sem garantia') },
                    { days: 30, label: tr('30 días', '30 days', '30 dias') },
                    { days: 60, label: tr('60 días', '60 days', '60 dias') },
                    { days: 90, label: tr('90 días', '90 days', '90 dias') },
                  ].map((opt) => {
                    const active = warrantyDays === opt.days;
                    return (
                      <button
                        key={opt.days}
                        type="button"
                        onClick={() => setWarrantyDays(opt.days)}
                        className={`h-8 rounded-lg border px-2.5 text-xs font-semibold transition ${
                          active
                            ? 'border-[#0072BB] bg-[#0072BB] text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  <input
                    type="number"
                    min="0"
                    max="3650"
                    value={warrantyDays || ''}
                    onChange={(e) =>
                      setWarrantyDays(Math.max(0, Math.min(3650, Math.round(Number(e.target.value) || 0))))
                    }
                    placeholder={tr('Días', 'Days', 'Dias')}
                    aria-label={tr('Días personalizados de garantía', 'Custom warranty days', 'Dias personalizados de garantia')}
                    className="h-8 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
              {tr('Accesorios entregados', 'Accessories included', 'Acessórios entregues')}
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
                          {opt === 'Sí' ? tr('Sí', 'Yes', 'Sim') : tr('No', 'No', 'Não')}
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
                          : isOtherDevice
                            ? OTHER_DEVICE_ACCESSORIES
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
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                {tr('Check-in · Estado físico y funcional', 'Check-in · Physical & functional condition', 'Check-in · Estado físico e funcional')}
              </h3>
              {isOtherDevice && (
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {tr(
                    'Marcá solo los ítems que apliquen a este equipo (podés usar «No tiene» o dejar sin marcar los que no correspondan).',
                    'Check only items that apply to this device (leave unrelated ones unchecked).',
                    'Marque apenas os itens aplicáveis a este aparelho.'
                  )}
                </p>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2.5 rounded-2xl border border-slate-200 p-3.5 dark:border-slate-800">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {tr('Estado físico', 'Physical condition', 'Estado físico')}
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
                  {tr('Estado funcional', 'Functional condition', 'Estado funcional')}
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
                {tr('Notas internas o de entrega', 'Internal or delivery notes', 'Notas internas ou de entrega')}
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={tr('Observaciones adicionales...', 'Additional notes...', 'Observações adicionais...')}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                {isOtherDevice
                  ? tr('Clave / Acceso del equipo (opcional)', 'Device PIN / Access (optional)', 'Senha / Acesso do aparelho (opcional)')
                  : tr('Seguridad del equipo', 'Device security', 'Segurança do aparelho')}
              </h3>
              {!isOtherDevice && (
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
                    {tr('PIN / Clave', 'PIN / Password', 'PIN / Senha')}
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
                    {tr('Patrón', 'Pattern', 'Padrão')}
                  </button>
                </div>
              )}
            </div>

            {isOtherDevice || securityTab === 'pin' ? (
              <input
                type="text"
                value={securityPin}
                onChange={(e) => setSecurityPin(e.target.value)}
                placeholder={
                  isOtherDevice
                    ? tr(
                        'Solo si aplica (ej: clave WiFi, PIN de menú o admin), sino dejar vacío',
                        'Only if applicable (e.g. WiFi password, admin PIN), otherwise leave blank',
                        'Apenas se aplicável (ex: senha WiFi, PIN admin), senão deixe vazio'
                      )
                    : tr('PIN, contraseña o sin clave', 'PIN, password or none', 'PIN, senha ou sem senha')
                }
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            ) : (
              <div className="flex justify-center py-2">
                <PatternLock value={securityPattern} onChange={setSecurityPattern} size={220} />
              </div>
            )}
          </section>

          <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-4 sm:flex-row dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {tr('Cancelar', 'Cancel', 'Cancelar')}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleAddAnotherDevice}
              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#0072BB] bg-sky-50 px-4 text-sm font-semibold text-[#0072BB] transition hover:bg-sky-100 disabled:opacity-60 dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/70"
            >
              <Plus className="h-4 w-4" />
              {tr('Agregar otro equipo', 'Add another device', 'Adicionar outro aparelho')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
            >
              {saving
                ? tr('Guardando...', 'Saving...', 'Salvando...')
                : queuedItems.length > 0
                  ? tr(
                      `Guardar lote (${queuedItems.length + 1} equipos)`,
                      `Save batch (${queuedItems.length + 1} devices)`,
                      `Salvar lote (${queuedItems.length + 1} aparelhos)`
                    )
                  : tr('Guardar reparación', 'Save repair', 'Salvar reparo')}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
};
