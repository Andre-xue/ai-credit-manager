// 声音克隆样本管理：录音或音频文件 → 本地 IndexedDB 保存 → 通过第三方 TTS 代理 /clone 克隆。
// 当前内置免费云模型不提供声音克隆能力，因此克隆必须依赖用户在「第三方语音服务配置」里提供的代理端点。
// 支持保存多个克隆音色，可命名、切换、删除；每个音色在本机独立记录其云端 voiceId。

import { getTtsConfig } from './voice-download'

const DB_NAME = 'acm-voice-sample-db'
const STORE = 'samples'
const SLOT_KEY = 'active-sample'
const CLONED_VOICE_KEY = 'acm.tts.clonedVoice'       // 当前激活的 voiceId（兼容旧版）
const CLONED_VOICES_KEY = 'acm.tts.clonedVoices.v2'  // 多音色列表

export interface VoiceSample {
  name: string
  mime: string
  dataUrl: string
  size: number
  createdAt: number
}

/** 一个已保存的克隆音色 */
export interface ClonedVoice {
  id: string
  /** 用户可见的名字 */
  name: string
  /** 云端真实的音色 ID（用于 /synthesize） */
  voiceId: string
  /** 克隆来源样本名 */
  sampleName?: string
  createdAt: number
}

export interface CloneResult {
  ok: boolean
  voiceId?: string
  error?: string
}

/** 读取已保存的克隆音色列表（含旧版单音色迁移） */
export function listClonedVoices(): ClonedVoice[] {
  try {
    const raw = localStorage.getItem(CLONED_VOICES_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.filter(v => v && v.voiceId)
    }
  } catch { /* 忽略 */ }
  // 兼容旧版：只有一个 voiceId 时迁移进来
  const legacy = getClonedVoiceId()
  if (legacy) {
    const item: ClonedVoice = { id: 'cv-legacy', name: '克隆音色', voiceId: legacy, createdAt: Date.now() }
    try { localStorage.setItem(CLONED_VOICES_KEY, JSON.stringify([item])) } catch { /* 忽略 */ }
    return [item]
  }
  return []
}

function saveClonedVoices(list: ClonedVoice[]): void {
  try { localStorage.setItem(CLONED_VOICES_KEY, JSON.stringify(list)) } catch { /* 忽略 */ }
}

/** 新增一个克隆音色并设为当前使用 */
export function addClonedVoice(name: string, voiceId: string, sampleName?: string): ClonedVoice {
  const list = listClonedVoices()
  const item: ClonedVoice = {
    id: `cv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || '克隆音色', voiceId, sampleName, createdAt: Date.now(),
  }
  saveClonedVoices([item, ...list])
  setActiveClonedVoice(item.voiceId)
  return item
}

/** 删除一个克隆音色（不删除云端音色，仅移除本机记录） */
export function removeClonedVoice(id: string): void {
  const list = listClonedVoices().filter(v => v.id !== id)
  saveClonedVoices(list)
  const active = getClonedVoiceId()
  const activeItem = list.find(v => v.voiceId === active)
  if (!activeItem) {
    // 当前激活的被删了，切到第一个或清空
    if (list.length) setActiveClonedVoice(list[0].voiceId)
    else clearClonedVoice()
  }
}

/** 切换当前使用的克隆音色 */
export function setActiveClonedVoice(voiceId: string): void {
  try { localStorage.setItem(CLONED_VOICE_KEY, voiceId) } catch { /* 忽略 */ }
}

/** 重命名一个克隆音色 */
export function renameClonedVoice(id: string, name: string): void {
  const list = listClonedVoices().map(v => v.id === id ? { ...v, name: name.trim() || v.name } : v)
  saveClonedVoices(list)
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
  // 只删除临时样本，不动已保存的克隆音色列表
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
    addClonedVoice(name || sample.name.replace(/\.[^.]+$/, ''), voiceId, sample.name)
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
