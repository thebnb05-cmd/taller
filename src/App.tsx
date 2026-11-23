import React, { Suspense, useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Smartphone } from 'lucide-react';
import {
  fetchSingleById,
  handleDbError,
  isMissingTableError,
  OperationType,
  subscribeTableChanges,
  supabase,
} from './lib/db';
import type { WorkshopProfile } from './types/workshop';
import { getPreferenceCookie, setPreferenceCookie } from './utils/cookieStorage';
import { setActiveCurrency } from './utils/currency';
import { setActiveLanguage, useI18n } from './utils/i18n';
import { resetLoginGuard } from './utils/loginGuard';
import { sanitizeDbErrorMessage } from './utils/validation';
import { parseWorkshopMeta } from './utils/workshopMeta';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ToastProvider';

const AuthScreen = React.lazy(() =>
  import('./components/AuthGate').then((m) => ({ default: m.AuthScreen }))
);
const WorkshopOnboarding = React.lazy(() =>
  import('./components/AuthGate').then((m) => ({ default: m.WorkshopOnboarding }))
);
const PublicTrackingView = React.lazy(() =>
  import('./components/PublicTrackingView').then((m) => ({ default: m.PublicTrackingView }))
);
const WorkshopApp = React.lazy(() =>
  import('./components/WorkshopApp').then((m) => ({ default: m.WorkshopApp }))
);

function RouteLoadingFallback() {
  const { tr } = useI18n();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-slate-950">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0072BB] text-white">
        <Smartphone className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {tr('Cargando módulo...', 'Loading module...', 'Carregando módulo...')}
      </p>
    </div>
  );
}

function AuthenticatedGate({
  user,
  darkMode,
  onToggleDark,
}: {
  user: User;
  darkMode: boolean;
  onToggleDark: () => void;
}) {
  const { tr } = useI18n();
  const [profile, setProfile] = useState<WorkshopProfile | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [missingSchema, setMissingSchema] = useState(false);

  const loadProfile = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsLoading(true);
    setErrorMsg('');
    setMissingSchema(false);
    try {
      const data = await fetchSingleById<WorkshopProfile>('workshop_profiles', user.id);
      setProfile(data ?? undefined);
      if (data) {
        const meta = parseWorkshopMeta(data);
        setActiveCurrency(meta.currency);
        if (meta.hasExplicitLanguage) {
          setActiveLanguage(meta.language);
        }
      }
    } catch (err) {
      if (isMissingTableError(err)) {
        setMissingSchema(true);
      }
      setErrorMsg(sanitizeDbErrorMessage(err, 'Error al cargar el perfil del taller.'));
      try {
        await handleDbError(err, OperationType.GET, `workshop_profiles/${user.id}`);
      } catch {
        // Structured error logged in console
      }
    } finally {
      setIsLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void loadProfile(true);
    const unsubLocal = subscribeTableChanges('workshop_profiles', () => {
      void loadProfile(false);
    });

    const channel = supabase
      .channel(`profile-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workshop_profiles',
          filter: `id=eq.${user.id}`,
        },
        () => {
          void loadProfile(false);
        }
      )
      .subscribe();

    return () => {
      unsubLocal();
      void supabase.removeChannel(channel);
    };
  }, [user.id, loadProfile]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
          {tr('Cargando taller...', 'Loading workshop...', 'Carregando oficina...')}
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <div className="max-w-lg space-y-3 rounded-2xl border border-red-200 bg-white p-6 text-sm text-red-700 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-300">
          <div className="font-bold">
            {tr('Error al cargar el perfil del taller', 'Error loading workshop profile', 'Erro ao carregar o perfil da oficina')}
          </div>
          <p>{errorMsg}</p>
          {missingSchema && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              Las tablas aún no existen en tu proyecto de Supabase. Ejecutá el archivo{' '}
              <code>supabase/schema.sql</code> en el <strong>SQL Editor</strong> de Supabase y luego
              hacé clic en Reintentar.
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void loadProfile(true)}
              className="h-9 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
            >
              {tr('Reintentar', 'Retry', 'Tentar novamente')}
            </button>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              className="h-9 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
            >
              {tr('Cerrar sesión', 'Sign out', 'Sair')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const displayName =
    (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
    null;

  if (!profile) {
    return (
      <WorkshopOnboarding
        userId={user.id}
        userEmail={user.email}
        displayName={displayName}
      />
    );
  }

  return (
    <WorkshopApp
      userId={user.id}
      userEmail={user.email}
      profile={profile}
      darkMode={darkMode}
      onToggleDark={onToggleDark}
    />
  );
}

function AppContent() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const fromCookie = getPreferenceCookie('th3bnb_theme');
    if (fromCookie === 'dark' || fromCookie === 'light') {
      return fromCookie === 'dark';
    }
    try {
      return localStorage.getItem('th3bnb-theme') === 'dark';
    } catch {
      return false;
    }
  });

  const [trackingCode, setTrackingCode] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('track');
    if (raw === null) return null;
    return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    const themeVal = darkMode ? 'dark' : 'light';
    setPreferenceCookie('th3bnb_theme', themeVal);
    try {
      localStorage.setItem('th3bnb-theme', themeVal);
    } catch {
      // Ignore storage restrictions
    }
  }, [darkMode]);

  if (trackingCode !== null) {
    return (
      <PublicTrackingView
        initialCode={trackingCode}
        onExitTracking={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('track');
          window.history.replaceState({}, '', url.toString());
          setTrackingCode(null);
        }}
      />
    );
  }

  return (
    <AuthRouter
      darkMode={darkMode}
      onToggleDark={() => setDarkMode((d) => !d)}
      onOpenTracking={() => setTrackingCode('')}
    />
  );
}

function AuthRouter({
  darkMode,
  onToggleDark,
  onOpenTracking,
}: {
  darkMode: boolean;
  onToggleDark: () => void;
  onOpenTracking: () => void;
}) {
  const { tr } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setUser(data.session?.user ?? null);
        setAuthReady(true);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setAuthReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'SIGNED_IN' && session?.user?.email) {
        void resetLoginGuard(session.user.email, session.access_token);
      }
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  if (!authReady) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-slate-950">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0072BB] text-white">
          <Smartphone className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          {tr('Conectando con el taller...', 'Connecting to workshop...', 'Conectando à oficina...')}
        </p>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onOpenTrackingLookup={onOpenTracking} />;
  }

  return (
    <AuthenticatedGate user={user} darkMode={darkMode} onToggleDark={onToggleDark} />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <Suspense fallback={<RouteLoadingFallback />}>
          <AppContent />
        </Suspense>
      </ToastProvider>
    </ErrorBoundary>
  );
}
