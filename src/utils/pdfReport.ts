import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  ProductRecord,
  PurchaseRecord,
  RepairRecord,
  SaleRecord,
  WorkshopProfile,
} from '../types/workshop';
import { formatCurrency, formatDateShort, getStatusLabel, todayISO } from './formatters';

interface PdfBrandHeader {
  brandName: string;
  subtitle?: string;
  businessPhone?: string;
  businessAddress?: string;
}

function resolveBrand(profile?: WorkshopProfile | null): PdfBrandHeader {
  return {
    brandName: profile?.brandName || 'TH3 BNB Servicio Técnico',
    subtitle: profile?.subtitle || 'Servicio técnico',
    businessPhone: profile?.businessPhone,
    businessAddress: profile?.businessAddress,
  };
}

function getFinalY(doc: jsPDF, fallback: number): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
  return typeof last?.finalY === 'number' ? last.finalY : fallback;
}

function addDocumentHeader(
  doc: jsPDF,
  brand: PdfBrandHeader,
  title: string,
  metaLine: string
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  // Top accent bar
  doc.setFillColor(0, 114, 187);
  doc.rect(0, 0, pageWidth, 6, 'F');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(brand.brandName, margin, 17);

  const contactParts = [brand.businessAddress, brand.businessPhone ? `Tel: ${brand.businessPhone}` : '']
    .filter(Boolean)
    .join(' · ');
  if (contactParts) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(contactParts, margin, 22);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 114, 187);
  doc.text(title, pageWidth - margin, 17, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text(metaLine, pageWidth - margin, 22, { align: 'right' });

  doc.setDrawColor(226, 232, 240);
  doc.line(margin, 26, pageWidth - margin, 26);

  return 32;
}

function addPageFooters(doc: jsPDF, brandName: string) {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`${brandName} · Documento generado automáticamente`, margin, pageHeight - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 8, {
      align: 'right',
    });
  }
}

export function downloadSalesSummaryPdf(params: {
  profile?: WorkshopProfile | null;
  rangeLabel: string;
  repairs: RepairRecord[];
  sales: SaleRecord[];
  purchases: PurchaseRecord[];
}): void {
  const { profile, rangeLabel, repairs, sales, purchases } = params;
  const brand = resolveBrand(profile);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 14;

  const generatedAt = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date());

  let cursorY = addDocumentHeader(
    doc,
    brand,
    'Resumen de Ventas y Finanzas',
    `Período: ${rangeLabel} · Emitido: ${generatedAt}`
  );

  const repairIncome = repairs.reduce((s, r) => s + Number(r.price || 0), 0);
  const repairPaid = repairs.reduce((s, r) => s + Number(r.deposit || 0), 0);
  const salesIncome = sales.reduce((s, x) => s + Number(x.amount || 0), 0);
  const salesPaid = sales
    .filter((x) => x.status === 'cobrado')
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  const totalRevenue = repairIncome + salesIncome;
  const totalCollected = repairPaid + salesPaid;
  const totalPending = Math.max(0, totalRevenue - totalCollected);
  const totalPurchases = purchases.reduce((s, p) => s + Number(p.amount || 0), 0);
  const netResult = totalRevenue - totalPurchases;
  const avgTicket = repairs.length > 0 ? repairIncome / repairs.length : 0;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Indicadores financieros del período', margin, cursorY);
  cursorY += 3;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [0, 114, 187], textColor: 255, fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    head: [['Concepto', 'Detalle / Cantidad', 'Monto']],
    body: [
      ['Ventas de mostrador', `${sales.length} operaciones`, formatCurrency(salesIncome)],
      ['Órdenes de reparación', `${repairs.length} equipos`, formatCurrency(repairIncome)],
      ['Ingreso bruto total', 'Ventas + Reparaciones', formatCurrency(totalRevenue)],
      ['Total cobrado', 'Ventas cobradas + Señas', formatCurrency(totalCollected)],
      ['Saldo pendiente por cobrar', 'Cuentas por cobrar', formatCurrency(totalPending)],
      ['Compras / reposición', `${purchases.length} comprobantes`, formatCurrency(totalPurchases)],
      ['Resultado neto estimado', 'Ingresos - Compras', formatCurrency(netResult)],
      ['Ticket promedio (reparaciones)', `${repairs.length} órdenes`, formatCurrency(avgTicket)],
    ],
    columnStyles: {
      2: { halign: 'right', fontStyle: 'bold' },
    },
  });

  cursorY = getFinalY(doc, cursorY + 40) + 8;

  // Sales breakdown
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Detalle de ventas (${sales.length})`, margin, cursorY);
  cursorY += 3;

  const sortedSales = [...sales].sort((a, b) => b.createdAt - a.createdAt);
  if (sortedSales.length === 0) {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'plain',
      bodyStyles: { fontSize: 8.5, textColor: [100, 116, 139] },
      body: [['No se registraron ventas de mostrador en el período seleccionado.']],
    });
  } else {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
      head: [['Comprobante', 'Fecha', 'Cliente', 'Producto / Detalle', 'Estado', 'Monto']],
      body: sortedSales.map((s) => [
        s.invoice || '—',
        formatDateShort(s.dueDate),
        s.clientName,
        s.productName ? `${s.productName}${s.quantity ? ` × ${s.quantity}` : ''}` : 'Venta general',
        s.status === 'cobrado' ? 'Cobrado' : 'Pendiente',
        formatCurrency(s.amount),
      ]),
      columnStyles: {
        5: { halign: 'right', fontStyle: 'bold' },
      },
    });
  }

  cursorY = getFinalY(doc, cursorY + 15) + 8;
  if (cursorY > 250) {
    doc.addPage();
    cursorY = 18;
  }

  // Repairs revenue breakdown
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Ingresos por reparaciones (${repairs.length})`, margin, cursorY);
  cursorY += 3;

  const sortedRepairs = [...repairs].sort((a, b) => b.createdAt - a.createdAt);
  if (sortedRepairs.length === 0) {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'plain',
      bodyStyles: { fontSize: 8.5, textColor: [100, 116, 139] },
      body: [['No se registraron reparaciones en el período seleccionado.']],
    });
  } else {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
      head: [['Orden', 'Ingreso', 'Cliente', 'Equipo', 'Estado', 'Presup.', 'Pagado']],
      body: sortedRepairs.map((r) => [
        r.code,
        formatDateShort(r.dateIn),
        r.clientName,
        `${r.brand} ${r.model}`,
        getStatusLabel(r.status),
        formatCurrency(r.price),
        formatCurrency(r.deposit),
      ]),
      columnStyles: {
        5: { halign: 'right' },
        6: { halign: 'right', fontStyle: 'bold' },
      },
    });
  }

  addPageFooters(doc, brand.brandName);
  doc.save(`resumen-ventas-${todayISO()}.pdf`);
}

export function downloadInventorySummaryPdf(params: {
  profile?: WorkshopProfile | null;
  products: ProductRecord[];
}): void {
  const { profile, products } = params;
  const brand = resolveBrand(profile);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 14;

  const generatedAt = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date());

  let cursorY = addDocumentHeader(
    doc,
    brand,
    'Resumen de Inventario y Stock',
    `Emitido: ${generatedAt}`
  );

  const tracked = products.filter((p) => p.trackStock);
  const lowStock = tracked.filter((p) => p.stock <= p.minStock);
  const totalUnits = tracked.reduce((sum, p) => sum + Number(p.stock || 0), 0);
  const costValuation = products.reduce(
    (sum, p) => sum + Number(p.cost || 0) * (p.trackStock ? Number(p.stock || 0) : 1),
    0
  );
  const saleValuation = products.reduce(
    (sum, p) => sum + Number(p.price || 0) * (p.trackStock ? Number(p.stock || 0) : 1),
    0
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Resumen general de inventario', margin, cursorY);
  cursorY += 3;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [0, 114, 187], textColor: 255, fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    head: [['Indicador', 'Valor']],
    body: [
      ['Total de artículos en catálogo', String(products.length)],
      ['Artículos con control de stock', String(tracked.length)],
      ['Artículos con stock bajo / crítico', String(lowStock.length)],
      ['Unidades totales disponibles', `${totalUnits} u.`],
      ['Valorización total al costo', formatCurrency(costValuation)],
      ['Valorización total a precio de venta', formatCurrency(saleValuation)],
    ],
    columnStyles: {
      1: { halign: 'right', fontStyle: 'bold' },
    },
  });

  cursorY = getFinalY(doc, cursorY + 40) + 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Detalle de productos (${products.length})`, margin, cursorY);
  cursorY += 3;

  const sortedProducts = [...products].sort((a, b) => {
    const aLow = a.trackStock && a.stock <= a.minStock ? 0 : 1;
    const bLow = b.trackStock && b.stock <= b.minStock ? 0 : 1;
    if (aLow !== bLow) return aLow - bLow;
    return a.name.localeCompare(b.name, 'es');
  });

  if (sortedProducts.length === 0) {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'plain',
      bodyStyles: { fontSize: 8.5, textColor: [100, 116, 139] },
      body: [['No hay productos cargados en el inventario.']],
    });
  } else {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
      head: [['Producto', 'Categoría', 'SKU / Cód.', 'Stock', 'Mín.', 'Costo', 'Venta', 'Estado']],
      body: sortedProducts.map((p) => {
        const isLow = p.trackStock && p.stock <= p.minStock;
        const statusLabel = !p.trackStock
          ? 'Sin control'
          : p.stock === 0
          ? 'Sin stock'
          : isLow
          ? 'Stock bajo'
          : 'OK';
        return [
          p.name,
          p.category,
          p.sku || p.barcode || p.internalCode || '—',
          p.trackStock ? `${p.stock} u.` : '—',
          p.trackStock ? `${p.minStock} u.` : '—',
          formatCurrency(p.cost),
          formatCurrency(p.price),
          statusLabel,
        ];
      }),
      columnStyles: {
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right', fontStyle: 'bold' },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 7) {
          const val = String(data.cell.raw || '');
          if (val === 'Sin stock' || val === 'Stock bajo') {
            data.cell.styles.textColor = [185, 28, 28];
            data.cell.styles.fontStyle = 'bold';
          } else if (val === 'OK') {
            data.cell.styles.textColor = [4, 120, 87];
          }
        }
      },
    });
  }

  addPageFooters(doc, brand.brandName);
  doc.save(`resumen-inventario-${todayISO()}.pdf`);
}
