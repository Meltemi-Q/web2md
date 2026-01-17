# Web to Markdown - 项目规范

## 语言偏好

**所有回复必须使用中文**，包括：
- 解释和说明
- 进度汇报
- 错误提示
- 总结输出

代码和命令保持英文。

## 项目概述

网页内容抓取工具，将网页文章转换为 Markdown 格式。

**当前部署**：
- **API 地址**：`https://api-psi-ruby-39.vercel.app/api/extract?url=<URL>`
- **GitHub**：main 分支

## 目录结构

```
downweb/
├── api/                      # Vercel API（Node.js）
│   ├── extract.ts            # 单个 URL 端点
│   ├── batch.ts              # 批量处理端点
│   └── lib/
│       └── extractor.ts      # 内容提取逻辑
├── package.json
├── tsconfig.json
├── vercel.json
├── docs/                     # 详细文档
│   ├── CHANGELOG.md          # 开发记录
│   ├── KNOWN_ISSUES.md       # 已知问题
│   └── DECISIONS.md          # 技术决策
└── CLAUDE.md                 # 本文件
```

## API 使用

### 单个 URL 提取

```bash
# GET 请求
curl "https://api-psi-ruby-39.vercel.app/api/extract?url=https://news.ycombinator.com"

# POST 请求
curl -X POST https://api-psi-ruby-39.vercel.app/api/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://docs.bigmodel.cn"}'
```

### 批量处理

```bash
curl -X POST https://api-psi-ruby-39.vercel.app/api/batch \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://news.ycombinator.com",
      "https://docs.bigmodel.cn"
    ]
  }'
```

**限制**：最多 20 个 URL

## 核心功能

1. **智能内容提取** - 使用 Mozilla Readability 识别文章正文
2. **保留结构** - 标题层级（H1-H6）、列表、链接
3. **混合抓取策略**：
   - 默认使用轻量级 `fetch()`（快速）
   - 特定网站使用 Puppeteer（绕过基础反爬）
4. **提取元数据** - 标题、作者、发布时间

## 技术栈

| 依赖 | 用途 |
|------|------|
| `@mozilla/readability` | 内容提取 |
| `jsdom` | DOM 解析 |
| `turndown` | HTML → Markdown |
| `puppeteer-core` | 无头浏览器（按需） |
| `@sparticuz/chromium-min` | Serverless 优化 Chromium |

## 开发原则

### MVP 优先，按需扩展

- ✅ MVP 优先：先实现最小可用版本
- ✅ 按需扩展：验证可行后再增加功能
- ✅ 避免过度设计

### 混合抓取策略

```typescript
// 特定域名使用浏览器
const BROWSER_REQUIRED_DOMAINS = [
  'mp.weixin.qq.com',  // 微信公众号
];

// 其他网站使用 fetch
if (needsBrowser(url)) {
  return fetchWithPuppeteer(url);
} else {
  return fetchWithFetch(url);
}
```

### 开发流程（前后端分离）

1. **后端开发** → 独立测试 API 功能
2. **前端开发** → 独立设计和测试 UI
3. **整合测试** → 前后端联调
4. **部署上线** → 提交 GitHub → Vercel 部署

## 配置说明

### TypeScript 配置

```json
{
  "compilerOptions": {
    "moduleResolution": "node",  // 必须用 node，不能用 bundler
    "resolveJsonModule": true
  }
}
```

### Vercel 配置

```json
{
  "functions": {
    "api/**/*.ts": {
      "maxDuration": 60  // Pro 版本才有 60 秒
    }
  }
}
```

## 错误处理

| 场景 | HTTP 状态码 | 响应 |
|------|-------------|------|
| 成功 | 200 | `{ markdown, metadata }` |
| 无效 URL | 400 | `{ error, details }` |
| 提取失败 | 500 | `{ error, url }` |
| 超时 | 504 | Gateway Timeout |

## 已知限制

详见 [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)

**无法抓取的网站**（平台级限制）：
- Reddit（封锁数据中心 IP）
- 微信公众号（CAPTCHA 验证）
- 小红书（需要登录）

## 性能指标

- **Fetch 模式**：200-500ms
- **Puppeteer 模式**：
  - 冷启动：3-5 秒
  - 热启动：1-2 秒
- **内存使用**：250-400 MB（Puppeteer）

## 相关文档

- [开发记录](docs/CHANGELOG.md) - 版本历史和测试结果
- [已知问题](docs/KNOWN_ISSUES.md) - 平台限制和技术坑点
- [技术决策](docs/DECISIONS.md) - 架构选择和用户偏好

## 快速测试

```bash
# 测试 API
curl "https://api-psi-ruby-39.vercel.app/api/extract?url=https://news.ycombinator.com"

# 本地开发
npm install
npm run dev
# 访问 http://localhost:3000/api/extract?url=https://docs.bigmodel.cn
```
