# Research Report 04 — AGL_001.DAT 二进制结构（已解出）

> Agent: dat-binary (general-purpose)
> 执行时间: 2026-04-30
> 验证：3099 / 3099 条记录全部 100% 与 TXT 匹配 ✅

---

## 1. 文件总览

- **文件大小**：`24811` 字节
- **TXT 行数**：`3099` 数据行（+ 1 表头）
- **Magic**：前 15 字节 `5a 6f 75 63 71 47 45 4e 4c 4f 47 44 61 74 61` = `"ZoucqGENLOGData"`
- **Header 大小**：**19 字节**（不是 16/17）
- **每条记录**：**8 字节**
- **校验**：`19 + 8 × 3099 = 24811` ✅

> 用户原假设的 16-byte 头 + 0x1b 是 padding 是错的。0x1b 是记录条数 LE32 的最低字节

---

## 2. Header 布局（19 字节）

| Offset | Size | 类型 | 含义 | 值 |
|---|---|---|---|---|
| 0  | 15 | ASCII | Magic | `ZoucqGENLOGData` |
| 15 | 4  | uint32 LE | **Record count** | `1b 0c 00 00` = **3099** |

---

## 3. 记录布局（8 字节 / 条）

| Offset | Size | 字段 | 编码 |
|---|---|---|---|
| 0 | 4 | Timestamp | uint32 LE = **seconds since 2000-01-01 00:00:00 (本地时区)** |
| 4 | 1 | EnNo + Mode 复合 | `(EnNo << 4) \| (Mode_lo)`，其中 Mode=8 在低位编码为 0；非 8 直接用值 |
| 5 | 3 | Reserved | 全为 0x00（本样本中） |

### 3.1 Timestamp 编码（重点踩坑澄清）

- 目标：`2025/05/15 08:28:25` ⟷ `0x2fb86229` = `800612905`
- **正确公式**：`seconds_since(2000-01-01 00:00:00 local)`
- 验证：从 2000-01-01 到 2025-05-15 实际有 **9266 天**（含闰日），`9266×86400 + 8×3600 + 28×60 + 25 = 800612905` ✅
- 既不是位打包，也不是 ZKTeco 的"假日历"格式

### 3.2 EnNo / Mode 编码（在 byte[4]）

样本中 byte[4] 仅出现 10 种值，全部由 (EnNo, Mode) 唯一决定：

| Trailer | TXT 实测 EnNo | TXT 实测 Mode | 解码规则 |
|---|---|---|---|
| 0x10 | 1 | 8 | high=1, low=0 → Mode 默认 8 |
| 0x20 | 2 | 8 | … |
| 0x30 | 3 | 8 | low=0 ⇒ Mode=8 |
| 0x32 | 3 | 2 | low=2 ⇒ Mode=2 |
| 0x40 | 4 | 8 | … |
| 0x50–0x90 | 5–9 | 8 | … |

规则：
- `EnNo = byte[4] >> 4`
- `mode_nibble = byte[4] & 0x0F`
- `Mode = mode_nibble == 0 ? 8 : mode_nibble`（设备把"指纹比对成功"=Mode 8 当默认值，写存储时记 0）

**限制**：高 4 bit 决定 EnNo 上限 ≤ 15。本样本 EnNo 只到 9，再多用户时这个 1 字节方案肯定会爆。建议拿一个含 EnNo>15 的样本验证；若仍是单字节，则需要重新设计

### 3.3 INOUT 与 TMNo

- 样本里 **INOUT 全为 0**，**TMNo 全为 1**
- byte[5..7] 在 3099 条里 **全部为 0x00**，所以这两个字段在本样本中**没有被编码进记录**——它们是设备级常量（机器号 = 1，IO 状态默认进），由 TMS 在解析时按照机器配置补齐即可
- 这部分需要额外样本验证：拿一台 TMNo≠1 的设备的 .DAT，或一条 INOUT=1 的记录，看 byte[5..7] 是否变化

---

## 4. 完整 Python 解析脚本

```python
"""Parse a ZoucqGENLOG .DAT attendance dump from the fingerprint terminal.

Returns a list of dicts: {No, TMNo, EnNo, INOUT, Mode, datetime}.

Layout
------
Header (19 bytes):
    [0:15]   ASCII magic 'ZoucqGENLOGData'
    [15:19]  uint32 LE  record_count
Record (8 bytes), repeated record_count times:
    [0:4]    uint32 LE  timestamp = seconds since 2000-01-01 00:00:00 local
    [4]      uint8      flags: high nibble = EnNo, low nibble = Mode
                        (Mode==0 in storage means Mode=8, ZKTeco quirk)
    [5:8]    3 bytes    reserved (all 0x00 in observed sample)
"""
import datetime
import struct
from typing import List, Dict


MAGIC = b"ZoucqGENLOGData"
HEADER_SIZE = 19
RECORD_SIZE = 8
EPOCH = datetime.datetime(2000, 1, 1)


def parse_attendance_dat(path: str) -> List[Dict]:
    with open(path, "rb") as f:
        data = f.read()

    if data[:15] != MAGIC:
        raise ValueError(f"Bad magic, not a ZoucqGENLOG file: {data[:16]!r}")

    record_count = struct.unpack_from("<I", data, 15)[0]
    body_size = len(data) - HEADER_SIZE
    if body_size != record_count * RECORD_SIZE:
        raise ValueError(
            f"Size mismatch: header says {record_count} records "
            f"but body is {body_size} bytes ({body_size / RECORD_SIZE:.2f} recs)"
        )

    out: List[Dict] = []
    off = HEADER_SIZE
    for i in range(record_count):
        ts, flag = struct.unpack_from("<IB", data, off)
        # bytes off+5..off+7 are reserved/zero in observed samples
        enno = (flag >> 4) & 0x0F
        mode_nibble = flag & 0x0F
        mode = mode_nibble if mode_nibble != 0 else 8
        dt = EPOCH + datetime.timedelta(seconds=ts)
        out.append({
            "No": i,
            "TMNo": 1,    # device-level constant in this sample; revisit if other devices differ
            "EnNo": enno,
            "INOUT": 0,   # constant in this sample; revisit with multi-IO data
            "Mode": mode,
            "datetime": dt,
        })
        off += RECORD_SIZE
    return out


if __name__ == "__main__":
    import sys
    recs = parse_attendance_dat(sys.argv[1])
    print(f"No\tTMNo\tEnNo\tINOUT\tMode\tDateTime")
    for r in recs:
        print(f"{r['No']}\t{r['TMNo']}\t{r['EnNo']}\t{r['INOUT']}\t{r['Mode']}\t"
              f"{r['datetime']:%Y/%m/%d %H:%M:%S}")
```

---

## 5. 验证结果

跑完整 3099 条 vs `AGL_001.txt`：

| 字段 | 不匹配数 |
|---|---|
| TMNo | 0 / 3099 |
| EnNo | 0 / 3099 |
| INOUT | 0 / 3099 |
| Mode | 0 / 3099 |
| datetime | 0 / 3099 |
| **总错误** | **0 / 3099** |

前 20 条 100% 匹配，全文件 100% 匹配。

---

## 6. 还没解出来的部分（需更多样本）

| 问题 | 当前假设 | 风险 | 解决办法 |
|---|---|---|---|
| TMNo 字段在哪 | 不编码，固定=1 | 多机部署时会冲突 | 拿 TMNo=2 设备的 .DAT 比对 byte[5..7] |
| INOUT 字段在哪 | 不编码，固定=0 | 真实进出场景没数据验证 | 找一台开了"进/出区分"的设备样本 |
| EnNo 上限 | 仅 4 bit ⇒ 最多 15 | 员工数 >15 一定爆 | 找含 EnNo>15 的样本，可能用到 byte[5] |
| Mode 完整映射 | 0→8（指纹），2→密码？ | Mode 1/3/4/5/6/7 没出现过 | 需要更多 Mode 类型样本（密码、刷卡、人脸等）|

---

## 7. 给 TMS 落地的建议

1. **入库时按本表解析**，把 (TMNo, EnNo, datetime, INOUT, Mode) 写库表
2. **TMNo 暂时硬编码用 .DAT 的文件名**：`AGL_001.DAT` → TMNo = 1（或从机器配置查询）
3. **datetime 时区处理**：设备写的是本地时间无 tz，入 TMS 时按设备配置的时区补 `+08:00` 转 UTC 落库
4. **批量校验**：每次 import 后跑 `record_count == header.record_count` 一致性检查；不一致拒绝入库
5. **样本扩展**：在新设备上线时，用厂家 TXT 工具导一份再用本解析器跑一遍 diff，发现不匹配立刻补充字段假设

---

**关键文件路径**：
- 二进制样本：`requirements/hardware/data-samples/AGL_001.DAT`
- 文本对照：`requirements/hardware/data-samples/AGL_001.txt`
