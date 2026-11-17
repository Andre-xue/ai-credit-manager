// AI 语音通话模式：类电话交互——语音识别输入 → AI 回复 → 自动朗读。
// 识别引擎按平台：手机原生 App 用 Capacitor Speech Recognition（真系统识别），
// 桌面/Web 用浏览器 SpeechRecognition；两者都不可用时降级为文字输入（AI 仍语音朗读回复）。

import { useEffect, useRef, useState } from 'react'
import { Phone, PhoneOff, Mic, MicOff, Volume2, Loader2, Keyboard, Send } from 'lucide-react'
import { speak, stopSpeak, getSavedVoice } from '../core/tts'
import { isNativeApp } from '../core/openExternal'

type Engine = 'capacitor' | 'web' | 'none'

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function createWebRecognition(): RecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = 'zh-CN'
  r.continuous = false
  r.interimResults = false
  return r
}

export function VoiceCall({ onSend, onClose, notify }: {
  /** 发送一句话，返回 AI 的回复文本 */
  onSend: (text: string) => Promise<string>
  onClose: () => void
  notify: (m: string) => void
}) {
  const [status, setStatus] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle')
  const [liveText, setLiveText] = useState('')
  const [lastReply, setLastReply] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [engine, setEngine] = useState<Engine>('none')
  const [fallbackText, setFallbackText] = useState('')
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const recRef = useRef<RecognitionLike | null>(null)
  const capRecRef = useRef<any>(null)
  const capListenerRef = useRef<any>(null)
  const wantListen = useRef(false)
  const timerRef = useRef<number | null>(null)
  const speakingRef = useRef(false)

  useEffect(() => {
    timerRef.current = window.setInterval(() => setSeconds(s => s + 1), 1000)
    let alive = true

    const init = async () => {
      // 优先手机原生识别
      if (isNativeApp()) {
        try {
          const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
          const availRes = await SpeechRecognition.available() as { available: boolean }
          const isAvail = typeof availRes === 'boolean' ? availRes : availRes?.available
          if (alive && isAvail) {
            capRecRef.current = SpeechRecognition
            const perm = await SpeechRecognition.checkPermissions()
            if (perm.speechRecognition !== 'granted') {
              const asked = await SpeechRecognition.requestPermissions()
              if (asked.speechRecognition !== 'granted') {
                notify('语音识别权限被拒绝，请用文字输入通话')
                if (alive) setFallbackOpen(true)
              }
            }
            if (alive) setEngine('capacitor')
            return
          }
        } catch { /* 插件不可用，回退 */ }
      }
      // 桌面/Web 浏览器识别
      const r = createWebRecognition()
      if (r && alive) {
        recRef.current = r
        r.onresult = (e: any) => {
          const text = Array.from(e.results).map((res: any) => res[0]?.transcript ?? '').join('').trim()
          if (text) { setLiveText(text); void handleText(text) }
        }
        r.onerror = (e: any) => {
          if (e?.error === 'no-speech') { setStatus('idle'); return }
          setStatus('idle')
        }
        r.onend = () => { if (wantListen.current) { try { r.start() } catch { /* ignore */ } } }
        setEngine('web')
        return
      }
      // 都不支持：文字降级
      if (alive) { setEngine('none'); setFallbackOpen(true) }
    }
    void init()
    return () => { alive = false; cleanup() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cleanup = () => {
    wantListen.current = false
    try { recRef.current?.stop() } catch { /* ignore */ }
    if (capRecRef.current) { try { void capRecRef.current.stop() } catch { /* ignore */ } }
    if (capListenerRef.current) { try { void capListenerRef.current.remove() } catch { /* ignore */ } }
    stopSpeak()
    speakingRef.current = false
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
  }

  const startListening = async () => {
    if (engine === 'capacitor' && capRecRef.current) {
      setStatus('listening')
      setLiveText('')
      wantListen.current = true
      try {
        // 清理旧监听
        if (capListenerRef.current) { try { await capListenerRef.current.remove() } catch { /* ignore */ } }
        capListenerRef.current = await capRecRef.current.addListener('partialResults', (data: { matches: string[] }) => {
          const text = data.matches?.[0]?.trim()
          if (text) { setLiveText(text); if (!speakingRef.current) void handleText(text) }
        })
        await capRecRef.current.start({ language: 'zh-CN', partialResults: true, popup: false })
      } catch (e) {
        setStatus('idle')
        notify(`启动语音识别失败：${(e as Error).message?.slice(0, 50) ?? '未知'}，请用文字输入`)
        setFallbackOpen(true)
      }
      return
    }
    if (engine === 'web' && recRef.current) {
      wantListen.current = true
      setStatus('listening')
      setLiveText('')
      try { recRef.current.start() } catch { /* 已在运行 */ }
      return
    }
    setFallbackOpen(true)
  }

  const stopListening = () => {
    wantListen.current = false
    try { recRef.current?.stop() } catch { /* ignore */ }
    if (capRecRef.current) { try { void capRecRef.current.stop() } catch { /* ignore */ } }
    setStatus('idle')
  }

  const handleText = async (text: string) => {
    if (busy || speakingRef.current) return
    wantListen.current = false
    setBusy(true)
    try { recRef.current?.stop() } catch { /* ignore */ }
    if (capRecRef.current) { try { void capRecRef.current.stop() } catch { /* ignore */ } }
    setStatus('thinking')
    try {
      const reply = await onSend(text)
      setLastReply(reply)
      setStatus('speaking')
      speakingRef.current = true
      const ok = speak(reply, getSavedVoice(), (s) => {
        if (s === 'end' || s === 'error') {
          setStatus('idle'); setLiveText(''); speakingRef.current = false
        }
      })
      if (!ok) { setStatus('idle'); speakingRef.current = false; notify('当前环境不支持语音朗读，回复已显示为文字') }
    } catch (e) {
      setStatus('idle'); speakingRef.current = false
      notify(`回复失败：${(e as Error).message?.slice(0, 80) ?? '未知错误'}`)
    } finally { setBusy(false) }
  }

  const submitFallback = () => {
    const text = fallbackText.trim()
    if (!text || busy) return
    setFallbackText('')
    setLiveText(text)
    void handleText(text)
  }

  const toggleMic = () => {
    if (status === 'listening') stopListening()
    else if (status === 'idle' || status === 'speaking') { stopSpeak(); speakingRef.current = false; void startListening() }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  const voiceAvailable = engine !== 'none'

  return (
    <div className="call-overlay">
      <div className="call-panel">
        <div className="call-title">AI 语音通话</div>
        <div className="call-timer">{mm}:{ss}</div>
        <div className={`call-orb ${status}`}>
          {status === 'thinking' ? <Loader2 size={44} className="spin" />
            : status === 'speaking' ? <Volume2 size={44} />
            : status === 'listening' ? <Mic size={44} />
            : <Phone size={40} />}
        </div>
        <div className="call-status">
          {status === 'listening' ? '正在聆听…' : status === 'thinking' ? '思考中…' : status === 'speaking' ? '正在说话'
            : voiceAvailable ? '点击麦克风开始说话' : '当前设备不支持语音识别，请用文字通话'}
        </div>
        {liveText && <div className="call-live">“{liveText}”</div>}
        {lastReply && status !== 'listening' && <div className="call-reply">{lastReply}</div>}

        <div className="call-controls">
          {voiceAvailable && (
            <button className={`call-btn mic ${status === 'listening' ? 'active' : ''}`} onClick={toggleMic} disabled={busy} title={status === 'listening' ? '停止聆听' : '开始说话'}>
              {status === 'listening' ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
          )}
          <button className={`call-btn mic ${fallbackOpen ? 'active' : ''}`} onClick={() => setFallbackOpen(v => !v)} title="文字输入通话">
            <Keyboard size={22} />
          </button>
          <button className="call-btn hangup" onClick={() => { cleanup(); onClose() }} title="挂断"><PhoneOff size={26} /></button>
        </div>

        {fallbackOpen && (
          <div className="call-fallback">
            <input className="input" placeholder="输入你想说的话…" value={fallbackText}
              onChange={e => setFallbackText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitFallback() }} />
            <button className="btn sm primary" disabled={!fallbackText.trim() || busy} onClick={submitFallback}><Send size={14} /></button>
          </div>
        )}
        <div className="call-hint">{voiceAvailable ? '说话后自动识别并朗读 AI 回复 · 也可切换文字输入' : '输入文字后 AI 会语音朗读回复'}</div>
      </div>
    </div>
  )
}
