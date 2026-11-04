import PDFDocument from 'pdfkit';
import { formatQty, formatRupiah } from './money.js';
import { formatDateId } from './format.js';

const INK = '#1a1a1a';
const MUTED = '#5d5b54';
const HAIRLINE = '#e5e3df';
const PRIMARY = '#5645d4';
const PAGE_MARGIN = 48;

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function hairline(doc, y) {
  const right = doc.page.width - PAGE_MARGIN;
  doc.moveTo(PAGE_MARGIN, y).lineTo(right, y).strokeColor(HAIRLINE).lineWidth(1).stroke();
}

function invoiceHeader(doc, { invoice, business, customer }) {
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(business.name, PAGE_MARGIN, PAGE_MARGIN);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  if (business.address) doc.text(business.address, { width: 280 });
  if (business.phone) doc.text(`Telp. ${business.phone}`);
  if (business.npwp) doc.text(`NPWP ${business.npwp}`);

  const rightX = doc.page.width - PAGE_MARGIN - 200;
  doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(14);
  doc.text('FAKTUR', rightX, PAGE_MARGIN, { width: 200, align: 'right' });
  doc.fillColor(INK).font('Helvetica').fontSize(10);
  doc.text(invoice.number, rightX, doc.y + 2, { width: 200, align: 'right' });
  doc.fillColor(MUTED);
  doc.text(`Tanggal ${formatDateId(invoice.issue_date)}`, { width: 200, align: 'right' });
  if (invoice.due_date) {
    doc.text(`Jatuh tempo ${formatDateId(invoice.due_date)}`, { width: 200, align: 'right' });
  }

  doc.y = Math.max(doc.y, 140);
  doc.fillColor(MUTED).fontSize(9).text('Kepada', PAGE_MARGIN, doc.y + 12);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(customer?.name ?? 'Pelanggan umum');
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  if (customer?.address) doc.text(customer.address, { width: 320 });
  if (customer?.phone) doc.text(customer.phone);
}

const INVOICE_COLUMNS = [
  { key: 'description', label: 'Barang', x: PAGE_MARGIN, width: 225, align: 'left' },
  { key: 'qty', label: 'Jumlah', x: 275, width: 60, align: 'right' },
  { key: 'unit_price', label: 'Harga', x: 340, width: 90, align: 'right' },
  { key: 'line_total', label: 'Subtotal', x: 435, width: 112, align: 'right' },
];

function invoiceRow(doc, cells, y) {
  let height = 0;
  for (const column of INVOICE_COLUMNS) {
    doc.text(cells[column.key], column.x, y, { width: column.width, align: column.align });
    height = Math.max(height, doc.y - y);
  }
  return y + height;
}

function invoiceItems(doc, items) {
  let y = doc.y + 18;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
  const labels = Object.fromEntries(INVOICE_COLUMNS.map((c) => [c.key, c.label]));
  y = invoiceRow(doc, labels, y) + 4;
  hairline(doc, y);
  y += 6;
  doc.font('Helvetica').fontSize(10).fillColor(INK);
  for (const item of items) {
    if (y > doc.page.height - 160) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    y = invoiceRow(
      doc,
      {
        description: item.description,
        qty: formatQty(item.qty),
        unit_price: formatRupiah(item.unit_price),
        line_total: formatRupiah(item.line_total),
      },
      y,
    );
    y += 6;
  }
  hairline(doc, y);
  doc.y = y + 8;
}

function totalLine(doc, label, value, bold = false) {
  const y = doc.y;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor(INK);
  doc.text(label, 340, y, { width: 90, align: 'right' });
  doc.text(value, 435, y, { width: 112, align: 'right' });
  doc.y = y + (bold ? 20 : 15);
}

const INVOICE_STATUS = {
  draft: 'Draf',
  issued: 'Belum lunas',
  paid: 'Lunas',
  void: 'Dibatalkan',
};

export function invoicePdf(data) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
  invoiceHeader(doc, data);
  invoiceItems(doc, data.items);
  totalLine(doc, 'Subtotal', formatRupiah(data.sale.subtotal));
  if (data.sale.discount > 0) totalLine(doc, 'Diskon', `-${formatRupiah(data.sale.discount)}`);
  totalLine(doc, 'Total', formatRupiah(data.sale.total), true);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  doc.text(`Status: ${INVOICE_STATUS[data.invoice.status]}`, PAGE_MARGIN, doc.y + 8);
  if (data.business.payment_info) {
    doc.moveDown().fillColor(INK).font('Helvetica-Bold').text('Pembayaran');
    doc.font('Helvetica').fillColor(MUTED).text(data.business.payment_info, { width: 400 });
  }
  if (data.invoice.notes) {
    doc.moveDown().fillColor(INK).font('Helvetica-Bold').text('Catatan');
    doc.font('Helvetica').fillColor(MUTED).text(data.invoice.notes, { width: 400 });
  }
  return toBuffer(doc);
}

/** A report table with the same columns, rows, and totals as the screen. */
export function reportPdf(table) {
  const landscape = table.columns.length > 5;
  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    margin: PAGE_MARGIN,
  });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(table.title);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(table.subtitle);
  doc.moveDown();

  const usable = doc.page.width - PAGE_MARGIN * 2;
  const firstWidth = Math.max(usable * 0.3, usable - 90 * (table.columns.length - 1));
  const restWidth = (usable - firstWidth) / Math.max(1, table.columns.length - 1);
  const widths = table.columns.map((_, index) => (index === 0 ? firstWidth : restWidth));

  const drawRow = (cells, y) => {
    let x = PAGE_MARGIN;
    let bottom = y;
    cells.forEach((cell, index) => {
      doc.text(String(cell), x, y, {
        width: widths[index] - 4,
        align: table.columns[index].numeric ? 'right' : 'left',
      });
      bottom = Math.max(bottom, doc.y);
      x += widths[index];
    });
    return bottom;
  };

  const formatCell = (row, column) => {
    const value = row[column.key];
    if (value === null || value === undefined) return '';
    return column.money ? formatRupiah(value) : value;
  };

  let y = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
  y = drawRow(table.columns.map((c) => c.label), y) + 4;
  hairline(doc, y);
  y += 6;
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  for (const row of table.rows) {
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    doc.font(row.emphasis ? 'Helvetica-Bold' : 'Helvetica');
    y = drawRow(table.columns.map((c) => formatCell(row, c)), y) + 5;
  }
  return toBuffer(doc);
}
