#!/usr/bin/env python3
"""Passive CL-PC3 push-channel listener.

The CL-PC3 connects to ServerIP:ServerPort but may not speak HTTP first.
This listener does not send any greeting/probe. It accepts connections,
waits for raw bytes, and dumps exactly what the device sends.

Usage:
    python3 tools/protocol-reverse-engineering/clpc3-push-passive-listener.py

Keep the device configured with:
    ServerIP   = this PC/Mac IP
    ServerPort = 8080
    Realtime   = Yes
"""

from __future__ import annotations

import argparse
import datetime as dt
import socket
import sys
import threading
import time


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


def handle(conn: socket.socket, addr: tuple[str, int], conn_id: int, idle_timeout: float) -> None:
    print(f"\n{'=' * 72}")
    print(f"[{ts()}] CONN#{conn_id} from {addr[0]}:{addr[1]}")
    print(f"{'=' * 72}", flush=True)

    conn.settimeout(0.5)
    total = 0
    packets = 0
    last_rx = time.monotonic()

    try:
        while True:
            if time.monotonic() - last_rx > idle_timeout:
                print(f"[{ts()}] CONN#{conn_id} idle timeout; total={total}B packets={packets}")
                return
            try:
                data = conn.recv(8192)
            except socket.timeout:
                continue
            except OSError as exc:
                print(f"[{ts()}] CONN#{conn_id} recv error: {exc}")
                return
            if not data:
                print(f"[{ts()}] CONN#{conn_id} peer closed; total={total}B packets={packets}")
                return

            last_rx = time.monotonic()
            total += len(data)
            packets += 1
            print(f"\n[{ts()}] CONN#{conn_id} PKT#{packets} {len(data)}B")
            print(hexdump(data))
            sys.stdout.flush()
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--idle-timeout", type=float, default=20.0)
    parser.add_argument("--max-connections", type=int, default=0, help="0 means forever")
    args = parser.parse_args()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((args.host, args.port))
    srv.listen(16)

    print(f"[{ts()}] passive CL-PC3 listener on {args.host}:{args.port}")
    print(f"[{ts()}] no bytes will be sent to the device unless it speaks first", flush=True)

    conn_id = 0
    try:
        while args.max_connections <= 0 or conn_id < args.max_connections:
            conn, addr = srv.accept()
            conn_id += 1
            thread = threading.Thread(
                target=handle,
                args=(conn, addr, conn_id, args.idle_timeout),
                daemon=True,
            )
            thread.start()
    except KeyboardInterrupt:
        print(f"\n[{ts()}] stopped")
    finally:
        srv.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
