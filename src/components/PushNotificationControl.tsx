import React, { useEffect, useRef, useState } from 'react';
import { BellOff, BellRing, CheckCircle2, Send, ShieldAlert, X } from 'lucide-react';
import {
  getNotificationPermissionState,
  getPushAlertsEnabled,
  isPushNotificationSupported,
  requestPushNotificationPermission,
  sendTestRepairPushNotification,
  setPushAlertsEnabled,
  type PushPermissionState,
} from '../utils/pushNotifications';
import { useI18n } from '../utils/i18n';
import { useToast } from './ToastProvider';

export const PushNotificationControl: React.FC = () => {
  const { tr } = useI18n();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [supported] = useState(() => isPushNotificationSupported());
  const [permission, setPermission] = useState<PushPermissionState>(() =>
    getNotificationPermissionState()
  );
  const [enabled, setEnabled] = useState<boolean>(() => getPushAlertsEnabled());
  const [busy, setBusy] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setPermission(getNotificationPermissionState());
    setEnabled(getPushAlertsEnabled());

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  if (!supported) return null;

  const isActive = permission === 'granted' && enabled;

  const handleEnable = async () => {
    setBusy(true);
    try {
      const next = await requestPushNotificationPermission();
      setPermission(next);
      if (next === 'granted') {
        setEnabled(true);
        notify(
          tr(
            'Notificaciones push activadas para reparaciones listas.',
            'Push notifications enabled for ready repairs.',
            'Notificações push ativadas para reparos prontos.'
          ),
          'success'
        );
        await sendTestRepairPushNotification();
      } else if (next === 'denied') {
        setEnabled(false);
        notify(
          tr(
            'El navegador bloqueó las notificaciones. Habilitalas desde el candado de la barra de dirección.',
            'Browser blocked notifications. Enable them from the address bar site settings.',
            'O navegador bloqueou as notificações. Ative-as nas configurações do site.'
          ),
          'error'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = () => {
    const next = !enabled;
    setPushAlertsEnabled(next);
    setEnabled(next);
    notify(
      next
        ? tr(
            'Alertas de reparaciones listas activadas.',
            'Ready repair alerts enabled.',
            'Alertas de reparos prontos ativados.'
          )
        : tr(
            'Alertas de reparaciones pausadas.',
            'Ready repair alerts paused.',
            'Alertas de reparos pausados.'
          ),
      'info'
    );
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      const sent = await sendTestRepairPushNotification();
      if (sent) {
        notify(
          tr(
            'Notificación de prueba enviada al Service Worker.',
            'Test notification dispatched via Service Worker.',
            'Notificação de teste enviada ao Service Worker.'
          ),
          'success'
        );
      } else {
        notify(
          tr(
            'No se pudo mostrar la notificación. Verificá los permisos del navegador.',
            'Could not display notification. Check browser permissions.',
            'Não foi possível exibir a notificação. Verifique as permissões.'
          ),
          'error'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={tr(
          'Notificaciones push de reparaciones',
          'Repair push notifications',
          'Notificações push de reparos'
        )}
        title={
          isActive
            ? tr(
                'Notificaciones push activas (Listo / Terminado)',
                'Push alerts active (Ready / Completed)',
                'Alertas push ativos (Pronto / Concluído)'
              )
            : tr(
                'Configurar notificaciones push',
                'Configure push notifications',
                'Configurar notificações push'
              )
        }
        className={`relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl transition ${
          open
            ? 'bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300'
            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
        }`}
      >
        {permission === 'denied' ? (
          <BellOff className="h-4 w-4 text-slate-400" />
        ) : (
          <BellRing className={`h-4 w-4 ${isActive ? 'text-emerald-600 dark:text-emerald-400' : ''}`} />
        )}
        <span
          className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-white dark:ring-slate-900 ${
            isActive
              ? 'bg-emerald-500'
              : permission === 'denied'
                ? 'bg-rose-500'
                : 'bg-amber-400'
          }`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={tr(
            'Alertas push de reparaciones',
            'Repair push alerts',
            'Alertas push de reparos'
          )}
          className="fixed inset-x-3 top-16 z-50 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {tr('Notificaciones Push', 'Push Notifications', 'Notificações Push')}
                </span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : permission === 'denied'
                        ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                        : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                  }`}
                >
                  {isActive
                    ? tr('Activas', 'Active', 'Ativas')
                    : permission === 'denied'
                      ? tr('Bloqueadas', 'Blocked', 'Bloqueadas')
                      : permission === 'granted'
                        ? tr('Pausadas', 'Paused', 'Pausadas')
                        : tr('Inactivas', 'Off', 'Inativas')}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                {tr(
                  'Recibí alertas vía Service Worker cuando una reparación pase a "Listo" o "Terminado".',
                  'Receive Service Worker alerts whenever a repair switches to "Ready" or "Completed".',
                  'Receba alertas via Service Worker quando um reparo passar para "Pronto" ou "Concluído".'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={tr('Cerrar', 'Close', 'Fechar')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 space-y-2.5">
            {permission === 'default' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleEnable()}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-[#0072BB] px-3 text-xs font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
              >
                <BellRing className="h-3.5 w-3.5" />
                <span>
                  {tr(
                    'Activar notificaciones push',
                    'Enable push notifications',
                    'Ativar notificações push'
                  )}
                </span>
              </button>
            )}

            {permission === 'granted' && (
              <>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/50">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <CheckCircle2
                      className={`h-4 w-4 ${
                        enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                      }`}
                    />
                    <span>
                      {tr('Alertar en Listo / Terminado', 'Alert on Ready / Done', 'Alertar em Pronto')}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={handleToggle}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                      enabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                        enabled ? 'translate-x-4.5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleTest()}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Send className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                  <span>
                    {tr('Probar notificación ahora', 'Send test notification', 'Testar notificação')}
                  </span>
                </button>
              </>
            )}

            {permission === 'denied' && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {tr(
                    'Los permisos de notificación están bloqueados en este navegador. Habilitalos en la configuración del sitio para recibir avisos.',
                    'Notification permissions are blocked in this browser. Enable them in site settings to receive alerts.',
                    'As permissões de notificação estão bloqueadas neste navegador. Ative-as nas configurações do site.'
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
