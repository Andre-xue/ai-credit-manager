// Submit Morph：全局给所有 .btn.primary 主操作按钮加"提交变形"动画。
// 点击立即执行原有业务逻辑；动画按固定时间线独立播放：
//   t=0    文字淡出、按钮宽度收缩成圆形（300ms，ease-in-out）
//   t=300  圆形中央出现旋转加载环
//   t=1200 按钮变绿并画出对勾
//   t=2200 恢复原状
//
// ⚠️ 关键：绝不改动 React 管理的 DOM 节点（不移动/删除/包裹原内容）。
// 只额外 append 一个独立覆盖层 + 用 data-morph 属性驱动 CSS。
// 否则 React 更新按钮内容（如 <Languages>→<LoaderCircle>）时找不到原节点会崩溃白屏。

const SHRINK_MS = 300
const SUCCESS_MS = 1200
const RESTORE_MS = 2200

let inited = false
const active = new WeakSet<HTMLElement>()

function playMorph(btn: HTMLButtonElement) {
  if (active.has(btn)) return
  active.add(btn)

  const rect = btn.getBoundingClientRect()
  const circleSize = Math.max(1, Math.round(rect.height))
  // 用内联尺寸固定当前宽高（动画收缩到圆形）；不动任何子元素
  btn.style.width = `${rect.width}px`
  btn.style.height = `${circleSize}px`
  btn.style.setProperty('--morph-size', `${circleSize}px`)

  // 独立覆盖层：只 append，不触碰 React 的子节点
  const overlay = document.createElement('span')
  overlay.className = 'morph-overlay'
  overlay.setAttribute('aria-hidden', 'true')
  overlay.innerHTML =
    '<span class="morph-spinner"></span>' +
    '<span class="morph-check"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
  btn.appendChild(overlay)

  // data 属性驱动动画：React 不管理此属性，re-render 不会覆盖
  void btn.offsetWidth // 强制 reflow
  btn.dataset.morph = 'shrink'

  window.setTimeout(() => { if (active.has(btn)) btn.dataset.morph = 'loading' }, SHRINK_MS)
  window.setTimeout(() => { if (active.has(btn)) btn.dataset.morph = 'success' }, SUCCESS_MS)
  window.setTimeout(() => restore(btn), RESTORE_MS)
}

function restore(btn: HTMLButtonElement) {
  delete btn.dataset.morph
  // 只移除我们自己加的覆盖层
  const overlay = btn.querySelector(':scope > .morph-overlay')
  if (overlay) overlay.remove()
  btn.style.width = ''
  btn.style.height = ''
  btn.style.removeProperty('--morph-size')
  active.delete(btn)
}

/** 初始化全局监听（幂等，只注册一次） */
export function initSubmitMorph(): void {
  if (inited) return
  inited = true
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement
    const btn = target.closest('.btn.primary') as HTMLButtonElement | null
    if (!btn || btn.disabled) return
    if (btn.classList.contains('no-morph')) return
    playMorph(btn)
  }, true)
}
