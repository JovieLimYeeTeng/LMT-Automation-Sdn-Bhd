#!/usr/bin/env python3
"""Fast TCP scanner + selected UDP probe for CL-PC3.

Output JSON-lines so we can grep open ports.
"""
from __future__ import annotations

import argparse
import json
import socket
import struct
import time
from concurrent.futures import ThreadPoolExecutor, as_completed


def tcp_check(host: str, port: int, timeout: float) -> tuple[int, str, bytes]:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        s.settimeout(0.6)
        try:
            data = s.recv(256)
        except (socket.timeout, ConnectionResetError):
            data = b""
        return port, "open", data
    except (socket.timeout, ConnectionRefusedError, OSError):
        return port, "closed", b""
    finally:
        try:
            s.close()
        except OSError:
            pass


def udp_check(host: str, port: int, payload: bytes, timeout: float) -> tuple[int, str, bytes]:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        s.sendto(payload, (host, port))
        try:
            data, _ = s.recvfrom(4096)
            return port, "open", data
        except socket.timeout:
            return port, "open|filtered", b""
        except ConnectionRefusedError:
            return port, "closed", b""
    finally:
        s.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="192.168.100.153")
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--end", type=int, default=65535)
    ap.add_argument("--workers", type=int, default=600)
    ap.add_argument("--timeout", type=float, default=0.8)
    ap.add_argument("--udp-ports", default="53,67,69,123,137,138,161,500,1900,4500,5353,4370,5005,5006,8080,9999")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    open_tcp: list[tuple[int, bytes]] = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(tcp_check, args.host, p, args.timeout) for p in range(args.start, args.end + 1)]
        for f in as_completed(futs):
            port, state, banner = f.result()
            if state == "open":
                open_tcp.append((port, banner))
                print(f"[+] tcp/{port} OPEN  banner={banner[:48]!r}", flush=True)
    print(f"[i] TCP scan {args.start}-{args.end} done in {time.time()-t0:.1f}s, open={len(open_tcp)}")

    # UDP probes — payloads tuned for likely services
    udp_payloads = {
        53: b"\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x07example\x03com\x00\x00\x01\x00\x01",
        69: b"\x00\x01" + b"test\x00octet\x00",
        123: b"\x1b" + b"\x00" * 47,
        137: b"\x12\x34\x00\x10\x00\x01\x00\x00\x00\x00\x00\x00 CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\x00\x00!\x00\x01",
        161: b"\x30\x26\x02\x01\x00\x04\x06public\xa0\x19\x02\x04\x71\x52\x09\x49\x02\x01\x00\x02\x01\x00\x30\x0b\x30\x09\x06\x05\x2b\x06\x01\x02\x01\x05\x00",
        1900: b"M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n",
        5353: b"\x00\x00\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x09_services\x07_dns-sd\x04_udp\x05local\x00\x00\x0c\x00\x01",
        4370: b"\x50\x50\x82\x7d\x13\x00\x00\x00\xe8\x03\x17\xfc\x00\x00\x00\x00",  # ZKTeco connect
        5005: b"\x55\xaa\x00\xa9\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xa8\x01\x00",
    }
    open_udp: list[tuple[int, bytes]] = []
    for p in [int(x) for x in args.udp_ports.split(",")]:
        payload = udp_payloads.get(p, b"\x00")
        port, state, data = udp_check(args.host, p, payload, args.timeout)
        if state.startswith("open"):
            open_udp.append((port, data))
            print(f"[+] udp/{port} {state} reply={data[:48]!r}", flush=True)

    # save report
    report = {
        "host": args.host,
        "scanned_tcp": [args.start, args.end],
        "open_tcp": [{"port": p, "banner_hex": b.hex(), "banner_ascii": b.decode("latin-1", "replace")} for p, b in sorted(open_tcp)],
        "open_udp": [{"port": p, "data_hex": d.hex(), "data_ascii": d.decode("latin-1", "replace")} for p, d in sorted(open_udp)],
        "elapsed_sec": time.time() - t0,
    }
    with open(args.out, "w") as f:
        json.dump(report, f, indent=2)
    print(f"[i] saved {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
