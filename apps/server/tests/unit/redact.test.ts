import { describe, expect, it } from 'vitest';

import { REDACTED, createLogger } from '../../src/lib/logger.server';
import { hashForLog, keepTail, maskEmail, maskIp } from '../../src/lib/redact.server';
import { testEnv } from '../helpers/context';

describe('掩码工具', () => {
  it('邮箱保留首字符与域名', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
  });

  it('畸形邮箱不泄漏原文', () => {
    expect(maskEmail('not-an-email')).toBe('***');
  });

  it('IPv4 抹掉后两段', () => {
    expect(maskIp('203.0.113.9')).toBe('203.0.x.x');
  });

  it('IPv6 只保留前两组', () => {
    expect(maskIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8::…');
  });

  it('keepTail 只留末尾若干位', () => {
    expect(keepTail('rc_abcdefghijkl', 4)).toBe('***ijkl');
    expect(keepTail('abc', 4)).toBe('***');
  });

  it('hashForLog 稳定且随盐变化 —— 同一值可关联，跨实例不可反查', () => {
    expect(hashForLog('203.0.113.9', 'salt')).toBe(hashForLog('203.0.113.9', 'salt'));
    expect(hashForLog('203.0.113.9', 'salt')).not.toBe(hashForLog('203.0.113.9', 'other'));
    expect(hashForLog('203.0.113.9', 'salt')).toHaveLength(12);
  });
});

function capture() {
  const lines: string[] = [];
  return {
    lines,
    destination: {
      write(line: string) {
        lines.push(line);
      },
    },
  };
}

describe('logger 脱敏', () => {
  it('直接字段与嵌套字段都被抹掉', () => {
    const sink = capture();
    const logger = createLogger(testEnv({ LOG_LEVEL: 'info' }), { destination: sink.destination });

    logger.info(
      {
        email: 'alice@example.com',
        ip: '203.0.113.9',
        headers: { cookie: 'sid=1', authorization: 'Bearer x' },
        site: { settings: { smtp: { pass: 'hunter2', host: 'smtp.example.com' } } },
      },
      'probe',
    );

    const entry = JSON.parse(sink.lines[0] ?? '{}');

    expect(entry.email).toBe(REDACTED);
    expect(entry.ip).toBe(REDACTED);
    expect(entry.headers.cookie).toBe(REDACTED);
    expect(entry.headers.authorization).toBe(REDACTED);
    expect(entry.site.settings.smtp.pass).toBe(REDACTED);
    // 非敏感字段必须保留，否则日志就失去排查价值
    expect(entry.site.settings.smtp.host).toBe('smtp.example.com');
  });

  it('requestId 作为 child binding 只出现一次', () => {
    const sink = capture();
    const logger = createLogger(testEnv({ LOG_LEVEL: 'info' }), {
      bindings: { requestId: 'r-1' },
      destination: sink.destination,
    });

    logger.info({ reason: 'NOT_FOUND_SITE' }, 'probe');

    const entry = JSON.parse(sink.lines[0] ?? '{}');
    expect(entry.requestId).toBe('r-1');
    expect(sink.lines[0]?.match(/"requestId"/g)).toHaveLength(1);
  });

  it('LOG_LEVEL=silent 时不输出任何日志（测试环境）', () => {
    const sink = capture();
    const logger = createLogger(testEnv({ LOG_LEVEL: 'silent' }), {
      destination: sink.destination,
    });

    logger.error('should not appear');

    expect(sink.lines).toHaveLength(0);
  });
});
