/**
 * 预览渲染端点的请求契约。
 *
 * 放在 `@recado/shared` 而不是 `server`：这是**对外 API 的一部分**，
 * SDK 与 OpenAPI 都要从这里取类型（见 .specs/requirements.md §6 M8）。
 */

import { z } from 'zod';

export const RenderRequestSchema = z.object({
  /**
   * 待渲染的原文。
   *
   * 这里不设长度上限：上限来自**站点配置**（`settings.maxContentBytes`），
   * 由渲染服务在拿到站点上下文后判定，避免把站点级规则写死进公共契约。
   */
  content: z.string().min(1),
});

export type RenderRequest = z.infer<typeof RenderRequestSchema>;
