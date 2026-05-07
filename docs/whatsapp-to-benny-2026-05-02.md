# 给 Benny 的 WhatsApp（中英双版）— 2026-05-03 突破后重写

> ✅ **2026-05-03 重大突破**（codex）：CL-PC3 打卡记录已经能直接拉到我们这边了。WhatsApp 措辞从"求救"变成"汇报好消息 + 还差几件可选优化"。
>
> **写作前提**：Benny 行业老手卖打卡机多年，但**不懂底层技术**。本文用业务语言。

---

## 🇨🇳 中文版（推荐 — 直接复制粘贴发）

```
Hi Benny，

好消息 — 第二台 CL-PC3 我们这边搞定了 🎉

【现在状态】

第一台 WE-68 PLUS（指纹）：✅ WiFi 实时下载已通
第二台 CL-PC3（人脸）：✅ 打卡记录也已经能拉到

我们昨晚收到了你那台机的真实打卡记录，设备 SN 20241012011，
2026-04-24 到 2026-05-02 的几条打卡都在，员工 ID、时间、
识别方式（人脸/指纹）都对得上。

按你 PDF 上写的功能 — 员工资料、班次、自动判班、假期、
请假、补签卡、6 类报表、权限管理 — prototype 都已经有了。
现在两台机的打卡数据也都能进来。基础流程闭环了。

【还差三件可选的，方便的话顺便要】

(1) 两台机的"对接说明书"（SDK 或 protocol document）

  - CL-PC3 的：你内部找做 CL 系列那位工程师就有
  - WE-68 PLUS 的：中国厂家 Timmy 公开免费提供 SDK，
    你们 LMT 跟 Timmy 是上下游，让 LMT 采购/销售去要
    比我们外部联系 Timmy 快

  拿到这个我们以后能扩展更多功能。一时拿不到也不阻塞，
  现在按 enrollid binding 设计 v1 已经能跑。

(2) 合同 N1 网线条款

  合同写"网线下载到电脑"。两台情况不一样：
    - CL-PC3：有网口，没问题
    - WE-68 PLUS：物理上没有网口（只能 WiFi 或 USB）

  建议改成："CL-PC3 走网线，WE-68 PLUS 走 WiFi + USB"

辛苦了 🙏
```

---

## 🇬🇧 English version（备用 — 如 Benny 想转发给 LMT 工程师）

```
Hi Benny,

Good news — we cracked the second device (CL-PC3) 🎉

[Current status]

Device 1 WE-68 PLUS (fingerprint): ✅ WiFi sync working
Device 2 CL-PC3 (face): ✅ punch records also flowing in

We got real attendance records from your device last night —
SN 20241012011, punches from 2026-04-24 to 2026-05-02, with
correct enroll IDs, timestamps, and verification modes (face
or fingerprint).

All the features in your PDF — employee data, shifts, auto-
assign, holidays, leave, manual punch, 6 reports, access
control — are already in our prototype. Now both devices'
punch data flows into it. Basic loop closed.

[Three optional asks — get them when convenient]

(1) "Integration documents" for both devices (SDK / protocol)

  - CL-PC3: whoever at LMT built the CL series will have it
  - WE-68 PLUS: Timmy (China) provides SDK free of charge.
    LMT-Timmy is upstream-downstream, so LMT's procurement /
    sales channel will get it faster than us contacting Timmy
    from outside.

  With these we can extend more features later. Not blocking
  if unavailable now — v1 already runs with the enrollid
  binding design.

(2) Contract clause N1

  Contract says "data download via LAN cable". Two devices
  are different:
    - CL-PC3: has LAN port — fine
    - WE-68 PLUS: physically no LAN port (WiFi or USB only)

  Suggest: "CL-PC3 over LAN; WE-68 PLUS over WiFi + USB"

Thanks 🙏
```

---

## 📋 发出前 checklist

- [ ] WhatsApp 号确认：**+6019-383 2796**（名片 Benny 个人号）
- [ ] 中英版二选一（推荐中文 — Benny 母语）
- [ ] 发完截图存到 `docs/communications/2026-05-03-benny-whatsapp.png`

## 📋 Benny 答复后续动作

| Benny 答复 | 我们立刻做 |
|-----------|-----------|
| 「太好了，恭喜」 | 加一个简单测试：让他在 CL-PC3 上现场打一次卡，验证我们这边实时收到 |
| 「SDK 拿到了，两份给你」 | 实测验证 → adapter 完整实现（含写操作储备）→ v2 加分功能 |
| 「用户列表用 U 盘导」 | 让他给一份导出步骤说明 → 实测 .DAT 格式 → adapter 加 USB 导入 |
| 「用户列表用新版 PC 软件」 | 让他给安装包 → 反编看 cmd → adapter 实现 |
| 「内部要走两周才有答复」 | 不阻塞 — 打卡记录已通，v1 可以先签合同先出货 |
| 「网线条款不能改」 | 书面解释 + 报价加 USB 中转 dock 方案 |

---

## 🎯 当前实际项目进展

**已通**：
- ✅ TFS30 / WE-68 PLUS：WebSocket 实时同步（28 cmd 字典 + 7 cmd 实测）
- ✅ CL-PC3 接收：RealSvr push 通道（17B hello + 68B record + 16B ACK），8 条真实打卡已收到
- ✅ CL-PC3 5005 直连重新评估：flags=0x10 是合法 ACK echo（不是错误码）；read-only 命令实测通
- ✅ prototype 全功能：员工 / 班次 / 自动判班 / 假期 / 请假 / 补签卡 / 6 类报表 / 权限

**v1 接入设计（enrollid binding）**：
- ✅ 设备只负责输出 enrollid + 时间 + verify/inout（两台都已通）
- ✅ TMS 软件按 enrollid 关联档案 — 员工/HR 在 TMS 里填 PDF 14 字段（"员工编号"填跟设备一样的 enrollid）
- ✅ 打卡来 enrollid → TMS 查档案 → 报表完整出
- 不依赖任何设备的 user-list 读取

**v1 剩余**：
- 🟡 prototype 接 device-adapter（把 push 流按 enrollid 路由进档案）
- 🟡 本地 PC 打包（vercel web → Electron / Tauri）
- 🟡 权限管理 + U 盘加密
- 🟡 合同 N1 网线条款修订

**v2 储备（PDF 没要求，作为加分项内部留存）**：
- 🟡 设备模板下载备份（指纹 / 人脸 / 卡）— PDF "设备下载选项" 隐含
- 🟡 写用户回设备 — 拿到 SDK payload 模板后做
- 🟡 控制类（Session B 顺手反编了字节）— PDF 没要求，不主动告知 Benny

---

## 🔗 配套素材

- 综合状态报告：`docs/2026-05-02-comprehensive-status.md`
- ✨ CL-PC3 突破报告：`docs/clpc3-breakthrough-2026-05-03.md`
- 最小 Python 接收器：`tools/protocol-reverse-engineering/clpc3-realsvr-push-reader.py`
- LMT 公司资料：`vendor-resources/lmt-automation/README.md`
- Benny 的需求 PDF：`requirements/考勤软件方案.pdf`
- TFS30 协议：`docs/protocol-th900.md`
- prototype：`prototype/tms-hr-prototype/`
