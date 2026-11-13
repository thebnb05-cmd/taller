import type { DeviceType, RepairStatus } from '../types/workshop';

export const DEVICE_OPTIONS: Array<{ type: DeviceType; label: string; icon: string }> = [
  { type: 'Celular', label: 'Celular', icon: '📱' },
  { type: 'Tablet', label: 'Tablets', icon: '📟' },
  { type: 'Notebook', label: 'Notebook', icon: '💻' },
  { type: 'Parlante', label: 'Parlante', icon: '🔊' },
  { type: 'PC de escritorio', label: 'PC de escritorio', icon: '🖥️' },
  { type: 'Consola / joystick', label: 'Consola / joystick', icon: '🎮' },
  { type: 'Smartwatch', label: 'Smartwatches', icon: '⌚' },
  { type: 'Auriculares', label: 'Auriculares', icon: '🎧' },
  { type: 'Otros equipos', label: 'Otros equipos', icon: '🧰' },
];

export const BRAND_LIST = [
  'Samsung',
  'Apple',
  'Motorola',
  'Xiaomi',
  'Huawei',
  'Realme',
  'Nokia',
  'LG',
  'Otro',
];

export const MODELS_BY_BRAND: Record<string, string[]> = {
  Samsung: [
    'Galaxy A14',
    'Galaxy A15',
    'Galaxy A24',
    'Galaxy A34',
    'Galaxy A35',
    'Galaxy A54',
    'Galaxy A55',
    'Galaxy S21 FE',
    'Galaxy S22',
    'Galaxy S23',
    'Galaxy S23 Ultra',
    'Galaxy S24',
    'Galaxy S24 Ultra',
    'Galaxy Tab A8',
    'Galaxy Tab S9',
    'Otro modelo',
  ],
  Apple: [
    'iPhone 11',
    'iPhone 12',
    'iPhone 13',
    'iPhone 13 Pro Max',
    'iPhone 14',
    'iPhone 14 Pro',
    'iPhone 15',
    'iPhone 15 Pro Max',
    'iPhone 16',
    'iPad 9na Gen',
    'iPad Air',
    'Apple Watch Series 8',
    'Apple Watch SE',
    'Otro modelo',
  ],
  Motorola: [
    'Moto G14',
    'Moto G24',
    'Moto G32',
    'Moto G42',
    'Moto G54',
    'Moto G72',
    'Moto G84',
    'Moto Edge 30',
    'Moto Edge 40',
    'Moto Edge 50',
    'Moto E13',
    'Moto E22',
    'Otro modelo',
  ],
  Xiaomi: [
    'Redmi 12',
    'Redmi 13C',
    'Redmi Note 11',
    'Redmi Note 12',
    'Redmi Note 13',
    'Redmi Note 13 Pro',
    'Poco X5',
    'Poco X6 Pro',
    'Xiaomi 13T',
    'Otro modelo',
  ],
  Huawei: ['Nova 11', 'P30 Lite', 'P40 Lite', 'MatePad', 'Otro modelo'],
  Realme: ['Realme C55', 'Realme C67', 'Realme 11 Pro', 'Otro modelo'],
  Nokia: ['Nokia G21', 'Nokia G42', 'Nokia C32', 'Otro modelo'],
  LG: ['LG K42', 'LG K52', 'LG Velvet', 'Otro modelo'],
  Otro: ['Otro modelo'],
};

export const CAPACITY_OPTIONS = ['32 GB', '64 GB', '128 GB', '256 GB', '512 GB', '1 TB'];

export const STATUS_META: Record<
  RepairStatus,
  { label: string; defaultProgress: number; badgeClass: string; barClass: string }
> = {
  recibido: {
    label: 'Recibido',
    defaultProgress: 15,
    badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    barClass: 'bg-slate-500',
  },
  diagnostico: {
    label: 'Diagnóstico',
    defaultProgress: 30,
    badgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300',
    barClass: 'bg-sky-500',
  },
  espera_repuesto: {
    label: 'Espera repuesto',
    defaultProgress: 50,
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300',
    barClass: 'bg-amber-500',
  },
  en_progreso: {
    label: 'En progreso',
    defaultProgress: 70,
    badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300',
    barClass: 'bg-[#0072BB] dark:bg-sky-500',
  },
  listo: {
    label: 'Listo para entregar',
    defaultProgress: 90,
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300',
    barClass: 'bg-emerald-600',
  },
  entregado: {
    label: 'Entregado',
    defaultProgress: 100,
    badgeClass: 'bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300',
    barClass: 'bg-teal-600',
  },
};

export const PRODUCT_CATEGORIES = [
  'Repuesto',
  'Accesorio',
  'Equipo',
  'Herramienta e Insumo',
  'Otro',
  'Servicio',
];

export const SUBCATEGORIES_BY_CATEGORY: Record<string, string[]> = {
  Repuesto: [
    'Módulos / Pantallas',
    'Baterías',
    'Pines de carga / Flex',
    'Cámaras',
    'Parlantes / Auriculares',
    'Tapas traseras / Chasis',
    'Circuitos / IC',
  ],
  Accesorio: [
    'Fundas',
    'Vidrios templados / Hidrogel',
    'Cargadores',
    'Cables USB',
    'Auriculares',
    'Parlantes',
    'Soportes',
  ],
  Equipo: ['Celulares nuevos', 'Celulares usados', 'Tablets', 'Smartwatches', 'Notebooks'],
  'Herramienta e Insumo': [
    'Pegamentos / Cintas',
    'Estaño / Flux',
    'Destornilladores / Pinzas',
    'Limpieza / Alcohol',
  ],
  Servicio: [
    'Cambio de módulo',
    'Cambio de batería',
    'Cambio de pin de carga',
    'Limpieza por humedad',
    'Software / Flasheo',
    'Microsoldadura',
  ],
  Otro: ['Varios'],
};

export const PRODUCT_SUGGESTIONS: Record<string, string[]> = {
  'Módulos / Pantallas': [
    'Módulo Samsung A14 Original',
    'Módulo iPhone 11 Incell',
    'Módulo Moto G54 OLED',
  ],
  Baterías: ['Batería iPhone 11', 'Batería Samsung A32', 'Batería Motorola G20'],
  'Pines de carga / Flex': ['Placa de carga Samsung A54', 'Flex de carga iPhone 13', 'Pin Tipo C'],
  Fundas: ['Funda silicona MagSafe', 'Funda Antigolpe reforzada'],
  'Vidrios templados / Hidrogel': ['Templado 9D', 'Lámina Hidrogel Mate'],
  Cargadores: ['Cargador 20W USB-C PD', 'Cargador 25W Super Fast'],
};

export const PRODUCT_BRANDS = [
  'Sin marca',
  'Alcatel',
  'Anker',
  'Apple',
  'Asus',
  'Baseus',
  'Belkin',
  'Genérico',
  'Google',
  'Honor',
  'Huawei',
  'JBL',
  'Lenovo',
  'LG',
  'Motorola',
  'Nokia',
  'OEM',
  'OnePlus',
  'OPPO',
  'Original',
  'Otra',
  'OtterBox',
  'Realme',
  'Samsung',
  'Sony',
  'Spigen',
  'TCL',
  'Vivo',
  'Wuzip',
  'Xiaomi',
  'ZTE',
];

export const DEFAULT_RECEIPT_TERMS =
  '1. El presupuesto informado puede variar si durante la revisión técnica surgen fallas ocultas, en cuyo caso se notificará previamente al cliente.\n' +
  '2. Los equipos ingresados apagados o mojados quedan sujetos a diagnóstico previo.\n' +
  '3. El taller no se responsabiliza por pérdida de datos, chips SIM o memorias no declaradas.\n' +
  '4. Transcurridos 60 días desde el aviso de reparación finalizada sin retiro, el equipo quedará sujeto a gastos de almacenamiento.';
