import { useState } from 'react';
import { api, type Strategy } from '../lib/api';
import { Modal, Field } from '../components/Modal';

const SAMPLE = `交易对,方向,开仓时间,平仓时间,开仓价,平仓价,数量,保证金,止损价,手续费,资金费率,策略,行情,形态
BTCUSDT,多,2026-11-01T10:12:00,2026-11-01T11:05:00,62100,62650,0.0013,10,61800,0.0965,0,突破回踩,TREND_UP,箱体上沿突破回踩
ETHUSDT,空,2026-11-01T14:20:00,2026-11-01T15:10:00,2480,2452,0.032,10,2494,0.0946,-0.0012,均线顺势,TREND_DOWN,反弹承压`;

export function CsvImportModal({
  strategies,
  onClose,
  onImported,
}: {
  strategies: Strategy[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [defaultStrategyId, setDefaultStrategyId] = useState('');
  const [preview, setPreview] = useState<{ total: number; headers: string[]; sample: Record<string, string>[] } | null>(null);
  const [result, setResult] = useState<{ imported: number; failed: number; errors: { line: number; message: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doPreview = async () => {
    setError(null);
    try {
      setPreview(await api.previewCsv(csv));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const doImport = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api.importCsv(csv, defaultStrategyId || undefined);
      setResult(r);
      if (r.imported > 0) onImported();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="CSV 批量导入"
      wide
      onClose={onClose}
      footer={
        <>
          {error && <span style={{ color: 'var(--danger)', fontSize: 11.5 }}>{error}</span>}
          <div className="spacer" />
          <button className="btn" onClick={doPreview} disabled={!csv.trim()}>
            预览
          </button>
          <button className="btn primary" onClick={doImport} disabled={!csv.trim() || busy}>
            {busy ? '导入中…' : '开始导入'}
          </button>
        </>
      }
    >
      <div className="steps">
        <div>
          <span className="n">1</span>表头支持中英文（交易对 / symbol、开仓价 / entryPrice、止损价 / stopLoss 等均可识别）
        </div>
        <div>
          <span className="n">2</span>必填列：交易对、方向、开仓时间、开仓价、数量；其余可留空
        </div>
        <div>
          <span className="n">3</span>方向可写 多/空、LONG/SHORT、buy/sell
        </div>
      </div>

      <Field label="CSV 内容" hint="直接从 Excel 复制粘贴即可，首行必须是表头">
        <textarea
          className="input"
          rows={10}
          style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={SAMPLE}
        />
      </Field>

      <div className="form-row">
        <Field label="默认策略" hint="CSV 中没有策略列时使用">
          <select className="select" value={defaultStrategyId} onChange={(e) => setDefaultStrategyId(e.target.value)}>
            <option value="">不指定</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="操作">
          <button className="btn" onClick={() => setCsv(SAMPLE)}>
            填入示例
          </button>
        </Field>
      </div>

      {preview && (
        <div>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
            识别到 {preview.total} 行，字段：{preview.headers.join('、')}
          </div>
          <div className="log-box">
            {preview.sample.map((row, i) => (
              <div key={i}>{JSON.stringify(row)}</div>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div className={`banner ${result.failed > 0 ? '' : ''}`} style={result.failed === 0 ? { borderColor: 'rgba(53,235,104,.3)', background: 'rgba(53,235,104,.07)', color: '#b6f5c9' } : undefined}>
          <strong>
            导入完成：成功 {result.imported} 条，失败 {result.failed} 条
          </strong>
        </div>
      )}

      {result && result.errors.length > 0 && (
        <div className="log-box">
          {result.errors.map((e, i) => (
            <div key={i} className="error">
              第 {e.line} 行：{e.message}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
