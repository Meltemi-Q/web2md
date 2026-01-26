# 开发记录

## 2026-01-25: 兼容性增强（CLI + API）

### CLI（Python）

- 使用 `readability-lxml` 优先提取正文，失败再用选择器兜底
- 增加 AMP (`rel="amphtml"`) 兜底策略
- 支持从 JSON-LD(schema.org) 提取标题/作者/时间（提升元数据命中率）
- 图片处理改为“仅下载正文图片”，并统一懒加载/相对链接为绝对链接
- 可选 Playwright 作为 JS 渲染兜底（`pip install -e ".[browser]"` + `playwright install`）

### API（Node.js / Vercel）

- `fetch()` 失败/挑战页/正文过短时自动降级到浏览器渲染（覆盖更多未知站点）
- 浏览器抓取优化：拦截图片/字体/样式等资源，降低冷启动耗时与内存
- 正文 HTML 统一：相对链接/懒加载图片归一化为绝对链接，提升 Markdown 可用性
- Turndown：代码块尽量保留语言标记（```lang）

## 2026-01-17: 混合 Fetch 方案实现

### 功能更新

实现了混合抓取策略，优化性能和兼容性：

- **默认方案**：使用轻量级 `fetch()` API 快速获取页面内容
- **降级方案**：针对需要 JavaScript 渲染或有反爬机制的网站，使用 Puppeteer 无头浏览器
- **智能切换**：自动检测特定域名（微信公众号等），选择合适的抓取方案

### 技术实现

1. **Fetch 优先策略**
   - 速度快（~200ms）
   - 内存占用低
   - 适用于大多数静态网站

2. **Puppeteer 降级**
   - 针对特定域名列表（`mp.weixin.qq.com` 等）
   - 绕过基础反爬机制
   - 处理 JavaScript 动态渲染内容

3. **环境适配**
   - 生产环境：使用 `@sparticuz/chromium-min`（Serverless 优化）
   - 本地开发：使用完整 `puppeteer` 浏览器

### 测试结果

#### ✅ 成功提取的网站

| 网站 | 方法 | 状态 |
|------|------|------|
| docs.bigmodel.cn | fetch | ✅ |
| news.ycombinator.com | fetch | ✅ |
| github.com | fetch | ✅ |

#### ❌ 失败的网站（平台限制）

| 网站 | 问题 | 原因 |
|------|------|------|
| Reddit | 403 Forbidden | 封锁数据中心 IP |
| 微信公众号 | 需要验证 | CAPTCHA 人机验证 |
| 小红书 | 需要登录 | 需要账号登录 |

### 部署信息

- **GitHub Repo**: main 分支
- **Vercel 部署**: `https://api-psi-ruby-39.vercel.app`
- **API 端点**: `/api/extract?url=<URL>`
- **最新提交**: `e039de6` - Fix Vercel env detection and add Reddit to browser list

### 性能指标

- **Fetch 模式**：响应时间 200-500ms
- **Puppeteer 模式**：
  - 冷启动：3-5 秒
  - 热启动：1-2 秒
  - 内存使用：250-400 MB

---

## 历史版本

### 初始版本
- 基础 Readability 内容提取
- 简单的 fetch 实现
- Markdown 转换功能
