import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { MfeService } from './mfe.service';
import { ScoreService } from './score.service';
import { TradesModule } from '../trades/trades.module';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [TradesModule, MarketModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, MfeService, ScoreService],
  exports: [MfeService, ScoreService],
})
export class AnalyticsModule {}
