'use strict';

const STATUS_LABELS = {
  new: 'Yangi',
  paid: 'Kassaga tushdi',
  processing: "Qabul qilindi",
  ready: 'Buyurtma tayyor',
  out_for_delivery: "Kuryer yo'lda",
  delivered: 'Yetkazildi',
  cancelled: 'Bekor qilindi',
};

function normalizeDeliveryMethod(raw) {
  const method = String(raw || '').trim().toLowerCase();
  return method === 'pickup' ? 'pickup' : 'courier';
}

function statusLabel(status) {
  const s = String(status || '').toLowerCase();
  return STATUS_LABELS[s] || s || 'yangilandi';
}

function allowedNextStatuses(currentStatus, options = {}) {
  const s = String(currentStatus || '').toLowerCase();
  const deliveryMethod = normalizeDeliveryMethod(options.deliveryMethod || options.delivery_method);
  if (s === 'new' || s === 'paid') return ['processing', 'cancelled'];
  if (s === 'processing') return ['ready', 'cancelled'];
  if (s === 'ready') {
    return deliveryMethod === 'pickup'
      ? ['delivered', 'cancelled']
      : ['out_for_delivery', 'cancelled'];
  }
  if (s === 'out_for_delivery') return ['delivered', 'cancelled'];
  return [];
}

function isValidTransition(fromStatus, toStatus, options = {}) {
  const from = String(fromStatus || '').toLowerCase();
  const to = String(toStatus || '').toLowerCase();
  if (!from || !to) return false;
  if (from === to) return true;
  return allowedNextStatuses(from, options).includes(to);
}

module.exports = {
  STATUS_LABELS,
  statusLabel,
  normalizeDeliveryMethod,
  allowedNextStatuses,
  isValidTransition,
};
