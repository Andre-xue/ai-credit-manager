#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::{SystemTime, UNIX_EPOCH};
use std::sync::OnceLock;

/// 进程级共享 HTTP Client：复用 TLS 连接池，避免每次调用重新握手（性能）。
/// 官方端点用默认重定向策略；用户自定义 API 端点用禁用重定向的版本（SSRF 防护）。
fn shared_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("ai-credit-manager/0.1")
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("初始化 HTTP 客户端失败")
    })
}

fn shared_provider_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("ai-credit-manager/0.1")
            .timeout(std::time::Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("初始化 API 代理客户端失败")
    })
}

/// 云 LLM 代理：桌面 WebView 直连云端 SSE 会被 CORS 拦截（POST /chat/completions 预检失败），
/// 由 Rust 后端带 publishableKey 头转发，收集 SSE 的 content delta 后返回完整文本。
#[tauri::command]
async fn call_cloud_llm(endpoint: String, publishable_key: String, body_json: String, conversation_id: Option<String>) -> Result<String, String> {
    let url = format!("{}/.cloud/llm/chat/completions", endpoint.trim_end_matches('/'));
    let client = shared_http_client();
    let _: serde_json::Value = serde_json::from_str(&body_json).map_err(|e| format!("请求体非法：{}", e))?;
    let mut req = client.post(&url)
        .header("x-wb-webapp-access-key", &publishable_key)
        .header("Accept", "text/event-stream")
        .header("Content-Type", "application/json");
    if let Some(cid) = &conversation_id { req = req.header("X-Conversation-ID", cid); }
    let resp = req.body(body_json).send().await.map_err(|e| format!("请求失败：{}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败：{}", e))?;
    if !status.is_success() { return Err(format!("云端返回 {}：{}", status.as_u16(), text.chars().take(300).collect::<String>())) }

    // 解析 SSE：逐行取 data: {...}，累加 choices[0].delta.content；
    // 思考模型可能把内容放在 reasoning_content，content 为空时回退使用它。
    let mut answer = String::new();
    let mut reasoning = String::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with("data:") { continue }
        let data = line[5..].trim();
        if data == "[DONE]" { break }
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
            if let Some(delta) = json.get("choices").and_then(|c| c.get(0)).and_then(|ch| ch.get("delta")) {
                if let Some(content) = delta.get("content").and_then(|v| v.as_str()) { answer.push_str(content) }
                if let Some(reason) = delta.get("reasoning_content").and_then(|v| v.as_str()) { reasoning.push_str(reason) }
            }
        }
    }
    if answer.is_empty() { answer = reasoning; }
    if answer.is_empty() { return Err("云端未返回文本内容".into()) }
    Ok(answer)
}

/// 校验代理目标 URL，防止 SSRF 与 API Key 外泄。
/// - https：允许公网域名，但拒绝解析到内网/回环/链路本地/云元数据地址的主机
/// - http：仅允许本机（localhost / 127.0.0.0/8 / ::1），供本地 Ollama 等模型使用
fn validate_proxy_url(raw: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(raw).map_err(|_| "URL 格式不合法".to_string())?;
    let scheme = u.scheme();
    if scheme != "https" && scheme != "http" {
        return Err("仅允许 http(s) 协议".into())
    }
    let host = u.host_str().ok_or_else(|| "URL 缺少主机".to_string())?;
    let is_local = host == "localhost"
        || host == "::1"
        || host == "[::1]"
        || host.starts_with("127.")
        || host == "0.0.0.0";
    if scheme == "http" {
        if !is_local {
            return Err("http 仅允许本机地址（localhost / 127.0.0.1 / ::1）".into())
        }
        return Ok(u)
    }
    // https：拒绝字面量的内网/保留地址（防止 https://127.0.0.1、169.254.169.254 等绕过）
    let ip_blocked = host.parse::<std::net::IpAddr>().map(|ip| !is_public_ip(&ip)).unwrap_or(false);
    if is_local || ip_blocked {
        return Err("不允许请求内网或本机地址".into())
    }
    Ok(u)
}

/// 判断 IP 是否为公网地址（用于 SSRF 防护）
fn is_public_ip(ip: &std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            !(o[0] == 10
                || o[0] == 127
                || o[0] == 0
                || (o[0] == 169 && o[1] == 254)
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                || (o[0] >= 224))
        }
        IpAddr::V6(v) => {
            !v.is_loopback() && !v.is_unspecified() && !v.is_multicast()
                // 拒绝 IPv4 映射的内网地址
                && v.to_ipv4().map(|x| is_public_ip(&IpAddr::V4(x))).unwrap_or(true)
        }
    }
}

/// 通用模型 API 代理：让「用自己 Key 调用」绕过桌面 CORS。
/// 安全约束：仅 http(s)，且拒绝内网/回环/保留地址（防止开放代理 SSRF 与 Key 外发）；
/// 不存储任何凭证，Key 仅用于本次请求头。生图/视频的异步任务也用此命令提交与轮询。
#[tauri::command]
async fn call_provider_api(url: String, api_key: String, body_json: String, method: String) -> Result<String, String> {
    if api_key.trim().is_empty() { return Err("API Key 不能为空".into()) }
    let url = validate_proxy_url(&url)?.to_string();
    let m = method.to_uppercase();
    if m != "POST" && m != "GET" { return Err("仅支持 POST / GET".into()) }

    let client = shared_provider_client(); // 进程级复用；已禁用重定向，避免 302 到内网绕过 SSRF 校验

    let mut req = if m == "POST" {
        let parsed: serde_json::Value = serde_json::from_str(&body_json)
            .map_err(|e| format!("请求体不是合法 JSON：{}", e))?;
        client.post(&url).json(&parsed)
    } else {
        client.get(&url)
    };
    req = req.header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json");

    let resp = req.send().await.map_err(|e| format!("请求失败：{}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败：{}", e))?;
    if !status.is_success() {
        return Err(format!("接口返回 {}：{}", status.as_u16(), text.chars().take(200).collect::<String>()))
    }
    Ok(text)
}

/// 官方只读用量代理：仅允许白名单官方端点，绕过桌面端 CORS 限制。
/// 不接收任意 URL，防止被用作开放代理（SSRF）；不存储任何凭证。
/// 定位 Touch ID helper 二进制（开发态与打包态）
fn biometric_helper_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("binaries").join("acm-biometric-aarch64-apple-darwin");
        if p.exists() { return Some(p) }
        let p2 = dir.join("acm-biometric-aarch64-apple-darwin");
        if p2.exists() { return Some(p2) }
    }
    // 开发态：从 exe 目录向上找 src-tauri/binaries
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent();
        while let Some(d) = dir {
            let p = d.join("binaries").join("acm-biometric-aarch64-apple-darwin");
            if p.exists() { return Some(p) }
            dir = d.parent();
        }
    }
    None
}

#[tauri::command]
async fn biometric_available(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let p = biometric_helper_path(&app).ok_or("未找到指纹验证组件")?;
        let out = std::process::Command::new(p).arg("check").output()
            .map_err(|e| format!("指纹检测失败：{}", e))?;
        Ok(out.status.success())
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = app; Ok(false) }
}

#[tauri::command]
async fn biometric_auth(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let p = biometric_helper_path(&app).ok_or("未找到指纹验证组件")?;
        let out = std::process::Command::new(p).arg("auth").output()
            .map_err(|e| format!("指纹验证失败：{}", e))?;
        Ok(out.status.success())
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = app; Ok(false) }
}

/// 在系统默认浏览器打开外部链接。仅允许 http(s)，防止被滥用。
/// 弹出系统文件夹选择框，返回选中目录路径（macOS 用 osascript，零依赖）
#[tauri::command]
async fn choose_save_dir() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let script = "POSIX path of (choose folder with prompt \"选择导出文件的保存位置\")";
        let out = std::process::Command::new("osascript")
            .arg("-e").arg(script).output()
            .map_err(|e| format!("打开文件夹选择失败：{}", e))?;
        if !out.status.success() {
            return Ok(None) // 用户取消
        }
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok(if path.is_empty() { None } else { Some(path) })
    }
    #[cfg(not(target_os = "macos"))]
    { Err("当前平台暂不支持选择保存目录，请使用默认下载".into()) }
}

/// 将文本文件写入指定目录
#[tauri::command]
async fn write_file_to_dir(dir: String, filename: String, content: String) -> Result<String, String> {
    use std::io::Write;
    let path = std::path::Path::new(&dir).join(&filename);
    let mut f = std::fs::File::create(&path).map_err(|e| format!("创建文件失败：{}", e))?;
    f.write_all(content.as_bytes()).map_err(|e| format!("写入失败：{}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("仅允许 http(s) 链接".into())
    }
    // 校验 URL 不含空白与控制字符，杜绝 cmd/shell 元字符注入面
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("链接含非法字符".into())
    }
    // Windows 用 rundll32 直接交给系统处理 URL，不走 cmd，避免 &|^ 等被当作命令分隔符。
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url]).status();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&url).status();
    result.map(|_| ()).map_err(|e| format!("打开浏览器失败：{}", e))
}

/// 打开系统「麦克风隐私设置」面板。目标地址固定，不接受前端传参，避免命令注入。
#[tauri::command]
async fn open_mic_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // 新系统 scheme 先跳麦克风页；再显式唤起系统设置 App 保证窗口到前台
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone").status();
        let _ = std::process::Command::new("open").args(["-a", "System Settings"]).status();
        return Ok(())
    }
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", "ms-settings:privacy-microphone"]).status();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg("gnome-control-center privacy").status();
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let result = Ok(std::process::ExitStatus::default());
    #[cfg(not(target_os = "macos"))]
    result.map(|_| ()).map_err(|e| format!("打开系统设置失败：{}", e))
}

/// 打开系统「语音识别隐私设置」面板（仅桌面端）。
#[tauri::command]
async fn open_speech_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition").status();
        let _ = std::process::Command::new("open").args(["-a", "System Settings"]).status();
        return Ok(())
    }
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", "ms-settings:privacy-speech"]).status();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg("gnome-control-center privacy").status();
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let result = Ok(std::process::ExitStatus::default());
    #[cfg(not(target_os = "macos"))]
    result.map(|_| ()).map_err(|e| format!("打开系统设置失败：{}", e))
}

/// 检测本机是否安装了指定客户端。
/// macOS：用 mdfind 按官方 bundle id 精确匹配（Spotlight 索引）；Windows：查注册表 App Paths / where。
/// 仅做只读检测，不启动任何程序。
#[tauri::command]
async fn is_app_installed(bundle_ids: Vec<String>, exe_names: Vec<String>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        for bid in &bundle_ids {
            if bid.is_empty() { continue }
            // 允许字母数字、点、横线，防止命令注入
            if !bid.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') { continue }
            if let Ok(out) = std::process::Command::new("mdfind")
                .arg(format!("kMDItemCFBundleIdentifier == '{}'", bid)).output() {
                if !out.stdout.is_empty() { return Ok(true) }
            }
        }
        // mdfind 索引未建立时，回退检查常见安装目录（整行精确匹配 xxx.app，避免子串误判）
        if let Ok(out) = std::process::Command::new("ls").arg("/Applications").output() {
            let installed: Vec<String> = String::from_utf8_lossy(&out.stdout)
                .lines().map(|l| l.trim().to_lowercase()).collect();
            for exe in &exe_names {
                let stem = exe.trim_end_matches(".exe").to_lowercase();
                if !stem.is_empty() && installed.iter().any(|n| n == &format!("{}.app", stem)) {
                    return Ok(true)
                }
            }
        }
        Ok(false)
    }
    #[cfg(target_os = "windows")]
    {
        for exe in &exe_names {
            if exe.is_empty() { continue }
            if !exe.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ' ') { continue }
            // 注册表 App Paths
            if let Ok(out) = std::process::Command::new("reg")
                .args(["query", &format!("HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{}", exe)])
                .output() {
                if out.status.success() { return Ok(true) }
            }
            // PATH 中查找
            if let Ok(out) = std::process::Command::new("where").arg(exe).output() {
                if out.status.success() { return Ok(true) }
            }
        }
        Ok(false)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (bundle_ids, exe_names);
        Ok(false)
    }
}

/// 唤醒本机已安装的客户端。命中第一个可用标识即打开，返回是否成功发起。
/// 调用方应在失败时回退到官网，保证始终有可用出口。
#[tauri::command]
async fn open_local_app(bundle_ids: Vec<String>, exe_names: Vec<String>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = &exe_names; // macOS 仅用 bundle id 唤醒
        for bid in &bundle_ids {
            if bid.is_empty() { continue }
            if !bid.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') { continue }
            if let Ok(out) = std::process::Command::new("mdfind")
                .arg(format!("kMDItemCFBundleIdentifier == '{}'", bid)).output() {
                if !out.stdout.is_empty() {
                    // status() 等待并检查退出码：bundle id 未注册时 open 会返回非 0，
                    // 避免"report 成功但没唤醒"的假阳性。
                    let ok = std::process::Command::new("open").arg("-b").arg(bid).status()
                        .map(|s| s.success()).unwrap_or(false);
                    if ok { return Ok(true) }
                }
            }
        }
        Ok(false)
    }
    #[cfg(target_os = "windows")]
    {
        for exe in &exe_names {
            if exe.is_empty() { continue }
            if !exe.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ' ') { continue }
            if let Ok(out) = std::process::Command::new("where").arg(exe).output() {
                if out.status.success() {
                    std::process::Command::new("cmd").args(["/C", "start", "", exe]).spawn()
                        .map_err(|e| format!("唤醒客户端失败：{}", e))?;
                    return Ok(true)
                }
            }
        }
        Ok(false)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (bundle_ids, exe_names);
        Ok(false)
    }
}

#[tauri::command]
async fn send_notification(title: String, body: String) -> Result<(), String> {
    // 用系统原生命令发通知，避免引入额外 crate（本机无外网时也能编译）。
    // 转义双引号与反斜杠，防止 AppleScript 注入。
    let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "display notification \"{}\" with title \"AI 积分管家\" subtitle \"{}\"",
        esc(&body), esc(&title)
    );
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("osascript")
            .arg("-e").arg(&script)
            .output()
            .map_err(|e| format!("发送通知失败：{}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = script;
        Err("当前平台暂未实现系统通知".into())
    }
}

#[tauri::command]
async fn proxy_usage(provider: String, api_key: String) -> Result<serde_json::Value, String> {
    if api_key.trim().is_empty() {
        return Err("API Key 不能为空".into())
    }
    let (url, need_range): (&str, bool) = match provider.as_str() {
        "openai" => ("https://api.openai.com/v1/organization/usage/completions", true),
        "anthropic" => ("https://api.anthropic.com/v1/usage", false),
        _ => return Err(format!("平台 {} 不支持官方只读用量 API", provider)),
    };

    let client = shared_http_client();
    let mut req = client.get(url).header("Authorization", format!("Bearer {}", api_key));
    if need_range {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        req = req.query(&[("start_time", (now - 30 * 24 * 3600).to_string())]);
    }

    let resp = req.send().await.map_err(|e| format!("请求官方接口失败：{}", e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("官方接口返回 {}，请检查 Key 权限与账户类型", status.as_u16()))
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("解析响应失败：{}", e))
}

/// 本地服务 HTTP 指纹判定：Ollama GET /api/tags 返回 {"models":[...]}
fn fp_ollama(v: &serde_json::Value) -> bool { v.get("models").is_some() }
/// ComfyUI GET /system_stats 返回 {"system":...,"devices":...}
fn fp_comfyui(v: &serde_json::Value) -> bool { v.get("system").is_some() && v.get("devices").is_some() }
/// LM Studio GET /v1/models 返回 OpenAI 格式 {"data":[...]}
fn fp_lmstudio(v: &serde_json::Value) -> bool { v.get("data").is_some() }

/// 探测本机正在运行的本地模型服务（Ollama / ComfyUI / LM Studio 等）。
/// 不再仅凭 TCP 端口开放就认定（会把占用 8080/5000 的无关程序误报为本地服务），
/// 而是对每个候选地址发真实 HTTP 请求做指纹校验，只有响应匹配服务特征才返回。
/// 返回实际可连接的网关地址与端口，前端只读展示、不可修改。
#[tauri::command]
async fn detect_local_services() -> Result<Vec<serde_json::Value>, String> {
    use std::time::Duration;

    // 探测专用短超时客户端：本地服务应快速响应，避免无关端口拖慢整体探测
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1200))
        .connect_timeout(Duration::from_millis(300))
        .build()
        .map_err(|e| format!("初始化探测客户端失败：{}", e))?;

    // (服务名, 指纹路径, 判定函数)：对候选地址依次尝试，命中即确认服务类型
    let fingerprints: &[(&str, &str, fn(&serde_json::Value) -> bool)] = &[
        ("Ollama", "/api/tags", fp_ollama),
        ("ComfyUI", "/system_stats", fp_comfyui),
        ("LM Studio", "/v1/models", fp_lmstudio),
    ];

    // 候选端口：各服务默认端口 + 常见自定义端口（覆盖大多数本机部署习惯）
    let ports: &[u16] = &[
        11434, 11435, 11436, // Ollama 默认及常见自定义
        8188, 8189, 8288,    // ComfyUI 默认及常见自定义
        1234, 1235,          // LM Studio 默认及常见自定义
        5000, 5001, 8000, 8080, 7860, 3000, // 通用本地端口（需指纹命中才返回）
    ];
    let hosts = ["127.0.0.1", "localhost"];
    let mut found: Vec<serde_json::Value> = Vec::new();

    for &port in ports {
        let mut matched: Option<(&str, &str)> = None; // (service, path)
        for host in hosts {
            for (service, path, check) in fingerprints {
                let url = format!("http://{}:{}{}", host, port, path);
                if let Ok(resp) = client.get(&url).send().await {
                    if resp.status().is_success() {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            if check(&json) {
                                matched = Some((service, host));
                                break
                            }
                        }
                    }
                }
            }
            if matched.is_some() { break }
        }
        if let Some((service, host)) = matched {
            let host = if host == "localhost" { "127.0.0.1" } else { host };
            found.push(serde_json::json!({
                "service": service,
                "host": host,
                "port": port,
                "url": format!("http://{}:{}", host, port),
            }));
        }
    }
    Ok(found)
}

/// 从 macOS `sysctl -n hw.memsize` 的输出（字节数）解析物理内存 GB
fn parse_memsize_bytes_macos(out: &str) -> Option<f64> {
    let bytes: u64 = out.trim().parse().ok()?;
    Some(bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}

/// 从 Linux /proc/meminfo 的 MemTotal 行解析物理内存 GB（kB → GB）
fn parse_meminfo_linux(out: &str) -> Option<f64> {
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            let kb: f64 = rest.split_whitespace().next()?.parse().ok()?;
            return Some(kb / 1024.0 / 1024.0)
        }
    }
    None
}

/// 读取本机物理内存 GB（桌面端）。失败返回 0，前端按 8G 保守档处理。
#[tauri::command]
fn get_system_memory_gb() -> f64 {
    use std::process::Command;
    let out = {
        #[cfg(target_os = "macos")]
        { Command::new("sysctl").args(["-n", "hw.memsize"]).output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).and_then(|s| parse_memsize_bytes_macos(&s)) }
        #[cfg(target_os = "linux")]
        { std::fs::read_to_string("/proc/meminfo").ok().and_then(|s| parse_meminfo_linux(&s)) }
        #[cfg(target_os = "windows")]
        { Command::new("wmic").args(["computersystem", "get", "TotalPhysicalMemory", "/value"]).output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).and_then(|s| s.split('=').nth(1).map(|x| x.trim().to_string())).and_then(|n| n.parse::<u64>().ok()).map(|b| b as f64 / (1024.0*1024.0*1024.0)) }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        { None::<f64> }
    };
    out.unwrap_or(0.0)
}

/// 检测单个本地服务是否正在运行（HTTP 指纹校验，返回服务实际地址或 null）。
/// key: ollama / comfyui / lmstudio
#[tauri::command]
async fn check_local_service(key: String) -> Option<String> {
    use std::time::Duration;
    let (ports, path, check): (&[u16], &str, fn(&serde_json::Value) -> bool) = match key.as_str() {
        "ollama" => (&[11434, 11435, 11436], "/api/tags", fp_ollama),
        "comfyui" => (&[8188, 8189, 8288], "/system_stats", fp_comfyui),
        "lmstudio" => (&[1234, 1235], "/v1/models", fp_lmstudio),
        _ => return None,
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1000))
        .connect_timeout(Duration::from_millis(250))
        .build()
        .ok()?;
    for &port in ports {
        for host in ["127.0.0.1", "localhost"] {
            let url = format!("http://{}:{}{}", host, port, path);
            if let Ok(resp) = client.get(&url).send().await {
                if resp.status().is_success() {
                    if let Ok(json) = resp.json::<serde_json::Value>().await {
                        if check(&json) {
                            return Some(format!("http://127.0.0.1:{}", port))
                        }
                    }
                }
            }
        }
    }
    None
}

/// 启动本机本地模型服务（显式调用，由用户主动触发）。
/// 仅拉起应用进程，不修改任何系统自启设置；服务由用户在各自应用内管理停止。
/// 返回启动指引文案。
#[tauri::command]
fn start_local_service(key: String) -> Result<String, String> {
    use std::process::Command;
    let (app_name, guide): (&str, &str) = match key.as_str() {
        "ollama" => ("Ollama", "Ollama 启动后将在 11434 端口提供服务"),
        "comfyui" => ("Comfy Desktop", "ComfyUI 启动后将在 8188 端口提供服务"),
        "lmstudio" => ("LM Studio", "LM Studio 需在设置中开启本地服务器（1234 端口）"),
        _ => return Err("未知服务".to_string()),
    };
    #[cfg(target_os = "macos")]
    {
        // 先确认应用是否安装
        let app_path = format!("/Applications/{}.app", app_name);
        if !std::path::Path::new(&app_path).exists() {
            return Err(format!("未检测到 {}，请先安装后再启动", app_name))
        }
        match Command::new("open").args(["-a", app_name]).spawn() {
            Ok(_) => Ok(format!("已请求启动 {}，请稍候点击「重新检测」。{}", app_name, guide)),
            Err(e) => Err(format!("启动失败：{}", e)),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(format!("当前平台暂不支持一键启动，请手动打开 {}。{}", app_name, guide))
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![proxy_usage, call_provider_api, call_cloud_llm, send_notification, open_url, open_mic_settings, open_speech_settings, biometric_available, biometric_auth, choose_save_dir, write_file_to_dir, is_app_installed, open_local_app, detect_local_services, get_system_memory_gb, check_local_service, start_local_service])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod local_service_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ollama_fingerprint_matches_only_ollama_shape() {
        assert!(fp_ollama(&json!({"models": [{"name": "llama3"}]})));
        assert!(!fp_ollama(&json!({"status": "ok"})));
        assert!(!fp_ollama(&json!({})));
    }

    #[test]
    fn comfyui_fingerprint_requires_system_and_devices() {
        assert!(fp_comfyui(&json!({"system": {}, "devices": []})));
        assert!(!fp_comfyui(&json!({"system": {}}))); // 缺 devices 不算
        assert!(!fp_comfyui(&json!({"hello": "world"})));
    }

    #[test]
    fn lmstudio_fingerprint_matches_openai_models_shape() {
        assert!(fp_lmstudio(&json!({"data": [{"id": "m"}]})));
        assert!(!fp_lmstudio(&json!({"models": []}))); // Ollama 形状不算 LM Studio
        assert!(!fp_lmstudio(&json!({})));
    }

    #[test]
    fn parse_macos_memsize() {
        let bytes_16g = 16u64 * 1024 * 1024 * 1024;
        assert_eq!(parse_memsize_bytes_macos(&bytes_16g.to_string()), Some(16.0));
        assert_eq!(parse_memsize_bytes_macos("17179869184\n"), Some(16.0));
        assert_eq!(parse_memsize_bytes_macos("invalid"), None);
    }

    #[test]
    fn parse_linux_meminfo() {
        let meminfo = "MemTotal:       16384256 kB\nMemFree:         1234567 kB\n";
        let gb = parse_meminfo_linux(meminfo).unwrap();
        assert!(gb > 15.0 && gb < 17.0, "解析结果 {} 应接近 16GB", gb);
        assert_eq!(parse_meminfo_linux("no mem here"), None);
    }

    #[test]
    fn unrelated_services_do_not_match_any_fingerprint() {
        // 占用 8080/5000 的无关 Web 服务响应，不应被误判为任何本地模型服务
        for body in [json!({"status": "ok"}), json!({"hello": "world"}), json!({"version": "1.0"})] {
            assert!(!fp_ollama(&body) && !fp_comfyui(&body) && !fp_lmstudio(&body));
        }
    }
}
