import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LayoutDashboard, CalendarCheck2, KeyRound, BarChart3, Plus, ShieldCheck,
  ExternalLink, Trash2, RefreshCw, AlertTriangle, Info, Check,
  Wallet, Flame, Clock, TrendingUp, Lock, Unlock, Download, X, Copy, CircleHelp,
  Code2, Sparkles, Search, Image, Mic, PenTool, Settings, Gift,
} from 'lucide-react'
import type { AppState, AccountView, ProviderDefinition, CreditUnit, AccountMode, QuotaSnapshot } from './core/types'
import { PROVIDERS, PROVIDER_MAP, CATEGORY_LABEL } from './data/providers'
import {
  loadState, saveState, uid, addAccount, removeAccount, upsertQuota, latestQuota, toggleCheckin,
  exportState, importState, mergeState, addUsageEvent, updateSettings, clearAllData, markBenefit,
} from './core/store'
import { BENEFITS, BENEFIT_KIND_LABEL, type BenefitItem } from './data/benefits'
import { requestWebPermission, sendNotification, inQuietHours } from './core/notify'
import { totalPortfolioValue, monthlySpendByPlatform, DEFAULT_UNIT_PRICES } from './core/value'
import { predictExhaustion, forecastText } from './core/forecast'
import { todayISO } from './core/store'
import {
  isVaultInitialized, initVault, verifyVault, encryptSecret, decryptSecret, fingerprint, resetVault,
} from './core/crypto'
import { getAdapter, isDesktopProxyAvailable } from './core/adapters'
import { parseUsageCsv, type UsageEventInput } from './core/csv'
import { openExternal, isDesktopApp } from './core/openExternal'

type Tab = 'dashboard' | 'checkin' | 'benefits' | 'keys' | 'usage' | 'settings'

const UNIT_LABEL: Record<CreditUnit, string> = {
  credit: '积分', token: 'Tokens', request: '次', currency: '元', day: '天',
}

const MODE_LABEL: Record<AccountMode, string> = {
  api: '官方 API', manual: '手动录入', subscription: '订阅制',
}

const CATEGORY_ICON: Record<ProviderDefinition['category'], typeof Code2> = {
  llm: Sparkles, code: Code2, image: Image, search: Search, voice: Mic, design: PenTool, other: CircleHelp,
}

function App() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [tab, setTab] = useState<Tab>('dashboard')
  const [addOpen, setAddOpen] = useState(false)
  const [vaultOpen, setVaultOpen] = useState(false)
  const [quotaTarget, setQuotaTarget] = useState<string | null>(null)
  const [usageOpen, setUsageOpen] = useState(false)
  const [importData, setImportData] = useState<AppState | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => { saveState(state) }, [state])

  // 用 ref 跟踪最新 state，供稳定回调（定时通知等）读取，避免闭包陈旧
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  const toastTimer = useRef<number | null>(null)
  const notify = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  /** 读取备份 JSON 并打开导入确认框（顶栏与设置页共用） */
  const handleImportFile = useCallback((file?: File) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try { setImportData(importState(String(reader.result))) }
      catch (err: any) { notify(err.message ?? '文件解析失败') }
    }
    reader.readAsText(file)
  }, [notify])

  /** 导出数据为 JSON 备份 */
  const handleExport = useCallback((s: AppState) => {
    const blob = new Blob([exportState(s)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `ai-credit-manager-${todayISO()}.json`; a.click()
    URL.revokeObjectURL(url)
  }, [])

  /** 检查并发送提醒通知（签到 + 额度告警），每天每类最多一次 */
  const checkAndNotify = useCallback(async (force = false) => {
    const s = stateRef.current
    const st = s.settings
    if (!st.systemNotify) return
    if (!force && st.quietStart && st.quietEnd && inQuietHours(st.quietStart, st.quietEnd)) return
    const today = todayISO()
    const dayKey = `acm.notified.${today}`

    let sent: Record<string, boolean> = {}
    try { sent = JSON.parse(sessionStorage.getItem(dayKey) ?? '{}') } catch { sent = {} }

    const notices: Array<{ key: string; title: string; body: string }> = []
    if (st.checkinReminder) {
      const pending = PROVIDERS.filter(p => p.checkinUrl &&
        s.accounts.some(a => a.providerId === p.id) &&
        !s.checkins.some(c => c.providerId === p.id && c.date === today && c.done))
      if (pending.length > 0 && (force || !sent.checkin)) {
        notices.push({ key: 'checkin', title: '今日待签到', body: `${pending.length} 个平台待签到：${pending.slice(0, 3).map(p => p.shortName).join('、')}${pending.length > 3 ? ' 等' : ''}` })
      }
    }
    const urgent: string[] = []
    for (const a of s.accounts) {
      const f = predictExhaustion(s, a.id)
      if (f.level === 'exhausted' || f.level === 'critical' ||
          (f.level === 'warning' && (f.daysLeft ?? 99) <= st.alertDays)) {
        urgent.push(`${PROVIDER_MAP[a.providerId]?.shortName ?? a.providerId}(${f.level === 'exhausted' ? '已用尽' : `${Math.ceil(f.daysLeft ?? 0)}天`})`)
      }
    }
    if (urgent.length > 0 && (force || !sent.quota)) {
      notices.push({ key: 'quota', title: '额度即将耗尽', body: urgent.slice(0, 4).join('、') })
    }

    for (const n of notices) {
      const ok = await sendNotification({ title: n.title, body: n.body })
      if (ok) sent[n.key] = true
    }
    if (notices.length > 0) sessionStorage.setItem(dayKey, JSON.stringify(sent))
  }, [])

  // 启动后延迟检查一次；每 10 分钟复查。回调从 ref 读取最新 state，不依赖具体数据变化。
  useEffect(() => {
    if (!state.settings.systemNotify) return
    const t = window.setTimeout(() => { void checkAndNotify() }, 3000)
    const interval = window.setInterval(() => { void checkAndNotify() }, 600_000)
    return () => { window.clearTimeout(t); window.clearInterval(interval) }
  }, [state.settings.systemNotify, checkAndNotify])

  const views: AccountView[] = useMemo(() => state.accounts.map((account) => {
    const provider = PROVIDER_MAP[account.providerId]
    const quota = latestQuota(state.quotas, account.id)
    const used = quota?.used ?? 0
    const total = quota?.total ?? 0
    const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
    let days: number | undefined
    if (quota?.resetAt) days = Math.ceil((new Date(quota.resetAt).getTime() - Date.now()) / 86400000)
    const todayDone = state.checkins.some(
      (c) => c.providerId === account.providerId && c.date === todayISO() && c.done,
    )
    const forecast = quota ? predictExhaustion(state, account.id) : undefined
    return { account, provider, quota, usagePercent: percent, daysUntilReset: days, checkinDoneToday: todayDone, forecast }
  }), [state])

  const pendingCheckins = PROVIDERS.filter((p) =>
    p.checkinUrl && state.accounts.some((a) => a.providerId === p.id) &&
    !state.checkins.some((c) => c.providerId === p.id && c.date === todayISO() && c.done),
  )

  const lowQuota = views.filter((v) => v.usagePercent >= 80)
  const runningOut = views.filter((v) =>
    v.forecast?.level === 'exhausted' || v.forecast?.level === 'critical' ||
    (v.forecast?.level === 'warning' && (v.forecast.daysLeft ?? 99) <= state.settings.alertDays),
  )
  const monthCost = state.usage
    .filter((u) => u.date.startsWith(todayISO().slice(0, 7)))
    .reduce((s, u) => s + u.estimatedCost, 0)
  const portfolioValue = totalPortfolioValue(state)

  const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard; badge?: number }> = [
    { id: 'dashboard', label: '额度看板', icon: LayoutDashboard },
    { id: 'checkin', label: '签到提醒', icon: CalendarCheck2, badge: pendingCheckins.length },
    { id: 'benefits', label: '福利中心', icon: Gift },
    { id: 'keys', label: 'API Key 管理', icon: KeyRound },
    { id: 'usage', label: '用量与费用', icon: BarChart3 },
    { id: 'settings', label: '设置', icon: Settings },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <div>
            <div className="brand-name">AI 积分管家</div>
            <div className="brand-sub">Credit Manager</div>
          </div>
        </div>
        <nav className="nav">
          {tabs.map((t) => {
            const Icon = t.icon
            return (
              <button key={t.id} className={`nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <Icon size={17} />
                <span>{t.label}</span>
                {t.badge ? <span className="badge">{t.badge}</span> : null}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="compliance">
            <b>合规使用</b><br />
            仅只读官方接口，签到跳转官方页面由本人操作。不模拟登录、不自动领取、不共享凭证。
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{tabs.find((t) => t.id === tab)?.label}</h1>
            <div className="subtitle">本地优先存储 · 数据仅保存在此设备</div>
          </div>
          <div className="topbar-actions">
            <label className="btn" style={{ cursor: 'pointer' }}>
              <Download size={15} style={{ transform: 'rotate(180deg)' }} /> 导入
              <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => {
                handleImportFile(e.target.files?.[0])
                e.target.value = ''
              }} />
            </label>
            <button className="btn" onClick={() => { handleExport(state); notify('已导出（不含密钥）') }}><Download size={15} /> 导出</button>
            <button className="btn primary" onClick={() => setAddOpen(true)}><Plus size={16} /> 添加账户</button>
          </div>
        </header>

        <div className="content">
          <div className="banner info">
            <Info size={16} />
            <div>本工具管理的是你<b>自己账户</b>的积分与额度。所有数据本地加密存储；签到仅提醒并跳转官方页面，领取动作由你本人完成。</div>
          </div>

          <div className="stats-grid">
            <StatCard icon={<Wallet size={17} />} color="blue" label="资源总估值" value={`¥${portfolioValue.toFixed(0)}`} hint={`${state.accounts.length} 个账户 · 单价可校准`} />
            <StatCard icon={<Flame size={17} />} color="amber" label="今日待签到" value={String(pendingCheckins.length)} hint={pendingCheckins.length ? '点击右侧跳转官方页面' : '今日已全部完成'} />
            <StatCard icon={<AlertTriangle size={17} />} color="red" label="即将耗尽" value={String(runningOut.length)} hint={runningOut.length ? `按近期速度 ${state.settings.alertDays} 天内` : `${lowQuota.length} 个账户用量超 80%`} />
            <StatCard icon={<TrendingUp size={17} />} color="green" label="本月预估费用" value={`¥${monthCost.toFixed(2)}`} hint={`预算 ¥${state.settings.monthlyBudget}`} />
          </div>

          {tab === 'dashboard' && <DashboardView views={views} onAdd={() => setAddOpen(true)} onRemove={(id) => {
            setState(s => removeAccount(s, id)); notify('账户已移除')
          }} onEditQuota={(accountId) => setQuotaTarget(accountId)} notify={notify} />}

          {tab === 'checkin' && <CheckinView
            accounts={state.accounts} checkins={state.checkins}
            notify={notify}
            onToggle={(pid, aid) => setState(s => toggleCheckin(s, pid, aid))}
          />}

          {tab === 'benefits' && <BenefitsView
            state={state} notify={notify}
            onMark={(id, kind) => { setState(s => markBenefit(s, id, kind)); notify('已标记为本人处理') }}
          />}

          {tab === 'keys' && <KeysView
            state={state} notify={notify}
            onOpenVault={() => setVaultOpen(true)}
            onQuotaFetched={(accountId, used, total, unit) => {
              setState(s => upsertQuota(s, { accountId, used, total: total ?? used, unit, source: 'api' }))
            }}
            onRemoveKey={(accId) => {
              setState(s => ({ ...s, accounts: s.accounts.map(a => a.id === accId ? { ...a, encryptedKey: undefined, keyFingerprint: undefined } : a) }))
              notify('已清除本地密钥')
            }}
          />}

          {tab === 'usage' && <UsageView state={state} notify={notify}
            onBudget={(v) => setState(s => ({ ...s, settings: { ...s.settings, monthlyBudget: v } }))}
            onPriceChange={(providerId, price) => setState(s => ({ ...s, settings: {
              ...s.settings, unitPrices: { ...s.settings.unitPrices, [providerId]: price },
            } }))}
            onAddUsage={() => setUsageOpen(true)}
            onImport={(events) => {
              setState(s => ({ ...s, usage: [
                ...s.usage,
                ...events.map(e => ({ ...e, id: uid('u') })),
              ] }))
              notify(`已导入 ${events.length} 条用量记录`)
            }}
          />}

          {tab === 'settings' && <SettingsView
            state={state}
            onChange={(patch) => setState(s => updateSettings(s, patch))}
            onOpenVault={() => setVaultOpen(true)}
            onExport={() => {
              handleExport(state)
              setState(s => updateSettings(s, { lastExportAt: new Date().toISOString() }))
              notify('已导出备份（不含密钥）')
            }}
            onImportFile={handleImportFile}
            onTestNotify={async () => {
              if (!state.settings.systemNotify) { notify('请先开启系统通知'); return }
              const ok = await sendNotification({ title: 'AI 积分管家', body: '通知测试：这是一条本地提醒，不会领取任何福利。' })
              notify(ok ? '测试通知已发送' : '通知发送失败，请检查权限')
            }}
            onEnableNotify={async () => {
              const r = await requestWebPermission()
              notify(r === 'granted' ? '通知权限已就绪' : r === 'denied' ? '通知被拒绝，请在浏览器设置中允许' : '当前环境不支持通知权限申请')
            }}
            onClear={() => {
              setState(s => clearAllData(s))
              notify('业务数据已清空，设置与保险箱保留')
            }}
          />}
        </div>
      </main>

      {addOpen && <AddAccountModal
        onClose={() => setAddOpen(false)}
        onSubmit={async (input) => {
          // 函数式更新以避免 async 回调中的闭包陈旧
          setState(s => addAccount(s, input))
          setAddOpen(false)
          notify('账户已添加，请在看板中录入额度')
        }}
      />}
      {vaultOpen && <VaultModal onClose={() => setVaultOpen(false)} notify={notify}
        onInit={async (pwd) => { await initVault(pwd); setState(s => ({ ...s, settings: { ...s.settings, vaultInitialized: true } })); notify('保险箱已创建') }}
        onReset={() => { resetVault(); setState(s => ({ ...s, settings: { ...s.settings, vaultInitialized: false } })); notify('保险箱已重置') }}
      />}
      {quotaTarget && (() => {
        const acc = state.accounts.find(a => a.id === quotaTarget)
        if (!acc) return null
        const existing = latestQuota(state.quotas, quotaTarget)
        return <QuotaModal
          account={acc} provider={PROVIDER_MAP[acc.providerId]} existing={existing}
          onClose={() => setQuotaTarget(null)}
          onSave={(q) => { setState(s => upsertQuota(s, { accountId: quotaTarget, ...q })); setQuotaTarget(null); notify('额度已更新') }}
        />
      })()}
      {usageOpen && <UsageModal
        accounts={state.accounts} onClose={() => setUsageOpen(false)}
        onSave={(e) => { setState(s => addUsageEvent(s, e)); setUsageOpen(false); notify('用量记录已添加') }}
      />}
      {importData && <ImportModal
        incoming={importData} current={state} onClose={() => setImportData(null)}
        onImport={(mode) => {
          const before = stateRef.current
          if (mode === 'replace') {
            setState(importData)
            notify(`已覆盖导入 ${importData.accounts.length} 个账户`)
          } else {
            setState(s => mergeState(s, importData))
            notify(`已合并，新增 ${importData.accounts.filter(a => !before.accounts.some(x => x.id === a.id)).length} 个账户`)
          }
          setImportData(null)
        }}
      />}
      {toast && <div className="toast"><Check size={15} /> {toast}</div>}
    </div>
  )
}

function StatCard({ icon, color, label, value, hint }: { icon: React.ReactNode; color: string; label: string; value: string; hint: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    blue: { bg: 'var(--blue-soft)', fg: 'var(--blue)' },
    amber: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
    red: { bg: 'var(--red-soft)', fg: 'var(--red)' },
    green: { bg: 'var(--green-soft)', fg: 'var(--green)' },
  }
  const c = map[color]
  return (
    <div className="stat-card">
      <div className="stat-top">
        <div className="stat-icon" style={{ background: c.bg, color: c.fg }}>{icon}</div>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-hint">{hint}</div>
    </div>
  )
}

function ProviderLogo({ provider, size = 38 }: { provider: ProviderDefinition; size?: number }) {
  const Icon = CATEGORY_ICON[provider.category]
  return (
    <div className="ac-logo" style={{ background: provider.color, width: size, height: size }}>
      <Icon size={size * 0.45} />
    </div>
  )
}

/** 官方外链按钮：桌面端用系统浏览器打开，Web 端开新标签；失败给出可复制的链接提示 */
function OutLink({ url, label, className = 'btn sm ghost', title, notify, style }: {
  url: string; label: React.ReactNode; className?: string; title?: string;
  notify: (m: string) => void; style?: React.CSSProperties
}) {
  return (
    <button className={className} style={{ ...style, display: 'inline-flex', alignItems: 'center', gap: 5 }} title={title}
      onClick={async () => {
        const ok = await openExternal(url)
        if (!ok) notify(`${isDesktopApp() ? '系统浏览器打开失败' : '弹窗被拦截'}，请手动复制：${url}`)
        else if (!isDesktopApp()) notify('已在新标签页打开官方页面，请本人操作')
      }}>
      {label} <ExternalLink size={12} />
    </button>
  )
}

function DashboardView({ views, onAdd, onRemove, onEditQuota, notify }: {
  views: AccountView[]; onAdd: () => void; onRemove: (id: string) => void; onEditQuota: (id: string) => void;
  notify: (m: string) => void
}) {
  if (views.length === 0) {
    return (
      <div className="empty">
        <div className="stat-icon" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', margin: '0 auto' }}><Wallet size={22} /></div>
        <h3>还没有账户</h3>
        <p>添加一个你自己的 AI 平台账户，开始统一管理积分与额度</p>
        <button className="btn primary" onClick={onAdd}><Plus size={15} /> 添加第一个账户</button>
      </div>
    )
  }
  return (
    <>
      <div className="section-head">
        <h2>账户额度 <span className="hint">{views.length} 个账户</span></h2>
        <button className="btn sm" onClick={onAdd}><Plus size={14} /> 添加</button>
      </div>
      <div className="account-grid">
        {views.map((v) => {
          const percent = v.usagePercent
          const color = percent >= 90 ? 'var(--red)' : percent >= 70 ? 'var(--amber)' : 'var(--green)'
          const hasQuota = !!v.quota
          return (
            <div className="account-card" key={v.account.id}>
              <div className="ac-head">
                <ProviderLogo provider={v.provider} />
                <div style={{ minWidth: 0 }}>
                  <div className="ac-title">{v.account.label}</div>
                  <div className="ac-mode">
                    <span>{v.provider.name}</span>
                    <span style={{ color: 'var(--border-strong)' }}>·</span>
                    <span>{MODE_LABEL[v.account.mode]}</span>
                  </div>
                </div>
                <div className="ac-menu">
                  <div className="dots">
                    <button className="icon-btn" title="录入/更新额度" onClick={() => onEditQuota(v.account.id)}><RefreshCw size={14} /></button>
                    <button className="icon-btn danger" title="移除账户" onClick={() => onRemove(v.account.id)}><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
              {hasQuota ? (
                <>
                  <div className="ac-quota">
                    <div className="ac-quota-num">
                      {(v.quota!.total - v.quota!.used).toLocaleString()}
                      <small>{UNIT_LABEL[v.quota!.unit]}</small>
                    </div>
                    <div className="ac-quota-label">剩余 / 共 {v.quota!.total.toLocaleString()}</div>
                  </div>
                  <div className="progress"><div style={{ width: `${Math.max(percent, 2)}%`, background: color }} /></div>
                  <div className="ac-foot">
                    <span className={`tag ${percent >= 90 ? 'red' : percent >= 70 ? 'amber' : 'green'}`}>
                      已用 {percent}%
                    </span>
                    {v.daysUntilReset !== undefined
                      ? <span><Clock size={11} style={{ verticalAlign: '-1px' }} /> {v.daysUntilReset > 0 ? `${v.daysUntilReset} 天后重置` : '即将重置'}</span>
                      : <span style={{ color: 'var(--text-3)' }}>更新日期：{v.quota!.capturedAt.slice(0, 10)}</span>}
                  </div>
                  {v.forecast && v.forecast.level !== 'insufficient' && (
                    <div className={`forecast ${v.forecast.level}`} title={`依据：${v.forecast.basis === 'quota-history' ? '额度历史' : '用量记录'} · ${v.forecast.samples} 个样本${v.forecast.exhaustDate ? ` · 预计 ${v.forecast.exhaustDate}` : ''}`}>
                      <TrendingUp size={13} />
                      <span>{forecastText(v.forecast)}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ padding: '10px 0 14px', fontSize: 13, color: 'var(--text-3)' }}>尚未录入额度</div>
                  <div className="ac-foot">
                    <button className="btn sm" onClick={() => onEditQuota(v.account.id)}><RefreshCw size={13} /> 录入额度</button>
                    <OutLink url={v.provider.usageUrl} label="官方用量页" notify={notify} style={{ color: 'var(--primary)' }} />
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function CheckinView({ accounts, checkins, notify, onToggle }: {
  accounts: AppState['accounts']; checkins: AppState['checkins'];
  notify: (m: string) => void; onToggle: (pid: string, aid?: string) => void
}) {
  const usedProviderIds = new Set(accounts.map(a => a.providerId))
  const all = PROVIDERS.filter(p => usedProviderIds.has(p.id))
  const today = todayISO()
  const doneCount = all.filter(p => checkins.some(c => c.providerId === p.id && c.date === today && c.done)).length

  return (
    <>
      <div className="banner warn">
        <AlertTriangle size={16} />
        <div>签到功能仅做<b>提醒与跳转</b>：点击「前往签到」将打开官方页面，需要你本人登录并完成领取。本工具不模拟登录、不自动点击、不保存你的会话凭证。</div>
      </div>
      <div className="section-head"><h2>今日签到 <span className="hint">{doneCount}/{all.length} 已完成</span></h2></div>
      <div className="panel">
        {all.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>先在「额度看板」添加账户后，即可看到签到提醒</div>
        ) : all.map((p) => {
          const done = checkins.some(c => c.providerId === p.id && c.date === today && c.done)
          const hasCheckinUrl = !!p.checkinUrl
          return (
            <div className="checkin-row" key={p.id}>
              <ProviderLogo provider={p} size={34} />
              <div className="checkin-info">
                <div className="checkin-name">{p.name}</div>
                <div className="checkin-note">{p.note ?? '官方福利/积分页面'}</div>
              </div>
              <span className={`tag ${done ? 'green' : hasCheckinUrl ? 'amber' : 'gray'}`}>
                {done ? <><Check size={11} /> 今日已完成</> : hasCheckinUrl ? '待签到' : '无签到页'}
              </span>
              {p.checkinUrl && (
                <OutLink url={p.checkinUrl} label="前往签到" className="btn sm" notify={notify}
                  title={`打开 ${p.name} 官方页面，由你本人完成签到`} />
              )}
              <button className="btn sm ghost" onClick={() => onToggle(p.id)} title={done ? '标记为未完成' : '标记今日已完成'}>
                {done ? '撤销' : '标记完成'}
              </button>
            </div>
          )
        })}
      </div>
      <div className="section-head"><h2>支持签到的平台 <span className="hint">添加账户后会出现在上方</span></h2></div>
      <div className="panel">
        {PROVIDERS.filter(p => p.checkinUrl).map(p => (
          <div className="link-row" key={p.id}>
            <ProviderLogo provider={p} size={24} />
            <span>{p.name}</span>
            <span className="tag gray" style={{ marginLeft: 6 }}>{CATEGORY_LABEL[p.category]}</span>
            <OutLink url={p.checkinUrl!} label="官方页面" className="btn ghost sm" notify={notify} />
          </div>
        ))}
      </div>
    </>
  )
}

function KeysView({ state, notify, onOpenVault, onRemoveKey, onQuotaFetched }: {
  state: AppState; notify: (m: string) => void; onOpenVault: () => void;
  onRemoveKey: (id: string) => void;
  onQuotaFetched: (accountId: string, used: number, total: number | undefined, unit: CreditUnit) => void
}) {
  const [unlockPwd, setUnlockPwd] = useState('')
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const keyAccounts = state.accounts.filter(a => a.encryptedKey)

  const unlock = async () => {
    setBusy(true)
    try {
      const ok = await verifyVault(unlockPwd)
      if (!ok) { notify('主密码错误'); return }
      const decrypted: Record<string, string> = {}
      for (const a of keyAccounts) {
        try { decrypted[a.id] = await decryptSecret(a.encryptedKey!, unlockPwd) } catch { /* skip */ }
      }
      setRevealed(decrypted)
      notify('已解锁（仅本次会话）')
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="banner info">
        <ShieldCheck size={16} />
        <div>API Key 使用 <b>AES-256-GCM</b> 加密，密钥由主密码经 PBKDF2 派生，仅存本地。导出数据不含密钥。遗忘主密码无法恢复，请谨慎保管。</div>
      </div>
      <div className="split">
        <div>
          <div className="section-head"><h2>保险箱</h2></div>
          <div className="panel" style={{ padding: 18 }}>
            <div className="kv"><span className="k">状态</span><span className="v tag gray">{isVaultInitialized() ? '已初始化' : '未初始化'}</span></div>
            <div className="kv"><span className="k">加密算法</span><span className="v mono">AES-256-GCM</span></div>
            <div className="kv"><span className="k">密钥派生</span><span className="v mono">PBKDF2 · 210k</span></div>
            <div className="kv"><span className="k">存储位置</span><span className="v">仅此设备</span></div>
            <div style={{ marginTop: 16 }}>
              {isVaultInitialized() ? (
                <>
                  <div className="field" style={{ marginBottom: 10 }}>
                    <input className="input" type="password" placeholder="输入主密码解锁" value={unlockPwd} onChange={e => setUnlockPwd(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn primary" onClick={unlock} disabled={busy || !unlockPwd}><Unlock size={14} /> 解锁查看</button>
                    <button className="btn" onClick={() => { setRevealed({}); setUnlockPwd(''); notify('已锁定') }} disabled={!unlockPwd && !Object.keys(revealed).length}><Lock size={14} /> 锁定</button>
                  </div>
                </>
              ) : (
                <button className="btn primary" onClick={onOpenVault}><Lock size={14} /> 创建保险箱</button>
              )}
            </div>
          </div>
        </div>
        <div>
          <div className="section-head"><h2>已保存的密钥 <span className="hint">{keyAccounts.length} 个</span></h2></div>
          <div className="panel">
            {keyAccounts.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                暂无密钥。添加账户时选择「官方 API」模式即可保存。
              </div>
            ) : keyAccounts.map(a => {
              const provider = PROVIDER_MAP[a.providerId]
              const plain = revealed[a.id]
              const adapter = getAdapter(a.providerId)
              return (
                <div key={a.id} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <ProviderLogo provider={provider} size={28} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{a.label}</div>
                      <div className="mono" style={{ color: 'var(--text-3)', fontSize: 11 }}>
                        {plain ? plain : a.keyFingerprint}
                      </div>
                    </div>
                    {plain && <button className="icon-btn" title="复制" onClick={() => { navigator.clipboard.writeText(plain); notify('已复制（注意保管）') }}><Copy size={14} /></button>}
                    <button className="icon-btn danger" title="清除密钥" onClick={() => onRemoveKey(a.id)}><Trash2 size={14} /></button>
                  </div>
                  {adapter.supported && (
                    <button className="btn sm" onClick={async () => {
                      if (!plain) { notify('请先解锁查看密钥'); return }
                      try {
                        const r = await adapter.fetchUsage!(plain)
                        onQuotaFetched(a.id, r.used, r.total, r.unit)
                        notify(`查询成功：已用 ${r.used.toLocaleString()} ${r.unit}`)
                      } catch (e: any) { notify(e.message ?? '查询失败') }
                    }}><RefreshCw size={13} /> 查询官方用量</button>
                  )}
                  {!adapter.supported && <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>该平台无公开只读 API，请到官方页面查看</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 16 }}>
        注：{isDesktopProxyAvailable()
          ? '当前为桌面端，官方只读请求经本地后端代理（域名白名单），不受 CORS 限制。'
          : '当前为 Web 端，直接调用官方 API 可能受浏览器 CORS 限制；可改用桌面端或手动录入。'}
        查询仅发送只读 GET 请求至官方域名，不上传密钥至任何第三方。
      </p>
    </>
  )
}

function UsageView({ state, notify, onBudget, onAddUsage, onImport, onPriceChange }: {
  state: AppState; notify: (m: string) => void; onBudget: (v: number) => void;
  onAddUsage: () => void;
  onImport: (events: UsageEventInput[]) => void
  onPriceChange: (providerId: string, price: number) => void
}) {
  const month = todayISO().slice(0, 7)
  const monthEvents = state.usage.filter(u => u.date.startsWith(month))
  const totalCost = monthEvents.reduce((s, u) => s + u.estimatedCost, 0)
  const totalIn = monthEvents.reduce((s, u) => s + u.inputTokens, 0)
  const totalOut = monthEvents.reduce((s, u) => s + u.outputTokens, 0)
  const budget = state.settings.monthlyBudget
  const budgetPct = budget > 0 ? Math.min(100, Math.round(totalCost / budget * 100)) : 0

  const byDay = useMemo(() => {
    const map: Record<string, number> = {}
    monthEvents.forEach(u => { map[u.date] = (map[u.date] ?? 0) + u.estimatedCost })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).slice(-14)
  }, [monthEvents])

  const maxDay = Math.max(...byDay.map(d => d[1]), 0.01)
  const spendByPlatform = monthlySpendByPlatform(state, month)
  const ownedProviders = Array.from(new Set(state.accounts.map(a => a.providerId)))
  const prices = state.settings.unitPrices ?? {}
  const effectivePrices = { ...DEFAULT_UNIT_PRICES, ...prices }

  return (
    <>
      <div className="banner info">
        <Info size={16} />
        <div>费用为<b>本地估算值</b>，仅供参考，以平台官方账单为准。可手动录入每日用量，或（在支持的平台）通过官方 API 只读查询。</div>
      </div>
      <div className="stats-grid">
        <StatCard icon={<Wallet size={17} />} color="blue" label="本月费用" value={`¥${totalCost.toFixed(2)}`} hint="本地估算" />
        <StatCard icon={<BarChart3 size={17} />} color="green" label="本月 Tokens" value={(totalIn + totalOut).toLocaleString()} hint={`输入 ${totalIn.toLocaleString()} · 输出 ${totalOut.toLocaleString()}`} />
        <StatCard icon={<TrendingUp size={17} />} color="amber" label="预算使用" value={`${budgetPct}%`} hint={`预算 ¥${budget.toFixed(0)}`} />
        <StatCard icon={<CalendarCheck2 size={17} />} color="blue" label="记录天数" value={String(new Set(monthEvents.map(u => u.date)).size)} hint="本月已记录" />
      </div>

      <div className="split">
        <div className="panel" style={{ padding: 18 }}>
          <div className="section-head" style={{ marginTop: 0 }}><h2>费用趋势 <span className="hint">近 14 天</span></h2></div>
          {byDay.length === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '20px 0' }}>暂无数据</div> : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 130, paddingTop: 10 }}>
              {byDay.map(([date, cost]) => (
                <div key={date} style={{ flex: 1, textAlign: 'center' }} title={`${date}: ¥${cost.toFixed(2)}`}>
                  <div style={{ background: 'var(--primary)', borderRadius: '4px 4px 0 0', height: `${Math.max(4, cost / maxDay * 96)}px`, marginBottom: 5 }} />
                  <div style={{ fontSize: 9, color: 'var(--text-3)' }}>{date.slice(8)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel" style={{ padding: 18 }}>
          <div className="section-head" style={{ marginTop: 0 }}><h2>预算设置</h2></div>
          <div className="field">
            <label>每月预算（元）</label>
            <input className="input" type="number" min="0" step="10" defaultValue={budget}
                   onBlur={e => { const v = Number(e.target.value); if (!isNaN(v) && v >= 0) { onBudget(v); notify('预算已更新') } }} />
          </div>
          <div className="progress" style={{ height: 8 }}><div style={{ width: `${budgetPct}%`, background: budgetPct >= 90 ? 'var(--red)' : 'var(--primary)' }} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>
            <span>已用 ¥{totalCost.toFixed(2)}</span><span>预算 ¥{budget.toFixed(0)}</span>
          </div>
          {budgetPct >= 90 && <div className="banner warn" style={{ marginTop: 16, marginBottom: 0 }}><AlertTriangle size={15} /> 预算即将用尽，建议检查用量</div>}
        </div>
      </div>

      <div className="section-head"><h2>按平台消费结构 <span className="hint">本月</span></h2></div>
      <div className="panel" style={{ padding: 18 }}>
        {spendByPlatform.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: 13 }}>暂无消费数据</div>
        ) : spendByPlatform.map(p => (
          <div key={p.providerId} style={{ marginBottom: 13 }}>
            <div className="row between" style={{ fontSize: 12.5, marginBottom: 6 }}>
              <span style={{ fontWeight: 500 }}>{p.name}</span>
              <span style={{ color: 'var(--text-2)' }}>¥{p.cost.toFixed(2)} · {(p.share * 100).toFixed(0)}%</span>
            </div>
            <div className="progress"><div style={{ width: `${Math.max(2, p.share * 100)}%`, background: 'var(--primary)' }} /></div>
          </div>
        ))}
      </div>

      <div className="section-head"><h2>额度单价校准 <span className="hint">用于资源总估值</span></h2></div>
      <div className="panel" style={{ padding: 18 }}>
        <div className="banner info" style={{ fontSize: 11.5, marginBottom: 14 }}>
          <Info size={14} />
          <div>下方是<b>参考单价</b>，并非官方定价。请按你实际账单校准；货币(元)单位固定 1:1 无需设置。修改后立即影响"资源总估值"。</div>
        </div>
        {ownedProviders.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: 13 }}>添加账户后可校准对应平台的单价</div>
        ) : ownedProviders.map(pid => (
          <div className="settings-row" key={pid}>
            <span style={{ fontSize: 13 }}>{PROVIDER_MAP[pid]?.shortName ?? pid}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>元 / {UNIT_LABEL[state.quotas.find(q => q.accountId === state.accounts.find(a => a.providerId === pid)?.id)?.unit ?? 'credit']}</span>
              <input className="input" type="number" min="0" step="0.0001"
                value={effectivePrices[pid] ?? DEFAULT_UNIT_PRICES.default}
                onChange={e => onPriceChange(pid, Math.max(0, Number(e.target.value)))}
                style={{ width: 100 }} />
            </span>
          </div>
        ))}
      </div>

      <div className="section-head"><h2>用量记录 <span className="hint">{monthEvents.length} 条</span></h2></div>
      <div className="panel">
        <table>
          <thead><tr><th>日期</th><th>账户</th><th>模型</th><th>输入 Tokens</th><th>输出 Tokens</th><th>估算费用</th></tr></thead>
          <tbody>
            {monthEvents.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 30 }}>暂无记录</td></tr> :
              monthEvents.slice().reverse().map(u => {
                const acc = state.accounts.find(a => a.id === u.accountId)
                return (
                  <tr key={u.id}>
                    <td className="mono">{u.date}</td>
                    <td>{acc?.label ?? '—'}</td>
                    <td className="mono">{u.model ?? '—'}</td>
                    <td className="mono">{u.inputTokens.toLocaleString()}</td>
                    <td className="mono">{u.outputTokens.toLocaleString()}</td>
                    <td>¥{u.estimatedCost.toFixed(3)}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={onAddUsage}><Plus size={13} /> 手动添加记录</button>
        <label className="btn sm" style={{ cursor: 'pointer' }}>
          <Download size={13} style={{ transform: 'rotate(180deg)' }} /> 导入 CSV
          <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              try {
                const events = parseUsageCsv(String(reader.result), state.accounts)
                if (events.length === 0) { notify('未解析到有效记录，请检查 CSV 格式'); return }
                onImport(events)
              } catch (err: any) { notify(err.message ?? 'CSV 解析失败') }
            }
            reader.readAsText(file)
            e.target.value = ''
          }} />
        </label>
        <button className="btn sm ghost" onClick={() => {
          const csv = 'date,account,inputTokens,outputTokens,cost,model\n2026-01-01,我的账户,1000,500,0.15,gpt-4o\n'
          const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a'); a.href = url; a.download = 'usage-template.csv'; a.click()
          URL.revokeObjectURL(url)
          notify('模板已下载')
        }}><Download size={13} /> CSV 模板</button>
        <span style={{ fontSize: 11.5, color: 'var(--text-3)', alignSelf: 'center' }}>列：date, account, inputTokens, outputTokens, cost, model</span>
      </div>
    </>
  )
}

function AddAccountModal({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (input: { providerId: string; label: string; mode: AccountMode; encryptedKey?: string; keyFingerprint?: string }) => void
}) {
  const [providerId, setProviderId] = useState('')
  const [label, setLabel] = useState('')
  const [mode, setMode] = useState<AccountMode>('manual')
  const [secret, setSecret] = useState('')
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)

  const provider = PROVIDER_MAP[providerId]
  const availableModes: AccountMode[] = provider?.modes ?? ['manual']

  useEffect(() => { if (availableModes.length && !availableModes.includes(mode)) setMode(availableModes[0]) }, [providerId])

  const submit = async () => {
    if (!providerId) return
    setBusy(true)
    try {
      let encryptedKey: string | undefined
      let keyFingerprint: string | undefined
      if (mode === 'api' && secret) {
        if (!isVaultInitialized()) { throw new Error('请先在「API Key 管理」中创建保险箱') }
        const ok = await verifyVault(pwd)
        if (!ok) throw new Error('主密码错误')
        encryptedKey = await encryptSecret(secret, pwd)
        keyFingerprint = fingerprint(secret)
      }
      onSubmit({ providerId, label: label.trim() || provider!.shortName, mode, encryptedKey, keyFingerprint })
    } catch (e: any) { alert(e.message ?? '保存失败') } finally { setBusy(false) }
  }

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-head"><h3>添加账户</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="field">
            <label>选择平台</label>
            <div className="provider-picker">
              {PROVIDERS.map(p => (
                <button key={p.id} className={`provider-opt ${providerId === p.id ? 'selected' : ''}`} onClick={() => setProviderId(p.id)}>
                  <ProviderLogo provider={p} size={28} />
                  <span className="p-name">{p.shortName}</span>
                </button>
              ))}
            </div>
          </div>
          {provider && (
            <>
              <div className="field">
                <label>账户名称</label>
                <input className="input" placeholder={`例如：我的 ${provider.shortName} 账户`} value={label} onChange={e => setLabel(e.target.value)} />
              </div>
              <div className="field">
                <label>数据方式</label>
                <select className="select" value={mode} onChange={e => setMode(e.target.value as AccountMode)}>
                  {availableModes.map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                </select>
                <div className="desc">
                  {mode === 'api' ? '保存官方 API Key（加密）后可只读查询用量。' :
                   mode === 'subscription' ? '订阅制：记录订阅与到期，用量到官方页面查看。' :
                   '平台无公开用量 API：请到官方页面查看后，在看板中手动录入额度。'}
                </div>
              </div>
              {mode === 'api' && (
                <>
                  {!isVaultInitialized() && <div className="banner warn" style={{ marginBottom: 14 }}><Lock size={15} /> 请先在「API Key 管理」中创建保险箱，再保存密钥。</div>}
                  <div className="field-row">
                    <div className="field">
                      <label>API Key</label>
                      <input className="input" type="password" placeholder="sk-..." value={secret} onChange={e => setSecret(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>主密码</label>
                      <input className="input" type="password" placeholder="用于加密" value={pwd} onChange={e => setPwd(e.target.value)} />
                    </div>
                  </div>
                </>
              )}
              {provider.note && <div className="banner info" style={{ marginBottom: 0 }}><Info size={15} /> {provider.note}</div>}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={submit} disabled={!providerId || busy}>添加账户</button>
        </div>
      </div>
    </div>
  )
}

function VaultModal({ onClose, onInit, onReset, notify }: {
  onClose: () => void; onInit: (pwd: string) => Promise<void>; onReset: () => void; notify: (m: string) => void
}) {
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (pwd.length < 6) { notify('主密码至少 6 位'); return }
    if (pwd !== confirm) { notify('两次密码不一致'); return }
    setBusy(true)
    try { await onInit(pwd); onClose() } finally { setBusy(false) }
  }
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>创建本地保险箱</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="banner warn"><AlertTriangle size={16} /> 主密码遗忘后<b>无法恢复</b>已保存的密钥，请务必牢记。密钥仅存本地，不会上传。</div>
          <div className="field"><label>设置主密码（至少 6 位）</label><input className="input" type="password" value={pwd} onChange={e => setPwd(e.target.value)} /></div>
          <div className="field"><label>确认主密码</label><input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
        </div>
        <div className="modal-foot">
          {isVaultInitialized() && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => { onReset(); onClose() }}>重置保险箱</button>}
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={submit} disabled={busy}>创建</button>
        </div>
      </div>
    </div>
  )
}

/** 额度录入 / 更新模态框 */
function QuotaModal({ account, provider, existing, onClose, onSave }: {
  account: AppState['accounts'][number]; provider: ProviderDefinition; existing?: AppState['quotas'][number];
  onClose: () => void;
  onSave: (q: { unit: CreditUnit; used: number; total: number; resetAt?: string; source: QuotaSnapshot['source'] }) => void
}) {
  const [unit, setUnit] = useState<CreditUnit>(existing?.unit ?? 'credit')
  const [total, setTotal] = useState(existing ? String(existing.total) : '')
  const [used, setUsed] = useState(existing ? String(existing.used) : '0')
  const [resetAt, setResetAt] = useState(existing?.resetAt?.slice(0, 10) ?? '')
  const totalNum = Number(total), usedNum = Number(used)
  const valid = total !== '' && !isNaN(totalNum) && totalNum >= 0 && !isNaN(usedNum) && usedNum >= 0
  const pct = valid && totalNum > 0 ? Math.min(100, Math.round(usedNum / totalNum * 100)) : 0

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h3>{existing ? '更新额度' : '录入额度'}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="banner info" style={{ marginBottom: 16 }}>
            <ProviderLogo provider={provider} size={28} />
            <div><b>{account.label}</b> · {provider.name}<br />请到官方用量页查看后录入，数据仅存本地。</div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>单位</label>
              <select className="select" value={unit} onChange={e => setUnit(e.target.value as CreditUnit)}>
                {(Object.keys(UNIT_LABEL) as CreditUnit[]).map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
              </select>
            </div>
            <div className="field">
              <label>重置/到期日（可选）</label>
              <input className="input" type="date" value={resetAt} onChange={e => setResetAt(e.target.value)} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>总额度</label>
              <input className="input" type="number" min="0" placeholder="如 100" value={total} onChange={e => setTotal(e.target.value)} />
            </div>
            <div className="field">
              <label>已使用</label>
              <input className="input" type="number" min="0" placeholder="如 20" value={used} onChange={e => setUsed(e.target.value)} />
            </div>
          </div>
          {valid && totalNum > 0 && (
            <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: 12 }}>
              <div className="row between" style={{ fontSize: 12.5, marginBottom: 8 }}>
                <span style={{ color: 'var(--text-2)' }}>剩余 <b style={{ color: 'var(--text)' }}>{Math.max(0, totalNum - usedNum).toLocaleString()} {UNIT_LABEL[unit]}</b></span>
                <span className={`tag ${pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'green'}`}>已用 {pct}%</span>
              </div>
              <div className="progress"><div style={{ width: `${Math.max(pct, 2)}%`, background: pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green)' }} /></div>
            </div>
          )}
          <div className="desc" style={{ marginTop: 10 }}>来源：手动录入 {existing ? `· 上次更新 ${existing.capturedAt.slice(0, 10)}` : ''}</div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave({
            unit, used: usedNum, total: totalNum,
            resetAt: resetAt ? new Date(`${resetAt}T23:59:59`).toISOString() : undefined,
            source: 'manual',
          })}>保存</button>
        </div>
      </div>
    </div>
  )
}

/** 用量记录添加模态框 */
function UsageModal({ accounts, onClose, onSave }: {
  accounts: AppState['accounts'];
  onClose: () => void;
  onSave: (e: UsageEventInput) => void
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [date, setDate] = useState(todayISO())
  const [inputTokens, setInputTokens] = useState('0')
  const [outputTokens, setOutputTokens] = useState('0')
  const [estimatedCost, setEstimatedCost] = useState('0')
  const [model, setModel] = useState('')
  const valid = !!accountId && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    [inputTokens, outputTokens, estimatedCost].every(v => v !== '' && !isNaN(Number(v)) && Number(v) >= 0)

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head"><h3>添加用量记录</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          {accounts.length === 0 ? (
            <div className="banner warn">请先添加一个账户后再录入用量。</div>
          ) : (
            <>
              <div className="field-row">
                <div className="field">
                  <label>账户</label>
                  <select className="select" value={accountId} onChange={e => setAccountId(e.target.value)}>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.label} · {PROVIDER_MAP[a.providerId]?.shortName ?? a.providerId}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>日期</label>
                  <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>输入 Tokens</label>
                  <input className="input" type="number" min="0" value={inputTokens} onChange={e => setInputTokens(e.target.value)} />
                </div>
                <div className="field">
                  <label>输出 Tokens</label>
                  <input className="input" type="number" min="0" value={outputTokens} onChange={e => setOutputTokens(e.target.value)} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>估算费用（元）</label>
                  <input className="input" type="number" min="0" step="0.001" value={estimatedCost} onChange={e => setEstimatedCost(e.target.value)} />
                </div>
                <div className="field">
                  <label>模型（可选）</label>
                  <input className="input" placeholder="如 gpt-4o" value={model} onChange={e => setModel(e.target.value)} />
                </div>
              </div>
              <div className="desc">费用为本地估算，以平台官方账单为准。</div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave({
            accountId, date,
            inputTokens: Number(inputTokens), outputTokens: Number(outputTokens),
            estimatedCost: Number(estimatedCost), model: model.trim() || undefined,
          })}>保存记录</button>
        </div>
      </div>
    </div>
  )
}

/** 数据导入确认模态框：选择覆盖或合并 */
function ImportModal({ incoming, current, onClose, onImport }: {
  incoming: AppState; current: AppState; onClose: () => void; onImport: (mode: 'replace' | 'merge') => void
}) {
  const newIds = incoming.accounts.filter(a => !current.accounts.some(c => c.id === a.id)).length
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head"><h3>导入数据</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="banner info"><Info size={16} /> 检测到备份文件，包含 <b>{incoming.accounts.length}</b> 个账户、<b>{incoming.quotas.length}</b> 条额度、<b>{incoming.usage.length}</b> 条用量记录。密钥不会被导入。</div>
          <div className="field">
            <label>导入方式</label>
            <div className="provider-picker" style={{ gridTemplateColumns: '1fr', maxHeight: 'none' }}>
              <button className="provider-opt" style={{ padding: 14 }} onClick={() => onImport('merge')}>
                <RefreshCw size={18} style={{ color: 'var(--primary)' }} />
                <div style={{ textAlign: 'left' }}>
                  <div className="p-name">合并（推荐）</div>
                  <div className="desc" style={{ marginTop: 4 }}>保留当前数据，追加 {newIds} 个新账户；相同 id 不重复</div>
                </div>
              </button>
              <button className="provider-opt" style={{ padding: 14 }} onClick={() => onImport('replace')}>
                <Trash2 size={18} style={{ color: 'var(--red)' }} />
                <div style={{ textAlign: 'left' }}>
                  <div className="p-name">覆盖</div>
                  <div className="desc" style={{ marginTop: 4 }}>清空当前全部数据，仅保留备份内容（不可撤销）</div>
                </div>
              </button>
            </div>
          </div>
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>取消</button></div>
      </div>
    </div>
  )
}

/** 福利中心：聚合各平台公开免费层/试用信息，仅跳转官方页面由本人操作 */
function BenefitsView({ state, notify, onMark }: {
  state: AppState; notify: (m: string) => void; onMark: (id: string, kind: 'daily' | 'other') => void
}) {
  const [filter, setFilter] = useState<'all' | 'owned'>('all')
  const today = todayISO()
  const ownedIds = new Set(state.accounts.map(a => a.providerId))

  const items = BENEFITS.filter(b => filter === 'all' || ownedIds.has(b.providerId))
  const isMarked = (b: BenefitItem) => state.benefitMarks.some(
    m => m.benefitId === b.id && (b.kind === 'daily' ? m.date === today : true),
  )
  const markedCount = items.filter(isMarked).length

  return (
    <>
      <div className="banner warn">
        <AlertTriangle size={16} />
        <div>本页只聚合各平台<b>公开</b>的免费层/试用信息并提供官方链接。具体额度频繁变化，请以官方页面为准；领取须由你本人完成，本工具不自动领取、不模拟登录、不保存领取凭证。</div>
      </div>

      <div className="stats-grid">
        <StatCard icon={<Gift size={17} />} color="blue" label="收录福利" value={String(BENEFITS.length)} hint={`覆盖 ${new Set(BENEFITS.map(b => b.providerId)).size} 个平台`} />
        <StatCard icon={<Check size={17} />} color="green" label="已处理" value={String(markedCount)} hint={filter === 'owned' ? '我的平台范围内' : '全部平台'} />
        <StatCard icon={<Wallet size={17} />} color="amber" label="我的平台" value={String(ownedIds.size)} hint="在看板中已添加的账户" />
        <StatCard icon={<Info size={17} />} color="blue" label="数据核对" value="2026-11-17" hint="政策以官方实时公告为准" />
      </div>

      <div className="section-head">
        <h2>福利清单 <span className="hint">{items.length} 项</span></h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn sm ${filter === 'all' ? 'primary' : ''}`} onClick={() => setFilter('all')}>全部平台</button>
          <button className={`btn sm ${filter === 'owned' ? 'primary' : ''}`} onClick={() => setFilter('owned')}>仅我的平台</button>
        </div>
      </div>

      <div className="account-grid">
        {items.map(b => {
          const provider = PROVIDER_MAP[b.providerId]
          const marked = isMarked(b)
          return (
            <div className="account-card" key={b.id}>
              <div className="ac-head">
                {provider ? <ProviderLogo provider={provider} size={36} /> : <div className="ac-logo" style={{ background: 'var(--text-3)' }}>?</div>}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="ac-title" style={{ fontSize: 13 }}>{b.title}</div>
                  <div className="ac-mode">{provider?.name ?? b.providerId}</div>
                </div>
                <span className={`tag ${BENEFIT_KIND_COLORS[b.kind]}`}>{BENEFIT_KIND_LABEL[b.kind]}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65, minHeight: 60 }}>{b.desc}</div>
              <div className="ac-foot" style={{ marginTop: 12 }}>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>核对 {b.updatedAt}</span>
                {marked && <span className="tag green"><Check size={11} /> 已处理</span>}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 14 }}>
                <OutLink url={b.url} label="查看官方政策" className="btn sm" notify={notify}
                  title={`打开 ${provider?.shortName ?? b.providerId} 官方页面，由你本人确认`} />
                <button className="btn sm ghost" onClick={() => onMark(b.id, b.kind === 'daily' ? 'daily' : 'other')}>
                  {marked ? '撤销标记' : '标记已处理'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 16 }}>
        "标记已处理"仅用于个人记录，不会向任何平台发送数据。每日签到类福利请在「签到提醒」页记录。
      </p>
    </>
  )
}

const BENEFIT_KIND_COLORS: Record<BenefitItem['kind'], string> = {
  'free-tier': 'green', trial: 'blue', daily: 'amber', education: 'gray', other: 'gray',
}

/** 开关组件 */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch" aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', flexShrink: 0,
        background: checked ? 'var(--primary)' : 'var(--border-strong)',
        position: 'relative', transition: 'background .15s', padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3, width: 16, height: 16,
        borderRadius: '50%', background: '#fff', transition: 'left .15s',
      }} />
    </button>
  )
}

/** 设置分组容器 */
function SettingsSection({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ padding: '18px 20px', marginBottom: 16 }}>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h3>
        {desc && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{desc}</div>}
      </div>
      {children}
    </div>
  )
}

/** 设置行：标题 + 说明 + 控件 */
function SettingsRow({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
        {desc && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.5 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

/** 设置中心 */
function SettingsView({ state, onChange, onOpenVault, onExport, onImportFile, onTestNotify, onEnableNotify, onClear }: {
  state: AppState
  onChange: (patch: Partial<AppState['settings']>) => void
  onOpenVault: () => void
  onExport: () => void
  onImportFile: (file?: File) => void
  onTestNotify: () => void
  onEnableNotify: () => void
  onClear: () => void
}) {
  const s = state.settings
  const [confirmClear, setConfirmClear] = useState(false)

  const daysSinceBackup = s.lastExportAt
    ? Math.floor((Date.now() - new Date(s.lastExportAt).getTime()) / 86400000)
    : null

  return (
    <>
      <div className="banner info">
        <Info size={16} />
        <div>所有设置与数据均保存在<b>本机</b>，不会上传。导出的备份文件不含 API Key 密钥。</div>
      </div>

      <div className="split">
        <div>
          <SettingsSection title="通用" desc="提醒与预警行为">
            <SettingsRow title="签到提醒" desc="在看板与侧栏显示今日待签到数量">
              <Toggle checked={s.checkinReminder} onChange={v => onChange({ checkinReminder: v })} />
            </SettingsRow>
            <SettingsRow title="耗尽预警阈值" desc={`额度预计剩余不超过 ${s.alertDays} 天时计入"即将耗尽"`}>
              <select className="select" style={{ width: 90 }} value={s.alertDays} onChange={e => onChange({ alertDays: Number(e.target.value) })}>
                {[1, 3, 7, 14, 30].map(d => <option key={d} value={d}>{d} 天</option>)}
              </select>
            </SettingsRow>
            <SettingsRow title="默认额度单位" desc="新账户录入额度时的预选单位">
              <select className="select" style={{ width: 110 }} value={s.defaultUnit} onChange={e => onChange({ defaultUnit: e.target.value as CreditUnit })}>
                {(Object.keys(UNIT_LABEL) as CreditUnit[]).map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
              </select>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="系统通知" desc="签到与额度告警主动提醒，每日每类最多一次">
            <SettingsRow title="启用通知" desc="桌面端为系统通知；Web 端需授予浏览器权限">
              <Toggle checked={s.systemNotify} onChange={v => { onChange({ systemNotify: v }); if (v) onEnableNotify() }} />
            </SettingsRow>
            <SettingsRow title="免打扰时段" desc="此区间内不发送通知，留空表示全天可通知">
              <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input className="input" type="time" value={s.quietStart} onChange={e => onChange({ quietStart: e.target.value })} style={{ width: 92 }} />
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>
                <input className="input" type="time" value={s.quietEnd} onChange={e => onChange({ quietEnd: e.target.value })} style={{ width: 92 }} />
              </span>
            </SettingsRow>
            <SettingsRow title="测试通知" desc="发送一条本地测试提醒，验证权限与显示">
              <button className="btn sm" onClick={onTestNotify}>发送测试</button>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="预算与费用" desc="用于费用追踪与超支预警">
            <SettingsRow title="每月预算" desc="人民币，超出 90% 时提示">
              <input className="input" type="number" min="0" step="10" value={s.monthlyBudget}
                     onChange={e => onChange({ monthlyBudget: Math.max(0, Number(e.target.value)) })}
                     style={{ width: 100 }} />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="安全" desc="本地密钥保险箱">
            <SettingsRow title="密钥保险箱" desc={s.vaultInitialized ? '已启用 · AES-256-GCM 加密' : '未创建 · API Key 将无法加密保存'}>
              <button className="btn sm" onClick={onOpenVault}>{s.vaultInitialized ? '管理' : '创建'}</button>
            </SettingsRow>
          </SettingsSection>
        </div>

        <div>
          <SettingsSection title="数据管理" desc="备份、恢复与清理">
            <SettingsRow title="导出备份" desc={
              daysSinceBackup === null ? '从未导出 · 建议定期备份' :
              daysSinceBackup === 0 ? '今天已导出' : `${daysSinceBackup} 天前导出`
            }>
              <button className="btn sm" onClick={onExport}><Download size={13} /> 导出</button>
            </SettingsRow>
            <SettingsRow title="导入备份" desc="从 JSON 备份恢复，可选择合并或覆盖">
              <label className="btn sm" style={{ cursor: 'pointer' }}>
                导入
                <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={e => {
                  onImportFile(e.target.files?.[0]); e.target.value = ''
                }} />
              </label>
            </SettingsRow>
            <SettingsRow title="备份提醒" desc="超过 7 天未导出时在界面提示">
              <Toggle checked={s.backupReminder} onChange={v => onChange({ backupReminder: v })} />
            </SettingsRow>
            {s.backupReminder && daysSinceBackup !== null && daysSinceBackup > 7 && (
              <div className="banner warn" style={{ marginTop: 12, marginBottom: 0 }}>
                <AlertTriangle size={15} /> 已有 {daysSinceBackup} 天未备份，建议导出以防数据丢失。
              </div>
            )}
            <SettingsRow title="清空业务数据" desc="删除全部账户、额度、签到与用量记录；设置与保险箱保留">
              {confirmClear ? (
                <span style={{ display: 'flex', gap: 6 }}>
                  <button className="btn sm danger" onClick={() => { onClear(); setConfirmClear(false) }}>确认清空</button>
                  <button className="btn sm ghost" onClick={() => setConfirmClear(false)}>取消</button>
                </span>
              ) : <button className="btn sm danger" onClick={() => setConfirmClear(true)}><Trash2 size={13} /> 清空</button>}
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="数据概览" desc="当前本地存储的内容">
            <div className="kv"><span className="k">账户</span><span className="v">{state.accounts.length} 个</span></div>
            <div className="kv"><span className="k">额度快照</span><span className="v">{state.quotas.length} 条</span></div>
            <div className="kv"><span className="k">签到记录</span><span className="v">{state.checkins.length} 条</span></div>
            <div className="kv"><span className="k">用量记录</span><span className="v">{state.usage.length} 条</span></div>
          </SettingsSection>

          <SettingsSection title="关于" desc="版本与合规说明">
            <div className="kv"><span className="k">版本</span><span className="v mono">v0.1.0</span></div>
            <div className="kv"><span className="k">定位</span><span className="v">本地优先 · 个人资源管理工具</span></div>
            <div className="banner warn" style={{ marginTop: 12, marginBottom: 0, fontSize: 11.5 }}>
              <AlertTriangle size={14} /> 本工具不模拟登录、不自动领取、不抓取私有接口。签到仅提醒并跳转官方页面，由你本人完成。
            </div>
          </SettingsSection>
        </div>
      </div>
    </>
  )
}

export default App
