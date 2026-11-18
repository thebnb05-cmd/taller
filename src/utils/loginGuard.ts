import { supabase } from '../lib/db';

export const MAX_LOGIN_ATTEMPTS = 5;

const STORAGE_KEY = 'th3bnb_login_guard_v1';
const LOCK_TTL_MS = 24 * 60 * 60 * 1000;

export interface LoginGuardStatus {
  attempts: number;
  remainingAttempts: number;
  requiresOtp: boolean;
}

interface StoredAttemptEntry {
  n: number;
  r: boolean;
  t: number;
}

type StoredGuardMap = Record<string, StoredAttemptEntry>;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function hashEmailKey(email: string): Promise<string> {
  const clean = normalizeEmail(email);
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const encoded = new TextEncoder().encode(`lg:${clean}`);
      const digest = await window.crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 24);
    } catch {
      // Fallback below
    }
  }
  let hash = 2166136261;
  for (let i = 0; i < clean.length; i += 1) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `f_${(hash >>> 0).toString(16)}`;
}

function readLocalMap(): StoredGuardMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredGuardMap;
    if (!parsed || typeof parsed !== 'object') return {};
    const now = Date.now();
    const clean: StoredGuardMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.n === 'number' && typeof v.t === 'number' && now - v.t < LOCK_TTL_MS) {
        clean[k] = {
          n: Math.max(0, Math.min(MAX_LOGIN_ATTEMPTS, Math.floor(v.n))),
          r: Boolean(v.r),
          t: v.t,
        };
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function writeLocalMap(map: StoredGuardMap): void {
  if (typeof window === 'undefined') return;
  try {
    const entries = Object.entries(map)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, 8);
    if (entries.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    }
  } catch {
    // Ignore storage quota errors
  }
}

function buildStatus(attempts: number, requiresOtp?: boolean): LoginGuardStatus {
  const clamped = Math.max(0, Math.min(MAX_LOGIN_ATTEMPTS, Math.floor(attempts)));
  const locked = Boolean(requiresOtp) || clamped >= MAX_LOGIN_ATTEMPTS;
  return {
    attempts: clamped,
    remainingAttempts: Math.max(0, MAX_LOGIN_ATTEMPTS - clamped),
    requiresOtp: locked,
  };
}

async function callServerLoginGuard(
  email: string,
  action: 'status' | 'fail' | 'reset',
  accessToken?: string
): Promise<LoginGuardStatus | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const res = await fetch('/api/auth/login-guard', {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ email: normalizeEmail(email), action }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      attempts?: number;
      requiresOtp?: boolean;
    } | null;
    if (!data || !data.ok || typeof data.attempts !== 'number') return null;
    return buildStatus(data.attempts, data.requiresOtp);
  } catch {
    return null;
  }
}

export async function getLoginGuardStatus(email: string): Promise<LoginGuardStatus> {
  const clean = normalizeEmail(email);
  if (!clean || !clean.includes('@')) return buildStatus(0, false);

  const key = await hashEmailKey(clean);
  const localMap = readLocalMap();
  const localEntry = localMap[key];
  const localStatus = buildStatus(localEntry?.n || 0, localEntry?.r);

  const serverStatus = await callServerLoginGuard(clean, 'status');
  const mergedAttempts = Math.max(localStatus.attempts, serverStatus?.attempts || 0);
  const mergedLocked = localStatus.requiresOtp || Boolean(serverStatus?.requiresOtp);

  if (mergedAttempts > (localEntry?.n || 0) || mergedLocked !== Boolean(localEntry?.r)) {
    localMap[key] = { n: mergedAttempts, r: mergedLocked, t: Date.now() };
    writeLocalMap(localMap);
  }

  return buildStatus(mergedAttempts, mergedLocked);
}

export async function recordFailedPasswordAttempt(email: string): Promise<LoginGuardStatus> {
  const clean = normalizeEmail(email);
  if (!clean || !clean.includes('@')) return buildStatus(0, false);

  const key = await hashEmailKey(clean);
  const localMap = readLocalMap();
  const prev = localMap[key];
  const nextLocalAttempts = Math.min(MAX_LOGIN_ATTEMPTS, (prev?.n || 0) + 1);
  const nextLocalLocked = Boolean(prev?.r) || nextLocalAttempts >= MAX_LOGIN_ATTEMPTS;

  const serverStatus = await callServerLoginGuard(clean, 'fail');
  const mergedAttempts = Math.max(nextLocalAttempts, serverStatus?.attempts || 0);
  const mergedLocked = nextLocalLocked || Boolean(serverStatus?.requiresOtp);

  localMap[key] = { n: mergedAttempts, r: mergedLocked, t: Date.now() };
  writeLocalMap(localMap);

  return buildStatus(mergedAttempts, mergedLocked);
}

export async function resetLoginGuard(email: string, accessToken?: string): Promise<void> {
  const clean = normalizeEmail(email);
  if (!clean || !clean.includes('@')) return;

  const key = await hashEmailKey(clean);
  const localMap = readLocalMap();
  if (key in localMap) {
    delete localMap[key];
    writeLocalMap(localMap);
  }

  let token = accessToken;
  if (!token) {
    try {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token;
    } catch {
      // Ignore session lookup errors
    }
  }
  if (token) {
    await callServerLoginGuard(clean, 'reset', token);
  }
}
