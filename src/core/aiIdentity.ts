// AI 聊天身份配置：机器人与"我"的头像、名字、音色与回答前缀。
// 关键：这些配置只存本机 localStorage，不进入云同步；同一账号在不同平台互相独立。

export interface AvatarPreset {
  id: string
  emoji: string
  color: string
  label: string
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'spark', emoji: '✨', color: '#6366f1', label: '星光' },
  { id: 'bot', emoji: '🤖', color: '#4f46e5', label: '机器人' },
  { id: 'cat', emoji: '🐱', color: '#f59e0b', label: '猫咪' },
  { id: 'fox', emoji: '🦊', color: '#f97316', label: '狐狸' },
  { id: 'panda', emoji: '🐼', color: '#10b981', label: '熊猫' },
  { id: 'rabbit', emoji: '🐰', color: '#ec4899', label: '兔子' },
  { id: 'star', emoji: '⭐', color: '#8b5cf6', label: '星星' },
  { id: 'moon', emoji: '🌙', color: '#3b82f6', label: '月亮' },
  { id: 'sun', emoji: '🌞', color: '#ef4444', label: '太阳' },
  { id: 'coffee', emoji: '☕', color: '#92400e', label: '咖啡' },
  { id: 'book', emoji: '📚', color: '#0ea5e9', label: '书本' },
  { id: 'gem', emoji: '💎', color: '#06b6d4', label: '宝石' },
]

export interface BotProfile {
  avatarId: string
  name: string
  voiceURI: string | null
}

export interface UserProfile {
  avatarId: string
  nickname: string
  phrase: string
}

const BOT_KEY = 'acm.ai.botProfile.v1'
const USER_KEY = 'acm.ai.userProfile.v1'

export const DEFAULT_BOT: BotProfile = { avatarId: 'spark', name: 'AI 助手', voiceURI: null }
export const DEFAULT_USER: UserProfile = { avatarId: 'user', nickname: '我', phrase: '' }

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { ...fallback }
    return { ...fallback, ...JSON.parse(raw) }
  } catch { return { ...fallback } }
}

function save<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 忽略 */ }
}

export function loadBotProfile(): BotProfile { return load(BOT_KEY, DEFAULT_BOT) }
export function saveBotProfile(p: BotProfile): void { save(BOT_KEY, p) }
export function loadUserProfile(): UserProfile { return load(USER_KEY, DEFAULT_USER) }
export function saveUserProfile(p: UserProfile): void { save(USER_KEY, p) }

export function getAvatar(id: string): AvatarPreset {
  return AVATAR_PRESETS.find(a => a.id === id)
    ?? (id === 'user' ? { id: 'user', emoji: '👤', color: '#64748b', label: '我' } : AVATAR_PRESETS[0])
}

/** 每次 AI 回答前的固定前缀：昵称 + 自定义短语。未设置时返回空串。 */
export function replyPrefix(): string {
  const u = loadUserProfile()
  const parts = [u.nickname.trim(), u.phrase.trim()].filter(Boolean)
  if (!parts.length) return ''
  return `${parts.join('：')}：`
}

export function withReplyPrefix(text: string): string {
  const p = replyPrefix()
  if (!p || text.startsWith(p)) return text
  return `${p}${text}`
}
