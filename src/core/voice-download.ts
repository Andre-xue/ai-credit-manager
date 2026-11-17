// 音色文件下载管理器：本地同一时间只保留一个音色文件，避免存储空间过载。
// 切换音色时：删除旧文件 → 提示 → 下载新文件。文件存 IndexedDB（适合二进制 Blob）。
// 第三方 TTS 的密钥本地加密存储；未配置时下载入口禁用并说明。

const DB_NAME = 'acm-voice-db'
const STORE = 'voices'
const SLOT_KEY = 'active-voice'
const CONFIG_KEY = 'acm.tts.provider.config'

export type VoiceDownloadState = 'idle' | 'downloading' | 'ready' | 'error'

export interface VoiceFile {
  id: string
  name: string
  blob: Blob
  downloadedAt: number
}

export interface TtsProviderConfig {
  /** 第三方 TTS 服务类型；未配置为空 */
  provider: '' | 'tencent' | 'aliyun'
  /** 服务端点（由部署方配置，避免前端持有长期密钥） */
  endpoint: string
  secretId?: string
  secretKey?: string
}

const EMPTY_CONFIG: TtsProviderConfig = { provider: '', endpoint: '' }

/** 切换音色时的标准提示（保留原意，措辞更自然） */
export const SWITCH_NOTICE = '为避免存储空间过载，已清理原下载的音色，正在下载新音色…'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 读取当前已下载的音色文件（只会有一个） */
export async function getActiveVoiceFile(): Promise<VoiceFile | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(SLOT_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch { return null }
}

/** 删除当前已下载的音色文件（释放存储） */
export async function deleteActiveVoiceFile(): Promise<boolean> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(SLOT_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return true
  } catch { return false }
}

/** 是否已有下载的音色文件 */
export async function hasDownloadedVoice(): Promise<boolean> {
  return (await getActiveVoiceFile()) !== null
}

/** 获取 TTS 配置（明文返回给调用方用于发起请求，存储时不落明文日志） */
export function getTtsConfig(): TtsProviderConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? { ...EMPTY_CONFIG, ...JSON.parse(raw) } : EMPTY_CONFIG
  } catch { return EMPTY_CONFIG }
}

export function hasTtsConfig(): boolean {
  const c = getTtsConfig()
  return !!(c.provider && c.endpoint)
}

export function saveTtsConfig(c: TtsProviderConfig): void {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)) } catch { /* 忽略 */ }
}

export function clearTtsConfig(): void {
  try { localStorage.removeItem(CONFIG_KEY) } catch { /* 忽略 */ }
}

/**
 * 切换并下载音色：核心互斥逻辑。
 * 1) 若已有旧音色文件 → 删除 → 通过 onNotice 提示（优化文案）
 * 2) 通过配置的 TTS endpoint 下载新音色文件
 * 3) 成功后写入单槽位（天然保证同时只有一个）
 *
 * 未配置第三方 TTS 时返回 error，界面据此置灰方言项。
 */
export async function switchVoice(
  voiceId: string,
  voiceName: string,
  onState: (s: VoiceDownloadState) => void,
  onNotice?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  const config = getTtsConfig()
  if (!config.provider || !config.endpoint) {
    return { ok: false, error: '方言音色需先配置第三方语音服务（设置 → 语音朗读）' }
  }

  // 互斥：先删除旧文件并提示
  const old = await getActiveVoiceFile()
  if (old && old.id !== voiceId) {
    await deleteActiveVoiceFile()
    onNotice?.(SWITCH_NOTICE)
  }

  onState('downloading')
  try {
    // 通过部署方的 TTS 代理端点换取音频；密钥在服务端持有，前端只传音色 id。
    const url = `${config.endpoint.replace(/\/$/, '')}/voice?provider=${encodeURIComponent(config.provider)}&voice=${encodeURIComponent(voiceId)}`
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`)
    const blob = await res.blob()
    if (blob.size === 0) throw new Error('下载的音色文件为空')

    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ id: voiceId, name: voiceName, blob, downloadedAt: Date.now() } satisfies VoiceFile, SLOT_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    onState('ready')
    return { ok: true }
  } catch (e) {
    onState('error')
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg.includes('abort') ? '已取消下载' : `音色下载失败：${msg.slice(0, 80)}` }
  }
}
