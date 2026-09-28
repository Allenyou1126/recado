# `recado-cli` 的包装脚本生成器（NixOS 模块用）。
#
# 为什么不能直接把 `cliPackage` 丢进 PATH：CLI 与服务走的是**同一套**配置校验
# （`loadEnv`，见 apps/server/src/config/env.server.ts），而服务的配置只活在
# systemd 单元里 —— `settings` 是单元的 `Environment=`，密钥是 `EnvironmentFile=`
# （通常 0400、只有 root 能读）。直接在 shell 里跑二进制的结果是：
#
#   环境变量校验失败，共 8 项问题：DATABASE_URL/SESSION_SECRET/… 未设置（必填）
#
# 所以这里用 `systemd-run` 起一个**临时单元**，把服务那一套复现出来：
#
# - 密钥**不进命令行参数**：`--property=EnvironmentFile=` 由 systemd 以 root 读取，
#   `/proc/<pid>/cmdline`（全机可读）里看不到任何密钥 —— 这也是不用
#   `env VAR=secret …` / `set -a; . envfile` 的原因；
# - 以**服务用户**运行：`database.createLocally` 用的是 socket + peer 认证，
#   OS 用户名就是数据库角色名，root 跑会以「角色不存在 / peer 认证失败」告终；
# - 加固项与服务一致，CLI 不会成为绕过服务沙箱的后门；
# - `--wait --pipe` 把 stdin/stdout/stderr 直连给调用者，并**原样返回命令的退出码**
#   （实测 `systemd-run --wait --pipe sh -c 'exit 7'` → 7），这样 `site:create` 的
#   site key 能打印到终端、脚本里也能用 `$?` 判断成败；
# - `--collect` 保证临时单元退出后立刻消失，反复执行不会在 `systemctl --failed`
#   里堆积同名单元。
{
  lib,
  pkgs,
  # 运维 CLI 所在包（nix/packages.nix 的 `recado-cli`，提供 bin/recado-cli）
  cliPackage,
  # 运行服务的系统用户 / 用户组
  user,
  group,
  # 与 `recado.service` 完全相同的环境变量（NODE_ENV / settings / PORT）
  environment,
  # 密钥文件路径（`services.recado.environmentFile`），null 表示没有
  environmentFile,
  # 与 `recado.service` 相同的 systemd 加固项
  hardening,
  name ? "recado-cli",
}:

let
  # systemd 的属性值：布尔要写成 true/false（不能走 toString，会得到 1/0），
  # 列表用空格分隔（`-p RestrictAddressFamilies=AF_INET AF_UNIX` 是合法写法）。
  renderValue =
    value:
    if lib.isBool value then
      (if value then "true" else "false")
    else if lib.isList value then
      lib.concatStringsSep " " (map renderValue value)
    else
      toString value;

  setenvArgs = lib.mapAttrsToList (key: value: "--setenv=${key}=${renderValue value}") environment;

  hardeningArgs = lib.mapAttrsToList (key: value: "--property=${key}=${renderValue value}") hardening;

  # 三组参数合成一行：`systemd-run` 的选项顺序无关紧要，而「逐组换行」需要往
  # 缩进字符串里插「续行符 + 换行」，很容易踩到「以插值开头的行按零缩进算」这个坑
  # （一旦踩到，生成出来的脚本会整体多一层缩进 —— 还能跑，但没人看得懂）。
  flagArgs = lib.escapeShellArgs (
    lib.optional (environmentFile != null) "--property=EnvironmentFile=${toString environmentFile}"
    ++ setenvArgs
    ++ hardeningArgs
  );

  systemdRun = lib.getExe' pkgs.systemd "systemd-run";
  id = lib.getExe' pkgs.coreutils "id";
  cli = lib.getExe' cliPackage "recado-cli";
in
pkgs.writeShellScriptBin name ''
  # 临时单元必须由 PID 1 创建，所以要 root（与 `systemctl start recado-migrate` 同级）。
  if [ "$(${id} -u)" -ne 0 ]; then
    echo "recado-cli 需要 root：它要以服务身份（${user}）和服务的环境变量运行。" >&2
    echo "  sudo recado-cli $*" >&2
    exit 1
  fi

  exec ${systemdRun} \
    --quiet \
    --wait \
    --pipe \
    --collect \
    --unit="recado-cli-$$" \
    --uid=${lib.escapeShellArg user} \
    --gid=${lib.escapeShellArg group} \
    ${flagArgs} \
    -- ${lib.escapeShellArg cli} "$@"
''
