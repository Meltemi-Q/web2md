# 已知问题和平台限制

## 平台限制（无法通过代码解决）

### 1. Reddit - 403 Blocked

**问题描述**：
- 错误码：403 Forbidden
- 即使使用 Puppeteer 也无法访问

**根本原因**：
- Reddit 封锁了数据中心 IP 地址
- Vercel 部署的服务器 IP 在封锁列表中
- 需要住宅 IP 或代理服务

**解决方案**：
- ❌ 不可行：直接从 Vercel 访问
- ✅ 可行但成本高：使用付费代理服务（如 ScraperAPI、BrightData）
- ✅ 替代方案：使用 Reddit API（需要申请密钥）

---

### 2. 微信公众号 - CAPTCHA 验证

**问题描述**：
- 页面加载后显示人机验证
- Puppeteer 可以加载页面但无法通过验证

**根本原因**：
- 微信的反爬机制检测到非人类行为
- 需要用户手动完成滑动验证或点击验证

**解决方案**：
- ❌ 不可行：完全自动化绕过
- ⚠️ 部分可行：使用验证码识别服务（准确率不高）
- ✅ 替代方案：用户手动登录后提供 Cookie

---

### 3. 小红书 - 需要登录

**问题描述**：
- 内容页面需要登录才能查看
- 未登录用户只能看到登录提示

**根本原因**：
- 平台策略要求登录
- 防止内容被爬取

**解决方案**：
- ❌ 不可行：无登录状态访问
- ✅ 可行：用户提供登录 Cookie
- ✅ 替代方案：使用官方 API（如果提供）

---

## 技术坑点（已解决）

### 1. TypeScript 配置问题

**问题**：
```
error TS5110: Option 'resolveJsonModule' cannot be specified when 'moduleResolution' is set to 'bundler'.
```

**原因**：
- `moduleResolution: "bundler"` 与 `resolveJsonModule: true` 不兼容
- Vercel 运行时需要 Node.js 兼容的模块解析

**解决方案**：
```json
{
  "compilerOptions": {
    "moduleResolution": "node",  // 改为 node
    "resolveJsonModule": true
  }
}
```

---

### 2. Vercel 路由格式

**问题**：
- 使用 `api/extract/route.ts` 格式无法正常工作
- 404 错误

**原因**：
- Vercel Serverless Functions 需要特定文件命名
- `route.ts` 是 Next.js App Router 约定，不适用于独立 API

**解决方案**：
```
❌ api/extract/route.ts
✅ api/extract.ts
```

---

### 3. 类型定义缺失

**问题**：
- `@types/puppeteer-core` 不存在
- `turndown-plugin-gfm` 没有类型定义

**解决方案**：
```typescript
// puppeteer-core 自带类型定义，无需额外安装
import puppeteer from 'puppeteer-core';

// turndown-plugin-gfm 使用 @ts-ignore
// @ts-ignore
import turndownPluginGfm from 'turndown-plugin-gfm';
```

---

### 4. Vercel 环境检测不可靠

**问题**：
```typescript
// ❌ 不可靠
if (process.env.VERCEL_ENV === 'production')

// ❌ 本地开发也可能有这个变量
if (process.env.VERCEL_ENV)
```

**原因**：
- `VERCEL_ENV` 在预览部署时是 `"preview"`
- 本地开发时可能被设置但不是真正的 Vercel 环境

**解决方案**：
```typescript
// ✅ 可靠的检测方法
const isVercel = process.env.VERCEL === '1';
```

---

## Serverless 限制

### Vercel Free Plan

- **执行时间限制**：10 秒
- **内存限制**：1024 MB
- **冷启动时间**：1-3 秒

### Vercel Pro Plan

- **执行时间限制**：60 秒
- **内存限制**：3008 MB
- **更快的冷启动**：~1 秒

### 影响

- **Puppeteer 冷启动**：首次下载 Chromium 需要 3-5 秒
- **复杂页面**：渲染时间可能超过 Free Plan 限制
- **建议**：对于生产环境，推荐使用 Pro Plan

---

## 浏览器兼容性

### Puppeteer 在 Vercel 上的注意事项

1. **必须使用 `puppeteer-core`**（轻量版）
2. **必须使用 `@sparticuz/chromium-min`**（Serverless 优化）
3. **必须设置 `--no-sandbox`**（权限限制）
4. **从 CDN 加载 Chromium**：
   ```typescript
   executablePath: await chromium.executablePath()
   ```

### 本地开发

- 使用完整的 `puppeteer` 包
- 自动下载完整 Chromium
- 无沙箱限制
