#!/usr/bin/env python3
"""HTTP listener for CL-PC3 push channel.

Mirror of fk6.clicktmsmy.com:80 — let CL-PC3 push its real data to us.
Logs every request method/path/headers/body, decodes JSON if possible,
extracts base64 photos and decodes them if present.

Usage:
    python3 clpc3-http-listener.py

Then on CL-PC3: MENU → Comm/Network →
    ServerIP   = <this Mac IP, e.g. 172.20.10.3>
    ServerPort = 8080
    Save (ESC → SAVE).

Within seconds the device should POST register/heartbeat/log frames.
"""
import base64
import datetime
import json
import socketserver
import sys
from http.server import BaseHTTPRequestHandler

PORT = 8080  # not 80 (macOS reserves <1024 for root)


def ts() -> str:
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def hexdump(data: bytes, width: int = 16, max_lines: int = 16) -> str:
    lines = []
    for i in range(0, min(len(data), width * max_lines), width):
        chunk = data[i:i + width]
        h = " ".join(f"{b:02x}" for b in chunk).ljust(width * 3)
        a = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        lines.append(f"  {i:04x}  {h}  |{a}|")
    if len(data) > width * max_lines:
        lines.append(f"  ... ({len(data) - width * max_lines} more bytes)")
    return "\n".join(lines)


class CLPC3Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # silence default access log; we print our own
        pass

    def _dump(self, method: str):
        body = b""
        cl = int(self.headers.get("Content-Length", "0") or 0)
        if cl > 0:
            body = self.rfile.read(cl)

        print(f"\n{'=' * 70}")
        print(f"[{ts()}] {method} {self.path}  from {self.client_address[0]}")
        print(f"{'=' * 70}")
        print("Headers:")
        for k, v in self.headers.items():
            print(f"  {k}: {v}")

        if body:
            print(f"\nBody ({len(body)} B):")
            # try JSON first
            try:
                j = json.loads(body)
                print("  JSON:")
                pretty = json.dumps(j, indent=2, ensure_ascii=False)
                for line in pretty.split("\n")[:80]:
                    print(f"    {line}")
                # auto-decode any base64 photo fields
                self._extract_photos(j)
            except Exception:
                # try form-urlencoded
                try:
                    text = body.decode("utf-8")
                    if "&" in text and "=" in text and not text.startswith(("{", "[")):
                        print("  Form/URL-encoded:")
                        for kv in text.split("&"):
                            print(f"    {kv[:200]}")
                    else:
                        print("  Text:")
                        print(f"    {text[:500]}")
                except Exception:
                    print("  Binary:")
                    print(hexdump(body))

        # Send a generic OK back
        # Some firmware expects HTTP 200 with empty body, others want JSON ack.
        # Reply body can be tuned once we see request format.
        resp_body = b'{"ret":"ok","result":true,"cloudtime":"' + \
            datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S").encode() + b'"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp_body)))
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.wfile.write(resp_body)
        sys.stdout.flush()

    def _extract_photos(self, obj, path: str = "$"):
        """Walk JSON, find any value > 1000 chars that looks like base64 → save as .jpg."""
        if isinstance(obj, dict):
            for k, v in obj.items():
                self._extract_photos(v, f"{path}.{k}")
        elif isinstance(obj, list):
            for i, x in enumerate(obj):
                self._extract_photos(x, f"{path}[{i}]")
        elif isinstance(obj, str) and len(obj) > 1000:
            try:
                data = base64.b64decode(obj, validate=False)
                if data[:3] in (b"\xff\xd8\xff", b"\x89PN", b"GIF"):
                    fn = f"/tmp/clpc3-push-{ts().replace(':', '').replace('.', '')}.jpg"
                    with open(fn, "wb") as f:
                        f.write(data)
                    print(f"  ★ Saved likely-photo from {path} → {fn} ({len(data)}B)")
            except Exception:
                pass

    def do_GET(self):    self._dump("GET")
    def do_POST(self):   self._dump("POST")
    def do_PUT(self):    self._dump("PUT")
    def do_DELETE(self): self._dump("DELETE")
    def do_HEAD(self):   self._dump("HEAD")


class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    addr = ("0.0.0.0", PORT)
    print(f"[{ts()}] CL-PC3 HTTP listener on {addr[0]}:{addr[1]}")
    print(f"[{ts()}] Configure CL-PC3: ServerIP=<your Mac IP>, ServerPort={PORT}")
    print(f"[{ts()}] Waiting for device push...\n")
    try:
        with ThreadingHTTPServer(addr, CLPC3Handler) as srv:
            srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] stopped.")
