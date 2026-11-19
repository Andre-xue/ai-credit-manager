import { describe, it, expect } from 'vitest'
import { detectModelCapability, shouldHideFromChat } from './modelCapability'

describe('模型能力识别', () => {
  it('识别嵌入模型（含标签变体）', () => {
    for (const name of ['nomic-embed-text:latest', 'nomic-embed-text', 'mxbai-embed-large', 'bge-m3', 'text-embedding-3-small']) {
      const r = detectModelCapability(name)
      expect(r.capability, name).toBe('embedding')
      expect(shouldHideFromChat(r), name).toBe(true)
    }
  })
  it('识别翻译模型', () => {
    const r = detectModelCapability('hy-mt2:1.8b')
    expect(r.capability).toBe('translation')
    expect(r.chatCapable).toBe(true) // 翻译走 chat 接口，保留但不推荐
  })
  it('识别通用对话模型', () => {
    for (const name of ['llama3.2:3b', 'qwen2.5:3b', 'deepseek-v4-pro-4b-uncensored:latest', 'gemma2:9b']) {
      const r = detectModelCapability(name)
      expect(r.capability, name).toBe('chat')
      expect(shouldHideFromChat(r), name).toBe(false)
    }
  })
  it('识别图像与音频模型', () => {
    expect(detectModelCapability('llava:latest').capability).toBe('image')
    expect(detectModelCapability('whisper-large-v3').capability).toBe('audio')
    expect(shouldHideFromChat(detectModelCapability('llava'))).toBe(true)
  })
  it('未知模型默认可聊天（保守，避免误杀）', () => {
    const r = detectModelCapability('my-custom-model')
    expect(r.capability).toBe('unknown')
    expect(shouldHideFromChat(r)).toBe(false)
  })
})
