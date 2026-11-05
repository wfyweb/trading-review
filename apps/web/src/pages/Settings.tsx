import { useEffect, useState } from 'react';
import { api, type SyncJob } from '../lib/api';
import { ErrorCard, Loading } from './Overview';
import { dtFull, todayStr } from '../lib/format';
import { Field } from '../components/Modal';
import { DateRange, type DateRangeValue } from '../components/DateRange';

function cleanError(msg: string): string {
  // 后端返回的是「状态码 + 原文 + JSON」，这里只取出人话部分
  try {
    const m = msg.match(/\{.*\}$/s);
    if (m) {
      const j = JSON.parse(m[0]);
      if (j.message) return Array.isArray(j.message) ? j.message.join('；') : j.message;
    }
  } catch {
    /* ignore */
  }
  return msg.replace(/^\d{3}\s+\w+\s*/, '');
}

interface Config {
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
}

export function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [baseline, setBaseline] = useState('');

  const [testResult, setTestResult] = useState<any>(null);
  const [netResult, setNetResult] = useState<any>(null);
  const [syncRange, setSyncRange] = useState<DateRangeValue>({ from: todayStr(-89), to: todayStr() });
  const [syncing, setSyncing] = useState(false);
  const [activeJob, setActiveJob] = useState<{ id: string; logLines: { t: string; level: string; msg: string }[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    Promise.all([api.syncConfig(), api.syncJobs()])
      .then(([c, j]) => {
        setConfig(c);
        setBaseline(c.baselineCapital);
        setJobs(j);
      })
      .catch((e) => setErr(e.message));
  };

  useEffect(load, []);

  if (err) return <ErrorCard message={err} />;
  if (!config) return <Loading />;

  const saveKeys = async () => {
    setNotice(null);
    if (!apiKey || !secret || !passphrase) {
      setNotice('三项都需要填写');
      return;
    }
    try {
      const c = await api.saveSyncConfig({ apiKey, secret, passphrase });
      setConfig(c);
      setApiKey('');
      setSecret('');
      setPassphrase('');
      setNotice('已保存。密钥以 AES-256-GCM 加密存于 data/secrets，数据库内不留明文。');
    } catch (e: any) {
      setNotice(`保存失败：${cleanError(e.message)}`);
    }
  };

  const test = async () => {
    setTestResult({ testing: true });
    // 三个框都填了就用刚填的（不必先保存）；否则用已保存的
    const creds = apiKey && secret && passphrase ? { apiKey, secret, passphrase } : undefined;
    try {
      const r = await api.testConnection(creds);
      setTestResult(r);
    } catch (e: any) {
      setTestResult({ ok: false, mode: 'LIVE', error: cleanError(e.message) });
    }
  };

  const netCheck = async () => {
    setNetResult({ checking: true });
    const r = await api.netCheck();
    setNetResult(r as any);
  };

  /** 反推期初资金：当前权益 − 累计净收益 */
  const derive = async () => {
    setNotice(null);
    try {
      const r = await api.deriveBaseline(config!.accountId);
      const ok = confirm(
        `当前权益：${Number(r.lastEquity).toFixed(2)} USDT\n` +
          `已同步区间累计净收益：${Number(r.cumulativeNetPnl).toFixed(2)} USDT\n` +
          `推算期初资金：${Number(r.suggestedBaseline).toFixed(2)} USDT\n\n` +
          `（${r.tradeCount} 笔已平仓。${r.note}）\n\n要应用为初始资金吗？`,
      );
      if (!ok) return;
      const a = await api.applyDerivedBaseline(config!.accountId);
      setBaseline(a.baselineCapital);
      setNotice(`初始资金已设为 ${Number(a.baselineCapital).toFixed(2)} USDT`);
      load();
    } catch (e: any) {
      setNotice(`反推失败：${cleanError(e.message)}`);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const job = await api.runSync({ from: syncRange.from, to: syncRange.to });
      const detail = await api.syncJob(job.id);
      setActiveJob({ id: detail.id, logLines: detail.logLines });
      load();
    } catch (e: any) {
      setNotice(`同步失败：${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const openJob = async (id: string) => {
    const d = await api.syncJob(id);
    setActiveJob({ id: d.id, logLines: d.logLines });
  };

  return (
    <div className="page">
      <div className="grid g2">
        <div className="card">
          <div className="card-hd">
            <h2>账户</h2>
            <span className="hint">初始资金决定收益率与回撤的基准</span>
          </div>
          <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="stat-row">
              <span>账户</span>
              <span className="mono">Bitget 主账户</span>
            </div>
            <div className="stat-row">
              <span>账户体系</span>
              <span className="mono">
                {config.accountModeLabel ?? <span className="muted">未探测（点测试连接后自动识别）</span>}
              </span>
            </div>
            <div className="stat-row">
              <span>持仓模式</span>
              <span className="mono">{config.posMode ?? '未探测'}</span>
            </div>
            <div className="stat-row">
              <span>最近同步</span>
              <span className="mono">{config.lastSyncAt ? dtFull(config.lastSyncAt) : '从未同步'}</span>
            </div>
            <div className="form-row">
              <Field label="初始资金 (USDT)" hint="改这里会影响收益率与回撤基准">
                <input className="input" value={baseline} onChange={(e) => setBaseline(e.target.value)} />
              </Field>
              <Field label="操作">
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn"
                    onClick={async () => {
                      const c = await api.saveSyncConfig({ baselineCapital: baseline });
                      setConfig(c);
                      setNotice('初始资金已更新');
                    }}
                  >
                    保存
                  </button>
                  <button className="btn ghost" onClick={derive} title="用当前权益减去累计净收益，反推同步区间开始时的本金">
                    反推
                  </button>
                </div>
              </Field>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <h2>Bitget API 配置</h2>
            <span className={`chip ${config.mode === 'LIVE' ? 'acc' : 'warn'}`}>{config.mode === 'LIVE' ? '实盘只读' : 'Mock 模式'}</span>
          </div>
          <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {config.credentialSource === 'ENV' && (
              <div className="banner" style={{ borderColor: '#d3ddcd', background: '#eef2ec', color: '#5f7a63' }}>
                <strong>已从 .env 读取密钥</strong>
                <span className="vline" />
                <span>{config.apiKeyMasked}｜如需更换，改 apps/api/.env 后重启，或在下方填写保存覆盖</span>
              </div>
            )}
            {config.credentialSource === 'LOCAL' && (
              <div className="banner">
                <strong>已配置（页面保存）</strong>
                <span className="vline" />
                <span>{config.apiKeyMasked}｜优先级高于 .env 预置值</span>
              </div>
            )}
            {config.credentialSource === 'NONE' && (
              <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
                还没有可用密钥。两种方式任选：
                <br />
                ① 在 <code className="mono">apps/api/.env</code> 里填 <code className="mono">BITGET_API_KEY / BITGET_SECRET_KEY / BITGET_PASSPHRASE</code>，重启后端即自动生效；
                <br />
                ② 直接在下面三个框填写并保存。
                <br />
                都没有时为 <b>Mock 模式</b>：同步会写入内置演示成交，不发外网请求。
              </div>
            )}

            <div className="form-row g3">
              <Field label="API Key">
                <input className="input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={config.configured ? '已配置，重新填写可覆盖' : ''} />
              </Field>
              <Field label="Secret Key">
                <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
              </Field>
              <Field label="Passphrase">
                <input className="input" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              </Field>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" onClick={saveKeys}>
                保存密钥
              </button>
              <button className="btn" onClick={test}>
                测试连接
              </button>
              <button className="btn" onClick={netCheck}>
                网络自检
              </button>
              <button
                className="btn ghost"
                onClick={async () => {
                  const c: any = await api.clearSyncConfig();
                  setConfig(c);
                  setTestResult(null);
                  setNotice(c.clearedNote ?? '已清除本地密钥');
                }}
              >
                清除密钥
              </button>
            </div>

            <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.7 }}>
              密钥以 AES-256-GCM 加密后存于 <code className="mono">data/secrets/</code>，密钥文件 <code className="mono">data/.secret.key</code> 与数据库分离。
              这能防"数据库被单独拷走"，但不防本机管理员。系统钥匙串方案列入后期。
            </div>

            <details>
              <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--text-3)' }}>不知道怎么申请密钥？</summary>
              <div className="steps" style={{ marginTop: 8 }}>
                <div>
                  <span className="n">1</span>Bitget 右上角头像 → API 管理 → 创建 API Key（系统生成）
                </div>
                <div>
                  <span className="n">2</span>权限只勾「读取」，交易、划转、提币一律不勾
                </div>
                <div>
                  <span className="n">3</span>自己设一个 Passphrase 并记牢（Bitget 不发给你）
                </div>
                <div>
                  <span className="n">4</span>Secret Key 只显示一次，关页前先保存
                </div>
                <div className="muted" style={{ marginTop: 2 }}>
                  完整图文步骤见 <code className="mono">docs/03-Bitget密钥接入指南.md</code>
                </div>
              </div>
            </details>

            {testResult && (
              <div className={`banner ${testResult.testing ? '' : testResult.ok && testResult.mode === 'LIVE' ? '' : 'danger'}`}>
                {testResult.testing ? (
                  '正在测试…'
                ) : testResult.ok && testResult.mode === 'LIVE' ? (
                  <>
                    <strong>连接成功（真实接口）</strong>
                    <span className="vline" />
                    <span>
                      持仓模式 {testResult.posMode}｜权益 {testResult.equity}
                      {testResult.accountModeLabel ? `｜${testResult.accountModeLabel}` : ''}
                      {testResult.credentialSource === 'INPUT'
                        ? '｜使用刚填写的密钥（未保存）'
                        : testResult.credentialSource === 'ENV'
                          ? '｜使用 .env 中的密钥'
                          : '｜使用页面保存的密钥'}
                    </span>
                  </>
                ) : testResult.mode === 'MOCK' ? (
                  <>
                    <strong>没有用真实密钥测试</strong>
                    <span className="vline" />
                    <span>{testResult.error ?? '当前是 Mock 模式，返回值是内置假数据'}</span>
                  </>
                ) : (
                  <>
                    <strong>连接失败</strong>
                    <span className="vline" />
                    <span>{testResult.error}</span>
                  </>
                )}
                {testResult.warning && (
                  <>
                    <span className="vline" />
                    <span>{testResult.warning}</span>
                  </>
                )}
              </div>
            )}

            {netResult && (
              <div className="card" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div className="card-bd" style={{ padding: 12 }}>
                  <div style={{ fontSize: 11.5, marginBottom: 8 }}>
                    网络自检 {netResult.checking ? '进行中…' : netResult.ok ? '通过' : '未通过'} · 目标 {netResult.baseUrl ?? '—'}
                  </div>
                  {netResult.steps?.map((s: any) => (
                    <div key={s.name} className="stat-row">
                      <span>
                        {s.ok ? '✓' : '✗'} {s.name}
                      </span>
                      <span className={`mono ${s.ok ? '' : 'neg'}`} style={{ fontSize: 11 }}>
                        {s.detail} · {s.ms}ms
                      </span>
                    </div>
                  ))}
                  {netResult.advice && (
                    <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.7 }}>
                      {netResult.advice}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <h2>数据同步</h2>
          <span className="hint">首次同步用较长区间，之后按增量即可</span>
          <div className="spacer" />
          {config.mode === 'MOCK' && <span className="chip warn">当前为 Mock 模式</span>}
        </div>
        <div className="card-bd" style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <div className="field">
            <label>同步区间</label>
            <DateRange value={syncRange} onChange={setSyncRange} allowAll={false} />
          </div>
          <button className="btn primary" onClick={runSync} disabled={syncing}>
            {syncing ? '同步中…' : '立即同步'}
          </button>

          <div className="spacer" />
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, maxWidth: 380 }}>
            同步流程：探测持仓模式 → 拉成交 → 拉订单 → 拉流水 → 去重入库 → 成交配对 → 归集资金费率。
            双向持仓会直接中止，不做猜测性配对。
          </div>
        </div>
        {notice && (
          <div className="card-bd" style={{ paddingTop: 0 }}>
            <div className="banner">
              <span>{notice}</span>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ borderColor: 'rgba(254,84,91,.28)' }}>
        <div className="card-hd">
          <h2 style={{ color: 'var(--danger)' }}>清空数据</h2>
          <span className="hint">重新导入前先清场，避免新旧数据混在一起</span>
        </div>
        <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, marginBottom: 3 }}>只清同步数据</div>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
                删除自动配对生成的交易、成交、订单、流水与同步记录。<b>手工录入的交易和复盘会保留。</b>
              </div>
            </div>
            <button
              className="btn"
              onClick={async () => {
                if (!confirm('将删除所有「自动配对」生成的交易、成交、订单与流水。手工录入的交易和复盘会保留。继续？')) return;
                const r = await api.resetSync();
                setNotice(`已清空：交易 ${r.trades} 笔、成交 ${r.fills} 条、订单 ${r.orders} 条、流水 ${r.ledger} 条`);
                setActiveJob(null);
                load();
              }}
            >
              清空同步数据
            </button>
          </div>

          <div style={{ height: 1, background: 'var(--border)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, marginBottom: 3, color: 'var(--danger)' }}>清空全部交易数据</div>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
                连手工录入和演示数据一起删掉，交易、成交、订单、流水、同步记录、复盘记录全部清空。
                <b>账户、策略、标签会保留。</b>不可撤销。
              </div>
            </div>
            <button
              className="btn"
              style={{ borderColor: 'color-mix(in srgb, var(--danger) 45%, transparent)', color: 'var(--danger)' }}
              onClick={async () => {
                const typed = prompt('这一步不可撤销。请输入「清空」两个字以确认：');
                if (typed !== '清空') {
                  if (typed !== null) alert('输入不匹配，已取消');
                  return;
                }
                try {
                  const r = await api.purgeAll();
                  setNotice(`已清空全部交易数据（${r.trades} 笔）。策略 ${r.keptStrategies} 个、标签 ${r.keptTags} 个已保留，可以直接重新同步。`);
                  setActiveJob(null);
                  load();
                } catch (e: any) {
                  setNotice(`清空失败：${cleanError(e.message)}`);
                }
              }}
            >
              清空全部交易
            </button>
          </div>

          <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.7 }}>
            想恢复演示数据：在项目目录执行 <code className="mono">pnpm --filter api prisma:seed</code>
            （会重置整个数据库并重新灌入 26 笔演示交易）。
          </div>
        </div>
      </div>

      {activeJob && (
        <div className="card">
          <div className="card-hd">
            <h2>本次同步日志</h2>
            <div className="spacer" />
            <button className="btn ghost" onClick={() => setActiveJob(null)}>
              收起
            </button>
          </div>
          <div className="card-bd">
            <div className="log-box">
              {activeJob.logLines.map((l, i) => (
                <div key={i} className={l.level === 'error' ? 'error' : l.level === 'warn' ? 'warn' : ''}>
                  [{l.t.slice(11, 19)}] {l.msg}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-hd">
          <h2>同步历史</h2>
          <span className="hint">保留最近 20 次</span>
        </div>
        <div className="card-bd tight">
          <table className="table">
            <thead>
              <tr>
                <th>开始时间</th>
                <th>模式</th>
                <th>状态</th>
                <th className="num">区间</th>
                <th className="num">成交</th>
                <th className="num">订单</th>
                <th className="num">流水</th>
                <th className="num">新增</th>
                <th className="num">耗时</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} onClick={() => openJob(j.id)}>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {dtFull(j.createdAt)}
                  </td>
                  <td>
                    <span className={`chip ${j.mode === 'LIVE' ? 'acc' : ''}`}>{j.mode}</span>
                  </td>
                  <td>
                    <span className={`chip ${j.status === 'SUCCESS' ? 'acc' : j.status === 'FAILED' ? 'danger' : j.status === 'ABORTED' ? 'warn' : ''}`}>
                      {j.status === 'SUCCESS' ? '成功' : j.status === 'FAILED' ? '失败' : j.status === 'ABORTED' ? '已中止' : '进行中'}
                    </span>
                  </td>
                  <td className="num muted" style={{ fontSize: 11 }}>
                    {j.requestedFrom.slice(5, 10)} ~ {j.requestedTo.slice(5, 10)}
                  </td>
                  <td className="num">{j.fillsCount}</td>
                  <td className="num">{j.ordersCount}</td>
                  <td className="num">{j.ledgerCount}</td>
                  <td className="num">{j.insertedCount}</td>
                  <td className="num muted">
                    {j.startedAt && j.completedAt
                      ? `${Math.max(1, Math.round((new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime()) / 1000))}s`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobs.length === 0 && <div className="empty">还没有同步记录。点击「立即同步」试试（未配置密钥时为 Mock 模式）。</div>}
        </div>
      </div>
    </div>
  );
}
