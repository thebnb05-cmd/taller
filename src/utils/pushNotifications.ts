import type { RepairRecord } from '../types/workshop';
import { getActiveLanguage, getTranslatedStatusLabel } from './i18n';

export type PushPermissionState = NotificationPermission | 'unsupported';

interface RepairNotificationPayload {
  title: string;
  body: string;
  icon: string;
  badge: string;
  tag: string;
  data: {
    repairId: string;
    code: string;
    status: string;
    url: string;
  };
}

const PUSH_PREF_STORAGE_KEY = 'th3bnb-push-repairs-enabled-v1';
const PUSH_DEDUP_STORAGE_KEY = 'th3bnb-push-notified-repairs-v1';
const PUSH_DEDUP_TTL_MS = 10 * 60 * 1000;
const READY_STATUS_SET = new Set(['listo', 'terminado']);

export function normalizeRepairStatusKey(status: string | undefined | null): string {
  return String(status || '')
    .trim()
    .toLowerCase();
}

export function isReadyRepairStatus(status: string | undefined | null): boolean {
  return READY_STATUS_SET.has(normalizeRepairStatusKey(status));
}

export function isPushNotificationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator
  );
}

export function getNotificationPermissionState(): PushPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

export function getPushAlertsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(PUSH_PREF_STORAGE_KEY);
    if (raw === '0' || raw === 'false') return false;
    if (raw === '1' || raw === 'true') return true;
  } catch {
    // Ignore storage read error
  }
  return getNotificationPermissionState() === 'granted';
}

export function setPushAlertsEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PUSH_PREF_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage write error
  }
}

function wasRecentlyNotified(dedupKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const now = Date.now();
    const raw = window.localStorage.getItem(PUSH_DEDUP_STORAGE_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    const lastTs = map[dedupKey];
    if (typeof lastTs === 'number' && now - lastTs < PUSH_DEDUP_TTL_MS) {
      return true;
    }
    const cleaned: Record<string, number> = {};
    for (const [k, ts] of Object.entries(map)) {
      if (typeof ts === 'number' && now - ts < PUSH_DEDUP_TTL_MS) {
        cleaned[k] = ts;
      }
    }
    cleaned[dedupKey] = now;
    window.localStorage.setItem(PUSH_DEDUP_STORAGE_KEY, JSON.stringify(cleaned));
    return false;
  } catch {
    return false;
  }
}

async function getRegisteredServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) {
      return existing;
    }

    const regs = await navigator.serviceWorker.getRegistrations();
    if (regs.length > 0) {
      return regs[0];
    }

    // Fallback when running in dev server where vite-plugin-pwa devOptions is disabled
    const fallbackReg = await navigator.serviceWorker.register('/sw-notifications.js', {
      scope: '/',
    });
    return fallbackReg;
  } catch {
    return null;
  }
}

async function dispatchThroughServiceWorker(payload: RepairNotificationPayload): Promise<boolean> {
  const reg = await getRegisteredServiceWorker();

  if (reg) {
    try {
      const targetWorker = reg.active || reg.waiting || reg.installing;
      if (targetWorker && reg.active) {
        reg.active.postMessage({
          type: 'SHOW_REPAIR_NOTIFICATION',
          payload,
        });
        return true;
      }

      if (typeof reg.showNotification === 'function') {
        await reg.showNotification(payload.title, {
          body: payload.body,
          icon: payload.icon,
          badge: payload.badge,
          tag: payload.tag,
          data: payload.data,
        });
        return true;
      }
    } catch {
      // Fall through to showNotification / Notification fallback
    }

    try {
      const readyReg = await Promise.race<ServiceWorkerRegistration | null>([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1500)),
      ]);
      if (readyReg && typeof readyReg.showNotification === 'function') {
        await readyReg.showNotification(payload.title, {
          body: payload.body,
          icon: payload.icon,
          badge: payload.badge,
          tag: payload.tag,
          data: payload.data,
        });
        return true;
      }
    } catch {
      // Fall through
    }
  }

  // Fallback directly via Notification API if SW could not show it
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const notif = new Notification(payload.title, {
        body: payload.body,
        icon: payload.icon,
        tag: payload.tag,
      });
      notif.onclick = () => {
        window.focus();
        if (payload.data.repairId) {
          window.dispatchEvent(
            new CustomEvent('th3bnb:open-repair-from-notification', {
              detail: { repairId: payload.data.repairId, code: payload.data.code },
            })
          );
        }
        notif.close();
      };
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export async function requestPushNotificationPermission(): Promise<PushPermissionState> {
  if (!isPushNotificationSupported()) {
    return 'unsupported';
  }

  const permission = await window.Notification.requestPermission();
  if (permission === 'granted') {
    setPushAlertsEnabled(true);
    await getRegisteredServiceWorker();
  }
  return permission;
}

function buildRepairReadyCopy(repair: RepairRecord): { title: string; body: string } {
  const lang = getActiveLanguage();
  const normalized = normalizeRepairStatusKey(repair.status);
  const statusLabel =
    normalized === 'terminado'
      ? lang === 'en'
        ? 'Completed'
        : lang === 'pt'
          ? 'Concluído'
          : 'Terminado'
      : getTranslatedStatusLabel('listo');

  const deviceLabel = `${repair.brand || ''} ${repair.model || ''}`.trim() || repair.deviceType || 'Equipo';
  const clientLabel = repair.clientName || (lang === 'en' ? 'Client' : lang === 'pt' ? 'Cliente' : 'Cliente');
  const orderCode = repair.code || '';

  if (lang === 'en') {
    return {
      title: `Repair ready${orderCode ? ` · ${orderCode}` : ''}`,
      body: `${deviceLabel} for ${clientLabel} is now "${statusLabel}".`,
    };
  }
  if (lang === 'pt') {
    return {
      title: `Reparo pronto${orderCode ? ` · ${orderCode}` : ''}`,
      body: `${deviceLabel} de ${clientLabel} passou para "${statusLabel}".`,
    };
  }
  return {
    title: `Reparación lista${orderCode ? ` · ${orderCode}` : ''}`,
    body: `${deviceLabel} de ${clientLabel} pasó a estado "${statusLabel}".`,
  };
}

export async function sendRepairReadyPushNotification(repair: RepairRecord): Promise<boolean> {
  if (!isReadyRepairStatus(repair.status)) return false;
  if (!isPushNotificationSupported()) return false;
  if (getNotificationPermissionState() !== 'granted') return false;
  if (!getPushAlertsEnabled()) return false;

  const statusKey = normalizeRepairStatusKey(repair.status);
  const dedupKey = `${repair.id}:${statusKey}`;
  if (wasRecentlyNotified(dedupKey)) {
    return false;
  }

  const { title, body } = buildRepairReadyCopy(repair);
  return dispatchThroughServiceWorker({
    title,
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: `repair-ready-${repair.id}`,
    data: {
      repairId: repair.id,
      code: repair.code || '',
      status: statusKey,
      url: `/?repairId=${encodeURIComponent(repair.id)}`,
    },
  });
}

export async function sendTestRepairPushNotification(): Promise<boolean> {
  if (!isPushNotificationSupported()) return false;
  if (getNotificationPermissionState() !== 'granted') return false;

  const lang = getActiveLanguage();
  const title =
    lang === 'en'
      ? 'Test notification · R-10001'
      : lang === 'pt'
        ? 'Notificação de teste · R-10001'
        : 'Notificación de prueba · R-10001';
  const body =
    lang === 'en'
      ? 'Alerts for repairs marked Ready / Completed are active via Service Worker.'
      : lang === 'pt'
        ? 'Os alertas de reparos Prontos / Concluídos estão ativos via Service Worker.'
        : 'Las alertas cuando una reparación pasa a Listo o Terminado están activas vía Service Worker.';

  return dispatchThroughServiceWorker({
    title,
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: 'th3bnb-repair-test',
    data: {
      repairId: '',
      code: 'R-10001',
      status: 'listo',
      url: '/',
    },
  });
}
