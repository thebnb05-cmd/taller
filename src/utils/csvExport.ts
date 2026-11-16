import { sanitizeCsvCell } from './validation';

export type CsvCellValue = string | number | boolean | null | undefined;

function escapeCsvField(raw: CsvCellValue): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return '0';
    return String(Math.round(raw * 100) / 100);
  }
  if (typeof raw === 'boolean') {
    return raw ? 'Sí' : 'No';
  }
  const safe = sanitizeCsvCell(raw);
  if (!safe) return '';
  if (/[",\n\r;]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function buildCsvContent(
  headers: string[],
  rows: CsvCellValue[][]
): string {
  const headerLine = headers.map((h) => escapeCsvField(h)).join(',');
  const bodyLines = rows.map((row) => row.map((cell) => escapeCsvField(cell)).join(','));
  // Prepend UTF-8 BOM so Excel and accounting tools open accents cleanly
  return `\uFEFF${[headerLine, ...bodyLines].join('\r\n')}`;
}

export function downloadCsvFile(
  fileName: string,
  headers: string[],
  rows: CsvCellValue[][]
): void {
  const csv = buildCsvContent(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName.endsWith('.csv') ? fileName : `${fileName}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
