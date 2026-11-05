import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { TradeQueryDto } from '../trades/trades.dto';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

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
}
