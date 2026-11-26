import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { DEFAULT_RECEIPT_TERMS } from '../data/catalog';
import type {
  ProductRecord,
  PurchaseRecord,
  RepairRecord,
  SaleRecord,
  WorkshopProfile,
} from '../types/workshop';
import { convertFromBaseCurrency, type CurrencyCode } from './currency';
import { formatCurrency, formatDateShort, getStatusLabel, todayISO } from './formatters';
import { parsePaymentInfo } from './payment';
import { isMirroredIncomePurchase, parsePurchaseInfo } from './purchaseMeta';
import { parseSalePaymentInfo } from './saleMeta';
import { parseCheckoutAndSignature } from './signatureMeta';
import { parseWorkshopMeta } from './workshopMeta';
import { getIntlLocale } from './i18n';

interface PdfBrandHeader {
  brandName: string;
  subtitle?: string;
  businessPhone?: string;
  businessAddress?: string;
  businessEmail?: string;
  taxId?: string;
  hours?: string;
  social?: string;
  footerNote?: string;
  currency: CurrencyCode;
}

function resolveBrand(profile?: WorkshopProfile | null): PdfBrandHeader {
  const meta = parseWorkshopMeta(profile);
  return {
    brandName: profile?.brandName || 'TH3 BNB Servicio Técnico',
    subtitle: meta.subtitle || 'Servicio técnico',
    businessPhone: profile?.businessPhone,
    businessAddress: profile?.businessAddress,
    businessEmail: meta.businessEmail,
    taxId: meta.taxId,
    hours: meta.hours,
    social: meta.social,
    footerNote: meta.footerNote,
    currency: meta.currency,
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

  const generatedAt = new Intl.DateTimeFormat(getIntlLocale(), {
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
  const salesPaid = sales.reduce((s, x) => s + parseSalePaymentInfo(x).deposit, 0);
  const totalRevenue = repairIncome + salesIncome;
  const totalCollected = repairPaid + salesPaid;
  const totalPending = Math.max(0, totalRevenue - totalCollected);
  const realPurchases = purchases.filter(
    (p) => !isMirroredIncomePurchase(parsePurchaseInfo(p))
  );
  const totalPurchases = realPurchases.reduce((s, p) => s + Number(p.amount || 0), 0);
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
      ['Ventas de mostrador', `${sales.length} operaciones`, formatCurrency(salesIncome, brand.currency)],
      ['Órdenes de reparación', `${repairs.length} equipos`, formatCurrency(repairIncome, brand.currency)],
      ['Ingreso bruto total', 'Ventas + Reparaciones', formatCurrency(totalRevenue, brand.currency)],
      ['Total cobrado', 'Ventas cobradas + Señas', formatCurrency(totalCollected, brand.currency)],
      ['Saldo pendiente por cobrar', 'Cuentas por cobrar', formatCurrency(totalPending, brand.currency)],
      ['Compras / reposición', `${realPurchases.length} comprobantes`, formatCurrency(totalPurchases, brand.currency)],
      ['Resultado neto estimado', 'Ingresos - Compras', formatCurrency(netResult, brand.currency)],
      ['Ticket promedio (reparaciones)', `${repairs.length} órdenes`, formatCurrency(avgTicket, brand.currency)],
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
      body: sortedSales.map((s) => {
        const info = parseSalePaymentInfo(s);
        const statusText = info.isPaid
          ? `Cobrado${info.methodLabel ? ` (${info.methodLabel})` : ''}`
          : info.deposit > 0
            ? `Seña ${formatCurrency(info.deposit, brand.currency)}${info.methodLabel ? ` · ${info.methodLabel}` : ''}`
            : `Pendiente${info.methodLabel ? ` (${info.methodLabel})` : ''}`;
        return [
          s.invoice || '—',
          formatDateShort(s.dueDate),
          s.clientName,
          s.productName ? `${s.productName}${s.quantity ? ` × ${s.quantity}` : ''}` : 'Venta general',
          statusText,
          formatCurrency(s.amount, brand.currency),
        ];
      }),
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
        formatCurrency(r.price, brand.currency),
        formatCurrency(r.deposit, brand.currency),
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

  const generatedAt = new Intl.DateTimeFormat(getIntlLocale(), {
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
      ['Valorización total al costo', formatCurrency(costValuation, brand.currency)],
      ['Valorización total a precio de venta', formatCurrency(saleValuation, brand.currency)],
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
          formatCurrency(p.cost, brand.currency),
          formatCurrency(p.price, brand.currency),
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

async function toPngDataUrl(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!dataUrl || typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width || 160;
        const h = img.naturalHeight || img.height || 160;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: canvas.toDataURL('image/png'), width: w, height: h });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export async function buildClientRepairReceiptPdf(params: {
  repair: RepairRecord;
  profile?: WorkshopProfile | null;
  trackingUrl: string;
  trackingQrDataUrl?: string;
  currencyCode?: CurrencyCode;
  exchangeRate?: number;
  clientSignatureDataUrl?: string;
}): Promise<{ doc: jsPDF; fileName: string; blob: Blob }> {
  const { repair, profile, trackingUrl } = params;
  const brand = resolveBrand(profile);
  const paymentInfo = parsePaymentInfo(repair);
  const displayCurrency: CurrencyCode = params.currencyCode || paymentInfo.currency || brand.currency;
  const resolvedRate =
    params.exchangeRate && params.exchangeRate > 0
      ? params.exchangeRate
      : paymentInfo.currency === displayCurrency && paymentInfo.rate
        ? paymentInfo.rate
        : 1;
  const isConverted = displayCurrency !== brand.currency && resolvedRate !== 1;
  const fmtAmount = (baseVal: number | undefined) => {
    const n = Number(baseVal || 0);
    return formatCurrency(isConverted ? convertFromBaseCurrency(n, resolvedRate) : n, displayCurrency);
  };
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // Top brand accent
  doc.setFillColor(0, 114, 187);
  doc.rect(0, 0, pageWidth, 5, 'F');

  let headerTextX = margin;
  if (profile?.logoDataUrl) {
    const pngLogo = await toPngDataUrl(profile.logoDataUrl);
    if (pngLogo) {
      const maxH = 14;
      const ratio = pngLogo.width / Math.max(1, pngLogo.height);
      const drawW = Math.min(28, maxH * ratio);
      const drawH = drawW / Math.max(0.2, ratio);
      doc.addImage(pngLogo.dataUrl, 'PNG', margin, 10, drawW, drawH);
      headerTextX = margin + drawW + 4;
    }
  }

  // Badge
  doc.setFillColor(224, 242, 254);
  doc.roundedRect(headerTextX, 9.5, 68, 5, 1.2, 1.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(0, 114, 187);
  doc.text('BOLETA CLIENTE · COMPROBANTE DE INGRESO', headerTextX + 2, 13);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(brand.brandName, headerTextX, 20.5);

  let leftHeaderY = 24.8;
  if (brand.subtitle) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(0, 114, 187);
    doc.text(brand.subtitle, headerTextX, leftHeaderY);
    leftHeaderY += 4;
  }

  const contactLine = [
    brand.businessAddress || 'Servicio técnico especializado',
    brand.businessPhone ? `Tel: ${brand.businessPhone}` : '',
    brand.businessEmail || '',
    brand.taxId || '',
  ]
    .filter(Boolean)
    .join(' · ');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(71, 85, 105);
  const wrappedContact = doc.splitTextToSize(contactLine, contentWidth - (headerTextX - margin) - 52);
  doc.text(wrappedContact, headerTextX, leftHeaderY);
  leftHeaderY += wrappedContact.length * 3.6;

  const extraLine = [
    brand.hours ? `Horarios: ${brand.hours}` : '',
    brand.social || '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (extraLine) {
    doc.setFontSize(7.4);
    doc.setTextColor(100, 116, 139);
    const wrappedExtra = doc.splitTextToSize(extraLine, contentWidth - (headerTextX - margin) - 52);
    doc.text(wrappedExtra, headerTextX, leftHeaderY + 0.5);
    leftHeaderY += wrappedExtra.length * 3.5 + 0.5;
  }

  // Right order meta
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(`Orden ${repair.code}`, pageWidth - margin, 14, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.setTextColor(0, 114, 187);
  doc.text(`Seguimiento: ${repair.trackingCode}`, pageWidth - margin, 19.2, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(100, 116, 139);
  doc.text(`Ingreso: ${formatDateShort(repair.dateIn)}`, pageWidth - margin, 23.8, {
    align: 'right',
  });
  let rightHeaderBottom = 25;
  if (repair.dateEst) {
    doc.text(`Entrega est.: ${formatDateShort(repair.dateEst)}`, pageWidth - margin, 28, {
      align: 'right',
    });
    rightHeaderBottom = 29.5;
  }

  const headerSepY = Math.max(31.5, leftHeaderY + 1.5, rightHeaderBottom + 2);
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, headerSepY, pageWidth - margin, headerSepY);

  let cursorY = headerSepY + 4.5;

  // Client & Device side-by-side cards
  const colGap = 5;
  const colW = (contentWidth - colGap) / 2;

  const accessoriesText =
    repair.accessories && repair.accessories.length > 0
      ? repair.accessories.join(', ')
      : repair.consoleAccessories && Object.keys(repair.consoleAccessories).length > 0
        ? Object.entries(repair.consoleAccessories)
            .filter(([, v]) => v === 'Sí')
            .map(([k]) => k)
            .join(', ') || 'Ninguno'
        : 'Ninguno';

  const clientLines = [
    repair.clientName,
    repair.clientPhone ? `Tel: ${repair.clientPhone}` : '',
    repair.clientDni ? `DNI: ${repair.clientDni}` : '',
    repair.clientAddress ? `Dir: ${repair.clientAddress}` : '',
  ].filter(Boolean);

  const deviceTitle = `${repair.deviceType} · ${repair.brand} ${repair.model}`;
  const deviceSub = [repair.color, repair.capacity].filter(Boolean).join(' · ');
  const deviceLines = [
    deviceTitle,
    deviceSub || 'Sin detalles físicos adicionales',
    repair.imei ? `IMEI / Serie: ${repair.imei}` : '',
    `Accesorios: ${accessoriesText}`,
  ].filter(Boolean);

  const wrappedClient = clientLines.flatMap((line, idx) =>
    doc.splitTextToSize(line, colW - 6).map((t: string) => ({ text: t, bold: idx === 0 }))
  );
  const wrappedDevice = deviceLines.flatMap((line, idx) =>
    doc.splitTextToSize(line, colW - 6).map((t: string) => ({ text: t, bold: idx === 0 }))
  );

  const cardH = Math.max(24, 10 + Math.max(wrappedClient.length, wrappedDevice.length) * 4.3);

  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, cursorY, colW, cardH, 2, 2, 'FD');
  doc.roundedRect(margin + colW + colGap, cursorY, colW, cardH, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('DATOS DEL CLIENTE', margin + 3, cursorY + 5);
  doc.text('EQUIPO INGRESADO', margin + colW + colGap + 3, cursorY + 5);

  wrappedClient.forEach((item: { text: string; bold: boolean }, idx: number) => {
    doc.setFont('helvetica', item.bold ? 'bold' : 'normal');
    doc.setFontSize(item.bold ? 9.5 : 8.2);
    doc.setTextColor(item.bold ? 15 : 51, item.bold ? 23 : 65, item.bold ? 42 : 85);
    doc.text(item.text, margin + 3, cursorY + 10.2 + idx * 4.3);
  });

  wrappedDevice.forEach((item: { text: string; bold: boolean }, idx: number) => {
    doc.setFont('helvetica', item.bold ? 'bold' : 'normal');
    doc.setFontSize(item.bold ? 9.2 : 8.2);
    doc.setTextColor(item.bold ? 15 : 51, item.bold ? 23 : 65, item.bold ? 42 : 85);
    doc.text(item.text, margin + colW + colGap + 3, cursorY + 10.2 + idx * 4.3);
  });

  cursorY += cardH + 4;

  // Falla declarada
  const problemLines = doc.splitTextToSize(repair.problem || 'Sin detalle', contentWidth - 6);
  const problemH = Math.max(14, 9 + problemLines.length * 4.2);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, cursorY, contentWidth, problemH, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(71, 85, 105);
  doc.text('Falla declarada / Motivo de ingreso', margin + 3, cursorY + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(problemLines, margin + 3, cursorY + 9.5);
  cursorY += problemH + 4;

  // Check out summary if present
  const physicalEntries = Object.entries(repair.physicalCheck || {}).filter(
    ([, v]) => Boolean(v && String(v).trim())
  );
  const functionalEntries = Object.entries(repair.functionalCheck || {}).filter(
    ([, v]) => Boolean(v && String(v).trim())
  );
  if (physicalEntries.length > 0 || functionalEntries.length > 0) {
    const checkSections: Array<{ title: string; lines: string[] }> = [];
    if (physicalEntries.length > 0) {
      const text = physicalEntries.map(([k, v]) => `${k}: ${v}`).join(' · ');
      checkSections.push({
        title: 'CHECK OUT · ESTADO FÍSICO',
        lines: doc.splitTextToSize(text, contentWidth - 6),
      });
    }
    if (functionalEntries.length > 0) {
      const text = functionalEntries.map(([k, v]) => `${k}: ${v}`).join(' · ');
      checkSections.push({
        title: 'CHECK OUT · ESTADO FUNCIONAL',
        lines: doc.splitTextToSize(text, contentWidth - 6),
      });
    }
    const checkH = checkSections.reduce((acc, s) => acc + 5 + s.lines.length * 3.8, 3);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, cursorY, contentWidth, checkH, 2, 2, 'FD');
    let innerY = cursorY + 4.5;
    for (const sec of checkSections) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(100, 116, 139);
      doc.text(sec.title, margin + 3, innerY);
      innerY += 3.8;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(30, 41, 59);
      doc.text(sec.lines, margin + 3, innerY);
      innerY += sec.lines.length * 3.8 + 1.2;
    }
    cursorY += checkH + 4;
  }

  // Totals strip
  const pendingBalance = Math.max(0, Number(repair.price || 0) - Number(repair.deposit || 0));
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, cursorY, pageWidth - margin, cursorY);
  doc.line(margin, cursorY + 15, pageWidth - margin, cursorY + 15);

  const third = contentWidth / 3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Presupuesto', margin + third * 0.5, cursorY + 5.2, { align: 'center' });
  doc.text('Seña / Anticipo', margin + third * 1.5, cursorY + 5.2, { align: 'center' });
  doc.text('Saldo pendiente', margin + third * 2.5, cursorY + 5.2, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(fmtAmount(repair.price), margin + third * 0.5, cursorY + 11.2, { align: 'center' });
  doc.setTextColor(4, 120, 87);
  doc.text(fmtAmount(repair.deposit), margin + third * 1.5, cursorY + 11.2, {
    align: 'center',
  });
  doc.setTextColor(15, 23, 42);
  doc.text(fmtAmount(pendingBalance), margin + third * 2.5, cursorY + 11.2, {
    align: 'center',
  });

  cursorY += 19;

  if (isConverted) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Moneda: ${displayCurrency} (1 ${displayCurrency} = ${formatCurrency(resolvedRate, brand.currency)}) · Equivalente base: ${formatCurrency(repair.price, brand.currency)}`,
      pageWidth / 2,
      cursorY - 0.5,
      { align: 'center' }
    );
    cursorY += 3.8;
  }

  // Paid stamp if fully paid
  if (paymentInfo.isPaid) {
    const stampW = 68;
    const stampH = 18;
    const stampX = pageWidth - margin - stampW;
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(4, 120, 87);
    doc.setLineWidth(0.6);
    doc.roundedRect(stampX, cursorY, stampW, stampH, 2, 2, 'FD');
    doc.setLineWidth(0.2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(6, 95, 70);
    doc.text('P A G O', stampX + stampW / 2, cursorY + 5.8, { align: 'center' });

    doc.setFontSize(8.2);
    doc.setTextColor(15, 23, 42);
    const shortClient = repair.clientName.slice(0, 32).toUpperCase();
    doc.text(shortClient, stampX + stampW / 2, cursorY + 10.6, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(6, 95, 70);
    const paidDetail = `${paymentInfo.methodLabel ? `${paymentInfo.methodLabel} · ` : ''}${fmtAmount(repair.price)}`;
    doc.text(paidDetail, stampX + stampW / 2, cursorY + 15, { align: 'center' });

    cursorY += stampH + 4;
  }

  // Terms & Conditions
  const termsText = (profile?.receiptTerms ?? DEFAULT_RECEIPT_TERMS).trim();
  if (termsText) {
    const termsLines = doc.splitTextToSize(termsText, contentWidth - 6);
    const termsH = Math.max(12, 8 + termsLines.length * 3.1);
    if (cursorY + termsH > pageHeight - 40) {
      doc.addPage();
      cursorY = 16;
    }
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, cursorY, contentWidth, termsH, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(51, 65, 85);
    doc.text('TÉRMINOS Y CONDICIONES', margin + 3, cursorY + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.setTextColor(71, 85, 105);
    doc.text(termsLines, margin + 3, cursorY + 8);
    cursorY += termsH + 4;
  }

  if (brand.footerNote) {
    const noteLines = doc.splitTextToSize(brand.footerNote, contentWidth - 8);
    const noteH = Math.max(8, 4.5 + noteLines.length * 3.6);
    if (cursorY + noteH > pageHeight - 36) {
      doc.addPage();
      cursorY = 16;
    }
    doc.setFillColor(240, 249, 255);
    doc.setDrawColor(186, 230, 253);
    doc.roundedRect(margin, cursorY, contentWidth, noteH, 1.8, 1.8, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(12, 74, 110);
    doc.text(noteLines, pageWidth / 2, cursorY + 5, { align: 'center' });
    cursorY += noteH + 4;
  }

  // QR + Signature footer
  if (cursorY > pageHeight - 38) {
    doc.addPage();
    cursorY = 18;
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(margin, cursorY, pageWidth - margin, cursorY);
  cursorY += 4;

  let qrUrl = params.trackingQrDataUrl || '';
  if (!qrUrl && trackingUrl) {
    try {
      qrUrl = await QRCode.toDataURL(trackingUrl, {
        width: 200,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
    } catch {
      qrUrl = '';
    }
  }

  let qrTextX = margin;
  if (qrUrl) {
    doc.addImage(qrUrl, 'PNG', margin, cursorY, 22, 22);
    qrTextX = margin + 25;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.setTextColor(30, 41, 59);
  doc.text('Seguimiento en línea', qrTextX, cursorY + 4.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(100, 116, 139);
  doc.text('Escaneá el QR para ver el estado de tu equipo', qrTextX, cursorY + 9);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 114, 187);
  doc.text(`Código: ${repair.trackingCode}`, qrTextX, cursorY + 13.5);

  const wrappedTrackingUrl = doc.splitTextToSize(trackingUrl, 85);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(100, 116, 139);
  doc.text(wrappedTrackingUrl.slice(0, 2), qrTextX, cursorY + 17.5);

  // Signature line on right (with saved handwritten signature when present)
  const rawSignature =
    params.clientSignatureDataUrl !== undefined
      ? params.clientSignatureDataUrl
      : parseCheckoutAndSignature(repair.checkoutState).signatureDataUrl;
  const sigPng = rawSignature ? await toPngDataUrl(rawSignature) : null;

  const sigW = 58;
  const sigX = pageWidth - margin - sigW;
  const sigLineY = cursorY + 17;
  if (sigPng) {
    const maxSigW = sigW - 6;
    const maxSigH = 14.5;
    const ratio = sigPng.width / Math.max(1, sigPng.height);
    let drawW = maxSigW;
    let drawH = drawW / Math.max(0.2, ratio);
    if (drawH > maxSigH) {
      drawH = maxSigH;
      drawW = drawH * Math.max(0.2, ratio);
    }
    const drawX = sigX + (sigW - drawW) / 2;
    const drawY = sigLineY - drawH - 0.8;
    doc.addImage(sigPng.dataUrl, 'PNG', drawX, drawY, drawW, drawH);
  }
  doc.setDrawColor(148, 163, 184);
  doc.line(sigX, sigLineY, sigX + sigW, sigLineY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Firma y aclaración del cliente', sigX + sigW / 2, sigLineY + 4, { align: 'center' });

  const safeCode = (repair.code || 'orden').replace(/[^a-zA-Z0-9_-]/g, '-');
  const fileName = `boleta-cliente-${safeCode}.pdf`;
  const blob = doc.output('blob');

  return { doc, fileName, blob };
}

export async function downloadClientRepairReceiptPdf(params: {
  repair: RepairRecord;
  profile?: WorkshopProfile | null;
  trackingUrl: string;
  trackingQrDataUrl?: string;
  currencyCode?: CurrencyCode;
  exchangeRate?: number;
  clientSignatureDataUrl?: string;
}): Promise<{ fileName: string; blob: Blob }> {
  const { doc, fileName, blob } = await buildClientRepairReceiptPdf(params);
  doc.save(fileName);
  return { fileName, blob };
}

export async function buildBatchRepairReceiptPdf(params: {
  repairs: RepairRecord[];
  batchRef: string;
  profile?: WorkshopProfile | null;
  currencyCode?: CurrencyCode;
  exchangeRate?: number;
  clientSignatureDataUrl?: string;
}): Promise<{ doc: jsPDF; fileName: string; blob: Blob }> {
  const { repairs, batchRef, profile } = params;
  const brand = resolveBrand(profile);
  const first = repairs[0];
  const firstPaymentInfo = first ? parsePaymentInfo(first) : null;
  const displayCurrency: CurrencyCode =
    params.currencyCode || firstPaymentInfo?.currency || brand.currency;
  const resolvedRate =
    params.exchangeRate && params.exchangeRate > 0
      ? params.exchangeRate
      : firstPaymentInfo?.currency === displayCurrency && firstPaymentInfo?.rate
        ? firstPaymentInfo.rate
        : 1;
  const isConverted = displayCurrency !== brand.currency && resolvedRate !== 1;
  const fmtAmount = (baseVal: number | undefined) => {
    const n = Number(baseVal || 0);
    return formatCurrency(isConverted ? convertFromBaseCurrency(n, resolvedRate) : n, displayCurrency);
  };
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  doc.setFillColor(0, 114, 187);
  doc.rect(0, 0, pageWidth, 6, 'F');

  doc.setFillColor(224, 242, 254);
  doc.roundedRect(margin, 10, 64, 5.5, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(0, 114, 187);
  doc.text('BOLETA CLIENTE · INGRESO MÚLTIPLE', margin + 2, 13.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(brand.brandName, margin, 21.5);

  let batchHeaderY = 25.8;
  if (brand.subtitle) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(0, 114, 187);
    doc.text(brand.subtitle, margin, batchHeaderY);
    batchHeaderY += 4;
  }

  const subParts = [
    brand.businessAddress,
    brand.businessPhone ? `Tel: ${brand.businessPhone}` : '',
    brand.businessEmail || '',
    brand.taxId || '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (subParts) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(71, 85, 105);
    const wrappedSub = doc.splitTextToSize(subParts, contentWidth - 52);
    doc.text(wrappedSub, margin, batchHeaderY);
    batchHeaderY += wrappedSub.length * 3.6;
  }

  const batchExtra = [
    brand.hours ? `Horarios: ${brand.hours}` : '',
    brand.social || '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (batchExtra) {
    doc.setFontSize(7.4);
    doc.setTextColor(100, 116, 139);
    const wrappedExtra = doc.splitTextToSize(batchExtra, contentWidth - 52);
    doc.text(wrappedExtra, margin, batchHeaderY + 0.5);
    batchHeaderY += wrappedExtra.length * 3.5 + 0.5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Ref. ${batchRef || 'LOTE'}`, pageWidth - margin, 15, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.setTextColor(0, 114, 187);
  doc.text(`${repairs.length} equipos ingresados`, pageWidth - margin, 19.8, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(100, 116, 139);
  doc.text(`Ingreso: ${formatDateShort(first?.dateIn)}`, pageWidth - margin, 24.3, {
    align: 'right',
  });

  const batchSepY = Math.max(30, batchHeaderY + 1.5);
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, batchSepY, pageWidth - margin, batchSepY);

  let cursorY = batchSepY + 4;

  // Client summary card
  const clientInfo = [
    first?.clientName || 'Cliente',
    first?.clientPhone ? `Tel: ${first.clientPhone}` : '',
    first?.clientDni ? `DNI: ${first.clientDni}` : '',
    first?.clientAddress ? `Dir: ${first.clientAddress}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const clientWrapped = doc.splitTextToSize(clientInfo, contentWidth - 6);
  const clientH = 10 + clientWrapped.length * 4;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, cursorY, contentWidth, clientH, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('DATOS DEL CLIENTE / GREMIO', margin + 3, cursorY + 4.8);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(clientWrapped, margin + 3, cursorY + 9.6);

  cursorY += clientH + 4;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [0, 114, 187], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 7.8, textColor: [30, 41, 59], valign: 'top' },
    head: [['Orden / Seg.', 'Equipo', 'Falla y Accesorios', 'Presup.', 'Seña', 'Saldo']],
    body: repairs.map((r) => {
      const acc =
        r.accessories && r.accessories.length > 0
          ? r.accessories.join(', ')
          : r.consoleAccessories
            ? Object.entries(r.consoleAccessories)
                .filter(([, v]) => v === 'Sí')
                .map(([k]) => k)
                .join(', ')
            : '';
      const specs = [r.color, r.capacity, r.imei ? `IMEI/Serie: ${r.imei}` : '']
        .filter(Boolean)
        .join(' · ');
      const pending = Math.max(0, Number(r.price || 0) - Number(r.deposit || 0));
      return [
        `${r.code}\n${r.trackingCode}`,
        `${r.deviceType} · ${r.brand} ${r.model}${specs ? `\n${specs}` : ''}`,
        `${r.problem || 'Sin detalle'}${acc ? `\nAcc: ${acc}` : ''}`,
        fmtAmount(r.price),
        fmtAmount(r.deposit),
        fmtAmount(pending),
      ];
    }),
    columnStyles: {
      0: { cellWidth: 24, fontStyle: 'bold' },
      3: { halign: 'right', cellWidth: 21 },
      4: { halign: 'right', cellWidth: 20 },
      5: { halign: 'right', fontStyle: 'bold', cellWidth: 21 },
    },
  });

  cursorY = getFinalY(doc, cursorY + 30) + 5;

  const totalBudget = repairs.reduce((s, r) => s + Number(r.price || 0), 0);
  const totalDeposit = repairs.reduce((s, r) => s + Number(r.deposit || 0), 0);
  const totalPending = Math.max(0, totalBudget - totalDeposit);

  if (cursorY > pageHeight - 60) {
    doc.addPage();
    cursorY = 16;
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(margin, cursorY, pageWidth - margin, cursorY);
  doc.line(margin, cursorY + 15, pageWidth - margin, cursorY + 15);

  const third = contentWidth / 3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Total Presupuesto', margin + third * 0.5, cursorY + 5.2, { align: 'center' });
  doc.text('Total Seña / Anticipo', margin + third * 1.5, cursorY + 5.2, { align: 'center' });
  doc.text('Saldo Pendiente Total', margin + third * 2.5, cursorY + 5.2, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(fmtAmount(totalBudget), margin + third * 0.5, cursorY + 11.2, { align: 'center' });
  doc.setTextColor(4, 120, 87);
  doc.text(fmtAmount(totalDeposit), margin + third * 1.5, cursorY + 11.2, { align: 'center' });
  doc.setTextColor(15, 23, 42);
  doc.text(fmtAmount(totalPending), margin + third * 2.5, cursorY + 11.2, { align: 'center' });

  cursorY += 20;

  if (isConverted) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Moneda: ${displayCurrency} (1 ${displayCurrency} = ${formatCurrency(resolvedRate, brand.currency)}) · Equivalente base: ${formatCurrency(totalBudget, brand.currency)}`,
      pageWidth / 2,
      cursorY - 1,
      { align: 'center' }
    );
    cursorY += 4;
  }

  const termsText = (profile?.receiptTerms ?? DEFAULT_RECEIPT_TERMS).trim();
  if (termsText) {
    const termsLines = doc.splitTextToSize(termsText, contentWidth - 6);
    const termsH = Math.max(12, 8 + termsLines.length * 3.1);
    if (cursorY + termsH > pageHeight - 30) {
      doc.addPage();
      cursorY = 16;
    }
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, cursorY, contentWidth, termsH, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(51, 65, 85);
    doc.text('TÉRMINOS Y CONDICIONES', margin + 3, cursorY + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.setTextColor(71, 85, 105);
    doc.text(termsLines, margin + 3, cursorY + 8);
    cursorY += termsH + 5;
  }

  if (brand.footerNote) {
    const noteLines = doc.splitTextToSize(brand.footerNote, contentWidth - 8);
    const noteH = Math.max(8, 4.5 + noteLines.length * 3.6);
    if (cursorY + noteH > pageHeight - 25) {
      doc.addPage();
      cursorY = 16;
    }
    doc.setFillColor(240, 249, 255);
    doc.setDrawColor(186, 230, 253);
    doc.roundedRect(margin, cursorY, contentWidth, noteH, 1.8, 1.8, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(12, 74, 110);
    doc.text(noteLines, pageWidth / 2, cursorY + 5, { align: 'center' });
    cursorY += noteH + 5;
  }

  const rawBatchSignature =
    params.clientSignatureDataUrl !== undefined
      ? params.clientSignatureDataUrl
      : parseCheckoutAndSignature(first?.checkoutState).signatureDataUrl;
  const batchSigPng = rawBatchSignature ? await toPngDataUrl(rawBatchSignature) : null;

  if (cursorY > pageHeight - (batchSigPng ? 32 : 25)) {
    doc.addPage();
    cursorY = 18;
  }

  const sigW = 62;
  const sigX = pageWidth - margin - sigW;
  const batchSigLineY = batchSigPng ? cursorY + 17 : cursorY + 10;
  if (batchSigPng) {
    const maxSigW = sigW - 6;
    const maxSigH = 14.5;
    const ratio = batchSigPng.width / Math.max(1, batchSigPng.height);
    let drawW = maxSigW;
    let drawH = drawW / Math.max(0.2, ratio);
    if (drawH > maxSigH) {
      drawH = maxSigH;
      drawW = drawH * Math.max(0.2, ratio);
    }
    const drawX = sigX + (sigW - drawW) / 2;
    const drawY = batchSigLineY - drawH - 0.8;
    doc.addImage(batchSigPng.dataUrl, 'PNG', drawX, drawY, drawW, drawH);
  }
  doc.setDrawColor(148, 163, 184);
  doc.line(sigX, batchSigLineY, sigX + sigW, batchSigLineY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Firma y aclaración del cliente', sigX + sigW / 2, batchSigLineY + 4, { align: 'center' });

  addPageFooters(doc, brand.brandName);

  const safeBatch = (batchRef || 'lote').replace(/[^a-zA-Z0-9_-]/g, '-');
  const fileName = `boleta-lote-${safeBatch}.pdf`;
  const blob = doc.output('blob');
  return { doc, fileName, blob };
}

export async function downloadBatchRepairReceiptPdf(params: {
  repairs: RepairRecord[];
  batchRef: string;
  profile?: WorkshopProfile | null;
  currencyCode?: CurrencyCode;
  exchangeRate?: number;
  clientSignatureDataUrl?: string;
}): Promise<{ fileName: string; blob: Blob }> {
  const { doc, fileName, blob } = await buildBatchRepairReceiptPdf(params);
  doc.save(fileName);
  return { fileName, blob };
}

