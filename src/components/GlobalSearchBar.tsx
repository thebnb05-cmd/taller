import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Package, Search, Smartphone, Users, X } from 'lucide-react';
import type { ClientRecord, ProductRecord, RepairRecord } from '../types/workshop';
import { formatCurrency, getStatusMeta } from '../utils/formatters';

type SearchCategory = 'all' | 'clients' | 'repairs' | 'products';

interface SearchResultItem {
  kind: 'client' | 'repair' | 'product';
  id: string;
  client?: ClientRecord;
  repair?: RepairRecord;
  product?: ProductRecord;
}

interface GlobalSearchBarProps {
  clients: ClientRecord[];
  repairs: RepairRecord[];
  products: ProductRecord[];
  onSelectClient: (client: ClientRecord) => void;
  onSelectRepair: (repair: RepairRecord) => void;
  onSelectProduct: (product: ProductRecord) => void;
}

const MAX_PER_GROUP_ALL = 4;
const MAX_SINGLE_GROUP = 12;

export const GlobalSearchBar: React.FC<GlobalSearchBarProps> = ({
  clients,
  repairs,
  products,
  onSelectClient,
  onSelectRepair,
  onSelectProduct,
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SearchCategory>('all');
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const desktopInputRef = useRef<HTMLInputElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedQuery = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!normalizedQuery) {
      return {
        clients: [] as ClientRecord[],
        repairs: [] as RepairRecord[],
        products: [] as ProductRecord[],
      };
    }

    const matchedClients = clients.filter((c) => {
      return (
        c.name.toLowerCase().includes(normalizedQuery) ||
        (c.phone || '').toLowerCase().includes(normalizedQuery) ||
        (c.dni || '').toLowerCase().includes(normalizedQuery) ||
        (c.email || '').toLowerCase().includes(normalizedQuery) ||
        (c.address || '').toLowerCase().includes(normalizedQuery)
      );
    });

    const matchedRepairs = repairs
      .filter((r) => {
        return (
          r.brand.toLowerCase().includes(normalizedQuery) ||
          r.model.toLowerCase().includes(normalizedQuery) ||
          `${r.brand} ${r.model}`.toLowerCase().includes(normalizedQuery) ||
          r.deviceType.toLowerCase().includes(normalizedQuery) ||
          r.code.toLowerCase().includes(normalizedQuery) ||
          r.trackingCode.toLowerCase().includes(normalizedQuery) ||
          r.clientName.toLowerCase().includes(normalizedQuery) ||
          (r.imei || '').toLowerCase().includes(normalizedQuery) ||
          r.problem.toLowerCase().includes(normalizedQuery)
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    const matchedProducts = products.filter((p) => {
      return (
        p.name.toLowerCase().includes(normalizedQuery) ||
        (p.brand || '').toLowerCase().includes(normalizedQuery) ||
        p.category.toLowerCase().includes(normalizedQuery) ||
        (p.subcategory || '').toLowerCase().includes(normalizedQuery) ||
        (p.sku || '').toLowerCase().includes(normalizedQuery) ||
        (p.barcode || '').toLowerCase().includes(normalizedQuery) ||
        (p.internalCode || '').toLowerCase().includes(normalizedQuery) ||
        (p.location || '').toLowerCase().includes(normalizedQuery)
      );
    });

    return {
      clients: matchedClients,
      repairs: matchedRepairs,
      products: matchedProducts,
    };
  }, [clients, normalizedQuery, products, repairs]);

  const visibleGroups = useMemo(() => {
    const clientLimit = category === 'clients' ? MAX_SINGLE_GROUP : MAX_PER_GROUP_ALL;
    const repairLimit = category === 'repairs' ? MAX_SINGLE_GROUP : MAX_PER_GROUP_ALL;
    const productLimit = category === 'products' ? MAX_SINGLE_GROUP : MAX_PER_GROUP_ALL;

    return {
      clients:
        category === 'all' || category === 'clients'
          ? matches.clients.slice(0, clientLimit)
          : [],
      repairs:
        category === 'all' || category === 'repairs'
          ? matches.repairs.slice(0, repairLimit)
          : [],
      products:
        category === 'all' || category === 'products'
          ? matches.products.slice(0, productLimit)
          : [],
    };
  }, [category, matches]);

  const flatItems = useMemo<SearchResultItem[]>(() => {
    const items: SearchResultItem[] = [];
    visibleGroups.clients.forEach((client) =>
      items.push({ kind: 'client', id: client.id, client })
    );
    visibleGroups.repairs.forEach((repair) =>
      items.push({ kind: 'repair', id: repair.id, repair })
    );
    visibleGroups.products.forEach((product) =>
      items.push({ kind: 'product', id: product.id, product })
    );
    return items;
  }, [visibleGroups]);

  const totalMatches =
    matches.clients.length + matches.repairs.length + matches.products.length;

  useEffect(() => {
    setActiveIndex(-1);
  }, [normalizedQuery, category]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.innerWidth < 640) {
          setMobileOpen(true);
          setOpen(true);
          window.setTimeout(() => mobileInputRef.current?.focus(), 20);
        } else {
          setOpen(true);
          desktopInputRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const closeSearch = () => {
    setOpen(false);
    setMobileOpen(false);
    setActiveIndex(-1);
  };

  const handleSelectItem = (item: SearchResultItem) => {
    if (item.kind === 'client' && item.client) {
      onSelectClient(item.client);
    } else if (item.kind === 'repair' && item.repair) {
      onSelectRepair(item.repair);
    } else if (item.kind === 'product' && item.product) {
      onSelectProduct(item.product);
    }
    closeSearch();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (!open) setOpen(true);
    if (flatItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? flatItems.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0 && flatItems[activeIndex]) {
      e.preventDefault();
      handleSelectItem(flatItems[activeIndex]);
    }
  };

  const renderDropdownContent = () => {
    const tabs: Array<{ id: SearchCategory; label: string; count: number }> = [
      { id: 'all', label: 'Todos', count: totalMatches },
      { id: 'clients', label: 'Clientes', count: matches.clients.length },
      { id: 'repairs', label: 'Equipos', count: matches.repairs.length },
      { id: 'products', label: 'Productos', count: matches.products.length },
    ];

    let runningIndex = 0;

    return (
      <div
        role="listbox"
        aria-label="Resultados de búsqueda global"
        className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50/80 p-1.5 dark:border-slate-800 dark:bg-slate-950/60">
          {tabs.map((tab) => {
            const active = category === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setCategory(tab.id)}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition ${
                  active
                    ? 'bg-white text-[#0072BB] shadow-xs dark:bg-slate-800 dark:text-sky-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <span>{tab.label}</span>
                {normalizedQuery && (
                  <span
                    className={`rounded-md px-1.5 py-0.5 font-mono-num text-[10px] ${
                      active
                        ? 'bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300'
                        : 'bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-2 sm:max-h-[420px]">
          {!normalizedQuery ? (
            <div className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              <p className="font-medium text-slate-700 dark:text-slate-200">
                Búsqueda rápida en todo el taller
              </p>
              <p className="mt-1">
                Escribí nombre, teléfono, DNI, marca/modelo, orden, IMEI, SKU o código de barras.
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-3 font-mono-num text-[11px] text-slate-400">
                <span>{clients.length} clientes</span>
                <span>·</span>
                <span>{repairs.length} equipos</span>
                <span>·</span>
                <span>{products.length} productos</span>
              </div>
            </div>
          ) : flatItems.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No se encontraron resultados para «<span className="font-semibold">{query.trim()}</span>».
            </div>
          ) : (
            <div className="space-y-2">
              {visibleGroups.clients.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      Clientes
                    </span>
                    <span className="font-mono-num">{matches.clients.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {visibleGroups.clients.map((client) => {
                      const idx = runningIndex++;
                      const selected = idx === activeIndex;
                      return (
                        <button
                          key={client.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() =>
                            handleSelectItem({ kind: 'client', id: client.id, client })
                          }
                          className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition ${
                            selected
                              ? 'bg-sky-50 dark:bg-sky-950/50'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              <Users className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                {client.name}
                              </div>
                              <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {[client.phone, client.dni ? `DNI ${client.dni}` : '', client.email]
                                  .filter(Boolean)
                                  .join(' · ') || 'Sin datos de contacto'}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {visibleGroups.repairs.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Smartphone className="h-3.5 w-3.5" />
                      Equipos
                    </span>
                    <span className="font-mono-num">{matches.repairs.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {visibleGroups.repairs.map((repair) => {
                      const idx = runningIndex++;
                      const selected = idx === activeIndex;
                      const meta = getStatusMeta(repair.status);
                      return (
                        <button
                          key={repair.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() =>
                            handleSelectItem({ kind: 'repair', id: repair.id, repair })
                          }
                          className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition ${
                            selected
                              ? 'bg-sky-50 dark:bg-sky-950/50'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-base dark:bg-slate-800">
                              {repair.deviceIcon || '📱'}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                {repair.brand} {repair.model}
                              </div>
                              <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-300">
                                  {repair.code}
                                </span>{' '}
                                · {repair.clientName}
                                {repair.imei ? ` · ${repair.imei}` : ''}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {visibleGroups.products.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Package className="h-3.5 w-3.5" />
                      Productos
                    </span>
                    <span className="font-mono-num">{matches.products.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {visibleGroups.products.map((product) => {
                      const idx = runningIndex++;
                      const selected = idx === activeIndex;
                      const low = product.trackStock && product.stock <= product.minStock;
                      return (
                        <button
                          key={product.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() =>
                            handleSelectItem({ kind: 'product', id: product.id, product })
                          }
                          className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition ${
                            selected
                              ? 'bg-sky-50 dark:bg-sky-950/50'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              <Package className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                {product.name}
                              </div>
                              <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {product.category}
                                {product.brand ? ` · ${product.brand}` : ''}
                                {product.sku ? ` · SKU ${product.sku}` : ''}
                                {product.barcode ? ` · ${product.barcode}` : ''}
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-mono-num text-xs font-bold text-[#0072BB] dark:text-sky-400">
                              {formatCurrency(product.price)}
                            </div>
                            {product.trackStock && (
                              <div
                                className={`font-mono-num text-[11px] font-semibold ${
                                  low
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {product.stock} u.
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div ref={containerRef} className="relative flex flex-1 items-center justify-end sm:justify-center">
      {/* Mobile trigger button */}
      <button
        type="button"
        onClick={() => {
          setMobileOpen(true);
          setOpen(true);
          window.setTimeout(() => mobileInputRef.current?.focus(), 20);
        }}
        aria-label="Abrir búsqueda global"
        title="Buscar clientes, equipos o productos"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 sm:hidden dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <Search className="h-4 w-4" />
      </button>

      {/* Desktop / Tablet inline search bar */}
      <div className="relative hidden w-full max-w-md sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={desktopInputRef}
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder="Buscar clientes, equipos o productos..."
          aria-label="Búsqueda global entre clientes, equipos y productos"
          className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-16 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0072BB] focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-white dark:focus:border-sky-500 dark:focus:bg-slate-800"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              desktopInputRef.current?.focus();
            }}
            aria-label="Limpiar búsqueda"
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono-num text-[10px] font-semibold text-slate-400 md:inline-block dark:border-slate-700 dark:bg-slate-900">
            Ctrl K
          </kbd>
        )}

        {open && (
          <div className="absolute left-0 right-0 top-full z-40">
            {renderDropdownContent()}
          </div>
        )}
      </div>

      {/* Mobile full-width top search overlay */}
      {mobileOpen && (
        <div className="fixed inset-x-0 top-0 z-50 border-b border-slate-200 bg-white px-3 py-2 shadow-lg sm:hidden dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={mobileInputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (!open) setOpen(true);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder="Buscar clientes, equipos o productos..."
                aria-label="Búsqueda global entre clientes, equipos y productos"
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-8 text-sm text-slate-900 outline-none focus:border-[#0072BB] focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    mobileInputRef.current?.focus();
                  }}
                  aria-label="Limpiar búsqueda"
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={closeSearch}
              className="h-10 shrink-0 rounded-xl px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cerrar
            </button>
          </div>
          {open && renderDropdownContent()}
        </div>
      )}
    </div>
  );
};
