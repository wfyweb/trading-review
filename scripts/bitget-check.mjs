#!/usr/bin/env node
/**
 * Bitget 只读连通性自检脚本（零依赖，不经过本系统）
 *
 * 用途：联调时先确认"密钥本身是否可用"，再怀疑系统代码。
 *
 * 用法：
 *   BITGET_KEY=xxx BITGET_SECRET=xxx BITGET_PASSPHRASE=xxx node scripts/bitget-check.mjs
 *   BITGET_KEY=xxx BITGET_SECRET=xxx BITGET_PASSPHRASE=xxx node scripts/bitget-check.mjs --fills 7
 *
 * 输出：每一步的 HTTP 状态、业务码、原始响应前 800 字符。
 */

import crypto from 'node:crypto';

const KEY = process.env.BITGET_KEY;
const SECRET = process.env.BITGET_SECRET;
const PASSPHRASE = process.env.BITGET_PASSPHRASE;
const BASE = process.env.BITGET_BASE_URL || 'https://api.bitget.com';
const PRODUCT = 'USDT-FUTURES';

if (!KEY || !SECRET || !PASSPHRASE) {
  console.error('缺少环境变量：需要 BITGET_KEY / BITGET_SECRET / BITGET_PASSPHRASE');
  process.exit(1);
}

const argv = process.argv.slice(2);
const fillsIdx = argv.indexOf('--fills');
const fillsDays = fillsIdx >= 0 ? Number(argv[fillsIdx + 1] || 7) : 0;

function sign(timestamp, method, path, queryString, body) {
  const preHash = timestamp + method.toUpperCase() + path + (queryString ? `?${queryString}` : '') + (body || '');
  return crypto.createHmac('sha256', SECRET).update(preHash).digest('base64');
}

const seen = [];

async function call(path, params = {}) {
  const timestamp = Date.now().toString();
  const queryString = new URLSearchParams(params).toString();
  const s = sign(timestamp, 'GET', path, queryString, '');
  const url = `${BASE}${path}${queryString ? `?${queryString}` : ''}`;

  seen.push({ preHash: timestamp + 'GET' + path + (queryString ? `?${queryString}` : ''), sign: s });

  const res = await fetch(url, {
    headers: {
      'ACCESS-KEY': KEY,
      'ACCESS-SIGN': s,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': PASSPHRASE,
      'Content-Type': 'application/json',
      locale: 'zh-CN',
    },
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function report(title, r) {
  console.log(`\n=== ${title} ===`);
  console.log(`HTTP ${r.status}`);
  if (r.json) {
    console.log(`code ${r.json.code ?? '-'}  msg ${r.json.msg ?? '-'}`);
    console.log(`data ${JSON.stringify(r.json.data).slice(0, 800)}`);
  } else {
    console.log(r.text.slice(0, 800));
  }
  return r;
}

console.log('Bitget 只读连通性自检');
console.log(`base=${BASE}  key=${KEY.slice(0, 4)}****${KEY.slice(-4)}`);

try {
  const account = report('1. 账户信息 /api/v2/mix/account/accounts', await call('/api/v2/mix/account/accounts', { productType: PRODUCT }));

  if (account.json?.code === '00000') {
    const list = Array.isArray(account.json.data) ? account.json.data : [account.json.data].filter(Boolean);
    const usdt = list.find((a) => a?.marginCoin === 'USDT') || list[0] || {};
    console.log(`\n→ 持仓模式 posMode = ${usdt.posMode ?? '未返回'}`);
    console.log(`→ 账户权益 accountEquity = ${usdt.accountEquity ?? '未返回'}`);
    if (String(usdt.posMode).includes('hedge')) {
      console.log('⚠ 该账户为双向持仓，第一版不支持自动配对');
    }
  }

  if (fillsDays > 0) {
    const end = Date.now();
    const start = end - fillsDays * 86400_000;
    const fills = report(`2. 成交 /api/v2/mix/order/fills（近 ${fillsDays} 天）`, 
      await call('/api/v2/mix/order/fills', {
        productType: PRODUCT,
        startTime: String(start),
        endTime: String(end),
        limit: '100',
      }));

    if (fills.json?.code === '00000') {
      const list = fills.json.data?.fillList ?? (Array.isArray(fills.json.data) ? fills.json.data : []);
      console.log(`\n→ 返回 ${list.length} 条成交`);
      if (list[0]) {
        console.log('→ 首条原始字段名：');
        console.log('  ' + Object.keys(list[0]).join(', '));
        console.log('→ 首条内容：');
        console.log('  ' + JSON.stringify(list[0]).slice(0, 600));
        console.log('\n请核对以下字段是否与系统映射一致：');
        console.log('  tradeId / symbol / side / price / baseVolume / feeDetail / profit|execPnl / cTime');
      }
    }

    const bills = report(`3. 资金流水 /api/v2/mix/account/bill（近 ${fillsDays} 天）`,
      await call('/api/v2/mix/account/bill', {
        productType: PRODUCT,
        startTime: String(start),
        endTime: String(end),
        limit: '100',
      }));
    if (bills.json?.code === '00000') {
      const list = bills.json.data?.bills ?? (Array.isArray(bills.json.data) ? bills.json.data : []);
      console.log(`\n→ 返回 ${list.length} 条流水`);
      if (list[0]) console.log('→ 首条字段名：' + Object.keys(list[0]).join(', '));
    }
  }

  console.log('\n=== 签名原文（排查签名问题时对照官方文档）===');
  seen.forEach((s, i) => {
    console.log(`--${i + 1}--`);
    console.log(s.preHash);
  });
  console.log('\n如果这里 code 是 00000，说明密钥与签名都正确，问题只可能在本系统。');
} catch (e) {
  console.error('\n请求异常：', e.message);
  console.error('排查顺序：网络/DNS → 时间戳偏差 → IP 白名单 → 密钥是否正确');
  process.exit(1);
}
