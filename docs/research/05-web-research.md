# Research Report 05 — Web 深度调研（Riss / Hysoon / CLICK）

> ⚠️ **OEM 结论已被推翻（2026-05-02 标注）**
>
> 本文当时推断 OEM 链是 "Realand + Hysoon 双链"。实测后已确认：
> - **TFS30 真厂家是 Shenzhen Union Timmy Technology**（深圳市友联天美），协议是 Timmy WebSocket+JSON v2.1
> - Realand / Hysoon 等线索来自 LMT **重打包后的 PC 软件**遗留组件，不是设备真厂家
>
> 本文反编 LMT 老软件 V1.0.402 中的协议代码（Realand Zd2911 协议族 0xA55A 包头），与设备实际协议（CL-PC3 是 Click Protocol B `55 AA + 79 19`，TFS30 是 WebSocket）**没有直接关系**。
>
> 当前权威：[`../protocol-th900.md`](../protocol-th900.md) + [`../protocol-cl-pc3.md`](../protocol-cl-pc3.md)
>
> 本文保留作历史参考，不删除。
>
> ---
>
> Agent: web-research (general-purpose)
> 执行时间: 2026-04-30
> 关键发现：**OEM 链彻底打开 + GitHub 上有完整开源代码可直接 fork**

---

## 0. 关键结论 (TL;DR)

调研把"马来西亚 LMT 经销的 CLICK PC + WEMAX WE-68 PLUS"的中国 OEM 链彻底打开。**它不是单一厂家，而是两条并行的 OEM 供应链拼成的：**

1. **Realand (广州现代) — Riss.Devices.dll** [官方+社区]
   - `Riss.Devices.dll` 是 **Guangzhou Realand Information Technology Co., Ltd.** 的官方 .NET SDK，对应 **ZDC2911 / RL10079** 系列控制板
   - 公开 SDK 完整可拿，含 C# / VB6 / VB.NET / Delphi / C++ 五种语言 demo
   - GitHub 上有完整的中/越文 API 指南 + 多个生产级集成项目

2. **Hysoon (广州浩顺) — FK623Attend.dll / FKAttend.dll / FKNet300.dll / TMPCCOMM.dll** [官方+社区]
   - **FK 系列 88 个型号全部是浩顺**（FK623, FK625OF, FK635, FK725, FK735, FK825, FK833, FOW305, HS001-105 ...）
   - 公司全名：**Guangzhou Hysoon Electronic Co., Ltd.**（1995 年成立，2005 进入生物识别）

3. **WEMAX WE-68 PLUS / CLICK CL-918 / LMT** = 马来西亚下游品牌；底层硬件来自浩顺 FK 系列（彩屏、1500 用户对应 `FK635` 或 `FK725HS` 子型号），CLICK PC TMS 软件因此 **同时绑定** Riss.Devices + FK623Attend 两套 SDK，因为 LMT 同时分销 Realand-OEM 和 Hysoon-OEM 机型

4. **`ZoucqGENLOGData` magic** [推测] 没有任何公开文献提到，但 **这是浩顺 (Hysoon) USB 导出的 .DAT 文件标识**——`GENLOGData` = "General Log Data" 与 SDK API `FK_GetGeneralLogData` / `FK_USBLoadGeneralLogDataFromFile` 直接对应

5. **绕过 CLICK PC 完全可行**：拿到 Riss.Devices.dll + 浩顺 FK623Attend.dll + 公开的样板代码即可直接对接，最快 1-2 周可做出独立采集服务

---

## 1. P0 调研结果

### 1.1 Riss.Devices SDK 公开身份 [官方]

**真身：Guangzhou Realand Information Technology Co., Ltd. 的 .NET SDK**

| 项目 | 值 |
|------|-----|
| 文件 | `Riss.Devices.dll` (1.0.0.2069 / 1.0.0.2077) |
| ProductName | `Riss.Devices` |
| Vendor | Realand (广州现代) |
| 官方 SDK 入口 | https://www.realandtec.com/download/sdk-download_c0005 |
| 历史下载 | http://www.realandbio.hk/download/sdk/RL10079DesktopDemo_20151021.rar |
| 主要型号 | ZDC2911 + RL 系列控制板 + A-Cxxx / A-Lxxx / A-Fxxx / M-Fxxx / G-Mxxx |
| 公司名 | Guangzhou Realand Information Technology Co., Ltd. |
| 成立 | 2008 年 |

**没有公开 NuGet 包**，但 **GitHub 有完整社区镜像 + 中越文 API 指南**：

| GitHub 资源 | 价值 |
|-----|----|
| **`hoangh-e/ZDC2911_Demo`** ([repo](https://github.com/hoangh-e/ZDC2911_Demo)) | 完整 RL10079DesktopDemo_20151021 镜像，**含 Riss.Devices.dll 的 C# / VB6 / VB.NET / Delphi / C++ 五种 demo** + 1.3MB 官方 PDF "ZD2911 User Guide-en.pdf" |
| **`hoangh-e/BHK_Retrieval_Attendance`** ([repo](https://github.com/hoangh-e/BHK_Retrieval_Attendance)) (MIT 协议, .NET 8 WPF, 2026-03 还在维护) | 含 `docs/Riss.Device_Guide.md` —— **目前互联网上能找到的最完整 Riss.Devices SDK API 中文/越南文文档** |
| **`aindong/biometrics_server`** ([repo](https://github.com/aindong/biometrics_server)) | 早期生产级 WinForms 集成，含 Real-Time UDP 监听 demo |
| **`TharakaMadushan/AttendanceSolution.WindowsApplication`** ([repo](https://github.com/TharakaMadushan/AttendanceSolution.WindowsApplication)) | C# WPF + Riss.Devices 完整生产代码 |
| **`FelipeHJBastos/coletor35`** ([repo](https://github.com/FelipeHJBastos/coletor35)) | 巴西人写的小型采集器，可参考最小集成 |

**协议特性（已从社区文档+demo 反推）**：
- `Device.ConnectionModel = 5` (ZD2911 系列固定)
- `CommunicationType` = Serial=0 / Tcp=1 / Usb=2
- TCP 模式下默认走 `IpAddress + IpPort`，**没有固定端口号** —— 由用户在设备菜单中设置（典型 5005 / 4370）
- 实时监听走 **UDP** (`Monitor.Mode = 0` UDP, `Mode = 1` RS485)，端口由 `Monitor.UDPPort` 指定
- 指纹模板长度固定 **498 字节**，每用户最多 10 指
- DIN (UInt64) 是用户 ID，最多 18 位十进制
- 实体类完整列表：`Device, User, UserExt, Enroll, Record, Monitor`
- 操作类：`DeviceConnection.CreateConnection(ref Device)` → `.Open()` 返回 >0 即成功

**英文 SDK 文档**：`hoangh-e/ZDC2911_Demo/RL10079DesktopDemo/ZD2911 User Guide-en.pdf` (1.3MB，官方原版) — 直接 `gh` 下载即可

### 1.2 `ZoucqGENLOGData` magic 的来源 [推测]

**搜索结论**：GitHub / Stack Overflow / FingerTec / 任何公开技术博客 **均无任何字面匹配**

**最合理推断**：
- `GENLOG` ↔ Hysoon SDK 的 `FK_GetGeneralLogData` / `FK_USBLoadGeneralLogDataFromFile` API
- `ZoucqGENLOGData` 应当是 **浩顺机型导出 USB .DAT 文件的 magic header**（不是 Realand 的）
- 后续若要解析 .DAT，应直接 reverse `FKAttend.dll` / `FKViaDev.dll` 的 `FK_USBLoadGeneralLogDataFromFile` 函数

**没有人写过开源解析器** —— GitHub 全文搜确认空集。但更可行的路径是：让设备在线，用 SDK pull 数据，跳过文件格式问题

### 1.3 CLICK Biometric / CL-918 系列厂家身份 [社区]

| 型号 | 中国 OEM 厂家 | 证据 |
|------|--------------|------|
| CL-918A | **不确定** —— 单色屏老款，可能是浩顺早期 FK623OF1 (`FileVer=PS_HTML, MaxUser=1000`) 或 Realand A-C031 类的 1000 用户单色机 | 规格匹配 Hysoon `FK623OF1` |
| CL-918i | **浩顺 / Hysoon** 的人脸+指纹门禁机改贴牌 | 1:1/1:N、500dpi、TFT 彩屏 = Hysoon 主流 SKU |
| WEMAX WE-68 PLUS | **浩顺 FK635 系列**（彩屏，1500 用户，typical FK635OF3 / FK635OFC / FK635OF_XML 子变种） | `FKModelDic.ini` 里 `Color=1, MaxUser=3000-10000` 匹配 |

**欧洲出口品牌**：浩顺主要走 **Hysoon** 自有品牌进西班牙/拉美（VisioTech Security 西班牙官方分销 / Orbita Digital），型号会改名 HY-AC010 / HY-C280A 等。CLICK 是 **马来西亚区域专属 SKU**

**Alibaba 直查**：
- Hysoon 官店：https://hysooncn.en.alibaba.com/ + https://hysoon1.en.alibaba.com/
- Hysoon 官网：http://www.hysoon.com/about.php (英) / https://www.hsun.cn/ (中)
- Hysoon 中文公司全名：**广州浩顺电子有限公司**，2002 年成立，1995 起源做马达，2005 进入生物识别
- Hysoon 国际接洽邮箱：info@hsun.cn / 浩顺中文热线 400-700-0202
- Realand：https://realand.en.made-in-china.com/ + https://realandtec.com (官网)

---

## 2. P1 调研结果

### 2.1 FKNet300 / FKRS300 / 浩顺协议 [社区]

**确认厂家**：广州浩顺 (Hysoon)。**完整 SDK 名 = HSSDK = 浩顺标准 SDK**

完整 DLL 树（从 GitHub `Yaswanth-Vempuluru-7916/biomax_security` 仓库 `Execute&Dll/` 目录萃取）：

| DLL | 作用 |
|-----|------|
| `FK623Attend.dll` (42KB) | 主考勤 API（即使型号是 FK625/FK725，文件名仍叫 FK623Attend） |
| `FKAttend.dll` (2.1MB) | 大型考勤库 |
| `FKViaDev.dll` (1.65MB) | 设备底层通信 |
| `LFWViaDev.dll` (1.65MB) | 多语言变体 |
| `FpDataConv.dll` | 指纹模板转换 |
| `FaceDataConv.dll` | 人脸数据转换 |
| `FKPwdEncDec.dll` | 密码加解密 |
| `RealSvrOcxTcp.ocx` (1.7MB) | TCP 实时事件 OCX |
| **`FKModelDic.ini`** | **关键文件 — 88 个 firmware 名 → MaxUser/MaxFont/Color/FpVer 全表** |
| `datEnrollDat.mdb` | 默认 Access 数据库模板 |
| `Newtonsoft.Json.dll` | 报文 JSON 编码 |

**P/Invoke 完整签名（C#）** — 来自 `Yaswanth-Vempuluru-7916/biomax_security/Samples/FK623Attend/c#/FKAttendDLL.cs`：

```csharp
[DllImport("FK623Attend.dll", CharSet = CharSet.Ansi)]
public static extern int FK_ConnectNet(int anMachineNo, string astrIpAddress,
    int anNetPort, int anTimeOut, int anProtocolType, int anNetPassword, int anLicense);

[DllImport("FK623Attend.dll", CharSet = CharSet.Ansi)]
public static extern int FK_ConnectComm(int anMachineNo, int anComPort, int anBaudRate,
    string astrTelNumber, int anWaitDialTime, int anLicense, int anComTimeOut);

[DllImport("FK623Attend.dll", CharSet = CharSet.Ansi)]
public static extern int FK_ConnectUSB(int anMachineNo, int anLicense);

[DllImport("FK623Attend.dll", CharSet = CharSet.Ansi)]
public static extern int FK_LoadGeneralLogDataByDate(int anHandleIndex,
    DateTime anStartDateTime, DateTime anEndDateTime);

[DllImport("FK623Attend.dll", CharSet = CharSet.Ansi)]
public static extern int FK_GetGeneralLogData(int anHandleIndex,
    ref UInt32 apnEnrollNumber, ref int apnVerifyMode, ref int apnInOutMode,
    ref DateTime apnDateTime);
// ... 100+ 个 API 全部在 FKAttendDLL.cs (MIT-friendly to copy)
```

**TCP 默认端口**：socially-known 是 **5005**（浩顺、Realand 两家共用习惯），不是 ZK 的 4370。设备端可改

**浩顺协议特点**：
- 走自家二进制协议，但 SDK 内嵌 Newtonsoft.Json → 推测某些命令（如设备状态心跳、监控事件）走 JSON 包装；指纹模板/历史日志走二进制
- 实时数据需要 OCX：`FKRealSvr.ocx` 监听设备主动推送

### 2.2 FK 系列 88 型号全部清单 [官方]

`FKModelDic.ini` 列出的 88 型号按系列分组：

| 系列 | 数量 | 代表型号 | 特征 |
|------|------|---------|------|
| FK254 | 1 | FK254HS20 | HS 系列 |
| FK533 | 1 | FK533FFI3 | FFI = 人脸+指纹 |
| FK60x / FK62x / FK63x | ~14 | FK605OF, FK623OF1, FK625OF, FK625OF5/10/30, FK625OFC, FK633OF1, FK635FFI3/10, FK635OF3/10, FK635OF_BS/_XML, FK635OFC, FK635OR3/50 | OF = 光学指纹+办公；OR = Real-time log；OFC = + Color；FFI = 人脸+指纹 |
| FK72x / FK73x / FK74x / FK75x | ~22 | FK725HS1/3/15, FK735HS0/2/3/J2/K2/C/HL2, FK744HS1/2 | HS = 高端系列（彩屏+网络）。**WE-68 PLUS 与 1500 用户彩屏对应 FK725HS1 / FK735HS2 区段** |
| FK82x / FK83x / FK85x | ~13 | FK823OF/wOF, FK825OF/wOF, FK833OF/wOF, FK853xOF | x/w 后缀是变种 |
| FOW 系列 | 4 | FOW305, FOW638FFi3, FOW665OF3, FOW675OF3 | 旧型号 |
| HS 系列 | 7 | HS001 - HS105 | Hysoon 标准短码 |
| WS / IFKL / OP / FAK | ~10 | WS306Ax_Comix, IFKLOF001, FAK401FFi03 等 | OEM 异型号 |

电商验证：浩顺 Alibaba 官店主推 **C/F/G 系列**；**FK 系列是 OEM 渠道型号**，正常零售页面看不到，证明 LMT/CLICK/WEMAX 是浩顺给海外经销商的 ODM 定制贴牌

### 2.3 macOS 反编译 .NET 的工具 [官方]

| 工具 | 安装命令 | 适用 |
|------|---------|------|
| **`ilspycmd`** (推荐) | `dotnet tool install -g ilspycmd` | 已确认 dotnet 在你机器上，命令：`ilspycmd -p -o ./out Riss.Devices.dll` 即得到完整 C# 反编译项目 |
| **AvaloniaILSpy** ([repo](https://github.com/icsharpcode/AvaloniaILSpy)) | 下载 macOS .app | 跨平台 GUI |
| **dnSpy** | ❌ 仅 Windows | macOS 没有原生版 |
| **`monodis`** | `brew install mono` | mono 自带的 IL 反汇编 |
| **`pefile` (Python)** | `pip install pefile` | 提取 PE/.NET metadata |

**最快路径**：
```bash
dotnet tool install -g ilspycmd
ilspycmd -p -o ./decompiled Riss.Devices.dll
# 之后用 VSCode 打开 ./decompiled/ 即可看到完整 C# 源码
```

ILSpy 是 MIT 协议；**但反编译别人的商用 SDK 用于绕过授权可能引起合同/版权风险**（如果只是为了看 API 参数细节、不分发反编译代码，一般实务可接受）

---

## 3. P2 调研结果（ZK 协议家族对照）

| 库 | GitHub | 能否直接用于 FK / Riss |
|-----|--------|----------------------|
| **`pyzk`** | [fananimi/pyzk](https://github.com/fananimi/pyzk) | **❌ 不能直接用** —— 浩顺 / Realand 用的是不同协议。但 ZK 与浩顺/Realand 在 packet header 层面有相似度，可作参考 |
| **`zk-protocol`** | [adrobinoga/zk-protocol](https://github.com/adrobinoga/zk-protocol) | 同上 |
| **`node-zklib`** | [caobo171/node-zklib](https://github.com/caobo171/node-zklib) | ❌ |
| **Anviz Python** | [coyotevz/anviz](https://github.com/coyotevz/anviz) | ❌ |

**关键判断**：FK 系列 / Riss.Devices **不是 ZK 协议**。pyzk / node-zklib 不能直接对接。但 **Realand 和 Hysoon 的 SDK 本身已开源 demo 完整可用**，所以也不需要去写 pyzk 的 wrapper

---

## 4. 我们能直接拿来用的开源代码清单

### 一类：直接对接 WEMAX/CLICK/FK 设备的 P0 项目

| Repo | 价值 | 协议 |
|------|-----|------|
| **[hoangh-e/ZDC2911_Demo](https://github.com/hoangh-e/ZDC2911_Demo)** | **Realand 官方 SDK 完整镜像** + 五种语言 demo + 1.3MB 英文用户手册 PDF | C# |
| **[hoangh-e/BHK_Retrieval_Attendance](https://github.com/hoangh-e/BHK_Retrieval_Attendance)** (MIT) | **目前互联网最完整 Riss.Devices API 中文/越文文档** + 现代 .NET 8 WPF Clean Architecture | C# / .NET 8 |
| **[Yaswanth-Vempuluru-7916/biomax_security](https://github.com/Yaswanth-Vempuluru-7916/biomax_security)** | **完整浩顺 HSSDK 完整二进制镜像** + `FKModelDic.ini` 88 型号清单 + C# P/Invoke 全部签名 | C# |
| **[AkshadGawde05/CMS-deploy](https://github.com/AkshadGawde05/CMS-deploy)** (BiomaxBridge 子目录) | **生产级 ASP.NET Core 服务**，把 FK623Attend.dll 包装成 HTTP 微服务（/device/connect, /device/logs）。**这就是我们想要的"绕过 CLICK PC 软件"的现成参考架构** | C# / .NET Core |
| **[AliRezaKhazaeiNezhad/NovinPardaz_Device_Connector](https://github.com/AliRezaKhazaeiNezhad/NovinPardaz_Device_Connector)** (MIT) | 伊朗人写的 Hysoon FK623Attend C# wrapper，2026-01 更新 | C# |
| **[Joshua-LP/Servidor-lima-international-school-of-tomorrow](https://github.com/Joshua-LP/Servidor-lima-international-school-of-tomorrow)** | 含 `api_tas/`, `api_realsvr/`, `api_fpclock/` 三种调用法（FKAttend / FKRealSvr / FP_CLOCK + TMPCCOMM + CH375DLL），覆盖**老/新机型全部三种通信方式** | PHP + .NET |
| **[andylah/Fenger32](https://github.com/andylah/Fenger32)** | **Python 版 FK623Attend.dll 调用**（pyinstaller spec 已配） | Python |
| **[h-devs/fk623](https://github.com/h-devs/fk623)** | 官方 FK623Attend ReadMe 镜像 | VBA |
| **[mkranga/FKAttend](https://github.com/mkranga/FKAttend)** | C# winform，完整 frmEnroll/frmLog/frmNetInfo 等 UI；含 `FKAttend.dll` 二进制 | C# |
| **[FelipeHJBastos/coletor35](https://github.com/FelipeHJBastos/coletor35)** | 巴西版 Riss.Devices C# 最小集成 | C# |
| **[TharakaMadushan/AttendanceSolution.WindowsApplication](https://github.com/TharakaMadushan/AttendanceSolution.WindowsApplication)** | C# WPF Riss.Devices 实战 | C# |
| **[aindong/biometrics_server](https://github.com/aindong/biometrics_server)** | C# WinForms Riss.Devices + UDP 实时事件监听 | C# |

### 二类：ZK 家族对照参考

| Repo | 用途 |
|-----|------|
| **[adrobinoga/zk-protocol](https://github.com/adrobinoga/zk-protocol)** | ZK 协议白皮书（最详细的二进制 packet 格式描述） |
| **[fananimi/pyzk](https://github.com/fananimi/pyzk)** | Python ZK 实现 |

### 三类：macOS 工具

| 工具 | 用途 |
|-----|------|
| **[icsharpcode/ILSpy](https://github.com/icsharpcode/ILSpy)** + `dotnet tool install -g ilspycmd` | macOS 上反编译 Riss.Devices.dll / FK*.dll |

---

## 5. 还需要客户/经销商提供的清单（精简版）

只有当上面 GitHub 资源**还不够**时才去要这些：

1. **现场设备截图 / 视频**：开机 LOGO 是 WEMAX 还是 CLICK 还是 Hysoon？设备菜单 → "关于本机" / "About" / "系统信息" 显示的 firmware version（应该会出现 `FK625OF`, `FK635OF3`, `FK725HS1` 这种字符串）。**有了这一个字符串，就能在 `FKModelDic.ini` 里精确定位 SKU**
2. **设备网络配置截图**：菜单 → 网络/通信 → 服务器 IP + 服务器端口 + 同步传输是否开启
3. **设备背面贴纸**：写有真正的 model code 和 S/N
4. **CLICK PC 软件的安装包压缩文件**：`C:\Program Files (x86)\CLICK\TMS\` 整个目录（**已拿到** `tms-setup-V1.0.402.zip`）
5. **一份现成的 .DAT 文件**：用 USB 从设备导出真实考勤数据（**已拿到** `AGL_001.DAT`）
6. **设备序列号 + 浩顺/Realand 联系**（可选）：通过 LMT 关系直接找浩顺 info@hsun.cn 或 Realand sales@realandtec.com

---

## 6. 推荐落地路径（2 周方案）

| 阶段 | 工作 | 时间 |
|------|------|------|
| **D1-D2** | 让客户拷贝 `C:\Program Files (x86)\CLICK\TMS\` 整个目录 → 用 ilspycmd 反编译 Riss.Devices.dll | 2 天（已完成，本研究产物） |
| **D3-D5** | fork [`hoangh-e/BHK_Retrieval_Attendance`](https://github.com/hoangh-e/BHK_Retrieval_Attendance)，剥离 SharePoint 部分，改成 DuoCode 自己的 ASP.NET Core HTTP 服务 | 3 天 |
| **D6-D8** | 加 P/Invoke 包装 FK623Attend.dll（参考 [`Yaswanth-Vempuluru-7916/biomax_security`](https://github.com/Yaswanth-Vempuluru-7916/biomax_security) 的 `FKAttendDLL.cs`） — 因为 CLICK 同时绑定两套 SDK，我们也都包一遍，运行时根据设备 firmware 自动路由 | 3 天 |
| **D9-D10** | 真机联调：先 TCP pull 用户 + 历史日志；再 UDP 监听实时事件；最后写用户 / 删用户 / 同步指纹模板 | 2 天 |
| **D11-D14** | 加 .DAT 文件离线导入（调用 `FK_USBLoadGeneralLogDataFromFile`），单元测试，部署文档 | 4 天 |

**关键约束**：浩顺 + Realand SDK 都是 **Windows-only x86 native DLLs**。**最稳的工程做法是单独跑一台小型 Windows 工控机做"设备 Adapter"，对外暴露 HTTPS+JSON API，让 DuoCode 主系统在 Linux/云上无忧调用**

---

## 7. 信息可信度速览

| 结论 | 可信度 |
|------|--------|
| Riss.Devices.dll = Realand SDK | [官方+社区双重确认] |
| FK 系列 88 型号全部 = Hysoon | [官方 — FKModelDic.ini 自证] |
| WEMAX/CLICK = Hysoon FK 系列贴牌 | [社区+推断；规格匹配] |
| ZoucqGENLOGData = Hysoon .DAT magic | [推测；已说明推理链] |
| TCP 默认端口 5005 | [社区惯例；需现场确认] |
| 浩顺成立时间 1995/2002/2005 | [官网三处不同；2002 可能是公司转型生物识别后注册] |
| pyzk/node-zklib 不能直接用 | [推断 — 协议不同族] |

---

## 8. Sources

- [Realand 官方 SDK 下载](https://www.realandtec.com/download/sdk-download_c0005)
- [Hysoon 官网](http://www.hysoon.com/about.php) / [浩顺中文官网](https://www.hsun.cn/)
- [hoangh-e/BHK_Retrieval_Attendance Riss.Device Guide](https://github.com/hoangh-e/BHK_Retrieval_Attendance/blob/main/BHK_Retrieval_Attendance.Project/docs/Riss.Device_Guide.md)
- [hoangh-e/ZDC2911_Demo](https://github.com/hoangh-e/ZDC2911_Demo)
- [Yaswanth-Vempuluru-7916/biomax_security](https://github.com/Yaswanth-Vempuluru-7916/biomax_security)
- [AkshadGawde05/CMS-deploy/BiomaxBridge](https://github.com/AkshadGawde05/CMS-deploy)
- [Riss.Devices.dll 元数据](https://www.pconlife.com/viewfileinfo/riss-devices-dll/)
- [adrobinoga/zk-protocol](https://github.com/adrobinoga/zk-protocol)
- [fananimi/pyzk](https://github.com/fananimi/pyzk)
- [icsharpcode/ILSpy](https://github.com/icsharpcode/ILSpy)
