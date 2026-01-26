"""Web to Markdown - Extract article content from web pages"""

__version__ = "0.1.0"

from .extractor import WebExtractor

__all__ = ["WebExtractor", "main"]


def main() -> None:
    # 延迟导入，避免把 CLI 依赖强绑到库导入路径
    from .__main__ import main as _main

    _main()
