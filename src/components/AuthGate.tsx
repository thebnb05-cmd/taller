import React, { useState } from 'react';
import {
  Building2,
  Coins,
  Image as ImageIcon,
  LogIn,
  Mail,
  ShieldCheck,
  Smartphone,
  Store,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import {
  clampStr,
  handleDbError,
  OperationType,
  stripUndefined,
  supabase,
  upsertRow,
} from '../lib/db';
import { DEFAULT_RECEIPT_TERMS } from '../data/catalog';
import {
  CURRENCY_OPTIONS,
  DEFAULT_CURRENCY,
  sanitizeCurrencyCode,
  setActiveCurrency,
  type CurrencyCode,
} from '../utils/currency';
import { compressImageToDataUrl, formatCurrency } from '../utils/formatters';
import {
  isPrivatePreviewOrigin,
  normalizeTrackingBaseUrl,
  resolveTrackingBaseUrl,
} from '../utils/tracking';
import { serializeWorkshopSubtitle } from '../utils/workshopMeta';
import {
  isValidEmail,
  sanitizeDbErrorMessage,
  sanitizeEmail,
  sanitizeHexColor,
  sanitizeImageDataUrl,
  sanitizePhone,
  sanitizePlainLine,
  sanitizeText,
} from '../utils/validation';
import { BrandMark } from './BrandMark';
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
          : '';
      if (msg.toLowerCase().includes('provider is not enabled')) {
        setErrorMsg(
          'Falta activar Google en tu panel de Supabase (Authentication → Providers → Google).'
        );
      } else {
        setErrorMsg('No se pudo iniciar sesión con Google. Intentá nuevamente.');
      }
      setGoogleLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = sanitizeEmail(email);
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      setErrorMsg('Ingresá un correo electrónico válido.');
      return;
    }
    if (!password) {
      setErrorMsg('Ingresá tu contraseña.');
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setErrorMsg('Para crear una cuenta, la contraseña debe tener al menos 8 caracteres.');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) throw error;
        notify('Sesión iniciada correctamente.');
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
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
          ? String((err as { message?: unknown }).message).toLowerCase()
          : '';
      if (msg.includes('invalid login credentials')) {
        setErrorMsg('Correo o contraseña incorrectos.');
      } else if (msg.includes('email not confirmed')) {
        setErrorMsg('Tu correo todavía no está confirmado. Revisá tu bandeja de entrada.');
      } else if (msg.includes('user already registered')) {
        setErrorMsg('Ya existe una cuenta registrada con ese correo.');
      } else if (msg.includes('rate limit') || msg.includes('too many')) {
        setErrorMsg('Demasiados intentos. Esperá unos minutos e intentá nuevamente.');
      } else if (msg.includes('password')) {
        setErrorMsg('La contraseña no cumple con los requisitos mínimos de seguridad.');
      } else {
        setErrorMsg('No se pudo completar la autenticación. Verificá tus datos e intentá otra vez.');
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
                  minLength={mode === 'signup' ? 8 : 6}
                  maxLength={128}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'Mínimo 8 caracteres' : 'Tu contraseña'}
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
  const [role, setRole] = useState<'admin' | 'operator'>('admin');

  const [brandName, setBrandName] = useState('TH3 BNB');
  const [subtitleText, setSubtitleText] = useState('Servicio técnico');
  const [businessPhone, setBusinessPhone] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY);

  const [hours, setHours] = useState('');
  const [social, setSocial] = useState('');
  const [taxId, setTaxId] = useState('');
  const [businessEmail, setBusinessEmail] = useState(userEmail || '');
  const [footerNote, setFooterNote] = useState('');

  const [wordColors, setWordColors] = useState<string[]>(['#0F172A', '#0072BB']);
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [logoScale, setLogoScale] = useState(100);
  const [logoTransparent, setLogoTransparent] = useState(true);
  const [receiptTerms, setReceiptTerms] = useState(DEFAULT_RECEIPT_TERMS);
  const [trackingBaseUrl, setTrackingBaseUrl] = useState(() =>
    isPrivatePreviewOrigin(window.location.origin)
      ? ''
      : resolveTrackingBaseUrl(window.location.origin)
  );
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);

  const words = (brandName || 'TH3 BNB').trim().split(/\s+/).filter(Boolean);

  const handleLogoFile = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Usá una imagen PNG, JPG o WebP.', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      notify('El logo no puede superar los 2 MB.', 'error');
      return;
    }
    try {
      const compressed = await compressImageToDataUrl(file, 480, 0.88);
      const safeLogo = sanitizeImageDataUrl(compressed, 700000);
      if (!safeLogo) {
        notify('El logo procesado no tiene un formato válido o supera el límite.', 'error');
        return;
      }
      setLogoDataUrl(safeLogo);
    } catch {
      notify('No se pudo cargar la imagen del logo.', 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanFirst = sanitizePlainLine(firstName, 100);
    const cleanLast = sanitizePlainLine(lastName, 100);
    if (!cleanFirst || !cleanLast) {
      notify('Completá tu nombre y apellido.', 'error');
      return;
    }

    const cleanContactEmail = sanitizeEmail(businessEmail, 100);
    if (cleanContactEmail && !isValidEmail(cleanContactEmail)) {
      notify('El email de contacto del taller no tiene un formato válido.', 'error');
      return;
    }

    const rawTracking = trackingBaseUrl.trim();
    const cleanedTrackingUrl = normalizeTrackingBaseUrl(rawTracking);
    if (rawTracking && !cleanedTrackingUrl) {
      notify('La dirección del sitio de seguimiento debe empezar con https:// o http://', 'error');
      return;
    }

    setSaving(true);
    const path = `workshop_profiles/${userId}`;
    try {
      const nowIso = new Date().toISOString();
      const safeCurrency = sanitizeCurrencyCode(currency);
      const safeTrackingBaseUrl = isPrivatePreviewOrigin(cleanedTrackingUrl)
        ? ''
        : clampStr(cleanedTrackingUrl, 250);
      const encodedSubtitle = serializeWorkshopSubtitle({
        subtitle: sanitizePlainLine(subtitleText, 80),
        hours: sanitizePlainLine(hours, 100),
        social: sanitizePlainLine(social, 100),
        taxId: sanitizePlainLine(taxId, 60),
        businessEmail: cleanContactEmail,
        footerNote: sanitizePlainLine(footerNote, 180),
        currency: safeCurrency,
      });
      const safeColors = wordColors
        .slice(0, 12)
        .map((c, idx) => sanitizeHexColor(c, idx === 0 ? '#0F172A' : '#0072BB'));
      const safeScale = Math.min(200, Math.max(50, Math.round(Number(logoScale) || 100)));
      const safeLogoDataUrl = logoDataUrl ? sanitizeImageDataUrl(logoDataUrl, 700000) : '';

      const payload = stripUndefined({
        id: userId,
        ownerId: userId,
        email: clampStr(sanitizeEmail(userEmail || ''), 200),
        firstName: clampStr(cleanFirst, 100),
        lastName: clampStr(cleanLast, 100),
        role: role === 'operator' ? 'operator' : 'admin',
        brandName: clampStr(sanitizePlainLine(brandName, 80) || 'TH3 BNB', 80) || 'TH3 BNB',
        subtitle: clampStr(encodedSubtitle, 900),
        businessPhone: clampStr(sanitizePhone(businessPhone, 50), 50),
        businessAddress: clampStr(sanitizePlainLine(businessAddress, 200), 200),
        wordColors: safeColors,
        logoDataUrl: safeLogoDataUrl,
        logoScale: safeScale,
        logoTransparent,
        receiptTerms: sanitizeText(receiptTerms, 2000),
        trackingBaseUrl: safeTrackingBaseUrl,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      await upsertRow('workshop_profiles', payload);
      setActiveCurrency(safeCurrency);
      notify('Perfil del taller guardado correctamente.');
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo guardar el perfil. Intentá de nuevo.'), 'error');
      void handleDbError(err, OperationType.CREATE, path).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8 dark:bg-slate-950">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white font-display">
            Configurá tu taller
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Completá tus datos, marca, moneda, logo y opciones visibles en cada boleta y presupuesto.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Datos del responsable */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Nombre *
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
                Apellido *
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

          {/* Sección Taller · Marca y comprobantes */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5 pt-1 dark:border-slate-800">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
              <Store className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-white font-display">
                Taller · Marca y comprobantes
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Todos estos datos se reflejan automáticamente en tus boletas A4, 80mm y PDF.
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Nombre o marca del taller
              </label>
              <input
                type="text"
                maxLength={60}
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="TH3 BNB"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Subtítulo / Rubro del taller
              </label>
              <input
                type="text"
                maxLength={80}
                value={subtitleText}
                onChange={(e) => setSubtitleText(e.target.value)}
                placeholder="Ej: Servicio técnico especializado"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Teléfono del local
              </label>
              <input
                type="tel"
                maxLength={40}
                value={businessPhone}
                onChange={(e) => setBusinessPhone(e.target.value)}
                placeholder="11-5555-0199"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Dirección del local
              </label>
              <input
                type="text"
                maxLength={120}
                value={businessAddress}
                onChange={(e) => setBusinessAddress(e.target.value)}
                placeholder="Av. Principal 1234"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          {/* Moneda */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <Coins className="h-4 w-4" />
                </span>
                <div>
                  <label
                    htmlFor="onboarding-currency-select"
                    className="block text-xs font-bold text-slate-800 dark:text-slate-100"
                  >
                    Moneda del taller, presupuestos y boletas
                  </label>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Se aplica en presupuestos, señas, inventario, ventas, WhatsApp y boletas A4, 80mm y PDF.
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono-num text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300">
                Ej: {formatCurrency(15000, currency)}
              </div>
            </div>

            <div className="mt-3">
              <select
                id="onboarding-currency-select"
                value={currency}
                onChange={(e) => setCurrency(sanitizeCurrencyCode(e.target.value))}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                {CURRENCY_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Opciones extra para mostrar en cada boleta */}
          <div className="space-y-3 rounded-2xl border border-sky-200/80 bg-sky-50/40 p-4 dark:border-sky-900/50 dark:bg-sky-950/20">
            <div>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Opciones extra para mostrar en cada boleta
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Completá las que quieras imprimir en boletas de reparación, ventas, lotes y PDF.
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Horarios de atención
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="Ej: Lun a Vie 9:30 a 19:00 · Sáb 10 a 14"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Instagram / Web
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={social}
                  onChange={(e) => setSocial(e.target.value)}
                  placeholder="Ej: @th3bnb.servicio · www.th3bnb.com"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  CUIT / Documento comercial (opcional)
                </label>
                <input
                  type="text"
                  maxLength={60}
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="Ej: CUIT 20-12345678-9"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Email de contacto
                </label>
                <input
                  type="email"
                  maxLength={100}
                  value={businessEmail}
                  onChange={(e) => setBusinessEmail(e.target.value)}
                  placeholder="Ej: contacto@tutaller.com"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Garantía o mensaje destacado al pie de boleta
                </label>
                <input
                  type="text"
                  maxLength={180}
                  value={footerNote}
                  onChange={(e) => setFooterNote(e.target.value)}
                  placeholder="Ej: Garantía 30 días sobre el trabajo realizado · ¡Gracias por elegirnos!"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Color por palabra y vista previa */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              Color por palabra y vista previa
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {words.map((word, idx) => (
                <label
                  key={`${word}-${idx}`}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <input
                    type="color"
                    value={wordColors[idx] || (idx === 0 ? '#0F172A' : '#0072BB')}
                    onChange={(e) => {
                      const next = [...wordColors];
                      next[idx] = e.target.value;
                      setWordColors(next);
                    }}
                    className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <span>{word}</span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-center rounded-xl border border-slate-200 bg-white py-3 dark:border-slate-700 dark:bg-slate-900">
              <BrandMark
                profile={{
                  brandName,
                  wordColors,
                  logoDataUrl,
                  logoScale,
                  logoTransparent,
                }}
                size="lg"
                showLogoImage={false}
              />
            </div>
          </div>

          {/* Logo del taller */}
          <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <ImageIcon className="h-4 w-4 text-[#0072BB] dark:text-sky-400" />
                <span>Logo del taller (opcional)</span>
              </div>
              {logoDataUrl && (
                <button
                  type="button"
                  onClick={() => setLogoDataUrl('')}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Quitar logo
                </button>
              )}
            </div>

            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void handleLogoFile(e.dataTransfer.files?.[0]);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-center transition ${
                dragOver
                  ? 'border-[#0072BB] bg-sky-50 dark:bg-sky-950/30'
                  : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/40'
              }`}
            >
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void handleLogoFile(e.target.files?.[0])}
                className="hidden"
              />
              {logoDataUrl ? (
                <div
                  className={`rounded-xl p-2 ${
                    logoTransparent ? '' : 'bg-white shadow-xs'
                  }`}
                >
                  <img
                    src={logoDataUrl}
                    alt="Vista previa del logo"
                    referrerPolicy="no-referrer"
                    style={{ height: `${Math.round((48 * logoScale) / 100)}px` }}
                    className="max-w-full object-contain"
                  />
                </div>
              ) : (
                <>
                  <UploadCloud className="h-7 w-7 text-slate-400" />
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    <strong>Clic para seleccionar</strong> o arrastrá una imagen
                  </div>
                  <div className="text-[11px] text-slate-400">
                    PNG transparente recomendado · Máx 2 MB
                  </div>
                </>
              )}
            </label>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
                <span>Tamaño del logo</span>
                <span className="font-mono-num">{logoScale}%</span>
              </div>
              <input
                type="range"
                min={50}
                max={200}
                step={10}
                value={logoScale}
                onChange={(e) => setLogoScale(Number(e.target.value))}
                className="w-full accent-[#0072BB]"
              />
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={logoTransparent}
                onChange={(e) => setLogoTransparent(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-[#0072BB]"
              />
              <span>
                <strong className="block text-slate-900 dark:text-white">
                  Mi logo tiene fondo transparente
                </strong>
                Si subiste un JPG o PNG con fondo blanco, desmarcalo para mostrarlo sobre un recuadro
                claro.
              </span>
            </label>
          </div>

          {/* Términos y condiciones */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Términos y condiciones
            </label>
            <textarea
              rows={4}
              maxLength={2000}
              value={receiptTerms}
              onChange={(e) => setReceiptTerms(e.target.value)}
              placeholder="Escribí los términos y condiciones que aparecerán en la boleta del cliente..."
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {/* URL pública de seguimiento */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Dirección pública del sitio para links de seguimiento (opcional)
            </label>
            <input
              type="url"
              value={trackingBaseUrl}
              onChange={(e) => setTrackingBaseUrl(e.target.value)}
              placeholder="https://tu-taller.vercel.app"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
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
