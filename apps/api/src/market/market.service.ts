import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { fetchCandles, FALLBACK_ORDER, GRANULARITY_MS, MarketError, type RawCandle } from './market.client';

export interface CandlePoint {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface CandleResult {
  symbol: string;
  /** 实际命中的周期（可能因 1m 深度不足而降级） */
  granularity: string;
  candles: CandlePoint[];
  /** 覆盖率 0~1：应有根数 vs 实得根数 */
  coverage: number;
  /** true 表示全是本地缓存，没有发起网络请求 */
  fromCache: boolean;
  warning: string | null;
}

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 取某段区间的 K 线：优先本地缓存，缺失才回源。
   * @param allowFetch false 时只读缓存（离线可用）
   */
  async getCandles(
    symbol: string,
    from: Date,
    to: Date,
    opts: { granularity?: string; allowFetch?: boolean; maxPages?: number } = {},
  ): Promise<CandleResult> {
    const fromMs = from.getTime();
    const toMs = to.getTime();
    const allowFetch = opts.allowFetch !== false;

    const order = opts.granularity ? [opts.granularity] : FALLBACK_ORDER;
    let best: CandleResult | null = null;

    for (const g of order) {
      const res = await this.getCachedOrFetch(symbol, g, fromMs, toMs, allowFetch, opts.maxPages);
      if (res.candles.length === 0) continue;

      if (!best || res.coverage > best.coverage) best = res;
      // 覆盖率达标即返回，避免无谓地拉更粗的周期
      if (res.coverage >= 0.9) return res;
      // 指定了周期就不再降级
      if (opts.granularity) return res;
    }

    if (best) return best;
    return {
      symbol,
      granularity: order[0],
      candles: [],
      coverage: 0,
      fromCache: true,
      warning: '该区间无 K 线数据（可能超出交易所历史深度，或网络不可达）',
    };
  }

  private async getCachedOrFetch(
    symbol: string,
    granularity: string,
    fromMs: number,
    toMs: number,
    allowFetch: boolean,
    maxPages?: number,
  ): Promise<CandleResult> {
    const ms = GRANULARITY_MS[granularity];
    if (!ms) throw new MarketError(`不支持的周期：${granularity}`);

    const expected = Math.max(1, Math.floor((toMs - fromMs) / ms) + 1);
    const local = await this.readCache(symbol, granularity, fromMs - ms, toMs + ms);
    let candles = local;
    let fromCache = true;
    let warning: string | null = null;

    const enough = local.length >= expected * 0.9;
    if (!enough && allowFetch) {
      fromCache = false;
      try {
        const fetched = await fetchCandles(symbol, granularity, fromMs - ms, toMs + ms, { maxPages });
        await this.saveCandles(symbol, granularity, fetched);
        candles = await this.readCache(symbol, granularity, fromMs - ms, toMs + ms);
      } catch (e: any) {
        warning = `行情拉取失败：${e.message ?? e}`;
        this.logger.warn(`${symbol} ${granularity} ${warning}`);
      }
    }

    const inRange = candles.filter((c) => c.openTime >= fromMs - ms && c.openTime <= toMs + ms);
    return {
      symbol,
      granularity,
      candles: inRange,
      coverage: Math.min(1, inRange.length / expected),
      fromCache,
      warning,
    };
  }

  private async readCache(symbol: string, granularity: string, fromMs: number, toMs: number): Promise<CandlePoint[]> {
    const rows = await this.prisma.candle.findMany({
      where: {
        symbol,
        granularity,
        openTime: { gte: new Date(fromMs), lte: new Date(toMs) },
      },
      orderBy: { openTime: 'asc' },
    });
    return rows.map((r) => ({
      openTime: r.openTime.getTime(),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
  }

  /** 只写缺失的 K 线，按 200 一批串行落库（SQLite 单写者，批量太大反而慢） */
  private async saveCandles(symbol: string, granularity: string, rows: RawCandle[]) {
    if (rows.length === 0) return 0;
    const existing = await this.prisma.candle.findMany({
      where: {
        symbol,
        granularity,
        openTime: {
          gte: new Date(rows[0].openTime),
          lte: new Date(rows[rows.length - 1].openTime),
        },
      },
      select: { openTime: true },
    });
    const have = new Set(existing.map((e) => e.openTime.getTime()));
    const missing = rows.filter((r) => !have.has(r.openTime));
    if (missing.length === 0) return 0;

    let inserted = 0;
    for (let i = 0; i < missing.length; i += 200) {
      const chunk = missing.slice(i, i + 200);
      await this.prisma.$transaction(
        chunk.map((c) =>
          this.prisma.candle.create({
            data: {
              symbol,
              granularity,
              openTime: new Date(c.openTime),
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
            },
          }),
        ),
      );
      inserted += chunk.length;
    }
    return inserted;
  }

  /** 缓存概览：按周期统计已有 K 线的币种与时间跨度 */
  async cacheStats() {
    const rows = await this.prisma.candle.groupBy({
      by: ['symbol', 'granularity'],
      _count: { _all: true },
      _min: { openTime: true },
      _max: { openTime: true },
    });
    return rows.map((r) => ({
      symbol: r.symbol,
      granularity: r.granularity,
      count: r._count._all,
      from: r._min.openTime,
      to: r._max.openTime,
    }));
  }

  async clearCache(symbol?: string) {
    const res = await this.prisma.candle.deleteMany({ where: symbol ? { symbol } : {} });
    return { deleted: res.count };
  }
}
