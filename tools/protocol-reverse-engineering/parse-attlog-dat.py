#!/usr/bin/env python3
"""Parse a `ZoucqGENLOGData` .DAT attendance dump (legacy firmware family).

Verified against `requirements/hardware/data-samples/AGL_001.DAT` —
3099/3099 records 100% match the companion .txt export.

Layout
------
Header (19 bytes):
    [0:15]   ASCII magic 'ZoucqGENLOGData'
    [15:19]  uint32 LE  record_count
Record (8 bytes), repeated record_count times:
    [0:4]    uint32 LE  timestamp = seconds since 2000-01-01 00:00:00 LOCAL TIME
    [4]      uint8      flags: high nibble = EnNo, low nibble = Mode
                        (Mode==0 in storage means Mode=8 — fingerprint default)
    [5:8]    3 bytes    reserved (all 0x00 in observed samples)

Limits / unknowns
-----------------
- EnNo only 4 bits → max 15. If real deployment > 15 employees, expect format
  to widen into byte[5..7]. Re-test with such a sample.
- TMNo, INOUT not encoded in observed sample (constants 1, 0). Multi-device or
  IO-aware deployments may use byte[5..7].
- Mode complete enum unknown; only 8 (FP) and 2 (Card?) seen.

Usage
-----
    python3 parse-attlog-dat.py <path/to/AGL_001.DAT>
"""
import datetime
import struct
import sys
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
        enno = (flag >> 4) & 0x0F
        mode_nibble = flag & 0x0F
        mode = mode_nibble if mode_nibble != 0 else 8
        dt = EPOCH + datetime.timedelta(seconds=ts)
        out.append({
            "No": i,
            "TMNo": 1,
            "EnNo": enno,
            "INOUT": 0,
            "Mode": mode,
            "datetime": dt,
        })
        off += RECORD_SIZE
    return out


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    recs = parse_attendance_dat(sys.argv[1])
    print(f"No\tTMNo\tEnNo\tINOUT\tMode\tDateTime")
    for r in recs:
        print(f"{r['No']}\t{r['TMNo']}\t{r['EnNo']}\t{r['INOUT']}\t{r['Mode']}\t"
              f"{r['datetime']:%Y/%m/%d %H:%M:%S}")
