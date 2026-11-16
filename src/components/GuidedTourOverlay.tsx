import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Compass, Sparkles, X } from 'lucide-react';
import type { ResolvedContextualGuide, WelcomeTourStep } from '../utils/onboardingTour';

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface WelcomeSpotlightTourProps {
  open: boolean;
  steps: WelcomeTourStep[];
  onComplete: () => void;
  onSkip: () => void;
}

function findVisibleTarget(step: WelcomeTourStep | undefined): HTMLElement | null {
  if (!step || typeof document === 'undefined') return null;
  const candidates = [step.targetSelector, step.mobileTargetSelector].filter(Boolean) as string[];
  for (const selector of candidates) {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return el;
    }
  }
  return null;
}

export const WelcomeSpotlightTour: React.FC<WelcomeSpotlightTourProps> = ({
  open,
  steps,
  onComplete,
  onSkip,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });

  useEffect(() => {
    if (open) {
      setStepIndex(0);
    }
  }, [open]);

  const currentStep = steps[stepIndex];

  useEffect(() => {
    if (!open || !currentStep) return;

    const updatePosition = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
      const el = findVisibleTarget(currentStep);
      if (!el) {
        setTargetRect(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      const padding = 6;
      setTargetRect({
        top: Math.max(4, rect.top - padding),
        left: Math.max(4, rect.left - padding),
        width: Math.min(window.innerWidth - 8, rect.width + padding * 2),
        height: Math.min(window.innerHeight - 8, rect.height + padding * 2),
      });
    };

    const el = findVisibleTarget(currentStep);
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }

    updatePosition();
    const timer = window.setTimeout(updatePosition, 160);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, currentStep]);

  const cardStyle = useMemo<React.CSSProperties>(() => {
    const cardMaxWidth = Math.min(400, viewport.width - 24);
    if (!targetRect || viewport.width < 640) {
      return {
        width: cardMaxWidth,
        left: '50%',
        top: targetRect && targetRect.top > viewport.height * 0.55 ? '18px' : '50%',
        transform:
          targetRect && targetRect.top > viewport.height * 0.55
            ? 'translateX(-50%)'
            : 'translate(-50%, -50%)',
      };
    }

    const spaceBelow = viewport.height - (targetRect.top + targetRect.height);
    const spaceAbove = targetRect.top;
    const spaceRight = viewport.width - (targetRect.left + targetRect.width);
    const spaceLeft = targetRect.left;

    // Prefer placing to the right of sidebar items if plenty of room
    if (spaceRight >= cardMaxWidth + 24 && targetRect.left < viewport.width * 0.35) {
      const top = Math.min(
        Math.max(16, targetRect.top),
        Math.max(16, viewport.height - 290)
      );
      return {
        width: cardMaxWidth,
        top: `${top}px`,
        left: `${targetRect.left + targetRect.width + 16}px`,
      };
    }

    // Place below target if space is sufficient
    if (spaceBelow >= 260 || spaceBelow >= spaceAbove) {
      const idealLeft = Math.min(
        Math.max(12, targetRect.left),
        viewport.width - cardMaxWidth - 12
      );
      return {
        width: cardMaxWidth,
        top: `${Math.min(viewport.height - 280, targetRect.top + targetRect.height + 14)}px`,
        left: `${idealLeft}px`,
      };
    }

    // Place to the left if target is near top-right header actions
    if (spaceLeft >= cardMaxWidth + 24 && targetRect.top < 120) {
      return {
        width: cardMaxWidth,
        top: `${Math.max(16, targetRect.top + targetRect.height + 12)}px`,
        left: `${Math.max(12, targetRect.left + targetRect.width - cardMaxWidth)}px`,
      };
    }

    // Otherwise place above target
    const idealLeft = Math.min(
      Math.max(12, targetRect.left),
      viewport.width - cardMaxWidth - 12
    );
    return {
      width: cardMaxWidth,
      bottom: `${viewport.height - targetRect.top + 14}px`,
      left: `${idealLeft}px`,
    };
  }, [targetRect, viewport]);

  if (!open || !currentStep) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  return (
    <div
      className="no-print fixed inset-0 z-[70]"
      role="dialog"
      aria-modal="true"
      aria-label="Tour guiado inicial"
    >
      {/* Backdrop or Spotlight cutout */}
      {targetRect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-2xl border-2 border-sky-400 transition-all duration-200"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.64)',
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-slate-950/65 backdrop-blur-[2px]"
        />
      )}

      {/* Click-blocker overlay so background interactions stay paused during the spotlight tour */}
      <div className="fixed inset-0" />

      {/* Tooltip Card */}
      <div
        style={cardStyle}
        className="fixed z-[71] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl transition-all duration-200 dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-400">
              <Compass className="h-4 w-4" />
            </span>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#0072BB] dark:text-sky-400">
                Tour guiado · Paso {stepIndex + 1} de {steps.length}
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                {currentStep.title}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onSkip}
            aria-label="Omitir tour guiado"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          {currentStep.description}
        </p>

        {currentStep.tips.length > 0 && (
          <ul className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3 text-[11px] text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
            {currentStep.tips.map((tip) => (
              <li key={tip} className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0072BB] dark:text-sky-400" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Omitir tour
          </button>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
                className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Anterior
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isLast) {
                  onComplete();
                } else {
                  setStepIndex((prev) => Math.min(steps.length - 1, prev + 1));
                }
              }}
              className="inline-flex h-9 items-center gap-1 rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white transition hover:bg-[#005f9c]"
            >
              {isLast ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Finalizar
                </>
              ) : (
                <>
                  Siguiente
                  <ChevronRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ContextualWindowGuideProps {
  guide: ResolvedContextualGuide | null;
  onDismissCurrent: () => void;
  onDismissAll: () => void;
}

export const ContextualWindowGuide: React.FC<ContextualWindowGuideProps> = ({
  guide,
  onDismissCurrent,
  onDismissAll,
}) => {
  if (!guide) return null;

  return (
    <aside
      aria-label={guide.title}
      className="no-print fixed bottom-20 right-4 z-[75] w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-sky-200 bg-white/95 p-4 shadow-xl backdrop-blur-md lg:bottom-5 lg:right-5 dark:border-sky-800/70 dark:bg-slate-900/95"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-[#0072BB] dark:bg-sky-950/70 dark:text-sky-400">
            {guide.isIncrementalUpdate ? (
              <Sparkles className="h-4 w-4" />
            ) : (
              <Compass className="h-4 w-4" />
            )}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white font-display">
                {guide.title}
              </h4>
              {guide.isIncrementalUpdate && (
                <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-[#0072BB] dark:bg-sky-950 dark:text-sky-300">
                  Nuevo
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{guide.subtitle}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismissCurrent}
          aria-label="Cerrar guía de esta ventana"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <ul className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-slate-700 dark:text-slate-200">
        {guide.bullets.map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0072BB] dark:bg-sky-400" />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
        <button
          type="button"
          onClick={onDismissAll}
          className="text-[11px] font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Desactivar todas las guías
        </button>
        <button
          type="button"
          onClick={onDismissCurrent}
          className="inline-flex h-8 items-center gap-1 rounded-xl bg-[#0072BB] px-3 text-[11px] font-semibold text-white transition hover:bg-[#005f9c]"
        >
          <Check className="h-3.5 w-3.5" />
          Entendido
        </button>
      </div>
    </aside>
  );
};
