# 交易复盘工作台（Trading Review）

本地优先的短线合约交易复盘系统。监控 Bitget USDT 永续，核心是把**交易结果**和**执行质量**分开评价。

数据全部留在本地 SQLite，不上云，不需要登录。

---

## 目录

```
trading-review/
├── apps/
│   ├── api/                     NestJS + Fastify + Prisma + SQLite
│   │   ├── prisma/schema.prisma 数据模型（金额一律 String + decimal.js）
│   │   ├── prisma/seed.ts       26 笔演示数据（10 USDT 本金）
│   │   └── src/
│   │       ├── common/          金额运算入口、常量、诊断阈值
│   │       ├── bitget/          只读客户端：签名、限频、字段容错映射、Mock 数据
│   │       ├── sync/            同步编排：订单/成交/流水 + 去重 + 日志
│   │       ├── matching/        配对引擎：成交 → 复合交易（加仓/部分平仓/反手）
│   │       ├── secrets/         本地密钥 AES-256-GCM 加密
│   │       ├── trades/          交易 CRUD、派生字段计算、复盘保存
│   │       ├── analytics/       统计口径（唯一实现处）
│   │       ├── catalog/         策略 / 标签
│   │       └── import/          CSV 导入
│   └── web/                     React + Vite + TypeScript
│       └── src/
│           ├── pages/           概览 / 交易 / 单笔复盘 / 策略 / 标签 / 诊断 / 设置
│           ├── components/      弹窗、录入表单、CSV 导入
│           ├── charts.tsx       纯 SVG 图表，无图表库依赖
│           └── lib/             API 客户端、格式化
├── docs/
│   ├── 01-数据模型与计算口径.md    ← 怎么算，以此为准
│   ├── 02-产品需求文档-PRD.md      ← 给谁用、做成什么样
│   └── 03-Bitget密钥接入指南.md    ← 小白操作手册，10 分钟接通
└── data/                        SQLite 与导出
```

---

## 启动

```bash
pnpm install

# 首次：初始化数据库并灌入演示数据
pnpm --filter api prisma:push
pnpm --filter api prisma:seed

# 开发（同时起前后端）
pnpm dev
```

- 前端 http://localhost:5173
- 后端 http://127.0.0.1:3000/api/health

单独启动：

```bash
pnpm dev:api    # tsc 编译后 node --watch
pnpm dev:web    # vite
```

> 后端没有用 Nest CLI，直接 `tsc` 编译到 `dist/`，`node --watch` 运行。
> 改动后端代码需要重新执行 `pnpm dev:api`（会先编译）。

---

## 已实现的接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/trades` | 列表，支持 from/to/symbol/direction/strategyId/tagId/result/reviewStatus/q/sort/page |
| GET | `/api/trades/:id` | 详情（含标签、复盘、成交） |
| POST/PATCH/DELETE | `/api/trades` `/api/trades/:id` | 手动录入与修改（自动重算派生字段） |
| PUT | `/api/trades/:id/review` | 保存复盘 |
| GET | `/api/analytics/overview` | 概览（净收益、胜率、盈亏比、期望值、回撤、手续费占比、数据质量） |
| GET | `/api/analytics/equity-curve` | 权益曲线（基于 tradingEquity） |
| GET | `/api/analytics/strategies` | 策略对比 + verdict |
| GET | `/api/analytics/tags` | 标签归因 |
| GET | `/api/analytics/risk` | 连亏、仓位放大、每日盈亏、集中度 |
| GET | `/api/analytics/diagnostics` | 规则式诊断 R1–R6 |
| GET | `/api/strategies` `/api/tags` | 策略与标签维护 |
| POST | `/api/import/csv` | CSV 导入（支持中英文表头） |
| GET/PUT/DELETE | `/api/sync/config` | API 密钥配置（密钥加密存本地） |
| POST | `/api/sync/test` | 连通性测试 + 持仓模式探测（可直接传未保存的密钥） |
| GET | `/api/sync/netcheck` | 网络自检：DNS + HTTPS，用来区分网络问题与密钥问题 |
| POST | `/api/sync/run` | 执行同步（成交/订单/流水 → 配对） |
| GET | `/api/sync/jobs` `/api/sync/jobs/:id` | 同步历史与逐行日志 |
| POST | `/api/sync/reset` | 清空同步数据（保留人工录入） |
| POST | `/api/sync/purge-all` | 清空全部交易数据（含人工录入，保留账户/策略/标签） |
| GET/POST | `/api/accounts/:id/derive-baseline` | 按「当前权益 − 累计净收益」反推期初资金 |

所有统计接口共用同一套筛选参数。

---

## 密钥来源

三种来源，优先级从高到低：

1. **页面保存**：加密存于 `data/secrets/<accountId>.enc`（AES-256-GCM，密钥文件 `data/.secret.key`）
2. **`apps/api/.env` 预置**：`BITGET_API_KEY` / `BITGET_SECRET_KEY` / `BITGET_PASSPHRASE`，改完需重启
3. **都没有**：Mock 模式，同步只写演示数据，不发外网请求

页面上的「清除密钥」只删本地文件，会自动回落到 .env。

## 数据同步

在「设置」页操作，两种模式：

| 模式 | 触发条件 | 行为 |
|---|---|---|
| **Mock** | 未配置 API 密钥 | 写入内置演示成交（含加仓、部分平仓、反手、资金费率、划转、未平仓），不发外网请求 |
| **LIVE** | 配置了 Key/Secret/Passphrase | 只读调用 Bitget，签名 HMAC-SHA256；自动识别经典账户（v2）与统一账户（v3） |

同步流程：

```
探测持仓模式 → 拉成交 → 拉订单 → 拉资金流水
  → 去重入库（原始响应全部留存）
  → 成交配对成交易（加仓 / 部分平仓 / 反手）
  → 资金费率按持仓区间归集
  → 写同步日志
```

三条硬规则：

1. **双向持仓直接中止**，不做猜测性配对。
2. **密钥不落库明文**：AES-256-GCM 加密存 `data/secrets/`，密钥文件 `data/.secret.key` 与数据库分离。
3. **重算不冲掉人工成果**：重建自动交易时按「交易对 + 开仓时间」恢复原复盘与标签。

```bash
# 用内置 Mock 数据完整试跑一遍（不需要任何密钥）
# 打开设置页 → 立即同步；或在命令行：
curl -X POST http://127.0.0.1:3000/api/sync/run -H 'Content-Type: application/json' -d '{"from":"2026-10-01","to":"2026-11-04"}'
```

---

## 三条不能违反的规则

1. **金额不用 number。** 价格/数量/金额在库里是 `String`，运算只走 `decimal.js`，前端只做展示。
2. **缺数据就标估算。** `netPnlEstimated = true` 的交易在 UI 上有 `≈` 标记，且不进入诊断结论。
3. **不可计算就留空。** R 倍数依赖开仓止损价，没有就是 `null`，不用 0 或最大亏损顶替。

---

## 本期不做（见文档第六节）

K 线重建、MFE/MAE、滑点、WebSocket 实时、爆仓预测、AI 判情绪、非 USDT 手续费折算、移动端、多用户。
