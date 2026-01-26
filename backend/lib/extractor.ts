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

export type AssetManifest = {
  images: string[];
  files: string[];
};

// 需要使用浏览器的域名列表（有安全验证或动态加载）
const BROWSER_REQUIRED_DOMAINS = [
  'mp.weixin.qq.com',
  'weixin.qq.com',
  'xiaohongshu.com',
  'xhslink.com',
  'reddit.com',
];

const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
} as const;

const MIN_ARTICLE_TEXT_LENGTH = 200;

const FILE_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.csv',
  '.tsv',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.tgz',
  '.apk',
  '.dmg',
  '.exe',
  '.msi',
  '.epub',
  '.mobi',
  '.txt',
  '.md',
  '.rtf',
  '.json',
  '.xml',
]);

type FetchResult = {
  html: string;
  finalUrl: string;
  method: 'http' | 'browser';
};

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
async function fetchWithHttp(
  url: string,
  timeoutMs = 15_000
): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    return { html, finalUrl: response.url || url };
  } finally {
    clearTimeout(timeout);
  }
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
 * 使用无头浏览器获取页面 HTML
 */
async function fetchWithBrowser(url: string): Promise<{ html: string; finalUrl: string }> {
  const browser = await getBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(DEFAULT_HEADERS['User-Agent']);

    // 拦截不必要资源，加速并降低内存
    await page.setRequestInterception(true);
    page.on('request', (req: any) => {
      const type = (req.resourceType?.() || '').toLowerCase();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        return req.abort();
      }
      return req.continue();
    });

    await page.setExtraHTTPHeaders({
      Accept: DEFAULT_HEADERS.Accept,
      'Accept-Language': DEFAULT_HEADERS['Accept-Language'],
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    try {
      // networkidle0 在很多站点会卡住（长连接/埋点），用更温和的等待
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 10_000 });
    } catch {
      // ignore
    }
    await new Promise(resolve => setTimeout(resolve, 400));

    return { html: await page.content(), finalUrl: page.url() || url };
  } finally {
    await browser.close();
  }
}

function looksLikeBotOrJsChallenge(html: string): boolean {
  const lowered = (html || '').toLowerCase();
  const patterns = [
    'enable javascript',
    'please enable javascript',
    'captcha',
    'verify you are human',
    'verify you are a human',
    'human verification',
    'just a moment',
    'cloudflare',
    'access denied',
    'attention required',
  ];
  return patterns.some(p => lowered.includes(p));
}

/**
 * 智能获取页面内容：根据域名选择方案 + 自动降级到浏览器
 */
async function fetchHtml(url: string): Promise<FetchResult> {
  if (needsBrowser(url)) {
    const { html, finalUrl } = await fetchWithBrowser(url);
    return { html, finalUrl, method: 'browser' };
  }

  try {
    const { html, finalUrl } = await fetchWithHttp(url);
    if (looksLikeBotOrJsChallenge(html)) {
      throw new Error('Page looks like bot-challenge / requires JavaScript');
    }
    return { html, finalUrl, method: 'http' };
  } catch {
    const { html, finalUrl } = await fetchWithBrowser(url);
    return { html, finalUrl, method: 'browser' };
  }
}

function buildTurndownService(): TurndownService {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  turndownService.use(gfm);

  turndownService.addRule('strikethrough', {
    filter: ['del', 's'],
    replacement: (content: string) => `~~${content}~~`,
  });

  // 代码块：尽量保留语言信息（```lang）
  turndownService.addRule('fencedCodeBlockWithLanguage', {
    filter: (node: any) =>
      node &&
      node.nodeName === 'PRE' &&
      node.firstChild &&
      node.firstChild.nodeName === 'CODE',
    replacement: (_content: string, node: any) => {
      const codeNode = node.firstChild;
      const className = (codeNode.getAttribute?.('class') || '') as string;
      const match =
        className.match(/language-([a-z0-9_+-]+)/i) ||
        className.match(/lang(?:uage)?-([a-z0-9_+-]+)/i);
      const language = match?.[1] || '';
      const code = (codeNode.textContent || '').replace(/\n$/, '');
      return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    },
  });

  return turndownService;
}

function pickBestFromSrcset(srcset: string): string {
  if (!srcset.includes(',')) return srcset.trim();
  let bestUrl = '';
  let bestScore = -1;
  for (const part of srcset.split(',')) {
    const tokens = part.trim().split(/\s+/);
    if (!tokens[0]) continue;
    const url = tokens[0];
    let score = 0;
    if (tokens[1]) {
      const descriptor = tokens[1].toLowerCase();
      if (descriptor.endsWith('w')) {
        const n = Number(descriptor.slice(0, -1));
        score = Number.isFinite(n) ? n : 0;
      } else if (descriptor.endsWith('x')) {
        const n = Number(descriptor.slice(0, -1));
        score = Number.isFinite(n) ? n * 1000 : 0;
      }
    }
    if (score >= bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }
  return bestUrl || srcset.split(',')[0].trim().split(/\s+/)[0];
}

function looksLikePlaceholderImage(url: string): boolean {
  const lowered = url.toLowerCase();
  return (
    lowered.includes('lazy_placeholder') ||
    lowered.includes('placeholder.gif') ||
    lowered.includes('pixel.gif') ||
    lowered.includes('1x1.gif') ||
    lowered.includes('blank.gif') ||
    lowered.startsWith('data:image/gif')
  );
}

function bestImageSrc(img: any): string | null {
  const candidates = [
    img.getAttribute?.('src'),
    img.getAttribute?.('data-src'),
    img.getAttribute?.('data-original'),
    img.getAttribute?.('data-url'),
    img.getAttribute?.('data-actualsrc'),
    img.getAttribute?.('data-lazy-src'),
    img.getAttribute?.('data-srcset'),
    img.getAttribute?.('data-original-src'),
  ]
    .filter(Boolean)
    .map((v: any) => String(v).trim())
    .filter(v => v && !looksLikePlaceholderImage(v));

  for (const c of candidates) {
    return pickBestFromSrcset(c);
  }

  const srcset = img.getAttribute?.('srcset');
  if (srcset) return pickBestFromSrcset(String(srcset));

  return null;
}

function isProbablyFileLink(url: string, anchor?: any): boolean {
  try {
    if (anchor?.getAttribute?.('download') != null) return true;
  } catch {
    // ignore
  }

  try {
    const u = new URL(url);
    const pathname = u.pathname || '';
    const ext = pathname.includes('.') ? pathname.slice(pathname.lastIndexOf('.')).toLowerCase() : '';
    if (!ext) return false;
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) return false;
    return FILE_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

function normalizeArticleHtml(html: string, baseUrl: string): { html: string; assets: AssetManifest } {
  const dom = new JSDOM(html, { url: baseUrl });
  const document: any = dom.window.document;
  const assets: AssetManifest = { images: [], files: [] };

  // 清理明显无关元素
  for (const selector of ['script', 'style', 'iframe', 'noscript', 'form', 'button', 'input']) {
    for (const el of Array.from(document.querySelectorAll(selector)) as any[]) {
      el.remove?.();
    }
  }

  // 归一化链接
  for (const a of Array.from(document.querySelectorAll('a[href]')) as any[]) {
    const href = String(a.getAttribute('href') || '').trim();
    if (!href || href.startsWith('#')) continue;
    const lowered = href.toLowerCase();
    if (lowered.startsWith('javascript:') || lowered.startsWith('mailto:') || lowered.startsWith('tel:')) continue;
    try {
      const absolute = new URL(href, baseUrl).toString();
      a.setAttribute('href', absolute);
      if (isProbablyFileLink(absolute, a)) {
        assets.files.push(absolute);
      }
    } catch {
      // ignore
    }
  }

  // 归一化图片（懒加载/相对路径）
  for (const img of Array.from(document.querySelectorAll('img')) as any[]) {
    const src = bestImageSrc(img);
    if (!src || src.startsWith('data:')) continue;
    try {
      const absolute = new URL(src, baseUrl).toString();
      img.setAttribute('src', absolute);
      assets.images.push(absolute);
    } catch {
      // ignore
    }
  }

  assets.images = Array.from(new Set(assets.images));
  assets.files = Array.from(new Set(assets.files));

  return { html: document.body?.innerHTML || html, assets };
}

function extractFromHtmlWithAssets(
  html: string,
  baseUrl: string,
  url: string
): { result: ExtractResult; assets: AssetManifest } | null {
  const dom = new JSDOM(html, { url: baseUrl });
  const article = new Readability(dom.window.document).parse();
  if (!article) return null;

  const normalized = normalizeArticleHtml(article.content, baseUrl);
  const turndownService = buildTurndownService();
  const markdown = turndownService.turndown(normalized.html).trim();

  return {
    result: {
      title: article.title || undefined,
      content: markdown,
      author: article.byline || undefined,
      date: article.publishedTime || undefined,
      url,
      excerpt: article.excerpt || undefined,
      length: markdown.length,
    },
    assets: normalized.assets,
  };
}

function extractFromHtml(html: string, baseUrl: string, url: string): ExtractResult | null {
  const extracted = extractFromHtmlWithAssets(html, baseUrl, url);
  return extracted ? extracted.result : null;
}

export async function extractArticle(url: string): Promise<ExtractResult | { error: string }> {
  try {
    const first = await fetchHtml(url);
    let result = extractFromHtml(first.html, first.finalUrl, url);

    if (result && result.content.replace(/\s+/g, '').length >= MIN_ARTICLE_TEXT_LENGTH) {
      return result;
    }

    // HTTP 方案提取失败或过短，则尝试浏览器渲染兜底（覆盖更多未知站点）
    if (first.method === 'http') {
      try {
        const browser = await fetchWithBrowser(url);
        result = extractFromHtml(browser.html, browser.finalUrl, url);
      } catch {
        // ignore
      }
    }

    if (!result) {
      return { error: '无法提取文章内容' };
    }

    return result;
  } catch (error: any) {
    return { error: error.message || '抓取失败' };
  }
}

export async function extractArticleWithAssets(
  url: string
): Promise<{ result: ExtractResult; assets: AssetManifest } | { error: string }> {
  try {
    const first = await fetchHtml(url);
    let extracted = extractFromHtmlWithAssets(first.html, first.finalUrl, url);

    if (extracted && extracted.result.content.replace(/\s+/g, '').length >= MIN_ARTICLE_TEXT_LENGTH) {
      return extracted;
    }

    if (first.method === 'http') {
      try {
        const browser = await fetchWithBrowser(url);
        extracted = extractFromHtmlWithAssets(browser.html, browser.finalUrl, url);
      } catch {
        // ignore
      }
    }

    if (!extracted) {
      return { error: '无法提取文章内容' };
    }

    return extracted;
  } catch (error: any) {
    return { error: error.message || '抓取失败' };
  }
}
