/**
 * 渲染管线 —— Markdown → 安全 HTML 的**唯一**权威实现。
 *
 * 为什么强调「唯一」：Waline 同时存在服务端 markdown-it 与客户端 marked 两条管线，
 * 二者会分歧（研究报告 §6.3 #2）。本项目只保留这一条，预览端点与落库渲染
 * 复用同一函数，保证「预览所见即最终所得」。
 *
 * 管线与顺序：
 *
 * ```
 * remark-parse             Markdown → mdast
 *   remark-gfm             GFM 扩展
 *   remark-math            `$…$` / `$$…$$` → math 节点
 *   remark-rehype          mdast → hast（allowDangerousHtml 默认关闭：原文里的
 *                          原始 HTML 根本不会进入 AST，这是第一道闸门）
 *   rehype-emoji           `:name:` → `<img class="emoji">`（T2.4）
 *   rehype-external-links  站外链接补 rel（T2.5）
 *   rehype-sanitize        白名单消毒（**默认 schema，一条都不放宽**）
 *   [rehype-mathjax]       数学公式（T2.3，可信插件；必须排在 Shiki 之前，见下）
 *   [rehype-shiki]         代码高亮（T2.2，可信插件）
 *   rehype-stringify       hast → HTML
 * ```
 *
 * 为什么消毒放在「用户内容转换之后、可信插件之前」而不是最后：
 * Shiki 的 `<span style="color:…">` 与 MathJax 的 SVG 需要大量元素与属性，
 * 放到最后就必须放宽白名单，反而扩大攻击面。用户内容在进入这些插件之前
 * 已经过白名单消毒，而原始 HTML 从一开始就进不了 AST —— 因此
 * 「消毒在最外层」与「消毒在最严格处」在这里是同一个位置。
 *
 * ⚠️ MathJax 必须排在 Shiki **之前**：remark-math 的块级公式经 remark-rehype
 * 会变成 `<pre><code class="language-math">`，与代码块同形。若 Shiki 先跑，
 * 它会把这个代码块当成 `math` 语言去高亮并替换掉外层 `<pre>`，MathJax 就再也
 * 找不到目标节点（未知语言会静默退化成纯文本，这是个很难察觉的坑）。
 */

import { err, ok, type Result } from '@recado/shared';
import rehypeShiki from '@shikijs/rehype';
import { defaultSchema, type Schema } from 'hast-util-sanitize';
import rehypeMathjax from 'rehype-mathjax/svg';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import type { BuiltinLanguage } from 'shiki';
import { unified } from 'unified';

import { resolveEmojiMap, rehypeEmoji } from './emoji';
import { rehypeExternalLinks } from './links';
import { RenderErrors, type RenderError } from './rendering.errors';
import {
  RenderOptionsSchema,
  type RenderOptions,
  type RenderOptionsInput,
  type RenderedContent,
} from './rendering.schema';

/**
 * 代码高亮主题。
 *
 * 输出内联样式（`style="color:…"`），前端**无需**引入任何 CSS ——
 * 这是 Headless 交付形态下的正确取舍：站点不该为了看评论去装 Shiki 的样式表。
 */
export const CODE_THEME = 'github-light';

/** 语言包按需加载的初始集合：一个都不预加载（需求 Q-09：否则构建产物会明显膨胀） */
const PRELOADED_LANGUAGES: BuiltinLanguage[] = [];

/** shiki 用于「无高亮纯文本」的内置特殊语言 */
const PLAIN_TEXT = 'text';

/**
 * 消毒白名单：默认 schema + 一条与安全无关的必要补充。
 *
 * 补两条我们自己生成的属性，值都是固定字面量，调用方无从借此注入：
 *
 * - `img` 的 `className=emoji`：默认白名单不允许 img 带 className，
 *   不补就会被静默剥掉，前端无法给表情单独设样式
 * - `a` 的 `rel`：默认白名单允许 href 但不含 rel，不补外链的
 *   `nofollow ugc noopener noreferrer` 会被丢掉
 *
 * 除此之外不放宽任何规则，`src`/`href` 仍受默认的协议白名单约束。
 */
export const SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.['img'] ?? []), ['className', 'emoji']],
    // 外链的 rel 由上面的插件写入，默认白名单不含它
    a: [...(defaultSchema.attributes?.['a'] ?? []), 'rel'],
  },
};

/** 原文字节数（UTF-8），与 `comments.content_bytes` 同口径 */
export function contentBytes(markdown: string): number {
  return new TextEncoder().encode(markdown).length;
}

/**
 * 组装处理链。
 *
 * 每次调用新建一个 processor：unified 的 processor 冻结后不能再 `.use()`，
 * 而站点级配置（是否高亮、是否渲染公式）是按请求变化的。
 * 真正的重活（Shiki highlighter）由插件内部的单例缓存兜住，不受影响。
 */
export function buildProcessor(options: RenderOptions) {
  const processor = unified().use(remarkParse);

  if (options.gfm) {
    processor.use(remarkGfm);
  }

  if (options.math) {
    processor.use(remarkMath);
  }

  processor.use(remarkRehype);
  processor.use(rehypeEmoji, resolveEmojiMap(options.emojis));

  if (options.linkNofollow) {
    processor.use(rehypeExternalLinks);
  }

  processor.use(rehypeSanitize, SANITIZE_SCHEMA);

  if (options.math) {
    // SVG 输出是自包含的：不依赖 MathJax 的 CSS 或字体，适合 Headless 交付
    processor.use(rehypeMathjax);
  }

  if (options.codeHighlight) {
    processor.use(rehypeShiki, {
      // 语言包在遇到代码块时按需 import，未知语言按 fallbackLanguage 退化为纯文本
      lazy: true,
      langs: PRELOADED_LANGUAGES,
      theme: CODE_THEME,
      defaultLanguage: PLAIN_TEXT,
      fallbackLanguage: PLAIN_TEXT,
      // 单个代码块高亮失败（例如语言包加载失败）时保留原样的代码块，
      // 不能让一条评论的代码块拖垮整个渲染
      onError: () => {},
    });
  }

  return processor.use(rehypeStringify);
}

/**
 * 把 Markdown 渲染成已消毒的 HTML。
 *
 * @param markdown 用户提交的原文（权威数据，始终先落库再渲染）
 */
export async function renderMarkdown(
  markdown: string,
  options: RenderOptionsInput = {},
): Promise<Result<RenderedContent, RenderError>> {
  const resolved = RenderOptionsSchema.parse(options);
  const bytes = contentBytes(markdown);

  if (markdown.trim().length === 0) {
    return err(RenderErrors.empty());
  }

  try {
    const file = await buildProcessor(resolved).process(markdown);

    return ok({
      html: String(file),
      mentions: [],
      bytes,
    });
  } catch {
    // 底层库的错误信息可能带实现细节，只记类型不往外抛
    return err(RenderErrors.failed());
  }
}
