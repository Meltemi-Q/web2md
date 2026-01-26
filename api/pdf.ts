import type { VercelRequest, VercelResponse } from '@vercel/node';
import { extractArticle } from '../lib/extractor.js';
import { markdownToPdf } from '../lib/pdf-generator.js';

/**
 * PDF 导出端点
 *
 * 支持两种方式：
 * 1. 从 URL 提取内容并转为 PDF
 * 2. 直接将 Markdown 文本转为 PDF
 *
 * POST /api/pdf
 * Body:
 *   - { url: string } - 从网页 URL 提取
 *   - { markdown: string, title?: string } - 直接从 Markdown 转换
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // 只允许 POST 请求
  if (req.method !== 'POST') {
    res.status(405).json({ error: '只支持 POST 请求' });
    return;
  }

  try {
    const { url, markdown, title } = req.body;

    if (!url && !markdown) {
      res.status(400).json({
        error: '请提供 url 或 markdown 参数',
        usage: {
          url_mode: '{ "url": "https://example.com" }',
          markdown_mode: '{ "markdown": "# Hello", "title": "可选标题" }',
        },
      });
      return;
    }

    let markdownContent: string;
    let docTitle: string | undefined;

    // 方式 1：从 URL 提取
    if (url) {
      if (typeof url !== 'string' || !url.trim()) {
        res.status(400).json({ error: 'url 必须是有效字符串' });
        return;
      }

      const extracted = await extractArticle(url);

      if ('error' in extracted) {
        res.status(500).json({
          error: '提取网页内容失败',
          details: extracted.error,
          url,
        });
        return;
      }

      markdownContent = extracted.content;
      docTitle = extracted.title || title;

      // 添加元数据到 Markdown
      const metadata: string[] = [];
      if (extracted.title) metadata.push(`**标题**: ${extracted.title}`);
      if (extracted.author) metadata.push(`**作者**: ${extracted.author}`);
      if (extracted.date) metadata.push(`**日期**: ${extracted.date}`);
      if (extracted.url) metadata.push(`**原文**: ${extracted.url}`);

      if (metadata.length > 0) {
        markdownContent = `${metadata.join('  \n')}\n\n---\n\n${markdownContent}`;
      }
    }
    // 方式 2：直接从 Markdown 转换
    else {
      if (typeof markdown !== 'string' || !markdown.trim()) {
        res.status(400).json({ error: 'markdown 必须是有效字符串' });
        return;
      }

      markdownContent = markdown;
      docTitle = title;
    }

    // 生成 PDF
    const pdfBuffer = await markdownToPdf(markdownContent, {
      title: docTitle,
      format: 'A4',
      displayHeaderFooter: false,
    });

    // 设置响应头
    const filename = `${docTitle || 'document'}_${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`
    );
    res.setHeader('Content-Length', pdfBuffer.length);

    res.status(200).send(pdfBuffer);
  } catch (error: any) {
    console.error('PDF 生成失败:', error);

    res.status(500).json({
      error: 'PDF 生成失败',
      message: error.message || '未知错误',
    });
  }
}
