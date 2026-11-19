// Submit Morph：全局给所有 .btn.primary 主操作按钮加"提交变形"动画。
// 点击立即执行原有业务逻辑；动画按固定时间线独立播放：
//   t=0    文字淡出、按钮宽度收缩成圆形（300ms，ease-in-out）
//   t=300  圆形中央出现旋转加载环
//   t=1200 按钮变绿并画出对勾
//   t=2200 恢复原状
// 不改任何组件 JSX：点击时动态包裹原内容、注入加载环/对勾，动画结束还原。

const SHRINK_MS = 300
const SUCCESS_MS = 1200
const RESTORE_MS = 2200

let inited = false
const active = new WeakSet<HTMLElement>()

/** 动画期间临时注入的结构，用 WeakMap 保存以便还原 */
interface MorphState {
  btn: HTMLButtonElement
  label: HTMLSpanElement
  spinner: HTMLSpanElement
  check: HTMLSpanElement
  originalWidth: string
  originalHeight: string
  circleSize: number
  originalHtml: string
}
const states = new WeakMap<HTMLButtonElement, MorphState>()

function playMorph(btn: HTMLButtonElement) {
  if (active.has(btn)) return
  active.add(btn)

  // 1) 记录原始宽度与内容，把原内容包进 morph-label
  const originalWidth = btn.style.width
  const originalHeight = btn.style.height
  const originalHtml = btn.innerHTML
  const rect = btn.getBoundingClientRect()
  const circleSize = Math.round(rect.height)
  btn.style.width = `${rect.width}px`
  btn.style.height = `${circleSize}px`
  btn.style.setProperty('--morph-size', `${circleSize}px`)

  const label = document.createElement('span')
  label.className = 'morph-label'
  label.innerHTML = originalHtml

  const spinner = document.createElement('span')
  spinner.className = 'morph-spinner'
  const check = document.createElement('span')
  check.className = 'morph-check'
  check.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

  btn.innerHTML = ''
  btn.appendChild(label)
  btn.appendChild(spinner)
  btn.appendChild(check)
  states.set(btn, { btn, label, spinner, check, originalWidth, originalHeight, circleSize, originalHtml })

  // 2) 触发收缩（文字淡出 + 宽度→圆形），强制 reflow 保证过渡生效
  void btn.offsetWidth
  btn.classList.add('submit-morph')

  // 3) 300ms：显示加载环
  window.setTimeout(() => { if (active.has(btn)) btn.classList.add('morph-loading') }, SHRINK_MS)
  // 4) 1200ms：变绿 + 画对勾
  window.setTimeout(() => { if (active.has(btn)) btn.classList.add('morph-success') }, SUCCESS_MS)
  // 5) 2200ms：还原
  window.setTimeout(() => restore(btn), RESTORE_MS)
}

function restore(btn: HTMLButtonElement) {
  const s = states.get(btn)
  if (!s) return
  btn.classList.remove('submit-morph', 'morph-loading', 'morph-success')
  btn.innerHTML = s.originalHtml
  btn.style.width = s.originalWidth
  btn.style.height = s.originalHeight
  btn.style.removeProperty('--morph-size')
  states.delete(btn)
  active.delete(btn)
  // 清空固定尺寸后再让浏览器回流，避免残留影响响应式
  window.setTimeout(() => {
    if (active.has(btn)) return
    btn.style.width = ''
    btn.style.height = ''
  }, 350)
}

/** 初始化全局监听（幂等，只注册一次） */
export function initSubmitMorph(): void {
  if (inited) return
  inited = true
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement
    const btn = target.closest('.btn.primary') as HTMLButtonElement | null
    if (!btn || btn.disabled) return
    // 跳过明确标记不参与变形的按钮
    if (btn.classList.contains('no-morph')) return
    playMorph(btn)
  }, true)
}
