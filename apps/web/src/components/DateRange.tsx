import { useEffect, useRef, useState } from 'react';

export interface DateRangeValue {
  from?: string;
  to?: string;
}

function pad(n: number) {
  return `${n}`.padStart(2, '0');
}

function todayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

function lastMonthRange(): DateRangeValue {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const last = new Date(d.getFullYear(), d.getMonth(), 0);
  return {
    from: `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(first.getDate())}`,
    to: `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`,
  };
}

interface Preset {
  key: string;
  label: string;
  get: () => DateRangeValue;
}

const PRESETS: Preset[] = [
  { key: 'all', label: '全部', get: () => ({}) },
  { key: '7d', label: '近 7 天', get: () => ({ from: todayStr(-7) }) },
  { key: '30d', label: '近 30 天', get: () => ({ from: todayStr(-30) }) },
  { key: '90d', label: '近 89 天', get: () => ({ from: todayStr(-89) }) },
  { key: 'month', label: '本月', get: () => ({ from: firstOfMonth() }) },
  { key: 'lastMonth', label: '上月', get: () => lastMonthRange() },
];

function labelOf(v: DateRangeValue): string {
  if (!v.from && !v.to) return '全部时间';
  return `${v.from || '…'} ~ ${v.to || '今天'}`;
}

function sameRange(a: DateRangeValue, b: DateRangeValue) {
  return (a.from ?? '') === (b.from ?? '') && (a.to ?? '') === (b.to ?? '');
}

/**
 * 单控件日期范围选择：
 * 一个入口点开面板，预设一键生效；自定义起止在面板内改完点「应用」。
 * 用于顶栏全局区间、同步窗口等所有时间范围场景。
 */
export function DateRange({
  value,
  onChange,
  allowAll = true,
  align = 'left',
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  allowAll?: boolean;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRangeValue>(value);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openPanel = () => {
    setDraft(value);
    setOpen(true);
  };

  const commit = (v: DateRangeValue) => {
    onChange(v);
    setOpen(false);
  };

  const activePreset = PRESETS.find((p) => sameRange(p.get(), value))?.key;
  const isCustom = !activePreset && Boolean(value.from || value.to);

  return (
    <div className="drange" ref={wrap}>
      <button
        className={`drange-btn ${open ? 'open' : ''} ${isCustom ? 'custom' : ''}`}
        onClick={() => (open ? setOpen(false) : openPanel())}
        title="选择时间范围"
      >
        <span className={`drange-dot ${value.from || value.to ? 'on' : ''}`} />
        {labelOf(value)}
        <span className="drange-arrow">▾</span>
      </button>

      {open && (
        <div className={`drange-panel ${align === 'right' ? 'right' : ''}`}>
          <div className="drange-presets">
            {(allowAll ? PRESETS : PRESETS.filter((p) => p.key !== 'all')).map((p) => {
              const v = p.get();
              const active = sameRange(v, draft);
              return (
                <div
                  key={p.key}
                  className={`drange-preset ${active ? 'active' : ''}`}
                  onClick={() => commit(v)}
                >
                  {p.label}
                </div>
              );
            })}
          </div>

          <div className="drange-dates">
            <input
              className="input"
              type="date"
              value={draft.from ?? ''}
              max={draft.to || undefined}
              onChange={(e) => setDraft({ ...draft, from: e.target.value || undefined })}
            />
            <span className="drange-sep">~</span>
            <input
              className="input"
              type="date"
              value={draft.to ?? ''}
              min={draft.from || undefined}
              onChange={(e) => setDraft({ ...draft, to: e.target.value || undefined })}
            />
          </div>

          <div className="drange-foot">
            {allowAll && (
              <button
                className="btn ghost"
                onClick={() => commit({})}
                disabled={!value.from && !value.to}
              >
                清除
              </button>
            )}
            <div className="spacer" />
            <button className="btn primary" onClick={() => commit(draft)}>
              应用
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
