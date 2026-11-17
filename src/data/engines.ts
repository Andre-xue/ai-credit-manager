// 主流模型引擎目录（内置参考数据）。
// 数据说明：token 倍率为相对参考值（用于按消耗从低到高排序），非实时价格；
// 真实计费请以各平台官方账单为准。引擎 id 为该平台 OpenAI 兼容接口的 model 参数。
// 排序：倍率升序；同倍率按名称。

export interface Engine {
  /** 该平台 API 的 model 参数值 */
  id: string
  /** 展示名 */
  name: string
  /** 相对 token 消耗倍率（参考） */
  multiplier: number
  /** 是否支持推理等级 */
  reasoning?: boolean
  /** 标签：折扣/订阅优先等（仅展示，参考） */
  tag?: '夜间折扣' | '订阅优先' | '新模型' | '高性价比'
  /** 是否需要订阅才能用 */
  subscription?: boolean
}

/** 按 providerId 索引的引擎目录；未收录的平台返回空数组，UI 提示手动输入引擎名 */
export const ENGINE_CATALOG: Record<string, Engine[]> = {
  // Moonshot Kimi
  kim: [
    { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', multiplier: 0.42, reasoning: true, tag: '新模型' },
    { id: 'kimi-k2', name: 'Kimi K2', multiplier: 0.28 },
    { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K', multiplier: 1.20 },
    { id: 'moonshot-v1-32k', name: 'Moonshot V1 32K', multiplier: 0.60 },
    { id: 'moonshot-v1-8k', name: 'Moonshot V1 8K', multiplier: 0.18, tag: '高性价比' },
  ],
  // 通义千问
  qwen: [
    { id: 'qwen3-235b-a22b', name: 'Qwen3 235B A22B', multiplier: 0.55, reasoning: true },
    { id: 'qwen3-30b-a3b', name: 'Qwen3 30B A3B', multiplier: 0.15, tag: '高性价比' },
    { id: 'qwen-plus', name: 'Qwen Plus', multiplier: 0.40 },
    { id: 'qwen-turbo', name: 'Qwen Turbo', multiplier: 0.08, tag: '高性价比' },
    { id: 'qwen-max', name: 'Qwen Max', multiplier: 1.00 },
    { id: 'qwen-long', name: 'Qwen Long', multiplier: 0.30 },
  ],
  // DeepSeek
  deepseek: [
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', multiplier: 0.11, tag: '夜间折扣' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', multiplier: 0.69, reasoning: true },
    { id: 'deepseek-chat', name: 'DeepSeek Chat', multiplier: 0.27 },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', multiplier: 0.50, reasoning: true },
  ],
  // OpenAI
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o mini', multiplier: 0.15, tag: '高性价比' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', multiplier: 0.20 },
    { id: 'gpt-4o', name: 'GPT-4o', multiplier: 0.75 },
    { id: 'gpt-4.1', name: 'GPT-4.1', multiplier: 0.90 },
    { id: 'o4-mini', name: 'o4-mini', multiplier: 0.60, reasoning: true },
    { id: 'o3', name: 'o3', multiplier: 1.50, reasoning: true },
  ],
  // 智谱 GLM
  glm: [
    { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', multiplier: 0.08, tag: '高性价比' },
    { id: 'glm-5.3', name: 'GLM-5.3', multiplier: 0.69, subscription: true, tag: '订阅优先' },
    { id: 'glm-5.2', name: 'GLM-5.2', multiplier: 0.79, tag: '夜间折扣' },
    { id: 'glm-4-plus', name: 'GLM-4 Plus', multiplier: 0.50 },
    { id: 'glm-4-air', name: 'GLM-4 Air', multiplier: 0.20 },
  ],
  // Anthropic Claude
  anthropic: [
    { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', multiplier: 0.25, tag: '高性价比' },
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', multiplier: 0.90, reasoning: true },
    { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', multiplier: 0.85, reasoning: true },
    { id: 'claude-opus-4', name: 'Claude Opus 4', multiplier: 1.50, reasoning: true },
  ],
  // Google Gemini
  gemini: [
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', multiplier: 0.06, tag: '高性价比' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', multiplier: 0.15, reasoning: true },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', multiplier: 0.80, reasoning: true },
  ],
  // MiniMax
  minimax: [
    { id: 'MiniMax-Text-01', name: 'MiniMax Text 01', multiplier: 0.35 },
    { id: 'abab6.5s-chat', name: 'abab6.5s Chat', multiplier: 0.20 },
    { id: 'MiniMax-M1', name: 'MiniMax M1', multiplier: 0.60, reasoning: true, tag: '新模型' },
  ],
  // 阶跃星辰
  stepfun: [
    { id: 'step-3-mini', name: 'Step 3 Mini', multiplier: 0.12, tag: '高性价比' },
    { id: 'step-3', name: 'Step 3', multiplier: 0.55, reasoning: true },
    { id: 'step-2', name: 'Step 2', multiplier: 0.40 },
  ],
  // 百川
  baichuan: [
    { id: 'Baichuan4-Turbo', name: 'Baichuan4 Turbo', multiplier: 0.18, tag: '高性价比' },
    { id: 'Baichuan4', name: 'Baichuan4', multiplier: 0.45 },
    { id: 'Baichuan3-Turbo', name: 'Baichuan3 Turbo', multiplier: 0.10 },
  ],
  // 豆包 / 火山方舟
  doubao: [
    { id: 'doubao-lite', name: '豆包 Lite', multiplier: 0.08, tag: '高性价比' },
    { id: 'doubao-pro', name: '豆包 Pro', multiplier: 0.45 },
    { id: 'doubao-thinking', name: '豆包 Thinking', multiplier: 0.60, reasoning: true },
  ],
  // xAI Grok
  xai: [
    { id: 'grok-3-mini', name: 'Grok 3 Mini', multiplier: 0.20, reasoning: true },
    { id: 'grok-3', name: 'Grok 3', multiplier: 0.95, reasoning: true },
  ],
  // Mistral
  mistral: [
    { id: 'mistral-small', name: 'Mistral Small', multiplier: 0.10, tag: '高性价比' },
    { id: 'mistral-medium', name: 'Mistral Medium', multiplier: 0.40 },
    { id: 'mistral-large', name: 'Mistral Large', multiplier: 0.85, reasoning: true },
  ],
}

/** 取某平台的引擎（按倍率升序）。未收录返回空 */
export function enginesFor(providerId: string): Engine[] {
  const list = ENGINE_CATALOG[providerId] ?? []
  return [...list].sort((a, b) => a.multiplier - b.multiplier)
}

/** 平台是否有内置引擎目录 */
export function hasCatalog(providerId: string): boolean {
  return (ENGINE_CATALOG[providerId]?.length ?? 0) > 0
}

/** 推理等级：界面四档 → SDK reasoning_effort */
export type ReasoningLevel = 'Off' | 'Low' | 'High' | 'Max'
export const REASONING_LEVELS: ReasoningLevel[] = ['Off', 'Low', 'High', 'Max']
export function toReasoningEffort(level: ReasoningLevel): 'minimal' | 'low' | 'medium' | 'high' | undefined {
  switch (level) {
    case 'Off': return undefined
    case 'Low': return 'minimal'
    case 'High': return 'medium'
    case 'Max': return 'high'
  }
}
