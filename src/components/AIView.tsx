// AI 助手聊天页：类 WorkBuddy 的干净对话界面。
// 布局自适应：桌面居中宽栏、移动端占满屏；流式输出、可中止、快捷提问。

import { useEffect, useRef, useState, useMemo } from 'react'
import {
  Sparkles, Send, Square, Plus, ChevronDown, Bot, User, Trash2, CornerDownLeft, Volume2, VolumeX,
  Phone, Layers, ExternalLink, Info, Loader2,
} from 'lucide-react'
import {
  listModels, loadHistory, saveHistory, rotateConversationId,
  loadModel, saveModel, streamChat, friendlyAiError,
  type ChatMessage, type AiModel,
} from '../core/ai'
import { speak, stopSpeak, getSavedVoice } from '../core/tts'
import { VoiceCall } from './VoiceCall'
import {
  MODEL_CATEGORIES, CATEGORY_META, categoryForModel, type ModelCategory,
} from '../core/modelCategories'
import { callByCategory } from '../core/providerCall'
import type { Account } from '../core/types'
import { decryptSecret } from '../core/crypto'
import { PROVIDER_MAP } from '../data/providers'

const QUICK_PROMPTS = [
  { icon: '📊', title: '如何管理我的 AI 订阅费用？', desc: '给出预算与额度控制建议' },
  { icon: '🔑', title: 'API Key 怎么安全保管？', desc: '本地保险箱与合规使用要点' },
  { icon: '📅', title: '每天签到有哪些注意事项？', desc: '签到提醒与官方页面操作' },
  { icon: '💡', title: '这个 App 能帮我做什么？', desc: '快速了解全部功能' },
]

export function AIView({ notify, accounts, sessionPwd }: {
  notify: (m: string) => void
  accounts: Account[]
  sessionPwd: string
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory())
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [models, setModels] = useState<AiModel[]>([])
  const [model, setModel] = useState<string>('')
  const [modelOpen, setModelOpen] = useState(false)
  const [category, setCategory] = useState<ModelCategory>('通用型')
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [callOpen, setCallOpen] = useState(false)
  const [resolvingKey, setResolvingKey] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 加载模型列表：空列表给明确提示，不硬编码兜底
  useEffect(() => {
    let alive = true
    listModels().then(list => {
      if (!alive) return
      setModels(list)
      const saved = loadModel()
      if (saved?.startsWith('own:')) return  // 恢复的是自己的账户，由 allOptions 匹配（下方 effect）
      const picked = saved && list.some(m => m.id === saved) ? saved : list[0]?.id
      if (picked) setModel(picked)
    }).catch(e => { if (alive) notify(`模型加载失败：${friendlyAiError(e)}`) })
    return () => { alive = false }
  }, [notify])

  // 持久化历史 + 自动滚动到底部
  useEffect(() => { saveHistory(messages) }, [messages])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamingText])

  // 免费模型 + 用户自己的账户模型，按分类联动过滤
  const freeOptions = useMemo(() => models.map(m => ({ key: m.id, label: m.name, account: null as Account | null, category: '通用型' as ModelCategory, free: true })), [models])
  const ownOptions = useMemo(() => accounts.map(a => ({
    key: `own:${a.id}`,
    label: `${a.label}${a.note ? ` · ${a.note.replace(/^\[[^\]]+\]\s*/, '')}` : ''}`,
    account: a,
    category: categoryForModel(a.note),
    free: false,
  })), [accounts])
  const allOptions = useMemo(() => [...freeOptions, ...ownOptions], [freeOptions, ownOptions])
  const visibleOptions = useMemo(() =>
    category === '通用型' ? allOptions : allOptions.filter(o => o.category === category),
    [category, allOptions])
  const selectedOption = allOptions.find(o => o.key === model) ?? null
  const canChat = !selectedOption || selectedOption.free || CATEGORY_META[selectedOption.category].canChat

  useEffect(() => {
    if (!model && allOptions.length > 0) {
      const saved = loadModel()
      const match = saved && allOptions.some(o => o.key === saved) ? saved : allOptions[0].key
      setModel(match)
    }
  }, [allOptions, model])

  /** 统一取回复：用户自己的账户走其 API，否则走平台免费模型 */
  const getReply = async (content: string, history: ChatMessage[], signal?: AbortSignal): Promise<string> => {
    const opt = allOptions.find(o => o.key === model)
    // 用户自己的账户：用其 Key 真正调用
    if (opt?.account) {
      const acct = opt.account
      const pwd = sessionPwd || ''
      if (!acct.encryptedKey) throw new Error('该账户未配置 API Key，请在 API Key 管理页添加')
      if (!pwd) throw new Error('请先在 API Key 管理页解锁保险箱后再使用自己的模型')
      setResolvingKey(true)
      let apiKey: string
      try { apiKey = await decryptSecret(acct.encryptedKey, pwd) }
      finally { setResolvingKey(false) }
      const msgs = [{ role: 'system', content: '你是 AI 积分管家助手，请用简洁中文回答。' }, ...history.slice(-12).map(m => ({ role: m.role, content: m.content })), { role: 'user', content }]
      const r = await callByCategory(acct, apiKey, opt.category, msgs)
      if (!r.ok) throw Object.assign(new Error(r.error ?? '调用失败'), { cors: r.cors })
      if (r.images?.length) {
        return `${r.text}\n${r.images.map(u => u.startsWith('data:') ? '[已生成图片]' : u).join('\n')}`
      }
      return r.text
    }
    // 平台免费模型：流式输出
    return streamChat(model || 'auto', history, content, delta => setStreamingText(prev => prev + delta), signal)
  }

  const send = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || generating) return
    if (!model) { notify('模型尚未就绪，请稍候'); return }
    if (selectedOption && !canChat) { notify(`${selectedOption.category}模型不支持文字对话，请切换到对话型/通用型`); return }
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    const userMsg: ChatMessage = { id: `${Date.now()}-u`, role: 'user', content, at: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setGenerating(true)
    setStreamingText('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const answer = await getReply(content, messages, controller.signal)
      setMessages(prev => [...prev, { id: `${Date.now()}-a`, role: 'assistant', content: answer || '（无回复内容）', at: Date.now() }])
    } catch (e) {
      const msg = friendlyAiError(e)
      if (msg !== '已停止生成') notify(msg)
      setStreamingText(prev => {
        if (prev) setMessages(p => [...p, { id: `${Date.now()}-a`, role: 'assistant', content: prev, at: Date.now() }])
        return ''
      })
    } finally {
      setGenerating(false)
      setStreamingText('')
      abortRef.current = null
    }
  }

  const stop = () => { abortRef.current?.abort(); setGenerating(false) }

  const toggleSpeak = (m: ChatMessage) => {
    if (speakingId === m.id) { stopSpeak(); setSpeakingId(null); return }
    const ok = speak(m.content, getSavedVoice(), (state) => {
      if (state === 'end' || state === 'error') setSpeakingId(null)
    })
    if (!ok) { notify('当前环境不支持语音朗读'); return }
    setSpeakingId(m.id)
  }

  useEffect(() => () => { stopSpeak() }, [])

  const clear = () => {
    if (generating) stop()
    setMessages([])
    rotateConversationId()
    notify('已开启新对话')
  }

  const onInput = (v: string) => {
    setInput(v)
    const el = textareaRef.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }
  }

  const currentModel = selectedOption?.label ?? '选择模型'
  const hasChat = messages.length > 0 || generating
  const callEnabled = !selectedOption || CATEGORY_META[selectedOption.category].canChat

  return (
    <div className="ai-page">
      <div className="ai-shell">
        {/* 顶部栏 */}
        <div className="ai-topbar">
          <div className="ai-brand">
            <div className="ai-brand-mark"><Sparkles size={18} /></div>
            <div>
              <div className="ai-brand-title">AI 助手</div>
              <div className="ai-brand-sub">积分管家智能助理</div>
            </div>
          </div>
          <div className="ai-top-actions">
            {/* 模型分类下拉（与模型下拉联动） */}
            <div className="ai-model-wrap">
              <button className="ai-model-btn" onClick={() => { setCategoryOpen(v => !v); setModelOpen(false) }} title="模型分类">
                <Layers size={13} /> {category} <ChevronDown size={13} />
              </button>
              {categoryOpen && <div className="ai-model-menu">
                {MODEL_CATEGORIES.map(c => (
                  <button key={c} className={`ai-model-option ${c === category ? 'active' : ''}`}
                    onClick={() => {
                      setCategory(c); setCategoryOpen(false)
                      // 分类切换后，若当前模型不在新分类里，自动选该分类第一个
                      const list = c === '通用型' ? allOptions : allOptions.filter(o => o.category === c)
                      if (list.length && !list.some(o => o.key === model)) { setModel(list[0].key); saveModel(list[0].key) }
                    }}>
                    <span>{CATEGORY_META[c].icon} {c}</span>
                    <small>{c === '通用型' ? allOptions.length : allOptions.filter(o => o.category === c).length}</small>
                  </button>
                ))}
              </div>}
            </div>
            {/* 模型下拉（按分类过滤） */}
            <div className="ai-model-wrap">
              <button className="ai-model-btn" onClick={() => { setModelOpen(v => !v); setCategoryOpen(false) }} title="切换模型">
                {currentModel} <ChevronDown size={13} />
              </button>
              {modelOpen && <div className="ai-model-menu">
                {visibleOptions.length === 0 && <div className="ai-model-empty">该分类暂无模型，请到 API Key 管理页添加</div>}
                {visibleOptions.map(o => (
                  <button key={o.key} className={`ai-model-option ${o.key === model ? 'active' : ''}`}
                    onClick={() => { setModel(o.key); saveModel(o.key); setModelOpen(false) }}>
                    <span>{o.free ? '⚡ ' : '🔑 '}{o.label}</span>
                    {!o.free && <small>{o.category}</small>}
                  </button>
                ))}
              </div>}
            </div>
            <button className="ai-icon-btn call" onClick={() => setCallOpen(true)} disabled={!callEnabled}
              title={callEnabled ? 'AI 语音通话' : '当前分类模型不支持语音通话'}><Phone size={17} /></button>
            <button className="ai-icon-btn" onClick={clear} title="新建对话"><Plus size={18} /></button>
            {messages.length > 0 && <button className="ai-icon-btn" onClick={() => { setMessages([]); rotateConversationId(); notify('对话已清空') }} title="清空对话"><Trash2 size={17} /></button>}
          </div>
        </div>

        {/* 非对话型模型提示卡 */}
        {selectedOption && !canChat && (
          <div className="ai-model-notice">
            <Info size={15} />
            <div>
              <b>{selectedOption.label}</b> 属于「{selectedOption.category}」——{CATEGORY_META[selectedOption.category].desc}。
              直接对话已在此输入你的问题，尝试调用官方接口（生图/视频类多为异步任务，结果请到官方平台查看）。
            </div>
            <button className="btn sm ghost" onClick={() => {
              const url = PROVIDER_MAP[selectedOption.account!.providerId]?.officialUrl
              if (url) window.open(url, '_blank', 'noopener')
              else notify('暂无官方地址')
            }}><ExternalLink size={13} /> 官方</button>
          </div>
        )}

        {/* 对话区 */}
        <div className="ai-messages">
          {!hasChat ? (
            <div className="ai-welcome">
              <div className="ai-welcome-mark"><Sparkles size={34} /></div>
              <h2>有什么可以帮你？</h2>
              <p>关于积分、额度、签到、费用与 API Key 安全，都可以问我。</p>
              <div className="ai-quick-grid">
                {QUICK_PROMPTS.map(q => (
                  <button key={q.title} className="ai-quick-card" onClick={() => void send(q.title)}>
                    <span className="ai-quick-icon">{q.icon}</span>
                    <span className="ai-quick-title">{q.title}</span>
                    <span className="ai-quick-desc">{q.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ai-thread">
              {messages.map(m => (
                <div key={m.id} className={`ai-msg ${m.role}`}>
                  <div className="ai-avatar">{m.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}</div>
                  <div className="ai-msg-body">
                    <div className="ai-bubble">{m.content}</div>
                    {m.role === 'assistant' && m.content && (
                      <button className={`ai-speak ${speakingId === m.id ? 'active' : ''}`}
                        onClick={() => toggleSpeak(m)} title={speakingId === m.id ? '停止朗读' : '朗读此回复'}>
                        {speakingId === m.id ? <VolumeX size={14} /> : <Volume2 size={14} />}
                        <span>{speakingId === m.id ? '停止' : '朗读'}</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {generating && streamingText && (
                <div className="ai-msg assistant">
                  <div className="ai-avatar"><Bot size={16} /></div>
                  <div className="ai-bubble"><span className="ai-typing">{streamingText}</span><span className="ai-cursor" /></div>
                </div>
              )}
              {generating && !streamingText && (
                <div className="ai-msg assistant">
                  <div className="ai-avatar"><Bot size={16} /></div>
                  <div className="ai-bubble ai-thinking"><span /><span /><span /></div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="ai-compose">
          <div className="ai-compose-box">
            <textarea ref={textareaRef} className="ai-textarea" rows={1}
              placeholder="输入你的问题…" value={input}
              onChange={e => onInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              disabled={generating} />
            {generating ? (
              <button className="ai-send stop" onClick={stop} title="停止生成"><Square size={15} fill="currentColor" /></button>
            ) : (
              <button className="ai-send" onClick={() => void send()} disabled={!input.trim()} title="发送"><Send size={17} /></button>
            )}
          </div>
          <div className="ai-hint">
            <span><CornerDownLeft size={12} /> Enter 发送 · Shift+Enter 换行</span>
            <span>{resolvingKey ? <><Loader2 size={12} className="spin" /> 正在解锁密钥…</> : 'AI 回答仅供参考，重要信息请核对官方渠道'}</span>
          </div>
        </div>
      </div>
      {callOpen && <VoiceCall
        onSend={async (text) => {
          const r = await getReply(text, messages)
          setMessages(prev => [...prev,
            { id: `${Date.now()}-u`, role: 'user', content: text, at: Date.now() },
            { id: `${Date.now()}-a`, role: 'assistant', content: r, at: Date.now() },
          ])
          return r
        }}
        onClose={() => setCallOpen(false)}
        notify={notify}
      />}
    </div>
  )
}
