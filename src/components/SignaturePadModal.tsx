import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Eraser, PenTool, Trash2, X } from 'lucide-react';
import { sanitizeImageDataUrl } from '../utils/validation';

interface SignaturePadModalProps {
  open: boolean;
  clientName: string;
  orderLabel: string;
  initialSignatureUrl?: string;
  saving?: boolean;
  onClose: () => void;
  onSave: (signatureDataUrl: string) => Promise<void> | void;
}

interface Point {
  x: number;
  y: number;
}

const LOGICAL_WIDTH = 560;
const LOGICAL_HEIGHT = 210;

function trimAndExportSignature(sourceCanvas: HTMLCanvasElement): string {
  const ctx = sourceCanvas.getContext('2d');
  if (!ctx) return '';

  const { width, height } = sourceCanvas;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return '';
  }

  const dpr = Math.max(1, width / LOGICAL_WIDTH);
  const pad = Math.round(10 * dpr);
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(width - sx, maxX - minX + 1 + pad * 2);
  const sh = Math.min(height - sy, maxY - minY + 1 + pad * 2);

  // Enforce a sensible minimum crop aspect so short strokes don't scale abnormally large
  const targetMaxW = 520;
  const scale = Math.min(1 / dpr, targetMaxW / Math.max(1, sw));
  const outW = Math.max(120, Math.round(sw * scale));
  const outH = Math.max(48, Math.round(sh * scale));

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = outW;
  exportCanvas.height = outH;
  const exportCtx = exportCanvas.getContext('2d');
  if (!exportCtx) return '';

  const drawW = Math.round(sw * scale);
  const drawH = Math.round(sh * scale);
  const offsetX = Math.round((outW - drawW) / 2);
  const offsetY = Math.round((outH - drawH) / 2);

  exportCtx.drawImage(sourceCanvas, sx, sy, sw, sh, offsetX, offsetY, drawW, drawH);
  return sanitizeImageDataUrl(exportCanvas.toDataURL('image/png'), 350_000);
}

export const SignaturePadModal: React.FC<SignaturePadModalProps> = ({
  open,
  clientName,
  orderLabel,
  initialSignatureUrl = '',
  saving = false,
  onClose,
  onSave,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const midPointRef = useRef<Point | null>(null);

  const [hasInk, setHasInk] = useState(false);

  const setupCanvas = useCallback(
    (preloadUrl?: string) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = LOGICAL_WIDTH * dpr;
      canvas.height = LOGICAL_HEIGHT * dpr;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      ctx.strokeStyle = '#0f172a';
      ctx.fillStyle = '#0f172a';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (preloadUrl) {
        const img = new Image();
        img.onload = () => {
          const targetCanvas = canvasRef.current;
          if (!targetCanvas) return;
          const targetCtx = targetCanvas.getContext('2d');
          if (!targetCtx) return;
          const maxW = LOGICAL_WIDTH - 48;
          const maxH = LOGICAL_HEIGHT - 36;
          const ratio = img.width / Math.max(1, img.height);
          let drawW = maxW;
          let drawH = drawW / Math.max(0.2, ratio);
          if (drawH > maxH) {
            drawH = maxH;
            drawW = drawH * Math.max(0.2, ratio);
          }
          const x = (LOGICAL_WIDTH - drawW) / 2;
          const y = (LOGICAL_HEIGHT - drawH) / 2;
          targetCtx.drawImage(img, x, y, drawW, drawH);
          setHasInk(true);
        };
        img.src = preloadUrl;
      } else {
        setHasInk(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    activePointerIdRef.current = null;
    lastPointRef.current = null;
    midPointRef.current = null;
    setHasInk(Boolean(initialSignatureUrl));
    setupCanvas(initialSignatureUrl);
  }, [open, initialSignatureUrl, setupCanvas]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (!saving) onClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [open, saving, onClose]);

  if (!open) return null;

  const getRelativePoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = LOGICAL_WIDTH / Math.max(1, rect.width);
    const scaleY = LOGICAL_HEIGHT / Math.max(1, rect.height);
    return {
      x: Math.max(0, Math.min(LOGICAL_WIDTH, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(LOGICAL_HEIGHT, (e.clientY - rect.top) * scaleY)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (saving || activePointerIdRef.current !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unavailable
    }

    const pt = getRelativePoint(e);
    activePointerIdRef.current = e.pointerId;
    lastPointRef.current = pt;
    midPointRef.current = pt;

    ctx.strokeStyle = '#0f172a';
    ctx.fillStyle = '#0f172a';
    ctx.lineWidth = e.pointerType === 'pen' ? 2.3 : 2.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();

    setHasInk(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pt = getRelativePoint(e);
    const last = lastPointRef.current;
    const prevMid = midPointRef.current;
    if (!last || !prevMid) return;

    const newMid: Point = {
      x: (last.x + pt.x) / 2,
      y: (last.y + pt.y) / 2,
    };

    ctx.beginPath();
    ctx.moveTo(prevMid.x, prevMid.y);
    ctx.quadraticCurveTo(last.x, last.y, newMid.x, newMid.y);
    ctx.stroke();

    lastPointRef.current = pt;
    midPointRef.current = newMid;
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const last = lastPointRef.current;
    const prevMid = midPointRef.current;

    if (ctx && last && prevMid) {
      ctx.beginPath();
      ctx.moveTo(prevMid.x, prevMid.y);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }

    activePointerIdRef.current = null;
    lastPointRef.current = null;
    midPointRef.current = null;

    if (canvas?.hasPointerCapture?.(e.pointerId)) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore release errors
      }
    }
  };

  const handleClear = () => {
    activePointerIdRef.current = null;
    lastPointRef.current = null;
    midPointRef.current = null;
    setupCanvas();
  };

  const handleConfirmSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || saving) return;
    const dataUrl = trimAndExportSignature(canvas);
    if (!dataUrl) {
      setHasInk(false);
      return;
    }
    await onSave(dataUrl);
  };

  const handleRemoveSignature = async () => {
    if (saving) return;
    await onSave('');
  };

  return (
    <div
      className="no-print fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Firma del cliente"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:rounded-3xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden dark:bg-slate-700" />

        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6 dark:border-slate-800">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 truncate text-base font-bold text-slate-900 dark:text-white font-display">
              <PenTool className="h-4 w-4 shrink-0 text-[#0072BB] dark:text-sky-400" />
              <span>Firma del cliente</span>
            </h3>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {clientName} · {orderLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar firma"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          <div className="text-xs text-slate-600 dark:text-slate-300">
            Firmá con el dedo, lápiz táctil o mouse dentro del recuadro. Al guardar se agrega automáticamente a la boleta A4, térmico 80mm y PDF.
          </div>

          <div className="relative overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-white shadow-inner">
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              className="relative z-10 block h-48 w-full cursor-crosshair touch-none select-none sm:h-52"
            />
            <div className="pointer-events-none absolute inset-x-8 bottom-8 border-b border-slate-300/90" />
            {!hasInk && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-slate-300 select-none">
                Firmá aquí
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[10px] font-medium text-slate-400 select-none">
              Firma y aclaración del cliente
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClear}
                disabled={saving || !hasInk}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Eraser className="h-3.5 w-3.5" />
                Limpiar
              </button>
              {initialSignatureUrl && (
                <button
                  type="button"
                  onClick={() => void handleRemoveSignature()}
                  disabled={saving}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-red-200 px-3 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-45 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Quitar firma
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmSave()}
                disabled={saving || !hasInk}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-4 text-xs font-bold text-white hover:bg-[#005f9c] disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {saving ? 'Guardando...' : 'Guardar firma'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
