# Web to Markdown - 项目规范

## 项目概述

网页内容抓取工具，将网页文章主体内容转换为 Markdown 格式，保留标题层级结构。

包含两个独立实现：
- **CLI 工具（Python）** - 本地安装使用
- **Vercel API（Node.js）** - 部署为 HTTP API 服务

## 目录结构

```
downweb/
├── cli/                      # CLI 工具（Python）
│   ├── web_to_md/
│   │   ├── __init__.py
│   │   ├── __main__.py       # CLI 入口
│   │   └── extractor.py      # 内容提取逻辑
│   ├── pyproject.toml        # 项目配置
│   ├── requirements.txt      # 依赖列表
│   ├── .gitignore
│   └── README.md
│
├── api/                      # Vercel API（Node.js）
│   ├── api/
│   │   ├── extract/route.ts  # 单个 URL 端点
│   │   └── batch/route.ts    # 批量处理端点
│   ├── lib/
│   │   └── extractor.ts      # 内容提取逻辑
│   ├── package.json
│   ├── tsconfig.json
│   ├── vercel.json
│   ├── .gitignore
│   └── README.md
│
└── README.md                 # 总体说明
```

## 核心功能

1. **提取文章主体内容** - 智能识别文章正文区域
2. **保留标题层级（H1-H6）** - 完整保留文档结构
3. **批量处理多个 URL** - 支持并发抓取
4. **图片下载到本地** - 自动处理懒加载图片
5. **提取元数据** - 标题、作者、发布时间
6. **保留链接和格式** - 链接、列表、粗体等

## CLI 工具规范

### 安装

```bash
cd cli
pip install -e .
```

### 使用

```bash
# 单个 URL
web2md extract <URL> [-o output.md]

# 批量处理（文件）
web2md batch urls.txt -o ./output

# 批量处理（直接传入）
web2md multi <URL1> <URL2> <URL3> -o ./output

# 下载图片
web2md extract <URL> --download-images -o output.md
```

### 技术栈

- `requests` - HTTP 请求
- `BeautifulSoup4` - HTML 解析
- `markdownify` - HTML → Markdown
- `click` - CLI 框架
- `rich` - 终端美化
- `Pillow` - 图片验证

## Vercel API 规范

### 部署

```bash
cd api
npm install
vercel deploy
```

### 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/extract` | GET/POST | 提取单个 URL |
| `/api/batch` | POST | 批量提取（最多 20 个）|

### 技术栈

- `@mozilla/readability` - 内容提取
- `jsdom` - DOM 解析
- `turndown` - HTML → Markdown
- `puppeteer-core` - 无头浏览器控制（轻量版）
- `@sparticuz/chromium-min` - Serverless 优化的 Chromium 浏览器

## 开发规范

### 提取逻辑

- 优先查找 `.post-content`、`.entry-content` 等 WordPress 常用 class
- 回退到 `<article>` 标签
- 再回退到 `<main>` 标签
- 移除脚本、样式、导航等无关元素
- 处理懒加载图片（`data-src` → `src`）

### 图片下载

- 优先使用 `data-src` 跳过占位图
- 验证图片格式（Pillow）
- 支持的格式：jpg, png, gif, webp, svg

### 错误处理

- 浏览器页面加载超时：30 秒
- Vercel 函数执行超时：60 秒（Pro 版本）
- 无效 URL 格式：返回 400 错误
- 提取失败：返回 500 错误
- 批量处理：记录成功/失败数量

### 无头浏览器实现

API 使用 Puppeteer + Chromium 获取页面内容，可绕过安全验证机制（如微信公众号文章）：

- **生产环境**：使用 `@sparticuz/chromium-min` 从 CDN 加载优化的 Chromium
- **本地开发**：使用完整的 `puppeteer` 自带浏览器
- **性能特点**：
  - 冷启动：3-5 秒（首次下载 Chromium）
  - 后续调用：1-2 秒
  - 内存使用：250-400 MB
- **浏览器配置**：
  - 使用真实的 Chrome User-Agent
  - 等待网络空闲后再提取内容（`networkidle0`）
  - 无沙箱模式（serverless 环境要求）
