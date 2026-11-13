import React, { useState } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Building2, LogIn, ShieldCheck, Smartphone, Upload } from 'lucide-react';
import {
  auth,
  clampStr,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  stripUndefined,
} from '../lib/db';
import { DEFAULT_RECEIPT_TERMS } from '../data/catalog';
import { compressImageToDataUrl } from '../utils/formatters';
import { useToast } from './ToastProvider';

interface AuthScreenProps {
  onOpenTrackingLookup?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onOpenTrackingLookup }) => {
  const { notify } = useToast();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      await signInWithPopup(auth, googleProvider);
      notify('Sesión iniciada correctamente.');
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: string }).code)
          : '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setErrorMsg('Se cerró la ventana de acceso antes de completar el ingreso.');
      } else if (code === 'auth/popup-blocked') {
        setErrorMsg('El navegador bloqueó la ventana emergente. Habilitá los popups e intentá de nuevo.');
      } else if (code === 'auth/unauthorized-domain') {
        setErrorMsg(
          'Este dominio no está autorizado en Firebase Authentication. Agregalo en la consola de Firebase.'
        );
      } else {
        const msg = err instanceof Error ? err.message : 'No se pudo iniciar sesión con Google.';
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
              <span>Acceso seguro con tu cuenta de Google vía Firebase Authentication</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Building2 className="h-4 w-4 shrink-0 text-sky-400" />
              <span>Sincronización en tiempo real con Firestore entre PC, tablet y celular</span>
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
                Ingresar al sistema
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Iniciá sesión con tu cuenta de Google para acceder a tu taller o configurar uno nuevo.
              </p>
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                {errorMsg}
              </div>
            )}

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-[#0072BB] px-4 text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
            >
              <LogIn className="h-4 w-4" />
              <span>{loading ? 'Conectando...' : 'Continuar con Google'}</span>
            </button>

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
    const path = `workshopProfiles/${userId}`;
    try {
      const payload = stripUndefined({
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
        trackingBaseUrl: clampStr(window.location.origin, 250),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'workshopProfiles', userId), payload);
      notify('Perfil del taller guardado correctamente.');
    } catch (err) {
      notify('No se pudo guardar el perfil. Intentá de nuevo.', 'error');
      handleFirestoreError(err, OperationType.CREATE, path);
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
              onClick={() => signOut(auth)}
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
