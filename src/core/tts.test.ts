import { describe, expect, it } from 'vitest'
import { cleanForSpeech, cleanForAutoSpeech, resolveCloneVoiceId } from './tts'

describe('cleanForAutoSpeech 自动朗读清洗（只读文字）', () => {
  it('去掉标点符号与表情，只保留文字', () => {
    const out = cleanForAutoSpeech('你好！这是😀测试，包含。标点？还有**重点**')
    expect(out).not.toMatch(/[！!，,。？?]/)
    expect(out).not.toContain('😀')
    expect(out).toContain('这是测试')
    expect(out).toContain('重点')
  })
  it('保留中文与字母数字', () => {
    expect(cleanForAutoSpeech('第1步打开 App')).toBe('第1步打开 应用')
  })
})

describe('resolveCloneVoiceId AI 朗读音色选择', () => {
  const voices = [
    { id: 'cv-1', voiceId: 'cosyvoice-aaa' },
    { id: 'cv-2', voiceId: 'cosyvoice-bbb' },
  ]
  it('指定的 voiceURI 命中克隆音色时用该音色', () => {
    expect(resolveCloneVoiceId('cosyvoice-bbb', voices, 'cosyvoice-aaa')).toBe('cosyvoice-bbb')
    expect(resolveCloneVoiceId('cv-2', voices, null)).toBe('cosyvoice-bbb')
  })
  it('未指定或不匹配时用全局克隆音色', () => {
    expect(resolveCloneVoiceId(null, voices, 'cosyvoice-aaa')).toBe('cosyvoice-aaa')
    expect(resolveCloneVoiceId('Tingting', voices, 'cosyvoice-aaa')).toBe('cosyvoice-aaa')
  })
  it('无指定且无全局克隆音色时返回 null（走系统音）', () => {
    expect(resolveCloneVoiceId(null, voices, null)).toBeNull()
  })
})

describe('cleanForSpeech 朗读文本清洗', () => {
  it('去掉 markdown 加粗/行内代码/标题/列表符号', () => {
    const raw = '## 标题\n**重点**：用 `code` 调用\n- 第一项\n- 第二项'
    const out = cleanForSpeech(raw)
    expect(out).not.toContain('**')
    expect(out).not.toContain('`')
    expect(out).not.toContain('##')
    expect(out).not.toMatch(/^[-*+]\s/m)
    expect(out).toContain('重点')
    expect(out).toContain('第一项')
  })

  it('去掉 emoji 与链接语法，保留链接文字', () => {
    expect(cleanForSpeech('请问😀 [官网](https://example.com)')).toBe('请问 官网')
  })

  it('把换行合并为中文逗号，避免逐行停顿', () => {
    const out = cleanForSpeech('第一行\n第二行\n第三行')
    expect(out).toBe('第一行，第二行，第三行')
  })

  it('空文本与安全返回', () => {
    expect(cleanForSpeech('')).toBe('')
    expect(cleanForSpeech('**')).toBe('')
  })

  it('去掉固定寒暄开头，避免每次都你好/哈哈', () => {
    expect(cleanForSpeech('你好，小明，今天天气不错')).toBe('小明，今天天气不错')
    expect(cleanForSpeech('哈哈，这个很简单')).toBe('这个很简单')
    expect(cleanForSpeech('您好！请问需要帮忙吗')).toBe('请问需要帮忙吗')
  })

  it('把常见英文缩写转成口语，避免逐字母念', () => {
    const out = cleanForSpeech('这个 API Key 放在 App 里，AI 会处理')
    expect(out).toContain('密钥')
    expect(out).toContain('应用')
    expect(out).toContain('人工智能')
    expect(out).not.toMatch(/\bAPI\b|\bAI\b|\bApp\b/)
  })

  it('保留正常中文标点与句子', () => {
    const s = '这个方案不错。你觉得呢？'
    expect(cleanForSpeech(s)).toBe(s)
  })
})
