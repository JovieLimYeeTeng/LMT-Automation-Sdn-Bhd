#!/usr/bin/env python3
"""TCP tee relay for CL-PC3 push experiments.

Listens locally, connects to an upstream server, forwards bytes both ways,
and prints a timestamped hexdump for each direction.
"""

from __future__ import annotations

import argparse
import datetime as dt
import socket
import sys
import threading


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


def forward(src: socket.socket, dst: socket.socket, label: str) -> None:
    try:
        while True:
            data = src.recv(8192)
            if not data:
                print(f"[{ts()}] {label} closed", flush=True)
                return
            print(f"\n[{ts()}] {label} {len(data)}B")
            print(hexdump(data), flush=True)
            dst.sendall(data)
    except OSError as exc:
        print(f"[{ts()}] {label} error: {exc}", flush=True)
    finally:
        for sock in (src, dst):
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass


def handle(client: socket.socket, addr: tuple[str, int], upstream: tuple[str, int], conn_id: int) -> None:
    print(f"\n{'=' * 72}")
    print(f"[{ts()}] RELAY#{conn_id} client {addr[0]}:{addr[1]} -> upstream {upstream[0]}:{upstream[1]}")
    print(f"{'=' * 72}", flush=True)
    try:
        server = socket.create_connection(upstream, timeout=5)
    except OSError as exc:
        print(f"[{ts()}] upstream connect failed: {exc}", flush=True)
        client.close()
        return

    threads = [
        threading.Thread(target=forward, args=(client, server, f"device->server #{conn_id}"), daemon=True),
        threading.Thread(target=forward, args=(server, client, f"server->device #{conn_id}"), daemon=True),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    print(f"[{ts()}] RELAY#{conn_id} done", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen-host", default="0.0.0.0")
    parser.add_argument("--listen-port", type=int, default=8080)
    parser.add_argument("--upstream-host", required=True)
    parser.add_argument("--upstream-port", type=int, required=True)
    parser.add_argument("--max-connections", type=int, default=0, help="0 means forever")
    args = parser.parse_args()

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((args.listen_host, args.listen_port))
    listener.listen(16)

    upstream = (args.upstream_host, args.upstream_port)
    print(f"[{ts()}] tee relay on {args.listen_host}:{args.listen_port} -> {upstream[0]}:{upstream[1]}", flush=True)

    conn_id = 0
    try:
        while args.max_connections <= 0 or conn_id < args.max_connections:
            client, addr = listener.accept()
            conn_id += 1
            thread = threading.Thread(target=handle, args=(client, addr, upstream, conn_id), daemon=False)
            thread.start()
    except KeyboardInterrupt:
        print(f"\n[{ts()}] stopped")
    finally:
        listener.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
