# AI 积分管家（AI Credit Manager）

统一管理你在各家 AI 平台的**积分、额度、用量与 API Key** 的合规工具。

> **仓库**：https://github.com/Andre-xue/ai-credit-manager
> **线上演示**（启用 Pages 后）：https://andre-xue.github.io/ai-credit-manager/
> **Docker 镜像**：`docker compose up -d` → http://localhost:8080

## Docker 版（容器运行）

本项目 Web 版可完全运行在 Docker 容器中，镜像仅约 78 MB（多阶段构建 + nginx）。

```bash
# 方式一：docker compose（推荐）
docker compose up -d --build
# 访问 http://localhost:8080

# 方式二：纯 docker 命令
docker build -t ai-credit-manager:latest .
docker run -d --name ai-credit-manager -p 8080:80 --restart unless-stopped ai-credit-manager:latest
```

- 健康检查：`curl http://localhost:8080/health` 返回 `ok`
- 更新：[见下方"GitHub 实时更新"](#github-实时更新)

> **数据说明**：本应用为本地优先架构，所有账户/额度/密钥数据保存在**浏览器 localStorage**，容器不持久化任何用户数据。因此容器可随时删除重建，数据不会丢失；但换浏览器/设备需通过「导出/导入」迁移。容器本身无状态，无需挂载数据卷。

## GitHub 实时更新

推送到 `main` 分支后，GitHub Actions 会自动：
1. 运行 62 个单元测试 + 构建 + Docker 冒烟测试（CI）
2. 构建 Web 版并部署到 GitHub Pages（免费静态托管）

在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions** 即可启用 Pages 自动部署。此后每次 push 都会实时更新线上版本。

## 一、在我的电脑上运行（最简单）

**前置条件**：安装 Node.js 20 或以上（[https://nodejs.org](https://nodejs.org)，选 LTS 版，一路下一步即可）。只需安装一次。

**Mac 用户**：打开 Finder，进入 `ai-credit-manager` 文件夹，**双击 `start-mac.command`**。
- 首次运行会自动安装依赖（约 1 分钟），随后自动打开浏览器，地址是 `http://localhost:5173`。
- 若提示"无法打开，因为来自身份不明的开发者"：右键该文件 →「打开」→ 弹窗点「打开」即可（仅需一次）。
- 使用完毕后，关闭弹出的终端窗口即停止服务。

**Windows 用户**：进入 `ai-credit-manager` 文件夹，**双击 `start-windows.bat`**，浏览器会自动打开 `http://localhost:5173`。

**手动命令方式**（任意系统，在项目目录打开终端）：

```bash
npm install     # 首次运行需要
npm run dev     # 启动，然后浏览器访问 http://localhost:5173
```

> 数据保存在浏览器本地存储中，同一个浏览器地址访问即可看到之前的数据。清除浏览器站点数据会清空记录，重要数据请用顶栏「导出」备份为 JSON。

**其他端**：桌面 App（Mac/Windows 独立程序）、安卓、微信小程序、iOS 的构建方式见下方「快速开始」。

### 各平台安装包下载（GitHub Releases）

访问 https://github.com/Andre-xue/ai-credit-manager/releases/latest 下载最新版本（当前 **v0.1.6**）：

| 平台 | 文件格式 | 说明 |
|------|----------|------|
| macOS Apple Silicon | `.dmg` | M1/M2/M3/M4 |
| macOS Intel | `.dmg` | Intel 芯片 |
| Windows | `.msi` / `.exe` | 64 位 |
| Linux | `.AppImage` / `.deb` | 64 位 |
| Android | `.apk` | Debug 版，安装时选"允许未知来源" |

这些包由 GitHub Actions 在多平台 runner 上自动编译，打 `v*` 标签时触发。

**关于 iOS**：Apple 要求所有 iOS 应用必须签名才能在真机安装，签名需要加入 Apple Developer 计划（$99/年）。因此无法提供可直接安装的 IPA。可选方案：
1. **自行编译**（免费）：在有 Xcode 的 Mac 上 `cd android && npx cap add ios && npx cap sync ios && npx cap open ios`，用免费开发者账号签名后安装到自己的设备
2. **TestFlight 分发**：加入开发者计划后走 App Store Connect 分发给测试者
3. **使用 Web 版**：把 `http://localhost:8080`（Docker）或 Pages 线上地址添加到 iPhone 主屏幕，体验接近原生 App


> **定位说明**：本工具管理的是你**自己账户**的资源。所有数据本地优先存储；签到仅做提醒并跳转官方页面，由你本人登录完成领取。工具**不模拟登录、不自动领取、不共享凭证、不抓取私有接口**，因此可通过各应用商店与小程序审核。

## 功能

- **积分额度看板**：集中查看各账户剩余额度、使用进度、重置时间，支持手动录入或官方只读 API 查询。
- **用量预测与耗尽提醒**：基于近期额度快照或用量记录，按日均消耗速度预测"约 N 天后耗尽"，并分健康/警告(≤7天)/告急(≤3天)三级提示。录入满 2 次即可预测。
- **签到提醒**：显示今日待签到平台，一键跳转官方页面；本人完成后手动标记。
- **API Key 管理**：AES-256-GCM 加密，PBKDF2（210k 次）派生密钥，主密码解锁，密文仅存本地；导出数据不含密钥。表格化布局（名称/余额/API地址/Key/备注/操作），**13 个平台自动填充官方 API 地址**；备注用 `[分类] 说明` 格式即可按分类下拉筛选；支持分页（每页 8 条）；点击眼睛弹出查看窗，**macOS 支持 Touch ID 指纹解锁查看明文**（其他平台隐藏指纹按钮）。
- **用量与费用**：本地记录用量、估算费用、预算预警、近 14 天趋势。
- **设置中心**：统一管理签到提醒、耗尽预警阈值（1/3/7/14/30 天）、默认额度单位、每月预算、密钥保险箱、备份提醒、数据导入导出与清空、数据概览。所有设置保存在本地并向后兼容旧版本存档。
- **福利中心**：聚合 14 个平台公开的免费层/试用/教育优惠信息，按"全部/仅我的平台"筛选，标记本人已处理并跳转官方页面。工具只提供公开信息与官方链接，**不自动领取、不模拟登录**。具体额度以官方实时公告为准。
- **系统通知**：签到与额度告警主动提醒（桌面走系统通知、Web 走浏览器通知），每日每类最多一次；支持免打扰时段与手动测试。设置中开启。
- **跨平台价值归一化**：把不同单位的剩余额度按可校准的单价折算成人民币"资源总估值"；费用页新增按平台消费结构分析与单价校准表（默认值为参考，请按实际账单调整）。

## 项目结构

```
ai-credit-manager/
├── src/                 # 核心 Web 应用（React + TS + Vite）
│   ├── core/            # 共享核心：数据模型 / 加密 / 存储 / 适配器
│   └── data/providers.ts# 14 个平台官方目录（官方链接）
├── miniapp/             # 微信小程序（原生，查询/提醒版）
├── desktop/src-tauri/   # 桌面端 Tauri 配置（Mac / Windows / Linux）
└── android/             # 安卓端 Capacitor 配置（也可 build iOS）
```

## 快速开始

### Web 版（可立即运行）

```bash
cd ai-credit-manager
npm install
npm run dev        # 开发预览 http://localhost:5173
npm run build      # 生产构建，产物在 dist/
npm test           # 运行 27 个核心逻辑单元测试
```

> 测试覆盖：CSV 解析（英文/中文表头、引号字段、BOM/CRLF、异常值）、状态存取与合并去重、密钥保险箱（加密解密往返、错误密码拒绝、主密码校验）。

### 桌面端（Mac / Windows）

前置：安装 [Rust](https://rustup.rs) 与系统构建工具（macOS: Xcode CLT；Windows: VS Build Tools + WebView2）。

```bash
cd ai-credit-manager/desktop
npm install
npm run tauri dev    # 开发（热更新）
npm run tauri build  # 生成 .dmg / .msi
```

Tauri 配置在 `desktop/src-tauri/tauri.conf.json`，`beforeBuildCommand` 会自动构建前端，无需手动执行。产物位置：

- **macOS**：`desktop/src-tauri/target/release/bundle/macos/*.app`；dmg 在 `bundle/dmg/`（若 Tauri 的 `hdiutil` 脚本在新版 macOS 报错，可手动执行：
  ```bash
  cd desktop/src-tauri/target/release/bundle
  STAGE=/tmp/acm-stage && rm -rf $STAGE && mkdir -p $STAGE
  cp -R "macos/AI Credit Manager.app" "$STAGE/" && ln -s /Applications "$STAGE/Applications"
  hdiutil create -volname "AI 积分管家" -srcfolder "$STAGE" -ov -format UDZO "AI Credit Manager_0.1.0_aarch64.dmg"
  ```
  ）
- **Windows**：`desktop/src-tauri/target/release/bundle/msi/*.msi`

> **macOS 首次打开提示"无法验证开发者"**：右键 .app →「打开」→ 弹窗点「打开」即可。要彻底消除提示需加入 Apple Developer 计划做签名与公证（可选，不影响本地使用）。
>
> 本机已内置完整图标集（`desktop/src-tauri/icons/`），CSP 已放行内联样式与官方 API 域名；如修改 `tauri.conf.json` 的 `csp`，注意保留 `ipc:` 与 `'unsafe-inline'`，否则界面会白屏或代理失效。

### 安卓端

前置：Android Studio + JDK 17 + Android SDK。

```bash
cd ai-credit-manager/android
npm install
npm run sync         # 构建 Web 并同步到原生工程
npm run open         # 在 Android Studio 打开
npm run build        # 构建 APK
```

### iOS 端

在同一 `android/` 目录的 `package.json` 中追加 `@capacitor/ios`，然后：

```bash
npx cap add ios
npx cap sync ios
npx cap open ios      # 用 Xcode 打开，配置签名后 Archive
```

### 微信小程序

1. 打开微信开发者工具 → 「导入项目」 → 选择 `miniapp/` 目录。
2. 填入你自己的 AppID（或使用测试号）。
3. 编译预览；上传前在 `project.config.json` 中替换为真实 AppID。

> 小程序为**轻量查询/提醒版**：不含 API Key 加密保险箱（小程序不适合存密钥）；支持添加账户后随时点「编辑额度」更新或清除额度；不做任何自动化外部操作，以确保符合平台审核规范。

## 数据来源与合规边界

| 方式 | 说明 | 适用 |
|------|------|------|
| 官方只读 API | 桌面端经 Rust 后端代理（域名白名单）绕过 CORS；Web 端直连可能受 CORS 限制。需 Admin Key | OpenAI、Anthropic 等 |
| 官方页面跳转 | 复制/打开官方用量或签到页，本人登录后查看与领取 | 全部平台 |
| 手动录入 | 无公开 API 的平台，用户自行查看后录入 | 豆包、Kimi、Cursor 等 |
| 账单导入 | 预留，CSV 导入用量 | 后续版本 |

明确不做：模拟登录、破解私有接口、自动点击签到、代领积分、上传/共享用户凭证。

## 桌面端 API 代理（Tauri）

`desktop/src-tauri/src/lib.rs` 注册了 `proxy_usage` 命令：

- **域名白名单**：仅允许 OpenAI、Anthropic 的官方用量端点，不接收任意 URL，防止被用作开放代理（SSRF）。
- **仅只读 GET**：发送 `Authorization: Bearer <Key>` 到官方域名，不做任何写操作、不执行领取。
- **不落盘凭证**：Key 仅内存传递，命令执行完即释放；不写日志、不持久化。
- 前端 `src/core/adapters.ts` 自动检测运行环境：桌面端走 `invoke('proxy_usage')`，Web 端走 `fetch`。

## 用量录入

- **手动录入**：用量与费用页点「手动添加记录」，填写账户、日期、Tokens、估算费用、模型。
- **CSV 导入**：支持表头 `date, account, inputTokens, outputTokens, cost, model`（兼容中文表头），按账户名称自动匹配已有账户；可下载模板。
- **额度录入**：看板卡片点刷新图标，填写总额度、已用、单位与重置日期，带实时进度预览。
- **数据备份**：顶栏「导出」保存 JSON（不含密钥）；「导入」可「合并」（按 id 去重、追加新账户）或「覆盖」（清空后恢复）。

## 安全说明

- 密钥密文与派生盐仅存浏览器 `localStorage`（Web）或应用沙盒（桌面/App）。
- 导出 JSON **自动剔除**密钥字段与保险箱校验位。
- 主密码遗忘无法恢复密钥——这是有意设计，避免密钥被弱口令保护。
- 生产部署请使用 HTTPS；本地开发使用 localhost。

## 已内置平台（14）

OpenAI、Anthropic Claude、Google Gemini、DeepSeek、通义千问、Moonshot Kimi、豆包/火山方舟、智谱 GLM、Cursor、GitHub Copilot、Midjourney、Perplexity、ElevenLabs、Figma AI。

平台目录在 `src/data/providers.ts` 与 `miniapp/utils/providers.js`，可自行扩展（仅需官方 URL，无需任何私有接口）。

---

**免责声明**：本工具仅提供个人信息管理功能，不替代任何平台的官方服务，不承诺获取任何平台奖励。使用时应遵守各平台服务条款。
