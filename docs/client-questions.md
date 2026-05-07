# 还要请 Benny 做的事

> **项目身份**：DuoCode（乙方 IT 服务）↔ Benny（甲方）；只有这两个主体
> **状态**：协议层基本闭环（TFS30 100% / CL-PC3 baseline 通），合同前剩 4 项
> **维护**：每问到一项，移到底部"已收到 ✅"

---

## 🔴 P0 — 阻塞合同的（1 项）

### 1. 合同范围确认

v1 是否要包含 **CL-PC3 写操作**（后台批量管员工 / 写人脸到设备 / 远程开门）？

| 选项 | 范围 | 工期 | 把握 |
|------|------|------|------|
| **A 保守** | 两台机**只读** + 实时同步 + 报表 | 标准 | 95% |
| **B 完整** | 含 CL-PC3 写操作 | +1-2 周 | 60%（需先 reverse 通）|

**强烈推荐 A**，B 留作 v2 评估。

询问话术：
> "v1 想做'读取+同步'还是含'后台管员工写人脸到设备'？读取版本工期标准、把握 95%；写入版本要先逆向多 1-2 周。建议先签读取版，写入作 v2 评估。"

---

## 🟡 P1 — 5 分钟能给的 3 件小事

### 2. CL-PC3 屏幕 Capacity 截图

进 `MENU → System Info → Capacity` 那一页拍照发我们 — 看当前注册了几个人脸 / 几个指纹 / 几个用户 / 几条打卡日志。

**用途**：让我们提前知道有多少数据要拉。

### 3. CL-PC3 的 root / Telnet 密码

设备 TCP 23 (Telnet) 是开的，登录是 `buildroot login:`（标准 buildroot Linux）。Benny 买机时厂家可能附带 root 密码（在产品文档 / 开发者卡片里）。

**用途**：拿到密码 = 跳过所有 reverse，直接 root shell 看 firmware，CL-PC3 协议 1 小时全解。

### 4. ~~USB 2.0 U盘~~（已自动解决）

CL-PC3 包装清单（Quick Start Guide §8）含 `USB Flash Disk × 1` —— Benny 买机时**已经配套发了**。如果他没用过那个 U 盘，直接给我们就行。

### 5. ServerIP 改成 Mac IP（让 CL-PC3 真实数据 push 给我们）

CL-PC3 出厂 ServerIP = `fk6.clicktmsmy.com:80`（LMT 云）。我们破解 5005 控制端口拿不到 BigData，是因为**真实数据走 HTTP push 到 ServerIP**。

让 Benny 改设备 `MENU → Comm/Network`：
- ServerIP → `<我们 Mac IP>`（每次 Mac IP 可能变，要先确认）
- ServerPort → `8080`（macOS 80 需 root，8080 不需要）
- 保存（ESC → SAVE）

我方起 HTTP listener `tools/protocol-reverse-engineering/clpc3-http-listener.py`，几秒内能看到设备 push 真实用户/打卡/人脸数据。

**风险提示**：改完后 LMT 云端就收不到这台 CL-PC3 的实时数据了。Benny 自己甲方，可决定（TFS30 同理已经改成 push 我们 7788）。

### 5. N1 网线下载条款

PDF 方案写 "U盘+WiFi+网线"，但两台设备都没 RJ45。Benny 自己定：

- 删掉"网线"，改成 "WiFi+U盘" 双通道（建议）
- 或者 Benny 解释下"网线"指的是不是局域网 WiFi

---

## ⚪ 已不需要再问

| 旧项 | 状态 |
|------|------|
| ~~M5 新版 CLICK 软件~~ | Protocol B baseline 已通，不依赖 |
| ~~M2 厂家联系~~ | 已自挖 Timmy（`info@timyteco.net` / `danielso@sztimmy.com.cn` / +86-755-83875070） |
| ~~N3 人脸识别~~ | CL-PC3 解决 |
| ~~N4 自动判班~~ | prototype 已实现完整规则 + 模拟器 |
| ~~型号 / 数量 / 业务规则细化~~ | 方案 PDF 已说清，Benny 自己用，按 PDF 落地 |

---

## 一段 WhatsApp 给 Benny（中英双版）

### 🇬🇧 English

> Hey Benny, four quick things to wrap up before contract:
>
> 1. **v1 scope**: just read attendance + real-time sync from both machines? Or include writing fingerprints/faces back to CL-PC3? Read-only is 95% certain, faster to deliver. Write functions add 1-2 weeks and ~60% certainty (CL-PC3 reverse still in progress). Strongly recommend read-only v1, write as v2.
>
> 2. **CL-PC3 Capacity screen** — take a photo of `MENU → System Info → Capacity` so we know how many users/faces are registered.
>
> 3. **CL-PC3 root/Telnet password** — the device has Telnet open. If you got the root credential from the vendor (in product docs or developer card), share it. Saves us 2 days of reverse engineering.
>
> 4. **USB 2.0 thumb drive** — please give us one (you mentioned a customized USB earlier). Device doesn't support USB 3.0.
>
> Also: the spec PDF mentions "网线下载" (Ethernet download) but neither machine has an RJ45 port. OK to drop that and keep "WiFi sync + USB offline"?

### 🇨🇳 中文

> Benny，签合同前 4 件事确认下：
>
> 1. **v1 范围**：两台机做"读+同步"（实时打卡 + 报表）就够了？还是要含 **CL-PC3 写操作**（后台批量管员工 / 把人脸写回设备）？读版本 95% 把握、工期标准；写版本要先 reverse 通需多 1-2 周、60% 把握。**强烈建议先签读版，写作 v2**。
>
> 2. **CL-PC3 屏幕 `MENU → System Info → Capacity` 拍张照**给我们 — 看当前注册了多少人脸 / 用户。
>
> 3. **CL-PC3 的 root / Telnet 密码** — 设备 Telnet 23 是开的。厂家给您机器时可能附了 root 密码（开发者卡片 / 产品文档里）。如果有给我们一份，省 2 天 reverse。
>
> 4. **USB 2.0 U 盘**给我们一个 — 您之前提过会做定制 U 盘，普通 2.0 也行（设备不支持 3.0）。
>
> 另外 PDF 方案里"网线下载"，两台机都没 RJ45 网口，建议删掉这条改成"WiFi 实时同步 + U盘离线下载"双通道，可以吗？

---

## 已收到 ✅（按时间倒序）

- 2026-05-02：CL-PC3 设备身份（Click 自家品牌、Bilian WiFi 模块 ODM、固件 A102G1S1K051Wcs v1.13）
- 2026-04-30：客户面谈纪要 PDF
- 2026-04-30：设备 + 包装 + 名片实拍 10 张
- 2026-04-30：WiFi 连接演示视频
- 2026-04-30：考勤数据样本 `AGL_001.DAT/.txt`（3099 条）
- 2026-04-30：Master Key 字符串
- 2026-04-30：LMT 重打包版 PC 软件 `tms-setup-V1.0.402.zip`
- 2026-04-30：OA Shine FP-93 同源机参考手册（已不重要）
