/**
 * 渲染性能回归测试。
 *
 * 对应 .specs/requirements.md §7.2 的目标：**单条 10KB Markdown 渲染 < 80ms**。
 *
 * 取 7 次的中位数，先跑一次热身（Shiki highlighter 与语言包是懒加载的，
 * 冷启动成本不该混进稳态指标）。阈值取实测值（约 22ms）的 3.5 倍余量，
 * 既能挡住真实退化，又不会在 CI 负载抖动时误报。
 */

import { describe, expect, it } from 'vitest';

import { contentBytes, renderMarkdown } from './rendering.service';

/** 逼近 10KB 上限的真实形态评论：大量正文 + 一段代码 + 一个公式 */
function realisticDocument(): string {
  const paragraph =
    '这是一段普通的评论正文，包含 **加粗**、*斜体*、`行内代码`、[链接](https://example.com) 与 :smile: 表情。\n\n';

  let document = '';
  while (contentBytes(document + paragraph) <= 8_600) {
    document += paragraph;
  }

  const code = Array.from({ length: 20 }, (_, index) => `const value${index} = compute(${index});`);

  document += `\`\`\`js\n${code.join('\n')}\n\`\`\`\n\n`;
  document += '质能方程 $E = mc^2$ 很简单。\n';

  return document;
}

async function medianRenderMs(markdown: string, runs = 7): Promise<number> {
  // 热身：把 Shiki highlighter 与语言包的懒加载成本排除在稳态指标之外
  await renderMarkdown(markdown);

  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    const result = await renderMarkdown(markdown);
    expect(result.error).toBeNull();
    samples.push(performance.now() - started);
  }

  samples.sort((left, right) => left - right);
  return samples[Math.floor(runs / 2)] ?? Number.POSITIVE_INFINITY;
}

describe('渲染性能（§7.2）', () => {
  it('单条 10KB 真实形态评论渲染 < 80ms', async () => {
    const document = realisticDocument();

    expect(contentBytes(document)).toBeLessThanOrEqual(10_240);

    const elapsed = await medianRenderMs(document);

    expect(elapsed, `渲染耗时 ${elapsed.toFixed(1)}ms 超过 80ms 目标`).toBeLessThan(80);
  });

  it('公式密集的极端文档仍在可接受范围', async () => {
    // 每 160 字节就有一个公式，远密于真实评论；MathJax 是其中最重的一环，
    // 这里用较宽的阈值（300ms）只挡明显退化，不作为 §7.2 的达标依据
    const block = '# 标题\n\n段落 **加粗** [链接](https://example.com)\n\n$x^2 + y^2 = z^2$\n\n';
    let document = '';
    while (contentBytes(document + block) <= 9_900) {
      document += block;
    }

    const elapsed = await medianRenderMs(document, 5);

    expect(elapsed, `公式密集文档耗时 ${elapsed.toFixed(1)}ms`).toBeLessThan(300);
  });
});
