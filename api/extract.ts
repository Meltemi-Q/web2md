import { extractArticle } from './lib/extractor.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: '请提供 url 参数' });
    }

    try {
      new URL(url); // 验证 URL 格式
    } catch {
      return res.status(400).json({ error: '无效的 URL 格式' });
    }

    const result = await extractArticle(url);

    if ('error' in result) {
      return res.status(500).json({ error: result.error });
    }

    return res.status(200).json(result);
  }

  if (req.method === 'POST') {
    try {
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({ error: '请求体必须包含 url 字段' });
      }

      try {
        new URL(url);
      } catch {
        return res.status(400).json({ error: '无效的 URL 格式' });
      }

      const result = await extractArticle(url);

      if ('error' in result) {
        return res.status(500).json({ error: result.error });
      }

      return res.status(200).json(result);
    } catch (error: any) {
      return res.status(400).json({ error: '无效的 JSON 请求体' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
