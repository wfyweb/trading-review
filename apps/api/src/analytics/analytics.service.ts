import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { TradesService } from '../trades/trades.service';
import { TradeQueryDto } from '../trades/trades.dto';
import { D, key, pct, safeDiv, sum } from '../common/money';
import { DIAGNOSTIC_THRESHOLDS as TH } from '../common/constants';
import {
  buildConcentration,
  buildDirectionSplit,
  buildEquityCurve,
  buildHoldingBuckets,
  computePerformance,
  maxDrawdown,
  toDateStr,
  type TradeLike,
} from './performance';

@Injectable()
export class AnalyticsService {
  constructor(
    private prisma: PrismaService,
    private trades: TradesService,
    private accounts: AccountsService,
  ) {}

  async overview(q: TradeQueryDto) {
    const positions = await this.trades.fetchAll(q);
    return this.computeOverview(positions);
  }

  private async computeOverview(positions: any[]) {
    const baseline = await this.accounts.getBaseline();
    const perf = computePerformance(positions as TradeLike[]);

    const equityPoints = buildEquityCurve(positions as TradeLike[], baseline);
    const mdd = maxDrawdown(equityPoints);
    const finalEquity = equityPoints.length ? equityPoints[equityPoints.length - 1].equity : baseline;
    const returnPct = safeDiv(D(finalEquity).minus(D(baseline)), D(baseline), 4);

    const withFee = positions.filter((t) => t.feeUnconverted).length;
    const estimated = positions.filter((t) => t.netPnlEstimated).length;
    const mismatch = positions.filter((t) => t.pnlMismatch).length;

    return {
      baselineCapital: baseline,
      finalEquity: key(D(finalEquity)),
      returnPct,
      maxDrawdownPct: mdd,
      ...perf,
      feeRatio: perf.feeRatio ? key(D(perf.feeRatio).times(100), 2) : null,
      returnPctDisplay: returnPct ? key(D(returnPct).times(100), 2) : null,
      quality: {
        estimatedCount: estimated,
        feeUnconvertedCount: withFee,
        pnlMismatchCount: mismatch,
        needsReviewCount: positions.filter((t) => t.matchingStatus === 'NEEDS_REVIEW' || t.status === 'NEEDS_REVIEW').length,
        missingStopCount: positions.filter((t) => !t.initialStopPrice).length,
      },
    };
  }

  /** 持仓时长分层 / 收益集中度 / 多空对比：判断「策略是否真赚钱」的三把尺子 */
  async breakdown(q: TradeQueryDto) {
    const rows = await this.trades.fetchAll(q);
    return {
      holdingBuckets: buildHoldingBuckets(rows as TradeLike[]),
      concentration: buildConcentration(rows as TradeLike[]),
      directionSplit: buildDirectionSplit(rows as TradeLike[]),
    };
  }

  async equityCurve(q: TradeQueryDto) {
    const baseline = await this.accounts.getBaseline();
    const rows = await this.trades.fetchAll(q);
    const points = buildEquityCurve(rows as TradeLike[], baseline);
    return { baselineCapital: baseline, points, maxDrawdownPct: maxDrawdown(points) };
  }

  async strategies(q: TradeQueryDto) {
    const rows = await this.trades.fetchAll(q);
    const list = await this.prisma.strategy.findMany();
    const map = new Map(list.map((s) => [s.id, s]));

    const groups = new Map<string, any[]>();
    for (const t of rows) {
      const k = t.strategyId ?? '__NONE__';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(t);
    }

    const result = [...groups.entries()].map(([id, items]) => {
      const perf = computePerformance(items as TradeLike[]);
      const conc = buildConcentration(items as TradeLike[]);
      const netPnl = sum(items, (t) => t.netPnl);
      const grossAbs = D(perf.grossPnl).abs();
      const feeToGross = grossAbs.isZero() ? null : safeDiv(D(perf.totalFee), grossAbs, 4);

      // 判定必须同时看三件事：样本够不够、期望正不正、利润是不是靠少数单撑着
      let verdict: 'OK' | 'REASSESS' | 'FRAGILE' | 'INSUFFICIENT' = 'OK';
      if (perf.closedCount < TH.MIN_SAMPLE_FOR_STRATEGY) verdict = 'INSUFFICIENT';
      else if (D(netPnl).lessThan(0)) verdict = 'REASSESS';
      else if (conc.stability === 'EXTREME') verdict = 'FRAGILE';

      const verdictReason =
        verdict === 'INSUFFICIENT'
          ? `样本 ${perf.closedCount} 笔，不足 ${TH.MIN_SAMPLE_FOR_STRATEGY} 笔，不下结论`
          : verdict === 'REASSESS'
            ? `样本 ${perf.closedCount} 笔，净收益 ${key(netPnl, 2)}，期望值 ${perf.expectancyUsdt}，需要重新评估`
            : verdict === 'FRAGILE'
              ? `净收益为正，但最好的 5% 交易贡献了 ${(Number(conc.top5Share) * 100).toFixed(0)}% 的利润，剔除后只剩 ${conc.netWithoutTop5}`
              : `样本 ${perf.closedCount} 笔，期望值 ${perf.expectancyUsdt}，利润分布可接受`;

      return {
        strategyId: id === '__NONE__' ? null : id,
        name: id === '__NONE__' ? '未归类' : map.get(id)?.name ?? '已删除策略',
        rules: map.get(id)?.rules ?? null,
        ...perf,
        totalR: key(sum(items.filter((t) => t.rMultiple), (t) => t.rMultiple)),
        feeToGross,
        top5Share: conc.top5Share,
        netWithoutTop5: conc.netWithoutTop5,
        stability: conc.stability,
        verdict,
        verdictReason,
      };
    });

    result.sort((a, b) => D(b.netPnl).comparedTo(D(a.netPnl)));
    return result;
  }

  async tags(q: TradeQueryDto) {
    const acc = await this.accounts.ensureDefault();
    const rows = await this.trades.fetchAll(q);
    const tags = await this.prisma.tag.findMany({ where: { accountId: acc.id } });

    return tags
      .map((tag) => {
        const items = rows.filter((t) => t.tags?.some((tt: any) => tt.tagId === tag.id));
        const perf = computePerformance(items as TradeLike[]);
        return {
          ...tag,
          ...perf,
          avgNetPnl: perf.closedCount ? key(D(perf.netPnl).div(perf.closedCount), 4) : null,
        };
      })
      .sort((a, b) => b.closedCount - a.closedCount);
  }

  async risk(q: TradeQueryDto) {
    const rows = (await this.trades.fetchAll(q)) as any[];
    const closed = rows
      .filter((t) => t.status === 'CLOSED')
      .sort((a, b) => new Date(a.exitTime ?? a.entryTime).getTime() - new Date(b.exitTime ?? b.entryTime).getTime());

    // 连续亏损
    let streak = 0;
    let longestLosing = 0;
    let longestWinning = 0;
    let curWin = 0;
    for (const t of closed) {
      if (D(t.netPnl).lessThan(0)) {
        streak += 1;
        curWin = 0;
        longestLosing = Math.max(longestLosing, streak);
      } else {
        curWin += 1;
        streak = 0;
        longestWinning = Math.max(longestWinning, curWin);
      }
    }

    // 连亏后是否放大仓位
    const scaleUps: any[] = [];
    for (let i = TH.LOSS_STREAK; i < closed.length; i++) {
      const prev = closed.slice(i - TH.LOSS_STREAK, i);
      if (!prev.every((t) => D(t.netPnl).lessThan(0))) continue;
      const avgNotional =
        prev.reduce((acc, t) => acc.plus(D(t.entryPrice).times(D(t.quantity))), D(0)).div(prev.length);
      const current = D(closed[i].entryPrice).times(D(closed[i].quantity));
      if (avgNotional.greaterThan(0) && current.div(avgNotional).greaterThan(TH.POSITION_SCALE_AFTER_STREAK)) {
        scaleUps.push({
          tradeId: closed[i].id,
          symbol: closed[i].symbol,
          entryTime: closed[i].entryTime,
          ratio: safeDiv(current, avgNotional, 2),
          netPnl: closed[i].netPnl,
        });
      }
    }

    // 每日盈亏
    const dailyMap = new Map<string, ReturnType<typeof D>>();
    for (const t of closed) {
      const d = toDateStr(t.exitTime ?? t.entryTime);
      dailyMap.set(d, (dailyMap.get(d) ?? D(0)).plus(D(t.netPnl)));
    }
    const daily = [...dailyMap.entries()]
      .map(([date, v]) => ({ date, netPnl: key(v) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const worstDay = daily.reduce((a, b) => (D(b.netPnl).lessThan(D(a.netPnl)) ? b : a), daily[0] ?? { date: '', netPnl: '0' });

    // 交易对集中度
    const symbolMap = new Map<string, number>();
    for (const t of closed) symbolMap.set(t.symbol, (symbolMap.get(t.symbol) ?? 0) + 1);
    const concentration = [...symbolMap.entries()]
      .map(([symbol, count]) => ({ symbol, count, share: pct(count, closed.length || 1) }))
      .sort((a, b) => b.count - a.count);

    const missingStop = rows.filter((t) => !t.initialStopPrice).length;

    return {
      longestLosingStreak: longestLosing,
      longestWinningStreak: longestWinning,
      scaleUpAfterLoss: scaleUps,
      worstDay,
      daily,
      concentration,
      missingStopCount: missingStop,
      missingStopRatio: rows.length ? safeDiv(missingStop, rows.length, 4) : null,
      avgRiskAmount: (() => {
        const withRisk = rows.filter((t) => t.riskAmount);
        return withRisk.length ? key(sum(withRisk, (t) => t.riskAmount).div(withRisk.length), 4) : null;
      })(),
    };
  }

  /** 诊断规则：全部透明，输出样本量 / 阈值 / 关联交易（见文档第四节） */
  async diagnostics(q: TradeQueryDto) {
    const rows = (await this.trades.fetchAll(q)) as any[];
    const closed = rows.filter((t) => t.status === 'CLOSED');
    const issues: any[] = [];

    const strategyStats = await this.strategies(q);
    for (const s of strategyStats) {
      if (s.verdict === 'REASSESS') {
        issues.push({
          code: 'R1',
          level: 'HIGH',
          title: `策略「${s.name}」期望值为负`,
          detail: `样本 ${s.closedCount} 笔，净收益 ${s.netPnl} USDT，期望值 ${s.expectancyUsdt} USDT/笔。`,
          threshold: `N ≥ ${TH.MIN_SAMPLE_FOR_STRATEGY} 且期望值 < 0`,
          sampleSize: s.closedCount,
          tradeIds: closed.filter((t) => t.strategyId === s.strategyId).slice(0, 5).map((t) => t.id),
        });
      }
    }

    // R2 过度交易
    const byDay = new Map<string, number>();
    closed.forEach((t) => {
      const d = toDateStr(t.entryTime);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    });
    const counts = [...byDay.values()];
    const dayAvg = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
    const overDays = [...byDay.entries()].filter(([, c]) => c > dayAvg * TH.OVERTRADE_MULTIPLIER);
    if (overDays.length) {
      issues.push({
        code: 'R2',
        level: 'MEDIUM',
        title: '存在过度交易日',
        detail: `${overDays.map(([d, c]) => `${d}（${c} 笔）`).join('、')}，日均 ${dayAvg.toFixed(1)} 笔。`,
        threshold: `单日笔数 > 日均 × ${TH.OVERTRADE_MULTIPLIER}`,
        sampleSize: counts.length,
        tradeIds: [],
      });
    }

    // R3 连亏放大
    const risk = await this.risk(q);
    if (risk.scaleUpAfterLoss.length) {
      issues.push({
        code: 'R3',
        level: 'HIGH',
        title: '连亏后放大仓位',
        detail: `${risk.scaleUpAfterLoss.length} 次在连亏 ≥ ${TH.LOSS_STREAK} 笔后把名义仓位放大 1.5 倍以上，典型报复性交易特征。`,
        threshold: `连亏 ≥ ${TH.LOSS_STREAK} 笔，下一笔名义仓位 > 前三笔均值 × ${TH.POSITION_SCALE_AFTER_STREAK}`,
        sampleSize: closed.length,
        tradeIds: risk.scaleUpAfterLoss.map((x: any) => x.tradeId),
      });
    }

    // R4 止损缺失
    const noStop = rows.filter((t) => !t.initialStopPrice).length;
    const noStopRatio = rows.length ? noStop / rows.length : 0;
    if (noStopRatio > TH.MISSING_STOP_RATIO) {
      issues.push({
        code: 'R4',
        level: 'MEDIUM',
        title: '止损缺失比例过高',
        detail: `${noStop}/${rows.length} 笔没有记录开仓止损价，风险无法量化，R 倍数相关指标失真。`,
        threshold: `缺失占比 > ${TH.MISSING_STOP_RATIO * 100}%`,
        sampleSize: rows.length,
        tradeIds: rows.filter((t) => !t.initialStopPrice).slice(0, 5).map((t) => t.id),
      });
    }

    // R5 手续费侵蚀
    const perf = computePerformance(rows as TradeLike[]);
    const fee = D(perf.totalFee);
    const netAbs = D(perf.netPnl).abs();
    const feeRatio = netAbs.isZero() ? D(0) : fee.div(netAbs);
    if (feeRatio.greaterThan(TH.FEE_EROSION_RATIO)) {
      issues.push({
        code: 'R5',
        level: 'HIGH',
        title: '手续费侵蚀严重',
        detail: `累计手续费 ${perf.totalFee} USDT，净收益 ${perf.netPnl} USDT，手续费占净收益 ${feeRatio.times(100).toFixed(1)}%。10U 本金下这是结构性成本。`,
        threshold: `手续费 / |净收益| > ${TH.FEE_EROSION_RATIO * 100}%`,
        sampleSize: closed.length,
        tradeIds: [],
      });
    }

    // R6 计划偏离
    const reviewed = closed.filter((t) => t.review && t.review.followedPlan !== null);
    const deviated = reviewed.filter((t) => t.review.followedPlan === false);
    if (reviewed.length >= 5 && deviated.length / reviewed.length > TH.PLAN_DEVIATION_RATIO) {
      issues.push({
        code: 'R6',
        level: 'MEDIUM',
        title: '计划偏离率高',
        detail: `${deviated.length}/${reviewed.length} 笔交易未按计划执行，问题在执行力而非策略。`,
        threshold: `偏离占比 > ${TH.PLAN_DEVIATION_RATIO * 100}%`,
        sampleSize: reviewed.length,
        tradeIds: deviated.slice(0, 5).map((t) => t.id),
      });
    }

    // R7 短线净期望为负：按持仓时长分层，扣费后是否还赚钱
    const buckets = buildHoldingBuckets(rows as TradeLike[]);
    for (const b of buckets) {
      if (b.count >= 20 && b.verdict === 'LOSING') {
        issues.push({
          code: 'R7',
          level: 'HIGH',
          title: `${b.label}的交易扣费后是亏的`,
          detail: `${b.count} 笔（占 ${(Number(b.share) * 100).toFixed(0)}%），净收益 ${b.netPnl}，每笔期望 ${b.expectancy}，手续费占毛利 ${b.feeToGross ? (Number(b.feeToGross) * 100).toFixed(0) + '%' : '—'}。这类交易越做越亏。`,
          threshold: '该时长区间样本 ≥ 20 且每笔期望 < 0',
          sampleSize: b.count,
          tradeIds: [],
        });
      }
    }

    // R8 利润依赖极少数交易
    const conc = buildConcentration(rows as TradeLike[]);
    if (conc.stability === 'EXTREME') {
      issues.push({
        code: 'R8',
        level: 'MEDIUM',
        title: '利润几乎全部来自少数几笔',
        detail: `最好的 5% 交易贡献了 ${(Number(conc.top5Share) * 100).toFixed(0)}% 的利润；剔除它们后净收益只有 ${conc.netWithoutTop5}。这说明当前结果是行情给的，不是策略稳定产出的。`,
        threshold: '样本 ≥ 20 且前 5% 交易贡献 > 80% 的利润',
        sampleSize: conc.sampleSize,
        tradeIds: [],
      });
    }

    // R9 方向失衡：做得多的那个方向在亏钱
    const dirs = buildDirectionSplit(rows as TradeLike[]);
    const dominant = dirs[0].count >= dirs[1].count ? dirs[0] : dirs[1];
    if (dominant.count >= 20 && Number(dominant.share) > 0.65 && D(dominant.netPnl).lessThan(0)) {
      issues.push({
        code: 'R9',
        level: 'HIGH',
        title: `${dominant.direction === 'LONG' ? '多单' : '空单'}占比过高且整体亏损`,
        detail: `${dominant.direction === 'LONG' ? '多' : '空'}单 ${dominant.count} 笔（占 ${(Number(dominant.share) * 100).toFixed(0)}%），胜率 ${dominant.winRate ? (Number(dominant.winRate) * 100).toFixed(1) + '%' : '—'}，净收益 ${dominant.netPnl}。方向偏好正在拖累整体，需要单独检查这个方向的开仓依据。`,
        threshold: '单方向占比 > 65% 且该方向净收益 < 0',
        sampleSize: dominant.count,
        tradeIds: [],
      });
    }

    // R11 近 30 天强制平仓（爆仓）：比收益率更早暴露杠杆/仓位结构问题
    const liqAll = rows.filter((t: any) => t.isLiquidation);
    if (liqAll.length > 0) {
      const lastTs = rows.reduce((mx: number, t: any) => {
        const ts = new Date(t.exitTime ?? t.entryTime).getTime();
        return Number.isFinite(ts) ? Math.max(mx, ts) : mx;
      }, 0);
      const windowStart = lastTs - 30 * 86400_000;
      const recentLiq = liqAll.filter((t: any) => new Date(t.exitTime ?? t.entryTime).getTime() >= windowStart);
      if (recentLiq.length >= 2) {
        const liqLoss = recentLiq.reduce((sum: any, t: any) => sum.plus(D(t.netPnl)), D(0));
        const symbols = Array.from(new Set(recentLiq.map((t: any) => t.symbol))).join('、');
        issues.push({
          code: 'R11',
          level: 'HIGH',
          title: `近 30 天被强制平仓 ${recentLiq.length} 次`,
          detail:
            `涉及 ${symbols}，合计净收益 ${key(liqLoss, 2)} U。爆仓不是运气问题，是杠杆与仓位结构撑不住正常波动：` +
            `同一方向的仓位在逆行时被继续加码，保证金耗尽就会被动离场。先降杠杆或缩仓位，再谈策略。`,
          threshold: '近 30 天强制平仓次数 ≥ 2',
          sampleSize: recentLiq.length,
          tradeIds: recentLiq.map((t: any) => t.id),
        });
      }
    }

    // R10 手续费吞噬毛利（与 R5 的区别：R5 看净利，这里看毛利）
    const grossAbs = D(perf.grossPnl).abs();
    const feeToGross = grossAbs.isZero() ? D(0) : D(perf.totalFee).div(grossAbs);
    if (grossAbs.greaterThan(0) && feeToGross.greaterThan(0.5)) {
      issues.push({
        code: 'R10',
        level: 'HIGH',
        title: '手续费吃掉了过半毛利',
        detail: `毛收益 ${perf.grossPnl}，手续费 ${perf.totalFee}，占比 ${feeToGross.times(100).toFixed(1)}%。降低频率或提高单笔目标波动，否则做得越多亏得越多。`,
        threshold: '手续费 / |毛收益| > 50%',
        sampleSize: closed.length,
        tradeIds: [],
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      issues,
      checked: 11,
      insufficient: {
        strategySample: Math.max(0, TH.MIN_SAMPLE_FOR_STRATEGY - closed.length),
        note: closed.length < TH.MIN_SAMPLE_FOR_STRATEGY ? `总样本 ${closed.length} 笔，策略结论需 ≥ ${TH.MIN_SAMPLE_FOR_STRATEGY} 笔` : null,
      },
    };
  }
}
