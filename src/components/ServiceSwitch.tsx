// 本地服务开关按钮：设置页之外的模块（AI 翻译 / AI 图像 / AI 视频）共用的服务启停开关。
// 状态来自传入的 ServiceController（单一数据源 settings.localServices），因此与设置页天然联动：
// 任一处切换 -> 更新 settings -> 所有引用处同步显示。

import { Power, Loader2, CircleCheck, Circle } from 'lucide-react'
import type { LocalServiceKey } from '../core/types'
import type { ServiceController } from '../core/useServiceController'

export function ServiceSwitch({
  controller, serviceKey, label, compact,
}: {
  controller: ServiceController
  serviceKey: LocalServiceKey
  label?: string
  compact?: boolean
}) {
  const enabled = controller.enabled(serviceKey)
  const running = !!controller.status[serviceKey]
  const busy = controller.busyKey === serviceKey
  const name = label ?? (serviceKey === 'ollama' ? 'Ollama' : serviceKey === 'comfyui' ? 'ComfyUI' : 'LM Studio')

  return (
    <button
      type="button"
      className={`service-switch ${enabled ? 'on' : ''} ${compact ? 'compact' : ''}`}
      onClick={() => void controller.toggle(serviceKey)}
      disabled={busy}
      title={enabled
        ? `${name} 已启用${running ? `（运行中：${controller.status[serviceKey]}）` : '（未检测到运行）'}，点击关闭`
        : `${name} 未启用，点击开启并启动服务`}
    >
      {busy ? <Loader2 size={14} className="spin" /> : <Power size={14} />}
      <span className="service-switch-label">{name}</span>
      <span className={`service-switch-state ${enabled ? 'on' : ''}`}>{enabled ? '已开启' : '已关闭'}</span>
      <span className={`service-switch-dot ${running ? 'running' : ''}`} title={running ? '服务运行中' : '服务未运行'}>
        {running ? <CircleCheck size={13} /> : <Circle size={13} />}
      </span>
    </button>
  )
}
