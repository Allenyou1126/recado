/**
 * 渲染管线的安全回归测试。
 *
 * 这是 P0 红线对应的测试：评论只经服务端 Unified.js 管线渲染，**渲染后必须过
 * `rehype-sanitize`**。这里预置一批 XSS payload，逐条断言产物里不出现危险构造；
 * 同时断言合法 Markdown 不被误伤 —— 消毒过头的评论区同样不可用。
 */

import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './rendering.service';

/**
 * 产物里**绝不允许**出现的构造。
 *
 * 说明：这里检查的是最终 HTML 字符串。以下 payload 里的原始 HTML 会被
 * `remark-rehype`（allowDangerousHtml 默认关闭）直接丢掉，链接协议会被
 * 白名单过滤，因此不会出现「危险文本仍在但已成无害转义」的误报。
 */
const DANGEROUS_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'script 标签', pattern: /<script/i },
  { label: 'iframe 标签', pattern: /<iframe/i },
  { label: 'object 标签', pattern: /<object/i },
  { label: 'embed 标签', pattern: /<embed/i },
  { label: 'form 标签', pattern: /<form/i },
  { label: 'base 标签', pattern: /<base/i },
  { label: 'style 标签', pattern: /<style/i },
  { label: 'link 标签', pattern: /<link/i },
  { label: 'meta 标签', pattern: /<meta/i },
  { label: 'svg onload', pattern: /<svg/i },
  { label: '事件处理属性', pattern: /\son[a-z]+\s*=/i },
  { label: 'javascript: 协议', pattern: /javascript:/i },
  { label: 'vbscript: 协议', pattern: /vbscript:/i },
  { label: 'data:text/html', pattern: /data:text\/html/i },
  { label: 'srcdoc', pattern: /srcdoc\s*=/i },
];

/** 原始 HTML 注入：这些 payload 应当被整体丢弃 */
const HTML_INJECTION_PAYLOADS = [
  '<script>alert(1)</script>',
  '<SCRIPT SRC=https://evil.example/x.js></SCRIPT>',
  '<img src=x onerror=alert(1)>',
  '<img src="x" onerror="alert(1)">',
  '<svg/onload=alert(1)>',
  '<svg><animate onbegin=alert(1) attributeName=x dur=1s>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><input type=submit></form>',
  '<base href="javascript:alert(1)//">',
  '<style>@import "https://evil.example/x.css";</style>',
  '<link rel=stylesheet href="https://evil.example/x.css">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<a href="javascript:alert(1)">点我</a>',
  '<math><mtext><script>alert(1)</script></mtext></math>',
  '<textarea></textarea><script>alert(1)</script>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<details open ontoggle=alert(1)>',
  '<div style="background:url(javascript:alert(1))">x</div>',
];

/** Markdown 链接协议注入 */
const LINK_PROTOCOL_PAYLOADS = [
  '[点我](javascript:alert(1))',
  '[点我](JaVaScRiPt:alert(1))',
  '[点我](vbscript:msgbox(1))',
  '[点我](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '![图](javascript:alert(1))',
  '[点我](java\u0000script:alert(1))',
];

describe('XSS payload 全部被消毒', () => {
  it.each(HTML_INJECTION_PAYLOADS)('原始 HTML 被丢弃：%s', async (payload) => {
    const result = await renderMarkdown(payload);

    expect(result.error).toBeNull();
    const html = result.data?.html ?? '';

    for (const { label, pattern } of DANGEROUS_PATTERNS) {
      expect(html, `${label} 出现在产物里：${html}`).not.toMatch(pattern);
    }
  });

  it.each(LINK_PROTOCOL_PAYLOADS)('危险协议被剥掉：%s', async (payload) => {
    const result = await renderMarkdown(payload);

    expect(result.error).toBeNull();
    const html = result.data?.html ?? '';

    for (const { label, pattern } of DANGEROUS_PATTERNS) {
      expect(html, `${label} 出现在产物里：${html}`).not.toMatch(pattern);
    }
  });

  it('代码块里的危险内容被转义，不会成为真元素', async () => {
    const result = await renderMarkdown(
      '```html\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n```',
    );

    const html = result.data?.html ?? '';
    expect(html).not.toContain('<script>');
    // shiki 用数字实体转义 `<`
    expect(html).toContain('&#x3C;');
  });

  it('实体编码的 payload 只是文本，不会被解码成标签', async () => {
    const html = (await renderMarkdown('&lt;script&gt;alert(1)&lt;/script&gt;')).data?.html ?? '';

    // 序列化器用数字实体转义 `<`，因此看到的是 &#x3C; 而不是 &lt;
    expect(html).toContain('&#x3C;script');
    expect(html).not.toContain('<script');
  });

  it('表情与提及不会成为注入通道', async () => {
    const html =
      (
        await renderMarkdown(':evil: @<script>alert(1)</script>', {
          emojis: { evil: 'javascript:alert(1)' },
        })
      ).data?.html ?? '';

    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toContain('<script');
  });
});

describe('合法 Markdown 不被误伤', () => {
  it('保留标题、强调、列表、引用、表格与任务列表', async () => {
    const html =
      (
        await renderMarkdown(
          [
            '# 标题',
            '',
            '**加粗** 与 *斜体* 与 ~~删除线~~',
            '',
            '- 项目一',
            '- [x] 已完成',
            '',
            '> 引用',
            '',
            '| 列 A | 列 B |',
            '| --- | --- |',
            '| 1 | 2 |',
          ].join('\n'),
        )
      ).data?.html ?? '';

    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('<em>斜体</em>');
    expect(html).toContain('<del>删除线</del>');
    expect(html).toContain('<li>项目一</li>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<table>');
  });

  it('保留代码块、公式、表情、外链与提及', async () => {
    const result = await renderMarkdown(
      '```js\nconst a = 1;\n```\n\n$x^2$\n\n:smile:\n\n[外站](https://example.com)\n\n@alice',
    );
    const html = result.data?.html ?? '';

    expect(html).toContain('class="shiki');
    expect(html).toContain('<mjx-container');
    expect(html).toContain('class="emoji"');
    expect(html).toContain('rel="nofollow ugc noopener noreferrer"');
    expect(result.data?.mentions).toEqual(['alice']);
  });

  it('保留中文、换行与长单词的完整性', async () => {
    const html =
      (
        await renderMarkdown(
          '中文段落。\n第二行。\n\nhttps://example.com/a/very/long/path?with=query&and=more',
        )
      ).data?.html ?? '';

    expect(html).toContain('中文段落。');
    expect(html).toContain('第二行。');
    // GFM 自动链接：地址被识别成链接，路径本身不被截断
    expect(html).toContain('example.com/a/very/long/path');
    expect(html).toContain('<a href=');
  });
});

describe('渲染是纯函数', () => {
  it('同一输入重复渲染，产物逐字节一致', async () => {
    const input = '# 标题\n\n```js\nconst a = 1;\n```\n\n$x^2$ :smile:';

    const first = await renderMarkdown(input);
    const second = await renderMarkdown(input);

    expect(second.data?.html).toBe(first.data?.html);
    expect(second.data?.mentions).toEqual(first.data?.mentions);
    expect(second.data?.bytes).toBe(first.data?.bytes);
  });

  it('前一次渲染不会污染后一次（无跨请求状态）', async () => {
    const withMentions = await renderMarkdown('@alice 你好');
    const without = await renderMarkdown('你好');

    expect(withMentions.data?.mentions).toEqual(['alice']);
    expect(without.data?.mentions).toEqual([]);
  });

  it('站点配置只影响本次渲染', async () => {
    const custom = await renderMarkdown(':smile:', {
      emojis: { smile: 'https://cdn.example.com/x.png' },
    });
    const builtin = await renderMarkdown(':smile:');

    expect(custom.data?.html).toContain('cdn.example.com');
    expect(builtin.data?.html).toContain('twemoji');
  });
});
