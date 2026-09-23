# Recado 的 Nix 打包实现。
#
# 与 docker/Dockerfile 的关系：Dockerfile 在容器里跑 `pnpm install` + `pnpm build`
# 得到 `.output`；这里跑同样两步，区别只是依赖来自 `fetchPnpmDeps` 冻结出的
# pnpm 存储（固定输出派生），因此**构建过程不联网**、同一个 lockfile 得到同一份产物。
#
# 打包边界（与 docs/deployment.md 的承诺一致）：
#
# - `recado`      —— 只含 Nitro 产物 `.output`（自包含），运行时只需要 Node.js。
# - `recado-cli`  —— 运维 CLI 与数据库迁移命令，用 esbuild 打成单文件，
#                    不需要把 tsx / drizzle-kit / 几百 MB 的 node_modules 带进运行时。
# - **迁移不在应用启动流程里**（requirements.md §8.5）：`recado-migrate` 是独立命令，
#   NixOS 模块里是一个不被任何 target 拉起的一次性服务。
{
  lib,
  stdenv,
  nodejs,
  pnpm_12,
  fetchPnpmDeps,
  pnpmConfigHook,
  esbuild,
  makeWrapper,
  version,
  pnpmDepsHash,
}:

let
  pnpm = pnpm_12;

  # 只用「构建真正会读到的文件」参与构建：
  #
  # - 按 basename 排除构建产物（node_modules / .output / …），它们会在构建期重新生成；
  # - 按**仓库根相对路径**排除与产物无关的东西（文档、Docker、打包脚本本身），
  #   这样改 README 或改 flake 不会白白重建应用。
  #
  # ⚠️ 不能用 basename 排除 `scripts` 之类：`apps/server/scripts/cli.ts` 是构建输入。
  src = lib.cleanSourceWith {
    src = ../.;
    name = "recado-source";
    filter =
      path: _type:
      let
        pathStr = toString path;
        relative = lib.removePrefix "${toString ../.}/" pathStr;
      in
      !(builtins.elem (baseNameOf pathStr) [
        "node_modules"
        ".output"
        ".nitro"
        ".tanstack"
        ".tmp"
        "coverage"
      ])
      && !(builtins.elem relative [
        "AGENTS.md"
        "README.md"
        "flake.lock"
        "flake.nix"
        "nix"
        "docs"
        "docker"
        "scripts"
        ".githooks"
        ".specs"
      ]);
  };

  pnpmDeps = fetchPnpmDeps {
    pname = "recado";
    inherit src pnpm;
    # pnpm 11+ 必须用 fetcherVersion 4（3 已被 nixpkgs 拒绝）。
    fetcherVersion = 4;
    hash = pnpmDepsHash;
  };

  nodeTarget = "node${lib.versions.major nodejs.version}";

  # esbuild 的 ESM 输出把 CJS 依赖包成 __require，遇到 `require('events')`
  # 这类动态 require 会抛 "Dynamic require of ... is not supported"（pg 就会）。
  # 给产物注入一个真正的 require 即可。
  cjsInteropBanner = ''
    import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
  '';

  common = {
    inherit src pnpmDeps;

    # pnpmConfigHook 在 configure 阶段用 pnpmDeps 里的存储执行
    # `pnpm install --offline --frozen-lockfile --ignore-scripts`，无需自己再装一次。
    nativeBuildInputs = [
      nodejs
      pnpm
      pnpmConfigHook
      makeWrapper
    ];

    env = {
      # pnpm 12 默认会照着 package.json 的 `packageManager` 字段去下载指定版本
      # 的 pnpm（仓库锁的是 12.4.1，nixpkgs 提供的是 12.3.x）。沙箱里没有网络，
      # 这里显式关掉；nixpkgs 的 pnpmConfigHook 对 pnpm 11+ 也会设同样的开关。
      pnpm_config_pm_on_fail = "ignore";
      pnpm_config_trust_lockfile = "true";
      pnpm_config_update_notifier = "false";
    };

    meta = {
      description = "自托管、多站点、Headless 的评论系统";
      platforms = lib.platforms.linux;
      # 仓库是私有未授权项目（package.json: UNLICENSED），因此不声明 license。
    };
  };

  # 两个可执行文件都是「node <入口文件>」：Nitro 的产物与 esbuild 的产物
  # 都不带 shebang，用 makeWrapper 固定解释器，避免依赖 PATH 里的 node。
  mkWrapper = name: entry: ''
    makeWrapper ${lib.getExe nodejs} $out/bin/${name} \
      --add-flags "${entry}" \
      --set-default NODE_ENV production
  '';
in
{
  recado = stdenv.mkDerivation (
    common
    // {
      pname = "recado";
      inherit version;

      buildPhase = ''
        runHook preBuild
        pnpm --filter @recado/server build
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall

        mkdir -p $out/lib/recado
        # Nitro 的产物是自包含的（.output 内含运行所需的全部依赖），
        # 与 docker/Dockerfile 运行层拷贝的东西完全一致。
        cp -r apps/server/.output $out/lib/recado/output

        mkdir -p $out/bin
        ${mkWrapper "recado" "$out/lib/recado/output/server/index.mjs"}

        runHook postInstall
      '';

      passthru = {
        # 供调试与重新生成 nix/pnpm-deps-hash.nix 用：
        #   nix build .#recado.pnpmDeps
        inherit pnpmDeps;
      };

      meta = common.meta // {
        mainProgram = "recado";
      };
    }
  );

  recado-cli = stdenv.mkDerivation (
    common
    // {
      pname = "recado-cli";
      inherit version;

      nativeBuildInputs = common.nativeBuildInputs ++ [ esbuild ];

      # 只需要 pnpmConfigHook 装好的 node_modules，没有要编译的东西。
      dontBuild = true;

      installPhase = ''
        runHook preInstall

        mkdir -p $out/lib/recado-cli

        # 迁移入口放到 packages/db 下打包，那里能解析到 drizzle-orm / pg。
        # 源文件在 nix/recado-migrate.mjs（那里有为什么需要它的说明）。
        cp ${./recado-migrate.mjs} packages/db/nix-migrate.mjs

        esbuild apps/server/scripts/cli.ts \
          --bundle --platform=node --format=esm --target=${nodeTarget} \
          --log-level=warning \
          --banner:js=${lib.escapeShellArg cjsInteropBanner} \
          --outfile=$out/lib/recado-cli/recado-cli.mjs

        esbuild packages/db/nix-migrate.mjs \
          --bundle --platform=node --format=esm --target=${nodeTarget} \
          --log-level=warning \
          --banner:js=${lib.escapeShellArg cjsInteropBanner} \
          --outfile=$out/lib/recado-cli/recado-migrate.mjs

        rm packages/db/nix-migrate.mjs

        # 迁移 SQL 与 journal：放在入口文件旁边，入口按 import.meta.url 找它。
        cp -r packages/db/drizzle $out/lib/recado-cli/drizzle

        mkdir -p $out/bin
        ${mkWrapper "recado-cli" "$out/lib/recado-cli/recado-cli.mjs"}
        ${mkWrapper "recado-migrate" "$out/lib/recado-cli/recado-migrate.mjs"}

        runHook postInstall
      '';

      meta = common.meta // {
        description = "Recado 运维 CLI 与数据库迁移命令";
        mainProgram = "recado-cli";
      };
    }
  );
}
