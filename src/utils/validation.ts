const CONTROL_CHARS_MULTILINE_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const CONTROL_CHARS_SINGLE_RE = /[\x00-\x1F\x7F]/g;
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS_MULTILINE_RE, '')
    .trim()
    .slice(0, maxLen);
}

export function sanitizePlainLine(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS_SINGLE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function sanitizePhone(value: unknown, maxLen = 40): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^\d+\-()\s.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeTelHref(phone: unknown): string {
  if (typeof phone !== 'string') return '';
  return phone.replace(/[^\d+]/g, '').slice(0, 24);
}

export function sanitizeEmail(value: unknown, maxLen = 200): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS_SINGLE_RE, '')
    .trim()
    .toLowerCase()
    .slice(0, maxLen);
}

export function isValidEmail(value: string): boolean {
  const clean = value.trim();
  if (!clean) return false;
  return clean.length <= 200 && EMAIL_RE.test(clean);
}

export function sanitizeDni(value: unknown, maxLen = 32): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^a-zA-Z0-9.\-\s]/g, '')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeImei(value: unknown, maxLen = 64): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^a-zA-Z0-9\-_:/.\s]/g, '')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeAlias(value: unknown, maxLen = 60): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^a-zA-Z0-9._\-]/g, '')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeCbu(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\d]/g, '').slice(0, 22);
}

export function sanitizeHexColor(value: unknown, fallback = '#0072BB'): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed : fallback;
}

export function sanitizeSafeUrl(value: unknown, maxLen = 500): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.replace(CONTROL_CHARS_SINGLE_RE, '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    return parsed.toString().slice(0, maxLen);
  } catch {
    return '';
  }
}

const SAFE_IMAGE_DATA_URL_RE =
  /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
const SAFE_VIDEO_DATA_URL_RE =
  /^data:video\/(mp4|webm|ogg|quicktime);base64,[A-Za-z0-9+/=]+$/i;

export function sanitizeImageDataUrl(value: unknown, maxLen = 1_200_000): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return '';
  if (SAFE_IMAGE_DATA_URL_RE.test(trimmed)) return trimmed;
  return '';
}

export function sanitizeMediaUrl(
  value: unknown,
  mediaType?: 'image' | 'video'
): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.replace(CONTROL_CHARS_SINGLE_RE, '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:')) {
    if (mediaType !== 'video' && SAFE_IMAGE_DATA_URL_RE.test(trimmed)) {
      return trimmed.length <= 2_500_000 ? trimmed : '';
    }
    if (mediaType !== 'image' && SAFE_VIDEO_DATA_URL_RE.test(trimmed)) {
      return trimmed.length <= 9_000_000 ? trimmed : '';
    }
    return '';
  }
  return sanitizeSafeUrl(trimmed, 1000);
}

export function parseSafePositiveNumber(
  value: unknown,
  fallback = 0,
  maxVal = 999_999_999
): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(maxVal, Math.round(n * 100) / 100);
}

export function parseSafeNonNegativeInt(
  value: unknown,
  fallback = 0,
  maxVal = 1_000_000
): number {
  const n = typeof value === 'number' ? value : Number(value ?? '');
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(maxVal, Math.floor(n));
}

export function sanitizeCsvCell(value: unknown): string {
  const str = sanitizePlainLine(String(value ?? ''), 500);
  if (!str) return '';
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID_RE.test(value);
}

export function stripPrototypeKeys<T extends Record<string, unknown>>(
  obj: T
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    clean[key] = val;
  }
  return clean;
}

export function sanitizeDbErrorMessage(error: unknown, fallback: string): string {
  const raw =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : typeof error === 'string'
      ? error
      : '';
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';

  const lower = raw.toLowerCase();

  if (code === '42501' || lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'No tenés permisos para realizar esta acción sobre ese registro.';
  }
  if (code === '23505' || lower.includes('duplicate key')) {
    return 'Ya existe un registro con ese identificador o código.';
  }
  if (code === '23503' || lower.includes('foreign key')) {
    return 'Referencia inválida o sesión no encontrada.';
  }
  if (code === '22P02' || lower.includes('invalid input syntax')) {
    return 'Uno de los datos ingresados tiene un formato inválido.';
  }
  if (code === '42P01' || code === 'PGRST205' || lower.includes('could not find the table')) {
    return 'Falta inicializar las tablas de base de datos en Supabase.';
  }
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('timeout')) {
    return 'Error de conexión. Verificá tu internet e intentá nuevamente.';
  }
  if (lower.includes('jwt') || lower.includes('token') || lower.includes('session')) {
    return 'Tu sesión venció. Volvé a iniciar sesión para continuar.';
  }
  return fallback;
}
