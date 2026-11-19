// 阿里云百炼 TTS 直连封装：调用 Rust 后端命令直调官方 API（免部署代理、规避 CORS）。
// 仅在桌面端且配置为 direct 模式时可用。

import { isDesktopApp } from './openExternal'
import type { TtsProviderConfig } from './voice-download'
import { getCurrentVoiceApiKey, hasVoiceConfigAccount } from './voiceKey'

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function getInvoke(): Invoke | null {
  if (!isDesktopApp()) return null
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }
  return w.__TAURI_INTERNALS__?.invoke ?? null
}

/**
 * 是否为直连模式（桌面端 + 有可用 Key）。
 * Key 来源：语音配置账户（加密）优先，旧的 localStorage 配置兜底。
 */
export function isDirectMode(cfg: TtsProviderConfig): boolean {
  if (!getInvoke()) return false
  if (cfg.mode === 'proxy') return false
  // 有语音配置账户，或旧配置直连模式且填了 Key
  if (hasVoiceConfigAccount()) return true
  return cfg.provider === 'aliyun' && !!cfg.apiKey?.trim()
}

/** 解析语音 API Key：优先加密账户（按当前服务商匹配），回退旧配置 */
async function resolveVoiceKey(cfg: TtsProviderConfig): Promise<string> {
  const fromAccount = await getCurrentVoiceApiKey(cfg.provider || undefined)
  if (fromAccount) return fromAccount
  return cfg.apiKey ?? ''
}

/** 校验 API Key（账户 Key 优先；传入值兜底） */
export async function ttsTestDirect(fallbackKey: string, provider?: string): Promise<{ ok: boolean; message: string }> {
  const invoke = getInvoke()
  if (!invoke) return { ok: false, message: '仅桌面端支持直连测试' }
  const fromAccount = await getCurrentVoiceApiKey(provider)
  const apiKey = fromAccount || fallbackKey
  if (!apiKey.trim()) return { ok: false, message: '请先在「添加账户 → 语音配置(APP)」保存 Key，或在下方输入' }
  try {
    const message = await invoke('tts_test_direct', { apiKey }) as string
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: (e as Error)?.message ?? String(e) }
  }
}

/** 直连克隆：返回 voiceId */
export async function ttsCloneDirect(cfg: TtsProviderConfig, name: string, mime: string, audioDataUrl: string): Promise<string> {
  const invoke = getInvoke()
  if (!invoke) throw new Error('仅桌面端支持直连克隆')
  const apiKey = await resolveVoiceKey(cfg)
  if (!apiKey) throw new Error('语音配置 Key 未解锁，请在语音配置页验证主密码')
  return await invoke('tts_clone_direct', {
    apiKey, name, mime, audioDataUrl,
  }) as string
}

/** 直连合成：返回音频 data URI（data:audio/mp3;base64,...） */
export async function ttsSynthesizeDirect(cfg: TtsProviderConfig, voice: string, text: string): Promise<string> {
  const invoke = getInvoke()
  if (!invoke) throw new Error('仅桌面端支持直连合成')
  const apiKey = await resolveVoiceKey(cfg)
  if (!apiKey) throw new Error('语音配置 Key 未解锁，请在语音配置页验证主密码')
  return await invoke('tts_synthesize_direct', {
    apiKey, voice, text,
  }) as string
}

// ==================== VoiceStudio 本地服务 ====================
// 通过 Rust 后端直连本机 VoiceStudio(:3900)，绕过浏览器 CORS。
// endpoint 即 VoiceStudio 地址（默认 http://127.0.0.1:3900），apiKey 为其可选 Bearer 密钥。

function vsArgs(cfg: TtsProviderConfig): { endpoint: string; apiKey: string } {
  return { endpoint: cfg.endpoint?.trim() || 'http://127.0.0.1:3900', apiKey: cfg.apiKey?.trim() || '' }
}

export async function voicestudioTest(cfg: TtsProviderConfig): Promise<{ ok: boolean; message: string }> {
  const invoke = getInvoke()
  if (!invoke) return { ok: false, message: '仅桌面端支持连接 VoiceStudio' }
  try {
    const message = await invoke('voicestudio_test', vsArgs(cfg)) as string
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: (e as Error)?.message ?? String(e) }
  }
}

export interface VoiceStudioProfile { id: string; name: string; [key: string]: unknown }

export async function voicestudioList(cfg: TtsProviderConfig): Promise<VoiceStudioProfile[]> {
  const invoke = getInvoke()
  if (!invoke) throw new Error('仅桌面端支持 VoiceStudio 音色列表')
  const arr = await invoke('voicestudio_list', vsArgs(cfg)) as Array<Record<string, unknown>>
  return arr.map(p => ({
    ...p,
    id: String(p.id ?? p.profile_id ?? ''),
    name: String(p.name ?? p.id ?? '未命名音色'),
  })).filter(p => p.id)
}

export async function voicestudioClone(cfg: TtsProviderConfig, name: string, audioDataUrl: string): Promise<string> {
  const invoke = getInvoke()
  if (!invoke) throw new Error('仅桌面端支持 VoiceStudio 克隆')
  return await invoke('voicestudio_clone', { ...vsArgs(cfg), name, audioDataUrl }) as string
}

export async function voicestudioSynthesize(cfg: TtsProviderConfig, voice: string, text: string): Promise<string> {
  const invoke = getInvoke()
  if (!invoke) throw new Error('仅桌面端支持 VoiceStudio 合成')
  return await invoke('voicestudio_synthesize', { ...vsArgs(cfg), voice, text }) as string
}
