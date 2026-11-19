import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from './types'
import { callChat, callImage, callVideo, callLocalImage, callLocalVideo, queryVideoTask, fetchLocalMediaModels, normalizeReasoningEffort, usesFixedSampling, extractModelId } from './providerCall'

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

describe('AI 图像/视频模块参数化调用', () => {
  const imgResp = (bodies: unknown[]) => ({
    ok: true,
    text: async () => {
      const b = bodies[bodies.length - 1] as { n?: number }
      return JSON.stringify({ data: Array.from({ length: b?.n ?? 1 }, () => ({ url: 'https://img.example.com/a.png' })) })
    },
  })
  it('callImage 携带尺寸/数量/质量/风格参数，返回图片 URL', async () => {
    const bodies: unknown[] = []
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      bodies.push(JSON.parse(init.body))
      return Promise.resolve(imgResp(bodies))
    })
    vi.stubGlobal('fetch', fetchMock)
    const a = { ...acct('siliconflow'), note: '[生图型] Kwai-Kolors/Kolors' }
    const r = await callImage(a, 'key', '一只猫', { size: '1536x1024', n: 2, quality: 'hd', style: 'vivid' })
    expect(r.ok).toBe(true)
    expect(r.images).toHaveLength(2)
    const body = bodies[0] as Record<string, unknown>
    expect(body.size).toBe('1536x1024')
    expect(body.n).toBe(2)
    expect(body.quality).toBe('hd')
    expect(body.style).toBe('vivid')
    expect(body.model).toBe('Kwai-Kolors/Kolors')
  })
  it('callImage 不传参数时保持默认 1024x1024 与 1 张（向后兼容）', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => {
      bodies.push(JSON.parse(init.body)); return Promise.resolve(imgResp(bodies))
    }))
    await callImage(acct('custom'), 'key', '一只猫')
    expect((bodies[0] as Record<string, unknown>).size).toBe('1024x1024')
    expect((bodies[0] as Record<string, unknown>).n).toBe(1)
  })
  it('callVideo 携带时长/比例/首帧图参数', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => {
      bodies.push(JSON.parse(init.body))
      return Promise.resolve({ ok: true, text: async () => JSON.stringify({ id: 'task-123' }) })
    }))
    const a = { ...acct('kling'), note: '[视频型] Kling-v1' }
    const r = await callVideo(a, 'key', '海浪拍打礁石', { duration: 10, ratio: '16:9', image: 'data:image/png;base64,AAA' })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('task-123')
    const body = bodies[0] as Record<string, unknown>
    expect(body.duration).toBe(10)
    expect(body.ratio).toBe('16:9')
    expect(body.image).toBe('data:image/png;base64,AAA')
  })
  it('queryVideoTask 识别视频 URL 与失败状态', async () => {
    const a = acct('kling')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true, text: async () => JSON.stringify({ status: 'completed', url: 'https://v.example.com/o.mp4' }),
    }))
    const done = await queryVideoTask(a, 'key', 'task-1')
    expect(done.ok).toBe(true)
    expect(done.images).toEqual(['https://v.example.com/o.mp4'])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true, text: async () => JSON.stringify({ status: 'failed' }),
    }))
    const fail = await queryVideoTask(a, 'key', 'task-2')
    expect(fail.ok).toBe(false)
  })
})

describe('本地模型媒体调用与错误兜底', () => {
  it('callLocalImage 通过本地 base 调用并返回图片', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => {
      bodies.push(JSON.parse(init.body))
      return Promise.resolve({ ok: true, text: async () => JSON.stringify({ data: [{ url: 'http://127.0.0.1:1/img.png' }] }) })
    }))
    const r = await callLocalImage('http://127.0.0.1:11434', 'flux', '一只猫', { size: '1024x1024' })
    expect(r.ok).toBe(true)
    expect(r.images).toEqual(['http://127.0.0.1:1/img.png'])
    expect((bodies[0] as Record<string, unknown>).model).toBe('flux')
  })
  it('callLocalVideo 返回任务 ID 文本', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: 'local-task' }) }))
    const r = await callLocalVideo('http://127.0.0.1:8080', 'svd', '海浪')
    expect(r.ok).toBe(true)
    expect(r.text).toContain('local-task')
  })
  it('fetchLocalMediaModels 兼容 data/字符串/name 三种模型格式', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, text: async () => JSON.stringify({ data: [{ id: 'm1' }, { name: 'm2' }, 'm3'] }),
    }))
    expect(await fetchLocalMediaModels('http://127.0.0.1:11434')).toEqual(['m1', 'm2', 'm3'])
  })
  it('回归：Tauri reject 字符串时 callVideo 不崩溃、返回错误文本', async () => {
    // 模拟桌面端 invoke 抛出字符串（真实 bug：lastErr undefined → .slice 崩溃）
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: () => Promise.reject('boom string error') } })
    const r = await callVideo(acct('kling'), 'key', 'test')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('boom string error')
  })
})
