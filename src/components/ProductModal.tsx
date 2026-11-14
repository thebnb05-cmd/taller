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
import {
  compressImageToDataUrl,
  computeProductPricing,
  generateInternalProductCode,
} from '../utils/formatters';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';

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
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      notify('La imagen no puede superar 4 MB.', 'error');
      return;
    }
    try {
      const compressed = await compressImageToDataUrl(file, 640, 0.8);
      setImageDataUrl(compressed);
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
    if (!name.trim()) {
      notify('Ingresá el nombre del producto.', 'error');
      return;
    }
    setSaving(true);
    try {
      const supplier = suppliers.find((s) => s.id === supplierId);
      const baseFields = {
        name: clampStr(name, 200),
        description: clampStr(description, 2000),
        metaDescription: clampStr(metaDescription, 200),
        productType: clampStr(productType || 'Fisico', 40) || 'Fisico',
        imageDataUrl: clampStr(imageDataUrl, 700000),
        category: clampStr(category || 'Repuesto', 80) || 'Repuesto',
        subcategory: clampStr(subcategory, 80),
        brand: clampStr(brand, 80),
        supplierId: clampStr(supplier?.id, 128),
        supplierName: clampStr(supplier?.name, 160),
        sku: clampStr(sku, 80),
        barcode: clampStr(barcode, 80),
        location: clampStr(location, 120),
        internalCode: clampStr(internalCode || generateInternalProductCode(), 60),
        cost: Math.max(0, Number(cost || 0)),
        marginMode,
        margin: Number(margin || 0),
        vat: Math.max(0, Number(vat || 0)),
        rounding: Math.max(0, Number(rounding || 0)),
        netPrice: pricing.netPrice,
        price: pricing.finalPrice,
        trackStock,
        allowNoStock,
        usesSerial,
        stock: Math.max(0, Number(stock || 0)),
        minStock: Math.max(0, Number(minStock || 0)),
      };

      if (editProduct) {
        const path = `products/${editProduct.id}`;
        const updatePayload = stripUndefined(
          {
            ...baseFields,
            reorderCap: reorderCap ? Number(reorderCap) : null,
            weight: weight ? Number(weight) : null,
            height: height ? Number(height) : null,
            width: width ? Number(width) : null,
            depth: depth ? Number(depth) : null,
          },
          true
        );
        try {
          await updateRow('products', editProduct.id, updatePayload, true);
          notify('Producto actualizado.');
        } catch (err) {
          notify('No se pudo guardar el producto.', 'error');
          await handleDbError(err, OperationType.UPDATE, path);
        }
      } else {
        const productId = generateDocId('products');
        const path = `products/${productId}`;
        const createPayload = stripUndefined({
          id: productId,
          ...baseFields,
          ownerId,
          reorderCap: reorderCap ? Number(reorderCap) : undefined,
          weight: weight ? Number(weight) : undefined,
          height: height ? Number(height) : undefined,
          width: width ? Number(width) : undefined,
          depth: depth ? Number(depth) : undefined,
          createdAt: new Date().toISOString(),
        });
        try {
          await upsertRow('products', createPayload);
          notify('Producto guardado.');
        } catch (err) {
          notify('No se pudo guardar el producto.', 'error');
          await handleDbError(err, OperationType.CREATE, path);
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={editProduct ? 'Editar producto' : 'Nuevo producto'}
      maxWidth="3xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">
            Información básica
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Nombre del producto *
              </label>
              <input
                type="text"
                required
                list="product-suggestions-list"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Producto o repuesto"
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
                Descripción
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalles del producto"
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Meta descripción SEO ({metaDescription.length}/160)
              </label>
              <textarea
                rows={2}
                maxLength={160}
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                placeholder="Descripción breve para buscadores"
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Tipo *
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
                <option value="Fisico">Físico</option>
                <option value="Servicio">Servicio</option>
                <option value="Licencia digital">Licencia digital</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Imagen del producto
              </label>
              <div className="flex items-center gap-3">
                <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  <Upload className="h-3.5 w-3.5" />
                  <span>{imageDataUrl ? 'Cambiar imagen' : 'Seleccionar imagen'}</span>
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
                    alt="Vista previa"
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                  />
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">Clasificación</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Categoría *
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
                Subcategoría
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
                Marca
              </label>
              <input
                type="text"
                list="product-brand-list"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Sin marca"
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
                Proveedor
              </label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="">Sin proveedor</option>
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
            Identificación y ubicación
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
                placeholder="Código propio"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Código de barras
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
                  placeholder="Escanear o escribir"
                  className="h-10 flex-1 rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <button
                  type="button"
                  onClick={startScanner}
                  title="Leer código con cámara"
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
                Ubicación
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Estante, caja o depósito"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Código interno
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
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">Precios</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Costo de compra
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
                Tipo de ganancia
              </label>
              <select
                value={marginMode}
                onChange={(e) => setMarginMode(e.target.value as 'percent' | 'fixed')}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="percent">Porcentaje sobre costo</option>
                <option value="fixed">Monto fijo sobre costo</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {marginMode === 'percent' ? 'Ganancia (%)' : 'Ganancia ($)'}
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
                IVA
              </label>
              <select
                value={vat}
                onChange={(e) => setVat(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="0">0% (Exento)</option>
                <option value="10.5">10.5%</option>
                <option value="21">21%</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Redondeo
              </label>
              <select
                value={rounding}
                onChange={(e) => setRounding(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="0">Ninguno</option>
                <option value="1">Entero</option>
                <option value="10">Decena</option>
                <option value="100">Centena</option>
                <option value="1000">Mil</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Precio final de venta
              </label>
              <input
                type="text"
                readOnly
                value={`$${pricing.finalPrice.toLocaleString('es-AR')}`}
                className="h-10 w-full rounded-xl border border-slate-200 bg-sky-50 px-3 font-mono-num text-sm font-bold text-[#0072BB] dark:border-slate-700 dark:bg-sky-950/40 dark:text-sky-300"
              />
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">
            Control de stock y dimensiones
          </h3>
          <div className="flex flex-wrap gap-4 text-xs font-medium text-slate-700 dark:text-slate-300">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={trackStock}
                onChange={(e) => setTrackStock(e.target.checked)}
                className="h-4 w-4 rounded accent-[#0072BB]"
              />
              Controlar stock
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={allowNoStock}
                onChange={(e) => setAllowNoStock(e.target.checked)}
                className="h-4 w-4 rounded accent-[#0072BB]"
              />
              Permitir venta sin stock
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={usesSerial}
                onChange={(e) => setUsesSerial(e.target.checked)}
                className="h-4 w-4 rounded accent-[#0072BB]"
              />
              Usa series / IMEI
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Stock actual
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
                Stock mínimo
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
                Tope de recompra
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={reorderCap}
                onChange={(e) => setReorderCap(e.target.value)}
                placeholder="Opcional"
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
              placeholder="Peso (kg)"
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="number"
              min="0"
              step="0.1"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="Alto (cm)"
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="number"
              min="0"
              step="0.1"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              placeholder="Ancho (cm)"
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="number"
              min="0"
              step="0.1"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              placeholder="Profundidad (cm)"
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
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c] disabled:opacity-60"
          >
            {saving ? 'Guardando...' : 'Guardar producto'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
