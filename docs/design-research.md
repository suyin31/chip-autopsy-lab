# Chip Autopsy Lab — 设计简报（Kiroween 2026 · Frankenstein）

> 调研日期 2026-11-18。截止 **2026-12-04 14:00 PST**。评审五项各 20%：影响力 / Kiro 技术运用 / **设计** / 创新 / **演示**（视频 <3 分钟）。另有 Best Demo 和 Best Student Project 加分奖，学生身份可以报。

## 结论先行
真正的对手不是 Exensio 这类企业级系统，而是 **tsmap**：免费、开源，浏览器里就能本地解析 STDF，功能有晶圆图、Pareto、发现项。功能上我们拉不开差距。能赢的地方只有三个：**先给结论的 AI“尸检报告”、图表之间联动的证据链、Apple 级的叙事与质感**。

## (a) 用户默认会有的 5 项（必须做）
1. **拖入就能解析**：支持 .stdf / .gz，不装软件。STDF-Viewer 和 tsmap 都是拖进来直接开。
2. **Bin 晶圆图**：HBIN/SBIN 可切换；悬停 die 显示 X/Y、bin、测试值；点图例可以隐藏某个 bin；支持缩放和平移。参考 STDF-Viewer、wafermap。
3. **堆叠晶圆图（Stacked map）**：把多片晶圆的失效叠在一起找热点。yieldWerx、Galaxy、SiliconDash 都把它当核心功能。
4. **Bin Pareto 和良率汇总**：按 lot / wafer / site 给出良率和复测数。
5. **参数分析**：直方图叠加上下限，统计表含 Cp/Cpk、均值、σ，再加一张参数热力晶圆图。这套是 Galaxy Examinator 的经典组合。

## (b) 我们能做得更好的 5 点
1. **先出结论**：首屏只给一句死因判定，比如“Edge-Ring 型失效，良率 82.4%，主要损失在 SBIN 7”，证据放在下面。传统工具的做法是把几十张图一次性堆给用户。
2. **点一句结论，对应的 die 就亮起来**：报告里每条判断都绑定一组 die 或一个区域。Exensio ASD 有自动签名分类，但只在企业版里，交互也不是这样做的。
3. **空间签名分类**：按 WM-811K 的 9 类（Center / Donut / Edge-Loc / Edge-Ring / Loc / Random / Scratch / Near-full / None）给出置信度，并附上常见成因，例如 Scratch 多来自机械搬运，Center 和 Edge-Ring 多与沉积、刻蚀有关。
4. **联动刷选**：在晶圆图上框选一片区域，Pareto 和直方图立刻只显示这片 die 的数据。wafermap 支持右键钻取，我们改成实时联动。
5. **⌘K 自然语言查询**：输入“Cpk<1.33 的测试”“只看 bin 7”“边缘 3 圈”就能跳转或筛选。对照的是小厂工程师现在的流程：Python 脚本 → Excel → matplotlib，每片晶圆都得重来一遍（见 LinkedIn 帖子）。

## (c) 具体交互模式（附出处）
| 模式 | 做法 | 出处 |
|---|---|---|
| 渐进披露 | 宏观（良率）→ 中观（bin / 区域）→ 微观（单 die），只在用户需要时展开 | Apple WWDC22《Design app experiences with charts》 |
| 拖动看数值 | 悬停或拖动时出一条竖线和数值浮层，不遮挡数据 | Apple Health / Stocks，Swift Charts 的 chartXSelection |
| 命令面板 | ⌘K，每行右侧显示快捷键，按上下文给出可用操作，最近用过的排前面 | Linear、Raycast（Enter 执行默认操作，⌘K 打开次级操作） |
| 空状态 | 按原因区分：首次使用 / 无结果 / 解析失败，各配一个明确的下一步，并附一个“加载示例 lot” | Vercel Geist Empty State |
| 层级靠亮度 | 不用阴影，靠 4–8% 白色叠加和极细描边分层，浮层加 20–32px 背景模糊 | Linear |
| 拖入区 | 整页都能接收文件；拖入时边框和网格微亮，文案写“Drop the body.” | — |
| 高频操作不加动画 | 键盘触发的操作不做动画，只给低频的“揭示”时刻做动效 | Emil Kowalski《You don't need animations》 |
| 图表克制 | 先突出数据本身；颜色不能是唯一的区分手段 | Apple HIG Charts |

## (d) 颜色、字体与动效
- **底色**：#0A0A0B（参照 Linear 的 #08090a），面板用 #111113，描边用 8% 白色。
- **主色只用一个**：取一种“福尔马林绿”，比如 #7CF2C1，用于选中状态和 AI 结论。万圣节元素只留一处：失效 / 死因用南瓜橙 #FF7A1A。全站不出现骷髅、蜘蛛网这类装饰。
- **Bin 配色**：Pass 用低饱和的灰绿；失效 bin 用 LCH 等亮度的分类色，做法同 Linear 的主题生成。参数热力图用 magma 这类感知均匀的色带，暗色背景下也自带“解剖台”的感觉。
- **字体**：标题用 Inter Display 或 SF Pro Display，字距 -0.02em，字重 510–590，不用粗体；数字一律用 Geist Mono 或 JetBrains Mono 并开 `tabular-nums`。
- **动效**：常规 UI 用 150–200ms ease-out；面板进出用弹簧动画（stiffness 高、轻微回弹）；整体时长不超过 400ms。

## (e) 适合放进演示视频的 5 个时刻
1. **探针扫描式加载**：文件拖进来后，die 按探针的步进顺序逐颗点亮（边解析边渲染），坏片在最后变成橙色。约 3 秒，整个产品只放这一次。
2. **死因卡片**：AI 结论逐字出现，例如“Cause of death: Edge-Ring, 置信度 0.91”。点一下，边缘 3 圈 die 依次闪亮，对应的 Pareto 柱同时高亮。
3. **25 片晶圆叠成一张**：晶圆画廊收拢，叠成一张堆叠热图，热点自己浮出来。
4. **⌘K 一句话**：输入“show edge failures with Cpk < 1.33”，三张图同时切换到结果。
5. **前后对比**：左边是 Excel + matplotlib 花 2 小时，右边 10 秒出报告，收尾画面只放一行字。
- 可选彩蛋：按住 Option 出现“验尸灯”放大镜（借 SpookBnB 的 mask-image 手电筒效果），默认关闭，不影响专业感。

## 往届获奖作品的启示（Kiroween 2025）
- **第 1 名 InteractionKit**：痛点真实，而且用一张表讲清楚 Kiro 的每个功能各自起了什么作用。
- **第 2 名 UnitSet**：Kiro 用得深，有 21 份 spec、15 份 steering、9 个 hook、4 个 MCP，并全部写进了提交说明。
- **第 3 名 SpookBnB**：整个作品只押一个强概念（“暗色模式真的变暗”），动效打磨得很细。
- **Best Resurrection Faxi**：真实用户群加上评委能直接上手试的入口。
- **对我们的建议**：在线 Demo 里内置示例 STDF；提交说明里放一张 Kiro 用法表；视频前 15 秒把问题讲清楚。
- 未核实：2025 年 Best Frankenstein 的得主没查到。

## 风险与注意事项
- WM-811K 是通过 / 失效图像，不是 STDF。演示用的 STDF 需要自己合成（可以用 Semi-ATE 或 pystdf 写），并且要带上可复现的 Edge-Ring 和 Scratch 图案。
- 参赛作品必须是新代码；如果引用 wafermap（MIT 协议），要在说明里披露。

## 来源
- yieldWerx：https://www.hologenix.com/sites/default/files/PDFs/Yieldwerx.pdf ；https://yieldwerx.com/blog/outlier-detection-for-quality-improvement-in-semiconductor-testing/
- PDF Solutions Exensio：https://www.pdf.com/products/advanced-insights-for-manufacturing ；https://www.pdf.com/products/exensio-analytics-platform/modules/manufacturing-analytics/exensio-npi/products-exensio-analytics-platform-modules-manufacturing-analytics-exensio-npi-yield-engineer
- Galaxy Examinator：https://www.galaxysemi.com/products/examinatorpro ；https://www.yumpu.com/en/document/view/10032733/read-data-sheet-galaxy-semiconductor
- Synopsys SiliconDash：https://www.synopsys.com/content/dam/synopsys/solutions/slm/datasheets/silicondashds.pdf
- Onto Discover Yield：https://ontoinnovation.com/products/discover-yield-software
- STDF-Viewer：https://github.com/noonchen/STDF-Viewer
- tsmap / wafermap：https://wafertools.github.io/ ；https://github.com/wafertools/wafermap
- WM-811K：https://www.kaggle.com/datasets/qingyi/wm811k-wafer-map ；https://www.mdpi.com/2076-3417/11/20/9769
- 工程师痛点：https://www.linkedin.com/posts/sai-vihari-8353b832a_semiconductors-yieldengineering-stdf-activity-7462384201313554432-JnAF ；https://www.yieldhub.com/blogs/dealing-with-large-stdf-data-sets-then-and-now
- Linear：https://linear.app/now/how-we-redesigned-the-linear-ui ；https://akash-m.com/blogs/2026-10-linear
- Vercel Geist：https://vercel.com/geist/colors ；https://vercel.com/geist/empty-state ；https://vercel.com/geist/typography
- Apple：https://developer.apple.com/design/human-interface-guidelines/charting-data ；https://developer.apple.com/videos/play/wwdc2022/110342 ；https://developer.apple.com/videos/play/wwdc2023/10037/
- Raycast / 动效：https://www.raycast.com/blog/a-fresh-look-and-feel ；https://emilkowal.ski/ui/you-dont-need-animations
- Kiroween：https://kiroween.devpost.com/rules ；https://kiroween-2025.devpost.com/project-gallery ；https://devpost.com/software/kiro-interactionkit ；https://devpost.com/software/unitset ；https://devpost.com/software/spookbnb-when-dark-mode-gets-truly-dark ；https://devpost.com/software/faxi-16iecy
