// AI 翻译模块：文件拖入/粘贴导入 → 分类 → 翻译（自己的模型 / 免费公共 API）→
// 双语布局（3 种，可多选）→ 导出（TXT / MD / HTML / PDF打印）。全平台适用。

import { useEffect, useMemo, useRef, useState } from 'react'
import { Languages, Upload, FileText, Image as ImageIcon, Archive, Loader2, Download, Printer, Check, Info, RefreshCw, Radar } from 'lucide-react'
import {
  categorizeFile, translateText, alignPairs,
  buildHtml, buildPlain, buildPrintHtml, layoutName, layoutSuffix, TARGET_LANGUAGES, SOURCE_LANGUAGES, FREE_ENGINES,
  type TranslateFile, type TranslateEngine, type FreeEngine, type BilingualLayout, type ExportFormat,
} from '../core/translate'
import { fetchLocalChatModels } from '../core/providerCall'
import { detectLocalServices } from '../core/localServices'
import { HoldToConfirm } from './HoldToConfirm'
import { chooseBackupFolder } from '../core/keyBackup'
import { isDesktopApp } from '../core/openExternal'
import {
  readFilesFromPaths, readFilesFromDataTransfer, readOneFile, onTauriFileDrop,
  type ImportedFile,
} from '../core/fileImport'
import { detectModelCapability, capabilityChatCapable } from '../core/modelCapability'
import { isVoiceConfigAccount, categoryFromNote } from '../core/modelCategories'
import { isAccountServiceEnabled, LOCAL_SERVICE_CHANGED_EVENT } from '../core/localServicesSettings'
import { needsBinaryParse, parseBinaryDocument } from '../core/documentParse'
import { buildDocxBlob, DOCX_MIME } from '../core/docxExport'
import { ocrImage, ocrToParagraphs, renderTranslatedImage } from '../core/imageOcr'
import { ServiceSwitch } from './ServiceSwitch'
import type { ServiceController } from '../core/useServiceController'
import type { Account, AppSettings } from '../core/types'

interface TransResult {
  name: string
  source: string
  translated: string
  isImage?: boolean
  originalImage?: string  // 原图 data URL（图片 OCR 用）
}

interface Props {
  accounts: Account[]
  notify: (m: string) => void
  settings?: AppSettings
  serviceController?: ServiceController
}

const LAYOUTS: BilingualLayout[] = ['side-by-side', 'interleaved', 'stacked']
const CATEGORY_ICON = { document: FileText, image: ImageIcon, archive: Archive, other: FileText }
const CATEGORY_LABEL = { document: '文档', image: '图片', archive: '压缩包', other: '其他' }

export function TranslationView({ accounts, notify, settings, serviceController }: Props) {
  const [files, setFiles] = useState<TranslateFile[]>([])
  const [engine, setEngine] = useState<TranslateEngine>('free')
  const [freeEngine, setFreeEngine] = useState<FreeEngine>('google')
  const [source, setSource] = useState('auto')
  const [accountId, setAccountId] = useState('')
  const [target, setTarget] = useState('zh-CN')
  const [bilingual, setBilingual] = useState(true)
  const [layouts, setLayouts] = useState<BilingualLayout[]>(['side-by-side'])
  const [format, setFormat] = useState<ExportFormat | 'pdf' | 'docx'>('html')
  const [exportDir, setExportDir] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState<TransResult[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const printRef = useRef<HTMLIFrameElement>(null)

  // 本地翻译引擎配置：地址由后台自动探测（不可手改），只列可翻译文本模型
  const [localBase, setLocalBase] = useState('')  // 探测到 Ollama 服务地址
  const [detectingLocal, setDetectingLocal] = useState(false)
  const [localModels, setLocalModels] = useState<string[]>([])
  const [localModel, setLocalModel] = useState('')
  const [loadingLocalModels, setLoadingLocalModels] = useState(false)
  // Ollama 服务是否开启（与顶部开关联动）
  const ollamaEnabled = settings?.localServices?.ollama !== false
  // 服务关闭时（无论来源）：引擎停在 local 就切回免费，并清空本地模型
  useEffect(() => {
    if (!ollamaEnabled) {
      setLocalModels([]); setLocalModel('')
      setEngine(prev => prev === 'local' ? 'free' : prev)
    }
  }, [ollamaEnabled])  // 关闭 Ollama 时：清空本地模型列表并切回免费引擎；开启时重新探测地址
  useEffect(() => {
    const onChanged = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; enabled: boolean }>).detail
      if (d?.key !== 'ollama') return
      if (!d.enabled) {
        setLocalModels([]); setLocalModel(''); setLocalBase('')
        setEngine(prev => prev === 'local' ? 'free' : prev)
      }
    }
    window.addEventListener(LOCAL_SERVICE_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(LOCAL_SERVICE_CHANGED_EVENT, onChanged)
  }, [])
  // 开启且未探测到地址时自动探测本机 Ollama 地址
  useEffect(() => {
    if (!ollamaEnabled || localBase) return
    let alive = true
    setDetectingLocal(true)
    void detectLocalServices().then(r => {
      if (!alive) return
      const ollama = r.services.find(s => /ollama/i.test(s.service))
      if (ollama) setLocalBase(ollama.url)
      setDetectingLocal(false)
    }).catch(() => { if (alive) setDetectingLocal(false) })
    return () => { alive = false }
  }, [ollamaEnabled, localBase])
  const loadLocalModels = async () => {
    if (!ollamaEnabled) { setLocalModels([]); setLocalModel(''); notify('请先开启顶部 Ollama 服务'); return }
    if (!localBase) { notify('未探测到本地 Ollama 服务，请先启动 Ollama 后再点探测'); return }
    setLoadingLocalModels(true)
    try {
      const ids = await fetchLocalChatModels(localBase)
      setLocalModels(ids)
      setLocalModel(prev => ids.includes(prev) ? prev : (ids[0] ?? ''))
      notify(`已找到 ${ids.length} 个可用于翻译的本地文本模型`)
    } catch (e) { notify(`拉取本地模型失败：${(e as Error)?.message ?? String(e)}`) }
    finally { setLoadingLocalModels(false) }
  }

  // 可用于翻译的账户：排除语音配置、非文本模型、以及备注分类为生图型/视频型的账户
  // （同一服务商下不同用途的账户，按「备注/用途」分类过滤，避免把生图/视频账户混进翻译下拉）
  const usableAccounts = useMemo(() => accounts
    .filter(a => !!a.encryptedKey)
    .filter(a => !isVoiceConfigAccount(a.providerId, a.note))
    .filter(a => {
      const cat = categoryFromNote(a.note)
      return cat === '对话型' || cat === '通用型'  // 只留文本用途
    })
    .filter(a => {
      const stored = a.modelCapability
      const live = detectModelCapability(a.label).capability
      return capabilityChatCapable(live) && (stored === undefined || capabilityChatCapable(stored))
    })
    .filter(a => isAccountServiceEnabled(settings, a.providerId)), [accounts, settings])
  useEffect(() => {
    if (usableAccounts.length && !usableAccounts.some(a => a.id === accountId)) setAccountId(usableAccounts[0].id)
  }, [usableAccounts, accountId])

  // 统一导入：纯文本直读；docx/pdf 本地解析；图片存 dataUrl 待 OCR；压缩包跳过
  const ingestFiles = async (imported: ImportedFile[]) => {
    const added: TranslateFile[] = []
    for (const f of imported) {
      const category = categorizeFile(f.name)
      if (category === 'archive' || category === 'other') {
        notify(`「${f.name}」${category === 'archive' ? '是压缩包，需先解压再导入' : '暂不支持'}，本次跳过`)
        continue
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      if (category === 'image') {
        if (!f.dataUrl) { notify(`「${f.name}」图片读取失败，跳过`); continue }
        added.push({ id, name: f.name, category, text: '', source: f.dataUrl })
      } else if (needsBinaryParse(f.name)) {
        setProgress(`解析文档 ${f.name}…`)
        try {
          if (!f.arrayBuffer) throw new Error('未读到文件内容')
          const parsed = await parseBinaryDocument(f.name, f.arrayBuffer)
          if (!parsed.text) { notify(`「${f.name}」未提取到文字（可能是扫描件），跳过`); continue }
          added.push({ id, name: f.name, category, text: parsed.text })
        } catch (e) {
          notify(`「${f.name}」解析失败：${(e as Error)?.message ?? String(e)}`)
          continue
        }
      } else {
        added.push({ id, name: f.name, category, text: f.text })
      }
    }
    setProgress('')
    if (added.length) {
      setFiles(prev => [...prev, ...added])
      notify(`已导入 ${added.length} 个文件`)
    }
  }

  // Web/手机：从点击选择的 input 读取
  const addFiles = async (fileList: FileList | File[]) => {
    const added: ImportedFile[] = []
    for (const f of Array.from(fileList)) {
      try { added.push(await readOneFile(f)) } catch { notify(`「${f.name}」读取失败`) }
    }
    void ingestFiles(added)
  }

  const doTranslate = async () => {
    if (!files.length) { notify('请先导入文件'); return }
    if (engine === 'account' && !accountId) { notify('请先在 API Key 管理添加模型账户'); return }
    if (engine === 'local' && (!localBase.trim() || !localModel.trim())) { notify('请先设置本地服务地址并拉取/填写翻译模型'); return }
    const account = usableAccounts.find(a => a.id === accountId)
    const localOpts = { localBase: localBase.trim(), localModel: localModel.trim() }
    setTranslating(true)
    const out: TransResult[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        setProgress(`翻译中 ${i + 1}/${files.length}：${f.name}`)
        if (f.category === 'image' && f.source) {
          // 图片：云端视觉模型 OCR → 翻译识别出的文字
          try {
            const ocrText = await ocrImage(f.source, 'auto')
            const paras = ocrToParagraphs(ocrText)
            if (!paras.length) { notify(`「${f.name}」未识别到文字，跳过`); continue }
            const srcText = paras.join('\n\n')
            const translated = await translateText(srcText, {
              engine, account, target, source, freeEngine, ...localOpts,
              onProgress: (done, total) => setProgress(`翻译中 ${i + 1}/${files.length}：${f.name}（${done}/${total} 段）`),
            })
            out.push({ name: f.name, source: srcText, translated, isImage: true, originalImage: f.source })
          } catch (e) {
            notify(`「${f.name}」OCR 失败，已跳过：${(e as Error)?.message ?? String(e)}`)
          }
          continue
        }
        const translated = await translateText(f.text, {
          engine, account, target, source, freeEngine, ...localOpts,
          onProgress: (done, total) => setProgress(`翻译中 ${i + 1}/${files.length}：${f.name}（${done}/${total} 段）`),
        })
        out.push({ name: f.name, source: f.text, translated })
      }
      setResults(out)
      notify(`已完成 ${out.length} 个文件的翻译`)
    } catch (e) {
      notify(`翻译失败：${(e as Error)?.message ?? String(e)}`)
    } finally {
      setTranslating(false); setProgress('')
    }
  }

  const toggleLayout = (l: BilingualLayout) => {
    setLayouts(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l])
  }

  // 图片译文图跟随当前布局选择
  const activeLayoutsForImage: BilingualLayout[] = bilingual ? layouts : ['side-by-side']

  // 保存文件：桌面指定目录走 Tauri 写入，否则浏览器下载
  const saveFile = async (filename: string, content: string) => {
    if (isDesktopApp() && exportDir) {
      const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<string> } }
      const invoke = w.__TAURI_INTERNALS__?.invoke
      if (invoke) {
        const path = await invoke('write_file_to_dir', { dir: exportDir, filename, content: '\ufeff' + content })
        return path
      }
    }
    const blob = new Blob(['\ufeff' + content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return filename
  }

  // 保存二进制文件（docx / 图片）：桌面走 write_binary_to_dir，否则 Blob 下载
  const saveBinary = async (filename: string, data: Uint8Array | ArrayBuffer, mime: string) => {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    if (isDesktopApp() && exportDir) {
      const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<string> } }
      const invoke = w.__TAURI_INTERNALS__?.invoke
      if (invoke) {
        let bin = ''
        for (const b of bytes) bin += String.fromCharCode(b)
        await invoke('write_binary_to_dir', { dir: exportDir, filename, content_base64: btoa(bin) })
        return
      }
    }
    const blob = new Blob([bytes as BlobPart], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // 下载图片译文图（Canvas 生成，data URL）
  const downloadImage = (dataUrl: string, filename: string) => {
    const a = document.createElement('a'); a.href = dataUrl; a.download = filename; a.click()
  }

  const pickDir = async () => {
    if (!isDesktopApp()) { notify('Web / 手机端由浏览器自动下载到默认目录，无法自定义文件夹'); return }
    const dir = await chooseBackupFolder()
    if (dir) { setExportDir(dir); notify('已选择导出文件夹') }
  }

  const doExport = async () => {
    if (!results.length) { notify('请先翻译'); return }
    if (bilingual && layouts.length === 0) { notify('请至少选择一种双语布局，或关闭双语对照'); return }
    const activeLayouts: BilingualLayout[] = bilingual ? layouts : ['side-by-side']
    let count = 0
    try {
      // 每种布局单独一个文件（多选布局 = 多个文件）
      for (const r of results) {
        const pairs = alignPairs(r.source, r.translated)
        const base = r.name.replace(/\.[^.]+$/, '')
        for (const layout of activeLayouts) {
          const multi = activeLayouts.length > 1
          const suffix = multi ? `-${layoutSuffix(layout)}` : ''
          if (format === 'html') await saveFile(`${base}-译文${suffix}.html`, buildHtml(r.name, pairs, [layout]))
          else if (format === 'md') await saveFile(`${base}-译文${suffix}.md`, buildPlain(r.name, pairs, [layout], 'md'))
          else if (format === 'txt') await saveFile(`${base}-译文${suffix}.txt`, buildPlain(r.name, pairs, [layout], 'txt'))
          else if (format === 'docx') {
            const bytes = await buildDocxBlob(r.name, pairs, layout)
            await saveBinary(`${base}-译文${suffix}.docx`, bytes, DOCX_MIME)
          }
          count++
        }
      }
      notify(`已导出 ${count} 个文件（${results.length} 个文档 × ${activeLayouts.length} 种布局）`)
    } catch (e) {
      notify(`导出失败：${(e as Error)?.message ?? String(e)}`)
    }
  }

  const doPrintPdf = () => {
    if (!results.length) { notify('请先翻译'); return }
    const activeLayouts: BilingualLayout[] = bilingual ? layouts : ['side-by-side']
    const docs = results.map(r => ({ name: r.name, pairs: alignPairs(r.source, r.translated) }))
    const html = buildPrintHtml(docs, activeLayouts)
    // 用隐藏 iframe 打印：Tauri WebView 会拦截 window.open，但 iframe.contentWindow.print() 可用
    const iframe = printRef.current
    if (!iframe) return
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
        notify('已打开打印对话框，请在目标里选「另存为 PDF」')
      } catch {
        notify('打印失败：当前环境不支持直接打印，请改导出 HTML 后用浏览器打开打印')
      }
    }
    iframe.srcdoc = html
  }

  // 粘贴导入：文本 或 文件（剪贴板里的文件）
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const dt = e.clipboardData
      if (!dt) return
      // 优先处理粘贴的文件
      if (dt.files.length > 0) {
        e.preventDefault()
        const r = await readFilesFromDataTransfer(dt)
        if (r.skipped.length) notify(`已跳过 ${r.skipped.length} 个不支持的文件（仅纯文本文档可翻译）`)
        void ingestFiles(r.files)
        return
      }
      // 纯文本粘贴
      const text = dt.getData('text/plain')
      if (!text?.trim()) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      setFiles(prev => [...prev, { id: `paste-${Date.now()}`, name: `粘贴内容-${new Date().toLocaleTimeString('zh-CN')}.txt`, category: 'document', text }])
      notify('已粘贴文本内容，作为文档加入列表')
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [notify])

  // 桌面端：Tauri 原生文件拖放（WebView 会拦截 DOM drop，必须走此 API）
  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void onTauriFileDrop(async paths => {
      const r = await readFilesFromPaths(paths)
      if (cancelled) return
      if (r.skipped.length) notify(`已跳过 ${r.skipped.length} 个不支持的文件（仅纯文本文档可翻译）`)
      void ingestFiles(r.files)
    }).then(fn => { if (cancelled) fn(); else unlisten = fn })
    return () => { cancelled = true; unlisten?.() }
  }, [notify])

  return (
    <div className="translate-page">
      {serviceController && <div className="translate-service-bar">
        <span className="translate-service-hint">本地翻译服务</span>
        <ServiceSwitch controller={serviceController} serviceKey="ollama" />
        <Info size={13} /> <span>开启后可在本机翻译（无需联网）；关闭则只走云端引擎。开关与设置页同步。</span>
      </div>}
      <div className="translate-intro">
        <Info size={14} />
        <span>拖入/粘贴文件（txt/md/docx/pdf/图片）或直接粘贴文本，选择翻译引擎与目标语言，即可生成双语对照文件。docx/pdf 在本机解析，图片由云端视觉模型 OCR 识别文字后翻译（失败自动跳过）。</span>
      </div>

      <div
        className={`translate-drop ${dragOver ? 'over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false)
          // 桌面端由 Tauri 原生拖放监听处理，避免重复
          if (isDesktopApp()) return
          if (e.dataTransfer.files.length) {
            void readFilesFromDataTransfer(e.dataTransfer).then(r => {
              if (r.skipped.length) notify(`已跳过 ${r.skipped.length} 个不支持的文件`)
              void ingestFiles(r.files)
            })
          }
        }}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" multiple accept=".txt,.md,.markdown,.csv,.json,.log,.text,.xml,.yaml,.yml,.html,.htm,.docx,.pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp" style={{ display: 'none' }}
          onChange={e => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }} />
        <Upload size={22} />
        <b>拖入文件，或点击选择</b>
        <span>支持 txt/md/docx/pdf/图片；也可直接粘贴文本或文件</span>
      </div>

      {files.length > 0 && (
        <div className="translate-section">
          <div className="translate-section-title">待翻译文件 <span className="hint">{files.length}</span></div>
          <div className="translate-files">
            {files.map(f => {
              const Icon = CATEGORY_ICON[f.category]
              return (
                <div className="translate-file" key={f.id}>
                  <Icon size={15} />
                  <span className="tf-name" title={f.name}>{f.name}</span>
                  <span className="tag gray">{CATEGORY_LABEL[f.category]}</span>
                  <HoldToConfirm title="移除文件" onConfirm={() => setFiles(prev => prev.filter(x => x.id !== f.id))} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="translate-section">
        <div className="translate-section-title">翻译设置</div>
        <div className="translate-settings">
          <div className="tr-field">
            <label>翻译引擎</label>
            <select className="select" value={engine} onChange={e => setEngine(e.target.value as TranslateEngine)} disabled={translating}>
              <option value="free">免费公共 API（无需 Key）</option>
              <option value="account">我的模型账户</option>
              {ollamaEnabled && <option value="local">本地服务（Ollama）</option>}
            </select>
          </div>
          {engine === 'free' && (
            <div className="tr-field">
              <label>免费服务</label>
              <select className="select" value={freeEngine} onChange={e => setFreeEngine(e.target.value as FreeEngine)} disabled={translating}>
                {FREE_ENGINES.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
          {engine === 'account' && (
            <div className="tr-field">
              <label>模型账户</label>
              <select className="select" value={accountId} onChange={e => setAccountId(e.target.value)} disabled={translating}>
                {usableAccounts.length === 0 && <option value="">请先添加账户</option>}
                {usableAccounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
          )}
          {engine === 'local' && (
            <>
              <div className="tr-field">
                <label>本地服务地址（自动探测）</label>
                <div className="tr-local-row">
                  <span className="tr-local-url" title="地址由后台自动探测，不可手动修改">{detectingLocal ? '探测中…' : (localBase || '未探测到 Ollama 服务')}</span>
                  <button className="btn sm ghost" onClick={() => {
                    setDetectingLocal(true)
                    void detectLocalServices().then(r => {
                      const ollama = r.services.find(s => /ollama/i.test(s.service))
                      if (ollama) { setLocalBase(ollama.url); notify(`已探测到 Ollama：${ollama.url}`) }
                      else notify('未探测到本机 Ollama 服务，请先启动 Ollama')
                      setDetectingLocal(false)
                    }).catch(() => setDetectingLocal(false))
                  }} disabled={detectingLocal || translating} title="重新探测本机 Ollama 服务"><Radar size={13} className={detectingLocal ? 'spin' : ''} /> 探测</button>
                  <button className="btn sm ghost" onClick={() => void loadLocalModels()} disabled={loadingLocalModels || translating} title="拉取本地文本模型">
                    {loadingLocalModels ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} 拉取
                  </button>
                </div>
              </div>
              <div className="tr-field">
                <label>翻译模型（仅文本模型）</label>
                {localModels.length > 0 ? (
                  <select className="select" value={localModel} onChange={e => setLocalModel(e.target.value)} disabled={translating}>
                    {localModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input className="input" value={localModel} onChange={e => setLocalModel(e.target.value)} placeholder="先点「拉取」或手填模型名" disabled={translating} />
                )}
              </div>
            </>
          )}
          <div className="tr-field">
            <label>源语言</label>
            <select className="select" value={source} onChange={e => setSource(e.target.value)} disabled={translating}>
              {SOURCE_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
          <div className="tr-field">
            <label>目标语言</label>
            <select className="select" value={target} onChange={e => setTarget(e.target.value)} disabled={translating}>
              {TARGET_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <div className="tr-engine-note">
          {engine === 'account'
            ? '使用你在「API Key 管理」添加的模型账户（如 hy-mt2 翻译模型）翻译，走你自己的 Key，不消耗公共额度。'
            : engine === 'local'
              ? '使用本机 Ollama 的文本模型翻译（无需联网、不消耗额度）。需先在顶部开启 Ollama 服务，且本机已拉取文本模型（如 qwen2.5:3b）。'
              : FREE_ENGINES.find(f => f.id === freeEngine)?.desc}
          {engine === 'free' && <span className="tr-engine-note-extra">源语言选「自动检测」时，Google 会自动识别，MyMemory 会按英文处理。文本按段落分块发送，失败块保留原文。</span>}
        </div>
        <button className="btn primary" onClick={() => void doTranslate()} disabled={translating || !files.length}>
          {translating ? <><Loader2 size={14} className="spin" /> {progress || '翻译中…'}</> : <><Languages size={14} /> 开始翻译</>}
        </button>
      </div>

      {results.length > 0 && (
        <>
          <div className="translate-section">
            <div className="translate-section-title">导出设置</div>
            <div className="tr-export-row">
              <label className="tr-check"><input type="checkbox" checked={bilingual} onChange={e => setBilingual(e.target.checked)} /> 双语对照</label>
              <div className="tr-field">
                <label>导出格式</label>
                <select className="select" value={format} onChange={e => setFormat(e.target.value as ExportFormat | 'pdf' | 'docx')}>
                  <option value="html">HTML（排版最全）</option>
                  <option value="docx">DOCX（Word 文档）</option>
                  <option value="md">Markdown</option>
                  <option value="txt">TXT 纯文本</option>
                  <option value="pdf">PDF（浏览器打印另存）</option>
                </select>
              </div>
            </div>
            {bilingual && (
              <div className="tr-layouts">
                <div className="tr-layouts-label">文件布局（可多选，多选将导出多个文件）</div>
                <div className="tr-layouts-list">
                  {LAYOUTS.map(l => (
                    <label key={l} className={`tr-layout-opt ${layouts.includes(l) ? 'active' : ''}`}>
                      <input type="checkbox" checked={layouts.includes(l)} onChange={() => toggleLayout(l)} />
                      <span>{layoutName(l)}</span>
                      {layouts.includes(l) && <Check size={13} />}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="tr-export-actions">
              <div className="tr-dir-row">
                <button className="btn sm" onClick={() => void pickDir()}><Upload size={13} /> 选择导出文件夹</button>
                <span className="tr-dir-label" title={exportDir ?? ''}>
                  {exportDir ? exportDir.split(/[\\/]/).slice(-2).join('/') : '未选择 · 浏览器默认下载目录'}
                </span>
              </div>
              {format === 'pdf'
                ? <button className="btn primary" onClick={doPrintPdf}><Printer size={14} /> 打印 / 另存为 PDF</button>
                : <button className="btn primary" onClick={() => void doExport()}><Download size={14} /> 导出文件</button>}
            </div>
          </div>

          <div className="translate-section">
            <div className="translate-section-title">翻译结果 <span className="hint">{results.length}</span></div>
            <div className="translate-results">
              {results.map((r, ri) => (
                <div className="translate-result" key={`${r.name}-${ri}`}>
                  <div className="tr-result-name">
                    {r.isImage ? <ImageIcon size={14} /> : <FileText size={14} />} {r.name}
                    {r.isImage && <span className="tag blue" style={{ marginLeft: 6 }}>图片 OCR</span>}
                  </div>
                  <div className="tr-result-preview" title={r.translated}>{r.translated.slice(0, 160) || '（无译文）'}</div>
                  {r.isImage && activeLayoutsForImage.length > 0 && (
                    <div className="tr-image-downloads">
                      <span>下载译文图：</span>
                      {activeLayoutsForImage.map(l => (
                        <button key={l} className="btn sm" onClick={() => {
                          const pairs = alignPairs(r.source, r.translated)
                          const dataUrl = renderTranslatedImage(pairs, l, r.name)
                          downloadImage(dataUrl, `${r.name.replace(/\.[^.]+$/, '')}-译文图-${layoutSuffix(l)}.png`)
                        }}>{layoutSuffix(l)}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {/* 隐藏 iframe：打印生成 PDF（Tauri WebView 拦截 window.open，改用 iframe） */}
      <iframe ref={printRef} style={{ position: 'absolute', width: 0, height: 0, border: 0, opacity: 0 }} title="打印" />
    </div>
  )
}
