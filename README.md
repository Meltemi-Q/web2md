# Web to Markdown - 网页内容抓取工具

一个强大的网页内容抓取工具套件，将网页文章主体内容转换为 Markdown 格式，保留标题层级结构。

包含两个版本：
- **CLI 命令行工具（Python）** - 本地安装使用，支持批量处理和图片下载
- **Vercel API（Node.js）** - 部署为 HTTP API 服务

## 功能特性

- ✅ 提取文章主体内容
- ✅ 保留标题层级结构（H1-H6）
- ✅ 批量处理多个 URL
- ✅ 图片下载到本地（CLI 版本）
- ✅ 提取元数据（标题、作者、发布时间）
- ✅ 保留链接和基本格式
- ✅ 错误处理和重试机制

---

## CLI 命令行工具（Python）

### 安装

```bash
cd cli
pip install -e .
```

### 使用方式

#### 单个 URL 抓取

```bash
# 抓取并预览内容
web2md extract https://example.com/article

# 保存到文件
web2md extract https://example.com/article -o article.md

# 下载图片
web2md extract https://example.com/article --download-images -o article.md

# 不保留图片链接
web2md extract https://example.com/article --no-images

# 输出 HTML 格式
web2md extract https://example.com/article --format html
```

#### 批量处理（从文件）

```bash
# 创建 URL 文件
cat > urls.txt << EOF
https://example.com/article1
https://example.com/article2
https://example.com/article3
EOF

# 批量处理
web2md batch urls.txt -o ./articles

# 下载图片
web2md batch urls.txt -o ./articles --download-images

# 自定义并发数
web2md batch urls.txt --max-workers 10
```

#### 批量处理（直接传入）

```bash
web2md multi https://example.com/1 https://example.com/2 https://example.com/3 -o ./articles
```

### 命令参数

**extract 命令：**
- `url`: 网页 URL（必填）
- `-o, --output`: 输出文件路径
- `--format`: 输出格式（markdown/html/txt，默认 markdown）
- `--no-comments`: 不包含评论
- `--no-images`: 不保留图片链接
- `--download-images`: 下载图片到本地
- `--images-dir`: 图片保存目录

**batch 命令：**
- `urls_file`: URL 列表文件（必填）
- `-o, --output-dir`: 输出目录（默认 ./output）
- `--format`: 输出格式
- `--download-images`: 下载图片
- `--max-workers`: 并发数（默认 5）

**multi 命令：**
- `urls`: URL 列表（必填，支持多个）
- `-o, --output-dir`: 输出目录
- `--format`: 输出格式
- `--download-images`: 下载图片
- `--max-workers`: 并发数

---

## Vercel API（Node.js）

### 部署

```bash
cd api
npm install
vercel deploy
```

### API 端点

#### 1. 单个 URL 提取

**GET 请求：**
```bash
curl "https://your-project.vercel.app/api/extract?url=https://example.com/article"
```

**POST 请求：**
```bash
curl -X POST https://your-project.vercel.app/api/extract \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article"}'
```

**响应示例：**
```json
{
  "title": "文章标题",
  "content": "# 标题\n\n文章内容...",
  "author": "作者名",
  "date": "2025-01-15T10:00:00Z",
  "url": "https://example.com/article",
  "excerpt": "文章摘要...",
  "length": 5420
}
```

#### 2. 批量提取

**POST 请求：**
```bash
curl -X POST https://your-project.vercel.app/api/batch \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://example.com/article1",
      "https://example.com/article2",
      "https://example.com/article3"
    ]
  }'
```

**响应示例：**
```json
{
  "total": 3,
  "success": 2,
  "failed": 1,
  "results": [
    {
      "url": "https://example.com/article1",
      "title": "文章1",
      "content": "...",
      "length": 3200
    },
    {
      "url": "https://example.com/article2",
      "title": "文章2",
      "content": "...",
      "length": 4100
    },
    {
      "url": "https://example.com/article3",
      "error": "无法提取文章内容"
    }
  ]
}
```

### API 限制

- 单次最多处理 20 个 URL
- 单个请求超时时间：10 秒
- 批量请求超时时间：30 秒

---

## 技术栈

### CLI 工具
- **Trafilatura**: 内容提取
- **Requests**: HTTP 请求
- **Click**: CLI 框架
- **Rich**: 终端美化
- **BeautifulSoup4**: HTML 解析
- **Pillow**: 图片处理

### Vercel API
- **@mozilla/readability**: Mozilla 官方内容提取库
- **Turndown**: HTML 转 Markdown
- **JSDOM**: DOM 解析
- **Axios**: HTTP 客户端

---

## 本地开发

### CLI 工具开发

```bash
cd cli
pip install -e ".[dev]"
black web_to_md/
flake8 web_to_md/
```

### Vercel API 开发

```bash
cd api
npm install
npm run dev
```

---

## 目录结构

```
downweb/
├── cli/                      # CLI 工具（Python）
│   ├── web_to_md/
│   │   ├── __init__.py
│   │   ├── __main__.py       # CLI 入口
│   │   └── extractor.py      # 内容提取逻辑
│   ├── pyproject.toml        # 项目配置
│   ├── requirements.txt
│   ├── README.md
│   └── .gitignore
│
└── api/                      # Vercel API（Node.js）
    ├── api/
    │   ├── extract/
    │   │   └── route.ts      # 单个 URL 端点
    │   └── batch/
    │       └── route.ts      # 批量处理端点
    ├── lib/
    │   └── extractor.ts      # 内容提取逻辑
    ├── package.json
    ├── tsconfig.json
    ├── vercel.json
    ├── README.md
    └── .gitignore
```

---

## License

MIT
