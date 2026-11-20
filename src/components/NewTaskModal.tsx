import React, { useEffect, useState } from 'react';
import {
  clampStr,
  generateDocId,
  stripUndefined,
  upsertRow,
} from '../lib/db';
import { todayISO } from '../utils/formatters';
import {
  sanitizeDbErrorMessage,
  sanitizePlainLine,
  sanitizeText,
} from '../utils/validation';
import { ModalShell } from './ModalShell';
import { useToast } from './ToastProvider';
import { useI18n } from '../utils/i18n';

interface NewTaskModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
}

export const NewTaskModal: React.FC<NewTaskModalProps> = ({ open, onClose, ownerId }) => {
  const { notify } = useToast();
  const { tr } = useI18n();
  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState('seguimiento');
  const [priority, setPriority] = useState('media');
  const [assignee, setAssignee] = useState('Equipo');
  const [dueDate, setDueDate] = useState(todayISO());
  const [status, setStatus] = useState('pendiente');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setTaskType('seguimiento');
    setPriority('media');
    setAssignee('Equipo');
    setDueDate(todayISO());
    setStatus('pendiente');
    setNotes('');
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = sanitizePlainLine(title, 200);
    if (!cleanTitle) {
      notify('Ingresá un título para la tarea.', 'error');
      return;
    }
    setSaving(true);
    const taskId = generateDocId('tasks');
    try {
      await upsertRow(
        'tasks',
        stripUndefined({
          id: taskId,
          ownerId,
          title: cleanTitle,
          taskType,
          priority,
          assignee: sanitizePlainLine(assignee, 100),
          dueDate: clampStr(dueDate, 40),
          status,
          notes: sanitizeText(notes, 1500),
        })
      );
      notify('Tarea agregada a la agenda.');
      onClose();
    } catch (err) {
      notify(sanitizeDbErrorMessage(err, 'No se pudo guardar la tarea.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell open={open} onClose={onClose} title={tr('Nueva tarea', 'New task', 'Nova tarefa')} maxWidth="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            {tr('Título *', 'Title *', 'Título *')}
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tr('Confirmar repuesto, seguimiento, cobro...', 'Confirm part, follow-up, payment...', 'Confirmar peça, acompanhamento, cobrança...')}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#0072BB] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('Tipo', 'Type', 'Tipo')}
            </label>
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="seguimiento">{tr('Seguimiento', 'Follow-up', 'Acompanhamento')}</option>
              <option value="proveedor">{tr('Proveedor', 'Supplier', 'Fornecedor')}</option>
              <option value="finanzas">{tr('Finanzas', 'Finance', 'Finanças')}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('Prioridad', 'Priority', 'Prioridade')}
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="alta">{tr('Alta', 'High', 'Alta')}</option>
              <option value="media">{tr('Media', 'Medium', 'Média')}</option>
              <option value="baja">{tr('Baja', 'Low', 'Baixa')}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('Responsable', 'Assignee', 'Responsável')}
            </label>
            <input
              type="text"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {tr('Fecha', 'Date', 'Data')}
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            {tr('Estado', 'Status', 'Status')}
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="pendiente">{tr('Pendiente', 'Pending', 'Pendente')}</option>
            <option value="hoy">{tr('Hoy', 'Today', 'Hoje')}</option>
            <option value="completado">{tr('Completada', 'Completed', 'Concluída')}</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            {tr('Notas', 'Notes', 'Notas')}
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={tr('Detalles, seguimiento o comentarios...', 'Details, follow-up or comments...', 'Detalhes, acompanhamento ou comentários...')}
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
          >
            {tr('Cancelar', 'Cancel', 'Cancelar')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-11 flex-1 rounded-xl bg-[#0072BB] text-sm font-semibold text-white hover:bg-[#005f9c]"
          >
            {saving
              ? tr('Guardando...', 'Saving...', 'Salvando...')
              : tr('Guardar tarea', 'Save task', 'Salvar tarefa')}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
