const COOKIE_CHUNK_SIZE = 3200;
const COOKIE_MAX_CHUNKS = 4;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function sanitizeCookieKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function isEmbeddedIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

function buildCookieAttributes(maxAgeSeconds: number): string {
  const isHttps =
    typeof window !== 'undefined' && window.location.protocol === 'https:';
  const sameSite = isEmbeddedIframe() && isHttps ? 'SameSite=None' : 'SameSite=Strict';
  const secureFlag = isHttps ? '; Secure' : '';
  return `Path=/; Max-Age=${maxAgeSeconds}; ${sameSite}${secureFlag}`;
}

function readCookieMap(): Map<string, string> {
  const map = new Map<string, string>();
  if (typeof document === 'undefined' || !document.cookie) return map;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    try {
      map.set(k, decodeURIComponent(v));
    } catch {
      map.set(k, v);
    }
  }
  return map;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; ${buildCookieAttributes(maxAgeSeconds)}`;
}

function clearCookieChunks(baseName: string): void {
  if (typeof document === 'undefined') return;
  writeCookie(baseName, '', 0);
  writeCookie(`${baseName}__n`, '', 0);
  for (let i = 0; i < COOKIE_MAX_CHUNKS; i++) {
    writeCookie(`${baseName}__c${i}`, '', 0);
  }
}

function writeChunkedCookie(baseName: string, value: string): boolean {
  if (typeof document === 'undefined') return false;
  clearCookieChunks(baseName);

  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += COOKIE_CHUNK_SIZE) {
    chunks.push(value.slice(i, i + COOKIE_CHUNK_SIZE));
  }
  if (chunks.length > COOKIE_MAX_CHUNKS) return false;

  writeCookie(`${baseName}__n`, String(chunks.length), COOKIE_MAX_AGE_SECONDS);
  for (let i = 0; i < chunks.length; i++) {
    writeCookie(`${baseName}__c${i}`, chunks[i], COOKIE_MAX_AGE_SECONDS);
  }

  // Verify the browser accepted the cookies (iframes with blocked third-party cookies won't persist them)
  const check = readCookieMap();
  return check.get(`${baseName}__n`) === String(chunks.length);
}

function readChunkedCookie(baseName: string): string | null {
  const map = readCookieMap();
  const countRaw = map.get(`${baseName}__n`);
  if (!countRaw) return null;
  const count = Number(countRaw);
  if (!Number.isInteger(count) || count < 1 || count > COOKIE_MAX_CHUNKS) return null;

  let out = '';
  for (let i = 0; i < count; i++) {
    const chunk = map.get(`${baseName}__c${i}`);
    if (typeof chunk !== 'string') return null;
    out += chunk;
  }
  return out;
}

export function setPreferenceCookie(name: string, value: string): void {
  const safeName = sanitizeCookieKey(name);
  if (!safeName) return;
  writeCookie(safeName, value.slice(0, 200), 60 * 60 * 24 * 365);
}

export function getPreferenceCookie(name: string): string | null {
  const safeName = sanitizeCookieKey(name);
  if (!safeName) return null;
  return readCookieMap().get(safeName) ?? null;
}

/**
 * Hardened storage adapter for Supabase Auth session tokens.
 * - Prefers hardened cookies (`Path=/`, `SameSite=Strict` in top-level context or `SameSite=None; Secure` in HTTPS iframe).
 * - Falls back cleanly to `sessionStorage` -> `localStorage` if a sandboxed iframe rejects cookies or token exceeds cookie bounds.
 * - Cleans up all legacy session locations on `removeItem`.
 */
export function createHardenedAuthStorage(): Storage {
  const memoryFallback = new Map<string, string>();

  return {
    get length(): number {
      return memoryFallback.size;
    },
    clear(): void {
      memoryFallback.clear();
    },
    key(index: number): string | null {
      return Array.from(memoryFallback.keys())[index] ?? null;
    },
    getItem(key: string): string | null {
      const cookieName = `th3_${sanitizeCookieKey(key)}`;
      const fromCookie = readChunkedCookie(cookieName);
      if (fromCookie !== null) return fromCookie;

      try {
        const fromSession = window.sessionStorage.getItem(key);
        if (fromSession !== null) return fromSession;
      } catch {
        // Ignore restricted storage
      }

      try {
        const fromLocal = window.localStorage.getItem(key);
        if (fromLocal !== null) return fromLocal;
      } catch {
        // Ignore restricted storage
      }

      return memoryFallback.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      const cookieName = `th3_${sanitizeCookieKey(key)}`;
      memoryFallback.set(key, value);

      const savedInCookie = writeChunkedCookie(cookieName, value);
      if (savedInCookie) {
        try {
          window.sessionStorage.setItem(key, value);
          window.localStorage.removeItem(key);
        } catch {
          // Ignore
        }
        return;
      }

      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          // Kept in memoryFallback
        }
      }
    },
    removeItem(key: string): void {
      const cookieName = `th3_${sanitizeCookieKey(key)}`;
      memoryFallback.delete(key);
      clearCookieChunks(cookieName);
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // Ignore
      }
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore
      }
    },
  };
}
