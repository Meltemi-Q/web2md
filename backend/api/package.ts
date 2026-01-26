import crypto from 'crypto';
import { createTarGz, type TarEntry } from '../lib/tar.js';
import { extractArticleWithAssets, type AssetManifest } from '../lib/extractor.js';

export const config = {
  maxDuration: 60,
};

const MAX_URLS = 20;
const ARTICLE_CONCURRENCY = 2;
const ASSET_CONCURRENCY = 6;
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25MB per asset
const MAX_TOTAL_ASSET_BYTES = 150 * 1024 * 1024; // 150MB total

type PackageOptions = {
  downloadImages: boolean;
  downloadFiles: boolean;
};

type AssetKind = 'images' | 'files';

type DownloadedAsset = {
  originalUrl: string;
  relativePath: string;
  content: Buffer;
};

function shortHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 10);
}

function sanitizeSegment(input: string): string {
  return (input || '')
    .replace(/\0/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function sanitizePath(input: string): string {
  const parts = (input || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(sanitizeSegment)
    .filter(Boolean);
  return parts.join('/');
}

function safeArticleFolder(url: string, title: string | undefined, index: number): string {
  const prefix = String(index + 1).padStart(3, '0');
  const base = sanitizeSegment(title || '') || sanitizeSegment(new URL(url).hostname) || `article_${prefix}`;
  return `${prefix}_${base}`;
}

function guessExtFromContentType(contentType: string): string {
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  const mapping: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'application/x-zip-compressed': '.zip',
    'application/x-rar-compressed': '.rar',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'text/csv': '.csv',
    'application/json': '.json',
  };
  return mapping[ct] || '';
}

function parseFilenameFromContentDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const cd = contentDisposition;
  const star = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]).trim().replace(/^"+|"+$/g, '');
    } catch {
      return star[1].trim().replace(/^"+|"+$/g, '');
    }
  }
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (plain?.[1]) return plain[1].trim();
  return null;
}

function dedupePath(path: string, used: Set<string>): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const idx = path.lastIndexOf('.');
  const base = idx >= 0 ? path.slice(0, idx) : path;
  const ext = idx >= 0 ? path.slice(idx) : '';
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = `${base}_${shortHash(path)}${ext}`;
  used.add(fallback);
  return fallback;
}

function buildRelativeAssetPath(assetUrl: string, kind: AssetKind, filename: string): string {
  const u = new URL(assetUrl);
  const host = sanitizeSegment(u.hostname) || 'host';

  // 保留站点原始目录结构（更接近“原文位置”）
  const dir = sanitizePath(u.pathname.split('/').slice(0, -1).join('/'));
  const safeFilename = sanitizeSegment(filename) || `${kind}_${shortHash(assetUrl)}`;

  const base = dir ? `${dir}/${safeFilename}` : safeFilename;
  return `assets/${kind}/${host}/${base}`;
}

async function downloadAsset(
  assetUrl: string,
  referer: string,
  kind: AssetKind,
  usedPaths: Set<string>,
  total: { bytes: number }
): Promise<DownloadedAsset | null> {
  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      response = await fetch(assetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          Referer: referer,
          Accept: '*/*',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const contentType = response.headers.get('content-type') || '';
  const cd = response.headers.get('content-disposition');

  // 避免把网页当附件下载
  if (kind === 'files' && contentType.toLowerCase().startsWith('text/html')) {
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  const content = Buffer.from(arrayBuffer);
  if (content.length === 0) return null;
  if (content.length > MAX_ASSET_BYTES) return null;
  if (total.bytes + content.length > MAX_TOTAL_ASSET_BYTES) return null;
  total.bytes += content.length;

  const urlName = (() => {
    try {
      const u = new URL(assetUrl);
      const base = u.pathname.split('/').filter(Boolean).pop() || '';
      return base ? decodeURIComponent(base) : '';
    } catch {
      return '';
    }
  })();

  let filename = parseFilenameFromContentDisposition(cd) || urlName || `${kind}_${shortHash(assetUrl)}`;
  filename = sanitizeSegment(filename) || `${kind}_${shortHash(assetUrl)}`;

  const extFromName = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  if (!extFromName) {
    const ext = guessExtFromContentType(contentType);
    if (ext) filename = `${filename}${ext}`;
  }

  // query 可能导致同名不同内容，附加 hash 防冲突
  if (assetUrl.includes('?')) {
    const idx = filename.lastIndexOf('.');
    const base = idx >= 0 ? filename.slice(0, idx) : filename;
    const ext = idx >= 0 ? filename.slice(idx) : '';
    filename = `${base}__${shortHash(assetUrl)}${ext}`;
  }

  let relativePath = buildRelativeAssetPath(assetUrl, kind, filename);
  relativePath = dedupePath(relativePath, usedPaths);

  return { originalUrl: assetUrl, relativePath, content };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) break;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function replaceAll(text: string, search: string, replacement: string): string {
  if (!search) return text;
  return text.split(search).join(replacement);
}

function buildArticleMarkdown(result: any): string {
  const title = result.title || '';
  const lines: string[] = [];
  if (title) lines.push(`# ${title}`);
  lines.push(`**来源**: ${result.url}`);
  if (result.author) lines.push(`**作者**: ${result.author}`);
  if (result.date) lines.push(`**日期**: ${result.date}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(result.content || '');
  return lines.join('\n').trim() + '\n';
}

function pickAssets(manifest: AssetManifest, options: PackageOptions): { images: string[]; files: string[] } {
  return {
    images: options.downloadImages ? manifest.images : [],
    files: options.downloadFiles ? manifest.files : [],
  };
}

export default async function handler(req: any, res: any) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const urls: string[] = Array.isArray(body.urls) ? body.urls : body.url ? [body.url] : [];
    const options: PackageOptions = {
      downloadImages: body.downloadImages !== false,
      downloadFiles: body.downloadFiles !== false,
    };

    if (!urls.length) {
      return res.status(400).json({ error: '请求体必须包含 url 或 urls' });
    }
    if (urls.length > MAX_URLS) {
      return res.status(400).json({ error: `单次最多处理 ${MAX_URLS} 个 URL` });
    }

    for (const url of urls) {
      try {
        const u = new URL(url);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Invalid protocol');
      } catch {
        return res.status(400).json({ error: `无效的 URL: ${url}` });
      }
    }

    const tarEntries: TarEntry[] = [];
    const manifest: any = { total: urls.length, success: 0, failed: 0, results: [] as any[] };
    const totalAssets = { bytes: 0 };

    const articleResults = await mapLimit(urls, ARTICLE_CONCURRENCY, async (url, index) => {
      const extracted = await extractArticleWithAssets(url);
      if ('error' in extracted) {
        return { url, index, error: extracted.error } as const;
      }
      return { url, index, extracted } as const;
    });

    for (const item of articleResults) {
      const url = item.url;
      if ('error' in item) {
        const folder = safeArticleFolder(url, undefined, item.index);
        const errorMd = `# 提取失败\n\n**来源**: ${url}\n\n**错误**: ${item.error}\n`;
        tarEntries.push({ type: 'file', path: `${folder}/error.md`, content: Buffer.from(errorMd, 'utf8') });
        manifest.failed += 1;
        manifest.results.push({ url, folder, ok: false, error: item.error });
        continue;
      }

      const extracted = item.extracted;
      const folder = safeArticleFolder(url, extracted.result.title, item.index);
      let markdown = buildArticleMarkdown(extracted.result);

      const usedPaths = new Set<string>();
      const assets = pickAssets(extracted.assets, options);

      const downloaded = await mapLimit(
        [
          ...assets.images.map(u => ({ kind: 'images' as const, url: u })),
          ...assets.files.map(u => ({ kind: 'files' as const, url: u })),
        ],
        ASSET_CONCURRENCY,
        async ({ kind, url: assetUrl }) => downloadAsset(assetUrl, url, kind, usedPaths, totalAssets)
      );

      const okAssets = downloaded.filter(Boolean) as DownloadedAsset[];
      for (const asset of okAssets) {
        markdown = replaceAll(markdown, asset.originalUrl, asset.relativePath);
        tarEntries.push({
          type: 'file',
          path: `${folder}/${asset.relativePath}`,
          content: asset.content,
        });
      }

      tarEntries.push({ type: 'file', path: `${folder}/index.md`, content: Buffer.from(markdown, 'utf8') });

      manifest.success += 1;
      manifest.results.push({
        url,
        folder,
        ok: true,
        images: assets.images.length,
        files: assets.files.length,
        downloaded: okAssets.length,
      });
    }

    tarEntries.push({
      type: 'file',
      path: 'manifest.json',
      content: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'),
    });

    const tarGz = createTarGz(tarEntries);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="downweb_${Date.now()}.tar.gz"`);
    return res.status(200).send(tarGz);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '无效的请求' });
  }
}

