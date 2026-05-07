#!/usr/bin/env python3
"""Force BigData read after every ACK regardless of flags.
Hypothesis: flags=0x10 means 16-byte BigData follows, not 'no data'."""
import sys, importlib.util
spec = importlib.util.spec_from_file_location("clpc3", "/Users/sunfl/Documents/work/DuoCode/products/WEMAX-TMS/tools/protocol-reverse-engineering/clpc3-full-roundtrip.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

def show(label, r):
    print(f"\n=== {label} ===")
    print(f"  ACK flags: 0x{r['ack_flags']:08x}  ack_chk: {r['ack_chk']}")
    print(f"  data_len:  {r['data_len']} bytes")
    if r.get('data_bytes'):
        d = r['data_bytes']
        print(f"  data hex (first 256B):")
        for i in range(0, min(len(d), 256), 32):
            chunk = d[i:i+32]
            ascii_ = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
            print(f"     {i:04x}  {chunk.hex()}  |{ascii_}|")
        if len(d) > 256: print(f"  ... ({len(d)-256}B more)")

with m.CLPC3Client() as c:
    print(f"Connected, MID={c.machine_id}, pwd={c.password}\n")
    # Always expect_big — read whatever comes after ACK with longer hold
    show("ping",                           c.send_cmd(0x52,  expect_big=True, hold_after_ack=4.0))
    show("get_device_status (0x10D)",      c.send_cmd(0x10D, expect_big=True, hold_after_ack=4.0))
    show("get_serial (0x119)",             c.send_cmd(0x119, expect_big=True, hold_after_ack=4.0))
    show("get_device_info (0x10E)",        c.send_cmd(0x10E, expect_big=True, hold_after_ack=4.0))
    show("get_device_time (0x113)",        c.send_cmd(0x113, expect_big=True, hold_after_ack=4.0))
    show("get_all_user_id (0x117)",        c.send_cmd(0x117, expect_big=True, hold_after_ack=5.0))
    show("read_all_glog (0x10A)",          c.send_cmd(0x10A, expect_big=True, hold_after_ack=5.0))
    show("get_enroll uid=1 fp",            c.send_cmd(0x101, arg2=(1<<28)|1, arg1=1, expect_big=True, hold_after_ack=5.0))
    show("get_enroll uid=1 face A (arg1=7)", c.send_cmd(0x101, arg2=(20<<28)|1, arg1=7, expect_big=True, hold_after_ack=5.0))
    show("PHOTO_SIZE_CS uid=1 (0x513)",    c.send_cmd(0x513, arg2=1, expect_big=True, hold_after_ack=4.0))
    show("PHOTO_GET_CS uid=1 (0x514)",     c.send_cmd(0x514, arg2=1, expect_big=True, hold_after_ack=8.0))
