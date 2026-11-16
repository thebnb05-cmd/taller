import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  FileSpreadsheet,
  LayoutGrid,
  List,
  Minus,
  Package,
  Plus,
  Search,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { updateRow } from '../lib/db';
import type { ProductRecord } from '../types/workshop';
import { formatCompactCurrency, formatCurrency } from '../utils/formatters';

interface InventoryPageProps {
  products: ProductRecord[];
  initialFilter?: 'all' | 'repuestos' | 'accesorios' | 'bajo_stock';
  filterNonce?: number;
  onNewProduct: () => void;
  onImportProducts: () => void;
  onSelectProduct: (product: ProductRecord) => void;
}

export const InventoryPage: React.FC<InventoryPageProps> = ({
  products,
  initialFilter = 'all',
  filterNonce = 0,
  onNewProduct,
  onImportProducts,
  onSelectProduct,
}) => {
  const { notify } = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'repuestos' | 'accesorios' | 'bajo_stock'>(
    initialFilter
  );
  const [viewMode, setViewMode] = useState<'cards' | 'list'>(
    initialFilter === 'bajo_stock' ? 'list' : 'cards'
  );

  useEffect(() => {
    setFilter(initialFilter);
    if (initialFilter === 'bajo_stock') {
      setViewMode('list');
    }
  }, [initialFilter, filterNonce]);

  const lowStockCount = useMemo(
    () => products.filter((p) => p.trackStock && p.stock <= p.minStock).length,
    [products]
  );

  const inventoryValue = useMemo(
    () =>
      products.reduce(
        (sum, p) => sum + Number(p.price || 0) * (p.trackStock ? Number(p.stock || 0) : 1),
        0
      ),
    [products]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...products]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((p) => {
        if (filter === 'repuestos' && p.category !== 'Repuesto') return false;
        if (filter === 'accesorios' && p.category !== 'Accesorio') return false;
        if (filter === 'bajo_stock' && !(p.trackStock && p.stock <= p.minStock)) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q) ||
          (p.internalCode || '').toLowerCase().includes(q) ||
          (p.brand || '').toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          (p.location || '').toLowerCase().includes(q)
        );
      });
  }, [filter, products, search]);

  const adjustStock = async (p: ProductRecord, delta: number) => {
    const next = Math.max(0, Number(p.stock || 0) + delta);
    try {
      await updateRow('products', p.id, { stock: next });
    } catch (err) {
      console.error(err);
      notify('No se pudo actualizar el stock.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Inventario y productos
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Catálogo, existencias y reposición de repuestos y accesorios
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onImportProducts}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Importar Excel
          </button>
          <button
            type="button"
            onClick={onNewProduct}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            Agregar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
            {products.length}
          </div>
          <div className="text-xs text-slate-500">Productos</div>
        </div>
        <button
          type="button"
          onClick={() => setFilter((prev) => (prev === 'bajo_stock' ? 'all' : 'bajo_stock'))}
          className={`rounded-2xl border bg-white p-4 text-left transition dark:bg-slate-900 ${
            filter === 'bajo_stock'
              ? 'border-amber-500 ring-1 ring-amber-500/30 dark:border-amber-400'
              : 'border-slate-200 hover:border-amber-300 dark:border-slate-800 dark:hover:border-amber-700'
          }`}
        >
          <div className="font-mono-num text-2xl font-bold text-amber-600 dark:text-amber-400">
            {lowStockCount}
          </div>
          <div className="text-xs text-slate-500">Stock bajo</div>
        </button>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-2xl font-bold text-[#0072BB] dark:text-sky-400">
            {formatCompactCurrency(inventoryValue)}
          </div>
          <div className="text-xs text-slate-500">Valorizado</div>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, SKU, código de barras, marca o ubicación..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
            {[
              { id: 'all', label: 'Todo' },
              { id: 'repuestos', label: 'Repuestos' },
              { id: 'accesorios', label: 'Accesorios' },
              { id: 'bajo_stock', label: `Bajo stock${lowStockCount > 0 ? ` (${lowStockCount})` : ''}` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id as typeof filter)}
                className={`h-9 rounded-lg px-3 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                  filter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                viewMode === 'cards'
                  ? 'bg-white text-[#0072BB] shadow-xs dark:bg-slate-800 dark:text-sky-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Tarjetas
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                viewMode === 'list'
                  ? 'bg-white text-[#0072BB] shadow-xs dark:bg-slate-800 dark:text-sky-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              Lista (+/-)
            </button>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <Package className="mx-auto h-7 w-7 text-slate-400" />
          <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
            No hay productos para mostrar
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Probá con otro filtro o agregá un nuevo artículo.
          </p>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const low = p.trackStock && p.stock <= p.minStock;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectProduct(p)}
                className="flex items-center gap-3.5 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-[#0072BB]/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/40"
              >
                {p.imageDataUrl ? (
                  <img
                    src={p.imageDataUrl}
                    alt={p.name}
                    referrerPolicy="no-referrer"
                    className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                  />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800">
                    <Package className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {p.name}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                    {p.category}
                    {p.brand ? ` · ${p.brand}` : ''}
                    {p.location ? ` · ${p.location}` : ''}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <span className="font-mono-num font-bold text-[#0072BB] dark:text-sky-400">
                      {formatCurrency(p.price)}
                    </span>
                    {p.trackStock && (
                      <span
                        className={`font-mono-num font-semibold ${
                          low ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {p.stock} u.{low ? ' · Bajo' : ''}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {filtered.map((p) => {
            const low = p.trackStock && p.stock <= p.minStock;
            return (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
              >
                <button
                  type="button"
                  onClick={() => onSelectProduct(p)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold text-slate-900 dark:text-white">
                      {p.name}
                    </span>
                    {low && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
                        <AlertTriangle className="h-3 w-3" />
                        Reponer
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {p.category}
                    {p.brand ? ` · ${p.brand}` : ''}
                    {p.location ? ` · Ubicación: ${p.location}` : ''}
                    {p.sku ? ` · SKU: ${p.sku}` : ''}
                    <span> · {formatCurrency(p.price)}</span>
                  </div>
                </button>

                {p.trackStock ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => adjustStock(p, -1)}
                      aria-label="Restar 1"
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-12 text-center font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                      {p.stock}
                    </span>
                    <button
                      type="button"
                      onClick={() => adjustStock(p, 1)}
                      aria-label="Sumar 1"
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    Sin control de stock
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
