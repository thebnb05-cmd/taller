import React, { useCallback, useEffect, useState } from 'react';
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
import { AuthScreen, WorkshopOnboarding } from './components/AuthGate';
import { PublicTrackingView } from './components/PublicTrackingView';
import { ToastProvider } from './components/ToastProvider';
import { WorkshopApp } from './components/WorkshopApp';

function AuthenticatedGate({
  user,
  darkMode,
  onToggleDark,
}: {
  user: User;
  darkMode: boolean;
  onToggleDark: () => void;
}) {
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
    } catch (err) {
      if (isMissingTableError(err)) {
        setMissingSchema(true);
      }
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message)
          : 'Error al cargar el perfil del taller.';
      setErrorMsg(msg);
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
          Cargando taller...
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <div className="max-w-lg space-y-3 rounded-2xl border border-red-200 bg-white p-6 text-sm text-red-700 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-300">
          <div className="font-bold">Error al cargar el perfil del taller</div>
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
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              className="h-9 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
            >
              Cerrar sesión
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
    return localStorage.getItem('th3bnb-theme') === 'dark';
  });

  const [trackingCode, setTrackingCode] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('track');
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('th3bnb-theme', darkMode ? 'dark' : 'light');
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
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
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
          Conectando con el taller...
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
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
