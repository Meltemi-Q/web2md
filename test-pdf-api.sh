#!/bin/bash

echo "测试 PDF API 端点..."
echo ""

# 测试 Markdown → PDF
echo "1. 测试 Markdown → PDF"
curl -s -X POST http://localhost:3000/api/pdf \
  -H "Content-Type: application/json" \
  -d '{
    "markdown": "# 测试文档\n\n这是一个测试文档。\n\n## 子标题\n\n- 列表项 1\n- 列表项 2",
    "title": "测试"
  }' \
  -o test-markdown.pdf

if [ -f test-markdown.pdf ] && [ -s test-markdown.pdf ]; then
  echo "✓ Markdown → PDF 测试通过（文件大小: $(ls -lh test-markdown.pdf | awk '{print $5}')）"
else
  echo "✗ Markdown → PDF 测试失败"
fi

echo ""
echo "2. 测试 URL → PDF（需要本地服务运行）"
echo "提示：请先运行 'cd api && npm run dev' 启动本地服务"
