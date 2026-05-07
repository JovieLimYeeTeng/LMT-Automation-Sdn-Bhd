#!/usr/bin/env python3
"""
[STATUS: untested against device — DO NOT RUN until owner reviews opcode table below]

OPCODE SOURCE: /tmp/clpc3-rev/riss/Riss.Devices.decompiled.cs lines 12266-12320
(decompile of requirements/hardware/software/tms-setup-V1.0.402/Riss.Devices.dll).
This is the same .NET assembly used by the customer's TMS.exe (17 MB, 2024-06-24).

NOTE the mapping below CONFLICTS with the prior CLAUDE.md red-line list. Per Riss:
  0x0117 = CMD_ENROLL_DATA_EMPTY  (DESTRUCTIVE)
  0x0118 = CMD_GLOG_EMPTY         (DESTRUCTIVE)
  0x0119 = CMD_SLOG_EMPTY         (DESTRUCTIVE)
  0x011A = CMD_USER_NAME_GET      (SAFE READ)        ← prior table said EMPTY_ENROLL
  0x011B = CMD_USER_NAME_SET      (destructive write)
  0x011C = CMD_COMPANY_NAME_GET   (SAFE READ)        ← prior table said EMPTY_SUP_LOG
  0x011D = CMD_COMPANY_NAME_SET   (destructive write)
The DESTRUCTIVE set below is keyed on the Riss enum, not the prior labelling.

CL-PC3 user list reader — Zd100 / FP_CLOCK Protocol B (correct opcodes from Riss.Devices.dll).

WIRE FORMAT
-----------
Cmd  (PC→Dev, 16 bytes, struct Staff):
   55 AA | DN(2 LE) | 79 19 | cmd(2 LE) | length(4 LE) | inParam(2 LE) | sum(2 LE)

Cmd-Ack (Dev→PC, 8 bytes, struct CommandAck — sometimes inflated to 10 by CL-PC3):
   5A A5 | MachineID(2) | Response(2) | ChkSum(2)

CmdRes (Dev→PC, 14 bytes, struct CommandRes — what RecExeResult expects):
   AA 55 | MachineID(2) | Reserved(2) | Ret(2) | OutParam(4) | ChkSum(2)

   OBSERVED: CL-PC3 returns 10 bytes prefixed AA 55 instead of 8+14. Layout looks like:
   AA 55 | MachineID(2) | Flags(2) | OutParam(2) | ChkSumEcho(2)

Data block (Dev→PC, 1024+6 bytes = 1030 max chunk, prefix 5A A5):
   5A A5 | DN(2) | data(N) | ChkSum(2)

KEY OPCODES (per Riss.Devices.dll enum):
   CMD_GET_ENROLL_DATA   = 257 (0x0101)   2-stage: count then BigData (per-user fingerprint blob)
   CMD_READ_ALL_USERID   = 274 (0x0112)   2-stage: count then BigData (8-byte EnrollUserID per record)
   CMD_USER_NAME_GET     = 282 (0x011A)   per-user name read

DESTRUCTIVE — DO NOT SEND:
   CMD_ENROLL_DATA_EMPTY = 279 (0x0117) — DELETES ALL USERS
   CMD_GLOG_EMPTY        = 280 (0x0118)
   CMD_SLOG_EMPTY        = 281 (0x0119)

EnrollUserID struct (8 bytes/record):
   uint ID; byte EMachineNumber; byte BackupNumber; byte MachinPrivilege; byte Enable;
"""
import socket
import struct
import sys
import time

HOST = "192.168.100.153"
PORT = 5005
DN = 1
TIMEOUT = 8.0

# Read-only opcodes (safe)
CMD_READ_ALL_USERID = 0x0112  # 274
CMD_USER_NAME_GET   = 0x011A  # 282
CMD_GET_ENROLL_DATA = 0x0101  # 257
CMD_BACKUP_NUM_GET  = 0x0115  # 277  — but check: 277 = 0x115. Test only.
CMD_DEVICE_TIME_GET = 0x010E  # 270
CMD_SERIAL_NUM_GET  = 0x0113  # 275

# Destructive — never send
DESTRUCTIVE = {0x0117, 0x0118, 0x0119, 0x012F}  # EMPTY_*, USERCTRL_CLR


def build_cmd(cmd: int, in_param: int = 0, length: int = 0, dn: int = DN) -> bytes:
    """Build 16-byte Zd100 cmd packet (FP_CLOCK Protocol B)."""
    if cmd in DESTRUCTIVE:
        raise RuntimeError(f"refusing destructive opcode 0x{cmd:04x}")
    # struct Staff (1+1+2+2+2+4+2+2 = 16 bytes, no padding):
    pkt = struct.pack(
        "<BBHHHIH",
        0x55,           # head1
        0xAA,           # head2
        dn & 0xFFFF,    # dn
        0x1979,         # reserved (sub-magic)
        cmd & 0xFFFF,   # command
        length & 0xFFFFFFFF,  # length
        in_param & 0xFFFF,    # inParam
    )
    chk = sum(pkt) & 0xFFFF
    pkt += struct.pack("<H", chk)
    assert len(pkt) == 16
    return pkt


def hexd(b: bytes, max_len: int = 80) -> str:
    s = " ".join(f"{x:02x}" for x in b[:max_len])
    if len(b) > max_len:
        s += f" ... (+{len(b)-max_len} bytes)"
    return s


class Zd100Conn:
    def __init__(self, host=HOST, port=PORT, timeout=TIMEOUT, dn=DN, verbose=True):
        self.host, self.port, self.timeout, self.dn = host, port, timeout, dn
        self.verbose = verbose
        self.s = None

    def open(self):
        self.s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.s.settimeout(self.timeout)
        self.s.connect((self.host, self.port))
        if self.verbose:
            print(f"[conn] open tcp://{self.host}:{self.port}")

    def close(self):
        if self.s:
            try:
                self.s.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            self.s.close()
            self.s = None

    def send(self, frame: bytes):
        if self.verbose:
            print(f"[tx {len(frame)}B] {hexd(frame)}")
        self.s.sendall(frame)

    def recv_until_quiet(self, max_bytes=8192, idle_ms=400) -> bytes:
        """Read everything the device sends until idle for idle_ms or max_bytes hit."""
        out = b""
        end = time.time() + self.timeout
        self.s.settimeout(idle_ms / 1000.0)
        while len(out) < max_bytes and time.time() < end:
            try:
                chunk = self.s.recv(max_bytes - len(out))
                if not chunk:
                    break
                out += chunk
            except socket.timeout:
                if out:
                    break  # quiet → done
        self.s.settimeout(self.timeout)
        if self.verbose:
            print(f"[rx {len(out)}B] {hexd(out)}")
        return out

    def send_command_get_response(self, cmd: int, in_param: int, length: int) -> dict:
        """Send a Zd100 cmd, collect everything device returns."""
        if self.verbose:
            print(f"\n--- cmd=0x{cmd:04x} inParam={in_param} length={length} ---")
        frame = build_cmd(cmd=cmd, in_param=in_param, length=length, dn=self.dn)
        self.send(frame)
        resp = self.recv_until_quiet(max_bytes=65536, idle_ms=600)
        return parse_response(resp)


def parse_response(b: bytes) -> dict:
    """Parse whatever the device returned. May contain ack(s) + data block(s) concatenated."""
    out = {"raw": b, "len": len(b), "blocks": []}
    i = 0
    while i < len(b):
        if i + 2 > len(b):
            out["blocks"].append({"type": "tail-truncated", "off": i, "bytes": b[i:].hex()})
            break
        h1, h2 = b[i], b[i + 1]
        if h1 == 0xAA and h2 == 0x55:
            # CommandRes-ish (might be 10 or 14 bytes)
            blk_size = None
            for sz in (14, 10, 8):
                if i + sz <= len(b):
                    test = b[i:i + sz]
                    chk_off = sz - 2
                    chk = struct.unpack_from("<H", test, chk_off)[0]
                    s = sum(test[:chk_off]) & 0xFFFF
                    # Don't validate sum (CL-PC3 echoes request chksum, not computed)
                    blk_size = sz
                    if s == chk:
                        break
            blk_size = blk_size or min(10, len(b) - i)
            blk = b[i:i + blk_size]
            mid = struct.unpack_from("<H", blk, 2)[0] if blk_size >= 4 else None
            # 14-byte layout: AA 55 | MID(2) | Reserved(2) | Ret(2) | OutParam(4) | Chk(2)
            # 10-byte layout: AA 55 | MID(2) | Flags(2)    | OutParam(2)         | Chk(2)
            if blk_size == 14:
                _, _, mid_, res, ret, outp, chk = struct.unpack("<BBHHHIH", blk)
                out["blocks"].append({
                    "type": "CmdRes14", "off": i, "size": 14,
                    "MID": mid_, "Reserved": res, "Ret": ret, "OutParam": outp, "ChkSum": f"0x{chk:04x}",
                    "hex": hexd(blk),
                })
            elif blk_size == 10:
                _, _, mid_, flags, outp, chk = struct.unpack("<BBHHHH", blk)
                out["blocks"].append({
                    "type": "CmdRes10", "off": i, "size": 10,
                    "MID": mid_, "Flags": f"0x{flags:04x}", "OutParam": outp, "ChkSum": f"0x{chk:04x}",
                    "hex": hexd(blk),
                })
            else:
                out["blocks"].append({"type": f"AA55-{blk_size}", "off": i, "size": blk_size, "hex": hexd(blk)})
            i += blk_size
        elif h1 == 0x5A and h2 == 0xA5:
            # CommandAck (8) or DataBlock (variable, prefix + DN(2) + data + chk(2))
            # Try 8-byte ack first
            if i + 8 <= len(b):
                ack = b[i:i + 8]
                _, _, mid, resp, chk = struct.unpack("<BBHHH", ack)
                # Could be ack OR start of bigger data block. Heuristic: if next bytes look like 5A A5/AA 55 magic, this was an 8-byte ack.
                next_is_magic = (
                    i + 8 < len(b) and b[i + 8] in (0x5A, 0xAA) and b[i + 9] in (0xA5, 0x55)
                )
                eats_rest = i + 8 == len(b)
                if next_is_magic or eats_rest:
                    out["blocks"].append({
                        "type": "CmdAck8", "off": i, "size": 8,
                        "MID": mid, "Response": resp, "ChkSum": f"0x{chk:04x}",
                        "hex": hexd(ack),
                    })
                    i += 8
                    continue
            # Otherwise treat as DataBlock: 5A A5 | DN(2) | data... | chk(2)
            # We don't know data length up front; assume it spans till next AA55/5AA5 magic OR end.
            j = i + 2
            data_end = len(b)
            while j + 1 < len(b):
                if (b[j] == 0xAA and b[j + 1] == 0x55) or (b[j] == 0x5A and b[j + 1] == 0xA5):
                    data_end = j
                    break
                j += 1
            blk = b[i:data_end]
            if len(blk) >= 6:
                mid = struct.unpack_from("<H", blk, 2)[0]
                payload = blk[4:-2]
                chk = struct.unpack_from("<H", blk, len(blk) - 2)[0]
                out["blocks"].append({
                    "type": "DataBlock", "off": i, "size": len(blk),
                    "MID": mid, "PayloadBytes": len(payload), "ChkSum": f"0x{chk:04x}",
                    "Payload": payload.hex(),
                })
            else:
                out["blocks"].append({"type": "5AA5-short", "off": i, "size": len(blk), "hex": hexd(blk)})
            i = data_end
        else:
            # Unknown — capture rest as raw and stop
            out["blocks"].append({"type": "unknown", "off": i, "rest_hex": hexd(b[i:])})
            break
    return out


def parse_enroll_user_records(payload: bytes) -> list:
    """8-byte EnrollUserID records: uint ID, byte EMachineNumber, byte BackupNumber, byte MachinPrivilege, byte Enable."""
    out = []
    n = len(payload) // 8
    for i in range(n):
        rec = payload[i * 8:(i + 1) * 8]
        uid, emn, bn, priv, en = struct.unpack("<IBBBB", rec)
        out.append({
            "EnrollID": uid,
            "EMachineNum": emn,
            "BackupNumber": bn,  # 0..9 finger, 10=password, 11=card, 20..28 face
            "Privilege": priv,
            "Enable": en,
            "raw": rec.hex(),
        })
    return out


CMD_INTERNAL_CHECK_PASSWORD = 0x0052  # 82 — sent on session open per Zd100Connection.StartComm


def main():
    print(f"=== CL-PC3 Zd100/FP_CLOCK READ_ALL_USERID 2-stage probe ===")
    print(f"Target: {HOST}:{PORT}, DN={DN}\n")

    c = Zd100Conn()
    c.open()
    try:
        # STAGE 0: authenticate. Per Zd100Connection.StartComm:
        #   SendCommand(InternalCheckDevicePassword, inParam=0, transSize=password)
        # password is 0 per customer MDB.
        print("\n=== STAGE 0: auth (InternalCheckDevicePassword pwd=0) ===")
        r0 = c.send_command_get_response(cmd=CMD_INTERNAL_CHECK_PASSWORD, in_param=0, length=0)
        for b in r0["blocks"]:
            print(f"  {b}")

        # Sanity probes: read-only opcodes we expect to return non-zero outparam.
        for label, cmd in (
            ("DEVICE_TIME_GET", CMD_DEVICE_TIME_GET),
            ("SERIAL_NUM_GET",  CMD_SERIAL_NUM_GET),
            ("BACKUP_NUM_GET",  CMD_BACKUP_NUM_GET),
        ):
            print(f"\n=== Probe: {label} (cmd=0x{cmd:04x}, inParam=0, length=0) ===")
            rp = c.send_command_get_response(cmd=cmd, in_param=0, length=0)
            for b in rp["blocks"]:
                print(f"  {b}")

        # Variant A: longer recv on STAGE 1
        print("\n=== STAGE 1A: READ_ALL_USERID(0,0) with 5s idle ===")
        c.send(build_cmd(cmd=CMD_READ_ALL_USERID, in_param=0, length=0))
        slow = c.recv_until_quiet(max_bytes=65536, idle_ms=5000)
        print(f"  total recv: {len(slow)} bytes, hex: {hexd(slow, 256)}")
        r1 = parse_response(slow)

        # Variant B: skip stage1, send stage2 directly with non-zero length
        for guess_len in (8, 16, 32, 64, 128, 256, 512, 1024):
            print(f"\n=== STAGE 1B: READ_ALL_USERID(1,{guess_len}) direct stage 2 ===")
            c.send(build_cmd(cmd=CMD_READ_ALL_USERID, in_param=1, length=guess_len))
            slow = c.recv_until_quiet(max_bytes=65536, idle_ms=2000)
            print(f"  recv {len(slow)} bytes: {hexd(slow, 200)}")
            if len(slow) > 16:
                print(f"  ★ device sent more than minimal ack — investigating ★")

        # Variant C: inParam=1, length=0 (also worth trying)
        print(f"\n=== Variant C: READ_ALL_USERID(1,0) ===")
        c.send(build_cmd(cmd=CMD_READ_ALL_USERID, in_param=1, length=0))
        slow = c.recv_until_quiet(max_bytes=65536, idle_ms=2000)
        print(f"  recv {len(slow)} bytes: {hexd(slow, 200)}")
        print("\n[STAGE 1 PARSED]")
        for b in r1["blocks"]:
            print(f"  {b}")

        # Look for OutParam in first AA55 block
        out_param_bytes = None
        for blk in r1["blocks"]:
            if blk["type"] in ("CmdRes14", "CmdRes10"):
                out_param_bytes = blk.get("OutParam")
                break
        if out_param_bytes is None:
            print("\n[!] no OutParam found in stage-1 response — aborting")
            return
        print(f"\n[+] STAGE 1 OutParam = {out_param_bytes} (= bytes of user data device claims to have)")

        if out_param_bytes == 0:
            print("[!] device says zero users — but we know there are at least 3. Trying stage 2 with length=8 anyway.")
            # device might encode 'count of users' rather than bytes; try both
            out_param_bytes_try = 8 * 16  # 16 users * 8 bytes/record
        else:
            out_param_bytes_try = out_param_bytes

        # STAGE 2: fetch (inParam=1, length=out_param_bytes from stage 1)
        r2 = c.send_command_get_response(cmd=CMD_READ_ALL_USERID, in_param=1, length=out_param_bytes_try)
        print("\n[STAGE 2 PARSED]")
        for b in r2["blocks"]:
            print(f"  {b}")

        # Try to find a DataBlock and decode 8-byte EnrollUserID records
        for blk in r2["blocks"]:
            if blk["type"] == "DataBlock":
                payload_hex = blk["Payload"]
                payload = bytes.fromhex(payload_hex)
                recs = parse_enroll_user_records(payload)
                print(f"\n[★] DataBlock has {len(payload)} bytes → {len(recs)} EnrollUserID records:")
                for r in recs:
                    print(f"    {r}")

    finally:
        c.close()


if __name__ == "__main__":
    main()
