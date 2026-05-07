# Timmy WebSocket Protocol v2.1 — 官方规范分析

> **来源**：[`vendor-resources/timmy/protocol-spec/timmy-websocket-json-protocol-v2.1.txt`](../vendor-resources/timmy/protocol-spec/timmy-websocket-json-protocol-v2.1.txt)
> **作者**：Chingzou（Timmy 开发者）
> **版本**：v2.0（2021-02-02），但文档名是 2.1
> **首版**：v1.0（2016-03-25），9 次迭代到当前
> **范围**：所有 Timmy 指纹机 / 人脸机 / 门禁机 — 包括 TFS30 / TH900 系列
> **协议**：WebSocket RFC6455 v13，TCP **7788**（无 TLS），JSON 文本帧

---

## 1. 我们的实测 vs 官方文档 — 对照

### ✅ 完全验证正确的（破解 100% 准确）

| 实测发现 | 官方文档 | 状态 |
|----------|---------|------|
| 端口 7788 | "default listen port is 7788, no TLS encrypt" | ✅ |
| Path `/pub/chat` | （文档没写 path，但我们设备实际就用这个） | ✅ |
| 设备主动连接 server | "Terminal active send data to server" | ✅ |
| `cmd:reg` 第一帧 + 心跳 | §1 Register | ✅ |
| reg payload `devinfo` 完整字段 | §1 同字段集 | ✅ |
| Server 必回 `ret:reg result:true cloudtime` | §1 success response | ✅ |
| `nosenduser` 控制设备 push 用户 | §1 注释 "tell the terminal, auto send the new user message or not" | ✅ |
| `cmd:sendlog` 实时打卡 push | §2 Send the logs | ✅ |
| `getnewlog` / `getalllog` 拉打卡 | §10/§11 | ✅ |
| `getuserinfo {enrollid:N}` 拿用户 | §2.2 含 backupnum | ✅ |
| `getuserlist` 用户列表 | §2.1 含分页 stn 字段 | ✅ |
| `opendoor` 远程开门 | §19 | ✅ |
| `result:false reason:N` 错误格式 | 全文统一 | ✅ |
| reason=1（参数缺失） | 实测同 | ✅ |

### ⚠️ 实测与文档有出入的点

#### A. `mode` 字段 — 文档**自相矛盾**！

文档里 mode 字段在不同 section 写法不一致：

| 出现位置 | 写法 |
|---------|------|
| §2 sendlog 注释 | `"mode":0, //1:fp 2:card 3:pwd 8:face` |
| §2 sendlog Note 段 | `Mode: 0 fp, 1 card 2 password` |
| §10 getnewlog 注释 | `"mode":0, //0 fp 1:card 2:pwd` |
| §11 getalllog 注释 | `"mode":0, //0 fp 1:card 2:pwd` |

**实测我们的设备发出的是 `mode:1` = 指纹打卡**，符合 §2 sendlog 第一条注释。

**结论**：`mode` 实际值因固件 / 设备型号不同，**TFS30 + TH900_click V5.0 用：1=fp / 2=card / 3=pwd / 8=face**（与 §2 sendlog 注释一致）。**老固件**（即客户给我们的 `AGL_001.DAT` U盘样本）里 mode=8 也是指纹，是另一个编码体系。代码里要兼容两套。

#### B. `event` 字段 — 文档补全了 enrollid=0 时的特殊语义

我们实测只见到 `event:0`（普通打卡）。文档：

```c
当 enrollid != 0 (普通打卡):
    event: 0~16 customization (设备 F1~F4 键可以打"上班/下班/外出"等标签)

当 enrollid == 0 (设备/门状态事件):
    event 枚举：
        0 UI_MGLOG_CLOSED         门已关
        1 UI_MGLOG_OPENED         门已开
        2 UI_MGLOG_HAND_OPEN      用出门按钮开门
        3 UI_MGLOG_PROG_OPEN      软件远程开门
        4 UI_MGLOG_PROG_CLOSE     软件远程关门
        5 UI_MGLOG_ILLEGAL_OPEN   非法开门
        6 UI_MGLOG_ILLEGAL_REMOVE 设备被拆
        7 UI_MGLOG_ALARM          告警输入触发
```

**对 TMS 落地的影响**：
- 收到 `enrollid=0` 的 sendlog 帧不要当成"员工 0 号打卡"
- 这是设备 / 门禁安全事件，应路由到独立的 `door_events` 表 + 告警通道

#### C. `verifymode` 字段（实测没见到，文档补全）

```c
enum {
    0 VERIFY_KIND_FP_CARD_PWD,         // 卡 OR 指纹 OR 密码（任一）
    1 VERIFY_KIND_CARD_ADD_FP,         // 卡 + 指纹
    2 VERIFY_KIND_PWD_ADD_FP,          // 密码 + 指纹
    3 VERIFY_KIND_CARD_ADD_FP_ADD_PWD, // 卡 + 指纹 + 密码
    4 VERIFY_KIND_CARD_ADD_PWD,        // 卡 + 密码
    13 // QR code (just AI device)
};
```

我们设备没看到 `verifymode` 字段，可能是 V5.0 新固件去掉了或仅 AI 设备才用。

---

## 2. backupnum 字段完整字典（关键）

`backupnum` 在 `senduser` / `getuserinfo` / `setuserinfo` / `deleteuser` 中决定**操作哪个验证介质**：

| 值范围 | 类型 |
|--------|------|
| **0~9** | 第 N 根指纹（每个用户最多 10 个指纹） |
| **10** | 密码（最多 8 位数字） |
| **11** | RFID 卡号 |
| **20-27** | 静态人脸（8 个槽位） |
| **30-37** | 掌静脉（8 个槽位） |
| **50** | 照片（Base64 编码） |

**deleteuser 还有特殊语义**：
- `0~9`：删第 N 根指纹
- `10`：删密码
- `11`：删卡
- **12**：删该用户**所有指纹**（保留卡/密码/姓名）
- **13**：删该用户**全部信息**（指纹+密码+卡+姓名）

**我们实测 Ben 的 backupnum=0** → 一根拇指指纹

---

## 3. 28 个 cmd 完整字典

### Terminal → Server (设备主动 push)

| # | cmd | 用途 | 实测 |
|---|-----|------|------|
| 1 | `reg` | 心跳 / 设备注册 | ✅ |
| 2 | `sendlog` | 实时打卡推送（含温度 / Base64 照片 / QR 验证） | ✅ |
| 3 | `senduser` | 用户在设备上手动录入后 push 给 server（仅 reg 时 `nosenduser:false` 有效） | ❌ 未实测 |

### Server → Terminal (server 主动 push)

#### 用户管理

| # | cmd | 用途 | 实测 |
|---|-----|------|------|
| 4 | `getuserlist` | 拿用户列表（每包 ≤40，分页 stn） | ✅ |
| 5 | `getuserinfo` | 拿单用户（带 enrollid + backupnum 决定拿啥介质） | ✅ |
| 6 | `setuserinfo` | **写**用户（增/改）— 含指纹模板（≤1620 chars THbio3.0） | ❌ 未实测，**v1 不需要**（员工设备上录入） |
| 7 | `deleteuser` | 删用户（backupnum 决定细粒度） | ❌ 未实测 |
| 8 | `getusername` | 拿单用户名 | ❌ |
| 9 | `setusername` | 批量改用户名（每包 ≤50） | ❌ |
| 10 | `enableuser` | 启用（`enflag:1`）/ 禁用（`enflag:0`，文档 §8 标记为 `disableuser`，cmd 名不变） | ❌ |
| 11 | `cleanuser` | ⚠️ 清空所有用户 — 危险 | ❌ |

#### 打卡日志

| # | cmd | 用途 | 实测 |
|---|-----|------|------|
| 12 | `getnewlog` | 拿增量未传 logs，分页 stn | ✅ |
| 13 | `getalllog` | 拿全量 logs，**支持日期范围** `from`/`to`（v1.8+），分页 | ✅ |
| 14 | `cleanlog` | ⚠️ 清空所有 logs — 危险 | ❌ |

#### 系统管理

| # | cmd | 用途 | 实测 |
|---|-----|------|------|
| 15 | `initsys` | ⚠️ 重置：删全部用户+全部 logs，但保留参数设置 | ❌ |
| 16 | `reboot` | ⚠️ 重启设备 — **无响应消息** | ❌ |
| 17 | `cleanadmin` | 把所有管理员降级为普通用户 | ❌ |
| 18 | `settime` | 同步时间到设备（cloudtime） | ❌ |
| 19 | `setdevinfo` | 设设备参数（语言/音量/屏保/验证模式/睡眠/指纹数/日志提示/重验时间） | ❌ |
| 20 | `getdevinfo` | 拿设备参数 | ❌ |

#### 门禁

| # | cmd | 用途 | 实测 |
|---|-----|------|------|
| 21 | `opendoor` | 远程开门（access controller 有 `doornum`:1~4） | ✅ |
| 22 | `setdevlock` | 设门禁参数（开门延迟/门磁/警报/挟持/反潜回/互锁/多人开门/拆机告警/Wiegand/dayzone/weekzone/lockgroup） | ❌ |
| 23 | `getdevlock` | 拿门禁参数 | ❌ |
| 24 | `getuserlock` | 拿单用户门禁权限（4 个 weekzone + group + 起止时间） | ❌ |
| 25 | `setuserlock` | 设单用户门禁权限 | ❌ |
| 26 | `deleteuserlock` | 删单用户门禁权限 | ❌ |
| 27 | `cleanuserlock` | 清空所有用户门禁权限 | ❌ |

**实测验证 7 个，规范揭示完整 28 个。**

---

## 4. 设备参数（setdevinfo）枚举

### 语言（`language` 字段）

```
0 EN  English
1 SC  简体中文
2 TC  台湾繁体
3 JAPAN
4 NKR  朝鲜
5 SKR  韩国
6 THAI
7 INDONESIA
8 VIETNAM
9 SPA  西班牙
10 FAN 法语
11 POR 葡萄牙
12 GEN 德语
13 RUSSIA
14 TUR 土耳其
15 ITALIAN
16 CZECH
17 ALB  阿拉伯
18 PARSI 波斯
```

### 验证模式（`verifymode` 字段，用于 setdevinfo —— 不是 sendlog 里的 verifymode 13）

```
0 RFID 卡 OR 指纹 OR 密码（任一）
1 卡 + 指纹
2 密码 + 指纹
3 卡 + 指纹 + 密码（三者都要）
4 卡 + 密码
```

### 其他

- `volume`: 0~10（默认 6）
- `screensaver`: 0=不启用，1~255 = 几秒后进屏保
- `userfpnum`: 1~10（每用户能存几个指纹，默认 3）
- `loghint`: 日志剩余多少条时提示满（0=不提示）
- `reverifytime`: 重验时间 0~255 分钟

---

## 5. 门禁参数 setdevlock 完整字段

复杂度最高的一个 cmd，对应 access controller 高级权限管理：

| 字段 | 类型 | 含义 |
|------|------|------|
| `opendelay` | int | 开门延迟秒 |
| `doorsensor` | 0/1/2 | 门磁类型：0 禁用 / 1 NC 常闭 / 2 NO 常开 |
| `alarmdelay` | int | 门未关报警时间 1~255 分钟（0=禁用） |
| `threat` | 0/1/2/3 | 挟持告警 |
| `InputAlarm` | 0/1/2 | 输入告警输出 |
| `antpass` | 0/1/2 | 反潜回 |
| `interlock` | 0/1 | 互锁 |
| `mutiopen` | 0/1~4 | 多人开门 |
| `tryalarm` | 0/1~10 | 试错次数告警 |
| `tamper` | 0/1 | 拆机告警 |
| `wgformat` | 0/1 | Wiegand 格式 26/34 |
| `wgoutput` | 0/1/2 | Wiegand 输出格式 |
| `cardoutput` | 0/1 | 是否输出卡号 |
| `dayzone` | array[8] | **8 组日时段**，每组 5 个时间段（如 06:00~07:00） |
| `weekzone` | array[8] | **8 组周配置**，每组 7 天分别引用 dayzone |
| `lockgroup` | array[5] | 多人开门组合（如 `129` = 1组+2组+9组各一人才能开） |

---

## 6. 必须立即更新到 prototype 的事

### 6.1 数据模型（types.ts）需要新增

| 字段 | 来源 | 重要性 |
|------|------|--------|
| `Employee.fingerprintTemplates: Array<{slot: 0..9, blob: string}>` | backupnum 0~9 | ⭐⭐ |
| `Employee.faceTemplates: Array<{slot: 20..27, blob: string}>` | backupnum 20-27 | ⭐⭐ |
| `Employee.palmTemplates`（暂不做） | backupnum 30-37 | 低 |
| `Employee.photo: string (base64)` | backupnum 50 | ⭐ |
| `Employee.cardNo: string` | backupnum 11 | ⭐⭐ |
| `Employee.passwordHash` | backupnum 10（设备里是明文 8 位数字！） | ⭐ |
| `Punch.event: number` | sendlog event 字段 | ⭐⭐ |
| `Punch.temperature: number` | sendlog temp 字段（防疫遗留） | ⭐ |
| `Punch.verifyMode: number` | sendlog verifymode 字段 | ⭐ |
| `Punch.image: string (base64)` | AI 设备 sendlog 含照片 | ⭐ |
| `DoorEvent { type: enum, time, source }` | enrollid=0 的 sendlog | ⭐⭐ |

### 6.2 业务逻辑

- **enrollid==0 的 sendlog 帧不能当成员工 0 号** —— 路由到 door_events 而不是 attendance_logs
- 验证模式 5 种 + QR 13，UI 至少要识别 mode 1（指纹）/ 2（卡）/ 3（密码）/ 8（人脸）
- record 字段长度限制：THbio3.0 ≤ 1620 chars，THbio1.0 ≤ 1024 chars

---

## 7. 还没探到 / 需要厂家进一步确认

虽然有了官方 spec，但**这些不在 v2.1 文档里**：

1. `/pub/chat` 这个 path 文档没写（我们实测出来的）
2. `Server approval = Yes` 时设备未连 server 拒绝打卡的具体行为（manual §11.2 有，spec 没明说）
3. AI 设备的 backupnum 50（photo）实际怎么用 — 文档说"format is base64"但没说图片格式（JPEG?PNG?）
4. `senduser` 的触发条件（用户在设备上录指纹 → 立刻 push？还是周期？）

---

## 8. 实施优先级（更新版）

### v1（合同范围内必做）
- ✅ 接 reg / sendlog（已完成）
- ✅ getnewlog 增量同步（已完成测试）
- ✅ getuserlist + getuserinfo 拉用户（已完成）
- 🔲 settime 时间同步（确保设备时间不跑偏）
- 🔲 enrollid=0 的 sendlog 路由到 door_events 表
- 🔲 backupnum 50 的 photo 解析展示

### v2（增值功能）
- 🔲 setuserinfo 在 TMS 后台管员工 → 同步指纹模板到设备（要小心 1620 chars 限制）
- 🔲 deleteuser 离职员工删模板
- 🔲 enableuser/disableuser 临时停用
- 🔲 setdevinfo 远程改设备参数

### v3（门禁高级 — 客户没要求但能力可演示）
- 🔲 setdevlock + setuserlock 门禁权限管理
- 🔲 dayzone/weekzone/lockgroup 复杂权限

### 永远不做
- 🚫 cleanuser / cleanlog / initsys / reboot — 太危险，留给客户在设备上手动操作
