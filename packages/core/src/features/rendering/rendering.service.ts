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
 *   remark-rehype          mdast → hast（allowDangerousHtml 默认关闭：原文里的
 *                          原始 HTML 根本不会进入 AST，这是第一道闸门）
 *   rehype-sanitize        白名单消毒（**用默认 schema，不为渲染插件放宽任何规则**）
 *   [rehype-shiki]         代码高亮（T2.2，可信插件）
 *   [rehype-mathjax]       数学公式（T2.3，可信插件）
 *   rehype-stringify       hast → HTML
 * ```
 *
 * 为什么消毒放在「用户内容转换之后、可信插件之前」而不是最后：
 * Shiki 的 `<span style="color:…">` 与 MathJax 的 SVG 需要大量元素与属性，
 * 放到最后就必须放宽白名单，反而扩大攻击面。用户内容在进入这些插件之前
 * 已经过默认白名单消毒，而原始 HTML 从一开始就进不了 AST —— 因此
 * 「消毒在最外层」与「消毒在最严格处」在这里是同一个位置。
 */

import { err, ok, type Result } from '@recado/shared';
import rehypeShiki from '@shikijs/rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

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
const PRELOADED_LANGUAGES: string[] = [];

/** shiki 用于「无高亮纯文本」的内置特殊语言 */
const PLAIN_TEXT = 'text';

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

  processor.use(remarkRehype);
  processor.use(rehypeSanitize);

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
