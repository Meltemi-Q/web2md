import requests
import os
import re
from urllib.parse import urljoin, urlparse
from pathlib import Path
from typing import Optional, Dict, List
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image
import io
from markdownify import markdownify as md
from bs4 import BeautifulSoup


class WebExtractor:
    """提取网页内容并转换为 Markdown，支持批量处理和图片下载"""

    def __init__(self, timeout: int = 10, max_workers: int = 5):
        self.timeout = timeout
        self.max_workers = max_workers

    def extract(
        self,
        url: str,
        output_format: str = "markdown",
        include_comments: bool = False,
        include_images: bool = True,
        download_images: bool = False,
        images_dir: Optional[str] = None
    ) -> Dict[str, Optional[str]]:
        """
        提取网页内容

        Args:
            url: 网页 URL
            output_format: 输出格式（markdown, html, txt）
            include_comments: 是否包含评论
            include_images: 是否保留图片链接
            download_images: 是否下载图片到本地
            images_dir: 图片保存目录

        Returns:
            包含 title, content, author, date 等字段的字典
        """
        # 下载网页
        try:
            response = requests.get(url, timeout=self.timeout, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; WebToMD/1.0)'
            })
            response.raise_for_status()
            html = response.text
        except Exception as e:
            return {"error": f"Failed to download page: {str(e)}"}

        soup = BeautifulSoup(html, 'html.parser')

        # 提取标题
        title = self._extract_title(soup)

        # 提取元数据
        author = self._extract_meta(soup, 'author')
        date = self._extract_meta(soup, 'date')

        # 提取文章内容
        content_html = self._extract_content(soup)

        if not content_html:
            return {"error": "Failed to extract article content"}

        # 转换为指定格式
        if output_format == "markdown":
            # 转换前处理 HTML：将懒加载的 data-src 复制到 src
            content_soup = BeautifulSoup(content_html, 'html.parser')
            for img in content_soup.find_all('img'):
                data_src = img.get('data-src')
                if data_src:
                    img['src'] = data_src
            content = md(str(content_soup), heading_style="ATX")
        elif output_format == "html":
            content = content_html
        else:  # txt
            from html2text import HTML2Text
            h = HTML2Text()
            h.ignore_links = True
            h.ignore_images = True
            content = h.handle(content_html)

        # 下载图片
        images = []
        if download_images and images_dir:
            images = self._download_images(html, url, images_dir)
            # 替换内容中的图片链接
            if images and content:
                content = self._replace_image_links(content, images)

        return {
            "title": title,
            "author": author,
            "date": date,
            "url": url,
            "content": content,
            "images": images
        }

    def _extract_title(self, soup: BeautifulSoup) -> Optional[str]:
        """提取文章标题"""
        # 优先级: h1 > og:title > title tag
        # 先尝试 h1 标签
        h1 = soup.find('h1')
        if h1:
            return h1.get_text().strip()

        # 再尝试 meta 标签
        og_title = soup.find('meta', property='og:title')
        if og_title and og_title.get('content'):
            return og_title.get('content')

        # 最后尝试 title 标签
        title_tag = soup.find('title')
        if title_tag:
            return title_tag.get_text().strip()

        return None

    def _extract_content(self, soup: BeautifulSoup) -> Optional[str]:
        """提取文章主要内容区域"""
        # 尝试多种方式找到文章内容区域
        content_div = None

        # 1. WordPress 常见的 class 名称
        for class_name in [
            'post-content',
            'entry-content',
            'article-content',
            'content-area',
            'main-content',
            'article-body',
            'post-body',
            'article-content',
        ]:
            content_div = soup.find('div', class_=class_name)
            if content_div:
                break

        # 2. 尝试 article 标签
        if not content_div:
            article = soup.find('article')
            if article:
                content_div = article

        # 3. 尝试带有特定 role 的 div
        if not content_div:
            content_div = soup.find('div', role='article')

        # 4. 尝试 main 标签
        if not content_div:
            main = soup.find('main')
            if main:
                content_div = main

        if not content_div:
            return None

        # 克隆避免修改原始 soup
        content_soup = BeautifulSoup(str(content_div), 'html.parser')

        # 移除不需要的标签元素
        for tag in ['script', 'style', 'nav', 'aside', 'footer', 'iframe', 'noscript', 'header']:
            for elem in content_soup.find_all(tag):
                elem.decompose()

        # 移除特定的 class 元素（更精确的匹配）
        classes_to_remove = [
            'author-desktop', 'author-block', 'author-meta', 'author-avatar', 'author-name', 'author-desc',
            'sidebar', 'related-posts', 'share-buttons', 'comments', 'navigation', 'post-navigation',
            'meta-wrap', 'social-share', 'ad', 'advertisement'
        ]
        for class_name in classes_to_remove:
            for elem in content_soup.find_all(class_=class_name):
                elem.decompose()

        return str(content_soup)

    def _extract_meta(self, soup: BeautifulSoup, meta_type: str) -> Optional[str]:
        """从 HTML 中提取元数据"""
        if meta_type == 'author':
            # 尝试多种方式获取作者
            author = (
                soup.find('meta', {'name': 'author'}) or
                soup.find('meta', {'property': 'article:author'}) or
                soup.find('meta', {'name': 'dc.creator'}) or
                soup.find('meta', {'property': 'og:author'}) or
                soup.find('a', rel='author')
            )
            if author:
                if author.has_attr('content'):
                    return author.get('content')
                return author.get_text().strip()
            return None

        elif meta_type == 'date':
            # 尝试多种方式获取日期
            date = (
                soup.find('meta', {'property': 'article:published_time'}) or
                soup.find('meta', {'name': 'date'}) or
                soup.find('meta', {'name': 'dc.date'}) or
                soup.find('meta', {'property': 'og:published_time'}) or
                soup.find('time')
            )
            if date:
                if date.has_attr('content'):
                    return date.get('content')
                if date.has_attr('datetime'):
                    return date.get('datetime')
                return date.get('content')
            return None

        return None

    def extract_batch(
        self,
        urls: List[str],
        output_dir: str = "./output",
        download_images: bool = False,
        **kwargs
    ) -> List[Dict]:
        """
        批量提取多个网页

        Args:
            urls: URL 列表
            output_dir: 输出目录
            download_images: 是否下载图片

        Returns:
            提取结果列表
        """
        results = []
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {
                executor.submit(
                    self._extract_and_save,
                    url,
                    output_dir,
                    download_images,
                    **kwargs
                ): url for url in urls
            }

            for future in as_completed(futures):
                url = futures[future]
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    results.append({"url": url, "error": str(e)})

        return results

    def _extract_and_save(
        self,
        url: str,
        output_dir: str,
        download_images: bool,
        **kwargs
    ) -> Dict:
        """提取并保存到文件"""
        # 创建图片目录
        images_dir = None
        if download_images:
            url_hash = hash(url)
            images_dir = os.path.join(output_dir, f"images_{url_hash}")
            os.makedirs(images_dir, exist_ok=True)

        # 提取内容
        result = self.extract(
            url,
            download_images=download_images,
            images_dir=images_dir,
            **kwargs
        )

        if result.get("error"):
            return result

        # 生成文件名
        title = result.get('title', 'untitled')
        safe_title = re.sub(r'[\\/*?:"<>|]', '_', title)[:50]
        filename = f"{safe_title}.md"
        filepath = os.path.join(output_dir, filename)

        # 保存文件
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(f"# {result['title']}\n\n")
            if result.get('author'):
                f.write(f"**作者**: {result['author']}\n\n")
            if result.get('date'):
                f.write(f"**日期**: {result['date']}\n\n")
            f.write(f"**来源**: {result['url']}\n\n")
            f.write("---\n\n")
            f.write(result['content'])

        result['saved_to'] = filepath
        return result

    def _download_images(
        self,
        html: str,
        base_url: str,
        images_dir: str
    ) -> List[Dict]:
        """从 HTML 中提取并下载图片"""
        soup = BeautifulSoup(html, 'html.parser')
        img_tags = soup.find_all('img')

        downloaded = []
        seen_urls = set()

        for i, img in enumerate(img_tags):
            # 优先使用 data-src (懒加载)，其次使用 src
            src = img.get('data-src') or img.get('src')
            if not src:
                continue

            # 转换为绝对 URL
            absolute_url = urljoin(base_url, src)

            # 跳过占位图和无关图片
            skip_patterns = ['lazy_placeholder', 'placeholder.gif', 'pixel.gif', '1x1.gif', 'blank.gif']
            if any(pattern in absolute_url.lower() for pattern in skip_patterns):
                continue

            # 跳过重复
            if absolute_url in seen_urls:
                continue
            seen_urls.add(absolute_url)

            try:
                response = requests.get(absolute_url, timeout=10, stream=True)
                if response.status_code != 200:
                    continue

                # 验证是否为图片
                img_data = response.content
                img_file = io.BytesIO(img_data)
                try:
                    Image.open(img_file)
                except:
                    continue

                # 确定文件扩展名
                ext = self._get_image_extension(response.headers.get('content-type', ''))
                if not ext:
                    ext = '.jpg'

                # 保存图片
                filename = f"image_{i+1}{ext}"
                filepath = os.path.join(images_dir, filename)

                with open(filepath, 'wb') as f:
                    f.write(img_data)

                downloaded.append({
                    'original_url': absolute_url,
                    'local_path': filepath,
                    'filename': filename
                })

            except Exception as e:
                continue

        return downloaded

    def _get_image_extension(self, content_type: str) -> str:
        """根据 Content-Type 获取文件扩展名"""
        mapping = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg'
        }
        return mapping.get(content_type, '')

    def _replace_image_links(self, content: str, images: List[Dict]) -> str:
        """替换 Markdown 中的图片链接为本地路径"""
        for img in images:
            content = content.replace(img['original_url'], img['local_path'])
        return content
