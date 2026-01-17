import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
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

export async function extractArticle(url: string): Promise<ExtractResult | { error: string }> {
  try {
    // 获取网页内容
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WebToMD/1.0)',
      },
    });

    // 使用 JSDOM 解析
    const dom = new JSDOM(response.data, { url });

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

    // 自定义规则：保留图片 alt 文本
    turndownService.addRule('strikethrough', {
      filter: ['del', 's', 'strike'],
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
