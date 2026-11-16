// 本地密钥保险箱：WebCrypto PBKDF2 + AES-GCM。
// 主密码仅用于派生密钥，永不存储明文；密文仅存本地，绝不上传。

const SALT_KEY = 'acm.vault.salt'
const VERIFY_KEY = 'acm.vault.verify'
const ITERATIONS = 210_000

const enc = new TextEncoder()
const dec = new TextDecoder()

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes.buffer
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function isVaultInitialized(): boolean {
  return !!localStorage.getItem(VERIFY_KEY)
}

/** 首次设置主密码。校验位用于 subsequent 验证，但不能反推密码。 */
export async function initVault(password: string): Promise<void> {
  if (password.length < 6) throw new Error('主密码至少 6 位')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(password, salt)
  const verifyIv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: verifyIv as BufferSource }, key, enc.encode('acm-verify'))
  localStorage.setItem(SALT_KEY, toBase64(salt.buffer))
  localStorage.setItem(VERIFY_KEY, toBase64(verifyIv.buffer) + ':' + toBase64(cipher))
}

export async function verifyVault(password: string): Promise<boolean> {
  const saltB64 = localStorage.getItem(SALT_KEY)
  const verify = localStorage.getItem(VERIFY_KEY)
  if (!saltB64 || !verify) return false
  try {
    const [ivB64, cipherB64] = verify.split(':')
    const key = await deriveKey(password, new Uint8Array(fromBase64(saltB64)))
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(fromBase64(ivB64)) as BufferSource },
      key,
      fromBase64(cipherB64),
    )
    return dec.decode(plain) === 'acm-verify'
  } catch {
    return false
  }
}

export async function encryptSecret(plaintext: string, password: string): Promise<string> {
  const saltB64 = localStorage.getItem(SALT_KEY)
  if (!saltB64) throw new Error('保险箱未初始化')
  const key = await deriveKey(password, new Uint8Array(fromBase64(saltB64)))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(plaintext))
  return toBase64(iv.buffer) + ':' + toBase64(cipher)
}

export async function decryptSecret(ciphertext: string, password: string): Promise<string> {
  const saltB64 = localStorage.getItem(SALT_KEY)
  if (!saltB64) throw new Error('保险箱未初始化')
  const [ivB64, cipherB64] = ciphertext.split(':')
  const key = await deriveKey(password, new Uint8Array(fromBase64(saltB64)))
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(fromBase64(ivB64)) as BufferSource },
    key,
    fromBase64(cipherB64),
  )
  return dec.decode(plain)
}

/** 仅用于展示的指纹：取原文前 4 后 4，中间打码，不可逆推完整 key */
export function fingerprint(secret: string): string {
  const s = secret.trim()
  if (s.length <= 8) return '••••'
  return `${s.slice(0, 4)}····${s.slice(-4)}`
}

/**
 * 修改主密码：验证旧密码 → 用旧密码解密所有密文 → 重置保险箱 → 用新密码重新加密。
 * 返回重新加密后的密文数组（顺序与输入一致）；若旧密码错误抛出错误，不改动任何数据。
 */
export async function changeMasterPassword(
  oldPassword: string,
  newPassword: string,
  ciphertexts: string[],
): Promise<string[]> {
  if (newPassword.length < 6) throw new Error('新密码至少 6 位')
  if (!(await verifyVault(oldPassword))) throw new Error('原主密码错误')

  // 先用旧密码解密全部（失败则中止，不改动保险箱）
  const plains: string[] = []
  for (const c of ciphertexts) {
    plains.push(await decryptSecret(c, oldPassword))
  }

  // 重置并用新密码初始化（新的盐与校验位）
  resetVault()
  await initVault(newPassword)

  // 用新密码重新加密
  const result: string[] = []
  for (const p of plains) result.push(await encryptSecret(p, newPassword))
  return result
}

const BIOMETRIC_PWD_KEY = 'acm.vault.bioPwd'

/**
 * 指纹解锁模式：将主密码以混淆形式存本地（非强加密，仅避免明文可见）。
 * 安全性说明：能读取 localStorage 的攻击者同样能读到密钥密文，此设计是本地便利性与安全的折中。
 */
export function saveBiometricPassword(password: string): void {
  const obfuscated = btoa(unescape(encodeURIComponent(password)).split('').reverse().join(''))
  localStorage.setItem(BIOMETRIC_PWD_KEY, obfuscated)
}

export function getBiometricPassword(): string | null {
  const raw = localStorage.getItem(BIOMETRIC_PWD_KEY)
  if (!raw) return null
  try {
    return decodeURIComponent(escape(atob(raw).split('').reverse().join('')))
  } catch { return null }
}

export function clearBiometricPassword(): void {
  localStorage.removeItem(BIOMETRIC_PWD_KEY)
}

/** 修改主密码时同步更新指纹模式的存储 */
export function resetVault(): void {
  localStorage.removeItem(SALT_KEY)
  localStorage.removeItem(VERIFY_KEY)
  clearBiometricPassword()
}
