import * as crypto from 'crypto';

/**
 * Bitget v2 私有接口签名。
 *
 * preHash = timestamp + METHOD + requestPath + ('?' + queryString | '') + body
 * sign    = base64( HMAC-SHA256(preHash, secretKey) )
 *
 * 难点不在算法，而在拼接顺序、query 是否带 '?'、body 是否为原始字符串。
 * 因此签名逻辑只允许存在于这一处，任何 service 都不得自己拼。
 */
export function signRequest(params: {
  secret: string;
  timestamp: string;
  method: string;
  requestPath: string;
  queryString?: string;
  body?: string;
}): string {
  const { secret, timestamp, method, requestPath, queryString, body } = params;
  const preHash = timestamp + method.toUpperCase() + requestPath + (queryString ? `?${queryString}` : '') + (body ?? '');
  return crypto.createHmac('sha256', secret).update(preHash).digest('base64');
}

export function buildHeaders(params: {
  apiKey: string;
  passphrase: string;
  sign: string;
  timestamp: string;
}): Record<string, string> {
  return {
    'ACCESS-KEY': params.apiKey,
    'ACCESS-SIGN': params.sign,
    'ACCESS-TIMESTAMP': params.timestamp,
    'ACCESS-PASSPHRASE': params.passphrase,
    'Content-Type': 'application/json',
    locale: 'zh-CN',
  };
}

/** 简单最小间隔限流，避免 429 */
export class RateLimiter {
  private next = 0;

  constructor(private readonly minIntervalMs = 120) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const delay = Math.max(0, this.next - now);
    this.next = Math.max(now, this.next) + this.minIntervalMs;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
}
