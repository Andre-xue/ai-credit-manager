// 声音克隆样本管理：录音或音频文件 → 本地 IndexedDB 单槽位保存 → 通过第三方 TTS 代理 /clone 克隆。
// 当前内置免费云模型不提供声音克隆能力，因此克隆必须依赖用户在「第三方语音服务配置」里提供的代理端点。

import { getTtsConfig } from './voice-download'

const DB_NAME = 'acm-voice-sample-db'
const STORE = 'samples'
const SLOT_KEY = 'active-sample'
const CLONED_VOICE_KEY = 'acm.tts.clonedVoice'

export interface VoiceSample {
  name: string
  mime: string
  dataUrl: string
  size: number
  createdAt: number
}

export interface CloneResult {
  ok: boolean
  voiceId?: string
  error?: string
}

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

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

/** 保存音频样本（单槽位，新样本自动替换旧样本） */
export async function saveVoiceSample(blob: Blob, name: string): Promise<VoiceSample> {
  const sample: VoiceSample = {
    name, mime: blob.type || 'audio/webm', dataUrl: await toDataUrl(blob),
    size: blob.size, createdAt: Date.now(),
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(sample, SLOT_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return sample
}

export async function loadVoiceSample(): Promise<VoiceSample | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(SLOT_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch { return null }
}

export async function deleteVoiceSample(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(SLOT_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch { /* 忽略 */ }
  try { localStorage.removeItem(CLONED_VOICE_KEY) } catch { /* 忽略 */ }
}

/** 录音：需要浏览器/原生 WebView 提供 getUserMedia；桌面 Tauri 可用音频文件导入兜底 */
export function recordVoiceSample(seconds = 8): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    const md = navigator.mediaDevices as MediaDevices | undefined
    if (!md?.getUserMedia || typeof MediaRecorder === 'undefined') {
      reject(new Error('当前环境不支持录音，请选择音频文件导入'))
      return
    }
    let stream: MediaStream
    try { stream = await md.getUserMedia({ audio: true }) }
    catch { reject(new Error('麦克风权限被拒绝，请授权后再录音')); return }
    const chunks: BlobPart[] = []
    const rec = new MediaRecorder(stream)
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })) }
    rec.onerror = () => { stream.getTracks().forEach(t => t.stop()); reject(new Error('录音失败')) }
    rec.start()
    window.setTimeout(() => { if (rec.state !== 'inactive') rec.stop() }, seconds * 1000)
  })
}

/** 调用第三方代理克隆声音；代理需实现 POST {endpoint}/clone，返回 { voiceId } */
export async function cloneVoiceFromSample(sample: VoiceSample, name?: string): Promise<CloneResult> {
  const cfg = getTtsConfig()
  if (!cfg.provider || !cfg.endpoint) {
    return { ok: false, error: '请先在下方配置第三方语音服务端点' }
  }
  try {
    const res = await fetch(`${cfg.endpoint.replace(/\/$/, '')}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: cfg.provider,
        name: name || sample.name,
        mime: sample.mime,
        audio: sample.dataUrl,
      }),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `克隆失败（HTTP ${res.status}）：${text.slice(0, 100)}` }
    let voiceId = ''
    try { voiceId = JSON.parse(text)?.voiceId ?? '' } catch { voiceId = text.trim() }
    if (!voiceId) return { ok: false, error: '服务未返回 voiceId' }
    localStorage.setItem(CLONED_VOICE_KEY, voiceId)
    return { ok: true, voiceId }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    const hint = /load failed|failed to fetch|networkerror/i.test(msg)
      ? '无法连接语音服务：请确认端点地址正确、云函数已部署，且已更新到支持自定义端点的桌面版本。Web/手机端请用浏览器或 App 内置网络'
      : `克隆请求失败：${msg}`
    return { ok: false, error: hint }
  }
}

export function getClonedVoiceId(): string | null {
  try { return localStorage.getItem(CLONED_VOICE_KEY) } catch { return null }
}

export function clearClonedVoice(): void {
  try { localStorage.removeItem(CLONED_VOICE_KEY) } catch { /* 忽略 */ }
}
