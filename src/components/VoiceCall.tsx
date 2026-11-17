// AI 语音通话模式：类电话交互——语音识别输入 → AI 回复 → 自动朗读。
// 使用浏览器 SpeechRecognition（webkit 前缀兼容）+ 现有 TTS 朗读。
// 对话型模型可用；不支持语音识别的环境给出明确提示。

import { useEffect, useRef, useState } from 'react'
import { Phone, PhoneOff, Mic, MicOff, Volume2, Loader2 } from 'lucide-react'
import { speak, stopSpeak, getSavedVoice } from '../core/tts'

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

function createRecognition(): RecognitionLike | null {
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
  const [supported, setSupported] = useState(true)
  const recRef = useRef<RecognitionLike | null>(null)
  const wantListen = useRef(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    timerRef.current = window.setInterval(() => setSeconds(s => s + 1), 1000)
    const r = createRecognition()
    if (!r) { setSupported(false); return () => {} }
    recRef.current = r
    r.onresult = (e: any) => {
      const text = Array.from(e.results).map((res: any) => res[0]?.transcript ?? '').join('').trim()
      if (text) { setLiveText(text); void handleText(text) }
    }
    r.onerror = (e: any) => {
      if (e?.error === 'no-speech') { setStatus('idle'); return }
      notify(`语音识别出错：${e?.error ?? '未知'}`)
      setStatus('idle')
    }
    r.onend = () => { if (wantListen.current) { try { r.start() } catch { /* ignore */ } } }
    return () => { cleanup() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cleanup = () => {
    wantListen.current = false
    try { recRef.current?.stop() } catch { /* ignore */ }
    stopSpeak()
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
  }

  const startListening = () => {
    if (!recRef.current) { notify('当前环境不支持语音识别，请用文字对话'); return }
    wantListen.current = true
    setStatus('listening')
    setLiveText('')
    try { recRef.current.start() } catch { /* 已在运行 */ }
  }

  const stopListening = () => {
    wantListen.current = false
    try { recRef.current?.stop() } catch { /* ignore */ }
    setStatus('idle')
  }

  const handleText = async (text: string) => {
    wantListen.current = false
    try { recRef.current?.stop() } catch { /* ignore */ }
    setStatus('thinking')
    try {
      const reply = await onSend(text)
      setLastReply(reply)
      setStatus('speaking')
      const ok = speak(reply, getSavedVoice(), (s) => {
        if (s === 'end' || s === 'error') { setStatus('idle'); setLiveText('') }
      })
      if (!ok) { setStatus('idle'); notify('当前环境不支持语音朗读') }
    } catch (e) {
      setStatus('idle')
      notify(`回复失败：${(e as Error).message?.slice(0, 80) ?? '未知错误'}`)
    }
  }

  const toggleMic = () => {
    if (status === 'listening') stopListening()
    else if (status === 'idle' || status === 'speaking') { stopSpeak(); startListening() }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

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
          {status === 'listening' ? '正在聆听…' : status === 'thinking' ? '思考中…' : status === 'speaking' ? '正在说话' : supported ? '点击下方按钮开始说话' : '当前环境不支持语音识别'}
        </div>
        {liveText && <div className="call-live">“{liveText}”</div>}
        {lastReply && status !== 'listening' && <div className="call-reply">{lastReply}</div>}

        <div className="call-controls">
          <button className={`call-btn mic ${status === 'listening' ? 'active' : ''}`} onClick={toggleMic} disabled={!supported} title={status === 'listening' ? '停止聆听' : '开始说话'}>
            {status === 'listening' ? <MicOff size={24} /> : <Mic size={24} />}
          </button>
          <button className="call-btn hangup" onClick={() => { cleanup(); onClose() }} title="挂断"><PhoneOff size={26} /></button>
        </div>
        <div className="call-hint">说话后自动识别并朗读 AI 回复 · 再次点击麦克风可随时打断</div>
      </div>
    </div>
  )
}
