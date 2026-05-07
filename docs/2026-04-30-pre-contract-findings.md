# 签合同前的实测发现与决策清单

> **首版**：2026-04-30
> **最近更新**：2026-05-02（Protocol B 突破 + 项目身份订正）
> **关联**：[`protocol-th900.md`](protocol-th900.md) · [`protocol-spec-analysis.md`](protocol-spec-analysis.md) · [`protocol-cl-pc3.md`](protocol-cl-pc3.md) · [`research/01..05-*.md`](research/)

---

## 0. 项目身份（订正版）

只有两个主体：
- **甲方 = Benny**（个人买了两台打卡机，找 DuoCode 做配套软件，不是经销商角色）
- **乙方 = DuoCode Technology**（IT 服务）

设备里 `enrollid=1 name="Ben"` 就是 Benny 自己的指纹。`requirements/考勤软件方案.pdf` 是 Benny 自己写的需求清单。**没有第三方"最终客户"**。

---

## 1. 一页式状态总览

| 维度 | 状态 |
|------|------|
| 设备厂家身份 | ✅ Shenzhen Union Timmy Technology — TFS30 / CL-PC3 大概率同 OEM 链 |
| 第一台 TFS30 协议 | ✅ 100% 闭环（官方 v2.1 协议规范 28 cmd + 实测 7 cmd 验证）|
| 第二台 CL-PC3 协议 | 🟡 baseline 通了（14 cmd 收 ACK），深 reverse 拉真实数据进行中 |
| 数据样本 | ✅ TFS30 老格式 .DAT 100% 解出 |
| 业务模型 | ✅ prototype/types.ts + domain.ts 覆盖方案 PDF 全字段 |
| 自动判班 | ✅ prototype 已实现含 simulator UI |
| 合同范围 | 🔴 **必须确认**：v1 是否包含 CL-PC3 写操作？影响价格工期 |
| 网线下载条款（N1） | 🟡 Benny 自己定 |

**结论**：协议层 95% 通；剩下 1 项必须问 Benny 才能签合同（**合同范围**）。

---

## 2. 协议层完整状态

### 2.1 第一台 TFS30 — ✅ 100% 闭环

| 项 | 值 |
|----|-----|
| 厂家 | Shenzhen Union Timmy Technology Co., Ltd. |
| 联系 | `info@timyteco.net` / `danielso@sztimmy.com.cn` / +86-755-83875070 |
| 设备 SN | ZYTI25116685 |
| 协议 | WebSocket /pub/chat over TCP **7788**，纯 JSON，无认证 |
| 规范文档 | [Timmy WebSocket Protocol v2.1](../vendor-resources/timmy/protocol-spec/) — 31 页官方文档，28 cmd 完整字典 |
| 实测验证 | 7 个核心 cmd（reg / sendlog / getnewlog / getalllog / getuserinfo / getuserlist / opendoor） |
| 写操作 cmd | 文档完整给出（setuserinfo / deleteuser / settime / setdevinfo / cleanuser 等），未实测 |

### 2.2 第二台 CL-PC3 — 🟡 baseline 通 + 深 reverse 中

| 项 | 值 |
|----|-----|
| 实物贴牌 | Click CL-PC3（Click Marketing Sdn Bhd 自家品牌）|
| OEM 推断 | **大概率仍是 Timmy**（Click CL-AI* 与 Timmy TM-AI* 是 1:1 rebrand），但走老 Click Protocol B 协议族 |
| 制造日期 | 2024-10-12（比 TFS30 早一年） |
| 固件 | A102G1S1K051Wcs v1.13 |
| 协议 | **Protocol B over TCP 5005**，二进制，PC 主动连 |
| 帧格式 | PC→Dev 16B `55 AA <MID> 79 19 <cmd> <arg2:4> <arg1:2> <chk:2>`；Dev→PC 10B `AA 55 <MID> <flags:4> <chk:2>` |
| 实测验证 | **14 个 cmd 全部收 ACK**（魔数对 + chksum 对，但 flags 字段固定 `10 00 00 00` 表示设备未真正执行）|
| 真实数据 | ❌ 还没拿到（继续 reverse） |
| Telnet 23 | OPEN（buildroot Linux login，弱密码未试）|

### 2.3 关键 trap（实施时绕开）

1. **`enrollid=0` 的 sendlog 不是员工 0** — 是门 / 设备事件（开门/关门/非法/拆机告警），TMS 必须路由到独立 `door_events` 表
2. **`mode` 字段在 WebSocket vs U盘 .DAT 编码不同**：WebSocket 1=fp，老 .DAT 8=fp
3. **`Server approval = Yes` 时设备未连 server 拒绝打卡** — TMS server 必须 always-on
4. **指纹模板长度** ≤1620 字符（THbio3.0）/ ≤1024 字符（THbio1.0）

---

## 3. 实测能力 vs 方案 PDF 对照

| 方案 PDF 要求 | 数据来源 | 状态 |
|-------------|---------|------|
| 员工编号 = 设备 enrollid | TFS30 getuserlist；CL-PC3 reverse 中 | TFS30 ✅ / CL-PC3 🟡 |
| 员工资料 14 项 | TMS 自管 | ✅ |
| 班次 7 天独立 + 灵活工时/午饭/迟到优惠 | TMS 自管 | ✅ |
| 自动编排班次 | domain.ts:249 + UI simulator | ✅ |
| 假期 / 部门 / 请假 / 补签卡 | TMS 自管 | ✅ |
| 6 类报表 | TMS 计算 + 设备打卡 | ✅ |
| **WiFi 下载** | TFS30 WS push + getnewlog；CL-PC3 Protocol B baseline | ✅ TFS30 / 🟡 CL-PC3 |
| **U 盘下载** | 老固件 ZoucqGENLOGData 已解出 | ✅ |
| 网线下载 | TFS30 无 RJ45；**CL-PC3 有 RJ45**（实测照片确认）| 🟡 改条款分机型 |
| 验证方式 | TFS30 指纹+卡+密码；CL-PC3 人脸+指纹+卡+密码 | ✅（互补覆盖）|
| 软件登录权限 | TMS 自管 | ✅ |

---

## 4. 真正还要 Benny 做的事（精简到 4 项）

### 🔴 P0：合同范围确认（影响定价）

v1 想包含 **CL-PC3 写操作**（增删人脸到设备）吗？

- **方案 A（保守）**：v1 = 两台机器**只读**（拉打卡 + 实时同步 + 报表）→ 95% 把握能交付，工期更短
- **方案 B（完整）**：v1 = 含 CL-PC3 写操作（后台批量管员工 / 写人脸到设备）→ 60% 把握，需要先 reverse 通；工期 +1-2 周

强烈建议方案 A 起步，写操作作为 v2 评估。

### 🟡 P1：N1 网线下载条款（CL-PC3 有网口，分机型表述）

实测照片确认：
- **TFS30（WE-68 PLUS）**：仅 5V 电源孔，**无 RJ45**
- **CL-PC3**：12V 供电 + **RJ45 + USB-A + Reset**

所以"网线下载"对 CL-PC3 可行，对 TFS30 不可行。建议条款写成"按机型支持"，避免一刀切错杀 CL-PC3。

旧版 P1：N1 网线下载（已合并到上面）

PDF 方案写"U盘+WiFi+网线"，但两台设备**都没 RJ45 网口**。

- 改成 "WiFi 实时同步 + U盘离线下载" 双通道
- 或者 Benny 自己说"网线"指的就是局域网
- **Benny 自己定即可**

### 🟡 P1：5 分钟内能给我们的 3 件小事

让 Benny 顺手做（每件 1 分钟）：

1. **CL-PC3 屏幕 `MENU → System Info → Capacity` 那一页拍照** — 看当前注册了几个人脸 / 几个用户
2. **CL-PC3 的 root / Telnet 密码他知道吗** — 设备开了 Telnet 23，弱密码我们能猜，但他直接告诉最快
3. **USB 2.0 U盘** — 验证新固件 .DAT 格式（设备不支持 3.0）

### ⚪ 已不需要再问 / 已不阻塞

- ~~M5 新版 CLICK 软件~~ → Protocol B baseline 已通，不依赖
- ~~M2 厂家联系方式~~ → 已自挖 Timmy
- ~~N3 人脸识别~~ → CL-PC3 解决
- ~~N4 自动判班~~ → prototype 已实现

---

## 5. 合同建议条款

### 5.1 设备能力分工

> 本合同覆盖两台设备：
> - **TFS30（WE-68 PLUS）**：指纹 + ID 卡 + 密码
> - **CL-PC3**：人脸 + 指纹 + 卡 + 密码
> 两台机统一接入 TMS server，员工资料一次维护，设备分工记录。

### 5.2 设备下载方式（改写网线下载）

> 系统支持以下下载通道：
> - **WiFi 实时同步**（主通道）
> - **U盘离线下载**（备份通道）
>
> 客户机型不带 RJ45 以太网口；如未来采购支持网线机型，作为升级项另行报价。

### 5.3 v1 范围声明（重要）

> v1 范围：两台设备的**读取功能** — 实时打卡同步、历史日志、用户列表、报表。
> CL-PC3 的**写操作能力**（后台批量管员工、写人脸到设备、远程开门）作为 v2 评估，根据 reverse 进度另行规划。

### 5.4 自动编排班次

> 自动编排按"打卡时间最接近哪个班次开始时间"原则归类（已实现于 prototype）。

---

## 6. 实测可证据库

| 能力 | 证据 |
|------|------|
| TFS30 WebSocket 7788 接收 | `tools/protocol-reverse-engineering/captured/2026-04-30-handshake-trace.log` |
| TFS30 实时打卡 push | sendlog 帧 enrollid=2 mode=1 inout=0 |
| TFS30 拉用户 + 指纹模板 | getuserinfo enrollid=1 → name="Ben" + 600 字节模板 |
| TFS30 远程开门 | opendoor result=true |
| TFS30 U盘 .DAT | research/04 — 3099 条 100% 解出 |
| **CL-PC3 Protocol B 基线** | clpc3-protocol-b-probe.py + clpc3-data-probe.py — **14 cmd 全部 ACK** |
| Timmy 官方 v2.1 协议规范 | vendor-resources/timmy/protocol-spec/ |

---

## 7. 行动顺序

### 立即（今明天）
- [ ] **派 subagent 深 reverse CL-PC3**（反编 ocx 95 method + 试 ACK 后 follow-up + 试 Telnet 弱密码）
- [ ] 给 Benny 一段 WhatsApp（合同范围 + 3 件小事）

### Benny 答复后（本周）
- [ ] 修订合同条款（按 §5）
- [ ] 签合同
- [ ] 启动 v1：fork prototype 加 `device-adapter/`，跑两个 adapter（TFS30 WS + CL-PC3 Protocol B）

### 永远不做
- 不实施 cleanuser / cleanlog / initsys / reboot 等危险 cmd
- 不依赖 LMT 老软件 / Master Key（与新协议无关）
