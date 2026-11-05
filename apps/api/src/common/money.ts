import Decimal from 'decimal.js';

// 全部金融计算入口。禁止在业务代码中直接使用 number 做金额运算。
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -20, toExpPos: 20 });

export type Numeric = string | number | Decimal | null | undefined;

export const ZERO = new Decimal(0);
export const HUNDRED = new Decimal(100);

export function D(v: Numeric): Decimal {
  if (v === null || v === undefined || v === '') return ZERO;
  if (v instanceof Decimal) return v;
  try {
    return new Decimal(v);
  } catch {
    return ZERO;
  }
}

/** 转数据库存储格式：去掉多余的尾随 0，但至少保留原精度 */
export function key(d: Decimal, dp = 8): string {
  return d.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed();
}

/** 转接口返回的展示格式（保留指定小数位） */
export function fixed(v: Numeric, dp = 2): string {
  return D(v).toFixed(dp);
}

export function sum<T>(list: T[], pick: (x: T) => Numeric): Decimal {
  return list.reduce((acc, x) => acc.plus(D(pick(x))), ZERO);
}

export function avg(list: Decimal[]): Decimal {
  if (list.length === 0) return ZERO;
  return list.reduce((a, b) => a.plus(b), ZERO).div(list.length);
}

/** 百分比，返回 0-100 的数值字符串 */
export function pct(part: Numeric, total: Numeric, dp = 2): string {
  const t = D(total);
  if (t.isZero()) return new Decimal(0).toFixed(dp);
  return D(part).div(t).times(HUNDRED).toFixed(dp);
}

/** 安全除法，分母为 0 返回 null（用于 R 倍数、盈亏比这类必须显示"不可计算"的指标） */
export function safeDiv(a: Numeric, b: Numeric, dp = 4): string | null {
  const d = D(b);
  if (d.isZero()) return null;
  return D(a).div(d).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed();
}

export function compareNumeric(a: Numeric, b: Numeric): number {
  return D(a).comparedTo(D(b));
}

export function isPositive(v: Numeric): boolean {
  return D(v).greaterThan(0);
}

export function isNegative(v: Numeric): boolean {
  return D(v).lessThan(0);
}

/**
 * 净收益唯一口径（见 docs/01-数据模型与计算口径.md 决策 2）
 *   netPnl = grossPnl - tradingFee + fundingFee - otherCost
 * fundingFee 入库时已统一为"收入为正、支出为负"。
 */
export function calcNetPnl(params: {
  grossPnl: Numeric;
  tradingFee: Numeric;
  fundingFee: Numeric;
  otherCost?: Numeric;
  missingComponents?: string[];
}): { netPnl: string; isEstimated: boolean; missingComponents: string[] } {
  const missing = params.missingComponents ?? [];
  const net = D(params.grossPnl)
    .minus(D(params.tradingFee))
    .plus(D(params.fundingFee))
    .minus(D(params.otherCost ?? 0));
  return {
    netPnl: key(net, 8),
    isEstimated: missing.length > 0,
    missingComponents: missing,
  };
}

/** 计划风险金额 = |entry - stop| × qty */
export function calcRiskAmount(entryPrice: Numeric, stopPrice: Numeric, quantity: Numeric): string | null {
  if (stopPrice === null || stopPrice === undefined || stopPrice === '') return null;
  const risk = D(entryPrice).minus(D(stopPrice)).abs().times(D(quantity));
  if (risk.isZero()) return null;
  return key(risk, 8);
}
