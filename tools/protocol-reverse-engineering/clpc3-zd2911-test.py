#!/usr/bin/env python3
"""
CL-PC3 Zd2911 protocol test — derived from Riss.Devices.dll decompile.

Wire format (28 bytes total):
  off  0-1: magic = 0xAA55 LE  (= bytes 55 AA) when checkFlag=true (inParam=1)
                  = 0xA55A LE  (= bytes 5A A5) when checkFlag=false
  off  2-3: device DN (default 1) LE
  off  4-5: cmd (LE u16)
  off  6-7: transSize (payload length) LE
  off  8-25: payload area (max 18 bytes)
  off 26-27: checksum (LE u16) = sum of bytes [0..25] truncated to u16

Response: 28 bytes from device with response code u16 at offset 8 (0 = OK).

CMD2911 enum:
  TEST_CONNECTION = 593 (0x0251)
  GET_ENROLL_INFO = 517 (0x0205)
  GET_USER_NAME   = 545 (0x0221)
  GET_USER_INFO_BY_ID = 541 (0x021D)
  GET_ALL_USER_ENROLL_INFO = 578 (0x0242)
"""
import socket
import struct
import sys
import time

HOST = "192.168.100.153"
PORT = 5005
DN = 1
TIMEOUT = 5.0

CMD2911 = {
    "TEST_CONNECTION":            593,
    "GET_ENROLL_INFO":            517,
    "GET_USER_NAME":              545,
    "GET_USER_INFO_BY_ID":        541,
    "GET_ALL_USER_ENROLL_INFO":   578,
    "GET_DEVICE_TYPE":            None,  # search if needed
}


def build_cmd_frame(cmd: int, in_param: int, trans_size: int, payload: bytes = b"", dn: int = DN) -> bytes:
    """Build a 28-byte Zd2911 cmd frame.
    in_param=1 (checkFlag=true) → magic 55 AA. in_param=0 → magic 5A A5.
    """
    pkt = bytearray(28)
    magic = 0xAA55 if in_param == 1 else 0xA55A
    struct.pack_into("<HHHH", pkt, 0, magic, dn, cmd & 0xFFFF, trans_size & 0xFFFF)
    # copy payload into offset 8..
    if payload:
        pkt[8:8 + len(payload)] = payload
    # checksum: sum of bytes 0..25 (cmdPacketLen=26)
    chksum = sum(pkt[:26]) & 0xFFFF
    struct.pack_into("<H", pkt, 26, chksum)
    return bytes(pkt)


def hexd(b: bytes) -> str:
    return " ".join(f"{x:02x}" for x in b)


def send_recv_tcp(frame: bytes, expect_bytes: int = 28, host=HOST, port=PORT, timeout=TIMEOUT) -> bytes:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.connect((host, port))
    s.sendall(frame)
    out = b""
    deadline = time.time() + timeout
    while len(out) < expect_bytes and time.time() < deadline:
        try:
            chunk = s.recv(expect_bytes - len(out))
            if not chunk:
                break
            out += chunk
        except socket.timeout:
            break
    s.close()
    return out


def send_recv_udp(frame: bytes, expect_bytes: int = 28, host=HOST, port=PORT, timeout=TIMEOUT) -> bytes:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    s.sendto(frame, (host, port))
    try:
        data, _ = s.recvfrom(65535)
    except socket.timeout:
        data = b""
    s.close()
    return data


def parse_resp(b: bytes) -> dict:
    if len(b) < 8:
        return {"raw": hexd(b), "len": len(b), "decoded": False}
    magic = struct.unpack_from("<H", b, 0)[0]
    dn = struct.unpack_from("<H", b, 2)[0]
    cmd = struct.unpack_from("<H", b, 4)[0]
    tsize = struct.unpack_from("<H", b, 6)[0]
    rc = struct.unpack_from("<H", b, 8)[0] if len(b) >= 10 else None
    return {
        "raw": hexd(b),
        "len": len(b),
        "magic": f"0x{magic:04x}",
        "dn": dn,
        "cmd": f"0x{cmd:04x}",
        "trans_size": tsize,
        "rc_at_off8": rc,
        "rc_ok": rc == 0,
    }


def main():
    # 1) PING — TEST_CONNECTION = 593 (0x0251). transSize=0 (per TestConnection())
    ping = build_cmd_frame(cmd=593, in_param=1, trans_size=0)
    print(f"[PING build] {hexd(ping)}")

    for label, fn in (("tcp", send_recv_tcp), ("udp", send_recv_udp)):
        print(f"\n=== PING via {label.upper()} 5005 ===")
        try:
            resp = fn(ping)
        except Exception as e:
            print(f"  send/recv failed: {e}")
            continue
        if not resp:
            print("  no response (timeout)")
            continue
        info = parse_resp(resp)
        for k, v in info.items():
            print(f"  {k}: {v}")

    # 2) GET_ALL_USER_ENROLL_INFO_CODE = 578 (0x0242), maxUserCount=100, transSize=4
    payload = b"\x00\x00" + struct.pack("<H", 100)  # maxUserCount=100 at offset 2
    enroll_info = build_cmd_frame(cmd=578, in_param=1, trans_size=4, payload=payload)
    print(f"\n[GET_ALL_USER_ENROLL_INFO build] {hexd(enroll_info)}")

    for label, fn in (("tcp", send_recv_tcp), ("udp", send_recv_udp)):
        print(f"\n=== GET_ALL_USER_ENROLL_INFO via {label.upper()} 5005 ===")
        try:
            # Receive larger buffer; expect ack first
            resp = fn(enroll_info, expect_bytes=2048)
        except Exception as e:
            print(f"  send/recv failed: {e}")
            continue
        if not resp:
            print("  no response (timeout)")
            continue
        print(f"  got {len(resp)} bytes")
        print(f"  hex: {hexd(resp[:64])}{'...' if len(resp) > 64 else ''}")
        info = parse_resp(resp)
        print(f"  parsed: magic={info.get('magic')} dn={info.get('dn')} cmd={info.get('cmd')} tsize={info.get('trans_size')} rc={info.get('rc_at_off8')}")
        if info.get("rc_ok"):
            user_count = struct.unpack_from("<H", resp, 10)[0]
            print(f"  ★ USER COUNT (offset 10) = {user_count}")
            # Try to read 12-byte records starting at offset 12 if more data present
            for i in range(min(user_count, 32)):
                base = 12 + i * 12
                if base + 12 > len(resp):
                    print(f"  ... need more data via RecBigData (have {len(resp)} bytes)")
                    break
                rec = resp[base:base + 12]
                din = struct.unpack_from("<Q", rec, 0)[0]
                etype = struct.unpack_from("<H", rec, 8)[0]
                priv = rec[10]
                print(f"    user[{i}] DIN={din} EnrollType={etype} Priv={priv}  raw={hexd(rec)}")


if __name__ == "__main__":
    main()
