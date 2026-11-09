import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { D, key } from '../common/money';

/**
 * 权益杠杆估算。
 *
 * 为什么需要：Bitget 统一账户的历史持仓接口不返回杠杆与保证金（已实测确认），
 * 只有当前持仓接口有。历史单想回答「这笔仓位相对账户有多重」，只能自己回放权益。
 *
 * 口径（写死在这里，UI 与文档都引用这一段）：
 *   equityAtEntry = 初始资金 + 开仓前已平仓交易的净收益 + 开仓前的净划转
 *   leverage      = 名义仓位 / equityAtEntry
 *   margin        = equityAtEntry（全仓模式下权益即担保金；逐仓不推算，留空）
 *
 * 原则：
 *   1. 交易所真值（leverageSource = EXCHANGE）永不覆盖；
 *   2. equityAtEntry ≤ 0 时不算——分母为零或负，算出来的杠杆没有意义；
 *   3. 估算值必须带标记，UI 显示为「≈」，不允许冒充交易所数据。
 */
@Injectable()
export class LeverageService {
  private readonly logger = new Logger(LeverageService.name);

  constructor(private prisma: PrismaService) {}

  async estimate(opts: { accountId?: string; force?: boolean } = {}) {
    const acc = opts.accountId
      ? await this.prisma.account.findUnique({ where: { id: opts.accountId } })
      : await this.prisma.account.findFirst();
    if (!acc) return { total: 0, estimated: 0, keptExchange: 0, skippedNoEquity: 0, skipped: 0 };

    const baseline = D(acc.baselineCapital);

    const [trades, transfers] = await Promise.all([
      this.prisma.trade.findMany({
        where: { accountId: acc.id },
        select: {
          id: true,
          symbol: true,
          entryTime: true,
          exitTime: true,
          entryPrice: true,
          quantity: true,
          netPnl: true,
          status: true,
          marginMode: true,
          actualLeverage: true,
          leverageSource: true,
        },
        orderBy: [{ exitTime: 'asc' }, { entryTime: 'asc' }],
      }),
      this.prisma.ledger.findMany({
        where: { accountId: acc.id, type: { in: ['TRANSFER_IN', 'TRANSFER_OUT'] } },
        select: { amount: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
      }),
    ]);

    // 按时间顺序回放权益：闭合交易按其平仓时间入账
    const closed = trades
      .filter((t) => t.exitTime)
      .sort((a, b) => (a.exitTime as Date).getTime() - (b.exitTime as Date).getTime());

    let result = {
      total: trades.length,
      estimated: 0,
      keptExchange: 0,
      skippedNoEquity: 0,
      skipped: 0,
    };
    const samples: { symbol: string; equity: string; leverage: string; netPnl: string }[] = [];

    for (const t of trades) {
      const isExchange = t.leverageSource === 'EXCHANGE' && t.actualLeverage !== null;
      if (isExchange && !opts.force) {
        result.keptExchange++;
        continue;
      }

      const entryMs = t.entryTime.getTime();
      // 开仓前已实现的部分
      let realized = D(0);
      for (const c of closed) {
        if ((c.exitTime as Date).getTime() < entryMs) realized = realized.plus(D(c.netPnl));
        else break;
      }
      const transferSum = transfers
        .filter((x) => x.occurredAt.getTime() < entryMs)
        .reduce((acc2, x) => acc2.plus(D(x.amount)), D(0));

      const equity = baseline.plus(realized).plus(transferSum);
      const notional = D(t.entryPrice).times(D(t.quantity));

      if (equity.lessThanOrEqualTo(0) || notional.lessThanOrEqualTo(0)) {
        await this.prisma.trade.update({
          where: { id: t.id },
          data: { equityAtEntry: key(equity, 4), actualLeverage: null, leverageSource: null },
        });
        result.skippedNoEquity++;
        continue;
      }

      const leverage = notional.div(equity);
      // 逐仓的"占用保证金"与权益无关，不推算；全仓则权益即担保金
      const margin = t.marginMode === 'isolated' ? null : equity;

      await this.prisma.trade.update({
        where: { id: t.id },
        data: {
          equityAtEntry: key(equity, 4),
          actualLeverage: key(leverage, 2),
          margin: margin ? key(margin, 6) : null,
          leverageSource: 'ESTIMATED',
        },
      });
      result.estimated++;
      if (samples.length < 5) {
        samples.push({ symbol: t.symbol, equity: key(equity, 2), leverage: key(leverage, 2), netPnl: key(D(t.netPnl), 2) });
      }
    }

    this.logger.log(
      `权益杠杆推算：估算 ${result.estimated} 笔，保留交易所值 ${result.keptExchange} 笔，权益非正跳过 ${result.skippedNoEquity} 笔`,
    );
    return { ...result, samples };
  }

  /** 给前端看的口径说明 */
  explain() {
    return {
      method: 'EQUITY_REPLAY',
      formula: 'leverage = 名义仓位 / 开仓时账户权益',
      equityFormula: 'equityAtEntry = 初始资金 + 开仓前已平仓净收益 + 开仓前净划转',
      marginRule: '全仓：margin = equityAtEntry（权益即担保金）；逐仓：不推算，留空',
      caveats: [
        '这是「权益杠杆」，衡量仓位相对账户有多重，与交易所显示的杠杆倍数不是同一个数',
        '权益为按已实现盈亏回放的结果，不含浮盈浮亏与未入账的资金费率',
        '交易所返回的真实杠杆（leverageSource = EXCHANGE）优先，永不被估算值覆盖',
      ],
    };
  }
}
