import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  QrCode,
  RefreshCw,
  Save,
  Smartphone,
  Trash2,
} from 'lucide-react';
import {
  hydrateMercadoPagoConfig,
  loadMercadoPagoConfig,
  saveMercadoPagoConfig,
  testMercadoPagoConnection,
  type MercadoPagoConfig,
  type MpPosSummary,
  type MpTerminalSummary,
} from '../utils/mercadoPago';
import {
  parseWorkshopMeta,
  saveMercadoPagoConfigToProfile,
} from '../utils/workshopMeta';
import type { WorkshopProfile } from '../types/workshop';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';

interface PaymentSettingsPanelProps {
  ownerId: string;
  profile?: WorkshopProfile | null;
  onSaved?: (config: MercadoPagoConfig) => void;
  compact?: boolean;
}

export const PaymentSettingsPanel: React.FC<PaymentSettingsPanelProps> = ({
  ownerId,
  profile,
  onSaved,
  compact = false,
}) => {
  const { notify } = useToast();
  const [config, setConfig] = useState<MercadoPagoConfig>(() => loadMercadoPagoConfig(ownerId));
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [terminals, setTerminals] = useState<MpTerminalSummary[]>([]);
  const [posList, setPosList] = useState<MpPosSummary[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const profileMp = profile ? parseWorkshopMeta(profile).mercadoPago : undefined;
    const localMp = loadMercadoPagoConfig(ownerId);
    setConfig(localMp.accessToken || localMp.terminalId || localMp.posExternalId ? localMp : profileMp || localMp);
    void hydrateMercadoPagoConfig(ownerId).then((hydrated) => {
      if (cancelled) return;
      if (hydrated.accessToken || hydrated.terminalId || hydrated.posExternalId) {
        setConfig(hydrated);
      } else if (profileMp) {
        setConfig(saveMercadoPagoConfig(ownerId, profileMp));
      } else {
        setConfig(hydrated);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ownerId, profile]);

  const persistMpConfig = async (nextConfig: MercadoPagoConfig, successMessage: string) => {
    setSavingConfig(true);
    try {
      const saved = profile
        ? await saveMercadoPagoConfigToProfile(profile, nextConfig)
        : saveMercadoPagoConfig(ownerId, nextConfig);
      setConfig(saved);
      notify(successMessage);
      onSaved?.(saved);
    } catch {
      const savedLocal = saveMercadoPagoConfig(ownerId, nextConfig);
      setConfig(savedLocal);
      notify(`${successMessage} (solo en este dispositivo por error de red)`);
      onSaved?.(savedLocal);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSave = () => {
    void persistMpConfig(config, 'Configuración de Mercado Pago guardada en tu cuenta.');
  };

  const handleClear = () => {
    const empty: MercadoPagoConfig = {
      accessToken: '',
      posExternalId: '',
      terminalId: '',
      printOnTerminal: false,
      sellerNickname: '',
      sellerEmail: '',
    };
    setTerminals([]);
    setPosList([]);
    setConnectionStatus('idle');
    setConnectionMessage('');
    void persistMpConfig(empty, 'Credenciales de Mercado Pago eliminadas de tu cuenta.');
  };

  const handleTestConnection = async () => {
    const trimmedToken = config.accessToken.trim();
    if (!trimmedToken) {
      notify('Ingresá tu Access Token de Mercado Pago antes de probar.', 'error');
      return;
    }

    setTesting(true);
    setConnectionStatus('idle');
    setConnectionMessage('');

    try {
      const result = await testMercadoPagoConnection(trimmedToken);
      if (!result.ok) {
        setConnectionStatus('error');
        setConnectionMessage(result.error || 'No se pudo validar el Access Token.');
        notify(result.error || 'Error al conectar con Mercado Pago.', 'error');
        return;
      }

      const foundTerminals = result.terminals || [];
      const foundPos = result.posList || [];
      setTerminals(foundTerminals);
      setPosList(foundPos);

      const nextConfig: MercadoPagoConfig = {
        ...config,
        accessToken: trimmedToken,
        sellerNickname: result.account?.nickname || config.sellerNickname,
        sellerEmail: result.account?.email || config.sellerEmail,
        terminalId: config.terminalId || foundTerminals[0]?.id || '',
        posExternalId:
          config.posExternalId ||
          foundTerminals[0]?.externalPosId ||
          foundPos[0]?.externalId ||
          '',
      };

      if (profile) {
        void saveMercadoPagoConfigToProfile(profile, nextConfig)
          .then((saved) => {
            setConfig(saved);
            onSaved?.(saved);
          })
          .catch(() => {
            const savedLocal = saveMercadoPagoConfig(ownerId, nextConfig);
            setConfig(savedLocal);
            onSaved?.(savedLocal);
          });
      } else {
        setConfig(nextConfig);
        saveMercadoPagoConfig(ownerId, nextConfig);
        onSaved?.(nextConfig);
      }

      setConnectionStatus('ok');
      const accountLabel =
        result.account?.nickname || result.account?.email || result.account?.sellerId || 'Cuenta verificada';
      setConnectionMessage(
        `Conectado: ${accountLabel} · ${foundTerminals.length} terminal(es) Point y ${foundPos.length} caja(s) QR detectadas.`
      );
      notify('Conexión con Mercado Pago verificada.');
    } catch {
      setConnectionStatus('error');
      setConnectionMessage('Error de red al comunicarse con el servidor.');
      notify('No se pudo probar la conexión.', 'error');
    } finally {
      setTesting(false);
    }
  };

  const isConfigured = Boolean(
    config.accessToken.trim() && (config.terminalId.trim() || config.posExternalId.trim())
  );

  return (
    <div
      className={`space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40 ${
        compact ? 'p-3.5' : 'p-4'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-[#0072BB] dark:bg-sky-950/60 dark:text-sky-300">
            <CreditCard className="h-4 w-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                Configuración de pagos · Mercado Pago (Point y QR)
              </h4>
              {isConfigured && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  Configurado
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Conectá tu Access Token de producción/prueba y tu ID de dispositivo Point o Caja POS para cobrar directo desde Nueva venta.
            </p>
          </div>
        </div>

        {isConfigured && (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <Trash2 className="h-3 w-3" />
            Limpiar
          </button>
        )}
      </div>

      <div>
        <label
          htmlFor="mp-access-token"
          className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300"
        >
          Access Token de Mercado Pago
        </label>
        <div className="relative">
          <input
            id="mp-access-token"
            type={showToken ? 'text' : 'password'}
            value={config.accessToken}
            onChange={(e) => setConfig((prev) => ({ ...prev, accessToken: e.target.value }))}
            placeholder="APP_USR-... o TEST-..."
            autoComplete="off"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-3 pr-10 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
          <button
            type="button"
            onClick={() => setShowToken((prev) => !prev)}
            aria-label={showToken ? 'Ocultar Access Token' : 'Mostrar Access Token'}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="mp-terminal-id"
            className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            <Smartphone className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
            <span>ID dispositivo físico (Point)</span>
          </label>
          <input
            id="mp-terminal-id"
            type="text"
            value={config.terminalId}
            onChange={(e) => setConfig((prev) => ({ ...prev, terminalId: e.target.value }))}
            placeholder="Ej: NEWLAND_N950__SBX0001 o PAX_A910__..."
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </div>

        <div>
          <label
            htmlFor="mp-pos-id"
            className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            <QrCode className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
            <span>ID punto de venta / Caja (QR)</span>
          </label>
          <input
            id="mp-pos-id"
            type="text"
            value={config.posExternalId}
            onChange={(e) => setConfig((prev) => ({ ...prev, posExternalId: e.target.value }))}
            placeholder="Ej: CAJA01 o SUC01POS01"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono-num text-xs text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          checked={config.printOnTerminal}
          onChange={(e) =>
            setConfig((prev) => ({ ...prev, printOnTerminal: e.target.checked }))
          }
          className="h-4 w-4 rounded accent-[#0072BB]"
        />
        <span>Imprimir comprobante físico en la terminal Point Smart al aprobar</span>
      </label>

      {connectionMessage && (
        <div
          className={`rounded-xl border px-3 py-2 text-xs ${
            connectionStatus === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
          }`}
        >
          {connectionMessage}
        </div>
      )}

      {terminals.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Dispositivos Point detectados (tocá para seleccionar):
          </div>
          <div className="flex flex-wrap gap-1.5">
            {terminals.map((term) => {
              const active = config.terminalId === term.id;
              return (
                <button
                  key={term.id}
                  type="button"
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      terminalId: term.id,
                      posExternalId: prev.posExternalId || term.externalPosId || prev.posExternalId,
                    }))
                  }
                  className={`rounded-lg border px-2.5 py-1 font-mono-num text-[11px] font-medium transition ${
                    active
                      ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] dark:border-sky-400 dark:bg-sky-950/60 dark:text-sky-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  {term.id}
                  {term.operatingMode ? ` · ${term.operatingMode}` : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {posList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Cajas / Puntos de venta QR detectados (tocá para seleccionar):
          </div>
          <div className="flex flex-wrap gap-1.5">
            {posList.map((pos) => {
              const active = config.posExternalId === pos.externalId;
              return (
                <button
                  key={pos.id || pos.externalId}
                  type="button"
                  onClick={() =>
                    setConfig((prev) => ({ ...prev, posExternalId: pos.externalId }))
                  }
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                    active
                      ? 'border-[#0072BB] bg-sky-50 text-[#0072BB] dark:border-sky-400 dark:bg-sky-950/60 dark:text-sky-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  {pos.name} (<span className="font-mono-num">{pos.externalId}</span>)
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => void handleTestConnection()}
          disabled={testing || !config.accessToken.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {testing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Probar y detectar dispositivos
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={savingConfig}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white transition hover:bg-[#005f9c] disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" />
          {savingConfig ? 'Guardando...' : 'Guardar pagos'}
        </button>
      </div>
    </div>
  );
};

interface PaymentSettingsModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  profile?: WorkshopProfile | null;
  onSaved?: (config: MercadoPagoConfig) => void;
}

export const PaymentSettingsModal: React.FC<PaymentSettingsModalProps> = ({
  open,
  onClose,
  ownerId,
  profile,
  onSaved,
}) => {
  return (
    <ModalShell open={open} onClose={onClose} title="Configuración de pagos · Mercado Pago" maxWidth="lg">
      <div className="space-y-4">
        <PaymentSettingsPanel
          ownerId={ownerId}
          profile={profile}
          onSaved={(saved) => {
            onSaved?.(saved);
            onClose();
          }}
        />
      </div>
    </ModalShell>
  );
};
