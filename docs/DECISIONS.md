# 技术决策和用户偏好

## 核心开发原则

### 1. MVP 优先，按需扩展

**用户偏好**：
> "先做 MVP（最小可用版本），验证可行后再扩展功能。"

**应用场景**：
- ✅ 先用 fetch 实现 MVP
- ✅ 验证核心流程后，按需引入 Puppeteer
- ✅ 避免过度设计，按需添加功能

---

### 2. 混合方案：智能降级

**技术决策**：
- **默认**：使用轻量级 `fetch()` API
- **降级**：针对特定域名使用 Puppeteer
- **原因**：平衡性能和兼容性

**实现方式**：
```typescript
const BROWSER_REQUIRED_DOMAINS = [
  'mp.weixin.qq.com',  // 微信公众号
  'www.reddit.com',     // Reddit（虽然仍会失败）
];

// 根据域名选择抓取方法
if (needsBrowser(url)) {
  return fetchWithPuppeteer(url);
} else {
  return fetchWithFetch(url);
}
```

---

### 3. 测试优先的部署流程

**用户偏好**：
> "先在本地或测试环境验证，再提交到 GitHub，最后部署到 Vercel"

**标准流程**：
1. **本地测试**：使用 `npm run dev` 验证功能
2. **提交 GitHub**：确保代码可追溯
3. **部署 Vercel**：通过 Git 集成自动部署
4. **验证 API**：测试生产环境端点

**避免**：
- ❌ 直接在生产环境调试
- ❌ 未经测试就部署
- ❌ 跳过版本控制

---

### 4. Git 推送策略

**用户偏好**：
> "推送代码时不需要询问，直接推送"

**实施规则**：
- ✅ 提交后自动推送到远程仓库
- ✅ 无需确认，直接执行 `git push`
- ✅ 节省交互时间，提高效率

**流程**：
```bash
git add .
git commit -m "..."
git push  # 直接推送，不询问
```

---

### 5. 前后端分离开发

**用户偏好**：
> "先把后端测试好，前端也单独设计好，完了再一起测试。"

**开发流程**：
1. **后端开发**：
   - 独立实现 API 端点
   - 用 curl 或 Postman 测试
   - 确保返回格式正确

2. **前端开发**：
   - 独立设计 UI/UX
   - 使用 Mock 数据测试
   - 确保交互流畅

3. **整合测试**：
   - 前后端联调
   - 测试完整用户流程
   - 处理边界情况

**避免**：
- ❌ 边写后端边调前端（容易混乱）
- ❌ 跳过独立测试直接联调

---

## 架构决策

### 为什么选择混合 Fetch 方案？

**背景**：
- 纯 `fetch()` 无法处理需要 JavaScript 渲染的网站
- 纯 Puppeteer 性能开销大，冷启动慢

**决策**：
- **方案 A**：全部使用 Puppeteer（❌ 性能差）
- **方案 B**：全部使用 fetch（❌ 兼容性差）
- **方案 C**：混合方案（✅ 选择）

**优势**：
- 大多数请求快速响应（fetch）
- 特殊网站有降级方案（Puppeteer）
- 成本可控（按需使用 Puppeteer）

---

### 为什么不使用第三方 API？

**考虑过的方案**：
- ScraperAPI
- BrightData
- WebScraping.ai

**决策**：不使用

**原因**：
1. **成本**：每月数百美元起
2. **依赖性**：服务商可能停止服务或涨价
3. **控制权**：无法自定义提取逻辑
4. **当前需求**：大多数目标网站不需要复杂反爬

**例外情况**：
- 如果需要抓取 Reddit、微信等平台
- 可以考虑集成第三方服务作为可选功能

---

## 代码风格偏好

### TypeScript 配置

**决策**：使用保守的配置
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",  // 而非 bundler
    "strict": true,
    "esModuleInterop": true
  }
}
```

**原因**：
- 兼容 Vercel Serverless Functions
- 避免复杂的模块解析问题
- 减少构建错误

---

### 依赖管理

**原则**：
- ✅ 优先使用轻量级库
- ✅ 避免依赖臃肿的框架
- ✅ 定期检查安全更新

**当前技术栈**：
```json
{
  "@mozilla/readability": "轻量内容提取",
  "jsdom": "标准 DOM 解析",
  "turndown": "简洁 Markdown 转换",
  "puppeteer-core": "无浏览器的 Puppeteer",
  "@sparticuz/chromium-min": "Serverless 优化 Chromium"
}
```

---

## API 设计决策

### 为什么使用 GET 而非 POST？

**端点**：`/api/extract?url=<URL>`

**决策**：支持 GET 和 POST

**原因**：
- **GET**：便于浏览器直接访问测试
- **POST**：支持复杂参数（未来扩展）
- **实际使用**：大多数情况 GET 就够了

---

### 为什么不返回 HTML？

**决策**：只返回 Markdown

**原因**：
1. **明确的定位**：Web to Markdown 转换工具
2. **减少响应体积**：Markdown 更小
3. **易于处理**：客户端可直接使用

**未来可能添加**：
- 支持 `?format=html` 参数
- 返回结构化 JSON（标题、内容、元数据分离）

---

## 错误处理策略

### 哲学

**原则**：
- 优雅降级，而非硬性失败
- 提供有用的错误信息
- 记录失败原因

**实现**：
```typescript
// ✅ 好的错误处理
try {
  const content = await extractWithReadability(html);
  if (!content) {
    throw new Error('No content extracted');
  }
  return content;
} catch (error) {
  return {
    error: 'Failed to extract content',
    details: error.message,
    suggestion: 'Try a different URL or check if the page requires login'
  };
}

// ❌ 避免
throw new Error('Failed'); // 信息不足
```

---

## 性能优化决策

### 为什么不缓存结果？

**考虑**：缓存提取的 Markdown 内容

**决策**：不实现缓存（暂时）

**原因**：
1. **内容时效性**：文章可能更新
2. **存储成本**：Vercel KV 收费
3. **当前规模**：流量不大，不需要缓存

**未来可能添加**：
- 使用 Vercel KV 或 Redis
- TTL 设置为 1 小时
- 可选的 `?refresh=true` 参数

---

### 为什么不并行处理批量请求？

**当前实现**：顺序处理

**决策**：保持顺序处理（暂时）

**原因**：
1. **避免 Puppeteer 资源耗尽**
2. **Vercel 函数内存限制**
3. **更好的错误追踪**

**未来可能改进**：
- 限制并发数（如 3 个）
- 使用队列系统

---

## 安全考虑

### URL 验证

**决策**：基础验证 + 白名单

**实现**：
```typescript
// 1. 验证 URL 格式
new URL(url); // 抛出异常如果无效

// 2. 检查协议
if (!url.startsWith('http://') && !url.startsWith('https://')) {
  throw new Error('Only HTTP(S) URLs are supported');
}

// 3. 避免 SSRF（未来）
// 检查是否访问内网地址
```

---

### 资源限制

**决策**：限制页面大小和加载时间

**实现**：
```typescript
{
  timeout: 30000,  // 30 秒超时
  // 未来：限制响应体积
  maxBodySize: 10 * 1024 * 1024  // 10MB
}
```

---

## 用户体验决策

### API 响应格式

**决策**：简单直接的响应

**成功**：
```json
{
  "markdown": "# Title\n\nContent...",
  "metadata": {
    "title": "...",
    "author": "...",
    "publishedTime": "..."
  }
}
```

**失败**：
```json
{
  "error": "Failed to extract content",
  "details": "...",
  "url": "..."
}
```

**原因**：
- 易于解析
- 包含足够的调试信息
- 符合 RESTful 约定
