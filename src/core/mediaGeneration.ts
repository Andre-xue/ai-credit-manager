// AI 图像 / AI 视频模块共用：生成历史（localStorage 持久化）+ 媒体保存（三端）。
// 历史只存 URL/文本与元信息，不存二进制；图片/视频本体由调用方按 URL 预览与下载。

import { isDesktopApp, isNativeApp } from './openExternal'

export type MediaKind = 'image' | 'video'

export interface MediaHistoryItem {
  id: string
  kind: MediaKind
  prompt: string
  accountLabel: string
  model: string
  createdAt: number
  /** 结果 URL（http(s) 或 data URL）列表 */
  results: string[]
  /** 生成参数摘要，如 "1024x1024 · HD · 2张" / "5秒 · 16:9" */
  params: string
  /** 任务说明/状态文本（视频异步提交时可能只有文本） */
  note?: string
}

const KEY_IMAGE = 'acm.gen.image.history'
const KEY_VIDEO = 'acm.gen.video.history'
const MAX_ITEMS = 40

function keyOf(kind: MediaKind): string { return kind === 'image' ? KEY_IMAGE : KEY_VIDEO }

export function loadHistory(kind: MediaKind): MediaHistoryItem[] {
  try {
    const raw = localStorage.getItem(keyOf(kind))
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(x => x && typeof x === 'object' && Array.isArray(x.results)) : []
  } catch { return [] }
}

export function saveHistory(kind: MediaKind, items: MediaHistoryItem[]): void {
  try { localStorage.setItem(keyOf(kind), JSON.stringify(items.slice(0, MAX_ITEMS))) } catch { /* 存储满时静默 */ }
}

export function addHistory(kind: MediaKind, item: MediaHistoryItem): MediaHistoryItem[] {
  const next = [item, ...loadHistory(kind)].slice(0, MAX_ITEMS)
  saveHistory(kind, next)
  return next
}

export function removeHistory(kind: MediaKind, id: string): MediaHistoryItem[] {
  const next = loadHistory(kind).filter(x => x.id !== id)
  saveHistory(kind, next)
  return next
}

export function clearHistory(kind: MediaKind): void {
  try { localStorage.removeItem(keyOf(kind)) } catch { /* noop */ }
}

/** 由 URL 推断文件扩展名（含 data URL mime） */
function extOf(url: string, kind: MediaKind): string {
  const mime = url.startsWith('data:') ? (url.slice(5, url.indexOf(';')) || '') : ''
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('jpeg')) return 'jpg'
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('webm')) return 'webm'
  try {
    const path = new URL(url).pathname
    const m = path.match(/\.(png|jpe?g|webp|gif|mp4|webm|mov)(?:$|\?)/i)
    if (m) return m[1].toLowerCase().replace('jpeg', 'jpg')
  } catch { /* data url 或相对路径 */ }
  return kind === 'image' ? 'png' : 'mp4'
}

/** 把 URL（http(s) 或 data URL）转成 Blob */
async function urlToBlob(url: string): Promise<{ blob: Blob; mime: string }> {
  if (url.startsWith('data:')) {
    const res = await fetch(url)
    const blob = await res.blob()
    return { blob, mime: blob.type || 'application/octet-stream' }
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
  const blob = await res.blob()
  return { blob, mime: blob.type || (blob.type.includes('video') ? 'video/mp4' : 'image/png') }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 保存生成的图片/视频到本机：
 * - 桌面端：优先弹系统目录选择（沿用 choose_save_dir / write_binary_to_dir）
 * - 原生 App：写入 Documents 目录
 * - Web：浏览器下载
 * 返回保存位置描述，失败抛错。
 */
export async function saveMedia(url: string, kind: MediaKind, filenameBase: string): Promise<string> {
  const { blob } = await urlToBlob(url)
  const ext = extOf(url, kind)
  const filename = `${filenameBase}.${ext}`

  if (isDesktopApp()) {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) throw new Error('桌面接口不可用')
    // 让用户在系统对话框里选保存目录
    let dir: string | null = null
    try { dir = await invoke('choose_save_dir') as string | null } catch { dir = null }
    if (!dir) throw new Error('已取消保存')
    const base64 = await toBase64(blob)
    await invoke('write_binary_to_dir', { dir, filename, content_base64: base64 })
    return `${dir}/${filename}`
  }

  if (isNativeApp()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: filename, data: await toBase64(blob), directory: Directory.Documents, recursive: true })
    return `Documents/${filename}`
  }

  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  return filename
}

/** 供 UI 用的轻量 id */
export function newMediaId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
