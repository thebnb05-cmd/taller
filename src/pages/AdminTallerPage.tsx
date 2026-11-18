import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Boxes,
  Check,
  Copy,
  Download,
  Laptop,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Tablet,
  Users,
  Wrench,
} from 'lucide-react';
import { supabase } from '../lib/db';

interface AdminOverviewSummary {
  totalUsers: number;
  confirmedUsers: number;
  configuredWorkshops: number;
  activeToday: number;
  active7d: number;
  active30d: number;
  totalInstalls: number;
  installsByPlatform: {
    android: number;
    ios: number;
    desktop: number;
    other: number;
  };
  totalRepairs: number;
  totalClients: number;
  totalSales: number;
  totalProducts: number;
}

interface AdminWorkshopRow {
  userId: string;
  email: string;
  provider: string;
  confirmed: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  workshopName: string;
  ownerFullName: string;
  phone: string;
  repairsCount: number;
  clientsCount: number;
  salesCount: number;
  productsCount: number;
  installedPlatforms: string[];
  isPlatformAdmin: boolean;
}

interface AdminRecentInstallRow {
  deviceId: string;
  platform: string;
  installSource: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  linkedEmail: string | null;
}

interface AdminOverviewPayload {
  ok: boolean;
  serviceRoleConfigured?: boolean;
  installsTableReady?: boolean;
  generatedAt?: string;
  error?: string;
  summary?: AdminOverviewSummary;
  workshops?: AdminWorkshopRow[];
  recentInstalls?: AdminRecentInstallRow[];
}

interface AdminTallerPageProps {
  userEmail?: string | null;
}

const APP_INSTALLS_SQL = `create table if not exists public.app_installs (
  device_id text primary key,
  user_id uuid references auth.users(id) on delete set null,
  platform text not null default 'other',
  install_source text not null default 'standalone',
  user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_app_installs_last_seen on public.app_installs(last_seen_at desc);
create index if not exists idx_app_installs_platform on public.app_installs(platform);

alter table public.app_installs enable row level security;
revoke all on table public.app_installs from anon, public, authenticated;`;

type WorkshopFilter = 'all' | 'configured' | 'installed' | 'active7d';

function formatDateTimeShort(iso: string | null): string {
  if (!iso) return 'Nunca';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function formatRelativeDays(iso: string | null): string {
  if (!iso) return 'Sin ingresos';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return 'Sin ingresos';
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `Hace ${diffDays} d`;
}

function formatPlatformLabel(platform: string): string {
  if (platform === 'android') return 'Android';
  if (platform === 'ios') return 'iPhone / iPad';
  if (platform === 'desktop') return 'PC';
  return 'Otro';
}

export const AdminTallerPage: React.FC<AdminTallerPageProps> = ({ userEmail }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminOverviewPayload | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<WorkshopFilter>('all');
  const [copiedSql, setCopiedSql] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setError('Sesión vencida. Volvé a iniciar sesión para ver los datos.');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/admin/overview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });

      const payload = (await res.json().catch(() => ({}))) as AdminOverviewPayload;
      if (!res.ok || !payload.ok) {
        setError(payload.error || `No se pudieron cargar los datos (HTTP ${res.status}).`);
        setLoading(false);
        return;
      }

      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red al consultar el servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(APP_INSTALLS_SQL);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 2200);
    } catch {
      setCopiedSql(false);
    }
  };

  const workshops = data?.workshops || [];
  const summary = data?.summary;
  const recentInstalls = data?.recentInstalls || [];

  const filteredWorkshops = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    return workshops.filter((w) => {
      if (filter === 'configured' && w.workshopName === 'Sin configurar') return false;
      if (filter === 'installed' && w.installedPlatforms.length === 0) return false;
      if (filter === 'active7d') {
        const lastMs = w.lastSignInAt ? Date.parse(w.lastSignInAt) : 0;
        if (!lastMs || now - lastMs > sevenDaysMs) return false;
      }
      if (!q) return true;
      return (
        w.email.toLowerCase().includes(q) ||
        w.workshopName.toLowerCase().includes(q) ||
        w.ownerFullName.toLowerCase().includes(q) ||
        w.phone.toLowerCase().includes(q)
      );
    });
  }, [workshops, search, filter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#0072BB] dark:text-sky-400" />
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Admin de taller
            </h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Vista privada exclusiva para {userEmail || 'tu cuenta'}. Otros talleres no ven esta sección.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {data?.generatedAt && (
            <span className="font-mono-num text-xs text-slate-400">
              Actualizado {formatDateTimeShort(data.generatedAt)}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* Guía de activación si falta SUPABASE_SERVICE_ROLE_KEY */}
      {!loading && data && !data.serviceRoleConfigured && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 dark:border-amber-900/60 dark:bg-amber-950/25">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-2 text-sm text-amber-950 dark:text-amber-100">
              <div className="font-semibold">
                Falta conectar la clave privada del servidor para ver usuarios e instalaciones reales
              </div>
              <p className="text-xs leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                Por seguridad, la lista completa de cuentas e instalaciones solo puede consultarse desde el servidor. Seguí estos 3 pasos una sola vez:
              </p>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-amber-900 dark:text-amber-200">
                <li>
                  En Supabase → <span className="font-semibold">Project Settings → API Keys</span>, copiá tu clave privada:{' '}
                  en la pestaña <span className="font-semibold">Publishable and secret API keys</span> usá{' '}
                  <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-amber-900/60">
                    Secret keys
                  </code>{' '}
                  (<code className="font-mono text-[11px]">sb_secret_...</code>) o en{' '}
                  <span className="font-semibold">Legacy anon, service_role API keys</span> tocá Reveal en{' '}
                  <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-amber-900/60">
                    service_role
                  </code>{' '}
                  (nunca la pongas con prefijo <code className="font-mono text-[11px]">VITE_</code>).
                </li>
                <li>
                  En Vercel → <span className="font-semibold">Settings → Environment Variables</span>, agregá{' '}
                  <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-amber-900/60">
                    SUPABASE_SERVICE_ROLE_KEY
                  </code>{' '}
                  y pegá esa clave.
                </li>
                <li>
                  Ejecutá el SQL de la tabla <code className="font-mono text-[11px]">app_installs</code> en Supabase y hacé{' '}
                  <span className="font-semibold">Redeploy</span> en Vercel.
                </li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Aviso si falta crear la tabla app_installs en Supabase */}
      {!loading && data?.serviceRoleConfigured && !data.installsTableReady && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-5 dark:border-sky-900/60 dark:bg-sky-950/25">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-sky-950 dark:text-sky-100">
                <Download className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
                Falta crear la tabla de instalaciones de la app en Supabase
              </div>
              <p className="text-xs text-sky-900/85 dark:text-sky-200/85">
                Los usuarios registrados ya se ven abajo. Para empezar a contar descargas en Android, iPhone y PC, pegá este bloque en Supabase → SQL Editor y tocá Run.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleCopySql()}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white transition hover:bg-[#005f9c]"
            >
              {copiedSql ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedSql ? 'SQL copiado' : 'Copiar SQL'}
            </button>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-xl border border-sky-200/80 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:border-sky-900/60 dark:bg-slate-950 dark:text-slate-200">
            {APP_INSTALLS_SQL}
          </pre>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            />
          ))}
        </div>
      )}

      {/* KPIs principales */}
      {summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Usuarios registrados
                </span>
                <Users className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
              </div>
              <div className="mt-2 font-mono-num text-3xl font-bold text-slate-900 dark:text-white">
                {summary.totalUsers}
              </div>
              <div className="mt-1.5 font-mono-num text-xs text-slate-500 dark:text-slate-400">
                {summary.confirmedUsers} confirmados · {summary.configuredWorkshops} talleres armados
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Talleres activos
                </span>
                <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="mt-2 font-mono-num text-3xl font-bold text-slate-900 dark:text-white">
                {summary.active7d}
              </div>
              <div className="mt-1.5 font-mono-num text-xs text-slate-500 dark:text-slate-400">
                Hoy: {summary.activeToday} · Últimos 30d: {summary.active30d}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  App instalada (dispositivos)
                </span>
                <Download className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div className="mt-2 font-mono-num text-3xl font-bold text-slate-900 dark:text-white">
                {data?.installsTableReady ? summary.totalInstalls : '—'}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono-num text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <Smartphone className="h-3 w-3" /> Android {summary.installsByPlatform.android}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Tablet className="h-3 w-3" /> iOS {summary.installsByPlatform.ios}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Laptop className="h-3 w-3" /> PC {summary.installsByPlatform.desktop}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Actividad en plataforma
                </span>
                <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="mt-2 font-mono-num text-3xl font-bold text-slate-900 dark:text-white">
                {summary.totalRepairs}
              </div>
              <div className="mt-1.5 font-mono-num text-xs text-slate-500 dark:text-slate-400">
                Órdenes · {summary.totalClients} clientes · {summary.totalSales} ventas
              </div>
            </div>
          </div>

          {/* Totales secundarios compactos */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <Wrench className="h-4 w-4 shrink-0 text-[#0072BB] dark:text-sky-400" />
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Reparaciones</div>
                <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {summary.totalRepairs}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <Users className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Clientes guardados</div>
                <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {summary.totalClients}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <ShoppingBag className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Ventas registradas</div>
                <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {summary.totalSales}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <Boxes className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Productos cargados</div>
                <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {summary.totalProducts}
                </div>
              </div>
            </div>
          </div>

          {/* Tabla de usuarios y talleres */}
          <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Usuarios y talleres registrados
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Mostrando <span className="font-mono-num font-semibold">{filteredWorkshops.length}</span> de{' '}
                  <span className="font-mono-num">{workshops.length}</span> cuentas
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar correo, taller o nombre..."
                    className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#0072BB] focus:bg-white focus:outline-none sm:w-64 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-sky-400 dark:focus:bg-slate-900"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
              {[
                { id: 'all' as WorkshopFilter, label: 'Todos' },
                { id: 'configured' as WorkshopFilter, label: 'Con taller armado' },
                { id: 'active7d' as WorkshopFilter, label: 'Activos últimos 7d' },
                { id: 'installed' as WorkshopFilter, label: 'Con app instalada' },
              ].map((tab) => {
                const active = filter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    className={`h-8 shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${
                      active
                        ? 'bg-[#0072BB] text-white'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {filteredWorkshops.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No hay cuentas que coincidan con ese filtro.
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                        <th className="px-4 py-3">Taller / Responsable</th>
                        <th className="px-4 py-3">Correo y acceso</th>
                        <th className="px-4 py-3">Registro</th>
                        <th className="px-4 py-3">Último ingreso</th>
                        <th className="px-4 py-3 text-right">Órdenes</th>
                        <th className="px-4 py-3 text-right">Clientes</th>
                        <th className="px-4 py-3 text-right">Ventas</th>
                        <th className="px-4 py-3">App instalada</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredWorkshops.map((w) => (
                        <tr
                          key={w.userId}
                          className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                        >
                          <td className="px-4 py-3 align-top">
                            <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                              <span>{w.workshopName}</span>
                              {w.isPlatformAdmin && (
                                <span className="text-[10px] font-bold text-[#0072BB] dark:text-sky-400">
                                  · Admin
                                </span>
                              )}
                            </div>
                            {(w.ownerFullName || w.phone) && (
                              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {[w.ownerFullName, w.phone].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-slate-800 dark:text-slate-200">
                              {w.email || 'Sin correo'}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                              {w.provider === 'google' ? 'Google' : 'Correo'} ·{' '}
                              <span
                                className={
                                  w.confirmed
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-amber-600 dark:text-amber-400'
                                }
                              >
                                {w.confirmed ? 'Verificado' : 'Pendiente'}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top font-mono-num text-slate-600 dark:text-slate-300">
                            {formatDateTimeShort(w.createdAt)}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="font-mono-num text-slate-800 dark:text-slate-200">
                              {formatRelativeDays(w.lastSignInAt)}
                            </div>
                            <div className="font-mono-num text-[11px] text-slate-400">
                              {formatDateTimeShort(w.lastSignInAt)}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top text-right font-mono-num font-semibold text-slate-900 dark:text-white">
                            {w.repairsCount}
                          </td>
                          <td className="px-4 py-3 align-top text-right font-mono-num text-slate-700 dark:text-slate-300">
                            {w.clientsCount}
                          </td>
                          <td className="px-4 py-3 align-top text-right font-mono-num text-slate-700 dark:text-slate-300">
                            {w.salesCount}
                          </td>
                          <td className="px-4 py-3 align-top text-slate-600 dark:text-slate-300">
                            {w.installedPlatforms.length > 0
                              ? w.installedPlatforms.map(formatPlatformLabel).join(', ')
                              : 'Web navegador'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
                  {filteredWorkshops.map((w) => (
                    <div key={w.userId} className="space-y-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                            {w.workshopName}
                            {w.isPlatformAdmin && (
                              <span className="ml-1.5 text-[11px] font-bold text-[#0072BB] dark:text-sky-400">
                                · Admin
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-slate-600 dark:text-slate-300">
                            {w.email}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 text-[11px] font-semibold ${
                            w.confirmed
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {w.confirmed ? 'Verificado' : 'Pendiente'}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                        <span>Último ingreso: {formatRelativeDays(w.lastSignInAt)}</span>
                        <span>Órdenes: {w.repairsCount}</span>
                        <span>Clientes: {w.clientsCount}</span>
                        <span>Ventas: {w.salesCount}</span>
                        <span>
                          App:{' '}
                          {w.installedPlatforms.length > 0
                            ? w.installedPlatforms.map(formatPlatformLabel).join(', ')
                            : 'Web'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Dispositivos con app instalada recientes */}
          {data?.installsTableReady && recentInstalls.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-100 p-4 dark:border-slate-800">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Instalaciones recientes de la app
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Dispositivos únicos que instalaron o abrieron la aplicación en pantalla completa (incluso antes de iniciar sesión).
                </p>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {recentInstalls.map((inst) => (
                  <div
                    key={inst.deviceId}
                    className="flex flex-col gap-1 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {formatPlatformLabel(inst.platform)}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600 dark:text-slate-300">
                        {inst.linkedEmail || 'Sin cuenta vinculada aún'}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono-num text-[11px] text-slate-400">
                        {inst.installSource === 'appinstalled' ? 'Instalación nueva' : 'Uso en app instalada'}
                      </span>
                    </div>
                    <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                      Última vez: {formatDateTimeShort(inst.lastSeenAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
