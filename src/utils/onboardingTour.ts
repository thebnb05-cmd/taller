import type { PageId } from '../types/workshop';

export type ActionGuideId = 'new_repair' | 'repair_detail' | 'new_sale' | 'brand_settings';

export interface GuideBullet {
  id: string;
  text: string;
}

export interface ContextualGuideDef {
  title: string;
  subtitle: string;
  bullets: GuideBullet[];
}

export interface ResolvedContextualGuide {
  scopeKey: string;
  title: string;
  subtitle: string;
  bullets: GuideBullet[];
  isIncrementalUpdate: boolean;
}

export interface OnboardingState {
  welcomeTourDone: boolean;
  seenWelcomeStepIds: Record<string, boolean>;
  seenGuideItems: Record<string, boolean>;
  dismissAllGuides: boolean;
}

export interface WelcomeTourStep {
  id: string;
  targetSelector?: string;
  mobileTargetSelector?: string;
  title: string;
  description: string;
  tips: string[];
}

/**
 * REGISTRO CENTRAL DEL TOUR GUIADO
 * ---------------------------------
 * Cada nueva ventana o funcionalidad agregada acá (con un `id` único en `bullets`
 * o un nuevo paso en `WELCOME_TOUR_STEPS`) se suma automáticamente al tour:
 * - Usuarios nuevos: ven la guía completa la primera vez que entran a cada ventana.
 * - Usuarios existentes: ven únicamente los ítems nuevos agregados en esa ventana
 *   y, al tocar "Entendido", no vuelven a aparecer más.
 */

const STORAGE_PREFIX = 'th3bnb_onboarding_v1_';

const DEFAULT_STATE: OnboardingState = {
  welcomeTourDone: false,
  seenWelcomeStepIds: {},
  seenGuideItems: {},
  dismissAllGuides: false,
};

function getStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId || 'default'}`;
}

export const WELCOME_TOUR_STEPS: WelcomeTourStep[] = [
  {
    id: 'welcome',
    title: '¡Bienvenido a tu sistema de gestión!',
    description:
      'En menos de un minuto te mostramos dónde está cada herramienta para organizar reparaciones, clientes, stock y caja sin complicaciones.',
    tips: [
      'Cada vez que entres por primera vez a una ventana vas a ver una breve guía con sus funciones clave.',
      'Cuando ya la hayas visto o la cierres, no volverá a aparecer automáticamente.',
    ],
  },
  {
    id: 'search',
    targetSelector: '[data-tour="global-search"]',
    mobileTargetSelector: '[data-tour="global-search-mobile"]',
    title: 'Buscador global instantáneo',
    description:
      'Desde acá buscás cualquier orden (por código, IMEI/serie o falla), cliente o producto del inventario sin cambiar de pantalla.',
    tips: [
      'Hacé clic en un resultado para abrir directamente la ficha del equipo, cliente o producto.',
    ],
  },
  {
    id: 'quick-actions',
    targetSelector: '[data-tour="quick-actions"]',
    mobileTargetSelector: '[data-tour="mobile-nav"]',
    title: 'Acciones rápidas y carga de órdenes',
    description:
      'Creá una nueva reparación, registrá un cliente o sumá productos al stock con un toque desde cualquier parte del taller.',
    tips: [
      'Podés cargar varios equipos de un mismo cliente en una sola boleta en lote.',
    ],
  },
  {
    id: 'navigation',
    targetSelector: '[data-tour="sidebar-nav"]',
    mobileTargetSelector: '[data-tour="mobile-nav"]',
    title: 'Todas las secciones del taller',
    description:
      'Navegá entre Reparaciones (Tarjetas y Kanban), Agenda, Clientes, Inventario, Proveedores, Compras, Ventas y Reportes.',
    tips: [
      'En celular encontrás las secciones adicionales tocando el botón «Más» abajo a la derecha.',
    ],
  },
  {
    id: 'settings',
    targetSelector: '[data-tour="header-actions"]',
    title: 'Configuración, alertas y ayuda',
    description:
      'La campanita te avisa cuando un repuesto tiene stock bajo. En el engranaje configurás el logo, términos de boleta, técnicos opcionales y monedas.',
    tips: [
      'Si alguna vez querés repetir este recorrido, podés abrirlo desde el ícono «?» en la barra superior.',
    ],
  },
];

export const PAGE_GUIDES: Record<PageId, ContextualGuideDef> = {
  home: {
    title: 'Guía rápida · Inicio',
    subtitle: 'Tu tablero general del taller en tiempo real',
    bullets: [
      {
        id: 'home_metrics_charts',
        text: 'Visualizá tarjetas interactivas con ventas del mes, reparaciones activas por etapa y balance ingresos vs. gastos.',
      },
      {
        id: 'home_quick_access',
        text: 'Usá los botones de acceso rápido para iniciar una reparación, venta o alta de cliente.',
      },
      {
        id: 'home_recent_orders',
        text: 'Tocá cualquier orden reciente o alerta para ir directo a su ficha.',
      },
    ],
  },
  repairs: {
    title: 'Guía rápida · Reparaciones',
    subtitle: 'Controlá cada equipo desde el ingreso hasta la entrega',
    bullets: [
      {
        id: 'repairs_kanban_dnd',
        text: 'Alterná entre vista Tarjetas y vista Kanban para arrastrar y soltar órdenes entre etapas.',
      },
      {
        id: 'repairs_filters',
        text: 'Filtrá por estado, técnico asignado o buscá por código, cliente o número de serie.',
      },
      {
        id: 'repairs_open_detail',
        text: 'Tocá cualquier orden para actualizar avances, subir fotos al seguimiento o imprimir boletas.',
      },
    ],
  },
  agenda: {
    title: 'Guía rápida · Agenda',
    subtitle: 'Organizá entregas estimadas y tareas pendientes',
    bullets: [
      {
        id: 'agenda_deliveries',
        text: 'Visualizá las fechas de entrega comprometidas de tus reparaciones activas.',
      },
      {
        id: 'agenda_tasks',
        text: 'Creá recordatorios o tareas internas del taller con «Nueva tarea» y tildalas al completarlas.',
      },
    ],
  },
  clients: {
    title: 'Guía rápida · Clientes',
    subtitle: 'Base de clientes e historial completo',
    bullets: [
      {
        id: 'clients_extended_fields',
        text: 'Cargá datos completos: teléfono alternativo, tipo (particular/empresa), CUIT y localidad/barrio.',
      },
      {
        id: 'clients_history',
        text: 'Hacé clic en un cliente para ver todas sus reparaciones, compras y crearle una orden directa.',
      },
      {
        id: 'clients_csv_export',
        text: 'Exportá tu listado a CSV en un clic para usar en Excel o contabilidad.',
      },
    ],
  },
  inventory: {
    title: 'Guía rápida · Inventario',
    subtitle: 'Repuestos, accesorios y control de stock mínimo',
    bullets: [
      {
        id: 'inventory_filters',
        text: 'Filtrá rápidamente entre repuestos, accesorios o artículos con stock bajo.',
      },
      {
        id: 'inventory_import_csv',
        text: 'Usá el botón de importar planilla o Exportar CSV para actualizar o respaldar tu catálogo.',
      },
      {
        id: 'inventory_auto_stock',
        text: 'Al vender o asociar repuestos a una reparación, el stock se descuenta automáticamente.',
      },
    ],
  },
  suppliers: {
    title: 'Guía rápida · Proveedores',
    subtitle: 'Tus distribuidores de repuestos e insumos',
    bullets: [
      {
        id: 'suppliers_directory',
        text: 'Registrá contacto, dirección y notas de tus proveedores habituales.',
      },
      {
        id: 'suppliers_link',
        text: 'Asociarlos te agiliza la carga de productos nuevos y el registro de compras.',
      },
    ],
  },
  purchases: {
    title: 'Guía rápida · Compras',
    subtitle: 'Registro de gastos, reposición e insumos',
    bullets: [
      {
        id: 'purchases_register',
        text: 'Cargá tus facturas o compras de repuestos (en moneda base o secundaria).',
      },
      {
        id: 'purchases_balance',
        text: 'Estos egresos se reflejan automáticamente en el balance de Inicio y Reportes.',
      },
    ],
  },
  sales: {
    title: 'Guía rápida · Ventas',
    subtitle: 'Caja directa de accesorios, equipos y servicios',
    bullets: [
      {
        id: 'sales_methods',
        text: 'Registrá ventas en efectivo, tarjeta o transferencia con tu Alias/CBU y QR visible.',
      },
      {
        id: 'sales_receipts',
        text: 'Emití tickets térmicos 80mm o comprobantes A4 al instante después de cobrar.',
      },
      {
        id: 'sales_csv_export',
        text: 'Exportá el historial de ventas a CSV para control contable externo.',
      },
    ],
  },
  reports: {
    title: 'Guía rápida · Reportes',
    subtitle: 'Rendimiento, ingresos y movimientos del taller',
    bullets: [
      {
        id: 'reports_kpis',
        text: 'Consultá métricas detalladas de facturación, gastos, reparaciones terminadas y stock crítico.',
      },
      {
        id: 'reports_compare',
        text: 'Compará períodos para tomar mejores decisiones de precios y reposición.',
      },
    ],
  },
};

export const ACTION_GUIDES: Record<ActionGuideId, ContextualGuideDef> = {
  new_repair: {
    title: 'Guía rápida · Nueva reparación',
    subtitle: 'Cómo cargar una orden completa paso a paso',
    bullets: [
      {
        id: 'new_repair_other_devices',
        text: 'Paso 1: Elegí el tipo de equipo. En «Otros equipos» tenés categoría, accesorios y Check-in físico/funcional adaptado.',
      },
      {
        id: 'new_repair_checkin',
        text: 'Paso 2: Seleccioná o creá el cliente, describí la falla, accesorios y marcá el Check-in físico/funcional.',
      },
      {
        id: 'new_repair_batch',
        text: '¿Trae varios equipos? Usá «Agregar otro equipo» antes de guardar para generar una boleta en lote.',
      },
    ],
  },
  repair_detail: {
    title: 'Guía rápida · Ficha de reparación',
    subtitle: 'Todo lo que podés gestionar sobre esta orden',
    bullets: [
      {
        id: 'repair_detail_edit_media',
        text: 'En Editar actualizás estado, presupuesto, repuestos y fotos/videos para el seguimiento en línea del cliente.',
      },
      {
        id: 'repair_detail_signature',
        text: 'Capturá la firma del cliente con el dedo o mouse para que salga en la boleta A4, térmica 80mm y PDF.',
      },
      {
        id: 'repair_detail_print',
        text: 'En Boleta / Imprimir generás comprobante A4, ticket térmico 80mm, PDF o enviás el link por WhatsApp.',
      },
    ],
  },
  new_sale: {
    title: 'Guía rápida · Nueva venta',
    subtitle: 'Cobro rápido y emisión de comprobante',
    bullets: [
      {
        id: 'new_sale_stock',
        text: 'Sumá uno o varios productos del inventario; el stock se actualiza al confirmar.',
      },
      {
        id: 'new_sale_transfer_qr',
        text: 'Si elegís Transferencia podés cargar tu Alias, CBU y QR una vez y mostrarlo en pantalla y boleta.',
      },
    ],
  },
  brand_settings: {
    title: 'Guía rápida · Configuración del taller',
    subtitle: 'Personalizá la identidad y reglas de tu negocio',
    bullets: [
      {
        id: 'settings_branding',
        text: 'Configurá el nombre comercial, logo, WhatsApp, dirección y términos de la boleta.',
      },
      {
        id: 'settings_techs_currency',
        text: 'Activá o desactivá la asignación opcional de técnicos y agregá monedas secundarias con cotización.',
      },
    ],
  },
};

export function loadOnboardingState(userId: string): OnboardingState {
  if (typeof window === 'undefined') return { ...DEFAULT_STATE };
  try {
    const raw = window.localStorage.getItem(getStorageKey(userId));
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<OnboardingState> & {
      visitedPages?: Record<string, boolean>;
      visitedActions?: Record<string, boolean>;
    };

    const seenGuideItems: Record<string, boolean> =
      parsed.seenGuideItems && typeof parsed.seenGuideItems === 'object'
        ? { ...parsed.seenGuideItems }
        : {};

    // Smooth migration from legacy boolean visitedPages / visitedActions
    if (parsed.visitedPages && typeof parsed.visitedPages === 'object') {
      for (const [pageKey, visited] of Object.entries(parsed.visitedPages)) {
        if (!visited) continue;
        const def = PAGE_GUIDES[pageKey as PageId];
        if (!def) continue;
        for (const bullet of def.bullets) {
          seenGuideItems[`page:${pageKey}:${bullet.id}`] = true;
        }
      }
    }
    if (parsed.visitedActions && typeof parsed.visitedActions === 'object') {
      for (const [actionKey, visited] of Object.entries(parsed.visitedActions)) {
        if (!visited) continue;
        const def = ACTION_GUIDES[actionKey as ActionGuideId];
        if (!def) continue;
        for (const bullet of def.bullets) {
          seenGuideItems[`action:${actionKey}:${bullet.id}`] = true;
        }
      }
    }

    const seenWelcomeStepIds: Record<string, boolean> =
      parsed.seenWelcomeStepIds && typeof parsed.seenWelcomeStepIds === 'object'
        ? { ...parsed.seenWelcomeStepIds }
        : {};

    if (parsed.welcomeTourDone && Object.keys(seenWelcomeStepIds).length === 0) {
      for (const step of WELCOME_TOUR_STEPS) {
        seenWelcomeStepIds[step.id] = true;
      }
    }

    return {
      welcomeTourDone: Boolean(parsed.welcomeTourDone),
      seenWelcomeStepIds,
      seenGuideItems,
      dismissAllGuides: Boolean(parsed.dismissAllGuides),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveOnboardingState(userId: string, state: OnboardingState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getStorageKey(userId), JSON.stringify(state));
  } catch {
    // Ignore storage quota / private mode restrictions
  }
}

export function getUnseenWelcomeSteps(state: OnboardingState): WelcomeTourStep[] {
  return WELCOME_TOUR_STEPS.filter((step) => !state.seenWelcomeStepIds[step.id]);
}

export function markWelcomeStepsSeen(
  state: OnboardingState,
  steps: WelcomeTourStep[] = WELCOME_TOUR_STEPS
): OnboardingState {
  const nextSeen = { ...state.seenWelcomeStepIds };
  for (const step of steps) {
    nextSeen[step.id] = true;
  }
  return {
    ...state,
    welcomeTourDone: true,
    seenWelcomeStepIds: nextSeen,
  };
}

export function getPendingContextualGuide(
  scopeKey: string,
  def: ContextualGuideDef,
  state: OnboardingState
): ResolvedContextualGuide | null {
  const unseenBullets = def.bullets.filter(
    (b) => !state.seenGuideItems[`${scopeKey}:${b.id}`]
  );
  if (unseenBullets.length === 0) {
    return null;
  }

  const seenCount = def.bullets.length - unseenBullets.length;
  const isIncrementalUpdate = seenCount > 0;

  return {
    scopeKey,
    title: isIncrementalUpdate
      ? def.title.replace('Guía rápida · ', 'Novedades · ')
      : def.title,
    subtitle: isIncrementalUpdate
      ? 'Funciones nuevas agregadas en esta ventana'
      : def.subtitle,
    bullets: isIncrementalUpdate ? unseenBullets : def.bullets,
    isIncrementalUpdate,
  };
}

export function markGuideScopeSeen(
  state: OnboardingState,
  scopeKey: string,
  def: ContextualGuideDef
): OnboardingState {
  const nextSeen = { ...state.seenGuideItems };
  for (const bullet of def.bullets) {
    nextSeen[`${scopeKey}:${bullet.id}`] = true;
  }
  return {
    ...state,
    seenGuideItems: nextSeen,
  };
}
