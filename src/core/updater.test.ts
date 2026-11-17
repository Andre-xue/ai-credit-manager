import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkReleaseUpdate } from './updater'

afterEach(() => vi.unstubAllGlobals())

const jsonRes = (data: unknown, ok = true, status = 200) => ({
  ok, status,
  json: async () => data,
})

const release = (tag: string, names: string[], extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  body: `notes for ${tag}`,
  published_at: '2026-11-18T00:00:00Z',
  assets: names.map(name => ({ name, browser_download_url: `https://x/${name}` })),
  ...extra,
})

const DESKTOP = ['latest.json', 'AI.Credit.Manager_0.1.66_aarch64.dmg', 'AI.Credit.Manager_0.1.66_x64-setup.exe']

describe('检查更新：桌面安装包齐全性判断与回退', () => {
  it('最新版已有桌面安装包时不回退，直接返回最新版', async () => {
    const latest = release('v0.1.68', DESKTOP)
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(latest)))
    const info = await checkReleaseUpdate(true)
    expect(info?.latest).toBe('0.1.68')
    expect(info?.fallback).toBe(false)
    expect(info?.installersReady).toBe(true)
  })

  it('最新版缺桌面包时回退到最近一个带完整安装包的正式版', async () => {
    const latest = release('v0.1.69', ['app-debug.apk'])
    const list = [
      latest,
      release('v0.1.68', ['app-debug.apk']),           // 也没有桌面包
      release('v0.1.67', DESKTOP),                      // 最近一个完整版本
      release('v0.1.66', DESKTOP),
      release('v0.1.70', DESKTOP, { draft: true }),     // 草稿，应忽略
    ]
    const fetchMock = vi.fn(async (url: string) =>
      jsonRes(url.includes('/releases?') ? list : latest),
    )
    vi.stubGlobal('fetch', fetchMock)
    const info = await checkReleaseUpdate(true)
    expect(info?.latest).toBe('0.1.67')
    expect(info?.fallback).toBe(true)
    expect(info?.installersReady).toBe(true)
    expect(info?.releaseUrl).toContain('v0.1.67')
  })

  it('列表里没有任何带桌面包的版本时回报构建中，不误报为可下载', async () => {
    const latest = release('v0.1.69', ['app-debug.apk'])
    // latest 端点返回单个对象、list 端点返回只有无桌面包版本的数组
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      jsonRes(url.includes('/releases?') ? [latest] : latest),
    ))
    const info = await checkReleaseUpdate(true)
    expect(info?.installersReady).toBe(false)
    expect(info?.fallback).toBe(false)
  })

  it('非桌面调用不做齐全性判断，直接返回最新版', async () => {
    const latest = release('v0.1.69', ['app-debug.apk'])
    const fetchMock = vi.fn(async () => jsonRes(latest))
    vi.stubGlobal('fetch', fetchMock)
    const info = await checkReleaseUpdate(false)
    expect(info?.latest).toBe('0.1.69')
    expect(fetchMock).toHaveBeenCalledTimes(1) // 不额外拉列表
  })

  it('GitHub 403 限流给出明确错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({}, false, 403)))
    const info = await checkReleaseUpdate(true)
    expect(info?.error).toContain('频率限制')
  })
})
