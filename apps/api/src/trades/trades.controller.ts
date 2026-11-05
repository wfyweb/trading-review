import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { TradesService } from './trades.service';
import { BatchStrategyDto, CreateTradeDto, ReviewDto, TradeQueryDto, UpdateTradeDto } from './trades.dto';

@Controller('trades')
export class TradesController {
  constructor(private readonly trades: TradesService) {}

  @Get()
  list(@Query() query: TradeQueryDto) {
    return this.trades.list(query);
  }

  @Get('symbols')
  symbols() {
    return this.trades.symbols();
  }

  /** 导出 Excel（注意：必须声明在 :id 之前，否则会被动态路由吞掉） */
  @Get('export')
  async exportXlsx(@Query() query: TradeQueryDto, @Res() reply: any) {
    const { buffer, count } = await this.trades.exportXlsx(query);
    const range = `${query.from ?? 'all'}_${query.to ?? 'all'}`;
    const filename = `交易记录_${range}.xlsx`;
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="trades-${range}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .header('X-Export-Count', String(count))
      .send(buffer);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.trades.detail(id);
  }

  @Post('batch-strategy')
  @HttpCode(200)
  batchStrategy(@Body() dto: BatchStrategyDto) {
    return this.trades.batchStrategy(dto);
  }

  @Post()
  create(@Body() dto: CreateTradeDto) {
    return this.trades.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTradeDto) {
    return this.trades.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.trades.remove(id);
  }

  @Get(':id/review')
  async getReview(@Param('id') id: string) {
    const trade = await this.trades.detail(id);
    return trade.review;
  }

  @Put(':id/review')
  saveReview(@Param('id') id: string, @Body() dto: ReviewDto) {
    return this.trades.saveReview(id, dto);
  }
}
