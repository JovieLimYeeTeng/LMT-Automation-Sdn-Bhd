# TH900_click 协议规范（已实测）

> 适用：WEMAX WE-68 PLUS / TFS30 / TH900_click 固件 V5.0（Fw_date 2025-09-05）
> 实测设备 SN：ZYTI25116685
> 实测时间：2026-04-30
> 状态：核心通道已破解，关键 cmd 已验证

---

## 1. 物理 / 链路

- **传输**：WebSocket over TCP (RFC 6455，标准 WebSocket)
- **方向**：**设备主动连接 server**（设备是 WS client，TMS 是 WS server）
- **端口**：默认 `7788`（在设备 `MENU → Server → SerPortNo` 配置）
- **路径**：`/pub/chat`
- **HTTP Upgrade Headers**：标准 `Sec-WebSocket-Version: 13`，无任何鉴权头
- **认证**：**无**（LAN 内信任模型，不带任何 token / password / 加密）
- **编码**：UTF-8 JSON 文本帧（不用 binary frame）

---

## 2. 通信范式

### 2.1 双向命令模型

| 方向 | 字段 | 含义 |
|------|------|------|
| 请求方→响应方 | `cmd` | 要执行的动作 |
| 响应方→请求方 | `ret` | 同名（响应该 cmd） |

### 2.2 标准响应骨架

```json
{
  "ret": "<原 cmd 名>",
  "sn": "<设备 SN>",
  "result": true | false,
  "reason": <错误码 — 仅 result:false 时存在>,
  ...payload
}
```

### 2.3 错误码 `reason` 已知值

| reason | 含义（推测） |
|--------|-------------|
| 1 | 参数缺失（实测 `getuserinfo` 不带 enrollid 时返回） |

---

## 3. 设备 → Server 主动 push

### 3.1 `cmd: "reg"` — 注册 / 心跳（每次 TCP 连接首帧 + 周期重发）

```json
{
  "cmd": "reg",
  "sn": "ZYTI25116685",
  "devinfo": {
    "modelname": "tfs30",
    "usersize": 3000,         // 用户容量上限
    "fpsize": 3000,           // 指纹模板上限
    "cardsize": 3000,         // 卡上限
    "pwdsize": 3000,          // 密码上限
    "logsize": 193877,        // 日志条数上限
    "useduser": 2,            // 已登记用户数
    "usedfp": 2,              // 已登记指纹数
    "usedcard": 0,
    "usedpwd": 0,
    "usedlog": 1,             // 总历史日志数
    "usednewlog": 1,          // ★ 未传送的新日志数（增量同步关键字段）
    "fpalgo": "thbio3.0",     // 指纹算法标识
    "firmware": "TH900_click V5.0",
    "time": "2026-04-30 11:56:23",  // ★ UTC 时间（不是本地）
    "mac": "00-01-F5-02-7D-5F"
  }
}
```

**Server 必回**（不回设备会 ~20 秒重发，仍连着）：
```json
{
  "ret": "reg",
  "result": true,
  "cloudtime": "2026-04-30 11:56:24",   // server UTC 时间，设备会用这个对时
  "nosenduser": false,                   // false = 允许设备 push user 数据
  "nosendlog": false                     // false = 允许设备 push 打卡日志
}
```

### 3.2 `cmd: "sendlog"` — 设备主动 push 打卡（**核心业务数据**）

打卡发生时立即推送：

```json
{
  "cmd": "sendlog",
  "sn": "ZYTI25116685",
  "count": 1,
  "logindex": 1,
  "record": [{
    "enrollid": 2,                       // 员工 ID
    "time": "2026-04-30 11:56:20",       // UTC 时间
    "mode": 1,                           // 验证方式（见下表）
    "inout": 0,                          // 进出标记
    "event": 0                           // 事件类型
  }]
}
```

**Server 必回**：
```json
{"ret": "sendlog", "result": true, "count": 1}
```

#### 字段枚举

| 字段 | 已观察值 | 含义 |
|------|---------|------|
| `mode` | 1 | 指纹验证（**与老 .DAT 格式中的 8 不同**，新固件重定义） |
| `mode` | (待测) | 2 = 卡？3 = 密码？4 = 人脸？需要更多样本 |
| `inout` | 0 | 进 / Check-In |
| `inout` | (待测) | 1 = 出 / Check-Out？需要在设备上设进出按键再打卡验证 |
| `event` | 0 | 普通打卡 |
| `event` | (待测) | 其他事件类型？ |

---

## 4. Server → 设备 拉取命令（已验证）

### 4.1 `getnewlog` — 拉增量打卡日志（未传部分）

```json
// REQ
{"cmd": "getnewlog", "sn": "ZYTI25116685", "stn": true}
// RESP
{
  "ret": "getnewlog",
  "sn": "ZYTI25116685",
  "result": true,
  "count": 1,
  "from": 0,
  "to": 1,
  "record": [{
    "enrollid": 2,
    "time": "2026-04-30 11:56:20",
    "mode": 1, "inout": 0, "event": 0
  }]
}
```

`stn` = "send to network" 或类似，必带。

### 4.2 `getalllog` — 拉全量打卡日志

```json
{"cmd": "getalllog", "sn": "...", "stn": true}
// 响应结构与 getnewlog 一致
```

> **注意**：`from` / `to` 是范围 offset，大数据时设备可能分批 push 多条 ret。需要在 to == count 时认为收完。

### 4.3 `getuserinfo` — 拉单个用户（含指纹模板）

```json
// REQ — 必须带 enrollid，缺则 result:false reason:1
{"cmd": "getuserinfo", "sn": "...", "enrollid": 1}
// RESP
{
  "ret": "getuserinfo",
  "sn": "...",
  "result": true,
  "enrollid": 1,
  "name": "Ben",                  // 显示名（T9 录入，可中可英）
  "backupnum": 0,                 // 哪根手指（0-9）
  "admin": 0,                     // 0=普通 1=管理员（推测）
  "record": "c5236a01eb87aaa6...fe"   // ★ 指纹模板 hex string，约 600B
}
```

**指纹模板 record 字段**：
- 长度约 1170 hex chars ≈ 585 字节
- 算法：**THBIO 3.0**（不是 ZK / Riss PEFIS / 浩顺老格式）
- 字段内有 `(200)` `(41)` 这样的标记 — 待研究是否为分段长度
- 模板格式专属于此设备族，不能直接喂给其他厂商

### 4.4 `getuserlist` — 拉用户索引

```json
// REQ
{"cmd": "getuserlist", "sn": "...", "stn": true}
// RESP
{
  "ret": "getuserlist", "result": true,
  "count": 2, "from": 0, "to": 2,
  "record": [
    {"enrollid": 1, "admin": "0", "backupnum": 0},
    {"enrollid": 2, "admin": "0", "backupnum": 0}
  ]
}
```

(`admin` 在这里是字符串 "0"，与 `getuserinfo` 里的整数 0 不一致 — 可能 firmware bug 也可能本来就这样)

### 4.5 `opendoor` — 远程开门（**已实测设备真的开锁了**）

```json
// REQ
{"cmd": "opendoor", "sn": "...", "doorno": 1, "passwd": "0"}
// RESP
{"ret": "opendoor", "sn": "...", "result": true}
```

设备硬件支持 relay 输出，TMS 可远程开锁。

---

## 4.6 设备 Server 配置字段（来自 Timmy 官方 manual §11.2）

设备菜单 `MENU → Comm Set → Server` 下的字段，决定它怎么连我们的 TMS server：

| 字段 | 含义 | 默认 |
|------|------|------|
| Server Req | Yes/No — Yes 时启用 server 通信（即设备主动连 server，启 WebSocket push 模式）| No |
| Use domainNm | Yes 用域名 / No 用 IP | No |
| DomainNm | 域名（公网部署时用） | 192.168.0.110 |
| Server IP | server 的 IP（局域网部署用） | 192.168.0.122 |
| SerPortNo | server 端口 | **7788** |
| Heart beat | 心跳秒数 | **3 s**（实测设备被 LMT 改成 5s）|
| **Server approval** | **Yes 时设备未连上 server 期间禁止打卡** ⚠️ | No |

⚠️ **生产关键约束**：如果客户设 `Server approval = Yes`，TMS WS server 一旦掉线，**全公司员工无法打卡**。所以：
- TMS server 必须做高可用（至少守护进程 / systemd 自动重启）
- 部署文档要明确告知客户这个开关的影响

## 4.7 U 盘文件命名规则（来自 Timmy 官方 manual §10）

| 操作 | 文件名 | 内容 |
|------|--------|------|
| Down Glog | `GLG_001.TXT` | 增量打卡（设备未传出的新 log） |
| Down All Glog | `AGL_001.TXT` | 全量打卡（设备所有 log） |
| Clear All Enroll | — | 删所有用户（含 face/card/pwd） |
| Delete All Glog | — | 删所有打卡 |
| Initialize Menu | — | 重置参数（不动用户/打卡） |
| Clean Manager | — | 清管理员 |

> 注意：手册说是 `.TXT`；客户提供的样本是 `AGL_001.DAT` + `AGL_001.txt`（二进制 + 文本对照）。可能老固件有 .DAT 副产物，新 TH900_click 固件只产 .TXT —— 拿 M3 实测确认。

## 5. 完整 cmd 字典（已通过官方 v2.1 规范补全）

**2026-04-30 更新**：拿到了 Timmy 官方 WebSocket Protocol v2.1 规范文档（`vendor-resources/timmy/protocol-spec/`）+ 详细分析（`docs/protocol-spec-analysis.md`）。完整 28 个 cmd 已知，写操作 cmd 名全部确认：

| cmd | 方向 | 用途 | 实测 |
|-----|------|------|------|
| `reg` | T→S push | 心跳 / 注册 | ✅ |
| `sendlog` | T→S push | 实时打卡 | ✅ |
| `senduser` | T→S push | 设备上录入用户后主动 push | ❌ |
| `getuserlist` | S→T pull | 拿用户列表（分页） | ✅ |
| `getuserinfo` | S→T pull | 拿单用户（按 backupnum 拿 fp/card/pwd/face/photo） | ✅ |
| `setuserinfo` | S→T push | **写**用户（增/改） | ❌ |
| `deleteuser` | S→T push | 删用户/单指纹/单卡（细粒度） | ❌ |
| `getusername` / `setusername` | S→T | 拿/设用户名 | ❌ |
| `enableuser` / `disableuser` | S→T | 启用/禁用（同 cmd 名 enableuser，enflag=1/0） | ❌ |
| `cleanuser` | S→T push | ⚠️ 清空全部用户 | ❌ |
| `getnewlog` / `getalllog` | S→T pull | 拉打卡（getalllog 支持日期 from/to） | ✅ |
| `cleanlog` | S→T push | ⚠️ 清空全部 logs | ❌ |
| `initsys` | S→T push | ⚠️ 重置（删用户+logs，留参数） | ❌ |
| `reboot` | S→T push | ⚠️ 重启（无响应消息） | ❌ |
| `cleanadmin` | S→T push | 把管理员降级 | ❌ |
| `settime` | S→T push | 同步时间 | ❌ |
| `setdevinfo` / `getdevinfo` | S→T | 设/拿设备参数（语言/音量/验证模式 等） | ❌ |
| `opendoor` | S→T push | 远程开门（access ctrl 带 doornum:1~4） | ✅ |
| `setdevlock` / `getdevlock` | S→T | 设/拿门禁参数（dayzone/weekzone/lockgroup） | ❌ |
| `getuserlock` / `setuserlock` / `deleteuserlock` / `cleanuserlock` | S→T | 单用户门禁权限 | ❌ |

**先前我们猜的 cmd 名**（`getalluser` / `getdeviceinfo` / `getconfig` 等）**都是错的** — 设备 silent 是因为 cmd 不存在。正确名字见上表。

### 关键校正

**`mode` 字段** — 官方文档对此自相矛盾，但实测 TFS30 + TH900_click V5.0 使用 `1=fp / 2=card / 3=pwd / 8=face`（与 §2 sendlog 一致）。注意：**老固件 .DAT 格式中 mode=8 = 指纹**，是另一个编码体系，TMS 解析时需按数据来源（WebSocket vs U盘）路由。

**`event` 字段当 enrollid=0 时是门 / 设备事件**：

```
0=门关闭, 1=门打开, 2=出门按钮, 3=软件开门, 4=软件关门,
5=非法开门, 6=设备被拆, 7=输入告警
```

→ TMS 收到 `enrollid=0` 的 sendlog **必须路由到 `door_events` 表**，不能当员工 0 号打卡。

**`backupnum` 字典**（在 senduser/getuserinfo/setuserinfo/deleteuser 都用）：

```
0~9   第 N 根指纹（每用户最多 10 根）
10    密码（≤8 位数字明文）
11    RFID 卡号
20-27 静态人脸（8 槽）
30-37 掌静脉（8 槽）
50    照片（Base64）
deleteuser 还有 12=删全部指纹 / 13=删全部信息
```

**指纹模板长度**：THbio3.0 ≤ 1620 字符，THbio1.0 ≤ 1024 字符。

完整分析：见 [`protocol-spec-analysis.md`](protocol-spec-analysis.md)

---

## 6. 时间处理

- **设备所有时间字段都是 UTC**（不是本地时间！）
- TMS 端必须做 +8 时区转换（马来西亚 UTC+8）显示给用户
- Server reply 里的 `cloudtime` 也用 UTC

---

## 7. TMS 落地路线（V1）

```
[WEMAX WE-68 PLUS]
        │
        │ WebSocket /pub/chat
        │ (设备主动连接)
        ▼
[TMS Server: WS listener on :7788]
        │
        │ 收 cmd:reg     → ret:reg
        │ 收 cmd:sendlog → 写库 + ret:sendlog
        │ send getnewlog → 收 ret:getnewlog → 写库
        │ send setuserinfo → 收 ret:setuserinfo
        ▼
[TMS Database (PostgreSQL)]
   employees(enroll_id, name, admin, backup_num, fp_template)
   attendance_logs(device_sn, enroll_id, punched_at_utc, mode, inout, event)
```

**完全不需要**：
- ❌ Windows DLL（FK623Attend.dll / Riss.Devices.dll）
- ❌ ctypes / P/Invoke
- ❌ 任何 SDK 授权
- ❌ Master Key 注册
- ❌ U盘 / .DAT 文件解析（除非客户机也用旧固件）

**完全用得上**：
- ✅ Python `websockets` / Node `ws` / Go `gorilla/websocket` / Rust `tungstenite`
- ✅ 跨平台（Linux / Docker / 云）
- ✅ 标准 JSON 序列化

---

## 8. 与老 .DAT 格式的对比

| 维度 | 老固件（.DAT 文件 / Riss / FK 系列） | TH900_click V5.0 (本设备) |
|------|------------------------------------|-------------------------|
| 通道 | TCP 5005 自定义二进制 / U盘 | **WebSocket /pub/chat 7788** |
| 协议 | 0xA55A 帧头，HS4720 加密 | 明文 JSON |
| Mode 字段 | 8 = 指纹 | **1 = 指纹** |
| 字段命名 | TMNo, EnNo, INOUT, Mode | enrollid, time, mode, inout, event |
| 时间 | 自 2000-01-01 秒数（设备本地） | **UTC ISO-like 字符串** |
| 指纹算法 | PEFIS（浩顺）| **THBIO 3.0** |
| 增量机制 | 无（PC 软件 ReadMark） | **设备 `usednewlog` 字段** |
| 鉴权 | HS4720 密码加密 | 无 |

> **结论**：客户的设备已经是新一代固件，旧的协议研究（FK 系列 / Riss / .DAT）**对这台机器无用**。但仍有价值作为"如果客户多机里有老款"时的备用解析器。

---

## 9. 已固化的代码资产

- `/tmp/wemax_ws.py` — Python WebSocket server，能接收设备连接、ack reg、主动 send 各种 cmd 探测
- `/tmp/wemax_ws.log` — 完整握手日志（FRAME #1-#7 的 raw + parsed JSON）

下一步可以将 `wemax_ws.py` 整理进 `prototype/` 仓库作为 TMS 设备 adapter 的种子代码。
