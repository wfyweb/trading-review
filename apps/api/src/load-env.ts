/**
 * 必须作为 main.ts 的第一个 import：
 * 后续模块（如 bitget/client.ts）在模块加载阶段就会读 process.env，
 * 所以环境变量必须在这之前注入，否则读到的永远是 undefined。
 *
 * 为什么不用 process.loadEnvFile：
 * 它的语义是"已有变量不覆盖"，而机器上可能已经有 HTTPS_PROXY（系统级代理、
 * 终端导出的变量、IDE 注入等），会导致 .env 里的配置静默失效。
 * 这里改成手动解析并强制覆盖，保证 .env 是唯一事实来源。
 */
import * as fs from 'fs';
import * as path from 'path';

const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
];

const file = candidates.find((f) => fs.existsSync(f));

if (file) {
  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}
