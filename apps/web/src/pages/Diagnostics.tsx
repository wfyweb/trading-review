import { useEffect, useState } from 'react';
import { api, type DiagnosticIssue, type Filters, type RiskReport, type ScoreBatchResult, type ScoreSummary } from '../lib/api';
import { num, signed, pnlClass, ratioToPct } from '../lib/format';
import { DailyBars } from '../charts';
import { go } from '../lib/router';
import { ErrorCard, Loading } from './Overview';

interface Diag {
  generatedAt: string;
  issues: DiagnosticIssue[];
  checked: number;
  insufficient: { strategySample: number; note: string | null };
}

const RULE_NAMES: Record<string, string> = {
  R1: '策略失效',
  R2: '过度交易',
  R3: '连亏放大',
  R4: '止损缺失',
  R5: '手续费侵蚀',
  R6: '计划偏离',
  R7: '短线亏损',
  R8: '利润集中',
  R9: '方向失衡',
  R10: '手续费吞毛利',
  R11: '强制平仓',
};

export function DiagnosticsPage({ filters }: { filters: Filters }) {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scoreSummary, setScoreSummary] = useState<ScoreSummary | null>(null);
  const [preview, setPreview] = useState<ScoreBatchResult | null>(null);
  const [busy, setBusy] = useState<'' | 'suggest' | 'fill'>('');

  const loadScore = () => api.scoreSummary().then(setScoreSummary).catch(() => {});

  useEffect(() => {
    Promise.all([api.diagnostics(filters), api.risk(filters)])
      .then(([d, r]) => {
        setDiag(d);
        setRisk(r);
      })
      .catch((e) => setErr(e.message));
    loadScore();
  }, [JSON.stringify(filters)]);

  /** 批量：dryRun 只预览；fill 只补空白分，不碰人工分 */
  const runBatch = async (mode: 'suggest' | 'fill', dryRun: boolean) => {
    setBusy(mode);
    try {
      const r = await api.scoreBatch({ mode, dryRun, filter: filters });
      if (dryRun) {
        setPreview(r);
      } else {
        setPreview(null);
        await loadScore();
        alert(`已写入 ${r.written} 笔自动分${r.noEvidence > 0 ? `，${r.noEvidence} 笔因无依据跳过` : ''}`);
      }
    } catch (e: any) {
      alert(`批量评分失败：${e.message}`);
    } finally {
      setBusy('');
    }
  };

  if (err) return <ErrorCard message={err} />;
  if (!diag || !risk) return <Loading />;

  return (
    <div className="page">
      <div className="card">
        <div className="card-hd">
          <h2>系统诊断</h2>
          <span className="hint">规则式，全部可审计：每条都给出样本量、阈值和判定依据</span>
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 11 }}>
            检查 {diag.checked} 条规则 · {diag.issues.length} 条命中 · {new Date(diag.generatedAt).toLocaleTimeString('zh-CN')}
          </span>
        </div>
        <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {diag.issues.length === 0 && <div className="empty">当前区间未触发任何规则</div>}
          {diag.issues.map((i) => (
            <div key={i.code + i.title} className={`rule-card ${i.level.toLowerCase()}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`chip ${i.level === 'HIGH' ? 'danger' : 'warn'}`}>
                  {i.code} {RULE_NAMES[i.code] ?? ''}
                </span>
                <strong style={{ fontWeight: 500, fontSize: 13 }}>{i.title}</strong>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.7 }}>{i.detail}</div>
              <div className="rule-meta">
                <span>阈值：{i.threshold}</span>
                <span>样本：N={i.sampleSize}</span>
                {i.tradeIds.length > 0 && <span>关联交易：{i.tradeIds.length} 笔</span>}
              </div>
            </div>
          ))}
          {diag.insufficient.note && (
            <div className="banner">
              <strong>样本不足，不下结论</strong>
              <span className="vline" />
              <span>{diag.insufficient.note}</span>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <h2>执行评分自动化</h2>
          <span className="hint">按违规标签 + 客观指标给建议分；没有依据的交易不给分，绝不与盈亏挂钩</span>
          <div className="spacer" />
          <button className="btn ghost" disabled={Boolean(busy)} onClick={() => runBatch('suggest', true)}>
            {busy === 'suggest' ? '计算中…' : '预览建议分'}
          </button>
          <button className="btn primary" disabled={Boolean(busy)} onClick={() => runBatch('fill', false)}>
            {busy === 'fill' ? '写入中…' : `填充空白（${scoreSummary?.unscoredCount ?? 0} 笔）`}
          </button>
        </div>
        <div className="card-bd">
          {!scoreSummary ? (
            <div className="muted" style={{ fontSize: 11 }}>加载中…</div>
          ) : (
            <>
              <div className="grid g4" style={{ gap: 10 }}>
                <MiniStat label="已评分" value={`${scoreSummary.scoredCount}/${scoreSummary.closedTrades}`} sub={`覆盖 ${scoreSummary.coveragePct}%`} />
                <MiniStat label="平均分" value={scoreSummary.avgScore === null ? '—' : String(scoreSummary.avgScore)} sub="仅统计已评分" />
                <MiniStat
                  label="平均偏差"
                  value={scoreSummary.avgDeviation === null ? '—' : scoreSummary.avgDeviation > 0 ? `+${scoreSummary.avgDeviation}` : String(scoreSummary.avgDeviation)}
                  sub="自评 − 建议"
                />
                <MiniStat label="自动分" value={String(scoreSummary.bySource.find((s) => s.source === 'AUTO')?.count ?? 0)} sub="规则写入" />
              </div>

              <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'flex-end', height: 54 }}>
                {scoreSummary.buckets.map((b) => {
                  const max = Math.max(...scoreSummary.buckets.map((x) => x.count), 1);
                  return (
                    <div
                      key={b.label}
                      style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                    >
                      <div
                        style={{
                          width: '52%',
                          height: Math.max(2, (b.count / max) * 34),
                          background: b.min >= 75 ? '#6f8b73' : b.min >= 60 ? '#b08d57' : '#a05b52',
                          opacity: 0.45,
                          borderRadius: 1,
                        }}
                      />
                      <div className="muted" style={{ fontSize: 9.5, marginTop: 3 }}>{b.label}</div>
                      <div className="mono" style={{ fontSize: 10 }}>{b.count}</div>
                    </div>
                  );
                })}
              </div>

              {preview && (
                <div className="banner" style={{ marginTop: 10, display: 'block' }}>
                  <strong>
                    预览：{preview.total - preview.noEvidence} 笔可评分
                    {preview.noEvidence > 0 ? `，${preview.noEvidence} 笔无依据跳过` : ''}
                    {preview.avgSuggested !== null ? ` · 平均建议分 ${preview.avgSuggested}` : ''}
                  </strong>
                  <div style={{ fontSize: 11, marginTop: 4, lineHeight: 1.7 }}>
                    分布 {preview.distribution.map((d) => `${d.label}:${d.count}`).join(' · ')}
                    {preview.deviationTop.length > 0 && (
                      <>
                        <br />
                        自评偏差最大：
                        {preview.deviationTop.slice(0, 3).map((d) => `${d.symbol} 自评${d.selfScore}/建议${d.suggested}(${d.deviation > 0 ? '+' : ''}${d.deviation})`).join('，')}
                      </>
                    )}
                  </div>
                </div>
              )}

              {scoreSummary.deviationTop.length > 0 && !preview && (
                <div style={{ marginTop: 10 }}>
                  <div className="muted" style={{ fontSize: 10.5, marginBottom: 4 }}>自评与建议偏差最大（自我认知与执行事实的差距）</div>
                  {scoreSummary.deviationTop.slice(0, 3).map((d) => (
                    <div
                      key={d.tradeId}
                      className="stat-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => go(`trades/${d.tradeId}`)}
                      title="点击查看这笔交易"
                    >
                      <span style={{ fontSize: 11.5 }}>{d.symbol}</span>
                      <span className="mono" style={{ fontSize: 11.5 }}>
                        自评 {d.selfScore} / 建议 {d.suggested} · {d.deviation > 0 ? '+' : ''}
                        {d.deviation}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-hd">
            <h2>连续盈亏</h2>
          </div>
          <div className="card-bd">
            <div className="grid g2" style={{ gap: 10 }}>
              <div className="metric" style={{ padding: 12 }}>
                <div className="metric-label">最长连续亏损</div>
                <div className="metric-value neg">{risk.longestLosingStreak}</div>
                <div className="metric-sub">笔</div>
              </div>
              <div className="metric" style={{ padding: 12 }}>
                <div className="metric-label">最长连续盈利</div>
                <div className="metric-value pos">{risk.longestWinningStreak}</div>
                <div className="metric-sub">笔</div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>每日净收益</div>
              <DailyBars data={risk.daily} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <div className="card-hd">
              <h2>风险画像</h2>
            </div>
            <div className="card-bd" style={{ paddingTop: 6 }}>
              <div className="stat-row">
                <span>最差单日</span>
                <span className={`mono ${pnlClass(risk.worstDay.netPnl)}`}>
                  {risk.worstDay.date || '—'} · {signed(risk.worstDay.netPnl, 3)} U
                </span>
              </div>
              <div className="stat-row">
                <span>缺止损占比</span>
                <span className="mono" style={{ color: Number(risk.missingStopRatio ?? 0) > 0.3 ? 'var(--warn)' : undefined }}>
                  {ratioToPct(risk.missingStopRatio, 0)}（{risk.missingStopCount} 笔）
                </span>
              </div>
              <div className="stat-row">
                <span>平均计划风险</span>
                <span className="mono">{risk.avgRiskAmount ? `${num(risk.avgRiskAmount, 3)} U` : '—'}</span>
              </div>
              <div className="stat-row">
                <span>连亏后放大仓位</span>
                <span className="mono" style={{ color: risk.scaleUpAfterLoss.length ? 'var(--danger)' : undefined }}>
                  {risk.scaleUpAfterLoss.length} 次
                </span>
              </div>
              <div style={{ marginTop: 12 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>交易对集中度</div>
                {risk.concentration.map((c) => (
                  <div key={c.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                    <span style={{ width: 64, fontSize: 11 }}>{c.symbol.replace('USDT', '')}</span>
                    <div style={{ flex: 1, height: 5, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${c.share}%`, height: '100%', background: 'var(--accent)', opacity: 0.55 }} />
                    </div>
                    <span className="mono muted" style={{ fontSize: 10.5, width: 62, textAlign: 'right' }}>
                      {c.count} 笔 · {num(c.share, 0)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {risk.scaleUpAfterLoss.length > 0 && (
            <div className="card">
              <div className="card-hd">
                <h2>连亏后放大明细</h2>
              </div>
              <div className="card-bd tight">
                <table className="table">
                  <thead>
                    <tr>
                      <th>交易</th>
                      <th className="num">放大倍数</th>
                      <th className="num">该笔净收益</th>
                    </tr>
                  </thead>
                  <tbody>
                    {risk.scaleUpAfterLoss.map((s) => (
                      <tr key={s.tradeId} onClick={() => (window.location.hash = `#/trades/${s.tradeId}`)}>
                        <td>{s.symbol}</td>
                        <td className="num">{num(s.ratio, 2)}×</td>
                        <td className={`num ${pnlClass(s.netPnl)}`}>{signed(s.netPnl, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <h2>规则清单</h2>
          <span className="hint">本期共 10 条，阈值集中配置在 constants.ts</span>
        </div>
        <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(RULE_NAMES).map(([code, name]) => (
            <div key={code} style={{ display: 'flex', gap: 10, fontSize: 12 }}>
              <span className="mono muted" style={{ width: 26 }}>{code}</span>
              <span style={{ width: 82, color: 'var(--text-2)' }}>{name}</span>
              <span className="muted">{ruleText(code)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ruleText(code: string): string {
  const map: Record<string, string> = {
    R1: '某策略 N ≥ 20 且期望值为负 → 该策略需要重新评估',
    R2: '单日交易笔数 > 近 30 日均值 × 2 → 检查是否情绪化加仓',
    R3: '连亏 ≥ 3 笔后，下一笔名义仓位 > 前 3 笔均值 × 1.5 → 报复性交易特征',
    R4: '无开仓止损的样本占比 > 30% → 风险不可量化',
    R5: '手续费 / |净收益| > 40% → 频率或杠杆结构需优化',
    R6: '未按计划执行的样本占比 > 20% → 执行力问题而非策略问题',
    R7: '某个持仓时长区间样本 ≥ 20 且每笔净期望 < 0 → 这类时长的交易越做越亏',
    R8: '最好的 5% 交易贡献 > 80% 的利润 → 结果是行情给的，不是策略稳定产出的',
    R9: '单方向占比 > 65% 且该方向净收益 < 0 → 方向偏好正在拖累你',
    R10: '手续费 / |毛收益| > 50% → 毛利被成本吃掉一半以上',
    R11: '近 30 天强制平仓 ≥ 2 次 → 杠杆与仓位结构撑不住正常波动',
  };
  return map[code] ?? '';
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="metric" style={{ padding: 10 }}>
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ fontSize: 18 }}>{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}
