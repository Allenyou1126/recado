import { describe, expect, it } from 'vitest';

import { SiteSettingsSchema, parseSiteSettings } from './sites.schema';
import { SITE_KEY_PREFIX, SITE_KEY_RANDOM_LENGTH, generateSiteKey } from './sites.service';

describe('parseSiteSettings', () => {
  it('空配置取 §5.3 的默认值', () => {
    const settings = parseSiteSettings({});

    expect(settings).toMatchObject({
      maxDepth: 2,
      auditMode: 'none',
      spamThreshold: 1,
      pageSize: 20,
      maxPageSize: 50,
      repliesPreview: 3,
      maxContentBytes: 10_240,
      minIntervalSeconds: 20,
      requireNickname: true,
      originPolicy: 'strict',
      notifyEmails: [],
      notifyOnPending: false,
      smtp: null,
      emojis: {},
      markdown: { gfm: true },
      codeHighlight: true,
      math: true,
      linkNofollow: true,
    });
  });

  it('单个字段写错只回退该字段，不牵连整份配置', () => {
    const settings = parseSiteSettings({ maxDepth: 99, pageSize: 50, originPolicy: 'lenient' });

    expect(settings.maxDepth).toBe(2);
    expect(settings.pageSize).toBe(50);
    expect(settings.originPolicy).toBe('lenient');
  });

  it('整体不是对象时退回全默认值', () => {
    expect(parseSiteSettings('nonsense').maxDepth).toBe(2);
    expect(parseSiteSettings(null).originPolicy).toBe('strict');
    expect(parseSiteSettings([]).pageSize).toBe(20);
  });

  it('未知字段被丢弃，不会渗进领域对象', () => {
    const settings = parseSiteSettings({ somethingElse: true });

    expect(Object.keys(settings)).not.toContain('somethingElse');
  });

  it('maxDepth 只接受 1–5（§5.3）', () => {
    expect(parseSiteSettings({ maxDepth: 5 }).maxDepth).toBe(5);
    expect(parseSiteSettings({ maxDepth: 0 }).maxDepth).toBe(2);
    expect(parseSiteSettings({ maxDepth: 6 }).maxDepth).toBe(2);
  });
});

describe('SiteSettingsSchema', () => {
  it('解析后的对象再次解析结果稳定（幂等）', () => {
    const once = SiteSettingsSchema.parse({ pageSize: 30 });
    const twice = SiteSettingsSchema.parse(once);

    expect(twice).toEqual(once);
  });
});

describe('generateSiteKey', () => {
  it('形如 rc_ + 24 位小写字母数字', () => {
    const key = generateSiteKey();

    expect(key.startsWith(SITE_KEY_PREFIX)).toBe(true);
    expect(key.slice(SITE_KEY_PREFIX.length)).toMatch(
      new RegExp(`^[a-z0-9]{${SITE_KEY_RANDOM_LENGTH}}$`),
    );
  });

  it('多次生成互不相同', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateSiteKey()));

    expect(keys.size).toBe(200);
  });
});
