#!/usr/bin/env python3
"""CL-PC3 Protocol B control probe.

This is the Session B companion to ``clpc3-realsvr-push-reader.py``.
It targets the device's TCP 5005 control socket and keeps write/control
commands guarded behind explicit flags.

Static reverse source:

* ``FP_CLOCK.ocx`` ``OpendoorEx`` calls ``SendCommandX(0x137, door, 0)``.
* ``FP_CLOCK.ocx`` ``SetDeviceTime`` calls ``SendCommandX(0x112, 0, 0)``.

The direct 5005 frame format was confirmed earlier from ``TMPCCOMM.dll``:

    55 aa <mid:LE16> 79 19 <cmd:LE16> <arg2:LE32> <arg1:LE16> <sum:LE16>
"""

from __future__ import annotations

import argparse
import json
import socket
import struct
import sys
from dataclasses import asdict, dataclass


DEFAULT_HOST = "192.168.100.153"
DEFAULT_PORT = 5005
DEFAULT_MACHINE_ID = 1

DESTRUCTIVE_COMMANDS = {
    0x11A: "EMPTY_ENROLL",
    0x11B: "EMPTY_GEN_LOG",
    0x11C: "EMPTY_SUP_LOG",
    0x128: "USERCTRL_CLR",
    0x115: "POWER_OFF",
}

KNOWN_COMMANDS = {
    0x0052: "PING",
    0x0112: "SET_DEV_TIME_VENDOR_STYLE",
    0x0113: "GET_DEV_TIME",
    0x0120: "GET_DOOR",
    0x0121: "SET_DOOR",
    0x0137: "OPEN_DOOR_EX",
}

READ_ONLY_COMMANDS = {
    0x0052,
    0x0101,
    0x0104,
    0x0105,
    0x0106,
    0x0107,
    0x0108,
    0x0109,
    0x010A,
    0x010D,
    0x010E,
    0x0113,
    0x0117,
    0x0118,
    0x0119,
    0x011D,
    0x0120,
    0x0122,
    0x0125,
    0x0129,
    0x012B,
    0x012D,
    0x0133,
    0x0135,
    0x0136,
    0x0138,
    0x0139,
    0x013A,
    0x0513,
    0x0514,
}


@dataclass
class CommandResult:
    cmd: int
    name: str
    arg2: int
    arg1: int
    request_hex: str
    sent: bool
    ack_hex: str | None = None
    ack_valid: bool = False
    ack_mid: int | None = None
    ack_flags: int | None = None
    ack_checksum: int | None = None
    extra_hex: str = ""


def encode_password(pwd: int) -> int:
    src = pwd.to_bytes(4, "little")
    enc = bytes(src[i] ^ i ^ 0x5B for i in range(4))
    return int.from_bytes(enc, "little")


def build_request(machine_id: int, cmd: int, arg2: int = 0, arg1: int = 0, password: int = 0) -> bytes:
    if cmd in DESTRUCTIVE_COMMANDS:
        raise ValueError(f"refusing destructive command 0x{cmd:03x} ({DESTRUCTIVE_COMMANDS[cmd]})")

    buf = bytearray(16)
    buf[0] = 0x55
    buf[1] = 0xAA
    struct.pack_into("<H", buf, 2, machine_id & 0xFFFF)
    buf[4] = 0x79
    buf[5] = 0x19
    struct.pack_into("<H", buf, 6, cmd & 0xFFFF)
    if password:
        arg2 = (arg2 ^ encode_password(password)) & 0xFFFFFFFF
    struct.pack_into("<I", buf, 8, arg2 & 0xFFFFFFFF)
    struct.pack_into("<H", buf, 12, arg1 & 0xFFFF)
    struct.pack_into("<H", buf, 14, sum(buf[:14]) & 0xFFFF)
    return bytes(buf)


def parse_ack(data: bytes) -> tuple[bool, int | None, int | None, int | None]:
    if len(data) < 10 or data[0:2] != b"\xaa\x55":
        return False, None, None, None
    return (
        True,
        struct.unpack_from("<H", data, 2)[0],
        struct.unpack_from("<I", data, 4)[0],
        struct.unpack_from("<H", data, 8)[0],
    )


def recv_available(sock: socket.socket, timeout: float) -> bytes:
    sock.settimeout(timeout)
    data = bytearray()
    while True:
        try:
            chunk = sock.recv(8192)
        except socket.timeout:
            break
        if not chunk:
            break
        data.extend(chunk)
        if len(data) >= 10:
            sock.settimeout(0.2)
    return bytes(data)


def run_command(args: argparse.Namespace, cmd: int, arg2: int, arg1: int, *, write_guard: bool) -> CommandResult:
    frame = build_request(args.machine_id, cmd, arg2=arg2, arg1=arg1, password=args.password)
    result = CommandResult(
        cmd=cmd,
        name=KNOWN_COMMANDS.get(cmd, f"CMD_0x{cmd:03x}"),
        arg2=arg2,
        arg1=arg1,
        request_hex=frame.hex(" "),
        sent=False,
    )

    if write_guard and not (args.execute and args.i_understand):
        return result
    if args.dry_run:
        return result

    with socket.create_connection((args.host, args.port), timeout=args.timeout) as sock:
        sock.settimeout(args.timeout)
        sock.sendall(frame)
        rx = recv_available(sock, args.timeout)

    result.sent = True
    result.ack_hex = rx[:10].hex(" ") if rx else None
    result.extra_hex = rx[10:].hex(" ") if len(rx) > 10 else ""
    valid, mid, flags, chk = parse_ack(rx)
    result.ack_valid = valid
    result.ack_mid = mid
    result.ack_flags = flags
    result.ack_checksum = chk
    return result


def print_result(result: CommandResult) -> int:
    payload = asdict(result)
    payload["cmd"] = f"0x{result.cmd:03x}"
    if result.ack_flags is not None:
        payload["ack_flags"] = f"0x{result.ack_flags:08x}"
    if result.ack_checksum is not None:
        payload["ack_checksum"] = f"0x{result.ack_checksum:04x}"
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if (not result.sent or result.ack_valid) else 2


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--machine-id", type=int, default=DEFAULT_MACHINE_ID)
    parser.add_argument("--password", type=int, default=0, help="Comm password; default 0")
    parser.add_argument("--timeout", type=float, default=2.0)
    parser.add_argument("--dry-run", action="store_true", help="Build bytes but do not connect")
    parser.add_argument("--execute", action="store_true", help="Allow guarded write/control commands to be sent")
    parser.add_argument("--i-understand", action="store_true", help="Second guard for write/control commands")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)

    ping = sub.add_parser("ping", help="Send read-only cmd 0x52")
    add_common(ping)

    door_status = sub.add_parser("door-status", help="Send read-only cmd 0x120")
    add_common(door_status)

    open_door = sub.add_parser("open-door", help="Build/send OpendoorEx cmd 0x137")
    add_common(open_door)
    open_door.add_argument("--door", type=int, default=1, help="LMT API door parameter; 1 is the observed default")

    set_time = sub.add_parser("set-time-vendor-style", help="Build/send FP_CLOCK.ocx SetDeviceTime frame")
    add_common(set_time)

    raw = sub.add_parser("raw", help="Build/send a non-destructive Protocol B command")
    add_common(raw)
    raw.add_argument("--cmd", required=True, type=lambda s: int(s, 0))
    raw.add_argument("--arg2", type=lambda s: int(s, 0), default=0)
    raw.add_argument("--arg1", type=lambda s: int(s, 0), default=0)
    raw.add_argument("--write-guard", action="store_true")

    args = parser.parse_args(argv)
    if args.action == "ping":
        result = run_command(args, 0x52, 0, 0, write_guard=False)
    elif args.action == "door-status":
        result = run_command(args, 0x120, 0, 0, write_guard=False)
    elif args.action == "open-door":
        result = run_command(args, 0x137, args.door, 0, write_guard=True)
    elif args.action == "set-time-vendor-style":
        result = run_command(args, 0x112, 0, 0, write_guard=True)
    elif args.action == "raw":
        result = run_command(
            args,
            args.cmd,
            args.arg2,
            args.arg1,
            write_guard=args.write_guard or args.cmd not in READ_ONLY_COMMANDS,
        )
    else:
        parser.error(f"unknown action {args.action}")

    return print_result(result)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
