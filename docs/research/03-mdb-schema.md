# Research Report 03 — MDB 数据库 Schema

> Agent: mdb-schema (general-purpose)
> 执行时间: 2026-04-30
> 工具: mdbtools 1.0.1（brew 成功安装）
> 范围: 4 个 .mdb 文件，全部只读

---

## 一、四个 .mdb 文件总览

| 文件 | 大小 | 表数 | 角色 |
|---|---|---|---|
| `datEnrollDat.mdb` | 143 KB | 1 | 员工指纹库（旧版主库，35 行真实数据） |
| `datEnrollDatARM.mdb` | 250 KB | 3 | 员工指纹库（ARM 设备版本，含岗位字典与班次时段） |
| `Pay_data.mdb` | 9.2 MB | **82** | **核心**：员工 + 考勤 + 班次 + 假期 + 配置 + 报表 |
| `Audit_Trial.mdb` | 377 KB | 1 | 用户操作审计日志（203 行，2011–2024） |

---

## 二、按业务功能分组的表清单

### 2.1 员工与组织架构

| 表 | 用途 | 关键字段 |
|---|---|---|
| `Employees` | 主员工档案 | `EmployeeID`(PK 文本)、`Employeeno`、`EmpName`、`Sex`、`Date_Brth`、`HireDate`、`Status`(int 引用 EmpStatus)、`Active`、`Dept`、`Shift`(FK→Shifts)、`Shift2`、`TypeOfSched`、`Annual`、`LeaveType`、`HolidayGroup`、`Template1..4`(指纹模板)、`CIMode/COMode/IFLMode/OFLMode/OTIMode/OTOMode`(布尔模式开关)、`PartimerCode`、`AutoShift`、`UpdateDT` |
| `EmpStatus` | 员工状态字典 | `Probationary / Full Time / Part Time / Contract` |
| `Department` | 部门字典 | `ID, Department, Description, ExpRpt` |
| `Partimer` | 兼职费率 | `Code, Rates, PHRates, OTRates, PHRates3` |
| `tblEnroll` (datEnrollDat) | 设备侧员工指纹库 | `EMachineNumber, EnrollNumber, FingerNumber, Privilige, Password, FPData(OLE 二进制)` |
| `tblEnroll` (datEnrollDatARM) | ARM 设备员工库 | 多 `EnrollName(50)` 字段 |
| `tblPostName` | 岗位名字典(空模板) | `No, PostName` |
| `userrec` | 用户指纹文本备份 | `UserID, Kind, FingerPrint` |
| `Paste Errors` | Excel 粘贴错误备份(VB6 遗留) | 与 Employees 同结构 |

### 2.2 考勤打卡数据（核心业务）

| 表 | 用途 |
|---|---|
| `Transactions` | **主考勤流水表**：`DeviceNo, EnrollNo, VerifyMode, InOutMode, LogDate, LogTime, UserName, ID, TempInOutMode, DeviceName, Temperature` — 是从设备拉下来的原始打卡记录（含温度，2020 年新冠后加） |
| `SuccessLogs` | 成功验证日志（与 Transactions 几乎重复，疑为旧版本） |
| `TempLogs` | 临时缓冲 |
| `AMIN / AMOUT / PMIN / PMOUT` | 按"上午/下午"分桶的进出打卡 |
| `AMINTea / AMOUTTea / PMINTea / PMOUTTea` | 茶歇打卡 |
| `OTIN / OTOUT / OTINB / OTOUTB` | 加班打卡（B = before？两段 OT） |
| `TransactionMode` | 单行汇总：In, BreakIn, BreakOut, Out, OtIn, OtOut |
| `Remarks` | 当日备注（手动填）：`EnrollNo, LogDate, Remarks` |
| `tblLogs` | **横向 45 列时间戳**(`Time1..Time45`) — VB6 时代的"每天最多 45 笔打卡"反范式表 |
| `ModeTotal` | 加班/欠时小时数累计 |

### 2.3 班次与排班

| 表 | 用途 |
|---|---|
| `Shifts` | **班次模板**(51 行)：周一至周日开始/结束、午休、Grace、加班窗口、Flexi 弹性班、`MinAdd`、`DeductLate`、按周五/六/日单独 OT 配置 |
| `TeaShifts` | 茶歇班次模板 |
| `tblShiftTime` | ARM 设备侧班次（最多 3 段时间） |
| `ChangesShift` | 排班记录（个人/日期级别覆盖） |
| `ChangesShiftBatch` | 批量排班 |
| `ChangesShiftTemp` | 待处理排班 |
| `ShiftStartTemp1` | 班次起算辅助 |
| `tblRestday` | **休息日记录** (103,210 行 — 唯一真有大数据量的表)：`EmployeeID, Logdate, Rest(bool), ComputeAs` |
| `TimeCard / TimeCardDum / TimeCardDummy / TimeCardDummy2 / TimeCardTea` | 把 Shifts 模板"展开到日"的物化结果 — 报表生成中间产物 |

### 2.4 假期与请假

| 表 | 用途 |
|---|---|
| `LeaveType` | **假期类型字典**：AL/ML/CL/HL/MT/PT/RP（数据：年假、医假、丧假、住院、产假、陪产、调休） |
| `LeaveCount` | 半天/全天小时数（"Half Day"=4，"Whole Day"=8） |
| `Leave` | 单段请假申请：LeaveID, EntryDate, EmployeeID, LDFrom, LDTo, Type, Reason, Active |
| `LeaveBreak` | 请假按天展开（与 Leave 1:N） |
| `LeaveDummy` | 报表临时（3,976 行） |
| `LeavePeriod` | 假期统计周期 |
| `LeaveWOPay` | 无薪假 |
| `NewLeave / NewLeaveBreak / tblLeave / tblLeavewoPay` | 假期余额/统计/旧版数据混杂 |
| `AnnualLeave` | 年假申请 |
| `OTRequest / OTRequestBatch / OTRequestTemp` | 加班申请审批 |
| `Holidays` | **节假日**(135 行)：HolidayName, HolidayDate, HolidayType(LHP=Long Holiday Pay, SHP=Short Holiday Pay), HolidayGroup, OTRate(2/3) |
| `HolidayDummy` | 节假日临时 |
| `OTHalfHour` | 半小时加班零头 |

### 2.5 薪资与报表

| 表 | 用途 |
|---|---|
| `NEWDTR` | **每日时薪报表** — 包含每日 InAm/OutAm/InPm/OutPm/InOt/OutOt + 计算列：CntWork, CntRestDay, CntAbsent, CntSHP, CntLHP, HrsWork, RestDayOT, HolOT, OTHrs, MorningLate, AfternoonLate, MinLate, MLHrs, UTHrs, NDiffHrs, OTNDiffHrs, NDHrs |
| `DailyTA1` | 同 NEWDTR 但更窄 |
| `PayPeriod` | 工资周期定义：PrdFrom, PrdTo, TotalDay |
| `YearPeriod` | 年度（数据：1601–9999，明显是 Access 默认占位） |
| `MonthlyPeriod / DailyPeriod / PeriodCompute` | 周期计算辅助 |
| `PayrollFormat` | 导出格式定义（UBS/SQL 等格式字串） |
| `tblExportFormat` | 导出字段映射 |
| `TransactionExportFormat` | 流水导出格式 |
| `rptAvailLeave` | 可用假期报表 |

### 2.6 设备与系统配置

| 表 | 用途 |
|---|---|
| `ConnectionSetting` | 设备连接参数：DeviceNo, Connection(Network), Comport, Baudrate, ipaddress, Devicename, Portno, Password, TimeOut, UDP — **数据示例**：`192.168.0.9:5005` |
| `AutoDownload` | **关键**：自动下载任务表 — `Deviceno, IPaddress, TimeDown, BaudRate, Version, DeviceType, HostName, PortNo, LastRun, Status` — **数据示例**：`1, 192.168.0.221, "02:26 PM", TFS30, 192.168.0.221:5005, LastRun=2022-04-04 14:26, Status="Successful"` |
| `DeviceL` | 设备位置字典 |
| `CompanyProfile / CompanyProfile1` | 公司信息 + 全局设置（DeviceType, AutoDownload bool, TimeDown, EDDaily, EHourDown, NDiffStart, NDiffEnd, DateFormat） |
| `SupervisorTable` | 系统操作员（密码字段是 Caesar 偏移：`" 52 50 57 54 49 49 53 50"`，每个数字 -1 后还原 ASCII） |
| `PWord` | 单一密码：`godislove`(明文！) |
| `SystemMasterKey` | 主授权密钥 + 有效期 |
| `Click` | 登录次数计数器（单值 = 1） |
| `Display` | 桌面背景图(OLE)（9098 行 — 是图片二进制分块） |
| `customfield` | 自定义字段(2 列) |
| `UseID / useIDBack / AvailID` | 可用 EnrollNumber 池（1–22） |
| `SYS` | **系统级 KV 配置 + 多种枚举**（详见下文） |

### 2.7 审计

| 表 | 用途 |
|---|---|
| `audit_trial` | `UserName, Transaction(操作描述文本), TimeTrans, DateTrans` — 仅记录用户/管理员动作，**不记录设备同步** |

---

## 三、SYS 表（关键枚举与配置中心）

`SYS` 表用 `(SID, GID)` 复合键存了多种字典与配置。从 122 行数据反推 GID 含义：

| GID | 含义 | 示例值 |
|---|---|---|
| 1 | OT 倍率 | 1.5 / 2.0 / 3.0 |
| 2 | LeaveType 描述（与 LeaveType 表冗余） | Annual/Medical/Absent/RPH/Marriage/Maternity/Hospitalized |
| 3, 4, 5, 13 | 各设备的连接参数（IP、端口、超时） | `192.168.0.222:5005`、`192.168.0.131`、`192.168.0.118` |
| 7 | 状态枚举 | "CE"=Contract expired |
| 11 | **设备型号字典**(关键) | `CL928 系列、CL385B/CL365A/CL918i/WE68NPLUS、CL928i/TFS30/WE-88i/WE-68PLUS/AIFace、CL618A/CL918N/CL918S` |
| 19, 20, 24, 26, 34 | 各种路径/默认值（含 `c:\Users\WEMAX\Desktop\New cases\Bakels\...`） |
| 23 | 100+ 系列条目（设备/部门启用 flag，0/1） |
| 36, 39, 40 | 时间格式 / 数值格式 | `hh:mm:ss AM/PM` |
| 38 | **HolidayGroup 字典** | Group 1–20 |
| 41 | 时间戳序列（疑似某种 last-touched 标记） |

---

## 四、关键字段语义答疑

### 4.1 `INOUT` / `InOutMode` 字段

- 在 `Transactions` / `SuccessLogs` 表中是 `Text(10)`，**没有外键 lookup 表**
- 同时还有 `TempInOutMode Text(50)`（疑为温度筛查模式：`Normal`/`HighTemp`）
- `Employees` 表里有 6 个布尔列对应：`CIMode / COMode / IFLMode / OFLMode / OTIMode / OTOMode` — **这就是 InOutMode 的枚举集合**
- 即 `InOutMode` 取值集：**`CI / CO / IFL / OFL / OTI / OTO`**（6 个）

### 4.2 `Mode` / `VerifyMode` 字段

- `Transactions.VerifyMode Text(20)`、`SuccessLogs.VerifyMode Text(10)`，无 lookup 表
- `Employees.VMode Text(50)` 默认值 `"Fp"`
- 行业惯例 + 设备 SDK：**`FP`(指纹) / `PW`(密码) / `RF`(刷卡) / `FACE`(人脸)**
- `Employees.VerifyOk Text(50)` 是验证模式优先级（如 `"FP|PW"`）

### 4.3 `TMNo` / `EnNo` / `EnrollNo` / `EMachineNumber` / `EnrollNumber`

- `tblEnroll.EMachineNumber` = 设备编号（终端机号 = TMNo）
- `tblEnroll.EnrollNumber` = 员工在设备里的注册号（即业务工号，但是 Long Integer）
- `Employees.Employeeno` Text(15) = 业务工号
- `Employees.EmployeeID` Text(50) = 系统主键（PK，全表关联用）
- `Transactions.EnrollNo` Text(50) → 关联 `Employees.Employeeno`（不是 EmployeeID！）
- `tblEnroll.FingerNumber` = 第几根手指（0-9）
- `tblEnroll.Privilige` = 用户权限（**0=普通，1=登记员，2=管理员，3=超级管理员**，标准 ZK/中控协议）

### 4.4 报表生成的 SQL JOIN 路径

从 `NEWDTR` 和 `TimeCard` 字段反推：

```
Employees (EmployeeID, Employeeno, Shift, Dept, HolidayGroup)
  ├── LEFT JOIN Shifts ON Employees.Shift = Shifts.ShiftID
  ├── LEFT JOIN Department ON Employees.Dept = Department.Department  (按名字 join，弱外键)
  ├── LEFT JOIN ChangesShift ON Employees.EmployeeID = ChangesShift.EmployeeID
  │                          AND Logdate BETWEEN Cdate AND CdateTo (覆盖排班)
  ├── LEFT JOIN Holidays ON Employees.HolidayGroup = Holidays.HolidayGroup
  │                      AND Holidays.HolidayDate = Logdate
  ├── LEFT JOIN tblRestday ON EmployeeID + Logdate
  ├── LEFT JOIN Leave/LeaveBreak ON EmployeeID + DLeave
  └── LEFT JOIN Transactions(or AMIN/PMIN/PMOUT/OTIN/OTOUT) ON EnrollNo = Employeeno + LogDate
```

注意：**没有真正的 FOREIGN KEY 约束** — schema 全是 `Long Integer / Text` 裸字段，所有 JOIN 是字符串/整数比对。VB6 + Access 的典型做法

### 4.5 "上次同步位置 / last sync timestamp"

**确认增量下载是软件层做的，不在设备**：

- `AutoDownload.LastRun DateTime` — 每个设备最后一次下载成功时间（数据：`2022-04-04 14:26`，`Status="Successful"`）
- `AutoDownload.Status Text(255)` — 下载结果文字
- `CompanyProfile.PrevHour DateTime` + `CompanyProfile.TimeDown DateTime` — 全局上次/下次定时下载时间
- `CompanyProfile.AutoDownload Boolean` + `EDDaily Boolean` + `EHourDown Text(50)` — 自动下载开关 + 频率
- 没有任何"sync cursor / offset / serial"字段 — 设备每次都是被全量拉，软件按 `LogDate >= LastRun` 在客户端去重
- `audit_trial` 中**也没有** Download/Sync/Transfer 类的事务记录（只有 User log-In / Edit Holiday / Update Profile 类管理员操作）

---

## 五、TMS 数据库设计建议

### 5.1 必须照抄/借鉴的表

| 我们 TMS 该有 | 对应 Click 表 | 备注 |
|---|---|---|
| `employees` | `Employees` | 字段精简，去掉 6 个 Mode 布尔，用 enum；`Template1..4` 改 BLOB 关联表 |
| `departments` | `Department` | 加 parent_id 支持层级 |
| `devices` | `ConnectionSetting` + `AutoDownload` 合并 | 加 `last_sync_at`、`last_sync_status`、`firmware_version` |
| `device_models` | `SYS GID=11` | 单独字典表，用 enum |
| `attendance_logs` | `Transactions` | 主流水：`device_id, employee_id, verify_mode(enum), in_out_mode(enum), punched_at, raw_payload jsonb` |
| `shifts` | `Shifts` | 字段太多需重构：拆出 `shift_days`(weekday, start, stop, lunch_start, lunch_stop, ot_start, ot_end) |
| `shift_assignments` | `ChangesShift` | 员工 × 日期范围排班覆盖 |
| `holidays` | `Holidays` | 加 `country_code`、`region` |
| `holiday_groups` | `SYS GID=38` | 1..N |
| `leave_types` | `LeaveType` | 关键字典，照抄结构 |
| `leave_requests` | `Leave` + `LeaveBreak` | 合并：`leave_request` + `leave_request_days` |
| `ot_requests` | `OTRequest` | 简化 OTRequestBatch 50+ 字段 |
| `payroll_periods` | `PayPeriod` | |
| `daily_attendance_summary` | `NEWDTR` / `TimeCard` | **物化每日 KPI** — 给报表用 |
| `audit_logs` | `audit_trial` | 加 `entity_type, entity_id, before, after`(jsonb) |
| `system_config` | `SYS` | 改单一 KV 表 |

### 5.2 可丢弃的 VB6 时代遗留

- **横向打卡表** `AMIN/AMOUT/PMIN/PMOUT/AMINTea/AMOUTTea/PMINTea/PMOUTTea/OTIN/OTOUT/OTINB/OTOUTB`（12 个表！）— 全部用单一 `attendance_logs` + `in_out_mode` 字段替代
- **横向时间戳** `tblLogs.Time1..Time45` — 严重反范式
- **多份 TimeCard 副本** `TimeCardDum/TimeCardDummy/TimeCardDummy2/TimeCardTea` — PostgreSQL 用物化视图或单一 `daily_summary`
- `Paste Errors` — Excel 粘贴错误存档
- `CompanyProfile1` — 旧版重复表
- `NewLeave/NewLeaveBreak/tblLeave/tblLeavewoPay/LeaveDummy` — 5 份假期数据冗余表
- `Display` 表（9098 行，存 OLE 图片块）— 桌面背景图
- `Click`、`AvailID/UseID/useIDBack/userrec`、`HolidayDummy`、`MonthlyPeriod`、`DailyPeriod`、`YearPeriod`、`PeriodCompute`、`Table1`、`PWord`、`SystemMasterKey` — 全是单值/工具表
- `tblEnroll`(datEnrollDat) — 设备本地缓存。但 `FPData OLE`(指纹模板) 我们要新设计 `enrollment_templates` 表存
- `datEnrollDatARM.tblPostName / tblShiftTime` — 设备本地字典，全空模板

---

## 六、通过 .mdb 拿到的事实清单（不必再问客户）

1. **设备型号矩阵**：CL 系列（CL918i/CL918N/CL918S/CL928/CL928i/CL928S/CL181/CL888/CL385B/CL365A/CL573/CL618A）、TFS30、AIFace、WE-88/WE-88i/WE-68PLUS/WE68NPLUS — 都共用同一个数据库结构
2. **协议**：TCP over `5005` 端口（默认）；也支持 UDP（`UDP` bool 字段）；老款用串口（COM port + 115200 baud）
3. **设备主动 push？** 否。客户端 CLICK 软件做定时主动 pull（`AutoDownload` 表 + `CompanyProfile.TimeDown`）
4. **增量同步实现**：客户端在自身 `LastRun` 之后做软件层去重，**设备本身不维护 sync cursor**
5. **打卡模式枚举**：6 种 — `CI / CO / IFL / OFL / OTI / OTO`
6. **验证方式枚举**：`FP / PW / RF / FACE`（默认 `Fp`）
7. **设备权限**：0=普通用户、1=登记员、2=管理员、3=超管
8. **温度筛查**：`Transactions.Temperature Double` + `TempInOutMode` —2020 年新冠后加，新设备能上传体温
9. **审计粒度**：仅 admin 操作进 audit_trial（登入、改假期、改公司资料），打卡数据流 / 设备同步 **不进** 审计
10. **马来西亚假期模板已含**：NATIONAL DAY, MALAYSIA DAY, HARI RAYA, DEEPAVALI, CHRISTMAS, CNY, VESAK, AGONG'S BIRTHDAY, AWAL MUHARRAM, NABI MUHAMMAD BIRTHDAY, THAIPUSAM, NUZUL AL-QURAN, SULTAN SELANGOR'S BIRTHDAY 等（135 条 2015–2024 年），可直接做客户初始化模板
11. **请假类型代码**：AL（年假）/ML（病假）/CL（丧假）/HL（住院）/MT（产假）/PT（陪产）/RP（调休/补休）— 每天 = 8 小时 / 半天 = 4 小时
12. **加班费率**：1.5x / 2.0x / 3.0x（`SHP=2x`，`LHP=3x`）
13. **班次特性**：支持 7 天分别配置；支持 Flexi（弹性班）、FixLength（标准时长）、Round（取整）、Lunch Length 周一独立 + 二至日各自配置；支持 OT 主时段 + B 时段（两段加班）+ 周五/周六/周日 OT 单独配置
14. **休息日是单独的表**（`tblRestday`）— 不是 `Shifts` 字段 — 是按员工 × 日期单独标的
15. **管理员密码加密**：Caesar shift -1（每位 ASCII −1，例 `52→1, 50→1, 57→8...`）— **极弱**，TMS 用 bcrypt/argon2
16. **VB6 软件作者上下文**：路径里看到 `C:\Users\WEMAX\Desktop\New cases\Bakels\01Nov2021_Meal count\tms-setup V1.0.342 - Recycle database` — 印证软件是按客户/项目魔改的（"Bakels"是马来烘焙公司客户）

---

## 七、原始 schema/数据文件位置（如需复查）

- `/tmp/mdb-analysis/schema_datEnrollDat.sql`
- `/tmp/mdb-analysis/schema_datEnrollDatARM.sql`
- `/tmp/mdb-analysis/schema_Pay_data.sql`（1316 行，全 schema）
- `/tmp/mdb-analysis/schema_Audit_Trial.sql`

源 .mdb 文件未做任何修改。
