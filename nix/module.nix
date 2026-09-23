# Recado 的 NixOS 模块。
#
# 与 docs/deployment.md 的承诺保持一致：
#
# - 应用只监听本地端口，TLS 与来源头重写交给反向代理 —— 本模块不替你写 Nginx 配置。
# - **迁移不挂在应用启动流程里**（requirements.md §8.5）：`recado-migrate.service`
#   不被任何 target 拉起，升级与首次部署时由运维显式执行。
# - 密钥不进 Nix store：`settings` 只放非敏感项，`SESSION_SECRET`、`SECRETS_KEY`、
#   `OIDC_CLIENT_SECRET` 走 `environmentFile`（store 是全局可读的）。
#
# 最小用法（配合 flake 的 nixosModules.default，包会由 flake 注入）：
#
#   services.recado = {
#     enable = true;
#     settings = {
#       OIDC_ISSUER_URL = "https://id.example.com";
#       OIDC_CLIENT_ID = "recado";
#       OIDC_REDIRECT_URI = "https://comments.example.com/auth/callback";
#       OIDC_ROLE_PREFIX = "recado";
#       PUBLIC_BASE_URL = "https://comments.example.com";
#     };
#     environmentFile = "/run/secrets/recado.env";   # DATABASE_URL / SESSION_SECRET / SECRETS_KEY / OIDC_CLIENT_SECRET
#     database.createLocally = true;                 # 在本机起 PostgreSQL（socket + peer 认证）
#   };
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.recado;

  # 环境变量只接受标量；布尔值必须转成 true/false，不能走 toString（会得到 1/0）。
  renderValue =
    value: if lib.isBool value then (if value then "true" else "false") else toString value;

  environment = {
    # 与 docker/Dockerfile 运行层一致；settings 里显式写 NODE_ENV 可以覆盖它。
    NODE_ENV = "production";
  }
  // lib.mapAttrs (_: renderValue) cfg.settings
  // {
    PORT = toString cfg.port;
  };

  environmentFile = lib.optional (cfg.environmentFile != null) cfg.environmentFile;

  # 两个 unit 共用的加固：进程需要做的事只有「连数据库、发 SMTP、监听端口」。
  # ⚠️ 不要加 MemoryDenyWriteExecute —— V8 的 JIT 需要可写可执行内存。
  hardening = {
    NoNewPrivileges = true;
    PrivateDevices = true;
    PrivateTmp = true;
    ProtectClock = true;
    ProtectControlGroups = true;
    ProtectHome = true;
    ProtectKernelLogs = true;
    ProtectKernelModules = true;
    ProtectKernelTunables = true;
    ProtectSystem = "strict";
    # AF_NETLINK：Node 枚举网卡 / 解析地址时会用到
    RestrictAddressFamilies = [
      "AF_INET"
      "AF_INET6"
      "AF_UNIX"
      "AF_NETLINK"
    ];
    RestrictNamespaces = true;
    RestrictRealtime = true;
    RestrictSUIDSGID = true;
    LockPersonality = true;
    SystemCallArchitectures = "native";
    CapabilityBoundingSet = [ "" ];
    AmbientCapabilities = [ "" ];
  };
in
{
  options.services.recado = {
    enable = lib.mkEnableOption "Recado 评论系统";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.recado;
      defaultText = lib.literalExpression "pkgs.recado";
      description = ''
        服务端包。用 flake 的 `nixosModules.default` 时无需设置；
        只引入 `nix/module.nix` 时，需要 `nixpkgs.overlays = [ recado.overlays.default ]`
        或者显式指定本 flake 的 `packages.<system>.recado`。
      '';
    };

    cliPackage = lib.mkOption {
      type = lib.types.package;
      default = pkgs.recado-cli;
      defaultText = lib.literalExpression "pkgs.recado-cli";
      description = "运维 CLI 与迁移命令所在的包（提供 `recado-cli` 与 `recado-migrate`）。";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "HTTP 监听端口。只应暴露给反向代理，不要直接开到公网。";
    };

    settings = lib.mkOption {
      type = lib.types.attrsOf (
        lib.types.oneOf [
          lib.types.str
          lib.types.int
          lib.types.bool
        ]
      );
      default = { };
      example = lib.literalExpression ''
        {
          LOG_LEVEL = "info";
          OIDC_ISSUER_URL = "https://id.example.com";
          OIDC_CLIENT_ID = "recado";
          OIDC_REDIRECT_URI = "https://comments.example.com/auth/callback";
          OIDC_ROLE_PREFIX = "recado";
          PUBLIC_BASE_URL = "https://comments.example.com";
        }
      '';
      description = ''
        **非敏感**环境变量，直接被应用启动校验消费（完整清单见 `.env.example`）。

        敏感项（`DATABASE_URL`、`SESSION_SECRET`、`SECRETS_KEY`、`OIDC_CLIENT_SECRET`、
        `INTERNAL_DRAIN_TOKEN`）请写进 {option}`services.recado.environmentFile` ——
        这些值会进 Nix store，而 store 是全局可读的。
      '';
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/recado.env";
      description = ''
        密钥文件（`KEY=VALUE`），由 systemd 读取，例如用 sops-nix / agenix 生成。

        首次部署至少要提供：`DATABASE_URL`、`SESSION_SECRET`（≥32 字符）、
        `SECRETS_KEY`（≥32 字符）、`OIDC_CLIENT_SECRET`。
        ⚠️ `SECRETS_KEY` 丢失意味着所有站点的 SMTP 密码都要重填，请与数据库备份一起保存。
      '';
    };

    database.createLocally = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        在本机启用 PostgreSQL，并创建 `recado` 库与同名角色（socket + peer 认证，
        不需要密码）。开启后会自动把 `settings.DATABASE_URL` 设成
        `postgres:///<库名>?host=/run/postgresql`，除非你自己指定了它。
      '';
    };

    database.name = lib.mkOption {
      type = lib.types.str;
      default = "recado";
      description = "`database.createLocally` 创建的数据库名。";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "recado";
      description = "运行服务的系统用户（也是 peer 认证下的数据库角色名）。";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "recado";
      description = "运行服务的系统用户组。";
    };
  };

  config = lib.mkIf cfg.enable {
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      description = "Recado 评论系统";
    };

    users.groups.${cfg.group} = { };

    # 本机数据库：只在显式开启时接管 postgresql 服务。
    services.postgresql = lib.mkIf cfg.database.createLocally {
      enable = true;
      ensureDatabases = [ cfg.database.name ];
      ensureUsers = [
        {
          name = cfg.user;
          ensureDBOwnership = true;
        }
      ];
    };

    services.recado.settings.DATABASE_URL = lib.mkIf cfg.database.createLocally (
      lib.mkDefault "postgres:///${cfg.database.name}?host=/run/postgresql"
    );

    systemd.services.recado = {
      description = "Recado 评论系统";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ] ++ lib.optional cfg.database.createLocally "postgresql.service";

      inherit environment;

      serviceConfig = hardening // {
        Type = "simple";
        ExecStart = "${cfg.package}/bin/recado";
        User = cfg.user;
        Group = cfg.group;
        EnvironmentFile = environmentFile;
        Restart = "on-failure";
        RestartSec = 5;
        # 探针：/healthz 只看进程（数据库抖动不误杀），/readyz 会查库（503 时摘流量）。
        # 具体探测命令交给反向代理或 systemd 之外的工具，避免这里绑死一个 HTTP 客户端。
      };
    };

    systemd.services.recado-migrate = {
      description = "Recado 数据库迁移（一次性任务，需手动触发）";
      # 刻意不挂 wantedBy / requiredBy / partOf：迁移是**独立部署步骤**
      # （requirements.md §8.5），失败不应该污染应用启动流程。升级流程：
      #
      #   nixos-rebuild switch         # 或先只更新 flake 输入
      #   systemctl start recado-migrate
      #   systemctl restart recado
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ] ++ lib.optional cfg.database.createLocally "postgresql.service";

      inherit environment;

      serviceConfig = hardening // {
        Type = "oneshot";
        RemainAfterExit = false;
        ExecStart = "${cfg.cliPackage}/bin/recado-migrate";
        User = cfg.user;
        Group = cfg.group;
        EnvironmentFile = environmentFile;
      };
    };
  };
}
