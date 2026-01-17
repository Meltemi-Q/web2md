import puppeteerCore from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'turndown-plugin-gfm';

export interface ExtractResult {
  title?: string;
  content: string;
  author?: string;
  date?: string;
  url: string;
  excerpt?: string;
  length: number;
}

// 需要使用浏览器的域名列表（有安全验证或动态加载）
const BROWSER_REQUIRED_DOMAINS = [
  'mp.weixin.qq.com',
  'weixin.qq.com',
  'xiaohongshu.com',
  'xhslink.com',
  'reddit.com',
];

const CHROMIUM_REMOTE_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar";

/**
 * 检查 URL 是否需要使用浏览器
 */
function needsBrowser(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return BROWSER_REQUIRED_DOMAINS.some(domain => hostname.includes(domain));
  } catch {
    return false;
  }
}

/**
 * 使用 fetch 获取页面 HTML（轻量方案）
 */
async function fetchWithHttp(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.text();
}

/**
 * 获取浏览器实例
 * 在 Vercel 环境使用 chromium-min，本地使用完整 puppeteer
 */
async function getBrowser() {
  // Vercel 环境检测：VERCEL 环境变量在所有 Vercel 部署中都存在
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
        '--single-process'
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
 * 使用无头浏览器获取页面 HTML
 */
async function fetchWithBrowser(url: string): Promise<string> {
  const browser = await getBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

/**
 * 智能获取页面内容：根据域名选择方案
 */
async function fetchHtml(url: string): Promise<string> {
  if (needsBrowser(url)) {
    return fetchWithBrowser(url);
  }
  return fetchWithHttp(url);
}

export async function extractArticle(url: string): Promise<ExtractResult | { error: string }> {
  try {
    // 智能选择获取方式
    const html = await fetchHtml(url);

    // 使用 JSDOM 解析
    const dom = new JSDOM(html, { url });

    // 使用 Readability 提取文章
    const article = new Readability(dom.window.document).parse();

    if (!article) {
      return { error: '无法提取文章内容' };
    }

    // 配置 Turndown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });

    // 启用 GFM 插件（表格、删除线、任务列表）
    turndownService.use(gfm);

    // 自定义规则：保留删除线
    turndownService.addRule('strikethrough', {
      filter: ['del', 's'],
      replacement: (content: string) => `~~${content}~~`
    });

    // 转换为 Markdown
    const markdown = turndownService.turndown(article.content);

    return {
      title: article.title,
      content: markdown,
      author: article.byline || undefined,
      date: article.publishedTime || undefined,
      url,
      excerpt: article.excerpt || undefined,
      length: markdown.length,
    };
  } catch (error: any) {
    return { error: error.message || '抓取失败' };
  }
}
