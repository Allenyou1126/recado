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

describe('代码高亮（T2.2）', () => {
  it('已知语言产出带内联样式的 Shiki 输出', async () => {
    const { html } = await render('```js\nconst answer = 42;\n```');

    expect(html).toContain('class="shiki');
    expect(html).toContain('style="color:');
    expect(html).toContain('answer');
  });

  it('未知语言降级为纯文本：保留代码块与转义，但不做着色', async () => {
    const { html } = await render('```not-a-real-language\nplain <b>text</b>\n```');

    expect(html).toContain('plain');
    // 没有 `style="color:…"` 这类着色标记
    expect(html).not.toContain('style="color:');
    expect(html).not.toContain('<b>');
  });

  it('无语言标注的代码块也能给出稳定输出', async () => {
    const { html } = await render('```\nplain\n```');

    expect(html).toContain('plain');
  });

  it('行内代码不参与高亮', async () => {
    const { html } = await render('这里是 `inline()` 代码');

    expect(html).toContain('<code>inline()</code>');
    expect(html).not.toContain('class="shiki');
  });

  it('codeHighlight=false 时原样输出代码块', async () => {
    const result = await renderMarkdown('```js\nconst a = 1;\n```', { codeHighlight: false });

    expect(result.error).toBeNull();
    expect(result.data?.html).toContain('<pre><code class="language-js">');
    expect(result.data?.html).not.toContain('class="shiki');
  });

  it('高亮产物不会绕过消毒——代码内容始终被转义', async () => {
    const { html } = await render('```html\n<script>alert(1)</script>\n```');

    expect(html).not.toContain('<script>');
    // shiki 用数字实体转义 `<`，同样是安全的
    expect(html).toContain('&#x3C;');
  });
});

describe('数学公式（T2.3）', () => {
  it('行内公式渲染为自包含的 SVG', async () => {
    const { html } = await render('质能方程 $E = mc^2$ 很简洁');

    expect(html).toContain('<mjx-container');
    expect(html).toContain('<svg');
    expect(html).not.toContain('$E = mc^2$');
  });

  it('块级公式同样渲染', async () => {
    const { html } = await render('$$\n\\int_0^1 x^2 dx\n$$');

    expect(html).toContain('<mjx-container');
    expect(html).toContain('display="true"');
  });

  it('公式里的 HTML 不会逃逸成真元素', async () => {
    const { html } = await render('$\\text{<script>alert(1)</script>}$');

    expect(html).not.toContain('<script>');
  });

  it('math=false 时不解析公式，按普通文本处理', async () => {
    const result = await renderMarkdown('质能方程 $E = mc^2$', { math: false });

    expect(result.error).toBeNull();
    expect(result.data?.html).not.toContain('<mjx-container');
    expect(result.data?.html).toContain('$E = mc^2$');
  });
});

describe('表情短代码（T2.4）', () => {
  it('内置表情渲染成 img.emoji', async () => {
    const { html } = await render('你好 :smile: 世界');

    expect(html).toContain('<img class="emoji"');
    expect(html).toContain('alt=":smile:"');
    expect(html).toContain('twemoji');
  });

  it('站点自定义表情覆盖同名内置项，并可追加新名字', async () => {
    const result = await renderMarkdown(':smile: :party_parrot:', {
      emojis: {
        smile: 'https://cdn.example.com/smile.png',
        party_parrot: '/emoji/parrot.gif',
      },
    });

    expect(result.data?.html).toContain('src="https://cdn.example.com/smile.png"');
    expect(result.data?.html).toContain('src="/emoji/parrot.gif"');
  });

  it('未知短代码原样保留，不会被吞掉', async () => {
    const { html } = await render('这个 :not_an_emoji: 应保持原样');

    expect(html).toContain(':not_an_emoji:');
    expect(html).not.toContain('<img');
  });

  it('代码块与行内代码里的短代码不会被替换', async () => {
    const { html } = await render('` :smile: `\n\n```text\n:smile:\n```');

    expect(html).not.toContain('<img');
    expect(html).toContain(':smile:');
  });

  it('危险协议的表情地址被丢弃，不给 XSS 留口子', async () => {
    const result = await renderMarkdown(':evil:', {
      emojis: { evil: 'javascript:alert(1)' },
    });

    expect(result.data?.html).not.toContain('<img');
    expect(result.data?.html).toContain(':evil:');
  });
});

describe('外链处理（T2.5）', () => {
  it('站外链接补上 rel', async () => {
    const { html } = await render('[外站](https://example.com/post)');

    expect(html).toContain('rel="nofollow ugc noopener noreferrer"');
  });

  it('站内相对链接与锚点不加 rel', async () => {
    const { html } = await render('[站内](/posts/1) 与 [锚点](#section)');

    expect(html).not.toContain('rel=');
  });

  it('GFM 自动链接同样被处理', async () => {
    const { html } = await render('见 https://example.com/auto');

    expect(html).toContain('rel="nofollow ugc noopener noreferrer"');
  });

  it('linkNofollow=false 时不加 rel', async () => {
    const result = await renderMarkdown('[外站](https://example.com)', { linkNofollow: false });

    expect(result.data?.html).not.toContain('rel=');
  });

  it('javascript: 链接被消毒掉，不会因为补 rel 而复活', async () => {
    const { html } = await render('[点我](javascript:alert(1))');

    expect(html).not.toContain('javascript:');
  });
});
