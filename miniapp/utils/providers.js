// 平台目录 —— 与 Web 端 src/data/providers.ts 保持一致
// 仅官方域名链接；小程序不做任何自动化外部操作
const PROVIDERS = [
  { id:'openai', name:'OpenAI', short:'OpenAI', cat:'大模型', url:'https://platform.openai.com/usage', checkin:'', color:'#10a37f', initials:'OA', note:'官方 Usage 页面查看用量' },
  { id:'anthropic', name:'Anthropic Claude', short:'Claude', cat:'大模型', url:'https://console.anthropic.com/settings/usage', checkin:'', color:'#d97757', initials:'CL', note:'控制台查看用量' },
  { id:'gemini', name:'Google Gemini', short:'Gemini', cat:'大模型', url:'https://aistudio.google.com/app/apikey', checkin:'', color:'#4285f4', initials:'GE', note:'AI Studio 免费额度' },
  { id:'deepseek', name:'DeepSeek', short:'DeepSeek', cat:'大模型', url:'https://platform.deepseek.com/usage', checkin:'', color:'#4d6bfe', initials:'DS', note:'控制台查看余额' },
  { id:'qwen', name:'通义千问', short:'通义', cat:'大模型', url:'https://bailian.console.aliyun.com/', checkin:'', color:'#615ced', initials:'通', note:'百炼控制台查看额度' },
  { id:'kim', name:'Moonshot Kimi', short:'Kimi', cat:'大模型', url:'https://platform.moonshot.cn/console/info', checkin:'', color:'#1a1a1a', initials:'K', note:'控制台查看余额' },
  { id:'doubao', name:'豆包 / 火山方舟', short:'豆包', cat:'大模型', url:'https://console.volcengine.com/ark', checkin:'', color:'#f04142', initials:'豆', note:'火山方舟控制台' },
  { id:'glm', name:'智谱 GLM', short:'GLM', cat:'大模型', url:'https://open.bigmodel.cn/usercenter', checkin:'', color:'#3859ff', initials:'G', note:'开放平台查看余额' },
  { id:'cursor', name:'Cursor', short:'Cursor', cat:'编程', url:'https://www.cursor.com/account/usage', checkin:'', color:'#111827', initials:'CU', note:'订阅账户查看用量' },
  { id:'copilot', name:'GitHub Copilot', short:'Copilot', cat:'编程', url:'https://github.com/settings/copilot', checkin:'', color:'#24292f', initials:'GH', note:'Settings 查看请求配额' },
  { id:'midjourney', name:'Midjourney', short:'MJ', cat:'图像', url:'https://www.midjourney.com/account', checkin:'', color:'#111827', initials:'MJ', note:'订阅 Fast Hours' },
  { id:'perplexity', name:'Perplexity', short:'PPLX', cat:'搜索', url:'https://www.perplexity.ai/settings/api', checkin:'', color:'#20808d', initials:'PX', note:'API 账户查看余额' },
  { id:'elevenlabs', name:'ElevenLabs', short:'Eleven', cat:'语音', url:'https://elevenlabs.io/app/settings/usage', checkin:'', color:'#111827', initials:'EL', note:'控制台查看字符额度' },
  { id:'figma', name:'Figma AI', short:'Figma', cat:'设计', url:'https://www.figma.com/settings', checkin:'', color:'#f24e1e', initials:'FG', note:'订阅账户查看 AI 额度' },
]

const PROVIDER_MAP = {}
PROVIDERS.forEach(function (p) { PROVIDER_MAP[p.id] = p })

// 本地存储工具（小程序 wx.Storage）
const STORAGE_KEY = 'acm.mini.v1'
var DEFAULT_SETTINGS = {
  checkinReminder: true,
  alertDays: 7,
  defaultUnit: 'credit',
  monthlyBudget: 200,
  backupReminder: true
}
function load() {
  var state = { accounts: [], quotas: [], checkins: [], usage: [], settings: DEFAULT_SETTINGS }
  try {
    var raw = wx.getStorageSync(STORAGE_KEY)
    if (raw) {
      state.accounts = raw.accounts || []
      state.quotas = raw.quotas || []
      state.checkins = raw.checkins || []
      state.usage = raw.usage || []
      state.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {})
      if (raw.budget && !raw.settings) state.settings.monthlyBudget = raw.budget
    }
  } catch (e) {}
  return state
}
function save(state) {
  try { wx.setStorageSync(STORAGE_KEY, state) } catch (e) {}
}
function updateSettings(patch) {
  var state = load()
  state.settings = Object.assign({}, state.settings, patch)
  save(state)
  return state.settings
}
function today() {
  var d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

module.exports = { PROVIDERS, PROVIDER_MAP, load, save, updateSettings, today }
