# 给 Timmy 的英文邮件 — 可直接复制粘贴

> **收件人**：`info@timyteco.net`
> **备用电话**：+86-755-83875070
> **公司**：Shenzhen Union Timmy Technology Co., Ltd.
> **地址**：3rd Floor, Building A5, Silicon Valley Power Qinghu Park, Dahe Road, Qinghu Community, Longhua District, Shenzhen, Guangdong, China

---

## 🇬🇧 English version

**Subject**:
```
Request for TFS30 / TH900 SDK and WebSocket Protocol Specification
```

**Body**:
```
Dear TIMY Team,

We are DUOCODE TECHNOLOGY, a software development company with teams
in Malaysia and China. We are currently building a custom Time
Management System (TMS) for our client in Malaysia who has purchased
two of your terminals to integrate with their own attendance system:

  - TIMY TFS30 (firmware: TH900_click V5.0, manufactured Sep 05 2025;
    locally rebranded as "WEMAX WE-68 PLUS"). Serial: ZYTI25116685.
  - A face-recognition unit branded locally as Click CL-PC3
    (manufactured 2024-10-12, firmware A102G1S1K051Wcs v1.13). We
    believe this is also a Timmy OEM (the Click CL-AI* series matches
    your TM-AI* product line 1:1).

We have already verified the WebSocket /pub/chat protocol on
TCP 7788 and successfully implemented the basic flows:

  - reg (heartbeat / device registration)
  - sendlog (real-time attendance push)
  - getnewlog / getalllog
  - getuserinfo / getuserlist
  - opendoor

To complete a full integration, we still need the official
documentation in order to correctly implement the write-side
operations:

  - setuserinfo / set new user
  - deleteuser
  - setdevicetime / cloudtime synchronization
  - cleanlog / cleanuser
  - device configuration writes

Could you please provide:

  1. The Device SDK package for TFS30 / TH900 firmware
  2. The "WebSocket + JSON Protocol" specification document
     (we believe the latest is version 2.1, around 31 pages)
  3. Any sample server / client code in any language
     (we are using Node.js / Python on the server side)

This is for direct internal use only. We are NOT redistributing
the SDK; we are building a custom server-side adapter that listens
for the device's WebSocket connection.

Thank you for your support. Looking forward to your reply.

Best regards,

DUOCODE TECHNOLOGY
Email: DUOCODETECHU@DUOCODETECH.com
Mobile (Malaysia): +60 147398281
Mobile (China):    +86 18355366842
```

---

## 🇨🇳 中文版

**主题**：
```
申请 TFS30 / TH900 设备 SDK 与 WebSocket 协议文档
```

**正文**：
```
TIMY 团队您好，

我们是 DUOCODE TECHNOLOGY，一家在马来西亚和中国均有团队的软件开发
公司。目前正在为马来西亚一位客户开发定制的考勤管理系统（TMS），
客户已采购贵司两台终端用于其考勤系统：

  - TIMY TFS30（固件 TH900_click V5.0，2025-09-05 出厂；本地贴牌为
    "WEMAX WE-68 PLUS"），序列号 ZYTI25116685。
  - 一台人脸识别款，本地贴牌 Click CL-PC3（2024-10-12 出厂，固件
    A102G1S1K051Wcs v1.13）。我们推测这台也是贵司 OEM（Click 的
    CL-AI* 系列与贵司 TM-AI* 产品线 1:1 对应）。

我们已经成功验证了设备的 WebSocket /pub/chat 协议（TCP 7788），并
完成了基础读取流程的实现：

  - reg（心跳 / 设备注册）
  - sendlog（实时打卡推送）
  - getnewlog / getalllog（拉取打卡记录）
  - getuserinfo / getuserlist（拉取用户信息）
  - opendoor（远程开门）

为完成完整对接，我们还需要贵司的官方文档来正确实现写入相关功能：

  - setuserinfo（新增 / 修改用户）
  - deleteuser（删除用户）
  - setdevicetime（同步设备时间）
  - cleanlog / cleanuser（清空日志 / 用户）
  - 设备配置写入

烦请提供：

  1. TFS30 / TH900 设备 SDK 完整安装包
  2. WebSocket + JSON 协议规范文档（我们了解到最新版本为 v2.1，约 31 页）
  3. 任意语言的示例 server / client 代码（我方服务端使用 Node.js / Python）

仅用于公司内部对接，不会对外分发 SDK 本身；我们要构建的是一个监听
设备 WebSocket 主动连接的定制 server adapter。

非常感谢，期待您的回复。

此致

DUOCODE TECHNOLOGY
邮箱：DUOCODETECHU@DUOCODETECH.com
手机（马来西亚）：+60 147398281
手机（中国）：    +86 18355366842
```

---

## 📋 实操建议

1. **同时发中英双语**到 `info@timyteco.net`（一封邮件，两段正文叠在一起即可，或分两封）
2. 如 3 天内没回复：
   - 加发到他们 B2B 商铺的 inquiry：https://sztimmy.goldsupplier.com
   - 或拨电话：+86-755-83875070（中国深圳，工作日 09:00-18:00 北京时间）
3. 收到 SDK 后存到 `vendor-resources/timmy/protocol-spec/`，文件名用 `timmy-tfs30-th900-sdk-v<X>.zip` / `timmy-websocket-json-protocol-v<X>.pdf`
4. 把协议文档里的 cmd 列表与 `docs/protocol-th900.md` 对照验证一遍

## 📎 备用：Scribd 上的协议泄漏副本

URL：[https://www.scribd.com/document/677738981/websocket-json-protocol2-1-1](https://www.scribd.com/document/677738981/websocket-json-protocol2-1-1)
- 31 页，标题 "Websocket+json Protocol2.1"
- 上传者 Phan Thanh Nhàn（越南分销商）
- 文件名一一对应，几乎肯定是 Timmy 同份协议
- Scribd 需付费 / 订阅访问（约 $11.99/月）

如付费下载到，存到 `vendor-resources/timmy/protocol-spec/timmy-websocket-json-protocol-v2.1.pdf`
