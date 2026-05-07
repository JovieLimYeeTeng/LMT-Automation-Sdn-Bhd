#!/usr/bin/env python3
"""WebSocket server for WEMAX TH900_click device on port 7788, path /pub/chat.

Logs every connection, every frame (text/binary), every error.
Does NOT actively send anything to the device — read-only reverse engineering mode.
After we see what device sends, we'll add reply logic.
"""
import asyncio
import datetime
import json
import sys

import websockets
from websockets.server import serve
from websockets.asyncio.server import serve as serve_async

PORT = 7788


def ts():
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def hexdump(data: bytes, width: int = 16) -> str:
    if not data:
        return "  (empty)"
    lines = []
    for i in range(0, len(data), width):
        chunk = data[i:i + width]
        hexs = " ".join(f"{b:02x}" for b in chunk).ljust(width * 3)
        ascii_ = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        lines.append(f"  {i:04x}  {hexs}  |{ascii_}|")
    return "\n".join(lines)


def try_parse_json(text: str):
    try:
        return json.loads(text)
    except Exception:
        return None


async def reply(ws, obj):
    msg = json.dumps(obj, ensure_ascii=False)
    await ws.send(msg)
    print(f"  → REPLY: {msg}")
    sys.stdout.flush()


async def handler(websocket):
    peer = websocket.remote_address
    path = websocket.request.path if hasattr(websocket, "request") else "?"
    print(f"\n{'='*70}")
    print(f"[{ts()}] CONNECT  peer={peer}  path={path}")
    print(f"{'='*70}", flush=True)

    pkt_idx = 0
    try:
        async for msg in websocket:
            pkt_idx += 1
            if isinstance(msg, str):
                print(f"\n[{ts()}] FRAME#{pkt_idx} TEXT ({len(msg)} chars)")
                print(f"  RAW: {msg[:500]}{'...' if len(msg)>500 else ''}")
                j = try_parse_json(msg)
                if j is not None:
                    print(f"  JSON parsed:")
                    print("  " + json.dumps(j, indent=2, ensure_ascii=False).replace("\n", "\n  "))
                    cmd = j.get("cmd")
                    sn = j.get("sn", "")
                    # Try to ack — common IoT patterns
                    if cmd == "reg":
                        # server-time + ret ok pattern, but ENABLE pushes this time
                        utc_now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                        await reply(websocket, {
                            "ret": "reg",
                            "result": True,
                            "cloudtime": utc_now,
                            "nosenduser": False,
                            "nosendlog": False,
                        })
                        # Probes removed 2026-05-01 — reconnect interval was
                        # collapsing (3h → 37min → 17min) and we already have
                        # the protocol fully captured. Re-enable temporarily
                        # only when actively reverse-engineering.
                    elif cmd == "sendlog":
                        # Must echo logindex so device clears its push queue.
                        # Without it the device retries the same record at ~4 Hz.
                        await reply(websocket, {
                            "ret": "sendlog",
                            "result": True,
                            "count": j.get("count", 0),
                            "logindex": j.get("logindex", 0),
                            "cloudtime": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                        })
                    elif cmd == "senduser":
                        await reply(websocket, {
                            "ret": "senduser",
                            "result": True,
                            "count": j.get("count", 0),
                            "cloudtime": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                        })
                    elif cmd:
                        await reply(websocket, {"ret": cmd, "result": True})
            else:
                print(f"\n[{ts()}] FRAME#{pkt_idx} BINARY ({len(msg)} bytes)")
                print(hexdump(msg))
            sys.stdout.flush()
    except websockets.exceptions.ConnectionClosed as e:
        print(f"\n[{ts()}] CLOSED code={e.code} reason={e.reason!r}")
    except Exception as e:
        print(f"\n[{ts()}] ERROR {type(e).__name__}: {e}")


async def main():
    print(f"[{ts()}] WS listener on 0.0.0.0:{PORT}", flush=True)
    async with serve_async(handler, "0.0.0.0", PORT, ping_interval=None, max_size=None) as srv:
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
