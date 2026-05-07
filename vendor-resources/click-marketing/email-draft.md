# 给 Click Marketing / LMT 的英文邮件 — 可直接复制粘贴

> **Primary recipient**：`enquiry@clickmarketing.com.my`
> **Backup**：从 [clickmarketing.com.my/contact](https://clickmarketing.com.my/contact) 取最新工程师邮箱
> **公司**：Click Marketing Sdn Bhd（LMT Automation 子品牌）
> **场景**：CL-PC3 协议规范 / SDK / 服务端 API 请求

---

## 🇬🇧 English version

**Subject**:
```
Request for CL-PC3 Protocol Specification, SDK, and Server-Side API Documentation
```

**Body**:
```
Dear Click Marketing Team,

We are DUOCODE TECHNOLOGY, a software development firm with
operations in Malaysia and China. We are currently developing a
customized Time Management System (TMS) for a high-priority
enterprise client in Malaysia who has purchased two of your
attendance terminals:

  - Click CL-PC3 (face recognition)
    Serial: 20241012011
    Manufactured: 2024-10-12
    Firmware: A102G1S1K051Wcs v1.13
    Default cloud server: fk6.clicktmsmy.com:80

  - WEMAX WE-68 PLUS (locally rebranded TIMY TFS30)
    Serial: ZYTI25116685

Our integration goal is to receive attendance data and user
information directly from the device into our own back-end
(rather than relying on the legacy CLICK PC software). For the
TFS30 unit we already have the official WebSocket+JSON protocol
documentation and have completed integration. For the CL-PC3,
however, we have only the legacy V1.0.402 PC software that ships
on the original USB stick, which does not appear to communicate
correctly with this newer firmware revision.

After extensive testing on TCP port 5005 (the documented control
port), all command frames return a 10-byte ACK with flags=0x10
(which we interpret as a permission-denied / not-supported error
code rather than a data length). We believe the actual user and
attendance data flows over the device's outbound HTTP push channel
to fk6.clicktmsmy.com on port 80, using a private LMT/Click-side
protocol that the legacy V1.0.402 software does not implement.

Could you please provide one or more of the following so that we
can complete a proper integration:

  1. The CL-PC3 protocol specification document
     (binary frame format, command list, packet flow)

  2. A Software Development Kit (SDK) — any platform is fine
     (Windows DLL / .NET / Java / Python / PHP / Node.js)

  3. The server-side API documentation for the
     fk6.clicktmsmy.com:80 push channel
     (so that we can host an equivalent endpoint internally)

  4. A direct technical contact (engineer / developer relations)
     we can speak with for follow-up questions

  5. Any official sample server or client code

This is for direct internal use within our integration adapter
only. We are NOT redistributing the SDK or your protocol
specification; we are building a custom server-side service that
acts as the receiving endpoint for our customer's two terminals,
strictly within their LAN.

Our customer (Benny / LMT-affiliated buyer of the two units) is
copied — feel free to confirm the engagement with him directly if
needed.

Thank you very much for your support. We look forward to your
reply.

Best regards,

DUOCODE TECHNOLOGY
Email:           DUOCODETECHU@DUOCODETECH.com
Mobile (MY):     +60 147398281
Mobile (CN):     +86 18355366842
```

---

## 🇨🇳 中文版（备用 — 万一对方有华裔工程师/管理层）

**主题**：
```
申请 CL-PC3 协议规范 / SDK / 服务端 API 文档
```

**正文**：
```
Click Marketing 团队您好，

我们是 DUOCODE TECHNOLOGY，一家在马来西亚和中国均有团队的软件开发
公司。目前正在为马来西亚的一位企业客户开发定制化考勤管理系统
（TMS），客户已采购贵司两台考勤终端：

  - Click CL-PC3（人脸识别款）
    序列号：20241012011
    出厂日期：2024-10-12
    固件：A102G1S1K051Wcs v1.13
    出厂云端：fk6.clicktmsmy.com:80

  - WEMAX WE-68 PLUS（本地贴牌 TIMY TFS30）
    序列号：ZYTI25116685

我方对接目标是把考勤数据和用户信息直接接入到我方后端（不再
依赖原 CLICK PC 软件 V1.0.402）。对于 TFS30 我们已拿到 Timmy
官方 WebSocket+JSON 协议规范，对接已完成。CL-PC3 这台目前只有
随机 USB 上的 V1.0.402 老版 PC 软件，但该软件似乎与这台较新固件
通讯异常。

我们在文档中标注的 5005 控制端口做了完整测试，所有命令帧都返回
10 字节 ACK（flags=0x10），我们判断这是错误码（permission denied
或 not supported）而非数据包长度。我们怀疑真实业务数据走的是设备
通过 fk6.clicktmsmy.com:80 主动推送的 HTTP 通道，使用 LMT/Click
私有协议，而旧版 V1.0.402 软件并不支持。

为了完成对接，烦请提供下述之一或多项：

  1. CL-PC3 协议规范文档
     （二进制帧格式 / 命令列表 / 通讯流程）

  2. 任意平台 SDK
     （Windows DLL / .NET / Java / Python / PHP / Node.js 均可）

  3. fk6.clicktmsmy.com:80 推送通道服务端 API 文档
     （我们将在内部部署一个等价的接收端点）

  4. 一位可直接对接的技术联系人
     （工程师 / 开发者关系负责人，便于后续追问）

  5. 任意官方示例 server 或 client 代码

仅用于公司内部对接 adapter，不会对外分发 SDK 或协议规范本身；
我们要构建的是一个 server 端服务，部署在客户局域网内，专门作为
两台终端的接收端。

客户（Benny / LMT 经销渠道购买方）已抄送本邮件，如需向他直接
确认本次对接，欢迎与他联系。

非常感谢，期待您的回复。

此致

DUOCODE TECHNOLOGY
邮箱：       DUOCODETECHU@DUOCODETECH.com
手机（马来西亚）：+60 147398281
手机（中国）：    +86 18355366842
```

---

## 📋 实操建议

1. **先发英文版**（Click Marketing 是马来西亚本地公司，英文是工作语言）
2. 在邮件里**抄送（CC）Benny**（让他可见，省去我们再单独告知一次）
3. 如 5 个工作日没回复：
   - 翻 [clickmarketing.com.my/contact](https://clickmarketing.com.my/contact) 找直拨 / WhatsApp
   - 或让 Benny 通过他在 LMT 的关系询问"工程支持邮箱"
4. 收到任何文档后存到 `vendor-resources/click-marketing/protocol-spec/` 或 `.../sdk/`
5. 立刻把 cmd 列表与 `docs/protocol-cl-pc3.md` 56 opcode 字典对照核验

---

## 📎 已知线索（让客服转工程时可附）

- 设备序列号：`20241012011`
- 固件版本：`A102G1S1K051Wcs v1.13`
- 出厂 ServerIP：`fk6.clicktmsmy.com:80`
- 我方实测端口：5005（控制端口）+ 设备主动 connect 出口
- Master Key（设备绑定）：`11475-2295-26775-2550-AF-7905-5355-13770-0-1530`
  （随机 USB 上 `Master_key.txt` 内）
