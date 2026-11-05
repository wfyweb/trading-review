import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MarketService } from '../market/market.service';
import { D, key } from '../common/money';

interface Extremum {
  pct: string;
  usdt: string;
  r: string | null;
  at: string;
}

@Injectable()
export class MfeService {
  private readonly logger = new Logger(MfeService.name);

  constructor(
    private prisma: PrismaService,
    private market: MarketService,
  ) {}

  /**
   * 计算单笔交易的 MFE / MAE。
   *
   * 口径：
   *   做多 MFE = 持仓期最高价相对开仓价的上行幅度；MAE = 最低价的下行幅度（负数）
   *   做空两者相反
   *   usdt = 幅度 × 开仓名义（quantity × 价格差），r = usdt / 计划风险（有止损才算）
   *
   * 注意：这是「持仓区间内的理论极值」，不含滑点与实际成交路径，
   * 用于回答「我是不是跑早了 / 止损是不是太紧」，不用于计算真实盈亏。
   */
  async computeOne(tradeId: string, opts: { allowFetch?: boolean } = {}) {
    const trade = await this.prisma.trade.findUnique({ where: { id: tradeId } });
    if (!trade) return { tradeId, status: 'NOT_FOUND' as const };

    if (trade.status !== 'CLOSED' || !trade.exitTime) {
      return { tradeId, status: 'OPEN' as const, message: '未平仓交易不计算 MFE/MAE' };
    }

    const entry = D(trade.entryPrice);
    const qty = D(trade.quantity);
    const risk = D(trade.riskAmount);

    // 区间向上取整一根，保证覆盖开仓所在的那根 K 线
    const from = new Date(trade.entryTime.getTime() - 60_000);
    const to = trade.exitTime;

    const res = await this.market.getCandles(trade.symbol, from, to, {
      allowFetch: opts.allowFetch !== false,
      maxPages: 20,
    });

    if (res.candles.length === 0) {
      await this.prisma.trade.update({
        where: { id: tradeId },
        data: { candleStatus: 'NO_DATA', mfe: null, mae: null, mfePct: null, maePct: null },
      });
      return { tradeId, status: 'NO_DATA' as const, warning: res.warning };
    }

    let maxHigh = res.candles[0].high;
    let minLow = res.candles[0].low;
    let maxAt = res.candles[0].openTime;
    let minAt = res.candles[0].openTime;

    for (const c of res.candles) {
      if (D(c.high).greaterThan(D(maxHigh))) {
        maxHigh = c.high;
        maxAt = c.openTime;
      }
      if (D(c.low).lessThan(D(minLow))) {
        minLow = c.low;
        minAt = c.openTime;
      }
    }

    const isLong = trade.direction === 'LONG';
    // 有利方向与不利方向的价格极值
    const favPrice = isLong ? D(maxHigh) : D(minLow);
    const advPrice = isLong ? D(minLow) : D(maxHigh);

    const favDelta = isLong ? favPrice.minus(entry) : entry.minus(favPrice);
    const advDelta = isLong ? advPrice.minus(entry) : entry.minus(advPrice);

    const build = (delta: any, at: number): Extremum => {
      const pct = entry.isZero() ? D(0) : delta.div(entry).times(100);
      const usdt = delta.times(qty);
      return {
        pct: key(pct, 4),
        usdt: key(usdt, 6),
        r: risk.isZero() ? null : key(usdt.div(risk), 4),
        at: new Date(at).toISOString(),
      };
    };

    const mfe = build(favDelta, maxAt);
    const mae = build(advDelta, minAt);

    const status = res.coverage >= 0.9 ? 'OK' : 'PARTIAL';
    await this.prisma.trade.update({
      where: { id: tradeId },
      data: {
        mfe: JSON.stringify(mfe),
        mae: JSON.stringify(mae),
        mfePct: mfe.pct,
        maePct: mae.pct,
        candleStatus: status,
      },
    });

    return {
      tradeId,
      symbol: trade.symbol,
      direction: trade.direction,
      status,
      granularity: res.granularity,
      coverage: Number(res.coverage.toFixed(3)),
      candleCount: res.candles.length,
      mfe,
      mae,
      warning: res.warning,
    };
  }

  /**
   * 批量重算。默认跳过已算过的（candleStatus = OK），force 时全部重算。
   * 逐笔串行：行情接口有频率限制，且 SQLite 单写者，并发收益不大。
   */
  async recompute(opts: {
    from?: string;
    to?: string;
    symbols?: string[];
    force?: boolean;
    allowFetch?: boolean;
    limit?: number;
  }) {
    const where: any = { status: 'CLOSED', exitTime: { not: null } };
    if (opts.from || opts.to) {
      where.entryTime = {};
      if (opts.from) where.entryTime.gte = new Date(`${opts.from}T00:00:00`);
      if (opts.to) where.entryTime.lte = new Date(`${opts.to}T23:59:59`);
    }
    if (opts.symbols?.length) where.symbol = { in: opts.symbols };

    const trades = await this.prisma.trade.findMany({
      where,
      orderBy: { entryTime: 'desc' },
      select: { id: true, candleStatus: true, symbol: true },
      take: opts.limit && opts.limit > 0 ? opts.limit : undefined,
    });

    const targets = opts.force ? trades : trades.filter((t) => t.candleStatus !== 'OK');

    const summary = { total: trades.length, processed: 0, ok: 0, partial: 0, noData: 0, skipped: trades.length - targets.length, failed: 0 };
    const failures: { tradeId: string; symbol: string; error: string }[] = [];

    for (const t of targets) {
      try {
        const r: any = await this.computeOne(t.id, { allowFetch: opts.allowFetch });
        summary.processed++;
        if (r.status === 'OK') summary.ok++;
        else if (r.status === 'PARTIAL') summary.partial++;
        else if (r.status === 'NO_DATA') summary.noData++;
      } catch (e: any) {
        summary.failed++;
        failures.push({ tradeId: t.id, symbol: t.symbol, error: e.message ?? String(e) });
        this.logger.warn(`MFE 计算失败 ${t.symbol} ${t.id}: ${e.message}`);
      }
    }

    return { ...summary, failures: failures.slice(0, 10) };
  }

  /** MFE/MAE 覆盖情况（给 UI 显示「还有多少笔没算」） */
  async coverage() {
    const [total, byStatus] = await Promise.all([
      this.prisma.trade.count({ where: { status: 'CLOSED' } }),
      this.prisma.trade.groupBy({ by: ['candleStatus'], where: { status: 'CLOSED' }, _count: { _all: true } }),
    ]);
    const map = Object.fromEntries(byStatus.map((b) => [b.candleStatus, b._count._all]));
    return {
      closedTrades: total,
      pending: map['PENDING'] ?? 0,
      ok: map['OK'] ?? 0,
      partial: map['PARTIAL'] ?? 0,
      noData: map['NO_DATA'] ?? 0,
      coveragePct: total === 0 ? '0' : ((100 * ((map['OK'] ?? 0) + (map['PARTIAL'] ?? 0))) / total).toFixed(1),
    };
  }
}
