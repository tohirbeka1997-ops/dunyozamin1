'use strict';

const {
  normalizeUnit,
  quantityDecimals,
  qtyToScaled,
  scaledToString,
  scaledToNumber,
  mulDivScaled,
  ceilScaledToDecimals,
  ceilScaledToMultiple,
  mulQtyPriceInteger,
} = require('./qty.cjs');

const STATUSES = {
  SHORTAGE: 'SHORTAGE',
  RISK: 'RISK',
  OK: 'OK',
  NO_SALES: 'NO_SALES',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
};

const FORMULA = [
  'dailySalesRate = soldQty / analysisDays',
  'forecastDemand = dailySalesRate × planningDays',
  'safetyStock = dailySalesRate × safetyDays',
  'availableQty = onHandQty + confirmedInboundQty + inTransferQty - reservedQty - blockedQty - revisionQty',
  'recommendedQty = roundUp(max(0, forecastDemand + safetyStock - availableQty), unitPrecision, MOQ, orderStep)',
].join('\n');

function statusRank(status) {
  switch (status) {
    case STATUSES.SHORTAGE:
      return 0;
    case STATUSES.RISK:
      return 1;
    case STATUSES.INSUFFICIENT_DATA:
      return 2;
    case STATUSES.NO_SALES:
      return 3;
    default:
      return 4;
  }
}

function precisionStepLabel(decimals) {
  const d = Math.max(0, Math.min(6, Math.floor(Number(decimals) || 0)));
  if (d === 0) return '1';
  return `0.${'0'.repeat(d - 1)}1`;
}

function computePurchasePlanningRow(input) {
  const analysisDays = Math.max(1, Math.floor(Number(input.analysisDays) || 1));
  const planningDays = Math.max(0, Math.floor(Number(input.planningDays) || 0));
  const safetyDays = Math.max(0, Math.floor(Number(input.safetyDays) || 0));
  const unit = input.unit || 'pcs';
  const precision = quantityDecimals(unit, input.qtyPrecision);
  const unitNorm = normalizeUnit(unit);

  const soldS = qtyToScaled(input.soldQty);
  const onHandS = qtyToScaled(input.onHandQty);
  const reservedS = qtyToScaled(input.reservedQty);
  const blockedS = qtyToScaled(input.blockedQty);
  const inboundS = qtyToScaled(input.confirmedInboundQty);
  const inTransferS = qtyToScaled(input.inTransferQty);
  const revisionS = qtyToScaled(input.revisionQty);

  const dailyS = mulDivScaled(soldS, 1, analysisDays);
  const forecastS = mulDivScaled(soldS, planningDays, analysisDays);
  const safetyS = mulDivScaled(soldS, safetyDays, analysisDays);
  const availableS = onHandS + inboundS + inTransferS - reservedS - blockedS - revisionS;

  const needS = forecastS + safetyS - availableS;
  const needClampedS = needS > 0 ? needS : 0;

  const roundingParts = [];
  let recommendedS = ceilScaledToDecimals(needClampedS, precision);
  roundingParts.push(
    unitNorm === 'pcs' || precision === 0
      ? 'dona: yuqoriga (ceil) 1'
      : `ceil ${precisionStepLabel(precision)} ${unitNorm || unit}`,
  );

  const moqS = qtyToScaled(input.moq);
  const stepS = qtyToScaled(input.orderStep);
  if (recommendedS > 0 && moqS > 0 && recommendedS < moqS) {
    recommendedS = ceilScaledToDecimals(moqS, precision);
    roundingParts.push(`MOQ ${scaledToString(moqS, precision)}`);
  }
  if (recommendedS > 0 && stepS > 0) {
    const stepped = ceilScaledToMultiple(recommendedS, stepS);
    if (stepped !== recommendedS) {
      recommendedS = stepped;
      roundingParts.push(`qadam ${scaledToString(stepS, precision)}`);
    }
  }

  const roundingRule = roundingParts.join(' → ');

  const missing = [];
  if (!input.hasUnit) missing.push('unit');
  if (!input.hasSupplier) missing.push('supplier');
  if (input.lastPurchasePrice == null || input.lastPurchasePrice === '') missing.push('cost');

  let status = STATUSES.OK;
  let recommendZeroReason = null;
  if (soldS <= 0) {
    status = STATUSES.NO_SALES;
    recommendZeroReason = 'Tahlil davrida sotuv yo‘q — kunlik o‘rtacha 0, tavsiya 0.';
  } else if (availableS < forecastS) {
    status = STATUSES.SHORTAGE;
  } else if (availableS < forecastS + safetyS) {
    status = STATUSES.RISK;
  } else {
    status = STATUSES.OK;
    recommendZeroReason =
      '🟢 Yetadi: mavjud zaxira reja davri talabi + xavfsizlik zaxirasini qoplaydi, shuning uchun tavsiya 0.';
  }

  if (missing.length && status === STATUSES.OK) {
    status = STATUSES.INSUFFICIENT_DATA;
    recommendZeroReason = `Ma’lumot yetarli emas: ${missing.join(', ')}.`;
  }

  const lastPrice = Number(input.lastPurchasePrice);
  const hasPrice = Number.isFinite(lastPrice);
  const currency = String(input.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
  let recommendedValue = null;
  if (hasPrice) {
    if (currency === 'USD') {
      const cents = Math.round(lastPrice * 100);
      recommendedValue = mulQtyPriceInteger(recommendedS, cents) / 100;
    } else {
      recommendedValue = mulQtyPriceInteger(recommendedS, Math.round(lastPrice));
    }
  }

  let priceChangePct = null;
  const prev = Number(input.previousPurchasePrice);
  if (hasPrice && Number.isFinite(prev) && prev !== 0) {
    const lastS = qtyToScaled(lastPrice);
    const prevS = qtyToScaled(prev);
    if (prevS !== 0) {
      const delta = lastS - prevS;
      const pctMilli = Number((BigInt(delta) * 10000n * 100n) / BigInt(prevS));
      priceChangePct = pctMilli / 10000;
    }
  }

  const stockDays =
    dailyS > 0 ? scaledToNumber(mulDivScaled(availableS, 1_000_000, dailyS), 3) : availableS > 0 ? null : 0;

  return {
    analysis_days: analysisDays,
    plan_days: planningDays,
    safety_days: safetyDays,
    period_sales_qty: scaledToNumber(soldS, 6),
    avg_daily_sales: scaledToNumber(dailyS, precision === 0 ? 0 : Math.max(3, precision)),
    avg_daily_sales_exact: scaledToString(dailyS, 6),
    forecast_demand_qty: scaledToNumber(forecastS, 6),
    safety_qty: scaledToNumber(safetyS, 6),
    on_hand_qty: scaledToNumber(onHandS, 6),
    reserved_qty: scaledToNumber(reservedS, 6),
    blocked_qty: scaledToNumber(blockedS, 6),
    confirmed_inbound_qty: scaledToNumber(inboundS, 6),
    in_transfer_qty: scaledToNumber(inTransferS, 6),
    revision_qty: scaledToNumber(revisionS, 6),
    available_qty: scaledToNumber(availableS, 6),
    recommended_qty: scaledToNumber(recommendedS, 6),
    recommended_qty_scaled: recommendedS,
    rounding_rule: roundingRule,
    unit_precision: precision,
    status,
    data_incomplete: missing.length > 0,
    missing_fields: missing,
    recommend_zero_reason: recommendedS <= 0 ? recommendZeroReason : null,
    stock_days: stockDays,
    shortage_qty: scaledToNumber(needClampedS, 6),
    recommended_value: recommendedValue,
    currency,
    price_change_pct: priceChangePct,
    formula: FORMULA,
  };
}

module.exports = {
  STATUSES,
  FORMULA,
  statusRank,
  computePurchasePlanningRow,
};
