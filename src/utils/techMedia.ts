import { sanitizeMediaUrl, sanitizePlainLine, sanitizeText } from './validation';

export interface TechMediaItem {
  id: string;
  type: 'image' | 'video';
  url: string;
  caption?: string;
  createdAt: number;
}

const MEDIA_MARKER = '\n<!--TH3BNB_MEDIA:';
const MEDIA_END = '-->';
const RMETA_RE = /\n?<!--TH3BNB_RMETA:([\s\S]*?)-->/;
const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{6,20}$/;
const DRIVE_ID_RE = /^[a-zA-Z0-9_-]{10,120}$/;

export const MAX_INLINE_VIDEO_BYTES = 6 * 1024 * 1024; // 6 MB

export function parseWorkDetailAndMedia(raw?: string | null): {
  text: string;
  media: TechMediaItem[];
} {
  if (!raw) return { text: '', media: [] };
  const withoutRmeta = raw.replace(RMETA_RE, '');
  const idx = withoutRmeta.lastIndexOf(MEDIA_MARKER);
  if (idx === -1) {
    return { text: sanitizeText(withoutRmeta, 2000), media: [] };
  }
  const text = sanitizeText(withoutRmeta.slice(0, idx), 2000);
  const after = withoutRmeta.slice(idx + MEDIA_MARKER.length);
  const endIdx = after.lastIndexOf(MEDIA_END);
  const jsonPart = endIdx !== -1 ? after.slice(0, endIdx) : after;
  try {
    const parsed = JSON.parse(jsonPart);
    if (Array.isArray(parsed)) {
      const media: TechMediaItem[] = [];
      for (const item of parsed.slice(0, 12)) {
        if (
          !item ||
          typeof item !== 'object' ||
          (item.type !== 'image' && item.type !== 'video') ||
          typeof item.url !== 'string'
        ) {
          continue;
        }
        const safeUrl = sanitizeMediaUrl(item.url, item.type);
        if (!safeUrl) continue;
        media.push({
          id: sanitizePlainLine(String(item.id || createMediaId()), 64) || createMediaId(),
          type: item.type,
          url: safeUrl,
          caption: typeof item.caption === 'string' ? sanitizePlainLine(item.caption, 160) : undefined,
          createdAt:
            typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
              ? item.createdAt
              : Date.now(),
        });
      }
      return { text, media };
    }
  } catch {
    // Fallback to clean text if marker payload is malformed
  }
  return { text, media: [] };
}

export function serializeWorkDetailAndMedia(
  text: string,
  media: TechMediaItem[],
  existingWorkDetail?: string | null
): string {
  const cleanText = sanitizeText(text, 2000)
    .replace(/<!--TH3BNB_MEDIA:/g, '')
    .replace(/<!--TH3BNB_RMETA:/g, '')
    .replace(/-->/g, '')
    .trim();
  const safeMedia = (media || [])
    .slice(0, 10)
    .map((item) => {
      const safeUrl = sanitizeMediaUrl(item.url, item.type);
      if (!safeUrl) return null;
      return {
        id: sanitizePlainLine(item.id, 64) || createMediaId(),
        type: item.type,
        url: safeUrl,
        caption: item.caption ? sanitizePlainLine(item.caption, 160) : undefined,
        createdAt: item.createdAt || Date.now(),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const head =
    safeMedia.length === 0
      ? cleanText
      : `${cleanText}${MEDIA_MARKER}${JSON.stringify(safeMedia)}${MEDIA_END}`;

  const rmetaMatch = existingWorkDetail ? RMETA_RE.exec(existingWorkDetail) : null;
  if (!rmetaMatch) return head;
  const rmetaBlock = rmetaMatch[0].trim();
  return head ? `${head}\n${rmetaBlock}` : rmetaBlock;
}

export async function compressPhotoForTracking(
  file: File,
  maxDimension = 1080,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato de imagen no compatible.'));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No se pudo procesar la imagen.'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function readVideoAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el video.'));
    reader.onload = () => {
      const raw = String(reader.result || '');
      const safe = sanitizeMediaUrl(raw, 'video');
      if (!safe) {
        reject(new Error('Formato de video no compatible.'));
        return;
      }
      resolve(safe);
    };
    reader.readAsDataURL(file);
  });
}

export function getEmbedVideoUrl(url: string): string | null {
  const trimmed = (url || '').trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'm.youtube.com'
    ) {
      if (parsed.pathname.startsWith('/shorts/')) {
        const id = parsed.pathname.split('/')[2] || '';
        return YOUTUBE_ID_RE.test(id) ? `https://www.youtube.com/embed/${id}` : null;
      }
      const v = parsed.searchParams.get('v') || '';
      return YOUTUBE_ID_RE.test(v) ? `https://www.youtube.com/embed/${v}` : null;
    }
    if (host === 'youtu.be') {
      const id = parsed.pathname.replace(/^\//, '').split('/')[0] || '';
      return YOUTUBE_ID_RE.test(id) ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === 'drive.google.com') {
      const match = /\/file\/d\/([^/]+)/.exec(parsed.pathname);
      if (match?.[1] && DRIVE_ID_RE.test(match[1])) {
        return `https://drive.google.com/file/d/${match[1]}/preview`;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function createMediaId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
