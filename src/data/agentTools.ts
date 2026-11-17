// AI Agent 工具目录 —— 国内外分类 + 官方签到状态
// 数据来源：各平台官方站点与公开活动规则（2026-11 核实）。
// 说明：
// - canCheckin 仅标记「官方确有每日签到 / 登录领积分」机制，免费层 / 试用 / 每日免费额度不算。
// - 签到入口在客户端内的，downloadUrl 指向官方下载页，checkinTip 写明入口位置。
// - 所有链接均为官方域名；工具只做提醒与跳转，不模拟登录、不自动领取。
// - 图标为各平台官方 logo，已下载到本地 public/agent-icons，离线可用。

export type AgentRegion = 'cn' | 'global'
export type AgentCategory =
  | '综合办公' | '对话助手' | '编程开发' | 'AI 搜索' | '图像设计' | '视频创作' | 'Agent 平台'

export interface AgentTool {
  id: string
  name: string        // 中文名
  nameEn: string      // 英文名
  region: AgentRegion
  category: AgentCategory
  canCheckin: boolean
  /** 官方下载/直达链接（https 官方域名） */
  downloadUrl: string
  /** 签到或福利入口链接（可与 downloadUrl 相同，入口在客户端内时指向官网） */
  checkinUrl?: string
  /** 签到说明：入口位置与奖励规则 */
  checkinTip?: string
  /** 无签到时的福利说明 */
  benefitTip?: string
  /** 本地官方 logo 路径 */
  icon: string
  /** 品牌色，用于卡片图标底 */
  color: string
  /** 一句话定位 */
  desc: string
}

const icon = (id: string) => `/agent-icons/${id}.png`

export const AGENT_TOOLS: AgentTool[] = [
  // ==================== 国内 · 可签到 ====================
  {
    id: 'workbuddy', name: 'WorkBuddy', nameEn: 'WorkBuddy', region: 'cn', category: '综合办公', canCheckin: true,
    downloadUrl: 'https://www.workbuddy.cn/', checkinUrl: 'https://www.workbuddy.cn/',
    checkinTip: '客户端左下角头像 →「Buddy 加油站」每日签到，每日 100 积分，连签 7/14/28 天有额外奖励；积分当月有效，手机端无入口。',
    icon: icon('workbuddy'), color: '#00b96b', desc: '腾讯出品的 AI Agent 办公工作台，本地文件批处理、定时任务、手机远程控电脑。',
  },
  {
    id: 'doubao', name: '豆包', nameEn: 'Doubao', region: 'cn', category: '对话助手', canCheckin: true,
    downloadUrl: 'https://www.doubao.com/', checkinUrl: 'https://www.doubao.com/',
    checkinTip: '电脑版左下角签到窗，或头像 →「免费用豆包」；每日 200 额度、周一翻倍，30 天累计约 8800；额度 30 天有效，手机端无入口。',
    icon: icon('doubao'), color: '#f04142', desc: '字节跳动的 AI 助手，对话、写作、绘图、PPT 一站式，电脑版「豆包工作」可操作本地文件。',
  },
  {
    id: 'yuanbao', name: '腾讯元宝', nameEn: 'Tencent Yuanbao', region: 'cn', category: '对话助手', canCheckin: true,
    downloadUrl: 'https://yuanbao.tencent.com/', checkinUrl: 'https://yuanbao.tencent.com/',
    checkinTip: '手机 App →「福利中心」每日签到攒积分，可兑话费券、视频会员等；积分有有效期，以 App 实时页面为准。',
    icon: icon('yuanbao'), color: '#4f6bfe', desc: '腾讯旗下 AI 助手，全功能免费，支持文档处理、AI 搜索与多模态生成。',
  },
  {
    id: 'coze', name: '扣子', nameEn: 'Coze', region: 'cn', category: 'Agent 平台', canCheckin: true,
    downloadUrl: 'https://www.coze.cn/', checkinUrl: 'https://www.coze.cn/',
    checkinTip: '每日登录领活动积分（约 1500 点，7 天有效），用于 Bot 对话与工作流调用；规则以官网活动页为准。',
    icon: icon('coze'), color: '#1a1a1a', desc: '字节跳动的 AI Agent 搭建平台，工作流、插件、知识库一应俱全，支持发布到飞书/微信。',
  },
  {
    id: 'zhipu', name: '智谱清言', nameEn: 'ChatGLM', region: 'cn', category: '对话助手', canCheckin: true,
    downloadUrl: 'https://chatglm.cn/', checkinUrl: 'https://chatglm.cn/',
    checkinTip: '网页/App 每日登录领积分，连续登录有额外奖励；积分规则以账户页实时显示为准。',
    icon: icon('zhipu'), color: '#3859ff', desc: '智谱 AI 的对话助手，基于 GLM 模型，支持长文本、文件解析与智能体。',
  },
  {
    id: 'minimax', name: 'MiniMax', nameEn: 'MiniMax', region: 'cn', category: '对话助手', canCheckin: true,
    downloadUrl: 'https://www.minimaxi.com/', checkinUrl: 'https://www.minimaxi.com/',
    checkinTip: '网页/App 账户菜单 →「每日签到」，每日约 400 积分，第 4/7 天有额外奖励；积分有效期约 30 天。',
    icon: icon('minimax'), color: '#0f172a', desc: '稀宇科技旗下 AI 助手，海螺视频、语音合成与文本模型一体的创作工具。',
  },
  {
    id: 'trae', name: 'Trae', nameEn: 'Trae', region: 'cn', category: '编程开发', canCheckin: true,
    downloadUrl: 'https://www.trae.cn/', checkinUrl: 'https://www.trae.cn/',
    checkinTip: '免费版账户菜单 →「签到」，每日约 100 积分；积分与规则以客户端账户页为准。',
    icon: icon('trae'), color: '#3b82f6', desc: '字节跳动的 AI 原生 IDE，Builder 模式可从自然语言直接生成完整项目。',
  },
  {
    id: 'qoder', name: '通义灵码 / Qoder', nameEn: 'Qoder', region: 'cn', category: '编程开发', canCheckin: true,
    downloadUrl: 'https://qoder.com/', checkinUrl: 'https://qoder.com/',
    checkinTip: '桌面客户端每日约 100 Credits，学生教师另有额度；具体以客户端账户页为准。',
    icon: icon('qoder'), color: '#615ced', desc: '阿里旗下 AI 编程工具，代码补全、Agent 模式与仓库级理解。',
  },
  {
    id: 'metaso', name: '秘塔 AI 搜索', nameEn: 'Metaso', region: 'cn', category: 'AI 搜索', canCheckin: true,
    downloadUrl: 'https://metaso.cn/', checkinUrl: 'https://metaso.cn/',
    checkinTip: '每日登录领约 500 积分，仅当日有效；深度研究约消耗 20–30 积分/次。规则以官网为准。',
    icon: icon('metaso'), color: '#1480f5', desc: '以深度搜索和学术研究著称的 AI 搜索引擎，自动整理来源生成综述。',
  },
  {
    id: 'yiyan', name: '文心一言', nameEn: 'ERNIE Bot', region: 'cn', category: '对话助手', canCheckin: true,
    downloadUrl: 'https://yiyan.baidu.com/', checkinUrl: 'https://yiyan.baidu.com/',
    checkinTip: 'App「我的」→ 每日签到，或网页头像菜单 → 签到；按连续天数发放充电值，规则以官方页面为准。',
    icon: icon('yiyan'), color: '#4e6ef2', desc: '百度的 AI 助手，基于文心大模型，支持多模态问答与插件生态。',
  },

  // ==================== 国内 · 无签到 ====================
  {
    id: 'kimi', name: 'Kimi', nameEn: 'Kimi', region: 'cn', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://www.kimi.com/', icon: icon('kimi'), color: '#1a1a1a',
    benefitTip: '基础对话与长文档阅读免费；Kimi Agent 每月约 6 次免费任务。无每日签到。',
    desc: '月之暗面出品，长文本处理见长，支持超长文档阅读与深度研究。',
  },
  {
    id: 'deepseek', name: 'DeepSeek', nameEn: 'DeepSeek', region: 'cn', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://www.deepseek.com/', icon: icon('deepseek'), color: '#4d6bfe',
    benefitTip: '网页版与 App 基础对话免费，API 按量计费。无每日签到。',
    desc: '深度求索的推理大模型，代码与数学能力强，API 价格亲民。',
  },
  {
    id: 'tongyi', name: '通义千问', nameEn: 'Qwen', region: 'cn', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://tongyi.aliyun.com/', icon: icon('tongyi'), color: '#615ced',
    benefitTip: '个人版对话、文档解析基本不限量，生视频每日约 15 次。无每日签到。',
    desc: '阿里云的大模型助手，表格清洗、文档解析与 Qwen Code 编程一应俱全。',
  },
  {
    id: 'kling', name: '可灵', nameEn: 'Kling', region: 'cn', category: '视频创作', canCheckin: false,
    downloadUrl: 'https://klingai.kuaishou.com/', icon: icon('kling'), color: '#ff6600',
    benefitTip: '每日赠送免费灵感值用于生成，属每日额度而非签到；以官网账户页为准。',
    desc: '快手推出的 AI 视频生成工具，支持文生视频、图生视频与运镜控制。',
  },
  {
    id: 'hailuo', name: '海螺 AI', nameEn: 'Hailuo AI', region: 'cn', category: '视频创作', canCheckin: false,
    downloadUrl: 'https://hailuoai.com/', icon: icon('hailuo'), color: '#2563eb',
    benefitTip: '提供每日免费生成额度，属免费层而非签到；具体以官网为准。',
    desc: 'MiniMax 旗下视频与语音创作平台，图生视频效果出色。',
  },
  {
    id: 'nami', name: '纳米 AI 搜索', nameEn: 'Nami AI', region: 'cn', category: 'AI 搜索', canCheckin: false,
    downloadUrl: 'https://www.n.cn/', icon: icon('nami'), color: '#e11d48',
    benefitTip: '基础搜索免费使用，多智能体协作需会员。无每日签到。',
    desc: '360 推出的 AI 搜索，支持多智能体协同完成复杂调研任务。',
  },
  {
    id: 'tiangong', name: '天工 AI', nameEn: 'Tiangong AI', region: 'cn', category: '综合办公', canCheckin: false,
    downloadUrl: 'https://www.tiangong.cn/', icon: icon('tiangong'), color: '#7c3aed',
    benefitTip: '基础对话与搜索免费，深度研究按次计费。无每日签到。',
    desc: '昆仑万维的 AI 助手，擅长搜索、写作、PPT 与音乐生成。',
  },
  {
    id: 'jimeng', name: '即梦', nameEn: 'Jimeng', region: 'cn', category: '图像设计', canCheckin: false,
    downloadUrl: 'https://jimeng.jianying.com/', icon: icon('jimeng'), color: '#ec4899',
    benefitTip: '每日赠送免费积分用于生图/生视频，属每日额度而非签到；以官方页面为准。',
    desc: '字节跳动旗下创作工具，AI 绘画、视频生成与数字人一站式。',
  },

  // ==================== 海外 · 可签到 ====================
  {
    id: 'genspark', name: 'Genspark', nameEn: 'Genspark', region: 'global', category: '综合办公', canCheckin: true,
    downloadUrl: 'https://www.genspark.ai/', checkinUrl: 'https://www.genspark.ai/',
    checkinTip: '免费版每日 100 积分，邀请好友再得积分；登录后自动发放，规则以官网为准。',
    icon: icon('genspark'), color: '#111827', desc: '一站式 AI 工作台，多模型对话、深度研究、文档与幻灯片生成。',
  },
  {
    id: 'poe', name: 'Poe', nameEn: 'Poe', region: 'global', category: '对话助手', canCheckin: true,
    downloadUrl: 'https://poe.com/', checkinUrl: 'https://poe.com/',
    checkinTip: '免费用户每日 300 compute points，登录自动发放；额度近年已缩减，以官网为准。',
    icon: icon('poe'), color: '#0f172a', desc: 'Quora 旗下 AI 聚合平台，一个入口切换 GPT、Claude、Gemini 等主流模型。',
  },
  {
    id: 'monica', name: 'Monica', nameEn: 'Monica', region: 'global', category: 'AI 搜索', canCheckin: true,
    downloadUrl: 'https://monica.im/', checkinUrl: 'https://monica.im/',
    checkinTip: '免费版每日约 40 次基础查询，登录领取；高级查询与 Deep Research 次数有限。',
    icon: icon('monica'), color: '#2563eb', desc: '浏览器 AI 助手插件，侧边栏一键总结网页、PDF、YouTube 与深度搜索。',
  },
  {
    id: 'anygen', name: 'AnyGen', nameEn: 'AnyGen', region: 'global', category: '综合办公', canCheckin: true,
    downloadUrl: 'https://www.anygen.io/', checkinUrl: 'https://www.anygen.io/',
    checkinTip: '每日登录领 200 积分，可累积不清零；邀请好友每人 1000 积分。规则以官网为准。',
    icon: icon('anygen'), color: '#0ea5e9', desc: '字节海外版交付型 Agent，擅长 PPT、文档、数据分析与网页生成。',
  },
  {
    id: 'manus', name: 'Manus', nameEn: 'Manus', region: 'global', category: 'Agent 平台', canCheckin: true,
    downloadUrl: 'https://manus.im/', checkinUrl: 'https://manus.im/',
    checkinTip: '所有用户每日可免费执行一项任务（约 300 积分），UTC 0 点重置；注册一次性赠 1000 积分。属每日任务额度，非手动签到按钮。',
    icon: icon('manus'), color: '#111827', desc: '通用型 AI Agent，自动拆解任务、调用工具并交付完整成果。',
  },

  // ==================== 海外 · 无签到 ====================
  {
    id: 'chatgpt', name: 'ChatGPT', nameEn: 'ChatGPT', region: 'global', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://chatgpt.com/', icon: icon('chatgpt'), color: '#10a37f',
    benefitTip: '免费用户有限次调用模型，达上限自动降级；图像生成每日约 2–3 张。无每日签到。',
    desc: 'OpenAI 的旗舰助手，对话、数据分析、图像生成与深度研究。',
  },
  {
    id: 'claude', name: 'Claude', nameEn: 'Claude', region: 'global', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://claude.ai/', icon: icon('claude'), color: '#d97757',
    benefitTip: '免费版按用量限额使用，无每日签到；Pro 订阅解锁更高额度。',
    desc: 'Anthropic 的 AI 助手，长文本与代码能力出色，支持 Projects 与 artifacts。',
  },
  {
    id: 'gemini', name: 'Gemini', nameEn: 'Google Gemini', region: 'global', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://gemini.google.com/', icon: icon('gemini'), color: '#4285f4',
    benefitTip: 'Flash 模式文本对话基本不限量，Pro 每日有限次，Deep Research 每月约 5 份。无签到。',
    desc: 'Google 的多模态 AI 助手，深度集成 Gmail、Drive 与搜索。',
  },
  {
    id: 'copilot', name: 'Microsoft Copilot', nameEn: 'Microsoft Copilot', region: 'global', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://copilot.microsoft.com/', icon: icon('copilot'), color: '#0f6cbd',
    benefitTip: '免费版有限次对话与图像生成，集成 Bing 搜索。无每日签到。',
    desc: '微软的 AI 助手，深度嵌入 Windows、Office 与 Edge 浏览器。',
  },
  {
    id: 'github-copilot', name: 'GitHub Copilot', nameEn: 'GitHub Copilot', region: 'global', category: '编程开发', canCheckin: false,
    downloadUrl: 'https://github.com/features/copilot', icon: icon('github-copilot'), color: '#24292f',
    benefitTip: '个人用户每月有免费补全与对话额度，超出需订阅。无每日签到。',
    desc: 'GitHub 的 AI 编程助手，代码补全、聊天与 Agent 模式。',
  },
  {
    id: 'cursor', name: 'Cursor', nameEn: 'Cursor', region: 'global', category: '编程开发', canCheckin: false,
    downloadUrl: 'https://cursor.com/', icon: icon('cursor'), color: '#111827',
    benefitTip: '免费版有有限次高级请求额度，属免费层而非签到。',
    desc: 'AI 原生代码编辑器，Tab 补全、Composer 多文件编辑与 Agent 模式。',
  },
  {
    id: 'grok', name: 'Grok', nameEn: 'Grok', region: 'global', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://grok.com/', icon: icon('grok'), color: '#1a1a1a',
    benefitTip: '免费版有限次请求，实时接入 X 平台信息。无每日签到。',
    desc: 'xAI 旗下助手，擅长实时资讯与幽默风格对话。',
  },
  {
    id: 'perplexity', name: 'Perplexity', nameEn: 'Perplexity', region: 'global', category: 'AI 搜索', canCheckin: false,
    downloadUrl: 'https://www.perplexity.ai/', icon: icon('perplexity'), color: '#20808d',
    benefitTip: '基础搜索免费，Pro 深度搜索每 4 小时约 5 次。无每日签到。',
    desc: 'AI 搜索标杆，回答附引用来源，可溯源性强。',
  },
  {
    id: 'midjourney', name: 'Midjourney', nameEn: 'Midjourney', region: 'global', category: '图像设计', canCheckin: false,
    downloadUrl: 'https://www.midjourney.com/', icon: icon('midjourney'), color: '#111827',
    benefitTip: '订阅制服务，偶有免费体验活动，无常驻签到机制。',
    desc: '高质量 AI 图像生成工具，艺术风格与美感表现突出。',
  },
  {
    id: 'runway', name: 'Runway', nameEn: 'Runway', region: 'global', category: '视频创作', canCheckin: false,
    downloadUrl: 'https://runwayml.com/', icon: icon('runway'), color: '#1e293b',
    benefitTip: '免费版有有限生成额度，属免费层而非签到。',
    desc: 'AI 视频生成与编辑平台，支持视频到视频、绿幕与运动追踪。',
  },
  {
    id: 'windsurf', name: 'Windsurf', nameEn: 'Windsurf', region: 'global', category: '编程开发', canCheckin: false,
    downloadUrl: 'https://windsurf.com/', icon: icon('windsurf'), color: '#0ea5e9',
    benefitTip: '免费版有有限次高级交互额度，属免费层而非签到。',
    desc: 'AI 编程 IDE，Cascade 流式协作擅长跨文件重构。',
  },
]

export const REGION_LABEL: Record<AgentRegion, string> = { cn: '国内工具', global: '海外工具' }
export const CATEGORY_TAGS: AgentCategory[] = [
  '综合办公', '对话助手', '编程开发', 'AI 搜索', '图像设计', '视频创作', 'Agent 平台',
]

export const CHECKIN_TOOLS = AGENT_TOOLS.filter(t => t.canCheckin)
