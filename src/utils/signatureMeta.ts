import { sanitizeImageDataUrl, sanitizePlainLine } from './validation';

const SIG_MARKER = '<!--TH3BNB_SIG:';
const SIG_END = '-->';
const MAX_SIG_DATA_URL_LEN = 350_000;

export interface ParsedCheckoutSignature {
  text: string;
  signatureDataUrl: string;
}

export function parseCheckoutAndSignature(
  raw?: string | null
): ParsedCheckoutSignature {
  if (!raw || typeof raw !== 'string') {
    return { text: '', signatureDataUrl: '' };
  }
  const idx = raw.lastIndexOf(SIG_MARKER);
  if (idx === -1) {
    return {
      text: sanitizePlainLine(raw, 500),
      signatureDataUrl: '',
    };
  }
  const text = sanitizePlainLine(raw.slice(0, idx), 500);
  const after = raw.slice(idx + SIG_MARKER.length);
  const endIdx = after.lastIndexOf(SIG_END);
  const sigRaw = (endIdx !== -1 ? after.slice(0, endIdx) : after).trim();
  const signatureDataUrl = sanitizeImageDataUrl(sigRaw, MAX_SIG_DATA_URL_LEN);
  return { text, signatureDataUrl };
}

export function serializeCheckoutAndSignature(
  text: string,
  signatureDataUrl?: string | null
): string {
  const cleanText = sanitizePlainLine(text, 500)
    .replace(/<!--TH3BNB_SIG:/g, '')
    .replace(/-->/g, '')
    .trim();
  const safeSig = sanitizeImageDataUrl(signatureDataUrl, MAX_SIG_DATA_URL_LEN);
  if (!safeSig) {
    return cleanText;
  }
  return cleanText
    ? `${cleanText}\n${SIG_MARKER}${safeSig}${SIG_END}`
    : `${SIG_MARKER}${safeSig}${SIG_END}`;
}
