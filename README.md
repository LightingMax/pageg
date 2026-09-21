# Pageg

本地 PDF 阅读器。架构和 [Codeg](https://github.com/xintaofei/codeg) 对齐：**Rust 核心 + Tauri 2 壳 + React/pdf.js 界面**。

它不自己托管模型。Rust 侧拉起 Codex / Claude / Gemini 的真实 CLI，在 stdio 上走 Agent Client Protocol。PDF 负责读，AI 只在你点「翻译 / 解释 / 提问」时才出场。

## 为什么是 Rust + Tauri，而不是把 PDF 也用 Rust 画

Codeg 也是这样分层的：

- **Rust**：进程生命周期、ACP JSON-RPC、本地 vault、通知、文件对话框
- **Webview UI**：pdf.js 做选区和文本层。这一层继续用 JS，是因为划线/翻译依赖浏览器文本层，硬用 Rust 光栅化 PDF 会把交互做差

高性能用在该用的地方：agent 子进程和磁盘，不是每一帧 canvas。

## 本机怎么跑

Windows 需要：

1. Rust (`rustup`, MSVC toolchain)
2. Visual Studio 2022 Build Tools，勾选 **Desktop development with C++**
3. Node.js 22+
4. WebView2（Win10/11 一般已带）

```bash
cd pageg
npm install
npm run tauri dev
```

第一次编译 Rust 依赖会比较久。打开一本 PDF → 右侧 AI 面板点「连接 Agent」→ 划线后点翻译或解释。

## 仓库结构

```
src/                 React + pdf.js
src-tauri/src/acp.rs ACP 客户端（spawn / initialize / session / prompt）
src-tauri/src/vault.rs 每本书的 Markdown 笔记
skills/              注入到书本 vault 里的阅读技能
```
