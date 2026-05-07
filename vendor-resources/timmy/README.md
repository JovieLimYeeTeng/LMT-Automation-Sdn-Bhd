# Vendor Resources — Shenzhen Union Timmy Technology Co., Ltd.

设备真实厂家公开资料合集（2026-04-30 拉取）。

## 厂家信息

| 项 | 值 |
|---|---|
| 中文名 | **深圳市友联天美科技有限公司** |
| 英文名 | **Shenzhen Union Timmy Technology Co., Ltd.** |
| 品牌 | **TIMY**（"Biometrics Identification SINCE 2000"） |
| 成立 | 2000 年（25 年厂家） |
| 工厂规模 | 2,500 m²，~100 员工，国家高新技术企业 |
| 出口 | 70+ 国家 |
| 资质 | ISO9001 / CE / FCC / RoHS |
| 官网 | https://sztimmy.net |
| B2B | https://sztimmy.goldsupplier.com |
| SDK 下载页 | https://sztimmy.net/downloads/software-development-kitsdk |

**关键宣称**（来自他们 2024 catalog 原文）：
> "Our Desktop and Cloud software are **free** as well as our **device SDK** that you can use to integrate with your existed system."

→ **SDK 公开免费**，写操作 cmd 探索受阻时直接邮件 Timmy 索要。

## 与本项目的关系

客户买的设备 **WEMAX WE-68 PLUS** 实际上是 LMT Automation（马来西亚经销商）从 Timmy OEM 贴牌的产品：

| 命名层 | 名字 |
|--------|------|
| 客户使用名 | WEMAX WE-68 PLUS |
| LMT 销售名 | WE-68 PLUS（WEMAX 是 LMT 自己的销售品牌）|
| Timmy 产品型号 | **TFS30** |
| Timmy 内部固件代号 | **TH900**（设备屏 `Soft: TH900_click V5.0`，`_click` 是 LMT 定制后缀） |

## 子目录

### `manuals/`  ✅ 入 git

| 文件 | 大小 | 内容 |
|------|------|------|
| `timmy-device-user-manual-EN.pdf` | 618 KB | **设备硬件用户手册（英文版，18 页）**。客户原本只有中文纸质 v3.0；这份是更全的英文电子版。重点章节：§5 User、§6 Shift、§10 Data Mgt（U盘文件命名 GLG_001/AGL_001）、§11 Communication（含 Server 配置、Heart beat、Server approval 等关键字段定义）。 |
| `timmy-attendance-pc-software-manual-EN.pdf` | 1.9 MB | Timmy 自家 PC 软件用户手册（不是 LMT 改的 CLICK 软件）。涵盖 HR System、Attendance System、Shift Pattern、Holiday、Leave Registration 等业务模型，可作为 TMS 业务功能参考。 |

### `catalog/`  ❌ gitignore（文件 >5MB，本地保留）

| 文件 | 大小 | 内容 |
|------|------|------|
| `timmy-product-catalog-2024-EN.pdf` | 17 MB | Timmy 全产品 catalog（28 页）。含所有型号：AI Face Recognition、Facial Terminal、Access Control、Attendance、Smart Lock 等。如客户后续要采购人脸/门禁等其他型号，参考这本。 |
| `timmy-company-profile-CN.pdf` | 20 MB | 中文公司介绍册。 |

> 这两个文件随时可以从 https://www.sztimmy.net/u_file/2401/file/09/2832bedfdb.pdf 等 URL 重新下载。

### `protocol-spec/`  ✅ 官方规范全文已入库

**`timmy-websocket-json-protocol-v2.1.pdf`** + 同名 `.txt`（31 页，纯文本 1415 行）

- 来源：Scribd 用户 Phan Thanh Nhàn 上传副本（已下载到本仓库）
- 内容：Timmy 内部官方协议规范 v2.0（文档名标 2.1），作者 Chingzou
- 覆盖：**28 个 cmd 完整 request/response payload + reason 错误码 + backupnum 字典 + verifymode 枚举 + door event 枚举**
- 版本演进：2016-03 v1.0 → 2021-02 v2.0，9 次迭代

完整对照分析见 [`docs/protocol-spec-analysis.md`](../../docs/protocol-spec-analysis.md)，里面有：
- 我们实测 7 个 cmd vs 官方文档一致性对照
- 自相矛盾的字段（如 `mode`）如何取舍
- 写操作 cmd 完整字典 + 危险等级
- 必须更新到 prototype/types.ts 的字段清单
- v1/v2/v3 实施优先级（按合同范围）

**SDK 包仍可向 Timmy 索取**（含示例代码），见 [`email-draft-to-timmy.md`](email-draft-to-timmy.md)，但 v1 落地已不再阻塞。

## 如何重新下载所有资源

```bash
# 在仓库根目录跑
mkdir -p vendor-resources/timmy/{manuals,catalog}

# 设备硬件手册
curl -L -o vendor-resources/timmy/manuals/timmy-device-user-manual-EN.pdf \
  https://www.sztimmy.net/u_file/2104/file/5b1af573af.pdf

# PC 软件手册
curl -L -o vendor-resources/timmy/manuals/timmy-attendance-pc-software-manual-EN.pdf \
  https://www.sztimmy.net/u_file/2105/file/4693419969.pdf

# 产品 catalog
curl -L -o vendor-resources/timmy/catalog/timmy-product-catalog-2024-EN.pdf \
  https://www.sztimmy.net/u_file/2401/file/09/2832bedfdb.pdf

# 中文公司资料
curl -L -o vendor-resources/timmy/catalog/timmy-company-profile-CN.pdf \
  https://www.sztimmy.net/u_file/2308/file/25/13ab2bede8.pdf
```
