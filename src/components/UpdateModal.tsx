// 应用更新弹窗：按平台展示更新方式与操作。
import { useEffect, useState } from 'react'
import { X, RefreshCw, Download, RotateCw, ExternalLink, Copy, Check, Info, Loader2, Smartphone } from 'lucide-react'
import {
  APP_VERSION, currentPlatform, checkDesktopUpdate, checkReleaseUpdate,
  installDesktopUpdate, relaunchApp, dockerUpdateCommands, latestApkUrl,
  checkMiniappUpdate, type UpdatePlatform,
} from '../core/updater'

type Phase = 'checking' | 'available' | 'latest' | 'downloading' | 'ready' | 'error' | 'manual'

export function UpdateModal({ onClose, notify }: { onClose: () => void; notify: (m: string) => void }) {
  const platform: UpdatePlatform = currentPlatform()
  const [phase, setPhase] = useState<Phase>('checking')
  const [latest, setLatest] = useState('')
  const [notes, setNotes] = useState('')
  const [releaseUrl, setReleaseUrl] = useState('')
  const [downloadedMb, setDownloadedMb] = useState(0)
  const [copied, setCopied] = useState(false)
  const [apkUrl, setApkUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (platform === 'desktop') {
        const u = await checkDesktopUpdate()
        if (!alive) return
        if (u) { setLatest(u.version); setNotes(u.body ?? ''); setPhase('available'); return }
        // 没有签名更新清单时退回 GitHub Releases 检查：提示手动下载安装包
        const info = await checkReleaseUpdate()
        if (!alive) return
        if (!info) { setPhase('error'); return }
        setLatest(info.latest)
        setNotes(info.notes)
        setReleaseUrl(info.releaseUrl)
        setPhase(info.hasUpdate ? 'manual' : 'latest')
        return
      }
      if (platform === 'miniapp') {
        checkMiniappUpdate(notify)
        if (alive) setPhase('manual')
        return
      }
      const info = await checkReleaseUpdate()
      if (!alive) return
      if (!info) { setPhase('error'); return }
      setLatest(info.latest)
      setNotes(info.notes)
      setReleaseUrl(info.releaseUrl)
      if (platform === 'android') {
        setApkUrl(await latestApkUrl())
        setPhase('available')
      } else {
        // Docker/Web：给出手动更新指引
        setPhase('manual')
      }
    })()
    return () => { alive = false }
  }, [platform, notify])

  const doInstall = async () => {
    setPhase('downloading')
    setDownloadedMb(0)
    const ok = await installDesktopUpdate(p => {
      setDownloadedMb(Math.round(p.downloaded / 1024 / 1024 * 10) / 10)
    })
    if (!ok) { setPhase('error'); notify('下载安装失败，请稍后重试'); return }
    setPhase('ready')
    notify('新版本已安装，点击「重启应用」生效')
  }

  const versionText = latest ? `v${latest.replace(/^v/i, '')}` : ''
  const isDesktop = platform === 'desktop'

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-head"><h3>应用更新</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="upd-current">当前版本 <b>v{APP_VERSION}</b> · {isDesktop ? '桌面客户端' : platform === 'android' ? '安卓客户端' : platform === 'docker' ? 'Docker 版' : platform === 'miniapp' ? '微信小程序' : '网页版'}</div>

          {phase === 'checking' && <div className="upd-state"><Loader2 size={18} className="spin" /> 正在检查更新…</div>}

          {phase === 'latest' && <div className="upd-state ok"><Check size={18} /> 当前已是最新版本</div>}

          {phase === 'error' && <div className="upd-state"><Info size={18} /> 检查更新失败，请检查网络后重试</div>}

          {(phase === 'available' || phase === 'downloading') && (
            <div className="upd-box">
              <div className="upd-new">发现新版本 <b>{versionText}</b></div>
              {notes && <pre className="upd-notes">{notes.slice(0, 600)}</pre>}
              {isDesktop && (
                <>
                  <div className="upd-hint">点击下方按钮自动下载并安装，完成后点击「重启应用」即可使用新版本。</div>
                  {phase === 'downloading' && <div className="upd-downloading"><Loader2 size={14} className="spin" /> 正在下载… 已下载 {downloadedMb} MB</div>}
                  <button className="btn primary" style={{ width: '100%' }} disabled={phase === 'downloading'} onClick={() => void doInstall()}>
                    <Download size={16} /> {phase === 'downloading' ? '下载中…' : '下载并安装'}
                  </button>
                </>
              )}
              {platform === 'android' && (
                <>
                  <div className="upd-hint">安卓 APK 需手动下载安装（系统要求用户确认）。下载后覆盖安装即可，数据不会丢失。</div>
                  {apkUrl ? (
                    <a className="btn primary" style={{ width: '100%', justifyContent: 'center' }} href={apkUrl} target="_blank" rel="noreferrer">
                      <Smartphone size={16} /> 下载最新 APK
                    </a>
                  ) : (
                    <a className="btn" style={{ width: '100%', justifyContent: 'center' }} href={releaseUrl || 'https://github.com/Andre-xue/ai-credit-manager/releases/latest'} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} /> 前往下载页
                    </a>
                  )}
                </>
              )}
            </div>
          )}

          {phase === 'ready' && (
            <div className="upd-box center">
              <div className="upd-new ok"><Check size={18} /> 新版本 {versionText} 已安装</div>
              <div className="upd-hint">重启后生效，当前数据不会丢失。</div>
              <button className="btn primary" style={{ width: '100%' }} onClick={() => void relaunchApp()}>
                <RotateCw size={16} /> 重启应用
              </button>
            </div>
          )}

          {phase === 'manual' && (
            <div className="upd-box">
              <div className="upd-new">{latest ? `发现新版本 ${versionText}` : '更新方式'}</div>
              {platform === 'docker' && (
                <>
                  <div className="upd-hint">网页运行在浏览器沙箱中，无法直接操作宿主机 Docker。请在终端执行以下命令，自动拉取新镜像、删除旧实例并启动新实例（数据卷保留）：</div>
                  <pre className="upd-cmd">{dockerUpdateCommands()}</pre>
                  <button className="btn primary" style={{ width: '100%' }} onClick={() => {
                    void navigator.clipboard.writeText(dockerUpdateCommands()).then(() => { setCopied(true); notify('更新命令已复制'); setTimeout(() => setCopied(false), 2000) })
                  }}>
                    {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? '已复制' : '一键复制更新命令'}
                  </button>
                </>
              )}
              {platform === 'web' && (
                <>
                  <div className="upd-hint">网页版由服务端统一部署，无需你手动更新。刷新页面即可获取最新前端资源。</div>
                  <button className="btn" style={{ width: '100%' }} onClick={() => location.reload()}><RefreshCw size={16} /> 刷新页面</button>
                </>
              )}
              {platform === 'miniapp' && (
                <div className="upd-hint">小程序由微信平台托管更新：检测到新版本后会自动下载，下载完成会弹窗询问是否重启。也可在微信「发现 → 小程序 → 我的小程序」中下拉刷新检查。</div>
              )}
              {platform === 'desktop' && (
                <>
                  <div className="upd-hint">当前安装包未配置签名更新通道，无法静默升级。请到 GitHub 下载页获取最新安装包，下载后覆盖安装即可，数据不会丢失。</div>
                  <a className="btn primary" style={{ width: '100%', justifyContent: 'center' }} href={releaseUrl || 'https://github.com/Andre-xue/ai-credit-manager/releases/latest'} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} /> 前往下载页
                  </a>
                </>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  )
}
