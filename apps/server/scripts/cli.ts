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

import { createSite, resolveAccessScope } from '@recado/core';
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

const commands: Record<string, Command> = {
  'auth:diagnose': diagnoseCommand,
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
