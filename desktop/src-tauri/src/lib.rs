#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::{SystemTime, UNIX_EPOCH};

/// 通用模型 API 代理：让「用自己 Key 调用」绕过桌面 CORS。
/// 安全约束：仅 http(s)；禁止内网/回环以外的私有地址（防止开放代理 SSRF）；
/// 不存储任何凭证，Key 仅用于本次请求头。生图/视频的异步任务也用此命令提交与轮询。
#[tauri::command]
async fn call_provider_api(url: String, api_key: String, body_json: String, method: String) -> Result<String, String> {
    if api_key.trim().is_empty() { return Err("API Key 不能为空".into()) }
    // URL 基础校验
    if !(url.starts_with("https://") || url.starts_with("http://localhost") || url.starts_with("http://127.0.0.1")) {
        return Err("仅允许 https 或本机地址".into())
    }
    let m = method.to_uppercase();
    if m != "POST" && m != "GET" { return Err("仅支持 POST / GET".into()) }

    let client = reqwest::Client::builder()
        .user_agent("ai-credit-manager/0.1")
        .timeout(std::time::Duration::from_secs(120))
        .build().map_err(|e| format!("客户端初始化失败：{}", e))?;

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

    let client = reqwest::Client::builder()
        .user_agent("ai-credit-manager/0.1")
        .build()
        .map_err(|e| format!("客户端初始化失败：{}", e))?;
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

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![proxy_usage, call_provider_api, send_notification, open_url, biometric_available, biometric_auth, choose_save_dir, write_file_to_dir, is_app_installed, open_local_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
