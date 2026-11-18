import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from './types'
import { callChat, normalizeReasoningEffort, usesFixedSampling, extractModelId } from './providerCall'

const acct = (providerId: string): Account => ({
  id: 'a1', providerId, label: 'test', mode: 'api',
  apiUrl: 'https://api.example.com',
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
})

afterEach(() => vi.unstubAllGlobals())

const okResponse = (text = 'ok') => ({
  ok: true,
  text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }),
})

describe('自有模型请求参数兼容', () => {
  it('Kimi 账户与 K3 模型不发送固定采样参数 temperature', () => {
    expect(usesFixedSampling(acct('kim'), 'anything')).toBe(true)
    expect(usesFixedSampling(acct('custom'), 'kimi-k3.1-pro')).toBe(true)
    expect(usesFixedSampling(acct('custom'), 'moonshotai/kimi-k3.1-pro')).toBe(true)
    expect(usesFixedSampling(acct('custom'), 'kimi-k3.1-pro-highspeed')).toBe(true)
    expect(usesFixedSampling(acct('openai'), 'gpt-4.1')).toBe(false)
  })

  it('K3 推理等级映射到官方支持的 low/high/max', () => {
    const kimi = acct('kim')
    expect(normalizeReasoningEffort(kimi, 'kimi-k3.1-pro', 'minimal')).toBe('low')
    expect(normalizeReasoningEffort(kimi, 'kimi-k3.1-pro', 'medium')).toBe('high')
    expect(normalizeReasoningEffort(kimi, 'kimi-k3.1-pro', 'high')).toBe('max')
    expect(normalizeReasoningEffort(kimi, 'kimi-k3.1-pro', undefined)).toBeUndefined()
    // 其他模型保持原有映射
    expect(normalizeReasoningEffort(acct('openai'), 'gpt-4.1', 'minimal')).toBe('minimal')
  })

  it('K3.1 Pro 实际请求体不带 temperature，推理等级映射为官方值', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', fetchMock)
    const r = await callChat(acct('kim'), 'key', [{ role: 'user', content: 'hi' }], 'kimi-k3.1-pro', 'minimal')
    expect(r.ok).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.temperature).toBeUndefined()
    expect(body.reasoning_effort).toBe('low')
  })

  it('未知模型遇到 temperature 报错时自动去掉该参数重试一次', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, text: async () => '{"error":{"message":"invalid temperature: only 1 is allowed for this model"}}' })
      .mockResolvedValueOnce(okResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const r = await callChat(acct('custom'), 'key', [{ role: 'user', content: 'hi' }], 'some-fixed-model')
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).temperature).toBeUndefined()
  })
})

describe('生图/生视频模型 ID 提取', () => {
  it('从备注分类前缀后提取含斜杠的真实模型 ID', () => {
    const a = { ...acct('siliconflow'), label: '硅基流动', note: '[生图型] Kwai-Kolors/Kolors' }
    expect(extractModelId(a)).toBe('Kwai-Kolors/Kolors')
  })
  it('从 label 中提取模型 ID', () => {
    const a = { ...acct('siliconflow'), label: 'black-forest-labs/FLUX.1-schnell' }
    expect(extractModelId(a)).toBe('black-forest-labs/FLUX.1-schnell')
  })
  it('无模型 ID 时退回第一个候选/label', () => {
    const a = { ...acct('custom'), label: '硅基流动 · BAABe Large En V1.5', note: '[生图型] 我的账户' }
    // 无斜杠，取 note 去掉分类后的首个 token
    expect(extractModelId(a)).toBe('我的账户')
  })
})
