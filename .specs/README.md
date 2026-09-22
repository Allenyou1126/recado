# .specs — 规格与决策档案

本目录存放 Recado 的设计阶段产物。**代码实现之前，这里是唯一的真源。**

---

## 文档清单

| 文件 | 内容 | 什么时候看 |
| --- | --- | --- |
| [`requirements.md`](./requirements.md) | 需求分析与功能规划：定位、领域模型、M1–M10 功能模块、非功能需求、技术架构、路线图、风险、验收标准 | 想知道「要做什么」 |
| [`decision-log.md`](./decision-log.md) | 需求确认记录：18 项问答全量归档，每项含结论与设计连带影响 | 想知道「为什么这么定」 |
| [`development-standards.md`](./development-standards.md) | 开发规范：分层架构、依赖注入、Context 层次、Result 错误处理、数据库与安全规范、前端规范、测试、Git 与评审清单 | 准备写代码 |
| [`research/waline-feature-inventory.md`](./research/waline-feature-inventory.md) | Waline 源码级功能盘点（711 行），含 19 项设计缺陷与源码证据 | 想对照参考产品 |
| [`research/tanstack-start-report.md`](./research/tanstack-start-report.md) | TanStack Start 能力实测报告（1708 行），含真实 dev + 生产构建验证 | 对框架行为有疑问 |

### 建议阅读顺序

1. `requirements.md` §1–§2 —— 搞清定位与已定决策
2. `decision-log.md` —— 补齐决策背后的取舍
3. `requirements.md` §5–§6 —— 领域模型与功能模块
4. `development-standards.md` —— 动手前过一遍
5. 研究资料 —— 按需查阅，不必通读

---

## 文档状态

| 阶段 | 状态 |
| --- | --- |
| 需求分析 | ✅ 完成，18 项疑问全部关闭 |
| 开发规范 | ✅ 完成 v1.0 |
| 技术设计 | ⬜ 未开始 |
| 实现 | ⬜ 未开始 |

---

## 两份研究资料的性质

它们是一次性研究产物，**归档时保留原始内容未作修改**，仅在开头补了「归档说明」更正路径信息。

研究期间使用的上游源码克隆（共约 93 MB）与临时数据已在仓库整理时删除。
每份报告的开头都写明了重建命令或重建要点，结论层面无需重建即可采信——
正文每条判断都标注了证据来源（源码 / 运行时实测 / 文档 / 未核实）。

### 这两个报告为什么值得留

它们推翻或修正了若干**凭直觉会做错**的判断，例如：

- TanStack Start 的 Server Function **无法被第三方站点调用**（四重阻断，运行时实测），
  公开 API 必须用 Server Route
- 框架**没有任何内置 CORS 支持**，且 dev 与生产的预检行为不一致
- 未匹配的 HTTP 方法返回 `200 text/html` 而非 405
- Waline 只存渲染后的 HTML、原文不落库，导致解析器修复后无法重渲染
- Waline 的管理台 JWT 永不过期且不可吊销，签名密钥还会静默回退到数据库密码

这些结论直接决定了本项目的架构，删除证据链会让后来者重复踩坑。

---

## 维护约定

- 需求或决策发生变更时，**同步更新 `requirements.md` 与 `decision-log.md`**，不要只改一处。
- 新的决策追加到 `decision-log.md`，编号顺延（当前到 `Q-18`）。
- `requirements.md` 中的 `Q-xx` 引用一律指向 `decision-log.md`，不指向外部。
- 开发规范是可执行的约定，若实践中发现某条不合理，**改规范而不是默默违反**。
