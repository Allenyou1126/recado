#!/usr/bin/env node
/**
 * Recado 运维 CLI。
 *
 * 为什么需要它：管理台要等到阶段 8 才可用，而**创建第一个站点**是部署流程里
 * 绕不过去的一步（UC-01）。此外，这类命令在自动化脚本里也比点后台更合适。
 *
 * 用法：
 *
 *   pnpm cli site:create --name "我的博客" --origin https://blog.example.com
 *   pnpm cli site:create --name "测试站" --json
 *
 * 约定：
 * - 配置沿用与服务**完全相同**的校验（`loadEnv`），避免「CLI 能跑、服务起不来」
 * - 退出码：0 成功、1 失败；失败信息写 stderr
 * - 这是边界程序，允许 try/catch（见 .specs/development-standards.md §6.4）
 */

import { parseArgs } from 'node:util';

import {
  createSite,
  getSiteById,
  listAdminComments,
  listOutbox,
  renderMarkdown,
  renderOptionsFromSettings,
  resolveAccessScope,
  retryOutboxItem,
  siteSettings,
  updateCommentContent,
} from '@recado/core';
import { createDbClient, type DbClient } from '@recado/db';
import { isErr } from '@recado/shared';

import { EnvValidationError, getEnv, loadLocalEnvFile } from '../src/config/env.server';
import { verifyBearerToken } from '../src/lib/oidc.server';

type Command = {
  summary: string;
  usage: string;
  run: (positionals: string[], options: ParsedOptions) => Promise<number>;
};

type ParsedOptions = ReturnType<typeof parseArgs>['values'];

/** 收集可重复出现的选项（如多个 `--origin`） */
function listOption(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}

function stringOption(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** 打开数据库连接并保证一定会关闭 */
async function withDb<TResult>(fn: (db: DbClient) => Promise<TResult>): Promise<TResult> {
  const client = createDbClient(getEnv().DATABASE_URL);

  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/**
 * 诊断登录：打印本次凭证解析到的角色与可见站点。
 *
 * 存在的理由是 Q-17 的代价 —— 无匹配角色会被直接拒绝登录，
 * 而首次部署最常见的故障就是「IdP 侧角色没配好」。这个命令让排查有据可依：
 * 到底拿到了哪些角色、前缀对不对、站点 UUID 写没写错。
 *
 * 两种用法：
 *   auth:diagnose --token <access token>   # 走完整验签，最接近真实调用
 *   auth:diagnose --roles a,b              # 只做映射，便于在没有 token 时核对前缀
 */
const diagnoseCommand: Command = {
  summary: '诊断 OIDC 角色与可见站点（排查「首次部署锁死」）',
  usage:
    'auth:diagnose (--token <access token> | --roles <角色1,角色2>) [--json]\n' +
    '  --token  直接给一个 access token，走完整验签与角色解析\n' +
    '  --roles  只给角色名列表，跳过验签（用于核对前缀与站点 UUID）',
  async run(_positionals, options) {
    const env = getEnv();
    const prefix = env.OIDC_ROLE_PREFIX;

    const token = stringOption(options.token);
    const rolesOption = stringOption(options.roles);

    if (token === undefined && rolesOption === undefined) {
      process.stderr.write('需要 --token 或 --roles 之一\n\n');
      return 1;
    }

    let roles: string[] = [];
    let subject = '(未验签)';

    if (token !== undefined) {
      const verified = await verifyBearerToken(env, token);

      if (verified.error) {
        process.stderr.write(
          `token 校验失败：${verified.error.reason}。请确认 issuer / 受众 / 密钥配置。\n`,
        );
        return 1;
      }

      roles = verified.data.roles;
      subject = verified.data.identity.oidcSubject;
    } else if (rolesOption !== undefined) {
      roles = rolesOption
        .split(',')
        .map((role) => role.trim())
        .filter((role) => role.length > 0);
    }

    const { matchedRoles, scope } = resolveAccessScope(roles, prefix);
    const siteIds = scope?.type === 'site' ? scope.siteIds : [];

    if (options.json === true) {
      process.stdout.write(
        `${JSON.stringify({ subject, rolePrefix: prefix, roles, matchedRoles, scope }, null, 2)}\n`,
      );
      return scope === null ? 2 : 0;
    }

    const lines = [
      `issuer:        ${env.OIDC_ISSUER_URL}`,
      `claim 路径:    ${env.OIDC_ROLE_CLAIM}`,
      `角色前缀:      ${prefix}`,
      `主体:          ${subject}`,
      `拿到的角色:    ${roles.length > 0 ? roles.join(', ') : '（空）'}`,
      `命中的角色:    ${matchedRoles.length > 0 ? matchedRoles.join(', ') : '（无）'}`,
      '',
    ];

    if (scope === null) {
      lines.push(
        `✗ 没有任何角色匹配前缀 \`${prefix}\`，该主体会被**拒绝登录且不产生会话**。`,
        '',
        '排查顺序：',
        `  1. IdP 里是否存在名为 ${prefix}.OWNER 或 ${prefix}.ADMIN.<站点 UUID> 的角色`,
        `  2. claim 路径是否为 ${env.OIDC_ROLE_CLAIM}（Keycloak 常见写法是 realm_access.roles）`,
        '  3. 站点管理员角色的站点段必须是 UUID，不是站点名或 slug',
      );
    } else if (scope.type === 'instance') {
      lines.push('✓ 实例级管理员：可以管理全部站点。');
    } else {
      lines.push(`✓ 站点级管理员：仅能看到以下 ${siteIds.length} 个站点：`);
      for (const siteId of siteIds) lines.push(`    ${siteId}`);
    }

    process.stdout.write(`${lines.join('\n')}\n`);

    return scope === null ? 2 : 0;
  },
};

/**
 * `admin:grant` —— 打印如何为某人授予权限。
 *
 * ⚠️ 这个命令**不写数据库**：本系统不存角色授予关系（决策 D15），
 * 权限完全由 IdP 角色决定。因此「授予管理员」这件事只能在 IdP 侧做 ——
 * 命令的价值是把「该配什么角色、站点 UUID 是多少」直接算给操作者看，
 * 免得他去翻文档拼字符串。
 */
const adminGrant: Command = {
  summary: '生成 IdP 角色名（本系统不存授权，只能在 IdP 侧授予）',
  usage:
    'admin:grant (--owner | --site <站点 UUID>) [--email <邮箱>]\n' +
    '  --owner          打印实例级管理员角色名\n' +
    '  --site <UUID>    打印该站点管理员角色名（会校验站点是否存在）',
  async run(_positionals, options) {
    const env = getEnv();
    const prefix = env.OIDC_ROLE_PREFIX;

    if (options.owner === true) {
      const role = `${prefix}.OWNER`;
      process.stdout.write(
        [
          `请在 IdP 中创建角色 ${role}，并授予目标账号：`,
          '',
          `  角色名：${role}`,
          '  效果：  该账号可以管理全部站点',
          '',
          '授权完成后，让他重新登录管理台（本系统不缓存角色授予关系）。',
          '',
        ].join('\n'),
      );
      return 0;
    }

    const siteId = stringOption(options.site);
    if (siteId === undefined) {
      process.stderr.write('需要 --owner 或 --site <站点 UUID>\n\n');
      return 1;
    }

    return withDb(async ({ db }) => {
      const site = await getSiteById(db, siteId);

      if (!site) {
        process.stderr.write(`找不到站点 ${siteId}\n`);
        return 1;
      }

      const role = `${prefix}.ADMIN.${site.id}`;
      process.stdout.write(
        [
          `请在 IdP 中创建角色 ${role}，并授予目标账号：`,
          '',
          `  站点：  ${site.name}（${site.id}）`,
          `  角色名：${role}`,
          '  效果：  仅能管理该站点',
          '',
          '提示：站点标识用的是 UUID，改名不影响这条授权（决策 D17）。',
          '',
        ].join('\n'),
      );

      return 0;
    });
  },
};

/**
 * `comment:rerender` —— 批量重渲染历史评论。
 *
 * 存在的意义正是「原文与 HTML 双存」这个设计的回报：
 * 解析器或站点渲染配置变更后，可以离线把历史评论重放一遍，
 * 而不是让它永远停留在旧渲染结果上（M4「内容重放」）。
 */
const commentRerender: Command = {
  summary: '用当前渲染管线重放历史评论的 HTML（双存设计的回报）',
  usage:
    'comment:rerender --site <站点 UUID> [--limit 200] [--path /posts/x] [--dry-run]\n' +
    '  --site     目标站点 UUID\n' +
    '  --limit    本次最多处理多少条（默认 200）\n' +
    '  --path     只处理该路径下的评论\n' +
    '  --dry-run  只统计会改动多少条，不写库',
  async run(_positionals, options) {
    const siteId = stringOption(options.site);
    if (siteId === undefined) {
      process.stderr.write('需要 --site <站点 UUID>\n\n');
      return 1;
    }

    const limit = Number(stringOption(options.limit) ?? '200');
    const path = stringOption(options.path);
    const dryRun = options['dry-run'] === true;

    return withDb(async ({ db }) => {
      const site = await getSiteById(db, siteId);
      if (!site) {
        process.stderr.write(`找不到站点 ${siteId}\n`);
        return 1;
      }

      const options_ = renderOptionsFromSettings(siteSettings(site));
      const { rows } = await listAdminComments(
        { db, site },
        {
          path,
          sort: 'oldest',
          limit: Number.isFinite(limit) && limit > 0 ? limit : 200,
          offset: 0,
        },
      );

      let changed = 0;
      let failed = 0;

      for (const row of rows) {
        const rendered = await renderMarkdown(row.contentMd, options_);

        if (rendered.error) {
          failed += 1;
          process.stderr.write(`跳过 ${row.id}：${rendered.error.reason}\n`);
          continue;
        }

        if (rendered.data.html === row.contentHtml) continue;

        changed += 1;

        if (!dryRun) {
          await updateCommentContent(db, site.id, row.id, {
            md: row.contentMd,
            html: rendered.data.html,
            bytes: rendered.data.bytes,
          });
        }
      }

      process.stdout.write(
        [
          `扫描 ${rows.length} 条，${dryRun ? '需要更新' : '已更新'} ${changed} 条，失败 ${failed} 条。`,
          dryRun ? '（--dry-run：未写库）' : '',
          '',
        ]
          .filter((line) => line.length > 0)
          .join('\n'),
      );

      return failed > 0 ? 1 : 0;
    });
  },
};

/** `outbox:retry` —— 把失败邮件放回队列（不依赖管理台） */
const outboxRetry: Command = {
  summary: '重发失败邮件（不依赖管理台）',
  usage:
    'outbox:retry --site <站点 UUID> [--id <outbox id>]\n' +
    '  --site  目标站点 UUID\n' +
    '  --id    只重发这一条；省略则重发该站点全部 failed',
  async run(_positionals, options) {
    const siteId = stringOption(options.site);
    if (siteId === undefined) {
      process.stderr.write('需要 --site <站点 UUID>\n\n');
      return 1;
    }

    const id = stringOption(options.id);

    return withDb(async ({ db }) => {
      if (id !== undefined) {
        const retried = await retryOutboxItem(db, siteId, id);
        process.stdout.write(retried ? '已放回队列。\n' : '该任务不是 failed 状态，未处理。\n');
        return retried ? 0 : 1;
      }

      const { rows } = await listOutbox(db, siteId, { status: 'failed', limit: 500, offset: 0 });

      let retried = 0;
      for (const row of rows) {
        if (await retryOutboxItem(db, siteId, row.id)) retried += 1;
      }

      process.stdout.write(`已把 ${retried} 条失败任务放回队列。\n`);
      return 0;
    });
  },
};

const commands: Record<string, Command> = {
  'admin:grant': adminGrant,
  'auth:diagnose': diagnoseCommand,
  'comment:rerender': commentRerender,
  'outbox:retry': outboxRetry,
  'site:create': {
    summary: '创建站点并签发 site key（管理台就绪前的 bootstrap 手段）',
    usage:
      'site:create --name <展示名> [--origin <来源>]... [--json]\n' +
      '  --name    站点展示名（仅后台展示用，不参与标识与授权）\n' +
      '  --origin  来源白名单，可重复；支持 example.com 与 *.example.com\n' +
      '  --json    以 JSON 输出，便于脚本消费',
    async run(_positionals, options) {
      const name = stringOption(options.name);
      if (!name) {
        process.stderr.write('缺少 --name\n\n');
        return 1;
      }

      const origins = listOption(options.origin);

      return withDb(async ({ db }) => {
        const created = await createSite(db, { name, allowedOrigins: origins, settings: {} });

        if (isErr(created)) {
          process.stderr.write(`创建失败：${created.error.reason} — ${created.error.message}\n`);
          return 1;
        }

        const site = created.data;

        if (options.json === true) {
          process.stdout.write(
            `${JSON.stringify({ id: site.id, name: site.name, key: site.key, allowedOrigins: site.allowedOrigins }, null, 2)}\n`,
          );
          return 0;
        }

        process.stdout.write(
          [
            '✓ 站点已创建',
            `  id:      ${site.id}`,
            `  name:    ${site.name}`,
            `  key:     ${site.key}`,
            `  来源:    ${site.allowedOrigins.length > 0 ? site.allowedOrigins.join(', ') : '（空，将拒绝所有浏览器请求）'}`,
            '',
            '把这个 site key 填进博客前端即可。注意它是**公开标识**，不是密钥 ——',
            '真正的防线是来源白名单、限流与人工审核。',
            '',
          ].join('\n'),
        );

        return 0;
      });
    },
  },
};

function printHelp(): void {
  const lines = ['Recado CLI', '', '用法：pnpm cli <命令> [选项]', '', '命令：'];

  for (const [name, command] of Object.entries(commands)) {
    lines.push(`  ${name}`, `      ${command.summary}`, '', `      ${command.usage}`, '');
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main(argv: string[]): Promise<number> {
  // 本地开发从仓库根 .env 兜底；编排环境直接注入环境变量（见 loadLocalEnvFile 的说明）
  loadLocalEnvFile();

  const [commandName, ...rest] = argv;

  if (commandName === undefined || commandName === '--help' || commandName === '-h') {
    printHelp();
    return commandName === undefined ? 1 : 0;
  }

  const command = commands[commandName];
  if (!command) {
    process.stderr.write(`未知命令：${commandName}\n\n`);
    printHelp();
    return 1;
  }

  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      name: { type: 'string' },
      origin: { type: 'string', multiple: true },
      token: { type: 'string' },
      roles: { type: 'string' },
      json: { type: 'boolean' },
      owner: { type: 'boolean' },
      site: { type: 'string' },
      id: { type: 'string' },
      limit: { type: 'string' },
      path: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  });

  return command.run(positionals, values);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (cause) {
  // 配置/网络/数据库的失败在这里收口：给可读信息，退出码非零
  if (cause instanceof EnvValidationError) {
    process.stderr.write(`\n${cause.message}\n`);
  } else {
    process.stderr.write(
      `\n命令执行失败：${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
  }

  process.exitCode = 1;
}
