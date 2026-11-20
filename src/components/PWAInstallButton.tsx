import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useI18n } from '../utils/i18n';

export const PWAInstallButton: React.FC = () => {
  const { tr } = useI18n();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        aria-label={tr('Instalar aplicación', 'Install app', 'Instalar aplicativo')}
        title={tr('Instalar app', 'Install app', 'Instalar app')}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0072BB] px-2.5 lg:px-3 text-xs font-semibold text-white transition hover:bg-[#005f9c] whitespace-nowrap shrink-0"
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">{tr('Instalar app', 'Install app', 'Instalar app')}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          aria-label={tr('Instalar aplicación', 'Install app', 'Instalar aplicativo')}
          title={tr('Instalar app', 'Install app', 'Instalar app')}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 lg:px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{tr('Instalar', 'Install', 'Instalar')}</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 dark:text-white font-display">
                  {tr('Instalar en iPhone / iPad', 'Install on iPhone / iPad', 'Instalar no iPhone / iPad')}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label={tr('Cerrar', 'Close', 'Fechar')}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                <li>
                  1. {tr('Tocá el botón', 'Tap the', 'Toque no botão')}{' '}
                  <strong>{tr('Compartir', 'Share', 'Compartilhar')}</strong>{' '}
                  {tr('en la barra inferior de Safari.', 'in Safari’s bottom bar.', 'na barra inferior do Safari.')}
                </li>
                <li>
                  2. {tr('Deslizá y elegí', 'Scroll and select', 'Role e escolha')}{' '}
                  <strong>{tr('Agregar a inicio', 'Add to Home Screen', 'Adicionar à Tela de Início')}</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 h-10 w-full rounded-xl bg-[#0072BB] text-xs font-semibold text-white"
              >
                {tr('Entendido', 'Got it', 'Entendi')}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
