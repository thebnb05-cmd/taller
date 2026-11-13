import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue>({ notify: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((toastId: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id: toastId, message, tone }]);
      window.setTimeout(() => {
        dismiss(toastId);
      }, 3600);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div
        aria-live="polite"
        className="no-print pointer-events-none fixed right-4 top-16 z-[80] flex w-full max-w-sm flex-col gap-2 px-2 sm:px-0"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg backdrop-blur-md transition-all ${
              t.tone === 'error'
                ? 'border-red-200 bg-red-50/95 text-red-900 dark:border-red-900/60 dark:bg-red-950/95 dark:text-red-100'
                : t.tone === 'info'
                ? 'border-sky-200 bg-sky-50/95 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/95 dark:text-sky-100'
                : 'border-emerald-200 bg-emerald-50/95 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/95 dark:text-emerald-100'
            }`}
          >
            {t.tone === 'error' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            ) : t.tone === 'info' ? (
              <Info className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Cerrar notificación"
              className="rounded-md p-1 opacity-70 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
