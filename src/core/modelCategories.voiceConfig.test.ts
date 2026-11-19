import { describe, it, expect } from 'vitest'
import {
  isVoiceConfigAccount, VOICE_CONFIG_CATEGORY, categoryForModel, categoryFromNote,
} from './modelCategories'

describe('语音配置(APP)账户识别', () => {
  it('按 providerId 识别', () => {
    expect(isVoiceConfigAccount('voice-config', undefined)).toBe(true)
    expect(isVoiceConfigAccount('openai', '普通')).toBe(false)
  })
  it('按 note 前缀识别', () => {
    expect(isVoiceConfigAccount(undefined, '[语音配置(APP)] 我的Key')).toBe(true)
    expect(isVoiceConfigAccount(undefined, ' [语音配置(APP)]')).toBe(true)
    expect(isVoiceConfigAccount(undefined, '[通用型] 聊天')).toBe(false)
  })
  it('categoryForModel 对语音配置返回隐藏分类', () => {
    expect(categoryForModel('[语音配置(APP)] 我的Key')).toBe(VOICE_CONFIG_CATEGORY)
  })
  it('普通分类不受影响', () => {
    expect(categoryForModel('[通用型] 聊天')).toBe('通用型')
    expect(categoryForModel('[本地型] ollama')).toBe('本地型')
    expect(categoryFromNote('[生图型] 绘图')).toBe('生图型')
  })
})
