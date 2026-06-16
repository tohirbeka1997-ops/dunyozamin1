// Exchange rates domain (Desktop/Electron). Split out of `api.ts`.

import { requireElectron } from '@/utils/electron';
import { delay, hasPosApi, ipc } from './internal';

export const getLatestExchangeRate = async (filters: {
  base_currency: string;
  quote_currency: string;
  on_date?: string; // YYYY-MM-DD
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.exchangeRates.getLatest(filters));
  }
  await delay();
  // Browser/mock: no FX rates store yet
  return null;
};

export const listExchangeRates = async (filters: {
  base_currency: string;
  quote_currency: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.exchangeRates.list(filters));
  }
  await delay();
  return [];
};

export const upsertExchangeRate = async (payload: {
  base_currency: string;
  quote_currency: string;
  rate: number;
  effective_date: string;
  source?: string;
  created_by?: string | null;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.exchangeRates.upsert(payload));
  }
  await delay();
  return { ...payload, id: 'mock-fx' };
};
