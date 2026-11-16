// 统一数据模型 —— 各端（Web / 桌面 / 安卓 / 小程序）共享的核心类型
// 设计原则：本地优先、只读官方接口、跳转由本人操作、不模拟登录、不自动领取

export type CreditUnit =
  | 'credit'      // 通用积分
  | 'token'       // Token 额度
  | 'request'     // 请求次数
  | 'currency'    // 货币额度（美元/人民币）
  | 'day'         // 天数（订阅剩余）

export type AccountMode =
  | 'api'         // 通过官方只读 API 查询用量
  | 'manual'      // 手动录入额度（无公开 API 的平台）
  | 'subscription'// 订阅制，只记录到期日

/** 平台目录条目（内置，不含任何用户凭证） */
export interface ProviderDefinition {
  id: string
  name: string
  shortName: string
  category: 'llm' | 'code' | 'image' | 'search' | 'voice' | 'design' | 'other'
  officialUrl: string
  /** 官方用量/账单页面，用于跳转（本人登录后查看） */
  usageUrl: string
  /** 官方签到/福利页面（如有），仅跳转，不自动操作 */
  checkinUrl?: string
  /** 官方 API base_url（自动填充到账户的链接地址） */
  apiBaseUrl?: string
  color: string
  initials: string
  /** 该平台账户支持的数据获取方式 */
  modes: AccountMode[]
  /** 说明文字 */
  note?: string
}

/** 用户账户（本地存储，凭证加密） */
export interface Account {
  id: string
  providerId: string
  label: string
  mode: AccountMode
  /** 加密后的 API Key（仅 api 模式），密文；永不上传 */
  encryptedKey?: string
  /** 密钥指纹（用于识别是否已配置，不泄露原文） */
  keyFingerprint?: string
  /** API 链接地址（用户自填，如 https://api.deepseek.com/v1） */
  apiUrl?: string
  /** 备注（用途） */
  note?: string
  createdAt: string
  updatedAt: string
}

/** 额度/积分快照 */
export interface QuotaSnapshot {
  id: string
  accountId: string
  unit: CreditUnit
  total: number
  used: number
  /** 重置或到期时间 ISO 字符串 */
  resetAt?: string
  capturedAt: string
  source: 'api' | 'manual' | 'import'
}

/** 签到记录（只记录「提醒 + 本人已跳转」，不执行自动签到） */
export interface CheckinRecord {
  id: string
  providerId: string
  accountId?: string
  /** 本地日期 YYYY-MM-DD */
  date: string
  /** 本人跳转到官方页面后手动标记完成 */
  done: boolean
  rewarded?: boolean
  note?: string
}

/** 用量事件（用于费用趋势） */
export interface UsageEvent {
  id: string
  accountId: string
  date: string          // YYYY-MM-DD
  inputTokens: number
  outputTokens: number
  estimatedCost: number // 估算费用（货币单位）
  model?: string
}

/** 福利领取标记（仅记录本人已跳转/领取，不执行任何自动操作） */
export interface BenefitMark {
  benefitId: string
  /** 本地日期 YYYY-MM-DD；daily 类型按日记录，其他类型只记首次 */
  date: string
}

/** 应用整体状态 */
export interface AppState {
  version: number
  accounts: Account[]
  quotas: QuotaSnapshot[]
  checkins: CheckinRecord[]
  usage: UsageEvent[]
  benefitMarks: BenefitMark[]
  settings: AppSettings
}

export interface AppSettings {
  /** 本地加密主密码校验位（不存明文） */
  vaultInitialized: boolean
  /** 每月预算（货币单位），用于预警 */
  monthlyBudget: number
  /** 签到提醒开关 */
  checkinReminder: boolean
  /** 额度耗尽预警阈值（天）：低于此值计入"即将耗尽" */
  alertDays: number
  /** 新账户录入额度时的默认单位 */
  defaultUnit: CreditUnit
  /** 备份提醒开关（超过 7 天未导出时提示） */
  backupReminder: boolean
  /** 系统通知开关（签到与额度告警） */
  systemNotify: boolean
  /** 免打扰开始/结束 "HH:mm"，空表示关闭 */
  quietStart: string
  quietEnd: string
  /** 各平台每单位额度价值（元），key 为 providerId，'default' 为兜底；用户可自行校准 */
  unitPrices: Record<string, number>
  /** 上次导出备份时间 ISO */
  lastExportAt?: string
  /** 上次同步时间（预留云同步） */
  lastSyncAt?: string
}

/** 数据源适配器接口 —— 插件化核心 */
export interface DataSourceAdapter {
  providerId: string
  mode: AccountMode
  /** 是否配置了可用的官方只读 API */
  supported: boolean
  /** 拉取用量（仅 api 模式且用户显式触发）；失败时抛出可读错误 */
  fetchUsage?(apiKey: string): Promise<{
    used: number
    total?: number
    unit: CreditUnit
    events?: Array<{ date: string; inputTokens: number; outputTokens: number; model?: string }>
  }>
  /** 官方用量页，跳转用 */
  usageUrl: string
}

/** 汇总后的看板视图模型 */
export interface AccountView {
  account: Account
  provider: ProviderDefinition
  quota?: QuotaSnapshot
  usagePercent: number
  daysUntilReset?: number
  checkinDoneToday: boolean
  /** 用量耗尽预测 */
  forecast?: import('./forecast').Forecast
}
