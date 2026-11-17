// 云服务客户端：全端共享一个实例（Web / 桌面 Tauri / 安卓 Capacitor WebView）。
// publicConfig 为面向客户端的公开配置（publishableKey 本身不含权限，服务端按来源域名校验）。
// 端点与 Key 只能来自开通云服务时返回的配置，切勿硬编码其他值。

import { createWorkBuddyCloud, type CloudUser } from '@tencent-ai/workbuddy-cloud-sdk'

export const PUBLIC_CONFIG = {
  endpoint: 'https://wbapp-uxzyxkkqofad4mwe1lca5e.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_uxZyXKKqOfad4mWe1LCa5E_eay4EyhsGD7Qb3o46G1JqqvdU5VGfd7q',
}
/** 供桌面端 Rust 代理转发 LLM 请求（公开配置，非密钥） */
export const LLM_PROXY_CONFIG = {
  endpoint: PUBLIC_CONFIG.endpoint,
  publishableKey: PUBLIC_CONFIG.publishableKey,
}

export const cloud = createWorkBuddyCloud({
  endpoint: PUBLIC_CONFIG.endpoint,
  oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
  publishableKey: PUBLIC_CONFIG.publishableKey,
})

export type { CloudUser }
