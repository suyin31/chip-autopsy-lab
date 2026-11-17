# Chip Autopsy Lab — 开源参考与技术选型

> 调研时间：2026-11-18（星数 / License / 最后提交来自 GitHub API 当日查询）。
> 规则：只依赖 MIT / Apache-2.0 / BSD / ISC 代码；GPL/AGPL 项目只看思路、不抄代码、不当依赖。黑客松要求新代码——库作为依赖可以，业务代码（解析器、晶圆图、报告联动）必须自己写。

---

## 0. 结论（先看这个）

**推荐栈：Next.js（App Router）+ React + TypeScript + Tailwind v4 + shadcn/ui（Radix）+ cmdk + Motion + visx + 自研 Canvas2D 晶圆图 + 自研 TS STDF 解析器（Web Worker）**

理由：
1. **STDF 解析自己写 TS**：没有一个"可直接依赖、许可干净、维护中"的 JS STDF 库；唯一现成的 `@wafertools/testdata-parser` 是竞品 tsmap 的核心，依赖它等于给竞品打工、也削弱"新代码"原创性。STDF V4 是简单的二进制 TLV（REC_LEN/TYP/SUB），demo 只需 FAR/MIR/WIR/WRR/PIR/PRR/PTR/HBR/SBR/MRR 约 10 种记录，400–600 行 TS 搞定，放 Web Worker 不卡主线程。
2. **晶圆图自己画 Canvas2D**：~1万 die 是小数据，Canvas2D 一次 fillRect 循环 <5ms；deck.gl/PixiJS 是为百万级或游戏设计的，包大、学习成本高。要"AI 结论点亮 die"的光晕/脉冲，用一层叠加 canvas + CSS/Motion 即可。真要 WebGL 再上 regl（5.6k★, MIT，极小）。
3. **图表用 visx**：Pareto、直方图都是低层 D3 原语 + React，样式 100% 可控，能做到 Linear/Vercel 那种细线、tabular 数字、暗色渐变；ECharts 功能强但默认长相"企业 BI"，调到 premium 很费劲。
4. **Next.js 而不是纯 Vite**：AI 报告需要服务端代理 LLM key（Route Handler），一键部署 Vercel；页面本身全客户端渲染。
5. **shadcn/ui + Radix + cmdk + Motion + Sonner** 是 Linear/Vercel 风格的事实标准组合，全 MIT，copy-paste 进仓库=代码归我们、可改。

---

## 1. STDF 解析 / 写入

| 项目 | ★ | License | 最后提交 | 语言 | 评价 |
|---|---|---|---|---|---|
| [Semi-ATE/STDF](https://github.com/Semi-ATE/STDF)（PyPI `Semi-ATE-STDF` 0.1.28） | 76 | **MIT** | 2025-12-14 | Python | **读+写**都支持，V4 / V4-2007，大小端，ATDF。纯 Python，理论上可在 Pyodide 跑。**最适合用来生成 demo STDF 并交叉验证我们的 TS 解析器**。 |
| [cmars/pystdf](https://github.com/cmars/pystdf) | 186 | **GPL-2.0** ❌ | 2026-08-20 | Python | 最经典的读取器，但 GPL，不能当依赖；只可本地用作"对拍"校验工具。 |
| [noonchen/rust-stdf](https://github.com/noonchen/rust-stdf) | 37 | **MIT** | 2026-09-23 | Rust | 完整 V4/V4-2007 读取，可编 WASM。若自研 TS 解析器出问题的备胎（但引入 Rust 工具链，hackathon 不划算）。 |
| [noonchen/STDF-Viewer](https://github.com/noonchen/STDF-Viewer) | 223 | GPL-3.0 ❌ | 2026-10-10 | Python/Qt | 桌面 STDF 分析器，功能参考（trend/histogram/wafer/bin），不可抄代码。 |
| [jlazear/stupidf](https://github.com/jlazear/stupidf) | 7 | BSD-2 | 2025-04-09 | Rust | 快速解析，小众。 |
| [davidmathers/stdf-convert](https://github.com/davidmathers/stdf-convert) | 0 | MIT | 2026-10-13 | Rust | STDF→JSONL，可做 CLI 校验。 |
| [stephensonb/stdflib](https://github.com/stephensonb/stdflib) | 8 | MIT | 2020-04-20 | C# | 读写都有，已停更。 |
| npm `stdfjs`（[antiwinter/stdfjs](https://github.com/antiwinter/stdfjs)） | 5 | ISC | 2018-11-21 | JS | 唯一纯 JS 解析器，7 年没更新，只作结构参考。 |
| npm `stdf-parser` 2.0.2 | – | 无 license ❌ | 2024-11 | JS | 无许可证，不能用。 |
| npm `@wafertools/testdata-parser` 0.16.4（来自 [wafertools/tsmap](https://github.com/wafertools/tsmap)） | 4 | MIT | 2026-11-15 | Rust→WASM | **竞品 tsmap 的解析核心**。技术上可用，但不建议依赖（原创性 + 差异化）。 |
| [wafertools/wafermap](https://github.com/wafertools/wafermap)（npm `@wafertools/wafermap`） | 8 | MIT | 2026-11-13 | TS | 竞品的晶圆图组件，看它的交互（hover/zoom/bin 着色）找差异点。 |
| [uia4w/uia-wafermap](https://github.com/uia4w/uia-wafermap) | 78 | Apache-2.0 | 2024-08-02 | JS | 老牌 JS shot/wafer map，可参考坐标系与 notch 方向处理。 |

**合成 demo 数据方案**：
- 首选：**自写 TS `stdf-writer.ts`**（与解析器同一套记录定义，顺便做 round-trip 单测），生成"有故事"的晶圆：边缘环形失效、某象限 Vdd 漏电偏移、探针卡某 site 系统性 fail 等，好让 AI 报告"破案"。
- 交叉验证：用 Semi-ATE-STDF（MIT）在 Python 里读我们写出的文件，确保格式合法；可选再用 pystdf 本地对拍（只作工具，不进仓库依赖）。
- 生态里没有专门的"合成 STDF 生成器"开源项目——这本身是我们的一个新代码亮点。

---

## 2. 前端栈候选

| 类别 | 项目 | ★ | License | 最后提交 | 备注 |
|---|---|---|---|---|---|
| 框架 | [vercel/next.js](https://github.com/vercel/next.js) | 143.7k | MIT | 2026-11-18 | ✅ 选它（需 LLM 代理 + Vercel 部署） |
| 框架 | [sveltejs/kit](https://github.com/sveltejs/kit) | 20.9k | MIT | 2026-11-18 | 性能好，但 premium 组件生态（shadcn-svelte 9.3k★）明显弱于 React |
| CSS | [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) | 98.7k | MIT | 2026-11-17 | v4，CSS 变量主题 |
| 组件 | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | 128.4k | MIT | 2026-11-17 | ✅ 代码拷进仓库，可深改 |
| 原语 | [radix-ui/primitives](https://github.com/radix-ui/primitives) | 19.5k | MIT | 2026-10-15 | ✅ shadcn 底座，键盘/无障碍 |
| ⌘K | [dip/cmdk](https://github.com/dip/cmdk)（原 pacocoursey/cmdk） | 13.2k | MIT | 2025-10-29 | ✅ Raycast/Linear 风命令面板；跳到 die、切 bin、跑 AI |
| 动效 | [motiondivision/motion](https://github.com/motiondivision/motion) | 35.3k | MIT | 2026-11-17 | ✅ layout 动画、spring、`useReducedMotion` |
| 动效组件 | [magicuidesign/magicui](https://github.com/magicuidesign/magicui) | 23.3k | MIT | 2026-11-17 | 可挑 1–2 个（Number Ticker、Border Beam、Shine）用在 hero/良率数字 |
| 动效组件 | [ibelick/motion-primitives](https://github.com/ibelick/motion-primitives) | 7.0k | MIT | 2026-09-28 | Text Effect / Morphing Dialog，克制好用 |
| Toast | [emilkowalski/sonner](https://github.com/emilkowalski/sonner) | 13.2k | MIT | 2026-08-10 | ✅ |
| Drawer | [emilkowalski/vaul](https://github.com/emilkowalski/vaul) | 8.8k | MIT | 2025-10-04 | 移动端 die 详情抽屉（可选） |
| 字体 | [vercel/geist-font](https://github.com/vercel/geist-font) | 3.8k | **OFL-1.1** | 2026-11-06 | 字体许可，可自由嵌入使用（不是代码依赖） |
| Aceternity UI | ui.aceternity.com | – | 无公开仓库/许可不明 ⚠️ | – | 效果炫但偏"营销页"，许可不清，**不建议依赖**，只看灵感 |
| 图表 | [airbnb/visx](https://github.com/airbnb/visx) | 21.1k | MIT | 2026-06-22 | ✅ Pareto/直方图，完全可控 |
| 图表 | [observablehq/plot](https://github.com/observablehq/plot) | 5.4k | ISC | 2026-11-06 | 写起来最快，但 SVG 输出精修空间小于 visx；做快速探索/备胎 |
| 图表 | [leeoniya/uPlot](https://github.com/leeoniya/uPlot) | 10.7k | MIT | 2026-11-17 | 极快（Canvas），适合 10 万点 trend/散点；外观朴素需自绘 |
| 图表 | [apache/echarts](https://github.com/apache/echarts) | 67.7k | Apache-2.0 | 2026-10-13 | 功能全、包大、默认"企业感"；不推荐作主力 |
| WebGL | [visgl/deck.gl](https://github.com/visgl/deck.gl) | 14.8k | MIT | 2026-11-17 | 百万级点的地图层，10k die 杀鸡用牛刀 |
| WebGL | [regl-project/regl](https://github.com/regl-project/regl) | 5.6k | MIT | 2026-10-17 | 轻量 WebGL，若要 GPU 光晕/热力插值再用 |
| 2D 引擎 | [pixijs/pixijs](https://github.com/pixijs/pixijs) | 48.8k | MIT | 2026-11-17 | 适合大量 sprite + 滤镜；包较大，非必要 |
| 不可依赖 | [pyodide/pyodide](https://github.com/pyodide/pyodide) | 14.9k | **MPL-2.0** ⚠️ | 2026-11-17 | 若走"Python→WASM 解析"需它；MPL 非 MIT/Apache/BSD，且首屏要下 ~10MB，**不走这条路** |

**晶圆图实现要点（自研）**：die 坐标→网格（X/Y from PRR），单 canvas 画底图（按 HBIN/SBIN 或参数值着色），第二层 canvas 画选中/AI 高亮（描边 + 外发光 + 呼吸脉冲），hover 用坐标反算（O(1)），缩放用 `transform` 而不是重绘；DPR 适配；`OffscreenCanvas` 可选。

---

## 3. 值得抄"模式"的开源数据应用（只抄设计模式，代码按许可）

| 项目 | ★ / License | 抄哪个模式 |
|---|---|---|
| [langfuse/langfuse](https://github.com/langfuse/langfuse) | 37.5k / 混合（核心 MIT，ee 目录除外） | **Trace 视图：左树右详情 + 点击节点联动高亮**——直接对应"报告结论 ↔ 晶圆 die"双向联动 |
| [triggerdotdev/trigger.dev](https://github.com/triggerdotdev/trigger.dev) | 16.8k / Apache-2.0 | **Run 详情的时间线 + 可折叠 span + 暗色细边框面板**；状态色点 + 等宽数字 |
| [umami-software/umami](https://github.com/umami-software/umami) | 40.2k / MIT | **KPI 卡片行（大数字 + 环比小字）+ 下方单一主图**——良率/总 die/主失效 bin 顶栏 |
| [tremorlabs/template-dashboard-oss](https://github.com/tremorlabs/template-dashboard-oss) | 0.5k / Apache-2.0 | **BarList（带比例条的排行列表）**——Bin Pareto 的最佳轻量表达，比柱状图更"Linear" |
| [evidence-dev/evidence](https://github.com/evidence-dev/evidence) | 7.1k / MIT | **"叙述文本里嵌数字/图表"**——AI 尸检报告：段落内数字可点击，跳到对应图 |
| [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) | 16.7k / MIT | **侧边栏 + ⌘K 全局搜索 + 数据表（排序/筛选/分页）**的完整 shadcn 骨架，直接对照写 |
| [Kiranism/next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter) | 7.3k / MIT | Next.js App Router + shadcn 的目录结构、主题切换、图表卡片布局 |
| [openstatusHQ/openstatus](https://github.com/openstatusHQ/openstatus) | 9.3k / **AGPL** ❌ | 只看：**状态条形格（每格一天的 uptime tracker）**——可借鉴为"lot/wafer 良率格子条"；不可抄码 |

（midday、plausible、documenso 也很漂亮但都是 AGPL，只能看。）

---

## 4. Apple/Linear 级 UI 与动效教程（已打开核实）

1. **Emil Kowalski — Great Animations**（https://emilkowal.ski/ui/great-animations）
   - 动画用 `ease-out`、一般 <300ms；**键盘触发的高频操作（如 ⌘K）不要动画**。
   - 只动 `transform`/`opacity`；主线程忙时用 CSS/WAAPI；尊重 `prefers-reduced-motion`；动画要可中断。
2. **Rauno Freiberg — Invisible Details of Interaction Design**（https://rauno.me/craft/interaction-design）
   - **频率 × 新鲜度决定要不要动画**：每天用上百次的（命令面板、右键菜单）出现时不动画；
   - **空间一致性**：元素从哪里来就从哪里展开（die 详情从被点的 die 位置展开，而不是凭空弹窗）。
3. **Josh W. Comeau — Designing Beautiful Shadows in CSS**（https://www.joshwcomeau.com/css/designing-shadows/）
   - **多层叠加阴影**（1/2/4/8/16px 递增）比单层自然；全站统一光源比例；
   - **阴影色匹配背景色相**而不是纯黑——暗色 #0A0A0B 上用带冷色相的极淡阴影 + 半透明边框。
4. **Linear — How we redesigned the Linear UI (part Ⅱ)**（https://linear.app/now/how-we-redesigned-the-linear-ui）
   - 主题只用 **base / accent / contrast 三个变量，在 LCH 色彩空间**生成所有表面层级（背景/面板/弹窗）；
   - 降低 chrome 的彩色占比、靠对齐与层级而非装饰；标题用 Inter Display、正文 Inter。
5. **Vercel — Web Interface Guidelines**（https://vercel.com/design/guidelines）
   - 数字对比用 `tabular-nums` / Geist Mono；`<html>` 设 `color-scheme: dark` + `theme-color`；
   - 状态不只靠颜色（bin 色块旁加文字标签）；skeleton 与最终布局一致；状态写进 URL（选中 die/bin 可分享）；重计算放 Web Worker。
   - 附：可把它的 AGENTS.md 放进仓库让 AI 编码代理遵守。

---

## 5. 风险与待定
- `wafertools`（tsmap / wafermap / testdata-parser）在 2026-11 仍高频更新，是直接竞品；差异化要落在 **AI 尸检报告 + 结论↔die 联动 + 叙事型 demo 数据 + 质感**，而不是"能看晶圆图"。
- Semi-ATE-STDF 最后提交 2025-12，生成验证够用，但别依赖其冷门记录类型。
- Langfuse/PostHog 仓库含 ee 目录（非 MIT），只参考 UI 模式。
