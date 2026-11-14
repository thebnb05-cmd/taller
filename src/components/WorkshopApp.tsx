import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  Boxes,
  CalendarDays,
  Factory,
  Home,
  LogOut,
  Moon,
  MoreHorizontal,
  Package,
  Plus,
  Receipt,
  Settings,
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
import { BrandSettingsModal } from './BrandSettingsModal';
import { ClientDetailModal, NewClientModal } from './ClientModals';
import { GlobalSearchBar } from './GlobalSearchBar';
import {
  NewPurchaseModal,
  NewSaleModal,
  NewSupplierModal,
  NewTaskModal,
} from './FinanceModals';
import { NewRepairModal } from './NewRepairModal';
import {
  AgendaPage,
  InventoryPage,
  ProductsPage,
  PurchasesPage,
  ReportsPage,
  SalesPage,
  SuppliersPage,
} from './OperationsPages';
import { ClientsPage, HomePage, RepairsPage } from './OverviewAndRepairsPages';
import { ProductDetailModal } from './ProductDetailModal';
import { ProductImportModal } from './ProductImportModal';
import { ProductModal } from './ProductModal';
import { PWAInstallButton } from './PWAInstallButton';
import { RepairDetailModal } from './RepairDetailModal';
import { SalePrintModal } from './SalePrintModal';

interface WorkshopAppProps {
  userId: string;
  userEmail?: string | null;
  profile: WorkshopProfile;
  darkMode: boolean;
  onToggleDark: () => void;
}

const NAV_ITEMS: Array<{ id: PageId; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'home', label: 'Inicio', icon: Home },
  { id: 'repairs', label: 'Reparaciones', icon: Wrench },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'repuestos', label: 'Productos', icon: Package },
  { id: 'inventory', label: 'Inventario', icon: Boxes },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'suppliers', label: 'Proveedores', icon: Factory },
  { id: 'sales', label: 'Ventas', icon: ShoppingBag },
  { id: 'purchases', label: 'Compras', icon: Receipt },
  { id: 'reports', label: 'Reportes', icon: BarChart3 },
];

export const WorkshopApp: React.FC<WorkshopAppProps> = ({
  userId,
  userEmail,
  profile,
  darkMode,
  onToggleDark,
}) => {
  const isOnline = useOnlineStatus();
  const [page, setPage] = useState<PageId>('home');
  const [inventoryInitialFilter, setInventoryInitialFilter] = useState<
    'all' | 'repuestos' | 'accesorios' | 'bajo_stock'
  >('all');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Firestore real-time state scoped to the authenticated owner
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
        const msg =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message?: unknown }).message)
            : 'Error al sincronizar con Supabase.';
        setSyncError(msg);
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

    const channel = supabase
      .channel(`workshop_sync_${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public' },
        (payload) => {
          const tbl = payload.table as TableName;
          const fn = reloadByTable[tbl];
          if (fn) void fn();
        }
      )
      .subscribe();

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
  const [selectedRepairId, setSelectedRepairId] = useState<string | null>(null);
  const [justCreatedRepair, setJustCreatedRepair] = useState<RepairRecord | null>(null);
  const [repairModalInitialTab, setRepairModalInitialTab] = useState<'detail' | 'edit' | 'receipt'>('detail');

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
  const [selectedPrintSale, setSelectedPrintSale] = useState<SaleRecord | null>(null);
  const [showNewPurchase, setShowNewPurchase] = useState(false);

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
          <div className="mb-2 px-3 text-[11px] font-semibold text-slate-400">Secciones</div>
          <nav className="space-y-1" aria-label="Secciones principales">
            {NAV_ITEMS.map((item) => {
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
          </nav>

          <div className="mt-6 border-t border-slate-100 pt-4 dark:border-slate-800">
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

        <div className="border-t border-slate-100 p-3 dark:border-slate-800">
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
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md sm:h-16 sm:gap-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900/90">
          <div className="flex shrink-0 items-center gap-3">
            <div className="lg:hidden">
              <BrandMark
                profile={profile}
                size="sm"
                wordClassNames={{ 2: 'text-[10px] text-center', 3: 'text-[10px]' }}
              />
            </div>
            <span className="hidden text-sm font-semibold text-slate-500 lg:inline dark:text-slate-400">
              {NAV_ITEMS.find((n) => n.id === page)?.label}
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

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <PWAInstallButton />

            <button
              type="button"
              onClick={() => {
                setInventoryInitialFilter('bajo_stock');
                setPage('inventory');
              }}
              aria-label="Alertas de stock bajo"
              title="Stock bajo"
              className="relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Bell className="h-4 w-4" />
              {lowStockCount > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 font-mono-num text-[10px] font-bold text-white">
                  {lowStockCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowBrandSettings(true)}
              aria-label="Configurar marca y comprobantes"
              title="Marca y comprobantes"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Settings className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onToggleDark}
              aria-label={darkMode ? 'Activar modo claro' : 'Activar modo oscuro'}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              aria-label="Cerrar sesión"
              title="Salir"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Salir</span>
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

              {page === 'repuestos' && (
                <ProductsPage
                  products={products}
                  onNewProduct={() => {
                    setEditProduct(null);
                    setShowProductModal(true);
                  }}
                  onImportProducts={() => setShowProductImport(true)}
                  onSelectProduct={(p) => setSelectedProductId(p.id)}
                />
              )}

              {page === 'inventory' && (
                <InventoryPage
                  products={products}
                  initialFilter={inventoryInitialFilter}
                  onNewProduct={() => {
                    setEditProduct(null);
                    setShowProductModal(true);
                  }}
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
                  onNewSale={() => {
                    setSaleProduct(null);
                    setShowNewSale(true);
                  }}
                  onPrintSale={(s) => setSelectedPrintSale(s)}
                />
              )}

              {page === 'purchases' && (
                <PurchasesPage
                  purchases={purchases}
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
            </>
          )}
        </main>
      </div>

      {/* Mobile / Tablet Bottom Navigation (compact <= 64px) */}
      <nav
        aria-label="Navegación móvil"
        className="no-print fixed bottom-0 left-0 right-0 z-30 grid h-16 grid-cols-5 border-t border-slate-200 bg-white/95 backdrop-blur-md lg:hidden dark:border-slate-800 dark:bg-slate-900/95"
      >
        {[
          { id: 'home' as PageId, label: 'Inicio', icon: Home },
          { id: 'repairs' as PageId, label: 'Equipos', icon: Wrench },
          { id: 'clients' as PageId, label: 'Clientes', icon: Users },
          { id: 'repuestos' as PageId, label: 'Productos', icon: Package },
        ].map((item) => {
          const Icon = item.icon;
          const active = page === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateTo(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition ${
                active
                  ? 'text-[#0072BB] dark:text-sky-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreMenuOpen((prev) => !prev)}
          className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition ${
            moreMenuOpen ||
            ['inventory', 'agenda', 'suppliers', 'sales', 'purchases', 'reports'].includes(page)
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
              {NAV_ITEMS.slice(4).map((item) => {
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
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <BrandSettingsModal
        open={showBrandSettings}
        onClose={() => setShowBrandSettings(false)}
        profile={profile}
      />

      <NewRepairModal
        open={showNewRepair}
        onClose={() => {
          setShowNewRepair(false);
          setRepairPreClient(null);
        }}
        onCreated={(created) => {
          setJustCreatedRepair(created);
          setRepairModalInitialTab('receipt');
          setSelectedRepairId(created.id);
        }}
        ownerId={userId}
        profile={profile}
        clients={clients}
        repairs={repairs}
        products={products}
        preselectedClient={repairPreClient}
      />

      <RepairDetailModal
        repair={selectedRepair}
        clients={clients}
        profile={profile}
        initialTab={repairModalInitialTab}
        justCreated={Boolean(justCreatedRepair && justCreatedRepair.id === selectedRepairId)}
        onClose={() => {
          setSelectedRepairId(null);
          setJustCreatedRepair(null);
          setRepairModalInitialTab('detail');
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
        }}
        ownerId={userId}
        clients={clients}
        preselectedProduct={saleProduct}
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
      />
    </div>
  );
};
