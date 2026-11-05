import { Controller, Delete, Get, Query } from '@nestjs/common';
import { MarketService } from './market.service';

@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  /**
   * 取 K 线（含本地缓存）。
   * GET /api/market/candles?symbol=BTCUSDT&from=2026-11-01T00:00&to=2026-11-01T06:00&granularity=1m&fetch=1
   * fetch=0 时只读缓存，不联网。
   */
  @Get('candles')
  async candles(
    @Query('symbol') symbol: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('granularity') granularity?: string,
    @Query('fetch') fetchFlag?: string,
  ) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (!symbol || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return { error: '参数不完整：需要 symbol / from / to' };
    }
    const res = await this.market.getCandles(symbol.toUpperCase(), fromDate, toDate, {
      granularity,
      allowFetch: fetchFlag !== '0',
    });
    return {
      ...res,
      warning: res.warning,
      count: res.candles.length,
    };
  }

  /** 缓存概览 */
  @Get('cache')
  cache() {
    return this.market.cacheStats();
  }

  /** 清空缓存（可按币种） */
  @Delete('cache')
  clear(@Query('symbol') symbol?: string) {
    return this.market.clearCache(symbol?.toUpperCase());
  }
}
