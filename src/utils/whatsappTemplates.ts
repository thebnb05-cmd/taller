import type { RepairRecord, WorkshopProfile } from '../types/workshop';
import { formatCurrency } from './formatters';
import { parsePaymentInfo } from './payment';
import { parseRepairPublicMeta } from './repairMeta';
import { parseWorkshopMeta } from './workshopMeta';
import { sanitizePlainLine } from './validation';

export type WhatsAppTemplateId =
  | 'auto'
  | 'ready'
  | 'quote_pending'
  | 'waiting_part'
  | 'delivered'
  | 'diagnostic';

export const WHATSAPP_TEMPLATE_OPTIONS: Array<{
  id: WhatsAppTemplateId;
  label: string;
}> = [
  { id: 'ready', label: 'Equipo listo para retirar' },
  { id: 'quote_pending', label: 'Enviar presupuesto para aprobación' },
  { id: 'waiting_part', label: 'En espera de repuesto' },
  { id: 'diagnostic', label: 'Equipo en diagnóstico / revisión' },
  { id: 'delivered', label: 'Entregado y garantía activa' },
];

export function resolveDefaultTemplateForStatus(status: string): Exclude<WhatsAppTemplateId, 'auto'> {
  if (status === 'listo') return 'ready';
  if (status === 'espera_repuesto') return 'waiting_part';
  if (status === 'entregado') return 'delivered';
  if (status === 'diagnostico') return 'quote_pending';
  return 'diagnostic';
}

export function buildRepairWhatsAppMessage(params: {
  templateId?: WhatsAppTemplateId;
  repair: RepairRecord;
  profile: WorkshopProfile | null;
  trackingUrl?: string;
}): string {
  const { repair, profile, trackingUrl } = params;
  const resolvedId =
    !params.templateId || params.templateId === 'auto'
      ? resolveDefaultTemplateForStatus(repair.status)
      : params.templateId;

  const brandName = sanitizePlainLine(profile?.brandName || 'el taller', 80) || 'el taller';
  const workshopMeta = parseWorkshopMeta(profile);
  const address = sanitizePlainLine(profile?.businessAddress || '', 160);
  const hours = sanitizePlainLine(workshopMeta.hours || '', 120);
  const payInfo = parsePaymentInfo(repair);
  const currencyCode = payInfo.currency;
  const budget = Math.max(0, Number(repair.price || 0));
  const paid = Math.max(0, Number(repair.deposit || 0));
  const pending = Math.max(0, budget - paid);
  const rmeta = parseRepairPublicMeta(repair.workDetail);
  const warrantyDays = rmeta.warrantyDays ?? 0;

  const clientFirst =
    sanitizePlainLine(repair.clientName || '', 80).split(/\s+/)[0] || 'Hola';
  const deviceLabel = `${repair.brand} ${repair.model}`.trim();

  const footerParts: string[] = [];
  if (trackingUrl) {
    footerParts.push(`Seguimiento online: ${trackingUrl}`);
  }
  if (address) {
    footerParts.push(`Dirección: ${address}`);
  }
  if (hours) {
    footerParts.push(`Horarios: ${hours}`);
  }
  const footer = footerParts.length > 0 ? `\n\n${footerParts.join('\n')}` : '';

  switch (resolvedId) {
    case 'ready': {
      const balanceLine =
        pending > 0
          ? `Saldo pendiente al retirar: ${formatCurrency(pending, currencyCode)}.`
          : budget > 0
            ? 'El trabajo ya se encuentra abonado en su totalidad.'
            : '';
      return `Hola ${clientFirst}! Te escribimos de ${brandName}. Tu ${deviceLabel} (orden ${repair.code}) ya está *listo para retirar*.${balanceLine ? `\n${balanceLine}` : ''}${footer}`;
    }
    case 'quote_pending': {
      const amountLine =
        budget > 0
          ? `El presupuesto estimado es de *${formatCurrency(budget, currencyCode)}*.`
          : 'Ya tenemos el diagnóstico técnico de tu equipo.';
      const onlineHint = trackingUrl
        ? '\nPodés aprobar o responder el presupuesto directamente desde el enlace de seguimiento:'
        : '\nConfirmános por acá si avanzamos con la reparación.';
      return `Hola ${clientFirst}! De ${brandName} te pasamos novedades de tu ${deviceLabel} (${repair.code}).\n${amountLine}${onlineHint}${footer}`;
    }
    case 'waiting_part': {
      return `Hola ${clientFirst}! Te actualizamos desde ${brandName} sobre tu ${deviceLabel} (${repair.code}): ya confirmamos la falla y estamos aguardando la llegada del repuesto para finalizarlo.${footer}`;
    }
    case 'delivered': {
      const warrantyLine =
        warrantyDays > 0
          ? `\nRecordá que tu reparación cuenta con *${warrantyDays} días de garantía* sobre el trabajo realizado.`
          : '';
      return `Hola ${clientFirst}! Gracias por confiar en ${brandName}. Confirmamos la entrega de tu ${deviceLabel} (${repair.code}).${warrantyLine}${trackingUrl ? `\nComprobante y detalle: ${trackingUrl}` : ''}`;
    }
    case 'diagnostic':
    default: {
      return `Hola ${clientFirst}! Te escribimos de ${brandName} por tu ${deviceLabel} (orden ${repair.code}). Estamos trabajando en el equipo y cualquier novedad te avisamos por acá.${footer}`;
    }
  }
}
