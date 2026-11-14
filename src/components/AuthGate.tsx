import React, { useState } from 'react';
import { Building2, LogIn, Mail, ShieldCheck, Smartphone, Upload } from 'lucide-react';
import {
  clampStr,
  handleDbError,
  OperationType,
  stripUndefined,
  supabase,
  upsertRow,
} from '../lib/db';
import { DEFAULT_RECEIPT_TERMS } from '../data/catalog';
import { compressImageToDataUrl } from '../utils/formatters';
import { isPrivatePreviewOrigin } from '../utils/tracking';
import { useToast } from './ToastProvider';

interface AuthScreenProps {
  onOpenTrackingLookup?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onOpenTrackingLookup }) => {
  const { notify } = useToast();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const handleGoogleAuth = async () => {
    setErrorMsg('');
    setInfoMsg('');
    if (typeof window !== 'undefined' && window.self !== window.top) {
      setErrorMsg(
        'Google bloquea su pantalla de acceso dentro de la vista previa integrada. Usá tu correo y contraseña acá, o probá el botón de Google desde tu web publicada en Vercel / app instalada.'
      );
      return;
    }
    setGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message)
          : 'No se pudo iniciar sesión con Google.';
      if (msg.toLowerCase().includes('provider is not enabled')) {
        setErrorMsg(
          'Falta activar Google en tu panel de Supabase (Authentication → Providers → Google).'
        );
      } else {
        setErrorMsg(msg);
      }
      setGoogleLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMsg('Completá tu correo electrónico y contraseña.');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        notify('Sesión iniciada correctamente.');
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        if (data.session) {
          notify('Cuenta creada e iniciada correctamente.');
        } else {
          setInfoMsg(
            'Cuenta creada. Revisá tu correo electrónico para confirmar la cuenta y luego iniciá sesión.'
          );
          setMode('login');
        }
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message)
          : 'No se pudo iniciar sesión.';
      if (msg.toLowerCase().includes('invalid login credentials')) {
        setErrorMsg('Correo o contraseña incorrectos.');
      } else if (msg.toLowerCase().includes('email not confirmed')) {
        setErrorMsg('Tu correo todavía no está confirmado. Revisá tu bandeja de entrada.');
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:grid-cols-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col justify-between bg-slate-900 p-8 text-white sm:p-10 dark:bg-slate-950">
          <div>
            <div className="inline-flex items-center gap-2.5 text-xl font-extrabold tracking-tight font-display">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0072BB] text-white">
                <Smartphone className="h-5 w-5" />
              </span>
              <span>
                TH3 <span className="text-sky-400">BNB</span>
              </span>
            </div>
            <h1 className="mt-8 text-3xl font-bold leading-tight tracking-tight text-balance font-display">
              Gestión integral para tu servicio técnico
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              Administrá órdenes de reparación, check-in de equipos, clientes, repuestos, inventario,
              ventas y boletas en tiempo real desde cualquier dispositivo.
            </p>
          </div>

          <div className="mt-8 space-y-3 border-t border-slate-800 pt-6 text-xs text-slate-300">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 shrink-0 text-sky-400" />
              <span>Acceso seguro por cuenta con Supabase Auth y políticas RLS</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Building2 className="h-4 w-4 shrink-0 text-sky-400" />
              <span>Base de datos PostgreSQL en Supabase entre PC, tablet y celular</span>
            </div>
            {onOpenTrackingLookup && (
              <button
                type="button"
                onClick={onOpenTrackingLookup}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 hover:underline"
              >
                ¿Sos cliente? Consultar estado de reparación
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col justify-center p-8 sm:p-10">
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white font-display">
                {mode === 'login' ? 'Ingresar al sistema' : 'Crear cuenta de taller'}
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {mode === 'login'
                  ? 'Ingresá con tu correo y contraseña para acceder a tu taller.'
                  : 'Registrate con tu correo para crear un nuevo taller en Supabase.'}
              </p>
            </div>

            <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg('');
                }}
                className={`h-9 rounded-lg text-xs font-semibold transition ${
                  mode === 'login'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Iniciar sesión
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setErrorMsg('');
                }}
                className={`h-9 rounded-lg text-xs font-semibold transition ${
                  mode === 'signup'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Crear cuenta
              </button>
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                {errorMsg}
              </div>
            )}

            {infoMsg && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200">
                {infoMsg}
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleGoogleAuth()}
              disabled={loading || googleLoading}
              className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-2xs transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              <span>{googleLoading ? 'Redirigiendo a Google...' : 'Continuar con Google'}</span>
            </button>

            <div className="relative flex items-center py-0.5">
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              <span className="mx-3 shrink-0 text-[11px] font-medium text-slate-400">
                o con tu correo
              </span>
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Correo electrónico
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="taller@ejemplo.com"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Contraseña
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <button
                type="submit"
                disabled={loading || googleLoading}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0072BB] px-4 text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
              >
                <LogIn className="h-4 w-4" />
                <span>
                  {loading
                    ? 'Conectando...'
                    : mode === 'login'
                    ? 'Ingresar'
                    : 'Registrar taller'}
                </span>
              </button>
            </form>

            <p className="text-center text-xs text-slate-500 dark:text-slate-400">
              Cada taller mantiene sus órdenes, clientes, inventario y finanzas aislados bajo su cuenta.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

interface WorkshopOnboardingProps {
  userId: string;
  userEmail?: string | null;
  displayName?: string | null;
}

export const WorkshopOnboarding: React.FC<WorkshopOnboardingProps> = ({
  userId,
  userEmail,
  displayName,
}) => {
  const { notify } = useToast();
  const initialParts = (displayName || '').trim().split(/\s+/);
  const [firstName, setFirstName] = useState(initialParts[0] || '');
  const [lastName, setLastName] = useState(initialParts.slice(1).join(' ') || '');
  const [businessPhone, setBusinessPhone] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [role, setRole] = useState<'admin' | 'operator'>('admin');
  const [brandName, setBrandName] = useState('TH3 BNB');
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      notify('El logo no puede superar 1,5 MB.', 'error');
      return;
    }
    try {
      const compressed = await compressImageToDataUrl(file, 480, 0.85);
      setLogoDataUrl(compressed);
    } catch {
      notify('No se pudo procesar la imagen del logo.', 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const path = `workshop_profiles/${userId}`;
    try {
      const nowIso = new Date().toISOString();
      const payload = stripUndefined({
        id: userId,
        ownerId: userId,
        email: clampStr(userEmail, 200),
        firstName: clampStr(firstName, 100),
        lastName: clampStr(lastName, 100),
        role,
        brandName: clampStr(brandName || 'TH3 BNB', 80) || 'TH3 BNB',
        subtitle: 'Servicio técnico',
        businessPhone: clampStr(businessPhone, 50),
        businessAddress: clampStr(businessAddress, 200),
        wordColors: ['#0F172A', '#0072BB'],
        logoDataUrl: logoDataUrl || '',
        logoScale: 100,
        logoTransparent: true,
        receiptTerms: clampStr(DEFAULT_RECEIPT_TERMS, 2000),
        trackingBaseUrl: isPrivatePreviewOrigin(window.location.origin)
          ? ''
          : clampStr(window.location.origin, 250),
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      await upsertRow('workshop_profiles', payload);
      notify('Perfil del taller guardado correctamente.');
    } catch (err) {
      notify('No se pudo guardar el perfil. Intentá de nuevo.', 'error');
      await handleDbError(err, OperationType.CREATE, path);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white font-display">
            Configurá tu taller
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Completá los datos de tu local para personalizar las boletas y el seguimiento de clientes.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Nombre
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Tu nombre"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Apellido
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Tu apellido"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Teléfono del local
              </label>
              <input
                type="tel"
                maxLength={50}
                value={businessPhone}
                onChange={(e) => setBusinessPhone(e.target.value)}
                placeholder="11-5555-0199"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Tipo de acceso
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'operator')}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="admin">Administrador</option>
                <option value="operator">Operador</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Dirección del local
            </label>
            <input
              type="text"
              maxLength={200}
              value={businessAddress}
              onChange={(e) => setBusinessAddress(e.target.value)}
              placeholder="Av. Principal 1234"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Nombre o marca del taller
            </label>
            <input
              type="text"
              maxLength={80}
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="TH3 BNB"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Logo (PNG, JPG o WebP, máximo 1,5 MB)
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-600 transition hover:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
              <Upload className="h-4 w-4" />
              <span>{logoDataUrl ? 'Logo cargado · Cambiar imagen' : 'Seleccionar imagen opcional'}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleLogoUpload}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cerrar sesión
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-11 flex-1 rounded-xl bg-[#0072BB] px-5 text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Comenzar a usar el taller'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
