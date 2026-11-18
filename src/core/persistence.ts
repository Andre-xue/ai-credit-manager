// 跨端持久化保障：把关键 localStorage 数据镜像到「真正的本机存储」，
// 目的：即使应用更新/重装导致 WebView 的 localStorage 被清空，也能在启动时恢复，
// 实现"只有本人主动退出才清除；更新安装新包不会清空数据"。
// - 手机（Capacitor）：用 Preferences（SharedPreferences/NSUserDefaults）。
// - 桌面（Tauri）：用 plugin-fs 写到 appDataDir 下的 acm-local-backup.json。
// - Web：无原生存储，降级为无操作（浏览器 localStorage 本身随域名持久）。

import { isNativeApp, isDesktopApp } from './openExternal'

const KEYS = [
  'acm.state.v1',
  'acm.vault.salt',
  'acm.vault.verify',
  'acm.vault.bioPwd',
  'acm.ai.history.v1',
  'acm.ai.conversationId',
  'acm.ai.model',
  'acm.sync.lastAt',
  'acm.sync.remoteVersion',
  'acm.sync.clientId',
  // 语音配置：不在云同步内，更新后必须保留
  'acm.tts.provider.config',
  'acm.volc.config.v1',
  'acm.tts.clonedVoice',
  'acm.tts.clonedVoices.v2',
  // 云登录会话：避免重装后云账户丢失（敏感，仅存本机文件，不进云同步）
  'workbuddy-cloud.session',
] as const

const BACKUP_FILE = 'acm-local-backup.json'

// ---------- 桌面（Tauri）----------
async function desktopPaths(): Promise<{ dir: string; file: string } | null> {
  try {
    const { appDataDir, join } = await import('@tauri-apps/api/path')
    const dir = await appDataDir()
    return { dir, file: await join(dir, BACKUP_FILE) }
  } catch { return null }
}

async function backupToDesktop(): Promise<void> {
  const paths = await desktopPaths()
  if (!paths) return
  try {
    const fs = await import('@tauri-apps/plugin-fs')
    const data: Record<string, string> = { __at: new Date().toISOString() }
    for (const key of KEYS) {
      const val = localStorage.getItem(key)
      if (val !== null) data[key] = val
    }
    // 云 session 的 key 带后缀，需按前缀收集
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? ''
      if (k.startsWith('workbuddy-cloud.session') && !(k in data)) data[k] = localStorage.getItem(k) ?? ''
    }
    // 确保目录存在再写（appDataDir 一般已存在）
    try { await fs.mkdir(paths.dir, { recursive: true }) } catch { /* 已存在 */ }
    await fs.writeTextFile(paths.file, JSON.stringify(data))
  } catch { /* 忽略 */ }
}

async function restoreFromDesktop(): Promise<void> {
  const paths = await desktopPaths()
  if (!paths) return
  try {
    const fs = await import('@tauri-apps/plugin-fs')
    if (!await fs.exists(paths.file)) return
    const text = await fs.readTextFile(paths.file)
    const data = JSON.parse(text) as Record<string, string>
    for (const key of KEYS) {
      if (localStorage.getItem(key) !== null) continue  // 本地已有，不覆盖
      if (typeof data[key] === 'string') localStorage.setItem(key, data[key])
    }
    // 恢复云 session 前缀键
    for (const k of Object.keys(data)) {
      if (k.startsWith('workbuddy-cloud.session') && localStorage.getItem(k) === null) {
        localStorage.setItem(k, data[k])
      }
    }
  } catch { /* 忽略 */ }
}

async function clearDesktopBackup(): Promise<void> {
  const paths = await desktopPaths()
  if (!paths) return
  try {
    const fs = await import('@tauri-apps/plugin-fs')
    if (await fs.exists(paths.file)) await fs.remove(paths.file)
  } catch { /* 忽略 */ }
}

// ---------- 手机（Capacitor）----------
async function backupToCapacitor(): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences')
    for (const key of KEYS) {
      const val = localStorage.getItem(key)
      if (val !== null) await Preferences.set({ key, value: val })
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? ''
      if (k.startsWith('workbuddy-cloud.session')) {
        const v = localStorage.getItem(k)
        if (v !== null) await Preferences.set({ key: k, value: v })
      }
    }
    await Preferences.set({ key: 'acm.backup.at', value: new Date().toISOString() })
  } catch { /* 忽略 */ }
}

async function restoreFromCapacitor(): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences')
    for (const key of KEYS) {
      if (localStorage.getItem(key) !== null) continue
      const { value } = await Preferences.get({ key })
      if (value != null) localStorage.setItem(key, value)
    }
    // 云 session 前缀键：Capacitor Preferences 用 keys() 枚举
    const keyList = (await Preferences.keys()).keys
    for (const k of keyList) {
      if (k.startsWith('workbuddy-cloud.session') && localStorage.getItem(k) === null) {
        const { value } = await Preferences.get({ key: k })
        if (value != null) localStorage.setItem(k, value)
      }
    }
  } catch { /* 忽略 */ }
}

async function clearCapacitorBackup(): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences')
    for (const key of KEYS) await Preferences.remove({ key })
    const keyList = (await Preferences.keys()).keys
    for (const k of keyList) if (k.startsWith('workbuddy-cloud.session')) await Preferences.remove({ key: k })
    await Preferences.remove({ key: 'acm.backup.at' })
  } catch { /* 忽略 */ }
}

// ---------- 统一入口 ----------
export async function backupToNative(): Promise<void> {
  if (isDesktopApp()) return backupToDesktop()
  if (isNativeApp()) return backupToCapacitor()
}

export async function restoreFromNative(): Promise<void> {
  if (isDesktopApp()) return restoreFromDesktop()
  if (isNativeApp()) return restoreFromCapacitor()
}

export async function clearNativeBackup(): Promise<void> {
  if (isDesktopApp()) return clearDesktopBackup()
  if (isNativeApp()) return clearCapacitorBackup()
}
