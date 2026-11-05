import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { D, key } from '../common/money';

/**
 * 执行评分自动化。
 *
 * 设计边界（写在代码里省得以后吵）：
 *  1. 分数衡量「是否按计划执行」，与盈亏无关：严格止损的亏损单应该高分，赚钱的乱做应该低分。
 *  2. 只给建议，不静默覆盖人工分。人工分是最重要的对照物——自评与建议的差额本身就是信号。
 *  3. 每个扣分点必须能被追溯：命中哪个标签 / 哪个客观指标，扣多少。
 *  4. 缺止损记录不扣分（那是数据缺失，不是纪律缺失），只标注「无法评估」。
 */

export interface ScoreItem {
  key: string;
  label: string;
  delta: number;
  reason: string;
}

export interface ScoreResult {
  tradeId: string;
  symbol: string;
  suggested: number | null;
  selfScore: number | null;
  scoreSource: string;
  deviation: number | null;
  items: ScoreItem[];
  notes: string[];
  version: number;
}

const SETTING_KEY = 'score.weights';

const DEFAULT_WEIGHTS = {
  version: 1,
  /** 标签权重：按标签名显式配置，不依赖 polarity（极性只决定颜色） */
  tag: {
    大亏失控: -25,
    逆势摊平: -20,
    逆势加仓: -20,
    反复补仓: -12,
    无计划入场: -10,
    追高: -10,
    重仓: -10,
    止损犹豫: -8,
    提前止盈: -6,
    零散小单: -5,
    手续费侵蚀: -5,
    /** 入场风格类标签：只用于归因，不参与评分（否则「单次开仓」就能白拿 10 分） */
    单次开仓: 0,
    顺势加仓: 0,
    吃到大趋势: 0,
    /** 真正的纪律类标签才加分 */
    严格止损: 10,
    按计划止盈: 8,
    等待确认: 5,
  } as Record<string, number>,
  /** 客观指标：不依赖打标，保证未打标的交易也能评分 */
  objective: {
    stopBreach: -12,
    bigLossVsAvg: -10,
    feeHeavy: -6,
    ultraShortLoss: -4,
  },
  caps: { negative: -70, positive: 8 },
};

@Injectable()
export class ScoreService {
  constructor(private prisma: PrismaService) {}

  async getWeights() {
    const row = await this.prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return DEFAULT_WEIGHTS;
    try {
      const saved = JSON.parse(row.value);
      return {
        ...DEFAULT_WEIGHTS,
        ...saved,
        tag: { ...DEFAULT_WEIGHTS.tag, ...(saved.tag ?? {}) },
        objective: { ...DEFAULT_WEIGHTS.objective, ...(saved.objective ?? {}) },
        caps: { ...DEFAULT_WEIGHTS.caps, ...(saved.caps ?? {}) },
      };
    } catch {
      return DEFAULT_WEIGHTS;
    }
  }

  async saveWeights(body: any) {
    const merged = {
      ...DEFAULT_WEIGHTS,
      ...body,
      tag: { ...DEFAULT_WEIGHTS.tag, ...(body?.tag ?? {}) },
      objective: { ...DEFAULT_WEIGHTS.objective, ...(body?.objective ?? {}) },
      caps: { ...DEFAULT_WEIGHTS.caps, ...(body?.caps ?? {}) },
    };
    await this.prisma.appSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: JSON.stringify(merged) },
      update: { value: JSON.stringify(merged) },
    });
    return merged;
  }

  /** 纯计算：给一笔交易打分（不落库） */
  private compute(
    trade: any,
    weights: typeof DEFAULT_WEIGHTS,
    ctx: { avgLoss: number; accountBaseline: number },
  ): { suggested: number | null; items: ScoreItem[]; notes: string[] } {
    const items: ScoreItem[] = [];
    const notes: string[] = [];
    const net = D(trade.netPnl);
    const gross = D(trade.grossPnl);
    const fee = D(trade.tradingFee);
    const risk = D(trade.riskAmount);

    // —— 标签类 ——
    const tagNames: string[] = (trade.tags ?? []).map((tt: any) => tt.tag?.name).filter(Boolean);
    for (const name of tagNames) {
      const w = weights.tag[name];
      if (w === undefined || w === 0) continue;
      items.push({
        key: `tag:${name}`,
        label: name,
        delta: w,
        reason: w < 0 ? `命中负面标签「${name}」` : `命中正面标签「${name}」`,
      });
    }
    if (tagNames.length === 0) notes.push('未打标签，仅按客观指标评分');

    // 标签与数据自相矛盾时点名，这本身就是复盘要修的东西
    if (tagNames.includes('严格止损') && !trade.initialStopPrice) {
      notes.push('标签「严格止损」与「未记录开仓止损价」冲突，建议核对');
    }

    // —— 客观指标 ——
    const obj = weights.objective;

    if (risk.greaterThan(0) && net.lessThan(0) && net.abs().greaterThan(risk.times(1.5))) {
      items.push({
        key: 'obj:stopBreach',
        label: '止损未执行',
        delta: obj.stopBreach,
        reason: `实际亏损 ${key(net.abs(), 2)} U 超过计划风险 ${key(risk, 2)} U 的 1.5 倍`,
      });
    } else if (risk.isZero() && !trade.initialStopPrice) {
      notes.push('缺少开仓止损价，仓位纪律无法评估（不扣分）');
    }

    if (ctx.avgLoss > 0 && net.lessThan(0) && net.abs().greaterThan(ctx.avgLoss * 3)) {
      items.push({
        key: 'obj:bigLossVsAvg',
        label: '单笔异常大亏',
        delta: obj.bigLossVsAvg,
        reason: `亏损 ${key(net.abs(), 2)} U 超过历史平均亏损 ${ctx.avgLoss.toFixed(2)} U 的 3 倍`,
      });
    }

    if (gross.greaterThan(0) && fee.greaterThan(gross.times(0.5))) {
      items.push({
        key: 'obj:feeHeavy',
        label: '手续费侵蚀',
        delta: obj.feeHeavy,
        reason: `手续费 ${key(fee, 2)} U 超过毛收益 ${key(gross, 2)} U 的 50%`,
      });
    }

    if ((trade.holdingSeconds ?? 999) < 120 && net.lessThan(0)) {
      items.push({
        key: 'obj:ultraShortLoss',
        label: '超短持仓亏损',
        delta: obj.ultraShortLoss,
        reason: `持仓 ${trade.holdingSeconds ?? 0} 秒即亏损离场，疑似冲动下单`,
      });
    }

    const negSum = items.filter((i) => i.delta < 0).reduce((a, b) => a + b.delta, 0);
    const posSum = items.filter((i) => i.delta > 0).reduce((a, b) => a + b.delta, 0);
    const cappedNeg = Math.max(weights.caps.negative, negSum);
    const cappedPos = Math.min(weights.caps.positive, posSum);
    if (cappedNeg !== negSum) notes.push(`负向扣分已封顶至 ${weights.caps.negative}`);

    // 没有任何可评分依据时不给分：宁可不给结论，也不编一个 100 分
    const hasEvidence = items.some((i) => i.delta !== 0);
    if (!hasEvidence) {
      notes.push('没有可评分依据（未打标签且无客观信号），不输出建议分');
      return { suggested: null, items, notes };
    }

    const raw = 100 + cappedNeg + cappedPos;
    const suggested = Math.max(0, Math.min(100, Math.round(raw)));

    return { suggested, items, notes };
  }

  /** 上下文：历史平均亏损（用于「异常大亏」判定） */
  private async loadContext() {
    const rows = await this.prisma.trade.findMany({
      where: { status: 'CLOSED' },
      select: { netPnl: true },
    });
    const losses = rows.map((r) => D(r.netPnl)).filter((d) => d.lessThan(0));
    const avgLoss = losses.length === 0 ? 0 : losses.reduce((a, b) => a.plus(b.abs()), D(0)).div(losses.length).toNumber();
    const acc = await this.prisma.account.findFirst({ select: { baselineCapital: true } });
    return { avgLoss, accountBaseline: Number(acc?.baselineCapital ?? 0) };
  }

  private serialize(trade: any, result: { suggested: number | null; items: ScoreItem[]; notes: string[] }, weights: any): ScoreResult {
    const selfScore = trade.executionScore ?? null;
    // 偏差只在「人工分 vs 建议分」之间才有意义；自动分和自己比恒等于 0，没有信息量
    const isManual = (trade.scoreSource ?? 'NONE') === 'MANUAL';
    return {
      tradeId: trade.id,
      symbol: trade.symbol,
      suggested: result.suggested,
      selfScore,
      scoreSource: trade.scoreSource ?? 'NONE',
      deviation: !isManual || selfScore === null || result.suggested === null ? null : selfScore - result.suggested,
      items: result.items,
      notes: result.notes,
      version: weights.version ?? 1,
    };
  }

  /** 单笔建议分（不写库） */
  async suggest(tradeId: string) {
    const trade = await this.prisma.trade.findUnique({
      where: { id: tradeId },
      include: { tags: { include: { tag: true } } },
    });
    if (!trade) throw new BadRequestException('交易不存在');
    const [weights, ctx] = await Promise.all([this.getWeights(), this.loadContext()]);
    return this.serialize(trade, this.compute(trade, weights, ctx), weights);
  }

  /**
   * 批量计算 / 写入。
   * mode: suggest（只算）| fill（只填空白的）| overwrite（全部覆盖，含人工分）
   */
  async batch(opts: {
    ids?: string[];
    filter?: any;
    mode?: 'suggest' | 'fill' | 'overwrite';
    dryRun?: boolean;
  }) {
    const mode = opts.mode ?? 'suggest';
    const where: any = {};
    if (opts.ids?.length) where.id = { in: opts.ids };
    if (opts.filter?.from || opts.filter?.to) {
      where.entryTime = {};
      if (opts.filter.from) where.entryTime.gte = new Date(`${opts.filter.from}T00:00:00`);
      if (opts.filter.to) where.entryTime.lte = new Date(`${opts.filter.to}T23:59:59`);
    }
    if (opts.filter?.symbol) where.symbol = opts.filter.symbol;
    if (opts.filter?.strategyId) where.strategyId = opts.filter.strategyId;
    if (opts.filter?.direction) where.direction = opts.filter.direction;

    const trades = await this.prisma.trade.findMany({
      where,
      include: { tags: { include: { tag: true } } },
      orderBy: { entryTime: 'desc' },
    });

    const [weights, ctx] = await Promise.all([this.getWeights(), this.loadContext()]);

    const results: ScoreResult[] = [];
    const writes: { id: string; score: number; detail: string }[] = [];

    for (const t of trades) {
      const r = this.compute(t, weights, ctx);
      const res = this.serialize(t, r, weights);
      results.push(res);

      const isEmpty = t.executionScore === null;
      const shouldWrite =
        r.suggested !== null && (mode === 'overwrite' ? true : mode === 'fill' ? isEmpty : false);

      if (shouldWrite && !opts.dryRun) {
        writes.push({
          id: t.id,
          score: r.suggested as number,
          detail: JSON.stringify({ suggested: r.suggested, items: r.items, notes: r.notes, version: weights.version ?? 1 }),
        });
      }
    }

    if (writes.length > 0) {
      await this.prisma.$transaction(
        writes.map((w) =>
          this.prisma.trade.update({
            where: { id: w.id },
            data: {
              executionScore: w.score,
              scoreSource: 'AUTO',
              scoreDetail: w.detail,
              scoredAt: new Date(),
            },
          }),
        ),
      );
    }

    const withSelf = results.filter((r) => r.selfScore !== null && r.scoreSource === 'MANUAL');
    const withScore = results.filter((r) => r.suggested !== null);
    const avg = (list: number[]) => (list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length);
    const withBoth = withSelf.filter((r) => r.suggested !== null);

    const distribution = [
      { label: '90-100', min: 90, max: 100 },
      { label: '80-89', min: 80, max: 89 },
      { label: '70-79', min: 70, max: 79 },
      { label: '60-69', min: 60, max: 69 },
      { label: '40-59', min: 40, max: 59 },
      { label: '0-39', min: 0, max: 39 },
    ].map((b) => ({
      label: b.label,
      count: withScore.filter((r) => (r.suggested as number) >= b.min && (r.suggested as number) <= b.max).length,
    }));

    return {
      mode,
      dryRun: Boolean(opts.dryRun),
      total: results.length,
      written: writes.length,
      emptyBefore: results.filter((r) => r.selfScore === null).length,
      /** 因为「无评分依据」被跳过的笔数，UI 要明确告知 */
      noEvidence: results.length - withScore.length,
      distribution,
      avgSuggested: withScore.length ? Number(avg(withScore.map((r) => r.suggested as number)).toFixed(1)) : null,
      avgSelf: withSelf.length ? Number(avg(withSelf.map((r) => r.selfScore as number)).toFixed(1)) : null,
      deviationTop: withBoth
        .sort((a, b) => Math.abs(b.deviation ?? 0) - Math.abs(a.deviation ?? 0))
        .slice(0, 5)
        .map((r) => ({ tradeId: r.tradeId, symbol: r.symbol, selfScore: r.selfScore, suggested: r.suggested, deviation: r.deviation })),
      sample: results.slice(0, 8),
      weightsVersion: weights.version ?? 1,
    };
  }

  /** 采纳建议：把建议分写为人工作品（来源仍记 MANUAL，便于区分） */
  async accept(tradeId: string) {
    const res = await this.suggest(tradeId);
    if (res.suggested === null) throw new BadRequestException('该笔没有可评分依据，无法采纳建议');
    await this.prisma.trade.update({
      where: { id: tradeId },
      data: {
        executionScore: res.suggested,
        scoreSource: 'MANUAL',
        scoreDetail: JSON.stringify({ suggested: res.suggested, items: res.items, notes: res.notes, version: res.version, accepted: true }),
        scoredAt: new Date(),
      },
    });
    return res;
  }

  /** 概览：评分覆盖率、分布、自评偏差 */
  async summary() {
    const trades = await this.prisma.trade.findMany({
      where: { status: 'CLOSED' },
      select: { id: true, symbol: true, executionScore: true, scoreSource: true, netPnl: true, tags: { include: { tag: true } } },
    });
    const [weights, ctx] = await Promise.all([this.getWeights(), this.loadContext()]);

    const scored = trades.filter((t) => t.executionScore !== null);
    const buckets = [
      { label: '90-100 纪律良好', min: 90, max: 100 },
      { label: '75-89 基本到位', min: 75, max: 89 },
      { label: '60-74 有明显偏离', min: 60, max: 74 },
      { label: '40-59 执行较差', min: 40, max: 59 },
      { label: '0-39 严重失控', min: 0, max: 39 },
    ].map((b) => ({
      ...b,
      count: scored.filter((t) => (t.executionScore as number) >= b.min && (t.executionScore as number) <= b.max).length,
    }));

    const deviations = trades
      .filter((t) => t.executionScore !== null && (t.scoreSource ?? 'NONE') === 'MANUAL')
      .map((t) => {
        const r = this.compute(t, weights, ctx);
        if (r.suggested === null) return null;
        return { tradeId: t.id, symbol: t.symbol, selfScore: t.executionScore as number, suggested: r.suggested, deviation: (t.executionScore as number) - r.suggested };
      })
      .filter((x): x is { tradeId: string; symbol: string; selfScore: number; suggested: number; deviation: number } => x !== null)
      .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));

    const bySource = ['MANUAL', 'AUTO', 'NONE'].map((src) => ({
      source: src,
      count: trades.filter((t) => (t.scoreSource ?? 'NONE') === src).length,
    }));

    return {
      closedTrades: trades.length,
      scoredCount: scored.length,
      unscoredCount: trades.length - scored.length,
      coveragePct: trades.length === 0 ? '0' : ((scored.length / trades.length) * 100).toFixed(1),
      avgScore: scored.length === 0 ? null : Number((scored.reduce((a, b) => a + (b.executionScore as number), 0) / scored.length).toFixed(1)),
      bySource,
      buckets,
      avgDeviation:
        deviations.length === 0 ? null : Number((deviations.reduce((a, b) => a + b.deviation, 0) / deviations.length).toFixed(1)),
      deviationTop: deviations.slice(0, 5),
      weightsVersion: weights.version ?? 1,
    };
  }
}
