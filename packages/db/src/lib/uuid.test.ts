import { describe, expect, it } from 'vitest';

import { uuidv7 } from './uuid';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('产出标准 UUID 形状', () => {
    expect(uuidv7()).toMatch(UUID_PATTERN);
  });

  it('版本位是 7、变体位是 0b10', () => {
    const id = uuidv7();

    expect(id.charAt(14)).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id.charAt(19));
  });

  it('时间戳相同的两次生成也会不同（随机位生效）', () => {
    const now = 1_700_000_000_000;

    expect(uuidv7(now)).not.toBe(uuidv7(now));
  });

  it('按时间递增，字符串序即时间序 —— 这正是选 v7 的理由', () => {
    const older = uuidv7(1_700_000_000_000);
    const newer = uuidv7(1_700_000_001_000);

    expect(older < newer).toBe(true);
  });

  it('把时间戳编进高位，可解出原始毫秒数', () => {
    const now = 1_700_000_000_000;
    const id = uuidv7(now);

    const encoded = Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    expect(encoded).toBe(now);
  });
});
