import { createClient } from '@supabase/supabase-js';
import { createHardenedAuthStorage } from '../utils/cookieStorage';
import { decryptRecordFields, encryptRecordFields } from '../utils/crypto';
import {
  isSafeId,
  sanitizeDbErrorMessage,
  stripPrototypeKeys,
} from '../utils/validation';

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
    storage: typeof window !== 'undefined' ? createHardenedAuthStorage() : undefined,
    storageKey: 'th3bnb-auth-session',
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

const TRACKING_CODE_RE = /^[a-zA-Z0-9_-]{1,40}$/;

async function getAuthenticatedOwnerId(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user?.id) return data.session.user.id;
    const { data: userData } = await supabase.auth.getUser();
    return userData?.user?.id ?? '';
  } catch {
    return '';
  }
}

export async function handleDbError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): Promise<never> {
  const userId = await getAuthenticatedOwnerId().catch(() => '');
  const safeMsg = sanitizeDbErrorMessage(
    error,
    'No se pudo completar la operación en la base de datos.'
  );
  const errInfo: DbErrorInfo = {
    error: safeMsg,
    operationType,
    path,
    userId: userId || null,
  };
  console.error('Supabase Error:', JSON.stringify(errInfo));
  throw new Error(safeMsg);
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
  return (value ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLen);
}

export function stripUndefined<T extends Record<string, unknown>>(
  obj: T,
  keepNull = false
): Record<string, unknown> {
  const cleanSource = stripPrototypeKeys(obj);
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(cleanSource)) {
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
  const cleanSource = stripPrototypeKeys(obj);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(cleanSource)) {
    if (val === undefined) continue;
    if (val === null && !keepNull) continue;
    if (typeof val === 'number' && !Number.isFinite(val)) continue;
    out[camelToSnake(key)] = val;
  }
  return out;
}

export function fromDbRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(stripPrototypeKeys(row))) {
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

const VALID_TABLES: ReadonlySet<TableName> = new Set<TableName>([
  'workshop_profiles',
  'clients',
  'repairs',
  'public_tickets',
  'products',
  'tasks',
  'suppliers',
  'sales',
  'purchases',
]);

function assertValidTable(table: TableName): void {
  if (!VALID_TABLES.has(table)) {
    throw new Error('Operación de tabla no permitida.');
  }
}

async function requireAuthenticatedOwnerId(
  operationType: OperationType,
  path: string
): Promise<string> {
  const authOwnerId = await getAuthenticatedOwnerId();
  if (!authOwnerId || !isSafeId(authOwnerId)) {
    await handleDbError(new Error('permission denied'), operationType, path);
  }
  return authOwnerId;
}

export async function fetchOwnerRows<T>(table: TableName, ownerId: string): Promise<T[]> {
  assertValidTable(table);
  if (!isSafeId(ownerId)) {
    throw new Error('Identificador de sesión inválido.');
  }
  const authOwnerId = await requireAuthenticatedOwnerId(OperationType.LIST, table);
  if (ownerId !== authOwnerId) {
    await handleDbError(new Error('permission denied'), OperationType.LIST, table);
  }
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('owner_id', authOwnerId);
  if (error) {
    throw error;
  }
  const rows = (data || []).map((row) =>
    fromDbRow<Record<string, unknown>>(row as Record<string, unknown>)
  );
  const decrypted = await Promise.all(
    rows.map((row) => decryptRecordFields<Record<string, unknown>>(table, row, authOwnerId))
  );
  return decrypted as unknown as T[];
}

export async function fetchSingleById<T>(table: TableName, id: string): Promise<T | null> {
  assertValidTable(table);
  if (!isSafeId(id)) return null;
  if (table === 'public_tickets') {
    return fetchPublicTicketByCode<T>(id);
  }
  const authOwnerId = await requireAuthenticatedOwnerId(OperationType.GET, `${table}/${id}`);
  if (table === 'workshop_profiles' && id !== authOwnerId) {
    await handleDbError(new Error('permission denied'), OperationType.GET, `${table}/${id}`);
  }
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('id', id)
    .eq('owner_id', authOwnerId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) return null;
  const mapped = fromDbRow<Record<string, unknown>>(data as Record<string, unknown>);
  const decrypted = await decryptRecordFields<Record<string, unknown>>(table, mapped, authOwnerId);
  return decrypted as unknown as T;
}

export async function fetchPublicTicketByCode<T>(trackingCode: string): Promise<T | null> {
  const cleaned = (trackingCode || '').trim().toUpperCase();
  if (!TRACKING_CODE_RE.test(cleaned)) return null;

  const rpcRes = await supabase
    .rpc('get_public_ticket_by_code', { p_tracking_code: cleaned })
    .maybeSingle();

  if (!rpcRes.error) {
    if (!rpcRes.data) return null;
    return fromDbRow<T>(rpcRes.data as Record<string, unknown>);
  }

  const code = String((rpcRes.error as { code?: unknown }).code || '');
  const msg = String(rpcRes.error.message || '');
  const isMissingRpc =
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('Could not find the function') ||
    msg.includes('does not exist');

  if (!isMissingRpc) {
    throw rpcRes.error;
  }

  const { data, error } = await supabase
    .from('public_tickets')
    .select(
      'id, repair_id, tracking_code, repair_code, business_name, business_phone, device_type, brand, model, status, progress, date_in, date_est, problem_summary, work_detail, price, deposit, updated_at'
    )
    .eq('id', cleaned)
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
  assertValidTable(table);
  const authOwnerId = await requireAuthenticatedOwnerId(OperationType.WRITE, table);
  if (typeof record.ownerId === 'string' && record.ownerId && record.ownerId !== authOwnerId) {
    await handleDbError(new Error('permission denied'), OperationType.WRITE, table);
  }
  if (typeof record.owner_id === 'string' && record.owner_id && record.owner_id !== authOwnerId) {
    await handleDbError(new Error('permission denied'), OperationType.WRITE, table);
  }
  if (record.id !== undefined && !isSafeId(record.id)) {
    await handleDbError(new Error('invalid input syntax'), OperationType.WRITE, table);
  }
  if (table === 'workshop_profiles' && record.id !== undefined && record.id !== authOwnerId) {
    await handleDbError(new Error('permission denied'), OperationType.WRITE, table);
  }
  const scopedRecord: Record<string, unknown> = {
    ...stripPrototypeKeys(record),
    ownerId: authOwnerId,
  };
  delete scopedRecord.owner_id;
  const prepared = await encryptRecordFields(table, scopedRecord, authOwnerId);
  const payload = toSnakeRecord(prepared, false);
  payload.owner_id = authOwnerId;
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
  assertValidTable(table);
  if (records.length === 0) return;
  const authOwnerId = await requireAuthenticatedOwnerId(OperationType.CREATE, table);
  const payload = await Promise.all(
    records.map(async (r) => {
      if (typeof r.ownerId === 'string' && r.ownerId && r.ownerId !== authOwnerId) {
        throw new Error('permission denied');
      }
      if (typeof r.owner_id === 'string' && r.owner_id && r.owner_id !== authOwnerId) {
        throw new Error('permission denied');
      }
      if (r.id !== undefined && !isSafeId(r.id)) {
        throw new Error('invalid input syntax');
      }
      if (table === 'workshop_profiles' && r.id !== undefined && r.id !== authOwnerId) {
        throw new Error('permission denied');
      }
      const scopedRecord: Record<string, unknown> = {
        ...stripPrototypeKeys(r),
        ownerId: authOwnerId,
      };
      delete scopedRecord.owner_id;
      const prepared = await encryptRecordFields(table, scopedRecord, authOwnerId);
      const snake = toSnakeRecord(prepared, false);
      snake.owner_id = authOwnerId;
      return snake;
    })
  );
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
  assertValidTable(table);
  if (!isSafeId(id)) {
    await handleDbError(new Error('invalid input syntax'), OperationType.UPDATE, table);
  }
  const authOwnerId = await requireAuthenticatedOwnerId(OperationType.UPDATE, `${table}/${id}`);
  if (table === 'workshop_profiles' && id !== authOwnerId) {
    await handleDbError(new Error('permission denied'), OperationType.UPDATE, `${table}/${id}`);
  }
  const cleanPatch = stripPrototypeKeys(patch);
  // Prevent client-side id / owner_id hijacking on update
  delete cleanPatch.id;
  delete cleanPatch.ownerId;
  delete cleanPatch.owner_id;

  const prepared = await encryptRecordFields(table, cleanPatch, authOwnerId);
  const payload = toSnakeRecord(prepared, keepNull);
  delete payload.id;
  delete payload.owner_id;

  const { error } = await supabase
    .from(table)
    .update(payload)
    .eq('id', id)
    .eq('owner_id', authOwnerId);
  if (error) {
    await handleDbError(error, OperationType.UPDATE, `${table}/${id}`);
  }
  notifyTableChanged(table);
}

export async function deleteRow(table: TableName, id: string): Promise<void> {
  assertValidTable(table);
  if (!isSafeId(id)) {
    await handleDbError(new Error('invalid input syntax'), OperationType.DELETE, table);
  }
  const authOwnerId = await requireAuthenticatedOwnerId(OperationType.DELETE, `${table}/${id}`);
  if (table === 'workshop_profiles' && id !== authOwnerId) {
    await handleDbError(new Error('permission denied'), OperationType.DELETE, `${table}/${id}`);
  }
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('id', id)
    .eq('owner_id', authOwnerId);
  if (error) {
    await handleDbError(error, OperationType.DELETE, `${table}/${id}`);
  }
  notifyTableChanged(table);
}


