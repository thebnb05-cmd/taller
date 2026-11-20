import { getPreferenceCookie, setPreferenceCookie } from './cookieStorage';

export type ShortcutCategory = 'actions' | 'navigation' | 'system';

export type ShortcutActionId =
  | 'new_repair'
  | 'new_client'
  | 'new_product'
  | 'new_sale'
  | 'new_task'
  | 'new_purchase'
  | 'nav_home'
  | 'nav_repairs'
  | 'nav_agenda'
  | 'nav_clients'
  | 'nav_inventory'
  | 'nav_suppliers'
  | 'nav_purchases'
  | 'nav_sales'
  | 'nav_cash'
  | 'nav_reports'
  | 'global_search'
  | 'open_settings'
  | 'toggle_dark'
  | 'open_shortcuts'
  | 'close_modal';

export interface ShortcutDefinition {
  id: ShortcutActionId;
  category: ShortcutCategory;
  keys: string[];
  altKeys?: string[];
  label: {
    es: string;
    en: string;
    pt: string;
  };
  clickable?: boolean;
}

const SHORTCUTS_COOKIE_KEY = 'th3bnb_shortcuts_enabled';
const SHORTCUTS_STORAGE_KEY = 'th3bnb-shortcuts-enabled';

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function formatShortcutKey(key: string, mac = isMacPlatform()): string {
  if (key === 'Ctrl') return mac ? '⌘' : 'Ctrl';
  if (key === 'Alt') return mac ? '⌥' : 'Alt';
  if (key === 'Shift') return mac ? '⇧' : 'Shift';
  return key;
}

export function getShortcutsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const fromCookie = getPreferenceCookie(SHORTCUTS_COOKIE_KEY);
  if (fromCookie === 'false') return false;
  if (fromCookie === 'true') return true;
  try {
    const fromStorage = window.localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    if (fromStorage === 'false') return false;
    if (fromStorage === 'true') return true;
  } catch {
    // Ignore storage restrictions
  }
  return true;
}

export function setShortcutsEnabled(enabled: boolean): void {
  const val = enabled ? 'true' : 'false';
  setPreferenceCookie(SHORTCUTS_COOKIE_KEY, val);
  try {
    window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, val);
  } catch {
    // Ignore storage restrictions
  }
}

export function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

export const GLOBAL_SHORTCUTS: ShortcutDefinition[] = [
  {
    id: 'new_repair',
    category: 'actions',
    keys: ['Ctrl', 'N'],
    altKeys: ['Alt', 'N'],
    label: {
      es: 'Nueva reparación',
      en: 'New repair',
      pt: 'Novo reparo',
    },
    clickable: true,
  },
  {
    id: 'new_client',
    category: 'actions',
    keys: ['Alt', 'C'],
    label: {
      es: 'Nuevo cliente',
      en: 'New client',
      pt: 'Novo cliente',
    },
    clickable: true,
  },
  {
    id: 'new_product',
    category: 'actions',
    keys: ['Alt', 'P'],
    label: {
      es: 'Nuevo producto',
      en: 'New product',
      pt: 'Novo produto',
    },
    clickable: true,
  },
  {
    id: 'new_sale',
    category: 'actions',
    keys: ['Alt', 'V'],
    label: {
      es: 'Nueva venta',
      en: 'New sale',
      pt: 'Nova venda',
    },
    clickable: true,
  },
  {
    id: 'new_task',
    category: 'actions',
    keys: ['Alt', 'T'],
    label: {
      es: 'Nueva tarea en agenda',
      en: 'New schedule task',
      pt: 'Nova tarefa na agenda',
    },
    clickable: true,
  },
  {
    id: 'new_purchase',
    category: 'actions',
    keys: ['Alt', 'B'],
    label: {
      es: 'Nueva compra',
      en: 'New purchase',
      pt: 'Nova compra',
    },
    clickable: true,
  },
  {
    id: 'nav_home',
    category: 'navigation',
    keys: ['Alt', '1'],
    label: {
      es: 'Ir a Inicio',
      en: 'Go to Home',
      pt: 'Ir para Início',
    },
    clickable: true,
  },
  {
    id: 'nav_repairs',
    category: 'navigation',
    keys: ['Alt', '2'],
    label: {
      es: 'Ir a Reparaciones',
      en: 'Go to Repairs',
      pt: 'Ir para Reparos',
    },
    clickable: true,
  },
  {
    id: 'nav_agenda',
    category: 'navigation',
    keys: ['Alt', '3'],
    label: {
      es: 'Ir a Agenda',
      en: 'Go to Schedule',
      pt: 'Ir para Agenda',
    },
    clickable: true,
  },
  {
    id: 'nav_clients',
    category: 'navigation',
    keys: ['Alt', '4'],
    label: {
      es: 'Ir a Clientes',
      en: 'Go to Clients',
      pt: 'Ir para Clientes',
    },
    clickable: true,
  },
  {
    id: 'nav_inventory',
    category: 'navigation',
    keys: ['Alt', '5'],
    label: {
      es: 'Ir a Inventario y Productos',
      en: 'Go to Inventory & Products',
      pt: 'Ir para Estoque e Produtos',
    },
    clickable: true,
  },
  {
    id: 'nav_suppliers',
    category: 'navigation',
    keys: ['Alt', '6'],
    label: {
      es: 'Ir a Proveedores',
      en: 'Go to Suppliers',
      pt: 'Ir para Fornecedores',
    },
    clickable: true,
  },
  {
    id: 'nav_purchases',
    category: 'navigation',
    keys: ['Alt', '7'],
    label: {
      es: 'Ir a Compras',
      en: 'Go to Purchases',
      pt: 'Ir para Compras',
    },
    clickable: true,
  },
  {
    id: 'nav_sales',
    category: 'navigation',
    keys: ['Alt', '8'],
    label: {
      es: 'Ir a Ventas',
      en: 'Go to Sales',
      pt: 'Ir para Vendas',
    },
    clickable: true,
  },
  {
    id: 'nav_cash',
    category: 'navigation',
    keys: ['Alt', '9'],
    label: {
      es: 'Ir a Caja diaria',
      en: 'Go to Cash register',
      pt: 'Ir para Caixa diário',
    },
    clickable: true,
  },
  {
    id: 'nav_reports',
    category: 'navigation',
    keys: ['Alt', '0'],
    label: {
      es: 'Ir a Reportes',
      en: 'Go to Reports',
      pt: 'Ir para Relatórios',
    },
    clickable: true,
  },
  {
    id: 'global_search',
    category: 'system',
    keys: ['Ctrl', 'K'],
    label: {
      es: 'Búsqueda global',
      en: 'Global search',
      pt: 'Busca global',
    },
    clickable: true,
  },
  {
    id: 'open_settings',
    category: 'system',
    keys: ['Alt', 'S'],
    label: {
      es: 'Configuración del taller',
      en: 'Workshop settings',
      pt: 'Configurações da oficina',
    },
    clickable: true,
  },
  {
    id: 'toggle_dark',
    category: 'system',
    keys: ['Alt', 'D'],
    label: {
      es: 'Cambiar tema claro / oscuro',
      en: 'Toggle light / dark theme',
      pt: 'Alternar tema claro / escuro',
    },
    clickable: true,
  },
  {
    id: 'open_shortcuts',
    category: 'system',
    keys: ['Ctrl', '/'],
    altKeys: ['?'],
    label: {
      es: 'Abrir guía de atajos',
      en: 'Open shortcuts guide',
      pt: 'Abrir guia de atalhos',
    },
    clickable: false,
  },
  {
    id: 'close_modal',
    category: 'system',
    keys: ['Esc'],
    label: {
      es: 'Cerrar ventana o panel activo',
      en: 'Close active modal or drawer',
      pt: 'Fechar janela ou painel ativo',
    },
    clickable: false,
  },
];
