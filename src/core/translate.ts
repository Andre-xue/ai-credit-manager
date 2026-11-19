// AI 翻译核心：翻译引擎抽象（用户账户模型 / 免费公共 API）、文件分类、文本切块、
// 双语布局渲染（3 种）、导出内容生成（TXT/MD/HTML）。
// 第一阶段：文档类文本翻译 + 三种双语布局 + 三种导出格式；图片 OCR / DOCX 导出留待第二阶段。

import { callChat } from './providerCall'
import { decryptSecret, getBiometricPassword } from './crypto'
import type { Account } from './types'

export type TranslateEngine = 'account' | 'free'
export type FileCategory = 'document' | 'image' | 'archive' | 'other'
export type BilingualLayout = 'side-by-side' | 'interleaved' | 'stacked'
export type ExportFormat = 'txt' | 'md' | 'html'

export interface TranslateFile {
  id: string
  name: string
  category: FileCategory
  text: string          // 文档类的纯文本内容
  source?: string       // 图片 data URL（第二阶段 OCR 用）
}

export interface TranslatePair {
  source: string        // 原文段落
  target: string        // 译文段落
}

export const TARGET_LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'ru', name: 'Русский' },
] as const

/** 文件扩展名 → 分类 */
export function categorizeFile(name: string): FileCategory {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (['txt', 'md', 'markdown', 'csv', 'json', 'log', 'text', 'xml', 'yaml', 'yml', 'html', 'htm'].includes(ext)) return 'document'
  if (['doc', 'docx', 'pdf', 'rtf', 'odt', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext)) return 'document'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext)) return 'image'
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return 'archive'
  return 'other'
}

/** 按段落切块，单块不超过 maxChars（尽量在换行/句号处断开） */
export function chunkForTranslate(text: string, maxChars = 450): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim())
  const chunks: string[] = []
  let cur = ''
  const append = (piece: string) => {
    if (!piece) return
    if (cur && (cur + '\n\n' + piece).length > maxChars) { chunks.push(cur); cur = piece }
    else cur += (cur ? '\n\n' : '') + piece
  }
  const flush = () => { if (cur.trim()) { chunks.push(cur.trim()); cur = '' } }
  for (const p of paragraphs) {
    if (p.length > maxChars) {
      flush() // 先结束当前块
      // 长段落按句号/分号再切成句子，逐句 append（可能跨多块）
      const sentences = p.split(/(?<=[。！？.!?;；])\s*/).filter(Boolean)
      let buf = ''
      for (const s of sentences) {
        if ((buf + s).length > maxChars) { if (buf) { chunks.push(buf); buf = '' } }
        buf += s
      }
      if (buf) cur = buf
    } else {
      append(p)
    }
  }
  flush()
  return chunks.length ? chunks : (text.trim() ? [text.trim()] : [])
}

/** 免费公共翻译 API（MyMemory，无需 Key，单次 ≤500 字符） */
async function translateFree(text: string, target: string, source = 'auto'): Promise<string> {
  const langpair = `${source === 'auto' ? 'en' : source}|${target}`
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`免费翻译服务请求失败（${res.status}）`)
  const json = await res.json()
  const out = json?.responseData?.translatedText
  if (!out) throw new Error(json?.responseDetails || '免费翻译未返回译文')
  return out as string
}

/** 用用户账户模型翻译 */
async function translateByAccount(account: Account, pwd: string, text: string, target: string): Promise<string> {
  const key = await decryptSecret(account.encryptedKey!, pwd)
  const system = `你是一个专业翻译引擎。把用户输入的文本翻译成${target}。只输出译文，不要解释、不要加引号、不要加任何前缀。保留原文的段落结构与换行。`
  const r = await callChat(account, key, [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ])
  if (!r.ok) throw new Error(r.error ?? '模型翻译失败')
  return r.text.trim()
}

export interface TranslateOptions {
  engine: TranslateEngine
  account?: Account
  target: string
  onProgress?: (done: number, total: number) => void
}

/** 翻译整段文本：切块后逐块翻译，失败块保留原文 */
export async function translateText(text: string, opts: TranslateOptions): Promise<string> {
  const chunks = chunkForTranslate(text)
  if (!chunks.length) return ''
  const pwd = getBiometricPassword()
  const results: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    try {
      if (opts.engine === 'free') results.push(await translateFree(chunks[i], opts.target))
      else {
        if (!opts.account?.encryptedKey) throw new Error('请先在 API Key 管理添加模型账户')
        if (!pwd) throw new Error('请先解锁主密码（生物识别或会话密码）')
        results.push(await translateByAccount(opts.account, pwd, chunks[i], opts.target))
      }
    } catch {
      results.push(chunks[i]) // 失败块保留原文，不中断整体
    }
    opts.onProgress?.(i + 1, chunks.length)
  }
  return results.join('\n\n')
}

/** 把原文/译文按段落对齐成 pair（按空行分段，数量不等时按较长者补空） */
export function alignPairs(source: string, target: string): TranslatePair[] {
  const a = source.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  const b = target.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  const n = Math.max(a.length, b.length)
  return Array.from({ length: n }, (_, i) => ({ source: a[i] ?? '', target: b[i] ?? '' }))
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>')

/** 按布局渲染一个段落对（HTML 片段） */
export function renderPairHtml(pair: TranslatePair, layout: BilingualLayout): string {
  const src = nl2br(pair.source)
  const dst = nl2br(pair.target)
  switch (layout) {
    case 'side-by-side':
      return `<div class="tr-row tr-side"><div class="tr-src">${src}</div><div class="tr-dst">${dst}</div></div>`
    case 'interleaved':
      return `<div class="tr-row tr-interleave"><div class="tr-src">${src}</div><div class="tr-dst tr-underline">${dst}</div></div>`
    case 'stacked':
      return `<div class="tr-row tr-stack"><div class="tr-src">${src}</div><div class="tr-dst">${dst}</div></div>`
  }
}

/** 布局对应的 CSS（导出 HTML 内嵌，保证离线打开排版一致） */
export function bilingualCss(): string {
  return `body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:1000px;margin:32px auto;padding:0 20px;color:#222;line-height:1.7}
.tr-col-label{font-size:12px;color:#888;margin:0 0 8px;font-weight:600;letter-spacing:.5px}
.tr-whole-side{display:flex;gap:28px;align-items:stretch}
.tr-whole-side>div{flex:1;min-width:0;white-space:pre-wrap}
.tr-whole-stack{display:flex;flex-direction:column;gap:24px}
.tr-whole-stack>div{white-space:pre-wrap}
.tr-src{color:#333}.tr-dst{color:#1a56db}
.tr-row{margin:0 0 18px;padding:12px 0;border-bottom:1px solid #eee}
.tr-interleave .tr-src{margin-bottom:4px}.tr-underline{border-bottom:1px solid #93c5fd;padding-bottom:8px}
@media print{.tr-row{break-inside:avoid}}`
}

/** 整篇原文（合并所有段落） */
function wholeSource(pairs: TranslatePair[]): string {
  return pairs.map(p => p.source).filter(Boolean).join('\n\n')
}
/** 整篇译文（合并所有段落） */
function wholeTarget(pairs: TranslatePair[]): string {
  return pairs.map(p => p.target).filter(Boolean).join('\n\n')
}

/** 生成完整 HTML 文档（每次只传一种布局，导出为独立文件） */
export function buildHtml(title: string, pairs: TranslatePair[], layouts: BilingualLayout[]): string {
  const sections = layouts.map(layout => {
    let body: string
    if (layout === 'side-by-side') {
      // 整篇原文在左栏、整篇译文在右栏
      body = `<div class="tr-whole-side">
<div class="tr-col"><p class="tr-col-label">原文</p><div class="tr-src">${nl2br(wholeSource(pairs))}</div></div>
<div class="tr-col"><p class="tr-col-label">译文</p><div class="tr-dst">${nl2br(wholeTarget(pairs))}</div></div>
</div>`
    } else if (layout === 'stacked') {
      // 整篇原文在上、整篇译文在下
      body = `<div class="tr-whole-stack">
<div><p class="tr-col-label">原文</p><div class="tr-src">${nl2br(wholeSource(pairs))}</div></div>
<div><p class="tr-col-label">译文</p><div class="tr-dst">${nl2br(wholeTarget(pairs))}</div></div>
</div>`
    } else {
      // 逐句交替：一句原文、其译文在下方带下划线
      body = pairs.map(p => renderPairHtml(p, 'interleaved')).join('\n')
    }
    return `<section class="tr-section" data-layout="${layout}">
<h2>${layoutName(layout)}</h2>
${body}
</section>`
  }).join('\n')
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${bilingualCss()}</style></head><body><h1>${esc(title)}</h1>${sections}</body></html>`
}

/** 生成 TXT / MD 内容（每份只含一种布局，导出为独立文件） */
export function buildPlain(title: string, pairs: TranslatePair[], layouts: BilingualLayout[], format: 'txt' | 'md'): string {
  const parts: string[] = [`# ${title}`]
  for (const layout of layouts) {
    parts.push('', `## ${layoutName(layout)}`, '')
    if (format === 'md' && layout === 'side-by-side') {
      // 整篇左右：两列各放整篇
      parts.push('| 原文（整篇） | 译文（整篇） |', '| --- | --- |')
      parts.push(`| ${wholeSource(pairs).replace(/\n/g, '<br>')} | ${wholeTarget(pairs).replace(/\n/g, '<br>')} |`)
    } else if (layout === 'side-by-side') {
      parts.push('【原文】', wholeSource(pairs), '', '【译文】', wholeTarget(pairs), '')
    } else if (layout === 'stacked') {
      // 上方整篇原文、下方整篇译文
      parts.push('【原文 · 全文】', wholeSource(pairs), '', '【译文 · 全文】', wholeTarget(pairs), '')
    } else {
      // 逐句交替
      pairs.forEach(p => { parts.push(p.source, `　→ ${p.target}`, '') })
    }
  }
  return parts.join('\n')
}

export function layoutName(layout: BilingualLayout): string {
  switch (layout) {
    case 'side-by-side': return '左右对照（左原文 · 右译文）'
    case 'interleaved': return '逐句对照（译文在下方并加下划线提示）'
    case 'stacked': return '上下结构（上原文 · 下译文）'
  }
}

/** 布局对应的文件名短后缀（多布局导出多个文件时使用） */
export function layoutSuffix(layout: BilingualLayout): string {
  switch (layout) {
    case 'side-by-side': return '左右对照'
    case 'interleaved': return '逐句对照'
    case 'stacked': return '上下结构'
  }
}
