// AI 视频生成模块：用自有视频账户的 API Key 调用 OpenAI 兼容视频生成接口。
// 支持文生视频 / 图生视频（上传首帧图）、时长与比例参数；异步任务提交后自动轮询状态，
// 拿到视频 URL 即可预览与下载；历史记录仅存本机 localStorage。

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Film, Sparkles, Loader2, Download, Trash2, Info, KeyRound,
  ExternalLink, History, X, Upload,
} from 'lucide-react'
import { callVideo, extractModelId, queryVideoTask } from '../core/providerCall'
import { decryptSecret, getBiometricPassword } from '../core/crypto'
import { PROVIDER_MAP } from '../data/providers'
import { categoryFromNote } from '../core/modelCategories'
import {
  addHistory, clearHistory, loadHistory, newMediaId, removeHistory, saveMedia,
  type MediaHistoryItem,
} from '../core/mediaGeneration'
import { HoldToConfirm } from './HoldToConfirm'
import type { Account, AppSettings } from '../core/types'

const DURATIONS = [5, 10, 15]
const RATIOS = ['16:9', '9:16', '1:1']

export function VideoView({ accounts, sessionPwd, onUnlock, notify }: {
  accounts: Account[]; sessionPwd: string; onUnlock: (pwd: string) => void; notify: (m: string) => void; settings?: AppSettings
}) {
  const usable = useMemo(() => accounts
    .filter(a => !!a.encryptedKey && a.apiUrl)
    .sort((a, b) => {
      const ag = categoryFromNote(a.note) === '视频型' ? 0 : 1
      const bg = categoryFromNote(b.note) === '视频型' ? 0 : 1
      return ag - bg
    }), [accounts])
  const [accountId, setAccountId] = useState('')
  const account = usable.find(a => a.id === accountId) ?? usable[0]

  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(5)
  const [ratio, setRatio] = useState('16:9')
  const [firstFrame, setFirstFrame] = useState<string>('')  // 图生视频首帧 data URL
  const [busy, setBusy] = useState(false)
  const [taskText, setTaskText] = useState('')
  const [results, setResults] = useState<string[]>([])
  const [pwdInput, setPwdInput] = useState('')
  const [history, setHistory] = useState<MediaHistoryItem[]>(() => loadHistory('video'))
  const [showHistory, setShowHistory] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const aliveRef = useRef(true)
  useEffect(() => { aliveRef.current = true; setHistory(loadHistory('video')); return () => { aliveRef.current = false } }, [])

  const model = account ? extractModelId(account) : ''
  const needPwd = !!account && !!account.encryptedKey && !getBiometricPassword() && !sessionPwd

  const onPickFrame = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { notify('请选择图片文件'); return }
    const reader = new FileReader()
    reader.onload = () => setFirstFrame(String(reader.result))
    reader.readAsDataURL(file)
  }

  const generate = async () => {
    if (!account) { notify('请先在「API Key 管理」添加带视频 API 地址的账户'); return }
    if (!prompt.trim()) { notify('请先输入画面描述'); return }
    const pwd = getBiometricPassword() || sessionPwd
    if (!pwd) { notify('请先解锁密钥库（本页下方输入主密码）'); return }
    setBusy(true); setResults([]); setTaskText('正在提交生成任务…')
    try {
      const apiKey = await decryptSecret(account.encryptedKey!, pwd)
      const r = await callVideo(account, apiKey, prompt.trim(), {
        duration, ratio, image: firstFrame || undefined,
      })
      if (!r.ok) { setTaskText(r.error ?? '提交失败'); notify(r.error ?? '提交失败'); return }

      let imgs = r.images ?? []
      // 直接返回视频 URL：立即展示
      if (imgs.length > 0) {
        setResults(imgs); setTaskText('视频已生成')
      } else {
        // 异步任务：尝试从文本里提取任务 ID 轮询；失败则保留提交提示（引导去官方查看）
        const idMatch = r.text.match(/ID:\s*([^）)\s]+)/)
        const taskId = idMatch?.[1]
        if (taskId) {
          setTaskText(`任务已提交（${String(taskId).slice(0, 16)}…），正在查询进度…`)
          for (let i = 0; i < 12 && aliveRef.current; i++) {
            await new Promise(res => setTimeout(res, 5000))
            if (!aliveRef.current) return
            const q = await queryVideoTask(account, apiKey, taskId)
            if (q.ok && q.images?.length) { imgs = q.images; break }
            if (!q.ok && q.error) { setTaskText(q.error); break }
            if (q.ok) setTaskText(q.text || '任务处理中…')
          }
          if (imgs.length > 0) { setResults(imgs); setTaskText('视频已生成') }
          else if (aliveRef.current && !taskText.startsWith('视频生成失败')) setTaskText(prev => prev.includes('失败') ? prev : `${r.text}（未自动拿到视频地址，可到官方平台查看）`)
        } else {
          setTaskText(r.text)
        }
      }
      const params = `${duration}秒 · ${ratio}${firstFrame ? ' · 图生视频' : ''}`
      setHistory(addHistory('video', {
        id: newMediaId(), kind: 'video', prompt: prompt.trim(), accountLabel: account.label,
        model, createdAt: Date.now(), results: imgs, params, note: imgs.length ? '' : (taskText || r.text),
      }))
      notify(imgs.length ? '视频已生成' : '视频任务已提交')
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e)
      setTaskText(msg); notify(msg)
    } finally { setBusy(false) }
  }

  const download = async (url: string, idx: number) => {
    try { const loc = await saveMedia(url, 'video', `ai-video-${Date.now()}-${idx + 1}`); notify(`已保存：${loc}`) }
    catch (e) { notify((e as Error)?.message ?? '保存失败') }
  }

  const resetHistory = () => { clearHistory('video'); setHistory([]); notify('历史已清空') }

  return (
    <div className="set-content">
      <div className="gen-layout">
        <section className="gen-panel">
          <div className="gen-panel-head"><span className="gen-head-icon"><Film size={18} /></span><div><h3>AI 视频生成</h3><p>输入画面描述，用你自己的视频账户生成短片</p></div></div>
          <div className="gen-body">
            <label className="gen-label">视频账户</label>
            {usable.length === 0 ? (
              <div className="gen-empty-hint"><KeyRound size={16} /> 还没有可用的视频账户。请到「API Key 管理」添加账户并填写 OpenAI 兼容的 API 地址；模型 ID 写在账户备注里即可。</div>
            ) : (
              <div className="gen-select-wrap">
                <select className="input" value={account?.id ?? ''} onChange={e => setAccountId(e.target.value)}>
                  {usable.map(a => <option key={a.id} value={a.id}>{a.label} · {PROVIDER_MAP[a.providerId]?.shortName ?? a.providerId}</option>)}
                </select>
                {account && <span className="gen-model-tag">模型：{model || '未识别（请在备注填模型ID）'}</span>}
              </div>
            )}

            <label className="gen-label">画面描述（Prompt）</label>
            <textarea className="input gen-prompt" rows={4} placeholder="例如：一只金毛犬在秋天的落叶中奔跑，阳光透过树叶洒下，电影质感，慢镜头"
              value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy} />

            <label className="gen-label">首帧图片（可选，用于图生视频）</label>
            <div className="gen-frame-row">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => onPickFrame(e.target.files?.[0])} />
              <button className="btn sm ghost" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={14} /> 上传首帧图</button>
              {firstFrame ? (
                <div className="gen-frame-preview">
                  <img src={firstFrame} alt="首帧预览" />
                  <button title="移除" onClick={() => setFirstFrame('')}><X size={14} /></button>
                </div>
              ) : <span className="gen-frame-hint">不上传则为文生视频</span>}
            </div>

            <div className="gen-grid-2">
              <div>
                <label className="gen-label">视频时长</label>
                <select className="input" value={duration} onChange={e => setDuration(Number(e.target.value))} disabled={busy}>
                  {DURATIONS.map(d => <option key={d} value={d}>{d} 秒</option>)}
                </select>
              </div>
              <div>
                <label className="gen-label">画面比例</label>
                <select className="input" value={ratio} onChange={e => setRatio(e.target.value)} disabled={busy}>
                  {RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
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
              {busy ? <><Loader2 size={16} className="spin" /> 生成中…</> : <><Sparkles size={16} /> 生成视频</>}
            </button>
            <div className="gen-tip"><Info size={13} /> 视频多为异步任务制，提交后会尝试自动查询进度；若平台为私有协议无法自动拿到结果，界面会给出引导，可到官方平台查看。</div>
          </div>
        </section>

        <section className="gen-panel">
          <div className="gen-panel-head">
            <span className="gen-head-icon"><Sparkles size={18} /></span>
            <div><h3>生成结果</h3><p>{taskText || '生成后的视频会显示在这里'}</p></div>
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
                      <HoldToConfirm title="删除" onConfirm={() => setHistory(removeHistory('video', h.id))} className="sm" />
                    </div>
                    <div className="gen-hist-prompt">{h.prompt}</div>
                    <div className="gen-hist-meta">{h.accountLabel} · {h.params}</div>
                    {h.results.length > 0 ? (
                      <div className="gen-thumbs">
                        {h.results.map((u, i) => <video key={i} src={u} className="gen-thumb" controls={false} muted onClick={() => window.open(u, '_blank', 'noopener')} />)}
                      </div>
                    ) : h.note ? <div className="gen-hist-note">{h.note}</div> : null}
                  </div>
                ))}
                {history.length > 0 && <button className="btn sm ghost" onClick={resetHistory}><Trash2 size={13} /> 清空历史</button>}
              </div>
            ) : results.length > 0 ? (
              <div className="gen-results">
                {results.map((u, i) => (
                  <div className="gen-result-card" key={i}>
                    <video src={u} controls className="gen-result-video" playsInline />
                    <div className="gen-result-actions">
                      <a className="btn sm ghost" href={u} target="_blank" rel="noopener"><ExternalLink size={13} /> 打开</a>
                      <button className="btn sm ghost" onClick={() => void download(u, i)}><Download size={13} /> 下载</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gen-empty">
                <Film size={40} />
                <p>还没有生成视频</p>
                <span>在左侧输入画面描述，点击「生成视频」即可开始</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
