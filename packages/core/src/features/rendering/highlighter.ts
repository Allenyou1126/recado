/**
 * 代码高亮用的 Shiki highlighter：懒创建、进程级复用、语言按需加载。
 *
 * 两个刻意的取舍：
 *
 * 1. **用 JavaScript 正则引擎而不是 Oniguruma WASM。**
 *    WASM 引擎会让服务端构建去解析 `onig.wasm` 里的 `env` 导入并失败
 *    （Rolldown 无法打包 emscripten 模块），最终 `.output` 就不再自包含。
 *    JS 引擎没有这个包袱，`forgiving: true` 让个别 JS 不支持的正则被跳过，
 *    而不是整段高亮失败。
 *
 * 2. **语言是白名单 + 按需加载。**
 *    不做「任意语言都去 dynamic import」：那等于把 200 多个语法包都挂在
 *    代码里的可达路径上，也让构建产物不可预测。这里只登记常见语言，
 *    未登记的语言由渲染管线降级为纯文本（见 rendering.service.ts）。
 *    语言包在第一次遇到该语言时才 import，产物里每种语言是一个独立 chunk。
 *
 * ⚠️ 别名（`js` / `py` / `sh` …）由 `normalizeCodeLanguageNames` 在进入 Shiki 之前
 * 改写成规范名，**不能**交给 highlighter 的 `langAlias`：`langAlias` 会让
 * `getLoadedLanguages()` 提前把别名报成「已加载」，而 `@shikijs/rehype` 正是用这个
 * 列表判断要不要走懒加载分支 —— 结果是别名代码块既不加载语言、也不高亮，
 * 静默退化成纯文本。
 */

import type { Root } from 'hast';
import { createBundledHighlighter, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { visit } from 'unist-util-visit';

/** 代码高亮主题；输出内联样式，前端无需引入任何 CSS */
export const CODE_THEME = 'github-light';

/** 常见语言别名 → 规范名（导出供渲染管线改写 class） */
export const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  jsx: 'jsx',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  py: 'python',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  go: 'go',
  kt: 'kotlin',
  cs: 'csharp',
  cxx: 'cpp',
  hpp: 'cpp',
  docker: 'dockerfile',
  htm: 'html',
  xml: 'xml',
};

/** 登记的语言（值必须是动态 import，保证按需加载） */
const LANGUAGE_LOADERS = {
  bash: () => import('@shikijs/langs/bash'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  lua: () => import('@shikijs/langs/lua'),
  markdown: () => import('@shikijs/langs/markdown'),
  nginx: () => import('@shikijs/langs/nginx'),
  php: () => import('@shikijs/langs/php'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  scss: () => import('@shikijs/langs/scss'),
  sql: () => import('@shikijs/langs/sql'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  vue: () => import('@shikijs/langs/vue'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
} as const;

const createHighlighter = createBundledHighlighter({
  langs: LANGUAGE_LOADERS,
  themes: { [CODE_THEME]: () => import('@shikijs/themes/github-light') },
  engine: () => createJavaScriptRegexEngine({ forgiving: true }),
});

let highlighterPromise: Promise<HighlighterCore> | undefined;

/**
 * 取得（或首次创建）进程级 highlighter。
 *
 * ⚠️ 刻意不在模块顶层 await：那会拖慢服务启动，而且启动期不需要高亮能力。
 */
export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighter({
    // 一个语言都不预加载
    langs: [],
    themes: [CODE_THEME],
  });

  return highlighterPromise;
}

/** 仅供测试：清空 highlighter 缓存 */
export function resetHighlighter(): void {
  highlighterPromise = undefined;
}

/** `language-` 前缀 */
const LANGUAGE_CLASS_PREFIX = 'language-';

/**
 * rehype 插件：把 `language-js` 这类别名改写成规范名 `language-javascript`。
 *
 * 必须在 Shiki 之前执行；原因见文件头部关于 `langAlias` 的说明。
 * 未登记的别名原样保留，交给 Shiki 的 `fallbackLanguage` 退化成纯文本。
 */
export function normalizeCodeLanguageNames() {
  return (tree: Root): void => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'code') return;

      const classes = node.properties?.['className'];
      if (!Array.isArray(classes)) return;

      node.properties = {
        ...node.properties,
        className: classes.map((name) => {
          if (typeof name !== 'string' || !name.startsWith(LANGUAGE_CLASS_PREFIX)) return name;

          const alias = name.slice(LANGUAGE_CLASS_PREFIX.length);
          const canonical = LANGUAGE_ALIASES[alias];

          return canonical === undefined ? name : `${LANGUAGE_CLASS_PREFIX}${canonical}`;
        }),
      };
    });
  };
}
