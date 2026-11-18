import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock, KeyRound, Mail, Send, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/db';
import { MAX_LOGIN_ATTEMPTS, resetLoginGuard } from '../utils/loginGuard';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';

export interface VerificationCodeModalProps {
  open: boolean;
  email: string;
  lockedUntil: number | null;
  initialError?: string;
  onClose: () => void;
  onVerified: (email: string) => void;
  onLockExpired?: (email: string) => void;
}

function formatLockCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const VerificationCodeModal: React.FC<VerificationCodeModalProps> = ({
  open,
  email,
  lockedUntil,
  initialError,
  onClose,
  onVerified,
  onLockExpired,
}) => {
  const { notify } = useToast();
  const [otpCode, setOtpCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [lockRemainingSec, setLockRemainingSec] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const expiredFiredRef = useRef(false);
  const onLockExpiredRef = useRef(onLockExpired);
  onLockExpiredRef.current = onLockExpired;

  // Reset modal internal state when opened for an email / lock window
  useEffect(() => {
    if (!open) return;
    expiredFiredRef.current = false;
    setOtpCode('');
    setCodeSent(false);
    setSending(false);
    setVerifying(false);
    setCooldownSec(0);
    setErrorMsg(initialError || '');
    setInfoMsg('');
    setLockRemainingSec(
      lockedUntil ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0
    );
  }, [open, email, lockedUntil, initialError]);

  // 1-second timer for 5-minute temporary lock countdown & resend cooldown
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      setCooldownSec((prev) => (prev > 0 ? Math.max(0, prev - 1) : 0));

      if (lockedUntil) {
        const nextLockSec = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
        setLockRemainingSec(nextLockSec);
        if (nextLockSec <= 0 && !expiredFiredRef.current) {
          expiredFiredRef.current = true;
          onLockExpiredRef.current?.(email);
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, email, lockedUntil]);

  const handleSendOtpCode = async () => {
    if (!email || sending || cooldownSec > 0) return;
    setErrorMsg('');
    setInfoMsg('');
    setSending(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      setCodeSent(true);
      setCooldownSec(60);
      setInfoMsg(
        `Enviamos un código de verificación de 6 dígitos a ${email}. Revisá tu bandeja (y spam) e ingresalo abajo.`
      );
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message).toLowerCase()
          : '';
      if (msg.includes('signups not allowed')) {
        setErrorMsg(
          'No existe una cuenta registrada con ese correo. Revisá si lo escribiste bien o usá otro correo.'
        );
      } else if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('seconds')) {
        setErrorMsg('Esperá unos segundos antes de solicitar un nuevo código por correo.');
      } else {
        setErrorMsg('No se pudo enviar el código de 6 dígitos. Intentá nuevamente en unos instantes.');
      }
    } finally {
      setSending(false);
    }
  };

  const handleVerifyOtpCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanToken = otpCode.replace(/\D/g, '').slice(0, 6);
    if (cleanToken.length !== 6) {
      setErrorMsg('Ingresá el código numérico de 6 dígitos que recibiste por correo.');
      return;
    }

    setErrorMsg('');
    setInfoMsg('');
    setVerifying(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: cleanToken,
        type: 'email',
      });
      if (error) throw error;

      // Reset failed-attempt counter on server + browser before handing back access
      await resetLoginGuard(email, data.session?.access_token);
      notify('Código verificado. Sesión iniciada correctamente.');
      onVerified(email);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message).toLowerCase()
          : '';
      if (msg.includes('expired') || msg.includes('invalid') || msg.includes('token')) {
        setErrorMsg('El código de 6 dígitos es incorrecto o venció. Pedí uno nuevo e intentá otra vez.');
      } else {
        setErrorMsg('No se pudo validar el código. Verificá los 6 dígitos e intentá nuevamente.');
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Verificación de seguridad"
      subtitle={`Bloqueo temporal tras ${MAX_LOGIN_ATTEMPTS} intentos fallidos`}
      maxWidth="md"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50/80 px-3.5 py-3 dark:border-amber-900/60 dark:bg-amber-950/40">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <KeyRound className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-bold text-amber-950 dark:text-amber-100">
                Cuenta protegida temporalmente
              </div>
              <div className="flex items-center gap-1 truncate text-[11px] text-amber-800 dark:text-amber-200">
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate font-semibold">{email}</span>
              </div>
            </div>
          </div>
          {lockedUntil && lockRemainingSec > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-2.5 py-1 font-mono-num text-xs font-bold text-amber-900 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200">
              <Clock className="h-3.5 w-3.5" />
              <span>{formatLockCountdown(lockRemainingSec)}</span>
            </span>
          )}
        </div>

        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          Superaste el límite de {MAX_LOGIN_ATTEMPTS} errores de contraseña. Podés esperar a que finalice el
          bloqueo temporal de 5 minutos o solicitar un código de 6 dígitos por correo para validar tu identidad
          e ingresar ahora mismo.
        </p>

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
          onClick={() => void handleSendOtpCode()}
          disabled={sending || cooldownSec > 0 || verifying}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-[#0072BB] transition hover:bg-sky-100 disabled:opacity-60 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/70"
        >
          <Send className="h-4 w-4" />
          <span>
            {sending
              ? 'Enviando código...'
              : cooldownSec > 0
                ? `Reenviar código en ${cooldownSec}s`
                : codeSent
                  ? 'Reenviar código de 6 dígitos'
                  : 'Enviar código de 6 dígitos al correo'}
          </span>
        </button>

        <form onSubmit={handleVerifyOtpCode} className="space-y-3.5">
          <div>
            <label
              htmlFor="verification-otp-input"
              className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              Código de verificación (6 dígitos)
            </label>
            <input
              id="verification-otp-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-center font-mono text-xl font-bold tracking-[0.45em] text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <button
            type="submit"
            disabled={verifying || otpCode.length !== 6}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0072BB] px-4 text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>{verifying ? 'Verificando código...' : 'Verificar código y acceder'}</span>
          </button>
        </form>

        <p className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          Tip: si tu correo llega con un enlace de acceso directo en vez del número de 6 dígitos, podés tocar ese
          enlace para entrar igual o incluir{' '}
          <code className="font-mono text-slate-700 dark:text-slate-200">{'{{ .Token }}'}</code> en la plantilla
          Magic Link de Supabase.
        </p>

        <div className="flex justify-start pt-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Usar otro correo / Cerrar</span>
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
