export type ShiftStatus = 'open' | 'closed';

export type Shift = {
  id: string;
  opened_at: string; // ISO string
  closed_at: string | null;
  opened_by: string; // user.id
  closed_by: string | null;
  opening_cash: number; // cash in drawer at start
  closing_cash: number | null;
  total_sales: number; // total amount of sales in this shift
  total_refunds: number; // total amount of returns in this shift
  status: ShiftStatus;
};








