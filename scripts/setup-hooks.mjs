#!/usr/bin/env node
/**
 * 安装后自动启用仓库内的 git 钩子。
 *
 * 背景：core.hooksPath 存放在 .git/config 中，不随仓库分发，
 * 新克隆的仓库默认不会启用 .githooks/ 下的提交校验。
 * 由 package.json 的 prepare 脚本调用，pnpm install 后自动生效。
 *
 * 见 AGENTS.md「提交规范」。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// 不在 git 仓库中（如从 tarball 安装）时静默跳过
if (!existsSync('.git')) {
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  console.log('✓ 已启用提交校验钩子（core.hooksPath=.githooks）');
} catch {
  console.warn('⚠ 无法自动启用 git 钩子，请手动执行：\n    git config core.hooksPath .githooks');
}
