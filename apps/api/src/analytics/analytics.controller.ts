import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { MfeService } from './mfe.service';
import { TradeQueryDto } from '../trades/trades.dto';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly mfe: MfeService,
  ) {}

  @Get('overview')
  overview(@Query() q: TradeQueryDto) {
    return this.analytics.overview(q);
  }

  @Get('equity-curve')
  equityCurve(@Query() q: TradeQueryDto) {
    return this.analytics.equityCurve(q);
  }

  @Get('breakdown')
  breakdown(@Query() q: TradeQueryDto) {
    return this.analytics.breakdown(q);
  }

  @Get('strategies')
  strategies(@Query() q: TradeQueryDto) {
    return this.analytics.strategies(q);
  }

  @Get('tags')
  tags(@Query() q: TradeQueryDto) {
    return this.analytics.tags(q);
  }

  @Get('risk')
  risk(@Query() q: TradeQueryDto) {
    return this.analytics.risk(q);
  }

  @Get('diagnostics')
  diagnostics(@Query() q: TradeQueryDto) {
    return this.analytics.diagnostics(q);
  }

  /** MFE/MAE 覆盖情况 */
  @Get('mfe/coverage')
  mfeCoverage() {
    return this.mfe.coverage();
  }

  /**
   * 批量重算 MFE/MAE。
   * POST /api/analytics/mfe/recompute  { from, to, symbols, force, allowFetch, limit }
   */
  @Post('mfe/recompute')
  @HttpCode(200)
  mfeRecompute(@Body() body: any) {
    return this.mfe.recompute(body ?? {});
  }

  /** 单笔重算 */
  @Post('mfe/:tradeId')
  @HttpCode(200)
  mfeOne(@Param('tradeId') tradeId: string, @Body() body: any) {
    return this.mfe.computeOne(tradeId, { allowFetch: body?.allowFetch !== false });
  }
}
