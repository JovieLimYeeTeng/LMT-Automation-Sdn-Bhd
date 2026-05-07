#!/usr/bin/env python3
"""Try to actually pull data (not just ACK) from CL-PC3.

Strategy: send each cmd, then wait long for BigData stream.
"""
import socket, struct, time

HOST, PORT = "172.20.10.2", 5005

def b_legacy(machine_id: int, cmd: int, arg2: int = 0, arg1: int = 0) -> bytes:
    buf = bytearray(16)
    buf[0] = 0x55; buf[1] = 0xAA
    struct.pack_into("<H", buf, 2, machine_id & 0xFFFF)
    buf[4] = 0x79; buf[5] = 0x19
    struct.pack_into("<H", buf, 6, cmd & 0xFFFF)
    struct.pack_into("<I", buf, 8, arg2 & 0xFFFFFFFF)
    struct.pack_into("<H", buf, 12, arg1 & 0xFFFF)
    struct.pack_into("<H", buf, 14, sum(buf[0:14]) & 0xFFFF)
    return bytes(buf)

def hd(b): return ' '.join(f'{x:02x}' for x in b)

def probe(label, frames, hold=4.0):
    """Send list of frames sequentially, hold socket open, dump everything."""
    s = socket.socket(); s.settimeout(3)
    try:
        s.connect((HOST, PORT))
        for i, f in enumerate(frames):
            s.sendall(f)
            time.sleep(0.3)
        s.settimeout(hold)
        rx = b""
        try:
            t_end = time.time() + hold
            while time.time() < t_end:
                c = s.recv(4096)
                if not c: break
                rx += c
        except socket.timeout: pass
        if rx:
            print(f"  [{label}] rx({len(rx)}B):")
            for i in range(0, min(len(rx), 256), 32):
                print(f"     {hd(rx[i:i+32])}")
            if len(rx) > 256:
                print(f"     ... ({len(rx)-256}B more)")
        else:
            print(f"  [{label}] no data")
    except Exception as e:
        print(f"  [{label}] err {e}")
    finally: s.close()

print("=== ping → look for follow-up data after ACK ===")
probe("ping+wait", [b_legacy(1, 0x52)], hold=3.0)

print()
print("=== sweep more cmds (looking for any > 10B response) ===")
# More cmd opcodes from agent reports + common Anviz/ZK/Click conventions
test_cmds = [
    ("0x14 GetEnrollData?",      0x14),
    ("0x32 GetAllEnrollIDs?",    0x32),
    ("0x44 GetGLogData",         0x44),
    ("0x4C GetSuperLogData",     0x4C),
    ("0x60 GetUserName",         0x60),
    ("0x6E DeviceStatus",        0x6E),
    ("0x73 GetDeviceTime",       0x73),
    ("0x46 GetSerialNumber",     0x46),
    ("0x66 GetMac",              0x66),
    ("0x12 GetDeviceInfo",       0x12),
    ("0x22 GetCount",            0x22),
    ("0x80 high cmd",            0x80),
    ("0x801 GetAllUserID",       0x801),
    ("0x807 GetAttRecord",       0x807),
]
for label, cmd in test_cmds:
    probe(label, [b_legacy(1, cmd)], hold=2.0)
    time.sleep(0.2)
