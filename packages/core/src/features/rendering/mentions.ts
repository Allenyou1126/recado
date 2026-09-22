/**
 * @提及解析 —— **在 AST 文本节点上做，不用正则扫原文**。
 *
 * 为什么必须走 AST：代码块里的 `@alice` 是代码而不是提及，正则扫原文会被它骗到
 * （.specs/development-plan.md 阶段 2 的已知坑）。这里只访问 `<code>`/`<pre>`
 * 之外的文本节点。
 *
 * 本模块只负责**提取昵称**。把昵称对应到具体成员是站点级的事（同名不同人、
 * 成员改名等），放在评论服务里做（阶段 4/6）。
 */

import type { Root } from 'hast';
import { visit } from 'unist-util-visit';

/** 昵称长度上限，与评论昵称字段保持一致 */
export const MAX_MENTION_LENGTH = 64;

/**
 * `@` + 昵称。
 *
 * 昵称字符集：Unicode 字母、数字、下划线、连字符与点 —— 覆盖中英文昵称，
 * 又不会把后面的中文标点或空格吞进来。
 */
export const MENTION_PATTERN = new RegExp(
  // 末尾的负向先行断言保证「整段昵称字符」被一次性匹配完：
  // 否则 @ 后面跟 65 个字母时会截取前 64 个，造出一个并不存在的昵称
  `@([\\p{L}\\p{N}_.-]{1,${MAX_MENTION_LENGTH}})(?![\\p{L}\\p{N}_.-])`,
  'gu',
);

/** 同上，用于判断 `@` 前面的字符是否属于昵称字符集 */
const NAME_CHARACTER = /[\p{L}\p{N}_.-]/u;

/**
 * 从一段纯文本里提取提及。
 *
 * 邮箱与单词中间的 `@` 会被排除：`foo@bar.com` 里的 `bar.com` 不是提及。
 */
export function findMentions(value: string): string[] {
  const names: string[] = [];

  for (const match of value.matchAll(MENTION_PATTERN)) {
    const name = match[1];
    if (name === undefined) continue;

    const previous = match.index > 0 ? value[match.index - 1] : undefined;
    if (previous !== undefined && NAME_CHARACTER.test(previous)) continue;

    names.push(name);
  }

  return names;
}

/**
 * rehype 插件：遍历非代码文本节点，把提取到的昵称交给 `collect`。
 *
 * @param collect 收集回调；由渲染服务负责去重与排序
 */
export function rehypeMentions(collect: (name: string) => void) {
  return (tree: Root): void => {
    visit(tree, 'text', (node, _index, parent) => {
      if (parent === undefined) return;

      // 代码块与行内代码里的 @ 是代码
      if (parent.type === 'element' && (parent.tagName === 'pre' || parent.tagName === 'code')) {
        return;
      }

      for (const name of findMentions(node.value)) {
        collect(name);
      }
    });
  };
}
