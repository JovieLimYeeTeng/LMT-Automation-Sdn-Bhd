#!/usr/bin/env python3
"""Probe newly-discovered TCP 15005 on CL-PC3 with multiple protocol guesses."""
from __future__ import annotations

import socket
import struct
import sys
import time

HOST = "192.168.100.153"
PORT = 15005


def hex_sp(b: bytes) -> str:
    return b.hex(" ")


def try_send(label: str, payload: bytes, recv_timeout: float = 3.0) -> None:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(3.0)
    try:
        s.connect((HOST, PORT))
        # passive read first — does the server speak first?
        s.settimeout(0.6)
        try:
            preamble = s.recv(4096)
        except socket.timeout:
            preamble = b""
        if preamble:
            print(f"[{label}] server-first preamble ({len(preamble)} B): {hex_sp(preamble[:64])}")
            print(f"  ascii: {preamble[:64]!r}")
        # send our payload
        s.settimeout(recv_timeout)
        s.sendall(payload)
        print(f"[{label}] sent {len(payload)} B: {hex_sp(payload[:48])}")
        # collect response
        buf = bytearray()
        deadline = time.time() + recv_timeout
        while time.time() < deadline:
            s.settimeout(max(0.2, deadline - time.time()))
            try:
                chunk = s.recv(8192)
            except (socket.timeout, ConnectionResetError):
                break
            if not chunk:
                break
            buf.extend(chunk)
            if len(buf) >= 4096:
                break
        if buf:
            print(f"[{label}] resp ({len(buf)} B): {hex_sp(buf[:96])}")
            print(f"  ascii: {bytes(buf[:96])!r}")
        else:
            print(f"[{label}] no response")
    except (ConnectionRefusedError, socket.timeout) as e:
        print(f"[{label}] connect/io error: {e}")
    finally:
        try:
            s.close()
        except OSError:
            pass


def main() -> int:
    # 1. silent: just connect, see if server speaks
    try_send("silent-connect", b"")

    # 2. HTTP GET
    try_send("HTTP-GET", b"GET / HTTP/1.0\r\nHost: 192.168.100.153\r\n\r\n", 3.0)
    try_send("HTTP-GET-iclock", b"GET /iclock/cdata?SN=20241012011 HTTP/1.0\r\nHost: 192.168.100.153\r\n\r\n", 3.0)
    try_send("HTTP-GET-status", b"GET /status HTTP/1.0\r\n\r\n")

    # 3. RealSvr server-first hello (echo the proven 17-byte hello to see if 15005 is also a push channel)
    try_send("RealSvr-hello", bytes.fromhex("55 aa 00 a9 00 00 00 00 00 00 00 00 00 00 a8 01 00"))

    # 4. Protocol B PING (same as 5005)
    try_send("Proto-B-PING", bytes.fromhex("55 aa 01 00 79 19 52 00 00 00 00 00 00 00 e4 01"))
    try_send("Proto-B-PING-arg2-1", bytes.fromhex("55 aa 01 00 79 19 52 00 01 00 00 00 00 00 e5 01"))
    try_send("Proto-B-READALLUID", bytes.fromhex("55 aa 01 00 79 19 17 01 00 00 00 00 00 00 aa 01"))

    # 5. ZKTeco ZKEM TCP magic (0x5050 etc.)
    try_send("ZKEM-connect", bytes.fromhex("50 50 82 7d 13 00 00 00 e8 03 17 fc 00 00 00 00"))

    # 6. Generic newline / null poke
    try_send("just-newline", b"\r\n", 1.5)
    try_send("just-null", b"\x00", 1.5)

    # 7. JSON envelope guess
    try_send("JSON-guess", b'{"cmd":"GetAllUserID"}\n', 3.0)

    # 8. Try also UDP at 15005
    print("\n--- UDP 15005 ---")
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(2.0)
    try:
        s.sendto(b"\x55\xaa\x00\xa9" + b"\x00"*13, (HOST, 15005))
        try:
            data, _ = s.recvfrom(4096)
            print(f"udp/15005 reply ({len(data)} B): {hex_sp(data[:64])}")
        except socket.timeout:
            print("udp/15005 timeout")
    except Exception as e:
        print(f"udp/15005 error: {e}")
    finally:
        s.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
