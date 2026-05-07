#!/usr/bin/env python3
"""Try TMPCCOMM Protocol B handshake against Click CL-PC3 (172.20.10.2:5005)."""
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

def hexdump(b):
    return ' '.join(f'{x:02x}' for x in b)

def try_one(label, frame):
    s = socket.socket(); s.settimeout(3)
    try:
        s.connect((HOST, PORT))
        s.sendall(frame)
        s.settimeout(2)
        rx = b""
        try:
            while len(rx) < 14:
                c = s.recv(64)
                if not c: break
                rx += c
        except socket.timeout: pass
        if rx:
            tag = "✅" if rx[:2] == b"\xAA\x55" else "?"
            print(f"  {tag} {label}: rx({len(rx)}B)= {hexdump(rx)}")
            return True
        print(f"  ✗ {label}: timeout")
        return False
    except Exception as e:
        print(f"  ✗ {label}: {e}")
        return False
    finally: s.close()

print(f"=== Protocol B probe → {HOST}:{PORT} ===")
hits = 0
for label, mid, cmd in [
    ("0x52 ping  MID=1",   1, 0x52),
    ("0x52 ping  MID=0",   0, 0x52),
    ("0x52 ping  MID=255", 0xFF, 0x52),
    ("0x46 GetSerial MID=1", 1, 0x46),
    ("0x12 GetDevInfo MID=1", 1, 0x12),
    ("0x66 GetMac MID=1",  1, 0x66),
    ("0x0101 GetEnroll MID=1", 1, 0x0101),
]:
    if try_one(label, b_legacy(mid, cmd)):
        hits += 1
    time.sleep(0.3)
print(f"\nTotal: {hits}/7 got response")
