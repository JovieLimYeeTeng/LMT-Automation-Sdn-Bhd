#!/usr/bin/env python3
"""Single-host TCP 5005 probe — gentle, no concurrency."""
import socket, struct, sys, time

def try_connect(host, port=5005, timeout=1.5):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        t0 = time.time()
        s.connect((host, port))
        return True, time.time() - t0
    except Exception as e:
        return False, str(e)
    finally:
        s.close()

def fingerprint(host, port=5005, timeout=2.5):
    """Send Zd2911 TestConnection (opcode 0x251). Frame: 5A A5 + LE16 op + LE16 len=0 + chk."""
    payload = bytes([0xA5, 0x5A]) + struct.pack("<H", 0x0251) + struct.pack("<H", 0)
    chk = (sum(payload) & 0xFF).to_bytes(1, "little")
    frame = payload + chk
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        s.send(frame)
        resp = s.recv(512)
        return f"OK {len(resp)}B: {resp.hex(' ')[:300]}"
    except Exception as e:
        return f"ERR: {e}"
    finally:
        s.close()

if __name__ == "__main__":
    targets = sys.argv[1:] or ["192.168.100.209", "192.168.100.214", "192.168.100.215"]
    for ip in targets:
        ok, info = try_connect(ip)
        if ok:
            print(f"[+] {ip}:5005 OPEN ({info:.2f}s) → fingerprinting...")
            print(f"    {fingerprint(ip)}")
        else:
            print(f"[-] {ip}:5005 closed/no-route ({info})")
        time.sleep(0.3)
