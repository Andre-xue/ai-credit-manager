#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::{SystemTime, UNIX_EPOCH};

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
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&url).spawn()
        .map_err(|e| format!("打开浏览器失败：{}", e))?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd").args(["/C", "start", "", &url]).spawn()
        .map_err(|e| format!("打开浏览器失败：{}", e))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&url).spawn()
        .map_err(|e| format!("打开浏览器失败：{}", e))?;
    Ok(())
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
        .invoke_handler(tauri::generate_handler![proxy_usage, send_notification, open_url, biometric_available, biometric_auth, choose_save_dir, write_file_to_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
