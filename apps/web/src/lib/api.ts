export interface Tag {
  id: string;
  name: string;
  category: 'MISTAKE' | 'POSITIVE' | 'MARKET' | 'SETUP';
  polarity: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  color?: string | null;
}

export interface Strategy {
  id: string;
  name: string;
  description?: string | null;
  rules?: string | null;
  isActive: boolean;
}

export interface Review {
  id: string;
  tradeId: string;
  entryReason?: string | null;
  exitReason?: string | null;
  marketContext?: string | null;
  plannedSetup?: string | null;
  actualProcess?: string | null;
  planDeviation?: string | null;
  emotion?: string | null;
  followedPlan?: boolean | null;
  reviewConclusion?: string | null;
  improvementAction?: string | null;
  reviewedAt?: string | null;
}

export interface Trade {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  status: string;
  entryTime: string;
  exitTime: string | null;
  holdingSeconds: number | null;
  entryPrice: string;
  exitPrice: string | null;
  quantity: string;
  margin: string | null;
  marginMode: string | null;
  actualLeverage: string | null;
  /** EXCHANGE = 交易所真实值；ESTIMATED = 按权益回放估算 */
  leverageSource: 'EXCHANGE' | 'ESTIMATED' | null;
  /** 开仓时账户权益（估算依据） */
  equityAtEntry: string | null;
  plannedLeverage: string | null;
  initialStopPrice: string | null;
  riskAmount: string | null;
  grossPnl: string;
  tradingFee: string;
  fundingFee: string;
  netPnl: string;
  netPnlEstimated: boolean;
  missingComponents: string | null;
  pnlMismatch: boolean;
  rMultiple: string | null;
  rMultipleSource: string | null;
  strategyId: string | null;
  strategy?: Strategy | null;
  marketRegime: string | null;
  setupType: string | null;
  executionScore: number | null;
  scoreSource: 'MANUAL' | 'AUTO' | 'NONE';
  scoreDetail: string | null;
  scoredAt: string | null;
  reviewStatus: string;
  matchingStatus: string;
  feeUnconverted: boolean;
  /** 是否发生过强制平仓（爆仓） */
  isLiquidation: boolean;
  liquidationCount: number;
  liquidationAt: string | null;
  /** STOP_LOSS | TAKE_PROFIT | LIQUIDATION | REVERSE | MANUAL */
  exitType: 'STOP_LOSS' | 'TAKE_PROFIT' | 'LIQUIDATION' | 'REVERSE' | 'MANUAL' | null;
  /** JSON 字符串：{"pct","usdt","r","at"}，K 线未算时为 null */
  mfe: string | null;
  mae: string | null;
  mfePct: string | null;
  maePct: string | null;
  candleStatus: 'PENDING' | 'OK' | 'NO_DATA' | 'PARTIAL';
  tags: Tag[];
  review: Review | null;
  display: { netPnl: string; grossPnl: string; rMultiple: string | null; tradingFee: string; isWin: boolean };
}

export interface Performance {
  tradeCount: number;
  closedCount: number;
  netPnl: string;
  grossPnl: string;
  totalFee: string;
  totalFunding: string;
  winCount: number;
  lossCount: number;
  winRate: string | null;
  avgWin: string | null;
  avgLoss: string | null;
  profitFactor: string | null;
  expectancyUsdt: string | null;
  expectancyR: string | null;
  rSampleSize: number;
  bestTrade: string | null;
  worstTrade: string | null;
  avgHoldingSeconds: number | null;
  feeRatio: string | null;
  rCoverage: string | null;
}

export interface Overview extends Performance {
  baselineCapital: string;
  finalEquity: string;
  returnPct: string | null;
  returnPctDisplay: string | null;
  maxDrawdownPct: string;
  feeRatio: string | null;
  quality: {
    estimatedCount: number;
    feeUnconvertedCount: number;
    pnlMismatchCount: number;
    needsReviewCount: number;
    missingStopCount: number;
  };
}

export interface EquityPoint {
  index: number;
  date: string;
  equity: string;
  netPnl: string;
  drawdownPct: string;
  peak: string;
}

export interface StrategyStat extends Performance {
  strategyId: string | null;
  name: string;
  rules: string | null;
  totalR: string;
  feeToGross: string | null;
  top5Share: string | null;
  netWithoutTop5: string;
  stability: 'ROBUST' | 'CONCENTRATED' | 'EXTREME' | 'INSUFFICIENT';
  verdict: 'OK' | 'REASSESS' | 'FRAGILE' | 'INSUFFICIENT';
  verdictReason: string;
}

export interface HoldingBucket {
  key: string;
  label: string;
  count: number;
  share: string | null;
  winRate: string | null;
  netPnl: string;
  grossPnl: string;
  fee: string;
  expectancy: string | null;
  feeToGross: string | null;
  netShare: string | null;
  verdict: 'PROFITABLE' | 'MARGINAL' | 'LOSING' | 'INSUFFICIENT';
}

export interface Concentration {
  sampleSize: number;
  profitableCount: number;
  totalPositivePnl: string;
  totalNetPnl: string;
  top1Share: string | null;
  top5Share: string | null;
  top1Pnl: string;
  top5Pnl: string;
  netWithoutTop5: string;
  stability: 'ROBUST' | 'CONCENTRATED' | 'EXTREME' | 'INSUFFICIENT';
  note: string;
}

export interface DirectionStat {
  direction: 'LONG' | 'SHORT';
  count: number;
  share: string;
  winRate: string | null;
  netPnl: string;
  grossPnl: string;
  fee: string;
  avgWin: string | null;
  avgLoss: string | null;
  expectancy: string | null;
}

export interface TagStat extends Performance {
  id: string;
  name: string;
  category: string;
  polarity: string;
  color: string | null;
  avgNetPnl: string | null;
}

export interface DiagnosticIssue {
  code: string;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  detail: string;
  threshold: string;
  sampleSize: number;
  tradeIds: string[];
}

export interface RiskReport {
  longestLosingStreak: number;
  longestWinningStreak: number;
  scaleUpAfterLoss: { tradeId: string; symbol: string; entryTime: string; ratio: string | null; netPnl: string }[];
  worstDay: { date: string; netPnl: string };
  daily: { date: string; netPnl: string }[];
  concentration: { symbol: string; count: number; share: string }[];
  missingStopCount: number;
  missingStopRatio: string | null;
  avgRiskAmount: string | null;
}

export type Filters = Record<string, string | undefined>;

export interface ScoreItem {
  key: string;
  label: string;
  delta: number;
  reason: string;
}

export interface ScoreResult {
  tradeId: string;
  symbol: string;
  /** null = 没有可评分依据（未打标签且无客观信号），不编分 */
  suggested: number | null;
  selfScore: number | null;
  scoreSource: 'MANUAL' | 'AUTO' | 'NONE';
  /** 自评 − 建议；正数=自评偏高 */
  deviation: number | null;
  items: ScoreItem[];
  notes: string[];
  version: number;
}

export interface ScoreBatchResult {
  mode: string;
  dryRun: boolean;
  total: number;
  written: number;
  emptyBefore: number;
  noEvidence: number;
  distribution: { label: string; count: number }[];
  avgSuggested: number | null;
  avgSelf: number | null;
  deviationTop: { tradeId: string; symbol: string; selfScore: number; suggested: number; deviation: number }[];
  sample: ScoreResult[];
  weightsVersion: number;
}

export interface ScoreSummary {
  closedTrades: number;
  scoredCount: number;
  unscoredCount: number;
  coveragePct: string;
  avgScore: number | null;
  bySource: { source: string; count: number }[];
  buckets: { label: string; min: number; max: number; count: number }[];
  avgDeviation: number | null;
  deviationTop: { tradeId: string; symbol: string; selfScore: number; suggested: number; deviation: number }[];
  weightsVersion: number;
}

const BASE = '/api';

function qs(filters: Filters = {}): string {
  const p = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // 只有真的带 body 时才声明 JSON，否则 Fastify 会以「body 为空」直接 400
  const headers: Record<string, string> = {};
  if (init?.body !== undefined && init.body !== null) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<{ ok: boolean; trades: number }>('/health'),

  trades: (f: Filters = {}) =>
    req<{ items: Trade[]; total: number; page: number; pageSize: number; summary: Performance }>(`/trades${qs(f)}`),

  /** 按当前筛选条件（含时间范围）导出 xlsx，浏览器直接下载 */
  exportTrades: async (f: Filters = {}) => {
    const res = await fetch(`${BASE}/trades/export${qs(f)}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`导出失败 ${res.status} ${text.slice(0, 200)}`);
    }
    const blob = await res.blob();
    const m = res.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/);
    const name = m ? decodeURIComponent(m[1]) : '交易记录.xlsx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  },

  trade: (id: string) => req<Trade>(`/trades/${id}`),

  /** 局部更新（补止损价、改止盈价等） */
  updateTrade: (id: string, body: Record<string, unknown>) =>
    req<Trade>(`/trades/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  saveReview: (id: string, body: Record<string, unknown>) =>
    req<{ review: Review }>(`/trades/${id}/review`, { method: 'PUT', body: JSON.stringify(body) }),

  overview: (f: Filters = {}) => req<Overview>(`/analytics/overview${qs(f)}`),

  equityCurve: (f: Filters = {}) =>
    req<{ baselineCapital: string; points: EquityPoint[]; maxDrawdownPct: string }>(`/analytics/equity-curve${qs(f)}`),

  strategyStats: (f: Filters = {}) => req<StrategyStat[]>(`/analytics/strategies${qs(f)}`),

  breakdown: (f: Filters = {}) =>
    req<{ holdingBuckets: HoldingBucket[]; concentration: Concentration; directionSplit: DirectionStat[] }>(
      `/analytics/breakdown${qs(f)}`,
    ),

  tagStats: (f: Filters = {}) => req<TagStat[]>(`/analytics/tags${qs(f)}`),

  risk: (f: Filters = {}) => req<RiskReport>(`/analytics/risk${qs(f)}`),

  diagnostics: (f: Filters = {}) =>
    req<{ generatedAt: string; issues: DiagnosticIssue[]; checked: number; insufficient: { strategySample: number; note: string | null } }>(
      `/analytics/diagnostics${qs(f)}`,
    ),

  strategies: () => req<Strategy[]>('/strategies'),
  tags: () => req<Tag[]>('/tags'),
  symbols: () => req<string[]>('/trades/symbols'),

  /** K 线（含本地缓存）。fetch=0 时只读缓存不联网 */
  candles: (p: { symbol: string; from: string; to: string; granularity?: string; fetch?: boolean }) =>
    req<{
      symbol: string;
      granularity: string;
      candles: { openTime: number; open: string; high: string; low: string; close: string; volume: string }[];
      coverage: number;
      fromCache: boolean;
      warning: string | null;
      count: number;
    }>(
      `/market/candles${qs({
        symbol: p.symbol,
        from: p.from,
        to: p.to,
        granularity: p.granularity,
        fetch: p.fetch === false ? '0' : undefined,
      })}`,
    ),

  mfeCoverage: () =>
    req<{ closedTrades: number; pending: number; ok: number; partial: number; noData: number; coveragePct: string }>(
      '/analytics/mfe/coverage',
    ),

  mfeRecompute: (body: { from?: string; to?: string; symbols?: string[]; force?: boolean; allowFetch?: boolean; limit?: number } = {}) =>
    req<{ total: number; processed: number; ok: number; partial: number; noData: number; skipped: number; failed: number; failures: { tradeId: string; symbol: string; error: string }[] }>(
      '/analytics/mfe/recompute',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  mfeOne: (tradeId: string, allowFetch = true) =>
    req<{ status: string; granularity?: string; coverage?: number; warning?: string; message?: string }>(
      `/analytics/mfe/${tradeId}`,
      { method: 'POST', body: JSON.stringify({ allowFetch }) },
    ),

  // ——— 执行评分自动化 ———
  scoreSuggest: (tradeId: string) => req<ScoreResult>(`/analytics/score/${tradeId}`),

  scoreAccept: (tradeId: string) => req<ScoreResult>(`/analytics/score/${tradeId}/accept`, { method: 'POST' }),

  scoreBatch: (body: { ids?: string[]; filter?: Filters; mode?: 'suggest' | 'fill' | 'overwrite'; dryRun?: boolean } = {}) =>
    req<ScoreBatchResult>('/analytics/score/batch', { method: 'POST', body: JSON.stringify(body) }),

  scoreSummary: () => req<ScoreSummary>('/analytics/score/summary'),

  scoreWeights: () => req<Record<string, any>>('/analytics/score/weights'),

  saveScoreWeights: (body: Record<string, any>) =>
    req<Record<string, any>>('/analytics/score/weights', { method: 'PUT', body: JSON.stringify(body) }),

  createTrade: (body: Record<string, unknown>) => req<Trade>('/trades', { method: 'POST', body: JSON.stringify(body) }),

  importCsv: (csv: string, defaultStrategyId?: string) =>
    req<{ total: number; imported: number; failed: number; errors: { line: number; message: string }[] }>('/import/csv', {
      method: 'POST',
      body: JSON.stringify({ csv, defaultStrategyId }),
    }),

  previewCsv: (csv: string) =>
    req<{ total: number; headers: string[]; sample: Record<string, string>[] }>('/import/preview', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),

  syncConfig: () =>
    req<{
      accountId: string;
      configured: boolean;
      credentialSource: 'LOCAL' | 'ENV' | 'NONE';
      credentialNote: string;
      apiKeyMasked: string;
      posMode: string | null;
      accountMode: string | null;
      accountModeLabel: string | null;
      lastSyncAt: string | null;
      baselineCapital: string;
      mode: 'LIVE' | 'MOCK';
    }>('/sync/config'),

  saveSyncConfig: (body: Record<string, unknown>) =>
    req<any>('/sync/config', { method: 'PUT', body: JSON.stringify(body) }),

  clearSyncConfig: () => req<any>('/sync/config', { method: 'DELETE' }),

  testConnection: (creds?: { apiKey?: string; secret?: string; passphrase?: string }) =>
    req<{
      ok: boolean;
      mode: string;
      source?: 'input' | 'saved' | 'none';
      credentialSource?: 'INPUT' | 'LOCAL' | 'ENV' | 'NONE';
      accountMode?: 'CLASSIC' | 'UTA';
      accountModeLabel?: string;
      posMode?: string;
      equity?: string;
      warning?: string | null;
      error?: string;
    }>('/sync/test', { method: 'POST', body: JSON.stringify(creds ?? {}) }),

  netCheck: () =>
    req<{
      ok: boolean;
      baseUrl: string;
      steps: { name: string; ok: boolean; detail: string; ms: number }[];
      advice: string;
    }>('/sync/netcheck'),

  runSync: (body: { from?: string; to?: string; limit?: number }) =>
    req<SyncJob>('/sync/run', { method: 'POST', body: JSON.stringify(body) }),

  syncJobs: () => req<SyncJob[]>('/sync/jobs'),

  syncJob: (id: string) => req<SyncJob & { logLines: { t: string; level: string; msg: string }[] }>(`/sync/jobs/${id}`),

  resetSync: () => req<Record<string, number>>('/sync/reset', { method: 'POST' }),

  purgeAll: () => req<{ trades: number; keptStrategies: number; keptTags: number }>('/sync/purge-all', { method: 'POST' }),

  deleteTrade: (id: string) => req<{ ok: boolean }>(`/trades/${id}`, { method: 'DELETE' }),

  batchStrategy: (body: Record<string, unknown>) =>
    req<{ matched: number; updated: number; dryRun?: boolean; sample: { id: string; symbol: string; direction: string; holdingMinutes: number; netPnl: string }[] }>(
      '/trades/batch-strategy',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  createStrategy: (body: { name: string; description?: string; rules?: string }) =>
    req<Strategy>('/strategies', { method: 'POST', body: JSON.stringify(body) }),

  deriveBaseline: (accountId: string) =>
    req<{ lastEquity: string; cumulativeNetPnl: string; suggestedBaseline: string; tradeCount: number; note: string }>(
      `/accounts/${accountId}/derive-baseline`,
    ),

  applyDerivedBaseline: (accountId: string) =>
    req<{ suggestedBaseline: string; baselineCapital: string }>(`/accounts/${accountId}/derive-baseline`, { method: 'POST' }),
};

export interface SyncJob {
  id: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'ABORTED';
  mode: 'LIVE' | 'MOCK';
  requestedFrom: string;
  requestedTo: string;
  ordersCount: number;
  fillsCount: number;
  ledgerCount: number;
  insertedCount: number;
  updatedCount: number;
  errorCount: number;
  posModeDetected: string | null;
  abortReason: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  logs?: string | null;
}
