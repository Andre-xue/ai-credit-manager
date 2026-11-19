// AI 图像生成模块：用自有生图账户的 API Key 调用 OpenAI 兼容 /images/generations。
// 支持文生图参数（尺寸/数量/质量/风格），结果预览与下载，历史记录仅存本机 localStorage。

import { useEffect, useMemo, useState } from 'react'
import {
  Image as ImageIcon, Sparkles, Loader2, Download, Trash2, Info, KeyRound,
  ExternalLink, History, ChevronDown,
} from 'lucide-react'
import { callImage, extractModelId } from '../core/providerCall'
import { decryptSecret, getBiometricPassword } from '../core/crypto'
import { PROVIDER_MAP } from '../data/providers'
import { categoryFromNote } from '../core/modelCategories'
import {
  addHistory, clearHistory, loadHistory, newMediaId, removeHistory, saveMedia,
  type MediaHistoryItem,
} from '../core/mediaGeneration'
import { HoldToConfirm } from './HoldToConfirm'
import type { Account, AppSettings } from '../core/types'

const SIZES = ['1024x1024', '1536x1024', '1024x1536', '1792x1024', '512x512']
const QUALITIES = ['', 'standard', 'hd']
const STYLES = ['', 'vivid', 'natural']

export function ImageView({ accounts, sessionPwd, onUnlock, notify }: {
  accounts: Account[]; sessionPwd: string; onUnlock: (pwd: string) => void; notify: (m: string) => void; settings?: AppSettings
}) {
  // 可用于生图的账户：有 Key；生图型备注优先，其余账户也列出（OpenAI 兼容接口通用）
  const usable = useMemo(() => accounts
    .filter(a => !!a.encryptedKey && a.apiUrl)
    .sort((a, b) => {
      const ag = categoryFromNote(a.note) === '生图型' ? 0 : 1
      const bg = categoryFromNote(b.note) === '生图型' ? 0 : 1
      return ag - bg
    }), [accounts])
  const [accountId, setAccountId] = useState('')
  const account = usable.find(a => a.id === accountId) ?? usable[0]

  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [quality, setQuality] = useState('')
  const [style, setStyle] = useState('')
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const [lastNote, setLastNote] = useState('')
  const [pwdInput, setPwdInput] = useState('')
  const [history, setHistory] = useState<MediaHistoryItem[]>(() => loadHistory('image'))
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => { setHistory(loadHistory('image')) }, [])

  const model = account ? extractModelId(account) : ''
  const needPwd = !!account && !!account.encryptedKey && !getBiometricPassword() && !sessionPwd

  const generate = async () => {
    if (!account) { notify('请先在「API Key 管理」添加带生图 API 地址的账户'); return }
    if (!prompt.trim()) { notify('请先输入画面描述'); return }
    const pwd = getBiometricPassword() || sessionPwd
    if (!pwd) { notify('请先解锁密钥库（本页下方输入主密码）'); return }
    setBusy(true); setResults([]); setLastNote('')
    try {
      const apiKey = await decryptSecret(account.encryptedKey!, pwd)
      const r = await callImage(account, apiKey, prompt.trim(), {
        size, n: count, quality: quality || undefined, style: style || undefined,
      })
      if (!r.ok) { setLastNote(r.error ?? '生成失败'); notify(r.error ?? '生成失败'); return }
      const imgs = r.images ?? []
      setResults(imgs)
      setLastNote(r.text)
      const params = [size, quality || '', style || '', `${count}张`].filter(Boolean).join(' · ')
      setHistory(addHistory('image', {
        id: newMediaId(), kind: 'image', prompt: prompt.trim(), accountLabel: account.label,
        model, createdAt: Date.now(), results: imgs, params,
      }))
      notify(imgs.length ? `已生成 ${imgs.length} 张图片` : r.text)
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e)
      setLastNote(msg); notify(msg)
    } finally { setBusy(false) }
  }

  const download = async (url: string, idx: number) => {
    try {
      const loc = await saveMedia(url, 'image', `ai-image-${Date.now()}-${idx + 1}`)
      notify(`已保存：${loc}`)
    } catch (e) { notify((e as Error)?.message ?? '保存失败') }
  }

  const resetHistory = () => { clearHistory('image'); setHistory([]); notify('历史已清空') }

  return (
    <div className="set-content">
      <div className="gen-layout">
        {/* 左：生成控制 */}
        <section className="gen-panel">
          <div className="gen-panel-head"><span className="gen-head-icon"><ImageIcon size={18} /></span><div><h3>AI 图像生成</h3><p>输入画面描述，用你自己的生图账户生成图片</p></div></div>
          <div className="gen-body">
            <label className="gen-label">生图账户</label>
            {usable.length === 0 ? (
              <div className="gen-empty-hint"><KeyRound size={16} /> 还没有可用的生图账户。请到「API Key 管理」添加账户并填写 OpenAI 兼容的 API 地址；模型 ID 写在账户备注里即可。</div>
            ) : (
              <div className="gen-select-wrap">
                <select className="input" value={account?.id ?? ''} onChange={e => setAccountId(e.target.value)}>
                  {usable.map(a => <option key={a.id} value={a.id}>{a.label} · {PROVIDER_MAP[a.providerId]?.shortName ?? a.providerId}</option>)}
                </select>
                {account && <span className="gen-model-tag">模型：{model || '未识别（请在备注填模型ID）'}</span>}
              </div>
            )}

            <label className="gen-label">画面描述（Prompt）</label>
            <textarea className="input gen-prompt" rows={4} placeholder="例如：赛博朋克风格的城市夜景，霓虹灯倒映在雨后的街道，电影质感"
              value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy} />

            <div className="gen-grid-2">
              <div>
                <label className="gen-label">图片尺寸</label>
                <div className="gen-select-wrap">
                  <select className="input" value={size} onChange={e => setSize(e.target.value)} disabled={busy}>
                    {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={14} className="gen-select-chevron" />
                </div>
              </div>
              <div>
                <label className="gen-label">生成张数</label>
                <select className="input" value={count} onChange={e => setCount(Number(e.target.value))} disabled={busy}>
                  {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} 张</option>)}
                </select>
              </div>
              <div>
                <label className="gen-label">质量（可选）</label>
                <select className="input" value={quality} onChange={e => setQuality(e.target.value)} disabled={busy}>
                  {QUALITIES.map(q => <option key={q} value={q}>{q || '默认'}</option>)}
                </select>
              </div>
              <div>
                <label className="gen-label">风格（可选）</label>
                <select className="input" value={style} onChange={e => setStyle(e.target.value)} disabled={busy}>
                  {STYLES.map(s => <option key={s} value={s}>{s || '默认'}</option>)}
                </select>
              </div>
            </div>

            {needPwd && (
              <div className="gen-pwd-gate">
                <Info size={14} /> 该账户密钥已加密，请输入主密码解锁本次会话：
                <div className="gen-pwd-row">
                  <input className="input" type="password" placeholder="主密码" value={pwdInput} onChange={e => setPwdInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && pwdInput) onUnlock(pwdInput) }} />
                  <button className="btn sm" disabled={!pwdInput} onClick={() => { onUnlock(pwdInput); setPwdInput('') }}>解锁</button>
                </div>
              </div>
            )}

            <button className="btn primary gen-generate" onClick={() => void generate()} disabled={busy || !prompt.trim() || !account}>
              {busy ? <><Loader2 size={16} className="spin" /> 正在生成…</> : <><Sparkles size={16} /> 生成图片</>}
            </button>
            <div className="gen-tip"><Info size={13} /> <span>生图走账户 API 地址对应的 OpenAI 兼容 images/generations 接口；若平台为私有协议会返回错误提示，请改用官方页面生成。</span></div>
          </div>
        </section>

        {/* 右：结果 + 历史 */}
        <section className="gen-panel">
          <div className="gen-panel-head">
            <span className="gen-head-icon"><Sparkles size={18} /></span>
            <div><h3>生成结果</h3><p>{lastNote || '生成后的图片会显示在这里'}</p></div>
            <button className="btn sm ghost gen-hist-btn" onClick={() => setShowHistory(v => !v)}><History size={14} /> {showHistory ? '返回预览' : `历史 (${history.length})`}</button>
          </div>
          <div className="gen-body">
            {showHistory ? (
              <div className="gen-history">
                {history.length === 0 && <div className="gen-empty">暂无历史记录</div>}
                {history.map(h => (
                  <div className="gen-hist-item" key={h.id}>
                    <div className="gen-hist-top">
                      <span className="gen-hist-time">{new Date(h.createdAt).toLocaleString('zh-CN')}</span>
                      <HoldToConfirm title="删除" onConfirm={() => setHistory(removeHistory('image', h.id))} className="sm" />
                    </div>
                    <div className="gen-hist-prompt">{h.prompt}</div>
                    <div className="gen-hist-meta">{h.accountLabel} · {h.params}</div>
                    <div className="gen-thumbs">
                      {h.results.map((u, i) => <img key={i} src={u} alt="历史图片" className="gen-thumb" onClick={() => window.open(u, '_blank', 'noopener')} />)}
                    </div>
                  </div>
                ))}
                {history.length > 0 && <button className="btn sm ghost" onClick={resetHistory}><Trash2 size={13} /> 清空历史</button>}
              </div>
            ) : results.length > 0 ? (
              <div className="gen-results">
                {results.map((u, i) => (
                  <div className="gen-result-card" key={i}>
                    {u.startsWith('data:') || /^https?:\/\//.test(u)
                      ? <img src={u} alt={`生成图片 ${i + 1}`} className="gen-result-img" />
                      : <div className="gen-result-text">{u}</div>}
                    <div className="gen-result-actions">
                      <a className="btn sm ghost" href={u} target="_blank" rel="noopener" title="在新窗口打开"><ExternalLink size={13} /> 打开</a>
                      <button className="btn sm ghost" onClick={() => void download(u, i)}><Download size={13} /> 下载</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gen-empty">
                <ImageIcon size={40} />
                <p>还没有生成图片</p>
                <span>在左侧输入画面描述，点击「生成图片」即可开始</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
