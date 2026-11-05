import { useEffect, useState } from 'react';
import { api, type DiagnosticIssue, type Filters, type RiskReport } from '../lib/api';
import { num, signed, pnlClass, ratioToPct } from '../lib/format';
import { DailyBars } from '../charts';
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
};

export function DiagnosticsPage({ filters }: { filters: Filters }) {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.diagnostics(filters), api.risk(filters)])
      .then(([d, r]) => {
        setDiag(d);
        setRisk(r);
      })
      .catch((e) => setErr(e.message));
  }, [JSON.stringify(filters)]);

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
  };
  return map[code] ?? '';
}
