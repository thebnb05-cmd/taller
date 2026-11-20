import React, { useEffect, useState } from 'react';
import { Edit3, Minus, Package, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { deleteRow, handleDbError, OperationType, updateRow } from '../lib/db';
import type { ProductRecord } from '../types/workshop';
import { formatCurrency } from '../utils/formatters';
import { sanitizeDbErrorMessage, sanitizeImageDataUrl } from '../utils/validation';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';
import { useI18n } from '../utils/i18n';

interface ProductDetailModalProps {
  product: ProductRecord | null;
  onClose: () => void;
  onEdit: (product: ProductRecord) => void;
  onSell: (product: ProductRecord) => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  onClose,
  onEdit,
  onSell,
}) => {
  const { notify } = useToast();
  const { tr } = useI18n();
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
  }, [product]);

  if (!product) return null;

  const isLowStock = product.trackStock && product.stock <= product.minStock;

  const adjustStock = async (delta: number) => {
    const nextStock = Math.max(0, Number(product.stock || 0) + delta);
    const path = `products/${product.id}`;
    try {
      await updateRow('products', product.id, { stock: nextStock });
      notify(`Stock actualizado: ${nextStock} u.`);
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo actualizar el stock.'), 'error');
      void handleDbError(err, OperationType.UPDATE, path).catch(() => {});
    }
  };

  const handleDelete = async () => {
    const path = `products/${product.id}`;
    try {
      await deleteRow('products', product.id);
      notify('Producto eliminado.');
      onClose();
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo eliminar el producto.'), 'error');
      void handleDbError(err, OperationType.DELETE, path).catch(() => {});
    }
  };

  return (
    <ModalShell
      open={Boolean(product)}
      onClose={onClose}
      title={product.name}
      subtitle={`${product.category}${product.subcategory ? ` · ${product.subcategory}` : ''}`}
      maxWidth="xl"
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-4">
          {sanitizeImageDataUrl(product.imageDataUrl, 1_200_000) ? (
            <img
              src={sanitizeImageDataUrl(product.imageDataUrl, 1_200_000)}
              alt={product.name}
              referrerPolicy="no-referrer"
              className="h-20 w-20 rounded-2xl border border-slate-200 object-cover dark:border-slate-700"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-800">
              <Package className="h-8 w-8" />
            </div>
          )}

          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
                {formatCurrency(product.price)}
              </span>
              {isLowStock && (
                <span className="rounded-lg bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
                  {tr('Stock bajo', 'Low stock', 'Estoque baixo')}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {tr('Costo:', 'Cost:', 'Custo:')} <span className="font-mono-num">{formatCurrency(product.cost)}</span> · {tr('IVA:', 'Tax:', 'Imposto:')}{' '}
              <span className="font-mono-num">{product.vat}%</span>
            </div>
            {product.brand && (
              <div className="text-xs text-slate-600 dark:text-slate-300">
                {tr('Marca:', 'Brand:', 'Marca:')} {product.brand}
              </div>
            )}
          </div>
        </div>

        {product.description && (
          <p className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
            {product.description}
          </p>
        )}

        <div className="grid gap-3 rounded-2xl border border-slate-200 p-4 text-xs sm:grid-cols-2 dark:border-slate-800">
          <div>
            <span className="text-slate-500">SKU: </span>
            <strong className="font-mono-num text-slate-900 dark:text-white">
              {product.sku || '—'}
            </strong>
          </div>
          <div>
            <span className="text-slate-500">{tr('Código de barras:', 'Barcode:', 'Código de barras:')} </span>
            <strong className="font-mono-num text-slate-900 dark:text-white">
              {product.barcode || '—'}
            </strong>
          </div>
          <div>
            <span className="text-slate-500">{tr('Ubicación:', 'Location:', 'Localização:')} </span>
            <strong className="text-slate-900 dark:text-white">{product.location || '—'}</strong>
          </div>
          <div>
            <span className="text-slate-500">{tr('Proveedor:', 'Supplier:', 'Fornecedor:')} </span>
            <strong className="text-slate-900 dark:text-white">
              {product.supplierName || '—'}
            </strong>
          </div>
        </div>

        {product.trackStock && (
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <div>
              <div className="text-xs text-slate-500">{tr('Stock disponible', 'Available stock', 'Estoque disponível')}</div>
              <div className="font-mono-num text-lg font-bold text-slate-900 dark:text-white">
                {product.stock} {tr('u.', 'units', 'un.')}{' '}
                <span className="text-xs font-normal text-slate-500">
                  ({tr('Mínimo:', 'Minimum:', 'Mínimo:')} {product.minStock})
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => adjustStock(-1)}
                aria-label={tr('Restar 1 al stock', 'Decrease stock by 1', 'Diminuir 1 do estoque')}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => adjustStock(1)}
                aria-label={tr('Sumar 1 al stock', 'Increase stock by 1', 'Somar 1 ao estoque')}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-4 w-4" />
              {tr('Eliminar', 'Delete', 'Excluir')}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDelete}
                className="h-9 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white"
              >
                {tr('Confirmar', 'Confirm', 'Confirmar')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                {tr('Cancelar', 'Cancel', 'Cancelar')}
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onEdit(product);
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Edit3 className="h-3.5 w-3.5" />
              {tr('Editar', 'Edit', 'Editar')}
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onSell(product);
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              {tr('Vender producto', 'Sell product', 'Vender produto')}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
