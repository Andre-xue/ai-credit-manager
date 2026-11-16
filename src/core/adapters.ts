// 插件化数据源适配器。
// 合规约束：仅调用官方只读端点；不使用 Cookie / 会话令牌；不模拟登录；不执行领取动作。
// 桌面端（Tauri）走 Rust 代理以绕过 CORS，且端点在后端白名单校验，防止开放代理。
import type { DataSourceAdapter } from './types'
import { PROVIDER_MAP } from '../data/providers'

interface UsageResult {
  used: number
  total?: number
  unit: 'token' | 'credit' | 'request' | 'currency' | 'day'
}

interface Endpoint {
  url: string
  parse: (json: any) => { used: number; total?: number }
}

/** 官方只读用量端点白名单（Web 直连；桌面端后端有对应白名单） */
const API_ENDPOINTS: Record<string, Endpoint> = {
  openai: {
    url: 'https://api.openai.com/v1/organization/usage/completions',
    parse: (j) => ({ used: j.total_usage ?? 0 }),
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/usage',
    parse: (j) => ({ used: j.data?.reduce((s: number, d: any) => s + (d.input_tokens || 0) + (d.output_tokens || 0), 0) ?? 0 }),
  },
}

/** 检测是否运行在 Tauri 桌面端 */
function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 调用 Tauri 后端代理命令（动态读取，Web 端不会执行） */
async function tauriProxyUsage(providerId: string, apiKey: string): Promise<any> {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<any> } }
  if (!w.__TAURI_INTERNALS__?.invoke) throw new Error('桌面端代理不可用，请升级应用')
  return w.__TAURI_INTERNALS__.invoke('proxy_usage', { provider: providerId, apiKey })
}

export function getAdapter(providerId: string): DataSourceAdapter {
  const p = PROVIDER_MAP[providerId]
  const endpoint = API_ENDPOINTS[providerId]
  return {
    providerId,
    mode: p?.modes[0] ?? 'manual',
    supported: !!endpoint && !!p?.modes.includes('api'),
    usageUrl: p?.usageUrl ?? p?.officialUrl ?? '#',
    async fetchUsage(apiKey: string): Promise<UsageResult> {
      if (!endpoint) throw new Error(`${p?.name ?? providerId} 无公开只读用量 API，请到官方页面查看后手动录入`)

      let data: any
      if (inTauri()) {
        // 桌面端：由 Rust 后端请求官方端点，无 CORS 限制
        data = await tauriProxyUsage(providerId, apiKey)
      } else {
        // Web 端：直连官方接口，可能因 CORS 失败
        const res = await fetch(endpoint.url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        })
        if (!res.ok) throw new Error(`官方接口返回 ${res.status}。Web 端受 CORS 限制，建议使用桌面端或手动录入`)
        data = await res.json()
      }
      const parsed = endpoint.parse(data)
      return { used: parsed.used, total: parsed.total, unit: 'token' }
    },
  }
}

export function listApiProviders(): string[] {
  return Object.keys(API_ENDPOINTS)
}

export function isDesktopProxyAvailable(): boolean {
  return inTauri()
}
