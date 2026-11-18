import React from 'react';
import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/db';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

async function clearServiceWorkersAndCaches(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
  } catch {
    // Ignorar restricciones de entorno
  }
  try {
    if ('caches' in window) {
      const names = await window.caches.keys();
      await Promise.all(names.map((name) => window.caches.delete(name).catch(() => false)));
    }
  } catch {
    // Ignorar restricciones de entorno
  }
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Error inesperado al mostrar la aplicación.';
    return {
      hasError: true,
      errorMessage: message.slice(0, 240),
    };
  }

  override componentDidCatch(error: unknown): void {
    console.error('App ErrorBoundary:', error);
  }

  private handleHardReload = async () => {
    await clearServiceWorkersAndCaches();
    window.location.reload();
  };

  private handleResetSession = async () => {
    await clearServiceWorkersAndCaches();
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignorar
    }
    try {
      window.sessionStorage.clear();
    } catch {
      // Ignorar
    }
    window.location.reload();
  };

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <h1 className="font-display text-base font-bold text-slate-900 dark:text-white">
                No se pudo abrir la pantalla
              </h1>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                Hubo un problema al cargar la vista en este dispositivo. Podés recargar limpiando la caché guardada.
              </p>
            </div>
          </div>

          {this.state.errorMessage && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              {this.state.errorMessage}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void this.handleHardReload()}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white transition hover:bg-[#005f9c]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Recargar sin caché
            </button>
            <button
              type="button"
              onClick={() => void this.handleResetSession()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              Reiniciar sesión
            </button>
          </div>
        </div>
      </div>
    );
  }
}
