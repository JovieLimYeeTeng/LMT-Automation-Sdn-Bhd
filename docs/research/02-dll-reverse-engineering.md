# Research Report 02 — DLL / EXE 反向工程

> ⚠️ **协议归因已订正（2026-05-02 标注）**
>
> 本文把 5005 协议归到 Realand Zd2911 协议族（包头 0xA55A），但 CL-PC3 实测使用的是 Click Protocol B（包头 `55 AA + 79 19`），56 opcode 字典也完全不同。这是 LMT V1.0.402 软件**遗留的 Realand 兼容层**，与 CL-PC3 设备实际协议不同。
>
> CL-PC3 真协议见 [`../protocol-cl-pc3.md`](../protocol-cl-pc3.md)（Click Protocol B + 56 opcode 字典），TFS30 见 [`../protocol-th900.md`](../protocol-th900.md)。
>
> 本文保留作历史参考，反编工件本身（FP_CLOCK.ocx 95 个 dispatch fn 等）依旧有效，但**对应到的"Realand 协议"结论应忽略**。
>
> ---
>
> Agent: dll-reverse (general-purpose)
> 执行时间: 2026-04-30
> 范围: `/tmp/wemax-software-explore/tms-setup-V1.0.402/` 全部 DLL/EXE/OCX
> 关键工具: `strings`, `pefile` (Python), `dnfile` (Python — 解析 .NET PE 的 metadata)

---

## 1. 设备 / 协议家族总览

OEM 一共有 **三套并存的固件协议**，由 `Riss.Devices.ConnectionModel` 枚举区分：

| ConnectionModel | 值 | 对应固件代号 / 包内类 | 特征 |
|---|---|---|---|
| `Zd100` | 1 | 老款 FK-100 系列（含 `FK625OF`,`FK623OF`,`FK635OF*` 等大部分 P0 型号） | 单字节包头 `0x55/0xAA`，命令码 `0x0FF` 段 |
| `Zd101` | 2 | Zd100 微变种 | 同上 |
| `Zd2910` | 3 | 中档（FK542 等） | 命令码 `0x801`/`0x807` 段 |
| `Zd3000` | 4 | 高档老款 | 命令码 `0x80x` 段，含 SCSI U盘传输 |
| `Zd2911` | 5 | **新一代主力（WE-68 PLUS 大概率属此组）** | 双字节包头 `0xA55A`/`0xAA55`，支持 P2P、TCP、USB SCSI |

证据：`Riss.Devices.dll` `ConnectionModel`/`CommunicationType` 枚举；`FKModelDic.ini`（含 88 项 `[FKModel-N]`）。

---

## 2. 三种通道与默认参数

### 2.1 TCP（局域网，最值得做）

| 字段 | 值 | 来源 |
|---|---|---|
| **默认设备 IP** | `192.168.1.201` | `TMS.exe` strings + UI 控件 `txtIP/txtPortNo` |
| **默认 TCP 端口** | **`5005`** | `TMS.exe` UI 默认值 + `txtPortNo` 控件初始值 |
| 备用样例端口 | `7005` | `TMS.exe` strings |
| Socket 超时 | 6000 ms | `Riss.Devices.dll` `Zd2911CommTcp::InitSocket` IL `ldc.i4 6000` |
| Send/Recv 缓冲 | 1024 B | 同上，`SendData`/`RecvData` 中 `ldc.i4 1024` |
| 关闭 UDP 复位 | 启用 `SIO_UDP_CONNRESET = 0x9800000C` | `Zd2911CommTcp::InitSocket` IL `ldc.i4 -1744830452` |

> **不是 ZKTeco 的 4370**；不是 TFT/HID 的 8080。**自定义二进制协议，端口 5005**

### 2.2 UDP（广播 + 实时事件）

| 字段 | 值 | 来源 |
|---|---|---|
| 广播地址 | `255.255.255.255` | `FKRealSvrDllUdp.dll` strings |
| 例样默认服务器 IP | `192.168.0.9` | `FKViaDev.dll`, `Autodownload.exe` |
| 用途 | (a) LAN 中扫描发现设备；(b) 设备主动 push 实时打卡日志 | `FKRealSvrDllUdp.dll` 导出 `FK_OpenNetwork/FK_SendResponse/FK_SetCallBack` |

### 2.3 串口 / RS-485

- 默认波特率档：9600 / 19200 / 38400 / 57600 / 115200
- RS-485 支持：`TMS.exe` 字符串 `RS485 Use!`
- 设备端口：`COM%d` (旧)，`\\.\COM%d` (新)
- 串口实现：`Zd2911CommSerial`, `Zd100CommSerial`, `Zd3000CommSerial`, `FKRS300.dll`（`A25*` 老协议）

### 2.4 USB（U盘 + USB Mass Storage 主机模式）

| 字段 | 值 | 来源 |
|---|---|---|
| USB 主机芯片 | **南京沁恒微 CH375** | `CH375DLL.DLL` 31 个导出（`CH375OpenDevice`, `CH375ReadData` 等） |
| 设备名访问 | `\\.\<drive>:` (Windows raw disk SCSI passthrough) | `Riss.Devices.Zd100CommUsb`/`Zd2911CommUsb`，调 `kernel32!DeviceIoControl` + `SCSI_PASS_THROUGH_DIRECT` |
| 通信模式 | (a) USB 大容量存储读写 .DAT；(b) SCSI vendor passthrough（CDB-12） | `Riss.Devices.dll` `SCSI_PASS_THROUGH_DIRECT` 结构 |
| 备选 USB DLL | `Data\SBPCCOMM.DLL`（`UsbOpen/UsbClose/UsbReadData/UsbSendData`） | `Riss.Devices.dll` P/Invoke 表 |

### 2.5 P2P 云穿透

| 字段 | 值 | 来源 |
|---|---|---|
| 云端 API | `http://p2p.weixinac.com/api/p2pserverip/` | `Riss.Devices.dll` user-string |
| 默认 P2P 服务器 IP | `182.254.150.81` | `P2pUtils::.cctor` IL `ldstr` |
| 默认 P2P 端口 | **`5505`** | `P2pUtils::.cctor` IL `ldc.i4 5505` |
| 协议命令簇 | `P2pCmdInit`, `P2pCmdInitSave`, `P2pCmdNotify`, `P2pCmdConnectRequest`, `P2pCmdConnect`, `P2pCmdReceiveConnectRequest`, `P2pCmdTransitConnectRequest` | `Riss.Devices.dll` `P2pUtils` 类字段名 |
| 设备号前缀 | 样例 `60-D2-B9` | `Riss.Devices.dll` user-string |
| 加密 | `P2pUtils::Encrypt`/`Decrypt` 静态方法（参数走 `WebEncryptKey` 字段） | `Riss.Devices.dll` 方法表 |

> 客户的设备很可能注册在 `weixinac.com`（一家做穿透的厂商域名）。**实际客户场景（马来西亚公司，本地局域网）建议直接走 TCP 5005，不必碰云端**

---

## 3. TCP 包结构（Zd2911 协议族 — WE-68 PLUS 大概率属此组）

通过 `Riss.Devices.Zd2911DeviceComm` IL 反汇编：

```
+--------+--------+--------+--------+----+----+--------------------+
|  SOF1  |  SOF2  |  CMDh  |  CMDl  | LH | LL |   DATA (0..N B)    | CHKSUM
+--------+--------+--------+--------+----+----+--------------------+
| 0x5A   | 0xA5   |   .....   |   ......   |       payload         | xor/sum
```

确凿字节常量（`Zd2911DeviceComm::SendCommand` IL）：
- 帧头 (LE 16-bit) 取决于方向：**`0xA55A` 上行**、**`0xAA55` 下行**（IL `ldc.i4 42330` = `0xA55A`，`ldc.i4 43605` = `0xAA55`）
- ACK 帧头：`0x55AA`
- BigData 标识：`0x5AA5`
- StaffType 枚举：`Cmd=0, Ack=1, Sum=2, Res=3, NAck=4`
- 校验和：`Zd2911DeviceComm.AddCheckSum` / `GetCheckSum`，长度 26 字节起算
- 心跳/连接超时：`0x7530` = 30000 ms

**关键命令码（`Zd2911DeviceComm`）**：

| 命令 | opcode (decimal / hex) |
|---|---|
| TestConnection | `593 / 0x251` |
| GetDeviceType | `589 / 0x24D` |
| VerifyDevicePassword | `533 / 0x215` |

### Zd100 协议族（旧 FK625OF 等）

完整命令码表（`Zd100Connection` IL）：

| 命令 | opcode (hex) |
|---|---|
| Open / Probe | `0x2910`, `0x2912` |
| EnableDevice | `0x10B`, `0x10C` |
| GetEnrollData | `0x101` |
| SetEnrollData | `0x102` |
| DeleteEnrollData | `0x103` |
| GetDeviceStatus | `0x108` |
| GetDeviceTime | `0x10E` |
| SetDeviceTime | `0x10F` |
| GetUserName | `0x11A` |
| SetUserName | `0x11B` |
| FirmwareUpgrade | `0x501` |
| InitSettings | `0x502`, `0x503` |
| GetLongFingerprint | `0x588` |

### Zd3000 协议族

| 命令 | opcode (hex) |
|---|---|
| Open/probe | `0x2910`, `0x2912`, `0xB5E`, `0xBB8` |
| EnableDevice | `0x80D` |
| GetAllUserID | `0x801` |
| GetUserInfo | `0x803` |
| SetUserInfo | `0x804` |
| GetSuperLog | `0x806` |
| **GetAttRecord** (打卡日志) | **`0x807`** |
| GetDeviceStatus | `0x808` |
| GetDeviceInfo | `0x809` |
| GetDataFile | `0x80B` |
| SetDataFile | `0x80C` |
| FirmwareUpgrade | `0x810` |

> 备注：所有 4 套协议 SetProperty/GetProperty 通过同一组 `DeviceInfoType` 枚举寻址（见 §6）

---

## 4. U 盘 .DAT 文件 magic — 全谱

来自 `FP_CLOCK.ocx` / `FP_CLOCK_CSHARP.ocx`：

| Magic（前 16 字节） | 用途 | 备注 |
|---|---|---|
| `ZoucqGENLOGData` | 普通打卡日志 (GLog) | **客户文件 magic** |
| `ZoucqSUPLOGData` | 管理日志 (SLog/SuperLog) | |
| `ZoucqEnrollData` | 指纹注册数据 | |
| `ZoucqFaceEnData` | 人脸注册数据 | |
| `Zou10GENLOGData` | 新版 GLog（"10" 系列） | 较新固件 |
| `Zou10SUPLOGData` | 新版 SLog | 较新固件 |

**U 盘格式族**（`FKAttend.dll` 字符串）：
- `LINUX_0`, `LINUX_1`, `LINUX_2`, `LINUX_CIF13`, `LINUX_CIF13_1`
- `NUC_CIF14`
- `PS_HTML`, `PS_EXCEL_1`, `GEN`

---

## 5. 实时事件推送（设备 → PC）

`FKRealSvrDllTcp.dll` / `FKRealSvr.ocx` / `RealSvrOcxTcp.ocx` 提供"打卡瞬间 PC 收到事件"的能力。

**协议指纹**：
- TCP 帧 magic：`RTLOG001`, `RTLOG002`, `RTLOG003`
- 另一标识 `FK_LOG_YT_003`
- JSON payload key：`log_count`, `log_data_type_code`, `log_datas`, `log_id`
- DLL 导出：`FK_OpenNetwork`, `FK_CloseNetwork`, `FK_SendResponse`, `FK_SendRtLogResponseV1`, `FK_SetCallBack`
- OCX 事件名：
  - `OnReceiveGLogData`
  - `OnReceiveGLogText`
  - `OnReceiveGLogTextOnDoorOpen`
  - `OnReceiveGLogTextAndImage`
  - `OnReceiveGLogDataExtend`

模型：**PC 主动 listen TCP，设备建立反向连接 push JSON-text 日志**

---

## 6. 设备属性枚举（SetProperty/GetProperty）

`Riss.Devices.DeviceInfoType` 枚举给出了 75 个可读写属性的索引。摘录：

| 属性名 | 值 | 含义 |
|---|---|---|
| `DateFormat` | 1 | |
| `Time` | 2 | 设备时间 |
| `Volume` | 5 | |
| `Machine_ID` | 30 | 设备号 |
| `Ethernet` | 31 | 网络模式 |
| `Ip` | 32 | IP |
| `SubNet` | 33 | |
| `GateWay` | 34 | |
| `RS232` | 35 | |
| `RS485` | 36 | |
| `Password` | 37 | 设备通信密码 |
| `DHCP` | 38 | |
| `UnlockTime` | 42 | |
| `DoorSensor` | 44 | |
| `Bell` | 57 | |
| `Wiegan` | 58 | 韦根 |
| `ManagerPC_IP` | 60 | **PC 服务器 IP（设备主动连接的目标）** |
| `BindingID` | 61 | |
| `IdentifyMode` | 63 | |
| `WiegandType` | 69 | |
| `USB_Slave` | 70 | USB 模式 |

---

## 7. 加密 / 验签

`FKPwdEncDec.dll` 导出：
- `FKHS3760_DecryptPwd` / `FKHS3760_EncryptPwd` — 老协议密码格式
- `FKHS4720_PassDecrypt` / `FKHS4720_PassEncrypt` — 新协议密码格式
- `ConvPwd_HS3760_TO_HS4720` / 反向 — 跨格式转换
- `ConvPwd_HS3760_TO_PlainInt` / `ConvPwd_PlainInt_TO_HS3760` — 与明文整数转换

`FpDataConv.dll` 导出（指纹模板格式转换）：
- `FPCONV_ISOToPEFIS`, `FPCONV_PEFISToISO`（ISO 19794-2 ↔ 厂家 PEFIS 格式）
- `FPCONV_GetFpDataValidity`
- `FPCONV_Init`, `FPCONV_Convert`

> **结论**：通信层包体里的 `Password` 字段 **会被 HS3760/HS4720 加密**。要正确发指令，必须先用 `FKPwdEncDec.dll` 加密用户/管理员密码（或反向加密算法）

---

## 8. DLL 导出函数（自研对接的高价值候选）

如果"短路"在 Windows 上用 ctypes/p-invoke 直接调 `FK623Attend.dll`/`FKAttend.dll` 是最快路径（150+ 个 `FK_*` 函数）。

最有用的 30 个：

```
连接：
  FK_ConnectNet(IP, Port, MachineID, Pwd)        ← TCP 主连
  FK_ConnectComm(COM, Baud, ...)                 ← 串口
  FK_ConnectUSB(...)                             ← U盘/USB
  FK_ConnectGetIP(...)                           ← UDP 扫描
  FK_DisConnect()
  FK_GetLastError() / FK_SetCurCodePage()

用户：
  FK_GetAllUserID / FK_GetAllUserID_StringID
  FK_GetUserInfo / FK_SetUserInfo / FK_GetUserInfoEx / FK_SetUserInfoEx
  FK_GetUserName / FK_SetUserName
  FK_EnableUser / FK_ModifyPrivilege

注册数据（指纹）：
  FK_GetEnrollData / FK_PutEnrollData / FK_DeleteEnrollData
  FK_GetEncrptEnrolledData    ← 拿到 HS4720 加密的密码 + 模板

打卡 / 日志：
  FK_GetGeneralLogData / FK_GetGeneralLogData_StringID  ← 普通日志
  FK_GetSuperLogData                              ← 管理日志
  FK_LoadGeneralLogData / FK_LoadSuperLogData     ← 缓冲
  FK_EmptyGeneralLogData                          ← 清空（慎用）

设备：
  FK_GetDeviceTime / FK_SetDeviceTime
  FK_GetDeviceInfo / FK_SetDeviceInfo
  FK_GetDeviceStatus
  FK_GetProductData / FK_GetDeviceVersion

实时：
  FK_GetRealTimeInfo / FK_SetRealTimeInfo
  FK_SetServerNetInfo  ← 让设备 push 到指定 PC

JSON 命令通道（新接口）：
  FK_HS_ExecJsonCmd                    ← 通用 JSON 命令入口
  FK_HS_GetTimeZone / FK_HS_SetTimeZone
  FK_HS_GetUserWeekPassTime / FK_HS_SetUserWeekPassTime

USB U 盘文件读写：
  FK_USBReadAllEnrollDataCount / FK_USBReadAllEnrollDataFromFile
  FK_USBLoadGeneralLogDataFromFile / FK_USBLoadSuperLogDataFromFile
  FK_USBGetOneEnrollData* / FK_USBSetOneEnrollData*
  FK_GetUSBEnrollDataIsSupportStringID
```

`FK_HS_ExecJsonCmd` 是新的 JSON 命令通道（"HS" = HighSecurity），FKAttend.dll 内嵌 jsoncpp 库（`FastWriter@Json`, `StyledWriter@Json`, `ValueAllocator@Json`）。**新固件用 JSON-over-TCP，老固件用二进制**。

`TMPCCOMM.dll` 是 VB6 端的统一接口（薄包装）：`StartComX`, `StartUdpX`, `StartUsbX`, `StartServerX`, `SendCommandX`, `SendBigDataX`, `RecBigDataX`, `RecExeResultX`, `SetMachineIDX`, `SetTCPTimeoutX`, `EndX`, `GetLastErrorX`, `ComWakeUpX`

---

## 9. 自研 TMS 的对接路线推荐

### 路线 A — Windows 上用 ctypes 直接 P/Invoke `FK623Attend.dll`（**最低成本，1–2 天**）

```python
import ctypes
fk = ctypes.WinDLL(r"C:\Program Files (x86)\CLICK\TMS\FK623Attend.dll")
fk.FK_ConnectNet.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_int, ctypes.c_char_p]
fk.FK_ConnectNet.restype = ctypes.c_int
ret = fk.FK_ConnectNet(b"192.168.1.201", 5005, 1, b"")
```

约束：必须 Windows + x86 进程（DLL 是 32-bit）。Node 用 ffi-napi/koffi、Go 用 `syscall.LoadDLL`，Rust 用 `libloading`。

### 路线 B — 跨平台重写 TCP 协议（**工程量中，1–2 周**）

针对 **Zd2911 协议族**（最可能匹配 WE-68 PLUS）：

```
1. TCP 连接 192.168.1.201:5005，超时 6s
2. 帧格式：
   [0xA5 0x5A] [opcode_le_2B] [len_le_2B] [payload …] [chksum_1B]
   ACK 反向：[0x55 0xAA] …
3. 第一步：opcode 0x251 (TestConnection) 探测 → 设备返回 0x55AA + Ack
4. 第二步：opcode 0x215 (VerifyDevicePassword) + HS4720 加密的密码
5. 之后按 §3 / §6 表使用
```

需要的额外工作：
- 复现 HS4720 密码加密 → 反汇编 `FKPwdEncDec.dll!FKHS4720_PassEncrypt`（PE32, MFC, ~47KB）
- 复现校验和算法 → 反汇编 `Zd2911DeviceComm::AddCheckSum`（IL，可读，dnfile 已能解）

### 路线 C — 完全 U 盘流（**最稳，0 网络依赖**）

适合"客户不允许联网"场景：
1. 设备端导出到 U 盘 → 文件 `ZoucqGENLOGData` 开头
2. 自研工具读 U 盘 → 解析 magic + payload
3. 解析逻辑可复用 `FKAttend.dll!FK_USBLoadGeneralLogDataFromFile` 或自己实现

---

## 10. 还需要的外部资源

如果要做到"完全跨平台对接，不依赖 Windows DLL"：

1. **从客户拿一个真实导出的 `.DAT` 文件**（U 盘里，应是 `ZoucqGENLOGData` 开头），用于反推 GLog 二进制布局
2. **抓包 1 次设备↔CLICK TMS 真实通信**（Wireshark 在客户那边录 5 分钟）：可瞬间确认是 Zd2911 还是 Zd3000 协议族、确认实际端口、把 HS4720 密码加密前后绑定
3. **反汇编 `FKPwdEncDec.dll`**（47KB，纯 C++）拿到 `FKHS4720_PassEncrypt` 算法
4. **反汇编 `Zd2911DeviceComm.AddCheckSum/GetCheckSum`** —— 已经在 `Riss.Devices.dll` IL 里
5. **`Riss.Devices.tlb` IDL 反编译** —— 当前 strings 已能看出接口名

不需要：brew install dotnet/mono；联网下载 ilspy（dnfile 已足够 80% 的元数据需求）

---

## 11. 一句话结论

**这是一台中国 Riss 系（实际供应方域名 weixinac.com）的 FK 系列指纹机，自定义二进制协议跑在 TCP 5005，包头 `5A A5` / `AA 55`，密码字段用 HS4720 加密，U 盘导出文件 magic = `ZoucqGENLOGData`。** 最快的 Windows 路线是 ctypes 调 `FK623Attend.dll`（150+ FK_* 函数）；跨平台重写需要先抓一次真实流量并反汇编 `FKPwdEncDec.dll`。
