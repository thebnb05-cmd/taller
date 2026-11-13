import React, { useCallback, useEffect, useRef, useState } from 'react';

interface PatternLockProps {
  value: number[];
  onChange?: (pattern: number[]) => void;
  readOnly?: boolean;
  size?: number;
}

const DOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function getDotCenter(index1Based: number, size: number) {
  const idx = index1Based - 1;
  const col = idx % 3;
  const row = Math.floor(idx / 3);
  const pad = size * 0.2;
  const step = (size - pad * 2) / 2;
  return {
    x: pad + col * step,
    y: pad + row * step,
  };
}

export const PatternLock: React.FC<PatternLockProps> = ({
  value,
  onChange,
  readOnly = false,
  size = 220,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const isDark = document.documentElement.classList.contains('dark');
    const lineColor = isDark ? '#38BDF8' : '#0072BB';
    const dotIdle = isDark ? '#475569' : '#CBD5E1';
    const dotRing = isDark ? '#1E293B' : '#E2E8F0';

    // Draw lines between selected dots
    if (value.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      value.forEach((dotId, i) => {
        const pt = getDotCenter(dotId, size);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });

      if (drawing && pointerPos && !readOnly) {
        ctx.lineTo(pointerPos.x, pointerPos.y);
      }
      ctx.stroke();
    }

    // Draw 9 nodes
    DOTS.forEach((dotId) => {
      const { x, y } = getDotCenter(dotId, size);
      const selectedIdx = value.indexOf(dotId);
      const isSelected = selectedIdx !== -1;

      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 16 : 12, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? `${lineColor}26` : dotRing;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? lineColor : dotIdle;
      ctx.fill();

      if (isSelected) {
        ctx.font = 'bold 10px Inter, system-ui, sans-serif';
        ctx.fillStyle = isDark ? '#E2E8F0' : '#0F172A';
        ctx.textAlign = 'center';
        ctx.fillText(String(selectedIdx + 1), x, y - 19);
      }
    });
  }, [drawing, pointerPos, readOnly, size, value]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const getRelativePoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * size,
      y: ((e.clientY - rect.top) / rect.height) * size,
    };
  };

  const hitTestDot = (pt: { x: number; y: number }): number | null => {
    const radius = size * 0.11;
    for (const dotId of DOTS) {
      const center = getDotCenter(dotId, size);
      if (Math.hypot(pt.x - center.x, pt.y - center.y) <= radius) {
        return dotId;
      }
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (readOnly || !onChange) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getRelativePoint(e);
    setDrawing(true);
    setPointerPos(pt);
    const hit = hitTestDot(pt);
    if (hit) {
      onChange([hit]);
    } else {
      onChange([]);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing || readOnly || !onChange) return;
    const pt = getRelativePoint(e);
    setPointerPos(pt);
    const hit = hitTestDot(pt);
    if (hit && !value.includes(hit)) {
      onChange([...value, hit]);
    }
  };

  const finishDraw = () => {
    setDrawing(false);
    setPointerPos(null);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={canvasRef}
        style={{ width: `${size}px`, height: `${size}px`, touchAction: 'none' }}
        className={`rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900 ${
          readOnly ? 'cursor-default' : 'cursor-crosshair'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDraw}
        onPointerCancel={finishDraw}
      />
      {!readOnly && (
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-mono-num">
            {value.length > 0 ? `Secuencia: ${value.join(' → ')}` : 'Dibujá el patrón conectando los puntos'}
          </span>
          {value.length > 0 && onChange && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="font-medium text-[#0072BB] hover:underline dark:text-sky-400"
            >
              Limpiar
            </button>
          )}
        </div>
      )}
    </div>
  );
};
