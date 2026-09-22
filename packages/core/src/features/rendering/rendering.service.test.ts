import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './rendering.service';

async function render(markdown: string) {
  const result = await renderMarkdown(markdown);

  expect(result.error).toBeNull();
  if (result.error) throw new Error(result.error.reason);

  return result.data;
}

describe('renderMarkdown', () => {
  it('渲染基础 Markdown', async () => {
    const { html } = await render('# 标题\n\n段落 **加粗** 与 *斜体*');

    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('<em>斜体</em>');
  });

  it('支持 GFM（表格、删除线、任务列表、自动链接）', async () => {
    const { html } = await render(
      [
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '~~删除~~',
        '',
        '- [x] 完成',
        '',
        'https://example.com',
      ].join('\n'),
    );

    expect(html).toContain('<table>');
    expect(html).toContain('<del>删除</del>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<a href="https://example.com"');
  });

  it('空内容返回 VALIDATION_CONTENT_EMPTY', async () => {
    const result = await renderMarkdown('   \n  ');

    expect(result.error?.reason).toBe('VALIDATION_CONTENT_EMPTY');
  });

  it('返回原文字节数（UTF-8），供 comments.content_bytes 使用', async () => {
    const { bytes } = await render('中文 abc');

    // 2 个中文字 × 3 字节 + 空格 + 3 个 ASCII
    expect(bytes).toBe(6 + 1 + 3);
  });

  it('原始 HTML 不进入 AST —— 第一道闸门', async () => {
    const { html } = await render('<script>alert(1)</script>\n\n<div onclick="x()">raw</div>');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<div');
  });
});
