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

# ---------- 迁移工具层 ----------
# 迁移是**独立部署步骤**，不挂在应用启动流程里：compose 的 migrate 服务用这个 stage
# 跑一次性任务（docker compose run --rm migrate），跑完即退。
# 这里直接复用 build 层，因为它同时具备源码、迁移文件与 devDependencies。
FROM build AS tools

CMD ["pnpm", "--filter", "@recado/db", "migrate"]

# ---------- 运行层 ----------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000

# Nitro 的产物是自包含的（.output 内含运行所需依赖）
COPY --from=build /app/apps/server/.output ./.output

# 非 root 运行：容器逃逸时把损失限制在最小范围
# （node 镜像自带 uid/gid 1000 的 node 用户，直接复用）
RUN chown -R node:node /app
USER node

EXPOSE 3000

# 用 /readyz 而不是 /healthz：它会在数据库不可用时返回 503，
# 编排系统据此把流量摘掉，而不是继续往一个跑不动的实例上打
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
