# Protocol Reverse-Engineering Tools

Scripts used to reverse the WEMAX WE-68 PLUS / TIMY TFS30 / TH900_click V5.0 device on 2026-04-30.

> Full protocol spec: see [`docs/protocol-th900.md`](../../docs/protocol-th900.md)
> Investigation report: see [`docs/research/02-dll-reverse-engineering.md`](../../docs/research/02-dll-reverse-engineering.md)

## Files

| File | Purpose |
|------|---------|
| `ws-server.py` | WebSocket server on port 7788, path `/pub/chat`. Accepts device's `cmd: "reg"` heartbeat, replies with `ret:reg result:true`, logs every JSON frame. **This is the seed of our TMS device adapter.** |
| `lan-scan.py` | Scans `/24` subnet for hosts with TCP 5005 open. Used during initial protocol discovery. ⚠️ Concurrent (64 workers) — can stress home routers. Prefer `tcp-probe.py` for spot checks. |
| `tcp-probe.py` | Single-host or small-list TCP 5005 probe. Sequential, gentle. |
| `parse-attlog-dat.py` | Decoder for legacy `ZoucqGENLOGData` `.DAT` U-disk export. 100% verified against the 3099-record `AGL_001.DAT` sample in `requirements/hardware/data-samples/`. |
| `captured/2026-04-30-handshake-trace.log` | Real raw WebSocket frame trace from the handshake session: device `reg`, `sendlog` push, replies to `getuserinfo` (含 Ben's fingerprint template), `getuserlist`, `opendoor` etc. **Source of truth for protocol field shapes.** |

## Quick replay

```bash
# Listen on 7788 — device must be configured to push to your IP:7788
python3 ws-server.py
# (in another shell, after device connects)
tail -f /tmp/wemax_ws.log
```

The device probes every Heartbeat seconds (default 3, factory; was 5 on the test unit).
First frame is always `cmd:"reg"`. Reply with the right shape and the device opens its data flow.

See `docs/protocol-th900.md` §3-4 for full request/response examples.

## Notes on safety

- These scripts only **listen** or **send well-formed read commands**. None send destructive commands like `cleanlog`, `cleanuser`, `reboot`.
- If you extend `ws-server.py` to test write commands (set/delete user, set time), do it on the test unit first, never on a customer-deployed device.
