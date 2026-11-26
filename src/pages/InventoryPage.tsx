import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  LayoutGrid,
  List,
  MessageCircle,
  Minus,
  Package,
  Plus,
  Printer,
  ReceiptText,
  Search,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { BrandMark } from '../components/BrandMark';
import { ModalShell } from '../components/ModalShell';
import type { PrintFormat } from '../components/RepairPrintDocuments';
import { useToast } from '../components/ToastProvider';
import { updateRow } from '../lib/db';
import type { ProductRecord, WorkshopProfile } from '../types/workshop';
import { downloadCsvFile } from '../utils/csvExport';
import { formatCompactCurrency, formatCurrency, formatDateShort, todayISO } from '../utils/formatters';
import { useI18n } from '../utils/i18n';
import {
  TRANSFER_QR_IVA_PRESETS,
  loadSavedTransferQrIvaPct,
  saveTransferQrIvaPct,
} from '../utils/repairMeta';
import { parseWorkshopMeta } from '../utils/workshopMeta';

interface CartEntry {
  productId: string;
  quantity: number;
}

export interface InventoryCartItem {
  product: ProductRecord;
  quantity: number;
}

interface InventoryPageProps {
  products: ProductRecord[];
  ownerId?: string;
  profile?: WorkshopProfile | null;
  initialFilter?: 'all' | 'repuestos' | 'accesorios' | 'bajo_stock';
  filterNonce?: number;
  onNewProduct: () => void;
  onImportProducts: () => void;
  onSelectProduct: (product: ProductRecord) => void;
  onCheckoutCart?: (items: InventoryCartItem[]) => void;
}

const roundMoney = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export const InventoryPage: React.FC<InventoryPageProps> = ({
  products,
  ownerId,
  profile,
  initialFilter = 'all',
  filterNonce = 0,
  onNewProduct,
  onImportProducts,
  onSelectProduct,
  onCheckoutCart,
}) => {
  const { notify } = useToast();
  const { tr } = useI18n();
  const workshopMeta = useMemo(() => parseWorkshopMeta(profile), [profile]);
  const cartStorageKey = `th3bnb_inv_cart_${ownerId || 'local'}`;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'repuestos' | 'accesorios' | 'bajo_stock'>(
    initialFilter
  );
  const [viewMode, setViewMode] = useState<'cards' | 'list'>(
    initialFilter === 'bajo_stock' ? 'list' : 'cards'
  );

  // Modo carrito: si está activo, un solo toque/clic agrega al carrito; si no, doble clic / doble toque
  const [cartMode, setCartMode] = useState(false);
  const [cartEntries, setCartEntries] = useState<CartEntry[]>(() => {
    try {
      if (typeof window === 'undefined') return [];
      const raw = window.localStorage.getItem(cartStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item): item is CartEntry =>
            item &&
            typeof item.productId === 'string' &&
            Number.isFinite(Number(item.quantity)) &&
            Number(item.quantity) > 0
        )
        .map((item) => ({ productId: item.productId, quantity: Math.floor(Number(item.quantity)) }));
    } catch {
      return [];
    }
  });
  const [pulseProductId, setPulseProductId] = useState<string | null>(null);
  const [cartModalOpen, setCartModalOpen] = useState(false);
  const [cartModalTab, setCartModalTab] = useState<'cart' | 'receipt'>('cart');
  const [receiptPrintFormat, setReceiptPrintFormat] = useState<PrintFormat>('a4');
  const [receiptCode, setReceiptCode] = useState(() => `BOL-${String(Date.now()).slice(-4)}`);
  const [cartClientName, setCartClientName] = useState('');
  const [cartNote, setCartNote] = useState('');
  const [applyCartIva, setApplyCartIva] = useState(false);
  const [cartIvaPct, setCartIvaPct] = useState<number>(() => loadSavedTransferQrIvaPct());

  const lastTapRef = useRef<{ id: string; time: number } | null>(null);
  const tapTimerRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (tapTimerRef.current !== null) {
        window.clearTimeout(tapTimerRef.current);
      }
      if (pulseTimerRef.current !== null) {
        window.clearTimeout(pulseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(cartStorageKey, JSON.stringify(cartEntries));
      }
    } catch {
      // ignore storage quota errors
    }
  }, [cartEntries, cartStorageKey]);

  useEffect(() => {
    setFilter(initialFilter);
    if (initialFilter === 'bajo_stock') {
      setViewMode('list');
    }
  }, [initialFilter, filterNonce]);

  const productMap = useMemo(() => {
    const map = new Map<string, ProductRecord>();
    for (const p of products) {
      map.set(p.id, p);
    }
    return map;
  }, [products]);

  const cartItems = useMemo<InventoryCartItem[]>(() => {
    const list: InventoryCartItem[] = [];
    for (const entry of cartEntries) {
      const product = productMap.get(entry.productId);
      if (!product) continue;
      const qty = Math.max(1, Math.floor(entry.quantity));
      list.push({ product, quantity: qty });
    }
    return list;
  }, [cartEntries, productMap]);

  const cartQtyMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cartItems) {
      map.set(item.product.id, item.quantity);
    }
    return map;
  }, [cartItems]);

  const cartTotalUnits = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );

  const cartSubtotal = useMemo(
    () =>
      roundMoney(
        cartItems.reduce((sum, item) => sum + Number(item.product.price || 0) * item.quantity, 0)
      ),
    [cartItems]
  );

  const cartSafeIvaPct = useMemo(
    () => (Number.isFinite(cartIvaPct) && cartIvaPct > 0 ? Math.min(100, cartIvaPct) : 0),
    [cartIvaPct]
  );

  const cartIvaAmount = useMemo(() => {
    if (!applyCartIva || cartSafeIvaPct <= 0 || cartSubtotal <= 0) return 0;
    return roundMoney(cartSubtotal * (cartSafeIvaPct / 100));
  }, [applyCartIva, cartSafeIvaPct, cartSubtotal]);

  const cartFinalTotal = useMemo(
    () => roundMoney(cartSubtotal + cartIvaAmount),
    [cartSubtotal, cartIvaAmount]
  );

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

  const triggerPulse = (productId: string) => {
    setPulseProductId(productId);
    if (pulseTimerRef.current !== null) {
      window.clearTimeout(pulseTimerRef.current);
    }
    pulseTimerRef.current = window.setTimeout(() => {
      setPulseProductId(null);
      pulseTimerRef.current = null;
    }, 550);
  };

  const addProductToCart = (product: ProductRecord, delta = 1) => {
    if (product.trackStock && Number(product.stock || 0) <= 0 && delta > 0) {
      notify(`${product.name} no tiene stock disponible, igual se agregó al carrito.`);
    }
    let nextQty = 0;
    setCartEntries((prev) => {
      const idx = prev.findIndex((item) => item.productId === product.id);
      if (idx === -1) {
        if (delta <= 0) return prev;
        nextQty = Math.max(1, delta);
        return [...prev, { productId: product.id, quantity: nextQty }];
      }
      const updated = prev[idx].quantity + delta;
      if (updated <= 0) {
        nextQty = 0;
        return prev.filter((item) => item.productId !== product.id);
      }
      nextQty = updated;
      return prev.map((item, i) => (i === idx ? { ...item, quantity: updated } : item));
    });
    if (delta > 0) {
      triggerPulse(product.id);
      notify(`${product.name} al carrito (x${nextQty || 1})`);
    }
  };

  const setCartItemQuantity = (productId: string, quantity: number) => {
    const cleanQty = Math.floor(Number(quantity) || 0);
    setCartEntries((prev) => {
      if (cleanQty <= 0) return prev.filter((item) => item.productId !== productId);
      const exists = prev.some((item) => item.productId === productId);
      if (!exists) return [...prev, { productId, quantity: cleanQty }];
      return prev.map((item) =>
        item.productId === productId ? { ...item, quantity: cleanQty } : item
      );
    });
  };

  const clearCart = () => {
    setCartEntries([]);
    setCartModalOpen(false);
    setCartModalTab('cart');
    notify('Carrito vaciado.');
  };

  // Soporta doble clic en PC y doble toque en celular/tablet (sin zoom ni abrir modal en el 1er toque)
  const handleProductTileTap = (product: ProductRecord) => {
    if (cartMode) {
      addProductToCart(product, 1);
      return;
    }

    const now = Date.now();
    const prev = lastTapRef.current;

    if (prev && prev.id === product.id && now - prev.time <= 340) {
      if (tapTimerRef.current !== null) {
        window.clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      lastTapRef.current = null;
      addProductToCart(product, 1);
      return;
    }

    lastTapRef.current = { id: product.id, time: now };
    if (tapTimerRef.current !== null) {
      window.clearTimeout(tapTimerRef.current);
    }
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = null;
      lastTapRef.current = null;
      onSelectProduct(product);
    }, 240);
  };

  const adjustStock = async (p: ProductRecord, delta: number) => {
    const next = Math.max(0, Number(p.stock || 0) + delta);
    try {
      await updateRow('products', p.id, { stock: next });
    } catch (err) {
      console.error(err);
      notify('No se pudo actualizar el stock.', 'error');
    }
  };

  const openCartModal = (tab: 'cart' | 'receipt' = 'cart') => {
    if (tab === 'receipt') {
      setReceiptCode(`BOL-${String(Date.now()).slice(-4)}`);
    }
    setCartModalTab(tab);
    setCartModalOpen(true);
  };

  const handleCheckoutToSale = () => {
    if (!onCheckoutCart || cartItems.length === 0) return;
    const payload = cartItems.map((item) => ({
      product: item.product,
      quantity: item.quantity,
    }));
    setCartEntries([]);
    setCartModalOpen(false);
    setCartModalTab('cart');
    setCartMode(false);
    onCheckoutCart(payload);
    notify(`Carrito pasado a venta (${payload.length} productos).`);
  };

  const handleExportCsv = () => {
    if (filtered.length === 0) {
      notify('No hay productos para exportar con el filtro actual.', 'error');
      return;
    }
    const headers = [
      'Nombre',
      'Categoría',
      'Subcategoría',
      'Marca',
      'SKU',
      'Código de barras',
      'Código interno',
      'Ubicación',
      'Proveedor',
      'Control de stock',
      'Stock actual',
      'Stock mínimo',
      'Estado stock',
      'Costo',
      'Modo margen',
      'Margen',
      'IVA (%)',
      'Precio neto',
      'Precio final',
      'Valorizado en stock',
    ];
    const rows = filtered.map((p) => {
      const stockNum = Number(p.stock || 0);
      const minNum = Number(p.minStock || 0);
      const low = Boolean(p.trackStock && stockNum <= minNum);
      const valorizado = Number(p.price || 0) * (p.trackStock ? stockNum : 1);
      return [
        p.name,
        p.category,
        p.subcategory || '',
        p.brand || '',
        p.sku || '',
        p.barcode || '',
        p.internalCode || '',
        p.location || '',
        p.supplierName || '',
        p.trackStock,
        p.trackStock ? stockNum : '',
        p.trackStock ? minNum : '',
        p.trackStock ? (low ? 'Bajo stock' : 'OK') : 'Sin control',
        Number(p.cost || 0),
        p.marginMode === 'fixed' ? 'Fijo' : 'Porcentaje (%)',
        Number(p.margin || 0),
        Number(p.vat || 0),
        Number(p.netPrice || 0),
        Number(p.price || 0),
        valorizado,
      ];
    });
    downloadCsvFile(`inventario-${todayISO()}.csv`, headers, rows);
    notify(`Exportados ${filtered.length} productos a CSV.`);
  };

  const displayClientName = cartClientName.trim() || 'Cliente mostrador';
  const receiptDateLabel = formatDateShort(todayISO());

  const buildCartShareText = () => {
    const lines = [
      `*${profile?.brandName || 'TH3 BNB Servicio Técnico'}*`,
      `Boleta de productos: *${receiptCode}*`,
      `Fecha: ${receiptDateLabel}`,
      `Cliente: ${displayClientName}`,
      '',
      '*Productos obtenidos:*',
      ...cartItems.map(
        (item, index) =>
          `${index + 1}. ${item.product.name}${item.product.sku ? ` (SKU: ${item.product.sku})` : ''} x${item.quantity} · ${formatCurrency(item.product.price)} c/u = ${formatCurrency(Number(item.product.price || 0) * item.quantity)}`
      ),
      '',
      `Subtotal (${cartTotalUnits} u.): ${formatCurrency(cartSubtotal)}`,
    ];
    if (cartIvaAmount > 0) {
      lines.push(`IVA Transferencia / QR (${cartSafeIvaPct}%): +${formatCurrency(cartIvaAmount)}`);
    }
    lines.push(`*Total: ${formatCurrency(cartFinalTotal)}*`);
    if (cartNote.trim()) {
      lines.push(`Nota: ${cartNote.trim()}`);
    }
    return lines.join('\n');
  };

  const handleCopyCartSummary = async () => {
    try {
      await navigator.clipboard.writeText(buildCartShareText());
      notify('Detalle de la boleta copiado.');
    } catch {
      notify('No se pudo copiar al portapapeles.', 'error');
    }
  };

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(buildCartShareText())}`;

  const renderA4Boleta = (isPrintMode: boolean) => (
    <div
      className={`bg-white text-slate-900 ${
        isPrintMode ? 'p-7' : 'rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex flex-col items-start gap-1.5">
          <div className="inline-block rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#0072BB]">
            Boleta de productos obtenidos
          </div>
          <BrandMark profile={profile} size="lg" forceLight />
          {workshopMeta.subtitle && (
            <div className="text-[11px] font-semibold text-[#0072BB]">{workshopMeta.subtitle}</div>
          )}
          <div className="flex flex-col gap-0.5 text-xs text-slate-600">
            <span>
              {profile?.businessAddress || 'Servicio técnico especializado, repuestos y accesorios'}
            </span>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
              {profile?.businessPhone && <span>Tel: {profile.businessPhone}</span>}
              {workshopMeta.businessEmail && <span>{workshopMeta.businessEmail}</span>}
              {workshopMeta.taxId && <span>{workshopMeta.taxId}</span>}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="font-mono-num text-lg font-extrabold text-slate-900">{receiptCode}</div>
          <div className="mt-0.5 text-xs text-slate-500">Fecha: {receiptDateLabel}</div>
          <div className="mt-1 inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
            {cartItems.length} productos · {cartTotalUnits} u.
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200/80 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Cliente / Destinatario
          </div>
          <div className="mt-1 text-sm font-bold text-slate-900">{displayClientName}</div>
        </div>
        <div className="rounded-xl border border-slate-200/80 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Detalle de entrega
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-800">
            {cartNote.trim() || 'Entrega en mostrador · Productos seleccionados del catálogo'}
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Producto obtenido</th>
              <th className="px-3 py-2 text-center">Cant.</th>
              <th className="px-3 py-2 text-right">Unitario</th>
              <th className="px-3 py-2 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cartItems.map((item, idx) => (
              <tr key={item.product.id} className="text-slate-900">
                <td className="px-3 py-2.5 font-mono-num text-[11px] text-slate-500">{idx + 1}</td>
                <td className="px-3 py-2.5 font-semibold">
                  <div>{item.product.name}</div>
                  <div className="font-mono-num text-[10px] font-normal text-slate-500">
                    {item.product.category}
                    {item.product.brand ? ` · ${item.product.brand}` : ''}
                    {item.product.sku ? ` · SKU: ${item.product.sku}` : ''}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center font-mono-num font-semibold">
                  {item.quantity}
                </td>
                <td className="px-3 py-2.5 text-right font-mono-num">
                  {formatCurrency(item.product.price)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono-num font-bold">
                  {formatCurrency(Number(item.product.price || 0) * item.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col items-end gap-1 border-t border-slate-200 pt-3 text-xs">
        <div className="flex w-full max-w-xs justify-between text-slate-600">
          <span>Subtotal ({cartTotalUnits} u.)</span>
          <span className="font-mono-num font-semibold">{formatCurrency(cartSubtotal)}</span>
        </div>
        {cartIvaAmount > 0 && (
          <div className="flex w-full max-w-xs justify-between text-sky-700">
            <span>IVA Transferencia / QR ({cartSafeIvaPct}%)</span>
            <span className="font-mono-num font-semibold">+{formatCurrency(cartIvaAmount)}</span>
          </div>
        )}
        <div className="mt-1 flex w-full max-w-xs justify-between border-t border-slate-200 pt-2 text-base font-extrabold text-slate-900">
          <span>Total</span>
          <span className="font-mono-num">{formatCurrency(cartFinalTotal)}</span>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-dashed border-slate-200 pt-4 text-[11px] text-slate-500">
        <div>
          {workshopMeta.footerNote || 'Documento emitido desde Inventario y Carrito del taller.'}
        </div>
        <div className="min-w-[180px] border-t border-slate-300 pt-1 text-center">
          Firma / Recibí conforme
        </div>
      </div>
    </div>
  );

  const renderThermalBoleta = () => (
    <div className="print-ticket-80mm mx-auto w-[302px] border border-slate-300 bg-white p-3 font-mono text-[11px] leading-snug text-black">
      <div className="border-b border-dashed border-black pb-2 text-center">
        <div className="flex justify-center">
          <BrandMark profile={profile} size="sm" forceLight />
        </div>
        <div className="mt-1 text-[10px] font-bold uppercase">Boleta de productos</div>
        {profile?.businessAddress && <div className="text-[9.5px]">{profile.businessAddress}</div>}
        {profile?.businessPhone && <div className="text-[9.5px]">Tel: {profile.businessPhone}</div>}
      </div>

      <div className="border-b border-dashed border-black py-1.5 text-[10px]">
        <div className="flex justify-between">
          <span>Boleta:</span>
          <strong>{receiptCode}</strong>
        </div>
        <div className="flex justify-between">
          <span>Fecha:</span>
          <span>{receiptDateLabel}</span>
        </div>
        <div className="flex justify-between">
          <span>Cliente:</span>
          <strong className="truncate pl-2">{displayClientName}</strong>
        </div>
        {cartNote.trim() && <div className="mt-0.5 text-[9.5px]">Nota: {cartNote.trim()}</div>}
      </div>

      <div className="border-b border-dashed border-black py-1.5">
        <div className="mb-1 text-[9.5px] font-bold uppercase">Productos obtenidos:</div>
        {cartItems.map((item, idx) => (
          <div key={item.product.id} className="mb-1.5 last:mb-0">
            <div className="font-bold">
              {idx + 1}. {item.product.name}
            </div>
            <div className="flex justify-between text-[10px]">
              <span>
                {item.quantity} x {formatCurrency(item.product.price)}
              </span>
              <strong>{formatCurrency(Number(item.product.price || 0) * item.quantity)}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="border-b border-dashed border-black py-1.5 text-[10.5px]">
        <div className="flex justify-between">
          <span>Subtotal ({cartTotalUnits} u.):</span>
          <span>{formatCurrency(cartSubtotal)}</span>
        </div>
        {cartIvaAmount > 0 && (
          <div className="flex justify-between">
            <span>IVA Transf/QR ({cartSafeIvaPct}%):</span>
            <span>+{formatCurrency(cartIvaAmount)}</span>
          </div>
        )}
        <div className="mt-1 flex justify-between border-t border-black pt-1 text-[12px] font-black">
          <span>TOTAL:</span>
          <span>{formatCurrency(cartFinalTotal)}</span>
        </div>
      </div>

      <div className="pt-2 text-center text-[9.5px]">
        <div>{workshopMeta.footerNote || '¡Gracias por elegirnos!'}</div>
        <div className="mt-5 border-t border-black pt-1">Firma y aclaración</div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 pb-24 lg:pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            {tr('Inventario y productos', 'Inventory & products', 'Estoque e produtos')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {tr(
              'Catálogo, existencias y carrito rápido de repuestos y accesorios',
              'Catalog, stock levels and quick cart for spare parts & accessories',
              'Catálogo, estoque e carrinho rápido de peças e acessórios'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openCartModal('cart')}
            className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
              cartTotalUnits > 0
                ? 'border-emerald-500 bg-emerald-600 text-white shadow-xs hover:bg-emerald-700'
                : 'border-slate-200 bg-white text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
            }`}
          >
            <ShoppingCart className="h-4 w-4" />
            <span>Carrito</span>
            {cartTotalUnits > 0 && (
              <span className="rounded-md bg-white/20 px-1.5 py-0.5 font-mono-num text-[11px] font-bold">
                {cartTotalUnits}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            title={tr(
              'Descargar listado de inventario en formato CSV',
              'Download inventory list as CSV',
              'Baixar lista de estoque em CSV'
            )}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:border-[#0072BB] hover:text-[#0072BB] disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-400 dark:hover:text-sky-300"
          >
            <Download className="h-4 w-4" />
            {tr('Exportar CSV', 'Export CSV', 'Exportar CSV')}
          </button>
          <button
            type="button"
            onClick={onImportProducts}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {tr('Importar Excel', 'Import Excel', 'Importar Excel')}
          </button>
          <button
            type="button"
            onClick={onNewProduct}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c] whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            {tr('Agregar', 'Add', 'Adicionar')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
            {products.length}
          </div>
          <div className="text-xs text-slate-500">{tr('Productos', 'Products', 'Produtos')}</div>
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
          <div className="text-xs text-slate-500">{tr('Stock bajo', 'Low stock', 'Estoque baixo')}</div>
        </button>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="font-mono-num text-2xl font-bold text-[#0072BB] dark:text-sky-400">
            {formatCompactCurrency(inventoryValue)}
          </div>
          <div className="text-xs text-slate-500">{tr('Valorizado', 'Total value', 'Valor total')}</div>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr(
              'Buscar por nombre, SKU, código de barras, marca o ubicación...',
              'Search by name, SKU, barcode, brand or location...',
              'Buscar por nome, SKU, código de barras, marca ou localização...'
            )}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCartMode((prev) => !prev)}
            className={`inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
              cartMode
                ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-500 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-emerald-500 dark:hover:text-emerald-300'
            }`}
          >
            <ShoppingCart className="h-4 w-4" />
            <span>{cartMode ? 'Modo carrito: ON (1 toque)' : 'Modo carrito'}</span>
          </button>

          <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
            {[
              { id: 'all', label: tr('Todo', 'All', 'Tudo') },
              { id: 'repuestos', label: tr('Repuestos', 'Spare parts', 'Peças') },
              { id: 'accesorios', label: tr('Accesorios', 'Accessories', 'Acessórios') },
              {
                id: 'bajo_stock',
                label: `${tr('Bajo stock', 'Low stock', 'Estoque baixo')}${lowStockCount > 0 ? ` (${lowStockCount})` : ''}`,
              },
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
              {tr('Tarjetas', 'Cards', 'Cartões')}
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
              {tr('Lista (+/-)', 'List (+/-)', 'Lista (+/-)')}
            </button>
          </div>
        </div>
      </div>

      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2 text-xs ${
          cartMode
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
            : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300'
        }`}
      >
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-3.5 w-3.5 shrink-0" />
          {cartMode ? (
            <span>
              <strong>Modo carrito activo:</strong> tocá cualquier producto una sola vez para
              sumarlo rápido al carrito (usá el ícono de ojo para ver o editar su ficha).
            </span>
          ) : (
            <span>
              <strong>Tip carrito:</strong> hacé <strong>doble clic</strong> (PC) o{' '}
              <strong>tocá dos veces</strong> (celular/tablet) sobre un producto para sumarlo al
              carrito, o activá <strong>Modo carrito</strong> si vas a elegir muchos.
            </span>
          )}
        </div>
        {cartItems.length > 0 && (
          <button
            type="button"
            onClick={() => openCartModal('receipt')}
            className="inline-flex items-center gap-1 font-semibold text-[#0072BB] hover:underline dark:text-sky-400"
          >
            <ReceiptText className="h-3.5 w-3.5" />
            Ver boleta ({cartTotalUnits} u.)
          </button>
        )}
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
            const inCartQty = cartQtyMap.get(p.id) || 0;
            const isPulsing = pulseProductId === p.id;
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => handleProductTileTap(p)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleProductTileTap(p);
                  }
                }}
                className={`touch-manipulation select-none flex cursor-pointer items-center gap-3.5 rounded-2xl border p-4 text-left transition ${
                  inCartQty > 0
                    ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500/20 dark:border-emerald-500/70 dark:bg-emerald-950/20'
                    : 'border-slate-200 bg-white hover:border-[#0072BB]/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/40'
                } ${isPulsing ? 'scale-[0.99] ring-2 ring-emerald-500/50' : ''}`}
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
                  <div className="flex items-start justify-between gap-2">
                    <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                      {p.name}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectProduct(p);
                      }}
                      title="Ver detalle / editar"
                      aria-label={`Ver detalle de ${p.name}`}
                      className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-[#0072BB] dark:hover:bg-slate-800 dark:hover:text-sky-400"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
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

                  {inCartQty > 0 && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="mt-2 flex items-center justify-between rounded-xl border border-emerald-200 bg-white px-2 py-1 text-[11px] dark:border-emerald-800 dark:bg-slate-900"
                    >
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                        <Check className="h-3 w-3" />
                        En carrito
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => addProductToCart(p, -1)}
                          aria-label={`Quitar 1 ${p.name} del carrito`}
                          className="flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="min-w-[20px] text-center font-mono-num font-bold text-slate-900 dark:text-white">
                          {inCartQty}
                        </span>
                        <button
                          type="button"
                          onClick={() => addProductToCart(p, 1)}
                          aria-label={`Sumar 1 ${p.name} al carrito`}
                          className="flex h-6 w-6 items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {filtered.map((p) => {
            const low = p.trackStock && p.stock <= p.minStock;
            const inCartQty = cartQtyMap.get(p.id) || 0;
            return (
              <div
                key={p.id}
                onClick={() => handleProductTileTap(p)}
                className={`touch-manipulation select-none flex cursor-pointer flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition ${
                  inCartQty > 0 ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : ''
                }`}
              >
                <div className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-bold text-slate-900 dark:text-white">
                      {p.name}
                    </span>
                    {low && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
                        <AlertTriangle className="h-3 w-3" />
                        Reponer
                      </span>
                    )}
                    {inCartQty > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 font-mono-num text-[11px] font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                        <ShoppingCart className="h-3 w-3" />
                        Carrito x{inCartQty}
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
                </div>

                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex flex-wrap items-center gap-2"
                >
                  {inCartQty > 0 ? (
                    <div className="flex items-center gap-1 rounded-xl border border-emerald-300 bg-white px-2 py-1 dark:border-emerald-700 dark:bg-slate-900">
                      <span className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">
                        Carr.
                      </span>
                      <button
                        type="button"
                        onClick={() => addProductToCart(p, -1)}
                        aria-label={`Restar 1 ${p.name} del carrito`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center font-mono-num text-xs font-bold text-slate-900 dark:text-white">
                        {inCartQty}
                      </span>
                      <button
                        type="button"
                        onClick={() => addProductToCart(p, 1)}
                        aria-label={`Sumar 1 ${p.name} al carrito`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addProductToCart(p, 1)}
                      className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-emerald-500 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      <ShoppingCart className="h-3.5 w-3.5" />
                      + Carrito
                    </button>
                  )}

                  {p.trackStock ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => adjustStock(p, -1)}
                        aria-label="Restar 1 stock"
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-10 text-center font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                        {p.stock}
                      </span>
                      <button
                        type="button"
                        onClick={() => adjustStock(p, 1)}
                        aria-label="Sumar 1 stock"
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Sin stock fijo
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => onSelectProduct(p)}
                    aria-label={`Ver detalle de ${p.name}`}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:border-[#0072BB] hover:text-[#0072BB] dark:border-slate-700 dark:text-slate-300"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Barra flotante de carrito */}
      {cartItems.length > 0 && (
        <div className="no-print fixed bottom-20 left-3 right-3 z-30 mx-auto max-w-4xl rounded-2xl border border-emerald-500/40 bg-slate-900/95 p-3 text-white shadow-xl backdrop-blur-md lg:bottom-5 lg:left-64 lg:right-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-white">
                <ShoppingCart className="h-5 w-5" />
              </span>
              <div>
                <div className="text-xs font-bold">
                  {cartItems.length} {cartItems.length === 1 ? 'producto' : 'productos'} ·{' '}
                  <span className="font-mono-num">{cartTotalUnits} u.</span>
                </div>
                <div className="font-mono-num text-sm font-extrabold text-emerald-300">
                  Total: {formatCurrency(cartFinalTotal)}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={clearCart}
                className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-700 px-3 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Vaciar
              </button>
              <button
                type="button"
                onClick={() => openCartModal('receipt')}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sky-400/40 bg-sky-500/20 px-3 text-xs font-semibold text-sky-200 hover:bg-sky-500/30"
              >
                <ReceiptText className="h-3.5 w-3.5" />
                Ver boleta
              </button>
              <button
                type="button"
                onClick={() => openCartModal('cart')}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
              >
                Abrir carrito
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Carrito y Boleta de productos obtenidos */}
      <ModalShell
        open={cartModalOpen}
        onClose={() => setCartModalOpen(false)}
        title={
          cartModalTab === 'receipt'
            ? `Boleta de productos obtenidos · ${receiptCode}`
            : `Carrito de inventario (${cartTotalUnits} u.)`
        }
        maxWidth="3xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-800/50">
            <div className="inline-flex rounded-xl bg-white p-1 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setCartModalTab('cart')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  cartModalTab === 'cart'
                    ? 'bg-[#0072BB] text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                }`}
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                Carrito ({cartItems.length})
              </button>
              <button
                type="button"
                disabled={cartItems.length === 0}
                onClick={() => {
                  setReceiptCode(`BOL-${String(Date.now()).slice(-4)}`);
                  setCartModalTab('receipt');
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${
                  cartModalTab === 'receipt'
                    ? 'bg-[#0072BB] text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                }`}
              >
                <ReceiptText className="h-3.5 w-3.5" />
                Boleta de productos
              </button>
            </div>

            {cartItems.length > 0 && cartModalTab === 'cart' && (
              <button
                type="button"
                onClick={clearCart}
                className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Vaciar carrito
              </button>
            )}
          </div>

          {cartItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center dark:border-slate-800">
              <ShoppingCart className="mx-auto h-7 w-7 text-slate-400" />
              <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                El carrito está vacío
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Hacé doble clic o tocá dos veces cualquier producto del inventario (o activá Modo
                carrito) para ir armando la lista y generar su boleta.
              </p>
            </div>
          ) : cartModalTab === 'cart' ? (
            <div className="space-y-4">
              <div className="max-h-[40vh] divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                {cartItems.map((item) => (
                  <div
                    key={item.product.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                        {item.product.name}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {formatCurrency(item.product.price)} c/u
                        {item.product.sku ? ` · SKU: ${item.product.sku}` : ''}
                        {item.product.trackStock ? ` · Stock actual: ${item.product.stock} u.` : ''}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => addProductToCart(item.product, -1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) =>
                          setCartItemQuantity(
                            item.product.id,
                            Math.max(1, Number(e.target.value) || 1)
                          )
                        }
                        className="h-8 w-14 rounded-lg border border-slate-200 bg-slate-50 text-center font-mono-num text-xs font-bold text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => addProductToCart(item.product, 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>

                      <div className="w-24 text-right font-mono-num text-xs font-bold text-slate-900 dark:text-white">
                        {formatCurrency(Number(item.product.price || 0) * item.quantity)}
                      </div>

                      <button
                        type="button"
                        onClick={() => setCartItemQuantity(item.product.id, 0)}
                        aria-label={`Quitar ${item.product.name}`}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Cliente / Destinatario (para la boleta)
                  </label>
                  <input
                    type="text"
                    value={cartClientName}
                    onChange={(e) => setCartClientName(e.target.value)}
                    placeholder="Cliente mostrador"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Nota / Referencia
                  </label>
                  <input
                    type="text"
                    value={cartNote}
                    onChange={(e) => setCartNote(e.target.value)}
                    placeholder="Ej: Retira en mostrador / Técnico Juan"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900/60 dark:bg-sky-950/25">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                    <input
                      type="checkbox"
                      checked={applyCartIva}
                      onChange={(e) => setApplyCartIva(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#0072BB] focus:ring-[#0072BB]"
                    />
                    Sumar IVA Transferencia / QR ({cartSafeIvaPct}%)
                  </label>
                  {applyCartIva && (
                    <span className="font-mono-num text-xs font-bold text-sky-700 dark:text-sky-300">
                      +{formatCurrency(cartIvaAmount)}
                    </span>
                  )}
                </div>

                {applyCartIva && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {TRANSFER_QR_IVA_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setCartIvaPct(preset);
                          saveTransferQrIvaPct(preset);
                        }}
                        className={`rounded-lg border px-2 py-1 font-mono-num text-[11px] font-semibold transition ${
                          Math.abs(cartSafeIvaPct - preset) < 0.01
                            ? 'border-[#0072BB] bg-[#0072BB] text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                        }`}
                      >
                        {preset}%{preset === 6.5 ? ' MP' : ''}
                      </button>
                    ))}
                    <div className="ml-auto flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={cartIvaPct}
                        onChange={(e) => {
                          const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                          setCartIvaPct(val);
                          if (val > 0) saveTransferQrIvaPct(val);
                        }}
                        className="h-7 w-16 rounded-lg border border-slate-200 bg-white px-2 text-right font-mono-num text-xs font-bold text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                      <span className="text-xs font-semibold text-slate-500">%</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {cartItems.length} productos · {cartTotalUnits} unidades
                  </div>
                  <div className="font-mono-num text-xl font-extrabold text-slate-900 dark:text-white">
                    Total: {formatCurrency(cartFinalTotal)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReceiptCode(`BOL-${String(Date.now()).slice(-4)}`);
                      setCartModalTab('receipt');
                    }}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#0072BB] bg-white px-4 text-xs font-semibold text-[#0072BB] hover:bg-sky-50 dark:border-sky-400 dark:bg-slate-900 dark:text-sky-300"
                  >
                    <ReceiptText className="h-4 w-4" />
                    Generar boleta
                  </button>
                  {onCheckoutCart && (
                    <button
                      type="button"
                      onClick={handleCheckoutToSale}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-700"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      Pasar a Venta / Cobrar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setReceiptPrintFormat('a4')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      receiptPrintFormat === 'a4'
                        ? 'bg-[#0072BB] text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Hoja A4
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceiptPrintFormat('thermal80')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      receiptPrintFormat === 'thermal80'
                        ? 'bg-[#0072BB] text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                    }`}
                  >
                    <ReceiptText className="h-3.5 w-3.5" />
                    Térmico 80mm
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyCartSummary()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copiar
                  </button>
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white hover:bg-[#005f9c]"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Imprimir boleta
                  </button>
                </div>
              </div>

              <div className="max-h-[58vh] overflow-y-auto rounded-2xl bg-slate-100/70 p-2 sm:p-4 dark:bg-slate-950/50">
                {receiptPrintFormat === 'a4' ? renderA4Boleta(false) : renderThermalBoleta()}
              </div>
            </div>
          )}
        </div>
      </ModalShell>

      {cartModalOpen &&
        cartModalTab === 'receipt' &&
        cartItems.length > 0 &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="print-only hidden bg-white text-slate-900">
            {receiptPrintFormat === 'thermal80' && (
              <style>{`@media print { @page { size: 80mm auto; margin: 2mm; } }`}</style>
            )}
            {receiptPrintFormat === 'a4' ? renderA4Boleta(true) : renderThermalBoleta()}
          </div>,
          document.body
        )}
    </div>
  );
};
