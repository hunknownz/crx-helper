# CRX Helper

一个基于 WXT 的浏览器扩展，用于一键导出当前页面的 HTML 快照，或导出可用于大模型分析的页面上下文（JSON + 精简 HTML）。

## 快速开始

- 前置环境：建议 Node.js 18+；已安装 `pnpm`（仓库使用 `pnpm@10.x`）。
- 克隆代码并进入目录：
  - 已克隆则跳过；或执行：`git clone <repo-url> && cd crx-helper`
- 安装依赖：`pnpm install`
- 启动开发：`pnpm dev`

启动后，WXT 会在项目根目录生成开发产物：`.output/chrome-mv3-dev`。

## 在浏览器中加载（开发模式）

以 Chrome/Edge 为例：
- 打开 `chrome://extensions`（扩展程序管理页）。
- 开启右上角“开发者模式”。
- 点击“加载已解压的扩展程序（Load unpacked）”，选择项目内的目录：`.output/chrome-mv3-dev`。
- 固定扩展图标后，点击图标即可在任意页面唤起工具箱。

提示：首次加载后如有代码变更，可在扩展管理页点击“刷新”来热更新。

## 构建发布

- 生产构建：`pnpm build`
- 构建产物会输出到 `.output/` 下（如 `chrome-mv3`）。可在扩展管理页选择对应目录进行“加载已解压”。

## 使用说明

- 点击扩展图标，会在页面右上角弹出工具箱：
  - “导出分析上下文（JSON + HTML）”：下载 `page_analysis.json` 与 `page_clean.html`。
  - “导出 HTML 快照”：下载当前页面完整 HTML 快照（含基本元信息注释）。
- 扩展已申请 `downloads` 权限，以确保使用浏览器下载器可靠保存文件。

## 目录结构（简要）

- `entrypoints/background.ts`：后台脚本，转发消息与触发下载。
- `entrypoints/content.ts`：内容脚本，注入工具箱、采集页面并导出数据。
- `wxt.config.ts`：WXT/Manifest 配置（名称、权限等）。
- `.output/`：WXT 的构建输出目录（开发/生产）。

## 其他

- 若无需 `pnpm`，也可用 npm/yarn：
  - 开发：`npm run dev` / `yarn dev`
  - 构建：`npm run build` / `yarn build`
- 若浏览器阻止多文件下载，请在地址栏右侧允许该站点下载或在扩展详情中授予所需权限。
