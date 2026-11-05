import { D, ZERO, avg, key, safeDiv, sum } from '../common/money';

export interface TradeLike {
  id: string;
  status: string;
  netPnl: string;
  grossPnl: string;
  tradingFee: string;
  fundingFee: string;
  rMultiple: string | null;
  holdingSeconds: number | null;
  entryTime: Date | string;
  exitTime: Date | string | null;
}

export interface PerformanceResult {
  tradeCount: number;
  closedCount: number;
  netPnl: string;
  grossPnl: string;
  totalFee: string;
  totalFunding: string;
  winCount: number;
  lossCount: number;
  winRate: string | null;
  avgWin: string | null;
  avgLoss: string | null;
  profitFactor: string | null;
  expectancyUsdt: string | null;
  expectancyR: string | null;
  rSampleSize: number;
  bestTrade: string | null;
  worstTrade: string | null;
  avgHoldingSeconds: number | null;
  feeRatio: string | null;
  rCoverage: string | null;
}

/** 统计口径见 docs/01-数据模型与计算口径.md 第五节 */
export function computePerformance(trades: TradeLike[]): PerformanceResult {
  const closed = trades.filter((t) => t.status === 'CLOSED');
  const wins = closed.filter((t) => D(t.netPnl).greaterThan(0));
  const losses = closed.filter((t) => D(t.netPnl).lessThanOrEqualTo(0));

  const netPnl = sum(closed, (t) => t.netPnl);
  const grossPnl = sum(closed, (t) => t.grossPnl);
  const totalFee = sum(closed, (t) => t.tradingFee);
  const totalFunding = sum(closed, (t) => t.fundingFee);

  const winSum = sum(wins, (t) => t.netPnl);
  const lossSum = sum(losses, (t) => t.netPnl);

  const rTrades = closed.filter((t) => t.rMultiple !== null && t.rMultiple !== undefined && t.rMultiple !== '');
  const rValues = rTrades.map((t) => D(t.rMultiple));

  const holdingList = closed.map((t) => t.holdingSeconds).filter((v): v is number => typeof v === 'number');

  const netPnlStr = key(netPnl);
  const feeRatio = netPnl.isZero() ? null : safeDiv(totalFee, netPnl.abs(), 4);

  return {
    tradeCount: trades.length,
    closedCount: closed.length,
    netPnl: netPnlStr,
    grossPnl: key(grossPnl),
    totalFee: key(totalFee),
    totalFunding: key(totalFunding),
    winCount: wins.length,
    lossCount: losses.length,
    winRate: closed.length ? safeDiv(wins.length, closed.length, 4) : null,
    avgWin: wins.length ? key(winSum.div(wins.length)) : null,
    avgLoss: losses.length ? key(lossSum.div(losses.length)) : null,
    profitFactor: lossSum.isZero() ? null : safeDiv(winSum, lossSum.abs(), 4),
    expectancyUsdt: closed.length ? key(netPnl.div(closed.length)) : null,
    expectancyR: rValues.length ? key(avg(rValues)) : null,
    rSampleSize: rValues.length,
    bestTrade: closed.length ? key(DecimalMax(closed.map((t) => t.netPnl))) : null,
    worstTrade: closed.length ? key(DecimalMin(closed.map((t) => t.netPnl))) : null,
    avgHoldingSeconds: holdingList.length ? Math.round(holdingList.reduce((a, b) => a + b, 0) / holdingList.length) : null,
    feeRatio,
    rCoverage: closed.length ? safeDiv(rValues.length, closed.length, 4) : null,
  };
}

function DecimalMax(values: string[]) {
  return values.reduce((a, b) => (D(b).greaterThan(a) ? D(b) : a), D(values[0] ?? 0));
}

function DecimalMin(values: string[]) {
  return values.reduce((a, b) => (D(b).lessThan(a) ? D(b) : a), D(values[0] ?? 0));
}

export interface EquityPoint {
  index: number;
  date: string;
  equity: string;
  netPnl: string;
  drawdownPct: string;
  peak: string;
}

/**
 * 权益曲线：基于 tradingEquity = baselineCapital + ΣnetPnl
 * 划转不计入（见决策 3）
 */
export function buildEquityCurve(trades: TradeLike[], baselineCapital: string): EquityPoint[] {
  const sorted = [...trades]
    .filter((t) => t.status === 'CLOSED')
    .sort((a, b) => new Date(a.exitTime ?? a.entryTime).getTime() - new Date(b.exitTime ?? b.entryTime).getTime());

  let equity = D(baselineCapital);
  let peak = equity;
  const points: EquityPoint[] = [
    {
      index: 0,
      date: toDateStr(sorted[0]?.entryTime ?? new Date()),
      equity: key(equity),
      netPnl: '0',
      drawdownPct: '0',
      peak: key(peak),
    },
  ];

  sorted.forEach((t, i) => {
    equity = equity.plus(D(t.netPnl));
    if (equity.greaterThan(peak)) peak = equity;
    const dd = peak.isZero() ? ZERO : equity.minus(peak).div(peak).times(100);
    points.push({
      index: i + 1,
      date: toDateStr(t.exitTime ?? t.entryTime),
      equity: key(equity),
      netPnl: key(D(t.netPnl)),
      drawdownPct: dd.toFixed(2),
      peak: key(peak),
    });
  });

  return points;
}

export function maxDrawdown(points: EquityPoint[]): string {
  if (points.length === 0) return '0';
  const min = points.reduce((a, b) => (D(b.drawdownPct).lessThan(a) ? b.drawdownPct : a), '0');
  return D(min).toFixed(2);
}

export function toDateStr(d: Date | string): string {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// 以下为「不能只看胜率」的三组拆解：持仓时长分层、收益集中度、多空对比
// 判断准则参考《交易策略》文档：短线是否被手续费吃掉、利润是否只靠少数单、
// 多空偏好是否拖累收益。
// ---------------------------------------------------------------------------

export interface HoldingBucket {
  key: string;
  label: string;
  minMinutes: number;
  maxMinutes: number | null;
  count: number;
  share: string | null;
  winRate: string | null;
  netPnl: string;
  grossPnl: string;
  fee: string;
  /** 每笔期望（净） */
  expectancy: string | null;
  feeToGross: string | null;
  /** 该层净收益占总净收益的绝对比例 */
  netShare: string | null;
  verdict: 'PROFITABLE' | 'MARGINAL' | 'LOSING' | 'INSUFFICIENT';
}

export interface ConcentrationResult {
  sampleSize: number;
  profitableCount: number;
  totalPositivePnl: string;
  totalNetPnl: string;
  /** 盈利前 1% / 5% 的交易占「全部盈利之和」的比例 */
  top1Share: string | null;
  top5Share: string | null;
  top1Pnl: string;
  top5Pnl: string;
  /** 剔除盈利最高的 5% 之后，剩余交易的净收益 */
  netWithoutTop5: string;
  /** 稳定性判定：靠少数单撑起来的策略不能算成熟 */
  stability: 'ROBUST' | 'CONCENTRATED' | 'EXTREME' | 'INSUFFICIENT';
  note: string;
}

export interface DirectionStat {
  direction: 'LONG' | 'SHORT';
  count: number;
  share: string;
  winRate: string | null;
  netPnl: string;
  grossPnl: string;
  fee: string;
  avgWin: string | null;
  avgLoss: string | null;
  expectancy: string | null;
}

const HOLDING_BUCKETS: { key: string; label: string; min: number; max: number | null }[] = [
  { key: '0-5m', label: '0–5 分钟', min: 0, max: 300 },
  { key: '5-30m', label: '5–30 分钟', min: 300, max: 1800 },
  { key: '30m-3h', label: '30 分钟–3 小时', min: 1800, max: 10800 },
  { key: '3h+', label: '3 小时以上', min: 10800, max: null },
];

export function buildHoldingBuckets(trades: TradeLike[]): HoldingBucket[] {
  const closed = trades.filter((t) => t.status === 'CLOSED');
  const totalNet = sum(closed, (t) => t.netPnl);

  return HOLDING_BUCKETS.map((b) => {
    const items = closed.filter((t) => {
      const sec = t.holdingSeconds ?? 0;
      return sec >= b.min && (b.max === null || sec < b.max);
    });
    const net = sum(items, (t) => t.netPnl);
    const gross = sum(items, (t) => t.grossPnl);
    const fee = sum(items, (t) => t.tradingFee);
    const wins = items.filter((t) => D(t.netPnl).greaterThan(0)).length;
    const expectancy = items.length ? net.div(items.length) : null;

    let verdict: HoldingBucket['verdict'] = 'INSUFFICIENT';
    if (items.length >= 10) {
      if (expectancy && expectancy.greaterThan(0)) verdict = 'PROFITABLE';
      else if (expectancy && expectancy.greaterThan(-0.5)) verdict = 'MARGINAL';
      else verdict = 'LOSING';
    }

    return {
      key: b.key,
      label: b.label,
      minMinutes: b.min / 60,
      maxMinutes: b.max === null ? null : b.max / 60,
      count: items.length,
      share: closed.length ? safeDiv(items.length, closed.length, 4) : '0',
      winRate: items.length ? safeDiv(wins, items.length, 4) : null,
      netPnl: key(net, 4),
      grossPnl: key(gross, 4),
      fee: key(fee, 4),
      expectancy: expectancy ? key(expectancy, 4) : null,
      feeToGross: gross.isZero() ? null : safeDiv(fee, gross.abs(), 4),
      netShare: totalNet.isZero() ? null : safeDiv(net, totalNet.abs(), 4),
      verdict,
    };
  });
}

export function buildConcentration(trades: TradeLike[]): ConcentrationResult {
  const closed = trades.filter((t) => t.status === 'CLOSED');
  const sorted = [...closed].sort((a, b) => D(b.netPnl).comparedTo(D(a.netPnl)));
  const positives = sorted.filter((t) => D(t.netPnl).greaterThan(0));
  const totalPositive = sum(positives, (t) => t.netPnl);
  const totalNet = sum(closed, (t) => t.netPnl);

  const takeN = (ratio: number) => Math.max(1, Math.round(closed.length * ratio));
  const sumTop = (n: number) => sum(sorted.slice(0, n), (t) => t.netPnl);

  const top1N = takeN(0.01);
  const top5N = takeN(0.05);
  const top1Pnl = sumTop(top1N);
  const top5Pnl = sumTop(top5N);
  const netWithoutTop5 = totalNet.minus(top5Pnl);

  const top1Share = totalPositive.isZero() ? null : safeDiv(top1Pnl, totalPositive, 4);
  const top5Share = totalPositive.isZero() ? null : safeDiv(top5Pnl, totalPositive, 4);

  let stability: ConcentrationResult['stability'] = 'INSUFFICIENT';
  let note = '样本不足，不做稳定性判断';
  if (closed.length >= 20 && top5Share !== null) {
    const r = D(top5Share);
    if (r.lessThan(0.5)) {
      stability = 'ROBUST';
      note = '盈利分布相对均匀，不是靠个别大单撑着';
    } else if (r.lessThan(0.8)) {
      stability = 'CONCENTRATED';
      note = '盈利较集中，剔除最好的 5% 后利润明显缩水';
    } else {
      stability = 'EXTREME';
      note = '盈利几乎全部来自极少数交易，这个策略还称不上成熟';
    }
  }

  return {
    sampleSize: closed.length,
    profitableCount: positives.length,
    totalPositivePnl: key(totalPositive, 4),
    totalNetPnl: key(totalNet, 4),
    top1Share,
    top5Share,
    top1Pnl: key(top1Pnl, 4),
    top5Pnl: key(top5Pnl, 4),
    netWithoutTop5: key(netWithoutTop5, 4),
    stability,
    note,
  };
}

export function buildDirectionSplit(trades: TradeLike[]): DirectionStat[] {
  const closed = trades.filter((t) => t.status === 'CLOSED');
  return (['LONG', 'SHORT'] as const).map((dir) => {
    const items = closed.filter((t) => (t as any).direction === dir);
    const wins = items.filter((t) => D(t.netPnl).greaterThan(0));
    const losses = items.filter((t) => D(t.netPnl).lessThanOrEqualTo(0));
    const net = sum(items, (t) => t.netPnl);
    return {
      direction: dir,
      count: items.length,
      share: closed.length ? safeDiv(items.length, closed.length, 4) : '0',
      winRate: items.length ? safeDiv(wins.length, items.length, 4) : null,
      netPnl: key(net, 4),
      grossPnl: key(sum(items, (t) => t.grossPnl), 4),
      fee: key(sum(items, (t) => t.tradingFee), 4),
      avgWin: wins.length ? key(sum(wins, (t) => t.netPnl).div(wins.length), 4) : null,
      avgLoss: losses.length ? key(sum(losses, (t) => t.netPnl).div(losses.length), 4) : null,
      expectancy: items.length ? key(net.div(items.length), 4) : null,
    };
  });
}
