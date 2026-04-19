import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Params = Partial<
  Record<keyof URLSearchParams, string | number | null | undefined>
>;

export function createQueryString(
  params: Params,
  searchParams: URLSearchParams
) {
  const newSearchParams = new URLSearchParams(searchParams?.toString());

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      newSearchParams.delete(key);
    } else {
      newSearchParams.set(key, String(value));
    }
  }

  return newSearchParams.toString();
}

// NOTE:
// Prefer using timezone-safe helpers from `src/lib/datetime.ts` for app UI.
// This helper is kept for generic formatting needs in UI utilities.
export function formatDate(
  date: Date | string | number,
  opts: Intl.DateTimeFormatOptions = {}
) {
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: (opts as any).timeZone ?? "Asia/Tashkent",
    month: opts.month ?? "2-digit",
    day: opts.day ?? "2-digit",
    year: opts.year ?? "numeric",
    ...opts,
  }).format(new Date(date));
}
