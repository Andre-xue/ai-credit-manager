// 「语音配置」独立模块：声音克隆（录音/音频文件 → AI 发音）、已保存音色管理、
// 语速、试听、声音服务目录、第三方 TTS 代理配置。
// 系统内置音色/拟真预设/方言已从界面移除；未克隆时底层仍用系统 TTS 兜底，避免 AI 完全无声。

import { useEffect, useState } from 'react'
import { Volume2, Play, Square, Trash2, Loader2, Info, Globe2, Mic, Check, Pencil } from 'lucide-react'
import {
  getRate, saveRate, stopSpeak, getSpeakSource, speakAsync,
} from '../core/tts'
import {
  loadVoiceSample, saveVoiceSample, deleteVoiceSample, recordVoiceSample,
  cloneVoiceFromSample, getClonedVoiceId, listClonedVoices, removeClonedVoice,
  setActiveClonedVoice, renameClonedVoice, type VoiceSample, type ClonedVoice,
} from '../core/voiceClone'
import { isDesktopApp, openExternal } from '../core/openExternal'
import { VOICE_PROVIDERS } from '../core/voiceProviders'
import {
  hasTtsConfig, getTtsConfig, saveTtsConfig, clearTtsConfig,
  type TtsProviderConfig,
} from '../core/voice-download'

export function VoiceSettings({ notify }: { notify: (m: string) => void }) {
  const [rate, setRate] = useState(getRate())
  const [ttsConfigured, setTtsConfigured] = useState(hasTtsConfig())
  const [config, setConfig] = useState<TtsProviderConfig>(() => getTtsConfig())
  const [configOpen, setConfigOpen] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [sample, setSample] = useState<VoiceSample | null>(null)
  const [clonedId, setClonedId] = useState<string | null>(() => getClonedVoiceId())
  const [clonedVoices, setClonedVoices] = useState<ClonedVoice[]>(() => listClonedVoices())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [cloning, setCloning] = useState(false)
  const desktop = isDesktopApp()
  const fileRef = useState(() => ({ current: null as HTMLInputElement | null }))[0]

  useEffect(() => { void loadVoiceSample().then(setSample) }, [])

  const tryPreview = () => {
    if (previewing) { stopSpeak(); setPreviewing(false); return }
    if (getSpeakSource() !== 'clone') {
      notify('当前没有可用的克隆音色，请先在下方导入声音样本并克隆')
      return
    }
    setPreviewing(true)
    void speakAsync('你好，这是当前克隆音色的试听。', null, (s) => {
      if (s === 'end' || s === 'error') setPreviewing(false)
    }, (reason) => { notify(reason); setPreviewing(false) }).then(ok => {
      if (!ok) { notify('克隆音色试听失败'); setPreviewing(false) }
    })
  }

  const changeRate = (r: number) => { setRate(r); saveRate(r) }

  const saveConfig = () => {
    if (config.provider && !config.endpoint) { notify('请填写服务端点'); return }
    saveTtsConfig(config)
    setTtsConfigured(!!(config.provider && config.endpoint))
    setConfigOpen(false)
    notify(config.provider ? '语音服务配置已保存' : '已清除语音服务配置')
  }

  const doRecord = async () => {
    if (desktop) { notify('桌面端 WebView 不提供浏览器录音接口，请用「选择音频文件」导入样本'); return }
    try {
      notify('开始录音，8 秒后自动结束…')
      const blob = await recordVoiceSample(8)
      setSample(await saveVoiceSample(blob, '录音样本.webm'))
      notify('声音样本已保存，可点击「克隆为 AI 发音」')
    } catch (e) { notify((e as Error).message ?? '录音失败') }
  }

  const pickNativeAudio = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({ multiple: false, filters: [{ name: '音频文件', extensions: ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'webm'] }] })
      if (typeof picked !== 'string') return
      const { readFile } = await import('@tauri-apps/plugin-fs')
      const bytes = await readFile(picked)
      const ext = picked.split('.').pop()?.toLowerCase() ?? ''
      const mime = ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : ext === 'm4a' ? 'audio/mp4' : `audio/${ext}`
      const blob = new Blob([bytes], { type: mime })
      setSample(await saveVoiceSample(blob, picked.split('/').pop() ?? picked))
      notify('音频样本已导入，可点击「克隆为 AI 发音」')
    } catch (e) { notify((e as Error)?.message ?? '读取音频文件失败') }
  }

  const doPickFile = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('audio/')) { notify('请选择音频文件'); return }
    setSample(await saveVoiceSample(file, file.name))
    notify('音频样本已保存，可点击「克隆为 AI 发音」')
  }

  const doClone = async () => {
    if (!sample) { notify('请先录音或选择音频文件'); return }
    setCloning(true)
    try {
      const r = await cloneVoiceFromSample(sample)
      if (!r.ok) { notify(r.error ?? '克隆失败'); return }
      setClonedId(r.voiceId ?? null)
      setClonedVoices(listClonedVoices())
      notify('克隆成功，AI 回复将优先使用该音色')
    } finally { setCloning(false) }
  }

  const removeSample = async () => {
    await deleteVoiceSample()
    setSample(null)
    notify('已删除临时声音样本（已保存的克隆音色不受影响）')
  }

  const pickCloned = (v: ClonedVoice) => {
    setActiveClonedVoice(v.voiceId)
    setClonedId(v.voiceId)
    notify(`已切换克隆音色：${v.name}`)
  }

  const dropCloned = (v: ClonedVoice) => {
    removeClonedVoice(v.id)
    setClonedVoices(listClonedVoices())
    setClonedId(getClonedVoiceId())
    notify(`已删除「${v.name}」；云端音色需到百炼控制台单独清理`)
  }

  const commitRename = (v: ClonedVoice) => {
    if (!renameText.trim()) { setRenaming(null); return }
    renameClonedVoice(v.id, renameText)
    setClonedVoices(listClonedVoices())
    setRenaming(null)
    notify('已重命名')
  }

  return (
    <div className="voice-settings">
      {/* 当前朗读源标识 */}
      <div className={`voice-source-badge ${getSpeakSource() === 'clone' ? 'clone' : 'system'}`}>
        {getSpeakSource() === 'clone'
          ? <>🎙 当前 AI 回复使用「克隆音色」——下方试听、聊天与通话朗读均走此音色</>
          : <>🔊 当前未设置克隆音色，AI 回复使用系统默认音色兜底。导入声音样本并克隆后即可用你自己的声音。</>}
      </div>

      <div className="voice-row">
        <div className="voice-row-label">语速 <span>{rate.toFixed(1)}×</span></div>
        <input type="range" min="0.5" max="2" step="0.1" value={rate} onChange={e => changeRate(Number(e.target.value))} className="voice-range" />
      </div>
      <button className="voice-preview" onClick={tryPreview}>
        {previewing ? <Square size={14} /> : <Play size={14} />} {previewing ? '停止试听' : '试听克隆音色'}
      </button>

      {/* 声音克隆 */}
      <div className="voice-section-label dialect"><Volume2 size={14} /> 声音克隆（录音 / 音频文件 → AI 发音）</div>
      <div className="voice-row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn sm" disabled={desktop} title={desktop ? '桌面 WebView 不支持浏览器录音' : '录制 8 秒声音样本'} onClick={() => void doRecord()}><Mic size={14} /> 录音 8 秒</button>
        {desktop ? (
          <button className="btn sm primary" onClick={() => void pickNativeAudio()}><Volume2 size={14} /> 选择音频文件</button>
        ) : (
          <>
            <button className="btn sm" onClick={() => fileRef.current?.click()}><Volume2 size={14} /> 选择音频文件</button>
            <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => { void doPickFile(e.target.files?.[0]); e.target.value = '' }} />
          </>
        )}
        <button className="btn sm primary" disabled={!sample || cloning} onClick={() => void doClone()}>
          {cloning ? <><Loader2 size={14} className="spin" /> 克隆中…</> : '克隆为 AI 发音'}
        </button>
        {sample && <button className="btn sm ghost" onClick={() => void removeSample()}><Trash2 size={14} /> 删除样本</button>}
      </div>
      {sample && <div className="voice-hint">样本：{sample.name}（{(sample.size / 1024).toFixed(0)} KB）</div>}
      {!ttsConfigured && <div className="voice-hint"><Info size={13} /> 声音克隆需要第三方语音服务代理（下方配置）；内置免费模型不提供克隆能力。</div>}
      {desktop && <div className="voice-hint"><Info size={13} /> 桌面 WebView 不提供浏览器录音接口；请用「选择音频文件」导入样本（可先用 QuickTime 等工具录音）。</div>}

      {/* 已保存的克隆音色列表：可命名、切换、删除 */}
      <div className="voice-section-label dialect" style={{ marginTop: 14 }}>已保存的克隆音色（{clonedVoices.length}）· 点击切换</div>
      {clonedVoices.length > 0 ? (
        <div className="cloned-voice-list">
          {clonedVoices.map(v => {
            const active = v.voiceId === clonedId
            return (
              <div key={v.id} className={`cloned-voice-item ${active ? 'active' : ''}`}>
                <button className="cloned-voice-main" onClick={() => pickCloned(v)} title="点击切换为当前音色">
                  {active ? <Check size={14} /> : <Volume2 size={14} />}
                  <span>
                    <b>{v.name}</b>
                    <small>{active ? '使用中' : `voiceId: ${v.voiceId.slice(-10)}`}</small>
                  </span>
                </button>
                <div className="cloned-voice-actions">
                  {renaming === v.id ? (
                    <>
                      <input className="input" style={{ width: 110 }} value={renameText} autoFocus
                        onChange={e => setRenameText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(v); if (e.key === 'Escape') setRenaming(null) }} />
                      <button className="icon-btn" onClick={() => commitRename(v)}><Check size={14} /></button>
                    </>
                  ) : (
                    <button className="icon-btn" title="重命名" onClick={() => { setRenaming(v.id); setRenameText(v.name) }}><Pencil size={14} /></button>
                  )}
                  <button className="icon-btn" title="删除此记录" onClick={() => dropCloned(v)}><Trash2 size={14} /></button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="voice-empty">还没有克隆音色。导入一段清晰人声（10~20 秒），点「克隆为 AI 发音」即可创建。</div>
      )}
      <div className="voice-hint">克隆音色保存在本机；删除记录只移除本机引用，云端音色请到百炼控制台清理以释放配额。</div>

      {/* 免费优先语音服务目录 */}
      <div className="voice-section-label"><Globe2 size={14} /> 声音服务（免费优先 · 点卡片查看官方文档）</div>
      <div className="voice-provider-grid">
        {VOICE_PROVIDERS.map(p => (
          <button key={p.id} className={`voice-provider ${p.recommended ? 'recommended' : ''}`} onClick={() => {
            setConfig({ ...config, provider: p.id === 'system' ? '' : p.id as TtsProviderConfig['provider'] }); setConfigOpen(true)
            if (p.id !== 'system') void openExternal(p.docs)
          }}>
            <span className="voice-provider-head"><b>{p.name}</b>{p.recommended && <em>免费优先</em>}</span>
            <span className="voice-provider-free">{p.free}</span>
            <small>{p.paid}</small>
          </button>
        ))}
      </div>

      {/* 第三方 TTS 配置 */}
      <button className="voice-config-toggle" onClick={() => setConfigOpen(v => !v)}>
        <Globe2 size={14} /> 第三方语音服务配置 {ttsConfigured ? '（已配置）' : '（未配置）'} <span>{configOpen ? '收起' : '展开'}</span>
      </button>
      {configOpen && <div className="voice-config">
        <label className="form-label">服务商
          <select className="select" value={config.provider} onChange={e => setConfig({ ...config, provider: e.target.value as TtsProviderConfig['provider'] })}>
            <option value="">未选择</option>
            {VOICE_PROVIDERS.filter(p => p.id !== 'system').map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="form-label">服务端点（代理地址，密钥在服务端持有)
          <input className="input" value={config.endpoint} onChange={e => setConfig({ ...config, endpoint: e.target.value })} placeholder="https://your-tts-proxy.example.com" />
        </label>
        <div className="voice-config-note">为安全起见，请将 AccessKey 保存在服务端代理，前端仅配置端点地址。</div>
        <div className="voice-config-actions">
          <button className="btn sm primary" onClick={saveConfig}>保存配置</button>
          {ttsConfigured && <button className="btn sm ghost" onClick={() => { clearTtsConfig(); setConfig({ provider: '', endpoint: '' }); setTtsConfigured(false); notify('已清除配置') }}>清除</button>}
        </div>
      </div>}
    </div>
  )
}
