export interface TechMediaItem {
  id: string;
  type: 'image' | 'video';
  url: string;
  caption?: string;
  createdAt: number;
}

const MEDIA_MARKER = '\n<!--TH3BNB_MEDIA:';
const MEDIA_END = '-->';

export const MAX_INLINE_VIDEO_BYTES = 6 * 1024 * 1024; // 6 MB

export function parseWorkDetailAndMedia(raw?: string | null): {
  text: string;
  media: TechMediaItem[];
} {
  if (!raw) return { text: '', media: [] };
  const idx = raw.indexOf(MEDIA_MARKER);
  if (idx === -1) {
    return { text: raw, media: [] };
  }
  const text = raw.slice(0, idx).trim();
  const after = raw.slice(idx + MEDIA_MARKER.length);
  const endIdx = after.lastIndexOf(MEDIA_END);
  const jsonPart = endIdx !== -1 ? after.slice(0, endIdx) : after;
  try {
    const parsed = JSON.parse(jsonPart);
    if (Array.isArray(parsed)) {
      const media: TechMediaItem[] = parsed.filter(
        (item): item is TechMediaItem =>
          Boolean(item) &&
          typeof item === 'object' &&
          (item.type === 'image' || item.type === 'video') &&
          typeof item.url === 'string' &&
          item.url.length > 0
      );
      return { text, media };
    }
  } catch {
    // Fallback to raw text if marker payload is malformed
  }
  return { text, media: [] };
}

export function serializeWorkDetailAndMedia(
  text: string,
  media: TechMediaItem[]
): string {
  const cleanText = text.trim().slice(0, 2000);
  if (!media || media.length === 0) {
    return cleanText;
  }
  const compactMedia = media.map((item) => ({
    id: item.id,
    type: item.type,
    url: item.url,
    caption: item.caption ? item.caption.trim().slice(0, 160) : undefined,
    createdAt: item.createdAt || Date.now(),
  }));
  return `${cleanText}${MEDIA_MARKER}${JSON.stringify(compactMedia)}${MEDIA_END}`;
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
          resolve(String(reader.result));
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
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function getEmbedVideoUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube.com')) {
      if (parsed.pathname.startsWith('/shorts/')) {
        const id = parsed.pathname.split('/')[2];
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      const v = parsed.searchParams.get('v');
      return v ? `https://www.youtube.com/embed/${v}` : null;
    }
    if (host === 'youtu.be') {
      const id = parsed.pathname.replace(/^\//, '');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host.includes('drive.google.com')) {
      const match = /\/file\/d\/([^/]+)/.exec(parsed.pathname);
      if (match?.[1]) {
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
