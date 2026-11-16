// 跨平台价值归一化：把不同单位的剩余额度折算成人民币估值。
// 单价由用户自行校准（设置中可改），默认值仅为保守参考，不代表官方定价。
import type { AppState, CreditUnit } from './types'
import { PROVIDER_MAP } from '../data/providers'
import { latestQuota } from './store'

/** 默认参考单价（元 / 单位）。currency 单位恒为 1 元，无需配置。 */
export const DEFAULT_UNIT_PRICES: Record<string, number> = {
  default: 0.01,
  openai: 0.01,      // 约每千 token 10 元 → 每 token 0.01 元（粗略）
  anthropic: 0.02,
  gemini: 0.001,     // 免费层为主，象征性估值
  deepseek: 0.001,
  qwen: 0.0005,
  kim: 0.002,
  doubao: 0.0008,
  glm: 0.0005,
  cursor: 0.5,       // 订阅请求次数
  copilot: 0.5,
  perplexity: 0.01,
  elevenlabs: 0.1,
  midjourney: 1,
  figma: 0.5,
}

/** 取某平台每单位估值（元） */
export function unitPrice(state: AppState, providerId: string): number {
  const prices = { ...DEFAULT_UNIT_PRICES, ...(state.settings.unitPrices ?? {}) }
  return prices[providerId] ?? prices.default
}

/**
 * 计算账户剩余额度的估值（元）。
 * currency 单位按 1:1；其余按平台单价 × 剩余量。
 */
export function estimateAccountValue(state: AppState, providerId: string, remaining: number, unit: CreditUnit): number {
  if (remaining <= 0) return 0
  if (unit === 'currency') return remaining
  return remaining * unitPrice(state, providerId)
}

/** 全部账户剩余资源总估值（元） */
export function totalPortfolioValue(state: AppState): number {
  let total = 0
  for (const a of state.accounts) {
    const q = latestQuota(state.quotas, a.id)
    if (!q || q.total <= 0) continue
    total += estimateAccountValue(state, a.providerId, Math.max(0, q.total - q.used), q.unit)
  }
  return total
}

/** 按平台汇总本月消费（用于报告） */
export interface PlatformSpend {
  providerId: string
  name: string
  cost: number
  inputTokens: number
  outputTokens: number
  share: number
}
export function monthlySpendByPlatform(state: AppState, monthPrefix: string): PlatformSpend[] {
  const map = new Map<string, { cost: number; input: number; output: number }>()
  for (const u of state.usage) {
    if (!u.date.startsWith(monthPrefix)) continue
    const acc = state.accounts.find(a => a.id === u.accountId)
    if (!acc) continue
    const cur = map.get(acc.providerId) ?? { cost: 0, input: 0, output: 0 }
    cur.cost += u.estimatedCost
    cur.input += u.inputTokens
    cur.output += u.outputTokens
    map.set(acc.providerId, cur)
  }
  const total = [...map.values()].reduce((s, v) => s + v.cost, 0)
  return [...map.entries()].map(([providerId, v]) => ({
    providerId,
    name: PROVIDER_MAP[providerId]?.shortName ?? providerId,
    cost: v.cost,
    inputTokens: v.input,
    outputTokens: v.output,
    share: total > 0 ? v.cost / total : 0,
  })).sort((a, b) => b.cost - a.cost)
}
