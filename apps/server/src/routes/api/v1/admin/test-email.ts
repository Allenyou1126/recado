import { renderTemplate, siteSettings } from '@recado/core';
import { AdminTestEmailInputSchema, err, ok, type AdminTestEmailInput } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_API_MIDDLEWARE } from '../../../../lib/http/admin-route';
import { createHandler } from '../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../lib/http/method-not-allowed';
import { readJsonBody, type RequestBodyError } from '../../../../lib/http/request';
import { sendMail } from '../../../../lib/mailer.server';

/**
 * `POST /api/v1/admin/test-email` —— 后台一键发信测试（T6.9）。
 *
 * **同步等待 SMTP 结果**并原样回报：这是整个系统里唯一一处「故意阻塞」的发信，
 * 因为它的全部价值就是即时反馈配置错在哪。错误信息经过裁剪，不带账号与凭据。
 */
const sendTest = createHandler<
  AdminSiteContext,
  { delivered: true },
  RequestBodyError | { reason: string; message: string; details?: unknown }
>(
  async (context, request) => {
    const body = await readJsonBody<AdminTestEmailInput>(request, AdminTestEmailInputSchema);
    if (body.error) return err(body.error);

    const settings = siteSettings(context.site);

    if (settings.smtp === null) {
      return err({
        reason: 'CONFLICT_SMTP_NOT_CONFIGURED',
        message: 'This site has no SMTP configuration',
      });
    }

    const rendered = renderTemplate('test', { siteName: context.site.name });
    const sent = await sendMail(context.env, context.site.id, settings.smtp, {
      to: body.data.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (sent.error) {
      return err({
        reason: sent.error.reason,
        message: sent.error.message,
        details: { permanent: sent.error.permanent },
      });
    }

    return ok({ delivered: true });
  },
  { operation: 'admin.test_email' },
);

export const Route = createFileRoute('/api/v1/admin/test-email')({
  server: {
    middleware: [...ADMIN_API_MIDDLEWARE],
    handlers: {
      POST: sendTest,
      ANY: async () => methodNotAllowed(['POST']),
    },
  },
});
