// 系统授权权限登记：各平台把 App 需要用户明确授权的能力集中记录。
// WebView 无法读取所有系统级 TCC/权限状态，因此这里记录"用户确认已授权"的开关，
// 并在功能入口处做门禁；能主动申请的权限（通知/麦克风/相机/相册/文件）会先尝试申请。

export type PermissionKey =
  | 'fullDisk' | 'files' | 'photosApp' | 'localNetwork' | 'screenRecording'
  | 'microphone' | 'camera' | 'speechRecognition' | 'remoteDesktop' | 'calendar' | 'notifications'
  | 'photoVideo' | 'musicAudio' | 'sms' | 'location'

export interface PermissionDef {
  key: PermissionKey
  label: string
  desc: string
  /** desktop / mobile / both */
  scope: 'desktop' | 'mobile' | 'both'
}

export const DESKTOP_PERMISSIONS: PermissionDef[] = [
  { key: 'fullDisk', label: '完全磁盘文件授权', desc: '允许桌面端读取/保存备份与附件所在目录', scope: 'desktop' },
  { key: 'files', label: '文件与文件夹', desc: '选择备份导出目录、读取本地附件', scope: 'desktop' },
  { key: 'photosApp', label: '照片 App', desc: '从系统照片 App 选取图片附件', scope: 'desktop' },
  { key: 'localNetwork', label: '本地网络', desc: '连接本机代理与局域网服务', scope: 'desktop' },
  { key: 'screenRecording', label: '录屏与系统录音', desc: '系统录制/采集权限，仅用于故障排查说明', scope: 'desktop' },
  { key: 'microphone', label: '麦克风', desc: 'AI 语音通话必须开启', scope: 'desktop' },
  { key: 'camera', label: '摄像头', desc: '拍照作为附件时必须开启', scope: 'desktop' },
  { key: 'speechRecognition', label: '语音识别', desc: '把语音转成文字发给 AI', scope: 'desktop' },
  { key: 'remoteDesktop', label: '远程桌面', desc: '远程协助场景，默认无需开启', scope: 'desktop' },
  { key: 'calendar', label: '日历', desc: '签到提醒写入日历时使用', scope: 'desktop' },
  { key: 'notifications', label: '通知', desc: '签到与额度告警通知', scope: 'desktop' },
]

export const MOBILE_PERMISSIONS: PermissionDef[] = [
  { key: 'microphone', label: '麦克风', desc: 'AI 语音通话必须开启', scope: 'mobile' },
  { key: 'camera', label: '相机', desc: '拍照作为附件时必须开启', scope: 'mobile' },
  { key: 'photoVideo', label: '照片与视频', desc: '从相册选取附件', scope: 'mobile' },
  { key: 'location', label: '定位', desc: '仅在需要本地化提示时使用', scope: 'mobile' },
  { key: 'musicAudio', label: '音乐与音频', desc: '读取本地音频文件', scope: 'mobile' },
  { key: 'sms', label: '短信', desc: '验证码相关场景预留，当前不读取短信', scope: 'mobile' },
  { key: 'calendar', label: '日历', desc: '签到提醒写入日历时使用', scope: 'mobile' },
  { key: 'notifications', label: '通知', desc: '签到与额度告警通知', scope: 'mobile' },
]

const STORAGE_KEY = 'acm.permissions.v1'

export function loadPermissions(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

export function isPermissionGranted(key: PermissionKey): boolean {
  return loadPermissions()[key] === true
}

export function setPermissionGranted(key: PermissionKey, granted: boolean): void {
  const all = loadPermissions()
  if (granted) all[key] = true
  else delete all[key]
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)) } catch { /* 忽略 */ }
}

/** 功能入口统一门禁：未授权时给出可操作的提示，返回 false 阻止继续执行。 */
export function requirePermission(key: PermissionKey, notify?: (m: string) => void): boolean {
  if (isPermissionGranted(key)) return true
  const def = [...DESKTOP_PERMISSIONS, ...MOBILE_PERMISSIONS].find(d => d.key === key)
  notify?.(`请先在「设置 → 安全隐私 → 系统授权权限」中开启「${def?.label ?? key}」`)
  return false
}
