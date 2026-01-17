import { extractArticle } from '@/lib/extractor';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

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
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: '请求体必须包含 urls 数组' });
    }

    if (urls.length === 0) {
      return res.status(400).json({ error: 'URL 数组不能为空' });
    }

    // 限制批量数量
    if (urls.length > 20) {
      return res.status(400).json({ error: '单次最多处理 20 个 URL' });
    }

    // 验证所有 URL
    for (const url of urls) {
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ error: `无效的 URL: ${url}` });
      }
    }

    // 并发提取
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const result = await extractArticle(url);
          if ('error' in result) {
            return { url, error: result.error };
          }
          return result;
        } catch (error: any) {
          return { url, error: error.message || '提取失败' };
        }
      })
    );

    return res.status(200).json({
      total: results.length,
      success: results.filter(r => !('error' in r)).length,
      failed: results.filter(r => 'error' in r).length,
      results
    });
  } catch (error: any) {
    return res.status(400).json({ error: '无效的 JSON 请求体' });
  }
}
