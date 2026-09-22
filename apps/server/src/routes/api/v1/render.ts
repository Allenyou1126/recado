import {
  renderMarkdown,
  renderOptionsFromSettings,
  siteSettings,
  type RenderError,
} from '@recado/core';
import { err, ok, RenderRequestSchema, type RenderRequest } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { PUBLIC_API_MIDDLEWARE } from '../../../lib/http/api-route';
import { createHandler } from '../../../lib/http/handler';
import { methodNotAllowed } from '../../../lib/http/method-not-allowed';
import { readJsonBody, type RequestBodyError } from '../../../lib/http/request';

/**
 * 预览渲染：`POST /api/v1/render`。
 *
 * **复用与落库完全相同的管线**，因此「预览所见 = 最终所得」是结构上的保证，
 * 而不是靠两处代码保持同步（Waline 的双管线分歧正是这么来的）。
 *
 * 刻意**不落库**：预览只是给输入框用的，写库会带来垃圾数据与额外的限流压力。
 */

type RenderPreview = {
  html: string;
  mentions: string[];
};

/** 本路由可能失败的两类原因：请求体不合法，或渲染本身失败 */
type RenderRouteError = RequestBodyError | RenderError;

const previewRender = createHandler<SiteContext, RenderPreview, RenderRouteError>(
  async (context, request) => {
    const body = await readJsonBody<RenderRequest>(request, RenderRequestSchema);

    if (body.error) {
      return err(body.error);
    }

    const rendered = await renderMarkdown(
      body.data.content,
      renderOptionsFromSettings(siteSettings(context.site)),
    );

    if (rendered.error) {
      return err(rendered.error);
    }

    // 显式构造响应：只回前端需要的两个字段，不做任何透传
    return ok({ html: rendered.data.html, mentions: rendered.data.mentions });
  },
  { operation: 'render.preview' },
);

export const Route = createFileRoute('/api/v1/render')({
  server: {
    middleware: [...PUBLIC_API_MIDDLEWARE],
    handlers: {
      POST: previewRender,

      // 未匹配的方法不会自动 405，必须显式兜住（AGENTS.md 硬性约束）
      ANY: async () => methodNotAllowed(['POST']),
    },
  },
});
