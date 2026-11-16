// 统一通知服务：桌面端走 Tauri 自定义命令（Rust notify-rust），Web 端走浏览器 Notification API。
// 合规：通知只提醒"去官方页面查看/签到"，绝不替用户执行任何领取动作。

export interface NotificationPayload {
  title: string
  body: string
}

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 浏览器通知权限（仅 Web 端） */
export async function requestWebPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (inTauri()) return 'granted' // 桌面端无需浏览器权限
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.requestPermission()
}

/** 发送系统通知。失败不抛错，返回是否成功 */
export async function sendNotification(payload: NotificationPayload): Promise<boolean> {
  try {
    if (inTauri()) {
      const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<void> } }
      if (!w.__TAURI_INTERNALS__?.invoke) return false
      await w.__TAURI_INTERNALS__.invoke('send_notification', { title: payload.title, body: payload.body })
      return true
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
    new Notification(payload.title, { body: payload.body, icon: undefined, tag: 'acm-reminder' })
    return true
  } catch {
    return false
  }
}

/** 免打扰时段判断：start/end 为 "HH:mm"，跨越午夜也支持 */
export function inQuietHours(start: string, end: string, now = new Date()): boolean {
  if (!start || !end || start === end) return false
  const mins = (h: string) => {
    const [hh, mm] = h.split(':').map(Number)
    return hh * 60 + mm
  }
  const cur = now.getHours() * 60 + now.getMinutes()
  const s = mins(start), e = mins(end)
  return s < e ? cur >= s && cur < e : cur >= s || cur < e
}
