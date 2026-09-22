import { describe, expect, it } from 'vitest';

import { findMentions } from './mentions';
import { renderMarkdown } from './rendering.service';

async function mentionsOf(markdown: string): Promise<string[]> {
  const result = await renderMarkdown(markdown);

  expect(result.error).toBeNull();
  return result.data?.mentions ?? [];
}

describe('findMentions', () => {
  it('提取中英文昵称', () => {
    expect(findMentions('@alice 与 @张三 都来')).toEqual(['alice', '张三']);
  });

  it('排除邮箱地址里的 @', () => {
    expect(findMentions('联系 foo@bar.com 谢谢')).toEqual([]);
  });

  it('不吞掉后面的标点', () => {
    expect(findMentions('@alice, 你好')).toEqual(['alice']);
    expect(findMentions('@alice，你好')).toEqual(['alice']);
  });

  it('超长昵称不匹配，避免把整段文字当昵称', () => {
    expect(findMentions(`@${'a'.repeat(65)}`)).toEqual([]);
    expect(findMentions(`@${'a'.repeat(64)}`)).toHaveLength(1);
  });

  it('没有 @ 时返回空数组', () => {
    expect(findMentions('普通文本')).toEqual([]);
  });
});

describe('@提及解析（T2.6）', () => {
  it('从 AST 文本节点提取提及', async () => {
    await expect(mentionsOf('你好 @alice，请看看 @bob 的回复')).resolves.toEqual(['alice', 'bob']);
  });

  it('代码块与行内代码里的 @ 不算提及 —— 这正是不能用正则扫原文的原因', async () => {
    await expect(mentionsOf('```text\n@alice\n```\n\n`@bob`')).resolves.toEqual([]);
  });

  it('同一个人被多次 @ 只记一次，且保持出现顺序', async () => {
    await expect(mentionsOf('@bob @alice @bob')).resolves.toEqual(['bob', 'alice']);
  });

  it('提及出现在链接文字与强调里同样能被提取', async () => {
    await expect(mentionsOf('**[@alice](/u/alice)** 与 *@bob*')).resolves.toEqual(['alice', 'bob']);
  });
});
