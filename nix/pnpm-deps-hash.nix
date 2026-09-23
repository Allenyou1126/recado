# pnpm 依赖（fetchPnpmDeps）的固定输出哈希，**按平台分别记录**。
#
# 为什么会变、什么时候要重新生成：
# - `pnpm-lock.yaml` 变化；
# - `pnpm` 大版本变化（平台相关的可选依赖会跟着变，比如 @esbuild/linux-x64）。
#   本 flake 用的是 nixpkgs 的 pnpm_12，见 nix/packages.nix。
#
# 重新生成的办法（nixpkgs 的约定流程）：
#
#   nix build .#recado 2>&1 | grep 'got:'
#
# 把报错里的 `got: sha256-…` 填回对应平台；没有记录的平台同样会以
# hash mismatch 报出该平台自己的正确哈希（不同平台的哈希**不通用**）。
{
  x86_64-linux = "sha256-RtjjMx7QbCM2z4F2Kcx3CMFu6V5LP88OpK7FVN2ceKw=";
}
