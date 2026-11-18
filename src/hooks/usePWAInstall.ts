import { useEffect, useState } from 'react';
import { supabase } from '../lib/db';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DEVICE_ID_STORAGE_KEY = 'th3bnb_device_id';
const INSTALL_PING_TS_KEY = 'th3bnb_install_ping_ts';
const STANDALONE_PING_INTERVAL_MS = 24 * 60 * 60 * 1000;

function getOrCreateDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,80}$/.test(existing)) {
      return existing;
    }
    const generated =
      typeof window.crypto !== 'undefined' && typeof window.crypto.randomUUID === 'function'
        ? `dev_${window.crypto.randomUUID().replace(/-/g, '')}`
        : `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `dev_${Date.now().toString(36)}`;
  }
}

function detectClientPlatform(): 'ios' | 'android' | 'desktop' {
  const ua = (window.navigator.userAgent || '').toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'desktop';
}

async function reportPwaInstall(source: 'appinstalled' | 'standalone'): Promise<void> {
  try {
    const now = Date.now();
    if (source === 'standalone') {
      const lastPingRaw = window.localStorage.getItem(INSTALL_PING_TS_KEY);
      const lastPing = lastPingRaw ? Number(lastPingRaw) : 0;
      if (Number.isFinite(lastPing) && now - lastPing < STANDALONE_PING_INTERVAL_MS) {
        return;
      }
    }

    const deviceId = getOrCreateDeviceId();
    const platform = detectClientPlatform();
    let token = '';
    try {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token || '';
    } catch {
      token = '';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch('/api/telemetry/install', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        deviceId,
        platform,
        installSource: source,
        userAgent: (window.navigator.userAgent || '').slice(0, 220),
      }),
    });

    if (res.ok) {
      window.localStorage.setItem(INSTALL_PING_TS_KEY, String(now));
    }
  } catch {
    // Telemetría silenciosa: nunca interrumpe la experiencia del taller
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    if (isStandalone) {
      void reportPwaInstall('standalone');
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      void reportPwaInstall('appinstalled');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      void reportPwaInstall('appinstalled');
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}
