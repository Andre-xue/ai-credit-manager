// 云同步登录弹窗：手机号验证码 / 邮箱验证码 / 微信扫码 / WorkBuddy 账号
// 扫码类在桌面 WebView / 安卓 WebView 内可能受限，会给出提示引导用验证码登录。

import { useState } from 'react'
import { X, Smartphone, Mail, QrCode, ShieldCheck, Loader2 } from 'lucide-react'
import { cloud, type CloudUser } from '../core/cloud'
import { isDesktopApp } from '../core/openExternal'

type Method = 'phone' | 'email' | 'wechat' | 'workbuddy'

export function CloudLoginModal({ onClose, onSuccess }: {
  onClose: () => void
  onSuccess: (user: CloudUser) => void
}) {
  const [method, setMethod] = useState<Method>('phone')
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<{ verificationId: string; isExistingUser: boolean; target: string } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [countdown, setCountdown] = useState(0)

  const isPhone = method === 'phone'

  const sendCode = async () => {
    setErr('')
    const value = identifier.trim()
    if (isPhone && !/^1\d{10}$/.test(value)) { setErr('请输入正确的 11 位手机号'); return }
    if (!isPhone && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setErr('请输入正确的邮箱地址'); return }
    setBusy(true)
    try {
      const sent = await cloud.auth.sendOtp(isPhone ? { phone: value } : { email: value })
      if (sent.error) { setErr(sent.error.message); return }
      setPending({ verificationId: sent.data.verificationId, isExistingUser: sent.data.isExistingUser, target: value })
      setCountdown(60)
      const timer = window.setInterval(() => {
        setCountdown(c => { if (c <= 1) { window.clearInterval(timer); return 0 } return c - 1 })
      }, 1000)
    } finally { setBusy(false) }
  }

  const submitCode = async () => {
    setErr('')
    if (!pending) { setErr('请先获取验证码'); return }
    if (pending.target !== identifier.trim()) { setErr('请先获取当前账号的验证码'); return }
    if (!code.trim()) { setErr('请输入验证码'); return }
    setBusy(true)
    try {
      const done = await cloud.auth.verifyOtp({
        ...(isPhone ? { phone: pending.target } : { email: pending.target }),
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: code.trim(),
      } as Parameters<typeof cloud.auth.verifyOtp>[0])
      if (done.error) { setErr(done.error.message); return }
      onSuccess(done.data.user as CloudUser)
    } finally { setBusy(false) }
  }

  const oauth = async (provider: 'wechat' | 'workbuddy') => {
    setErr('')
    if (isDesktopApp()) {
      setErr('扫码登录请在网页版或微信小程序中使用；桌面端请用手机号或邮箱验证码登录。')
      return
    }
    setBusy(true)
    try {
      const back = new URL(location.href)
      back.pathname = '/'
      for (const key of ['code', 'state', 'provider']) back.searchParams.delete(key)
      const { data, error } = await cloud.auth.signInWithOAuth({ provider, redirectTo: back.toString() })
      if (error) { setErr(error.message); return }
      location.assign(data.url)
    } finally { setBusy(false) }
  }

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h3>登录以开启云同步</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="notice-box" style={{ marginBottom: 16 }}>
            <ShieldCheck size={15} />
            <div>登录后用同一账号，在 Web / 桌面 / 安卓 / 小程序任意端的数据都会自动同步。未登录也可继续本地使用。</div>
          </div>

          <div className="login-methods">
            <button className={`login-method ${method === 'phone' ? 'active' : ''}`} onClick={() => { setMethod('phone'); setErr(''); setPending(null) }}>
              <Smartphone size={16} /> 手机号
            </button>
            <button className={`login-method ${method === 'email' ? 'active' : ''}`} onClick={() => { setMethod('email'); setErr(''); setPending(null) }}>
              <Mail size={16} /> 邮箱
            </button>
            <button className={`login-method ${method === 'wechat' ? 'active' : ''}`} onClick={() => { setMethod('wechat'); setErr('') }}>
              <QrCode size={16} /> 微信扫码
            </button>
            <button className={`login-method ${method === 'workbuddy' ? 'active' : ''}`} onClick={() => { setMethod('workbuddy'); setErr('') }}>
              <ShieldCheck size={16} /> WorkBuddy
            </button>
          </div>

          {(method === 'phone' || method === 'email') && <>
            <label className="form-label" style={{ marginTop: 18 }}>
              {isPhone ? '手机号' : '邮箱地址'}
              <input className="input" value={identifier} onChange={e => { setIdentifier(e.target.value); setErr('') }}
                placeholder={isPhone ? '11 位手机号' : 'name@example.com'} disabled={busy} />
            </label>
            <label className="form-label" style={{ marginTop: 12 }}>
              验证码
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" value={code} onChange={e => { setCode(e.target.value); setErr('') }} placeholder="6 位验证码" disabled={busy} />
                <button className="btn" type="button" onClick={sendCode} disabled={busy || countdown > 0} style={{ whiteSpace: 'nowrap' }}>
                  {countdown > 0 ? `${countdown}s 后重发` : pending ? '重新发送' : '获取验证码'}
                </button>
              </div>
            </label>
            {err && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>{err}</div>}
            <button className="btn primary" style={{ width: '100%', marginTop: 18, justifyContent: 'center' }} onClick={submitCode} disabled={busy}>
              {busy ? <><Loader2 size={14} className="spin" /> 处理中…</> : '登录 / 注册'}
            </button>
          </>}

          {method === 'wechat' && <>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: '18px 0' }}>
              点击下方按钮将跳转到微信授权页，可用微信扫码或快捷登录。登录完成后自动返回本应用。
            </p>
            {err && <div style={{ color: 'var(--amber)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => oauth('wechat')} disabled={busy}>
              <QrCode size={15} /> 使用微信登录
            </button>
          </>}

          {method === 'workbuddy' && <>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: '18px 0' }}>
              使用你的 WorkBuddy 账号登录，授权后自动返回本应用。
            </p>
            {err && <div style={{ color: 'var(--amber)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => oauth('workbuddy')} disabled={busy}>
              <ShieldCheck size={15} /> 使用 WorkBuddy 登录
            </button>
          </>}

          <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '16px 0 0', lineHeight: 1.6 }}>
            说明：QQ / 抖音 / 支付宝扫码登录暂未开放；当前支持微信扫码、手机号验证码、邮箱验证码与 WorkBuddy 账号。
          </p>
        </div>
      </div>
    </div>
  )
}
