import puppeteerCore from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';
import { marked } from 'marked';
import type { Browser } from 'puppeteer-core';

const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar';

/**
 * 获取浏览器实例
 * 在 Vercel 环境使用 chromium-min，本地使用完整 puppeteer
 */
async function getBrowser(): Promise<Browser> {
  const isVercel = process.env.VERCEL === '1';

  if (isVercel) {
    const executablePath = await chromium.executablePath(CHROMIUM_REMOTE_URL);
    return puppeteerCore.launch({
      executablePath,
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
      headless: true,
      defaultViewport: chromium.defaultViewport,
    });
  }

  // 本地开发使用完整 puppeteer
  const puppeteer = await import('puppeteer');
  return puppeteer.default.launch({ headless: true });
}

/**
 * Markdown 转 HTML 模板
 */
function markdownToHtml(markdown: string, title?: string): string {
  const content = marked.parse(markdown);

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || '文档'}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      color: #333;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
      line-height: 1.25;
    }
    h1 { font-size: 2em; border-bottom: 2px solid #eee; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    h3 { font-size: 1.25em; }
    p { margin-bottom: 16px; }
    code {
      background: #f6f8fa;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 0.9em;
    }
    pre {
      background: #f6f8fa;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      margin-bottom: 16px;
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      border-left: 4px solid #ddd;
      padding-left: 16px;
      color: #666;
      margin: 16px 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 16px;
    }
    table th, table td {
      border: 1px solid #ddd;
      padding: 8px 12px;
      text-align: left;
    }
    table th {
      background: #f6f8fa;
      font-weight: 600;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    a {
      color: #0366d6;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    ul, ol {
      margin-bottom: 16px;
      padding-left: 2em;
    }
    li {
      margin-bottom: 4px;
    }
    hr {
      border: none;
      border-top: 2px solid #eee;
      margin: 24px 0;
    }
  </style>
</head>
<body>
${content}
</body>
</html>
`.trim();
}

export interface PdfOptions {
  /**
   * 页面标题（可选）
   */
  title?: string;

  /**
   * 页面格式，默认 A4
   */
  format?: 'A4' | 'Letter' | 'Legal';

  /**
   * 是否显示页眉页脚
   */
  displayHeaderFooter?: boolean;

  /**
   * 页边距（单位：毫米）
   */
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
}

/**
 * Markdown 转 PDF
 */
export async function markdownToPdf(
  markdown: string,
  options: PdfOptions = {}
): Promise<Buffer> {
  const {
    title,
    format = 'A4',
    displayHeaderFooter = false,
    margin = {
      top: '20mm',
      right: '15mm',
      bottom: '20mm',
      left: '15mm',
    },
  } = options;

  const html = markdownToHtml(markdown, title);
  return htmlToPdf(html, { format, displayHeaderFooter, margin });
}

/**
 * HTML 转 PDF
 */
export async function htmlToPdf(
  html: string,
  options: Omit<PdfOptions, 'title'> = {}
): Promise<Buffer> {
  const {
    format = 'A4',
    displayHeaderFooter = false,
    margin = {
      top: '20mm',
      right: '15mm',
      bottom: '20mm',
      left: '15mm',
    },
  } = options;

  const browser = await getBrowser();

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format,
      displayHeaderFooter,
      margin,
      printBackground: true,
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
