import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { D, key } from '../common/money';

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
    const preserved = new Map<string, { review: any; tagIds: string[]; score: number | null }>();
    for (const t of olds) {
      if (t.review || t.tags.length || t.executionScore !== null) {
        preserved.set(`${t.symbol}|${new Date(t.entryTime).toISOString()}`, {
          review: t.review,
          tagIds: t.tags.map((x) => x.tagId),
          score: t.executionScore,
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
            // 交易所不提供开仓止损，R 倍数不猜，保持不可计算
            initialStopPrice: null,
            riskAmount: null,
            rMultiple: null,
            rMultipleSource: 'NONE',
            matchingStatus: 'AUTO_MATCHED',
            reviewStatus: keep?.review ? 'DONE' : 'PENDING',
            executionScore: keep?.score ?? null,
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
}
