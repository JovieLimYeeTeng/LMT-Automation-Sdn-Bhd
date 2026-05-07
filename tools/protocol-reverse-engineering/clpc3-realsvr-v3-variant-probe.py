#!/usr/bin/env python3
"""Probe CL-PC3 RealSvr response variants on the 8080 push channel.

The proven flow is:
  server hello -> device 33 99 attendance frame -> 16-byte ACK.

This script keeps the same server hello and cycles safe response variants after
the first device frame, including raw RTLOG003 buffers produced by the static
reverse of RealSvrOcxTcp.ocx SendRtLogResponseV3.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import socket
import struct
import sys
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path


SERVER_HELLO = bytes.fromhex("55 aa 00 a9 00 00 00 00 00 00 00 00 00 00 a8 01 00")
SERVER_ACK = bytes.fromhex("55 aa 01 40 00 00 00 00 00 00 00 00 00 00 40 01")


@dataclass
class VariantTrace:
    ts: str
    conn_id: int
    addr: str
    mode: str
    event: str
    data_hex: str
    length: int


def stamp() -> str:
    return dt.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def hexsp(data: bytes) -> str:
    return data.hex(" ")


def rtlog_packet(kind: str, body: bytes) -> bytes:
    if kind not in {"RTLOG001", "RTLOG002", "RTLOG003"}:
        raise ValueError(kind)
    if b"\x00" in body:
        raise ValueError("body must not contain NUL")
    if kind == "RTLOG001":
        return kind.encode("ascii") + struct.pack("<I", len(body) + 1) + body + b"\x00"
    return kind.encode("ascii") + struct.pack("<II", len(body) + 5, len(body) + 1) + body + b"\x00"


def response_sequence(mode: str) -> list[tuple[str, bytes]]:
    v3_ok = rtlog_packet("RTLOG003", b"OK")
    v3_name = rtlog_packet("RTLOG003", b"RTLOG003")
    v1_ok = rtlog_packet("RTLOG001", b"OK")
    v2_ok = rtlog_packet("RTLOG002", b"OK")
    table = {
        "ack": [("ack", SERVER_ACK)],
        "v3-ok": [("v3-ok", v3_ok)],
        "ack-v3-ok": [("ack", SERVER_ACK), ("v3-ok", v3_ok)],
        "v3-ok-ack": [("v3-ok", v3_ok), ("ack", SERVER_ACK)],
        "v3-rtlog003": [("v3-rtlog003", v3_name)],
        "v1-ok": [("v1-ok", v1_ok)],
        "v2-ok": [("v2-ok", v2_ok)],
    }
    if mode not in table:
        raise ValueError(f"unknown mode {mode}")
    return table[mode]


def recv_some(conn: socket.socket, timeout: float, max_bytes: int = 256 * 1024) -> bytes:
    conn.settimeout(timeout)
    data = bytearray()
    deadline = time.time() + timeout
    while time.time() < deadline and len(data) < max_bytes:
        conn.settimeout(max(0.1, deadline - time.time()))
        try:
            chunk = conn.recv(8192)
        except socket.timeout:
            break
        if not chunk:
            break
        data.extend(chunk)
        deadline = min(deadline, time.time() + 0.5)
    return bytes(data)


def trace(args: argparse.Namespace, entry: VariantTrace) -> None:
    payload = asdict(entry)
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    if args.trace_jsonl:
        with args.trace_jsonl.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def handle(
    conn: socket.socket,
    addr: tuple[str, int],
    conn_id: int,
    mode: str,
    args: argparse.Namespace,
) -> None:
    addr_s = f"{addr[0]}:{addr[1]}"
    try:
        conn.sendall(SERVER_HELLO)
        trace(args, VariantTrace(stamp(), conn_id, addr_s, mode, "tx-hello", hexsp(SERVER_HELLO), len(SERVER_HELLO)))

        frame = recv_some(conn, args.first_timeout)
        trace(args, VariantTrace(stamp(), conn_id, addr_s, mode, "rx-first", hexsp(frame), len(frame)))

        for label, payload in response_sequence(mode):
            conn.sendall(payload)
            trace(args, VariantTrace(stamp(), conn_id, addr_s, mode, f"tx-{label}", hexsp(payload), len(payload)))
            time.sleep(args.response_gap)

        extra = recv_some(conn, args.after_timeout)
        trace(args, VariantTrace(stamp(), conn_id, addr_s, mode, "rx-after-response", hexsp(extra), len(extra)))
    except Exception as exc:  # noqa: BLE001 - diagnostic probe.
        trace(args, VariantTrace(stamp(), conn_id, addr_s, mode, f"error:{exc}", "", 0))
    finally:
        try:
            conn.close()
        except OSError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--modes", default="ack,v3-ok,ack-v3-ok,v3-ok-ack,v3-rtlog003")
    parser.add_argument("--max-connections", type=int, default=5)
    parser.add_argument("--listen-seconds", type=float, default=180)
    parser.add_argument("--first-timeout", type=float, default=5)
    parser.add_argument("--after-timeout", type=float, default=6)
    parser.add_argument("--response-gap", type=float, default=0.15)
    parser.add_argument("--trace-jsonl", type=Path)
    args = parser.parse_args()

    if args.trace_jsonl and args.trace_jsonl.exists():
        args.trace_jsonl.unlink()

    modes = [m.strip() for m in args.modes.split(",") if m.strip()]
    for mode in modes:
        response_sequence(mode)

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((args.host, args.port))
    listener.listen(16)
    listener.settimeout(0.5)
    print(f"[{stamp()}] RealSvr V3 variant probe on {args.host}:{args.port}, modes={modes}", flush=True)

    conn_id = 0
    threads: list[threading.Thread] = []
    deadline = time.time() + args.listen_seconds
    try:
        while conn_id < args.max_connections and time.time() < deadline:
            try:
                conn, addr = listener.accept()
            except socket.timeout:
                continue
            mode = modes[conn_id % len(modes)]
            conn_id += 1
            thread = threading.Thread(target=handle, args=(conn, addr, conn_id, mode, args))
            thread.start()
            threads.append(thread)
    except KeyboardInterrupt:
        pass
    finally:
        listener.close()
        for thread in threads:
            thread.join(timeout=10)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
