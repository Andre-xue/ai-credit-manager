import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// 手机端禁用双指/双击缩放，呈现原生 App 体验（viewport meta 之外的兜底）
if (typeof window !== 'undefined') {
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false })
  document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false })
  // 阻止 iOS 双击缩放
  let lastTouch = 0
  document.addEventListener('touchend', (e) => {
    const now = Date.now()
    if (now - lastTouch < 300) e.preventDefault()
    lastTouch = now
  }, { passive: false })
}

/** 手机端：先从原生存储恢复数据，再渲染 App（确保更新/重装后数据不丢），最后定时镜像备份。 */
async function bootstrap() {
  const { restoreFromNative, backupToNative } = await import('./core/persistence')
  await restoreFromNative()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )

  // 启动后做一次备份，之后定期备份（页面隐藏时也备份，覆盖绝大多数更新场景）
  void backupToNative()
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void backupToNative()
    })
  }
  window.setInterval(() => void backupToNative(), 30_000)
}

void bootstrap()
