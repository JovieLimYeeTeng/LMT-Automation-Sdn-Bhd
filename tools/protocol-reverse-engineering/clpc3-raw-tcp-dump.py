#!/usr/bin/env python3
"""Raw TCP listener on :8080 — dump WHATEVER bytes CL-PC3 sends.

The HTTP handler may have been blocking waiting for a request-line.
This raw version logs every byte the device sends, regardless of protocol.
"""
import datetime
import socket
import sys
import threading

PORT = 8080


def ts():
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def hexdump(data: bytes, width: int = 16) -> str:
    lines = []
    for i in range(0, len(data), width):
        chunk = data[i:i + width]
        h = " ".join(f"{b:02x}" for b in chunk).ljust(width * 3)
        a = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        lines.append(f"  {i:04x}  {h}  |{a}|")
    return "\n".join(lines)


PROBES = [
    # ZKTeco PUSH long-poll variants — server queries device on the persistent connection
    b"GET /iclock/cdata?SN=20241012011&options=all&pushver=2.4.1&language=69 HTTP/1.1\r\nHost: 192.168.100.204:8080\r\nConnection: keep-alive\r\n\r\n",
    b"GET /iclock/getrequest?SN=20241012011 HTTP/1.1\r\nHost: 192.168.100.204:8080\r\nConnection: keep-alive\r\n\r\n",
    b"GET /iclock/ping HTTP/1.1\r\nHost: 192.168.100.204:8080\r\n\r\n",
    b"GET / HTTP/1.0\r\n\r\n",
    # Bare command tries
    b"HELLO\r\n",
    b"\xAA\x55\x01\x00\x10\x00\x00\x00\x00\x00",  # Click protocol B ack-shape
]


def handle(conn, addr, conn_id):
    print(f"\n{'=' * 70}")
    print(f"[{ts()}] CONN#{conn_id} from {addr}")
    print(f"{'=' * 70}", flush=True)
    conn.settimeout(2.0)
    total_rx = 0
    pkt = 0
    try:
        # Strategy: try one probe per connection (cycling through)
        probe_idx = (conn_id - 1) % len(PROBES)
        probe = PROBES[probe_idx]
        print(f"  [{ts()}] sending probe #{probe_idx}: {probe[:80]!r}{'...' if len(probe)>80 else ''}")
        try:
            conn.sendall(probe)
        except Exception as e:
            print(f"  send err: {e}"); return
        # Now read whatever device responds
        deadline = datetime.datetime.now().timestamp() + 12.0
        while datetime.datetime.now().timestamp() < deadline:
            try:
                data = conn.recv(8192)
            except socket.timeout:
                continue
            except OSError as e:
                print(f"  recv err: {e}"); break
            if not data:
                print(f"  (peer closed; total_rx={total_rx} bytes in {pkt} pkts)")
                break
            pkt += 1
            total_rx += len(data)
            print(f"\n[{ts()}] CONN#{conn_id} PKT#{pkt} ({len(data)}B):")
            print(hexdump(data))
            sys.stdout.flush()
        else:
            print(f"  (deadline reached; total_rx={total_rx} bytes)")
    finally:
        conn.close()
        print(f"\n[{ts()}] CONN#{conn_id} closed (total {total_rx}B)")


def main():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", PORT))
    s.listen(8)
    print(f"[{ts()}] Raw TCP listener on 0.0.0.0:{PORT}", flush=True)

    conn_id = 0
    while True:
        try:
            conn, addr = s.accept()
            conn_id += 1
            t = threading.Thread(target=handle, args=(conn, addr, conn_id), daemon=True)
            t.start()
        except KeyboardInterrupt:
            break


if __name__ == "__main__":
    main()
