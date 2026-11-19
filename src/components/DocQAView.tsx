// 本地文档问答（RAG）界面：导入本地文本 → 自动建向量库 → 基于文档回答问题。
// 全程本地：文档只存本机 IndexedDB，嵌入走本机 Ollama，回答走用户已添加的本地对话模型。

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Upload, Trash2, Loader2, Info, Search } from 'lucide-react'
import {
  isDocQAAvailable, addDocument, listDocuments, deleteDocument,
  embedText, searchChunks, buildContextPrompt, filterEmbeddingModels, shouldWarnEmbed, type DocInfo,
} from '../core/docQA'
import { detectModelCapability } from '../core/modelCapability'
import { isServiceEnabled } from '../core/localServicesSettings'
import { fetchLocalModels } from '../core/localServices'
import { decryptSecret, getBiometricPassword } from '../core/crypto'
import { callChat } from '../core/providerCall'
import { globalReasoningEffort } from '../data/engines'
import type { Account, AppSettings } from '../core/types'

export function DocQAView({ accounts, sessionPwd, onUnlock, notify, thinkingMode, settings }: {
  accounts: Account[]; sessionPwd: string; onUnlock: (pwd: string) => void; notify: (m: string) => void; thinkingMode?: boolean; settings?: AppSettings
}) {
  const supported = isDocQAAvailable()
  const [docs, setDocs] = useState<DocInfo[]>([])
  const [ importing, setImporting] = useState(false)
  const [ progress, setProgress] = useState('')
  const [ question, setQuestion] = useState('')
  const [ answering, setAnswering] = useState(false)
  const [ answer, setAnswer] = useState('')
  const [ sources, setSources] = useState<string[]>([])
  const [ pwdInput, setPwdInput] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // 本地服务开关：设置页关闭 Ollama 时文档问答整体不可用
  const serviceOn = isServiceEnabled(settings, 'ollama')

  // 本地 Ollama 网关：取任一本地账户的 apiUrl；嵌入模型可选
  const localAccounts = useMemo(() => accounts.filter(a => a.providerId?.startsWith('local-') && a.apiUrl), [accounts])
  const chatAccount = useMemo(() => localAccounts.find(a => {
    const cap = a.modelCapability ?? detectModelCapability(a.label).capability
    return cap === 'chat' || cap === 'translation' || cap === 'unknown'
  }), [localAccounts])
  const baseUrl = chatAccount?.apiUrl ?? ''
  const accountEmbedModel = localAccounts.find(a => detectModelCapability(a.label).capability === 'embedding')?.label
  const [embedChoice, setEmbedChoice] = useState<string>(() => accountEmbedModel ?? 'nomic-embed-text')
  // 已安装的嵌入类模型列表（从本机拉取，供下拉选择 + 未安装检测）
  const [embedModels, setEmbedModels] = useState<string[]>([])
  const [embedChecked, setEmbedChecked] = useState(false)

  // baseUrl 就绪时拉取本机模型，筛出嵌入类
  useEffect(() => {
    if (!baseUrl || !serviceOn) { setEmbedModels([]); setEmbedChecked(false); return }
    let alive = true
    void fetchLocalModels('ollama', baseUrl).then(r => {
      if (!alive) return
      setEmbedModels(r.ok ? filterEmbeddingModels(r.models) : [])
      setEmbedChecked(r.ok)
    })
    return () => { alive = false }
  }, [baseUrl, serviceOn])
  // 账户嵌入模型变化时同步到选择
  useEffect(() => { if (accountEmbedModel) setEmbedChoice(accountEmbedModel) }, [accountEmbedModel])
  const embedModel = embedChoice
  // 警告：成功拉取过模型列表就提示（列表为空说明可能没装嵌入模型）
  const embedWarn = shouldWarnEmbed(embedChecked, embedModels, embedModel)
  // 禁用：只有在明确拉到模型列表、且其中确实有嵌入模型但不含所选时才拦（避免筛不全误伤）
  const embedInstalled = !embedWarn || embedModels.length === 0

  useEffect(() => { void refreshDocs() }, [])

  const refreshDocs = async () => {
    try { setDocs(await listDocuments()) } catch { setDocs([]) }
  }

  const importFile = async (file: File) => {
    if (!serviceOn) { notify('请先在「设置 → 本地模型服务」开启 Ollama'); return }
    if (!baseUrl) { notify('请先在「添加账户」里添加一个本地模型（如 llama3.2 / qwen），文档问答需要本机服务'); return }
    if (!embedInstalled) { notify(`本机未安装嵌入模型 ${embedModel}，请先执行：ollama pull ${embedModel}`); return }
    setImporting(true); setProgress('读取文件…')
    try {
      const text = await file.text()
      const docId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setProgress('生成向量并入库…')
      const count = await addDocument({
        docId, name: file.name, text, baseUrl, embedModel,
        onProgress: (done, total) => setProgress(`已处理 ${done}/${total} 块`),
      })
      notify(`已导入「${file.name}」，切分 ${count} 块`)
      await refreshDocs()
    } catch (e) {
      notify(`导入失败：${(e as Error)?.message ?? String(e)}`)
    } finally { setImporting(false); setProgress('') }
  }

  const ask = async () => {
    const q = question.trim()
    if (!serviceOn) { notify('请先在「设置 → 本地模型服务」开启 Ollama'); return }
    if (!q) { notify('请输入问题'); return }
    if (!docs.length) { notify('请先导入文档'); return }
    if (!embedInstalled) { notify(`本机未安装嵌入模型 ${embedModel}，请先执行：ollama pull ${embedModel}`); return }
    if (!chatAccount?.encryptedKey) { notify('请先在「添加账户」里添加一个本地对话模型'); return }
    const pwd = getBiometricPassword() || sessionPwd || pwdInput
    if (!pwd) { notify('请输入主密码以调用本地模型（本次会话只需一次）'); return }
    setAnswering(true); setAnswer(''); setSources([])
    try {
      const qVec = await embedText(baseUrl, embedModel, q)
      const hits = await searchChunks(qVec, 3)
      if (!hits.length) { notify('知识库为空，请先导入文档'); return }
      const prompt = buildContextPrompt(q, hits)
      const apiKey = await decryptSecret(chatAccount.encryptedKey, pwd)
      if (pwdInput && pwdInput === pwd) { onUnlock(pwd); setPwdInput('') }
      const r = await callChat(chatAccount, apiKey, [{ role: 'user', content: prompt }], undefined, globalReasoningEffort(thinkingMode))
      if (!r.ok) { notify(r.error ?? '回答失败'); return }
      setAnswer(r.text)
      setSources([...new Set(hits.map(h => h.chunk.docName))])
    } catch (e) {
      notify(`回答失败：${(e as Error)?.message ?? String(e)}`)
    } finally { setAnswering(false) }
  }

  if (!supported) {
    return <div className="docqa-empty"><Info size={16} /> 本地文档问答仅在桌面端可用（需要本机 Ollama 生成向量）。Web / 手机端请使用桌面版。</div>
  }

  return (
    <div className="docqa">
      <div className="docqa-intro">
        <Info size={14} />
        <span>导入本地文本（.txt / .md / .csv 等），追问其中的内容。文档与向量只存本机，嵌入用 <b>{embedModel}</b>，回答用 <b>{chatAccount?.label ?? '本地对话模型'}</b>。</span>
      </div>

      {!serviceOn && (
        <div className="docqa-warn">本地服务已关闭，文档问答不可用。请到「设置 → 本地模型服务 → Ollama」开启后再使用。</div>
      )}

      {serviceOn && !chatAccount && (
        <div className="docqa-warn">尚未添加本地对话模型。文档问答需要：① 一个对话模型（如 llama3.2:3b）用于回答；② 嵌入模型（如 nomic-embed-text）用于检索。请到「API Key 管理 → 添加账户 → 本地模型」添加。</div>
      )}

      {serviceOn && chatAccount && (
        <div className="docqa-model-row">
          <label>嵌入模型</label>
          {embedModels.length > 0 ? (
            <select className="select" value={embedModel} onChange={e => setEmbedChoice(e.target.value)} disabled={importing || answering}>
              {Array.from(new Set([...embedModels, embedChoice])).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input className="input" value={embedModel} onChange={e => setEmbedChoice(e.target.value)} placeholder="嵌入模型名" disabled={importing || answering} />
          )}
        </div>
      )}

      {serviceOn && chatAccount && embedWarn && (
        <div className="docqa-warn">本机未检测到嵌入模型 <b>{embedModel}</b>。请在终端执行 <code>ollama pull {embedModel}</code> 安装后重试，或在上方可选列表里换一个已安装的嵌入模型。</div>
      )}

      <div className="docqa-section">
        <div className="docqa-section-title"><Upload size={14} /> 知识库文档 <span className="hint">{docs.length}</span></div>
        <input ref={fileRef} type="file" accept=".txt,.md,.csv,.json,.log,.text" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = '' }} />
        <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={importing || !serviceOn || !chatAccount || !embedInstalled}>{importing ? <Loader2 size={13} className="spin" /> : <Upload size={13} />} {importing ? (progress || '导入中…') : '导入文本文档'}</button>
        {docs.length > 0 && (
          <div className="docqa-docs">
            {docs.map(d => (
              <div className="docqa-doc" key={d.docId}>
                <FileText size={14} /><span className="doc-name">{d.name}</span><span className="doc-meta">{d.chunkCount} 块</span>
                <button className="icon-btn" title="删除" onClick={async () => { await deleteDocument(d.docId); await refreshDocs(); notify('已删除文档') }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="docqa-section">
        <div className="docqa-section-title"><Search size={14} /> 提问</div>
        <div className="docqa-ask-row">
          <input className="input" placeholder="针对文档提问，例如：怎么重置密码？" value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void ask() }} />
          <button className="btn sm primary" onClick={() => void ask()} disabled={answering || !docs.length || !serviceOn || !embedInstalled}>{answering ? '思考中…' : '提问'}</button>
        </div>
        {!getBiometricPassword() && !sessionPwd && (
          <input className="input" style={{ marginTop: 8 }} type="password" placeholder="主密码（调用本地模型，本次会话只需一次）" value={pwdInput} onChange={e => setPwdInput(e.target.value)} />
        )}
        {(answer || sources.length > 0) && (
          <div className="docqa-answer">
            <div className="docqa-answer-label">回答</div>
            <div className="docqa-answer-text">{answer || '…'}</div>
            {sources.length > 0 && <div className="docqa-sources">来源：{sources.join('、')}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
