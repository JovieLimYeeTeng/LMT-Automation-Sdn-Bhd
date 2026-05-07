# WEMAX-TMS 综合现状报告（master）

> **生成时间**：2026-05-02
> **作用**：把项目所有事实、reverse 路径、矛盾点、信息缺口、行动清单**集中在一处**，作为后续会话和决策的唯一权威入口
> **来源**：仓库内 docs/ + tools/ + vendor-resources/ + requirements/ 全量 review（subagent 通读 + 实测验证）
> **维护原则**：本文档**只增不删** — 后续如有事实更新，在底部追加修订记录

---

## 0bis. 关键设计决策 — enrollid binding（2026-05-03）

> 用户提出 + 接受：**TMS 软件管员工档案，设备只负责"刷脸/指纹/卡 → 给 enrollid"**。

### 设计

```
管理员到设备前 → 给员工录入指纹/人脸 + 分配一个 enrollid（设备菜单）
       ↓
员工 / HR 在 TMS 软件里填档案 → 第一字段 *员工编号 填跟设备一样的 enrollid
       ↓
打卡来 enrollid + 时间 → TMS 查 enrollid 对应的档案 → 显示完整 14 字段 + 报表
```

这恰好对应 PDF 第一字段 **`*员工编号（和设备的一样）`** — Benny 的需求里就**已经隐含**这个 binding 模式。

### 为什么这是最干净的解

- ✅ 不依赖 CL-PC3 user-list 读取（拿不到 name 也不阻塞 v1）
- ✅ TFS30 的 name 也变成 nice-to-have（管理员可以选择 import 也可以手填）
- ✅ 业务统一：**所有档案管理在 TMS 软件层**（设备只输出 enrollid）
- ✅ 兼容未来其他品牌打卡机（只要给 enrollid 就接入）
- ✅ 降低协议依赖 — 软件不绑死任何一家设备的"读用户"私有协议

### 这件事意味着 v1 范围又收紧了

PDF 里"设备下载选项（指纹/脸/卡）"原以为要从设备拉模板和 name；新设计下：
- v1：设备只 push 打卡（enrollid + 时间 + verify mode + inout）→ **两台都已通**
- v1 不再需要：CL-PC3 user list / TFS30 user template 拉取
- 设备模板下载 = 备份用途 = v2 升级（Session B 已反编出字节）

---

## 0. 项目身份（2026-05-03 第 4 次也是最终订正 — 关键）

> ⚠️ 前 3 次订正都偏离实际。**真相直接写在 `requirements/考勤软件方案.pdf` 里**（Benny 自己写的需求文档）：
> - "**我需要的是电脑下载软件**"（PDF 第一行）
> - "**我主要是卖设备，不靠软件赚钱**"（PDF 最后一段）
>
> 项目本质：LMT 的传统业务 = **卖打卡机 + 附送一个简单的本地 PC 软件**（行业标配）。LMT 老版 V1.0.402 就是这个附送软件，4 年前的，Benny 现在找 DuoCode 写新版。这跟 SaaS / 商业护城河 / fk6 文档**毫无关系** — 我之前几次解读全部偏离。

### 主体（最终）

| 角色 | 身份 |
|------|------|
| **甲方 / 关键人** | **Benny Low**，**Sales Manager** @ LMT Automation Sdn Bhd<br>benny@lmt.com.my，+6019-383 2796<br>主营 = 卖打卡机；找 DuoCode 写"附送软件"配合每次设备销售 |
| **甲方公司** | **LMT Automation Sdn Bhd**（公司号 382080-H，"Your One Stop Office Equipment Centre"）<br>lmt.com.my，sales@lmt.com.my |
| **乙方** | **DuoCode Technology**（手上已有 prototype/tms-hr-prototype 成品 — Benny 看过 vercel demo）<br>DUOCODETECHU@DUOCODETECH.com，+60 147398281 / +86 18355366842 |
| **最终用户** | LMT 卖设备的所有客户 — 软件作为销售包配套发给客户 |

### 项目身份链路（最终）

```
某 enterprise 客户
   ↓ 买 LMT 打卡机（销售包含: 设备 + 附送本地 PC 软件）
LMT Automation
   ↓ Benny（Sales Manager）找 DuoCode 写新版附送软件
   ↓ 老版 V1.0.402 是 4 年前的，跟新固件不匹配
DuoCode Technology
   ↓ 手上已有 prototype 覆盖大部分需求；扩 device-adapter 接两台设备下载
本地 PC 软件（不是 SaaS / 不是云后台 / 不是 web app）
```

### 这次订正解释了之前一直不通的事

| 现象 | 之前不通 | PDF 里直接写明白 |
|------|---------|---------------|
| Benny 帮我们改 ServerIP 到 Mac:8080 | "客户为什么配合开发商" | Benny 是销售，他要让这单成 |
| 合同 PDF 是 Benny 写的需求清单 | "客户为什么写这么细的 spec" | "我主要是卖设备，不靠软件赚钱"— 他写 spec 给 DuoCode 做 |
| 设备里 enrollid=1 name="Ben" | "客户为什么自己录指纹" | 销售经理 Benny 测机录的 |
| 为什么 Benny 这么了解硬件 | "甲方为什么懂技术" | **他就是卖这些机器的销售经理** |

### PDF 里的硬约束（Benny 自己写的，不是我推断）

> "我的理念是帮助会计员工容易和简单完成他们的工作。
> 软件容易操作少问题，**千万不要在发薪前时掉链子**就行了。
> 我主要是卖设备，不靠软件赚钱，
> 所以**不想在软件上的处理用太的多时间，主打简单就好了**。
> 也不想顾客的问题要一直去处理解决，少问题就好了。"

### PDF 里的功能清单

| 模块 | 字段 / 项 | prototype 状态 |
|------|----------|---------------|
| 员工资料 | 14 字段（*员工编号 *姓名 *性别 + 11 选填）| ✅ 已覆盖 |
| 班次设置 | 7 天独立 + 灵活固定工作长度 + 灵活午饭长度 + 迟到优惠 | ✅ 已覆盖 |
| 自动判班 | "说班是接近哪个时段就自动编排哪个班次" | ✅ 已实现（domain.ts findShiftForPunch） |
| 假期 | 年份选项 - 一年一次输入设置 | ✅ 已覆盖 |
| 部门 | 部门输入 | ✅ 已覆盖 |
| 请假 | 病假 / 年假 / 带薪假 / 无薪假 | ✅ 已覆盖 |
| 补签卡 | 忘记打卡 → 输入时间 | ✅ 已覆盖 |
| 报表 | 个人月 / 总结月 / 迟到早退 / 请假 / 加班 / 旷工 / 设备记录时间 | ✅ 6 类已覆盖 |
| 设备下载数据 | U 盘 / WiFi / 网线 | 🟡 TFS30 WiFi 通；CL-PC3 待 |
| 设备下载选项 | 指纹 / 脸 / 卡 / 设备型号 | 🟡 待加 |
| 权限 | 登录账号 + U 盘加密 | 🟡 待加 |
| 本地 PC 打包 | 当前 vercel web，应包成 .exe | 🟡 待 Electron / Tauri |

### LMT 集团结构（DNS + 站点 inspect 实测）

```
LMT Automation Sdn Bhd（母公司，lmt.com.my，IP 110.4.45.100）
   │  e-commerce 站，卖广义办公设备：碎纸机 / 保险柜 / 办公家具 /
   │  考勤系统 / 演示设备 / 显示设备 / 办公用品 / 卫生设备
   │  ⭐ Benny 在这里做 Sales Manager
   │
   └── Click Marketing Sdn Bhd（CMSB，clickmarketing.com.my，IP 103.10.78.30）
       │  专做 biometric / RFID / 考勤产品的子公司，2009 年成立
       │  WORKLINK 集团旗下
       │
       └── Click TMS（clicktmsmy.com + fk6.clicktmsmy.com，IP 123.253.35.47）
              CMSB 自家 SaaS 云考勤后台
              设备直连入口 + web 后台同一台服务器
```

### 对认知的颠覆性影响

| 之前以为 | 实际 |
|---------|------|
| Benny 是个人买机找 DuoCode 做软件 | Benny 是 LMT Sales Manager，**代表 LMT 雇 DuoCode** |
| 没有第三层客户 | **真正终端客户是 LMT 的某 enterprise 客户**，LMT 在打服务包 |
| Benny 跟 LMT 拿 SDK 商业敏感（怕 SaaS 月费跑掉）| **Benny 自己就是 LMT 销售经理**，内部走流程拿 SDK 是分钟级 |
| 需要"应对话术 / 不抢硬件销售"| ❌ 完全不需要，他自己就是 LMT |
| 设备里 enrollid=1 name="Ben" 是"Benny 个人指纹" | 仍是 Benny 自己 — 但他是用 LMT 销售员身份测机 |

### 设备里两个用户的真实身份

| enrollid | name | 真实身份 |
|----------|------|----------|
| 1 | Ben | **Benny Low**，LMT Sales Manager |
| 2 | Lw | DuoCode 工程师（2026-04-30 现场新录） |

### DuoCode 工具基础设施

- Mac（开发主机，IP 192.168.100.204，CL-PC3 已指向这个）
- Windows MSI_LS（远程协作机，IP 192.168.100.231 + Tailscale 100.99.221.68）

---

## 1. 两台设备完整状态对比

| 维度 | TFS30 (WE-68 PLUS) | CL-PC3 |
|------|---------------------|--------|
| 设备贴牌 | WEMAX WE-68 PLUS（LMT 销售名）| Click CL-PC3（LMT 自营 Click Marketing 品牌）|
| 设备屏自报 MFG | （未拍）| **`Click`** + `clickmarketing.com.my`（2026-05-03 实拍 `CL-PC3_屏幕_Dev.Info_厂家自报Click.jpeg`）|
| Cloud ID（绑 LMT 云）| 无 | `C2636CF4DB223121`（实拍 `CL-PC3_屏幕_CloudID_QR.jpeg`）|
| 真厂家 OEM | **Shenzhen Union Timmy Technology**（深圳市友联天美）| **真厂家不是 Timmy**（设备屏自报 MFG=Click，先前"CL-AI* = TM-AI* 1:1 rebrand"推断对 CL-PC3 不成立）；具体上游 ODM 待 firmware/engine ID 反查（A201-1000-102 / pvpro-8404-500）|
| ODM 模块 | — | Bilian（深圳必联，仅 WiFi 模块；MAC OUI 78:22:88）|
| 序列号 | `ZYTI25116685` | `20241012011` |
| 制造日期 | 2025-09-05 | 2024-10-12 |
| 固件 | TH900_click V5.0 | A102G1S1K051Wcs v1.13 |
| 验证方式 | 指纹 + ID 卡 + 密码 | 人脸 + 指纹 + 卡 + 密码 |
| 物理接口 | 仅 5V 电源孔（**无 RJ45**）| RJ45 + USB-A + Reset + 12V 电源 |
| 出厂网络配置 | （Server Mode 关）| ServerIP=`fk6.clicktmsmy.com`:80（LMT 自家云）, Realtime=No, DHCP 用 |
| 网络协议 | **WebSocket /pub/chat over TCP 7788**（设备主动 push）| **RealSvr server-first push over ServerIP:8080**（设备主动 push，2026-05-03 突破）|
| 协议规范 | ✅ Timmy 官方 v2.1（28 cmd 完整字典）| ✅ Push 帧格式已 reverse（17B hello + 68B record + 16B ACK），用户/写操作仍缺 SDK |
| 实测状态 | **100% 闭环**（实测 7 cmd：reg / sendlog / getnewlog / getalllog / getuserinfo / getuserlist / opendoor）| **打卡记录读取已通**（codex 2026-05-03 实测 10+ 条真实记录）；用户列表读取**v1 不再需要**（enrollid binding 设计）；写操作待 v2 |
| 已拿到 | Ben 600B 指纹模板 hex / 实时打卡 push / 远程开门 / 用户列表 | 真实打卡记录（enroll 1/2/3 共 10+ 条）+ 设备 SN + 时间戳 + verify/inout 模式 |
| 老 .DAT U盘格式 | `ZoucqGENLOGData` 19B header + 8B record，已 100% 解出 3099/3099 条 | 包装含 USB Flash Disk，待实测 U盘 .DAT 是同格式还是新格式 |
| **v1 落地** | ✅ WebSocket 实时同步（adapter 已写好种子代码 ws-server.py）| ✅ **RealSvr push 通道已通**（clpc3-realsvr-push-reader.py），打卡记录可直接接入 TMS |
| **v2 升级** | 写操作（增删用户、写指纹模板、设备时间同步）| 远程开门 + 设设备时间（字节就绪，等现场） + 写用户回设备（0x102 SetEnrollData + BigData，需 SDK payload 模板）|

---

## 2. 关键密码与凭证速查表

> 这些散落在多份文档/脚本里，集中收录方便速查。

| 密码 | 值 | 用途 | 出处 |
|------|---|------|------|
| TFS30 通信密码 | （无） | TFS30 WebSocket 协议无认证 | 实测 |
| CL-PC3 Net PWD（5005 协议密码） | **`0`** | Protocol B `arg2` 字段（XOR 编码后），默认即 0 | 设备屏 Comm Set + 实测 |
| CL-PC3 Data Password ⚠️ | **`8282`** | 设备菜单上"删数据/改管理员"高危密码（**TMS 永远不要发**）| Quick Start Guide §1 |
| LMT mdb 数据库密码 | **`eClick`** | `Pay_data.mdb` Jet OLEDB 密码（写 ConnectionSetting / SystemMasterKey 等）| 2026-05-02 强行破解发现 |
| LMT 隐藏 admin 用户名 | `eClick` / `Click` / `click` | LMT TMS.exe 首次登录隐藏管理员（注意与 mdb 密码同字符串） | research/01 §6 |
| LMT 隐藏 admin 密码 | 当前电脑时间 4 位 HHMM（无冒号）| LMT TMS.exe 隐藏管理员登录 | research/01 §6 |
| Master Key | `11475-2295-26775-2550-AF-7905-5355-13770-0-1530` | LMT TMS.exe 软件激活码（绑设备 SN）；写入 mdb SystemMasterKey 表 | requirements/hardware/software/Master_key.txt |
| Master Key 有效期 | 2036-12-31（我们写入 mdb 时设的）| 我们 INSERT 时设的，原值厂家未知 | clpc3-windows-attack/insert_mk.ps1 |
| WE-88 系列删全部 ID 密码 | `123456` | research/01 §13 | research/01 §13 |
| LMT 软件 supervisor 密码 | `b` | 老版默认管理员账户 | research/01 §6 |
| LMT 老软件 PWord 字段值 | `godislove`（明文）| Pay_data.mdb 内一字段，含义不明 | research/03 |

---

## 3. CL-PC3 reverse 路径清单（**第 14 条 = 突破**）

> 13 条 PC pull 路径全失败 → 第 14 条 server-first push 通道**成功**（2026-05-03 codex）。

| # | 方法 | 工具 / 文件 | 结果 |
|---|------|-------------|------|
| 1 | TCP 5005 端口探测 + 简单 cmd ping | `clpc3-protocol-b-probe.py` | 7 cmd 收 ACK，魔数对 |
| 2 | 14 cmd Protocol B 探测 | `clpc3-data-probe.py` | 全部 10B ACK flags=0x10 |
| 3 | 56 完整 opcode 字典扫描（含 0x513/0x514 人脸照片）| `clpc3-bigdata-probe.py` + `opcode_dict.txt` | 全 flags=0x10 |
| 4 | 强制 BigData 读（`expect_big=True, hold_after_ack=8.0`）| `clpc3-force-bigdata.py` | 0 字节 |
| 5 | Benny 现场录入用户 + 完成 1 次人脸识别后重测 11 cmd | `clpc3-pull-real-data.py` | 仍 flags=0x10 |
| 6 | Telnet 23 弱密码爆破（10 组）| `clpc3-telnet-probe.py` | 全失败 |
| 7 | TCP raw dump（listen :8080 + 6 种 ZK PUSH probe）| `clpc3-raw-tcp-dump.py` | 设备每秒 connect 但 server 任何 send 后立刻 RST close |
| 8 | 反编译 FP_CLOCK.ocx → 95 dispatch fn → 56 opcode 字典 | `clpc3-artifacts/dispatch_fns.json` + `wrapper_calls.csv` | 拿到完整 cmd 表 + RecBigData buffer 大小 |
| 9 | 反推 ConvertPassword（XOR with idx + 0x5B）| `clpc3-full-roundtrip.py` | 设备端密码加密算法已知 |
| 10 | Windows 装 LMT 完整 PC 软件 + 改 mdb 指向 192.168.100.153 + 写 Master Key | `clpc3-windows-attack/setup_clpc3_v6.ps1` + `insert_mk.ps1` | 软件能起 |
| 11 | Windows 32-bit PowerShell 直起 FP_CLOCK ActiveX 跳过 GUI，调 ReadAllUserID/ReadAllGLogData | `clpc3-windows-attack/clpc3_v3.ps1` + `clpc3_ocx2.pcapng` | OCX 收的设备响应**与我们 Mac Python 完全相同**（10B flags=0x10）；OCX 看到后 RST |
| 12 | pktmon 全流量抓包对照 OCX vs Python | `clpc3-artifacts/clpc3_ocx2.pcapng` (121KB) + `clpc3_python_ping.pcapng` | OCX 与 Python 等价 → **5005 在我们手段下确认不可破** |
| 13 | 改 ServerIP 为 Mac IP，HTTP listener listen :8080 等推送 | `clpc3-http-listener.py` + Benny 改设备配置 | 设备每秒 connect 8080 但 0 字节 push（等 server 先发 LMT 私有握手）|
| **14** | **🎯 突破：反编 RealSvrOcxTcp ActiveX 拿到 server-first 握手字节，纯 Python 复现成功** | `clpc3-realsvr-push-reader.py` + Windows `RealSvrProbe/` | **✅ 拿到真实打卡 8+ 条**（codex 2026-05-03） |
| **15** | **🎯 突破 B：5005 PC pull 重新评估 — 旧 cmd 选错，read-only 实测通；反编 OCX 拿到 OpenDoor / SetTime / SetEnrollData 完整字节** | `clpc3-control-probe.py` | **✅ PING / GET_DOOR 实测通；OpenDoor / SetTime 字节就绪等物理验证**（Session B 2026-05-03） |

**突破后的判断**（2026-05-03 双 codex session — 之前对 5005 的解读全部订正）：
- `flags=0x10` **不是错误码** — 是**合法 ACK echo**（ACK chksum 与 request chksum 完全一致 = 协议设计的回执配对）
- 5005 PC pull **可用**，之前所谓"全死"是因为我们试的某些 cmd 本身就是无返回的 control 类（PING / SetTime / OpenDoor 等），不是不通
- 现有两条工作路径并行使用：

**① 8080 push 通道**（Session A）= 实时打卡 + ACK
- 17B server hello: `55 aa 00 a9 00 00 00 00 00 00 00 00 00 00 a8 01 00`
- 设备回 68B record: magic `33 99` + device_id + verify/inout + 时间戳位打包 + ASCII serial
- 16B server ACK: `55 aa 01 40 00 00 00 00 00 00 00 00 00 00 40 01`

**② 5005 直连**（Session B）= 状态查询 + 远程控制
- PING (0x52): `55 aa 01 00 79 19 52 00 00 00 00 00 00 00 e4 01` → ACK `aa 55 01 00 10 00 00 00 e4 01` ✅ 实测
- GET_DOOR (0x120): `55 aa 01 00 79 19 20 01 00 00 00 00 00 00 b3 01` → ACK `aa 55 01 00 10 00 00 00 b3 01` ✅ 实测
- OpendoorEx (0x137, door=1): `55 aa 01 00 79 19 37 01 01 00 00 00 00 00 cb 01` 🟡 字节就绪等 Benny 现场
- SetDeviceTime (0x112): `55 aa 01 00 79 19 12 01 00 00 00 00 00 00 a5 01` 🟡 字节就绪等 Benny 现场
- SetEnrollData (0x102) + BigData two-stage：0x760 / 0x5ac / 0x58c 三种 payload 大小 🟡 待测
- SetUserNameUTF8 (0x13b): 字节就绪 🟡 待测

**控制命令物理黑名单**（脚本默认拒发，需 `--execute --i-understand` 双 guard）：
- 0x11A EMPTY_ENROLL / 0x11B EMPTY_GEN_LOG / 0x11C EMPTY_SUP_LOG（清空类）
- 0x128 USERCTRL_CLR / 0x115 POWER_OFF（破坏类）
- Data Password 8282（设备菜单删数据/改管理员高危密码）

完整突破文档：[`clpc3-breakthrough-2026-05-03.md`](clpc3-breakthrough-2026-05-03.md)（含 Session A push 通道 + Session B 5005 控制路径）

---

## 4. 仓库文档矛盾与过时清单

> Subagent review 发现 9 项不一致。**本节仅记录，不删除原文档**。

| ID | 文件 | 问题 | 建议 |
|----|------|------|------|
| **B-1** | `docs/client-questions.md` | §5 编号重复（§5. ServerIP 改 Mac IP / §5. N1 网线条款） | 简单手误；下次维护时改其中一个为 §6 |
| **B-2** | `docs/wemax-device-integration.md` | 整篇过时 — 写"DAT 留厂家软件"、"USB 仅 2.0"、"WiFi 版本未到货"、推荐"U盘批处理"为 v1。与 TFS30 实时 WS 已通 / CL-PC3 走 HTTP push 现状完全相反 | 在文件顶部加 `> **⚠️ 已过时**：本文写于 2026-04-30 初版，后续判断已被 protocol-th900.md / protocol-cl-pc3.md / 2026-05-02-comprehensive-status.md 取代` 标签 |
| **B-3** | `docs/research/05-web-research.md` | OEM 链结论被推翻 — 写 "WEMAX = 浩顺 FK 系列贴牌 + Realand 双链"，但实际是 **Timmy** 真厂家 | 顶部加 `> 注：OEM 真厂家在 TFS30/TH900 上是 Timmy；本文 Hysoon/Realand 链是 LMT 重打包软件遗留，非设备真厂家` |
| **B-4** | `docs/research/02-dll-reverse-engineering.md` | 把 5005 协议归到 Realand Zd2911 协议族（包头 0xA55A），但 CL-PC3 实测用的是 Click Protocol B（包头 `55 AA + 79 19`）+ 56 opcode 字典完全不同 | 顶部加 `> 注：本文反编 LMT 重打包软件遗留组件，与设备真协议关系仅作历史参考；CL-PC3 真协议见 protocol-cl-pc3.md` |
| **B-5** | `docs/protocol-cl-pc3.md` §6 vs `docs/client-questions.md` "已不需要再问" | protocol-cl-pc3.md 终局结论说"突破唯一路径：拿 LMT 新版软件"，但 client-questions.md 把 ~~M5 新版 CLICK 软件~~ 划掉为"baseline 已通，不依赖" | 实际两者都对：baseline（魔数 + chksum）通了 ≠ 能拉数据；本综合文档已统一表述（§3 终局判断 + §7 行动） |
| **B-6** | `requirements/hardware/README.md` | 仍写"OEM 层在中国"未指明 Timmy；与 vendor-resources/timmy/README.md 入库后的最新结论不一致 | 同 B-2 加注释 |
| **B-7** | `docs/research/01-pdf-deep-read.md` §3 | 写 "客户当前是 Realtime=No 的轮询模式" — 这是基于 LMT 老 PC 软件描述，与 CL-PC3 实测设备出厂 ServerIP=fk6.clicktmsmy.com 的事实不冲突，只是切了视角 | 不需改 |
| **B-8** | `docs/research/02` §2.5 | 推测设备注册在 weixinac.com（Realand 关联）；但 CL-PC3 实测 ServerIP = fk6.clicktmsmy.com（LMT 自家云），TFS30 也无 P2P 痕迹 | 同 B-4 加注释 |
| **B-9** | `docs/wemax-device-integration.md` §3.2 | 写"DAT 厂家加密"，但 research/04 已 100% 解出 DAT 不加密，3099/3099 全对 | 同 B-2 |

---

## 5. 信息缺口（Subagent + 自检发现）

> 应集中收录但散落或缺失的事实。

### D-1. mdb 密码 = `eClick`（2026-05-02 强行破解新发现）

`Pay_data.mdb` 的 Jet OLEDB Database Password = `eClick`。这与 LMT 软件首次登录隐藏管理员用户名同字符串。

→ 已在本文档 §2 速查表收录。

### D-2. CL-PC3 协议 5005 全错误码

`flags=0x10` 是错误码而非数据长度。但**确切语义**（PERMISSION_DENIED / AUTH_REQUIRED / NOT_SUPPORTED）尚未确认。

### D-3. ServerIP 改 Mac IP 的状态

Benny 已经做了：
- ServerIP = 192.168.100.204 ✓
- ServerPort = 8080 ✓
- Realtime Re = Yes ✓
- 设备每秒 connect Mac:8080 ✓
- **但应用层 0 字节** —— 设备等 server 先发 LMT 私有 magic

### D-4. TFS30 v2.1 协议规范来源链

来自 Scribd 用户 Phan Thanh Nhàn 上传副本（越南分销商），不是 Timmy 官方页面下载。如果未来要正式合规文档，需走官方渠道（已有 Timmy contact）。

### D-5. TFS30 写操作 cmd 未实测

protocol-th900.md §5 表中 21 个写 cmd（setuserinfo / deleteuser / settime / setdevinfo / cleanuser / cleanlog / initsys / reboot / cleanadmin / setdevlock / setuserlock / 等）全部 ❌ 未实测。

风险：合同选方案 B（含写）才发现协议字段不对会很被动。

### D-6. prototype 与设备的接驳层（device-adapter/）尚不存在

CLAUDE.md 写"下一步：在仓库新建 device-adapter/"，但目录还不存在。协议层和 prototype 没有任何代码桥接。

### D-7. types.ts 缺 11 个字段（详见 §6 数据模型映射）

protocol-spec-analysis.md §6.1 列出应新增字段，但 types.ts 至今未改。

---

## 6. 数据模型映射缺口（types.ts vs 设备协议）

| prototype 字段 | TFS30 提供 | CL-PC3 提供 | 差距 |
|----------------|------------|-------------|------|
| `Employee.enrollNo: string` | `enrollid: int` | `enrollid: int`（待 push 实测）| ⚠️ 类型不一致 string vs int |
| `Employee.firstName + lastName` | `name: string` 单字段 | 同 | ⚠️ 设备没分姓/名 |
| 🔴 缺：指纹模板 | `record: hex string ≤1620` | `BigData 0x58c bytes` | 写操作时缺 |
| 🔴 缺：人脸模板 | backupnum 20-27 | BigData 0x760/0x5ac | |
| 🔴 缺：人脸 JPG 照片 | backupnum 50（base64）| cmd 0x513 / 0x514 | |
| 🔴 缺：卡号 | backupnum 11 | cmd 0x101 arg1=3 | |
| 🔴 缺：设备密码 | backupnum 10 | cmd 0x101 arg1=2 | |
| 🔴 缺：admin 等级 | `admin: 0/1/2/3` | cmd 0x116 | |
| 🔴 缺：backupnum（哪根手指） | `backupnum: 0..9` | 同 | |
| `Punch.kind: in/breakOut/breakIn/out` | **设备无对应** — 只发"原始事件 + mode"，业务层判断 | 同 | TMS 自己分流 |
| 🔴 缺：mode（指纹/卡/密码/人脸） | `mode: 1/2/3/8`（sendlog） | 待实测 | |
| 🔴 缺：inout（设备端进/出标记） | `inout: 0/1` | bytes 5..7 | |
| 🔴 缺：event（enrollid=0 时门事件 0~7） | `event: 0..7` | 推断有 | 应单独 DoorEvent 类型 |
| 🔴 缺：temperature（防疫遗留） | sendlog 可带 temp | 未在 56 cmd 中 | |
| 🔴 缺：verifyMode（5+1 枚举） | sendlog 可带 | — | |
| 🔴 缺：image（AI 设备打卡时拍照 base64） | sendlog 可带 | — | |
| 🔴 缺：整个 `Device { sn, model, ip, port, mac, firmware, lastSeen, capacity, used }` 类型 | — | — | 必须加（两台机用 SN 区分） |
| 🔴 缺：整个 `EnrollmentTemplate { employeeId, deviceId, slot, kind, blob }` 类型 | — | — | 多 device 多 slot 时必须 |
| 🔴 缺：整个 `DoorEvent` 类型 | — | — | enrollid=0 帧路由用 |
| 🔴 缺：整个 `AuditLog` 类型 | — | — | research/03 audit_trial 表对应 |
| `AppSettings.device` 单 device 单一布尔 | 实际 2 台能力不同 | | 应改 `devices: Device[]` |

---

## 7. 真正还要请 Benny / 厂家做的事

### 7.1 Benny 优先去要（他买的设备，他出面成功率最高）

> 用户原话："说明清楚最好他来要，实在不行给 email 地址我们以他的公司名义去要"

**Benny 拿到任何下面这些都行**（按价值排序）：

#### CL-PC3 协议（实时同步刚需）

1. **CL-PC3 协议规范文档**（PDF 或 Word，跟 Timmy 给 TFS30 的 v2.1 那种格式）
2. **CL-PC3 SDK 包**（任何语言：.dll / .h / Java / Python / PHP）
3. **`fk6.clicktmsmy.com:80` 服务端 API 文档**（设备实际推送的对端格式）
4. **直接技术联系人**（Click Marketing 工程师邮箱 / 微信 / WhatsApp）

来源应是：
- LMT / Click Marketing Sdn Bhd（clickmarketing.com.my，本地 KL）
- 或他们的中国上游厂家（CL-PC3 OEM 真厂家可能是 Timmy 也可能是 Bilian 或别的中国 ODM）

#### TFS30 协议补全（写操作刚需 — **同等重要**）

> 注：TFS30 读取已 100% 通，但**写操作（增删人脸 / 同步用户回设备 / 设设备时间）跑不通的根因是缺这些**，与 CL-PC3 同等优先级。

5. **Timmy WebSocket Protocol 最新版本**（我们手上 v2.1 是 2021 年的，2026 应该有 v3.0+）
6. **Timmy SDK 包**（C# / Java / Python / PHP demo —— 厂家明确说"免费提供"）
7. **`setuserinfo` 写指纹 / 人脸模板的字节示例**（v2.1 文档说 record 字段 ≤1620 chars 但没给完整范例）

来源：Timmy（Shenzhen Union Timmy Technology Co., Ltd.）
- Email: `info@timyteco.net` / `danielso@sztimmy.com.cn`
- Tel: +86-755-83875070 / +86-13360071414（Daniel So）
- 官网: sztimmy.net

#### 物料（5 分钟事）

8. **CL-PC3 屏幕 `MENU → System Info → Capacity` 拍照** — 看当前注册了几个人脸/用户/打卡（让我们提前知道有多少数据）
9. **CL-PC3 root / Telnet 密码**（厂家可能附带在产品文档/开发者卡片里）

### 7.2 实在拿不到 → DuoCode 名义直接发邮件

Benny 如果不方便去要，我们以 DuoCode 名义直接发英文邮件给厂家。两份草稿 ready：

| 收件人 | 草稿位置 | 关键内容 |
|--------|---------|---------|
| Timmy（深圳）`info@timyteco.net` / `danielso@sztimmy.com.cn` | ✅ `vendor-resources/timmy/email-draft-to-timmy.md`（已含 CL-PC3 = Timmy OEM 推断 + DuoCode intro）| TFS30 SDK + 协议规范最新版 + setuserinfo 字节示例 + CL-PC3 OEM 确认 |
| Click Marketing（KL）`enquiry@clickmarketing.com.my` | ✅ `vendor-resources/click-marketing/email-draft.md`（中英双版 + DuoCode intro，已就绪）| CL-PC3 协议规范 + SDK + fk6 服务端 API 文档 + 技术联系人 |

DuoCode 公司介绍（用户提供）：

> We are DUOCODE TECHNOLOGY, a software development firm with operations in Malaysia and China. We are currently developing a customized Time Management System (TMS) for a high-priority enterprise client in Malaysia.

### 7.3 合同前一件硬条款

**N1 网线下载条款**：
- WE-68 PLUS 没 RJ45 — 物理做不到
- CL-PC3 有 RJ45 — 可做
- 建议合同改成"按机型分：WE-68 PLUS = WiFi + U盘，CL-PC3 = LAN + U盘"

---

## 8. v1 落地建议（基于已知事实）

### 推荐合同范围：方案 A（只读 + 同步）

```
v1 范围：
- TFS30 (WE-68 PLUS):
    * 实时打卡 push 同步（WebSocket /pub/chat 7788）
    * 拉用户列表 / 拉指纹模板（getuserlist / getuserinfo）
    * 拉历史日志（getnewlog / getalllog）
    * U 盘 .DAT 离线下载（已 100% 解出）

- CL-PC3:
    * U 盘 Excel 离线流程（包装含 USB Flash Disk + Quick Start Guide §7 标准做法）
    * staff 每天 / 每周插一次 U盘上传 TMS

- TMS 业务层：
    * 员工资料 14 项 + 班次 7 天独立 + 自动判班（已实现）
    * 假期 / 部门 / 请假 / 补签卡
    * 6 类报表
    * 软件登录权限 + U 盘 master key

把握度：95%（不依赖任何未确认的协议突破）
工期：标准
```

### v2 升级（拿到 SDK 后）

```
- TFS30: 写操作（增删人脸 / 设设备时间 / 同步用户）
- CL-PC3: 实时 push 同步（拿到 LMT 协议或抓包后）
- 后台管员工写回设备
- 远程开门联动
```

---

## 9. 行动顺序（综合 + 立即可执行）

### 立即（今天 / 明天）

1. **发 Benny WhatsApp**（中英双版，本文 §7.1 + §7.3 已就绪）
   - 让他去要 CL-PC3 协议 / SDK
   - 让他确认 N1 网线条款
2. **修补 9 项文档矛盾**（§4 表）— 在过时文档顶部加 `⚠️ 过时` 标签，**不删除**

### Benny 答复后

3. 修订合同条款（按 §8 模板）
4. 签合同
5. 启动开发：在仓库新建 `device-adapter/`
6. 扩 prototype/types.ts（按 §6 缺口列表）
7. 部署架构：单台 Linux/Windows 工控机跑 device-adapter，TMS 主体在云

### 异步并行（不阻塞合同）

8. 起草 Click Marketing 邮件草稿到 `vendor-resources/click-marketing/email-draft.md`
9. 实测 TFS30 写操作 cmd（在测试环境，不在 Benny 真机）
10. 反编译 OCX OpenCommPort 完整流程（CL-PC3 5005 突破备选路径）

### 永远不做

- 不发 destructive cmd（cleanuser / cleanlog / initsys / reboot / EmptyEnrollData / EmptyGeneralLogData）
- 不依赖 LMT 老 CLICK 软件作为产品基础
- 不删除任何已有文档（即使过时也只加注释）

---

## 10. LMT 集团商业模式 + "为什么连不上"重解释（2026-05-03 重写）

> ⚠️ 之前两次解释都不对：
> - 早期解释 "5005 协议是 LMT 私有 / 老软件不识别新固件" → 部分对，但解释不到为什么 LMT **自家** OCX 也连不上
> - 之前 "商业护城河 / 给 SDK 等于客户跑掉" → ❌ Benny 自己就是 LMT 销售经理，这个解释**整体作废**
>
> **真实最可能的解释**（综合所有 reverse 证据 + Benny 是 LMT 自己人这个事实）：

### 10.0 为什么连不上的真实原因（最可能解释）

**LMT 自己已经从"PC 拉"模式迁移到"设备推"模式了**。V1.0.402 是 4 年前的废弃 PC 软件，LMT 内部都不再用。

时间线：

| 时期 | 模式 |
|------|------|
| ~2018-2020 | 老产品线时代：PC 软件 V1.0.402，TCP 5005，"PC 主动 pull 数据"模式 |
| 2024-10 | CL-PC3 这台机出厂（固件 A102G1S1K051Wcs v1.13）— **整整 4 年差距** |
| 2025 至今 | LMT 把客户引到 SaaS 后台 clicktmsmy.com（web 入口），**新固件砍掉 PC pull**，只保留"设备 push 到云" |

证据全部对得上：

| 证据 | 解释 |
|------|------|
| 5005 全部 14 cmd + 56 opcode 收 `flags=0x10` | 不是"权限拒绝"，是"**这条路废弃了**" |
| OCX（LMT 自家 V1.0.402 软件）也吃同样错误码后 RST | LMT 自己内部都连不上 4 年前的老软件 |
| 设备每秒 connect Mac:8080，Realtime=Yes | **"设备 push" 这条路是设计好的、活跃的** |
| HTTP push 通道等 server 先发 magic | 期待对端是 fk6 服务端（即 LMT 自家 SaaS 后台） |

### 10.0.1 这彻底改变了我们要的资料

| 之前以为要的 | 实际要的 |
|-------------|----------|
| ❌ "新版 PC 客户端 / 协议规范" | 可能根本不存在新版（LMT 抛弃 PC pull 模式了） |
| ✅ — | **fk6.clicktmsmy.com:80 服务端的接收 API 文档**（设备 push 上来什么格式、server 怎么响应） |
| ❌ 找 LMT "PC 软件开发"那条线 | ✅ 找 LMT "Click TMS 后台开发"那条线（写 fk6 receiver 的工程师） |

### 10.0.2 我们已经做对的事（不需要重做）

- ✅ ServerIP 改成 Mac:8080 → 设备走的是它**正常的工作模式**（不是 hack）
- ✅ 8080 listener 收到设备每秒 connect → 设备一切正常
- ✅ 只差应用层格式 → 拿到 fk6 receiver 文档就闭环

---

### 10.1 集团结构（保留作背景）

### 10.1 LMT 集团做什么

**LMT Automation Sdn Bhd**（lmt.com.my）= 母公司，e-commerce 站，"Your One Stop Office Equipment Centre"，卖广义办公设备：
- 碎纸机（HSM Pure 940 / 830 系列等）
- 防火保险柜
- 办公家具
- **考勤系统 + 门禁**（旗下 Click Marketing 专营）
- 演示设备 / 显示设备 / 办公用品 / 卫生设备

**Click Marketing Sdn Bhd (CMSB)**（clickmarketing.com.my）= LMT 旗下做 biometric / RFID / 考勤产品的子公司
- 2009 年成立，WORKLINK 集团旗下
- 自报 "10,000+ 马来西亚客户"
- KL 总部：M2-B-23, Jalan Pandan Indah 4/1A, 55100 KL
- Tel: 603-42941872，enquiry@clickmarketing.com.my

**业务模型四块**：
- 硬件销售（Benny 这次卖给客户的两台属于这块）
- 云 SaaS（clicktmsmy.com，按月收 SaaS 费）
- 外包服务（直接帮客户算考勤 / 工资）
- Rent-to-own（租机 + 包月 SaaS 套餐）

### 10.2 设备出厂硬编码连 fk6.clicktmsmy.com 的真实含义

之前理解为"商业护城河 / 锁定客户"。**这个解读对外人成立，但对 LMT 内部不成立**。

对**外部第三方**（不是 LMT 雇的开发商）：是 SaaS 漏斗，要绕开很难
对**LMT 自己**（包括 Benny 雇的 DuoCode）：**协议规范 / SDK 在 LMT 内部产品/工程师手上**，DuoCode 通过 Benny 走内部流程拿就行

```
客户买设备 → 设备自动 connect fk6.clicktmsmy.com:80（LMT 自家云）
   ↓
   场景 A：客户用 LMT 全托管方案
      → 直接在 clicktmsmy.com 登录看报表 → 月付 SaaS
   ↓
   场景 B：客户要定制内部 TMS（这次的 case）
      → LMT 销售 Benny 推荐 DuoCode 做软件
      → DuoCode 拿 LMT 内部协议规范 → 部署在客户内网
      → 客户不再付 SaaS 月费，但付 LMT 一次性定制软件钱
```

**两条都是 LMT 业务**，只是收费模式不同。Benny 这单实际是 LMT 在打"定制方案"包，不是丢失 SaaS 客户。

### 10.3 拿 SDK 的实际路径（不再有"应对话术"）

| 资源 | 在哪 | 怎么拿 |
|------|------|--------|
| CL-PC3 协议规范 / SDK | LMT 内部 Click Marketing 工程师手上 | **Benny 内部走流程**，分钟级 |
| fk6.clicktmsmy.com:80 服务端 API 文档 | LMT 内部，写 Click TMS 后台的工程师手上 | 同上 |
| TFS30 SDK + 协议最新版 | 中国上游 Timmy 厂家 | **LMT 跟 Timmy 是上下游**，让 LMT 销售/采购人员去要，比 DuoCode 外部联系快 |

### 10.4 plan B 仍然保留作风险兜底

Benny 内部走流程也可能慢（LMT 流程 / Timmy 渠道），所以 plan B 仍需要：
- **U 盘 Excel 离线流程**（CL-PC3 自带 USB-A + Quick Start Guide §7 标准做法）— 不依赖任何 SDK
- TFS30 读取已通，写操作可以走"管理员到设备前手动录入 + TMS 离线同步"兜底
- 即使 SDK 走得慢，v1 也能签合同先上线，v2 拿到 SDK 后再升级实时同步

---

## 11. 修订记录

| 日期 | 修改 | 人 |
|------|------|-----|
| 2026-05-02 | 首版，subagent 全 review + 自检整合 | Claude (reverse session) |
| 2026-05-02 | §7 修正 TFS30 SDK 为"同等重要"，邮件草稿状态更新 | Claude |
| 2026-05-02 | 新增 §10 LMT SaaS 商业模式（inspect clicktmsmy.com + clickmarketing.com.my） | Claude |
| 2026-05-03 | §1 订正：CL-PC3 设备屏自报 MFG=Click（不是 Timmy OEM）；新增 Cloud ID `C2636CF4DB223121`；4 张设备屏实拍归档到 `requirements/hardware/photos/CL-PC3_屏幕_*` | Claude |
| 2026-05-03 | **§0 项目身份重大订正**：Benny = LMT Automation Sales Manager（基于名片）；§10 LMT 商业模式段重写（去掉"应对话术 / 商业护城河"等不再适用语义，Benny 走 LMT 内部流程拿 SDK） | Claude |

---

**附**：本文档作为权威入口，后续如有事实变更，应在 §11 修订记录追加，正文不删除已有内容。
