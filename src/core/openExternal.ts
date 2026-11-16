// 外部链接打开工具：桌面端走 Rust 命令调用系统默认浏览器，Web 端走 window.open。
// 原因：Tauri WebView 中 <a target="_blank"> 常被拦截，导致"只提示不打开"。

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 检测桌面端是否支持 Touch ID */
export async function biometricAvailable(): Promise<boolean> {
  if (!isDesktopApp()) return false
  try {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<boolean> } }
    if (!w.__TAURI_INTERNALS__?.invoke) return false
    return await w.__TAURI_INTERNALS__.invoke('biometric_available')
  } catch { return false }
}

/** 调用 Touch ID 验证，返回是否通过 */
export async function biometricAuth(): Promise<boolean> {
  if (!isDesktopApp()) return false
  try {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<boolean> } }
    if (!w.__TAURI_INTERNALS__?.invoke) return false
    return await w.__TAURI_INTERNALS__.invoke('biometric_auth')
  } catch { return false }
}

/** 在系统默认浏览器中打开官方页面。返回是否成功发起 */
export async function openExternal(url: string): Promise<boolean> {
  if (!url || !/^https?:\/\//.test(url)) return false
  try {
    if (isDesktopApp()) {
      const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<void> } }
      if (!w.__TAURI_INTERNALS__?.invoke) return false
      await w.__TAURI_INTERNALS__.invoke('open_url', { url })
      return true
    }
    // Web 端：新标签页打开； popup 被拦截时降级为当前页跳转
    const win = window.open(url, '_blank', 'noopener,noreferrer')
    if (win) return true
    window.location.href = url
    return true
  } catch {
    return false
  }
}
