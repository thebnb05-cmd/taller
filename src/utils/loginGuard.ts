import { supabase } from '../lib/db';

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;

const STORAGE_KEY = 'th3bnb_login_guard_v1';
const LAST_LOCKED_EMAIL_KEY = 'th3bnb_last_locked_email';
const ATTEMPT_WINDOW_MS = 30 * 60 * 1000;

export interface LoginGuardStatus {
  attempts: number;
  remainingAttempts: number;
  requiresOtp: boolean;
  lockedUntil: number | null;
  lockRemainingSec: number;
}

interface StoredAttemptEntry {
  n: number;
  u: number;
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
    let mutated = false;
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v.n !== 'number' || typeof v.t !== 'number') {
        mutated = true;
        continue;
      }
      const lockedUntil = typeof v.u === 'number' && Number.isFinite(v.u) ? v.u : 0;
      if (lockedUntil > 0 && now >= lockedUntil) {
        mutated = true;
        continue;
      }
      if (lockedUntil === 0 && now - v.t >= ATTEMPT_WINDOW_MS) {
        mutated = true;
        continue;
      }
      clean[k] = {
        n: Math.max(0, Math.min(MAX_LOGIN_ATTEMPTS, Math.floor(v.n))),
        u: lockedUntil,
        t: v.t,
      };
    }
    if (mutated) {
      writeLocalMap(clean);
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

function buildStatus(attempts: number, lockedUntil: number | null): LoginGuardStatus {
  const now = Date.now();
  const activeLock = Boolean(lockedUntil && lockedUntil > now);
  if (lockedUntil && !activeLock) {
    return {
      attempts: 0,
      remainingAttempts: MAX_LOGIN_ATTEMPTS,
      requiresOtp: false,
      lockedUntil: null,
      lockRemainingSec: 0,
    };
  }
  const clamped = Math.max(0, Math.min(MAX_LOGIN_ATTEMPTS, Math.floor(attempts)));
  const locked = activeLock || clamped >= MAX_LOGIN_ATTEMPTS;
  const effectiveUntil = locked ? (activeLock ? lockedUntil : now + LOGIN_LOCKOUT_MS) : null;
  const lockRemainingSec = effectiveUntil ? Math.max(0, Math.ceil((effectiveUntil - now) / 1000)) : 0;
  return {
    attempts: clamped,
    remainingAttempts: Math.max(0, MAX_LOGIN_ATTEMPTS - clamped),
    requiresOtp: locked,
    lockedUntil: effectiveUntil,
    lockRemainingSec,
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
      lockedUntil?: number | null;
    } | null;
    if (!data || !data.ok || typeof data.attempts !== 'number') return null;
    const serverUntil =
      typeof data.lockedUntil === 'number' && data.lockedUntil > Date.now()
        ? data.lockedUntil
        : data.requiresOtp
          ? Date.now() + LOGIN_LOCKOUT_MS
          : null;
    return buildStatus(data.attempts, serverUntil);
  } catch {
    return null;
  }
}

export function rememberLockedEmail(email: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!email) {
      window.sessionStorage.removeItem(LAST_LOCKED_EMAIL_KEY);
    } else {
      window.sessionStorage.setItem(LAST_LOCKED_EMAIL_KEY, normalizeEmail(email));
    }
  } catch {
    // Ignore storage errors
  }
}

export function getRememberedLockedEmail(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(LAST_LOCKED_EMAIL_KEY);
  } catch {
    return null;
  }
}

export async function getLoginGuardStatus(email: string): Promise<LoginGuardStatus> {
  const clean = normalizeEmail(email);
  if (!clean || !clean.includes('@')) return buildStatus(0, null);

  const key = await hashEmailKey(clean);
  const localMap = readLocalMap();
  const localEntry = localMap[key];
  const localStatus = buildStatus(
    localEntry?.n || 0,
    localEntry && localEntry.u > 0 ? localEntry.u : null
  );

  const serverStatus = await callServerLoginGuard(clean, 'status');
  const mergedAttempts = Math.max(localStatus.attempts, serverStatus?.attempts || 0);
  const mergedUntilCandidates = [localStatus.lockedUntil || 0, serverStatus?.lockedUntil || 0].filter(
    (v) => v > Date.now()
  );
  const mergedLockedUntil =
    mergedUntilCandidates.length > 0
      ? Math.max(...mergedUntilCandidates)
      : mergedAttempts >= MAX_LOGIN_ATTEMPTS
        ? Date.now() + LOGIN_LOCKOUT_MS
        : null;

  if (mergedAttempts > 0 || mergedLockedUntil) {
    localMap[key] = {
      n: mergedAttempts,
      u: mergedLockedUntil || 0,
      t: Date.now(),
    };
    writeLocalMap(localMap);
  }

  return buildStatus(mergedAttempts, mergedLockedUntil);
}

export async function recordFailedPasswordAttempt(email: string): Promise<LoginGuardStatus> {
  const clean = normalizeEmail(email);
  if (!clean || !clean.includes('@')) return buildStatus(0, null);

  const now = Date.now();
  const key = await hashEmailKey(clean);
  const localMap = readLocalMap();
  const prev = localMap[key];

  if (prev && prev.u > now) {
    const serverStatus = await callServerLoginGuard(clean, 'status');
    const mergedUntil = Math.max(prev.u, serverStatus?.lockedUntil || 0);
    rememberLockedEmail(clean);
    return buildStatus(MAX_LOGIN_ATTEMPTS, mergedUntil);
  }

  const nextLocalAttempts = Math.min(MAX_LOGIN_ATTEMPTS, (prev?.n || 0) + 1);
  const nextLocalUntil = nextLocalAttempts >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : 0;

  const serverStatus = await callServerLoginGuard(clean, 'fail');
  const mergedAttempts = Math.max(nextLocalAttempts, serverStatus?.attempts || 0);
  const mergedUntil =
    mergedAttempts >= MAX_LOGIN_ATTEMPTS
      ? Math.max(nextLocalUntil || now + LOGIN_LOCKOUT_MS, serverStatus?.lockedUntil || 0)
      : 0;

  localMap[key] = { n: mergedAttempts, u: mergedUntil, t: now };
  writeLocalMap(localMap);

  if (mergedAttempts >= MAX_LOGIN_ATTEMPTS) {
    rememberLockedEmail(clean);
  }

  return buildStatus(mergedAttempts, mergedUntil || null);
}

export async function resetLoginGuard(email: string, accessToken?: string): Promise<void> {
  const clean = normalizeEmail(email);
  if (!clean || !clean.includes('@')) return;

  rememberLockedEmail(null);
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
