// 原生持久化保障：把关键 localStorage 数据镜像到 Capacitor Preferences（原生 SharedPreferences/NSUserDefaults）。
// 目的：即使应用更新/重装导致 WebView 的 localStorage 被清空，也能在启动时恢复业务数据与保险箱材料，
// 从而实现"只有本人主动退出才清除；更新安装新包不会清空数据"。桌面/Web 无原生 Preferences 时降级为无操作。

import { isNativeApp } from './openExternal'

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
] as const

/** 把当前 localStorage 的关键值备份到原生存储（静默失败） */
export async function backupToNative(): Promise<void> {
  if (!isNativeApp()) return
  try {
    const { Preferences } = await import('@capacitor/preferences')
    for (const key of KEYS) {
      const val = localStorage.getItem(key)
      if (val !== null) await Preferences.set({ key, value: val })
    }
    await Preferences.set({ key: 'acm.backup.at', value: new Date().toISOString() })
  } catch { /* 非原生或失败时忽略 */ }
}

/** 启动时从原生存储恢复 localStorage 中缺失的键（不覆盖已存在的值） */
export async function restoreFromNative(): Promise<void> {
  if (!isNativeApp()) return
  try {
    const { Preferences } = await import('@capacitor/preferences')
    for (const key of KEYS) {
      if (localStorage.getItem(key) !== null) continue  // 本地已有，不覆盖
      const { value } = await Preferences.get({ key })
      if (value != null) localStorage.setItem(key, value)
    }
  } catch { /* 忽略 */ }
}

/** 主动清除（仅在用户本人退出/重置时调用） */
export async function clearNativeBackup(): Promise<void> {
  if (!isNativeApp()) return
  try {
    const { Preferences } = await import('@capacitor/preferences')
    for (const key of KEYS) await Preferences.remove({ key })
    await Preferences.remove({ key: 'acm.backup.at' })
  } catch { /* 忽略 */ }
}
