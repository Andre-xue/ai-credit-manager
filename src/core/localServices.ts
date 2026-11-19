// 本地模型服务探测：桌面端通过 Tauri 命令实时扫描本机监听端口；
// 手机 / Web 端无法访问宿主本机，明确提示不可用（本地模型仅桌面端支持）。

import { isDesktopApp } from './openExternal'

export interface LocalService {
  service: string
  host: string
  port: number
  url: string
}

/** 探测本机正在运行的本地模型服务；返回可连接的网关地址列表 */
export async function detectLocalServices(): Promise<{ ok: boolean; services: LocalService[]; error?: string }> {
  if (!isDesktopApp()) {
    return {
      ok: false,
      services: [],
      error: '本地模型仅能在桌面客户端添加：手机 / 网页无法访问你电脑上的本机服务。请在桌面端添加。',
    }
  }
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<LocalService[]> }
    }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return { ok: false, services: [], error: '桌面接口不可用，请重启应用后重试' }
    const services = await invoke('detect_local_services')
    return { ok: true, services: services ?? [] }
  } catch (e) {
    return { ok: false, services: [], error: `探测失败：${(e as Error)?.message ?? String(e)}` }
  }
}

/** 检测单个本地服务是否运行，返回其实际地址；未运行/非桌面端返回 null */
export async function checkLocalService(key: 'ollama' | 'comfyui' | 'lmstudio'): Promise<string | null> {
  if (!isDesktopApp()) return null
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<string | null> }
    }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return null
    return await invoke('check_local_service', { key })
  } catch {
    return null
  }
}

/** 启动本机本地服务（显式调用）；返回指引文案或错误 */
export async function startLocalService(key: 'ollama' | 'comfyui' | 'lmstudio'): Promise<{ ok: boolean; message: string }> {
  if (!isDesktopApp()) return { ok: false, message: '仅桌面端支持一键启动，请在电脑上运行对应应用' }
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<string> }
    }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return { ok: false, message: '桌面接口不可用' }
    const message = await invoke('start_local_service', { key })
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: (e as Error)?.message ?? String(e) }
  }
}

/** 读取本机物理内存 GB（仅桌面端）；失败返回 0，调用方按保守档处理 */
export async function getSystemMemoryGb(): Promise<number> {
  if (!isDesktopApp()) return 0
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<number> }
    }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return 0
    const gb = await invoke('get_system_memory_gb')
    return Number.isFinite(gb) && gb > 0 ? gb : 0
  } catch {
    return 0
  }
}
