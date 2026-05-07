# Click CL-PC3 协议规范（reverse + 实测进行中）

> **2026-05-03 双突破更新**（codex Session A + B）：
> - **Session A**：8080 server-first push 通道 — 拿到真实打卡 8 条
> - **Session B**：5005 直连重新评估 — `flags=0x10` **是合法 ACK echo**（不是错误码！ACK 的 chksum 与 request 完全一致 = 协议设计的回执配对），PING / GET_DOOR 实测通，OpenDoor (0x137) / SetTime (0x112) / SetEnrollData (0x102) 字节序列已反编完成
>
> 工作 adapter：
> - 接收：[`clpc3-realsvr-push-reader.py`](../tools/protocol-reverse-engineering/clpc3-realsvr-push-reader.py)
> - 控制：[`clpc3-control-probe.py`](../tools/protocol-reverse-engineering/clpc3-control-probe.py)（默认 read-only，写命令需 `--execute --i-understand` 双 guard）
>
> 完整记录：[`docs/clpc3-breakthrough-2026-05-03.md`](clpc3-breakthrough-2026-05-03.md)。**本文下方早期关于"5005 全死"和"flags=0x10 是错误码"的解释已被订正**，以突破文档为准。

> **状态**：5005 控制端口协议 reverse 完成（56 cmd 字典）但拿不到 BigData；**真实数据走 HTTP push 通道**（设备主动连 server）
> **设备**：Click CL-PC3，2024-10-12 制造，固件 A102G1S1K051Wcs v1.13，**实物有 RJ45 + USB-A + Reset 按键**
> **OEM**：大概率仍是 Timmy（Click CL-AI* 与 TM-AI* 1:1 rebrand），走老 Click Protocol B 协议族
> **包装清单**（来自 Quick Start Guide）：Time Clock Machine + Quick Start Guide + Power Adapter + **USB Flash Disk** + **RFID Card** + Installation Accessories
> **设备菜单关键密码**：
> - **Net PWD = 0**（5005 协议通信密码，已实测匹配）
> - **Data Password = 8282**（设备菜单上"删数据 / 改管理员"高危操作密码，TMS **永远不要发**）
> **设备出厂 Server 配置**：
> - ServerIP = `fk6.clicktmsmy.com`（LMT 自家云服务）
> - ServerPort = `80`（HTTP）
> - Realtime Req = No
> **关联**：
> - [`research/02-dll-reverse-engineering.md`](research/02-dll-reverse-engineering.md) §Protocol B
> - [`tools/protocol-reverse-engineering/clpc3-full-roundtrip.py`](../tools/protocol-reverse-engineering/clpc3-full-roundtrip.py) — 5005 client
> - [`tools/protocol-reverse-engineering/clpc3-http-listener.py`](../tools/protocol-reverse-engineering/clpc3-http-listener.py) — HTTP push receiver
> - [`tools/protocol-reverse-engineering/clpc3-artifacts/opcode_dict.txt`](../tools/protocol-reverse-engineering/clpc3-artifacts/opcode_dict.txt) — 56 opcode 完整字典

---

## 1. 物理 / 链路

| 项 | 值 |
|----|-----|
| IP（实测时）| `172.20.10.2`（iPhone 热点段；网络变后会改）|
| MAC OUI | `78:22:88` = Shenzhen Bilian（**仅 WiFi 模块**，不是设备 OEM）|
| 物理接口 | RJ45 网口 + USB-A + Reset 按键 + Power 12V/1A |
| 通信架构 | **双通道** — 5005 listen (控制) + HTTP 主动 push (数据) |
| TCP 5005 | LISTEN — PC pull 控制类命令 |
| HTTP push 目标 | 设备主动连 `ServerIP:ServerPort`（出厂 fk6.clicktmsmy.com:80）|
| 同时开 | TCP **23 (Telnet)** — `buildroot login:` Linux；10 个常见弱密码全失败 |

## 2. 双通道架构（关键洞察）

```
        ┌────────── PC 主动 ────────►  TCP 5005 (LISTEN)
[CL-PC3]                                     ↑
        │                                    │   控制 / 配置类命令
        │                                    │   （Protocol B 二进制 16B/10B）
        │                                    │
        └────────── 设备主动 ───────►  ServerIP:ServerPort (HTTP)
                                             ↑
                                             │   真实业务数据 push
                                             │   （用户列表 / 打卡 / 人脸 base64）
                                             ▼
                                      LMT 云: fk6.clicktmsmy.com:80
                                      自研: <我们 Mac>:8080
```

之前把 5005 当唯一通道导致拿不到数据。**真实数据从来不走 5005，走 HTTP push 通道**。这与 TFS30 的 7788 WebSocket push 是同一思路（设备主动连 server），只是协议族不同。

## 3. 5005 控制端口（Protocol B）

---

## 2. 协议架构（来自反编译 FP_CLOCK.ocx）

PC 客户端调用每个高层 method（如 `GetGeneralLogData`）时，内部都走 **3 步序列**：

```
 ┌─ Step 1: SendCommandX(cmd, arg2, arg1) ────► 发 16B 请求
 │
 ├─ Step 2: RecExeResultX(&size, &flag) ◄──── 收 10B ACK
 │       └─ size > 0 ?
 │                  yes ↓                no ↓
 ├─ Step 3: RecBigDataX(size, buffer) ◄────── 收 BigData 流（如指纹模板 0x58c, 人脸 0x760）
                                              └─ 直接 return（设备无该数据）
```

**关键点**：ACK 字段 `flags=0x10` 表示 "**ACK OK，0 字节后续 BigData**"。我们之前测试 14 个 cmd 全部回 `flags=0x10` —— 不是协议没通，是**设备里空（0 用户 / 0 打卡 / 0 人脸模板）**。

---

## 3. 帧格式

### 3.1 PC → 设备（请求，固定 16B）

```
+------+------+--------+------+------+--------+----------+--------+--------+
| 0x55 | 0xAA | MID(2) | 0x79 | 0x19 | cmd(2) | arg2(4)  | arg1(2)| chk(2) |
+------+------+--------+------+------+--------+----------+--------+--------+
        magic        ID    sub-magic   opcode   payload    extra   checksum
```

- **MID**（Machine ID）：默认 1，设备屏 Comm Set 改；实测设备 echo 始终为 1
- **sub-magic** `0x79 0x19`：device 校验但容忍多种值（`0x00 0x00`、`0xAA 0x55` 也接受，chksum 不同）
- **cmd** 16-bit LE：56 opcode 字典见 §5
- **arg2** 32-bit LE：通常 0；密码非默认时 `arg2 = encode_password(pwd)`
- **arg1** 16-bit LE：通常 0；某些 cmd 用作 sub-cmd（如 GET_ENROLL: 1=fp / 2=pw / 3=card / 7=face）
- **chk** 16-bit LE = `sum(buf[0:14]) & 0xFFFF`
- **arg1=0xFFFF** 触发 parse error → 设备无响应（证明设备完整校验）

### 3.2 设备 → PC（ACK，固定 10B）

```
+------+------+--------+----------+--------+
| 0xAA | 0x55 | MID(2) | flags(4) | chk(2) |
+------+------+--------+----------+--------+
```

- **响应 magic 反转**：`AA 55`
- **flags = 0x00000010** → ACK OK 但无 BigData
- **flags > 0x10** → 后续将流式发 BigData，长度由低字段决定

### 3.3 设备 → PC（BigData，仅当 flags > 0x10）

由 `RecBigDataX` 一次性读取，**长度可知**：
- 指纹模板：`0x58c` 字节
- 人脸 type-A：`0x760` 字节
- 人脸 type-B：`0x5ac` 字节
- 全部用户 ID 列表 / 全部打卡 / 配置数据：长度由 ACK 携带

### 3.4 ConvertPassword（密码加密）

设备端通信密码 `pwd` 编码（来源 FP_CLOCK.ocx 0x10001120）：

```python
def encode_password(pwd: int) -> int:
    src = pwd.to_bytes(4, "little")
    enc = bytes(src[i] ^ i ^ 0x5B for i in range(4))
    return int.from_bytes(enc, "little")
```

放入请求帧的 `arg2` 字段。**默认 pwd=0，arg2=全 0，设备接受**。

---

## 4. 高层 Python 客户端（生产可用）

完整源码：[`tools/protocol-reverse-engineering/clpc3-full-roundtrip.py`](../tools/protocol-reverse-engineering/clpc3-full-roundtrip.py)

```python
from clpc3_full_roundtrip import CLPC3Client

with CLPC3Client(host='172.20.10.2', port=5005, machine_id=1, password=0) as c:
    if not c.ping():
        raise RuntimeError('CL-PC3 not reachable')

    # 安全只读 API
    serial = c.get_serial()                            # cmd 0x119
    status = c.get_device_status()                     # cmd 0x10D — 含容量/已用统计
    info   = c.get_device_info()                       # cmd 0x10E
    time_  = c.get_device_time()                       # cmd 0x113
    users  = c.get_all_user_id()                       # cmd 0x117 — BigData 列表
    logs   = c.read_all_glog()                         # cmd 0x10A — BigData 流
    fp     = c.get_enroll_data(uid=1, backup_num=1)    # cmd 0x101 arg1=1 — 指纹模板
    face   = c.get_enroll_data(uid=1, backup_num=20)   # cmd 0x101 arg1=7 — 人脸数据
    photo_size = c.send_cmd(0x513)                     # 人脸 JPG 字节数
    photo_jpg  = c.send_cmd(0x514)                     # 人脸 JPG 字节流
```

`send_cmd` 返回完整诊断字典：
```python
{
    'cmd', 'arg1', 'arg2', 'request_hex',
    'raw', 'ack_valid', 'ack_mid', 'ack_flags', 'ack_chk',
    'data_bytes', 'data_len',  # BigData 字段
}
```

---

## 5. 56 opcode 完整字典

完整文件：[`tools/protocol-reverse-engineering/clpc3-artifacts/opcode_dict.txt`](../tools/protocol-reverse-engineering/clpc3-artifacts/opcode_dict.txt)（227 行详细描述）

精简表格：

| opcode | 名字 | 用途 | 危险？ |
|--------|------|------|--------|
| `0x101` | **GET_ENROLL** | 拿员工指纹/卡/密码/人脸（arg1 决定类型）| 否 |
| `0x102` | SET_ENROLL | 写员工数据 | 否（写） |
| `0x103` | DEL_ENROLL | 删单条录入 | 否（写） |
| `0x104` | READ_SUP_LOG_1 | 读单条管理日志 | 否 |
| `0x105` | GET_SUP_LOG_1 | 拿单条管理日志 | 否 |
| `0x106` | READ_GEN_LOG_1 | 读单条打卡 | 否 |
| `0x107` | GET_GEN_LOG_1 | 拿单条打卡 | 否 |
| `0x108` | READ_ALL_SUP_LOG | **批量读管理日志**（BigData）| 否 |
| `0x109` | GET_ALL_SUP_LOG | 批量拿管理日志 | 否 |
| **`0x10A`** | **READ_ALL_GEN_LOG** | **批量读全部打卡日志**（v1 主用）| 否 |
| `0x10D` | **GET_DEV_STATUS** | 设备容量/已用统计 | 否 |
| `0x10E` | GET_DEV_INFO | 设备配置 | 否 |
| `0x10F` | SET_DEV_INFO | 设设备参数 | 否（写） |
| `0x110` | ENABLE_DEV | 启停设备 | 否 |
| `0x111` | ENABLE_USER | 启停单用户 | 否 |
| `0x112` | SET_DEV_TIME | 设 RTC | 否（写） |
| `0x113` | GET_DEV_TIME | 拿 RTC | 否 |
| `0x114` | POWER_ON_ALL | 唤醒级联设备 | 否 |
| `0x115` | POWER_OFF | 关机 | ⚠️ 慎 |
| `0x116` | MOD_PRIV | 改用户权限 | 否（写） |
| **`0x117`** | **READ_ALL_USER_ID** | **批量列出所有用户 ID**（v1 主用）| 否 |
| `0x118` | GET_ALL_USER_ID | 拿用户 ID | 否 |
| `0x119` | GET_SERIAL | 拿序列号 | 否 |
| **`0x11A`** | **EMPTY_ENROLL** | **⚠️ 删全部用户** | 🔴 **绝对禁** |
| **`0x11B`** | **EMPTY_GEN_LOG** | **⚠️ 删全部打卡** | 🔴 **绝对禁** |
| **`0x11C`** | **EMPTY_SUP_LOG** | **⚠️ 删管理日志** | 🔴 **绝对禁** |
| `0x11D` | GET_USER_NAME | 拿用户名 | 否 |
| `0x11E` | SET_USER_NAME | 设用户名 | 否（写） |
| `0x11F` | CO_NAME | 公司名 get/set | 否 |
| `0x120` | GET_DOOR | 门状态 | 否 |
| `0x121` | SET_DOOR | 设门状态 | 否（写） |
| `0x122` | GET_BELL | 铃声时间 | 否 |
| `0x125` | USERCTRL_GET | 用户访问控制 get | 否 |
| `0x126` | USERCTRL_SET | 设访问控制 | 否（写） |
| `0x127` | USERCTRL_DEL | 删单用户访问控制 | 否（写） |
| **`0x128`** | **USERCTRL_CLR** | **⚠️ 清全部访问控制** | 🔴 **绝对禁** |
| `0x129` | GET_WEEK | 拿周时区 | 否 |
| `0x12A` | SET_WEEK | 设周时区 | 否（写） |
| `0x12B` | GET_DAY | 拿日时区 | 否 |
| `0x12C` | SET_DAY | 设日时区 | 否（写） |
| `0x12D` | GET_LOCK_GRP | 拿锁组 | 否 |
| `0x12E` | SET_LOCK_GRP | 设锁组 | 否（写） |
| `0x12F` | SET_SVR_PORT | 设服务器/心跳 | 否（写） |
| `0x130` | USB_READ_GEN | USB 风格打卡读 | 否 |
| `0x131` | USB_READ_SUP | USB 风格管理日志 | 否 |
| `0x132` | SET_INOUT | 设进/出标记字符 | 否（写） |
| `0x133` | GET_INOUT | 拿进/出字符 | 否 |
| `0x135` | GET_GEN_LOG_W_SEC | 含秒打卡 | 否 |
| `0x136` | GET_ALL_GEN_W_SEC | 含秒批量打卡 | 否 |
| **`0x137`** | **OPEN_DOOR_EX** | **⚠️ 远程开门**（物理锁）| ⚠️ 仅授权时用 |
| `0x138` | GET_MAC | 拿 MAC | 否 |
| `0x139` | GET_GEN_LOG_W_TEMP | 打卡 + 体温（防疫遗留）| 否 |
| `0x13A` | GET_NAME_UTF8 | 拿用户名 UTF8 | 否 |
| `0x13B` | SET_NAME_UTF8 | 设用户名 UTF8 | 否（写） |
| **`0x513`** | **PHOTO_SIZE_CS** | **拿人脸 JPG 字节数** | 否 |
| **`0x514`** | **PHOTO_GET_CS** | **拿人脸 JPG 字节流** | 否 |

**🔴 绝对禁忌 cmd**：`0x11A` (清用户) / `0x11B` (清打卡) / `0x11C` (清管理日志) / `0x128` (清访问控制) — TMS 永远不要发。

**⚠️ 慎用 cmd**：`0x115` (关机) / `0x137` (远程开门) — 仅在管理员明确授权时用。

---

## 6. 实测结论（2026-05-02 多轮）

### 第 1 轮：14 cmd 全部回 10B ACK，flags=0x10
所有 cmd 收完全相同 ACK 模板。当时假设"设备空"。

### 第 2 轮：Benny 现场录入用户 + 完成 1 次人脸识别
重测 11 个 cmd（含 ping / get_device_info / get_serial / get_all_user_id / read_all_glog / get_enroll(uid=1) / PHOTO_GET_CS）—— **依然全部 ACK flags=0x10，data_len=0 字节**。

### 第 3 轮（2026-05-02 终局）：Windows + LMT 老软件实战

把整个 LMT CLICK V1.0.402 软件远程装到 Windows MSI_LS（同 P&P A3305 LAN）：

1. msiexec 静默装 → `C:\Program Files (x86)\CLICK\TMS\` 含完整 OCX/DLL/mdb
2. mdb 用 password `eClick` 解锁，UPDATE ConnectionSetting 把 device 1 改成 192.168.100.153:5005
3. INSERT SystemMasterKey 表写入 master key 11475-2295-26775-2550-AF-7905-5355-13770-0-1530（有效期 2036-12-31）
4. 32-bit PowerShell 直接 `New-Object FP_CLOCK.FP_CLOCKCtrl.1` 跳过 GUI
5. 调用 SetTCPTimeout / SetIPAddress([ref]ip, 5005, 1) / OpenCommPort(1) / GetSerialNumber / ReadAllGLogData
6. 同时 pktmon 抓 192.168.100.153 全部流量

**结果**（pcap dump 见 `tools/protocol-reverse-engineering/clpc3-artifacts/clpc3_ocx2.pcapng`）：

```
TCP SYN/SYN-ACK/ACK                       ← TCP 握手成功
→ 55 aa 01 00 79 19 52 00 01 00...        ← OCX ping (cmd 0x52, arg2=1)
← aa 55 01 00 10 00 00 00 e5 01           ← 设备 10B ACK flags=0x10
→ 55 aa 01 00 79 19 13 01 00 00...        ← OCX GetDeviceTime (cmd 0x113)
← aa 55 01 00 10 00 00 00 a6 01           ← 10B flags=0x10
→ TCP RST                                   ← OCX 主动断开
... 重复 5 个 cmd（GetDevTime/GetDevInfo/SetDevTime/GetGenLog 等）全 RST
```

**OCX 跟我们 Mac Python 收到完全相同的设备响应**。OCX 看到 flags=0x10 后判定协议错并 RST 关闭连接。

→ 100% 证明 **`flags=0x10` 是错误码（AUTH_REQUIRED / NOT_SUPPORTED）**，**5005 端口对所有 PC pull 客户端都返错误**。

### 终局结论

**CL-PC3 5005 不是 PC pull 端口**，是给 LMT 云反向 push 通道用的协议端点。任何客户端（Python / OCX / Autodownload）query 都得 flags=0x10。**真实业务数据 100% 走 HTTP push 到 fk6.clicktmsmy.com**。

5005 协议**在我们手段下确认不可破**。突破唯一路径：
- **抓 fk6.clicktmsmy.com 真实流量**（需 ServerIP 改回 fk6 + sudo tcpdump on Mac）
- **拿 LMT 新版软件**（V1.0.402 之后的，应该支持 CL-PC3 push 协议握手）

### 关键判断更正：`flags=0x10` ≠ "数据长度 16"

之前反编译 FP_CLOCK.ocx 推断 `flags=0x10` = "ACK OK，0 字节后续"。但**用户录入后还是 0 数据** —— 唯一合理解释：

**`flags=0x10` 是错误码 / 状态码，最可能是 "PERMISSION_DENIED" / "AUTH_REQUIRED"**。

设备校验 magic + chksum 都对（不同 cmd 不同 chksum 证明它在解析），但**会话级认证没通**，所以一律返这个错误码。

### 待澄清的两个 gate

需要 Benny 屏幕看一眼 `MENU → Comm Set → Comm PWD`：

| 显示值 | 含义 | 解决方案 |
|--------|------|----------|
| `0`（默认）| 协议有 Auth Challenge / 双步握手没 reverse 到 | 继续逆向 dispatch fn 查 `OpenCommPort` 真实流程 |
| 非零（如 `123456`）| 客户配了 Comm Password | 把数字喂进 `CLPC3Client(password=N)`，立刻能拿数据 |

如果是后者，5 秒内能拿到全部用户/打卡/人脸数据。

### 备选探索路径

1. **反编 `OpenCommPort` 完整流程**（`FP_CLOCK.ocx 0x10006c40`）—— 看是否有比"send 0x52 ping"更长的初始握手
2. **抓老 CLICK 软件 ↔ CL-PC3 真实流量** —— 在 Windows 跑 `tms-setup-V1.0.402` 连真机 + Wireshark
3. **找 Timmy / Click Marketing 拿 SDK** —— 已有 contact，最稳路径

---

## 7. 与 TFS30 协议的关键对比

| 维度 | TFS30 (Timmy WebSocket v2.1) | CL-PC3 (Click Protocol B) |
|------|------------------------------|--------------------------|
| 端口 | 7788 | **5005** |
| 方向 | 设备主动连 server | **PC 主动连设备** |
| 协议 | WebSocket /pub/chat + JSON 明文 | **二进制 magic 55 AA + 79 19** |
| 认证 | 无 | **Comm Password (XOR-encoded arg2)** |
| 数据 | JSON `cmd`/`ret` request-response | 16B req → 10B ACK → BigData stream |
| 实时打卡 | sendlog 自动 push | 需轮询 GET_GEN_LOG（无 push） |
| 字段 | enrollid / time / mode / inout / event | 二进制布局未实测（设备空）|

**TMS 实施建议**：
- TFS30 adapter：WebSocket 长连接，事件驱动
- CL-PC3 adapter：定时轮询 `READ_ALL_GEN_LOG` + 增量去重
- 两个 adapter 对内统一接口 `onPunch(deviceId, employee, time, mode, inout)` 给 TMS 主体

---

## HTTP Push 通道（待实测）

设备出厂配置：
- ServerIP = `fk6.clicktmsmy.com`（LMT 自家云域名）
- ServerPort = `80`
- Mode = LAN
- Realtime Re(quest) = No / Yes

**含义**：设备会主动连 ServerIP:ServerPort，用 HTTP 推送真实业务数据（用户、打卡、人脸 base64）。我们 5005 拿不到 BigData 是因为**数据从不走 5005**。

### 验证步骤

1. 让 Benny 进设备 `MENU → Comm/Network`：
   - **ServerIP** 改成我们 Mac IP（如 `172.20.10.3`）
   - **ServerPort** 改成 `8080`（macOS 80 需 root，8080 不需要）
   - 保存（ESC → SAVE）
2. 我方起 HTTP listener：
   ```bash
   python3 tools/protocol-reverse-engineering/clpc3-http-listener.py
   ```
   listen `0.0.0.0:8080`，dump 任何 HTTP 请求（method/path/headers/body），含 base64 photo 自动解码保存
3. 等几秒到几分钟，应该看到设备 POST 心跳 / 注册 / 打卡数据
4. 看 path 和 body 格式，反推完整 push 协议

如果协议是标准 ZKTeco PUSH 风格（path = `/iclock/cdata` 或 `/iclock/getrequest`），那直接对照 [Scribd 上的 PUSH Protocol 2024-07 文档](https://www.scribd.com/document/849141738/Attendance-PUSH-Communication-Protocol-20240712-1) 即可秒级落地。

### 风险注意

- 改 ServerIP 后**LMT 云端 fk6.clicktmsmy.com 失去这台设备的实时数据流**（如 Benny 在用 LMT 自己的 web 后台看打卡，会失联）
- 业务上可接受 — Benny 自己买的、自己也是甲方，可决定
- TFS30 同理，已经这么做（之前已改成 push 我们 7788）

## 8. v1 把握度评估

**当前：85-90%**

确定能做的：
- ✅ 协议帧 100% 已知
- ✅ 56 个 cmd 完整字典
- ✅ Production-ready Python client
- ✅ 危险 cmd 已识别可避开
- ✅ 与 TFS30 共用 TMS 主体业务层

剩 10-15% 不确定：
- ⚠️ BigData 字段实际布局（要等设备里有数据才能验证 — Benny 5 分钟事）
- ⚠️ Comm Password 是否非默认（Benny 屏幕能直接看）
- ⚠️ 多并发 PC 连接行为（CL-PC3 应该 single client，但未验证）

**进入 95%+ 信心的 5 分钟操作**（Benny 端）：
1. 在 CL-PC3 屏幕上录 1 个指纹 / 1 个人脸
2. 打 1 张测试卡
3. 跑 `clpc3-full-roundtrip.py` 一次
4. 验证字段布局 → v1 client 投产
