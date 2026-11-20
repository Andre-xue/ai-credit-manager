// 本地文档问答（RAG）界面：导入本地文本 → 自动建向量库 → 基于文档回答问题。
// 全程本地：文档只存本机 IndexedDB，嵌入走本机 Ollama，回答走用户已添加的本地对话模型。

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Upload, Loader2, Info, Search } from 'lucide-react'
import { HoldToConfirm } from './HoldToConfirm'
import { ServiceSwitch } from './ServiceSwitch'
import type { ServiceController } from '../core/useServiceController'
import {
  isDocQAAvailable, addDocument, addDocumentTextOnly, listDocuments, deleteDocument,
  embedText, searchChunks, searchChunksByKeyword, buildContextPrompt, filterEmbeddingModels, shouldWarnEmbed, type DocInfo,
} from '../core/docQA'
import { detectModelCapability, capabilityChatCapable } from '../core/modelCapability'
import { categoryFromNote, isVoiceConfigAccount } from '../core/modelCategories'
import { isServiceEnabled } from '../core/localServicesSettings'
import { fetchLocalModels, detectLocalServices } from '../core/localServices'
import { filterAssistantModelNames, callChat, callLocalChat, fetchProviderModels } from '../core/providerCall'
import { decryptSecret, getBiometricPassword } from '../core/crypto'
import { needsBinaryParse, parseBinaryDocument } from '../core/documentParse'
import { globalReasoningEffort, enginesFor, enginesFromRemote } from '../data/engines'
import type { Account, AppSettings } from '../core/types'

type ServiceType = 'cloud' | 'local'

export function DocQAView({ accounts, sessionPwd, onUnlock, notify, thinkingMode, settings, serviceController }: {
  accounts: Account[]; sessionPwd: string; onUnlock: (pwd: string) => void; notify: (m: string) => void; thinkingMode?: boolean; settings?: AppSettings; serviceController?: ServiceController
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

  // Ollama 服务开关状态（嵌入始终依赖本机 Ollama；本地回答模式也依赖它）
  const serviceOn = isServiceEnabled(settings, 'ollama')

  // ===== 回答模型：云端 / 本地 双模式 =====
  const [serviceType, setServiceType] = useState<ServiceType>(() => (serviceOn ? 'local' : 'cloud'))
  // Ollama 关闭时只保留云端：若当前停在「本地」自动切回云端
  useEffect(() => { if (!serviceOn) setServiceType('cloud') }, [serviceOn])
  // 云端账户：API Key 管理里「通用型/对话型/文本型(归入通用)」分类、且能聊天的模型
  const cloudAccounts = useMemo(() => accounts.filter(a => {
    if (a.providerId?.startsWith('local-') || isVoiceConfigAccount(a.providerId, a.note)) return false
    const cat = categoryFromNote(a.note)
    if (cat !== '通用型' && cat !== '对话型') return false
    const cap = a.modelCapability ?? detectModelCapability(a.label).capability
    return capabilityChatCapable(cap)
  }), [accounts])
  const [cloudAccountId, setCloudAccountId] = useState('')
  const cloudAccount = cloudAccounts.find(a => a.id === cloudAccountId) ?? cloudAccounts[0] ?? null
  const [cloudEngineId, setCloudEngineId] = useState('')
  const [remoteEngines, setRemoteEngines] = useState<string[] | null>(null)
  const [loadingCloudEngines, setLoadingCloudEngines] = useState(false)
  // 选中云端账户后：解密 Key 拉取该账户真实可用的引擎（/v1/models）；失败回退内置目录
  useEffect(() => {
    let alive = true
    setRemoteEngines(null)
    if (!cloudAccount) return () => { alive = false }
    const acct = cloudAccount
    const pwd = getBiometricPassword() || sessionPwd
    if (!acct.encryptedKey || !pwd) return () => { alive = false }
    ;(async () => {
      setLoadingCloudEngines(true)
      try {
        const key = await decryptSecret(acct.encryptedKey!, pwd)
        const ids = await fetchProviderModels(acct, key)
        if (alive) setRemoteEngines(ids)
      } catch { /* 拉取失败 → 下方回退内置目录 */ }
      finally { if (alive) setLoadingCloudEngines(false) }
    })()
    return () => { alive = false }
  }, [cloudAccount, sessionPwd])
  // 引擎列表：动态拉取优先，内置目录兜底
  const cloudEngines = useMemo(() => {
    if (!cloudAccount) return []
    if (remoteEngines?.length) return enginesFromRemote(cloudAccount.providerId, remoteEngines)
    return enginesFor(cloudAccount.providerId)
  }, [cloudAccount, remoteEngines])
  useEffect(() => {
    setCloudEngineId(prev => cloudEngines.some(e => e.id === prev) ? prev : (cloudEngines.find(e => e.flagship)?.id ?? cloudEngines[0]?.id ?? ''))
  }, [cloudEngines])
  // 云端账户变化时同步选中
  useEffect(() => {
    if (cloudAccounts.length && !cloudAccounts.some(a => a.id === cloudAccountId)) setCloudAccountId(cloudAccounts[0].id)
  }, [cloudAccounts, cloudAccountId])

  // ===== 本机 Ollama：回答模型 + 嵌入模型统一拉取（默认地址优先，探测仅校准）=====
  const [ollamaBase, setOllamaBase] = useState('http://127.0.0.1:11434')
  const [localModels, setLocalModels] = useState<string[]>([])
  const [localModel, setLocalModel] = useState('')
  const [embedModels, setEmbedModels] = useState<string[]>([])
  const [loadingLocal, setLoadingLocal] = useState(false)      // 回答模型加载中
  const [embedLoading, setEmbedLoading] = useState(false)      // 嵌入模型探测中
  const [localLoadFailed, setLocalLoadFailed] = useState(false)
  const [embedLoadFailed, setEmbedLoadFailed] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)              // 手动重试计数

  useEffect(() => {
    let alive = true
    if (!serviceOn) {
      setLocalModels([]); setLocalModel(''); setEmbedModels([])
      setLoadingLocal(false); setEmbedLoading(false)
      setLocalLoadFailed(false); setEmbedLoadFailed(false)
      return
    }
    setLoadingLocal(true); setEmbedLoading(true)
    setLocalLoadFailed(false); setEmbedLoadFailed(false)
    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
    ;(async () => {
      // Ollama 默认端口固定为 11434；走 fetch_local_models 直连命令（已验证可靠），不依赖 /v1/models 代理
      const base = 'http://127.0.0.1:11434'
      setOllamaBase(base)
      // 1) 一次拉取全部模型名，本地过滤出「回答模型」与「嵌入模型」两类（不重复请求）
      try {
        const r = await withTimeout(fetchLocalModels('ollama', base), 12000)
        if (!alive) return
        if (!r.ok) throw new Error(r.error ?? '拉取失败')
        const all = r.models
        const [answerIds, embedIds] = await Promise.all([
          filterAssistantModelNames(base, all),
          Promise.resolve(filterEmbeddingModels(all)),
        ])
        setLocalModels(answerIds)
        setLocalModel(prev => answerIds.includes(prev) ? prev : (answerIds[0] ?? ''))
        setEmbedModels(embedIds)
        setLocalLoadFailed(false); setEmbedLoadFailed(false)
      } catch {
        if (alive) {
          setLocalModels([]); setLocalModel(''); setEmbedModels([])
          setLocalLoadFailed(true); setEmbedLoadFailed(true)
        }
      } finally { if (alive) { setLoadingLocal(false); setEmbedLoading(false) } }
      // 2) 后台探测地址，仅当探测到不同地址时校准并重试一次
      try {
        const r = await withTimeout(detectLocalServices(), 8000)
        if (!alive) return
        const hit = r.services.find(s => /ollama/i.test(s.service))
        if (hit?.url && hit.url.replace(/\/+$/, '') !== base) {
          setOllamaBase(hit.url)
          const r2 = await withTimeout(fetchLocalModels('ollama', hit.url), 12000)
          if (alive && r2.ok) {
            const all = r2.models
            const [answerIds, embedIds] = await Promise.all([
              filterAssistantModelNames(hit.url, all), Promise.resolve(filterEmbeddingModels(all)),
            ])
            if (answerIds.length) { setLocalModels(answerIds); setLocalModel(answerIds[0]); setLocalLoadFailed(false) }
            if (embedIds.length) { setEmbedModels(embedIds); setEmbedLoadFailed(false) }
          }
        }
      } catch { /* 探测失败不影响默认地址拉取结果 */ }
    })()
    return () => { alive = false }
  }, [serviceOn, reloadTick])

  // 自动选中：优先第一个探测到的嵌入模型，否则保持默认名（用于未安装提示）
  const embedModel = embedModels[0] ?? 'nomic-embed-text'
  const embedChecked = embedModels.length > 0 || embedLoadFailed  // 探测完成（有模型或明确失败）才算 checked
  const embedWarn = shouldWarnEmbed(embedChecked && !embedLoadFailed, embedModels, embedModel)
  const embedInstalled = !embedWarn || embedModels.length === 0
  // 是否用向量检索：Ollama 开着且嵌入可用时用向量，否则降级关键词检索（云端模式因此可脱离 Ollama）
  const useVector = serviceOn && embedInstalled
  // 导入/提问就绪：云端模式脱离 Ollama 也可用（关键词检索），本地模式需 Ollama 嵌入就绪
  const embeddingReady = serviceType === 'cloud' || useVector
  const answerReady = serviceType === 'cloud' ? !!cloudAccount : (serviceOn && !!localModel)

  useEffect(() => { void refreshDocs() }, [])

  const refreshDocs = async () => {
    try { setDocs(await listDocuments()) } catch { setDocs([]) }
  }

  const importFile = async (file: File) => {
    if (serviceType === 'local' && !serviceOn) { notify('本地模式需要本机 Ollama 生成向量，请先开启服务或切换到云端模式'); return }
    if (useVector && !embedInstalled) { notify(`本机未安装嵌入模型 ${embedModel}，请先执行：ollama pull ${embedModel}`); return }
    setImporting(true); setProgress('读取文件…')
    try {
      // docx/pdf 是二进制，必须走本地解析；纯文本直接读。否则会把 zip 乱码入库，检索不到内容
      let text: string
      if (needsBinaryParse(file.name)) {
        const parsed = await parseBinaryDocument(file.name, await file.arrayBuffer())
        text = parsed.text
      } else {
        text = await file.text()
      }
      if (!text.trim()) { notify('文档内容为空或无可提取文字（扫描版 PDF 需先 OCR）'); return }
      const docId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setProgress(useVector ? '生成向量并入库…' : '切分文本并入库（关键词检索模式）…')
      const count = useVector
        ? await addDocument({ docId, name: file.name, text, baseUrl: ollamaBase, embedModel, onProgress: (done, total) => setProgress(`已处理 ${done}/${total} 块`) })
        : await addDocumentTextOnly({ docId, name: file.name, text, onProgress: (done, total) => setProgress(`已处理 ${done}/${total} 块`) })
      notify(`已导入「${file.name}」，切分 ${count} 块`)
      await refreshDocs()
    } catch (e) {
      notify(`导入失败：${(e as Error)?.message ?? String(e)}`)
    } finally { setImporting(false); setProgress('') }
  }

  const ask = async () => {
    const q = question.trim()
    if (!q) { notify('请输入问题'); return }
    if (!docs.length) { notify('请先导入文档'); return }
    if (!embeddingReady) { notify('请先开启 Ollama 服务并确认嵌入模型已安装'); return }
    if (!answerReady) {
      notify(serviceType === 'cloud' ? '请先在 API Key 管理添加「通用型/对话型」模型账户' : '请先开启 Ollama 服务并等待本地模型加载'); return
    }
    setAnswering(true); setAnswer(''); setSources([])
    try {
      const hits = useVector
        ? await searchChunks(await embedText(ollamaBase, embedModel, q), 3, q)
        : await searchChunksByKeyword(q, 3)
      if (!hits.length) { notify('知识库为空或未匹配到相关内容，请先导入文档'); return }
      const prompt = buildContextPrompt(q, hits)
      const msgs = [{ role: 'user', content: prompt }]
      if (serviceType === 'cloud') {
        // 云端回答：用账户 Key + 选定引擎
        const acct = cloudAccount!
        const pwd = getBiometricPassword() || sessionPwd || pwdInput
        if (!acct.encryptedKey || !pwd) { notify('请输入主密码以调用云端模型（本次会话只需一次）'); return }
        const apiKey = await decryptSecret(acct.encryptedKey, pwd)
        if (pwdInput && pwdInput === pwd) { onUnlock(pwd); setPwdInput('') }
        const r = await callChat(acct, apiKey, msgs, cloudEngineId || undefined, globalReasoningEffort(thinkingMode))
        if (!r.ok) { notify(r.error ?? '回答失败'); return }
        setAnswer(r.text)
      } else {
        // 本地回答：直接调本机 Ollama，无需 Key
        const r = await callLocalChat(ollamaBase, localModel, msgs)
        if (!r.ok) { notify(r.error ?? '回答失败'); return }
        setAnswer(r.text)
      }
      setSources([...new Set(hits.map(h => h.chunk.docName))])
    } catch (e) {
      notify(`回答失败：${(e as Error)?.message ?? String(e)}`)
    } finally { setAnswering(false) }
  }

  if (!supported) {
    return <div className="docqa-empty"><Info size={16} /> 本地文档问答仅在桌面端可用（需要本机 Ollama 生成向量）。Web / 手机端请使用桌面版。</div>
  }

  const answerLabel = serviceType === 'cloud'
    ? `${cloudAccount?.label ?? '云端模型'}${cloudEngineId ? ` · ${cloudEngines.find(e => e.id === cloudEngineId)?.name ?? cloudEngineId}` : ''}`
    : (localModel || '本地对话模型')

  return (
    <div className="docqa">
      <div className="docqa-intro">
        <Info size={14} />
        <span>导入本地文本（.txt / .md / .csv 等），追问其中的内容。文档只存本机；检索方式：{useVector ? <>向量（<b>{embedModel}</b>）</> : '关键词匹配'}，回答用 <b>{answerLabel}</b>。</span>
      </div>

      {/* Ollama 服务开关：向量化与本地回答都依赖它 */}
      {serviceController && <div className="docqa-service-bar">
        <span className="docqa-service-hint">本地服务</span>
        <ServiceSwitch controller={serviceController} serviceKey="ollama" />
        <span className="docqa-service-note">开启 Ollama 可用向量检索；关闭后云端模式自动改用关键词检索，仍可正常使用。</span>
      </div>}

      {/* 回答模型配置：服务类型 / 模型 / 引擎（云端）/ 嵌入（本地+Ollama） */}
      <div className="docqa-config">
        <div className="docqa-config-row">
          <div className="tr-field">
            <label>服务类型</label>
            <select className="select" value={serviceType} onChange={e => setServiceType(e.target.value as ServiceType)} disabled={importing || answering}>
              <option value="cloud">☁️ 云端模型</option>
              {serviceOn && <option value="local">🖥️ 本地模型</option>}
            </select>
          </div>
          <div className="tr-field">
            <label>回答模型</label>
            {serviceType === 'cloud' ? (
              <select className="select" value={cloudAccount?.id ?? ''} onChange={e => setCloudAccountId(e.target.value)} disabled={importing || answering}>
                {cloudAccounts.length === 0 && <option value="">请先在 API Key 管理添加通用/对话型账户</option>}
                {cloudAccounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            ) : (
              <select className="select" value={localModel} onChange={e => setLocalModel(e.target.value)} disabled={importing || answering || !serviceOn || localModels.length === 0}>
                {localModels.length === 0 && <option value="">{loadingLocal ? '加载本地模型中…' : (localLoadFailed ? '连接失败，请点右侧重试' : (!serviceOn ? '请先开启 Ollama 服务' : '未找到可用模型，请先 ollama pull'))}</option>}
                {localModels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
          </div>
          {/* 模型引擎：仅云端，选中账户后自动拉取该账户真实引擎（失败回退内置目录），不可手填 */}
          {serviceType === 'cloud' && (
            <div className="tr-field">
              <label>模型引擎</label>
              <select className="select" value={cloudEngineId} onChange={e => setCloudEngineId(e.target.value)} disabled={importing || answering || cloudEngines.length === 0}>
                {cloudEngines.length === 0 && <option value="">{loadingCloudEngines ? '正在获取引擎…' : (cloudAccount ? '该账户暂无可用引擎' : '请先选择回答模型')}</option>}
                {cloudEngines.map(e => <option key={e.id} value={e.id}>{e.name}{e.tag ? ` · ${e.tag}` : ''}</option>)}
              </select>
            </div>
          )}
          {/* 嵌入模型：自动获取本机嵌入类模型，只读不可手改 */}
          {serviceType === 'local' && serviceOn && (
            <div className="tr-field">
              <label>
                嵌入模型（自动获取，本地检索辅助）
                <button className="docqa-reload-btn" onClick={() => setReloadTick(t => t + 1)} disabled={loadingLocal || embedLoading} title="重新探测本机模型">↻ 重试</button>
              </label>
              <span className="docqa-embed-readonly" title="由本机 Ollama 自动探测，不可手动修改">
                {embedModels.length ? embedModel : (embedLoading ? '探测中…' : (embedLoadFailed ? '连接失败，请点「重试」' : '未检测到嵌入模型'))}
              </span>
            </div>
          )}
        </div>
        {serviceType === 'local' && serviceOn && embedWarn && (
          <div className="docqa-warn">本机未检测到嵌入模型 <b>{embedModel}</b>。请在终端执行 <code>ollama pull {embedModel}</code> 安装后重试。嵌入模型由本机自动探测，安装后刷新即可。</div>
        )}
        {serviceType === 'local' && !serviceOn && (
          <div className="docqa-warn">本地模式需要本机 Ollama 服务。请先开启顶部 Ollama 开关，或切换到「云端模型」使用关键词检索（无需 Ollama）。</div>
        )}
        {serviceType === 'cloud' && !serviceOn && (
          <div className="docqa-hint-line">云端模式无需 Ollama：文档将以关键词检索方式入库与检索。开启 Ollama 后可获得更精准的向量检索。</div>
        )}
      </div>

      <div className="docqa-section">
        <div className="docqa-section-title"><Upload size={14} /> 知识库文档 <span className="hint">{docs.length}</span></div>
        <input ref={fileRef} type="file" accept=".txt,.md,.csv,.json,.log,.text,.docx,.pdf" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = '' }} />
        <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={importing || !embeddingReady}>{importing ? <Loader2 size={13} className="spin" /> : <Upload size={13} />} {importing ? (progress || '导入中…') : '导入文本文档'}</button>
        {docs.length > 0 && (
          <div className="docqa-docs">
            {docs.map(d => (
              <div className="docqa-doc" key={d.docId}>
                <FileText size={14} /><span className="doc-name">{d.name}</span><span className="doc-meta">{d.chunkCount} 块</span>
                <HoldToConfirm title="删除文档" onConfirm={() => void (async () => { await deleteDocument(d.docId); await refreshDocs(); notify('已删除文档') })()} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="docqa-section">
        <div className="docqa-section-title"><Search size={14} /> 提问</div>
        <div className="docqa-ask-row">
          <input className="input" placeholder="针对文档提问，例如：怎么重置密码？" value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void ask() }} />
          <button className="btn sm primary" onClick={() => void ask()} disabled={answering || !docs.length || !embeddingReady || !answerReady}>{answering ? '思考中…' : '提问'}</button>
        </div>
        {serviceType === 'cloud' && !getBiometricPassword() && !sessionPwd && (
          <input className="input" style={{ marginTop: 8 }} type="password" placeholder="主密码（调用云端模型，本次会话只需一次）" value={pwdInput} onChange={e => setPwdInput(e.target.value)} />
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
