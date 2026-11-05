import { IsArray, IsBoolean, IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';

export class TradeQueryDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() symbol?: string;
  @IsOptional() @IsIn(['LONG', 'SHORT']) direction?: string;
  @IsOptional() @IsString() strategyId?: string;
  @IsOptional() @IsString() tagId?: string;
  @IsOptional() @IsIn(['PENDING', 'DONE']) reviewStatus?: string;
  @IsOptional() @IsIn(['WIN', 'LOSS']) result?: string;
  @IsOptional() @IsIn(['OPEN', 'CLOSED', 'NEEDS_REVIEW']) status?: string;
  @IsOptional() @IsString() marketRegime?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  @IsOptional() @IsNumberString() page?: string;
  @IsOptional() @IsNumberString() pageSize?: string;
}

export class CreateTradeDto {
  @IsString() symbol: string;
  @IsIn(['LONG', 'SHORT']) direction: string;
  @IsString() entryTime: string;
  @IsOptional() @IsString() exitTime?: string;
  @IsString() entryPrice: string;
  @IsOptional() @IsString() exitPrice?: string;
  @IsString() quantity: string;
  @IsOptional() @IsString() margin?: string;
  @IsOptional() @IsString() plannedLeverage?: string;
  @IsOptional() @IsString() initialStopPrice?: string;
  @IsOptional() @IsString() takeProfitPrice?: string;
  @IsOptional() @IsString() tradingFee?: string;
  @IsOptional() @IsString() fundingFee?: string;
  @IsOptional() @IsString() grossPnl?: string;
  @IsOptional() @IsString() strategyId?: string;
  @IsOptional() @IsString() marketRegime?: string;
  @IsOptional() @IsString() setupType?: string;
  @IsOptional() @IsBoolean() feeUnconverted?: boolean;
  @IsOptional() @IsArray() tagIds?: string[];
  @IsOptional() @IsString() note?: string;
}

export class UpdateTradeDto extends CreateTradeDto {
  @IsOptional() @IsString() declare symbol: string;
  @IsOptional() @IsString() declare entryTime: string;
  @IsOptional() @IsString() declare entryPrice: string;
  @IsOptional() @IsString() declare quantity: string;
  @IsOptional() @IsIn(['LONG', 'SHORT']) declare direction: string;
  @IsOptional() @IsIn(['OPEN', 'CLOSED', 'NEEDS_REVIEW']) declare status?: string;
}

export class BatchStrategyDto {
  /** 直接指定交易 id（列表勾选） */
  @IsOptional() @IsArray() ids?: string[];
  /** 或按筛选条件批量（列表筛选 / 规则面板） */
  @IsOptional() filter?: TradeQueryDto;
  @IsOptional() @IsString() strategyId?: string | null;
  /** 持仓时长下限（分钟），用于「30 分钟以上归为趋势」这类规则 */
  @IsOptional() @IsString() holdingMinGte?: string;
  @IsOptional() @IsString() holdingMinLte?: string;
  /** 只处理当前未归类的交易 */
  @IsOptional() onlyUnassigned?: boolean;
  /** 只预览不写入 */
  @IsOptional() dryRun?: boolean;
}

export class ReviewDto {
  @IsOptional() @IsString() entryReason?: string;
  @IsOptional() @IsString() exitReason?: string;
  @IsOptional() @IsString() marketContext?: string;
  @IsOptional() @IsString() plannedSetup?: string;
  @IsOptional() @IsString() actualProcess?: string;
  @IsOptional() @IsString() planDeviation?: string;
  @IsOptional() @IsString() emotion?: string;
  @IsOptional() @IsBoolean() followedPlan?: boolean;
  @IsOptional() @IsString() reviewConclusion?: string;
  @IsOptional() @IsString() improvementAction?: string;
  @IsOptional() @IsString() screenshotPaths?: string;
  @IsOptional() @IsString() executionScore?: string;
  @IsOptional() @IsArray() tagIds?: string[];
}
