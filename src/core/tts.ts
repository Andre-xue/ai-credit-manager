// 语音朗读核心：基于系统内置 Web Speech API（speechSynthesis）。
// 零下载、离线可用、不占存储。音色来自操作系统已安装的语音包；
// 真正的方言音色（粤语/四川话等）需要第三方 TTS，由 voice-download.ts 管理。

export interface VoiceOption {
  uri: string
  name: string
  lang: string
  /** 归一化分组：mandarin / tw / cantonese / other */
  group: 'mandarin' | 'tw' | 'cantonese' | 'other' | 'dialect'
  /** 是否为系统内置（可直接用）；false 表示需第三方 TTS 下载 */
  system: boolean
}

const VOICE_KEY = 'acm.tts.voice'
const RATE_KEY = 'acm.tts.rate'

function groupOf(lang: string, name: string): VoiceOption['group'] {
  const l = lang.toLowerCase()
  if (l.startsWith('zh-hk') || l.startsWith('yue') || /cantonese|粤语|廣東話/i.test(name)) return 'cantonese'
  if (l === 'zh-tw' || l.startsWith('zh-hant') || /taiwan|台湾|臺灣/i.test(name)) return 'tw'
  if (l === 'zh-cn' || l === 'zh-hans' || l.startsWith('zh')) return 'mandarin'
  return 'other'
}

/** 列出系统可用音色（仅中文与常见外语，按使用频率排序） */
export function listSystemVoices(): VoiceOption[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return []
  const raw = window.speechSynthesis.getVoices() || []
  return raw
    .filter(v => /^zh|^yue/i.test(v.lang) || /chinese|mandarin|中文|普通话/i.test(v.name))
    .sort((a, b) => {
      // 中文优先，普通话 > 台湾 > 粤语 > 其他
      const rank = (g: VoiceOption['group']) => ({ mandarin: 0, tw: 1, cantonese: 2, other: 3, dialect: 4 })[g]
      return rank(groupOf(a.lang, a.name)) - rank(groupOf(b.lang, b.name))
    })
    .map(v => ({
      uri: v.voiceURI,
      name: v.name,
      lang: v.lang,
      group: groupOf(v.lang, v.name),
      system: true,
    }))
}

export interface PresetVoice {
  id: string
  name: string
  desc: string
  /** 实际映射到的系统音色 voiceURI；未找到时回退第一个中文音色 */
  uri?: string
  fallbackName: string
}

/** 豆包风格拟真音色预设：映射到系统已安装的中文语音包（不是云端克隆音色） */
export function listPresetVoices(): PresetVoice[] {
  const voices = listSystemVoices()
  const pick = (test: (v: VoiceOption) => boolean) => voices.find(test)?.uri
  return [
    { id: 'warm', name: '暖阳', desc: '温柔自然 · 女声', uri: pick(v => /female|女|xiaoxiao|huihui|tingting/i.test(v.name) && v.group === 'mandarin'), fallbackName: '普通话女声' },
    { id: 'clear', name: '清朗', desc: '清晰干练 · 男声', uri: pick(v => /male|男|yunxi|kangkang|liang/i.test(v.name) && v.group === 'mandarin'), fallbackName: '普通话男声' },
    { id: 'smart', name: '知性', desc: '播音腔 · 女声', uri: pick(v => /female|女|news|播报/i.test(v.name) && v.group === 'mandarin'), fallbackName: '普通话女声' },
    { id: 'lively', name: '活力', desc: '年轻明快 · 女声', uri: pick(v => /female|女|xiaoyi|xiaoxiao/i.test(v.name)), fallbackName: '普通话女声' },
    { id: 'steady', name: '沉稳', desc: '成熟稳重 · 男声', uri: pick(v => /male|男|yunyang|kangkang/i.test(v.name)), fallbackName: '普通话男声' },
  ]
}

/** 音色就绪监听（部分浏览器 voices 异步加载） */
export function onVoicesReady(cb: () => void): () => void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return () => {}
  const already = window.speechSynthesis.getVoices().length > 0
  if (already) { cb(); return () => {} }
  window.speechSynthesis.addEventListener('voiceschanged', cb)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', cb)
}

export function getSavedVoice(): string | null {
  try { return localStorage.getItem(VOICE_KEY) } catch { return null }
}
export function saveVoice(uri: string): void {
  try { localStorage.setItem(VOICE_KEY, uri) } catch { /* 忽略 */ }
}
export function getRate(): number {
  try { const r = Number(localStorage.getItem(RATE_KEY)); return r >= 0.5 && r <= 2 ? r : 1 } catch { return 1 }
}
export function saveRate(r: number): void {
  try { localStorage.setItem(RATE_KEY, String(r)) } catch { /* 忽略 */ }
}

let ttsUnlocked = false

/**
 * 在用户手势（点麦克风/发送）中预热系统 TTS。
 * Android WebView 常要求先有用户手势才允许后续 speechSynthesis 发声。
 */
export function unlockTts(): void {
  if (ttsUnlocked || typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    u.lang = 'zh-CN'
    window.speechSynthesis.speak(u)
    ttsUnlocked = true
  } catch { /* 忽略：部分 WebView 不支持朗读空文本 */ }
}

import { getTtsConfig } from './voice-download'
import { getClonedVoiceId } from './voiceClone'

let activeCallback: ((state: 'start' | 'end' | 'error') => void) | null = null

export function isSpeaking(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking
}

/** 朗读文本。onState 回调播放开始/结束/错误。 */
export function speak(text: string, voiceURI: string | null, onState?: (s: 'start' | 'end' | 'error') => void): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false
  const synth = window.speechSynthesis
  synth.cancel()
  activeCallback = onState ?? null

  const u = new SpeechSynthesisUtterance(text)
  const voices = synth.getVoices()
  const picked = voiceURI ? voices.find(v => v.voiceURI === voiceURI) : undefined
  // 未指定或找不到时优先中文音色
  const fallback = voices.find(v => /^zh|^yue/i.test(v.lang)) ?? voices[0]
  if (picked || fallback) u.voice = (picked ?? fallback)!
  u.lang = (picked ?? fallback)?.lang ?? 'zh-CN'
  u.rate = getRate()
  u.onstart = () => activeCallback?.('start')
  u.onend = () => { activeCallback?.('end'); activeCallback = null }
  u.onerror = () => { activeCallback?.('error'); activeCallback = null }
  synth.speak(u)
  return true
}

/**
 * 异步朗读：若已克隆声音且配置了第三方代理，优先走代理合成；失败回退系统 TTS。
 * 克隆声音只有代理端实现 /synthesize 后才会真正生效，系统音色不应伪装成克隆效果。
 */
export async function speakAsync(text: string, voiceURI: string | null, onState?: (s: 'start' | 'end' | 'error') => void): Promise<boolean> {
  const cloned = getClonedVoiceId()
  const cfg = getTtsConfig()
  if (cloned && cfg.endpoint) {
    try {
      stopSpeak()
      const url = `${cfg.endpoint.replace(/\/$/, '')}/synthesize?provider=${encodeURIComponent(cfg.provider)}&voice=${encodeURIComponent(cloned)}&text=${encodeURIComponent(text)}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      if (!blob.size) throw new Error('合成音频为空')
      const audio = new Audio(URL.createObjectURL(blob))
      activeCallback = onState ?? null
      audio.onplay = () => activeCallback?.('start')
      audio.onended = () => { activeCallback?.('end'); activeCallback = null; URL.revokeObjectURL(audio.src) }
      audio.onerror = () => { activeCallback?.('error'); activeCallback = null }
      await audio.play()
      return true
    } catch { /* 回退系统 TTS */ }
  }
  return speak(text, voiceURI, onState)
}

export function stopSpeak(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  activeCallback = null
  window.speechSynthesis.cancel()
}

export function pauseSpeak(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.pause()
}
export function resumeSpeak(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.resume()
}

/** 试听一句示例 */
export function previewVoice(voiceURI: string | null): boolean {
  return speak('你好，我是 AI 积分管家的语音助手，很高兴为你服务。', voiceURI)
}
