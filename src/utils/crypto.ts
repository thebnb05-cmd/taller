import { stripPrototypeKeys } from './validation';

const ENC_PREFIX = 'enc:v1:';
const APP_KEY_PEPPER = 'TH3BNB-AES256GCM-WORKSHOP-KEY-V1::2026';

const derivedKeyCache = new Map<string, Promise<CryptoKey>>();
const decryptedTextCache = new Map<string, string>();
const MAX_DECRYPT_CACHE_SIZE = 4000;

function setCachedPlaintext(cacheKey: string, value: string): void {
  if (decryptedTextCache.size >= MAX_DECRYPT_CACHE_SIZE) {
    decryptedTextCache.clear();
  }
  decryptedTextCache.set(cacheKey, value);
}

function getSubtleCrypto(): SubtleCrypto | null {
  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
    return null;
  }
  return window.crypto.subtle;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64u: string): Uint8Array {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function getOwnerAesKey(ownerId: string): Promise<CryptoKey | null> {
  const subtle = getSubtleCrypto();
  if (!subtle || !ownerId) return null;

  const existing = derivedKeyCache.get(ownerId);
  if (existing) return existing;

  const promise = (async () => {
    const enc = new TextEncoder();
    const keyMaterial = await subtle.importKey(
      'raw',
      enc.encode(`${APP_KEY_PEPPER}:${ownerId}`),
      'HKDF',
      false,
      ['deriveKey']
    );
    return subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: enc.encode(`th3bnb-owner-salt-${ownerId}`),
        info: enc.encode('th3bnb-pii-aes-256-gcm-v1'),
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  })();

  derivedKeyCache.set(ownerId, promise);
  return promise;
}

export function isEncryptedValue(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

async function encryptText(plaintext: string, ownerId: string): Promise<string> {
  if (!plaintext) return '';
  if (isEncryptedValue(plaintext)) return plaintext;
  const key = await getOwnerAesKey(ownerId);
  const subtle = getSubtleCrypto();
  if (!key || !subtle) return plaintext;

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const cipherBytes = new Uint8Array(cipherBuffer);
  const encrypted = `${ENC_PREFIX}${toBase64Url(iv)}:${toBase64Url(cipherBytes)}`;
  setCachedPlaintext(`${ownerId}:${encrypted}`, plaintext);
  return encrypted;
}

async function decryptText(value: string, ownerId: string): Promise<string> {
  if (!value) return '';
  if (!isEncryptedValue(value)) return value;

  const cacheKey = `${ownerId}:${value}`;
  const cached = decryptedTextCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const key = await getOwnerAesKey(ownerId);
  const subtle = getSubtleCrypto();
  if (!key || !subtle) return '';

  const payload = value.slice(ENC_PREFIX.length);
  const sep = payload.indexOf(':');
  if (sep <= 0) return '';

  try {
    const iv = fromBase64Url(payload.slice(0, sep));
    const cipherBytes = fromBase64Url(payload.slice(sep + 1));
    const plainBuffer = await subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      new Uint8Array(cipherBytes)
    );
    const decoded = new TextDecoder().decode(plainBuffer);
    setCachedPlaintext(cacheKey, decoded);
    return decoded;
  } catch {
    return '';
  }
}

export async function encryptJsonValue(value: unknown, ownerId: string): Promise<string> {
  const json = JSON.stringify(value);
  return encryptText(json, ownerId);
}

export async function decryptJsonValue<T>(
  raw: string,
  ownerId: string,
  fallback: T
): Promise<T> {
  if (!raw) return fallback;
  const decrypted = await decryptText(raw, ownerId);
  if (!decrypted) return fallback;
  try {
    const parsed = JSON.parse(decrypted);
    return parsed as T;
  } catch {
    return fallback;
  }
}

// Per-table sensitive PII / personal / financial field configuration
const ENCRYPTED_STRING_FIELDS: Record<string, readonly string[]> = {
  workshop_profiles: [
    'email',
    'firstName',
    'lastName',
    'businessPhone',
    'businessAddress',
    'subtitle',
    'trackingBaseUrl',
  ],
  clients: ['name', 'phone', 'dni', 'email', 'address', 'notes'],
  repairs: [
    'clientName',
    'clientPhone',
    'clientDni',
    'clientEmail',
    'clientAddress',
    'imei',
    'securityPin',
    'notes',
  ],
  suppliers: ['contact', 'phone', 'email'],
  sales: ['clientName'],
};

export async function encryptRecordFields(
  table: string,
  record: Record<string, unknown>,
  ownerId: string
): Promise<Record<string, unknown>> {
  const out = stripPrototypeKeys(record);
  const fields = ENCRYPTED_STRING_FIELDS[table];
  if (!ownerId || !fields) return out;

  const jobs: Array<Promise<void>> = [];
  for (const field of fields) {
    const val = out[field];
    if (typeof val === 'string' && val.length > 0 && !isEncryptedValue(val)) {
      jobs.push(
        encryptText(val, ownerId).then((cipher) => {
          out[field] = cipher;
        })
      );
    }
  }

  // Encrypt securityPattern unlock sequence while preserving JSONB structure
  if (table === 'repairs' && Array.isArray(out.securityPattern) && out.securityPattern.length > 0) {
    jobs.push(
      encryptJsonValue(out.securityPattern, ownerId).then((enc) => {
        out.securityPattern = { enc };
      })
    );
  }

  if (jobs.length > 0) {
    await Promise.all(jobs);
  }

  return out;
}

export async function decryptRecordFields<T extends Record<string, unknown>>(
  table: string,
  record: T,
  ownerIdHint?: string
): Promise<T> {
  const ownerId =
    (typeof record.ownerId === 'string' && record.ownerId) || ownerIdHint || '';
  if (!ownerId) return record;

  const fields = ENCRYPTED_STRING_FIELDS[table];
  const hasEncryptedSecurityPattern =
    table === 'repairs' && Boolean(record.securityPattern) && !Array.isArray(record.securityPattern);

  let needsWork = hasEncryptedSecurityPattern;
  if (!needsWork && fields) {
    for (const field of fields) {
      if (isEncryptedValue(record[field])) {
        needsWork = true;
        break;
      }
    }
  }
  if (!needsWork) return record;

  const out: Record<string, unknown> = { ...record };
  const jobs: Array<Promise<void>> = [];

  if (fields) {
    for (const field of fields) {
      const val = out[field];
      if (isEncryptedValue(val)) {
        jobs.push(
          decryptText(val, ownerId).then((plain) => {
            out[field] = plain;
          })
        );
      }
    }
  }

  if (hasEncryptedSecurityPattern) {
    const spObj = out.securityPattern as { enc?: unknown };
    if (spObj && isEncryptedValue(spObj.enc)) {
      jobs.push(
        decryptJsonValue<number[]>(spObj.enc, ownerId, []).then((decryptedArr) => {
          out.securityPattern = Array.isArray(decryptedArr) ? decryptedArr : [];
        })
      );
    } else {
      out.securityPattern = [];
    }
  }

  if (jobs.length > 0) {
    await Promise.all(jobs);
  }

  return out as T;
}
