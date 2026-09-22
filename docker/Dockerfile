# Recado 应用镜像
#
# 多阶段构建：pnpm 只装依赖 → 构建 → 运行时只带 .output。
#
# 本轮（阶段 0）先保证「能构建、能起」；非 root 运行、体积精简与健康检查
# 在 T9.3 收尾。数据库迁移不在镜像启动流程里（见 compose.yaml 注释）。

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---------- 依赖层：只在 lockfile 变化时重装 ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/sdk/package.json packages/sdk/
COPY packages/shared/package.json packages/shared/
# 构建机上不需要 git 钩子
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------- 构建层 ----------
FROM deps AS build
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm build

# ---------- 运行层 ----------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000

# Nitro 的产物是自包含的（.output 内含运行所需依赖）
COPY --from=build /app/apps/server/.output ./.output

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
