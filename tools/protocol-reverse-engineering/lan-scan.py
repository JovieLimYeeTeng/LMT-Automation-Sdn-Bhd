#!/usr/bin/env python3
"""WEMAX/Hysoon FK series device probe.

Scans LAN for devices listening on TCP 5005, then tries Zd2911 TestConnection
(opcode 0x251) and Zd100 probe (opcode 0x2910) to fingerprint protocol family.
"""
import socket
import struct
import sys
import time
import concurrent.futures
import ipaddress

TIMEOUT = 1.0
PORT = 5005


def scan_port(host, port=PORT, timeout=TIMEOUT):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return host, True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return host, False
    finally:
        s.close()


def scan_subnet(network):
    print(f"[*] Scanning {network} for TCP {PORT}...", flush=True)
    hosts = list(network.hosts())
    open_hosts = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=64) as ex:
        futures = {ex.submit(scan_port, str(h)): h for h in hosts}
        done = 0
        for f in concurrent.futures.as_completed(futures):
            host, is_open = f.result()
            done += 1
            if is_open:
                print(f"  [+] {host}:{PORT} OPEN", flush=True)
                open_hosts.append(host)
            if done % 32 == 0:
                print(f"  ... {done}/{len(hosts)} probed", flush=True)
    return open_hosts


def zd2911_test_connection(host, port=PORT, timeout=2.0):
    """Send Zd2911 TestConnection (0x251) frame and capture response.
    Frame: [0xA5 0x5A] [opcode_le_2B] [len_le_2B=0] [chksum].
    """
    sof = bytes([0xA5, 0x5A])
    opcode = struct.pack("<H", 0x0251)
    length = struct.pack("<H", 0x0000)
    payload = sof + opcode + length
    chksum = (sum(payload) & 0xFF).to_bytes(1, "little")
    frame = payload + chksum

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        s.send(frame)
        resp = s.recv(256)
        return resp
    except Exception as e:
        return f"ERR: {e}".encode()
    finally:
        s.close()


def zd100_probe(host, port=PORT, timeout=2.0):
    """Old protocol: [0x55 0xAA] [machine_id] [opcode_le_2B=0x2910] [data..] [chk]
    Try opcode 0x2910 with machine_id=1.
    """
    sof = bytes([0x55, 0xAA])
    machine_id = bytes([0x01])
    opcode = struct.pack("<H", 0x2910)
    payload = sof + machine_id + opcode
    chksum = (sum(payload) & 0xFF).to_bytes(1, "little")
    frame = payload + chksum

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        s.send(frame)
        resp = s.recv(256)
        return resp
    except Exception as e:
        return f"ERR: {e}".encode()
    finally:
        s.close()


def fingerprint(host):
    print(f"\n[*] Fingerprinting {host}:{PORT}...")
    print(f"    --- Try Zd2911 TestConnection (opcode 0x251) ---")
    r1 = zd2911_test_connection(host)
    print(f"    Got {len(r1)} bytes: {r1.hex(' ')[:200]}")
    print(f"    --- Try Zd100 probe (opcode 0x2910) ---")
    r2 = zd100_probe(host)
    print(f"    Got {len(r2)} bytes: {r2.hex(' ')[:200]}")
    return r1, r2


if __name__ == "__main__":
    if len(sys.argv) >= 2:
        target = sys.argv[1]
        if "/" in target:
            net = ipaddress.ip_network(target, strict=False)
            opens = scan_subnet(net)
        else:
            opens = [target]
    else:
        # Default: current /24
        opens = scan_subnet(ipaddress.ip_network("192.168.100.0/24"))

    if not opens:
        print("\n[-] No 5005 hosts found.")
        # Also try the device factory default IP
        print("\n[*] Trying factory default 192.168.1.201:5005 just in case...")
        r1, r2 = fingerprint("192.168.1.201")
    else:
        print(f"\n[*] Found {len(opens)} host(s) with 5005 open:")
        for h in opens:
            fingerprint(h)
