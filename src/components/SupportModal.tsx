import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  Mail,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '../lib/db';
import type { PageId, WorkshopProfile } from '../types/workshop';
import { sanitizePhone, sanitizePlainLine, sanitizeText } from '../utils/validation';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';
import { useI18n } from '../utils/i18n';

interface SupportModalProps {
  open: boolean;
  onClose: () => void;
  profile: WorkshopProfile;
  userEmail?: string | null;
  currentPage: PageId;
}

type SupportCategory = 'falla' | 'consulta' | 'mejora';

interface SupportStatusResponse {
  ok?: boolean;
  configured?: boolean;
  isAdmin?: boolean;
  telegramConfigured?: boolean;
  emailConfigured?: boolean;
  targetEmail?: string;
}

const CATEGORIES: Array<{
  id: SupportCategory;
  label: string;
  desc: string;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    id: 'falla',
    label: 'Falla o error',
    desc: 'Algo no funciona como esperabas',
    icon: AlertTriangle,
  },
  {
    id: 'consulta',
    label: 'Consulta',
    desc: 'Dudas sobre uso, pagos o cuenta',
    icon: HelpCircle,
  },
  {
    id: 'mejora',
    label: 'Mejora',
    desc: 'Ideas para sumar al sistema',
    icon: Lightbulb,
  },
];

export const SupportModal: React.FC<SupportModalProps> = ({
  open,
  onClose,
  profile,
  userEmail,
  currentPage,
}) => {
  const { notify } = useToast();
  const { tr } = useI18n();
  const [category, setCategory] = useState<SupportCategory>('consulta');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [contactPhone, setContactPhone] = useState(profile.businessPhone || '');
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [status, setStatus] = useState<SupportStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const senderEmail = (userEmail || profile.email || '').trim();
  const isAdminAccount = senderEmail.toLowerCase() === 'thebnb05@gmail.com';

  useEffect(() => {
    if (!open) return;
    setSentOk(false);
    setErrorMsg('');
    setSubject('');
    setMessage('');
    setContactPhone(profile.businessPhone || '');

    let active = true;
    setLoadingStatus(true);
    void supabase.auth
      .getSession()
      .then(async ({ data }) => {
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch('/api/support/status', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        });
        const json = (await res.json().catch(() => null)) as SupportStatusResponse | null;
        if (active && json && res.ok) {
          setStatus(json);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingStatus(false);
      });

    return () => {
      active = false;
    };
  }, [open, profile.businessPhone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSubject = sanitizePlainLine(subject, 120);
    const cleanMessage = sanitizeText(message, 2000);
    const cleanPhone = sanitizePhone(contactPhone, 40);

    if (cleanSubject.length < 3) {
      setErrorMsg('Escribí un asunto breve (mínimo 3 caracteres).');
      return;
    }
    if (cleanMessage.length < 10) {
      setErrorMsg('Contanos un poco más de detalle (mínimo 10 caracteres).');
      return;
    }

    setSending(true);
    setErrorMsg('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setErrorMsg('Tu sesión expiró. Recargá la página e intentá nuevamente.');
        return;
      }

      const res = await fetch('/api/support/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category,
          subject: cleanSubject,
          message: cleanMessage,
          workshopName: sanitizePlainLine(profile.brandName || 'TH3 BNB', 80),
          contactPhone: cleanPhone,
          currentPage,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !payload.ok) {
        setErrorMsg(
          payload.error || 'No se pudo enviar el mensaje en este momento. Intentá más tarde.'
        );
        return;
      }

      setSentOk(true);
      setSubject('');
      setMessage('');
      notify('Mensaje enviado. Te responderemos a la brevedad.');
    } catch {
      setErrorMsg('Error de conexión al enviar tu mensaje. Verificá tu internet e intentá otra vez.');
    } finally {
      setSending(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={tr('Soporte, consultas y mejoras', 'Support, questions & feedback', 'Suporte, dúvidas e melhorias')}
      subtitle={tr(
        'Escribinos directo si encontraste una falla, tenés dudas o querés sugerir mejoras',
        'Message us directly if you found a bug, have questions or want to suggest features',
        'Fale conosco se encontrou um erro, tem dúvidas ou quer sugerir melhorias'
      )}
      maxWidth="lg"
    >
      <div className="space-y-4">
        {sentOk ? (
          <div className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 text-center dark:border-emerald-900/60 dark:bg-emerald-950/30">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white font-display">
                ¡Mensaje enviado!
              </h3>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                Recibimos tu mensaje al instante. Te responderemos a{' '}
                <strong className="text-slate-900 dark:text-white">{senderEmail || 'tu correo'}</strong>
                {contactPhone ? ` o por WhatsApp al ${contactPhone}` : ''}.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSentOk(false)}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Enviar otro mensaje
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-xl bg-[#0072BB] px-4 text-xs font-semibold text-white hover:bg-[#005f9c]"
              >
                Volver al taller
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Motivo del mensaje
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const active = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id)}
                      className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${
                        active
                          ? 'border-[#0072BB] bg-sky-50/80 text-[#0072BB] dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-300'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-bold">{cat.label}</div>
                        <div className="text-[11px] opacity-80">{cat.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Remitente verificado
                </div>
                <div className="mt-0.5 truncate text-xs font-bold text-slate-800 dark:text-slate-100">
                  {profile.brandName || 'Mi Taller'}
                </div>
                <div className="flex items-center gap-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                  <Mail className="h-3 w-3 shrink-0" />
                  <span className="truncate">{senderEmail}</span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="support-phone-input"
                  className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  WhatsApp / Teléfono de contacto (opcional)
                </label>
                <input
                  id="support-phone-input"
                  type="tel"
                  maxLength={40}
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="Ej: 11-5555-0199"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="support-subject-input"
                className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Asunto *
              </label>
              <input
                id="support-subject-input"
                type="text"
                required
                minLength={3}
                maxLength={120}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={
                  category === 'falla'
                    ? 'Ej: Error al imprimir boleta 80mm'
                    : category === 'mejora'
                      ? 'Ej: Agregar recordatorio automático por WhatsApp'
                      : 'Ej: Consulta sobre configuración de Mercado Pago'
                }
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label
                  htmlFor="support-message-input"
                  className="text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Detalle del mensaje *
                </label>
                <span className="font-mono-num text-[11px] text-slate-400">
                  {message.length}/2000
                </span>
              </div>
              <textarea
                id="support-message-input"
                required
                minLength={10}
                maxLength={2000}
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describí qué pasó, qué necesitás consultar o qué mejora te ayudaría en el día a día del taller..."
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            {!loadingStatus && status && !status.configured && !isAdminAccount && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                El canal de recepción instantánea todavía se está terminando de activar en el servidor.
              </div>
            )}

            {errorMsg && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                {errorMsg}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="h-11 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={sending}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0072BB] px-5 text-sm font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                <span>{sending ? 'Enviando...' : 'Enviar mensaje'}</span>
              </button>
            </div>
          </form>
        )}

        {isAdminAccount && status?.isAdmin && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-800/50">
            <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-100">
              <ShieldCheck className="h-4 w-4 text-[#0072BB]" />
              <span>Estado de recepción instantánea (solo administrador)</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <div className="font-semibold text-slate-700 dark:text-slate-200">Telegram Bot</div>
                <div
                  className={`mt-0.5 text-[11px] font-semibold ${
                    status.telegramConfigured
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {status.telegramConfigured
                    ? 'Activo (aviso directo al chat)'
                    : 'Pendiente (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)'}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <div className="font-semibold text-slate-700 dark:text-slate-200">
                  Email ({status.targetEmail || 'thebnb05@gmail.com'})
                </div>
                <div
                  className={`mt-0.5 text-[11px] font-semibold ${
                    status.emailConfigured
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {status.emailConfigured
                    ? 'Activo vía Resend (con Reply-To al taller)'
                    : 'Pendiente (RESEND_API_KEY)'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
};
