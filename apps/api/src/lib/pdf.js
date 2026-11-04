import PDFDocument from 'pdfkit';
import { formatAccounting, formatQty, formatRupiah } from './money.js';
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
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(business.name, PAGE_MARGIN, PAGE_MARGIN);
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
  doc
    .fillColor(MUTED)
    .fontSize(9)
    .text('Kepada', PAGE_MARGIN, doc.y + 12);
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(customer?.name ?? 'Pelanggan umum');
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
  doc
    .font(bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(bold ? 12 : 10)
    .fillColor(INK);
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

const REPORT_MARGIN = { top: 56, bottom: 72, left: 56, right: 56 };
const REPORT_BODY_SIZE = 10;
const HEADER_FILL = '#f0eeec';
const SECTION_FILL = '#f6f5f4';
const CELL_PADDING_X = 6;
const CELL_PADDING_Y = 5;
const SECTION_GAP = 18;
const SECTION_TITLE_HEIGHT = 22;
const SIGNATURE_HEIGHT = 92;
const LANDSCAPE_ABOVE_COLUMNS = 7;

function bottomLimit(doc) {
  return doc.page.height - REPORT_MARGIN.bottom;
}

function usableWidth(doc) {
  return doc.page.width - REPORT_MARGIN.left - REPORT_MARGIN.right;
}

function rule(doc, y, width = 0.75, color = INK) {
  doc
    .moveTo(REPORT_MARGIN.left, y)
    .lineTo(doc.page.width - REPORT_MARGIN.right, y)
    .strokeColor(color)
    .lineWidth(width)
    .stroke();
}

function columnWidths(doc, columns) {
  const usable = usableWidth(doc);
  const rest = Math.min(112, (usable * 0.72) / Math.max(1, columns.length - 1));
  return columns.map((_, index) => (index === 0 ? usable - rest * (columns.length - 1) : rest));
}

function rowHeight(doc, widths, cells) {
  const heights = cells.map((cell, index) =>
    doc.heightOfString(String(cell), { width: widths[index] - CELL_PADDING_X * 2 }),
  );
  return Math.max(...heights, 0) + CELL_PADDING_Y * 2;
}

function drawCells(doc, columns, widths, cells, y, indent = 0) {
  let x = REPORT_MARGIN.left;
  cells.forEach((cell, index) => {
    const shift = index === 0 ? indent : 0;
    doc.text(String(cell), x + CELL_PADDING_X + shift, y + CELL_PADDING_Y, {
      width: widths[index] - CELL_PADDING_X * 2 - shift,
      align: columns[index].numeric ? 'right' : 'left',
      lineBreak: true,
    });
    x += widths[index];
  });
}

function drawTableHeader(doc, section, widths, y) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
  const labels = section.columns.map((column) => column.label);
  const height = rowHeight(doc, widths, labels);
  doc.rect(REPORT_MARGIN.left, y, usableWidth(doc), height).fill(HEADER_FILL);
  doc.fillColor(INK);
  drawCells(doc, section.columns, widths, labels, y);
  return y + height;
}

function drawSectionTitle(doc, title, y) {
  const height = SECTION_TITLE_HEIGHT;
  doc.rect(REPORT_MARGIN.left, y, usableWidth(doc), height).fill(SECTION_FILL);
  doc.font('Helvetica-Bold').fontSize(REPORT_BODY_SIZE).fillColor(INK);
  doc.text(title, REPORT_MARGIN.left + CELL_PADDING_X, y + 6, { lineBreak: false });
  return y + height;
}

function formatReportCell(row, column) {
  const value = row[column.key];
  if (value === null || value === undefined) return '';
  return column.money ? formatAccounting(value) : value;
}

function sectionHeight(doc, section, widths) {
  let height = section.title ? SECTION_TITLE_HEIGHT : 0;
  if (!section.plain) {
    doc.font('Helvetica-Bold').fontSize(9);
    height += rowHeight(
      doc,
      widths,
      section.columns.map((column) => column.label),
    );
  }
  for (const row of section.rows) {
    doc.font(row.emphasis ? 'Helvetica-Bold' : 'Helvetica').fontSize(REPORT_BODY_SIZE);
    const cells = section.columns.map((column) => formatReportCell(row, column));
    height += rowHeight(doc, widths, cells) + (row.double ? 3 : 0);
  }
  return height;
}

/** A section that fits on one page moves whole, so its total never lands alone on the next. */
function drawSection(doc, section, startY) {
  const widths = columnWidths(doc, section.columns);
  const height = sectionHeight(doc, section, widths);
  const pageRoom = bottomLimit(doc) - REPORT_MARGIN.top;
  let y = startY;
  if (y + (height <= pageRoom ? height : 70) > bottomLimit(doc)) {
    doc.addPage();
    y = REPORT_MARGIN.top;
  }
  if (section.title) y = drawSectionTitle(doc, section.title, y);
  if (!section.plain) y = drawTableHeader(doc, section, widths, y);

  for (const row of section.rows) {
    const cells = section.columns.map((column) => formatReportCell(row, column));
    doc
      .font(row.emphasis ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(REPORT_BODY_SIZE)
      .fillColor(INK);
    const height = rowHeight(doc, widths, cells);
    if (y + height + 4 > bottomLimit(doc)) {
      doc.addPage();
      y = REPORT_MARGIN.top;
      if (!section.plain) y = drawTableHeader(doc, section, widths, y);
      doc
        .font(row.emphasis ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(REPORT_BODY_SIZE)
        .fillColor(INK);
    }
    if (row.emphasis) rule(doc, y, 1);
    drawCells(doc, section.columns, widths, cells, y, row.indent ? 12 : 0);
    y += height;
    if (row.double) {
      rule(doc, y, 0.75);
      rule(doc, y + 2.5, 0.75);
      y += 3;
    } else if (!row.emphasis) {
      rule(doc, y, 0.5, HAIRLINE);
    }
  }
  return y;
}

function drawNotes(doc, notes, startY) {
  if (notes.length === 0) return startY;
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  let y = startY + 12;
  for (const note of notes) {
    const height = doc.heightOfString(note, { width: usableWidth(doc) });
    if (y + height > bottomLimit(doc)) {
      doc.addPage();
      y = REPORT_MARGIN.top;
    }
    doc.text(note, REPORT_MARGIN.left, y, { width: usableWidth(doc) });
    y += height + 3;
  }
  return y;
}

function drawSignatures(doc, printedBy, startY) {
  let y = startY + SECTION_GAP + 6;
  if (y + SIGNATURE_HEIGHT > bottomLimit(doc)) {
    doc.addPage();
    y = REPORT_MARGIN.top;
  }
  const width = 170;
  const blocks = [
    { label: 'Dibuat oleh', name: printedBy, x: REPORT_MARGIN.left },
    { label: 'Disetujui oleh', name: '', x: doc.page.width - REPORT_MARGIN.right - width },
  ];
  for (const block of blocks) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    doc.text(block.label, block.x, y, { width });
    const lineY = y + 62;
    doc
      .moveTo(block.x, lineY)
      .lineTo(block.x + width, lineY)
      .strokeColor(INK)
      .lineWidth(0.75)
      .stroke();
    doc.fillColor(INK).text(block.name, block.x, lineY + 5, { width });
  }
}

/** Written last, once the page count is known. */
function drawFooters(doc, meta) {
  const { start, count } = doc.bufferedPageRange();
  for (let index = start; index < start + count; index += 1) {
    doc.switchToPage(index);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 44;
    rule(doc, y - 6, 0.5, HAIRLINE);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    doc.text(`Dicetak ${meta.printedAt} oleh ${meta.printedBy}`, REPORT_MARGIN.left, y, {
      lineBreak: false,
    });
    doc.text(`Halaman ${index - start + 1} dari ${count}`, REPORT_MARGIN.left, y, {
      width: usableWidth(doc),
      align: 'right',
      lineBreak: false,
    });
    doc.page.margins.bottom = savedBottom;
  }
}

/** A financial report: same figures as the screen, in statement form. */
export function reportPdf(table, meta) {
  const widest = Math.max(...table.sections.map((section) => section.columns.length));
  const doc = new PDFDocument({
    size: 'A4',
    layout: widest > LANDSCAPE_ABOVE_COLUMNS ? 'landscape' : 'portrait',
    margins: REPORT_MARGIN,
    bufferPages: true,
    info: { Title: `${table.title} - ${meta.businessName}` },
  });

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(meta.businessName);
  doc.fontSize(15).text(table.title.toUpperCase(), { characterSpacing: 0.3 });
  doc.moveDown(0.15);
  doc.font('Helvetica').fontSize(REPORT_BODY_SIZE).fillColor(MUTED).text(table.subtitle);
  doc.text(table.basis);
  let y = doc.y + 8;
  rule(doc, y, 1.25);
  y += 14;

  table.sections.forEach((section, index) => {
    y = drawSection(doc, section, index === 0 ? y : y + SECTION_GAP);
  });
  y = drawNotes(doc, table.notes ?? [], y);
  drawSignatures(doc, meta.printedBy, y);
  drawFooters(doc, meta);
  return toBuffer(doc);
}
