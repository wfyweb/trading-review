import { useState } from 'react';
import { api, type Strategy } from '../lib/api';
import { Modal, Field } from '../components/Modal';
import { REGIME_LABEL } from '../lib/format';

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY = {
  symbol: '',
  direction: 'LONG',
  entryTime: nowLocal(),
  exitTime: '',
  entryPrice: '',
  exitPrice: '',
  quantity: '',
  margin: '',
  initialStopPrice: '',
  tradingFee: '',
  fundingFee: '0',
  strategyId: '',
  marketRegime: '',
  setupType: '',
  note: '',
};

export function TradeFormModal({
  strategies,
  onClose,
  onSaved,
}: {
  strategies: Strategy[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    setError(null);
    if (!form.symbol || !form.entryPrice || !form.quantity) {
      setError('交易对、开仓价、数量为必填项');
      return;
    }
    setSaving(true);
    try {
      const created = await api.createTrade({
        symbol: form.symbol.toUpperCase(),
        direction: form.direction,
        entryTime: form.entryTime,
        exitTime: form.exitTime || undefined,
        entryPrice: form.entryPrice,
        exitPrice: form.exitPrice || undefined,
        quantity: form.quantity,
        margin: form.margin || undefined,
        initialStopPrice: form.initialStopPrice || undefined,
        tradingFee: form.tradingFee === '' ? undefined : form.tradingFee,
        fundingFee: form.fundingFee === '' ? undefined : form.fundingFee,
        strategyId: form.strategyId || undefined,
        marketRegime: form.marketRegime || undefined,
        setupType: form.setupType || undefined,
        note: form.note || undefined,
      });
      onSaved(created.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="手动录入交易"
      onClose={onClose}
      footer={
        <>
          {error && <span style={{ color: 'var(--danger)', fontSize: 11.5 }}>{error}</span>}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <div className="form-row g3">
        <Field label="交易对 *">
          <input className="input" placeholder="BTCUSDT" value={form.symbol} onChange={(e) => set('symbol', e.target.value)} />
        </Field>
        <Field label="方向 *">
          <select className="select" value={form.direction} onChange={(e) => set('direction', e.target.value)}>
            <option value="LONG">做多</option>
            <option value="SHORT">做空</option>
          </select>
        </Field>
        <Field label="数量 *" hint="币本位数量，如 0.0013">
          <input className="input" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </Field>
      </div>

      <div className="form-row g3">
        <Field label="开仓价 *">
          <input className="input" value={form.entryPrice} onChange={(e) => set('entryPrice', e.target.value)} />
        </Field>
        <Field label="平仓价" hint="留空表示仍在持仓">
          <input className="input" value={form.exitPrice} onChange={(e) => set('exitPrice', e.target.value)} />
        </Field>
        <Field label="保证金" hint="用于计算实际杠杆">
          <input className="input" value={form.margin} onChange={(e) => set('margin', e.target.value)} />
        </Field>
      </div>

      <div className="form-row">
        <Field label="开仓时间 *">
          <input className="input" type="datetime-local" value={form.entryTime} onChange={(e) => set('entryTime', e.target.value)} />
        </Field>
        <Field label="平仓时间">
          <input className="input" type="datetime-local" value={form.exitTime} onChange={(e) => set('exitTime', e.target.value)} />
        </Field>
      </div>

      <div className="form-row g3">
        <Field label="开仓止损价" hint="填了才有 R 倍数；不填则 R 不可计算">
          <input className="input" value={form.initialStopPrice} onChange={(e) => set('initialStopPrice', e.target.value)} />
        </Field>
        <Field label="手续费 (USDT)" hint="留空 → 净收益标记为估算值">
          <input className="input" placeholder="0.096" value={form.tradingFee} onChange={(e) => set('tradingFee', e.target.value)} />
        </Field>
        <Field label="资金费率" hint="收入为正，支出为负">
          <input className="input" value={form.fundingFee} onChange={(e) => set('fundingFee', e.target.value)} />
        </Field>
      </div>

      <div className="form-row g3">
        <Field label="策略">
          <select className="select" value={form.strategyId} onChange={(e) => set('strategyId', e.target.value)}>
            <option value="">未归类</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="行情环境">
          <select className="select" value={form.marketRegime} onChange={(e) => set('marketRegime', e.target.value)}>
            <option value="">未记录</option>
            {Object.entries(REGIME_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="形态">
          <input className="input" placeholder="箱体突破回踩" value={form.setupType} onChange={(e) => set('setupType', e.target.value)} />
        </Field>
      </div>

      <Field label="入场理由（会写入复盘记录）">
        <textarea className="input" rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} />
      </Field>

      <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
        保存后毛收益、净收益、R 倍数、持仓时长由服务端统一计算，前端不参与任何金额运算。
      </div>
    </Modal>
  );
}
