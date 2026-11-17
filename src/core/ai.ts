// AI 助手核心：基于云平台免密钥 LLM（stream: true 流式输出）。
// 对话历史仅存本机 localStorage，不纳入账单数据的云同步——聊天是私密且高频的内容，
// 与额度数据分离可避免同步载荷膨胀，也符合用户对对话隐私的预期。

import { cloud } from './cloud'

const HISTORY_KEY = 'acm.ai.history.v1'
const CONV_KEY = 'acm.ai.conversationId'
const MODEL_KEY = 'acm.ai.model'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  at: number
}

export interface AiModel {
  id: string
  name: string
  disabled?: boolean
}

/** 应用 Self-owned 系统提示：始终把助手绑定在「AI 积分管家」的业务语境内。 */
export const SYSTEM_PROMPT = [
  '你是「AI 积分管家」App 内置的智能助手。这个 App 帮助用户统一管理各家 AI 平台的积分、额度、用量和 API Key，并提供签到提醒、福利追踪、费用预估等功能。',
  '回答要求：简洁、准确、可执行；优先用中文；涉及操作步骤时给出清晰编号；不要编造具体产品的价格、规则或日期，不确定时明确说明并建议用户到官方渠道核实。',
  '如果用户询问额度管理、签到、API Key 安全、费用控制等话题，结合这个 App 的功能给出建议；与产品无关的问题也可以正常回答，但保持礼貌与克制。',
].join('\n')

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** 拉取可用模型列表（过滤 disabled），空列表交给 UI 处理 */
export async function listModels(): Promise<AiModel[]> {
  const models = await cloud.llm.models.list()
  return models.filter(m => m.disabled !== true).map(m => ({ id: m.id, name: m.name ?? m.id }))
}

export function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') : []
  } catch { return [] }
}

export function saveHistory(messages: ChatMessage[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-100))) } catch { /* 忽略 */ }
}

/** 获取/新建会话 ID（应用自管，用于请求关联；不承诺服务端记忆历史） */
export function getConversationId(): string {
  try {
    let id = localStorage.getItem(CONV_KEY)
    if (!id) { id = uid(); localStorage.setItem(CONV_KEY, id) }
    return id
  } catch { return uid() }
}

export function rotateConversationId(): string {
  const id = uid()
  try { localStorage.setItem(CONV_KEY, id) } catch { /* 忽略 */ }
  return id
}

export function loadModel(): string | null {
  try { return localStorage.getItem(MODEL_KEY) } catch { return null }
}

export function saveModel(id: string): void {
  try { localStorage.setItem(MODEL_KEY, id) } catch { /* 忽略 */ }
}

/**
 * 流式发送消息。onDelta 增量回调用于实时渲染；返回完整回复文本。
 * 抛出的错误由 UI 捕获并按类型提示（未登录/额度不足/网络超时等）。
 */
export async function streamChat(
  model: string,
  history: ChatMessage[],
  userText: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  // 仅把最近的对话作为上下文（系统消息始终在最前）：
  // 取最近 20 条，控制单次请求体积；conversationId 保持关联。
  const context = history.slice(-20).map(m => ({
    role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: m.content,
  }))
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    ...context,
    { role: 'user' as const, content: userText },
  ]

  let answer = ''
  for await (const chunk of cloud.llm.chat.completions.create({
    model,
    messages,
    stream: true,
    conversationId: getConversationId(),
    signal,
  })) {
    const delta = chunk.choices?.[0]?.delta
    if (delta?.content) {
      answer += delta.content
      onDelta(delta.content)
    }
  }
  return answer
}

/** 把 SDK/网络错误转成用户可读的中文提示 */
export function friendlyAiError(error: unknown): string {
  const e = error as { name?: string; message?: string; code?: string }
  if (e?.name === 'AbortError') return '已停止生成'
  const msg = e?.message ?? String(error ?? '')
  const low = msg.toLowerCase()
  if (low.includes('quota') || low.includes('credit') || low.includes('额度')) return '模型额度不足，请稍后再试'
  if (low.includes('401') || low.includes('unauthorized') || low.includes('sign in')) return '请先登录后再使用 AI 助手'
  if (low.includes('timeout') || low.includes('timed out') || low.includes('network')) return '网络连接超时，请重试'
  if (low.includes('content_filter') || low.includes('blocked')) return '内容未通过安全检查，请换个说法'
  return `调用失败：${msg.slice(0, 120)}`
}
