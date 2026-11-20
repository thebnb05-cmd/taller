import { useEffect, useRef } from 'react';
import { isEditableElement, type ShortcutActionId } from '../utils/keyboardShortcuts';

interface UseGlobalShortcutsOptions {
  enabled: boolean;
  hasBlockingModalOpen: boolean;
  shortcutsModalOpen: boolean;
  onTrigger: (actionId: ShortcutActionId) => void;
  onToggleShortcutsModal: () => void;
  onEscape?: () => void;
}

const ALT_CODE_TO_ACTION: Record<string, ShortcutActionId> = {
  KeyN: 'new_repair',
  KeyC: 'new_client',
  KeyP: 'new_product',
  KeyV: 'new_sale',
  KeyT: 'new_task',
  KeyB: 'new_purchase',
  KeyS: 'open_settings',
  KeyD: 'toggle_dark',
  Digit1: 'nav_home',
  Digit2: 'nav_repairs',
  Digit3: 'nav_agenda',
  Digit4: 'nav_clients',
  Digit5: 'nav_inventory',
  Digit6: 'nav_suppliers',
  Digit7: 'nav_purchases',
  Digit8: 'nav_sales',
  Digit9: 'nav_cash',
  Digit0: 'nav_reports',
};

export function useGlobalShortcuts({
  enabled,
  hasBlockingModalOpen,
  shortcutsModalOpen,
  onTrigger,
  onToggleShortcutsModal,
  onEscape,
}: UseGlobalShortcutsOptions): void {
  const optionsRef = useRef({
    enabled,
    hasBlockingModalOpen,
    shortcutsModalOpen,
    onTrigger,
    onToggleShortcutsModal,
    onEscape,
  });

  optionsRef.current = {
    enabled,
    hasBlockingModalOpen,
    shortcutsModalOpen,
    onTrigger,
    onToggleShortcutsModal,
    onEscape,
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing) return;

      const state = optionsRef.current;
      const inEditable = isEditableElement(e.target);
      const hasPrimaryMod = (e.ctrlKey || e.metaKey) && !e.altKey;

      // Ctrl+/ or Cmd+/ toggles the keyboard shortcuts guide
      if (hasPrimaryMod && !e.shiftKey && (e.key === '/' || e.code === 'Slash')) {
        if (state.hasBlockingModalOpen) return;
        e.preventDefault();
        e.stopPropagation();
        state.onToggleShortcutsModal();
        return;
      }

      // '?' opens/toggles the shortcuts guide when outside editable inputs and no other modal is open
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key === '?' &&
        !inEditable &&
        !state.hasBlockingModalOpen
      ) {
        e.preventDefault();
        e.stopPropagation();
        state.onToggleShortcutsModal();
        return;
      }

      if (e.key === 'Escape' && state.onEscape) {
        state.onEscape();
      }

      if (!state.enabled || state.hasBlockingModalOpen || state.shortcutsModalOpen) {
        return;
      }

      // Ctrl+N / Cmd+N -> New Repair (works even if search/filter input is focused)
      if (
        hasPrimaryMod &&
        !e.shiftKey &&
        (e.code === 'KeyN' || e.key.toLowerCase() === 'n')
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (e.target instanceof HTMLElement) {
          e.target.blur();
        }
        state.onTrigger('new_repair');
        return;
      }

      // Alt+<Key> shortcuts are disabled inside text inputs to avoid interfering with Mac Option characters
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !inEditable) {
        const actionId = ALT_CODE_TO_ACTION[e.code];
        if (actionId) {
          e.preventDefault();
          e.stopPropagation();
          state.onTrigger(actionId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, []);
}
