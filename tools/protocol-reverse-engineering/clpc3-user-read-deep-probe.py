#!/usr/bin/env python3
"""CL-PC3 read-only user-data deep probe for Click Protocol B.

This reproduces the current best TCP 5005 user-read attempts:

* keep one TCP connection open;
* send the same PING shape observed from the vendor OCX (cmd 0x52, arg2=1);
* query user IDs, user names, enroll templates, and photo bytes for known IDs.

By default this script sends only read commands. The optional
``--with-enable-window`` mode wraps reads in ``ENABLE_DEV 0`` / ``ENABLE_DEV 1``
because some vendor SDK flows pause the device before bulk reads. The restore
command is sent in ``finally``.
"""

from __future__ import annotations

import argparse
import json
import socket
import struct
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path


DEFAULT_HOST = "192.168.100.153"
DEFAULT_PORT = 5005
DEFAULT_MACHINE_ID = 1

READ_COMMANDS = {
    0x0052: "PING",
    0x0101: "GET_ENROLL",
    0x0113: "GET_DEV_TIME",
    0x0117: "READ_ALL_USER_ID",
    0x0118: "GET_ALL_USER_ID",
    0x0119: "GET_SERIAL",
    0x011D: "GET_USER_NAME",
    0x013A: "GET_NAME_UTF8",
    0x0513: "PHOTO_SIZE_CS",
    0x0514: "PHOTO_GET_CS",
}

GUARDED_COMMANDS = {
    0x0110: "ENABLE_DEV",
}

REFUSE_COMMANDS = {
    0x011A: "EMPTY_ENROLL",
    0x011B: "EMPTY_GEN_LOG",
    0x011C: "EMPTY_SUP_LOG",
    0x0128: "USERCTRL_CLR",
    0x0115: "POWER_OFF",
    0x0137: "OPEN_DOOR_EX",
}


@dataclass
class ProbeResult:
    label: str
    cmd: str
    arg2: str
    arg1: str
    tx: str
    rx_len: int
    rx: str
    ack_valid: bool
    ack_flags: str | None


def hexsp(data: bytes) -> str:
    return data.hex(" ")


def build_request(machine_id: int, cmd: int, arg2: int = 0, arg1: int = 0) -> bytes:
    if cmd in REFUSE_COMMANDS:
        raise ValueError(f"refusing dangerous command 0x{cmd:03x} ({REFUSE_COMMANDS[cmd]})")
    if cmd not in READ_COMMANDS and cmd not in GUARDED_COMMANDS:
        raise ValueError(f"refusing unknown command 0x{cmd:03x}")

    buf = bytearray(16)
    buf[0] = 0x55
    buf[1] = 0xAA
    struct.pack_into("<H", buf, 2, machine_id & 0xFFFF)
    buf[4] = 0x79
    buf[5] = 0x19
    struct.pack_into("<H", buf, 6, cmd & 0xFFFF)
    struct.pack_into("<I", buf, 8, arg2 & 0xFFFFFFFF)
    struct.pack_into("<H", buf, 12, arg1 & 0xFFFF)
    struct.pack_into("<H", buf, 14, sum(buf[:14]) & 0xFFFF)
    return bytes(buf)


def parse_ack(data: bytes) -> tuple[bool, int | None]:
    if len(data) < 10 or data[:2] != b"\xaa\x55":
        return False, None
    return True, struct.unpack_from("<I", data, 4)[0]


def recv_available(sock: socket.socket, hold: float) -> bytes:
    data = bytearray()
    deadline = time.time() + hold
    while time.time() < deadline:
        sock.settimeout(max(0.1, deadline - time.time()))
        try:
            chunk = sock.recv(8192)
        except socket.timeout:
            break
        if not chunk:
            break
        data.extend(chunk)
        if len(data) >= 10:
            deadline = min(deadline, time.time() + 0.35)
    return bytes(data)


def command_name(cmd: int) -> str:
    return READ_COMMANDS.get(cmd) or GUARDED_COMMANDS.get(cmd) or f"CMD_0x{cmd:03x}"


def send_probe(
    sock: socket.socket,
    *,
    label: str,
    machine_id: int,
    cmd: int,
    arg2: int = 0,
    arg1: int = 0,
    hold: float = 1.5,
) -> ProbeResult:
    tx = build_request(machine_id, cmd, arg2, arg1)
    sock.sendall(tx)
    rx = recv_available(sock, hold)
    valid, flags = parse_ack(rx)
    return ProbeResult(
        label=label,
        cmd=f"0x{cmd:03x} {command_name(cmd)}",
        arg2=f"0x{arg2:x}",
        arg1=f"0x{arg1:x}",
        tx=hexsp(tx),
        rx_len=len(rx),
        rx=hexsp(rx),
        ack_valid=valid,
        ack_flags=f"0x{flags:08x}" if flags is not None else None,
    )


def write_result(result: ProbeResult, trace_jsonl: Path | None) -> None:
    payload = asdict(result)
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    if trace_jsonl:
        with trace_jsonl.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def run(args: argparse.Namespace) -> None:
    if args.trace_jsonl and args.trace_jsonl.exists():
        args.trace_jsonl.unlink()

    tests: list[tuple[str, int, int, int, float]] = [
        ("ping_arg2_1", 0x0052, 1, 0, 1.0),
        ("get_time", 0x0113, 0, 0, 1.0),
        ("get_serial", 0x0119, 0, 0, 1.5),
        ("read_all_user_id_117", 0x0117, 0, 0, 3.0),
        ("get_all_user_id_118", 0x0118, 0, 0, 3.0),
    ]
    for enrollid in args.enrollid:
        tests.extend(
            [
                (f"get_name_11d_uid{enrollid}", 0x011D, enrollid, 0, 2.0),
                (f"get_name_utf8_13a_uid{enrollid}", 0x013A, enrollid, 0, 2.0),
                (f"get_enroll_uid{enrollid}_fp", 0x0101, (1 << 28) | enrollid, 1, 3.0),
                (f"photo_size_uid{enrollid}", 0x0513, enrollid, 0, 2.0),
                (f"photo_get_uid{enrollid}", 0x0514, enrollid, 0, 3.0),
            ]
        )

    with socket.create_connection((args.host, args.port), timeout=args.timeout) as sock:
        sock.settimeout(args.timeout)
        try:
            if args.with_enable_window:
                write_result(
                    send_probe(
                        sock,
                        label="enable_device_0_before_read",
                        machine_id=args.machine_id,
                        cmd=0x0110,
                        arg2=0,
                        hold=1.0,
                    ),
                    args.trace_jsonl,
                )
            for label, cmd, arg2, arg1, hold in tests:
                write_result(
                    send_probe(
                        sock,
                        label=label,
                        machine_id=args.machine_id,
                        cmd=cmd,
                        arg2=arg2,
                        arg1=arg1,
                        hold=hold,
                    ),
                    args.trace_jsonl,
                )
                time.sleep(args.delay)
        finally:
            if args.with_enable_window:
                write_result(
                    send_probe(
                        sock,
                        label="enable_device_1_restore",
                        machine_id=args.machine_id,
                        cmd=0x0110,
                        arg2=1,
                        hold=1.0,
                    ),
                    args.trace_jsonl,
                )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--machine-id", type=int, default=DEFAULT_MACHINE_ID)
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--delay", type=float, default=0.25)
    parser.add_argument("--enrollid", type=int, action="append", default=[1, 3])
    parser.add_argument("--trace-jsonl", type=Path)
    parser.add_argument(
        "--with-enable-window",
        action="store_true",
        help="Wrap reads in ENABLE_DEV 0 / ENABLE_DEV 1. Restore is sent in finally.",
    )
    args = parser.parse_args(argv)
    run(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
