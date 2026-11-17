// 应用更新：按平台走各自的更新机制。
// - 桌面 Tauri：官方 updater（检查 → 下载安装 → 重启）
// - Docker/Web：网页无法操作宿主容器/服务器，用 GitHub Releases 检查版本 + 给出可复制的更新指令
// - 微信小程序：wx.getUpdateManager() 官方更新（检查 → 下载 → 重启）
// - 安卓 APK：给出下载最新 APK 的链接（无法静默安装，需用户确认）

import { isDesktopApp, isNativeApp } from './openExternal'

/** 与 tauri.conf.json / package.json 保持一致 */
export const APP_VERSION = '0.1.40'

const REPO = 'Andre-xue/ai-credit-manager'
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

export type UpdatePlatform = 'desktop' | 'android' | 'docker' | 'web' | 'miniapp'

export function currentPlatform(): UpdatePlatform {
  if (isDesktopApp()) return 'desktop'
  if (typeof wx !== 'undefined' && typeof (wx as WxLike).getUpdateManager === 'function') return 'miniapp'
  if (isNativeApp()) return 'android'
  // Docker 与 Web 都是浏览器；通过端口/域名粗判（docker 常见 8080），供文案区分
  if (typeof location !== 'undefined' && (location.port === '8080' || /docker/i.test(location.hostname))) return 'docker'
  return 'web'
}

/** 版本比较：返回 a > b。忽略前导 v 与非数字后缀 */
function versionGreater(a: string, b: string): boolean {
  const pa = a.replace(/^v/i, '').split(/[.\-]/).map(x => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split(/[.\-]/).map(x => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

export interface UpdateInfo {
  current: string
  latest: string
  hasUpdate: boolean
  releaseUrl: string
  notes: string
  publishedAt?: string
}

interface GitHubRelease {
  tag_name: string
  body?: string
  published_at?: string
  assets?: Array<{ name: string; browser_download_url: string }>
}

/** 从 GitHub Releases 查询最新版本（Web/Docker/安卓用） */
export async function checkReleaseUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    const rel = await res.json() as GitHubRelease
    const latest = rel.tag_name?.replace(/^v/i, '') ?? ''
    if (!latest) return null
    return {
      current: APP_VERSION,
      latest,
      hasUpdate: versionGreater(latest, APP_VERSION),
      releaseUrl: RELEASES_PAGE,
      notes: rel.body ?? '',
      publishedAt: rel.published_at,
    }
  } catch { return null }
}

/** 桌面端：用 Tauri updater 检查（返回 null 表示已是最新或不可用） */
export async function checkDesktopUpdate(): Promise<{ version: string; currentVersion: string; body?: string } | null> {
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) return null
    return { version: update.version, currentVersion: update.currentVersion, body: update.body }
  } catch { return null }
}

export interface InstallProgress { downloaded: number }

/** 桌面端：下载并安装更新。macOS/Linux 安装后需调用 relaunchApp() */
export async function installDesktopUpdate(onProgress?: (p: InstallProgress) => void): Promise<boolean> {
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) return false
    let downloaded = 0
    await update.downloadAndInstall((event) => {
      if (event.event === 'Progress') {
        downloaded += event.data.chunkLength
        onProgress?.({ downloaded })
      }
    })
    return true
  } catch { return false }
}

/** 桌面端：重启应用以启用新版本 */
export async function relaunchApp(): Promise<void> {
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch { /* 不支持时忽略，用户可手动重启 */ }
}

/** Docker 更新指令：拉新镜像 → 停旧容器 → 删旧容器 → 起新实例（数据卷保留） */
export function dockerUpdateCommands(): string {
  return [
    '# 更新 AI 积分管家 Docker 实例（保留数据卷）',
    'docker pull Andre-xue/ai-credit-manager:latest',
    'docker stop ai-credit-manager 2>/dev/null || true',
    'docker rm ai-credit-manager 2>/dev/null || true',
    'docker run -d --name ai-credit-manager -p 8080:80 -v ai-credit-data:/data --restart unless-stopped Andre-xue/ai-credit-manager:latest',
    '# 完成后刷新本页即可使用新版本',
  ].join('\n')
}

/** 获取最新 APK 下载地址 */
export async function latestApkUrl(): Promise<string | null> {
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    const rel = await res.json() as GitHubRelease
    const apk = rel.assets?.find(a => /\.apk$/i.test(a.name))
    return apk?.browser_download_url ?? RELEASES_PAGE
  } catch { return null }
}

// ---- 微信小程序更新 ----
type WxLike = {
  getUpdateManager?: () => {
    onCheckForUpdate: (cb: (r: { hasUpdate: boolean }) => void) => void
    onUpdateReady: (cb: () => void) => void
    onUpdateFailed: (cb: () => void) => void
    applyUpdate: () => void
  }
  showModal?: (o: Record<string, unknown>) => void
}
declare const wx: WxLike | undefined

/**
 * 小程序：启动时自动检查更新，下载完成后弹窗询问是否重启应用新版本。
 * 平台托管机制：只能更新已发布到微信后台的版本，无法自定义下载安装包。
 */
export function initMiniappUpdate(notify: (m: string) => void): void {
  if (typeof wx === 'undefined' || typeof wx.getUpdateManager !== 'function') return
  try {
    const um = wx.getUpdateManager()
    um.onCheckForUpdate(res => {
      if (res.hasUpdate) notify('发现新版本，正在后台下载…')
    })
    um.onUpdateReady(() => {
      const w = wx as WxLike
      if (w.showModal) {
        w.showModal({
          title: '更新提示',
          content: '新版本已下载完成，重启后即可使用。是否立即重启？',
          confirmText: '立即重启',
          cancelText: '稍后',
          success: (r: { confirm: boolean }) => { if (r.confirm) um.applyUpdate() },
        })
      } else {
        notify('新版本已就绪，请重启小程序')
      }
    })
    um.onUpdateFailed(() => notify('新版本下载失败，请检查网络后重试'))
  } catch { /* 非小程序环境忽略 */ }
}

/** 手动触发小程序更新检查（设置页按钮） */
export function checkMiniappUpdate(notify: (m: string) => void): void {
  initMiniappUpdate(notify)
  notify('已触发更新检查，如有新版本将自动下载')
}
