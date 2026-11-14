import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { FileSpreadsheet, UploadCloud } from 'lucide-react';
import {
  clampStr,
  generateDocId,
  handleDbError,
  insertRows,
  OperationType,
  stripUndefined,
} from '../lib/db';
import type { ProductRecord } from '../types/workshop';
import { generateInternalProductCode } from '../utils/formatters';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';

interface ProductImportModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  existingProducts: ProductRecord[];
}

interface ParsedImportProduct {
  name: string;
  price: number;
  cost: number;
  stock: number;
  category: string;
  subcategory: string;
  sku: string;
  barcode: string;
}

export const ProductImportModal: React.FC<ProductImportModalProps> = ({
  open,
  onClose,
  ownerId,
  existingProducts,
}) => {
  const { notify } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [toImport, setToImport] = useState<ParsedImportProduct[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setFileName('');
    setToImport([]);
    setSkippedCount(0);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: '',
      });

      const existingNames = new Set(
        existingProducts.map((p) => p.name.trim().toLowerCase())
      );
      const existingSkus = new Set(
        existingProducts.filter((p) => p.sku).map((p) => p.sku!.trim().toLowerCase())
      );

      const parsed: ParsedImportProduct[] = [];
      let skipped = 0;

      for (const row of rows) {
        const normalized: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          normalized[k.trim().toLowerCase()] = String(v ?? '').trim();
        }
        const name =
          normalized['nombre'] || normalized['producto'] || normalized['name'] || '';
        if (!name) {
          skipped++;
          continue;
        }
        const sku = normalized['sku'] || '';
        const barcode =
          normalized['código de barras'] ||
          normalized['codigo de barras'] ||
          normalized['barcode'] ||
          '';

        if (
          existingNames.has(name.toLowerCase()) ||
          (sku && existingSkus.has(sku.toLowerCase()))
        ) {
          skipped++;
          continue;
        }

        existingNames.add(name.toLowerCase());
        if (sku) existingSkus.add(sku.toLowerCase());

        const price = Math.max(
          0,
          Number((normalized['precio'] || normalized['price'] || '0').replace(',', '.')) || 0
        );
        const cost = Math.max(
          0,
          Number((normalized['costo'] || normalized['cost'] || '0').replace(',', '.')) || 0
        );
        const stock = Math.max(
          0,
          Math.floor(Number(normalized['stock'] || '0') || 0)
        );
        const category = normalized['categoría'] || normalized['categoria'] || 'Repuesto';
        const subcategory =
          normalized['subcategoría'] || normalized['subcategoria'] || '';

        parsed.push({
          name,
          price,
          cost,
          stock,
          category,
          subcategory,
          sku,
          barcode,
        });
      }

      setToImport(parsed);
      setSkippedCount(skipped);
    } catch {
      notify('No se pudo leer el archivo Excel o CSV.', 'error');
      reset();
    }
  };

  const handleConfirmImport = async () => {
    if (toImport.length === 0) return;
    setImporting(true);
    try {
      const BATCH_LIMIT = 400;
      const nowIso = new Date().toISOString();
      for (let start = 0; start < toImport.length; start += BATCH_LIMIT) {
        const slice = toImport.slice(start, start + BATCH_LIMIT);
        const rows = slice.map((item) =>
          stripUndefined({
            id: generateDocId('products'),
            ownerId,
            name: clampStr(item.name, 200),
            description: '',
            metaDescription: '',
            productType: 'Fisico',
            category: clampStr(item.category || 'Repuesto', 80) || 'Repuesto',
            subcategory: clampStr(item.subcategory, 80),
            sku: clampStr(item.sku, 80),
            barcode: clampStr(item.barcode, 80),
            internalCode: clampStr(generateInternalProductCode(), 60),
            cost: Math.max(0, Number(item.cost || 0)),
            marginMode: 'fixed',
            margin: Math.max(0, Number(item.price || 0) - Number(item.cost || 0)),
            vat: 0,
            rounding: 0,
            netPrice: Math.max(0, Number(item.price || 0)),
            price: Math.max(0, Number(item.price || 0)),
            trackStock: true,
            allowNoStock: false,
            usesSerial: false,
            stock: Math.max(0, Number(item.stock || 0)),
            minStock: 1,
            createdAt: nowIso,
          })
        );
        await insertRows('products', rows);
      }
      notify(`Se importaron ${toImport.length} productos correctamente.`);
      reset();
      onClose();
    } catch (err) {
      notify('Ocurrió un error al importar los productos.', 'error');
      await handleDbError(err, OperationType.WRITE, 'products');
    } finally {
      setImporting(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Importar productos"
      subtitle="Subí un archivo Excel (.xlsx) o CSV (.csv). Los duplicados se omiten automáticamente."
      maxWidth="lg"
    >
      <div className="space-y-4">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition ${
            dragOver
              ? 'border-[#0072BB] bg-sky-50 dark:bg-sky-950/30'
              : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/40'
          }`}
        >
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className="hidden"
          />
          {fileName ? (
            <FileSpreadsheet className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <UploadCloud className="h-8 w-8 text-slate-400" />
          )}
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            {fileName || 'Arrastrá el archivo aquí o hacé clic para buscarlo'}
          </div>
          <div className="text-xs text-slate-500">Formatos permitidos: .xlsx y .csv</div>
        </label>

        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
          Columnas reconocidas: <strong>Nombre</strong> (obligatoria), Precio, Costo, Stock,
          Categoría, Subcategoría, SKU y Código de barras.
        </div>

        {fileName && (
          <div className="rounded-xl border border-slate-200 p-3.5 text-xs dark:border-slate-800">
            <div className="font-semibold text-slate-900 dark:text-white">
              Listos para importar: <span className="font-mono-num">{toImport.length}</span> productos
            </div>
            {skippedCount > 0 && (
              <div className="mt-1 text-slate-500">
                Omitidos por duplicado o sin nombre: {skippedCount}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          {toImport.length > 0 && (
            <button
              type="button"
              disabled={importing}
              onClick={handleConfirmImport}
              className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c] disabled:opacity-60"
            >
              {importing ? 'Importando...' : `Importar ${toImport.length} productos`}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
};
