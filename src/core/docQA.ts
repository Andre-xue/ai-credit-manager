// 本地文档问答（RAG）核心模块：文档切块 → 嵌入向量 → 本地存储 → 相似度检索 → 组装上下文。
// 全程本地：文档与向量只存本机 IndexedDB，不上传；嵌入走本机 Ollama，回答走已配置的对话模型。

import { isDesktopApp } from './openExternal'

const DB_NAME = 'acm-docqa-db'
const STORE = 'chunks'
const DB_VERSION = 1

export interface DocChunk {
  id: string          // `${docId}#${index}`
  docId: string
  docName: string
  index: number
  text: string
  vector: number[]
}

export interface DocInfo {
  docId: string
  name: string
  chunkCount: number
  createdAt: number
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function getInvoke(): Invoke | null {
  if (!isDesktopApp()) return null
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }
  return w.__TAURI_INTERNALS__?.invoke ?? null
}

/** 是否支持文档问答（需桌面端 + Rust 嵌入命令） */
export function isDocQAAvailable(): boolean { return !!getInvoke() }

let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('docId', 'docId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbPromise = null; reject(req.error) }
    req.onblocked = () => { dbPromise = null; reject(new Error('数据库被占用')) }
  })
  return dbPromise
}

/** 生成嵌入向量（调 Rust → Ollama /api/embed） */
export async function embedText(baseUrl: string, model: string, text: string): Promise<number[]> {
  const invoke = getInvoke()
  if (!invoke) throw new Error('文档问答仅桌面端支持')
  const v = await invoke('ollama_embed', { baseUrl, model, input: text }) as number[]
  if (!Array.isArray(v) || v.length === 0) throw new Error('嵌入服务未返回有效向量')
  return v
}

/** 把文本切成带重叠的块 */
export function chunkText(text: string, size = 600, overlap = 100): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  if (clean.length <= size) return [clean]
  const out: string[] = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length)
    // 尽量在句号/换行处收尾，避免切断语义
    if (end < clean.length) {
      const slice = clean.slice(start, end)
      const breakPos = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('\n'), slice.lastIndexOf('. '))
      if (breakPos > size * 0.5) end = start + breakPos + 1
    }
    out.push(clean.slice(start, end).trim())
    if (end >= clean.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return out.filter(Boolean)
}

/** 存入一个文档（切块 + 逐块嵌入 + 写库）。返回块数。 */
export async function addDocument(params: {
  docId: string; name: string; text: string; baseUrl: string; embedModel: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<number> {
  const chunks = chunkText(params.text)
  if (!chunks.length) throw new Error('文档内容为空')
  const db = await openDb()
  let done = 0
  for (let i = 0; i < chunks.length; i++) {
    const vector = await embedText(params.baseUrl, params.embedModel, chunks[i])
    const chunk: DocChunk = {
      id: `${params.docId}#${i}`, docId: params.docId, docName: params.name,
      index: i, text: chunks[i], vector,
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(chunk)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    done++
    params.onProgress?.(done, chunks.length)
  }
  return chunks.length
}

/** 列出已导入文档 */
export async function listDocuments(): Promise<DocInfo[]> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    req.onsuccess = () => {
      const chunks = (req.result ?? []) as DocChunk[]
      const map = new Map<string, DocInfo>()
      for (const c of chunks) {
        const cur = map.get(c.docId)
        if (cur) cur.chunkCount++
        else map.set(c.docId, { docId: c.docId, name: c.docName, chunkCount: 1, createdAt: 0 })
      }
      resolve([...map.values()])
    }
    req.onerror = () => reject(req.error)
  })
}

/** 删除一个文档的所有块 */
export async function deleteDocument(docId: string): Promise<void> {
  const db = await openDb()
  const idx = db.transaction(STORE, 'readonly').objectStore(STORE).index('docId')
  const keysReq = idx.getAllKeys(docId)
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    keysReq.onsuccess = () => resolve(keysReq.result)
    keysReq.onerror = () => reject(keysReq.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    keys.forEach(k => store.delete(k))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 余弦相似度 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (!n) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** 检索与问题最相关的文档块 */
export async function searchChunks(queryVector: number[], topK = 3): Promise<{ chunk: DocChunk; score: number }[]> {
  const db = await openDb()
  const chunks = await new Promise<DocChunk[]>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result ?? []) as DocChunk[])
    req.onerror = () => reject(req.error)
  })
  return chunks
    .map(c => ({ chunk: c, score: cosineSimilarity(queryVector, c.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK))
}

/** 组装带引用的上下文 prompt */
export function buildContextPrompt(question: string, hits: { chunk: DocChunk; score: number }[]): string {
  if (!hits.length) return question
  const context = hits.map((h, i) =>
    `[资料${i + 1}｜${h.chunk.docName}]\n${h.chunk.text}`
  ).join('\n\n')
  return `请仅根据以下参考资料回答问题。如果资料中没有答案，请明确说明"资料中未提及"，不要编造。\n\n${context}\n\n问题：${question}`
}
