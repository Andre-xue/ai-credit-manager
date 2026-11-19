// 统一文件导入：兼容 Tauri 桌面原生拖放（会被 WebView 拦截 DOM drop）、
// Web/手机 DOM 拖放与粘贴。桌面路径用 plugin-fs 读取，只接受纯文本类文档。

import { isDesktopApp } from './openExternal'

export interface ImportedFile {
  name: string
  text: string
}

/** 纯文本类扩展名（可直接读为字符串） */
const TEXT_EXTS = /\.(txt|md|markdown|csv|json|log|text|xml|yaml|yml|html?)$/i

/** 桌面端：从 Tauri 原生拖放/剪贴板拿到的本地路径读取文件内容 */
export async function readFilesFromPaths(paths: string[]): Promise<{ files: ImportedFile[]; skipped: string[] }> {
  const files: ImportedFile[] = []
  const skipped: string[] = []
  if (!isDesktopApp()) return { files, skipped: paths }
  const { readFile } = await import('@tauri-apps/plugin-fs')
  for (const path of paths) {
    const name = path.split(/[\\/]/).pop() ?? '文件'
    if (!TEXT_EXTS.test(name)) { skipped.push(name); continue }
    try {
      const bytes = await readFile(path)
      const text = new TextDecoder('utf-8').decode(bytes)
      files.push({ name, text })
    } catch {
      skipped.push(name)
    }
  }
  return { files, skipped }
}

/** Web/手机：从 DOM DataTransfer（drop 或 paste 事件的 clipboardData）读取文件 */
export async function readFilesFromDataTransfer(dt: DataTransfer | null): Promise<{ files: ImportedFile[]; skipped: string[] }> {
  const files: ImportedFile[] = []
  const skipped: string[] = []
  if (!dt) return { files, skipped }
  for (const f of Array.from(dt.files)) {
    if (!TEXT_EXTS.test(f.name)) { skipped.push(f.name); continue }
    try {
      files.push({ name: f.name, text: await f.text() })
    } catch {
      skipped.push(f.name)
    }
  }
  return { files, skipped }
}

/**
 * 注册 Tauri 原生窗口文件拖放监听。
 * Tauri 默认拦截系统文件拖入，DOM 的 drop 事件收不到文件，必须走此 API。
 * 返回取消监听函数；非桌面端返回 noop。
 */
export async function onTauriFileDrop(handler: (paths: string[]) => void): Promise<() => void> {
  if (!isDesktopApp()) return () => {}
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    return await getCurrentWindow().onDragDropEvent(event => {
      if (event.payload.type === 'drop') handler(event.payload.paths)
    })
  } catch {
    return () => {}
  }
}
