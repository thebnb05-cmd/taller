import React, { useMemo } from 'react';
import { Keyboard, Navigation, Plus, SlidersHorizontal } from 'lucide-react';
import { useI18n } from '../utils/i18n';
import {
  formatShortcutKey,
  GLOBAL_SHORTCUTS,
  isMacPlatform,
  type ShortcutActionId,
  type ShortcutCategory,
  type ShortcutDefinition,
} from '../utils/keyboardShortcuts';
import { ModalShell } from './ModalShell';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
  enabled: boolean;
  onToggleEnabled: (next: boolean) => void;
  onRunAction: (actionId: ShortcutActionId) => void;
}

const KeyComboBadges: React.FC<{ keys: string[]; isMac: boolean }> = ({ keys, isMac }) => (
  <span className="inline-flex items-center gap-1">
    {keys.map((k, idx) => (
      <React.Fragment key={`${k}-${idx}`}>
        {idx > 0 && <span className="text-[10px] text-slate-400">+</span>}
        <kbd className="inline-flex min-w-[24px] items-center justify-center rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono-num text-[11px] font-semibold text-slate-700 shadow-2xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {formatShortcutKey(k, isMac)}
        </kbd>
      </React.Fragment>
    ))}
  </span>
);

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  open,
  onClose,
  enabled,
  onToggleEnabled,
  onRunAction,
}) => {
  const { lang, tr } = useI18n();
  const isMac = useMemo(() => isMacPlatform(), []);

  const sections = useMemo<
    Array<{
      category: ShortcutCategory;
      title: string;
      icon: React.FC<{ className?: string }>;
      items: ShortcutDefinition[];
    }>
  >(
    () => [
      {
        category: 'actions',
        title: tr('Acciones rápidas', 'Quick actions', 'Ações rápidas'),
        icon: Plus,
        items: GLOBAL_SHORTCUTS.filter((s) => s.category === 'actions'),
      },
      {
        category: 'navigation',
        title: tr('Navegación entre secciones', 'Section navigation', 'Navegação entre seções'),
        icon: Navigation,
        items: GLOBAL_SHORTCUTS.filter((s) => s.category === 'navigation'),
      },
      {
        category: 'system',
        title: tr('Sistema y búsqueda', 'System & search', 'Sistema e busca'),
        icon: SlidersHorizontal,
        items: GLOBAL_SHORTCUTS.filter((s) => s.category === 'system'),
      },
    ],
    [tr]
  );

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={tr('Atajos de teclado', 'Keyboard shortcuts', 'Atalhos de teclado')}
      subtitle={tr(
        'Acelerá la carga de reparaciones, ventas y navegación desde el escritorio.',
        'Speed up repairs, sales, and navigation on desktop.',
        'Acelere o registro de reparos, vendas e navegação no computador.'
      )}
      maxWidth="2xl"
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-[#0072BB] dark:bg-sky-950/70 dark:text-sky-400">
              <Keyboard className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {tr(
                  'Atajos globales de escritorio',
                  'Global desktop shortcuts',
                  'Atalhos globais de computador'
                )}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {enabled
                  ? tr(
                      'Activos mientras no estés escribiendo en un formulario.',
                      'Active whenever you are not typing inside an input.',
                      'Ativos quando você não estiver digitando em um formulário.'
                    )
                  : tr(
                      'Desactivados temporalmente (podés reactivarlos cuando quieras).',
                      'Temporarily disabled (re-enable anytime).',
                      'Desativados temporariamente (ative quando quiser).'
                    )}
              </div>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => onToggleEnabled(!enabled)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
              enabled ? 'bg-[#0072BB]' : 'bg-slate-300 dark:bg-slate-700'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="rounded-xl border border-sky-200/80 bg-sky-50/70 px-3.5 py-2.5 text-xs text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
          {tr(
            'Tip: Si tu navegador reserva Ctrl + N para abrir una ventana nueva, usá Alt + N para abrir Nueva reparación al instante, o hacé clic sobre cualquier atajo abajo para ejecutarlo.',
            'Tip: If your browser reserves Ctrl + N for a new window, use Alt + N to open New repair instantly, or click any shortcut below to run it.',
            'Dica: Se o navegador reservar Ctrl + N para abrir uma nova janela, use Alt + N para abrir Novo reparo na hora, ou clique em qualquer atalho abaixo para executar.'
          )}
        </div>

        <div className="space-y-5">
          {sections.map((section) => {
            const SectionIcon = section.icon;
            return (
              <div key={section.category}>
                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <SectionIcon className="h-3.5 w-3.5 text-[#0072BB] dark:text-sky-400" />
                  <span>{section.title}</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {section.items.map((item) => {
                    const labelText = item.label[lang] || item.label.es;
                    const rowContent = (
                      <>
                        <span className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                          {labelText}
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <KeyComboBadges keys={item.keys} isMac={isMac} />
                          {item.altKeys && (
                            <>
                              <span className="text-[10px] text-slate-400">/</span>
                              <KeyComboBadges keys={item.altKeys} isMac={isMac} />
                            </>
                          )}
                        </div>
                      </>
                    );

                    if (item.clickable) {
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onClose();
                            onRunAction(item.id);
                          }}
                          className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-[#0072BB]/50 hover:bg-sky-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-500/40 dark:hover:bg-slate-800/70"
                        >
                          {rowContent}
                        </button>
                      );
                    }

                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60"
                      >
                        {rowContent}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ModalShell>
  );
};
