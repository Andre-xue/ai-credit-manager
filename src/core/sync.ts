// 全端云同步：把整份本地数据（含加密密钥密文与保险箱材料）作为单个 JSON 载荷存云端。
// 每个用户一行（owner_id 唯一），RLS 保证只能读写自己的数据。
// 冲突策略：以云端 updated_at 为准——登录时若云端非空且比本地快照新，采用云端；本地变更则推送。

import { cloud } from './cloud'
import type { AppState } from './types'
import { getVaultSyncMaterial, applyVaultSyncMaterial, type VaultSyncMaterial } from './crypto'

const TABLE = 'user_data'
const LAST_SYNC_KEY = 'acm.sync.lastAt'

export interface SyncPayload {
  appState: AppState
  vault: VaultSyncMaterial
  /** 客户端写入时间戳，用于粗略判断新旧 */
  clientAt: string
}

export type PullResult =
  | { ok: true; payload: SyncPayload | null }
  | { ok: false; error: string }

export type PushResult = { ok: true } | { ok: false; error: string }

function errMsg(error: unknown): string {
  const e = error as { message?: string }
  return e?.message ?? String(error)
}

/** 读取当前登录用户的数据行。未登录或出错返回 error。 */
export async function pullPayload(): Promise<PullResult> {
  try {
    // 未传 schema 泛型时 SDK 把行推断为 never；此处用 any 承接并显式转型（运行时数据来自我们自己的表）
    const db = cloud.database as any
    const { data, error } = await db
      .from(TABLE)
      .select('payload, updated_at, owner_name')
      .maybeSingle()
    if (error) return { ok: false, error: errMsg(error) }
    if (!data?.payload) return { ok: true, payload: null }
    return { ok: true, payload: data.payload as SyncPayload }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

/** 把本地数据与保险箱材料推送到云端（每用户一行，存在则更新、不存在则插入）。 */
export async function pushPayload(appState: AppState): Promise<PushResult> {
  try {
    const payload: SyncPayload = {
      appState,
      vault: getVaultSyncMaterial(),
      clientAt: new Date().toISOString(),
    }
    const db = cloud.database as any
    // 先查是否已有行，决定 insert 还是 update（owner_id 由服务端 auth.uid() 填充，不可手写）
    const { data: existing, error: qerr } = await db
      .from(TABLE)
      .select('id')
      .maybeSingle()
    if (qerr) return { ok: false, error: errMsg(qerr) }

    if (existing?.id) {
      const { error } = await db
        .from(TABLE)
        .update({ payload, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) return { ok: false, error: errMsg(error) }
    } else {
      const { error } = await db
        .from(TABLE)
        .insert({ payload, owner_name: null })
      if (error) return { ok: false, error: errMsg(error) }
    }
    try { localStorage.setItem(LAST_SYNC_KEY, payload.clientAt) } catch { /* 忽略 */ }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

/**
 * 把云端载荷应用到本地：先应用保险箱材料，再以云端数据为准整体覆盖本地。
 * 云同步的语义是「同一账号全端一致」，因此登录/手动同步时云端是权威，不能用导入的并集合并
 * （否则本地已删除的记录会在合并后复活）。
 */
export function applyPayload(payload: SyncPayload, _local: AppState): AppState {
  if (payload.vault) applyVaultSyncMaterial(payload.vault)
  try { localStorage.setItem(LAST_SYNC_KEY, payload.clientAt) } catch { /* 忽略 */ }
  return payload.appState
}

export function getLastSyncAt(): string | null {
  try { return localStorage.getItem(LAST_SYNC_KEY) } catch { return null }
}
