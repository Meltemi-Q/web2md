# Web to Markdown CLI

Python 命令行工具，用于提取网页文章内容并转换为 Markdown 格式。

## 安装

```bash
pip install -e .
```

## 使用

### 单个 URL

```bash
# 基本使用
web2md extract https://example.com/article

# 保存到文件
web2md extract https://example.com/article -o article.md

# 下载图片
web2md extract https://example.com/article --download-images -o article.md

# 下载附件（PDF/Office/压缩包等）
web2md extract https://example.com/article --download-files -o article.md

# 同时下载图片 + 附件
web2md extract https://example.com/article --download-images --download-files -o article.md
```

### 批量处理

```bash
# 从文件读取 URL
web2md batch urls.txt -o ./output

# 直接传入多个 URL
web2md multi https://example.com/1 https://example.com/2 -o ./output
```

## 功能

- 提取文章主体内容
- 保留标题层级（H1-H6）
- 批量处理
- 图片下载
- 元数据提取

## 提高兼容性（可选：JS 渲染兜底）

CLI 默认使用 Readability 提取正文；当遇到需要 JavaScript 渲染或反爬挑战页时，可选使用 Playwright 作为兜底（需要额外安装）。

```bash
pip install -e ".[browser]"
playwright install
```
