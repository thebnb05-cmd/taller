import type { RepairRecord } from '../types/workshop';

const BATCH_REGEX = /\[Lote:\s*(LOTE-\d+)(?:\s*·\s*\d+\/\d+)?\]/i;

export function extractBatchRef(notes?: string | null): string | null {
  if (!notes) return null;
  const match = BATCH_REGEX.exec(notes);
  return match ? match[1].toUpperCase() : null;
}

export function generateBatchRef(existingRepairs: RepairRecord[]): string {
  let maxNum = 1000;
  for (const r of existingRepairs) {
    const ref = extractBatchRef(r.notes);
    if (ref) {
      const m = /^LOTE-(\d+)$/i.exec(ref);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxNum) maxNum = n;
      }
    }
  }
  return `LOTE-${maxNum + 1}`;
}

export function appendBatchRefToNotes(
  notes: string,
  batchRef: string,
  index: number,
  total: number
): string {
  const clean = (notes || '').trim();
  const tag = `[Lote: ${batchRef} · ${index}/${total}]`;
  if (!clean) return tag;
  if (BATCH_REGEX.test(clean)) return clean;
  return `${clean}\n${tag}`;
}
