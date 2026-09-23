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

      # `nix flake check` 只构建 checks，这里让两个产物都进检查范围。
      checks = forAllSystems (pkgs: {
        inherit (self.packages.${pkgs.stdenv.hostPlatform.system}) recado recado-cli;
      });

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
