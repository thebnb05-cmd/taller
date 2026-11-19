import { sanitizeImageDataUrl, sanitizePlainLine } from './validation';

const SIG_MARKER = '<!--TH3BNB_SIG:';
const SIG_END = '-->';
const RPAY_RE = /\n?<!--TH3BNB_RPAY:([\s\S]*?)-->/;
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
  const withoutRpay = raw.replace(RPAY_RE, '');
  const idx = withoutRpay.lastIndexOf(SIG_MARKER);
  if (idx === -1) {
    return {
      text: sanitizePlainLine(withoutRpay, 500),
      signatureDataUrl: '',
    };
  }
  const text = sanitizePlainLine(withoutRpay.slice(0, idx), 500);
  const after = withoutRpay.slice(idx + SIG_MARKER.length);
  const endIdx = after.lastIndexOf(SIG_END);
  const sigRaw = (endIdx !== -1 ? after.slice(0, endIdx) : after).trim();
  const signatureDataUrl = sanitizeImageDataUrl(sigRaw, MAX_SIG_DATA_URL_LEN);
  return { text, signatureDataUrl };
}

export function serializeCheckoutAndSignature(
  text: string,
  signatureDataUrl?: string | null,
  existingCheckoutState?: string | null
): string {
  const cleanText = sanitizePlainLine(text, 500)
    .replace(/<!--TH3BNB_SIG:/g, '')
    .replace(/<!--TH3BNB_RPAY:/g, '')
    .replace(/-->/g, '')
    .trim();
  const safeSig = sanitizeImageDataUrl(signatureDataUrl, MAX_SIG_DATA_URL_LEN);
  const head = !safeSig
    ? cleanText
    : cleanText
      ? `${cleanText}\n${SIG_MARKER}${safeSig}${SIG_END}`
      : `${SIG_MARKER}${safeSig}${SIG_END}`;

  const rpayMatch = existingCheckoutState ? RPAY_RE.exec(existingCheckoutState) : null;
  if (!rpayMatch) return head;
  const rpayBlock = rpayMatch[0].trim();
  return head ? `${head}\n${rpayBlock}` : rpayBlock;
}
