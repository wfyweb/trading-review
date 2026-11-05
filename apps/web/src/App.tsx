import { useEffect, useState } from 'react';
import { OverviewPage } from './pages/Overview';
import { TradesPage } from './pages/Trades';
import { TradeDetailPage } from './pages/TradeDetail';
import { StrategiesPage } from './pages/Strategies';
import { TagsPage } from './pages/Tags';
import { DiagnosticsPage } from './pages/Diagnostics';
import { SettingsPage } from './pages/Settings';
import type { Filters } from './lib/api';
import { go, currentRoute } from './lib/router';
import { DateRange, type DateRangeValue } from './components/DateRange';

type Tone = 'cn' | 'intl';

const NAV = [
  { key: 'overview', label: '概览', desc: '整体表现与权益' },
  { key: 'trades', label: '交易记录', desc: '逐笔明细' },
  { key: 'strategies', label: '策略分析', desc: '哪个策略在赚钱' },
  { key: 'tags', label: '标签归因', desc: '亏损来自哪里' },
  { key: 'diagnostics', label: '系统诊断', desc: '规则式体检' },
  { key: 'settings', label: '设置', desc: '账户与数据同步' },
];

function useHashRoute() {
  const [hash, setHash] = useState(() => currentRoute());
  useEffect(() => {
    const onChange = () => setHash(currentRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export default function App() {
  const route = useHashRoute();
  const [seg, param] = route.split('/');
  const [tone, setTone] = useState<Tone>((localStorage.getItem('tone') as Tone) || 'intl');
  const [dateRange, setDateRange] = useState<DateRangeValue>({});

  useEffect(() => {
    document.documentElement.dataset.tone = tone;
    localStorage.setItem('tone', tone);
  }, [tone]);

  const filters: Filters = dateRange.from || dateRange.to
    ? { ...(dateRange.from ? { from: dateRange.from } : {}), ...(dateRange.to ? { to: dateRange.to } : {}) }
    : {};

  const rangeLabel =
    dateRange.from || dateRange.to
      ? `${dateRange.from || '…'} ~ ${dateRange.to || '今天'}`
      : '全部时间';

  const title = seg === 'trades' && param ? '单笔复盘' : NAV.find((n) => n.key === seg)?.label ?? '概览';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">TR</div>
          <div>
            <div className="brand-name">交易复盘工作台</div>
            <div className="brand-sub">trading review</div>
          </div>
        </div>

        <nav className="nav">
          <div className="nav-label">复盘</div>
          {NAV.map((n) => (
            <div
              key={n.key}
              className={`nav-item ${seg === n.key ? 'active' : ''}`}
              onClick={() => go(n.key)}
              title={n.desc}
            >
              <span className="dot" />
              {n.label}
            </div>
          ))}
        </nav>

        <div className="nav">
          <div className="nav-label">账户</div>
          <div className="nav-item" style={{ cursor: 'default' }}>
            <span className="dot" />
            Bitget 主账户
          </div>
          <div className="nav-item" style={{ cursor: 'default' }}>
            <span className="dot" />
            单向持仓 · USDT 永续
          </div>
        </div>

        <div className="side-foot">
          <div>本地优先 · 数据不上云</div>
          <div>MVP-1 · v0.1.0</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <div className="sub">
              {rangeLabel} · 时区 Asia/Shanghai
            </div>
          </div>
          <div className="spacer" />

          <div className="filters">
            <div className="field">
              <label>时间范围</label>
              <DateRange value={dateRange} onChange={setDateRange} />
            </div>
            <div className="field">
              <label>涨跌配色</label>
              <select
                className="select"
                value={tone}
                onChange={(e) => {
                  const next = e.target.value as Tone;
                  // 先写 DOM 再改 state，保证 SVG 读取配色时已生效
                  document.documentElement.dataset.tone = next;
                  localStorage.setItem('tone', next);
                  setTone(next);
                }}
              >
                <option value="intl">国际（涨绿跌红）</option>
                <option value="cn">中式（涨红跌绿）</option>
              </select>
            </div>
          </div>
        </header>

        {(seg === 'overview' || !seg) && <OverviewPage filters={filters} />}
        {seg === 'trades' && !param && <TradesPage filters={filters} />}
        {seg === 'trades' && param && <TradeDetailPage id={param} />}
        {seg === 'strategies' && <StrategiesPage filters={filters} />}
        {seg === 'tags' && <TagsPage filters={filters} />}
        {seg === 'diagnostics' && <DiagnosticsPage filters={filters} />}
        {seg === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}
