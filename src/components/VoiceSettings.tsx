// 「语音配置」独立模块：声音克隆（录音/音频文件 → AI 发音）、已保存音色管理、
// 语速、试听、声音服务目录、第三方 TTS 代理配置。
// 系统内置音色/拟真预设/方言已从界面移除；未克隆时底层仍用系统 TTS 兜底，避免 AI 完全无声。

import { useEffect, useState, useRef } from 'react'
import { Volume2, Play, Square, Trash2, Loader2, Info, Globe2, Mic, Check, Pencil } from 'lucide-react'
import {
  getRate, saveRate, stopSpeak, getSpeakSource, speakAsync,
} from '../core/tts'
import {
  loadVoiceSample, saveVoiceSample, deleteVoiceSample, recordVoiceSample,
  cloneVoiceFromSample, getClonedVoiceId, listClonedVoices, removeClonedVoice,
  setActiveClonedVoice, renameClonedVoice, blobToWav, type VoiceSample, type ClonedVoice,
} from '../core/voiceClone'
import { isDesktopApp } from '../core/openExternal'
import { VOICE_PROVIDERS } from '../core/voiceProviders'
import {
  hasTtsConfig, getTtsConfig, saveTtsConfig, clearTtsConfig,
  type TtsProviderConfig,
} from '../core/voice-download'
import {
  getVolcConfig, saveVolcConfig, clearVolcConfig, type VolcConfig,
} from '../core/volcConfig'
import { ttsTestDirect } from '../core/ttsDirect'
import { verifyVault, getBiometricPassword } from '../core/crypto'
import { voiceNeedsUnlock, setVoiceSessionPwd, hasVoiceCredential } from '../core/voiceKey'
import type { Account } from '../core/types'

export function VoiceSettings({ notify, accounts, sessionPwd, onUnlock }: {
  notify: (m: string) => void
  accounts: Account[]
  sessionPwd: string
  onUnlock: (pwd: string) => void
}) {
  const [rate, setRate] = useState(getRate())
  const [ttsConfigured, setTtsConfigured] = useState(hasTtsConfig() || accounts.some(a => a.providerId === 'voice-config'))
  const [config, setConfig] = useState<TtsProviderConfig>(() => getTtsConfig())
  const [configOpen, setConfigOpen] = useState(false)
  const [testingKey, setTestingKey] = useState(false)
  // 语音配置账户解锁（生物识别免密 / 本次会话密码）
  const [voicePwdInput, setVoicePwdInput] = useState('')
  const [voiceUnlocking, setVoiceUnlocking] = useState(false)
  const needVoiceUnlock = voiceNeedsUnlock(accounts, config.provider || undefined)
  const voiceUnlocked = hasVoiceCredential() || !!sessionPwd

  const unlockVoice = async () => {
    if (!voicePwdInput) { notify('请输入主密码'); return }
    setVoiceUnlocking(true)
    try {
      const ok = await verifyVault(voicePwdInput)
      if (!ok) { notify('主密码错误'); return }
      setVoiceSessionPwd(voicePwdInput)
      onUnlock(voicePwdInput)
      setVoicePwdInput('')
      notify('已解锁，本次会话语音功能可读取加密 Key')
    } finally { setVoiceUnlocking(false) }
  }
  const [previewing, setPreviewing] = useState(false)
  const [sample, setSample] = useState<VoiceSample | null>(null)
  const [clonedId, setClonedId] = useState<string | null>(() => getClonedVoiceId())
  const [clonedVoices, setClonedVoices] = useState<ClonedVoice[]>(() => listClonedVoices())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState('')
  const [volcConfig, setVolcConfig] = useState<VolcConfig>(() => getVolcConfig())
  const [volcOpen, setVolcOpen] = useState(false)
  const desktop = isDesktopApp()
  const fileRef = useRef<HTMLInputElement | null>(null)

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

  const isDirect = (config.mode ?? 'direct') === 'direct'
  const saveConfig = () => {
    if (!config.provider) { saveTtsConfig({ provider: '', endpoint: '', mode: 'direct' }); setTtsConfigured(false); setConfigOpen(false); notify('已清除语音服务配置'); return }
    if (isDirect) {
      if (!config.apiKey?.trim()) { notify('请填写阿里云百炼 API Key'); return }
    } else if (!config.endpoint?.trim()) { notify('请填写服务端点'); return }
    saveTtsConfig(config)
    setTtsConfigured(true)
    setConfigOpen(false)
    notify('语音服务配置已保存')
  }

  const testDirect = async () => {
    if (!config.apiKey?.trim()) { notify('请先填写 API Key'); return }
    setTestingKey(true)
    try {
      const r = await ttsTestDirect(config.apiKey.trim(), config.provider || undefined)
      notify(r.message)
    } finally { setTestingKey(false) }
  }

  const doRecord = async () => {
    if (desktop) { notify('桌面端 WebView 不提供浏览器录音接口，请用「选择音频文件」导入样本'); return }
    try {
      notify('开始录音，请连续朗读 12 秒（10~20 秒最佳），自动结束…')
      let blob = await recordVoiceSample(12)
      notify('录音完成，正在转换为兼容格式…')
      const wav = await blobToWav(blob)
      if (wav) {
        blob = wav
      } else {
        // webm/opus 等转换失败时保留原样本（安卓 WebView 常见），交给代理端按 mime 处理。
        notify('格式转换未成功，将按原录音格式尝试克隆')
      }
      setCloneError('')
      const mt = blob.type || 'audio/webm'
      const finalExt = mt.includes('wav') ? 'wav' : mt.includes('mp4') ? 'm4a'
        : mt.includes('mpeg') || mt.includes('mp3') ? 'mp3' : 'webm'
      const finalName = `录音样本.${finalExt}`
      setSample(await saveVoiceSample(blob, finalName))
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
    setCloneError('')
    // 安卓 WebView 里 file.type 常为空，不能只看 MIME；结合扩展名判断，空 MIME 也放行交给后续处理。
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    const looksAudio = file.type.startsWith('audio/') ||
      ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'webm', 'opus', '3gp', 'amr'].includes(ext) || !file.type
    if (!looksAudio) { notify('请选择音频文件（WAV / MP3 / M4A）'); return }
    let blob: Blob = file
    // WAV/MP3/M4A/AAC 原生支持；webm/ogg/3gp 等尽量转 WAV，转换失败也保留原文件（克隆前再按 mime 处理）。
    if (!/\.(wav|mp3|m4a|aac)$/i.test(file.name)) {
      notify('正在转换音频格式…')
      const wav = await blobToWav(file)
      if (wav) {
        blob = wav
      } else {
        // 转换失败不阻断：保留原 blob，用正确的 mime 命名，交给代理端尝试。
        const fallbackMime = file.type || (ext === 'webm' ? 'audio/webm' : `audio/${ext || 'mp3'}`)
        blob = new Blob([file], { type: fallbackMime })
        notify('格式转换未成功，将按原格式尝试克隆')
      }
    }
    const mime = blob.type || file.type || 'audio/wav'
    const finalExt = mime.includes('wav') ? 'wav' : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3'
      : mime.includes('mp4') ? 'm4a' : ext || 'm4a'
    const name = file.name.replace(/\.[^.]+$/, '') + '.' + finalExt
    setSample(await saveVoiceSample(blob, name))
    setCloneError('')
    notify('音频样本已保存，可点击「克隆为 AI 发音」')
  }

  /** 克隆音色增删改后：刷新本页列表 + 通知 AI 助手设置弹窗同步音色下拉 */
  const syncClonedVoices = () => {
    const list = listClonedVoices()
    setClonedVoices(list)
    setClonedId(getClonedVoiceId())
    window.dispatchEvent(new CustomEvent('acm:cloned-voices-changed', { detail: list }))
  }

  const doClone = async () => {
    if (!sample) { notify('请先录音或选择音频文件'); return }
    setCloning(true)
    setCloneError('')
    try {
      const r = await cloneVoiceFromSample(sample)
      if (!r.ok) {
        const msg = r.error ?? '克隆失败'
        setCloneError(msg)
        notify(msg)
        return
      }
      setClonedId(r.voiceId ?? null)
      syncClonedVoices()
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
    syncClonedVoices()
    notify(`已切换克隆音色：${v.name}`)
  }

  const dropCloned = (v: ClonedVoice) => {
    removeClonedVoice(v.id)
    syncClonedVoices()
    notify(`已删除「${v.name}」；云端音色需到百炼控制台单独清理`)
  }

  const commitRename = (v: ClonedVoice) => {
    if (!renameText.trim()) { setRenaming(null); return }
    renameClonedVoice(v.id, renameText)
    syncClonedVoices()
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
        <button className="btn sm" disabled={desktop} title={desktop ? '桌面 WebView 不支持浏览器录音' : '连续朗读 12 秒（10~20 秒最佳）'} onClick={() => void doRecord()}><Mic size={14} /> 录音 12 秒</button>
        {desktop ? (
          <button className="btn sm primary" onClick={() => void pickNativeAudio()}><Volume2 size={14} /> 选择音频文件</button>
        ) : (
          <>
            <button className="btn sm" onClick={() => fileRef.current?.click()}><Volume2 size={14} /> 选择音频文件</button>
            <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={async e => {
              const f = e.target.files?.[0]
              await doPickFile(f)   // 先处理完，再清空，避免 File 失效竞态
              e.target.value = ''
            }} />
          </>
        )}
        <button className="btn sm primary" disabled={!sample || cloning} onClick={() => void doClone()}>
          {cloning ? <><Loader2 size={14} className="spin" /> 克隆中…</> : '克隆为 AI 发音'}
        </button>
        {sample && <button className="btn sm ghost" onClick={() => void removeSample()}><Trash2 size={14} /> 删除样本</button>}
      </div>
      {sample && <div className="voice-hint">样本：{sample.name}（{(sample.size / 1024).toFixed(0)} KB）</div>}
      {sample && /\.(amr|3gpp)$/i.test(sample.name) && (
        <div className="voice-hint" style={{ color: 'var(--red)' }}>
          <Info size={13} /> 当前样本是 AMR 格式，语音服务不支持。请点「录音 12 秒」重新录，或从「选择音频文件」导入 WAV / MP3 / M4A。
        </div>
      )}
      {cloneError && <div className="voice-clone-error"><Info size={14} /> <span>{cloneError}</span><button className="icon-btn" onClick={() => setCloneError('')}>×</button></div>}
      {/* 语音配置(APP) 账户：加密 Key 解锁 */}
      {accounts.some(a => a.providerId === 'voice-config') && (
        <div className="voice-key-unlock">
          <div className="voice-unlock-row">
            <span>🔐 语音配置账户 Key（加密保存）</span>
            <span className={`local-status-badge ${voiceUnlocked ? 'running' : ''}`}>{voiceUnlocked ? '已解锁' : '待解锁'}</span>
          </div>
          {needVoiceUnlock && !voiceUnlocked && (
            <>
              <div className="voice-unlock-desc">该 Key 保存在保险箱中，验证主密码后本次会话可用（启用指纹则自动解锁）。</div>
              <div className="voice-unlock-actions">
                {getBiometricPassword() ? (
                  <button className="btn sm" onClick={() => { const bp = getBiometricPassword(); if (bp) { setVoiceSessionPwd(bp); onUnlock(bp); notify('已通过生物识别解锁') } }}>指纹解锁</button>
                ) : (
                  <input className="input" type="password" placeholder="输入主密码" value={voicePwdInput} onChange={e => setVoicePwdInput(e.target.value)} />
                )}
                {!(getBiometricPassword()) && <button className="btn sm primary" disabled={voiceUnlocking} onClick={() => void unlockVoice()}>{voiceUnlocking ? '解锁中…' : '解锁'}</button>}
              </div>
            </>
          )}
          <div className="voice-unlock-note">在「API Key 管理 → 添加账户 → 语音配置(APP)」保存 Key；清除配置后账户仍在，无需重新申请。</div>
        </div>
      )}
      {!ttsConfigured && <div className="voice-hint"><Info size={13} /> 声音克隆需配置语音服务：在「API Key 管理 → 添加账户 → 语音配置(APP)」保存 Key，或按下方直连配置；内置免费模型不提供克隆能力。</div>}
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

      {/* 第三方 TTS 配置 */}
      <button className="voice-config-toggle" onClick={() => setConfigOpen(v => !v)}>
        <Globe2 size={14} /> 第三方语音服务配置 {ttsConfigured ? '（已配置）' : '（未配置）'} <span>{configOpen ? '收起' : '展开'}</span>
      </button>
      {configOpen && <div className="voice-config">
        <label className="form-label">连接模式
          <select className="select" value={config.mode ?? 'direct'} onChange={e => setConfig({ ...config, mode: e.target.value as 'direct' | 'proxy' })}>
            <option value="direct">官方直连（推荐 · 无需部署，只需一个 API Key）</option>
            <option value="proxy">自建服务端代理（高级 · 密钥放自己的服务端）</option>
          </select>
        </label>
        <label className="form-label">服务商
          <select className="select" value={config.provider} onChange={e => setConfig({ ...config, provider: e.target.value as TtsProviderConfig['provider'] })}>
            <option value="">未选择</option>
            {VOICE_PROVIDERS.filter(p => p.id !== 'system').map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        {isDirect ? (
          <>
            <div className="voice-direct-guide">
              1. 打开 <a href="https://bailian.console.aliyun.com/?tab=model#/api-key" target="_blank" rel="noreferrer">阿里云百炼控制台 → API Key 管理 ↗</a><br />
              2. 开通「语音合成 CosyVoice」并创建 API Key（创建音色免费）<br />
              3. 复制 Key 粘贴到下方，点「测试连接」验证
            </div>
            <label className="form-label">阿里云百炼 API Key（sk- 开头）
              <input className="input" type="password" value={config.apiKey ?? ''} onChange={e => setConfig({ ...config, apiKey: e.target.value, provider: config.provider || 'aliyun' })} placeholder="sk-xxxxxxxxxxxxxxxx" />
            </label>
            {config.provider !== 'aliyun' && config.provider && (
              <div className="voice-config-note">直连模式目前支持阿里云百炼；已自动为你选中该服务商。</div>
            )}
            <div className="voice-config-actions">
              <button className="btn sm" onClick={() => void testDirect()} disabled={testingKey}>{testingKey ? '测试中…' : '测试连接'}</button>
            </div>
            <div className="voice-config-note">Key 仅保存在本机（混淆存储），不上传、不进云同步/备份。直连由 App 后端转发调用，无需部署任何代理。</div>
          </>
        ) : (
          <>
            <label className="form-label">服务端点（代理地址，密钥在服务端持有）
              <input className="input" value={config.endpoint} onChange={e => setConfig({ ...config, endpoint: e.target.value })} placeholder="https://your-tts-proxy.example.com" />
            </label>
            <div className="voice-config-note">需自行部署云函数/代理，把 AccessKey 配在服务端。适合注重密钥隔离的高级用户。</div>
          </>
        )}
        <div className="voice-config-actions">
          <button className="btn sm primary" onClick={saveConfig}>保存配置</button>
          {ttsConfigured && <button className="btn sm ghost" onClick={() => { clearTtsConfig(); setConfig({ provider: '', endpoint: '', mode: 'direct', apiKey: '' }); setTtsConfigured(false); notify('已清除配置') }}>清除</button>}
        </div>
      </div>}

      {/* 火山引擎：声音复刻 + 端到端实时语音 共用凭据 */}
      <button className="voice-config-toggle" style={{ marginTop: 10 }} onClick={() => setVolcOpen(v => !v)}>
        <Globe2 size={14} /> 火山引擎 · 豆包语音（声音复刻 / 实时语音） <span>{volcOpen ? '收起' : '展开'}</span>
      </button>
      {volcOpen && <div className="voice-config">
        <label className="form-label">APP ID
          <input className="input" value={volcConfig.appId} onChange={e => setVolcConfig({ ...volcConfig, appId: e.target.value })} placeholder="火山控制台的 APP ID" />
        </label>
        <label className="form-label">Access Token
          <input className="input" type="password" value={volcConfig.accessToken} onChange={e => setVolcConfig({ ...volcConfig, accessToken: e.target.value })} placeholder="火山控制台的 Access Token" />
        </label>
        <label className="form-label">实时语音音色（可选）
          <input className="input" value={volcConfig.realtimeVoice} onChange={e => setVolcConfig({ ...volcConfig, realtimeVoice: e.target.value })} placeholder="如 zh_female_vv_jupiter_bigtts，留空用默认" />
        </label>
        <div className="voice-config-note">
          声音复刻：在上方「第三方语音服务配置」选「火山引擎 / 豆包声音复刻」并填代理端点（密钥配在云函数）。
          端到端实时语音：需桌面端原生桥接，当前为骨架、未启用联调。凭据仅存本机、不进云同步。
        </div>
        <div className="voice-config-actions">
          <button className="btn sm primary" onClick={() => { saveVolcConfig(volcConfig); notify('火山引擎配置已保存') }}>保存</button>
          <button className="btn sm ghost" onClick={() => { clearVolcConfig(); const d = getVolcConfig(); setVolcConfig(d); notify('已清除火山配置') }}>清除</button>
        </div>
      </div>}
    </div>
  )
}
