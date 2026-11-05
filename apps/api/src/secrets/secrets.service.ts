import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../../../data');
const SECRET_DIR = path.join(DATA_DIR, 'secrets');
const KEY_FILE = path.join(DATA_DIR, '.secret.key');

export interface Credentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export type CredSource = 'LOCAL' | 'ENV' | 'NONE';

export interface ResolvedCredentials {
  creds: Credentials | null;
  source: CredSource;
  /** 说明当前用的是哪一份，用于界面提示 */
  note: string;
}

/**
 * 本地密钥存储。
 * 密钥文件与数据库分开存放，数据库被拷走也无法解出 secret。
 * 局限：不防本机管理员，仅防"文件被单独拷走"。密钥环方案列入后期。
 */
@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);

  private ensureKey(): Buffer {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(KEY_FILE)) {
      const key = crypto.randomBytes(32);
      fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
      this.logger.log('已生成本地加密密钥 data/.secret.key');
    }
    return fs.readFileSync(KEY_FILE);
  }

  private fileFor(accountId: string) {
    fs.mkdirSync(SECRET_DIR, { recursive: true });
    return path.join(SECRET_DIR, `${accountId}.enc`);
  }

  save(accountId: string, creds: Credentials): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.ensureKey(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(creds), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, tag, data]).toString('base64');
    fs.writeFileSync(this.fileFor(accountId), payload, { mode: 0o600 });
    return `local-file:${accountId}`;
  }

  load(accountId: string): Credentials | null {
    const file = this.fileFor(accountId);
    if (!fs.existsSync(file)) return null;
    try {
      const buf = Buffer.from(fs.readFileSync(file, 'utf8'), 'base64');
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const data = buf.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.ensureKey(), iv);
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
    } catch (e: any) {
      this.logger.error(`密钥解密失败：${e.message}`);
      return null;
    }
  }

  remove(accountId: string) {
    const file = this.fileFor(accountId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  /** 从 .env 读取预置密钥（三个都填了才算有效） */
  loadFromEnv(): Credentials | null {
    const apiKey = (process.env.BITGET_API_KEY || process.env.BITGET_APIKEY || '').trim();
    const secret = (process.env.BITGET_SECRET_KEY || process.env.BITGET_SECRET || '').trim();
    const passphrase = (process.env.BITGET_PASSPHRASE || process.env.BITGET_PASS_PHRASE || '').trim();
    if (!apiKey || !secret || !passphrase) return null;
    return { apiKey, secret, passphrase };
  }

  /**
   * 解析当前生效的密钥。
   * 优先级：页面保存的本地加密文件 > .env 预置。
   * 页面保存后立刻生效，避免"改了页面却没反应"；清除后自动回落到 .env。
   */
  resolve(accountId: string): ResolvedCredentials {
    const local = this.load(accountId);
    if (local) {
      return { creds: local, source: 'LOCAL', note: '使用页面保存的密钥（已加密存于本机）' };
    }
    const env = this.loadFromEnv();
    if (env) {
      return { creds: env, source: 'ENV', note: '使用 apps/api/.env 中的预置密钥' };
    }
    return { creds: null, source: 'NONE', note: '尚未配置密钥' };
  }

  mask(apiKey?: string | null): string {
    if (!apiKey) return '';
    if (apiKey.length <= 8) return '****';
    return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
  }
}
