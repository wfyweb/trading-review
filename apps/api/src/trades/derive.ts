import { D, key, calcRiskAmount, calcNetPnl, safeDiv } from '../common/money';

export interface DeriveInput {
  direction: string;
  entryTime: Date | string;
  exitTime?: Date | string | null;
  entryPrice: string;
  exitPrice?: string | null;
  quantity: string;
  initialStopPrice?: string | null;
  margin?: string | null;
  tradingFee?: string | null;
  fundingFee?: string | null;
  grossPnl?: string | null;
  feeUnconverted?: boolean;
}

/**
 * 由原始字段推导 Trade 的全部派生字段。
 * 任何价格 / 手续费 / 止损变动都必须重新走这里，不允许在 controller 里手算。
 */
export function deriveTrade(i: DeriveInput) {
  const qty = D(i.quantity);
  const entry = D(i.entryPrice);
  const exit = i.exitPrice !== null && i.exitPrice !== undefined && i.exitPrice !== '' ? D(i.exitPrice) : null;

  const missing: string[] = [];

  // 手续费：未传视为缺失（估算），传 "0" 视为真实的零
  const feeMissing = i.tradingFee === null || i.tradingFee === undefined || i.tradingFee === '';
  if (feeMissing) missing.push('trading_fee');
  const tradingFee = feeMissing ? D(0) : D(i.tradingFee);

  const fundingMissing = i.fundingFee === null || i.fundingFee === undefined || i.fundingFee === '';
  if (fundingMissing) missing.push('funding_fee');
  const fundingFee = fundingMissing ? D(0) : D(i.fundingFee);

  // 毛收益：优先取交易所值，并与价格差做交叉校验
  let gross = i.grossPnl !== null && i.grossPnl !== undefined && i.grossPnl !== '' ? D(i.grossPnl) : null;
  let pnlMismatch = false;
  if (exit) {
    const computed = exit.minus(entry).times(qty).times(i.direction === 'LONG' ? 1 : -1);
    if (gross === null) {
      gross = computed;
    } else if (!computed.isZero()) {
      const deviation = gross.minus(computed).abs().div(computed.abs());
      if (deviation.greaterThan(0.0001)) pnlMismatch = true;
    }
  }
  if (gross === null) {
    gross = D(0);
    missing.push('gross_pnl');
  }

  const { netPnl, isEstimated, missingComponents } = calcNetPnl({
    grossPnl: gross,
    tradingFee,
    fundingFee,
    missingComponents: missing,
  });

  const riskAmount = calcRiskAmount(entry, i.initialStopPrice, qty);
  const rMultiple = riskAmount ? safeDiv(netPnl, riskAmount) : null;

  const exitTime = i.exitTime ? new Date(i.exitTime) : null;
  const entryTime = new Date(i.entryTime);
  const holdingSeconds = exitTime ? Math.max(0, Math.round((exitTime.getTime() - entryTime.getTime()) / 1000)) : null;

  const margin = i.margin ? D(i.margin) : null;
  const actualLeverage = margin && !margin.isZero() ? safeDiv(entry.times(qty), margin, 2) : null;

  return {
    status: exitTime ? 'CLOSED' : 'OPEN',
    entryTime,
    exitTime,
    holdingSeconds,
    entryPrice: key(entry),
    exitPrice: exit ? key(exit) : null,
    quantity: key(qty),
    margin: margin ? key(margin) : null,
    actualLeverage,
    initialStopPrice: i.initialStopPrice ? key(D(i.initialStopPrice)) : null,
    riskAmount,
    grossPnl: key(gross),
    tradingFee: key(tradingFee),
    fundingFee: key(fundingFee),
    netPnl,
    netPnlEstimated: isEstimated || Boolean(i.feeUnconverted),
    missingComponents: missingComponents.length ? missingComponents.join(',') : null,
    pnlMismatch,
    rMultiple,
    rMultipleSource: rMultiple ? 'PLANNED_STOP' : 'NONE',
  };
}
