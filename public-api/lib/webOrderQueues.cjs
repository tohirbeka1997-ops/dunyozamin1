'use strict';

/** Workflow queues for POS online sales (sidebar + list filters). */
const WEB_ORDER_QUEUES = {
  incoming: {
    statuses: ['new', 'paid'],
    titleKey: 'navigation.web_orders_incoming',
  },
  preparing: {
    statuses: ['processing'],
    titleKey: 'navigation.web_orders_preparing',
  },
  ready: {
    statuses: ['ready'],
    titleKey: 'navigation.web_orders_ready',
  },
  delivering: {
    statuses: ['out_for_delivery'],
    titleKey: 'navigation.web_orders_delivering',
  },
  delivered: {
    statuses: ['delivered'],
    titleKey: 'navigation.web_orders_delivered',
  },
};

const VALID_QUEUE_IDS = new Set(Object.keys(WEB_ORDER_QUEUES));

function normalizeQueueId(raw) {
  const id = String(raw || '').trim().toLowerCase();
  return VALID_QUEUE_IDS.has(id) ? id : null;
}

function resolveQueueStatuses(filters = {}) {
  const queue = normalizeQueueId(filters.queue);
  if (queue) {
    return [...WEB_ORDER_QUEUES[queue].statuses];
  }

  const statuses = filters.statuses;
  if (Array.isArray(statuses) && statuses.length) {
    return statuses.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  }

  const csv = filters.statuses_csv ?? filters.statusesCsv;
  if (csv) {
    return String(csv)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  const single = filters.status ? String(filters.status).trim().toLowerCase() : '';
  return single ? [single] : [];
}

const VALID_SALES_CHANNELS = new Set(['telegram', 'website', 'uzum', 'yandex', 'other']);

function normalizeSalesChannel(raw) {
  const ch = String(raw || '').trim().toLowerCase();
  return VALID_SALES_CHANNELS.has(ch) ? ch : 'telegram';
}

module.exports = {
  WEB_ORDER_QUEUES,
  VALID_QUEUE_IDS,
  VALID_SALES_CHANNELS,
  normalizeQueueId,
  resolveQueueStatuses,
  normalizeSalesChannel,
};
