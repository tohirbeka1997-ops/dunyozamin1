export type DeliverySlot = {
  /** Stable id, used as the React key and form value */
  key: string;
  /** Human label e.g. "Bugun 14:00–16:00" */
  label: string;
  /** Day in the user's locale, e.g. "Bugun" / "Ertaga" / "12 may" */
  day: string;
  /** Time range in 24-hour format */
  range: string;
  /** unix ms — start of the slot */
  startTs: number;
  /** Whether the slot has already passed today */
  past: boolean;
  /** Whether the slot is today and starts within the next ~hour */
  soon: boolean;
};

const HOUR_BUCKETS: [number, number][] = [
  [10, 12],
  [12, 14],
  [14, 16],
  [16, 18],
  [18, 20],
  [20, 22],
];

function dayLabel(date: Date, today: Date): string {
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (isSameDay(date, today)) return 'Bugun';
  if (isSameDay(date, tomorrow)) return 'Ertaga';
  return date.toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short' });
}

/**
 * Returns the next ~6 delivery slots starting from "now". Past slots
 * are filtered, then we top up with tomorrow's slots if needed so the
 * user always has a few options to pick from.
 */
export function generateSlots(opts?: { now?: Date; horizonHours?: number }): DeliverySlot[] {
  const now = opts?.now ? new Date(opts.now) : new Date();
  const horizon = opts?.horizonHours ?? 36;
  const out: DeliverySlot[] = [];
  const horizonEnd = now.getTime() + horizon * 60 * 60 * 1000;

  for (let dayOffset = 0; dayOffset < 4; dayOffset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + dayOffset);
    day.setHours(0, 0, 0, 0);

    for (const [from, to] of HOUR_BUCKETS) {
      const start = new Date(day);
      start.setHours(from, 0, 0, 0);
      const end = new Date(day);
      end.setHours(to, 0, 0, 0);
      if (end.getTime() <= now.getTime()) continue;
      if (start.getTime() > horizonEnd) break;
      const dl = dayLabel(start, now);
      const range = `${String(from).padStart(2, '0')}:00–${String(to).padStart(2, '0')}:00`;
      out.push({
        key: `${start.toISOString().slice(0, 10)}_${from}-${to}`,
        label: `${dl} · ${range}`,
        day: dl,
        range,
        startTs: start.getTime(),
        past: false,
        soon: dayOffset === 0 && start.getTime() - now.getTime() < 90 * 60 * 1000,
      });
      if (out.length >= 8) break;
    }
    if (out.length >= 8) break;
  }
  return out;
}
