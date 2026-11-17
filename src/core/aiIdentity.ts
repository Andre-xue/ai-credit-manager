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
  avatarDataUrl?: string
  name: string
  voiceURI: string | null
}

export interface UserProfile {
  avatarId: string
  avatarDataUrl?: string
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

/** 把用户选择的图片等比缩放到正方形画布（不拉伸变形），返回压缩后的 data URL */
export function resizeAvatarImage(file: File, max = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error('读取图片失败'))
    fr.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('图片格式不支持'))
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = max; canvas.height = max
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('画布不可用')); return }
        ctx.fillStyle = '#eef2ff'
        ctx.fillRect(0, 0, max, max)
        const scale = Math.min(max / img.width, max / img.height)
        const w = img.width * scale, h = img.height * scale
        ctx.drawImage(img, (max - w) / 2, (max - h) / 2, w, h)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = String(fr.result)
    }
    fr.readAsDataURL(file)
  })
}

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

/** 按用户设置的昵称/短语与 AI 名字生成动态系统提示，让回复自然带称呼而不是硬拼前缀。 */
export function buildIdentitySystemPrompt(bot: BotProfile, user: UserProfile, isFirstReply: boolean): string {
  const nickname = user.nickname.trim() || '朋友'
  const phrase = user.phrase.trim()
  const botName = bot.name.trim() || 'AI 助手'
  const greeting = `您好，${nickname}${phrase ? `，${phrase}` : ''}！`
  const intro = `我是一位叫“${botName}”的AI小助手，作为一位顶级AI的我，可以陪你聊天逗趣，生成图片视频；可以帮您解决问题；还可以帮您查看总结该应用下的所有数据；那么请讲出您的问题，由我“${botName}”AI助手帮您解决吧！`
  return [
    `你是「AI 积分管家」App 内置的智能助手，名字叫“${botName}”。用户昵称是“${nickname}”${phrase ? `，用户自定义的称呼/短语是“${phrase}”` : ''}。`,
    '回复要求：简洁、准确、可执行；优先用中文；不要编造具体产品价格、规则或日期，不确定时明确说明并建议到官方渠道核实。',
    `每次回复的第一句必须使用这个问候语：“${greeting}”，不要用“${nickname}：”这种机械前缀。`,
    isFirstReply ? `首次回复在问候语之后紧接着自我介绍：“${intro}”` : '后续回复不要再重复完整自我介绍，直接回答用户问题。',
    '涉及额度管理、签到、API Key 安全、费用控制时结合本 App 功能给出建议；其他问题也可以正常回答。',
  ].join('\n')
}

export function withReplyPrefix(text: string): string {
  const p = replyPrefix()
  if (!p || text.startsWith(p)) return text
  return `${p}${text}`
}
