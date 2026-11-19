// AI 翻译模块：文件拖入/粘贴导入 → 分类 → 翻译（自己的模型 / 免费公共 API）→
// 双语布局（3 种，可多选）→ 导出（TXT / MD / HTML / PDF打印）。全平台适用。

import { useEffect, useMemo, useRef, useState } from 'react'
import { Languages, Upload, FileText, Image as ImageIcon, Archive, Trash2, Loader2, Download, Printer, Check, Info } from 'lucide-react'
import {
  categorizeFile, translateText, alignPairs,
  buildHtml, buildPlain, layoutName, layoutSuffix, TARGET_LANGUAGES,
  type TranslateFile, type TranslateEngine, type BilingualLayout, type ExportFormat,
} from '../core/translate'
import { chooseBackupFolder } from '../core/keyBackup'
import { isDesktopApp } from '../core/openExternal'
import {
  readFilesFromPaths, readFilesFromDataTransfer, onTauriFileDrop,
  type ImportedFile,
} from '../core/fileImport'
import { detectModelCapability, capabilityChatCapable } from '../core/modelCapability'
import { isVoiceConfigAccount } from '../core/modelCategories'
import { isAccountServiceEnabled } from '../core/localServicesSettings'
import type { Account, AppSettings } from '../core/types'

interface Props {
  accounts: Account[]
  notify: (m: string) => void
  settings?: AppSettings
}

const LAYOUTS: BilingualLayout[] = ['side-by-side', 'interleaved', 'stacked']
const CATEGORY_ICON = { document: FileText, image: ImageIcon, archive: Archive, other: FileText }
const CATEGORY_LABEL = { document: '文档', image: '图片', archive: '压缩包', other: '其他' }

export function TranslationView({ accounts, notify, settings }: Props) {
  const [files, setFiles] = useState<TranslateFile[]>([])
  const [engine, setEngine] = useState<TranslateEngine>('free')
  const [accountId, setAccountId] = useState('')
  const [target, setTarget] = useState('zh-CN')
  const [bilingual, setBilingual] = useState(true)
  const [layouts, setLayouts] = useState<BilingualLayout[]>(['side-by-side'])
  const [format, setFormat] = useState<ExportFormat | 'pdf'>('html')
  const [exportDir, setExportDir] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState<{ name: string; source: string; translated: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // 可用于翻译的账户：与 AI 助手同一套标准——排除语音配置账户、非文本模型（嵌入/图像/音频）、服务已关闭的本地账户
  const usableAccounts = useMemo(() => accounts
    .filter(a => !!a.encryptedKey)
    .filter(a => !isVoiceConfigAccount(a.providerId, a.note))
    .filter(a => {
      const stored = a.modelCapability
      const live = detectModelCapability(a.label).capability
      return capabilityChatCapable(live) && (stored === undefined || capabilityChatCapable(stored))
    })
    .filter(a => isAccountServiceEnabled(settings, a.providerId)), [accounts, settings])
  useEffect(() => {
    if (usableAccounts.length && !usableAccounts.some(a => a.id === accountId)) setAccountId(usableAccounts[0].id)
  }, [usableAccounts, accountId])

  // 统一导入：给文件分类、给出跳过提示，加入待翻译列表
  const ingestFiles = (imported: ImportedFile[]) => {
    const added: TranslateFile[] = []
    for (const f of imported) {
      const category = categorizeFile(f.name)
      if (category !== 'document') {
        notify(`「${f.name}」${category === 'image' ? '是图片，OCR 翻译将在第二阶段支持' : category === 'archive' ? '是压缩包，需先解压再导入' : '暂不支持'}，本次跳过`)
        continue
      }
      added.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: f.name, category, text: f.text })
    }
    if (added.length) {
      setFiles(prev => [...prev, ...added])
      notify(`已导入 ${added.length} 个文件`)
    }
  }

  // Web/手机：从点击选择的 input 读取
  const addFiles = async (fileList: FileList | File[]) => {
    const added: ImportedFile[] = []
    for (const f of Array.from(fileList)) added.push({ name: f.name, text: await f.text() })
    ingestFiles(added)
  }

  const doTranslate = async () => {
    if (!files.length) { notify('请先导入文件'); return }
    if (engine === 'account' && !accountId) { notify('请先在 API Key 管理添加模型账户'); return }
    const account = usableAccounts.find(a => a.id === accountId)
    setTranslating(true)
    const out: { name: string; source: string; translated: string }[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        setProgress(`翻译中 ${i + 1}/${files.length}：${f.name}`)
        const translated = await translateText(f.text, {
          engine, account, target,
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
    // 每个布局单独一节，各自分页；用户可分别另存，或一次性打印成多页 PDF
    const html = results.flatMap(r => activeLayouts.map(layout =>
      `<div style="page-break-after:always">${buildHtml(`${r.name} · ${layoutName(layout)}`, alignPairs(r.source, r.translated), [layout])}</div>`
    )).join('')
    const win = window.open('', '_blank')
    if (!win) { notify('打印窗口被拦截，请允许弹出窗口后重试'); return }
    win.document.write(html)
    win.document.close()
    setTimeout(() => win.print(), 400)
    notify('已打开打印窗口（每种布局独立分页），可选择「另存为 PDF」')
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
        ingestFiles(r.files)
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
      ingestFiles(r.files)
    }).then(fn => { if (cancelled) fn(); else unlisten = fn })
    return () => { cancelled = true; unlisten?.() }
  }, [notify])

  return (
    <div className="translate-page">
      <div className="translate-intro">
        <Info size={14} />
        <span>导入文档拖入或粘贴文本，选择翻译引擎与目标语言，即可生成双语对照文件。第一阶段支持纯文本文档；图片 OCR 与二进制文档解析将在第二阶段支持。</span>
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
              ingestFiles(r.files)
            })
          }
        }}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" multiple accept=".txt,.md,.markdown,.csv,.json,.log,.text,.xml,.yaml,.yml,.html,.htm,.png,.jpg,.jpeg,.webp,.zip,.rar,.7z" style={{ display: 'none' }}
          onChange={e => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }} />
        <Upload size={22} />
        <b>拖入文件，或点击选择</b>
        <span>支持文档 / 图片 / 压缩包；也可直接粘贴文本</span>
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
                  <button className="icon-btn" title="移除" onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))}><Trash2 size={13} /></button>
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
            </select>
          </div>
          {engine === 'account' && (
            <div className="tr-field">
              <label>模型账户</label>
              <select className="select" value={accountId} onChange={e => setAccountId(e.target.value)} disabled={translating}>
                {usableAccounts.length === 0 && <option value="">请先添加账户</option>}
                {usableAccounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
          )}
          <div className="tr-field">
            <label>目标语言</label>
            <select className="select" value={target} onChange={e => setTarget(e.target.value)} disabled={translating}>
              {TARGET_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
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
                <select className="select" value={format} onChange={e => setFormat(e.target.value as ExportFormat | 'pdf')}>
                  <option value="html">HTML（排版最全）</option>
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
              {results.map(r => (
                <div className="translate-result" key={r.name}>
                  <div className="tr-result-name"><FileText size={14} /> {r.name}</div>
                  <div className="tr-result-preview" title={r.translated}>{r.translated.slice(0, 160) || '（无译文）'}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
