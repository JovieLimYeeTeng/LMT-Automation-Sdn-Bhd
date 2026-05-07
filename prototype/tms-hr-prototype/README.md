# TMS HR Local Prototype

> [English](#english) · [中文](#中文)

## English

A **pure-software** attendance prototype based on `requirements/考勤软件方案.pdf` and `requirements/TMS_handoff_factual_zero_context.md`. Designed for single-HR local use on one computer — no punch-clock hardware required.

### Run

```bash
npm install
npm run dev -- --port 5173
```

Open `http://127.0.0.1:5173/`. The default HR password is `1234` (changeable under "Settings → Permissions"). The UI supports Chinese / English; the language toggle lives in the top bar and is remembered in `localStorage`.

### Requirements covered (mapped to the PDF)

#### Employee profile
Employee No., work No., name (last/first), gender, ID No., birth date, birth place, address, nationality, company, department, position, join date, shift, weekly rest days, exemptions (late / early leave / lunch punch / overtime), active / inactive flag.

#### Shift setup
Per-day shift start, lunch start, lunch end, shift end, OT start, **OT end** (added), and rest. Options:
- Flexible work length / flexible lunch length / late grace
- **Auto shift assignment**: when enabled in the employee profile, the system matches the closest shift based on the first in-punch of the day
- **Manual shift override**: pick today's shift on the punch correction page; takes priority over auto assignment
- **Per-day rest override**: on the punch correction page a specific day can be flipped from rest to work or vice versa (matches the handoff's "employee rest day maintenance")

#### General settings
- Holiday input (with year filter, set once per year)
- Department / leave-type input (sick / annual / paid / unpaid leave, customizable)
- Data import workspace: CSV / TXT file import, paste import, post-import exception check, recent punch logs
- Punch correction (punch time input, manual shift override / per-day rest maintenance)

#### Reports
Personal monthly attendance report, monthly summary report, late / early leave, leave, overtime, absent, and raw punch log. Filter by company / department / employee, CSV export, browser print (the print version carries a header with month + company + department + employee). Honors the legacy constraint: one month per export.

#### Permissions
- HR password lock screen; bad password is reported without leaking the real one
- Optional USB key as a second factor: prototype simulates it with a plain string; production can swap in real USB / CA reading
- Session lives in `sessionStorage`, closing the tab auto-locks; the sidebar also has a manual lock button

#### Local data
JSON backup / restore / one-click reset to sample data. All data lives in the browser's `localStorage`.

### Open questions for the customer

1. **Final form factor**: is the local browser build enough, or does it need to be packaged as a Windows desktop executable (Electron / Tauri)?
2. **Punch data source**: there is no punch-clock on site. Will HR enter punches manually under "Punch correction", or should employees self-punch via web / phone / tablet (which would require an extra punch entry point)?
3. **Official rules for late / early / OT / absent**: the prototype uses sensible defaults; the real rules need item-by-item confirmation from the customer.
4. **Report layout**: replicate the legacy system field by field, or are equivalent fields fine? Do they need Excel / PDF export?
5. **Permission strength**: is a simple local password enough, or do they need a real USB security dongle / multiple roles?
6. **Local data backup path**: data currently lives only in the browser. Should it auto-export to a folder or to the cloud?
7. **Deployment**: will the final delivery be installed on a single customer machine, or served as a web app?

## 中文

根据 `requirements/考勤软件方案.pdf` 和 `requirements/TMS_handoff_factual_zero_context.md` 做的**纯软件**考勤原型，单 HR 本机使用，不需要打卡机硬件。

### 运行

```bash
npm install
npm run dev -- --port 5173
```

打开 `http://127.0.0.1:5173/`，默认 HR 密码：`1234`（可在"普通设置 → 权限"里改）。界面支持中文 / 英文双语，顶部有语言切换按钮，选项保存在 `localStorage`。

### 已覆盖的需求（对应 PDF 条目）

#### 员工资料
员工编号、员工工作号、姓名（姓/名）、性别、身份证号码、出生日期、出生地、住址、国籍、所属公司、部门、职位、入职日期、工作班次、工作休息日、豁免（迟到/早退/午餐打卡/加班）、活跃/不活跃。

#### 班次选项设置
每天的班次始、午饭始、午饭终、班次终、加班始、**加班终**（已加）、休息。选项：
- 灵活的固定工作长度 / 灵活的固定午饭长度 / 上班迟到优惠
- **自动判班**：员工档案里勾选后，按当天第一笔上班时间接近哪个班次始就算哪个班次
- **手动换班**：补签卡页面里选当天班次，优先级高于自动判班
- **当天休息日**：补签卡页面里可以把某一天从休息改成上班或反过来（对应 handoff 里 "employee rest day maintenance"）

#### 普通规格选项设置
- 假期输入（带年份筛选，一次设一年）
- 部门输入 / 请假选项输入（病假、年假、带薪假、无薪假，可自定义）
- 数据导入工作台：CSV / TXT 文件导入、粘贴导入、导入后异常检查、最近记录时间
- 补签卡（打卡时间输入，手动换班 / 当天休息日维护）

#### 考勤报表
个人考勤报表（月）、全部总结简介报表（月）、迟到早退、请假、加班、旷工、记录时间。支持按公司 / 部门 / 员工过滤，CSV 导出，浏览器打印（打印版顶部带月份 + 公司 + 部门 + 员工抬头）。参考旧系统约束：单次只打印单月。

#### 权限
- HR 密码登录界面（Lock screen），错误会提示，不泄露密码
- 可选 U盘 key 二次校验：原型用普通字符串模拟，生产里可以改成读真实 USB / CA
- 会话存在 sessionStorage，关闭标签页自动锁定，侧栏也有手动锁定按钮

#### 本地资料
JSON 备份 / 恢复 / 一键重置样例数据，全部数据保存在浏览器 localStorage。

### 仍需和客户确认的开放点

1. **最终形态**：浏览器本地版已经够用，还是要打包成 Windows 桌面可执行文件（Electron / Tauri）？
2. **打卡数据来源**：现场没有打卡机。数据是 HR 手动在"补签卡"录入，还是由员工通过网页 / 手机 / 平板自助打卡（需要再加一个打卡入口）？
3. **迟到/早退/OT/旷工的正式计算口径**：现在原型用了一套合理默认值，真实口径需要客户逐条确认。
4. **报表版式**：要像旧系统那样逐字段对齐复刻，还是字段等效即可？是否需要导出 Excel / PDF？
5. **权限强度**：简单本机密码够用，还是需要真正的 USB 加密锁 / 多角色？
6. **本机数据备份路径**：目前只在浏览器里，需不需要自动导出到某个文件夹或云端？
7. **部署**：最终给客户是部署到他们一台电脑上，还是走 web 形式？
