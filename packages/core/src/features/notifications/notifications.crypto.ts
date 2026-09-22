/**
 * 站点级 SMTP 密码的加解密。
 *
 * 需求 Q-10：SMTP 密码必须**加密存储**，读接口只回显「是否已配置」。
 * 这里用 AES-256-GCM：
 *
 * - 密钥由 `SECRETS_KEY` 经 SHA-256 派生（配置本身要求 ≥32 字符）
 * - 每次加密随机 12 字节 IV，密文里带上认证标签，防篡改
 * - 密文格式 `v1:<iv>:<tag>:<ciphertext>`，前缀留出版本位以便将来换算法
 *
 * ⚠️ 密钥丢失意味着所有站点的 SMTP 密码都要重填 —— 这一点必须写进部署文档。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

function deriveKey(secretsKey: string): Buffer {
  // SHA-256 而不是 scrypt：SECRETS_KEY 本身是高熵随机串（配置要求 ≥32 字符），
  // 不需要抗暴力破解的慢 KDF，而慢 KDF 会让每次取配置都变慢
  return createHash('sha256').update(secretsKey).digest();
}

export function encryptSecret(plaintext: string, secretsKey: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secretsKey), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/** 解密失败返回 null（密钥换了、密文被改），调用方按「未配置」处理 */
export function decryptSecret(payload: string, secretsKey: string): string | null {
  const [version, iv, tag, ciphertext] = payload.split(':');

  if (version !== VERSION || !iv || !tag || !ciphertext) return null;

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      deriveKey(secretsKey),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** 判断是否已是密文（避免对已加密的值重复加密） */
export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(`${VERSION}:`) && value.split(':').length === 4;
}
