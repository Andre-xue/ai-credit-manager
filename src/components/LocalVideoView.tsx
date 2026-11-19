// AI 视频（本地）专业页面：ComfyUI / SD 风格节点式工作流布局。
// 文生视频 / 图生视频 / 首尾帧，正反向提示词、时长/分辨率/帧率/步数/CFG/种子/运动强度，
// 调用本机 OpenAI 兼容视频服务，任务进度与结果预览，全部本机运行。

import { useEffect, useRef, useState } from 'react'
import {
  Film, Sparkles, Loader2, Download, Trash2, Info, RefreshCw,
  Dices, Upload, X, Maximize2, ChevronDown, SlidersHorizontal, History, Settings2, Workflow,
} from 'lucide-react'
import { callLocalVideo, queryLocalVideoTask, fetchLocalMediaModels } from '../core/providerCall'
import { saveMedia, loadHistory, addHistory, removeHistory, clearHistory, newMediaId, errTextSafe, type MediaHistoryItem } from '../core/mediaGeneration'
import { HoldToConfirm } from './HoldToConfirm'
import { extractTaskId } from '../core/mediaAdapters'
import { isComfyUIBase, fetchComfyCheckpoints } from '../core/comfyui'
import { fetchLocalModels } from '../core/localServices'
import { GenProgressBar, useGenProgress } from './GenProgressBar'

const RESOLUTIONS = ['480p', '576p', '720p', '768p', '1080p']
const RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9']
const DEFAULT_BASE = 'http://127.0.0.1:11434'

export function LocalVideoView({ notify }: { notify: (m: string) => void }) {
  const [base, setBase] = useState(() => {
    if (localStorage.getItem('acm.local.vid.migrated')) return localStorage.getItem('acm.local.vid.base') || DEFAULT_BASE
    const old = localStorage.getItem('acm.local.vid.base')
    const next = !old || old.includes('11434') ? DEFAULT_BASE : old
    localStorage.setItem('acm.local.vid.base', next)
    localStorage.setItem('acm.local.vid.migrated', '1')
    return next
  })
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [mode, setMode] = useState<'t2v' | 'i2v' | 'flf2v'>('t2v')
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [duration, setDuration] = useState(5)
  const [resolution, setResolution] = useState('768p')
  const [ratio, setRatio] = useState('16:9')
  const [fps, setFps] = useState(24)
  const [steps, setSteps] = useState(20)
  const [cfg, setCfg] = useState(7)
  const [seed, setSeed] = useState(-1)
  const [motion, setMotion] = useState(0.7)
  const [firstFrame, setFirstFrame] = useState('')
  const [lastFrame, setLastFrame] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const [lastParams, setLastParams] = useState('')
  const [history, setHistory] = useState<MediaHistoryItem[]>(() => loadHistory('video'))
  const [showHistory, setShowHistory] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)
  const lastRef = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const { progress, start: startProgress, advance: advanceProgress, done: doneProgress, fail: failProgress } = useGenProgress()
  useEffect(() => { alive.current = true; setHistory(loadHistory('video')); return () => { alive.current = false } }, [])
  useEffect(() => { localStorage.setItem('acm.local.vid.base', base) }, [base])

  const loadModels = async () => {
    setLoadingModels(true)
    try {
      let ids: string[]
      if (isComfyUIBase(base)) {
        // ComfyUI 无标准视频接口，只能列出 checkpoint 作为参考底模
        ids = await fetchComfyCheckpoints(base)
        if (ids.length === 0) {
          const r = await fetchLocalModels('comfyui', base)
          if (!r.ok) throw new Error(r.error ?? '拉取失败')
          ids = r.models
        }
        if (ids.length) notify(`已连上 ComfyUI，列出 ${ids.length} 个 checkpoint。注意：ComfyUI 生视频需 AnimateDiff 等工作流，此页可能仍无法生成`)
      } else {
        ids = await fetchLocalMediaModels(base)
      }
      setModels(ids)
      setModel(prev => ids.includes(prev) ? prev : (ids[0] ?? ''))
      if (!isComfyUIBase(base)) notify(`已连接本地服务，找到 ${ids.length} 个模型`)
    } catch (e) {
      const msg = errTextSafe(e)
      notify(!isComfyUIBase(base) && /502|503|connection|refused|连接/i.test(msg)
        ? `连接失败：${msg}。当前地址 ${base} 可能不是视频服务；ComfyUI 默认 8188（但 ComfyUI 生视频需额外工作流）`
        : `连接失败：${msg}`)
    }
    finally { setLoadingModels(false) }
  }
  const randomSeed = () => setSeed(Math.floor(Math.random() * 4294967295))
  const pick = (file: File | undefined, setter: (v: string) => void) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { notify('请选择图片文件'); return }
    const r = new FileReader(); r.onload = () => setter(String(r.result)); r.readAsDataURL(file)
  }

  const generate = async () => {
    if (!prompt.trim()) { notify('请先输入提示词'); return }
    if (!model) { notify('请先连接本地服务并选择模型'); return }
    if ((mode === 'i2v' || mode === 'flf2v') && !firstFrame) { notify('该模式请先上传首帧图'); return }
    if (mode === 'flf2v' && !lastFrame) { notify('首尾帧模式请上传尾帧图'); return }
    if (busy) return
    setBusy(true); setResults([])
    const startedAt = Date.now()
    const finalSeed = seed < 0 ? Math.floor(Math.random() * 4294967295) : seed
    startProgress('正在提交本地任务…')
    try {
      advanceProgress(25, '本地服务响应中…', 'queued')
      const r = await callLocalVideo(base, model, prompt.trim(), {
        duration, ratio, resolution,
        image: (mode === 'i2v' || mode === 'flf2v') ? firstFrame : undefined,
        lastFrame: mode === 'flf2v' ? lastFrame : undefined,
        negativePrompt: negative.trim() || undefined, steps, cfgScale: cfg, seed: finalSeed,
        fps, motionStrength: motion,
      })
      if (!alive.current) return
      if (!r.ok) { failProgress('提交失败'); notify(r.error ?? '提交失败'); return }
      let imgs = r.images ?? []
      const taskId = extractTaskId({ requestId: (r as { requestId?: string }).requestId })
      // 若返回任务 ID 而无视频，轮询查询
      if (imgs.length === 0 && taskId) {
        advanceProgress(35, '任务排队中…', 'queued')
        for (let i = 0; i < 24 && alive.current; i++) {
          await new Promise(res => setTimeout(res, 5000))
          if (!alive.current) return
          const q = await queryLocalVideoTask(base, taskId)
          if (q.ok && q.images?.length) { imgs = q.images; break }
          if (!q.ok && q.error) { failProgress(q.error); notify(q.error); break }
          advanceProgress(Math.min(85, 35 + (i + 1) * 3), q.text || '本地视频生成中…', 'generating')
        }
      }
      if (!alive.current) return
      setResults(imgs)
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
      doneProgress(imgs.length ? `生成完成 · 耗时 ${secs}s` : `任务已提交 · 耗时 ${secs}s`)
      const params = `${mode} · ${model} · ${duration}s · ${resolution} ${ratio} · ${fps}fps · ${steps}步 · CFG ${cfg} · seed ${finalSeed}`
      setLastParams(params)
      setHistory(addHistory('video', {
        id: newMediaId(), kind: 'video', prompt: prompt.trim(), accountLabel: `本地 · ${model}`,
        model, createdAt: Date.now(), results: imgs, params, note: imgs.length ? '' : r.text,
      }))
      notify(imgs.length ? '本地视频已生成' : r.text)
    } catch (e) { if (alive.current) { failProgress('生成失败'); notify(errTextSafe(e)) } }
    finally { if (alive.current) setBusy(false) }
  }

  const download = async (url: string, idx: number) => {
    try { const loc = await saveMedia(url, 'video', `sd-video-${Date.now()}-${idx + 1}`); notify(`已保存：${loc}`) }
    catch (e) { notify(errTextSafe(e)) }
  }
  const resetHistory = () => { clearHistory('video'); setHistory([]); notify('历史已清空') }

  return (
    <div className="sd-page">
      <div className="sd-topbar">
        <div className="sd-brand"><span className="sd-brand-mark"><Workflow size={17} /></span><div><b>AI 视频 · 本地</b><small>ComfyUI 风格工作流 · 全流程本机运行</small></div></div>
        <div className="sd-conn">
          <span className="sd-conn-label">本地服务</span>
          <input className="input" value={base} onChange={e => setBase(e.target.value)} placeholder="http://127.0.0.1:11434" />
          <button className="btn sm ghost" onClick={() => void loadModels()} disabled={loadingModels}><RefreshCw size={14} className={loadingModels ? 'spin' : ''} /> 连接</button>
        </div>
      </div>

      <div className="sd-layout">
        <section className="sd-control">
          <div className="sd-tabs">
            <button className={mode === 't2v' ? 'active' : ''} onClick={() => setMode('t2v')}><Sparkles size={15} /> 文生视频</button>
            <button className={mode === 'i2v' ? 'active' : ''} onClick={() => setMode('i2v')}><Film size={15} /> 图生视频</button>
            <button className={mode === 'flf2v' ? 'active' : ''} onClick={() => setMode('flf2v')}><Workflow size={15} /> 首尾帧</button>
          </div>

          <div className="sd-block">
            <div className="sd-block-title"><Settings2 size={15} /> 模型</div>
            {models.length > 0 ? (
              <select className="input" value={model} onChange={e => setModel(e.target.value)}>{models.map(m => <option key={m} value={m}>{m}</option>)}</select>
            ) : (
              <input className="input" placeholder="点顶部「连接」拉取本地视频模型" value={model} onChange={e => setModel(e.target.value)} />
            )}
          </div>

          <div className="sd-block">
            <div className="sd-block-title"><span className="sd-num">1</span> 提示词 Prompt</div>
            <textarea className="sd-prompt" rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="按时间顺序描述动作：主体、动作、环境、镜头、光线……（建议 200 字内）" />
          </div>
          <div className="sd-block">
            <div className="sd-block-title"><span className="sd-num">2</span> 反向提示词 Negative prompt</div>
            <textarea className="sd-prompt sd-prompt-neg" rows={2} value={negative} onChange={e => setNegative(e.target.value)} placeholder="low quality, blurry, distorted, watermark…" />
          </div>

          {(mode === 'i2v' || mode === 'flf2v') && (
            <div className="sd-block">
              <div className="sd-block-title"><Upload size={15} /> 参考帧</div>
              <div className="sd-frame-row">
                <div className="sd-frame-slot">
                  <span>首帧</span>
                  <input ref={firstRef} type="file" accept="image/*" hidden onChange={e => pick(e.target.files?.[0], setFirstFrame)} />
                  {firstFrame ? <div className="sd-frame-thumb"><img src={firstFrame} alt="首帧" /><button onClick={() => setFirstFrame('')}><X size={12} /></button></div> : <button className="sd-frame-add" onClick={() => firstRef.current?.click()}><Upload size={16} /></button>}
                </div>
                {mode === 'flf2v' && <div className="sd-frame-slot">
                  <span>尾帧</span>
                  <input ref={lastRef} type="file" accept="image/*" hidden onChange={e => pick(e.target.files?.[0], setLastFrame)} />
                  {lastFrame ? <div className="sd-frame-thumb"><img src={lastFrame} alt="尾帧" /><button onClick={() => setLastFrame('')}><X size={12} /></button></div> : <button className="sd-frame-add" onClick={() => lastRef.current?.click()}><Upload size={16} /></button>}
                </div>}
              </div>
            </div>
          )}

          <div className="sd-block">
            <div className="sd-block-title"><SlidersHorizontal size={15} /> 视频参数</div>
            <div className="sd-param-grid">
              <div className="sd-field"><label>时长 <b>{duration}s</b></label><input type="range" min={1} max={15} value={duration} onChange={e => setDuration(Number(e.target.value))} /></div>
              <div className="sd-field"><label>分辨率</label><div className="sd-select-wrap"><select className="input" value={resolution} onChange={e => setResolution(e.target.value)}>{RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}</select><ChevronDown size={13} /></div></div>
              <div className="sd-field"><label>画面比例</label><div className="sd-select-wrap"><select className="input" value={ratio} onChange={e => setRatio(e.target.value)}>{RATIOS.map(r => <option key={r} value={r}>{r}</option>)}</select><ChevronDown size={13} /></div></div>
              <div className="sd-field"><label>帧率 FPS <b>{fps}</b></label><input type="range" min={8} max={60} value={fps} onChange={e => setFps(Number(e.target.value))} /></div>
              <div className="sd-field"><label>采样步数 <b>{steps}</b></label><input type="range" min={1} max={50} value={steps} onChange={e => setSteps(Number(e.target.value))} /></div>
              <div className="sd-field"><label>CFG Scale <b>{cfg}</b></label><input type="range" min={1} max={30} step={0.5} value={cfg} onChange={e => setCfg(Number(e.target.value))} /></div>
              <div className="sd-field"><label>运动强度 <b>{motion.toFixed(2)}</b></label><input type="range" min={0} max={1} step={0.05} value={motion} onChange={e => setMotion(Number(e.target.value))} /></div>
              <div className="sd-field sd-seed-field"><label>种子 Seed</label><div className="sd-seed-row"><input className="input" type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} /><button className="btn sm ghost" onClick={randomSeed} title="随机"><Dices size={15} /></button></div></div>
            </div>
          </div>

          <button className="sd-generate" onClick={() => void generate()} disabled={busy || !prompt.trim()}>
            {busy ? <><Loader2 size={18} className="spin" /> 生成中…</> : <><Sparkles size={18} /> 生成视频</>}
          </button>
          <GenProgressBar progress={progress} />
          <div className="sd-tip"><Info size={13} /> 视频多为异步任务，提交后自动轮询进度。参数是否生效取决于本地服务接口实现；请确认已启动支持视频生成的本地服务。</div>
        </section>

        <section className="sd-result">
          <div className="sd-result-head">
            <div><b>生成结果</b><small>{lastParams || '等待生成'}</small></div>
            <div className="sd-result-actions">
              <button className="btn sm ghost" onClick={() => setShowHistory(v => !v)}><History size={14} /> {showHistory ? '返回' : `历史 ${history.length}`}</button>
            </div>
          </div>
          <div className="sd-gallery-wrap">
            {showHistory ? (
              <div className="sd-history">
                {history.length === 0 && <div className="sd-empty"><History size={40} /><p>暂无历史</p></div>}
                {history.map(h => (
                  <div className="sd-hist-card" key={h.id}>
                    <div className="sd-hist-head"><span>{new Date(h.createdAt).toLocaleString('zh-CN')}</span><HoldToConfirm title="删除" onConfirm={() => setHistory(removeHistory('video', h.id))} /></div>
                    <div className="sd-hist-prompt">{h.prompt}</div>
                    <div className="sd-hist-params">{h.params}</div>
                    {h.results.length > 0 ? <div className="sd-hist-thumbs">{h.results.map((u, i) => <video key={i} src={u} muted />)}</div> : h.note ? <div className="sd-hist-note">{h.note}</div> : null}
                  </div>
                ))}
                {history.length > 0 && <button className="btn sm ghost" onClick={resetHistory}><Trash2 size={13} /> 清空历史</button>}
              </div>
            ) : results.length > 0 ? (
              <div className="sd-gallery">
                {results.map((u, i) => (
                  <div className="sd-gallery-item sd-video-item" key={i}>
                    <video src={u} controls playsInline />
                    <div className="sd-gallery-bar"><span>视频 #{i + 1}</span><a href={u} target="_blank" rel="noopener"><Maximize2 size={14} /></a><button onClick={() => void download(u, i)} title="下载"><Download size={14} /></button></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sd-empty"><Film size={44} /><p>还没有生成视频</p><span>在左侧填写提示词，点击「生成视频」开始</span></div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
