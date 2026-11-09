import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { D, key, calcRiskAmount } from '../common/money';

type Dir = 'LONG' | 'SHORT';

interface CloseLeg {
  price: string;
  qty: string;
  fee: string;
  pnl: string;
}

interface OpenPosition {
  direction: Dir;
  qty: ReturnType<typeof D>;
  avgEntry: ReturnType<typeof D>;
  entryTime: Date;
  totalOpenQty: ReturnType<typeof D>;
  openFee: ReturnType<typeof D>;
  gross: ReturnType<typeof D>;
  closeFee: ReturnType<typeof D>;
  closeQty: ReturnType<typeof D>;
  closeNotional: ReturnType<typeof D>;
  lastTime: Date;
  /** 被强平的成交笔数 + 首次强平时间 */
  liqCount: number;
  liqAt: Date | null;
  closes: CloseLeg[];
  fills: { fillId: string; role: string; quantity: string }[];
}

export interface RebuildResult {
  trades: number;
  closed: number;
  open: number;
  needsReview: number;
  preservedReviews: number;
}

/**
 * 成交 → 复合交易 的配对引擎。
 *
 * 规则（与 01 文档决策 4 一致）：
 *   1. 同向成交 → 加仓，重算加权开仓价
 *   2. 反向且数量 < 持仓 → 部分平仓
 *   3. 反向且数量 = 持仓 → 平仓完成，产出一个 Trade
 *   4. 反向且数量 > 持仓 → 先平完（产出 Trade），剩余开反向新仓
 *   5. 期末仍有持仓 → 产出 status = OPEN 的 Trade
 *
 * 不做的事：不根据订单状态推断，不猜测用户意图，无法确认的宁可不配对。
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(private prisma: PrismaService) {}

  async rebuild(accountId: string): Promise<RebuildResult> {
    const fills = await this.prisma.fill.findMany({
      where: { accountId },
      orderBy: [{ filledAt: 'asc' }, { id: 'asc' }],
    });

    // 1. 保留人工复盘内容：重算不能把用户填的东西冲掉
    const olds = await this.prisma.trade.findMany({
      where: { accountId, matchingStatus: { not: 'MANUAL_MATCHED' } },
      include: { review: true, tags: true },
    });
    const preserved = new Map<string, {
      review: any;
      tagIds: string[];
      score: number | null;
      scoreSource: string;
      scoreDetail: string | null;
      // 人工补录 / 交易所界面抄录的字段，重建后必须原样带回
      initialStopPrice: string | null;
      takeProfitPrice: string | null;
      riskAmount: string | null;
      rMultiple: string | null;
      rMultipleSource: string;
      margin: string | null;
      marginMode: string | null;
      actualLeverage: string | null;
      leverageSource: string | null;
      equityAtEntry: string | null;
    }>();
    for (const t of olds) {
      if (t.review || t.tags.length || t.executionScore !== null) {
        preserved.set(`${t.symbol}|${new Date(t.entryTime).toISOString()}`, {
          review: t.review,
          tagIds: t.tags.map((x) => x.tagId),
          score: t.executionScore,
          scoreSource: t.scoreSource,
          scoreDetail: t.scoreDetail,
          initialStopPrice: t.initialStopPrice,
          takeProfitPrice: t.takeProfitPrice,
          riskAmount: t.riskAmount,
          rMultiple: t.rMultiple,
          rMultipleSource: t.rMultipleSource,
          margin: t.margin,
          marginMode: t.marginMode,
          actualLeverage: t.actualLeverage,
          leverageSource: t.leverageSource,
          equityAtEntry: t.equityAtEntry,
        });
      }
    }

    // 2. 清掉旧的自动配对结果（人工录入的保留）
    await this.prisma.trade.deleteMany({ where: { accountId, matchingStatus: { not: 'MANUAL_MATCHED' } } });

    // 3. 分组配对
    //    单向持仓：一个 symbol 一条腿（BOTH）
    //    双向持仓：同一 symbol 的多、空是两条独立的腿，必须分开配对，
    //              否则多空会互相抵消成一笔假交易。
    const byBucket = new Map<string, { symbol: string; side: string; list: typeof fills }>();
    for (const f of fills) {
      const side = ['LONG', 'SHORT'].includes(f.positionSide ?? '') ? f.positionSide! : 'BOTH';
      const bucketKey = `${f.symbol}|${side}`;
      const bucket = byBucket.get(bucketKey) ?? { symbol: f.symbol, side, list: [] };
      bucket.list.push(f);
      byBucket.set(bucketKey, bucket);
    }

    let closedCount = 0;
    let openCount = 0;
    let restored = 0;

    for (const { symbol, side: legSide, list } of byBucket.values()) {
      let state: OpenPosition | null = null;

      const emit = async (s: OpenPosition, exitTime: Date | null) => {
        const exitPrice = s.closeQty.isZero() ? null : s.closeNotional.div(s.closeQty);
        const netPnl = s.gross.minus(s.openFee).minus(s.closeFee);
        const preserveKey = `${symbol}|${s.entryTime.toISOString()}`;
        const keep = preserved.get(preserveKey);

        const trade = await this.prisma.trade.create({
          data: {
            accountId,
            symbol,
            direction: s.direction,
            status: exitTime ? 'CLOSED' : 'OPEN',
            entryTime: s.entryTime,
            exitTime,
            holdingSeconds: exitTime ? Math.max(0, Math.round((exitTime.getTime() - s.entryTime.getTime()) / 1000)) : null,
            entryPrice: key(s.avgEntry),
            exitPrice: exitPrice ? key(exitPrice) : null,
            quantity: key(s.totalOpenQty),
            grossPnl: key(s.gross),
            tradingFee: key(s.openFee.plus(s.closeFee)),
            fundingFee: '0',
            netPnl: key(netPnl),
            netPnlEstimated: false,
            // 优先保留人工补录 / 已提取的止损；没有才留空（绝不猜）
            initialStopPrice: keep?.initialStopPrice ?? null,
            takeProfitPrice: keep?.takeProfitPrice ?? null,
            riskAmount: keep?.riskAmount ?? null,
            rMultiple: keep?.rMultiple ?? null,
            rMultipleSource: keep?.rMultipleSource ?? 'NONE',
            margin: keep?.margin ?? null,
            marginMode: keep?.marginMode ?? null,
            actualLeverage: keep?.actualLeverage ?? null,
            leverageSource: keep?.leverageSource ?? null,
            equityAtEntry: keep?.equityAtEntry ?? null,
            matchingStatus: 'AUTO_MATCHED',
            isLiquidation: s.liqCount > 0,
            liquidationCount: s.liqCount,
            liquidationAt: s.liqAt,
            reviewStatus: keep?.review ? 'DONE' : 'PENDING',
            executionScore: keep?.score ?? null,
            scoreSource: keep?.scoreSource ?? 'NONE',
            scoreDetail: keep?.scoreDetail ?? null,
            tags: keep?.tagIds?.length ? { create: keep.tagIds.map((tagId) => ({ tagId })) } : undefined,
            review: keep?.review
              ? {
                  create: {
                    entryReason: keep.review.entryReason,
                    exitReason: keep.review.exitReason,
                    marketContext: keep.review.marketContext,
                    plannedSetup: keep.review.plannedSetup,
                    actualProcess: keep.review.actualProcess,
                    planDeviation: keep.review.planDeviation,
                    emotion: keep.review.emotion,
                    followedPlan: keep.review.followedPlan,
                    reviewConclusion: keep.review.reviewConclusion,
                    improvementAction: keep.review.improvementAction,
                    screenshotPaths: keep.review.screenshotPaths,
                    reviewedAt: keep.review.reviewedAt,
                  },
                }
              : undefined,
            fills: {
              create: s.fills.map((f) => ({ fillId: f.fillId, role: f.role, quantity: f.quantity })),
            },
          },
        });

        if (keep) restored++;
        if (exitTime) closedCount++;
        else openCount++;
        void trade;
      };

      for (const f of list) {
        const qty = D(f.quantity);
        if (qty.isZero()) continue;
        const price = D(f.price);
        const fee = D(f.fee);
        const isBuy = f.side === 'BUY' || f.side === 'buy';

        // 双向持仓：方向由成交所属的腿决定，而不是由买卖方向推断
        // LONG 腿：买入=开/加仓，卖出=平仓
        // SHORT 腿：卖出=开/加仓，买入=平仓
        const legDir: Dir | null = legSide === 'LONG' ? 'LONG' : legSide === 'SHORT' ? 'SHORT' : null;
        const newDir: Dir = legDir ?? (isBuy ? 'LONG' : 'SHORT');
        const isAdd = legDir ? (legDir === 'LONG' ? isBuy : !isBuy) : true;

        if (!state) {
          state = {
            direction: newDir,
            qty: qty.abs(),
            avgEntry: price,
            entryTime: f.filledAt,
            totalOpenQty: qty.abs(),
            openFee: fee,
            gross: D(0),
            closeFee: D(0),
            closeQty: D(0),
            closeNotional: D(0),
            lastTime: f.filledAt,
            liqCount: 0,
            liqAt: null,
            closes: [],
            fills: [{ fillId: f.id, role: 'ENTRY', quantity: key(qty.abs()) }],
          };
          continue;
        }

        if (isAdd) {
          // 加仓
          const addQty = qty.abs();
          const newTotal = state.qty.plus(addQty);
          state.avgEntry = state.qty.times(state.avgEntry).plus(price.times(addQty)).div(newTotal);
          state.qty = newTotal;
          state.totalOpenQty = state.totalOpenQty.plus(addQty);
          state.openFee = state.openFee.plus(fee);
          state.lastTime = f.filledAt;
          state.fills.push({ fillId: f.id, role: 'ENTRY', quantity: key(addQty) });
          continue;
        }

        // 反向：平仓（可能反手）
        const fillQty = qty.abs();
        const closeQty = state.qty.lessThan(fillQty) ? state.qty : fillQty;
        const ratio = fillQty.isZero() ? D(0) : closeQty.div(fillQty);

        const exitFee = fee.times(ratio);
        const pnlFromExchange = f.execPnl !== null && f.execPnl !== undefined && f.execPnl !== '' ? D(f.execPnl).times(ratio) : null;
        const pnlComputed = (isBuy ? state.avgEntry.minus(price) : price.minus(state.avgEntry)).times(closeQty);
        const legPnl = pnlFromExchange ?? pnlComputed;

        state.gross = state.gross.plus(legPnl);
        state.closeFee = state.closeFee.plus(exitFee);
        state.closeQty = state.closeQty.plus(closeQty);
        state.closeNotional = state.closeNotional.plus(price.times(closeQty));
        state.lastTime = f.filledAt;
        if (f.isLiquidation) {
          state.liqCount += 1;
          if (!state.liqAt) state.liqAt = f.filledAt;
        }
        state.closes.push({ price: key(price), qty: key(closeQty), fee: key(exitFee), pnl: key(legPnl) });
        state.fills.push({ fillId: f.id, role: 'EXIT', quantity: key(closeQty) });

        state.qty = state.qty.minus(closeQty);

        if (state.qty.isZero()) {
          await emit(state, f.filledAt);
          const remainder = fillQty.minus(closeQty);
          const restFee = fee.minus(exitFee);
          state = remainder.isZero()
            ? null
            : {
                direction: newDir,
                qty: remainder,
                avgEntry: price,
                entryTime: f.filledAt,
                totalOpenQty: remainder,
                openFee: restFee,
                gross: D(0),
                closeFee: D(0),
                closeQty: D(0),
                closeNotional: D(0),
                lastTime: f.filledAt,
                liqCount: 0,
                liqAt: null,
                closes: [],
                fills: [{ fillId: f.id, role: 'ENTRY', quantity: key(remainder) }],
              };
        }
      }

      if (state && state.qty.greaterThan(0)) {
        await emit(state, null);
      }
    }

    await this.attributeFunding(accountId);
    await this.enrichFromPositions(accountId);
    await this.enrichStops(accountId);
    await this.enrichExitType(accountId);

    const needsReview = 0;
    this.logger.log(
      `配对完成：${byBucket.size} 条腿（交易对 × 多空），平仓 ${closedCount}，持仓中 ${openCount}，恢复复盘 ${restored}`,
    );

    return { trades: closedCount + openCount, closed: closedCount, open: openCount, needsReview, preservedReviews: restored };
  }

  /**
   * 资金费率归属：按 symbol + 持仓时间区间匹配。
   * 交易所流水不带 tradeId，只能按时间归属；区间重叠时归给仓位最大的那笔。
   * 这是已知的近似，故在 01 文档中列为"高难度"。
   */
  private async attributeFunding(accountId: string) {
    const bills = await this.prisma.ledger.findMany({ where: { accountId, type: 'FUNDING' } });
    if (bills.length === 0) return;

    for (const bill of bills) {
      if (!bill.symbol) continue;
      const trades = await this.prisma.trade.findMany({
        where: { accountId, symbol: bill.symbol, status: 'CLOSED' },
      });
      const t = bill.occurredAt.getTime();
      const candidates = trades.filter((tr) => {
        const start = tr.entryTime.getTime();
        const end = tr.exitTime ? tr.exitTime.getTime() : Date.now();
        return t >= start && t <= end;
      });
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => D(b.quantity).comparedTo(D(a.quantity)));
      const target = candidates[0];
      const newFunding = D(target.fundingFee).plus(D(bill.amount));
      await this.prisma.ledger.update({ where: { id: bill.id }, data: { tradeId: target.id } });
      await this.prisma.trade.update({
        where: { id: target.id },
        data: {
          fundingFee: key(newFunding),
          netPnl: key(D(target.grossPnl).minus(D(target.tradingFee)).plus(newFunding)),
        },
      });
    }
  }

  /**
   * 用持仓历史回填杠杆 / 保证金 / 保证金模式。
   *
   * 成交流水里没有这些字段，只能从 /position/history-position 拿；
   * 匹配依据：同 symbol、同方向、开仓时间最接近，且平仓时间也对得上。
   * 找不到就保持 null（UI 显示"—"），绝不按名义价瞎算一个杠杆出来。
   */
  private async enrichFromPositions(accountId: string) {
    const positions = await this.prisma.position.findMany({ where: { accountId } });
    if (positions.length === 0) return;

    const trades = await this.prisma.trade.findMany({
      where: { accountId },
      select: { id: true, symbol: true, direction: true, entryTime: true, exitTime: true, entryPrice: true, quantity: true, margin: true, actualLeverage: true },
    });

    const TOLERANCE = 10 * 60 * 1000; // 10 分钟
    let filled = 0;

    for (const t of trades) {
      const entry = t.entryTime.getTime();
      const exit = t.exitTime ? t.exitTime.getTime() : entry;

      let best: (typeof positions)[number] | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const p of positions) {
        if (p.symbol !== t.symbol) continue;
        if (p.holdSide !== t.direction && p.holdSide !== 'BOTH') continue;
        const openDiff = Math.abs(p.openTime.getTime() - entry);
        const closeDiff = p.closeTime ? Math.abs(p.closeTime.getTime() - exit) : 0;
        if (openDiff > TOLERANCE) continue;
        const score = openDiff + closeDiff;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (!best) continue;

      // 保证金：优先用交易所给的，没有就用 名义 / 杠杆 推算（推算值也标清来源）
      const leverage = best.leverage ?? t.actualLeverage ?? null;
      let margin = best.marginSize ?? t.margin ?? null;
      if (!margin && leverage && Number(leverage) > 0) {
        const notional = Number(t.entryPrice) * Number(t.quantity);
        if (Number.isFinite(notional)) margin = (notional / Number(leverage)).toFixed(6);
      }

      await this.prisma.trade.update({
        where: { id: t.id },
        data: {
          margin,
          actualLeverage: leverage,
          marginMode: best.marginMode ?? null,
        },
      });
      filled++;
    }

    if (filled > 0) this.logger.log(`持仓回填：${filled} 笔补上杠杆/保证金`);
  }

  /**
   * 从开仓订单里提取止损 / 止盈。
   *
   * Bitget 的订单历史带 stopLoss / takeProfit 字段——只在你"下单时就附带止盈止损"时才有值。
   * 事后在持仓上单独设置的止盈止损，统一账户没有任何接口能查到（v2 计划委托接口对 UTA 直接 40085，
   * v3 无对应历史接口），所以这类单子仍然拿不到，只能手工补。
   *
   * 只填当前为空的，不覆盖人工填写的值。
   */
  async enrichStops(accountId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { accountId, initialStopPrice: null },
      include: { fills: { include: { fill: true } } },
    });
    if (trades.length === 0) return { filled: 0, checked: 0 };

    const orderIds = Array.from(
      new Set(
        trades
          .flatMap((t) => t.fills.filter((tf) => tf.role === 'ENTRY').map((tf) => tf.fill.orderId))
          .filter((x): x is string => Boolean(x)),
      ),
    );
    const orders = await this.prisma.order.findMany({ where: { accountId, exchangeOrderId: { in: orderIds } } });
    const byId = new Map(orders.map((o) => [o.exchangeOrderId, o]));

    let filled = 0;
    for (const t of trades) {
      const entryFills = t.fills
        .filter((tf) => tf.role === 'ENTRY')
        .sort((a, b) => a.fill.filledAt.getTime() - b.fill.filledAt.getTime());

      let stop: string | null = null;
      let takeProfit: string | null = null;
      for (const tf of entryFills) {
        const order = tf.fill.orderId ? byId.get(tf.fill.orderId) : undefined;
        if (!order) continue;
        try {
          const raw = JSON.parse(order.rawPayload ?? '{}');
          const sl = raw?.stopLoss;
          const tp = raw?.takeProfit;
          if (!stop && sl !== null && sl !== undefined && String(sl) !== '' && String(sl) !== '0') stop = String(sl);
          if (!takeProfit && tp !== null && tp !== undefined && String(tp) !== '' && String(tp) !== '0') takeProfit = String(tp);
        } catch {
          // 原始报文异常不影响主流程
        }
        if (stop) break;
      }
      if (!stop) continue;

      const risk = calcRiskAmount(t.entryPrice, stop, t.quantity);
      const rMultiple = risk && D(risk).greaterThan(0) ? key(D(t.netPnl).div(D(risk)), 4) : null;
      await this.prisma.trade.update({
        where: { id: t.id },
        data: {
          initialStopPrice: stop,
          takeProfitPrice: takeProfit ?? t.takeProfitPrice,
          riskAmount: risk,
          rMultiple,
          rMultipleSource: risk ? 'PLANNED_STOP' : 'NONE',
        },
      });
      filled++;
    }

    if (filled > 0) this.logger.log(`止损回填：${filled} 笔从开仓订单取到止损价并重算 R`);
    return { filled, checked: trades.length };
  }

  /**
   * 判定每笔交易的离场方式。
   *
   * Bitget 平仓单的 delegateType 会写明是谁平的仓：
   *   pos_loss_market   → 持仓止损被触发（你在持仓上设的止损打出去了）
   *   pos_profit_market → 持仓止盈被触发
   *   reverse           → 反手
   *   normal / market   → 手动平仓
   * 强平另由 isLiquidation 标记，优先级最高。
   *
   * 注意：这里拿到的是「触发止损时的成交价」，不是「你当初设的止损价」——
   * 交易所不保存计划委托的触发价（UTA 无历史计划委托接口），所以不会拿它去当 initialStopPrice，
   * 否则 R 倍数会被算成恒等于 ±1，毫无意义。
   */
  async enrichExitType(accountId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { accountId, status: 'CLOSED' },
      include: { fills: { include: { fill: true } } },
    });
    if (trades.length === 0) return { updated: 0 };

    const orderIds = Array.from(
      new Set(
        trades
          .flatMap((t) => t.fills.filter((tf) => tf.role === 'EXIT').map((tf) => tf.fill.orderId))
          .filter((x): x is string => Boolean(x)),
      ),
    );
    const orders = await this.prisma.order.findMany({ where: { accountId, exchangeOrderId: { in: orderIds } } });
    const byId = new Map(orders.map((o) => [o.exchangeOrderId, o]));

    const labelOf = (delegate: string | null | undefined): string => {
      switch (String(delegate ?? '').toLowerCase()) {
        case 'pos_loss_market':
          return 'STOP_LOSS';
        case 'pos_profit_market':
          return 'TAKE_PROFIT';
        case 'reverse':
          return 'REVERSE';
        default:
          return 'MANUAL';
      }
    };

    let updated = 0;
    for (const t of trades) {
      // 反向成交可能拆成两笔交易：只看真正属于离场的那部分
      const exitFills = t.fills
        .filter((tf) => tf.role === 'EXIT')
        .sort((a, b) => a.fill.filledAt.getTime() - b.fill.filledAt.getTime());

      let exitType: string | null = null;
      for (const tf of exitFills) {
        const order = tf.fill.orderId ? byId.get(tf.fill.orderId) : undefined;
        const delegate = order ? (JSON.parse(order.rawPayload ?? '{}')?.delegateType as string | undefined) : undefined;
        const label = labelOf(delegate);
        // 一笔交易可能分批平仓：只要有一次是止损/止盈触发，就按触发算
        if (label !== 'MANUAL') {
          exitType = label;
          break;
        }
      }
      if (!exitType && exitFills.length > 0) exitType = 'MANUAL';
      if (t.isLiquidation) exitType = 'LIQUIDATION';
      if (!exitType) continue;

      await this.prisma.trade.update({ where: { id: t.id }, data: { exitType } });
      updated++;
    }

    this.logger.log(`离场方式判定：${updated} 笔`);
    return { updated };
  }

  /**
   * 持仓期间捕获止盈止损：把「未完成委托」里的持仓止损/止盈计划单落到 OPEN 交易上。
   *
   * 为什么只能这么做：你习惯开单后再设止损，而这个止损一旦触发或撤销，
   * 交易所就不再保留它的触发价（UTA 无历史计划委托接口）。
   * 所以只有「持有期间同步过一次」才抓得到——抓到即为真实触发价。
   */
  async applyPendingStops(
    accountId: string,
    pending: { symbol: string; holdSide?: string | null; planType?: string | null; delegateType?: string | null; triggerPrice?: string | null }[],
  ) {
    const planLike = pending.filter(
      (p) =>
        p.triggerPrice &&
        (String(p.planType ?? '').toLowerCase().includes('profit_loss') ||
          String(p.delegateType ?? '').toLowerCase().includes('pos_loss') ||
          String(p.delegateType ?? '').toLowerCase().includes('pos_profit')),
    );
    if (planLike.length === 0) return { captured: 0, pending: pending.length };

    const openTrades = await this.prisma.trade.findMany({ where: { accountId, status: 'OPEN' } });
    let captured = 0;

    for (const t of openTrades) {
      const mine = planLike.filter(
        (p) => p.symbol === t.symbol && (!p.holdSide || String(p.holdSide).toUpperCase() === t.direction),
      );
      if (mine.length === 0) continue;

      const isProfit = (p: (typeof planLike)[number]) =>
        String(p.delegateType ?? '').toLowerCase().includes('profit') ||
        String(p.planType ?? '').toLowerCase().includes('profit');
      const stop = mine.find((p) => !isProfit(p))?.triggerPrice ?? null;
      const take = mine.find(isProfit)?.triggerPrice ?? null;

      if (!stop && !take) continue;
      const risk = stop ? calcRiskAmount(t.entryPrice, stop, t.quantity) : t.riskAmount;
      await this.prisma.trade.update({
        where: { id: t.id },
        data: {
          ...(stop && !t.initialStopPrice ? { initialStopPrice: stop, riskAmount: risk } : {}),
          ...(take && !t.takeProfitPrice ? { takeProfitPrice: take } : {}),
        },
      });
      captured++;
    }

    if (captured > 0) this.logger.log(`持仓期止损快照：${captured} 笔 OPEN 交易补上止损/止盈`);
    return { captured, pending: pending.length };
  }
}
