import { describe, it, expect } from 'vitest'
import {
  memoryToTier, maxServicesForTier, isServiceEnabled, isAccountServiceEnabled,
  enabledServiceCount, toggleService, providerToService, tierAdvice, shouldShowLocalCategory,
} from './localServicesSettings'
import type { AppSettings } from './types'

const base = (localServices?: Record<string, boolean>): AppSettings => ({
  vaultInitialized: true, monthlyBudget: 200, checkinReminder: true, checkinProviders: [],
  alertDays: 7, defaultUnit: 'credit', backupReminder: true,
  unlockMethod: 'password', unitPrices: {},
  localServices,
})

describe('memoryToTier', () => {
  it('按物理内存正确分档', () => {
    expect(memoryToTier(4)).toBe(8)
    expect(memoryToTier(8)).toBe(8)
    expect(memoryToTier(9.5)).toBe(8)
    expect(memoryToTier(16)).toBe(16)
    expect(memoryToTier(12)).toBe(16)
    expect(memoryToTier(32)).toBe(32)
    expect(memoryToTier(64)).toBe(32)
  })
  it('异常值按最保守 8G 处理', () => {
    expect(memoryToTier(0)).toBe(8)
    expect(memoryToTier(-1)).toBe(8)
    expect(memoryToTier(NaN)).toBe(8)
  })
})

describe('硬限制与默认值', () => {
  it('8G 档最多 1 个服务，16G/32G 不限', () => {
    expect(maxServicesForTier(8)).toBe(1)
    expect(maxServicesForTier(16)).toBe(3)
    expect(maxServicesForTier(32)).toBe(3)
  })
  it('未配置时默认全部开启', () => {
    expect(isServiceEnabled(base(), 'ollama')).toBe(true)
    expect(enabledServiceCount(base())).toBe(3)
  })
  it('明确关闭的服务判定为关闭', () => {
    const s = base({ ollama: false, comfyui: true, lmstudio: true })
    expect(isServiceEnabled(s, 'ollama')).toBe(false)
    expect(enabledServiceCount(s)).toBe(2)
  })
})

describe('AI页本地型分类显隐', () => {
  it('全部本地服务关闭时隐藏本地型分类', () => {
    const s = base({ ollama: false, comfyui: false, lmstudio: false })
    expect(shouldShowLocalCategory(s)).toBe(false)
  })
  it('开启任一本地服务时显示本地型分类', () => {
    expect(shouldShowLocalCategory(base({ ollama: true, comfyui: false, lmstudio: false }))).toBe(true)
    expect(shouldShowLocalCategory(base({ ollama: false, comfyui: true, lmstudio: false }))).toBe(true)
    expect(shouldShowLocalCategory(base())).toBe(true)
  })
})

describe('账户服务判定', () => {
  it('本地账户按服务开关判定', () => {
    const s = base({ ollama: false })
    expect(isAccountServiceEnabled(s, 'local-ollama')).toBe(false)
    expect(isAccountServiceEnabled(s, 'local-comfyui')).toBe(true)
  })
  it('非本地账户恒为启用', () => {
    expect(isAccountServiceEnabled(base(), 'openai')).toBe(true)
    expect(providerToService('openai')).toBeNull()
  })
  it('providerId 正确映射到服务 key', () => {
    expect(providerToService('local-ollama')).toBe('ollama')
    expect(providerToService('local-comfyui')).toBe('comfyui')
    expect(providerToService('local-lmstudio')).toBe('lmstudio')
  })
})

describe('toggleService 硬限制', () => {
  it('8G 档：已开 1 个时再开另一个被拒绝', () => {
    const s = base({ ollama: true, comfyui: false, lmstudio: false })
    expect(toggleService(s, 'comfyui', 8)).toBeNull()
  })
  it('8G 档：关闭后返回新状态', () => {
    const s = base({ ollama: true, comfyui: false, lmstudio: false })
    expect(toggleService(s, 'ollama', 8)).toEqual({ ollama: false, comfyui: false, lmstudio: false })
  })
  it('8G 档：当前 0 个时允许开一个', () => {
    const s = base({ ollama: false, comfyui: false, lmstudio: false })
    expect(toggleService(s, 'ollama', 8)).toEqual({ ollama: true, comfyui: false, lmstudio: false })
  })
  it('16G 档：允许开多个', () => {
    const s = base({ ollama: true, comfyui: false, lmstudio: false })
    expect(toggleService(s, 'comfyui', 16)).toEqual({ ollama: true, comfyui: true, lmstudio: false })
  })
})

describe('tierAdvice', () => {
  it('各档位给出对应建议文案', () => {
    expect(tierAdvice(8)).toContain('仅允许同时开启 1 个')
    expect(tierAdvice(16)).toContain('建议只开启 1 个')
    expect(tierAdvice(32)).toContain('全部本地服务')
  })
})
