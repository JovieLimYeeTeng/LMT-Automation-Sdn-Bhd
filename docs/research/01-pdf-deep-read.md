# Research Report 01 — PDF 深读

> Agent: pdf-reader (general-purpose)
> 执行时间: 2026-04-30
> 范围: `requirements/hardware/manuals/from-vendor-zip/` 9 个 PDF + Emp CSV + FKModelDic.ini

---

## 1. INOUT / Mode 字段（最关键）

**来源**：`CLICK Software Manual 2022.pdf` 第 15 页 §8.2 Time Card；`CLICK Software Manual 2010.pdf` 第 12 页 §8.2

PC 软件把 "In/Out Mode" 作为**单一字符串/枚举字段**（不是两个字段），有 6 个值：

| 代码 | 含义 |
|------|------|
| `CI`  | Check-In（上班打卡）|
| `CO`  | Check-Out（下班打卡）|
| `OFL` | Out For Lunch（出去吃饭）|
| `IFL` | In From Lunch（吃饭回来）|
| `OTI` | OT-In（加班开始）|
| `OTO` | OT-Out（加班结束）|

> **关键澄清**：客户样本 TXT 里的 `INOUT`（0/1）和 `Mode`（2/8）是设备**原始日志的二进制字段**，PC 软件读进数据库后**合并成上面一个 `InOutMode` 字符串**。手册里**完全没出现 INOUT=0/1 的语义说明**。
>
> - 设备硬件只产出"事件流"，没有 OT/Lunch 概念。
> - 旧版 2010 手册 p.6 Employee Profile 有"Shift IN/OUT Mode Setting"复选框：Check In / Break Out / Break In / Check Out / OT In / OT Out（**6 种**），与 PC 软件 6 字符串完全对齐。
> - **结论（推断）**：设备只发"原始打卡 + Mode 数字"，由员工"今天在哪个时段"决定 PC 软件落库映射哪个 InOutMode。

---

## 2. 设备真实型号谱系

### 来自 `FKModelDic.ini`（最权威）
共 **88 机型**，按 `FileVer`：

| FileVer | 含义 | 代表机型 |
|---------|------|---------|
| `GEN` / `GEN_1` | 老式黑白/彩色屏 TXT 日志 | FK625OF, FK635OFx, FK725HSx, FK735HSx |
| `PS_HTML` | HTML 格式日志 | FK623OF1, FK823OF, FK833OF, WS306Ax |
| `PS_EXCEL_1` | Excel/XML 日志（早期 K 系列）| FK853xOF, FK744HSx, FK254HS20, deliHS20CG |
| `RTBIO_5_PS_EXCEL` | Rtbio U-Disk 格式 | HS001 |
| `RTBIO_10_PS_EXCEL` | Rtbio 人脸+指纹 | HS002 |
| `LINUX_0/1/2/CIF13` | Linux 底层 U-Disk 格式 | HS101/102/103, IFKLOF001/002, FC335 |
| `NUC_CIF14` | 新一代 Nuc | NUC14U03F10S16FPFC, NUC14U30F50S24FP |

`MaxUser` 范围 200..50000；`MaxFont`（指纹模板数）500..30000。

### 来自 `CLICK Software Manual 2022.pdf` §10.3 (p.26) + Quick Guide Software (p.8)
PC 端 Download 菜单 5 类入口：
- **Finger / Card**（老 FK 系列）
- **Face**（老人脸机）
- **FPClock**（CL-918/928/938 / **WE-88i / WE-68 plus** / CL-TFS12 → "FPClock" 协议）
- **Finger / Card (New)**（新 NUC 系列）
- **TMS Cloud / TMS Cloud 2**（云通道）

### 客户的 WE-68 PLUS 落点
- Hardware Quick Guide p.1：WE-68plus 与 WE-88i / CL-TFS12 同组 → **走 FPClock 协议组**
- 同组：CL365A / CL385B / CL573 / WE-68PlusN
- AI 一组：AI07F（带触屏，Android UI）

---

## 3. 通信协议

**来源**：`CL-918A fingerprint access control manual.pdf` p.16-17 §5.3 + `CL-918i- User Manual.pdf` p.9 §6.3 + Hardware Quick Guide p.6 + Software Quick Guide p.8

### TCP/IP（主要通道）
- **默认端口 `5005`**（CL-918A、CL-918i、WE-68 设备菜单 "Port No"，PC 软件 Download 默认 5005）
- 默认 IP：`192.168.1.204`（CL-918A）/ `192.168.0.221`（CL-918i 截图）
- **必带 "Communication Password"**（设备菜单 "Comm PWD" / "Net PWD"，默认 `0`）— TCP 通信带这个口令
- **Device Number / TMNo**：CL-918A 范围 1..255，PC 软件 FP Clock 对话框叫 "Machine Number"

### TCP "Realtime / Server Push"
- CL-918i §6.3：`ServerIP`、`ServerPort` 默认 `7005`，`Realtime Req: Yes/No`
- **设备主动推送**通道（区别于 PC 拉取的 5005）。如果开启，设备每次打卡 POST 到 ServerIP:7005
- **客户当前是 Realtime=No 的轮询模式**（结合"用了 10 个月只下载新数据"佐证）

### RS-485
- 波特率 9600 / 38400 / 115200（默认 38400）
- 仅老机型用

### Wi-Fi
- 走 TCP/UDP，端口同 5005/7005

### USB / U-Disk
- 单独菜单 `U-Disk Mng → Download → All Glog / AttLog / Enroll Data`
- "Encrypt Data?" 提示，按 ESC 选不加密。客户拿到的 `AGL_001.DAT` 应该是不加密版本

### Wiegand（仅门禁机）
- WG26 / WG34 输入输出（不是考勤通道）

---

## 4. U盘导出文件命名规则

**来源**：`CLICK Software Manual 2022.pdf` p.27 §10.32 + p.36 §10.53

- **`AGL_001.DAT` = "All G-Log"**（所有打卡日志）
  - 2022 manual §10.53 原文："Browse `AGL_001` text file from the USB flash disk"
- **"AGL"** 是 **"A**ll **G**-**L**og" 缩写，与之并列：
  - `ATTLOG.DAT` —— Attendance Log（仅打卡部分）
  - `GLOG.DAT` —— G-Log（管理日志）
  - `SLOG.DAT` —— S-Log（System log）
- 后缀数字 `_001` 是**设备自增的文件序号**（下次导成 `_002`），跟客户/批次无关

---

## 5. 增量 vs 全量下载

**来源**：`CLICK Software Manual 2022.pdf` p.27 §10.32

界面截图有两个复选框：
- **"Save to Database"** — 是否落库
- **"ReadMark"** — **关键开关**

> ReadMark = ON 时：PC 软件读完后给设备一个"已读位"，下次只取**未读**的（增量）
> ReadMark = OFF 时：每次都读全量

**"用了 10 个月只下载新数据"** = 客户场景 **ReadMark=ON**（PC 软件层做增量），不是设备发增量。
- 证据 1：设备菜单里没有"传输位置/上次同步时间"字段
- 证据 2：U盘导出每次都是从设备内存倒**全量** `AGL_001.DAT`
- **风险**：如果客户用 ReadMark 但不归档 PC 数据库，删库 = 历史数据从设备拿不回来（设备只能存 60000 条）

---

## 6. Master Key 注册流程

**来源**：`How to register TMS Master key.pdf` + `How to register your Master Key.pdf` + `CLICK Software Manual 2022.pdf` p.5 §4

### PC 软件 Master Key 流程
1. U盘 (CD-ROM) 里有 `MASTER KEY.txt`，含 `3315-1785-30090-255-AF-19125-5100-15810-510-191` 形式注册号
2. 装好 TMS.exe → 登录
3. **首次登录隐藏管理员**：
   - 用户名：`eClick`（新版 1.0.234+）/ `Click`（老版）/ `click`（2022 manual §4.1.1 Online Master Key）
   - 密码：**当前电脑 24h 格式时间，4 位无冒号**。例：15:21 → `1521`
4. 菜单 `Tools → Master Key Registration` 粘贴注册号 → Apply
5. 之后才能创建普通账号（默认 `supervisor / b`）

### 多个登录路径
- **2010 老版本**：`supervisor / b`
- **离线 Master Key**（无网络）：`eClick / <时间>`
- **在线 Master Key**：`click / 1234`
- **TMS Cloud 2**：邮箱 + `1111111111`

### 关键约束
- **U盘必须插着才能开 TMS**（"pendrive 是物理 master key"）
- "你不能把别套 CD 的 U盘插到这套软件上"

---

## 7. 数据库结构

**来源**：`CLICK Software Manual 2022.pdf` p.41 §10.64 + §10.55 p.37

- **Microsoft Access `.mdb`**（"locate the old `Pay_data.mdb` file"）
- Initialize Data 屏的表清单：`ChangeShift / Employee / Leave / LeaveBreak / OTRequest / Transactions / AnnualLeave / Audit_Trial`

### Employee 表（`Emp072023-sample.csv` 41 列）
```
EmployeeID, FirstName, MI, LastName, Sex, Date_Brth, Position, Shift, Message,
HireDate, Status, Active, PicName, EmployeeNo, Dept, LatesEx, Utex, Shift2,
TypeofSched, ChangeEvery, Datetoapply, EmpName, Restmon..Restsun, NRIC,
ALeave, Annual, LeaveType, BirthPlace, address, tel, race, UserNameD,
VMode, EStatus, EStatus_Date
```
- **EmployeeID** = enroll number（设备 ID，最大 8 位 1..99999999）
- **EmployeeNo** = 公司工号（与 EmployeeID 可不同）
- **VMode** = 验证方式 `Fp` / `Fc` / `Card` / `Pwd`
- **Restmon..Restsun**（7 列）= 每周休息日布尔
- **Active** = 1=在职, 0=离职

### Transactions 字段（按 PC 软件 Time Card UI 反推）
```
DEVICENO  (= TMNo)
ENROLLNO
NAME
DEPARTMENT
LOGDATE   YYYYMMDD
LOGTIME   HHMM
MODE      1 byte
SPECIAL   000000 (dummy)
```

---

## 8. Shift / 班次 / 假期

### 班次（Shift）
- **最多 50 班次**
- 每班次 7 天独立设上下班
- "Shift End captured Before the Shift Start"（默认 240 分钟）= 跨午夜班次关键
- `Flexible / Fix Length / LOW`（LOW = Length Of Work）
- OT Rules：`OT 2.0 Time Range`、`Activate Break`
- **Auto Shift**：员工 profile 勾"Auto Shift"+ 配多班次，系统按打卡自动归类（要求班次间隔 ≥2 小时）

### Leave Type（假期类型）
**Leave Code = 2 字符大写**（`SL/AB/OS/ML/AD/OH/AL/MC/CL/RP/EL/PL/UP`）
**注意**：`AL`（Annual Leave）和 `MC`（Medical Leave）**不要在 Leave Type 里加**，已经在 Employee Profile 里有

### Holiday
- 类型枚举：**`SHP`（Special）** / **`LHP`（Legal）**
- 每个 holiday 必带 `OT Rate`
- 最多 **20 组 Holiday Group**

### Restday
- 双击日历按 OT 1.5 / OT 2.0 标记
- OT 1.5 = 周末加班 1.5 倍；OT 2.0 = 法定加班 2 倍

---

## 9. PC 软件 Excel 导出

### Transaction Export 默认文件名模板
- 例：`TRANSACTIONS01142020-01142020.txt`
- 模式：`TRANSACTIONS<MMDDYYYY>-<MMDDYYYY>.txt`
- **Auto Run**：可设 Daily/Weekly/Monthly + 时刻（默认 17:00:00）

### Payroll 导出（4 种 profile）
UBS / **SQL** / AutoCount / HR2000 / Others
- SQL 走 .zip，里面 5 csv：`leave.application/pending.allowance/pending.deduction/pending.overtime/pending.wages`
- **不导出金额，只导出时间统计**

### OT Code（TMS-SQL Payroll Manual）
| TMS OT 标签 | SQL Payroll Code |
|------------|------------------|
| OT 1.5 | `HW15` |
| OT 2.0 | `HW20` |
| OT 3.0 | `HW30` |
| 1/2 Rest Day | `DR05` |
| 1.0 Rest Day | `DR10` |
| Public Holiday | `DR30` |

---

## 10. 设备菜单 Comm Options 完整字段（CL-918A §5.3 p.16）

```
Dev Num             1..255   (= TMNo)
Baud Rate           9600 / 38400 / 115200
Port                5005     (TCP listen on device)
Comm PWD            0        (4-byte int, encrypt key for TCP)
IP address          192.168.1.204
Mask                255.255.255.0
Default Gateway     192.168.1.1
Server IP Address   <empty>  (PC IP for realtime push)
Server Port         5005
Transmitting        NO       (master switch for realtime push)
```

CL-918i §6.3 同段（更新版）多了：
```
ServerPort     7005      (push to PC port — 不同于 listen port!)
Net PWD        0
Realtime Req   Yes/No
```

> **PC 拉数据走 device:5005；设备主动推走 PC:7005**

---

## 11. SDK 调用示例代码

**未发现**所有手册都是终端用户/操作手册，没附带 C/C++/.NET demo。

可观察到的 SDK 痕迹（说明 SDK 存在但没附带）：
- p.26+ Tools/Download 子菜单功能名（"GetDeviceTime/SetDeviceTime/PowerOnDevice/PowerOffDevice/DisableDevice/Enable User/Disable User/Modify Privilege/Empty Enroll Data/Clear All Data(E,GL,SL)/GetDeviceInfo"）→ 这些就是底层 SDK 函数名
- "Get Product Data" 返回三字段：Serial Number, Backup Number, Product Code（§10.34 p.28）

---

## 12. 客户/经销商必须答的问题（红/黄/蓝灯）

### 红灯（不解决就阻塞）
1. **`AGL_001.DAT` 二进制结构** — 给一份真实 .DAT + 对应 PC 软件解析后的 Excel 导出，做差分
2. **Mode 字段精确映射表** — 0/1/2/4/8 → CI/CO/OFL/IFL/OTI/OTO
3. **客户实际部署是几台设备？** 多机时 TMNo 配置？AGL_001 在多台间会冲突吗？
4. **Comm PWD 客户改过没？** 默认 0，若改过没记录 → TCP 连不上

### 黄灯（先要文档）
5. **TCP 5005 协议规范 / 命令字列表**（厂家 SDK）
6. **MDB 完整 schema**（`Pay_data.mdb`）
7. **TMS Cloud 2 API 端点**
8. **K006 旧机型 USB 格式**

### 蓝灯（产品边界）
9. **客户是否需要 Realtime Push (Server IP / 7005)?**
10. **Wiegand 联动 / 门禁需求？**
11. **AI07F 触屏机 / WE-68PlusN 新菜单机**：客户机型混合？
12. **班次最多 50、Holiday Group 最多 20** —— 是否打破？
13. **Auto Shift "≥2 小时"约束** —— 餐饮 4 小时一班会卡
14. **离职员工**：设备指纹模板要不要同步删？

---

## 13. 不需要再问客户的（手册已答）

| 问题 | 答案位置 |
|------|---------|
| 设备最大用户 / 模板数 | FKModelDic.ini |
| 通信端口默认值 | 5005 (listen), 7005 (push) |
| 默认 IP / 网关 | 192.168.1.204 / 192.168.1.1 |
| 默认 Comm Password | 0 |
| 隐藏管理员登录 | `eClick` / 当前电脑 HHMM |
| 删全部 ID 的密码 | `8282` (新机) / `123456` (WE-88) |
| Master Key 验证机制 | U盘里 `MASTER KEY.txt` |
| Excel 导出文件名 | `TRANSACTIONS<MMDDYYYY>-<MMDDYYYY>.txt` |
| U盘原始日志文件名 | `AGL_001.DAT`（All G-Log）|
| Holiday 类型 | SHP / LHP |
| OT 三档代号 | HW15 / HW20 / HW30 |
| 班次/休息日上限 | 50 / 20 |
| 增量下载机制 | PC 软件 ReadMark 标记位 |
| Wiegand 输出 | WG26 / WG34 |
