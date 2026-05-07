#!/usr/bin/env python3
"""Pull REAL data from CL-PC3 now that Benny enrolled himself + did 1 face scan."""
import sys
sys.path.insert(0, "/Users/sunfl/Documents/work/DuoCode/products/WEMAX-TMS/tools/protocol-reverse-engineering")
import importlib.util
spec = importlib.util.spec_from_file_location("clpc3", "/Users/sunfl/Documents/work/DuoCode/products/WEMAX-TMS/tools/protocol-reverse-engineering/clpc3-full-roundtrip.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

def show(label, result):
    print(f"\n=== {label} ===")
    if isinstance(result, dict):
        ack = result.get('ack_flags', '?')
        print(f"  ACK flags: 0x{ack:08x}" if isinstance(ack, int) else f"  ACK flags: {ack}")
        print(f"  data_len:  {result.get('data_len', 0)}")
        if result.get('data_bytes'):
            d = result['data_bytes']
            print(f"  data hex (first 128B): {d[:128].hex()}")
            if len(d) > 128: print(f"  ... ({len(d)-128}B more)")
    else:
        print(f"  → {result}")

with m.CLPC3Client() as c:
    print(f"Connected to {c.host}:{c.port}, MID={c.machine_id}, pwd={c.password}")

    show("ping (cmd 0x52)",                c.ping())
    show("get_device_status (0x10D)",      c.get_device_status())
    show("get_serial (0x119)",             c.get_serial())
    show("get_device_info (0x10E)",        c.get_device_info())
    show("get_device_time (0x113)",        c.get_device_time())
    show("get_mac_code (0x138)",           c.get_mac_code())
    show("get_all_user_id (0x117)",        c.get_all_user_id())
    show("read_all_glog (0x10A) - 全部打卡", c.read_all_glog())
    show("read_all_slog (0x108) - 管理日志", c.read_all_slog())
    show("get_enroll uid=1 backup=1 (fp)",  c.get_enroll_data(1, 1))
    show("get_enroll uid=1 backup=20 (face A)", c.get_enroll_data(1, 20))
    show("get_enroll uid=1 backup=30 (face B)", c.get_enroll_data(1, 30))
    show("PHOTO_SIZE_CS uid=1 (0x513)",     c.send_cmd(0x513, arg2=1))
