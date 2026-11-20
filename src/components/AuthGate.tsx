import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Coins,
  Globe,
  Image as ImageIcon,
  LogIn,
  Mail,
  Smartphone,
  Store,
  Trash2,
  UploadCloud,
  XCircle,
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
import {
  getActiveLanguage,
  LANGUAGE_OPTIONS,
  sanitizeLanguageCode,
  setActiveLanguage,
  useI18n,
  type LanguageCode,
} from '../utils/i18n';
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
import {
  getLoginGuardStatus,
  getRememberedLockedEmail,
  MAX_LOGIN_ATTEMPTS,
  recordFailedPasswordAttempt,
  rememberLockedEmail,
  resetLoginGuard,
} from '../utils/loginGuard';
import { BrandMark } from './BrandMark';
import { useToast } from './ToastProvider';
import { VerificationCodeModal } from './VerificationCodeModal';

interface AuthScreenProps {
  onOpenTrackingLookup?: () => void;
}

interface OtpLockState {
  email: string;
  lockedUntil: number;
  initialError?: string;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onOpenTrackingLookup }) => {
  const { notify } = useToast();
  const { lang, tr } = useI18n();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [otpLock, setOtpLock] = useState<OtpLockState | null>(null);

  const hasSignupComparison = mode === 'signup' && confirmPassword.length > 0;
  const passwordsMatch = hasSignupComparison && password.length > 0 && password === confirmPassword;
  const passwordsMismatch = hasSignupComparison && password !== confirmPassword;
  const passwordMatchBorderClass = passwordsMatch
    ? 'border-emerald-500 focus:border-emerald-500 ring-2 ring-emerald-500/15 dark:border-emerald-500 dark:focus:border-emerald-400'
    : passwordsMismatch
    ? 'border-red-500 focus:border-red-500 ring-2 ring-red-500/15 dark:border-red-500 dark:focus:border-red-400'
    : 'border-slate-200 focus:border-[#0072BB] dark:border-slate-700';

  // Restore active 5-minute lockout modal if user refreshes during lockout
  useEffect(() => {
    const lastLockedEmail = getRememberedLockedEmail();
    if (!lastLockedEmail) return;
    let active = true;
    void getLoginGuardStatus(lastLockedEmail).then((status) => {
      if (!active) return;
      if (status.requiresOtp && status.lockedUntil && status.lockRemainingSec > 0) {
        const msg = `Bloqueo temporal de 5 minutos activo para ${lastLockedEmail}. Solicitá e ingresá el código de 6 dígitos enviado a tu correo para desbloquear antes.`;
        setEmail(lastLockedEmail);
        setRemainingAttempts(0);
        setErrorMsg(msg);
        setOtpLock({
          email: lastLockedEmail,
          lockedUntil: status.lockedUntil,
          initialError: msg,
        });
      } else {
        rememberLockedEmail(null);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handleGoogleAuth = async () => {
    setErrorMsg('');
    setInfoMsg('');
    if (typeof window !== 'undefined' && window.self !== window.top) {
      setErrorMsg(
        tr(
          'Google bloquea su pantalla de acceso dentro de la vista previa integrada. Usá tu correo y contraseña acá, o probá el botón de Google desde tu web publicada en Vercel / app instalada.',
          'Google blocks its sign-in screen inside the embedded preview. Use your email and password here, or try the Google button from your published site or installed app.',
          'O Google bloqueia a tela de login dentro da visualização integrada. Use seu e-mail e senha aqui, ou tente o botão do Google no seu site publicado ou app instalado.'
        )
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
          tr(
            'Falta activar Google en tu panel de Supabase (Authentication → Providers → Google).',
            'Google provider is not enabled yet in your Supabase dashboard (Authentication → Providers → Google).',
            'O provedor Google ainda não foi ativado no painel do Supabase (Authentication → Providers → Google).'
          )
        );
      } else {
        setErrorMsg(
          tr(
            'No se pudo iniciar sesión con Google. Intentá nuevamente.',
            'Could not sign in with Google. Try again.',
            'Não foi possível entrar com o Google. Tente novamente.'
          )
        );
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = sanitizeEmail(email);
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      setErrorMsg(tr('Ingresá un correo electrónico válido.', 'Enter a valid email address.', 'Digite um e-mail válido.'));
      return;
    }
    if (!password) {
      setErrorMsg(tr('Ingresá tu contraseña.', 'Enter your password.', 'Digite sua senha.'));
      return;
    }
    if (mode === 'signup') {
      if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
        setErrorMsg(
          tr(
            'Para crear una cuenta, la contraseña debe tener al menos 8 caracteres, incluyendo letras y números.',
            'To create an account, the password must have at least 8 characters, including letters and numbers.',
            'Para criar uma conta, a senha deve ter pelo menos 8 caracteres, incluindo letras e números.'
          )
        );
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg(
          tr(
            'Las contraseñas no coinciden. Escribí la misma contraseña en ambos campos.',
            'Passwords do not match. Enter the same password in both fields.',
            'As senhas não coincidem. Digite a mesma senha nos dois campos.'
          )
        );
        return;
      }
    }

    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');
    try {
      if (mode === 'login') {
        const guard = await getLoginGuardStatus(cleanEmail);
        if (guard.requiresOtp && guard.lockedUntil) {
          const lockMessage = tr(
            `Cuenta bloqueada temporalmente por 5 minutos tras ${MAX_LOGIN_ATTEMPTS} intentos fallidos. Solicitá e ingresá un código de 6 dígitos enviado a tu correo para desbloquear.`,
            `Account temporarily locked for 5 minutes after ${MAX_LOGIN_ATTEMPTS} failed attempts. Request and enter a 6-digit code sent to your email to unlock.`,
            `Conta bloqueada temporariamente por 5 minutos após ${MAX_LOGIN_ATTEMPTS} tentativas falhas. Solicite e digite um código de 6 dígitos enviado ao seu e-mail para desbloquear.`
          );
          rememberLockedEmail(cleanEmail);
          setRemainingAttempts(0);
          setPassword('');
          setErrorMsg(lockMessage);
          setOtpLock({
            email: cleanEmail,
            lockedUntil: guard.lockedUntil,
            initialError: lockMessage,
          });
          return;
        }

        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) throw error;
        setRemainingAttempts(null);
        await resetLoginGuard(cleanEmail, data.session?.access_token);
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
            tr(
              'Cuenta creada. Revisá tu correo electrónico para confirmar la cuenta y luego iniciá sesión.',
              'Account created. Check your email to confirm your account, then sign in.',
              'Conta criada. Verifique seu e-mail para confirmar a conta e depois faça login.'
            )
          );
          setConfirmPassword('');
          setMode('login');
        }
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message).toLowerCase()
          : '';
      if (msg.includes('invalid login credentials')) {
        if (mode === 'login') {
          const nextGuard = await recordFailedPasswordAttempt(cleanEmail);
          if (nextGuard.requiresOtp && nextGuard.lockedUntil) {
            const lockMessage = tr(
              `Superaste los ${MAX_LOGIN_ATTEMPTS} errores de contraseña. Bloqueamos el acceso por 5 minutos; pedí un código de 6 dígitos a tu correo para desbloquear antes.`,
              `You exceeded ${MAX_LOGIN_ATTEMPTS} password errors. Access is locked for 5 minutes; request a 6-digit email code to unlock earlier.`,
              `Você excedeu ${MAX_LOGIN_ATTEMPTS} erros de senha. O acesso foi bloqueado por 5 minutos; peça um código de 6 dígitos por e-mail para desbloquear antes.`
            );
            setRemainingAttempts(0);
            setPassword('');
            setErrorMsg(lockMessage);
            setOtpLock({
              email: cleanEmail,
              lockedUntil: nextGuard.lockedUntil,
              initialError: lockMessage,
            });
          } else {
            setRemainingAttempts(nextGuard.remainingAttempts);
            setErrorMsg(
              tr(
                `Correo o contraseña incorrectos. Te ${
                  nextGuard.remainingAttempts === 1
                    ? 'queda 1 intento'
                    : `quedan ${nextGuard.remainingAttempts} intentos`
                } antes del bloqueo temporal de 5 minutos.`,
                `Incorrect email or password. ${nextGuard.remainingAttempts} ${
                  nextGuard.remainingAttempts === 1 ? 'attempt' : 'attempts'
                } remaining before a 5-minute temporary lock.`,
                `E-mail ou senha incorretos. Restam ${nextGuard.remainingAttempts} ${
                  nextGuard.remainingAttempts === 1 ? 'tentativa' : 'tentativas'
                } antes do bloqueio temporário de 5 minutos.`
              )
            );
          }
        } else {
          setErrorMsg(tr('Correo o contraseña incorrectos.', 'Incorrect email or password.', 'E-mail ou senha incorretos.'));
        }
      } else if (msg.includes('email not confirmed')) {
        setErrorMsg(tr('Tu correo todavía no está confirmado. Revisá tu bandeja de entrada.', 'Your email is not confirmed yet. Check your inbox.', 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.'));
      } else if (msg.includes('user already registered')) {
        setErrorMsg(tr('Ya existe una cuenta registrada con ese correo.', 'An account with this email already exists.', 'Já existe uma conta registrada com esse e-mail.'));
      } else if (msg.includes('rate limit') || msg.includes('too many')) {
        setErrorMsg(tr('Demasiados intentos. Esperá unos minutos e intentá nuevamente.', 'Too many attempts. Wait a few minutes and try again.', 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'));
      } else if (msg.includes('password')) {
        setErrorMsg(tr('La contraseña no cumple con los requisitos mínimos de seguridad.', 'Password does not meet the minimum security requirements.', 'A senha não atende aos requisitos mínimos de segurança.'));
      } else {
        setErrorMsg(tr('No se pudo completar la autenticación. Verificá tus datos e intentá otra vez.', 'Could not complete authentication. Check your details and try again.', 'Não foi possível concluir a autenticação. Verifique seus dados e tente novamente.'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-3 py-5 sm:px-6 sm:py-8 lg:py-10 dark:bg-slate-950">
      <div className="grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:rounded-3xl md:grid-cols-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col justify-between bg-slate-900 p-6 text-white sm:p-7 md:p-8 lg:p-10 dark:bg-slate-950">
          <div>
            <div className="inline-flex items-center gap-2.5 text-lg font-extrabold tracking-tight font-display sm:text-xl">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0072BB] text-white sm:h-10 sm:w-10">
                <Smartphone className="h-5 w-5" />
              </span>
              <span>
                TU <span className="text-sky-400">TALLER</span>
              </span>
            </div>
            <h1 className="mt-5 text-2xl font-bold leading-tight tracking-tight text-balance font-display sm:mt-6 sm:text-3xl md:mt-8">
              {tr(
                'Gestión integral para tu servicio técnico',
                'Complete management for your repair shop',
                'Gestão completa para sua assistência técnica'
              )}
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-slate-300 sm:mt-3">
              {tr(
                'Controlá órdenes, repuestos, ventas y caja en tiempo real, con firma digital, QR de seguimiento y comprobantes listos para imprimir o enviar por WhatsApp.',
                'Manage orders, spare parts, sales, and cash register in real time, with digital signatures, tracking QR codes, and receipts ready to print or send via WhatsApp.',
                'Controle ordens, peças, vendas e caixa em tempo real, com assinatura digital, QR de acompanhamento e comprovantes prontos para imprimir ou enviar pelo WhatsApp.'
              )}
            </p>
          </div>

          <div className="mt-6 space-y-2.5 border-t border-slate-800 pt-4 text-xs text-slate-300 sm:mt-7 sm:pt-5 md:mt-8 md:space-y-3 md:pt-6">
            <div className="flex items-center gap-2.5">
              <Building2 className="h-4 w-4 shrink-0 text-sky-400" />
              <span>
                {tr(
                  'Sincronizado al instante entre PC, tablet y celular para trabajar desde el mostrador o donde estés.',
                  'Instantly synced across desktop, tablet, and mobile so you can work from the counter or anywhere.',
                  'Sincronizado na hora entre computador, tablet e celular para trabalhar do balcão ou de onde você estiver.'
                )}
              </span>
            </div>
            {onOpenTrackingLookup && (
              <button
                type="button"
                onClick={onOpenTrackingLookup}
                className="mt-1 inline-flex items-center gap-1.5 text-left text-xs font-medium text-sky-400 hover:text-sky-300 hover:underline md:mt-2"
              >
                {tr(
                  '¿Sos cliente? Consultar estado de reparación',
                  'Are you a customer? Check repair status',
                  'É cliente? Consultar status do reparo'
                )}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col justify-center p-6 sm:p-7 md:p-8 lg:p-10">
          <div className="space-y-4 sm:space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white font-display">
                    {mode === 'login'
                      ? tr('Ingresar al sistema', 'Sign in', 'Entrar no sistema')
                      : tr('Crear cuenta de taller', 'Create workshop account', 'Criar conta da oficina')}
                  </h2>
                </div>
                <label className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <Globe className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                  <select
                    aria-label={tr('Idioma', 'Language', 'Idioma')}
                    value={lang}
                    onChange={(e) => setActiveLanguage(sanitizeLanguageCode(e.target.value))}
                    className="bg-transparent text-xs font-semibold text-slate-700 outline-none dark:text-slate-200"
                  >
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.code} value={opt.code} className="dark:bg-slate-900">
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setConfirmPassword('');
                    setErrorMsg('');
                    setInfoMsg('');
                    setRemainingAttempts(null);
                  }}
                  className={`h-9 rounded-lg text-xs font-semibold transition ${
                    mode === 'login'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {tr('Iniciar sesión', 'Sign in', 'Entrar')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setConfirmPassword('');
                    setErrorMsg('');
                    setInfoMsg('');
                    setRemainingAttempts(null);
                  }}
                  className={`h-9 rounded-lg text-xs font-semibold transition ${
                    mode === 'signup'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {tr('Crear cuenta', 'Create account', 'Criar conta')}
                </button>
              </div>

              {errorMsg && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {errorMsg}
                </div>
              )}

              {mode === 'login' && remainingAttempts !== null && remainingAttempts > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-[11px] font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Protección de acceso: {MAX_LOGIN_ATTEMPTS - remainingAttempts}/{MAX_LOGIN_ATTEMPTS}{' '}
                    errores usados. Al llegar a {MAX_LOGIN_ATTEMPTS}, se bloqueará por 5 minutos con código de 6 dígitos.
                  </span>
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
                <span>
                  {googleLoading
                    ? tr('Redirigiendo a Google...', 'Redirecting to Google...', 'Redirecionando para o Google...')
                    : tr('Continuar con Google', 'Continue with Google', 'Continuar com o Google')}
                </span>
              </button>

              <div className="relative flex items-center py-0.5">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                <span className="mx-3 shrink-0 text-[11px] font-medium text-slate-400">
                  {tr('o con tu correo', 'or with your email', 'ou com seu e-mail')}
                </span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-3.5">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {tr('Correo electrónico', 'Email', 'E-mail')}
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setRemainingAttempts(null);
                      }}
                      placeholder="taller@ejemplo.com"
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {tr('Contraseña', 'Password', 'Senha')}
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      required
                      minLength={mode === 'signup' ? 8 : 6}
                      maxLength={128}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      aria-invalid={mode === 'signup' ? passwordsMismatch : undefined}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        mode === 'signup'
                          ? tr(
                              'Mín. 8 caracteres (letras y números)',
                              'Min. 8 chars (letters & numbers)',
                              'Mín. 8 caracteres (letras e números)'
                            )
                          : tr('Tu contraseña', 'Your password', 'Sua senha')
                      }
                      className={`h-11 w-full rounded-xl border bg-white px-3.5 text-sm text-slate-900 outline-none transition-colors dark:bg-slate-800 dark:text-white ${
                        hasSignupComparison ? 'pr-10' : ''
                      } ${passwordMatchBorderClass}`}
                    />
                    {passwordsMatch && (
                      <CheckCircle2
                        aria-hidden="true"
                        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500 dark:text-emerald-400"
                      />
                    )}
                    {passwordsMismatch && (
                      <XCircle
                        aria-hidden="true"
                        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-red-500 dark:text-red-400"
                      />
                    )}
                  </div>
                </div>

                {mode === 'signup' && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {tr('Repetir contraseña', 'Confirm password', 'Repetir senha')}
                    </label>
                    <div className="relative">
                      <input
                        type="password"
                        required
                        minLength={8}
                        maxLength={128}
                        autoComplete="new-password"
                        aria-invalid={passwordsMismatch}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={tr(
                          'Volvé a escribir tu contraseña',
                          'Re-enter your password',
                          'Digite sua senha novamente'
                        )}
                        className={`h-11 w-full rounded-xl border bg-white px-3.5 pr-10 text-sm text-slate-900 outline-none transition-colors dark:bg-slate-800 dark:text-white ${passwordMatchBorderClass}`}
                      />
                      {passwordsMatch && (
                        <CheckCircle2
                          aria-hidden="true"
                          className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500 dark:text-emerald-400"
                        />
                      )}
                      {passwordsMismatch && (
                        <XCircle
                          aria-hidden="true"
                          className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-red-500 dark:text-red-400"
                        />
                      )}
                    </div>
                    {hasSignupComparison && (
                      <p
                        className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium ${
                          passwordsMatch
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {passwordsMatch ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>
                          {passwordsMatch
                            ? tr('Las contraseñas coinciden.', 'Passwords match.', 'As senhas coincidem.')
                            : tr('Las contraseñas no coinciden.', 'Passwords do not match.', 'As senhas não coincidem.')}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || googleLoading}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0072BB] px-4 text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
                >
                  <LogIn className="h-4 w-4" />
                  <span>
                    {loading
                      ? tr('Conectando...', 'Connecting...', 'Conectando...')
                      : mode === 'login'
                      ? tr('Ingresar', 'Sign in', 'Entrar')
                      : tr('Registrar taller', 'Register workshop', 'Cadastrar oficina')}
                  </span>
                </button>
              </form>

              <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                {tr(
                  'Cada taller mantiene sus órdenes, clientes, inventario y finanzas aislados bajo su cuenta.',
                  'Each workshop keeps its orders, clients, inventory, and finances isolated under its own account.',
                  'Cada oficina mantém suas ordens, clientes, estoque e finanças isolados em sua conta.'
                )}
              </p>
            </div>
        </div>
      </div>

      <VerificationCodeModal
        open={Boolean(otpLock)}
        email={otpLock?.email || ''}
        lockedUntil={otpLock?.lockedUntil ?? null}
        initialError={otpLock?.initialError}
        onClose={() => {
          rememberLockedEmail(null);
          setOtpLock(null);
        }}
        onVerified={() => {
          setOtpLock(null);
          setRemainingAttempts(null);
          setErrorMsg('');
          setInfoMsg('');
        }}
        onLockExpired={(unlockedEmail) => {
          rememberLockedEmail(null);
          setOtpLock(null);
          setRemainingAttempts(null);
          setErrorMsg('');
          setInfoMsg(
            tr(
              `El bloqueo temporal de 5 minutos para ${unlockedEmail} finalizó. Ya podés volver a intentar con tu contraseña.`,
              `The 5-minute temporary lock for ${unlockedEmail} has ended. You can try your password again.`,
              `O bloqueio temporário de 5 minutos para ${unlockedEmail} terminou. Você já pode tentar sua senha novamente.`
            )
          );
        }}
      />
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
  const { tr } = useI18n();
  const initialParts = (displayName || '').trim().split(/\s+/);
  const [firstName, setFirstName] = useState(initialParts[0] || '');
  const [lastName, setLastName] = useState(initialParts.slice(1).join(' ') || '');
  const [role, setRole] = useState<'admin' | 'operator'>('admin');
  const [language, setLanguage] = useState<LanguageCode>(() => getActiveLanguage());

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
      const safeLanguage = sanitizeLanguageCode(language);
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
        language: safeLanguage,
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
        subtitle: clampStr(encodedSubtitle, 2000),
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
      setActiveLanguage(safeLanguage);
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
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white font-display">
              {tr('Configurá tu taller', 'Set up your workshop', 'Configure sua oficina')}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {tr(
                'Completá tus datos, idioma, marca, moneda, logo y opciones visibles en cada boleta y presupuesto.',
                'Complete your details, language, brand, currency, logo, and receipt options.',
                'Preencha seus dados, idioma, marca, moeda, logotipo e opções dos comprovantes.'
              )}
            </p>
            {userEmail && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <Mail className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                <span>{userEmail}</span>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Idioma / Lenguaje */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
                <Globe className="h-4 w-4" />
              </span>
              <div>
                <label
                  htmlFor="onboarding-language-select"
                  className="block text-xs font-bold text-slate-800 dark:text-slate-100"
                >
                  {tr(
                    'Idioma / Lenguaje del sistema',
                    'System language',
                    'Idioma do sistema'
                  )}
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {tr(
                    'Podés cambiarlo en cualquier momento desde Configuración.',
                    'You can change it anytime from Settings.',
                    'Você pode alterá-lo a qualquer momento em Configurações.'
                  )}
                </p>
              </div>
            </div>
            <div className="mt-3">
              <select
                id="onboarding-language-select"
                value={language}
                onChange={(e) => {
                  const nextLang = sanitizeLanguageCode(e.target.value);
                  setLanguage(nextLang);
                  setActiveLanguage(nextLang);
                }}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Datos del responsable */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {tr('Nombre *', 'First name *', 'Nome *')}
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={tr('Tu nombre', 'Your first name', 'Seu nome')}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {tr('Apellido *', 'Last name *', 'Sobrenome *')}
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder={tr('Tu apellido', 'Your last name', 'Seu sobrenome')}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {tr('Tipo de acceso', 'Access role', 'Tipo de acesso')}
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'operator')}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="admin">{tr('Administrador', 'Administrator', 'Administrador')}</option>
                <option value="operator">{tr('Operador', 'Operator', 'Operador')}</option>
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
                {tr(
                  'Taller · Marca y comprobantes',
                  'Workshop · Brand & receipts',
                  'Oficina · Marca e comprovantes'
                )}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {tr(
                  'Todos estos datos se reflejan automáticamente en tus boletas A4, 80mm y PDF.',
                  'All these details are automatically reflected on your A4, 80mm, and PDF receipts.',
                  'Todos esses dados são exibidos automaticamente nos comprovantes A4, 80mm e PDF.'
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {tr('Nombre o marca del taller', 'Workshop brand name', 'Nome ou marca da oficina')}
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
                {tr('Subtítulo / Rubro del taller', 'Subtitle / Workshop specialty', 'Subtítulo / Especialidade')}
              </label>
              <input
                type="text"
                maxLength={80}
                value={subtitleText}
                onChange={(e) => setSubtitleText(e.target.value)}
                placeholder={tr(
                  'Ej: Servicio técnico especializado',
                  'e.g. Specialized repair shop',
                  'Ex: Assistência técnica especializada'
                )}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {tr('Teléfono del local', 'Shop phone', 'Telefone da loja')}
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
                {tr('Dirección del local', 'Shop address', 'Endereço da loja')}
              </label>
              <input
                type="text"
                maxLength={120}
                value={businessAddress}
                onChange={(e) => setBusinessAddress(e.target.value)}
                placeholder={tr('Av. Principal 1234', '1234 Main Ave', 'Av. Principal 1234')}
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
                    {tr(
                      'Moneda del taller, presupuestos y boletas',
                      'Workshop, quotes, and receipts currency',
                      'Moeda da oficina, orçamentos e comprovantes'
                    )}
                  </label>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr(
                      'Se aplica en presupuestos, señas, inventario, ventas, WhatsApp y boletas A4, 80mm y PDF.',
                      'Applies to quotes, deposits, inventory, sales, WhatsApp, and A4, 80mm, and PDF receipts.',
                      'Aplica-se a orçamentos, sinais, estoque, vendas, WhatsApp e comprovantes A4, 80mm e PDF.'
                    )}
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono-num text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300">
                {tr('Ej:', 'Ex:', 'Ex:')} {formatCurrency(15000, currency)}
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
                {tr(
                  'Opciones extra para mostrar en cada boleta',
                  'Extra details printed on receipts',
                  'Opções extras para exibir nos comprovantes'
                )}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {tr(
                  'Completá las que quieras imprimir en boletas de reparación, ventas, lotes y PDF.',
                  'Fill in whichever fields you want on repair, sales, batch, and PDF receipts.',
                  'Preencha os campos que deseja imprimir nos comprovantes e PDFs.'
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {tr('Horarios de atención', 'Business hours', 'Horário de atendimento')}
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder={tr(
                    'Ej: Lun a Vie 9:30 a 19:00 · Sáb 10 a 14',
                    'e.g. Mon–Fri 9:30–19:00 · Sat 10–14',
                    'Ex: Seg a Sex 9:30–19:00 · Sáb 10–14'
                  )}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {tr('Instagram / Web', 'Instagram / Website', 'Instagram / Site')}
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
                  {tr('CUIT / Documento comercial (opcional)', 'Tax ID / Business ID (optional)', 'CNPJ / Documento fiscal (opcional)')}
                </label>
                <input
                  type="text"
                  maxLength={60}
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder={tr('Ej: CUIT 20-12345678-9', 'e.g. Tax ID 12-3456789', 'Ex: CNPJ 12.345.678/0001-90')}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {tr('Email de contacto', 'Contact email', 'E-mail de contato')}
                </label>
                <input
                  type="email"
                  maxLength={100}
                  value={businessEmail}
                  onChange={(e) => setBusinessEmail(e.target.value)}
                  placeholder={tr('Ej: contacto@tutaller.com', 'e.g. contact@yourshop.com', 'Ex: contato@suaoficina.com')}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {tr(
                    'Garantía o mensaje destacado al pie de boleta',
                    'Warranty or footer note on receipts',
                    'Garantia ou mensagem de rodapé do comprovante'
                  )}
                </label>
                <input
                  type="text"
                  maxLength={180}
                  value={footerNote}
                  onChange={(e) => setFooterNote(e.target.value)}
                  placeholder={tr(
                    'Ej: Garantía 30 días sobre el trabajo realizado · ¡Gracias por elegirnos!',
                    'e.g. 30-day warranty on completed work · Thank you for choosing us!',
                    'Ex: Garantia de 30 dias no serviço realizado · Obrigado pela preferência!'
                  )}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Color por palabra y vista previa */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              {tr('Color por palabra y vista previa', 'Color per word & preview', 'Cor por palavra e pré-visualização')}
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
                <span>{tr('Logo del taller (opcional)', 'Workshop logo (optional)', 'Logotipo da oficina (opcional)')}</span>
              </div>
              {logoDataUrl && (
                <button
                  type="button"
                  onClick={() => setLogoDataUrl('')}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {tr('Quitar logo', 'Remove logo', 'Remover logotipo')}
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
                    alt={tr('Vista previa del logo', 'Logo preview', 'Pré-visualização do logotipo')}
                    referrerPolicy="no-referrer"
                    style={{ height: `${Math.round((48 * logoScale) / 100)}px` }}
                    className="max-w-full object-contain"
                  />
                </div>
              ) : (
                <>
                  <UploadCloud className="h-7 w-7 text-slate-400" />
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    <strong>{tr('Clic para seleccionar', 'Click to select', 'Clique para selecionar')}</strong>{' '}
                    {tr('o arrastrá una imagen', 'or drag an image here', 'ou arraste uma imagem')}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {tr('PNG transparente recomendado · Máx 2 MB', 'Transparent PNG recommended · Max 2 MB', 'PNG transparente recomendado · Máx 2 MB')}
                  </div>
                </>
              )}
            </label>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
                <span>{tr('Tamaño del logo', 'Logo size', 'Tamanho do logotipo')}</span>
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
                  {tr('Mi logo tiene fondo transparente', 'My logo has a transparent background', 'Meu logotipo tem fundo transparente')}
                </strong>
                {tr(
                  'Si subiste un JPG o PNG con fondo blanco, desmarcalo para mostrarlo sobre un recuadro claro.',
                  'If you uploaded a JPG or PNG with a white background, uncheck to display it on a light badge.',
                  'Se você enviou um JPG ou PNG com fundo branco, desmarque para exibi-lo em um quadro claro.'
                )}
              </span>
            </label>
          </div>

          {/* Términos y condiciones */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              {tr('Términos y condiciones', 'Terms and conditions', 'Termos e condições')}
            </label>
            <textarea
              rows={4}
              maxLength={2000}
              value={receiptTerms}
              onChange={(e) => setReceiptTerms(e.target.value)}
              placeholder={tr(
                'Escribí los términos y condiciones que aparecerán en la boleta del cliente...',
                'Write the terms and conditions shown on the customer receipt...',
                'Escreva os termos e condições que aparecerão no comprovante do cliente...'
              )}
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {/* URL pública de seguimiento */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              {tr(
                'Dirección pública del sitio para links de seguimiento (opcional)',
                'Public site URL for tracking links (optional)',
                'Endereço público do site para links de acompanhamento (opcional)'
              )}
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
              {tr('Cerrar sesión', 'Sign out', 'Sair')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-11 flex-1 rounded-xl bg-[#0072BB] px-5 text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
            >
              {saving
                ? tr('Guardando...', 'Saving...', 'Salvando...')
                : tr('Comenzar a usar el taller', 'Start using workshop', 'Começar a usar a oficina')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
