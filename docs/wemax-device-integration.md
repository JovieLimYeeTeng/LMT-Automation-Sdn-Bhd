# WEMAX 打卡机对接指南（初版）

> ⚠️ **本文已过时（2026-05-02 标注）**
>
> 本文写于 2026-04-30，许多技术判断已被后续实测推翻：
> - "DAT 留厂家软件" → 已 100% 解出（research/04）
> - "USB 仅 2.0" → 实际 USB-A
> - "WiFi 版本未到货" → TFS30 / CL-PC3 都已实测
> - "推荐 U 盘批处理为 v1" → TFS30 已跑通 WebSocket 实时同步
>
> 当前权威文档：
> - [`2026-05-02-comprehensive-status.md`](2026-05-02-comprehensive-status.md) — 综合现状报告（master）
> - [`protocol-th900.md`](protocol-th900.md) — TFS30 协议（已闭环）
> - [`protocol-cl-pc3.md`](protocol-cl-pc3.md) — CL-PC3 协议（reverse 进展）
>
> 本文保留作历史参考，不删除。
>
> ---
>
> 编制时间：2026-04-30
> 信息来源：客户线下面谈记录、客户提供的设备 / 数据样本、公开网络资料
> 状态：**初步分析**，待拿到设备做实测后修订。

## 1. 设备身份与定位

| 项目 | 已确认值 | 来源 |
|------|---------|------|
| 客户主力型号 | **WEMAX WE-68 PLUS** | 设备实拍 + 包装 |
| 同系列 | WE-68 / WE-88 | 包装 |
| 经销商 | LMT Automation Sdn Bhd（马来西亚） | 名片 + 会议记录 |
| 厂商 | 中国 OEM，主要出口欧洲市场 | 会议记录 |
| 同源参考机 | OA Shine FP-93 / FP-93F（同 LMT 经销，规格高度相似） | LMT 官网 |
| 公开 User Manual v3.0 | **未在公网检索到**。客户处仅有纸质版（v3.0） | 网搜结果 |

**结论：WEMAX 是马来本地品牌贴牌，原厂层在中国。** 公开网络上几乎找不到具体型号的技术资料；同样格式（OA、FA、ZK 系列）的公开手册可作为协议族参考。**关键文档以"客户手中的纸质 v3.0 + 厂家提供的 Windows 软件"为准**，这是任何对接落地前必须先扫描数字化的事。

## 2. 已知硬件规格

合并三处信息源（包装实拍、LMT 类似机型、销售页）：

| 维度 | WE-68 / WE-68 PLUS（客户机） | OA Shine FP-93F（参考机） |
|------|------------------------------|---------------------------|
| 用户容量 | 1,500 | 1,000（FP-93 系列） |
| 指纹容量 | — | 3,000 |
| 记录容量 | 100,000 条 | 300,000 条 |
| 验证方式 | 指纹 / 卡 / 密码 | 指纹 / 人脸 / 密码 |
| 验证速度 | < 1 s（声明） | < 1 s |
| 屏幕 | 彩屏 500dpi | 2.8″ TFT |
| 通信接口 | **USB Host（U盘） + WiFi（仅 PLUS / 新批次）** | 仅 U盘 |
| 厂家口径 | "No Software Necessary" | "No Software Necessary" |

**重点限制**：
- **USB 仅 2.0**，不支持 3.0（写在 .gitignore 旁的 README，写代码 / 选 U盘 时记住）
- **客户当前在用的所有设备都没有 WiFi**，需向 LMT 重新订带 WiFi 版本（PDF 待办事项之一）
- **未在公开资料中发现 TCP/IP、RS-485、RS-232 接口**——意味着实时同步的可行通道只有 WiFi（如果有），否则必须走 U盘批处理

## 3. 数据导出格式（已实测客户样本）

客户提供 `requirements/hardware/data-samples/AGL_001.{DAT,txt}` 共 3098 条（覆盖 2025-01-02 ~ 2026-04-10）。

### 3.1 TXT 格式（可直接消费）

UTF-8 / ASCII，CRLF 行尾，TAB 分隔。表头：

```
No   TMNo   EnNo   Name      INOUT   Mode   DateTime
0    1      1      km        0       8      2025/05/15 08:28:25
20   1      2      benny     0       8      2025/01/02 08:56:02
21   1      3      Wanie     0       2      2025/01/02 08:56:44
```

| 字段 | 含义 | 实测取值 | 备注 |
|------|------|---------|------|
| `No` | 行号（导出时分配，跨次导出会重排） | 0–3097 | **不要用作业务主键** |
| `TMNo` | 终端机编号（同一客户多机时区分来源） | 1 | 客户多机时极重要 |
| `EnNo` | 员工 Enroll Number（设备内登记号） | 1–7 | **业务主键之一** |
| `Name` | 显示名（带尾部空格 padding） | km / benny / Wanie / Sue / Adam | 入库前 trim |
| `INOUT` | 进 / 出标记 | 0 / 1 | 待与厂家确认完整枚举 |
| `Mode` | 验证方式 | 实测见到 `2`、`8` | 推测：`8` = 指纹，`2` = 卡或密码；待确认（部分机型还会显示 `face` / `time` / `card`，本机不显示） |
| `DateTime` | 打卡时间 | `YYYY/MM/DD HH:MM:SS` | 本地时间，**无时区信息**，开发要约定为马来西亚时区（UTC+8） |

### 3.2 DAT 格式（厂家软件专用）

二进制，文件头 magic：

```
00000000: 5a6f 7563 7147 454e 4c4f 4744 6174 61   "ZoucqGENLOGData"
```

接 16-byte 头部 + 重复定长记录（每条 12 字节，看着是 `EnNo(4) + timestamp(4) + ?(4)` 的紧凑结构，待逆向）。

**结论**：
- 直接对 DAT 做协议级对接成本高、收益低（厂家加密 + 文档无、且 WE-68 的 DAT 头部不是常见 ZKTeco/FingerTec 格式）。
- **推荐路线**：在 TMS 端只接 **TXT 格式**；DAT 留给厂家配套软件做"灰盒备份 / 比对源"。
- 客户面谈里也明说"DAT 不知道是啥"，说明厂家自己都不靠它对外。

### 3.3 Master Key（不是数据加密，是软件激活）

`requirements/hardware/data-samples/Master_key.txt`：

```
11475-2295-26775-2550-AF-7905-5355-13770-0-1530
```

这是**厂家 PC 软件**（`tms-setup-V1.0.402.zip`）激活用的 master key，**与机器序列号绑定**，不是 .DAT 文件的解密 key。

**会议记录里关键事实**（`requirements/contract/2026-04-30_打卡机线下拿机器.pdf`）：
- 没有 master key 时只有 15 天试用期
- 注册 master key 入口是"隐藏页"：管理员账号不同 + 密码 = 当前电脑时间（如 1500 = 15:00）的某种动态码
- master key 过期后软件会要求"重新验证"——本质是 **联网激活** 模式

**对我们 TMS 的影响**：master key 是厂家软件的事，**与我们自研 TMS 完全无关**。我们直接吃 TXT，绕过它。

## 4. 推荐对接路线（三选一）

### 路线 A · U盘批处理（最先落地，零硬件依赖）⭐ 推荐 v1

```
[打卡机] --(用户插U盘导出 TXT)--> [U盘] --(用户上传 / 浏览器 file input)--> [TMS]
                                                                              |
                                                                              v
                                                              parse → 去重(TMNo+EnNo+DateTime) → 写库
```

**优点**：
- 0 硬件耦合，不依赖 WiFi 是否到货
- TXT 格式已知且已有 3098 条真实样本，**可立即写解析器 + 单元测试**
- 客户公司人少、行政简单，"每周插一次 U盘上传"心智成本低

**缺点**：
- 非实时（最多每天一次）
- 重复打卡的去重要靠 `(TMNo, EnNo, DateTime)` 复合唯一键

**MVP 工作量**：解析器 + 上传页 + 去重入库 + 员工映射表（EnNo ↔ 系统员工）。约 3–5 工日。

### 路线 B · WiFi 拉取（v2 增强）

等带 WiFi 的新机器到货后，先**抓包**看协议：
- 大概率是私有 TCP 协议（端口可能是 4370，这是 ZKTeco SDK 常用端口；或厂家自定义）
- 也可能是设备主动 push HTTP 到一个 webhook（少见但存在）

**先验证再投入**。在抓包确认前不写任何代码。

### 路线 C · 逆向 DAT + 替换厂家软件（不推荐）

成本极高，收益低。客户也明确表态"不需要复制原厂功能、用我们自己的方法简化"。直接放弃。

## 5. 必须找客户 / LMT 确认的事项（落地前的拦路虎）

> 这些不确认，路线 A 也不能 100% 跑通。建议在签合同前一次性问清。

1. **`INOUT` 字段语义**：0 是上班还是下班？是否所有机型一致？
2. **`Mode` 字段完整枚举**：8 = 指纹？2 = ?；其他可能值？
3. **`TMNo` 在多机部署时如何分配**：手动配？自动 DHCP？
4. **U盘导出文件命名规则**：`AGL_001.DAT` 中 `AGL` 是什么？是设备 SN 前缀还是导出批次号？多次导出会覆盖还是累加？
5. **导出是"全量"还是"增量"**：会议中提到软件支持增量下载（"用了 10 个月只下载新数据"），但**这个是软件层做的，还是设备层做的**？如果是设备层，TXT 里有没有"上次导出位置"标记？
6. **WiFi 版本订货 ETA**：客户 KM 已请 LMT 重新订；我们 v2 路线起跑点。
7. **客户期望的对接界面**：员工映射是手动维护还是 import 一次？

## 6. 当前 repo 资源对照

```
WEMAX-TMS/
├── docs/
│   └── wemax-device-integration.md      ← 本文件
├── requirements/
│   ├── TMS_handoff_factual_zero_context.md   产品需求/上下文
│   ├── 考勤软件方案.pdf                       初版方案
│   ├── contract/
│   │   └── 2026-04-30_打卡机线下拿机器.pdf    线下面谈纪要（关键）
│   ├── hardware/
│   │   ├── README.md                          硬件资料索引
│   │   ├── photos/                            设备/包装实拍
│   │   ├── videos/                            操作演示视频（gitignored）
│   │   ├── data-samples/                      AGL_001 真实数据 + Master key
│   │   ├── manuals/OA_Shine_FP-93.pdf         同源机参考手册
│   │   └── software/tms-setup-V1.0.402.zip    厂家 PC 软件（gitignored）
│   └── supplier/                              LMT 名片
└── prototype/                                 产品原型代码
```

## 7. 信息来源

- 销售页（WE-68 规格）：[timerecordermalaysia.com WE-68](https://timerecordermalaysia.com/product/we-68-wemax-fingerprint-time-attendance/)
- 同源机型：[LMT Automation OA Shine FP-93F](https://www.lmt.com.my/product/oa-shine-biometric-fingerprint-reader-facial-fp-93f/)
- 协议族参考（OA1000 V1.3）：[RS-Online OA1000 V1.3 manual](https://docs.rs-online.com/0562/0900766b814e4cc8.pdf)
- DAT 格式约定（FingerTec 同类）：[fingertectips.com DAT import](https://www.fingertectips.com/2017/09/import-user-and-attendance-record-with.html)
- WEMAX 销售对照：[itsoffice.com.my WEMAX WE-68](https://www.itsoffice.com.my/product/1843/WEMAX-Fingerprint-Time-Attendance-WE-68.html)（页面 404，仅作存档）
- 客户面谈纪要（最权威）：`requirements/contract/2026-04-30_打卡机线下拿机器.pdf`

## 8. TODO — 拿到设备后第一件事

1. **对纸质 User Manual v3.0 拍 / 扫成 PDF** → `requirements/hardware/manuals/WE-68_PLUS_user_manual_v3.0.pdf`
2. 在 PC 上跑 `tms-setup-V1.0.402.zip`，跑一次完整下载流程，**抓包**（Wireshark）记录设备 ↔ 软件的通信
3. 拿真实设备 + 厂家软件做一次 TXT 导出，比对 `AGL_001.txt` 的格式是否完全一致
4. 把"5. 必须确认事项"列成问题清单发给 Benny / KM
