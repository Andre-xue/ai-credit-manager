// 阿里云百炼 TTS 直连封装：调用 Rust 后端命令直调官方 API（免部署代理、规避 CORS）。
// 仅在桌面端且配置为 direct 模式时可用。

import { isDesktopApp } from './openExternal'
import type { TtsProviderConfig } from './voice-download'

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function getInvoke(): Invoke | null {
  if (!isDesktopApp()) return null
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }
  return w.__TAURI_INTERNALS__?.invoke ?? null
}

/** 是否为直连模式（桌面端 + provider=aliyun + mode=direct + 有 key） */
export function isDirectMode(cfg: TtsProviderConfig): boolean {
  return cfg.mode === 'direct' && cfg.provider === 'aliyun' && !!cfg.apiKey?.trim() && !!getInvoke()
}

/** 校验 API Key */
export async function ttsTestDirect(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const invoke = getInvoke()
  if (!invoke) return { ok: false, message: '仅桌面端支持直连测试' }
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
  return await invoke('tts_clone_direct', {
    apiKey: cfg.apiKey, name, mime, audioDataUrl,
  }) as string
}

/** 直连合成：返回音频 data URI（data:audio/mp3;base64,...） */
export async function ttsSynthesizeDirect(cfg: TtsProviderConfig, voice: string, text: string): Promise<string> {
  const invoke = getInvoke()
  if (!invoke) throw new Error('仅桌面端支持直连合成')
  return await invoke('tts_synthesize_direct', {
    apiKey: cfg.apiKey, voice, text,
  }) as string
}
