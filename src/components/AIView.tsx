// AI 助手聊天页：类 WorkBuddy 的干净对话界面。
// 布局自适应：桌面居中宽栏、移动端占满屏；流式输出、可中止、快捷提问。

import { useEffect, useRef, useState, useMemo } from 'react'
import {
  Sparkles, Send, Square, Plus, ChevronDown, Bot, User, Trash2, CornerDownLeft, Volume2, VolumeX,
  Phone, Layers, ExternalLink, Info, Loader2, FileText, Image as ImageIcon, Video, Camera, Images, X, RotateCcw, Cpu,
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
import { callByCategory, fetchProviderModels } from '../core/providerCall'
import type { Account } from '../core/types'
import { decryptSecret, getBiometricPassword } from '../core/crypto'
import { PROVIDER_MAP } from '../data/providers'
import {
  pickAttachment, currentPlatform, type AttachmentKind, type PickedAttachment,
} from '../core/attachments'
import {
  enginesFor, enginesFromRemote, hasCatalog, REASONING_LEVELS, REASONING_DESC, toReasoningEffort,
  type ReasoningLevel,
} from '../data/engines'

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
  const [attachOpen, setAttachOpen] = useState(false)
  const [attachments, setAttachments] = useState<PickedAttachment[]>([])
  const [picking, setPicking] = useState(false)
  const [enginePanelOpen, setEnginePanelOpen] = useState(false)
  const [engineId, setEngineId] = useState<string>('')
  const [remoteEngines, setRemoteEngines] = useState<string[] | null>(null)
  const [engineSource, setEngineSource] = useState<'remote' | 'builtin' | 'none'>('none')
  const [loadingEngines, setLoadingEngines] = useState(false)
  const [reasoning, setReasoning] = useState<ReasoningLevel>('Off')
  const [reasoningOpen, setReasoningOpen] = useState(false)
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
  const freeOptions = useMemo(() => models.map(m => ({ key: m.id, label: m.name, account: null as Account | null, category: '免费模型' as ModelCategory, free: true })), [models])
  const ownOptions = useMemo(() => accounts.map(a => ({
    key: `own:${a.id}`,
    label: `${a.label}${a.note ? ` · ${a.note.replace(/^\[[^\]]+\]\s*/, '')}` : ''}`,
    account: a,
    category: categoryForModel(a.note),
    free: false,
  })), [accounts])
  const allOptions = useMemo(() => [...freeOptions, ...ownOptions], [freeOptions, ownOptions])
  const visibleOptions = useMemo(() => allOptions.filter(o => o.category === category), [category, allOptions])
  const selectedOption = allOptions.find(o => o.key === model) ?? null
  const canChat = !selectedOption || selectedOption.free || CATEGORY_META[selectedOption.category].canChat
  // 当前自有账户 → 引擎列表：动态拉取优先，内置目录兜底
  const currentAccount = selectedOption?.account ?? null
  const engines = useMemo(() => {
    if (!currentAccount) return []
    if (engineSource === 'remote' && remoteEngines?.length) return enginesFromRemote(currentAccount.providerId, remoteEngines)
    return enginesFor(currentAccount.providerId)
  }, [currentAccount, engineSource, remoteEngines])
  const selectedEngine = engines.find(e => e.id === engineId) ?? null

  useEffect(() => {
    if (model || allOptions.length === 0) return
    const saved = loadModel()
    if (saved && allOptions.some(o => o.key === saved)) { setModel(saved); return }
    // 默认从当前分类选；当前分类为空则切到第一个有模型的分类
    const inCategory = allOptions.filter(o => o.category === category)
    if (inCategory.length) { setModel(inCategory[0].key); return }
    const firstCat = MODEL_CATEGORIES.find(c => allOptions.some(o => o.category === c))
    if (firstCat) { setCategory(firstCat); setModel(allOptions.find(o => o.category === firstCat)!.key) }
  }, [allOptions, model, category])

  // 选中自有账户后：用其 Key 动态拉取真实可用引擎（/v1/models）；失败回退内置目录
  useEffect(() => {
    let alive = true
    setRemoteEngines(null)
    if (!currentAccount) { setEngineSource('none'); return () => { alive = false } }
    const acct = currentAccount
    const pwd = sessionPwd || getBiometricPassword() || ''
    if (!acct.encryptedKey || !pwd) {
      setEngineSource('builtin')
      return () => { alive = false }
    }
    ;(async () => {
      setLoadingEngines(true)
      try {
        const key = await decryptSecret(acct.encryptedKey!, pwd)
        const ids = await fetchProviderModels(acct, key)
        if (!alive) return
        setRemoteEngines(ids)
        setEngineSource('remote')
      } catch {
        if (!alive) return
        setEngineSource('builtin')  // 拉取失败（CORS/Key无权限/私有协议）→ 内置目录
      } finally { if (alive) setLoadingEngines(false) }
    })()
    return () => { alive = false }
  }, [currentAccount, sessionPwd])

  // 引擎列表变化时：保留仍有效的选择，否则优先旗舰模型（无旗舰则取第一个）
  useEffect(() => {
    if (currentAccount) {
      setEngineId(prev => engines.some(e => e.id === prev) ? prev : (engines.find(e => e.flagship)?.id ?? engines[0]?.id ?? ''))
    } else setEngineId('')
  }, [currentAccount, engines])

  /** 统一取回复：用户自己的账户走其 API，否则走平台免费模型 */
  const getReply = async (content: string, history: ChatMessage[], signal?: AbortSignal, images?: string[]): Promise<string> => {
    const opt = allOptions.find(o => o.key === model)
    // 用户自己的账户：用其 Key 真正调用
    if (opt?.account) {
      const acct = opt.account
      const pwd = sessionPwd || getBiometricPassword() || ''
      if (!acct.encryptedKey) throw new Error('该账户未配置 API Key，请在 API Key 管理页添加')
      if (!pwd) throw new Error('请先在 API Key 管理页解锁保险箱后再使用自己的模型')
      setResolvingKey(true)
      let apiKey: string
      try { apiKey = await decryptSecret(acct.encryptedKey, pwd) }
      finally { setResolvingKey(false) }
      const msgs = [{ role: 'system', content: '你是 AI 积分管家助手，请用简洁中文回答。' }, ...history.slice(-12).map(m => ({ role: m.role, content: m.content })), { role: 'user', content }]
      const r = await callByCategory(acct, apiKey, opt.category, msgs, engineId || undefined, toReasoningEffort(reasoning))
      if (!r.ok) throw Object.assign(new Error(r.error ?? '调用失败'), { cors: r.cors })
      if (r.images?.length) {
        return `${r.text}\n${r.images.map(u => u.startsWith('data:') ? '[已生成图片]' : u).join('\n')}`
      }
      return r.text
    }
    // 平台免费模型：流式输出（图片附件随多模态消息发送）
    return streamChat(model || 'auto', history, content, delta => setStreamingText(prev => prev + delta), signal, images, toReasoningEffort(reasoning))
  }

  const send = async (text?: string) => {
    const content = (text ?? input).trim()
    const hasAttach = attachments.length > 0
    if ((!content && !hasAttach) || generating) return
    const effectiveText = content || '请分析这些附件'
    if (!model) { notify('模型尚未就绪，请稍候'); return }
    if (selectedOption && !canChat) { notify(`${selectedOption.category}模型不支持文字对话，请切换到对话型/通用型`); return }
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    const imageUrls = attachments.filter(a => a.mime.startsWith('image/')).map(a => a.dataUrl)
    const attachNote = attachments.length ? `\n${attachments.map(a => `[附件:${a.name}]`).join(' ')}` : ''
    const userMsg: ChatMessage = { id: `${Date.now()}-u`, role: 'user', content: effectiveText + attachNote, at: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setAttachments([])
    setGenerating(true)
    setStreamingText('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const answer = await getReply(effectiveText, messages, controller.signal, imageUrls)
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

  // 附件菜单：桌面=文件/照片/视频；手机=相机/相册/文件；Web 兜底=文件/照片/视频
  const platform = currentPlatform()
  const attachItems: { kind: AttachmentKind; label: string; icon: typeof FileText }[] = platform === 'mobile'
    ? [
        { kind: 'camera', label: '相机', icon: Camera },
        { kind: 'album', label: '相册', icon: Images },
        { kind: 'file', label: '文件', icon: FileText },
      ]
    : [
        { kind: 'file', label: '文件', icon: FileText },
        { kind: 'photo', label: '照片', icon: ImageIcon },
        { kind: 'video', label: '视频', icon: Video },
      ]

  const onPickAttachment = async (kind: AttachmentKind) => {
    setAttachOpen(false)
    setPicking(true)
    try {
      const picked = await pickAttachment(kind)
      if (picked) { setAttachments(prev => [...prev, picked]); notify(`已添加：${picked.name}`) }
    } catch (e) {
      notify((e as Error).message ?? '获取附件失败')
    } finally { setPicking(false) }
  }

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

  const currentModel = selectedOption?.account
    ? `${PROVIDER_MAP[selectedOption.account.providerId]?.shortName ?? selectedOption.account.label}${selectedEngine ? ` · ${selectedEngine.name}` : ''}`
    : selectedOption?.label ?? '选择模型'
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
                      const list = allOptions.filter(o => o.category === c)
                      if (list.length && !list.some(o => o.key === model)) { setModel(list[0].key); saveModel(list[0].key) }
                    }}>
                    <span>{CATEGORY_META[c].icon} {c}</span>
                    <small>{allOptions.filter(o => o.category === c).length}</small>
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
            {currentAccount && hasCatalog(currentAccount.providerId) && (
              <button className="ai-model-btn" onClick={() => setEnginePanelOpen(v => !v)} title="选择该平台的模型引擎">
                <Cpu size={13} /> 引擎 <ChevronDown size={13} />
              </button>
            )}
            <button className="ai-icon-btn call" onClick={() => setCallOpen(true)} disabled={!callEnabled}
              title={callEnabled ? 'AI 语音通话' : '当前分类模型不支持语音通话'}><Phone size={17} /></button>
            <div className="ai-model-wrap">
              <button className="ai-icon-btn" onClick={() => { setAttachOpen(v => !v); setModelOpen(false); setCategoryOpen(false) }} title="添加附件"><Plus size={18} /></button>
              {attachOpen && <div className="ai-attach-menu">
                <div className="ai-attach-title">添加附件 · {platform === 'mobile' ? '手机' : platform === 'desktop' ? '桌面' : '网页'}</div>
                {attachItems.map(item => {
                  const Icon = item.icon
                  return <button key={item.kind} onClick={() => void onPickAttachment(item.kind)} disabled={picking}>
                    <Icon size={16} /> {item.label}
                  </button>
                })}
                <div className="ai-attach-note">首次使用会请求相应权限，授权后即可选择</div>
              </div>}
            </div>
            <button className="ai-icon-btn" onClick={clear} title="新建对话"><RotateCcw size={17} /></button>
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
          {attachments.length > 0 && <div className="ai-attachments">
            {attachments.map((a, i) => (
              <div key={i} className="ai-attachment" title={a.name}>
                {a.mime.startsWith('image/') ? <img src={a.dataUrl} alt={a.name} />
                  : a.mime.startsWith('video/') ? <Video size={18} /> : <FileText size={18} />}
                <span>{a.name}</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} title="移除"><X size={13} /></button>
              </div>
            ))}
          </div>}
          <div className="ai-compose-box">
            <textarea ref={textareaRef} className="ai-textarea" rows={1}
              placeholder={attachments.length ? '对这些附件说点什么…（也可直接发送）' : '输入你的问题…'} value={input}
              onChange={e => onInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              disabled={generating} />
            {generating ? (
              <button className="ai-send stop" onClick={stop} title="停止生成"><Square size={15} fill="currentColor" /></button>
            ) : (
              <button className="ai-send" onClick={() => void send()} disabled={!input.trim() && attachments.length === 0} title="发送"><Send size={17} /></button>
            )}
          </div>
          <div className="ai-hint">
            <span>{resolvingKey ? <><Loader2 size={12} className="spin" /> 正在解锁密钥…</> : <><CornerDownLeft size={12} /> Enter 发送 · Shift+Enter 换行</>}</span>
            <div className="reasoning-wrap">
              <span>推理等级</span>
              <button className="reasoning-btn" onClick={() => setReasoningOpen(v => !v)} title={REASONING_DESC[reasoning]}>{reasoning} <ChevronDown size={12} /></button>
              {reasoningOpen && <div className="reasoning-menu">
                {REASONING_LEVELS.map(l => (
                  <button key={l} className={`reasoning-option ${l === reasoning ? 'active' : ''}`} title={REASONING_DESC[l]}
                    onClick={() => {
                      setReasoning(l); setReasoningOpen(false)
                      notify(`${l}：${REASONING_DESC[l]}`)  // 手机端点选后提示（桌面/Docker 也有 title 悬停提示）
                    }}>
                    <span className="reasoning-option-label">{l} {l === reasoning && <span>✓</span>}</span>
                    <small>{REASONING_DESC[l]}</small>
                  </button>
                ))}
              </div>}
            </div>
          </div>
        </div>
      </div>
      {/* 右侧引擎选择面板 */}
      {enginePanelOpen && currentAccount && (
        <>
          <div className="engine-backdrop" onClick={() => setEnginePanelOpen(false)} />
          <aside className="engine-panel">
            <div className="engine-panel-head">
              <div>
                <div className="engine-panel-title">模型引擎</div>
                <div className="engine-panel-sub">
                  {PROVIDER_MAP[currentAccount.providerId]?.shortName ?? currentAccount.label} · 按 token 消耗从低到高
                  {loadingEngines && ' · 正在获取实时引擎…'}
                  {!loadingEngines && engineSource === 'remote' && ' · 实时获取'}
                  {!loadingEngines && engineSource === 'builtin' && ' · 内置参考'}
                </div>
              </div>
              <button className="icon-btn" onClick={() => setEnginePanelOpen(false)}><X size={17} /></button>
            </div>
            <div className="engine-list">
              {engines.map(e => (
                <button key={e.id} className={`engine-item ${engineId === e.id ? 'active' : ''}`}
                  onClick={() => { setEngineId(e.id); notify(`已选引擎：${e.name}`) }}>
                  <span className="engine-icon">{e.reasoning ? '🧠' : '⚡'}</span>
                  <span className="engine-info">
                    <span className="engine-name">{e.name}
                      {e.tag && <em className={`engine-tag ${e.tag === '夜间折扣' ? 'discount' : e.tag === '订阅优先' ? 'sub' : ''}`}>{e.tag}</em>}
                    </span>
                    <span className="engine-id">{e.id}</span>
                  </span>
                  <span className="engine-multi">{e.multiplier.toFixed(2)}x</span>
                  {engineId === e.id && <span className="engine-check">✓</span>}
                </button>
              ))}
              {loadingEngines && <div className="engine-empty"><Loader2 size={22} className="spin" /><div style={{ marginTop: 10 }}>正在从官方接口获取可用引擎…</div></div>}
              {!loadingEngines && engines.length === 0 && <div className="engine-empty">该平台暂无内置引擎目录。<br />请到 API Key 管理页检查账户平台，或手动填写引擎名。</div>}
            </div>
            <div className="engine-note">
              <Info size={12} /> 倍率为参考值，用于排序；实际计费以官方账单为准。部分引擎需订阅或支持推理等级。
            </div>
          </aside>
        </>
      )}

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
