from __future__ import annotations

import hashlib
import io
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from markdownify import markdownify as md
from PIL import Image
from readability import Document
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class WebExtractor:
    """提取网页内容并转换为 Markdown，支持批量处理和图片下载"""

    _FILE_EXTENSIONS = {
        ".pdf",
        ".doc",
        ".docx",
        ".ppt",
        ".pptx",
        ".xls",
        ".xlsx",
        ".csv",
        ".tsv",
        ".zip",
        ".rar",
        ".7z",
        ".tar",
        ".gz",
        ".bz2",
        ".xz",
        ".tgz",
        ".apk",
        ".dmg",
        ".exe",
        ".msi",
        ".epub",
        ".mobi",
        ".txt",
        ".md",
        ".rtf",
        ".json",
        ".xml",
    }

    def __init__(self, timeout: int = 10, max_workers: int = 5, browser_fallback: bool = True):
        self.timeout = timeout
        self.max_workers = max_workers
        self.browser_fallback = browser_fallback

        self._session = self._build_session()
        self._default_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        retry = Retry(
            total=3,
            connect=3,
            read=3,
            backoff_factor=0.6,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET", "HEAD", "OPTIONS"}),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        return session

    def extract(
        self,
        url: str,
        output_format: str = "markdown",
        include_comments: bool = False,
        include_images: bool = True,
        download_images: bool = False,
        images_dir: Optional[str] = None,
        download_files: bool = False,
        files_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
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
        try:
            html = self._fetch_html(url)
        except Exception as e:
            return {"error": f"Failed to download page: {str(e)}"}

        soup = BeautifulSoup(html, "html.parser")

        # 元数据：优先 JSON-LD(schema.org)，其次 meta 标签
        json_ld = self._extract_json_ld(soup)
        author = (json_ld.get("author") or "").strip() or self._extract_meta(soup, "author")
        date = (json_ld.get("date") or "").strip() or self._extract_meta(soup, "date")

        # 正文提取：Readability 优先，失败则选择器兜底
        title, content_html = self._extract_with_readability(html)
        if not content_html or self._text_length(content_html) < 120:
            content_html = self._extract_content_by_selectors(soup)

        # AMP 兜底：很多新闻站点的 AMP 更简洁
        if not content_html or self._text_length(content_html) < 120:
            amp_url = self._extract_amp_url(soup, url)
            if amp_url:
                try:
                    amp_html = self._fetch_html(amp_url)
                    amp_title, amp_content_html = self._extract_with_readability(amp_html)
                    if amp_content_html and self._text_length(amp_content_html) >= 120:
                        title = title or amp_title
                        content_html = amp_content_html
                except Exception:
                    pass

        # 浏览器兜底（可选）：动态渲染/反爬页面
        if (not content_html or self._text_length(content_html) < 120) and self.browser_fallback:
            browser_html = self._try_fetch_with_playwright(url)
            if browser_html:
                browser_soup = BeautifulSoup(browser_html, "html.parser")
                json_ld = json_ld or self._extract_json_ld(browser_soup)
                author = author or (json_ld.get("author") or "").strip() or self._extract_meta(
                    browser_soup, "author"
                )
                date = date or (json_ld.get("date") or "").strip() or self._extract_meta(
                    browser_soup, "date"
                )
                title, content_html = self._extract_with_readability(browser_html)
                if not content_html or self._text_length(content_html) < 120:
                    content_html = self._extract_content_by_selectors(browser_soup)

        if not content_html or self._text_length(content_html) < 120:
            return {"error": "Failed to extract article content"}

        title = title or (json_ld.get("title") or "").strip() or self._extract_title(soup)

        cleaned_html, image_urls, file_urls = self._clean_and_normalize_html(
            content_html,
            base_url=url,
            include_comments=include_comments,
            include_images=include_images,
        )

        images: List[Dict[str, str]] = []
        if download_images and images_dir:
            images = self._download_images(image_urls, base_url=url, images_dir=images_dir)

        files: List[Dict[str, str]] = []
        if download_files and files_dir:
            files = self._download_files(file_urls, base_url=url, files_dir=files_dir)

        if output_format == "markdown":
            content = md(cleaned_html, heading_style="ATX", bullets="-")
        elif output_format == "html":
            content = cleaned_html
        else:  # txt
            from html2text import HTML2Text

            h = HTML2Text()
            h.ignore_links = True
            h.ignore_images = True
            content = h.handle(cleaned_html)

        if content and output_format in {"markdown", "html"}:
            if images:
                content = self._replace_asset_links(content, images)
            if files:
                content = self._replace_asset_links(content, files)

        return {
            "title": title,
            "author": author,
            "date": date,
            "url": url,
            "content": content,
            "images": images,
            "files": files,
        }

    def _fetch_html(self, url: str) -> str:
        response = self._session.get(
            url,
            timeout=self.timeout,
            headers=self._default_headers,
            allow_redirects=True,
        )
        if response.status_code >= 400:
            response.raise_for_status()

        if not response.encoding or response.encoding.lower() in {"iso-8859-1", "ascii"}:
            response.encoding = response.apparent_encoding or "utf-8"

        html = response.text
        if self.browser_fallback and self._looks_like_js_challenge(html):
            browser_html = self._try_fetch_with_playwright(url)
            if browser_html:
                return browser_html
        return html

    def _looks_like_js_challenge(self, html: str) -> bool:
        lowered = (html or "").lower()
        patterns = [
            "enable javascript",
            "please enable javascript",
            "captcha",
            "verify you are a human",
            "human verification",
            "just a moment",
            "cloudflare",
            "access denied",
        ]
        return any(p in lowered for p in patterns)

    def _try_fetch_with_playwright(self, url: str) -> Optional[str]:
        if not self._playwright_available():
            return None

        try:
            return self._fetch_html_with_playwright(url)
        except Exception:
            return None

    def _playwright_available(self) -> bool:
        try:
            import playwright  # noqa: F401

            return True
        except Exception:
            return False

    def _fetch_html_with_playwright(self, url: str) -> str:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page(user_agent=self._default_headers["User-Agent"])
                page.goto(url, wait_until="domcontentloaded", timeout=max(1_000, self.timeout * 1_000))
                try:
                    page.wait_for_load_state("networkidle", timeout=10_000)
                except Exception:
                    pass
                return page.content()
            finally:
                browser.close()

    def _extract_with_readability(self, html: str) -> Tuple[Optional[str], Optional[str]]:
        try:
            doc = Document(html)
            title = (doc.short_title() or "").strip() or None
            content_html = doc.summary(html_partial=True)
            return title, content_html
        except Exception:
            return None, None

    def _extract_amp_url(self, soup: BeautifulSoup, base_url: str) -> Optional[str]:
        link = soup.find("link", rel=lambda v: v and "amphtml" in v.lower())
        if not link:
            return None
        href = link.get("href")
        if not href:
            return None
        return urljoin(base_url, href)

    def _extract_title(self, soup: BeautifulSoup) -> Optional[str]:
        """提取文章标题"""
        h1 = soup.find("h1")
        if h1:
            return h1.get_text().strip()

        og_title = soup.find("meta", property="og:title")
        if og_title and og_title.get("content"):
            return og_title.get("content")

        title_tag = soup.find("title")
        if title_tag:
            return title_tag.get_text().strip()

        return None

    def _extract_content_by_selectors(self, soup: BeautifulSoup) -> Optional[str]:
        """提取文章主要内容区域（选择器兜底）"""
        content_div = None

        for class_name in [
            "post-content",
            "entry-content",
            "article-content",
            "content-area",
            "main-content",
            "article-body",
            "post-body",
        ]:
            content_div = soup.find("div", class_=class_name)
            if content_div:
                break

        if not content_div:
            article = soup.find("article")
            if article:
                content_div = article

        if not content_div:
            content_div = soup.find("div", role="article")

        if not content_div:
            main = soup.find("main")
            if main:
                content_div = main

        if not content_div:
            return None

        content_soup = BeautifulSoup(str(content_div), "html.parser")

        for tag in ["script", "style", "nav", "aside", "footer", "iframe", "noscript", "header"]:
            for elem in content_soup.find_all(tag):
                elem.decompose()

        classes_to_remove = [
            "author-desktop",
            "author-block",
            "author-meta",
            "author-avatar",
            "author-name",
            "author-desc",
            "sidebar",
            "related-posts",
            "share-buttons",
            "comments",
            "navigation",
            "post-navigation",
            "meta-wrap",
            "social-share",
            "ad",
            "advertisement",
        ]
        for class_name in classes_to_remove:
            for elem in content_soup.find_all(class_=class_name):
                elem.decompose()

        return str(content_soup)

    def _text_length(self, html: str) -> int:
        soup = BeautifulSoup(html or "", "html.parser")
        return len(soup.get_text(" ", strip=True))

    def _clean_and_normalize_html(
        self,
        content_html: str,
        base_url: str,
        include_comments: bool,
        include_images: bool,
    ) -> Tuple[str, List[str], List[str]]:
        content_soup = BeautifulSoup(content_html, "html.parser")

        for tag in ["script", "style", "nav", "aside", "footer", "iframe", "noscript", "header", "form"]:
            for elem in content_soup.find_all(tag):
                elem.decompose()

        if not include_comments:
            self._remove_by_keyword(
                content_soup,
                keywords=["comment", "comments", "disqus", "remark", "reply", "replies"],
            )

        # 删除常见干扰元素（订阅/弹窗/广告/遮罩）
        noisy_classes = [
            "sidebar",
            "related",
            "share",
            "social",
            "advert",
            "ad-",
            "ads",
            "promo",
            "newsletter",
            "subscribe",
            "paywall",
            "modal",
            "popup",
            "cookie",
        ]
        for elem in content_soup.find_all(True):
            classes = " ".join(elem.get("class", [])) if elem.get("class") else ""
            elem_id = elem.get("id") or ""
            signature = f"{classes} {elem_id}".lower()
            if any(c in signature for c in noisy_classes):
                elem.decompose()

        # 归一化链接 + 收集正文附件链接
        file_urls: List[str] = []
        for a in content_soup.find_all("a"):
            href = a.get("href")
            if not href:
                continue
            href = href.strip()
            if href.startswith("#") or href.lower().startswith(("javascript:", "mailto:", "tel:")):
                continue
            absolute_href = urljoin(base_url, href)
            a["href"] = absolute_href
            if self._is_probably_file_link(absolute_href, a):
                file_urls.append(absolute_href)

        # 归一化图片（懒加载/相对路径）
        image_urls: List[str] = []
        for img in content_soup.find_all("img"):
            src = self._best_image_src(img)
            if not src:
                continue
            if src.startswith("data:"):
                continue
            absolute_src = urljoin(base_url, src)
            img["src"] = absolute_src
            image_urls.append(absolute_src)

        # 去重（保序）
        image_urls = list(dict.fromkeys(image_urls))
        file_urls = list(dict.fromkeys(file_urls))

        if not include_images:
            for img in content_soup.find_all("img"):
                img.decompose()
            for picture in content_soup.find_all("picture"):
                picture.decompose()

        return str(content_soup), image_urls, file_urls

    def _is_probably_file_link(self, url: str, a_tag: Any) -> bool:
        if not url:
            return False
        try:
            if a_tag and a_tag.get("download") is not None:
                return True
        except Exception:
            pass

        parsed = urlparse(url)
        ext = os.path.splitext(parsed.path)[1].lower()
        if ext in self._guess_image_extensions():
            return False
        return ext in self._FILE_EXTENSIONS

    def _guess_image_extensions(self) -> set:
        return {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}

    def _remove_by_keyword(self, soup: BeautifulSoup, keywords: List[str]) -> None:
        lowered_keywords = [k.lower() for k in keywords]
        for elem in soup.find_all(True):
            attrs = " ".join(
                [
                    " ".join(elem.get("class", [])) if elem.get("class") else "",
                    elem.get("id") or "",
                    elem.get("role") or "",
                    elem.get("aria-label") or "",
                ]
            ).lower()
            if any(k in attrs for k in lowered_keywords):
                elem.decompose()

    def _best_image_src(self, img_tag: Any) -> Optional[str]:
        candidates = [
            img_tag.get("src"),
            img_tag.get("data-src"),
            img_tag.get("data-original"),
            img_tag.get("data-url"),
            img_tag.get("data-actualsrc"),
            img_tag.get("data-lazy-src"),
            img_tag.get("data-srcset"),
            img_tag.get("data-original-src"),
        ]
        for candidate in candidates:
            if not candidate or not isinstance(candidate, str):
                continue
            candidate = candidate.strip()
            if not candidate or self._looks_like_placeholder_image(candidate):
                continue
            return self._pick_from_srcset(candidate)

        srcset = img_tag.get("srcset")
        if srcset and isinstance(srcset, str):
            return self._pick_from_srcset(srcset)

        return None

    def _pick_from_srcset(self, value: str) -> str:
        if "," not in value:
            return value

        best_url = ""
        best_score = -1.0
        for part in value.split(","):
            part = part.strip()
            if not part:
                continue
            tokens = part.split()
            url = tokens[0]
            score = 0.0
            if len(tokens) >= 2:
                descriptor = tokens[1].strip().lower()
                if descriptor.endswith("w"):
                    try:
                        score = float(descriptor[:-1])
                    except ValueError:
                        score = 0.0
                elif descriptor.endswith("x"):
                    try:
                        score = float(descriptor[:-1]) * 1000.0
                    except ValueError:
                        score = 0.0
            if score >= best_score:
                best_score = score
                best_url = url

        return best_url or value.split(",")[0].strip().split()[0]

    def _looks_like_placeholder_image(self, url: str) -> bool:
        lowered = url.lower()
        skip_patterns = [
            "lazy_placeholder",
            "placeholder.gif",
            "pixel.gif",
            "1x1.gif",
            "blank.gif",
            "data:image/gif",
        ]
        return any(p in lowered for p in skip_patterns)

    def _extract_json_ld(self, soup: BeautifulSoup) -> Dict[str, str]:
        """从 JSON-LD(schema.org) 提取常见字段，提升兼容性"""
        result: Dict[str, str] = {}
        scripts = soup.find_all("script", type=lambda v: v and "ld+json" in v.lower())
        for script in scripts:
            raw = (script.string or script.get_text() or "").strip()
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except Exception:
                continue

            for item in self._iter_json_ld_items(data):
                if not isinstance(item, dict):
                    continue

                if "title" not in result:
                    headline = item.get("headline") or item.get("name")
                    if isinstance(headline, str) and headline.strip():
                        result["title"] = headline.strip()

                if "date" not in result:
                    date = item.get("datePublished") or item.get("dateCreated") or item.get("dateModified")
                    if isinstance(date, str) and date.strip():
                        result["date"] = date.strip()

                if "author" not in result:
                    author = item.get("author")
                    author_name: Optional[str] = None
                    if isinstance(author, dict):
                        author_name = author.get("name")
                    elif isinstance(author, list) and author:
                        first = author[0]
                        if isinstance(first, dict):
                            author_name = first.get("name")
                        elif isinstance(first, str):
                            author_name = first
                    elif isinstance(author, str):
                        author_name = author

                    if isinstance(author_name, str) and author_name.strip():
                        result["author"] = author_name.strip()

            if {"title", "author", "date"} <= set(result.keys()):
                break
        return result

    def _iter_json_ld_items(self, data: Any) -> Iterable[Any]:
        if isinstance(data, list):
            for item in data:
                yield from self._iter_json_ld_items(item)
            return
        if isinstance(data, dict):
            graph = data.get("@graph")
            if isinstance(graph, list):
                for item in graph:
                    yield item
            else:
                yield data

    def _extract_meta(self, soup: BeautifulSoup, meta_type: str) -> Optional[str]:
        """从 HTML 中提取元数据"""
        if meta_type == "author":
            author = (
                soup.find("meta", {"name": "author"})
                or soup.find("meta", {"property": "article:author"})
                or soup.find("meta", {"name": "dc.creator"})
                or soup.find("meta", {"property": "og:author"})
                or soup.find("a", rel="author")
            )
            if author:
                if author.has_attr("content"):
                    return author.get("content")
                return author.get_text().strip()
            return None

        if meta_type == "date":
            date = (
                soup.find("meta", {"property": "article:published_time"})
                or soup.find("meta", {"name": "date"})
                or soup.find("meta", {"name": "dc.date"})
                or soup.find("meta", {"property": "og:published_time"})
                or soup.find("time")
            )
            if date:
                if date.has_attr("content"):
                    return date.get("content")
                if date.has_attr("datetime"):
                    return date.get("datetime")
                return date.get("content")
            return None

        return None

    def extract_batch(
        self,
        urls: List[str],
        output_dir: str = "./output",
        download_images: bool = False,
        download_files: bool = False,
        **kwargs,
    ) -> List[Dict[str, Any]]:
        """批量提取多个网页"""
        results: List[Dict[str, Any]] = []
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {
                executor.submit(
                    self._extract_and_save,
                    url,
                    output_dir,
                    download_images,
                    download_files,
                    **kwargs,
                ): url
                for url in urls
            }

            for future in as_completed(futures):
                url = futures[future]
                try:
                    results.append(future.result())
                except Exception as e:
                    results.append({"url": url, "error": str(e)})

        return results

    def _extract_and_save(
        self,
        url: str,
        output_dir: str,
        download_images: bool,
        download_files: bool,
        **kwargs,
    ) -> Dict[str, Any]:
        """提取并保存到文件"""
        images_dir = None
        if download_images:
            url_hash = hashlib.md5(url.encode("utf-8")).hexdigest()[:8]
            images_dir = os.path.join(output_dir, f"images_{url_hash}")
            os.makedirs(images_dir, exist_ok=True)

        files_dir = None
        if download_files:
            url_hash = hashlib.md5(url.encode("utf-8")).hexdigest()[:8]
            files_dir = os.path.join(output_dir, f"files_{url_hash}")
            os.makedirs(files_dir, exist_ok=True)

        result = self.extract(
            url,
            download_images=download_images,
            images_dir=images_dir,
            download_files=download_files,
            files_dir=files_dir,
            **kwargs,
        )
        if result.get("error"):
            return result

        title = result.get("title") or "untitled"
        safe_title = re.sub(r'[\\/*?:"<>|]', "_", title)[:50]
        filename = f"{safe_title}.md"
        filepath = os.path.join(output_dir, filename)

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(f"# {result.get('title') or safe_title}\n\n")
            if result.get("author"):
                f.write(f"**作者**: {result['author']}\n\n")
            if result.get("date"):
                f.write(f"**日期**: {result['date']}\n\n")
            f.write(f"**来源**: {result['url']}\n\n")
            f.write("---\n\n")
            f.write(result["content"])

        result["saved_to"] = filepath
        return result

    def _download_images(self, image_urls: List[str], base_url: str, images_dir: str) -> List[Dict[str, str]]:
        """下载正文中的图片"""
        downloaded: List[Dict[str, str]] = []
        seen_urls = set()
        images_dir_name = os.path.basename(os.path.normpath(images_dir))

        for i, absolute_url in enumerate(image_urls):
            if not absolute_url or absolute_url.startswith("data:"):
                continue
            if self._looks_like_placeholder_image(absolute_url):
                continue
            if absolute_url in seen_urls:
                continue
            seen_urls.add(absolute_url)

            try:
                response = self._session.get(
                    absolute_url,
                    timeout=10,
                    stream=True,
                    headers={**self._default_headers, "Referer": base_url},
                )
                if response.status_code != 200:
                    continue

                content_type = (response.headers.get("content-type", "") or "").split(";")[0].strip().lower()
                if not content_type.startswith("image/") and not self._guess_extension_from_url(absolute_url):
                    continue

                img_data = response.content
                if content_type != "image/svg+xml":
                    try:
                        Image.open(io.BytesIO(img_data))
                    except Exception:
                        continue

                ext = self._get_image_extension(content_type) or self._guess_extension_from_url(absolute_url) or ".jpg"
                filename = f"image_{i + 1}{ext}"
                filepath = os.path.join(images_dir, filename)

                with open(filepath, "wb") as f:
                    f.write(img_data)

                downloaded.append(
                    {
                        "original_url": absolute_url,
                        "local_path": os.path.join(images_dir_name, filename),
                        "filename": filename,
                    }
                )
            except Exception:
                continue

        return downloaded

    def _download_files(self, file_urls: List[str], base_url: str, files_dir: str) -> List[Dict[str, str]]:
        """下载正文中的附件（PDF/Office/压缩包等）"""
        downloaded: List[Dict[str, str]] = []
        seen_urls = set()
        used_filenames = set()
        files_dir_name = os.path.basename(os.path.normpath(files_dir))

        for i, absolute_url in enumerate(file_urls):
            if not absolute_url or absolute_url.startswith("data:"):
                continue
            if absolute_url in seen_urls:
                continue
            seen_urls.add(absolute_url)

            try:
                response = self._session.get(
                    absolute_url,
                    timeout=20,
                    stream=True,
                    headers={**self._default_headers, "Referer": base_url},
                )
                if response.status_code != 200:
                    continue

                content_type = (response.headers.get("content-type", "") or "").split(";")[0].strip().lower()
                if content_type.startswith("text/html") and self._guess_extension_from_url(absolute_url) == "":
                    # 很多普通网页链接也会被误判，避免下载 HTML 页面
                    continue

                filename = self._filename_from_response(response, absolute_url) or f"file_{i + 1}"
                filename = self._sanitize_filename(filename)
                if not os.path.splitext(filename)[1]:
                    ext = self._guess_file_extension(content_type) or os.path.splitext(urlparse(absolute_url).path)[1]
                    if ext:
                        filename = f"{filename}{ext}"

                filename = self._dedupe_filename(filename, used_filenames)

                filepath = os.path.join(files_dir, filename)
                with open(filepath, "wb") as f:
                    f.write(response.content)

                downloaded.append(
                    {
                        "original_url": absolute_url,
                        "local_path": os.path.join(files_dir_name, filename),
                        "filename": filename,
                    }
                )
            except Exception:
                continue

        return downloaded

    def _get_image_extension(self, content_type: str) -> str:
        mapping = {
            "image/jpg": ".jpg",
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/gif": ".gif",
            "image/webp": ".webp",
            "image/svg+xml": ".svg",
        }
        return mapping.get((content_type or "").split(";")[0].strip().lower(), "")

    def _guess_extension_from_url(self, url: str) -> str:
        try:
            path = urlparse(url).path
        except Exception:
            return ""
        ext = os.path.splitext(path)[1].lower()
        if ext in self._guess_image_extensions():
            return ".jpg" if ext == ".jpeg" else ext
        return ""

    def _guess_file_extension(self, content_type: str) -> str:
        mapping = {
            "application/pdf": ".pdf",
            "application/zip": ".zip",
            "application/x-zip-compressed": ".zip",
            "application/x-rar-compressed": ".rar",
            "application/vnd.ms-powerpoint": ".ppt",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
            "application/msword": ".doc",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
            "application/vnd.ms-excel": ".xls",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
            "text/plain": ".txt",
            "text/markdown": ".md",
            "text/csv": ".csv",
            "application/json": ".json",
        }
        return mapping.get((content_type or "").split(";")[0].strip().lower(), "")

    def _filename_from_response(self, response: requests.Response, url: str) -> Optional[str]:
        cd = response.headers.get("content-disposition", "") or response.headers.get("Content-Disposition", "") or ""
        if cd:
            match = re.search(r"filename\\*=UTF-8''([^;]+)", cd, flags=re.IGNORECASE)
            if match:
                return unquote(match.group(1)).strip().strip('"').strip("'")
            match = re.search(r'filename=\"?([^\";]+)\"?', cd, flags=re.IGNORECASE)
            if match:
                return match.group(1).strip()

        try:
            path = urlparse(url).path
            name = os.path.basename(path)
            return unquote(name) if name else None
        except Exception:
            return None

    def _sanitize_filename(self, name: str) -> str:
        name = (name or "").strip()
        if not name:
            return "file"
        name = name.replace("\x00", "")
        name = re.sub(r"[\\/:*?\"<>|]", "_", name)
        name = re.sub(r"\s+", " ", name).strip()
        return name[:120] or "file"

    def _dedupe_filename(self, filename: str, used: set) -> str:
        if filename not in used:
            used.add(filename)
            return filename
        base, ext = os.path.splitext(filename)
        for i in range(2, 1000):
            candidate = f"{base}_{i}{ext}"
            if candidate not in used:
                used.add(candidate)
                return candidate
        fallback = f"{base}_{hashlib.md5(filename.encode('utf-8')).hexdigest()[:6]}{ext}"
        used.add(fallback)
        return fallback

    def _replace_asset_links(self, content: str, assets: List[Dict[str, str]]) -> str:
        """替换 Markdown/HTML 中的资源链接为本地路径"""
        for asset in assets:
            content = content.replace(asset["original_url"], asset["local_path"])
        return content
