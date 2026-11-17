// 设置页「语音朗读」区块：系统音色选择、方言音色（需第三方 TTS）、试听、语速、
// 第三方 TTS 配置、音色文件下载管理（单槽位互斥）。

import { useEffect, useState } from 'react'
import { Volume2, Play, Square, Download, Trash2, Loader2, Info, MapPin, Globe2, Mic } from 'lucide-react'
import {
  listSystemVoices, onVoicesReady, getSavedVoice, saveVoice, listPresetVoices,
  getRate, saveRate, previewVoice, stopSpeak, type VoiceOption,
} from '../core/tts'
import {
  loadVoiceSample, saveVoiceSample, deleteVoiceSample, recordVoiceSample,
  cloneVoiceFromSample, getClonedVoiceId, type VoiceSample,
} from '../core/voiceClone'
import { requirePermission } from '../core/permissions'
import { isDesktopApp, openExternal } from '../core/openExternal'
import { VOICE_PROVIDERS } from '../core/voiceProviders'
import {
  hasTtsConfig, getTtsConfig, saveTtsConfig, clearTtsConfig,
  getActiveVoiceFile, hasDownloadedVoice, deleteActiveVoiceFile, switchVoice,
  type VoiceDownloadState, type TtsProviderConfig,
} from '../core/voice-download'

/** 方言音色：需第三方 TTS，无配置时禁用 */
const DIALECT_VOICES = [
  { id: 'yue', name: '粤语', desc: '广东话 · 标准粤语', flag: '粤' },
  { id: 'sichuan', name: '四川话', desc: '西南官话 · 成都腔', flag: '川' },
  { id: 'shanghai', name: '上海话', desc: '吴语 · 市区腔', flag: '沪' },
  { id: 'northeast', name: '东北话', desc: '东北官话 · 沈阳腔', flag: '东北' },
]

const GROUP_LABEL: Record<VoiceOption['group'], string> = {
  mandarin: '普通话', tw: '台湾腔', cantonese: '粤语（系统）', other: '其他', dialect: '方言',
}

export function VoiceSettings({ notify }: { notify: (m: string) => void }) {
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [selected, setSelected] = useState<string | null>(() => getSavedVoice())
  const [rate, setRate] = useState(getRate())
  const [downloaded, setDownloaded] = useState(false)
  const [voiceName, setVoiceName] = useState('')
  const [ttsConfigured, setTtsConfigured] = useState(hasTtsConfig())
  const [config, setConfig] = useState<TtsProviderConfig>(() => getTtsConfig())
  const [configOpen, setConfigOpen] = useState(false)
  const [dlState, setDlState] = useState<VoiceDownloadState>('idle')
  const [dialectId, setDialectId] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [sample, setSample] = useState<VoiceSample | null>(null)
  const [clonedId, setClonedId] = useState<string | null>(() => getClonedVoiceId())
  const [cloning, setCloning] = useState(false)
  const fileRef = useState(() => ({ current: null as HTMLInputElement | null }))[0]

  useEffect(() => {
    const refresh = () => setVoices(listSystemVoices())
    refresh()
    return onVoicesReady(refresh)
  }, [])
  useEffect(() => {
    hasDownloadedVoice().then(async has => {
      setDownloaded(has)
      if (has) { const f = await getActiveVoiceFile(); setVoiceName(f?.name ?? '') }
    })
  }, [])

  useEffect(() => {
    void loadVoiceSample().then(setSample)
  }, [])

  const pickVoice = (v: VoiceOption) => {
    saveVoice(v.uri)
    setSelected(v.uri)
    notify(`已选择音色：${v.name}`)
  }

  const tryPreview = () => {
    if (previewing) { stopSpeak(); setPreviewing(false); return }
    const ok = previewVoice(selected)
    if (!ok) { notify('当前环境不支持语音朗读'); return }
    setPreviewing(true)
    window.setTimeout(() => setPreviewing(false), 4000)
  }

  const changeRate = (r: number) => { setRate(r); saveRate(r) }

  const downloadDialect = async (d: typeof DIALECT_VOICES[number]) => {
    if (!ttsConfigured) { notify('请先在下方配置第三方语音服务'); return }
    setDialectId(d.id)
    const result = await switchVoice(d.id, d.name, setDlState, msg => {
      notify(msg)
      // 旧文件已被删除，立即刷新状态
      setDownloaded(false)
      setVoiceName('')
    })
    if (result.ok) {
      setDownloaded(true)
      setVoiceName(d.name)
      notify(`${d.name}音色已就绪`)
    } else notify(result.error ?? '下载失败')
    setDialectId(null)
  }

  const removeVoice = async () => {
    await deleteActiveVoiceFile()
    setDownloaded(false)
    setVoiceName('')
    notify('已删除下载的音色文件，释放了存储空间')
  }

  const saveConfig = () => {
    if (config.provider && !config.endpoint) { notify('请填写服务端点'); return }
    saveTtsConfig(config)
    setTtsConfigured(!!(config.provider && config.endpoint))
    setConfigOpen(false)
    notify(config.provider ? '语音服务配置已保存' : '已清除语音服务配置')
  }

  const desktop = isDesktopApp()

  const doRecord = async () => {
    if (desktop) { notify('桌面端 WebView 不提供浏览器录音接口，请用「选择音频文件」导入样本'); return }
    if (!requirePermission('microphone', notify)) return
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
      notify('克隆成功，AI 回复将优先使用该音色')
    } finally { setCloning(false) }
  }

  const removeSample = async () => {
    await deleteVoiceSample()
    setSample(null); setClonedId(null)
    notify('已删除声音样本与克隆音色')
  }

  const groups: VoiceOption['group'][] = ['mandarin', 'tw', 'cantonese', 'other']

  return (
    <div className="voice-settings">
      {/* 音色选择 */}
      <div className="voice-section-label"><Volume2 size={14} /> 朗读音色（系统内置 · 无需下载）</div>
      {voices.length === 0 ? (
        <div className="voice-empty">正在加载系统音色…若长时间为空，说明当前系统未安装中文语音包。</div>
      ) : groups.map(g => {
        const list = voices.filter(v => v.group === g)
        if (list.length === 0) return null
        return (
          <div key={g} className="voice-group">
            <div className="voice-group-title">{GROUP_LABEL[g]} <span>{list.length}</span></div>
            <div className="voice-chips">
              {list.map(v => (
                <button key={v.uri} className={`voice-chip ${selected === v.uri ? 'active' : ''}`} onClick={() => pickVoice(v)}>
                  {v.name}
                </button>
              ))}
            </div>
          </div>
        )
      })}

      {/* 拟真音色预设 */}
      <div className="voice-section-label"><Volume2 size={14} /> 拟真音色预设（豆包风格 · 基于系统语音包）</div>
      <div className="voice-dialect-grid">
        {listPresetVoices().map(p => {
          const active = !!selected && selected === p.uri
          return (
            <button key={p.id} className={`voice-dialect ${active ? 'busy' : ''}`} onClick={() => {
              const uri = p.uri ?? listSystemVoices()[0]?.uri ?? null
              if (!uri) { notify('系统暂无可用中文音色'); return }
              saveVoice(uri); setSelected(uri); notify(`已选择「${p.name}」${p.fallbackName}`)
            }}>
              <span className="voice-dialect-flag">{p.name.slice(0, 1)}</span>
              <span className="voice-dialect-info"><b>{p.name}</b><small>{p.desc}</small></span>
              {active ? <span className="voice-ready">使用中</span> : null}
            </button>
          )
        })}
      </div>

      <div className="voice-row">
        <div className="voice-row-label">语速 <span>{rate.toFixed(1)}×</span></div>
        <input type="range" min="0.5" max="2" step="0.1" value={rate} onChange={e => changeRate(Number(e.target.value))} className="voice-range" />
      </div>
      <button className="voice-preview" onClick={tryPreview}>
        {previewing ? <Square size={14} /> : <Play size={14} />} {previewing ? '停止试听' : '试听当前音色'}
      </button>

      {/* 方言音色 */}
      <div className="voice-section-label dialect"><MapPin size={14} /> 方言音色（需第三方语音服务）</div>
      <div className="voice-dialect-grid">
        {DIALECT_VOICES.map(d => (
          <button key={d.id} className={`voice-dialect ${dialectId === d.id ? 'busy' : ''}`}
            onClick={() => void downloadDialect(d)} disabled={dlState === 'downloading'}>
            <span className="voice-dialect-flag">{d.flag}</span>
            <span className="voice-dialect-info"><b>{d.name}</b><small>{d.desc}</small></span>
            {dlState === 'downloading' && dialectId === d.id ? <Loader2 size={15} className="spin" />
              : downloaded && voiceName === d.name ? <span className="voice-ready">已下载</span>
              : <Download size={15} />}
          </button>
        ))}
      </div>
      {!ttsConfigured && (
        <div className="voice-hint"><Info size={13} /> 方言音色需配置第三方语音服务后下载；未配置时无法使用。</div>
      )}

      {/* 已下载音色管理（单槽位） */}
      {downloaded && (
        <div className="voice-downloaded">
          <div><b>已下载音色：{voiceName}</b><small>本地仅保留一个音色文件，切换新音色会自动替换</small></div>
          <button className="voice-remove" onClick={() => void removeVoice()}><Trash2 size={14} /> 删除</button>
        </div>
      )}

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
          {cloning ? '克隆中…' : '克隆为 AI 发音'}
        </button>
        {sample && <button className="btn sm ghost" onClick={() => void removeSample()}><Trash2 size={14} /> 删除样本</button>}
      </div>
      {sample && <div className="voice-hint">样本：{sample.name}（{(sample.size / 1024).toFixed(0)} KB）</div>}
      {clonedId && <div className="voice-hint">已克隆音色：{clonedId} · AI 回复优先走第三方代理合成</div>}
      {!ttsConfigured && <div className="voice-hint"><Info size={13} /> 声音克隆需要第三方语音服务代理（下方配置）；内置免费模型不提供克隆能力。</div>}
      {desktop && <div className="voice-hint"><Info size={13} /> 桌面 WebView 不提供浏览器录音接口，系统授权开关也无法补上；请用「选择音频文件」导入样本（可先用 QuickTime 等工具录音）。</div>}

      {/* 免费优先语音服务目录 */}
      <div className="voice-section-label"><Globe2 size={14} /> 声音服务（免费优先 · 点卡片查看官方文档）</div>
      <div className="voice-provider-grid">
        {VOICE_PROVIDERS.map(p => (
          <button key={p.id} className={`voice-provider ${p.recommended ? 'recommended' : ''}`} onClick={() => {
            if (p.id === 'system') { setConfig({ provider: '', endpoint: '' }); saveTtsConfig({ provider: '', endpoint: '' }); setTtsConfigured(false); notify('已切换为系统音色（完全免费）'); return }
            setConfig({ ...config, provider: p.id as TtsProviderConfig['provider'] }); setConfigOpen(true); void openExternal(p.docs)
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
            <option value="">未选择（使用系统音色）</option>
            {VOICE_PROVIDERS.filter(p => p.id !== 'system').map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="form-label">服务端点（代理地址，密钥在服务端持有）
          <input className="input" value={config.endpoint} onChange={e => setConfig({ ...config, endpoint: e.target.value })} placeholder="https://your-tts-proxy.example.com" />
        </label>
        <div className="voice-config-note">为安全起见，请将 AccessKey 保存在服务端代理，前端仅配置端点地址。方言音色通过代理下载。</div>
        <div className="voice-config-actions">
          <button className="btn sm primary" onClick={saveConfig}>保存配置</button>
          {ttsConfigured && <button className="btn sm ghost" onClick={() => { clearTtsConfig(); setConfig({ provider: '', endpoint: '' }); setTtsConfigured(false); notify('已清除配置') }}>清除</button>}
        </div>
      </div>}
    </div>
  )
}
