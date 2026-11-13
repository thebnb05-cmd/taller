import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { Smartphone } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType, toMillis } from './lib/db';
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

  useEffect(() => {
    setIsLoading(true);
    setErrorMsg('');
    const path = `workshopProfiles/${user.uid}`;
    const unsubscribe = onSnapshot(
      doc(db, 'workshopProfiles', user.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setProfile({
            ...(data as Omit<WorkshopProfile, 'id' | 'createdAt' | 'updatedAt'>),
            id: snap.id,
            createdAt: toMillis(data.createdAt),
            updatedAt: toMillis(data.updatedAt),
          });
        } else {
          setProfile(undefined);
        }
        setIsLoading(false);
      },
      (err) => {
        setIsLoading(false);
        setErrorMsg(err.message || 'Error al cargar el perfil del taller.');
        try {
          handleFirestoreError(err, OperationType.GET, path);
        } catch {
          // Structured error logged in console
        }
      }
    );

    return () => unsubscribe();
  }, [user.uid]);

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
        <div className="max-w-md rounded-2xl border border-red-200 bg-white p-6 text-sm text-red-700 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-300">
          Error al cargar el perfil del taller: {errorMsg}
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <WorkshopOnboarding
        userId={user.uid}
        userEmail={user.email}
        displayName={user.displayName}
      />
    );
  }

  return (
    <WorkshopApp
      userId={user.uid}
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
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
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
