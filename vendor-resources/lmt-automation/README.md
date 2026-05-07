# LMT Automation Sdn Bhd — 甲方公司资料

> 2026-05-03 收到 Benny 名片后建立。**Benny 是 LMT 销售经理 = 项目甲方对接人**。

## 公司资料

| 项 | 值 |
|----|----|
| 公司名 | **LMT Automation Sdn Bhd** |
| 公司号 | 382080-H |
| Tagline | "Your One Stop Office Equipment Centre" |
| 网址 | https://www.lmt.com.my |
| 地址 | No. 43, Jalan SG1/9, Taman Sri Gombak, 68100 Batu Caves, Selangor Darul Ehsan, Malaysia |
| 公司 Tel 1 | +603-6188 7340 |
| 公司 Tel 2 | +603-6187 8688 |
| 公司 Email | sales@lmt.com.my |

## Benny Low（甲方对接人）

| 项 | 值 |
|----|----|
| 姓名 | Benny Low |
| 职务 | **Sales Manager** |
| Mobile | **+6019-383 2796** |
| Email | **benny@lmt.com.my** |

> 名片实物在 `requirements/hardware/photos/Benny_LMT_business_card.jpg`（待补 — 用户在 WhatsApp 发的图）

## LMT 业务范围（lmt.com.my 实测）

母公司 LMT Automation 是综合办公设备 e-commerce，卖：

- **Office Machine**（碎纸机：HSM Pure 940 / 830 系列等，RM 12,000+）
- **Office Furniture**
- **Fire Resistant Safe**（防火保险柜）
- **Time Attendance System**（考勤系统 — 我们这个项目属于这块）
- **Presentation Equipment**
- **Display Equipment**
- **Office Supplies**
- **Stainless Steel and Hygiene Equipment**

## LMT 集团结构（DNS + 站点 inspect 实测）

```
LMT Automation Sdn Bhd（lmt.com.my，IP 110.4.45.100）
   │
   └── Click Marketing Sdn Bhd（CMSB，clickmarketing.com.my，IP 103.10.78.30）
       │  专做 biometric / RFID / 考勤产品的子公司
       │  2009 年成立，WORKLINK 集团旗下
       │  KL 总部：M2-B-23, Jalan Pandan Indah 4/1A, 55100 KL
       │  Tel: 603-42941872，enquiry@clickmarketing.com.my
       │
       └── Click TMS（clicktmsmy.com + fk6.clicktmsmy.com，IP 123.253.35.47）
              CMSB 自家 SaaS 云考勤后台
              CL-PC3 设备出厂硬编码连这里
```

## 项目身份链路

```
LMT 的某 enterprise 客户
   ↓ 买 LMT 设备 + 要定制内部 TMS（不用 LMT SaaS 云）
LMT Automation
   ↓ Benny（销售经理）对接外部开发商
DuoCode Technology
   ↓ 实施
两台设备：
   - WE-68 PLUS / TFS30（LMT 卖给客户的 Timmy OEM 设备）
   - CL-PC3（LMT 旗下 Click Marketing 自营品牌）
```

## 拿资源的内部路径（关键）

| 资源 | 在哪 | 怎么拿 |
|------|------|--------|
| CL-PC3 协议规范 / SDK | LMT 内部 Click Marketing 工程师 | Benny 内部走流程 |
| fk6.clicktmsmy.com:80 服务端 API | LMT 内部 Click TMS 后台开发 | 同上 |
| TFS30 / TH900 SDK | 中国 Timmy 厂家 | LMT 跟 Timmy 是上下游，Benny 通过采购 / 销售渠道要 |
| Master Key / mdb 密码 | LMT 老 PC 软件遗留 | 已 reverse 拿到（`eClick`、`11475-...`） |

## 历史误判清理（之前所有文档里的错误）

之前误判：
- ❌ "Benny 是个人买打卡机的甲方" → 实际 Benny = LMT Sales Manager
- ❌ "LMT 不愿给 SDK 是商业护城河" → 对外人成立，对 LMT 内部不成立
- ❌ "应对话术 / 不抢硬件销售" → 不再适用
- ❌ "我们以 DuoCode 名义自己发英文邮件给 LMT" → 实际 Benny 内部联系工程师即可
- ❌ "我们以 DuoCode 名义发邮件给 Timmy" → 实际 LMT 跟 Timmy 上下游有渠道，让 LMT 走

订正：
- ✅ Benny 走 LMT 内部流程拿 CL-PC3 协议 / SDK / fk6 API
- ✅ Benny 通过 LMT 跟 Timmy 的采购/销售渠道拿 TFS30 SDK
- ✅ DuoCode 邮件草稿仍保留（vendor-resources/click-marketing/ 和 vendor-resources/timmy/）作风险兜底，万一 Benny 内部走得慢可以并行
