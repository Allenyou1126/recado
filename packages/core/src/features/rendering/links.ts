/**
 * 外链处理：给站外链接统一加 `rel="nofollow ugc noopener noreferrer"`。
 *
 * 为什么三条都要：
 * - `nofollow` —— 评论是用户内容，不应把 SEO 权重传给外链
 * - `ugc` —— 明确标注这是用户生成内容里的链接
 * - `noopener noreferrer` —— 前端若给外链加了 `target="_blank"`，
 *   没有它们就会把 `window.opener` 交给对方页面（反向 tabnabbing）
 *
 * 判定采用「绝对地址即站外」：渲染器不知道站点自身的域名，而给站内链接多标一个
 * `nofollow` 没有实际危害，漏标外链才有。
 */

import type { Root } from 'hast';
import { visit } from 'unist-util-visit';

/**
 * 外链统一使用的 rel。
 *
 * hast 里 `rel` 是**空格分隔的列表**（property-information 的既有约定），
 * 因此写成数组；序列化时会重新拼成 `rel="nofollow ugc noopener noreferrer"`。
 */
export const EXTERNAL_LINK_REL = ['nofollow', 'ugc', 'noopener', 'noreferrer'];

/** 形如 `https://…` 或 `//host/path` 的链接视为站外 */
export function isExternalHref(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed.length === 0) return false;

  // 协议相对地址同样是站外
  if (trimmed.startsWith('//')) return true;

  // 站内相对地址、锚点、查询串
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('?')) {
    return false;
  }

  try {
    const protocol = new URL(trimmed).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    // 形如 `foo/bar` 的相对地址
    return false;
  }
}

/** rehype 插件：给站外 `<a>` 打上 rel */
export function rehypeExternalLinks() {
  return (tree: Root): void => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'a') return;

      const href = node.properties?.['href'];
      if (typeof href !== 'string' || !isExternalHref(href)) return;

      node.properties = { ...node.properties, rel: EXTERNAL_LINK_REL };
    });
  };
}
