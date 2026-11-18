// 删除 API Key 前的强制备份：支持密文云备份、本机文件（明文/密文）、本机备忘录（明文）。
// 备份文件是自包含的：密文备份带保险箱同步材料，明文备份带解密后的 Key。

import type { AppState, Account, CheckinRecord, QuotaSnapshot, UsageEvent } from './types'
import { isLocalProvider } from './types'
import { decryptSecret, encryptSecret, fingerprint, getVaultSyncMaterial, applyVaultSyncMaterial, type VaultSyncMaterial } from './crypto'
import { isNativeApp, isDesktopApp } from './openExternal'
import { pushPayload } from './sync'
import { todayISO, uid } from './store'

export type KeyBackupMode = 'cloud' | 'local' | 'notes'
export type KeyBackupFormat = 'cipher' | 'plain'
/** 备份文件容器格式（与明文/密文无关） */
export type BackupFileFormat = 'json' | 'csv' | 'txt'

export interface KeyBackupItem {
  account: Account
  encryptedKey?: string
  quotas: QuotaSnapshot[]
  usage: UsageEvent[]
  checkins: CheckinRecord[]
  /** 仅明文备份包含 */
  apiKey?: string
}

export interface KeyBackupFile {
  kind: 'acm-key-backup'
  version: 1
  createdAt: string
  backupId: string
  /** 备忘录等手动保存场景用于确认用户确实保存成功 */
  confirmationCode: string
  format: KeyBackupFormat
  /** 密文备份时的保险箱材料，用于异机恢复解密 */
  vault?: VaultSyncMaterial
  accounts: KeyBackupItem[]
}

export interface BackupResult {
  ok: boolean
  /** 备份落点描述，用于界面提示 */
  location?: string
  /** 是否调起了系统分享（备忘录场景） */
  shared?: boolean
  error?: string
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

/** 构造备份对象。明文备份必须提供已验证的主密码。 */
export async function buildKeyBackup(
  state: AppState,
  accountIds: string[],
  format: KeyBackupFormat,
  pwd?: string,
): Promise<KeyBackupFile> {
  // 本地模型（Ollama/ComfyUI 等）只存本机路径，不进任何备份
  const targets = state.accounts.filter(a => accountIds.includes(a.id) && !isLocalProvider(a.providerId))
  if (targets.length === 0) throw new Error('没有可备份的账户')
  if (format === 'plain' && !pwd) throw new Error('明文备份需要验证主密码')

  const accounts: KeyBackupItem[] = []
  for (const a of targets) {
    let apiKey: string | undefined
    if (format === 'plain' && a.encryptedKey) {
      try { apiKey = await decryptSecret(a.encryptedKey, pwd!) }
      catch { throw new Error(`「${a.label}」解密失败，请确认主密码正确`) }
    }
    accounts.push({
      account: a,
      quotas: state.quotas.filter(q => q.accountId === a.id),
      usage: state.usage.filter(u => u.accountId === a.id),
      checkins: state.checkins.filter(c => c.accountId === a.id),
      apiKey,
    })
  }

  return {
    kind: 'acm-key-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    backupId: uid('bk'),
    confirmationCode: String(Math.floor(100000 + Math.random() * 900000)),
    format,
    vault: format === 'cipher' ? getVaultSyncMaterial() : undefined,
    accounts,
  }
}

/** CSV 单元格：转义双引号，并防公式注入（= + - @ 等开头加单引号） */
const csvCell = (v: unknown) => {
  const s = String(v ?? '')
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

// 不再导出 vaultBiometricPwd（可还原的主密码副本）。列顺序保持不变以兼容旧导入，
// 该列留空；导入端也忽略旧值。
const CSV_HEADER = [
  'kind', 'version', 'backupId', 'confirmationCode', 'createdAt', 'format',
  'vaultSalt', 'vaultVerify', 'vaultBiometricPwd',
  'id', 'providerId', 'label', 'mode', 'apiUrl', 'note', 'keyFingerprint', 'key',
  'accCreatedAt', 'accUpdatedAt', 'quotasJson', 'usageJson', 'checkinsJson',
]

/** 序列化为 JSON / CSV / TXT。TXT 也是可机器解析的稳定格式，不只是给人看。 */
export function serializeKeyBackup(backup: KeyBackupFile, fileFormat: BackupFileFormat = 'json'): string {
  if (fileFormat === 'json') return JSON.stringify(backup, null, 2)

  const vault = backup.vault
  const rows = backup.accounts.map(item => {
    const a = item.account
    const key = backup.format === 'plain' ? (item.apiKey ?? '') : (a.encryptedKey ?? '')
    return [
      backup.kind, backup.version, backup.backupId, backup.confirmationCode, backup.createdAt, backup.format,
      vault?.salt ?? '', vault?.verify ?? '', vault?.biometricPwd ?? '',
      a.id, a.providerId, a.label, a.mode, a.apiUrl ?? '', a.note ?? '', a.keyFingerprint ?? '', key,
      a.createdAt, a.updatedAt,
      JSON.stringify(item.quotas), JSON.stringify(item.usage), JSON.stringify(item.checkins),
    ]
  })

  if (fileFormat === 'csv') {
    return [CSV_HEADER, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
  }

  const lines = [
    '# AI 积分管家密钥备份（文本格式，可导入）',
    `kind=${JSON.stringify(backup.kind)}`,
    `version=${JSON.stringify(backup.version)}`,
    `backupId=${JSON.stringify(backup.backupId)}`,
    `confirmationCode=${JSON.stringify(backup.confirmationCode)}`,
    `createdAt=${JSON.stringify(backup.createdAt)}`,
    `format=${JSON.stringify(backup.format)}`,
    '[vault]',
    `salt=${JSON.stringify(vault?.salt ?? null)}`,
    `verify=${JSON.stringify(vault?.verify ?? null)}`,
    // 不写入主密码凭据；旧备份里的 biometricPwd 行在导入时也会被忽略
  ]
  rows.forEach(r => {
    lines.push('[account]')
    CSV_HEADER.slice(9).forEach((k, i) => lines.push(`${k}=${JSON.stringify(r[i + 9])}`))
  })
  return lines.join('\n')
}

function defaultFileName(backup: KeyBackupFile, fileFormat: BackupFileFormat = 'json'): string {
  return `acm-key-backup-${backup.format}-${todayISO()}-${backup.backupId.slice(-6)}.${fileFormat}`
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

const asArray = <T,>(v: unknown): T[] => {
  try { const p = JSON.parse(String(v ?? '[]')); return Array.isArray(p) ? p : [] } catch { return [] }
  return []
}

/** 识别并解析三种格式的备份文件（按内容识别，不依赖扩展名） */
export function parseKeyBackup(text: string): KeyBackupFile | null {
  const raw = text.trim()
  if (!raw) return null
  try {
    const json = JSON.parse(raw)
    if (json?.kind === 'acm-key-backup') return json as KeyBackupFile
  } catch { /* 继续尝试其他格式 */ }

  if (/^"?kind"?,/.test(raw.split(/\r?\n/)[0])) {
    const lines = raw.split(/\r?\n/)
    const header = parseCsvLine(lines[0]).map(h => h.trim())
    if (!header.includes('kind')) return null
    const get = (row: string[], key: string) => row[header.indexOf(key)] ?? ''
    const first = parseCsvLine(lines[1] ?? '')
    const vault: VaultSyncMaterial | undefined = get(first, 'vaultSalt')
      ? { salt: get(first, 'vaultSalt') || null, verify: get(first, 'vaultVerify') || null, biometricPwd: get(first, 'vaultBiometricPwd') || null }
      : undefined
    const accounts: KeyBackupItem[] = lines.slice(1).filter(Boolean).map(line => {
      const r = parseCsvLine(line)
      const account: Account = {
        id: get(r, 'id'), providerId: get(r, 'providerId'), label: get(r, 'label'),
        mode: get(r, 'mode') as Account['mode'], apiUrl: get(r, 'apiUrl') || undefined,
        note: get(r, 'note') || undefined, keyFingerprint: get(r, 'keyFingerprint') || undefined,
        createdAt: get(r, 'accCreatedAt'), updatedAt: get(r, 'accUpdatedAt'),
      }
      const isPlain = get(r, 'format') === 'plain'
      if (!isPlain) account.encryptedKey = get(r, 'key') || undefined
      return {
        account,
        encryptedKey: isPlain ? undefined : get(r, 'key') || undefined,
        apiKey: isPlain ? get(r, 'key') || undefined : undefined,
        quotas: asArray(get(r, 'quotasJson')), usage: asArray(get(r, 'usageJson')), checkins: asArray(get(r, 'checkinsJson')),
      } as KeyBackupItem
    }).filter(i => i.account.id)
    if (!accounts.length) return null
    return {
      kind: 'acm-key-backup', version: 1, createdAt: get(first, 'createdAt'),
      backupId: get(first, 'backupId'), confirmationCode: get(first, 'confirmationCode'),
      format: get(first, 'format') === 'plain' ? 'plain' : 'cipher', vault, accounts,
    }
  }

  if (raw.includes('[account]') || raw.startsWith('# AI 积分管家密钥备份')) {
    const meta: Record<string, unknown> = {}
    let vault: VaultSyncMaterial | undefined
    const accounts: KeyBackupItem[] = []
    let current: Record<string, unknown> | null = null
    let section: 'meta' | 'vault' | 'account' = 'meta'
    const parseVal = (s: string) => { try { return JSON.parse(s) } catch { return s } }
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      if (line === '[vault]') { section = 'vault'; vault = {} as VaultSyncMaterial; continue }
      if (line === '[account]') {
        if (current) accounts.push(fromTxtAccount(current))
        current = {}; section = 'account'; continue
      }
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim(), val = parseVal(line.slice(eq + 1).trim())
      if (section === 'vault' && vault) (vault as any)[key] = val
      else if (section === 'account' && current) current[key] = val
      else meta[key] = val
    }
    if (current) accounts.push(fromTxtAccount(current))
    if (!accounts.length || meta.kind !== 'acm-key-backup') return null
    return {
      kind: 'acm-key-backup', version: 1 as const,
      createdAt: String(meta.createdAt ?? ''), backupId: String(meta.backupId ?? ''),
      confirmationCode: String(meta.confirmationCode ?? ''),
      format: meta.format === 'plain' ? 'plain' : 'cipher',
      vault, accounts,
    }
  }
  return null
}

function fromTxtAccount(r: Record<string, unknown>): KeyBackupItem {
  const account: Account = {
    id: String(r.id ?? ''), providerId: String(r.providerId ?? ''), label: String(r.label ?? ''),
    mode: String(r.mode ?? 'api') as Account['mode'], apiUrl: String(r.apiUrl ?? '') || undefined,
    note: String(r.note ?? '') || undefined, keyFingerprint: String(r.keyFingerprint ?? '') || undefined,
    createdAt: String(r.accCreatedAt ?? ''), updatedAt: String(r.accUpdatedAt ?? ''),
  }
  const isPlain = r.format === 'plain' || String(r.key ?? '').startsWith('sk-')
  if (!isPlain) account.encryptedKey = String(r.key ?? '') || undefined
  return {
    account,
    encryptedKey: isPlain ? undefined : String(r.key ?? '') || undefined,
    apiKey: isPlain ? String(r.key ?? '') || undefined : undefined,
    quotas: asArray(r.quotasJson), usage: asArray(r.usageJson), checkins: asArray(r.checkinsJson),
  } as KeyBackupItem
}

/** 把备份导入到当前状态：密文原样恢复并应用保险箱材料；明文需当前主密码重新加密。 */
export async function importKeyBackup(text: string, state: AppState, pwd?: string): Promise<AppState> {
  const backup = parseKeyBackup(text)
  if (!backup) throw new Error('不是可识别的密钥备份文件（支持 JSON / CSV / TXT）')
  if (backup.vault?.salt || backup.vault?.verify) applyVaultSyncMaterial(backup.vault)
  const merge = <T extends { id: string }>(base: T[], incoming: T[]) => {
    const map = new Map(base.map(x => [x.id, x]))
    incoming.forEach(x => map.set(x.id, x))
    return Array.from(map.values())
  }
  let accounts = [...state.accounts]
  let quotas = [...state.quotas]
  let usage = [...state.usage]
  let checkins = [...state.checkins]
  for (const item of backup.accounts) {
    const a = { ...item.account }
    if (backup.format === 'plain' && item.apiKey) {
      if (!pwd) throw new Error('明文备份包含密钥，请先解锁保险箱再导入')
      a.encryptedKey = await encryptSecret(item.apiKey, pwd)
      a.keyFingerprint = fingerprint(item.apiKey)
    } else if (item.encryptedKey) {
      a.encryptedKey = item.encryptedKey
    }
    const idx = accounts.findIndex(x => x.id === a.id)
    if (idx >= 0) accounts[idx] = a; else accounts.unshift(a)
    quotas = merge(quotas, item.quotas)
    usage = merge(usage, item.usage)
    checkins = merge(checkins, item.checkins)
  }
  return { ...state, accounts, quotas, usage, checkins }
}

function browserDownload(text: string, filename: string, fileFormat: BackupFileFormat): void {
  const mime = fileFormat === 'json' ? 'application/json' : fileFormat === 'csv' ? 'text/csv' : 'text/plain'
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 桌面端弹出系统文件夹选择器，返回用户选定路径（取消返回 null） */
export async function chooseBackupFolder(): Promise<string | null> {
  if (!isDesktopApp()) return null
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }
  try {
    const dir = await w.__TAURI_INTERNALS__?.invoke?.('choose_save_dir', {})
    return typeof dir === 'string' && dir ? dir : null
  } catch { return null }
}

/** 备份到本机文件夹：桌面可指定目录，原生 App 写入 Documents，Web 走浏览器下载。 */
export async function backupToLocalFile(backup: KeyBackupFile, dir?: string | null, fileFormat: BackupFileFormat = 'json'): Promise<BackupResult> {
  const text = serializeKeyBackup(backup, fileFormat)
  const filename = defaultFileName(backup, fileFormat)
  try {
    if (isDesktopApp() && dir) {
      const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<string> } }
      const invoke = w.__TAURI_INTERNALS__?.invoke
      if (!invoke) throw new Error('桌面接口不可用')
      const path = await invoke('write_file_to_dir', { dir, filename, content: text })
      return { ok: true, location: path }
    }
    if (isNativeApp()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      await Filesystem.writeFile({
        path: filename,
        data: utf8ToBase64(text),
        directory: Directory.Documents,
        recursive: true,
      })
      return { ok: true, location: `Documents/${filename}` }
    }
    browserDownload(text, filename, fileFormat)
    return { ok: true, location: filename }
  } catch (e) {
    return { ok: false, error: `本机文件备份失败：${(e as Error)?.message ?? String(e)}` }
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch { /* 继续走兜底 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}

/** 备份到本机备忘录：优先调起系统分享（手机可直接选择备忘录），失败则复制到剪贴板。 */
export async function backupToNotes(backup: KeyBackupFile, fileFormat: BackupFileFormat = 'txt'): Promise<BackupResult> {
  // 备忘录只能明文：防御性检查，避免调用方传错格式
  if (backup.format !== 'plain') return { ok: false, error: '备忘录备份只能使用明文格式' }
  const text = serializeKeyBackup(backup, fileFormat)
  const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string }) => Promise<void> }
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: 'AI 积分管家密钥备份', text })
      return { ok: true, shared: true }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return { ok: false, error: '已取消分享，未执行删除' }
      // 分享不可用则降级剪贴板
    }
  }
  const copied = await copyText(text)
  return copied
    ? { ok: true, shared: false, location: '剪贴板' }
    : { ok: false, error: '无法写入剪贴板，请检查浏览器权限' }
}

/** 密文备份到云：把备份追加到云端载荷，保留已有备份（最多 20 份）。 */
export async function backupToCloud(backup: KeyBackupFile, appState: AppState): Promise<BackupResult> {
  if (backup.format !== 'cipher') return { ok: false, error: '云端备份仅支持密文格式' }
  const result = await pushPayload(appState, [backup])
  return result.ok
    ? { ok: true, location: '云端保险箱' }
    : { ok: false, error: `云端备份失败：${result.error ?? '未知错误'}` }
}
