import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://fjkxnvqqmhxfycqbkmqy.supabase.co';

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_ZDUlk1JOyzUt-VpYIcnM2Q_5Vdqyyrz';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type TableName =
  | 'workshop_profiles'
  | 'clients'
  | 'repairs'
  | 'public_tickets'
  | 'products'
  | 'tasks'
  | 'suppliers'
  | 'sales'
  | 'purchases';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface DbErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  userId?: string | null;
}

export async function handleDbError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): Promise<never> {
  const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  const errInfo: DbErrorInfo = {
    error:
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message)
        : String(error),
    operationType,
    path,
    userId: data?.user?.id ?? null,
  };
  console.error('Supabase Error:', JSON.stringify(errInfo));
  throw new Error(errInfo.error || 'Error de base de datos en Supabase.');
}

export function isMissingTableError(error: unknown): boolean {
  const msg =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message)
      : String(error || '');
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('Could not find the table') ||
    msg.includes('does not exist')
  );
}

export function generateDocId(_tableName?: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function toMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (value instanceof Date) return value.getTime();
  return Date.now();
}

export function clampStr(value: string | undefined | null, maxLen: number): string {
  return (value ?? '').trim().slice(0, maxLen);
}

export function stripUndefined<T extends Record<string, unknown>>(
  obj: T,
  keepNull = false
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    if (val === null && !keepNull) continue;
    if (typeof val === 'number' && !Number.isFinite(val)) continue;
    result[key] = val;
  }
  return result;
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

const NUMERIC_FIELDS = new Set([
  'price',
  'deposit',
  'paidAmount',
  'progress',
  'cost',
  'margin',
  'vat',
  'rounding',
  'netPrice',
  'stock',
  'minStock',
  'reorderCap',
  'weight',
  'height',
  'width',
  'depth',
  'balance',
  'amount',
  'quantity',
  'logoScale',
]);

export function toSnakeRecord(obj: Record<string, unknown>, keepNull = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    if (val === null && !keepNull) continue;
    if (typeof val === 'number' && !Number.isFinite(val)) continue;
    out[camelToSnake(key)] = val;
  }
  return out;
}

export function fromDbRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = snakeToCamel(key);
    if (camel === 'createdAt' || camel === 'updatedAt') {
      out[camel] = toMillis(val);
    } else if (NUMERIC_FIELDS.has(camel) && val !== null && val !== undefined && val !== '') {
      const n = Number(val);
      out[camel] = Number.isFinite(n) ? n : val;
    } else if (val !== null) {
      out[camel] = val;
    }
  }
  return out as T;
}

// Local pub/sub so mutations inside this tab update active views immediately
const tableListeners = new Map<TableName, Set<() => void>>();

export function notifyTableChanged(table: TableName): void {
  const set = tableListeners.get(table);
  if (!set) return;
  for (const cb of set) {
    try {
      cb();
    } catch {
      // Ignore individual listener errors
    }
  }
}

export function subscribeTableChanges(table: TableName, callback: () => void): () => void {
  let set = tableListeners.get(table);
  if (!set) {
    set = new Set();
    tableListeners.set(table, set);
  }
  set.add(callback);
  return () => {
    set?.delete(callback);
  };
}

export async function fetchOwnerRows<T>(table: TableName, ownerId: string): Promise<T[]> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('owner_id', ownerId);
  if (error) {
    throw error;
  }
  return (data || []).map((row) => fromDbRow<T>(row as Record<string, unknown>));
}

export async function fetchSingleById<T>(table: TableName, id: string): Promise<T | null> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) return null;
  return fromDbRow<T>(data as Record<string, unknown>);
}

export async function fetchPublicTicketByCode<T>(trackingCode: string): Promise<T | null> {
  const { data, error } = await supabase
    .from('public_tickets')
    .select('*')
    .eq('id', trackingCode)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) return null;
  return fromDbRow<T>(data as Record<string, unknown>);
}

export async function upsertRow(
  table: TableName,
  record: Record<string, unknown>
): Promise<void> {
  const payload = toSnakeRecord(record, false);
  const { error } = await supabase.from(table).upsert(payload, { onConflict: 'id' });
  if (error) {
    await handleDbError(error, OperationType.WRITE, `${table}/${String(record.id ?? '')}`);
  }
  notifyTableChanged(table);
}

export async function insertRows(
  table: TableName,
  records: Array<Record<string, unknown>>
): Promise<void> {
  if (records.length === 0) return;
  const payload = records.map((r) => toSnakeRecord(r, false));
  const { error } = await supabase.from(table).insert(payload);
  if (error) {
    await handleDbError(error, OperationType.CREATE, table);
  }
  notifyTableChanged(table);
}

export async function updateRow(
  table: TableName,
  id: string,
  patch: Record<string, unknown>,
  keepNull = false
): Promise<void> {
  const payload = toSnakeRecord(patch, keepNull);
  const { error } = await supabase.from(table).update(payload).eq('id', id);
  if (error) {
    await handleDbError(error, OperationType.UPDATE, `${table}/${id}`);
  }
  notifyTableChanged(table);
}

export async function deleteRow(table: TableName, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) {
    await handleDbError(error, OperationType.DELETE, `${table}/${id}`);
  }
  notifyTableChanged(table);
}
