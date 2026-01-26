/**
 * 飞书文档导出 Bookmarklet
 * 基础版本：仅导出文本内容为 Markdown
 */
(function () {
  'use strict';

  // 检测是否在飞书文档页面
  function isLarkDocPage() {
    return (
      window.location.hostname.includes('feishu.cn') ||
      window.location.hostname.includes('larksuite.com')
    );
  }

  // 检测是否是新版文档（docx）
  function isDocx() {
    return window.PageMain !== undefined;
  }

  // 显示提示信息
  function showMessage(message, type = 'info') {
    const colors = {
      info: '#3b82f6',
      success: '#22c55e',
      error: '#ef4444',
      warning: '#f59e0b',
    };

    const div = document.createElement('div');
    div.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${colors[type]};
      color: white;
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 999999;
      font-family: sans-serif;
      font-size: 14px;
      max-width: 400px;
      animation: slideIn 0.3s ease-out;
    `;
    div.textContent = message;
    document.body.appendChild(div);

    setTimeout(() => {
      div.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => div.remove(), 300);
    }, 3000);
  }

  // 下载文件
  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 提取文档标题
  function getDocTitle() {
    try {
      const titleEl = document.querySelector('.doc-title') ||
                      document.querySelector('[data-testid="doc-title"]') ||
                      document.querySelector('h1');
      return titleEl ? titleEl.textContent.trim() : '飞书文档';
    } catch {
      return '飞书文档';
    }
  }

  // 简单的文本提取（不依赖 PageMain）
  function extractSimpleText() {
    try {
      // 尝试获取主要内容区域
      const contentEl = document.querySelector('.docs-reader') ||
                        document.querySelector('.bear-web-x-container') ||
                        document.querySelector('[role="main"]');

      if (!contentEl) {
        throw new Error('无法找到文档内容区域');
      }

      let markdown = '';
      const title = getDocTitle();
      markdown += `# ${title}\n\n`;

      // 遍历子元素提取文本
      const walker = document.createTreeWalker(
        contentEl,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let text = '';
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement && !node.parentElement.closest('script, style')) {
          const content = node.textContent.trim();
          if (content) {
            text += content + '\n';
          }
        }
      }

      markdown += text;
      return markdown;
    } catch (error) {
      throw new Error('文本提取失败：' + error.message);
    }
  }

  // 使用 PageMain 提取（如果可用）
  function extractWithPageMain() {
    try {
      if (!window.PageMain || !window.PageMain.blockManager) {
        throw new Error('无法访问 PageMain');
      }

      const rootBlock = window.PageMain.blockManager.rootBlockModel;
      if (!rootBlock) {
        throw new Error('无法获取文档内容');
      }

      let markdown = '';
      const title = getDocTitle();
      markdown += `# ${title}\n\n`;

      // 简化版：只提取文本内容
      function extractBlock(block) {
        let text = '';

        // 提取当前块的文本
        if (block.zoneState && block.zoneState.allText) {
          text += block.zoneState.allText + '\n';
        }

        // 递归处理子块
        if (block.children && Array.isArray(block.children)) {
          for (const child of block.children) {
            text += extractBlock(child);
          }
        }

        return text;
      }

      markdown += extractBlock(rootBlock);
      return markdown;
    } catch (error) {
      throw new Error('PageMain 提取失败：' + error.message);
    }
  }

  // 主函数
  function main() {
    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
      }
    `;
    document.head.appendChild(style);

    // 检查是否在飞书页面
    if (!isLarkDocPage()) {
      showMessage('这不是飞书文档页面', 'error');
      return;
    }

    showMessage('正在提取文档内容...', 'info');

    try {
      let markdown;

      // 优先尝试使用 PageMain
      if (isDocx()) {
        try {
          markdown = extractWithPageMain();
        } catch (error) {
          console.warn('PageMain 提取失败，降级到简单文本提取:', error);
          markdown = extractSimpleText();
        }
      } else {
        // 旧版文档或其他页面
        markdown = extractSimpleText();
      }

      // 下载文件
      const filename = `${getDocTitle()}_${Date.now()}.md`;
      downloadFile(markdown, filename);

      showMessage('✓ 导出成功！已开始下载', 'success');
    } catch (error) {
      console.error('导出失败:', error);
      showMessage(`导出失败：${error.message}`, 'error');

      // 提示使用扩展
      setTimeout(() => {
        const useExtension = confirm(
          '建议安装 Cloud Document Converter 扩展以获得完整功能（图片、附件、表格等）。\n\n是否前往下载？'
        );
        if (useExtension) {
          window.open('https://github.com/whale4113/cloud-document-converter', '_blank');
        }
      }, 500);
    }
  }

  // 执行
  main();
})();
