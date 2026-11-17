// AI 助手聊天页：类 WorkBuddy 的干净对话界面。
// 布局自适应：桌面居中宽栏、移动端占满屏；流式输出、可中止、快捷提问。

import { useEffect, useRef, useState } from 'react'
import { Sparkles, Send, Square, Plus, ChevronDown, Bot, User, Trash2, CornerDownLeft } from 'lucide-react'
import {
  listModels, loadHistory, saveHistory, rotateConversationId,
  loadModel, saveModel, streamChat, friendlyAiError,
  type ChatMessage, type AiModel,
} from '../core/ai'

const QUICK_PROMPTS = [
  { icon: '📊', title: '如何管理我的 AI 订阅费用？', desc: '给出预算与额度控制建议' },
  { icon: '🔑', title: 'API Key 怎么安全保管？', desc: '本地保险箱与合规使用要点' },
  { icon: '📅', title: '每天签到有哪些注意事项？', desc: '签到提醒与官方页面操作' },
  { icon: '💡', title: '这个 App 能帮我做什么？', desc: '快速了解全部功能' },
]

export function AIView({ notify }: { notify: (m: string) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory())
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [models, setModels] = useState<AiModel[]>([])
  const [model, setModel] = useState<string>('')
  const [modelOpen, setModelOpen] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 加载模型列表：空列表给明确提示，不硬编码兜底
  useEffect(() => {
    let alive = true
    listModels().then(list => {
      if (!alive) return
      setModels(list)
      if (list.length === 0) { notify('当前没有可用的 AI 模型'); return }
      const saved = loadModel()
      const picked = saved && list.some(m => m.id === saved) ? saved : list[0].id
      setModel(picked)
    }).catch(e => { if (alive) notify(`模型加载失败：${friendlyAiError(e)}`) })
    return () => { alive = false }
  }, [notify])

  // 持久化历史 + 自动滚动到底部
  useEffect(() => { saveHistory(messages) }, [messages])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamingText])

  const send = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || generating) return
    if (!model) { notify('模型尚未就绪，请稍候'); return }
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    const userMsg: ChatMessage = { id: `${Date.now()}-u`, role: 'user', content, at: Date.now() }
    const next = [...messages, userMsg]
    setMessages(next)
    setGenerating(true)
    setStreamingText('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const answer = await streamChat(model, messages, content, delta => setStreamingText(prev => prev + delta), controller.signal)
      setMessages(prev => [...prev, { id: `${Date.now()}-a`, role: 'assistant', content: answer || '（无回复内容）', at: Date.now() }])
    } catch (e) {
      const msg = friendlyAiError(e)
      if (msg !== '已停止生成') notify(msg)
      // 失败时保留已生成的部分（若有）
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

  const currentModel = models.find(m => m.id === model)?.name ?? '选择模型'
  const hasChat = messages.length > 0 || generating

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
            <div className="ai-model-wrap">
              <button className="ai-model-btn" onClick={() => setModelOpen(v => !v)} title="切换模型">
                {currentModel} <ChevronDown size={13} />
              </button>
              {modelOpen && <div className="ai-model-menu">
                {models.length === 0 && <div className="ai-model-empty">暂无可用模型</div>}
                {models.map(m => (
                  <button key={m.id} className={`ai-model-option ${m.id === model ? 'active' : ''}`}
                    onClick={() => { setModel(m.id); saveModel(m.id); setModelOpen(false) }}>
                    {m.name}
                  </button>
                ))}
              </div>}
            </div>
            <button className="ai-icon-btn" onClick={clear} title="新建对话"><Plus size={18} /></button>
            {messages.length > 0 && <button className="ai-icon-btn" onClick={() => { setMessages([]); rotateConversationId(); notify('对话已清空') }} title="清空对话"><Trash2 size={17} /></button>}
          </div>
        </div>

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
                  <div className="ai-bubble">{m.content}</div>
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
            <span>AI 回答仅供参考，重要信息请核对官方渠道</span>
          </div>
        </div>
      </div>
    </div>
  )
}
