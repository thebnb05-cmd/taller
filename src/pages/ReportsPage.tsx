import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, ChevronDown, FileDown, ShoppingBag } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import type {
  ClientRecord,
  ProductRecord,
  PurchaseRecord,
  RepairRecord,
  SaleRecord,
  WorkshopProfile,
} from '../types/workshop';
import { formatCompactCurrency, formatCurrency, isActiveRepairStatus } from '../utils/formatters';
import { downloadInventorySummaryPdf, downloadSalesSummaryPdf } from '../utils/pdfReport';
import { parseSalePaymentInfo } from '../utils/saleMeta';

interface ReportsPageProps {
  profile?: WorkshopProfile | null;
  repairs: RepairRecord[];
  clients: ClientRecord[];
  products: ProductRecord[];
  sales: SaleRecord[];
  purchases: PurchaseRecord[];
  onSelectProduct: (p: ProductRecord) => void;
}

const RANGE_OPTIONS: Array<{ id: '7' | '30' | '90' | 'all'; label: string; pdfLabel: string }> = [
  { id: '7', label: '7 días', pdfLabel: 'Últimos 7 días' },
  { id: '30', label: '30 días', pdfLabel: 'Últimos 30 días' },
  { id: '90', label: '90 días', pdfLabel: 'Últimos 90 días' },
  { id: 'all', label: 'Total', pdfLabel: 'Histórico total' },
];

export const ReportsPage: React.FC<ReportsPageProps> = ({
  profile,
  repairs,
  clients,
  products,
  sales,
  purchases,
  onSelectProduct,
}) => {
  const { notify } = useToast();
  const [range, setRange] = useState<'7' | '30' | '90' | 'all'>('all');
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false);
  const pdfMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pdfMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (pdfMenuRef.current && !pdfMenuRef.current.contains(e.target as Node)) {
        setPdfMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [pdfMenuOpen]);

  const report = useMemo(() => {
    const cutoff =
      range === 'all' ? 0 : Date.now() - Number(range) * 24 * 60 * 60 * 1000;

    const rFiltered = repairs.filter((r) => r.createdAt >= cutoff);
    const sFiltered = sales.filter((s) => s.createdAt >= cutoff);
    const pFiltered = purchases.filter((p) => p.createdAt >= cutoff);

    const active = rFiltered.filter((r) => isActiveRepairStatus(r.status)).length;
    const ready = rFiltered.filter((r) => r.status === 'listo').length;
    const delivered = rFiltered.filter((r) => r.status === 'entregado').length;

    const repairIncome = rFiltered.reduce((s, r) => s + Number(r.price || 0), 0);
    const repairPaid = rFiltered.reduce((s, r) => s + Number(r.deposit || 0), 0);
    const salesIncome = sFiltered.reduce((s, x) => s + Number(x.amount || 0), 0);
    const salesPaid = sFiltered.reduce(
      (s, x) => s + parseSalePaymentInfo(x).deposit,
      0
    );

    const totalRevenue = repairIncome + salesIncome;
    const totalPending = Math.max(0, totalRevenue - (repairPaid + salesPaid));
    const totalPurchases = pFiltered.reduce((s, p) => s + Number(p.amount || 0), 0);
    const netResult = totalRevenue - totalPurchases;
    const avgTicket = rFiltered.length > 0 ? repairIncome / rFiltered.length : 0;

    // Top clients
    const byClient = new Map<string, { name: string; total: number; count: number }>();
    rFiltered.forEach((r) => {
      const key = r.clientName.trim().toLowerCase();
      const prev = byClient.get(key) || { name: r.clientName, total: 0, count: 0 };
      prev.total += Number(r.price || 0);
      prev.count += 1;
      byClient.set(key, prev);
    });
    sFiltered.forEach((s) => {
      const key = s.clientName.trim().toLowerCase();
      const prev = byClient.get(key) || { name: s.clientName, total: 0, count: 0 };
      prev.total += Number(s.amount || 0);
      prev.count += 1;
      byClient.set(key, prev);
    });
    const topClients = Array.from(byClient.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const lowStock = products.filter((p) => p.trackStock && p.stock <= p.minStock);

    return {
      rFiltered,
      sFiltered,
      pFiltered,
      total: rFiltered.length,
      active,
      ready,
      delivered,
      totalRevenue,
      totalPending,
      avgTicket,
      totalPurchases,
      netResult,
      topClients,
      lowStock,
    };
  }, [products, purchases, range, repairs, sales]);

  const handleExportSalesPdf = () => {
    setPdfMenuOpen(false);
    try {
      const rangeMeta = RANGE_OPTIONS.find((o) => o.id === range);
      downloadSalesSummaryPdf({
        profile,
        rangeLabel: rangeMeta?.pdfLabel || 'Histórico total',
        repairs: report.rFiltered,
        sales: report.sFiltered,
        purchases: report.pFiltered,
      });
      notify('Resumen de ventas descargado en PDF.');
    } catch {
      notify('No se pudo generar el PDF de ventas.', 'error');
    }
  };

  const handleExportInventoryPdf = () => {
    setPdfMenuOpen(false);
    try {
      downloadInventorySummaryPdf({
        profile,
        products,
      });
      notify('Resumen de inventario descargado en PDF.');
    } catch {
      notify('No se pudo generar el PDF de inventario.', 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Reportes
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Rendimiento financiero, ticket promedio y stock crítico
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
            {RANGE_OPTIONS.map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setRange(btn.id)}
                className={`h-9 rounded-lg px-3 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                  range === btn.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <div ref={pdfMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setPdfMenuOpen((prev) => !prev)}
              aria-expanded={pdfMenuOpen}
              aria-haspopup="menu"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0072BB] px-3.5 text-xs font-semibold text-white transition hover:bg-[#005f9c] whitespace-nowrap shrink-0"
            >
              <FileDown className="h-4 w-4" />
              <span>Exportar PDF</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-80" />
            </button>

            {pdfMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleExportSalesPdf}
                  className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ShoppingBag className="mt-0.5 h-4 w-4 shrink-0 text-[#0072BB] dark:text-sky-400" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      Resumen de ventas (PDF)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Ingresos, órdenes y ventas del período
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleExportInventoryPdf}
                  className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      Resumen de inventario (PDF)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Stock actual, alertas y valorización
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Órdenes', value: String(report.total) },
          { label: 'Activas', value: String(report.active) },
          { label: 'Listas', value: String(report.ready) },
          { label: 'Entregadas', value: String(report.delivered) },
          { label: 'Ticket prom.', value: formatCompactCurrency(report.avgTicket) },
          { label: 'Ingreso bruto', value: formatCompactCurrency(report.totalRevenue) },
          { label: 'Por cobrar', value: formatCompactCurrency(report.totalPending) },
          { label: 'Compras', value: formatCompactCurrency(report.totalPurchases) },
          { label: 'Resultado neto', value: formatCompactCurrency(report.netResult) },
          { label: 'Clientes totales', value: String(clients.length) },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="font-mono-num text-xl font-bold text-slate-900 dark:text-white">
              {kpi.value}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">{kpi.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white font-display">
            Top clientes
          </h2>
          {report.topClients.length === 0 ? (
            <p className="text-xs text-slate-500">Sin datos en el período seleccionado.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.topClients.map((c) => (
                <div key={c.name} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                    <div className="text-slate-500">{c.count} operaciones</div>
                  </div>
                  <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                    {formatCurrency(c.total)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white font-display">
            Productos con stock bajo
          </h2>
          {report.lowStock.length === 0 ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Todo el inventario está por encima del mínimo.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.lowStock.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectProduct(p)}
                  className="flex w-full items-center justify-between py-2.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <span className="font-semibold text-slate-900 dark:text-white">{p.name}</span>
                  <span className="font-mono-num font-bold text-red-600 dark:text-red-400">
                    {p.stock} / mín {p.minStock}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
