import { Badge } from '../components/ui.jsx';

const PAYMENT_STATUS = {
  paid: { label: 'Lunas', tone: 'green' },
  open: { label: 'Belum dibayar', tone: 'orange' },
  partial: { label: 'Sebagian', tone: 'sky' },
  void: { label: 'Dibatalkan', tone: 'gray' },
};

export function PaymentBadge({ status }) {
  const { label, tone } = PAYMENT_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const INVOICE_STATUS = {
  draft: { label: 'Draf', tone: 'gray' },
  issued: { label: 'Belum lunas', tone: 'orange' },
  paid: { label: 'Lunas', tone: 'green' },
  void: { label: 'Dibatalkan', tone: 'gray' },
};

export function InvoiceBadge({ status }) {
  const { label, tone } = INVOICE_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}
