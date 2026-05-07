# Hardware Reference Materials

供 TMS 系统对接 WEMAX 指纹打卡机使用的素材索引。

## 目标设备
- **WEMAX WE-68 PLUS**（客户已购买，主力设备）
- WE-68 / WE-88（包装上提到的同系列型号，规格差异见 photos/）
- 供应商 / 经销商：**LMT Automation Sdn Bhd**（Benny Low，名片见 `../supplier/`）

## 子目录

| 目录 | 内容 | Git 跟踪 |
|------|------|----------|
| `photos/` | 设备 / 包装 / 现场实拍。文件名按"型号_部位_角度"命名 | ✅ |
| `videos/` | 设备操作演示视频（如 WiFi 连接） | ❌（在 .gitignore） |
| `data-samples/` | 客户提供的真实考勤打卡数据样本（`.DAT` 原始 + `.txt` 解码 + master key） | ✅（仓库 private，含真实姓名时记得在外发前脱敏） |
| `manuals/` | 设备手册（含 OA Shine FP-93，作为同协议族参考） | ✅ |
| `software/` | 厂家配套 PC 软件 `tms-setup-V1.0.402.zip`（导出 / 同步用） | ❌（zip 太大，本地保留） |

## 关于 data-samples/

- `AGL_001.DAT` — 打卡机 U 盘导出原始二进制，文件头 magic 为 `ZoucqGENLOGData`，是该 OEM 系列通用日志格式。
- `AGL_001.txt` — 同次导出的文本版，列结构：

  ```
  No  TMNo  EnNo  Name  INOUT  Mode  DateTime
  ```

  - `TMNo` 终端编号（设备 ID）
  - `EnNo` 员工登记号
  - `Name` 显示名（带尾部空格 padding）
  - `INOUT` 0=进 1=出（待与厂家确认）
  - `Mode` 验证方式：`8` = 指纹，`2` = 卡 / 密码（待厂家确认完整枚举）
  - `DateTime` `YYYY/MM/DD HH:MM:SS`

  覆盖时间区间：2025-01-02 ~ 2026-04-10，约 3098 条。

- `Master_key.txt` — 供电脑端导出软件做合法性校验的 master key，**与设备 SN 绑定**，禁止外泄。

## 关于 software/tms-setup-V1.0.402.zip

厂家提供的 Windows 端管理软件安装包。在自研对接前可作为协议 / 数据格式的"灰盒"参考（可抓包、看 SQLite/Access 库结构）。
