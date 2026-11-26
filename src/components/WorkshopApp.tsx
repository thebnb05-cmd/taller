import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  BarChart3,
  Boxes,
  CalendarDays,
  Factory,
  HelpCircle,
  Home,
  Keyboard,
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
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';
import { useFxAutoSyncService } from '../hooks/useFxAutoSyncService';
import { useActiveCurrency } from '../utils/currency';
import { useI18n } from '../utils/i18n';
import {
  formatShortcutKey,
  getShortcutsEnabled,
  isMacPlatform,
  setShortcutsEnabled as persistShortcutsEnabled,
  type ShortcutActionId,
} from '../utils/keyboardShortcuts';
import { clearTransferConfigCache, hydrateTransferConfig } from '../utils/payment';
import {
  clearMercadoPagoConfigCache,
  fetchRecentMercadoPagoPayments,
  hydrateMercadoPagoConfig,
  loadMercadoPagoConfig,
  type MpRecentPayment,
} from '../utils/mercadoPago';
import {
  mergeSyncedMpPayments,
  useRecoveredPayments,
} from '../utils/paymentLedger';
import { syncAllElectronicPaymentsToPurchases } from '../utils/mpPurchasesSync';
import {
  fetchSubscriptionStatus,
  getPlanDisplayName,
  getSubscriptionRemaining,
  PENDING_SUB_STORAGE_KEY,
  verifySubscriptionPayment,
  type PendingCheckoutState,
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
import {
  isReadyRepairStatus,
  normalizeRepairStatusKey,
  sendRepairReadyPushNotification,
} from '../utils/pushNotifications';
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
import { BrandMark } from './BrandMark';
import { CurrencyConverter } from './CurrencyConverter';
import { GlobalSearchBar } from './GlobalSearchBar';
import { PushNotificationControl } from './PushNotificationControl';
import { PWAInstallButton } from './PWAInstallButton';
import { useToast } from './ToastProvider';

const AdminTallerPage = React.lazy(() =>
  import('../pages/AdminTallerPage').then((m) => ({ default: m.AdminTallerPage }))
);
const AgendaPage = React.lazy(() =>
  import('../pages/AgendaPage').then((m) => ({ default: m.AgendaPage }))
);
const CashRegisterPage = React.lazy(() =>
  import('../pages/CashRegisterPage').then((m) => ({ default: m.CashRegisterPage }))
);
const ClientsPage = React.lazy(() =>
  import('../pages/ClientsPage').then((m) => ({ default: m.ClientsPage }))
);
const HomePage = React.lazy(() =>
  import('../pages/HomePage').then((m) => ({ default: m.HomePage }))
);
const InventoryPage = React.lazy(() =>
  import('../pages/InventoryPage').then((m) => ({ default: m.InventoryPage }))
);
const PurchasesPage = React.lazy(() =>
  import('../pages/PurchasesPage').then((m) => ({ default: m.PurchasesPage }))
);
const RepairsPage = React.lazy(() =>
  import('../pages/RepairsPage').then((m) => ({ default: m.RepairsPage }))
);
const ReportsPage = React.lazy(() =>
  import('../pages/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const SalesPage = React.lazy(() =>
  import('../pages/SalesPage').then((m) => ({ default: m.SalesPage }))
);
const SuppliersPage = React.lazy(() =>
  import('../pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage }))
);

const BatchReceiptModal = React.lazy(() =>
  import('./BatchReceiptModal').then((m) => ({ default: m.BatchReceiptModal }))
);
const BrandSettingsModal = React.lazy(() =>
  import('./BrandSettingsModal').then((m) => ({ default: m.BrandSettingsModal }))
);
const ClientDetailModal = React.lazy(() =>
  import('./ClientModals').then((m) => ({ default: m.ClientDetailModal }))
);
const NewClientModal = React.lazy(() =>
  import('./ClientModals').then((m) => ({ default: m.NewClientModal }))
);
const ContextualWindowGuide = React.lazy(() =>
  import('./GuidedTourOverlay').then((m) => ({ default: m.ContextualWindowGuide }))
);
const WelcomeSpotlightTour = React.lazy(() =>
  import('./GuidedTourOverlay').then((m) => ({ default: m.WelcomeSpotlightTour }))
);
const KeyboardShortcutsModal = React.lazy(() =>
  import('./KeyboardShortcutsModal').then((m) => ({ default: m.KeyboardShortcutsModal }))
);
const NewPurchaseModal = React.lazy(() =>
  import('./NewPurchaseModal').then((m) => ({ default: m.NewPurchaseModal }))
);
const NewRepairModal = React.lazy(() =>
  import('./NewRepairModal').then((m) => ({ default: m.NewRepairModal }))
);
const NewSaleModal = React.lazy(() =>
  import('./NewSaleModal').then((m) => ({ default: m.NewSaleModal }))
);
const NewSupplierModal = React.lazy(() =>
  import('./NewSupplierModal').then((m) => ({ default: m.NewSupplierModal }))
);
const NewTaskModal = React.lazy(() =>
  import('./NewTaskModal').then((m) => ({ default: m.NewTaskModal }))
);
const ProductDetailModal = React.lazy(() =>
  import('./ProductDetailModal').then((m) => ({ default: m.ProductDetailModal }))
);
const ProductImportModal = React.lazy(() =>
  import('./ProductImportModal').then((m) => ({ default: m.ProductImportModal }))
);
const ProductModal = React.lazy(() =>
  import('./ProductModal').then((m) => ({ default: m.ProductModal }))
);
const RepairDetailModal = React.lazy(() =>
  import('./RepairDetailModal').then((m) => ({ default: m.RepairDetailModal }))
);
const SalePrintModal = React.lazy(() =>
  import('./SalePrintModal').then((m) => ({ default: m.SalePrintModal }))
);
const SubscriptionModal = React.lazy(() =>
  import('./SubscriptionModal').then((m) => ({ default: m.SubscriptionModal }))
);
const SupportModal = React.lazy(() =>
  import('./SupportModal').then((m) => ({ default: m.SupportModal }))
);

const PageChunkSkeleton: React.FC = () => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
      {[1, 2, 3].map((k) => (
        <div
          key={k}
          className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        />
      ))}
    </div>
    <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
  </div>
);

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

const PLATFORM_ADMIN_EMAIL = 'thebnb05@gmail.com';

export const WorkshopApp: React.FC<WorkshopAppProps> = ({
  userId,
  userEmail,
  profile,
  darkMode,
  onToggleDark,
}) => {
  const isOnline = useOnlineStatus();
  const { notify } = useToast();
  const { tr } = useI18n();
  useActiveCurrency();
  useFxAutoSyncService(profile);
  const isMac = useMemo(() => isMacPlatform(), []);

  const navGroups = useMemo<Array<{ title: string; items: NavItem[] }>>(
    () => [
      {
        title: tr('Taller', 'Workshop', 'Oficina'),
        items: [
          { id: 'home', label: tr('Inicio', 'Home', 'Início'), icon: Home },
          { id: 'repairs', label: tr('Reparaciones', 'Repairs', 'Reparos'), icon: Wrench },
          { id: 'agenda', label: tr('Agenda', 'Schedule', 'Agenda'), icon: CalendarDays },
          { id: 'clients', label: tr('Clientes', 'Clients', 'Clientes'), icon: Users },
        ],
      },
      {
        title: tr('Stock y Compras', 'Stock & Purchases', 'Estoque e Compras'),
        items: [
          {
            id: 'inventory',
            label: tr('Inventario y Productos', 'Inventory & Products', 'Estoque e Produtos'),
            icon: Boxes,
          },
          { id: 'suppliers', label: tr('Proveedores', 'Suppliers', 'Fornecedores'), icon: Factory },
          { id: 'purchases', label: tr('Compras', 'Purchases', 'Compras'), icon: Receipt },
        ],
      },
      {
        title: tr('Ventas y Control', 'Sales & Control', 'Vendas e Controle'),
        items: [
          { id: 'sales', label: tr('Ventas', 'Sales', 'Vendas'), icon: ShoppingBag },
          { id: 'cash', label: tr('Caja diaria', 'Cash register', 'Caixa diário'), icon: Banknote },
          { id: 'reports', label: tr('Reportes', 'Reports', 'Relatórios'), icon: BarChart3 },
        ],
      },
    ],
    [tr]
  );

  const navItems = useMemo(() => navGroups.flatMap((g) => g.items), [navGroups]);
  const mobileMoreItems = useMemo(
    () =>
      navItems.filter((item) =>
        ['agenda', 'suppliers', 'purchases', 'sales', 'cash', 'reports'].includes(item.id)
      ),
    [navItems]
  );

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
  const [startupMpPayments, setStartupMpPayments] = useState<MpRecentPayment[]>([]);
  const recoveredEntries = useRecoveredPayments(userId);
  const lastPurchaseMirrorSigRef = useRef('');

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void hydrateTransferConfig(userId);
    void hydrateMercadoPagoConfig(userId).then((hydrated) => {
      if (!active) return;
      if (!hydrated.accessToken && !hydrated.terminalId && !hydrated.posExternalId) {
        syncMercadoPagoConfigFromProfile(userId, profile);
      }
      const effectiveMp = hydrated.accessToken
        ? hydrated
        : parseWorkshopMeta(profile).mercadoPago || loadMercadoPagoConfig(userId);
      if (effectiveMp.accessToken) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        void fetchRecentMercadoPagoPayments({
          accessToken: effectiveMp.accessToken,
          sinceIso: sevenDaysAgo.toISOString(),
        })
          .then((res) => {
            if (active && res.ok && Array.isArray(res.payments) && res.payments.length > 0) {
              setStartupMpPayments(res.payments);
              mergeSyncedMpPayments(userId, res.payments);
            }
          })
          .catch(() => {});
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

    const inflightByTable = new Map<TableName, Promise<void>>();
    const lastSyncAtByTable = new Map<TableName, number>();
    const realtimeTimers = new Map<TableName, number>();

    const triggerReload = (tbl: TableName, isRemoteEcho = false) => {
      const fn = reloadByTable[tbl];
      if (!fn) return;
      if (isRemoteEcho) {
        const last = lastSyncAtByTable.get(tbl) || 0;
        if (Date.now() - last < 500) return;
        const existingTimer = realtimeTimers.get(tbl);
        if (existingTimer) window.clearTimeout(existingTimer);
        realtimeTimers.set(
          tbl,
          window.setTimeout(() => {
            realtimeTimers.delete(tbl);
            triggerReload(tbl, false);
          }, 120)
        );
        return;
      }

      if (inflightByTable.has(tbl)) return;
      lastSyncAtByTable.set(tbl, Date.now());
      const promise = fn().finally(() => {
        inflightByTable.delete(tbl);
      });
      inflightByTable.set(tbl, promise);
    };

    const tables = Object.keys(reloadByTable) as TableName[];
    tables.forEach((tbl) => {
      triggerReload(tbl, false);
    });

    const localUnsubs = tables.map((tbl) =>
      subscribeTableChanges(tbl, () => {
        triggerReload(tbl, false);
      })
    );

    const channel = supabase.channel(`workshop_sync_${userId}`);
    tables.forEach((tbl) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tbl, filter: `owner_id=eq.${userId}` },
        () => {
          triggerReload(tbl, true);
        }
      );
    });
    channel.subscribe();

    return () => {
      active = false;
      realtimeTimers.forEach((timerId) => window.clearTimeout(timerId));
      realtimeTimers.clear();
      localUnsubs.forEach((unsub) => unsub());
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const isLoading = loadingCount > 0;

  useEffect(() => {
    if (!userId || isLoading) return;
    const sig = `${userId}|${sales.length}|${repairs.length}|${recoveredEntries.length}|${startupMpPayments.length}`;
    if (lastPurchaseMirrorSigRef.current === sig) return;
    lastPurchaseMirrorSigRef.current = sig;

    const effectiveMp =
      loadMercadoPagoConfig(userId).accessToken
        ? loadMercadoPagoConfig(userId)
        : parseWorkshopMeta(profile).mercadoPago || loadMercadoPagoConfig(userId);

    void syncAllElectronicPaymentsToPurchases({
      ownerId: userId,
      sales,
      repairs,
      purchases,
      recoveredEntries,
      mpPayments: startupMpPayments,
      mpConfig: effectiveMp,
      respectDismissed: true,
    });
  }, [
    userId,
    isLoading,
    sales,
    repairs,
    purchases,
    recoveredEntries,
    startupMpPayments,
    profile,
  ]);
  const prevRepairStatusesRef = useRef<Map<string, string> | null>(null);
  const initialRepairParamHandledRef = useRef(false);

  // Reset status tracker if the signed-in user changes
  useEffect(() => {
    prevRepairStatusesRef.current = null;
    initialRepairParamHandledRef.current = false;
  }, [userId]);

  // Trigger Service Worker push notification when any repair transitions to 'listo' or 'terminado'
  useEffect(() => {
    if (isLoading) return;

    const currentMap = new Map<string, string>();
    for (const r of repairs) {
      currentMap.set(r.id, normalizeRepairStatusKey(r.status));
    }

    const prevMap = prevRepairStatusesRef.current;
    if (prevMap === null) {
      prevRepairStatusesRef.current = currentMap;
      return;
    }

    for (const r of repairs) {
      const nextStatus = normalizeRepairStatusKey(r.status);
      const prevStatus = prevMap.get(r.id);
      if (prevStatus !== nextStatus && isReadyRepairStatus(nextStatus)) {
        void sendRepairReadyPushNotification(r);
      }
    }

    prevRepairStatusesRef.current = currentMap;
  }, [isLoading, repairs]);

  // Open repair modal when user clicks a push notification or lands with ?repairId=
  useEffect(() => {
    if (!isLoading && !initialRepairParamHandledRef.current) {
      initialRepairParamHandledRef.current = true;
      try {
        const url = new URL(window.location.href);
        const paramId = url.searchParams.get('repairId');
        if (paramId && repairs.some((r) => r.id === paramId)) {
          setPage('repairs');
          setSelectedRepairId(paramId);
          url.searchParams.delete('repairId');
          window.history.replaceState({}, '', url.toString());
        }
      } catch {
        // Ignore URL parsing errors
      }
    }
  }, [isLoading, repairs]);

  useEffect(() => {
    const openRepairById = (repairId: string | undefined | null) => {
      if (!repairId) return;
      setPage('repairs');
      setSelectedRepairId(repairId);
    };

    const handleSwMessage = (event: MessageEvent) => {
      const msg = event?.data as { type?: string; repairId?: string } | undefined;
      if (msg && msg.type === 'TH3_OPEN_REPAIR' && msg.repairId) {
        openRepairById(msg.repairId);
      }
    };

    const handleFallbackNotificationEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ repairId?: string }>).detail;
      if (detail?.repairId) {
        openRepairById(detail.repairId);
      }
    };

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }
    window.addEventListener('th3bnb:open-repair-from-notification', handleFallbackNotificationEvent);

    return () => {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      window.removeEventListener(
        'th3bnb:open-repair-from-notification',
        handleFallbackNotificationEvent
      );
    };
  }, []);

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
  const [saleCartItems, setSaleCartItems] = useState<Array<{ product: ProductRecord; quantity: number }>>([]);
  const [editingSale, setEditingSale] = useState<SaleRecord | null>(null);
  const [selectedPrintSale, setSelectedPrintSale] = useState<SaleRecord | null>(null);
  const [showNewPurchase, setShowNewPurchase] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<PurchaseRecord | null>(null);

  // Platform subscription state & live countdown
  const [subscriptionRecord, setSubscriptionRecord] = useState<SignedSubscriptionRecord | null>(
    () => parseWorkshopMeta(profile).subscription || null
  );
  const [mpPlatformConfigured, setMpPlatformConfigured] = useState(true);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [shortcutsEnabled, setShortcutsEnabled] = useState<boolean>(() => getShortcutsEnabled());
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

  const lowStockProducts = useMemo(
    () =>
      products
        .filter((p) => p.trackStock && p.stock <= p.minStock)
        .sort((a, b) => a.stock - b.stock),
    [products]
  );
  const lowStockCount = lowStockProducts.length;

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

  const hasBlockingModalOpen = Boolean(
    showBrandSettings ||
      showNewRepair ||
      selectedRepairId ||
      batchPrintData ||
      showClientModal ||
      selectedClientId ||
      showProductModal ||
      selectedProductId ||
      showProductImport ||
      showNewTask ||
      showSupplierModal ||
      showNewSale ||
      selectedPrintSale ||
      showNewPurchase ||
      showSubscriptionModal ||
      isSubscriptionBlocking ||
      showSupportModal ||
      welcomeTourOpen ||
      moreMenuOpen
  );

  const handleShortcutAction = (actionId: ShortcutActionId) => {
    switch (actionId) {
      case 'new_repair':
        openNewRepairFlow();
        break;
      case 'new_client':
        setEditClient(null);
        setShowClientModal(true);
        break;
      case 'new_product':
        setEditProduct(null);
        setShowProductModal(true);
        break;
      case 'new_sale':
        setSaleProduct(null);
        setSaleCartItems([]);
        setEditingSale(null);
        setShowNewSale(true);
        break;
      case 'new_task':
        setShowNewTask(true);
        break;
      case 'new_purchase':
        setEditingPurchase(null);
        setShowNewPurchase(true);
        break;
      case 'nav_home':
        navigateTo('home');
        break;
      case 'nav_repairs':
        navigateTo('repairs');
        break;
      case 'nav_agenda':
        navigateTo('agenda');
        break;
      case 'nav_clients':
        navigateTo('clients');
        break;
      case 'nav_inventory':
        navigateTo('inventory');
        break;
      case 'nav_suppliers':
        navigateTo('suppliers');
        break;
      case 'nav_purchases':
        navigateTo('purchases');
        break;
      case 'nav_sales':
        navigateTo('sales');
        break;
      case 'nav_cash':
        navigateTo('cash');
        break;
      case 'nav_reports':
        navigateTo('reports');
        break;
      case 'global_search':
        window.dispatchEvent(new CustomEvent('th3bnb:open-global-search'));
        break;
      case 'open_settings':
        setShowBrandSettings(true);
        break;
      case 'toggle_dark':
        onToggleDark();
        break;
      case 'open_shortcuts':
        setShowShortcutsModal((prev) => !prev);
        break;
      case 'close_modal':
        break;
    }
  };

  useGlobalShortcuts({
    enabled: shortcutsEnabled && !isLoading && !isSubscriptionBlocking,
    hasBlockingModalOpen,
    shortcutsModalOpen: showShortcutsModal,
    onTrigger: handleShortcutAction,
    onToggleShortcutsModal: () => setShowShortcutsModal((prev) => !prev),
    onEscape: () => {
      if (moreMenuOpen) setMoreMenuOpen(false);
    },
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-900">
        <div className="flex h-16 items-center gap-3 border-b border-slate-100 px-5 dark:border-slate-800">
          <BrandMark profile={profile} size="md" />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <nav data-tour="sidebar-nav" className="space-y-5" aria-label={tr('Secciones principales', 'Main sections', 'Seções principais')}>
            {navGroups.map((group) => (
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
                  {tr('Plataforma', 'Platform', 'Plataforma')}
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
                  <span className="truncate">{tr('Admin de taller', 'Workshop admin', 'Admin da oficina')}</span>
                </button>
              </div>
            )}
          </nav>

          <div data-tour="quick-actions" className="mt-6 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="mb-2 px-3 text-[11px] font-semibold text-slate-400">
              {tr('Acciones rápidas', 'Quick actions', 'Ações rápidas')}
            </div>
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => openNewRepairFlow()}
                className="flex h-9 w-full items-center gap-2 rounded-xl bg-[#0072BB] px-3 text-xs font-semibold text-white hover:bg-[#005f9c]"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{tr('Nueva reparación', 'New repair', 'Novo reparo')}</span>
                {shortcutsEnabled && (
                  <kbd className="ml-auto shrink-0 rounded border border-white/25 bg-white/15 px-1.5 py-0.5 font-mono-num text-[10px] font-semibold text-white/95">
                    {formatShortcutKey('Ctrl', isMac)} N
                  </kbd>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditClient(null);
                  setShowClientModal(true);
                }}
                className="flex h-9 w-full items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{tr('Nuevo cliente', 'New client', 'Novo cliente')}</span>
                {shortcutsEnabled && (
                  <kbd className="ml-auto shrink-0 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono-num text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                    {formatShortcutKey('Alt', isMac)} C
                  </kbd>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditProduct(null);
                  setShowProductModal(true);
                }}
                className="flex h-9 w-full items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{tr('Nuevo producto', 'New product', 'Novo produto')}</span>
                {shortcutsEnabled && (
                  <kbd className="ml-auto shrink-0 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono-num text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                    {formatShortcutKey('Alt', isMac)} P
                  </kbd>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-2 border-t border-slate-100 p-3 dark:border-slate-800">
          {subscriptionRecord && (
            <button
              type="button"
              data-tour="subscription-sidebar"
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
                {tr('Planes', 'Plans', 'Planos')}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSupportModal(true)}
            className="flex h-9 w-full items-center gap-2 rounded-xl border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <MessageSquarePlus className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
            <span>{tr('Soporte y sugerencias', 'Support & feedback', 'Suporte e sugestões')}</span>
          </button>
          <div className="truncate px-2 text-xs font-medium text-slate-700 dark:text-slate-300">
            {profile.firstName
              ? `${profile.firstName} ${profile.lastName || ''}`.trim()
              : userEmail || tr('Taller', 'Workshop', 'Oficina')}
          </div>
          <div className="truncate px-2 text-[11px] text-slate-400">
            {profile.role === 'admin'
              ? tr('Administrador', 'Administrator', 'Administrador')
              : tr('Operador', 'Operator', 'Operador')}
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
                ? tr('Admin de taller', 'Workshop admin', 'Admin da oficina')
                : navItems.find((n) => n.id === page)?.label}
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
            <CurrencyConverter />
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
                  className={`hidden sm:inline-flex lg:hidden h-8 sm:h-9 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition whitespace-nowrap ${
                    subscriptionRecord.payload.isExemptAnnual
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200'
                      : subscriptionRemaining.isExpired
                        ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200'
                        : subscriptionRemaining.days <= 5
                          ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                          : 'border-sky-200 bg-sky-50/80 text-[#0072BB] hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
                  }`}
                >
                  <span>{shortPlanLabel}</span>
                </button>
              );
            })()}
            <PWAInstallButton />

            <button
              type="button"
              onClick={() => setShowSupportModal(true)}
              aria-label={tr('Soporte y sugerencias', 'Support & feedback', 'Suporte e sugestões')}
              title={tr('Soporte y sugerencias', 'Support & feedback', 'Suporte e sugestões')}
              className="hidden lg:flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setWelcomeTourOpen(true)}
              aria-label={tr('Ver tour guiado', 'Guided tour', 'Tour guiado')}
              title={tr('Tour guiado', 'Guided tour', 'Tour guiado')}
              className="hidden lg:flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <HelpCircle className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowShortcutsModal(true)}
              aria-label={tr('Atajos de teclado', 'Keyboard shortcuts', 'Atalhos de teclado')}
              title={`${tr('Atajos de teclado', 'Keyboard shortcuts', 'Atalhos de teclado')} (${formatShortcutKey('Ctrl', isMac)}+/)`}
              className="hidden lg:flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Keyboard className="h-4 w-4" />
            </button>

            <PushNotificationControl
              lowStockProducts={lowStockProducts}
              onOpenLowStock={() => {
                setInventoryInitialFilter('bajo_stock');
                setInventoryFilterNonce((n) => n + 1);
                setPage('inventory');
                setMoreMenuOpen(false);
              }}
              onSelectProduct={(p) => setSelectedProductId(p.id)}
            />

            <button
              type="button"
              onClick={() => setShowBrandSettings(true)}
              aria-label={tr('Configuración', 'Settings', 'Configurações')}
              title={tr('Configuración', 'Settings', 'Configurações')}
              className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Settings className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onToggleDark}
              aria-label={
                darkMode
                  ? tr('Activar modo claro', 'Enable light mode', 'Ativar modo claro')
                  : tr('Activar modo oscuro', 'Enable dark mode', 'Ativar modo escuro')
              }
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
              aria-label={tr('Cerrar sesión', 'Sign out', 'Sair')}
              title={tr('Salir', 'Sign out', 'Sair')}
              className="inline-flex h-9 sm:h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-2.5 lg:px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">{tr('Salir', 'Sign out', 'Sair')}</span>
            </button>
          </div>
        </header>

        <main className="no-print mx-auto max-w-7xl px-4 pb-24 pt-5 sm:px-6 lg:pb-10">
          {!isOnline && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span>
                {tr(
                  'Sin conexión — Estás viendo datos en caché. Los cambios se sincronizarán al reconectar.',
                  'Offline — Showing cached data. Changes will sync when reconnected.',
                  'Sem conexão — Exibindo dados em cache. As alterações serão sincronizadas ao reconectar.'
                )}
              </span>
            </div>
          )}

          {syncError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
              Error al sincronizar con Supabase: {syncError}
            </div>
          )}

          {isLoading ? (
            <PageChunkSkeleton />
          ) : (
            <Suspense fallback={<PageChunkSkeleton />}>
              {page === 'home' && (
                <HomePage
                  ownerId={userId}
                  repairs={repairs}
                  clients={clients}
                  products={products}
                  sales={sales}
                  purchases={purchases}
                  profile={profile}
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
                  onOpenSettings={() => setShowBrandSettings(true)}
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
                  ownerId={userId}
                  profile={profile}
                  initialFilter={inventoryInitialFilter}
                  filterNonce={inventoryFilterNonce}
                  onNewProduct={() => {
                    setEditProduct(null);
                    setShowProductModal(true);
                  }}
                  onImportProducts={() => setShowProductImport(true)}
                  onSelectProduct={(p) => setSelectedProductId(p.id)}
                  onCheckoutCart={(items) => {
                    setSaleProduct(null);
                    setEditingSale(null);
                    setSaleCartItems(items);
                    setShowNewSale(true);
                  }}
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
                  ownerId={userId}
                  sales={sales}
                  products={products}
                  profile={profile}
                  onNewSale={() => {
                    setSaleProduct(null);
                    setSaleCartItems([]);
                    setEditingSale(null);
                    setShowNewSale(true);
                  }}
                  onEditSale={(s) => {
                    setSaleProduct(null);
                    setSaleCartItems([]);
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
                  products={products}
                  profile={profile}
                />
              )}

              {page === 'purchases' && (
                <PurchasesPage
                  purchases={purchases}
                  products={products}
                  tasks={tasks}
                  sales={sales}
                  repairs={repairs}
                  ownerId={userId}
                  profile={profile}
                  onNewPurchase={() => {
                    setEditingPurchase(null);
                    setShowNewPurchase(true);
                  }}
                  onEditPurchase={(p) => {
                    setEditingPurchase(p);
                    setShowNewPurchase(true);
                  }}
                />
              )}

              {page === 'reports' && (
                <ReportsPage
                  ownerId={userId}
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
            </Suspense>
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
          { id: 'home' as PageId, label: tr('Inicio', 'Home', 'Início'), icon: Home },
          { id: 'repairs' as PageId, label: tr('Equipos', 'Repairs', 'Reparos'), icon: Wrench },
          { id: 'clients' as PageId, label: tr('Clientes', 'Clients', 'Clientes'), icon: Users },
          { id: 'inventory' as PageId, label: tr('Inventario', 'Inventory', 'Estoque'), icon: Boxes },
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
          <span>{tr('Más', 'More', 'Mais')}</span>
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
                {tr('Más secciones', 'More sections', 'Mais seções')}
              </span>
              <button
                type="button"
                onClick={() => setMoreMenuOpen(false)}
                aria-label={tr('Cerrar menú', 'Close menu', 'Fechar menu')}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {mobileMoreItems.map((item) => {
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
                  <span className="text-center leading-tight">
                    {tr('Admin de taller', 'Workshop admin', 'Admin da oficina')}
                  </span>
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
                <span>{tr('Soporte', 'Support', 'Suporte')}</span>
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
                <span>{tr('Tour guiado', 'Guided tour', 'Tour guiado')}</span>
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

      {/* Modals (mounted & code-split on demand) */}
      <Suspense fallback={null}>
        {showBrandSettings && (
          <BrandSettingsModal
            open={showBrandSettings}
            onClose={() => setShowBrandSettings(false)}
            profile={profile}
            userEmail={userEmail}
            subscriptionRecord={subscriptionRecord}
            nowMs={nowMs}
            onOpenSubscription={() => setShowSubscriptionModal(true)}
          />
        )}

        {showNewRepair && (
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
        )}

        {selectedRepair && (
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
        )}

        {batchPrintData && (
          <BatchReceiptModal
            open={Boolean(batchPrintData)}
            repairs={batchPrintData.repairs}
            batchRef={batchPrintData.batchRef}
            profile={profile}
            onClose={() => setBatchPrintData(null)}
            onSelectRepair={(r) => {
              setBatchPrintData(null);
              setRepairModalInitialTab('detail');
              setSelectedRepairId(r.id);
            }}
          />
        )}

        {showClientModal && (
          <NewClientModal
            open={showClientModal}
            onClose={() => {
              setShowClientModal(false);
              setEditClient(null);
            }}
            ownerId={userId}
            editClient={editClient}
          />
        )}

        {selectedClient && (
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
        )}

        {showProductModal && (
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
        )}

        {selectedProduct && (
          <ProductDetailModal
            product={selectedProduct}
            onClose={() => setSelectedProductId(null)}
            onEdit={(p) => {
              setEditProduct(p);
              setShowProductModal(true);
            }}
            onSell={(p) => {
              setSaleCartItems([]);
              setSaleProduct(p);
              setShowNewSale(true);
            }}
          />
        )}

        {showProductImport && (
          <ProductImportModal
            open={showProductImport}
            onClose={() => setShowProductImport(false)}
            ownerId={userId}
            existingProducts={products}
          />
        )}

        {showNewTask && (
          <NewTaskModal
            open={showNewTask}
            onClose={() => setShowNewTask(false)}
            ownerId={userId}
          />
        )}

        {showSupplierModal && (
          <NewSupplierModal
            open={showSupplierModal}
            onClose={() => {
              setShowSupplierModal(false);
              setEditSupplier(null);
            }}
            ownerId={userId}
            editSupplier={editSupplier}
          />
        )}

        {showNewSale && (
          <NewSaleModal
            open={showNewSale}
            onClose={() => {
              setShowNewSale(false);
              setSaleProduct(null);
              setSaleCartItems([]);
              setEditingSale(null);
            }}
            ownerId={userId}
            clients={clients}
            products={products}
            preselectedProduct={saleProduct}
            preselectedCartItems={saleCartItems}
            editSale={editingSale}
            profile={profile}
            brandName={profile.brandName}
            onCreated={(createdSale) => setSelectedPrintSale(createdSale)}
          />
        )}

        {selectedPrintSale && (
          <SalePrintModal
            sale={sales.find((s) => s.id === selectedPrintSale.id) || selectedPrintSale}
            onClose={() => setSelectedPrintSale(null)}
            profile={profile}
            clients={clients}
          />
        )}

        {showNewPurchase && (
          <NewPurchaseModal
            open={showNewPurchase}
            onClose={() => {
              setShowNewPurchase(false);
              setEditingPurchase(null);
            }}
            ownerId={userId}
            suppliers={suppliers}
            products={products}
            tasks={tasks}
            profile={profile}
            editPurchase={editingPurchase}
          />
        )}

        {(showSubscriptionModal || isSubscriptionBlocking) && (
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
        )}

        {showSupportModal && (
          <SupportModal
            open={showSupportModal}
            onClose={() => setShowSupportModal(false)}
            profile={profile}
            userEmail={userEmail}
            currentPage={page}
          />
        )}

        {showShortcutsModal && (
          <KeyboardShortcutsModal
            open={showShortcutsModal}
            onClose={() => setShowShortcutsModal(false)}
            enabled={shortcutsEnabled}
            onToggleEnabled={(next) => {
              setShortcutsEnabled(next);
              persistShortcutsEnabled(next);
              notify(
                next
                  ? tr('Atajos de teclado activados.', 'Keyboard shortcuts enabled.', 'Atalhos de teclado ativados.')
                  : tr('Atajos de teclado desactivados.', 'Keyboard shortcuts disabled.', 'Atalhos de teclado desativados.'),
                'info'
              );
            }}
            onRunAction={handleShortcutAction}
          />
        )}

        {welcomeTourOpen && (
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
        )}

        {activeContextualGuide && (
          <ContextualWindowGuide
            guide={activeContextualGuide.resolved}
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
        )}
      </Suspense>
    </div>
  );
};
