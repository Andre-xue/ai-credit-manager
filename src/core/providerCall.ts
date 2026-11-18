// 用用户自己的 API Key 真正调用各平台（对话/生图/视频/本地）。
// 桌面端走 Tauri 命令代理绕过 CORS；Web/Docker 端直连（可能被 CORS 拦截，会给出提示）。
// 主流 OpenAI 兼容接口（DeepSeek/OpenAI/智谱/Moonshot/本地 Ollama 等）开箱可用；
// 生图走 /images/generations；视频为异步任务制，做尽力提交并给出去官方查询的引导。

import type { Account } from './types'
import type { ModelCategory } from './modelCategories'
import { isDesktopApp } from './openExternal'

export interface ProviderCallResult {
  ok: boolean
  text: string
  /** 图片 URL（生图型） */
  images?: string[]
  error?: string
  /** 是否为 CORS 类错误（Web 端提示用桌面端） */
  cors?: boolean
}

interface InvokeWindow extends Window {
  __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<string> }
}

async function invokeApi(url: string, apiKey: string, body: unknown, method: 'POST' | 'GET' = 'POST'): Promise<string> {
  const w = window as unknown as InvokeWindow
  if (!w.__TAURI_INTERNALS__?.invoke) throw Object.assign(new Error('桌面代理不可用'), { cors: true })
  return w.__TAURI_INTERNALS__.invoke!('call_provider_api', {
    url, apiKey, bodyJson: JSON.stringify(body), method,
  })
}

async function directFetch(url: string, apiKey: string, body: unknown): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`接口返回 ${res.status}：${text.slice(0, 160)}`)
  return text
}

/** 规范化 API base：确保以 /v1 结尾的对话端点可用 */
function chatUrl(account: Account): string {
  let base = (account.apiUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('该账户未填写 API 地址')
  // 用户填 base（如 https://api.deepseek.com）时补 /v1；已含 /chat/completions 则直接用
  if (base.includes('/chat/completions')) return base
  if (!/\/v\d+/.test(base)) base += '/v1'
  return `${base}/chat/completions`
}

/** /v1/models 端点：拉取该 Key 实际可用的模型引擎 */
function modelsUrl(account: Account): string {
  let base = (account.apiUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('该账户未填写 API 地址')
  if (base.includes('/chat/completions')) base = base.replace(/\/chat\/completions$/, '')
  if (!/\/v\d+/.test(base)) base += '/v1'
  return `${base}/models`
}

/**
 * 动态拉取平台可用模型引擎（OpenAI 兼容 /v1/models）。
 * 返回模型 id 列表；失败时抛出异常，由 UI 回退到内置目录。
 */
export async function fetchProviderModels(account: Account, apiKey: string): Promise<string[]> {
  const url = modelsUrl(account)
  let raw: string
  if (isDesktopApp()) {
    raw = await invokeApi(url, apiKey, {}, 'GET')
  } else {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    })
    raw = await res.text()
    if (!res.ok) throw new Error(`接口返回 ${res.status}：${raw.slice(0, 120)}`)
  }
  const json = JSON.parse(raw)
  const list: unknown[] = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : [])
  const ids = list
    .map((m: any) => m?.id)
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
  if (ids.length === 0) throw new Error('接口未返回任何模型')
  return ids
}

/**
 * Kimi 系列（含 K3 / K3.1）的采样参数在服务端固定：temperature 只能为 1，
 * 传 0.7 等自定义值会直接 400。这里统一"不传 temperature"，让服务端用默认值。
 * 同时兼容第三方中转平台返回的带前缀模型 id（如 moonshotai/kimi-k3.1-pro）。
 */
export function usesFixedSampling(account: Account, modelId: string): boolean {
  const id = modelId.toLowerCase()
  return account.providerId === 'kim'
    || /(^|[-_/])(kimi|moonshot)([-_/]|$)/.test(id)
    || /(^|[-_/])k3(\.1)?([-_/]|$)/.test(id)
}

/** K3 / K3.1 的 reasoning_effort 仅支持 low / high / max（Kimi 官方文档 2026-11）。 */
export function normalizeReasoningEffort(
  account: Account, modelId: string,
  effort?: 'minimal' | 'low' | 'medium' | 'high',
): 'minimal' | 'low' | 'medium' | 'high' | 'max' | undefined {
  if (!effort) return undefined
  const id = modelId.toLowerCase()
  const isK3 = /(^|[-_/])k3(\.1)?([-_/]|$)/.test(id) || /3\.1/.test(id)
  if (!isK3 || !usesFixedSampling(account, modelId)) return effort
  // 界面四档 → Kimi 官方三档
  switch (effort) {
    case 'minimal': return 'low'
    case 'medium': return 'high'
    case 'high': return 'max'
    default: return effort
  }
}

/** 识别服务端返回的"固定采样参数"类错误，用于自动重试一次 */
function isTemperatureError(e: unknown): boolean {
  const msg = ((e as Error)?.message ?? String(e ?? '')).toLowerCase()
  return msg.includes('invalid temperature') || msg.includes('invalid_temperature')
    || (/temperature/.test(msg) && /only\s+[\d.]+\s+is\s+allowed/.test(msg))
}

/** 对话：OpenAI 兼容 chat completions（非流式，简化处理） */
export async function callChat(
  account: Account, apiKey: string, messages: { role: string; content: string }[],
  engineId?: string, reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high',
): Promise<ProviderCallResult> {
  try {
    const url = chatUrl(account)
    const model = engineId || account.label
    const body: Record<string, unknown> = { model, messages, stream: false }
    // Kimi K3 系列固定采样参数：不传 temperature，避免 400 invalid temperature
    if (!usesFixedSampling(account, model)) body.temperature = 0.7
    const effort = normalizeReasoningEffort(account, model, reasoningEffort)
    if (effort) body.reasoning_effort = effort

    const request = (payload: Record<string, unknown>) =>
      isDesktopApp() ? invokeApi(url, apiKey, payload) : directFetch(url, apiKey, payload)

    let raw: string
    try {
      raw = await request(body)
    } catch (e) {
      // 动态拉取到的未知模型也可能有固定采样限制：去掉 temperature 自动重试一次
      if ('temperature' in body && isTemperatureError(e)) {
        const retry = { ...body }
        delete retry.temperature
        raw = await request(retry)
      } else throw e
    }
    const json = JSON.parse(raw)
    const text = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? ''
    if (!text) return { ok: false, text: '', error: '接口未返回文本内容，请检查模型名与账户配置' }
    return { ok: true, text }
  } catch (e) {
    return toError(e)
  }
}

/**
 * 从账户备注/名称中提取真实模型 ID。
 * 生图/生视频接口要求 model 是平台模型 ID（如 Kwai-Kolors/Kolors、black-forest-labs/FLUX.1-schnell），
 * 而用户填写的 label / note 常混入分类前缀与中文说明。约定：含 '/' 的 token 视为模型 ID。
 */
export function extractModelId(account: Account): string {
  const candidates: string[] = []
  // note 形如 "[生图型] Kwai-Kolors/Kolors" → 取分类前缀之后的部分
  if (account.note) {
    const cleaned = account.note.replace(/^\[[^\]]+\]\s*/, '')
    cleaned.split(/[\s,，;；]+/).forEach(tok => { if (tok) candidates.push(tok) })
  }
  if (account.label) account.label.split(/[\s,，;；]+/).forEach(tok => { if (tok) candidates.push(tok) })
  // 含 '/' 的最可能是模型 ID（Kolors/Kolors、FLUX.1、Qwen/...）
  const withSlash = candidates.find(t => t.includes('/'))
  return withSlash ?? candidates[0] ?? account.label ?? ''
}

/** 生图：OpenAI 兼容 images generations */
export async function callImage(
  account: Account, apiKey: string, prompt: string,
): Promise<ProviderCallResult> {
  try {
    let base = (account.apiUrl || '').trim().replace(/\/+$/, '')
    if (!base) throw new Error('该账户未填写 API 地址')
    if (!/\/v\d+/.test(base)) base += '/v1'
    const url = `${base}/images/generations`
    const model = extractModelId(account)
    const body = { model, prompt, n: 1, size: '1024x1024', response_format: 'url' }
    const raw = isDesktopApp() ? await invokeApi(url, apiKey, body) : await directFetch(url, apiKey, body)
    const json = JSON.parse(raw)
    const images: string[] = (json.data ?? []).map((d: { url?: string; b64_json?: string }) => d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : '')).filter(Boolean)
    if (images.length === 0) {
      return { ok: false, text: '', error: `接口未返回图片（模型：${model}）。请确认账户名称/备注里填的是真实生图模型 ID，如 Kwai-Kolors/Kolors、black-forest-labs/FLUX.1-schnell、Qwen/Qwen-Image` }
    }
    return { ok: true, text: `已生成 ${images.length} 张图片`, images }
  } catch (e) {
    return toError(e)
  }
}

/** 视频：异步任务制，尽力提交任务并给出引导（多数平台为私有协议，不保证成功） */
export async function callVideo(
  account: Account, apiKey: string, prompt: string,
): Promise<ProviderCallResult> {
  const base = (account.apiUrl || '').trim().replace(/\/+$/, '')
  if (!base) return { ok: false, text: '', error: '该账户未填写 API 地址' }
  // 尝试常见的 OpenAI 兼容视频端点；失败则明确引导官方
  const candidates = [`${base}/v1/videos/generations`, `${base}/v1/video/generations`, `${base}/videos/generations`]
  let lastErr = ''
  const model = extractModelId(account)
  for (const url of candidates) {
    try {
      const body = { model, prompt, duration: 5 }
      const raw = isDesktopApp() ? await invokeApi(url, apiKey, body) : await directFetch(url, apiKey, body)
      const json = JSON.parse(raw)
      const id = json.id ?? json.task_id ?? json.data?.id
      const videoUrl = json.url ?? json.data?.url ?? json.output?.url
      if (videoUrl) return { ok: true, text: '视频已生成', images: [videoUrl] }
      if (id) return { ok: true, text: `视频任务已提交（ID: ${String(id).slice(0, 20)}）。生成需数分钟，结果请到官方平台查看。` }
      lastErr = '接口已响应但未返回任务信息'
    } catch (e) { lastErr = (e as Error).message }
  }
  return {
    ok: false, text: '',
    error: `${account.label} 的视频接口暂未能自动调用（${lastErr.slice(0, 80)}）。这类平台多为私有异步协议，建议到官方页面生成后在此记录。`,
  }
}

/** 统一入口：按分类调用 */
export async function callByCategory(
  account: Account, apiKey: string, category: ModelCategory,
  messages: { role: string; content: string }[],
  engineId?: string, reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high',
): Promise<ProviderCallResult> {
  const userText = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  switch (category) {
    case '生图型': return callImage(account, apiKey, userText)
    case '视频型': return callVideo(account, apiKey, userText)
    default: return callChat(account, apiKey, messages, engineId, reasoningEffort)
  }
}

function toError(e: unknown): ProviderCallResult {
  const err = e as Error & { cors?: boolean }
  const msg = err?.message ?? String(e)
  const cors = err?.cors === true || /cors|failed to fetch|networkerror/i.test(msg)
  return {
    ok: false, text: '',
    cors,
    error: cors
      ? '浏览器直连被跨域策略拦截。请在桌面客户端使用（桌面端走本地代理），或检查平台是否开放 API。'
      : `调用失败：${msg.slice(0, 160)}`,
  }
}
