/**
 * 表情短代码：`:name:` → `<img class="emoji">`。
 *
 * 设计要点：
 *
 * - 替换发生在 **hast 文本节点**上（不是字符串替换），因此代码块与行内代码里的
 *   `:name:` 不会被误伤 —— 它们的内容在 `<code>` 里，插件会跳过
 * - 未知短代码**原样保留**文本，不做任何猜测；短代码名也不会被用来拼接 URL，
 *   只作为查表的键
 * - 自定义表情包的 URL 只接受 `http` / `https` 绝对地址或以 `/` 开头的站内路径，
 *   其余（`javascript:`、`data:` 等）一律丢弃
 *
 * 内置表情包指向 Twemoji 的 jsDelivr 镜像（CC-BY 4.0）。站点可在
 * `sites.settings.emojis` 里覆盖同名项或追加自己的表情，无需重新部署。
 */

import type { Element, ElementContent, Root, Text } from 'hast';
import { visit } from 'unist-util-visit';

import type { EmojiMap } from './rendering.schema';

const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg';

const twemoji = (code: string): string => `${TWEMOJI_BASE}/${code}.svg`;

/** 内置表情包（可被站点配置覆盖） */
export const BUILTIN_EMOJIS: EmojiMap = {
  smile: twemoji('1f604'),
  grin: twemoji('1f601'),
  joy: twemoji('1f602'),
  rofl: twemoji('1f923'),
  wink: twemoji('1f609'),
  thinking: twemoji('1f914'),
  cry: twemoji('1f622'),
  angry: twemoji('1f620'),
  surprised: twemoji('1f62e'),
  heart: twemoji('2764'),
  thumbsup: twemoji('1f44d'),
  thumbsdown: twemoji('1f44e'),
  clap: twemoji('1f44f'),
  pray: twemoji('1f64f'),
  muscle: twemoji('1f4aa'),
  wave: twemoji('1f44b'),
  ok_hand: twemoji('1f44c'),
  eyes: twemoji('1f440'),
  tada: twemoji('1f389'),
  fire: twemoji('1f525'),
  rocket: twemoji('1f680'),
  sparkles: twemoji('2728'),
  star: twemoji('2b50'),
  check: twemoji('2714'),
  cross: twemoji('274c'),
  warning: twemoji('26a0'),
  bulb: twemoji('1f4a1'),
  coffee: twemoji('2615'),
};

/** `:name:` 短代码；名字限定为小写字母、数字、下划线、加号与连字符 */
const SHORTCODE_PATTERN = /:([a-z0-9_+-]+):/g;

/** 合并内置包与站点自定义包（同名覆盖） */
export function resolveEmojiMap(custom: EmojiMap = {}): EmojiMap {
  return { ...BUILTIN_EMOJIS, ...custom };
}

/**
 * 只接受可安全放进 `<img src>` 的地址。
 *
 * `rehype-sanitize` 的默认 schema 也会挡掉危险协议，但表情图是我们在消毒之前
 * 插入的，多一道显式校验不亏 —— 站点配置写错时表现为「这个表情不显示」，
 * 而不是把问题带到更下游。
 */
export function isSafeEmojiUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;

  // 站内相对路径
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;

  try {
    const protocol = new URL(trimmed).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function emojiElement(name: string, url: string): Element {
  return {
    type: 'element',
    tagName: 'img',
    properties: {
      className: ['emoji'],
      src: url,
      // alt/title 用短代码本身：既保证可访问性，也让纯文本环境仍有信息
      alt: `:${name}:`,
      title: `:${name}:`,
    },
    children: [],
  };
}

/**
 * rehype 插件：把文本节点里的 `:name:` 换成图片元素。
 *
 * @param emojis 已合并的表情表（内置 + 站点自定义）
 */
export function rehypeEmoji(emojis: EmojiMap) {
  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (parent === undefined || index === undefined) return;

      // 代码块与行内代码里的 `:name:` 是代码，不是表情
      if (parent.type === 'element' && (parent.tagName === 'pre' || parent.tagName === 'code')) {
        return;
      }

      const parts = splitEmoji(node.value, emojis);
      if (parts === null) return;

      parent.children.splice(index, 1, ...parts);

      // 跳过刚插入的节点，避免对图片的 alt 再次匹配
      return index + parts.length;
    });
  };
}

/** 切分文本；没有任何命中时返回 null（调用方据此保留原节点） */
function splitEmoji(value: string, emojis: EmojiMap): ElementContent[] | null {
  const parts: ElementContent[] = [];
  let cursor = 0;

  for (const match of value.matchAll(SHORTCODE_PATTERN)) {
    const name = match[1];
    if (name === undefined) continue;

    const url = emojis[name];
    if (url === undefined || !isSafeEmojiUrl(url)) continue;

    const start = match.index;

    if (start > cursor) {
      parts.push({ type: 'text', value: value.slice(cursor, start) });
    }
    parts.push(emojiElement(name, url.trim()));
    cursor = start + match[0].length;
  }

  if (parts.length === 0) return null;

  if (cursor < value.length) {
    parts.push({ type: 'text', value: value.slice(cursor) });
  }

  return parts;
}
