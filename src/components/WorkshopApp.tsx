import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  BarChart3,
  Bell,
  Boxes,
  CalendarDays,
  Factory,
  HelpCircle,
  Home,
  LogOut,
  MessageSquarePlus,
  Moon,
  MoreHorizontal,
  Plus,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sun,
  Users,
  WifiOff,
  Wrench,
  X,
} from 'lucide-react';
import {
  fetchOwnerRows,
  handleDbError,
  OperationType,
  subscribeTableChanges,
  supabase,
  type TableName,
} from '../lib/db';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useActiveCurrency } from '../utils/currency';
import { clearTransferConfigCache, hydrateTransferConfig } from '../utils/payment';
import {
  clearMercadoPagoConfigCache,
  hydrateMercadoPagoConfig,
} from '../utils/mercadoPago';
import {
  fetchSubscriptionStatus,
  getPlanDisplayName,
  getSubscriptionRemaining,
  verifySubscriptionPayment,
  type SignedSubscriptionRecord,
} from '../utils/subscription';
import {
  parseWorkshopMeta,
  saveSubscriptionToProfile,
  syncMercadoPagoConfigFromProfile,
} from '../utils/workshopMeta';
import {
  ACTION_GUIDES,
  getPendingContextualGuide,
  loadOnboardingState,
  markGuideScopeSeen,
  markWelcomeStepsSeen,
  PAGE_GUIDES,
  saveOnboardingState,
  WELCOME_TOUR_STEPS,
  type ActionGuideId,
  type OnboardingState,
} from '../utils/onboardingTour';
import { sanitizeDbErrorMessage } from '../utils/validation';
import type {
  ClientRecord,
  PageId,
  ProductRecord,
  PurchaseRecord,
  RepairRecord,
  SaleRecord,
  SupplierRecord,
  TaskRecord,
  WorkshopProfile,
} from '../types/workshop';
import { AdminTallerPage } from '../pages/AdminTallerPage';
import { AgendaPage } from '../pages/AgendaPage';
import { CashRegisterPage } from '../pages/CashRegisterPage';
import { ClientsPage } from '../pages/ClientsPage';
import { HomePage } from '../pages/HomePage';
import { InventoryPage } from '../pages/InventoryPage';
import { PurchasesPage } from '../pages/PurchasesPage';
import { RepairsPage } from '../pages/RepairsPage';
import { ReportsPage } from '../pages/ReportsPage';
import { SalesPage } from '../pages/SalesPage';
import { SuppliersPage } from '../pages/SuppliersPage';
import { BrandMark } from './BrandMark';
import { BatchReceiptModal } from './BatchReceiptModal';
import { BrandSettingsModal } from './BrandSettingsModal';
import { ClientDetailModal, NewClientModal } from './ClientModals';
import { GlobalSearchBar } from './GlobalSearchBar';
import { ContextualWindowGuide, WelcomeSpotlightTour } from './GuidedTourOverlay';
import { NewPurchaseModal } from './NewPurchaseModal';
import { NewRepairModal } from './NewRepairModal';
import { NewSaleModal } from './NewSaleModal';
import { NewSupplierModal } from './NewSupplierModal';
import { NewTaskModal } from './NewTaskModal';
import { ProductDetailModal } from './ProductDetailModal';
import { ProductImportModal } from './ProductImportModal';
import { ProductModal } from './ProductModal';
import { PWAInstallButton } from './PWAInstallButton';
import { RepairDetailModal } from './RepairDetailModal';
import { SalePrintModal } from './SalePrintModal';
import {
  PENDING_SUB_STORAGE_KEY,
  SubscriptionModal,
  type PendingCheckoutState,
} from './SubscriptionModal';
import { SupportModal } from './SupportModal';

interface WorkshopAppProps {
  userId: string;
  userEmail?: string | null;
  profile: WorkshopProfile;
  darkMode: boolean;
  onToggleDark: () => void;
}

interface NavItem {
  id: PageId;
  label: string;
  icon: React.FC<{ className?: string }>;
}

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Taller',
    items: [
      { id: 'home', label: 'Inicio', icon: Home },
      { id: 'repairs', label: 'Reparaciones', icon: Wrench },
      { id: 'agenda', label: 'Agenda', icon: CalendarDays },
      { id: 'clients', label: 'Clientes', icon: Users },
    ],
  },
  {
    title: 'Stock y Compras',
    items: [
      { id: 'inventory', label: 'Inventario y Productos', icon: Boxes },
      { id: 'suppliers', label: 'Proveedores', icon: Factory },
      { id: 'purchases', label: 'Compras', icon: Receipt },
    ],
  },
  {
    title: 'Ventas y Control',
    items: [
      { id: 'sales', label: 'Ventas', icon: ShoppingBag },
      { id: 'cash', label: 'Caja diaria', icon: Banknote },
      { id: 'reports', label: 'Reportes', icon: BarChart3 },
    ],
  },
];

const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

const MOBILE_MORE_ITEMS: NavItem[] = NAV_ITEMS.filter((item) =>
  ['agenda', 'suppliers', 'purchases', 'sales', 'cash', 'reports'].includes(item.id)
);

const PLATFORM_ADMIN_EMAIL = 'thebnb05@gmail.com';

export const WorkshopApp: React.FC<WorkshopAppProps> = ({
  userId,
  userEmail,
  profile,
  darkMode,
  onToggleDark,
}) => {
  const isOnline = useOnlineStatus();
  useActiveCurrency();
  const isPlatformAdmin =
    (userEmail || profile.email || '').trim().toLowerCase() === PLATFORM_ADMIN_EMAIL;
  const [page, setPage] = useState<PageId>('home');
  const [inventoryInitialFilter, setInventoryInitialFilter] = useState<
    'all' | 'repuestos' | 'accesorios' | 'bajo_stock'
  >('all');
  const [inventoryFilterNonce, setInventoryFilterNonce] = useState(0);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  useEffect(() => {
    if (!isPlatformAdmin && page === 'admin_taller') {
      setPage('home');
    }
  }, [isPlatformAdmin, page]);

  // Supabase real-time state scoped to the authenticated owner
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [repairs, setRepairs] = useState<RepairRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [loadingCount, setLoadingCount] = useState(7);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void hydrateTransferConfig(userId);
    void hydrateMercadoPagoConfig(userId).then((hydrated) => {
      if (!active) return;
      if (!hydrated.accessToken && !hydrated.terminalId && !hydrated.posExternalId) {
        syncMercadoPagoConfigFromProfile(userId, profile);
      }
    });
    const loadedSet = new Set<string>();
    setLoadingCount(7);
    setSyncError(null);

    const markLoaded = (tableName: string) => {
      if (!active || loadedSet.has(tableName)) return;
      loadedSet.add(tableName);
      setLoadingCount((prev) => Math.max(0, prev - 1));
    };

    const loadTable = async <T,>(
      tableName: TableName,
      setter: React.Dispatch<React.SetStateAction<T[]>>
    ) => {
      try {
        const items = await fetchOwnerRows<T>(tableName, userId);
        if (!active) return;
        setter(items);
        markLoaded(tableName);
      } catch (err) {
        if (!active) return;
        setSyncError(sanitizeDbErrorMessage(err, 'Error al sincronizar con Supabase.'));
        markLoaded(tableName);
        void handleDbError(err, OperationType.LIST, tableName).catch(() => {});
      }
    };

    const reloadByTable: Partial<Record<TableName, () => Promise<void>>> = {
      clients: () => loadTable<ClientRecord>('clients', setClients),
      repairs: () => loadTable<RepairRecord>('repairs', setRepairs),
      products: () => loadTable<ProductRecord>('products', setProducts),
      tasks: () => loadTable<TaskRecord>('tasks', setTasks),
      suppliers: () => loadTable<SupplierRecord>('suppliers', setSuppliers),
      sales: () => loadTable<SaleRecord>('sales', setSales),
      purchases: () => loadTable<PurchaseRecord>('purchases', setPurchases),
    };

    const tables = Object.keys(reloadByTable) as TableName[];
    tables.forEach((tbl) => {
      void reloadByTable[tbl]?.();
    });

    const localUnsubs = tables.map((tbl) =>
      subscribeTableChanges(tbl, () => {
        void reloadByTable[tbl]?.();
      })
    );

    const channel = supabase.channel(`workshop_sync_${userId}`);
    tables.forEach((tbl) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tbl, filter: `owner_id=eq.${userId}` },
        () => {
          const fn = reloadByTable[tbl];
          if (fn) void fn();
        }
      );
    });
    channel.subscribe();

    return () => {
      active = false;
      localUnsubs.forEach((unsub) => unsub());
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const isLoading = loadingCount > 0;

  // Modals state
  const [showBrandSettings, setShowBrandSettings] = useState(false);
  const [showNewRepair, setShowNewRepair] = useState(false);
  const [repairPreClient, setRepairPreClient] = useState<ClientRecord | null>(null);
  const [warrantySourceRepair, setWarrantySourceRepair] = useState<RepairRecord | null>(null);
  const [selectedRepairId, setSelectedRepairId] = useState<string | null>(null);
  const [justCreatedRepair, setJustCreatedRepair] = useState<RepairRecord | null>(null);
  const [repairModalInitialTab, setRepairModalInitialTab] = useState<'detail' | 'edit' | 'receipt'>('detail');
  const [batchPrintData, setBatchPrintData] = useState<{
    repairs: RepairRecord[];
    batchRef: string;
  } | null>(null);

  const [showClientModal, setShowClientModal] = useState(false);
  const [editClient, setEditClient] = useState<ClientRecord | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const [showProductModal, setShowProductModal] = useState(false);
  const [editProduct, setEditProduct] = useState<ProductRecord | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [showProductImport, setShowProductImport] = useState(false);

  const [showNewTask, setShowNewTask] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editSupplier, setEditSupplier] = useState<SupplierRecord | null>(null);

  const [showNewSale, setShowNewSale] = useState(false);
  const [saleProduct, setSaleProduct] = useState<ProductRecord | null>(null);
  const [editingSale, setEditingSale] = useState<SaleRecord | null>(null);
  const [selectedPrintSale, setSelectedPrintSale] = useState<SaleRecord | null>(null);
  const [showNewPurchase, setShowNewPurchase] = useState(false);

  // Platform subscription state & live countdown
  const [subscriptionRecord, setSubscriptionRecord] = useState<SignedSubscriptionRecord | null>(
    () => parseWorkshopMeta(profile).subscription || null
  );
  const [mpPlatformConfigured, setMpPlatformConfigured] = useState(true);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const fromProfile = parseWorkshopMeta(profile).subscription;
    if (fromProfile) {
      setSubscriptionRecord((prev) =>
        !prev || fromProfile.payload.updatedAt > prev.payload.updatedAt ? fromProfile : prev
      );
    }
  }, [profile]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const currentFromProfile = parseWorkshopMeta(profile).subscription || null;

    const syncSub = async () => {
      try {
        const res = await fetchSubscriptionStatus(currentFromProfile);
        if (!active || !res.ok || !res.subscription) return;
        setMpPlatformConfigured(Boolean(res.mpConfigured));
        setSubscriptionRecord(res.subscription);

        const changed =
          !currentFromProfile ||
          currentFromProfile.sig !== res.subscription.sig ||
          currentFromProfile.payload.expiresAt !== res.subscription.payload.expiresAt;
        if (changed) {
          void saveSubscriptionToProfile(profile, res.subscription).catch(() => {});
        }

        // Check Mercado Pago redirect callback params if user returned from payment
        const url = new URL(window.location.href);
        const mpSubParam = url.searchParams.get('mp_sub');
        const preapprovalId = url.searchParams.get('preapproval_id') || '';
        const paymentId = url.searchParams.get('payment_id') || url.searchParams.get('collection_id') || '';
        const extRef = url.searchParams.get('external_reference') || '';

        let pendingSaved: PendingCheckoutState | null = null;
        try {
          const rawPending = window.sessionStorage.getItem(PENDING_SUB_STORAGE_KEY);
          if (rawPending) pendingSaved = JSON.parse(rawPending) as PendingCheckoutState;
        } catch {
          // Ignore storage error
        }

        if (mpSubParam === 'return' || preapprovalId || paymentId || extRef) {
          const verifyRes = await verifySubscriptionPayment({
            planId: pendingSaved?.planId,
            providerId: preapprovalId || paymentId || pendingSaved?.providerId || '',
            kind: preapprovalId
              ? 'preapproval'
              : paymentId
                ? 'preference'
                : pendingSaved?.kind,
            externalReference: extRef || pendingSaved?.externalReference || '',
            subscriptionToken: res.subscription,
          });
          if (!active) return;
          if (verifyRes.ok && verifyRes.paid && verifyRes.subscription) {
            setSubscriptionRecord(verifyRes.subscription);
            void saveSubscriptionToProfile(profile, verifyRes.subscription).catch(() => {});
            try {
              window.sessionStorage.removeItem(PENDING_SUB_STORAGE_KEY);
            } catch {
              // Ignore
            }
          }
          url.searchParams.delete('mp_sub');
          url.searchParams.delete('preapproval_id');
          url.searchParams.delete('payment_id');
          url.searchParams.delete('collection_id');
          url.searchParams.delete('collection_status');
          url.searchParams.delete('status');
          url.searchParams.delete('external_reference');
          url.searchParams.delete('payment_type');
          url.searchParams.delete('merchant_order_id');
          url.searchParams.delete('preference_id');
          window.history.replaceState({}, '', url.toString());
        }
      } catch {
        // Keep cached/profile subscription if offline
      }
    };

    void syncSub();
    return () => {
      active = false;
    };
  }, [userId]);

  const subscriptionRemaining = useMemo(
    () => getSubscriptionRemaining(subscriptionRecord?.payload, nowMs),
    [subscriptionRecord, nowMs]
  );

  const isSubscriptionBlocking = Boolean(
    subscriptionRecord &&
      !subscriptionRecord.payload.isExemptAnnual &&
      subscriptionRemaining.isExpired
  );

  // Onboarding tour & per-window first-visit guides
  const [onboardingState, setOnboardingState] = useState<OnboardingState>(() =>
    loadOnboardingState(userId)
  );
  const [welcomeTourOpen, setWelcomeTourOpen] = useState(false);

  useEffect(() => {
    setOnboardingState(loadOnboardingState(userId));
  }, [userId]);

  useEffect(() => {
    if (isLoading || isSubscriptionBlocking) return;
    if (!onboardingState.welcomeTourDone && !onboardingState.dismissAllGuides) {
      setWelcomeTourOpen(true);
    }
  }, [isLoading, isSubscriptionBlocking, onboardingState.welcomeTourDone, onboardingState.dismissAllGuides]);

  const updateOnboarding = (updater: (prev: OnboardingState) => OnboardingState) => {
    setOnboardingState((prev) => {
      const next = updater(prev);
      saveOnboardingState(userId, next);
      return next;
    });
  };

  const lowStockCount = useMemo(
    () => products.filter((p) => p.trackStock && p.stock <= p.minStock).length,
    [products]
  );

  const selectedRepair = useMemo(
    () =>
      repairs.find((r) => r.id === selectedRepairId) ||
      (justCreatedRepair?.id === selectedRepairId ? justCreatedRepair : null),
    [repairs, selectedRepairId, justCreatedRepair]
  );

  const activeContextualGuide = useMemo(() => {
    if (
      isLoading ||
      isSubscriptionBlocking ||
      welcomeTourOpen ||
      !onboardingState.welcomeTourDone ||
      onboardingState.dismissAllGuides
    ) {
      return null;
    }

    let actionId: ActionGuideId | null = null;
    if (showSubscriptionModal) actionId = 'subscription';
    else if (showNewRepair) actionId = 'new_repair';
    else if (selectedRepair) actionId = 'repair_detail';
    else if (showNewSale) actionId = 'new_sale';
    else if (showBrandSettings) actionId = 'brand_settings';

    if (actionId) {
      const def = ACTION_GUIDES[actionId];
      const resolved = getPendingContextualGuide(`action:${actionId}`, def, onboardingState);
      if (!resolved) return null;
      return {
        scopeKey: `action:${actionId}`,
        def,
        resolved,
      };
    }

    if (page === 'admin_taller') return null;

    const pageDef = PAGE_GUIDES[page];
    const resolvedPage = getPendingContextualGuide(`page:${page}`, pageDef, onboardingState);
    if (!resolvedPage) return null;
    return {
      scopeKey: `page:${page}`,
      def: pageDef,
      resolved: resolvedPage,
    };
  }, [
    isLoading,
    isSubscriptionBlocking,
    welcomeTourOpen,
    onboardingState,
    showSubscriptionModal,
    showNewRepair,
    selectedRepair,
    showNewSale,
    showBrandSettings,
    page,
  ]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) || null,
    [clients, selectedClientId]
  );

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  const navigateTo = (target: PageId) => {
    if (target !== 'inventory') setInventoryInitialFilter('all');
    setPage(target);
    setMoreMenuOpen(false);
  };

  const openNewRepairFlow = (client?: ClientRecord | null) => {
    setWarrantySourceRepair(null);
    setRepairPreClient(client || null);
    setShowNewRepair(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-900">
        <div className="flex h-16 items-center gap-3 border-b border-slate-100 px-5 dark:border-slate-800">
          <BrandMark profile={profile} size="md" />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <nav data-tour="sidebar-nav" className="space-y-5" aria-label="Secciones principales">
            {NAV_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {group.title}
                </div>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = page === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigateTo(item.id)}
                        className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${
                          active
                            ? 'bg-sky-50 font-semibold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-400'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-white'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                        {item.id === 'inventory' && lowStockCount > 0 && (
                          <span className="ml-auto font-mono-num text-xs font-bold text-red-600 dark:text-red-400">
                            {lowStockCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {isPlatformAdmin && (
              <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Plataforma
                </div>
                <button
                  type="button"
                  onClick={() => navigateTo('admin_taller')}
                  className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${
                    page === 'admin_taller'
                      ? 'bg-sky-50 font-semibold text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-400'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-white'
                  }`}
                >
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span className="truncate">Admin de taller</span>
                </button>
              </div>
            )}
          </nav>

          <div data-tour="quick-actions" className="mt-6 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="mb-2 px-3 text-[11px] font-semibold text-slate-400">
              Acciones rápidas
            </div>
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => openNewRepairFlow()}
                className="flex h-9 w-full items-center gap-2 rounded-xl bg-[#0072BB] px-3 text-xs font-semibold text-white hover:bg-[#005f9c]"
              >
                <Plus className="h-3.5 w-3.5" />
                Nueva reparación
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditClient(null);
                  setShowClientModal(true);
                }}
                className="flex h-9 w-full items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Nuevo cliente
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditProduct(null);
                  setShowProductModal(true);
                }}
                className="flex h-9 w-full items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Nuevo producto
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-2 border-t border-slate-100 p-3 dark:border-slate-800">
          {subscriptionRecord && (
            <button
              type="button"
              onClick={() => setShowSubscriptionModal(true)}
              className={`flex w-full items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                subscriptionRecord.payload.isExemptAnnual
                  ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 hover:bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
                  : subscriptionRemaining.isExpired
                    ? 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
                    : subscriptionRemaining.days <= 5
                      ? 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
                      : 'border-sky-200 bg-sky-50/60 text-slate-800 hover:bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-slate-100'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-[11px] font-bold">
                  {getPlanDisplayName(
                    subscriptionRecord.payload.planId,
                    subscriptionRecord.payload.isExemptAnnual
                  )}
                </div>
                <div className="truncate font-mono-num text-[11px] opacity-85">
                  {subscriptionRemaining.shortLabel}
                </div>
              </div>
              <span className="shrink-0 rounded-lg bg-white/90 px-2 py-0.5 text-[10px] font-bold text-[#0072BB] dark:bg-slate-900 dark:text-sky-300">
                Planes
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSupportModal(true)}
            className="flex h-9 w-full items-center gap-2 rounded-xl border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <MessageSquarePlus className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
            <span>Soporte y sugerencias</span>
          </button>
          <div className="truncate px-2 text-xs font-medium text-slate-700 dark:text-slate-300">
            {profile.firstName
              ? `${profile.firstName} ${profile.lastName || ''}`.trim()
              : userEmail || 'Taller'}
          </div>
          <div className="truncate px-2 text-[11px] text-slate-400">
            {profile.role === 'admin' ? 'Administrador' : 'Operador'}
          </div>
        </div>
      </aside>

      {/* Main Layout */}
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-2.5 backdrop-blur-md sm:h-16 sm:gap-3 sm:px-4 lg:px-6 dark:border-slate-800 dark:bg-slate-900/90">
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="lg:hidden">
              <BrandMark
                profile={profile}
                size="sm"
                wordClassNames={{ 2: 'text-[10px] text-center', 3: 'text-[10px]' }}
              />
            </div>
            <span className="hidden text-sm font-semibold text-slate-500 lg:inline dark:text-slate-400">
              {page === 'admin_taller'
                ? 'Admin de taller'
                : NAV_ITEMS.find((n) => n.id === page)?.label}
            </span>
          </div>

          <GlobalSearchBar
            clients={clients}
            repairs={repairs}
            products={products}
            onSelectClient={(c) => setSelectedClientId(c.id)}
            onSelectRepair={(r) => setSelectedRepairId(r.id)}
            onSelectProduct={(p) => setSelectedProductId(p.id)}
          />

          <div data-tour="header-actions" className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            {subscriptionRecord && (() => {
              const shortPlanLabel = subscriptionRemaining.isExpired
                ? 'Vencida'
                : subscriptionRecord.payload.isExemptAnnual ||
                    subscriptionRecord.payload.planId === 'anual'
                  ? 'Anual'
                  : subscriptionRecord.payload.planId === 'semestral'
                    ? '6 Meses'
                    : subscriptionRecord.payload.planId === 'mensual'
                      ? 'Mensual'
                      : 'Prueba';

              return (
                <button
                  type="button"
                  data-tour="subscription-badge"
                  onClick={() => setShowSubscriptionModal(true)}
                  title={`${getPlanDisplayName(
                    subscriptionRecord.payload.planId,
                    subscriptionRecord.payload.isExemptAnnual
                  )} · ${subscriptionRemaining.detailLabel}`}
                  className={`hidden sm:inline-flex h-8 sm:h-9 shrink-0 items-center gap-1 rounded-xl border px-2 xl:px-2.5 text-[11px] xl:text-xs font-semibold transition whitespace-nowrap ${
                    subscriptionRecord.payload.isExemptAnnual
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200'
                      : subscriptionRemaining.isExpired
                        ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200'
                        : subscriptionRemaining.days <= 5
                          ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                          : 'border-sky-200 bg-sky-50/80 text-[#0072BB] hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
                  }`}
                >
                  <span className="xl:hidden">{shortPlanLabel}</span>
                  <span className="hidden xl:inline">
                    {getPlanDisplayName(
                      subscriptionRecord.payload.planId,
                      subscriptionRecord.payload.isExemptAnnual
                    )}
                    {' · '}
                    <span className="font-mono-num">
                      {subscriptionRemaining.isExpired
                        ? 'Vencida'
                        : subscriptionRemaining.days >= 1
                          ? `Faltan ${subscriptionRemaining.days}d`
                          : subscriptionRemaining.shortLabel}
                    </span>
                  </span>
                </button>
              );
            })()}
            <PWAInstallButton />

            <button
              type="button"
              onClick={() => setShowSupportModal(true)}
              aria-label="Soporte y sugerencias"
              title="Soporte y sugerencias"
              className="hidden lg:flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setWelcomeTourOpen(true)}
              aria-label="Ver tour guiado"
              title="Tour guiado"
              className="hidden lg:flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <HelpCircle className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                setInventoryInitialFilter('bajo_stock');
                setInventoryFilterNonce((n) => n + 1);
                setPage('inventory');
                setMoreMenuOpen(false);
              }}
              aria-label="Alertas de stock bajo"
              title="Stock bajo"
              className="relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Bell className="h-4 w-4" />
              {lowStockCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 font-mono-num text-[10px] font-bold text-white">
                  {lowStockCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowBrandSettings(true)}
              aria-label="Configuración"
              title="Configuración"
              className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Settings className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onToggleDark}
              aria-label={darkMode ? 'Activar modo claro' : 'Activar modo oscuro'}
              className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={() => {
                clearTransferConfigCache(userId);
                clearMercadoPagoConfigCache(userId);
                void supabase.auth.signOut();
              }}
              aria-label="Cerrar sesión"
              title="Salir"
              className="inline-flex h-9 sm:h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-2.5 lg:px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Salir</span>
            </button>
          </div>
        </header>

        <main className="no-print mx-auto max-w-7xl px-4 pb-24 pt-5 sm:px-6 lg:pb-10">
          {!isOnline && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span>Sin conexión — Estás viendo datos en caché. Los cambios se sincronizarán al reconectar.</span>
            </div>
          )}

          {syncError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
              Error al sincronizar con Supabase: {syncError}
            </div>
          )}

          {isLoading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                {[1, 2, 3].map((k) => (
                  <div
                    key={k}
                    className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  />
                ))}
              </div>
              <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
            </div>
          ) : (
            <>
              {page === 'home' && (
                <HomePage
                  repairs={repairs}
                  clients={clients}
                  products={products}
                  sales={sales}
                  purchases={purchases}
                  onNavigate={navigateTo}
                  onNewRepair={() => openNewRepairFlow()}
                  onNewClient={() => {
                    setEditClient(null);
                    setShowClientModal(true);
                  }}
                  onNewProduct={() => {
                    setEditProduct(null);
                    setShowProductModal(true);
                  }}
                  onSelectRepair={(r) => setSelectedRepairId(r.id)}
                  onSelectClient={(c) => setSelectedClientId(c.id)}
                />
              )}

              {page === 'repairs' && (
                <RepairsPage
                  repairs={repairs}
                  profile={profile}
                  onNewRepair={() => openNewRepairFlow()}
                  onSelectRepair={(r) => setSelectedRepairId(r.id)}
                />
              )}

              {page === 'clients' && (
                <ClientsPage
                  clients={clients}
                  repairs={repairs}
                  sales={sales}
                  onNewClient={() => {
                    setEditClient(null);
                    setShowClientModal(true);
                  }}
                  onSelectClient={(c) => setSelectedClientId(c.id)}
                />
              )}

              {page === 'inventory' && (
                <InventoryPage
                  products={products}
                  initialFilter={inventoryInitialFilter}
                  filterNonce={inventoryFilterNonce}
                  onNewProduct={() => {
                    setEditProduct(null);
                    setShowProductModal(true);
                  }}
                  onImportProducts={() => setShowProductImport(true)}
                  onSelectProduct={(p) => setSelectedProductId(p.id)}
                />
              )}

              {page === 'agenda' && (
                <AgendaPage
                  tasks={tasks}
                  repairs={repairs}
                  onNewTask={() => setShowNewTask(true)}
                  onSelectRepair={(r) => setSelectedRepairId(r.id)}
                />
              )}

              {page === 'suppliers' && (
                <SuppliersPage
                  suppliers={suppliers}
                  onNewSupplier={() => {
                    setEditSupplier(null);
                    setShowSupplierModal(true);
                  }}
                  onEditSupplier={(s) => {
                    setEditSupplier(s);
                    setShowSupplierModal(true);
                  }}
                />
              )}

              {page === 'sales' && (
                <SalesPage
                  sales={sales}
                  products={products}
                  profile={profile}
                  onNewSale={() => {
                    setSaleProduct(null);
                    setEditingSale(null);
                    setShowNewSale(true);
                  }}
                  onEditSale={(s) => {
                    setSaleProduct(null);
                    setEditingSale(s);
                    setShowNewSale(true);
                  }}
                  onPrintSale={(s) => setSelectedPrintSale(s)}
                />
              )}

              {page === 'cash' && (
                <CashRegisterPage
                  ownerId={userId}
                  tasks={tasks}
                  sales={sales}
                  repairs={repairs}
                  purchases={purchases}
                  profile={profile}
                />
              )}

              {page === 'purchases' && (
                <PurchasesPage
                  purchases={purchases}
                  profile={profile}
                  onNewPurchase={() => setShowNewPurchase(true)}
                />
              )}

              {page === 'reports' && (
                <ReportsPage
                  profile={profile}
                  repairs={repairs}
                  clients={clients}
                  products={products}
                  sales={sales}
                  purchases={purchases}
                  onSelectProduct={(p) => setSelectedProductId(p.id)}
                />
              )}

              {page === 'admin_taller' && isPlatformAdmin && (
                <AdminTallerPage userEmail={userEmail} />
              )}
            </>
          )}
        </main>
      </div>

      {/* Mobile / Tablet Bottom Navigation (compact <= 64px) */}
      <nav
        data-tour="mobile-nav"
        aria-label="Navegación móvil"
        className="no-print fixed bottom-0 left-0 right-0 z-30 grid h-16 grid-cols-5 border-t border-slate-200 bg-white/95 backdrop-blur-md lg:hidden dark:border-slate-800 dark:bg-slate-900/95"
      >
        {[
          { id: 'home' as PageId, label: 'Inicio', icon: Home },
          { id: 'repairs' as PageId, label: 'Equipos', icon: Wrench },
          { id: 'clients' as PageId, label: 'Clientes', icon: Users },
          { id: 'inventory' as PageId, label: 'Inventario', icon: Boxes },
        ].map((item) => {
          const Icon = item.icon;
          const active = page === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateTo(item.id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition ${
                active
                  ? 'text-[#0072BB] dark:text-sky-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
              {item.id === 'inventory' && lowStockCount > 0 && (
                <span className="absolute right-3 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 font-mono-num text-[9px] font-bold text-white">
                  {lowStockCount}
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreMenuOpen((prev) => !prev)}
          className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition ${
            moreMenuOpen ||
            ['agenda', 'suppliers', 'sales', 'cash', 'purchases', 'reports', 'admin_taller'].includes(
              page
            )
              ? 'text-[#0072BB] dark:text-sky-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>Más</span>
        </button>
      </nav>

      {/* Mobile "Más" Drawer */}
      {moreMenuOpen && (
        <div
          className="no-print fixed inset-0 z-40 flex items-end bg-slate-950/50 backdrop-blur-xs lg:hidden"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMoreMenuOpen(false);
          }}
        >
          <div className="w-full rounded-t-3xl border-t border-slate-200 bg-white p-5 pb-8 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-bold text-slate-900 dark:text-white font-display">
                Más secciones
              </span>
              <button
                type="button"
                onClick={() => setMoreMenuOpen(false)}
                aria-label="Cerrar menú"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {MOBILE_MORE_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = page === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateTo(item.id)}
                    className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-xs font-semibold transition ${
                      active
                        ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] dark:border-sky-400 dark:bg-sky-950/50 dark:text-sky-300'
                        : 'border-slate-200 text-slate-700 dark:border-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              {isPlatformAdmin && (
                <button
                  type="button"
                  onClick={() => navigateTo('admin_taller')}
                  className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-xs font-semibold transition ${
                    page === 'admin_taller'
                      ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] dark:border-sky-400 dark:bg-sky-950/50 dark:text-sky-300'
                      : 'border-slate-200 text-slate-700 dark:border-slate-800 dark:text-slate-200'
                  }`}
                >
                  <ShieldCheck className="h-5 w-5" />
                  <span className="text-center leading-tight">Admin de taller</span>
                </button>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  setShowSupportModal(true);
                }}
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200"
              >
                <MessageSquarePlus className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
                <span>Soporte</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  setWelcomeTourOpen(true);
                }}
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200"
              >
                <HelpCircle className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
                <span>Tour guiado</span>
              </button>
            </div>
            {subscriptionRecord && (
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  setShowSubscriptionModal(true);
                }}
                className="mt-2 flex w-full items-center justify-between rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2 text-left text-xs font-semibold text-[#0072BB] dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300"
              >
                <span>
                  {getPlanDisplayName(
                    subscriptionRecord.payload.planId,
                    subscriptionRecord.payload.isExemptAnnual
                  )}
                </span>
                <span className="font-mono-num">
                  {subscriptionRemaining.isExpired
                    ? 'Vencida · Renovar'
                    : subscriptionRemaining.shortLabel}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <BrandSettingsModal
        open={showBrandSettings}
        onClose={() => setShowBrandSettings(false)}
        profile={profile}
        userEmail={userEmail}
        subscriptionRecord={subscriptionRecord}
        nowMs={nowMs}
        onOpenSubscription={() => setShowSubscriptionModal(true)}
      />

      <NewRepairModal
        open={showNewRepair}
        onClose={() => {
          setShowNewRepair(false);
          setRepairPreClient(null);
          setWarrantySourceRepair(null);
        }}
        onCreated={(created) => {
          setJustCreatedRepair(created);
          setRepairModalInitialTab('receipt');
          setSelectedRepairId(created.id);
        }}
        onBatchCreated={(createdList, batchRef) => {
          setBatchPrintData({ repairs: createdList, batchRef });
        }}
        ownerId={userId}
        profile={profile}
        clients={clients}
        repairs={repairs}
        products={products}
        preselectedClient={repairPreClient}
        warrantyFromRepair={warrantySourceRepair}
      />

      <RepairDetailModal
        repair={selectedRepair}
        clients={clients}
        products={products}
        profile={profile}
        initialTab={repairModalInitialTab}
        justCreated={Boolean(justCreatedRepair && justCreatedRepair.id === selectedRepairId)}
        onOpenBatch={(batchRef) => {
          const matching = repairs
            .filter((r) => (r.notes || '').toUpperCase().includes(`[LOTE: ${batchRef.toUpperCase()}`))
            .sort((a, b) => a.code.localeCompare(b.code));
          if (matching.length > 0) {
            setSelectedRepairId(null);
            setBatchPrintData({ repairs: matching, batchRef });
          }
        }}
        onWarrantyReentry={(sourceRepair) => {
          setSelectedRepairId(null);
          setRepairPreClient(null);
          setWarrantySourceRepair(sourceRepair);
          setShowNewRepair(true);
        }}
        onClose={() => {
          setSelectedRepairId(null);
          setJustCreatedRepair(null);
          setRepairModalInitialTab('detail');
        }}
      />

      <BatchReceiptModal
        open={Boolean(batchPrintData)}
        repairs={batchPrintData?.repairs || []}
        batchRef={batchPrintData?.batchRef || ''}
        profile={profile}
        onClose={() => setBatchPrintData(null)}
        onSelectRepair={(r) => {
          setBatchPrintData(null);
          setRepairModalInitialTab('detail');
          setSelectedRepairId(r.id);
        }}
      />

      <NewClientModal
        open={showClientModal}
        onClose={() => {
          setShowClientModal(false);
          setEditClient(null);
        }}
        ownerId={userId}
        editClient={editClient}
      />

      <ClientDetailModal
        client={selectedClient}
        repairs={repairs}
        sales={sales}
        onClose={() => setSelectedClientId(null)}
        onEdit={(c) => {
          setEditClient(c);
          setShowClientModal(true);
        }}
        onNewRepairForClient={(c) => openNewRepairFlow(c)}
        onSelectRepair={(r) => setSelectedRepairId(r.id)}
      />

      <ProductModal
        open={showProductModal}
        onClose={() => {
          setShowProductModal(false);
          setEditProduct(null);
        }}
        ownerId={userId}
        suppliers={suppliers}
        products={products}
        editProduct={editProduct}
      />

      <ProductDetailModal
        product={selectedProduct}
        onClose={() => setSelectedProductId(null)}
        onEdit={(p) => {
          setEditProduct(p);
          setShowProductModal(true);
        }}
        onSell={(p) => {
          setSaleProduct(p);
          setShowNewSale(true);
        }}
      />

      <ProductImportModal
        open={showProductImport}
        onClose={() => setShowProductImport(false)}
        ownerId={userId}
        existingProducts={products}
      />

      <NewTaskModal
        open={showNewTask}
        onClose={() => setShowNewTask(false)}
        ownerId={userId}
      />

      <NewSupplierModal
        open={showSupplierModal}
        onClose={() => {
          setShowSupplierModal(false);
          setEditSupplier(null);
        }}
        ownerId={userId}
        editSupplier={editSupplier}
      />

      <NewSaleModal
        open={showNewSale}
        onClose={() => {
          setShowNewSale(false);
          setSaleProduct(null);
          setEditingSale(null);
        }}
        ownerId={userId}
        clients={clients}
        products={products}
        preselectedProduct={saleProduct}
        editSale={editingSale}
        profile={profile}
        brandName={profile.brandName}
        onCreated={(createdSale) => setSelectedPrintSale(createdSale)}
      />

      <SalePrintModal
        sale={
          selectedPrintSale
            ? sales.find((s) => s.id === selectedPrintSale.id) || selectedPrintSale
            : null
        }
        onClose={() => setSelectedPrintSale(null)}
        profile={profile}
        clients={clients}
      />

      <NewPurchaseModal
        open={showNewPurchase}
        onClose={() => setShowNewPurchase(false)}
        ownerId={userId}
        suppliers={suppliers}
        products={products}
        profile={profile}
      />

      <SubscriptionModal
        open={showSubscriptionModal || isSubscriptionBlocking}
        blocking={isSubscriptionBlocking}
        onClose={() => setShowSubscriptionModal(false)}
        subscriptionRecord={subscriptionRecord}
        mpConfigured={mpPlatformConfigured}
        nowMs={nowMs}
        onSubscriptionUpdated={(next) => {
          setSubscriptionRecord(next);
          void saveSubscriptionToProfile(profile, next).catch(() => {});
        }}
        onSignOut={() => {
          clearTransferConfigCache(userId);
          clearMercadoPagoConfigCache(userId);
          void supabase.auth.signOut();
        }}
      />

      <SupportModal
        open={showSupportModal}
        onClose={() => setShowSupportModal(false)}
        profile={profile}
        userEmail={userEmail}
        currentPage={page}
      />

      <WelcomeSpotlightTour
        open={welcomeTourOpen}
        steps={WELCOME_TOUR_STEPS}
        onComplete={() => {
          setWelcomeTourOpen(false);
          updateOnboarding((prev) => markWelcomeStepsSeen(prev, WELCOME_TOUR_STEPS));
        }}
        onSkip={() => {
          setWelcomeTourOpen(false);
          updateOnboarding((prev) => markWelcomeStepsSeen(prev, WELCOME_TOUR_STEPS));
        }}
      />

      <ContextualWindowGuide
        guide={activeContextualGuide?.resolved || null}
        onDismissCurrent={() => {
          if (!activeContextualGuide) return;
          updateOnboarding((prev) =>
            markGuideScopeSeen(prev, activeContextualGuide.scopeKey, activeContextualGuide.def)
          );
        }}
        onDismissAll={() => {
          setWelcomeTourOpen(false);
          updateOnboarding((prev) => ({
            ...markWelcomeStepsSeen(prev, WELCOME_TOUR_STEPS),
            dismissAllGuides: true,
          }));
        }}
      />
    </div>
  );
};
