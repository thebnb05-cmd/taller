import { useSyncExternalStore } from 'react';
import { getPreferenceCookie, setPreferenceCookie } from './cookieStorage';

export type LanguageCode = 'es' | 'en' | 'pt';

export interface LanguageOption {
  code: LanguageCode;
  name: string;
  label: string;
  locale: string;
}

export const DEFAULT_LANGUAGE: LanguageCode = 'es';

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  {
    code: 'es',
    name: 'Español',
    label: 'Español (Argentina / LatAm)',
    locale: 'es-AR',
  },
  {
    code: 'en',
    name: 'English',
    label: 'English (US / International)',
    locale: 'en-US',
  },
  {
    code: 'pt',
    name: 'Português',
    label: 'Português (Brasil)',
    locale: 'pt-BR',
  },
];

const LANGUAGE_MAP = new Map<LanguageCode, LanguageOption>(
  LANGUAGE_OPTIONS.map((opt) => [opt.code, opt])
);

const LANGUAGE_COOKIE_KEY = 'th3bnb_lang';
const LANGUAGE_STORAGE_KEY = 'th3bnb-lang';

export function isValidLanguageCode(raw: unknown): raw is LanguageCode {
  if (typeof raw !== 'string') return false;
  const normalized = raw.trim().toLowerCase().slice(0, 2) as LanguageCode;
  return LANGUAGE_MAP.has(normalized);
}

export function sanitizeLanguageCode(raw: unknown): LanguageCode {
  if (typeof raw !== 'string') return DEFAULT_LANGUAGE;
  const normalized = raw.trim().toLowerCase().slice(0, 2) as LanguageCode;
  return LANGUAGE_MAP.has(normalized) ? normalized : DEFAULT_LANGUAGE;
}

export function getLanguageOption(code?: unknown): LanguageOption {
  const valid = sanitizeLanguageCode(code);
  return LANGUAGE_MAP.get(valid) ?? LANGUAGE_OPTIONS[0];
}

export function getIntlLocale(code?: LanguageCode): string {
  return getLanguageOption(code ?? activeLanguage).locale;
}

function readInitialLanguage(): LanguageCode {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  const fromCookie = getPreferenceCookie(LANGUAGE_COOKIE_KEY);
  if (fromCookie && isValidLanguageCode(fromCookie)) {
    return sanitizeLanguageCode(fromCookie);
  }
  try {
    const fromStorage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (fromStorage && isValidLanguageCode(fromStorage)) {
      return sanitizeLanguageCode(fromStorage);
    }
  } catch {
    // Ignore storage access errors
  }
  return DEFAULT_LANGUAGE;
}

let activeLanguage: LanguageCode = readInitialLanguage();
if (typeof document !== 'undefined') {
  document.documentElement.lang = activeLanguage;
}

const languageListeners = new Set<() => void>();

export function getActiveLanguage(): LanguageCode {
  return activeLanguage;
}

export function setActiveLanguage(code: unknown): LanguageCode {
  const next = sanitizeLanguageCode(code);
  if (typeof window !== 'undefined') {
    setPreferenceCookie(LANGUAGE_COOKIE_KEY, next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Ignore storage access errors
    }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
  }
  if (next !== activeLanguage) {
    activeLanguage = next;
    languageListeners.forEach((listener) => listener());
  }
  return next;
}

export function subscribeLanguageChange(listener: () => void): () => void {
  languageListeners.add(listener);
  return () => {
    languageListeners.delete(listener);
  };
}

export function useActiveLanguage(): LanguageCode {
  return useSyncExternalStore(
    subscribeLanguageChange,
    getActiveLanguage,
    () => DEFAULT_LANGUAGE
  );
}

export function tr(
  es: string,
  en: string,
  pt: string,
  lang: LanguageCode = activeLanguage
): string {
  if (lang === 'en') return en;
  if (lang === 'pt') return pt;
  return es;
}

export function useI18n() {
  const lang = useActiveLanguage();
  return {
    lang,
    locale: getIntlLocale(lang),
    setLanguage: setActiveLanguage,
    tr: (es: string, en: string, pt: string) => tr(es, en, pt, lang),
  };
}

export const REPAIR_STATUS_LABELS: Record<
  string,
  { es: string; en: string; pt: string }
> = {
  recibido: { es: 'Recibido', en: 'Received', pt: 'Recebido' },
  diagnostico: { es: 'Diagnóstico', en: 'Diagnostics', pt: 'Diagnóstico' },
  espera_repuesto: {
    es: 'Espera repuesto',
    en: 'Waiting for parts',
    pt: 'Aguardando peça',
  },
  en_progreso: { es: 'En progreso', en: 'In progress', pt: 'Em andamento' },
  listo: {
    es: 'Listo para entregar',
    en: 'Ready for pickup',
    pt: 'Pronto para retirada',
  },
  entregado: { es: 'Entregado', en: 'Delivered', pt: 'Entregue' },
};

export function getTranslatedStatusLabel(
  status: string,
  lang: LanguageCode = activeLanguage
): string {
  const entry = REPAIR_STATUS_LABELS[status];
  if (!entry) return status;
  return entry[lang] ?? entry.es;
}

const TOAST_TRANSLATIONS: Record<string, { en: string; pt: string }> = {
  'Configuración del taller actualizada.': {
    en: 'Workshop settings updated.',
    pt: 'Configurações da oficina atualizadas.',
  },
  'Perfil del taller guardado correctamente.': {
    en: 'Workshop profile saved successfully.',
    pt: 'Perfil da oficina salvo com sucesso.',
  },
  'Sesión iniciada correctamente.': {
    en: 'Signed in successfully.',
    pt: 'Sessão iniciada com sucesso.',
  },
  'Cuenta creada e iniciada correctamente.': {
    en: 'Account created and signed in.',
    pt: 'Conta criada e sessão iniciada.',
  },
  'Tu cuenta y todos los datos del taller fueron eliminados.': {
    en: 'Your account and all workshop data were deleted.',
    pt: 'Sua conta e todos os dados da oficina foram excluídos.',
  },
  'Error al guardar la configuración.': {
    en: 'Could not save settings.',
    pt: 'Erro ao salvar configurações.',
  },
  'Reparación actualizada.': {
    en: 'Repair updated.',
    pt: 'Reparo atualizado.',
  },
  'Enlace de seguimiento copiado.': {
    en: 'Tracking link copied.',
    pt: 'Link de acompanhamento copiado.',
  },
  'Producto eliminado.': {
    en: 'Product deleted.',
    pt: 'Produto excluído.',
  },
  'Suscripción activada con Mercado Pago.': {
    en: 'Subscription activated with Mercado Pago.',
    pt: 'Assinatura ativada com o Mercado Pago.',
  },
  'Pago verificado. Suscripción activada correctamente.': {
    en: 'Payment verified. Subscription activated.',
    pt: 'Pagamento verificado. Assinatura ativada com sucesso.',
  },
  'Todavía figura pendiente en Mercado Pago. Completá el pago e intentá nuevamente.': {
    en: 'Still pending in Mercado Pago. Complete the payment and try again.',
    pt: 'Ainda pendente no Mercado Pago. Conclua o pagamento e tente novamente.',
  },
  'No se pudo copiar automáticamente.': {
    en: 'Could not copy automatically.',
    pt: 'Não foi possível copiar automaticamente.',
  },
  'El email de contacto del taller no tiene un formato válido.': {
    en: 'The workshop contact email format is invalid.',
    pt: 'O e-mail de contato da oficina não tem um formato válido.',
  },
  'La dirección del sitio de seguimiento debe empezar con https:// o http://': {
    en: 'The tracking site URL must start with https:// or http://',
    pt: 'O endereço do site de acompanhamento deve começar com https:// ou http://',
  },
  'Completá tu nombre y apellido.': {
    en: 'Please enter your first and last name.',
    pt: 'Preencha seu nome e sobrenome.',
  },
  'Ese técnico ya está en la lista.': {
    en: 'That technician is already on the list.',
    pt: 'Esse técnico já está na lista.',
  },
  'Usá una imagen PNG, JPG o WebP.': {
    en: 'Use a PNG, JPG, or WebP image.',
    pt: 'Use uma imagem PNG, JPG ou WebP.',
  },
  'El logo no puede superar los 2 MB.': {
    en: 'Logo file size cannot exceed 2 MB.',
    pt: 'O logotipo não pode ultrapassar 2 MB.',
  },
  'No hay clientes para exportar con el filtro actual.': {
    en: 'There are no clients to export with the current filter.',
    pt: 'Não há clientes para exportar com o filtro atual.',
  },
};

export function translateToastMessage(
  message: string,
  lang: LanguageCode = activeLanguage
): string {
  if (lang === 'es') return message;
  const hit = TOAST_TRANSLATIONS[message];
  if (hit) return hit[lang];
  return message;
}
