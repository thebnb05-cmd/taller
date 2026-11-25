import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  Package,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { ProductRecord } from '../types/workshop';
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

interface PushNotificationControlProps {
  lowStockProducts?: ProductRecord[];
  onOpenLowStock?: () => void;
  onSelectProduct?: (product: ProductRecord) => void;
}

export const PushNotificationControl: React.FC<PushNotificationControlProps> = ({
  lowStockProducts = [],
  onOpenLowStock,
  onSelectProduct,
}) => {
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

  const lowStockCount = lowStockProducts.length;
  const outOfStockCount = useMemo(
    () => lowStockProducts.filter((p) => p.stock <= 0).length,
    [lowStockProducts]
  );
  const previewLowStock = useMemo(() => lowStockProducts.slice(0, 4), [lowStockProducts]);

  useEffect(() => {
    if (!open) return;
    if (supported) {
      setPermission(getNotificationPermissionState());
      setEnabled(getPushAlertsEnabled());
    }

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
  }, [open, supported]);

  const isActive = supported && permission === 'granted' && enabled;

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

  const buttonTitle =
    lowStockCount > 0
      ? tr(
          `Notificaciones (${lowStockCount} alertas de stock bajo)`,
          `Notifications (${lowStockCount} low stock alerts)`,
          `Notificações (${lowStockCount} alertas de estoque baixo)`
        )
      : isActive
        ? tr(
            'Centro de notificaciones · Push activo',
            'Notification center · Push active',
            'Central de notificações · Push ativo'
          )
        : tr(
            'Centro de notificaciones y alertas',
            'Notification & alert center',
            'Central de notificações e alertas'
          );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={tr(
          'Notificaciones y alertas de stock',
          'Notifications & stock alerts',
          'Notificações e alertas de estoque'
        )}
        title={buttonTitle}
        className={`relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl transition ${
          open
            ? 'bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300'
            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
        }`}
      >
        {!supported ? (
          <Bell className="h-4 w-4" />
        ) : permission === 'denied' && lowStockCount === 0 ? (
          <BellOff className="h-4 w-4 text-slate-400" />
        ) : (
          <BellRing
            className={`h-4 w-4 ${
              lowStockCount > 0
                ? 'text-amber-600 dark:text-amber-400'
                : isActive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : ''
            }`}
          />
        )}

        {lowStockCount > 0 ? (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 font-mono-num text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
            {lowStockCount > 99 ? '99+' : lowStockCount}
          </span>
        ) : supported ? (
          <span
            className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-white dark:ring-slate-900 ${
              isActive
                ? 'bg-emerald-500'
                : permission === 'denied'
                  ? 'bg-rose-500'
                  : 'bg-amber-400'
            }`}
          />
        ) : null}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={tr(
            'Centro de notificaciones y alertas',
            'Notification and alert center',
            'Central de notificações e alertas'
          )}
          className="fixed inset-x-3 top-16 z-50 max-h-[82vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-88 dark:border-slate-700 dark:bg-slate-900"
        >
          {/* Unified Header */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 dark:text-white">
                {tr(
                  'Notificaciones y Alertas',
                  'Notifications & Alerts',
                  'Notificações e Alertas'
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {tr(
                  'Alertas de stock y avisos push del taller en un solo lugar.',
                  'Stock alerts and workshop push notifications in one place.',
                  'Alertas de estoque e avisos push da oficina em um só lugar.'
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

          {/* Section 1: Inventory Low Stock Alerts */}
          <div className="mt-3 space-y-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                <AlertTriangle
                  className={`h-3.5 w-3.5 ${
                    lowStockCount > 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                />
                <span>{tr('Stock de productos', 'Product stock', 'Estoque de produtos')}</span>
              </div>
              <span
                className={`rounded-md px-1.5 py-0.5 font-mono-num text-[10px] font-bold ${
                  lowStockCount > 0
                    ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                }`}
              >
                {lowStockCount > 0
                  ? outOfStockCount > 0
                    ? tr(
                        `${lowStockCount} alertas (${outOfStockCount} sin stock)`,
                        `${lowStockCount} alerts (${outOfStockCount} out)`,
                        `${lowStockCount} alertas (${outOfStockCount} zerados)`
                      )
                    : tr(
                        `${lowStockCount} bajo mínimo`,
                        `${lowStockCount} low stock`,
                        `${lowStockCount} estoque baixo`
                      )
                  : tr('Al día', 'Healthy', 'Em dia')}
              </span>
            </div>

            {lowStockCount > 0 ? (
              <>
                <div className="space-y-1.5">
                  {previewLowStock.map((product) => {
                    const isOut = product.stock <= 0;
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          if (onSelectProduct) {
                            onSelectProduct(product);
                          } else {
                            onOpenLowStock?.();
                          }
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-2.5 py-1.5 text-left text-xs transition hover:border-[#0072BB] hover:bg-sky-50/60 dark:border-slate-800 dark:bg-slate-800/50 dark:hover:border-sky-500/60 dark:hover:bg-sky-950/30"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Package className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="truncate font-semibold text-slate-800 dark:text-slate-100">
                            {product.name}
                          </span>
                        </div>
                        <span
                          className={`shrink-0 font-mono-num text-[11px] font-bold ${
                            isOut
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {isOut
                            ? tr('Sin stock', 'Out of stock', 'Sem estoque')
                            : `${product.stock} / ${product.minStock} u.`}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {onOpenLowStock && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onOpenLowStock();
                    }}
                    className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl bg-red-50 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-100 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-950/80"
                  >
                    <span>
                      {lowStockCount > previewLowStock.length
                        ? tr(
                            `Ver los ${lowStockCount} productos en Inventario`,
                            `View all ${lowStockCount} items in Inventory`,
                            `Ver todos os ${lowStockCount} itens no Estoque`
                          )
                        : tr(
                            'Ver stock bajo en Inventario',
                            'View low stock in Inventory',
                            'Ver estoque baixo no Estoque'
                          )}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
                <span>
                  {tr(
                    'No hay productos por debajo del mínimo.',
                    'No products below minimum stock.',
                    'Nenhum produto abaixo do estoque mínimo.'
                  )}
                </span>
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              </div>
            )}
          </div>

          {/* Section 2: Push Notifications */}
          <div className="mt-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                <BellRing className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                <span>
                  {tr('Notificaciones Push', 'Push Notifications', 'Notificações Push')}
                </span>
              </div>
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                  !supported
                    ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    : isActive
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : permission === 'denied'
                        ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                        : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                }`}
              >
                {!supported
                  ? tr('No disponible', 'Unavailable', 'Indisponível')
                  : isActive
                    ? tr('Activas', 'Active', 'Ativas')
                    : permission === 'denied'
                      ? tr('Bloqueadas', 'Blocked', 'Bloqueadas')
                      : permission === 'granted'
                        ? tr('Pausadas', 'Paused', 'Pausadas')
                        : tr('Inactivas', 'Off', 'Inativas')}
              </span>
            </div>

            {!supported ? (
              <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                {tr(
                  'Este navegador no admite notificaciones push en segundo plano. Instalá la app (PWA) o usá Chrome/Edge.',
                  'This browser does not support background push notifications. Install the PWA or use Chrome/Edge.',
                  'Este navegador não suporta notificações push. Instale o app (PWA) ou use Chrome/Edge.'
                )}
              </p>
            ) : (
              <>
                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {tr(
                    'Avisos vía Service Worker cuando una reparación pase a "Listo" o "Terminado".',
                    'Service Worker alerts when a repair switches to "Ready" or "Completed".',
                    'Alertas via Service Worker quando um reparo passar para "Pronto" ou "Concluído".'
                  )}
                </p>

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
                          {tr(
                            'Alertar en Listo / Terminado',
                            'Alert on Ready / Done',
                            'Alertar em Pronto'
                          )}
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
                        {tr(
                          'Probar notificación ahora',
                          'Send test notification',
                          'Testar notificação'
                        )}
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
