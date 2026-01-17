# Web to Markdown API

Vercel API 服务，用于提取网页文章内容并转换为 Markdown 格式。

## 部署

```bash
npm install
vercel deploy
```

## API 端点

### GET /api/extract

提取单个 URL

```bash
curl "https://your-project.vercel.app/api/extract?url=https://example.com"
```

### POST /api/extract

提取单个 URL（POST 方法）

```bash
curl -X POST https://your-project.vercel.app/api/extract \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

### POST /api/batch

批量提取多个 URL（最多 20 个）

```bash
curl -X POST https://your-project.vercel.app/api/batch \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://example.com/1","https://example.com/2"]}'
```

## 响应格式

### 单个提取

```json
{
  "title": "文章标题",
  "content": "Markdown 内容",
  "author": "作者",
  "date": "发布日期",
  "url": "原始 URL",
  "excerpt": "摘要",
  "length": 5420
}
```

### 批量提取

```json
{
  "total": 2,
  "success": 2,
  "failed": 0,
  "results": [...]
}
```
