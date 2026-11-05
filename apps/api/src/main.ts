import './load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // bodyParser: false —— 由下面自己接管 JSON 解析。
  // 原因：Fastify 默认在 content-type=application/json 但 body 为空时直接返回 400
  // （FST_ERR_CTP_EMPTY_JSON_BODY）。本服务有多个"没有入参"的 POST 接口
  // （/sync/test、/sync/reset），客户端习惯性带上 Content-Type 就会被拦。
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), {
    bodyParser: false,
  });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (!raw) return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch (e) {
      done(e as Error, undefined);
    }
  });
  // 表单编码同理，避免无 body 的 POST 被误判
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (!raw) return done(null, {});
    done(null, Object.fromEntries(new URLSearchParams(raw)));
  });

  app.setGlobalPrefix('api');
  app.enableCors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '127.0.0.1');
  Logger.log(`API 已启动：http://127.0.0.1:${port}/api/health`, 'Bootstrap');
}

bootstrap();
