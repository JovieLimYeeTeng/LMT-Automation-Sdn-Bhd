# WEMAX-TMS / Project Context for Claude

> 给下一次会话的 Claude：先读这份。再按需要进入 `docs/` 看深度。

## 〇、关键设计决策 — enrollid binding（2026-05-03）

**TMS 软件管员工档案，设备只负责"刷脸/指纹/卡 → 给 enrollid"**。

```
管理员到设备前 → 录入员工指纹/人脸 + 分配 enrollid（设备菜单）
       ↓
员工 / HR 在 TMS 软件里填档案 → 第一字段 *员工编号 填跟设备一样的 enrollid
       ↓
打卡来 enrollid + 时间 → TMS 查 enrollid 对应档案 → 显示 14 字段 + 报表
```

这恰好对应 PDF 第一字段 `*员工编号（和设备的一样）` — Benny 的需求里**已经隐含**这个 binding 模式。

**v1 不再依赖**：CL-PC3 user list 读取 / TFS30 user template import / 设备模板拉取（这些归到 v2 备份场景）。

**v1 双机已闭环**：两台机的 enrollid + 时间 + verify/inout 都能实时 push 到 prototype，按 enrollid 关联软件档案 → 报表完整出。

---

## 一、项目身份（关键 — 2026-05-03 第 4 次也是最终订正）

> ⚠️ 前 3 次都没搞对。**真相直接写在 `requirements/考勤软件方案.pdf` 里**（Benny 自己写的需求文档）：
> - "**我需要的是电脑下载软件**"（第一行）
> - "**我主要是卖设备，不靠软件赚钱**"（最后一段）

### 项目本质

LMT 的传统业务模式 = **卖打卡机 + 附送一个简单的本地 PC 软件**（行业标配，客户买设备拿到 U 盘，里面有软件装到电脑用）。LMT 老版 V1.0.402 就是这个附送软件，4 年前的，Benny 现在找 DuoCode 做新版替代。

```
某 enterprise 客户
   ↓ 买 LMT 打卡机
LMT Automation（卖设备 + 附送本地 PC 软件）
   ↓ Benny Low（Sales Manager）找 DuoCode 写新版附送软件
DuoCode Technology（写本地 PC 软件，不是 SaaS / 不是云后台）
```

**主体**：
- **甲方 = Benny Low** @ LMT Automation Sdn Bhd（Sales Manager，benny@lmt.com.my，+6019-383 2796）
- **乙方 = DuoCode Technology**（DUOCODETECHU@DUOCODETECH.com，+60 147398281 / +86 18355366842）
- **最终用户** = LMT 卖设备的所有客户 — Benny 想要可重复使用的软件，每次卖设备都附送

**Benny 在 PDF 里说的硬约束**：
- "电脑下载软件"（不是 SaaS、不是云后台、不是 web app）
- "主打简单，不想在软件上的处理用太的多时间"
- "千万不要在发薪前时掉链子"
- "也不想顾客的问题要一直去处理解决，少问题就好了"
- "我主要是卖设备，不靠软件赚钱"

**软件功能（PDF 全部要求）**：
1. **员工资料**（14 字段，包括 *员工编号 *姓名 *性别）
2. **班次设置**（7 天独立 + 灵活固定工作长度 / 灵活午饭长度 / 迟到优惠）
3. **班次自动判断**（"说班是接近哪个时段就自动编排哪个班次"）
4. **普通规格**（假期 / 部门 / 请假 / 补签卡）
5. **6 类报表**（个人月报 / 总结月报 / 迟到早退 / 请假 / 加班 / 旷工 / 设备记录时间）
6. **设备下载数据**：U 盘 / WiFi / 网线 三种方式 + 设备下载选项（指纹 / 脸 / 卡 / 设备型号）
7. **权限**：要登录才能用 + 加密（如 U 盘权限才能开软件）

**DuoCode prototype/tms-hr-prototype 已覆盖**：
- ✅ 员工资料、班次、自动判班、假期 / 部门 / 请假 / 补签卡、6 类报表
- 🟡 缺：U 盘 / WiFi / 网线 数据导入接口（device-adapter）
- 🟡 缺：权限管理 + 加密
- 🟡 缺：本地 PC 打包（Electron / Tauri 包成 .exe？现在是 vercel web 版）

### 之前的所有"商业护城河 / SDK 谈判 / fk6 文档 / 应对话术"全部作废

之前我把这个简单需求看成复杂的 SaaS 商业谈判 — **错了**。这就是行业标配的"卖设备附送软件"模式，DuoCode 的事是把 prototype 包成本地 PC 软件 + 接好两台设备的下载接口。

## 二、Benny 买的两台机器

| 机器 | TFS30（在我们手上）| **CL-PC3**（在同事手上）|
|------|-----------------|---------------------|
| 实物贴牌 | WEMAX WE-68 PLUS | Click CL-PC3 |
| OEM 真厂家 | **Shenzhen Union Timmy Technology**（深圳市友联天美） | 大概率仍是 Timmy（Click CL-AI* 是 TM-AI* 1:1 rebrand），但走老 Click 协议族 |
| 序列号 | ZYTI25116685 | 20241012011 |
| 制造日期 | 2025-09-05 | **2024-10-12** |
| 固件 | TH900_click V5.0 | A102G1S1K051Wcs v1.13 |
| 验证方式 | 指纹 + ID 卡 + 密码 | 人脸 + 指纹 + 卡 + 密码 |
| 协议 | **WebSocket /pub/chat over 7788**（设备主动 push）| **Protocol B over 5005**（PC 主动连，二进制 55 AA 79 19 magic）|
| 协议状态 | ✅ 100% 闭环（28 cmd 官方文档全有 + 实测 7 cmd） | ⚠️ baseline 通了（14 cmd 收 ACK），还在 reverse 拉真实数据 |

## 三、核心协议事实（速查）

### TFS30 (WebSocket)

```
Endpoint:  ws://<server-ip>:7788/pub/chat   (设备主动连)
Auth:      无（LAN 信任）
Format:    JSON text frame
Cmd:       28 个完整字典在 vendor-resources/timmy/protocol-spec/
```

**坑**：`enrollid=0` 的 sendlog = 门事件不是员工 0；`mode` 字段 WebSocket vs U盘 .DAT 编码不同；`Server approval=Yes` 时 server 掉线全员无法打卡。

### CL-PC3 (Protocol B)

```
Endpoint:  tcp://<device-ip>:5005   (PC 主动连)
Auth:      Comm Password（XOR with idx + 0x5B 编码到 arg2 字段；默认 0）
Frame:     PC→Dev 16B「55 AA <MID> 79 19 <cmd> <arg2:4> <arg1:2> <chk:2>」
           Dev→PC 10B「AA 55 <MID> <flags:4> <chk:2>」
           BigData stream 还没破解
```

完整规范：[`docs/protocol-cl-pc3.md`](docs/protocol-cl-pc3.md)

### 完整文档索引（按重要性）

| 文档 | 何时看 |
|------|--------|
| [`docs/2026-04-30-pre-contract-findings.md`](docs/2026-04-30-pre-contract-findings.md) | 决策快照，要不要签 / 还要 Benny 做啥 |
| [`docs/protocol-th900.md`](docs/protocol-th900.md) | 写 TFS30 adapter 时必看 |
| [`docs/protocol-cl-pc3.md`](docs/protocol-cl-pc3.md) | 写 CL-PC3 adapter 时必看（reverse 进展） |
| [`docs/protocol-spec-analysis.md`](docs/protocol-spec-analysis.md) | Timmy 官方 28 cmd 字典 |
| [`docs/research/01..05-*.md`](docs/research/) | 5 份 reverse 子报告（PDF/DLL/MDB/DAT/Web） |
| [`vendor-resources/timmy/`](vendor-resources/timmy/) | Timmy 公开资料 + 官方 v2.1 协议规范 PDF |
| [`tools/protocol-reverse-engineering/`](tools/protocol-reverse-engineering/) | 实测脚本 + 真实握手 trace |

## 四、Prototype 状态

`prototype/tms-hr-prototype/` 是 React + TypeScript（Vite），数据模型 [`src/types.ts`](prototype/tms-hr-prototype/src/types.ts) 已覆盖方案 PDF 全字段；[`src/domain.ts`](prototype/tms-hr-prototype/src/domain.ts) 实现自动判班（规则在 i18n.ts:203）。

下一步：在仓库新建 `device-adapter/` 跑两个 adapter（TFS30 WS server + CL-PC3 Protocol B client），对内统一事件流接口。

## 五、合同前未决项（精简）

| ID | 内容 | 状态 |
|---|---|---|
| **N1** | "网线下载"条款（设备无网口） | 🟡 找 Benny 改条款（Benny 自己定，他想要就保留） |
| **CL-PC3 reverse** | 拉真实数据（Protocol B 第二步） | 🟡 baseline 通，深 reverse 进行中 |
| **合同范围** | v1 是否要 CL-PC3 **写操作**（增删人脸到设备）| 🔴 必须问 Benny 才能定价 |

不再阻塞的：
- ~~M5 新版 CLICK 软件~~ → baseline 通，不依赖
- ~~M2 厂家联系~~ → 已自挖 Timmy（`info@timyteco.net` / `danielso@sztimmy.com.cn` / +86-755-83875070）
- ~~N3 人脸~~ → 第二台机解决
- ~~N4 自动判班~~ → prototype 已实现

## 六、合作偏好

- **客户问题清单要节制** — 客户大多答不出技术细节，先吃透已有素材自己反推
- 对接路线：v1 不依赖 Windows DLL / 老 SDK / Master Key —— 全跨平台 Node/Python

## 七、远端

- GitHub: `https://github.com/DuoCode2/tms-hr-prototype.git`
- 仅一个分支：`redesign-balanced`（默认）
- visibility: **private**（含真实姓名 / 设备 SN / Master Key 等敏感数据，禁公开）
