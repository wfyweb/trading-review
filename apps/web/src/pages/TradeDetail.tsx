import { useEffect, useMemo, useState } from 'react';
import { api, type Tag, type Trade, type ScoreResult } from '../lib/api';
import { num, signed, pnlClass, dtFull, duration, REGIME_LABEL, EMOTIONS, priceDp, qtyDp } from '../lib/format';
import { go } from '../lib/router';
import { C } from '../lib/colors';
import { CandleChart, type CandlePoint } from '../components/CandleChart';
import { ErrorCard, Loading } from './Overview';

export function TradeDetailPage({ id }: { id: string }) {
  const [trade, setTrade] = useState<Trade | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    entryReason: '',
    exitReason: '',
    plannedSetup: '',
    actualProcess: '',
    planDeviation: '',
    emotion: '',
    followedPlan: null as boolean | null,
    reviewConclusion: '',
    improvementAction: '',
    executionScore: '',
  });
  const [tagIds, setTagIds] = useState<string[]>([]);

  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [candleMeta, setCandleMeta] = useState<{ granularity: string; coverage: number; fromCache: boolean; warning: string | null } | null>(null);
  const [loadingCandles, setLoadingCandles] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [accepting, setAccepting] = useState(false);

  const refreshScore = () => api.scoreSuggest(id).then(setScore).catch(() => {});
  useEffect(() => {
    refreshScore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    Promise.all([api.trade(id), api.tags()])
      .then(([t, tags]) => {
        setTrade(t);
        setAllTags(tags);
        setTagIds(t.tags.map((x) => x.id));
        setForm({
          entryReason: t.review?.entryReason ?? '',
          exitReason: t.review?.exitReason ?? '',
          plannedSetup: t.review?.plannedSetup ?? '',
          actualProcess: t.review?.actualProcess ?? '',
          planDeviation: t.review?.planDeviation ?? '',
          emotion: t.review?.emotion ?? '',
          followedPlan: t.review?.followedPlan ?? null,
          reviewConclusion: t.review?.reviewConclusion ?? '',
          improvementAction: t.review?.improvementAction ?? '',
          executionScore: t.executionScore ? String(t.executionScore) : '',
        });

        // K 线：区间向两端各留 5 分钟，保证开平仓点都在图内
        if (t.exitTime) {
          setLoadingCandles(true);
          const from = new Date(new Date(t.entryTime).getTime() - 5 * 60_000).toISOString();
          const to = new Date(new Date(t.exitTime).getTime() + 5 * 60_000).toISOString();
          api
            .candles({ symbol: t.symbol, from, to })
            .then((r) => {
              setCandles(r.candles);
              setCandleMeta({ granularity: r.granularity, coverage: r.coverage, fromCache: r.fromCache, warning: r.warning });
            })
            .catch(() => setCandles([]))
            .finally(() => setLoadingCandles(false));
        }
      })
      .catch((e) => setErr(e.message));
  }, [id]);

  /** 单笔重算 MFE/MAE，算完刷新本页数据 */
  const recalcMfe = async () => {    setCalculating(true);
    try {
      const r = await api.mfeOne(id, true);
      const t = await api.trade(id);
      setTrade(t);
      if (r.status === 'NO_DATA') alert(`未取到 K 线：${r.warning ?? '该区间超出交易所历史深度'}`);
    } catch (e: any) {
      alert(`重算失败：${e.message}`);
    } finally {
      setCalculating(false);
    }
  };

  /** 采纳建议分（写入人工分，保留明细） */
  const acceptScore = async () => {
    setAccepting(true);
    try {
      await api.scoreAccept(id);
      const t = await api.trade(id);
      setTrade(t);
      setForm((f) => ({ ...f, executionScore: t.executionScore ? String(t.executionScore) : f.executionScore }));
      await refreshScore();
    } catch (e: any) {
      alert(`采纳失败：${e.message}`);
    } finally {
      setAccepting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.saveReview(id, { ...form, tagIds });
      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
      const t = await api.trade(id);
      setTrade(t);
      refreshScore();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (err) return <ErrorCard message={err} />;
  if (!trade) return <Loading />;

  const missingStop = !trade.initialStopPrice;
  const mfe = parseExtremum(trade.mfe);
  const mae = parseExtremum(trade.mae);

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn ghost" onClick={() => go('trades')}>
          ← 返回列表
        </button>
        <span className="muted" style={{ fontSize: 11 }}>交易 ID {trade.id.slice(0, 10)}</span>
        <div className="spacer" />
        {trade.netPnlEstimated && <span className="chip warn">净收益为估算值</span>}
        {trade.feeUnconverted && <span className="chip warn">含非 USDT 手续费，未折算</span>}
        {trade.pnlMismatch && <span className="chip danger">毛收益校验不一致</span>}
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? '保存中…' : saved ? '已保存 ✓' : '保存复盘'}
        </button>
        <button
          className="btn"
          style={{ borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)', color: 'var(--danger)' }}
          onClick={async () => {
            if (!confirm('删除这笔交易？复盘记录与标签会一起删除，不可恢复。')) return;
            try {
              await api.deleteTrade(id);
              go('trades');
            } catch (e: any) {
              alert(`删除失败：${e.message}`);
            }
          }}
        >
          删除
        </button>
      </div>

      {missingStop && (
        <div className="banner">
          <strong>缺少开仓止损价</strong>
          <span className="vline" />
          <span>补齐 <code className="mono">initialStopPrice</code> 即可计算 R 倍数，当前该笔不参与 R 相关统计。</span>
        </div>
      )}

      <div className="card">
        <div className="card-bd" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18, fontWeight: 600 }}>{trade.symbol}</span>
              <span className={`chip ${trade.direction === 'LONG' ? 'long' : 'short'}`}>
                {trade.direction === 'LONG' ? '做多' : '做空'}
              </span>
              <span className="chip">{trade.strategy?.name ?? '未归类'}</span>
              {trade.marketRegime && <span className="chip">{REGIME_LABEL[trade.marketRegime] ?? trade.marketRegime}</span>}
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
              {dtFull(trade.entryTime)} → {dtFull(trade.exitTime)} · 持仓 {duration(trade.holdingSeconds)} · {trade.setupType ?? '未记录形态'}
            </div>
          </div>
          <div className="spacer" />
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 10 }}>净收益 (USDT)</div>
            <div className={`mono ${pnlClass(trade.netPnl)}`} style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.5px' }}>
              {signed(trade.netPnl, 3)}
            </div>
          </div>
          <div style={{ width: 1, height: 40, background: C.border }} />
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 10 }}>R 倍数</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 500 }}>
              {trade.rMultiple ? num(trade.rMultiple, 2) : <span className="muted" style={{ fontSize: 14 }}>不可计算</span>}
            </div>
          </div>
          <div style={{ width: 1, height: 40, background: C.border }} />
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 10 }}>执行评分</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 500, color: scoreColor(trade.executionScore) }}>
              {trade.executionScore ?? '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid g-8-4">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <div className="card-hd">
              <h2>K 线重建</h2>
              <span className="hint">
                {loadingCandles
                  ? '加载中…'
                  : candleMeta
                    ? `${candleMeta.granularity} · ${candles.length} 根 · 覆盖 ${(candleMeta.coverage * 100).toFixed(0)}%${candleMeta.fromCache ? ' · 本地缓存' : ''}`
                    : ''}
              </span>
            </div>
            <div className="card-bd">
              {loadingCandles ? (
                <div className="empty" style={{ padding: '28px 0' }}>
                  正在加载 K 线…
                </div>
              ) : candles.length > 0 ? (
                <CandleChart
                  candles={candles}
                  direction={trade.direction}
                  entryPrice={trade.entryPrice}
                  exitPrice={trade.exitPrice}
                  stopPrice={trade.initialStopPrice}
                  mfe={parseExtremum(trade.mfe)}
                  mae={parseExtremum(trade.mae)}
                  entryTime={trade.entryTime}
                  exitTime={trade.exitTime}
                />
              ) : (
                <>
                  <PriceTrack trade={trade} />
                  <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>
                    降级为成交点轨迹：{candleMeta?.warning ?? '未取到该区间 K 线'}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <h2>复盘记录</h2>
              <span className="hint">主观信息只能人工填写，系统不猜</span>
            </div>
            <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="入场理由（当时看到了什么信号）">
                <textarea
                  className="input"
                  rows={2}
                  value={form.entryReason}
                  onChange={(e) => setForm({ ...form, entryReason: e.target.value })}
                  placeholder="例：4H 箱体上沿放量突破，回踩不破 62000 建仓"
                />
              </Field>
              <div className="grid g2">
                <Field label="计划形态">
                  <input className="input" value={form.plannedSetup} onChange={(e) => setForm({ ...form, plannedSetup: e.target.value })} placeholder="突破回踩 / 均线回踩…" />
                </Field>
                <Field label="实际执行">
                  <input className="input" value={form.actualProcess} onChange={(e) => setForm({ ...form, actualProcess: e.target.value })} placeholder="与计划一致 / 提前入场…" />
                </Field>
              </div>
              <Field label="出场理由">
                <textarea className="input" rows={2} value={form.exitReason} onChange={(e) => setForm({ ...form, exitReason: e.target.value })} />
              </Field>
              <Field label="计划偏离（哪里没按计划做）">
                <input className="input" value={form.planDeviation} onChange={(e) => setForm({ ...form, planDeviation: e.target.value })} placeholder="提前止盈 / 移动止损 / 加仓…" />
              </Field>
              <div className="grid g3">
                <Field label="当时的情绪">
                  <select className="select" value={form.emotion} onChange={(e) => setForm({ ...form, emotion: e.target.value })}>
                    <option value="">未记录</option>
                    {EMOTIONS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="是否按计划执行">
                  <select
                    className="select"
                    value={form.followedPlan === null ? '' : String(form.followedPlan)}
                    onChange={(e) => setForm({ ...form, followedPlan: e.target.value === '' ? null : e.target.value === 'true' })}
                  >
                    <option value="">未记录</option>
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                </Field>
                <Field label="执行评分（0-100）">
                  <input className="input" value={form.executionScore} onChange={(e) => setForm({ ...form, executionScore: e.target.value })} placeholder="80" />
                </Field>
              </div>
              <Field label="复盘结论">
                <textarea className="input" rows={2} value={form.reviewConclusion} onChange={(e) => setForm({ ...form, reviewConclusion: e.target.value })} placeholder="这笔交易做对了什么、做错了什么" />
              </Field>
              <Field label="下一步要改的一件事">
                <input className="input" value={form.improvementAction} onChange={(e) => setForm({ ...form, improvementAction: e.target.value })} placeholder="必须具体、可执行" />
              </Field>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <div className="card-hd">
              <h2>盈亏构成</h2>
            </div>
            <div className="card-bd" style={{ paddingTop: 6 }}>
              <Row label="毛收益" value={signed(trade.grossPnl, 4)} cls={pnlClass(trade.grossPnl)} />
              <Row label="− 手续费" value={signed(`-${trade.tradingFee}`, 4)} cls="neg" />
              <Row label="+ 资金费率" value={signed(trade.fundingFee, 4)} cls={pnlClass(trade.fundingFee)} />
              <Row label="= 净收益" value={signed(trade.netPnl, 4)} cls={pnlClass(trade.netPnl)} strong />
              <div style={{ height: 8 }} />
              <Row label="入场均价" value={num(trade.entryPrice, priceDp(trade.entryPrice))} />
              <Row label="出场均价" value={trade.exitPrice ? num(trade.exitPrice, 4) : '持仓中'} />
              <Row label="数量" value={num(trade.quantity, qtyDp(trade.quantity))} />
              <Row label="名义仓位" value={`${num(Number(trade.entryPrice) * Number(trade.quantity), 2)} U`} />
              <Row label="保证金" value={trade.margin ? `${num(trade.margin, 2)} U` : '—'} />
              <Row label="实际杠杆" value={trade.actualLeverage ? `${num(trade.actualLeverage, 1)}×` : '—'} />
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <h2>执行评分</h2>
              <span className="hint">
                {trade.scoreSource === 'AUTO' ? '规则自动分' : trade.scoreSource === 'MANUAL' ? '人工分' : '未评分'}
              </span>
            </div>
            <div className="card-bd" style={{ paddingTop: 6 }}>
              {!score ? (
                <div className="muted" style={{ fontSize: 11 }}>计算中…</div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', marginBottom: 8 }}>
                    <div>
                      <div className="muted" style={{ fontSize: 10 }}>
                        {score.scoreSource === 'MANUAL' ? '自评' : score.scoreSource === 'AUTO' ? '当前(自动)' : '自评'}
                      </div>
                      <div className="mono" style={{ fontSize: 19, color: C.t2 }}>{score.selfScore ?? '—'}</div>
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 10 }}>建议</div>
                      <div className="mono" style={{ fontSize: 19, color: scoreColor(score.suggested) }}>{score.suggested ?? '—'}</div>
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 10 }}>偏差</div>
                      <div
                        className="mono"
                        style={{ fontSize: 19, color: score.deviation === null ? C.t3 : score.deviation > 0 ? 'var(--warn)' : 'var(--accent-ink)' }}
                      >
                        {score.deviation === null ? '—' : score.deviation > 0 ? `+${score.deviation}` : score.deviation}
                      </div>
                    </div>
                  </div>

                  {score.items.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
                      {score.items.map((it) => (
                        <div key={it.key} className="stat-row" title={it.reason}>
                          <span style={{ fontSize: 11.5, color: C.t2 }}>{it.label}</span>
                          <span className="mono" style={{ fontSize: 11.5, color: it.delta < 0 ? 'var(--warn)' : C.accent }}>
                            {it.delta > 0 ? `+${it.delta}` : it.delta}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {score.notes.map((n, i) => (
                    <div key={i} className="muted" style={{ fontSize: 10.5, lineHeight: 1.55 }}>
                      · {n}
                    </div>
                  ))}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <button
                      className="btn ghost"
                      style={{ fontSize: 11, padding: '3px 10px' }}
                      disabled={accepting || score.suggested === null}
                      onClick={acceptScore}
                    >
                      {accepting ? '写入中…' : '采纳建议分'}
                    </button>
                    <span className="muted" style={{ fontSize: 10 }}>
                      {score.deviation !== null && Math.abs(score.deviation) >= 20
                        ? score.deviation > 0
                          ? '自评明显偏高，值得回看'
                          : '自评明显偏低，对自己太苛刻'
                        : ''}
                    </span>
                  </div>

                  {score.suggested === null && (
                    <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>
                      没有可评分依据时系统不给分——宁可不给结论，也不编一个数字。
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <h2>风险口径</h2>
              <span className="hint">{trade.candleStatus === 'OK' ? 'K 线已算' : trade.candleStatus === 'PARTIAL' ? 'K 线不完整' : trade.candleStatus === 'NO_DATA' ? '无 K 线' : '未算 K 线'}</span>
            </div>
            <div className="card-bd" style={{ paddingTop: 6 }}>
              <Row label="开仓止损价" value={trade.initialStopPrice ? num(trade.initialStopPrice, priceDp(trade.initialStopPrice)) : '未记录'} cls={missingStop ? 'warn' : ''} />
              <Row label="计划风险金额" value={trade.riskAmount ? `${num(trade.riskAmount, 3)} U` : '—'} />
              <Row label="R 倍数" value={trade.rMultiple ? num(trade.rMultiple, 2) : '不可计算'} />
              <Row
                label="MFE 最大有利"
                value={mfe ? `${Number(mfe.pct) > 0 ? '+' : ''}${num(mfe.pct, 2)}% · ${signed(mfe.usdt, 3)} U${mfe.r ? ` · ${num(mfe.r, 2)}R` : ''}` : '未计算'}
                cls={mfe ? 'pos' : ''}
              />
              <Row
                label="MAE 最大不利"
                value={mae ? `${num(mae.pct, 2)}% · ${signed(mae.usdt, 3)} U${mae.r ? ` · ${num(mae.r, 2)}R` : ''}` : '未计算'}
                cls={mae ? 'neg' : ''}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <button className="btn ghost" style={{ fontSize: 11, padding: '3px 10px' }} disabled={calculating} onClick={recalcMfe}>
                  {calculating ? '计算中…' : '重算 K 线指标'}
                </button>
                <span className="muted" style={{ fontSize: 10 }}>
                  {trade.candleStatus === 'PARTIAL' ? '该区间 K 线不足 90%，数值仅供参考' : ''}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.6 }}>
                R = 净收益 / 计划风险；MFE/MAE 用持仓区间的 K 线最高/最低价计算，衡量「跑早了没有 / 止损是不是太紧」，不是真实成交路径。
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <h2>标签</h2>
              <span className="hint">点击切换</span>
            </div>
            <div className="card-bd" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allTags.map((t) => {
                const on = tagIds.includes(t.id);
                const color = t.polarity === 'POSITIVE' ? C.neg : t.polarity === 'NEGATIVE' ? C.pos : C.t2;
                return (
                  <span
                    key={t.id}
                    className="tag"
                    onClick={() => setTagIds((s) => (on ? s.filter((x) => x !== t.id) : [...s, t.id]))}
                    style={{
                      cursor: 'pointer',
                      padding: '3px 8px',
                      fontSize: 11,
                      color: on ? color : C.t3,
                      background: on ? (t.polarity === 'POSITIVE' ? 'var(--neg-soft)' : 'var(--pos-soft)') : 'var(--surface-2)',
                      border: `1px solid ${on ? color : C.border}`,
                      opacity: on ? 1 : 0.7,
                    }}
                  >
                    {t.name}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PriceTrack({ trade }: { trade: Trade }) {
  const W = 860;
  const H = 200;

  const geo = useMemo(() => {
    const entry = Number(trade.entryPrice);
    const exit = trade.exitPrice ? Number(trade.exitPrice) : entry;
    const stop = trade.initialStopPrice ? Number(trade.initialStopPrice) : null;
    const vals = [entry, exit, ...(stop ? [stop] : [])];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.35 || max * 0.002;
    const lo = min - pad;
    const hi = max + pad;
    const y = (v: number) => 24 + (1 - (v - lo) / (hi - lo)) * (H - 48);
    return { entry, exit, stop, y, lo, hi };
  }, [trade]);

  const xEntry = 90;
  const xExit = W - 90;
  const win = trade.direction === 'LONG' ? geo.exit >= geo.entry : geo.exit <= geo.entry;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {geo.stop !== null && (
        <>
          <rect
            x={xEntry}
            y={Math.min(geo.y(geo.entry), geo.y(geo.stop))}
            width={xExit - xEntry}
            height={Math.abs(geo.y(geo.entry) - geo.y(geo.stop))}
            fill={C.neg}
            opacity="0.07"
          />
          <line x1={xEntry - 14} x2={xExit + 14} y1={geo.y(geo.stop)} y2={geo.y(geo.stop)} stroke={C.neg} strokeWidth="1" strokeDasharray="4 3" opacity="0.85" />
          <text x={xExit + 20} y={geo.y(geo.stop)} fill={C.neg} fontSize="10.5" dominantBaseline="middle" fontFamily="var(--mono)">
            止损 {num(trade.initialStopPrice, priceDp(trade.initialStopPrice))}
          </text>
        </>
      )}

      <rect
        x={xEntry}
        y={Math.min(geo.y(geo.entry), geo.y(geo.exit))}
        width={xExit - xEntry}
        height={Math.abs(geo.y(geo.entry) - geo.y(geo.exit))}
        fill={win ? C.pos : C.neg}
        opacity="0.1"
      />

      <line x1={xEntry - 14} x2={xExit + 14} y1={geo.y(geo.entry)} y2={geo.y(geo.entry)} stroke={C.t2} strokeWidth="1" strokeDasharray="4 3" />
      <text x={xEntry - 20} y={geo.y(geo.entry)} fill={C.t2} fontSize="10.5" textAnchor="end" dominantBaseline="middle" fontFamily="var(--mono)">
        开仓 {num(trade.entryPrice, priceDp(trade.entryPrice))}
      </text>

      <line x1={xEntry - 14} x2={xExit + 14} y1={geo.y(geo.exit)} y2={geo.y(geo.exit)} stroke={win ? C.pos : C.neg} strokeWidth="1" strokeDasharray="4 3" />
      <text x={xEntry - 20} y={geo.y(geo.exit)} fill={win ? C.pos : C.neg} fontSize="10.5" textAnchor="end" dominantBaseline="middle" fontFamily="var(--mono)">
        平仓 {num(trade.exitPrice ?? '—', priceDp(trade.exitPrice)) }
      </text>

      <path
        d={`M${xEntry},${geo.y(geo.entry)} L${xExit},${geo.y(geo.exit)}`}
        fill="none"
        stroke={win ? C.pos : C.neg}
        strokeWidth="2"
      />
      <circle cx={xEntry} cy={geo.y(geo.entry)} r="4" fill={C.tx} stroke={C.surface} strokeWidth="2" />
      <circle cx={xExit} cy={geo.y(geo.exit)} r="4" fill={win ? C.pos : C.neg} stroke={C.surface} strokeWidth="2" />

      <text x={xEntry} y={H - 12} fill={C.t3} fontSize="10" textAnchor="middle">
        {dtFull(trade.entryTime).slice(5)}
      </text>
      <text x={xExit} y={H - 12} fill={C.t3} fontSize="10" textAnchor="middle">
        {trade.exitTime ? dtFull(trade.exitTime).slice(5) : '持仓中'}
      </text>
    </svg>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 11, color: C.t3 }}>{label}</label>
      {children}
    </div>
  );
}

function Row({ label, value, cls, strong }: { label: string; value: string; cls?: string; strong?: boolean }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <span className={`mono ${cls ?? ''}`} style={strong ? { fontWeight: 600, fontSize: 13 } : undefined}>
        {value}
      </span>
    </div>
  );
}

/**
 * 执行分色阶：固定交通灯语义（高分绿、中分橙、低分红）。
 * 刻意不复用 --pos/--neg——那两个随「涨跌配色」切换而反转，
 * 分数不是盈亏，不能跟着翻。
 */
function scoreColor(score: number | null): string {
  if (score === null) return C.t2;
  if (score >= 75) return '#6f8b73';
  if (score >= 50) return '#b08d57';
  return '#a05b52';
}

/** MFE/MAE 在库里是 JSON 字符串，解析失败就当未计算（不用 0 顶替） */
function parseExtremum(raw: string | null): { pct: string; usdt: string; r: string | null; at: string } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (typeof v?.pct !== 'string' && typeof v?.pct !== 'number') return null;
    return { pct: String(v.pct), usdt: String(v.usdt ?? '0'), r: v.r === null || v.r === undefined ? null : String(v.r), at: String(v.at ?? '') };
  } catch {
    return null;
  }
}
