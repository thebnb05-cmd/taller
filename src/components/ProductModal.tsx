import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, StopCircle, Upload } from 'lucide-react';
import {
  clampStr,
  generateDocId,
  handleDbError,
  OperationType,
  stripUndefined,
  updateRow,
  upsertRow,
} from '../lib/db';
import {
  PRODUCT_BRANDS,
  PRODUCT_CATEGORIES,
  PRODUCT_SUGGESTIONS,
  SUBCATEGORIES_BY_CATEGORY,
} from '../data/catalog';
import type { ProductRecord, SupplierRecord } from '../types/workshop';
import { getCurrencyOption, useActiveCurrency } from '../utils/currency';
import {
  compressImageToDataUrl,
  computeProductPricing,
  formatCurrency,
  generateInternalProductCode,
} from '../utils/formatters';
import {
  parseSafeNonNegativeInt,
  parseSafePositiveNumber,
  sanitizeDbErrorMessage,
  sanitizeImageDataUrl,
  sanitizePlainLine,
  sanitizeText,
} from '../utils/validation';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';
import { useI18n } from '../utils/i18n';

interface ProductModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  suppliers: SupplierRecord[];
  products: ProductRecord[];
  editProduct?: ProductRecord | null;
}

export const ProductModal: React.FC<ProductModalProps> = ({
  open,
  onClose,
  ownerId,
  suppliers,
  products,
  editProduct,
}) => {
  const { notify } = useToast();
  const { tr } = useI18n();
  const activeCurrency = useActiveCurrency();
  const currencySymbol = getCurrencyOption(activeCurrency).symbol;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [productType, setProductType] = useState('Fisico');
  const [imageDataUrl, setImageDataUrl] = useState('');

  const [category, setCategory] = useState('Repuesto');
  const [subcategory, setSubcategory] = useState('');
  const [brand, setBrand] = useState('');
  const [supplierId, setSupplierId] = useState('');

  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [location, setLocation] = useState('');
  const [internalCode, setInternalCode] = useState('');

  const [cost, setCost] = useState('0');
  const [marginMode, setMarginMode] = useState<'percent' | 'fixed'>('percent');
  const [margin, setMargin] = useState('0');
  const [vat, setVat] = useState('0');
  const [rounding, setRounding] = useState('0');

  const [trackStock, setTrackStock] = useState(true);
  const [allowNoStock, setAllowNoStock] = useState(false);
  const [usesSerial, setUsesSerial] = useState(false);
  const [stock, setStock] = useState('0');
  const [minStock, setMinStock] = useState('1');
  const [reorderCap, setReorderCap] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [width, setWidth] = useState('');
  const [depth, setDepth] = useState('');

  const [scanning, setScanning] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('También podés usar un lector USB.');
  const [saving, setSaving] = useState(false);

  const stopScanner = () => {
    if (scanTimerRef.current) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    if (!open) {
      stopScanner();
      return;
    }
    if (editProduct) {
      setName(editProduct.name);
      setDescription(editProduct.description || '');
      setMetaDescription(editProduct.metaDescription || '');
      setProductType(editProduct.productType || 'Fisico');
      setImageDataUrl(editProduct.imageDataUrl || '');
      setCategory(editProduct.category || 'Repuesto');
      setSubcategory(editProduct.subcategory || '');
      setBrand(editProduct.brand || '');
      setSupplierId(editProduct.supplierId || '');
      setSku(editProduct.sku || '');
      setBarcode(editProduct.barcode || '');
      setLocation(editProduct.location || '');
      setInternalCode(editProduct.internalCode || generateInternalProductCode());
      setCost(String(editProduct.cost ?? 0));
      setMarginMode((editProduct.marginMode as 'percent' | 'fixed') || 'percent');
      setMargin(String(editProduct.margin ?? 0));
      setVat(String(editProduct.vat ?? 0));
      setRounding(String(editProduct.rounding ?? 0));
      setTrackStock(editProduct.trackStock ?? true);
      setAllowNoStock(editProduct.allowNoStock ?? false);
      setUsesSerial(editProduct.usesSerial ?? false);
      setStock(String(editProduct.stock ?? 0));
      setMinStock(String(editProduct.minStock ?? 1));
      setReorderCap(editProduct.reorderCap != null ? String(editProduct.reorderCap) : '');
      setWeight(editProduct.weight != null ? String(editProduct.weight) : '');
      setHeight(editProduct.height != null ? String(editProduct.height) : '');
      setWidth(editProduct.width != null ? String(editProduct.width) : '');
      setDepth(editProduct.depth != null ? String(editProduct.depth) : '');
    } else {
      setName('');
      setDescription('');
      setMetaDescription('');
      setProductType('Fisico');
      setImageDataUrl('');
      setCategory('Repuesto');
      const subs = SUBCATEGORIES_BY_CATEGORY['Repuesto'] || [];
      setSubcategory(subs[0] || '');
      setBrand('');
      setSupplierId('');
      setSku('');
      setBarcode('');
      setLocation('');
      setInternalCode(generateInternalProductCode());
      setCost('0');
      setMarginMode('percent');
      setMargin('50');
      setVat('0');
      setRounding('0');
      setTrackStock(true);
      setAllowNoStock(false);
      setUsesSerial(false);
      setStock('0');
      setMinStock('1');
      setReorderCap('');
      setWeight('');
      setHeight('');
      setWidth('');
      setDepth('');
    }
    setScannerStatus('También podés usar un lector USB.');
  }, [open, editProduct]);

  const subcategories = SUBCATEGORIES_BY_CATEGORY[category] || ['Varios'];
  const suggestions = PRODUCT_SUGGESTIONS[subcategory] || [];

  const pricing = useMemo(
    () =>
      computeProductPricing({
        cost: Number(cost || 0),
        marginMode,
        margin: Number(margin || 0),
        vat: Number(vat || 0),
        rounding: Number(rounding || 0),
      }),
    [cost, margin, marginMode, rounding, vat]
  );

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Usá una imagen PNG, JPG o WebP.', 'error');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      notify('La imagen no puede superar 4 MB.', 'error');
      return;
    }
    try {
      const compressed = await compressImageToDataUrl(file, 640, 0.8);
      const safeImg = sanitizeImageDataUrl(compressed, 700000);
      if (!safeImg) {
        notify('La imagen procesada supera el tamaño permitido.', 'error');
        return;
      }
      setImageDataUrl(safeImg);
    } catch {
      notify('No se pudo optimizar la imagen.', 'error');
    }
  };

  const handleLookupCode = () => {
    const code = barcode.trim();
    if (!code) return;
    const found = products.find((p) => p.barcode === code || p.sku === code);
    if (found && found.id !== editProduct?.id) {
      notify(`Ya existe un producto con ese código: ${found.name}`, 'info');
    }
  };

  const startScanner = async () => {
    if (scanning) {
      stopScanner();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerStatus('Cámara no disponible en este navegador. Usá lector USB o carga manual.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setScanning(true);
      setScannerStatus('Apuntá la cámara al código de barras...');

      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);

      const BarcodeDetectorCtor = (
        window as unknown as {
          BarcodeDetector?: new (opts: { formats: string[] }) => {
            detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
          };
        }
      ).BarcodeDetector;

      if (!BarcodeDetectorCtor) {
        setScannerStatus('Cámara activa, pero tu navegador no soporta BarcodeDetector nativo.');
        return;
      }

      const detector = new BarcodeDetectorCtor({
        formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'qr_code'],
      });

      scanTimerRef.current = window.setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const detected = await detector.detect(videoRef.current);
          if (detected.length > 0 && detected[0].rawValue) {
            setBarcode(detected[0].rawValue);
            setScannerStatus(`Código leído: ${detected[0].rawValue}`);
            stopScanner();
          }
        } catch {
          // Ignore single-frame detection errors
        }
      }, 350);
    } catch {
      setScannerStatus('No se pudo acceder a la cámara. Verificá los permisos.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sanitizePlainLine(name, 200);
    if (!cleanName) {
      notify('Ingresá el nombre del producto.', 'error');
      return;
    }
    const rawMargin = Number(String(margin || 0).replace(',', '.'));
    const safeMargin = Number.isFinite(rawMargin)
      ? Math.max(-999_999, Math.min(999_999_999, Math.round(rawMargin * 100) / 100))
      : 0;
    const safeImage = imageDataUrl ? sanitizeImageDataUrl(imageDataUrl, 700000) : '';

    setSaving(true);
    try {
      const supplier = suppliers.find((s) => s.id === supplierId);
      const baseFields = {
        name: cleanName,
        description: sanitizeText(description, 2000),
        metaDescription: sanitizePlainLine(metaDescription, 200),
        productType: clampStr(productType || 'Fisico', 40) || 'Fisico',
        imageDataUrl: safeImage,
        category: sanitizePlainLine(category || 'Repuesto', 80) || 'Repuesto',
        subcategory: sanitizePlainLine(subcategory, 80),
        brand: sanitizePlainLine(brand, 80),
        supplierId: clampStr(supplier?.id, 128),
        supplierName: sanitizePlainLine(supplier?.name || '', 160),
        sku: sanitizePlainLine(sku, 80),
        barcode: sanitizePlainLine(barcode, 80),
        location: sanitizePlainLine(location, 120),
        internalCode: sanitizePlainLine(internalCode || generateInternalProductCode(), 60),
        cost: parseSafePositiveNumber(cost, 0),
        marginMode,
        margin: safeMargin,
        vat: parseSafePositiveNumber(vat, 0, 100),
        rounding: parseSafePositiveNumber(rounding, 0, 100_000),
        netPrice: Number.isFinite(pricing.netPrice) ? Math.max(0, pricing.netPrice) : 0,
        price: Number.isFinite(pricing.finalPrice) ? Math.max(0, pricing.finalPrice) : 0,
        trackStock,
        allowNoStock,
        usesSerial,
        stock: parseSafeNonNegativeInt(stock, 0),
        minStock: parseSafeNonNegativeInt(minStock, 0),
      };

      const optNum = (v: string) => {
        if (!v.trim()) return undefined;
        const parsed = parseSafePositiveNumber(v, -1);
        return parsed >= 0 ? parsed : undefined;
      };

      if (editProduct) {
        const path = `products/${editProduct.id}`;
        const updatePayload = stripUndefined(
          {
            ...baseFields,
            reorderCap: reorderCap.trim() ? parseSafeNonNegativeInt(reorderCap, 0) : null,
            weight: optNum(weight) ?? null,
            height: optNum(height) ?? null,
            width: optNum(width) ?? null,
            depth: optNum(depth) ?? null,
          },
          true
        );
        try {
          await updateRow('products', editProduct.id, updatePayload, true);
          notify('Producto actualizado.');
          onClose();
        } catch (err) {
          notify(sanitizeDbErrorMessage(err, 'No se pudo guardar el producto.'), 'error');
          void handleDbError(err, OperationType.UPDATE, path).catch(() => {});
        }
      } else {
        const productId = generateDocId('products');
        const path = `products/${productId}`;
        const createPayload = stripUndefined({
          id: productId,
          ...baseFields,
          ownerId,
          reorderCap: reorderCap.trim() ? parseSafeNonNegativeInt(reorderCap, 0) : undefined,
          weight: optNum(weight),
          height: optNum(height),
          width: optNum(width),
          depth: optNum(depth),
          createdAt: new Date().toISOString(),
        });
        try {
          await upsertRow('products', createPayload);
          notify('Producto guardado.');
          onClose();
        } catch (err) {
          notify(sanitizeDbErrorMessage(err, 'No se pudo guardar el producto.'), 'error');
          void handleDbError(err, OperationType.CREATE, path).catch(() => {});
        }
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={
        editProduct
          ? tr('Editar producto', 'Edit product', 'Editar produto')
          : tr('Nuevo producto', 'New product', 'Novo produto')
      }
      maxWidth="3xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">
            {tr('Información básica', 'Basic information', 'Informações básicas')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Nombre del producto *', 'Product name *', 'Nome do produto *')}
              </label>
              <input
                type="text"
                required
                list="product-suggestions-list"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tr('Producto o repuesto', 'Product or spare part', 'Produto ou peça')}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <datalist id="product-suggestions-list">
                {suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Descripción', 'Description', 'Descrição')}
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={tr('Detalles del producto', 'Product details', 'Detalhes do produto')}
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Meta descripción SEO', 'SEO meta description', 'Meta descrição SEO')} ({metaDescription.length}/160)
              </label>
              <textarea
                rows={2}
                maxLength={160}
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                placeholder={tr('Descripción breve para buscadores', 'Short description for search', 'Breve descrição para buscas')}
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Tipo *', 'Type *', 'Tipo *')}
              </label>
              <select
                value={productType}
                onChange={(e) => {
                  const val = e.target.value;
                  setProductType(val);
                  if (val !== 'Fisico') setTrackStock(false);
                }}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="Fisico">{tr('Físico', 'Physical', 'Físico')}</option>
                <option value="Servicio">{tr('Servicio', 'Service', 'Serviço')}</option>
                <option value="Licencia digital">{tr('Licencia digital', 'Digital license', 'Licença digital')}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Imagen del producto', 'Product image', 'Imagem do produto')}
              </label>
              <div className="flex items-center gap-3">
                <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  <Upload className="h-3.5 w-3.5" />
                  <span>
                    {imageDataUrl
                      ? tr('Cambiar imagen', 'Change image', 'Alterar imagem')
                      : tr('Seleccionar imagen', 'Select image', 'Selecionar imagem')}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>
                {imageDataUrl && (
                  <img
                    src={imageDataUrl}
                    alt={tr('Vista previa', 'Preview', 'Pré-visualização')}
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                  />
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">
            {tr('Clasificación', 'Classification', 'Classificação')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Categoría *', 'Category *', 'Categoria *')}
              </label>
              <select
                value={category}
                onChange={(e) => {
                  const nextCat = e.target.value;
                  setCategory(nextCat);
                  setSubcategory((SUBCATEGORIES_BY_CATEGORY[nextCat] || ['Varios'])[0]);
                }}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Subcategoría', 'Subcategory', 'Subcategoria')}
              </label>
              <select
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                {subcategories.map((sub) => (
                  <option key={sub} value={sub}>
                    {sub}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Marca', 'Brand', 'Marca')}
              </label>
              <input
                type="text"
                list="product-brand-list"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder={tr('Sin marca', 'No brand', 'Sem marca')}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <datalist id="product-brand-list">
                {PRODUCT_BRANDS.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Proveedor', 'Supplier', 'Fornecedor')}
              </label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="">{tr('Sin proveedor', 'No supplier', 'Sem fornecedor')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">
            {tr('Identificación y ubicación', 'Identification & location', 'Identificação e localização')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                SKU
              </label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder={tr('Código propio', 'Custom code', 'Código próprio')}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Código de barras', 'Barcode', 'Código de barras')}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleLookupCode();
                    }
                  }}
                  placeholder={tr('Escanear o escribir', 'Scan or type', 'Escanear ou digitar')}
                  className="h-10 flex-1 rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <button
                  type="button"
                  onClick={startScanner}
                  title={tr('Leer código con cámara', 'Scan code with camera', 'Ler código com a câmera')}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {scanning ? <StopCircle className="h-4 w-4 text-red-500" /> : <Camera className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{scannerStatus}</p>
              {scanning && (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="mt-2 h-36 w-full rounded-xl border border-slate-200 bg-black object-cover"
                />
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Ubicación', 'Location', 'Localização')}
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={tr('Estante, caja o depósito', 'Shelf, bin, or storage', 'Prateleira, caixa ou depósito')}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Código interno', 'Internal code', 'Código interno')}
              </label>
              <input
                type="text"
                readOnly
                value={internalCode}
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono-num text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
              />
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">
            {tr('Precios', 'Pricing', 'Preços')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Costo de compra', 'Purchase cost', 'Custo de compra')} ({currencySymbol})
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Tipo de ganancia', 'Markup type', 'Tipo de lucro')}
              </label>
              <select
                value={marginMode}
                onChange={(e) => setMarginMode(e.target.value as 'percent' | 'fixed')}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="percent">{tr('Porcentaje sobre costo', 'Percentage over cost', 'Percentual sobre custo')}</option>
                <option value="fixed">{tr('Monto fijo sobre costo', 'Fixed amount over cost', 'Valor fixo sobre custo')}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {marginMode === 'percent'
                  ? tr('Ganancia (%)', 'Markup (%)', 'Lucro (%)')
                  : `${tr('Ganancia', 'Markup', 'Lucro')} (${currencySymbol})`}
              </label>
              <input
                type="number"
                step="0.01"
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('IVA', 'Tax / VAT', 'Imposto')}
              </label>
              <select
                value={vat}
                onChange={(e) => setVat(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="0">{tr('0% (Exento)', '0% (Exempt)', '0% (Isento)')}</option>
                <option value="10.5">10.5%</option>
                <option value="21">21%</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Redondeo', 'Rounding', 'Arredondamento')}
              </label>
              <select
                value={rounding}
                onChange={(e) => setRounding(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="0">{tr('Ninguno', 'None', 'Nenhum')}</option>
                <option value="1">{tr('Entero', 'Integer', 'Inteiro')}</option>
                <option value="10">{tr('Decena', 'Tens', 'Dezena')}</option>
                <option value="100">{tr('Centena', 'Hundreds', 'Centena')}</option>
                <option value="1000">{tr('Mil', 'Thousands', 'Milhar')}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Precio final de venta', 'Final selling price', 'Preço final de venda')}
              </label>
              <input
                type="text"
                readOnly
                value={formatCurrency(pricing.finalPrice, activeCurrency)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-sky-50 px-3 font-mono-num text-sm font-bold text-[#0072BB] dark:border-slate-700 dark:bg-sky-950/40 dark:text-sky-300"
              />
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">
            {tr('Control de stock y dimensiones', 'Stock control & dimensions', 'Controle de estoque e dimensões')}
          </h3>
          <div className="flex flex-wrap gap-4 text-xs font-medium text-slate-700 dark:text-slate-300">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={trackStock}
                onChange={(e) => setTrackStock(e.target.checked)}
                className="h-4 w-4 rounded accent-[#0072BB]"
              />
              {tr('Controlar stock', 'Track stock', 'Controlar estoque')}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={allowNoStock}
                onChange={(e) => setAllowNoStock(e.target.checked)}
                className="h-4 w-4 rounded accent-[#0072BB]"
              />
              {tr('Permitir venta sin stock', 'Allow sale out of stock', 'Permitir venda sem estoque')}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={usesSerial}
                onChange={(e) => setUsesSerial(e.target.checked)}
                className="h-4 w-4 rounded accent-[#0072BB]"
              />
              {tr('Usa series / IMEI', 'Uses serial / IMEI', 'Usa série / IMEI')}
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Stock actual', 'Current stock', 'Estoque atual')}
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Stock mínimo', 'Minimum stock', 'Estoque mínimo')}
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {tr('Tope de recompra', 'Reorder cap', 'Limite de recompra')}
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={reorderCap}
                onChange={(e) => setReorderCap(e.target.value)}
                placeholder={tr('Opcional', 'Optional', 'Opcional')}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input
              type="number"
              min="0"
              step="0.001"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder={tr('Peso (kg)', 'Weight (kg)', 'Peso (kg)')}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="number"
              min="0"
              step="0.1"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder={tr('Alto (cm)', 'Height (cm)', 'Altura (cm)')}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="number"
              min="0"
              step="0.1"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              placeholder={tr('Ancho (cm)', 'Width (cm)', 'Largura (cm)')}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="number"
              min="0"
              step="0.1"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              placeholder={tr('Profundidad (cm)', 'Depth (cm)', 'Profundidade (cm)')}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </section>

        <div className="flex gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {tr('Cancelar', 'Cancel', 'Cancelar')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c] disabled:opacity-60"
          >
            {saving
              ? tr('Guardando...', 'Saving...', 'Salvando...')
              : tr('Guardar producto', 'Save product', 'Salvar produto')}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
