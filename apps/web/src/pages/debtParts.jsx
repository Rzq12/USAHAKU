import { Badge } from '../components/ui.jsx';

const STATUS = {
  open: { label: 'Belum dibayar', tone: 'orange' },
  partial: { label: 'Sebagian', tone: 'sky' },
  paid: { label: 'Lunas', tone: 'green' },
  void: { label: 'Dibatalkan', tone: 'gray' },
};

export function DebtBadge({ debt }) {
  if (debt.days_overdue > 0) return <Badge tone="red">Terlambat</Badge>;
  const { label, tone } = STATUS[debt.status];
  return <Badge tone={tone}>{label}</Badge>;
}
