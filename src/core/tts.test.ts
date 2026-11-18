import { describe, expect, it } from 'vitest'
import { cleanForSpeech } from './tts'

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
    expect(cleanForSpeech('你好😀 [官网](https://example.com)')).toBe('你好 官网')
  })

  it('把换行合并为中文逗号，避免逐行停顿', () => {
    const out = cleanForSpeech('第一行\n第二行\n第三行')
    expect(out).toBe('第一行，第二行，第三行')
  })

  it('空文本与安全返回', () => {
    expect(cleanForSpeech('')).toBe('')
    expect(cleanForSpeech('**')).toBe('')
  })

  it('保留正常中文标点与句子', () => {
    const s = '你好，我是AI助手。请问需要什么帮助？'
    expect(cleanForSpeech(s)).toBe(s)
  })
})
