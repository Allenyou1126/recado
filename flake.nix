{
  description = "Recado —— 自托管、多站点、Headless 的评论系统";

  inputs = {
    # 只依赖 nixpkgs：这个仓库的其余依赖由 pnpm-lock.yaml 冻结，
    # 不引入 flake-utils / flake-parts 之类的辅助输入，减少一处需要跟进的更新源。
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      inherit (nixpkgs) lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # 版本号没有单一真源（package.json 里是 0.0.0），用 git 修订号标识构建：
      # store 路径里带上提交号，排查「线上跑的是哪一版」时不用再猜。
      version = "unstable-${self.shortRev or self.dirtyShortRev or "unknown"}";

      pnpmDepsHashes = import ./nix/pnpm-deps-hash.nix;

      mkPackages =
        pkgs:
        pkgs.callPackage ./nix/packages.nix {
          inherit version;
          # 未记录的平台先用 fakeHash：首次构建会以 hash mismatch 报出正确值，
          # 把它填进 nix/pnpm-deps-hash.nix 即可（见该文件注释）。
          pnpmDepsHash = pnpmDepsHashes.${pkgs.stdenv.hostPlatform.system} or lib.fakeHash;
        };
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          recadoPackages = mkPackages pkgs;
        in
        {
          inherit (recadoPackages) recado recado-cli;
          default = recadoPackages.recado;
        }
      );

      # `nix flake check` 的覆盖范围：两个产物 + NixOS 模块。
      checks = forAllSystems (
        pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;

          # 模块级回归检查：真的把 `nixosModules.default` 按文档里的最小配置求值一遍，
          # 并把生成的 `recado-cli` 包装脚本构建出来。
          #
          # 为什么值得单列一条：服务的环境变量只活在 systemd 单元里（`Environment=`
          # 与 `EnvironmentFile=`），把 `cliPackage` 直接丢进 PATH 是不够的 ——
          # 裸二进制会以「环境变量校验失败」退出，运维就没法创建第一个站点。
          # 光构建 `packages.recado-cli` 覆盖不到这一点。
          recadoModule = lib.nixosSystem {
            inherit system;
            modules = [
              self.nixosModules.default
              {
                nixpkgs.pkgs = pkgs;

                # 只是求值用的示例配置，不承载任何状态：写死它免得刷一条
                # 「system.stateVersion is not set」的求值警告。
                system.stateVersion = "26.11";

                services.recado = {
                  enable = true;
                  environmentFile = "/run/secrets/recado.env";
                  settings = {
                    OIDC_ISSUER_URL = "https://idp.example.com";
                    OIDC_CLIENT_ID = "recado";
                    OIDC_REDIRECT_URI = "https://comments.example.com/auth/callback";
                    OIDC_ROLE_PREFIX = "recado";
                    PUBLIC_BASE_URL = "https://comments.example.com";
                  };
                  database.createLocally = true;
                };
              }
            ];
          };

          cliWrapper = recadoModule.config.services.recado.cli.package;
        in
        {
          inherit (self.packages.${system}) recado recado-cli;

          nixos-module =
            if lib.elem cliWrapper recadoModule.config.environment.systemPackages then
              pkgs.runCommand "recado-nixos-module-check" { } ''
                # 引用即构建依赖：包装脚本本身必须能构建出来
                test -x ${cliWrapper}/bin/recado-cli

                # 包装脚本必须复现「服务身份 + 服务环境」这三件事：
                # 运行用户、密钥文件（密钥不进命令行参数）、以及 settings
                grep -q -F -- '--uid=recado' ${cliWrapper}/bin/recado-cli
                grep -q -F -- '--gid=recado' ${cliWrapper}/bin/recado-cli
                grep -q -F -- '--property=EnvironmentFile=/run/secrets/recado.env' ${cliWrapper}/bin/recado-cli
                grep -q -F -- '--setenv=OIDC_ISSUER_URL=https://idp.example.com' ${cliWrapper}/bin/recado-cli
                grep -q -F -- '--setenv=NODE_ENV=production' ${cliWrapper}/bin/recado-cli
                grep -q -F -- '--setenv=DATABASE_URL=postgres:///recado?host=/run/postgresql' ${cliWrapper}/bin/recado-cli
                grep -q -F -- '--setenv=PORT=3000' ${cliWrapper}/bin/recado-cli
                grep -q -F -- '--property=NoNewPrivileges=true' ${cliWrapper}/bin/recado-cli

                # 退出码要能透传给调用者（脚本里靠 systemd-run --wait --pipe）
                grep -q -F -- '--wait' ${cliWrapper}/bin/recado-cli
                grep -q -F -- '--pipe' ${cliWrapper}/bin/recado-cli

                touch $out
              ''
            else
              throw "services.recado.cli.enable 默认开启时，包装脚本必须进入 environment.systemPackages";
        }
      );

      nixosModules = {
        recado = ./nix/module.nix;

        # 带默认包的版本：直接用它就不需要额外配置 overlay。
        default =
          { pkgs, lib, ... }:
          {
            imports = [ ./nix/module.nix ];

            services.recado.package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.recado;
            services.recado.cliPackage =
              lib.mkDefault
                self.packages.${pkgs.stdenv.hostPlatform.system}.recado-cli;
          };
      };

      overlays.default = final: _prev: {
        inherit (mkPackages final) recado recado-cli;
      };

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
