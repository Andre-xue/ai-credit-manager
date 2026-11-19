// AI 翻译模块：文件拖入/粘贴导入 → 分类 → 翻译（自己的模型 / 免费公共 API）→
// 双语布局（3 种，可多选）→ 导出（TXT / MD / HTML / PDF打印）。全平台适用。

import { useEffect, useMemo, useRef, useState } from 'react'
import { Languages, Upload, FileText, Image as ImageIcon, Archive, Trash2, Loader2, Download, Printer, Check, Info } from 'lucide-react'
import {
  categorizeFile, translateText, alignPairs,
  buildHtml, buildPlain, layoutName, TARGET_LANGUAGES,
  type TranslateFile, type TranslateEngine, type BilingualLayout, type ExportFormat,
} from '../core/translate'
import type { Account } from '../core/types'

interface Props {
  accounts: Account[]
  notify: (m: string) => void
}

const LAYOUTS: BilingualLayout[] = ['side-by-side', 'interleaved', 'stacked']
const CATEGORY_ICON = { document: FileText, image: ImageIcon, archive: Archive, other: FileText }
const CATEGORY_LABEL = { document: '文档', image: '图片', archive: '压缩包', other: '其他' }

export function TranslationView({ accounts, notify }: Props) {
  const [files, setFiles] = useState<TranslateFile[]>([])
  const [engine, setEngine] = useState<TranslateEngine>('free')
  const [accountId, setAccountId] = useState('')
  const [target, setTarget] = useState('zh-CN')
  const [bilingual, setBilingual] = useState(true)
  const [layouts, setLayouts] = useState<BilingualLayout[]>(['side-by-side'])
  const [format, setFormat] = useState<ExportFormat | 'pdf'>('html')
  const [translating, setTranslating] = useState(false)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState<{ name: string; source: string; translated: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // 可用于翻译的账户（有 Key）
  const usableAccounts = useMemo(() => accounts.filter(a => a.encryptedKey), [accounts])
  useEffect(() => { if (!accountId && usableAccounts.length) setAccountId(usableAccounts[0].id) }, [usableAccounts, accountId])

  const addFiles = async (fileList: FileList | File[]) => {
    const added: TranslateFile[] = []
    for (const f of Array.from(fileList)) {
      const category = categorizeFile(f.name)
      let text = ''
      if (category === 'document') {
        // 仅纯文本类可直接读；二进制文档（docx/pdf）第一阶段提示不支持
        if (/\.(txt|md|markdown|csv|json|log|text|xml|yaml|yml|html?)$/i.test(f.name)) {
          text = await f.text()
        } else {
          notify(`「${f.name}」是二进制文档，第一阶段暂不支持解析，请转存为 txt/md 后导入`)
          continue
        }
      } else if (category === 'image') {
        notify(`「${f.name}」是图片，OCR 翻译将在第二阶段支持，本次跳过`)
        continue
      } else {
        notify(`「${f.name}」是压缩包，需先解压再导入，本次跳过`)
        continue
      }
      added.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: f.name, category, text })
    }
    if (added.length) setFiles(prev => [...prev, ...added])
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

  const download = (filename: string, content: string, mime: string) => {
    const blob = new Blob(['\ufeff' + content], { type: mime + ';charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const doExport = () => {
    if (!results.length) { notify('请先翻译'); return }
    if (bilingual && layouts.length === 0) { notify('请至少选择一种双语布局，或关闭双语对照'); return }
    const activeLayouts: BilingualLayout[] = bilingual ? layouts : ['side-by-side']
    results.forEach(r => {
      const pairs = alignPairs(r.source, r.translated)
      const base = r.name.replace(/\.[^.]+$/, '')
      if (format === 'html') {
        download(`${base}-译文.html`, buildHtml(r.name, pairs, activeLayouts), 'text/html')
      } else if (format === 'md') {
        download(`${base}-译文.md`, buildPlain(r.name, pairs, activeLayouts, 'md'), 'text/markdown')
      } else if (format === 'txt') {
        download(`${base}-译文.txt`, buildPlain(r.name, pairs, activeLayouts, 'txt'), 'text/plain')
      }
    })
    const mode = bilingual && layouts.length > 1 ? `（${activeLayouts.length} 种布局）` : ''
    notify(`已导出 ${results.length} 个文件${mode}`)
  }

  const doPrintPdf = () => {
    if (!results.length) { notify('请先翻译'); return }
    const activeLayouts: BilingualLayout[] = bilingual ? layouts : ['side-by-side']
    const html = results.map(r => buildHtml(r.name, alignPairs(r.source, r.translated), activeLayouts)).join('<div style="page-break-after:always"></div>')
    const win = window.open('', '_blank')
    if (!win) { notify('打印窗口被拦截，请允许弹出窗口后重试'); return }
    win.document.write(html)
    win.document.close()
    setTimeout(() => win.print(), 400)
    notify('已打开打印窗口，请选择「另存为 PDF」')
  }

  // 粘贴导入：从剪贴板读取文本，作为 txt 文件
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain')
      if (!text?.trim()) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      setFiles(prev => [...prev, { id: `paste-${Date.now()}`, name: `粘贴内容-${new Date().toLocaleTimeString('zh-CN')}.txt`, category: 'document', text }])
      notify('已粘贴文本内容，作为文档加入列表')
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
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
        onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files) }}
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
              {format === 'pdf'
                ? <button className="btn primary" onClick={doPrintPdf}><Printer size={14} /> 打印 / 另存为 PDF</button>
                : <button className="btn primary" onClick={doExport}><Download size={14} /> 导出文件</button>}
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
