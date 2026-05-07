#!/usr/bin/env python3
"""Minimal CL-PC3 RealSvr push reader.

This implements the server-side handshake observed from LMT's
RealSvrOcxTcp ActiveX control:

1. Device connects to ServerIP:ServerPort.
2. Server sends a 17-byte hello frame.
3. Device replies with a 68-byte attendance record frame.
4. Server sends a 16-byte ACK frame.

The timestamp layout below is inferred from real records decoded by the
vendor ActiveX on 2026-05-03. Keep collecting samples before treating the
date bit layout as final for all years/hours.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import socket
import struct
import sys
import threading
from dataclasses import asdict, dataclass


SERVER_HELLO = bytes.fromhex("55 aa 00 a9 00 00 00 00 00 00 00 00 00 00 a8 01 00")
SERVER_ACK = bytes.fromhex("55 aa 01 40 00 00 00 00 00 00 00 00 00 00 40 01")


@dataclass
class PunchRecord:
    device_id: int
    enroll_id: int
    verify_mode: int
    inout_mode: int
    log_time: str
    serial: str
    raw_hex: str


def ts() -> str:
    return dt.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def hexdump(data: bytes, width: int = 16) -> str:
    lines: list[str] = []
    for i in range(0, len(data), width):
        chunk = data[i : i + width]
        hex_part = " ".join(f"{b:02x}" for b in chunk).ljust(width * 3)
        ascii_part = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        lines.append(f"  {i:04x}  {hex_part}  |{ascii_part}|")
    return "\n".join(lines)


def recv_exact(conn: socket.socket, n: int, timeout: float) -> bytes:
    conn.settimeout(timeout)
    data = bytearray()
    while len(data) < n:
        chunk = conn.recv(n - len(data))
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


def parse_punch(frame: bytes) -> PunchRecord:
    if len(frame) < 68:
        raise ValueError(f"record too short: {len(frame)}B")
    if frame[0:2] != b"\x33\x99":
        raise ValueError(f"unexpected record magic: {frame[0:2].hex(' ')}")

    payload_len = struct.unpack_from("<I", frame, 8)[0]
    if payload_len != 52:
        raise ValueError(f"unexpected payload_len={payload_len}, expected 52")

    device_id = struct.unpack_from("<I", frame, 12)[0]
    inout_mode = frame[16]
    verify_mode = frame[17] & 0x3F
    second = frame[19]
    enroll_id = struct.unpack_from("<I", frame, 20)[0]

    # Inferred from the four records parsed by RealSvrOcxTcp:
    #   b24: 0xD0 + (year - 2000)
    #   b25 high nibble: month
    #   b26 low 5 bits: day
    #   b26 high 3 bits + b27 bit 1 (shifted to bit 3): hour 4-bit
    #   b27 >> 2: minute
    # 旧版 (b26 >> 5) + 8 是错的（假设白天 +8 offset），实际是位拼装
    year = 2000 + frame[24] - 0xD0
    month = frame[25] >> 4
    day = frame[26] & 0x1F
    hour = (frame[26] >> 5) | (((frame[27] >> 1) & 0x01) << 3)
    minute = frame[27] >> 2
    log_time = dt.datetime(year, month, day, hour, minute, second)

    serial = frame[36:52].split(b"\x00", 1)[0].decode("ascii", errors="replace")

    return PunchRecord(
        device_id=device_id,
        enroll_id=enroll_id,
        verify_mode=verify_mode,
        inout_mode=inout_mode,
        log_time=log_time.isoformat(sep=" "),
        serial=serial,
        raw_hex=frame.hex(),
    )


def handle(conn: socket.socket, addr: tuple[str, int], conn_id: int, args: argparse.Namespace) -> None:
    print(f"\n{'=' * 72}")
    print(f"[{ts()}] CONN#{conn_id} from {addr[0]}:{addr[1]}")
    print(f"{'=' * 72}", flush=True)

    try:
        conn.sendall(SERVER_HELLO)
        header = recv_exact(conn, 12, args.timeout)
        if not header:
            print(f"[{ts()}] no response")
            return
        if len(header) < 12:
            print(f"[{ts()}] short header {len(header)}B")
            print(hexdump(header))
            return

        payload_len = struct.unpack_from("<I", header, 8)[0]
        expected_len = 16 + payload_len
        rest = recv_exact(conn, expected_len - len(header), args.timeout)
        frame = header + rest

        print(f"[{ts()}] device frame {len(frame)}B")
        print(hexdump(frame))

        record = parse_punch(frame)
        print(f"[{ts()}] PUNCH {json.dumps(asdict(record), ensure_ascii=False)}")
        if args.jsonl:
            with open(args.jsonl, "a", encoding="utf-8") as f:
                f.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")

        conn.sendall(SERVER_ACK)
        print(f"[{ts()}] ACK sent", flush=True)
    except Exception as exc:
        print(f"[{ts()}] error: {exc}", flush=True)
    finally:
        try:
            conn.close()
        except OSError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument("--max-connections", type=int, default=0, help="0 means forever")
    parser.add_argument("--listen-seconds", type=float, default=0, help="0 means no wall-clock limit")
    parser.add_argument("--jsonl", help="Optional path to append parsed punch records")
    args = parser.parse_args()

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((args.host, args.port))
    listener.listen(16)
    listener.settimeout(0.5)
    print(f"[{ts()}] CL-PC3 RealSvr push reader on {args.host}:{args.port}", flush=True)

    conn_id = 0
    deadline = dt.datetime.now() + dt.timedelta(seconds=args.listen_seconds) if args.listen_seconds else None
    try:
        while args.max_connections <= 0 or conn_id < args.max_connections:
            if deadline and dt.datetime.now() >= deadline:
                break
            try:
                conn, addr = listener.accept()
            except socket.timeout:
                continue
            conn_id += 1
            thread = threading.Thread(target=handle, args=(conn, addr, conn_id, args), daemon=False)
            thread.start()
    except KeyboardInterrupt:
        print(f"\n[{ts()}] stopped")
    finally:
        listener.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
