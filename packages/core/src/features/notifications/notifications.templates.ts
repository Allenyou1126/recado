/**
 * 邮件模板：内置模板 + 变量替换，**集中管理**。
 *
 * 为什么要集中：Waline 的模板散落在各处、且没有预览机制，
 * 改一句文案要先找到那段字符串。这里把模板与变量声明放在一起，
 * 后台预览与「发信测试」直接复用同一份实现。
 *
 * 模板只做**转义后的变量替换**：变量值来自用户内容（昵称、评论正文），
 * 直接拼进 HTML 会变成注入点。
 */

/** 模板变量：一律按字符串处理，注入前统一转义 */
export type TemplateVariables = Record<string, string>;

export type TemplateName = 'admin_new_comment' | 'reply' | 'test';

export type RenderedTemplate = {
  subject: string;
  html: string;
  text: string;
};

/** HTML 转义：模板里所有变量都必须经过它 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 把 `{{name}}` 占位符替换成变量值 */
export function interpolate(template: string, variables: TemplateVariables): string {
  return template.replaceAll(/\{\{(\w+)\}\}/g, (_match, key: string) => variables[key] ?? '');
}

type TemplateDefinition = {
  subject: string;
  html: string;
  text: string;
};

/**
 * 内置模板。
 *
 * 正文里的 `{{content}}` 是**纯文本**（已剥离 HTML），而 `{{contentHtml}}`
 * 只在管理员通知里用于高亮展示 —— 后者必须是渲染后的安全 HTML
 * （渲染管线已经消毒过），用户自填字段则一律用 `{{...}}` 文本变量。
 */
const TEMPLATES: Record<TemplateName, TemplateDefinition> = {
  admin_new_comment: {
    subject: '[{{siteName}}] {{author}} 在 {{path}} 发表了评论',
    html: [
      '<p><strong>{{author}}</strong> 在 <a href="{{url}}">{{path}}</a> 发表了新评论：</p>',
      '<blockquote>{{content}}</blockquote>',
      '<p style="color:#888;font-size:12px">这是一封自动通知。你可以在后台关闭或调整收件人。</p>',
    ].join('\n'),
    text: '{{author}} 在 {{path}} 发表了新评论：\n\n{{content}}\n\n{{url}}',
  },

  reply: {
    subject: '[{{siteName}}] {{author}} 回复了你的评论',
    html: [
      '<p><strong>{{author}}</strong> 回复了你在 <a href="{{url}}">{{path}}</a> 的评论：</p>',
      '<blockquote>{{content}}</blockquote>',
      '<p><a href="{{unsubscribeUrl}}">不再接收此站点的邮件</a></p>',
    ].join('\n'),
    text: '{{author}} 回复了你在 {{path}} 的评论：\n\n{{content}}\n\n{{url}}\n\n退订：{{unsubscribeUrl}}',
  },

  test: {
    subject: '[{{siteName}}] 发信测试',
    html: '<p>这是一封测试邮件。收到它说明站点 <strong>{{siteName}}</strong> 的 SMTP 配置可用。</p>',
    text: '这是一封测试邮件。收到它说明站点 {{siteName}} 的 SMTP 配置可用。',
  },
};

/**
 * 渲染模板。
 *
 * 变量在插入前统一转义；主题行里的变量也不例外（邮件主题同样可能被
 * 注入换行来伪造头部）。
 */
export function renderTemplate(name: TemplateName, variables: TemplateVariables): RenderedTemplate {
  const definition = TEMPLATES[name];

  const escaped: TemplateVariables = {};
  for (const [key, value] of Object.entries(variables)) {
    escaped[key] = escapeHtml(value);
  }

  return {
    subject: interpolate(definition.subject, escaped)
      .replaceAll(/[\r\n]+/g, ' ')
      .trim(),
    html: interpolate(definition.html, escaped),
    text: interpolate(definition.text, variables),
  };
}

/** 模板清单（后台预览用） */
export function listTemplates(): TemplateName[] {
  return Object.keys(TEMPLATES) as TemplateName[];
}

/** 把渲染后的 HTML 粗略转成纯文本，供 {{content}} 变量使用 */
export function htmlToText(html: string): string {
  return html
    .replaceAll(/<br\s*\/?>/gi, '\n')
    .replaceAll(/<\/(p|div|blockquote|li|h[1-6])>/gi, '\n')
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}
