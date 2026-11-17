// 删除 API Key 前的强制备份：支持密文云备份、本机文件（明文/密文）、本机备忘录（明文）。
// 备份文件是自包含的：密文备份带保险箱同步材料，明文备份带解密后的 Key。

import type { AppState, Account, CheckinRecord, QuotaSnapshot, UsageEvent } from './types'
import { decryptSecret, getVaultSyncMaterial, type VaultSyncMaterial } from './crypto'
import { isNativeApp, isDesktopApp } from './openExternal'
import { pushPayload } from './sync'
import { todayISO, uid } from './store'

export type KeyBackupMode = 'cloud' | 'local' | 'notes'
export type KeyBackupFormat = 'cipher' | 'plain'

export interface KeyBackupItem {
  account: Account
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
  const targets = state.accounts.filter(a => accountIds.includes(a.id))
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

export function serializeKeyBackup(backup: KeyBackupFile): string {
  return JSON.stringify(backup, null, 2)
}

function defaultFileName(backup: KeyBackupFile): string {
  return `acm-key-backup-${backup.format}-${todayISO()}-${backup.backupId.slice(-6)}.json`
}

function browserDownload(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
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
export async function backupToLocalFile(backup: KeyBackupFile, dir?: string | null): Promise<BackupResult> {
  const text = serializeKeyBackup(backup)
  const filename = defaultFileName(backup)
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
    browserDownload(text, filename)
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
export async function backupToNotes(backup: KeyBackupFile): Promise<BackupResult> {
  // 备忘录只能明文：防御性检查，避免调用方传错格式
  if (backup.format !== 'plain') return { ok: false, error: '备忘录备份只能使用明文格式' }
  const text = serializeKeyBackup(backup)
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
