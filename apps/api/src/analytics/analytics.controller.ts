import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { MfeService } from './mfe.service';
import { ScoreService } from './score.service';
import { LeverageService } from './leverage.service';
import { TradeQueryDto } from '../trades/trades.dto';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly mfe: MfeService,
    private readonly score: ScoreService,
    private readonly leverage: LeverageService,
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

  // ——— 权益杠杆（估算） ———

  @Get('leverage/explain')
  leverageExplain() {
    return this.leverage.explain();
  }

  @Post('leverage/estimate')
  @HttpCode(200)
  leverageEstimate(@Body() body: any) {
    return this.leverage.estimate({ accountId: body?.accountId, force: Boolean(body?.force) });
  }

  // ——— 执行评分自动化 ———
  // 注意：静态路径必须写在 :tradeId 之前

  @Get('score/summary')
  scoreSummary() {
    return this.score.summary();
  }

  @Get('score/weights')
  scoreWeights() {
    return this.score.getWeights();
  }

  @Put('score/weights')
  saveScoreWeights(@Body() body: any) {
    return this.score.saveWeights(body);
  }

  /** 批量：mode = suggest | fill | overwrite */
  @Post('score/batch')
  @HttpCode(200)
  scoreBatch(@Body() body: any) {
    return this.score.batch(body ?? {});
  }

  /** 单笔建议分（不写库） */
  @Get('score/:tradeId')
  scoreSuggest(@Param('tradeId') tradeId: string) {
    return this.score.suggest(tradeId);
  }

  /** 采纳建议分 */
  @Post('score/:tradeId/accept')
  @HttpCode(200)
  scoreAccept(@Param('tradeId') tradeId: string) {
    return this.score.accept(tradeId);
  }
}
