// AI 图像（本地）专业页面：Stable Diffusion WebUI 风格。
// 文生图 / 图生图、正反向提示词、采样器/步数/CFG/种子/尺寸/批量等完整参数，
// 调用本机 OpenAI 兼容生图服务（ComfyUI 插件 / LocalAI / SD WebUI API 等），结果与参数存本机。

import { useEffect, useRef, useState } from 'react'
import {
  Image as ImageIcon, Sparkles, Loader2, Download, Trash2, Info, RefreshCw,
  Dices, Upload, X, Maximize2, ChevronDown, SlidersHorizontal, History, Settings2,
} from 'lucide-react'
import { callLocalImage, fetchLocalMediaModels } from '../core/providerCall'
import { isComfyUIBase, comfyGenerate } from '../core/comfyui'
import { fetchLocalModels } from '../core/localServices'
import { saveMedia, loadHistory, addHistory, removeHistory, clearHistory, newMediaId, errTextSafe, urlToThumb, type MediaHistoryItem } from '../core/mediaGeneration'
import { HoldToConfirm } from './HoldToConfirm'
import { GenProgressBar, useGenProgress } from './GenProgressBar'
import { SafeThumb } from './SafeThumb'

const SAMPLERS = ['Euler a', 'Euler', 'DPM++ 2M Karras', 'DPM++ 2M', 'DPM++ SDE Karras', 'DDIM', 'UniPC', 'LMS', 'Heun']
const RATIOS = [
  { label: '1:1', w: 1024, h: 1024 }, { label: '3:4', w: 768, h: 1024 }, { label: '4:3', w: 1024, h: 768 },
  { label: '9:16', w: 576, h: 1024 }, { label: '16:9', w: 1024, h: 576 }, { label: '2:3', w: 832, h: 1248 },
]
const DEFAULT_BASE = 'http://127.0.0.1:8188'  // ComfyUI 默认端口

export function LocalImageView({ notify }: { notify: (m: string) => void }) {
  const [base, setBase] = useState(() => localStorage.getItem('acm.local.img.base') || DEFAULT_BASE)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [mode, setMode] = useState<'txt2img' | 'img2img'>('txt2img')
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [sampler, setSampler] = useState('DPM++ 2M Karras')
  const [steps, setSteps] = useState(20)
  const [cfg, setCfg] = useState(7)
  const [seed, setSeed] = useState(-1)
  const [width, setWidth] = useState(1024)
  const [height, setHeight] = useState(1024)
  const [batch, setBatch] = useState(1)
  const [strength, setStrength] = useState(0.7)
  const [sourceImage, setSourceImage] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const [lastParams, setLastParams] = useState('')
  const [lightbox, setLightbox] = useState('')
  const [history, setHistory] = useState<MediaHistoryItem[]>(() => loadHistory('image'))
  const [showHistory, setShowHistory] = useState(false)
  const { progress, start: startProgress, advance: advanceProgress, done: doneProgress, fail: failProgress } = useGenProgress()
  const fileRef = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; setHistory(loadHistory('image')); return () => { alive.current = false } }, [])
  useEffect(() => { localStorage.setItem('acm.local.img.base', base) }, [base])

  const loadModels = async () => {
    setLoadingModels(true)
    try {
      let ids: string[]
      if (isComfyUIBase(base)) {
        const r = await fetchLocalModels('comfyui', base)
        if (!r.ok) throw new Error(r.error ?? '拉取失败')
        ids = r.models
      } else {
        ids = await fetchLocalMediaModels(base)
      }
      setModels(ids)
      setModel(prev => ids.includes(prev) ? prev : (ids[0] ?? ''))
      notify(`已连接本地服务，找到 ${ids.length} 个模型${isComfyUIBase(base) ? '（ComfyUI）' : ''}`)
    } catch (e) { notify(`连接失败：${errTextSafe(e)}`) }
    finally { setLoadingModels(false) }
  }

  const randomSeed = () => setSeed(Math.floor(Math.random() * 4294967295))
  const onPickImage = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { notify('请选择图片文件'); return }
    const r = new FileReader()
    r.onload = () => setSourceImage(String(r.result))
    r.readAsDataURL(file)
  }

  const generate = async () => {
    if (!prompt.trim()) { notify('请先输入提示词'); return }
    if (!model) { notify('请先连接本地服务并选择模型'); return }
    if (mode === 'img2img' && !sourceImage) { notify('图生图模式请先上传源图'); return }
    if (busy) return
    setBusy(true); setResults([])
    const startedAt = Date.now()
    const finalSeed = seed < 0 ? Math.floor(Math.random() * 4294967295) : seed
    startProgress('正在连接本地模型…')
    try {
      const opts = {
        n: batch, size: `${width}x${height}`, width, height, sampler, steps, cfgScale: cfg,
        seed: finalSeed, negativePrompt: negative.trim() || undefined,
        sourceImage: mode === 'img2img' ? sourceImage : undefined,
        strength: mode === 'img2img' ? strength : undefined,
      }
      let imgs: string[]
      if (isComfyUIBase(base)) {
        advanceProgress(20, '正在构造 ComfyUI 工作流…')
        const cr = await comfyGenerate(base, model, prompt.trim(), opts,
          (pct, label) => advanceProgress(pct, label, pct >= 40 ? 'generating' : 'queued'),
          () => alive.current)
        if (!alive.current) return
        if (!cr.ok) { failProgress('生成失败'); notify(cr.error ?? '生成失败'); return }
        imgs = cr.images
      } else {
        advanceProgress(30, '本地模型正在绘制…')
        const r = await callLocalImage(base, model, prompt.trim(), opts)
        if (!alive.current) return
        if (!r.ok) { failProgress('生成失败'); notify(r.error ?? '生成失败'); return }
        imgs = r.images ?? []
      }
      // 远程临时链接转本地缩略图（ComfyUI 返回的是 data URL，本身即本地副本）
      const thumbs = await Promise.all(imgs.map(u => urlToThumb(u)))
      setResults(imgs.map((u, i) => thumbs[i] || u))
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
      doneProgress(`生成完成 · 耗时 ${secs}s`)
      const params = `${mode} · ${model} · ${width}x${height} · ${sampler} · ${steps}步 · CFG ${cfg} · seed ${finalSeed}${mode === 'img2img' ? ` · 重绘 ${strength}` : ''}`
      setLastParams(params)
      setHistory(addHistory('image', {
        id: newMediaId(), kind: 'image', prompt: prompt.trim(), accountLabel: `本地 · ${model}`,
        model, createdAt: Date.now(), results: imgs, thumbs, params,
      }))
      notify(imgs.length ? `已生成 ${imgs.length} 张图片` : '生成完成但未返回图片')
    } catch (e) { if (alive.current) { failProgress('生成失败'); notify(errTextSafe(e)) } }
    finally { if (alive.current) setBusy(false) }
  }

  const download = async (url: string, idx: number) => {
    try { const loc = await saveMedia(url, 'image', `sd-local-${Date.now()}-${idx + 1}`); notify(`已保存：${loc}`) }
    catch (e) { notify(errTextSafe(e)) }
  }
  const resetHistory = () => { clearHistory('image'); setHistory([]); notify('历史已清空') }

  return (
    <div className="sd-page">
      {/* 顶部服务栏 */}
      <div className="sd-topbar">
        <div className="sd-brand"><span className="sd-brand-mark"><Sparkles size={17} /></span><div><b>AI 图像 · 本地</b><small>Stable Diffusion 风格 · 全流程本机运行</small></div></div>
        <div className="sd-conn">
          <span className="sd-conn-label">本地服务</span>
          <input className="input" value={base} onChange={e => setBase(e.target.value)} placeholder="http://127.0.0.1:8188" />
          <button className="btn sm ghost" onClick={() => void loadModels()} disabled={loadingModels}><RefreshCw size={14} className={loadingModels ? 'spin' : ''} /> 连接</button>
        </div>
      </div>

      <div className="sd-layout">
        {/* 左：控制区 */}
        <section className="sd-control">
          <div className="sd-tabs">
            <button className={mode === 'txt2img' ? 'active' : ''} onClick={() => setMode('txt2img')}><Sparkles size={15} /> 文生图 txt2img</button>
            <button className={mode === 'img2img' ? 'active' : ''} onClick={() => setMode('img2img')}><ImageIcon size={15} /> 图生图 img2img</button>
          </div>

          <div className="sd-block">
            <div className="sd-block-title"><Settings2 size={15} /> 模型</div>
            {models.length > 0 ? (
              <select className="input" value={model} onChange={e => setModel(e.target.value)}>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input className="input" placeholder="点顶部「连接」拉取本地模型，或手填模型名" value={model} onChange={e => setModel(e.target.value)} />
            )}
          </div>

          <div className="sd-block">
            <div className="sd-block-title"><span className="sd-num">1</span> 提示词 Prompt</div>
            <textarea className="sd-prompt" rows={5} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="描述你想生成的画面：主体、动作、环境、镜头、光线、风格……" />
            <div className="sd-prompt-hint">支持英文标签权重，如 (masterpiece:1.2), best quality</div>
          </div>

          <div className="sd-block">
            <div className="sd-block-title"><span className="sd-num">2</span> 反向提示词 Negative prompt</div>
            <textarea className="sd-prompt sd-prompt-neg" rows={3} value={negative} onChange={e => setNegative(e.target.value)} placeholder="不想出现的元素：lowres, bad anatomy, watermark, text…" />
          </div>

          {mode === 'img2img' && (
            <div className="sd-block">
              <div className="sd-block-title"><Upload size={15} /> 源图与重绘幅度</div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => onPickImage(e.target.files?.[0])} />
              <div className="sd-img2img-row">
                <button className="btn sm ghost" onClick={() => fileRef.current?.click()}><Upload size={14} /> 上传源图</button>
                {sourceImage && <div className="sd-src-thumb"><img src={sourceImage} alt="源图" /><button onClick={() => setSourceImage('')} title="移除"><X size={13} /></button></div>}
              </div>
              <div className="sd-slider-row">
                <label>重绘幅度 <b>{strength.toFixed(2)}</b></label>
                <input type="range" min={0} max={1} step={0.05} value={strength} onChange={e => setStrength(Number(e.target.value))} />
                <div className="sd-slider-tips"><span>低=保留原图</span><span>高=自由发挥</span></div>
              </div>
            </div>
          )}

          <div className="sd-block">
            <div className="sd-block-title"><SlidersHorizontal size={15} /> 采样与参数</div>
            <div className="sd-param-grid">
              <div className="sd-field">
                <label>采样方法</label>
                <div className="sd-select-wrap"><select className="input" value={sampler} onChange={e => setSampler(e.target.value)}>{SAMPLERS.map(s => <option key={s} value={s}>{s}</option>)}</select><ChevronDown size={13} /></div>
              </div>
              <div className="sd-field sd-seed-field">
                <label>种子 Seed</label>
                <div className="sd-seed-row"><input className="input" type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} /><button className="btn sm ghost" onClick={randomSeed} title="随机种子"><Dices size={15} /></button></div>
              </div>
              <div className="sd-field">
                <label>采样步数 <b>{steps}</b></label>
                <input type="range" min={1} max={50} value={steps} onChange={e => setSteps(Number(e.target.value))} />
              </div>
              <div className="sd-field">
                <label>CFG Scale <b>{cfg}</b></label>
                <input type="range" min={1} max={30} step={0.5} value={cfg} onChange={e => setCfg(Number(e.target.value))} />
              </div>
              <div className="sd-field">
                <label>生成张数</label>
                <select className="input" value={batch} onChange={e => setBatch(Number(e.target.value))}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} 张</option>)}</select>
              </div>
            </div>
          </div>

          <div className="sd-block">
            <div className="sd-block-title"><Maximize2 size={15} /> 尺寸</div>
            <div className="sd-ratio-row">{RATIOS.map(r => <button key={r.label} className={(width === r.w && height === r.h) ? 'active' : ''} onClick={() => { setWidth(r.w); setHeight(r.h) }}>{r.label}</button>)}</div>
            <div className="sd-size-row">
              <div className="sd-field"><label>宽度</label><input className="input" type="number" step={64} value={width} onChange={e => setWidth(Number(e.target.value))} /></div>
              <span className="sd-size-x">×</span>
              <div className="sd-field"><label>高度</label><input className="input" type="number" step={64} value={height} onChange={e => setHeight(Number(e.target.value))} /></div>
            </div>
          </div>

          <button className="sd-generate" onClick={() => void generate()} disabled={busy || !prompt.trim()}>
            {busy ? <><Loader2 size={18} className="spin" /> 生成中…</> : <><Sparkles size={18} /> 生成图片</>}
          </button>
          <GenProgressBar progress={progress} />
          <div className="sd-tip"><Info size={13} /> 自动识别服务类型：地址含 8188 或 comfyui 时走 ComfyUI 原生工作流（/prompt + /history），其余走 OpenAI 兼容接口。ComfyUI 需在桌面端使用。</div>
        </section>

        {/* 右：结果区 */}
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
                    <div className="sd-hist-head"><span>{new Date(h.createdAt).toLocaleString('zh-CN')}</span><HoldToConfirm title="删除" onConfirm={() => setHistory(removeHistory('image', h.id))} /></div>
                    <div className="sd-hist-prompt">{h.prompt}</div>
                    <div className="sd-hist-params">{h.params}</div>
                    <div className="sd-hist-thumbs">{h.results.map((u, i) => <SafeThumb key={i} src={h.thumbs?.[i] || u} fallbackSrc={u} className="gen-thumb" onClick={() => setLightbox(u)} />)}</div>
                  </div>
                ))}
                {history.length > 0 && <button className="btn sm ghost" onClick={resetHistory}><Trash2 size={13} /> 清空历史</button>}
              </div>
            ) : results.length > 0 ? (
              <div className="sd-gallery">
                {results.map((u, i) => (
                  <div className="sd-gallery-item" key={i}>
                    {/^data:|^https?:/.test(u) ? <img src={u} alt={`结果 ${i + 1}`} /> : <div className="sd-gallery-text">{u}</div>}
                    <div className="sd-gallery-bar">
                      <span>#{i + 1}</span>
                      <button onClick={() => setLightbox(u)} title="放大"><Maximize2 size={14} /></button>
                      <button onClick={() => void download(u, i)} title="下载"><Download size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sd-empty"><ImageIcon size={44} /><p>还没有生成图片</p><span>在左侧填写提示词，点击「生成图片」开始</span></div>
            )}
          </div>
        </section>
      </div>

      {lightbox && (() => {
        const idx = results.indexOf(lightbox)
        return (
          <div className="sd-lightbox" onClick={() => setLightbox('')}>
            <button className="sd-lightbox-close" onClick={() => setLightbox('')}><X size={24} /></button>
            <img src={lightbox} alt="大图预览" onClick={e => e.stopPropagation()} />
            {idx >= 0 && <button className="sd-lightbox-dl" onClick={() => void download(lightbox, idx)}><Download size={15} /> 下载</button>}
          </div>
        )
      })()}
    </div>
  )
}
