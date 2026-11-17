// 全端云同步：把整份本地数据（含加密密钥密文与保险箱材料）作为单个 JSON 载荷存云端。
// 每个用户一行（owner_id 唯一），RLS 保证只能读写自己的数据。
// 实时性：SDK 无 realtime 订阅，采用时间戳轮询——登录后定时检查云端 updated_at，
// 发现是其他端更新则自动拉取并刷新本地，实现「改完自动同步、另一端无需操作」。

import { cloud } from './cloud'
import type { AppState } from './types'
import { getVaultSyncMaterial, applyVaultSyncMaterial, type VaultSyncMaterial } from './crypto'

const TABLE = 'user_data'
const LAST_SYNC_KEY = 'acm.sync.lastAt'
const REMOTE_VERSION_KEY = 'acm.sync.remoteVersion'

export interface SyncPayload {
  appState: AppState
  vault: VaultSyncMaterial
  /** 客户端写入时间戳 */
  clientAt: string
  /** 写入端标识，用于识别是不是自己刚推的，避免回环拉取 */
  clientId: string
}

export interface PullResult {
  ok: boolean
  payload: SyncPayload | null
  /** 服务端该行的 updated_at，作为同步基线 */
  remoteVersion: string | null
  error?: string
}

export interface PushResult {
  ok: boolean
  /** 服务端写回后的 updated_at */
  remoteVersion: string | null
  error?: string
}

function errMsg(error: unknown): string {
  const e = error as { message?: string }
  return e?.message ?? String(error)
}

function dbAny() { return cloud.database as any }

/** 生成一个稳定的本机标识（同一浏览器/App 安装内不变） */
export function getClientId(): string {
  const KEY = 'acm.sync.clientId'
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return `fallback-${Date.now()}`
  }
}

/** 只查云端版本号（updated_at），用于轮询，省去传输整份 payload */
export async function checkRemoteVersion(): Promise<{ ok: boolean; version: string | null; error?: string }> {
  try {
    const { data, error } = await dbAny().from(TABLE).select('updated_at').maybeSingle()
    if (error) return { ok: false, version: null, error: errMsg(error) }
    return { ok: true, version: data?.updated_at ?? null }
  } catch (e) {
    return { ok: false, version: null, error: errMsg(e) }
  }
}

/** 读取当前登录用户的完整数据行 */
export async function pullPayload(): Promise<PullResult> {
  try {
    const { data, error } = await dbAny()
      .from(TABLE)
      .select('payload, updated_at, owner_name')
      .maybeSingle()
    if (error) return { ok: false, payload: null, remoteVersion: null, error: errMsg(error) }
    const version = data?.updated_at ?? null
    if (!data?.payload) return { ok: true, payload: null, remoteVersion: version }
    return { ok: true, payload: data.payload as SyncPayload, remoteVersion: version }
  } catch (e) {
    return { ok: false, payload: null, remoteVersion: null, error: errMsg(e) }
  }
}

/** 把本地数据与保险箱材料推送到云端（每用户一行，存在则更新、不存在则插入） */
export async function pushPayload(appState: AppState): Promise<PushResult> {
  try {
    const payload: SyncPayload = {
      appState,
      vault: getVaultSyncMaterial(),
      clientAt: new Date().toISOString(),
      clientId: getClientId(),
    }
    const db = dbAny()
    const now = new Date().toISOString()
    // 先查是否已有行，决定 insert 还是 update（owner_id 由服务端 auth.uid() 填充，不可手写）
    const { data: existing, error: qerr } = await db.from(TABLE).select('id').maybeSingle()
    if (qerr) return { ok: false, remoteVersion: null, error: errMsg(qerr) }

    if (existing?.id) {
      const { data, error } = await db
        .from(TABLE)
        .update({ payload, updated_at: now })
        .eq('id', existing.id)
        .select('updated_at')
        .maybeSingle()
      if (error) return { ok: false, remoteVersion: null, error: errMsg(error) }
      setBaseline(data?.updated_at ?? now)
    } else {
      const { data, error } = await db
        .from(TABLE)
        .insert({ payload, owner_name: null })
        .select('updated_at')
        .maybeSingle()
      if (error) return { ok: false, remoteVersion: null, error: errMsg(error) }
      setBaseline(data?.updated_at ?? now)
    }
    try { localStorage.setItem(LAST_SYNC_KEY, payload.clientAt) } catch { /* 忽略 */ }
    return { ok: true, remoteVersion: getRemoteVersion() }
  } catch (e) {
    return { ok: false, remoteVersion: null, error: errMsg(e) }
  }
}

/** 把云端载荷应用到本地：先应用保险箱材料，再以云端数据为准整体覆盖本地。 */
export function applyPayload(payload: SyncPayload, _local: AppState): AppState {
  if (payload.vault) applyVaultSyncMaterial(payload.vault)
  try { localStorage.setItem(LAST_SYNC_KEY, payload.clientAt) } catch { /* 忽略 */ }
  return payload.appState
}

export function getLastSyncAt(): string | null {
  try { return localStorage.getItem(LAST_SYNC_KEY) } catch { return null }
}

/** 同步基线：最后一次我们已知的服务端 updated_at。轮询时只有它变化才拉取。 */
export function setBaseline(version: string | null): void {
  try { if (version) localStorage.setItem(REMOTE_VERSION_KEY, version) } catch { /* 忽略 */ }
}
export function getRemoteVersion(): string | null {
  try { return localStorage.getItem(REMOTE_VERSION_KEY) } catch { return null }
}
