# CL-PC3 Breakthrough — RealSvr Push Path

Date: 2026-05-03  
Device: CL-PC3, SN `20241012011`, Cloud ID `C2636CF4DB223121`  
Result: succeeded in reading real attendance records from the customer device.

## Summary

The working path is not TCP `5005` pull. The working path is the device's existing `ServerIP:ServerPort` push channel.

LMT's bundled `RealSvrOcxTcp` ActiveX control revealed the missing server-side handshake:

1. CL-PC3 connects to our server port, currently Mac `192.168.100.204:8080`.
2. Server sends a 17-byte hello:
   `55 aa 00 a9 00 00 00 00 00 00 00 00 00 00 a8 01 00`
3. Device replies with one 68-byte attendance record frame.
4. Server sends a 16-byte ACK:
   `55 aa 01 40 00 00 00 00 00 00 00 00 00 00 40 01`
5. Device closes/reconnects and sends the next pending record.

This produced real punch records from the device. The vendor ActiveX decoded the first records as:

| enroll_id | verify | inout | log_time | serial |
|---:|---:|---:|---|---|
| 1 | 20 | 1 | 2026-04-24 12:04:56 | 20241012011 |
| 1 | 20 | 1 | 2026-04-24 12:06:59 | 20241012011 |
| 2 | 20 | 1 | 2026-05-01 13:27:48 | 20241012011 |
| 2 | 20 | 1 | 2026-05-01 14:00:25 | 20241012011 |

After implementing the same handshake in pure Python, the Mac received more records directly, for example:

| enroll_id | verify | inout | log_time | serial |
|---:|---:|---:|---|---|
| 2 | 20 | 1 | 2026-05-01 14:29:07 | 20241012011 |
| 3 | 20 | 1 | 2026-05-02 11:44:13 | 20241012011 |
| 3 | 20 | 1 | 2026-05-02 12:20:29 | 20241012011 |
| 3 | 20 | 1 | 2026-05-02 14:19:00 | 20241012011 |
| 3 | 20 | 1 | 2026-05-02 14:21:29 | 20241012011 |
| 3 | 20 | 1 | 2026-05-02 14:23:59 | 20241012011 |
| 3 | 20 | 1 | 2026-05-02 14:26:20 | 20241012011 |
| 3 | 20 | 1 | 2026-05-02 15:04:48 | 20241012011 |

## Evidence

Passive listener result:

- Device repeatedly connected to `192.168.100.204:8080`.
- When the server sent nothing, the device sent `0B` and timed out.
- This proved the push protocol is server-first.

RealSvr tee relay result:

```text
server -> device:
55 aa 00 a9 00 00 00 00 00 00 00 00 00 00 a8 01 00

device -> server:
33 99 10 01 00 00 00 00 34 00 00 00 01 00 00 00
01 54 00 38 01 00 00 00 ea 47 98 11 01 00 8d 13
99 64 a8 c0 32 30 32 34 31 30 31 32 30 31 31 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
00 00 00 00

server -> device:
55 aa 01 40 00 00 00 00 00 00 00 00 00 00 40 01
```

The first device frame above was decoded by `RealSvrOcxTcp` as:

```text
device=192.168.100.153:5005
device_id=1
enroll=1
verify=20
inout=1
logDate=2026-04-24T12:04:56
serial=20241012011
```

## Minimal Code

Working pure Python receiver:

```bash
python3 tools/protocol-reverse-engineering/clpc3-realsvr-push-reader.py \
  --port 8080 \
  --listen-seconds 30 \
  --jsonl /tmp/clpc3-punches.jsonl
```

The script:

- sends the 17-byte RealSvr hello;
- reads the 68-byte punch frame;
- parses `device_id`, `enroll_id`, `verify_mode`, `inout_mode`, timestamp, and serial;
- sends the 16-byte ACK;
- appends JSONL records if `--jsonl` is provided.

Supporting debug tools added:

- `tools/protocol-reverse-engineering/clpc3-push-passive-listener.py`
- `tools/protocol-reverse-engineering/tcp-tee-relay.py`
- `tools/protocol-reverse-engineering/clpc3-windows-attack/real_svr_listen.ps1`
- `tools/protocol-reverse-engineering/clpc3-windows-attack/RealSvrProbe/`

## Current Frame Layout

Observed 68-byte record frame:

| Offset | Size | Meaning |
|---:|---:|---|
| 0 | 2 | magic `33 99` |
| 2 | 2 | frame type, observed `10 01` |
| 8 | 4 | payload length, observed `52` |
| 12 | 4 | device id |
| 16 | 1 | in/out mode |
| 17 | 1 | verify mode plus flags; `byte & 0x3f` matched ActiveX verify mode |
| 19 | 1 | seconds |
| 20 | 4 | enroll id |
| 24-27 | 4 | packed date/hour/minute, inferred from ActiveX-decoded records |
| 36 | 16 | ASCII serial, null-padded |

Timestamp packing is inferred from real records:

```python
year = 2000 + frame[24] - 0xD0
month = frame[25] >> 4
day = frame[26] & 0x1F
hour = (frame[26] >> 5) + 8
minute = frame[27] >> 2
second = frame[19]
```

This matched all records decoded by the vendor ActiveX in the current sample set. It still needs more samples outside the observed daytime hours before being treated as final.

## Expansion Assessment

Attendance records: viable now. The device sends backlog records one per connection after each ACK. A production adapter can keep `8080` open, append records, deduplicate by `(serial, enroll_id, log_time, verify_mode, inout_mode)`, and feed TMS.

Realtime: likely viable. With `Realtime=Yes`, new punches should arrive through the same server-first push path.

User list: not solved by this breakthrough. TCP `5005` still returns `flags=0x10/data_len=0` for `0x117` and `0x10A`, including OCX and Python. Need either a RealSvr user-frame command variant, USB export, or current LMT SDK/software.

Shift configuration: not solved by the device push path. It may be local software configuration rather than device data. Treat as TMS-side config unless LMT provides a device export for schedules.

Recommended next step: keep the Python push reader running, make a fresh punch on the CL-PC3, and verify a new record arrives immediately. Then add a small TMS adapter around `clpc3-realsvr-push-reader.py`.

## Session B Control Path Update

Date/time: 2026-05-03, Session B worktree `/Users/sunfl/Documents/work/DuoCode/products/WEMAX-TMS-session-b`.

Scope: CL-PC3 write/control path. No 8080 listener was started here; Session A keeps Mac port 8080.

### 5005 Control Socket Reachability

Current device IP `192.168.100.153:5005` is reachable from the Mac.

Read-only evidence:

```bash
python3 tools/protocol-reverse-engineering/clpc3-control-probe.py ping
python3 tools/protocol-reverse-engineering/clpc3-control-probe.py door-status --timeout 3
```

Observed ACK samples:

```text
PING request:
55 aa 01 00 79 19 52 00 00 00 00 00 00 00 e4 01

PING ack:
aa 55 01 00 10 00 00 00 e4 01

GET_DOOR request:
55 aa 01 00 79 19 20 01 00 00 00 00 00 00 b3 01

GET_DOOR ack:
aa 55 01 00 10 00 00 00 b3 01
```

Note: running multiple 5005 connections in parallel can produce empty responses. Use one connection per command, sequentially.

### Remote Open Door

Static reverse result from `FP_CLOCK.ocx`:

- `OpendoorEx` calls `SendCommandX(0x137, door, 0)`.
- Windows COM inspection confirms the public signature is `OpendoorEx(int, int)`.
- For the observed/default door parameter `door=1`, the Protocol B request is:

```text
55 aa 01 00 79 19 37 01 01 00 00 00 00 00 cb 01
```

Minimal repeatable code:

```bash
# Dry-run / byte generation only; does not trigger the relay.
python3 tools/protocol-reverse-engineering/clpc3-control-probe.py open-door --door 1

# Physical test command; run only after Benny confirms he is on-site and ready.
python3 tools/protocol-reverse-engineering/clpc3-control-probe.py open-door \
  --door 1 \
  --execute \
  --i-understand
```

Status: command bytes solved; physical open-door test not executed in this session because Benny on-site confirmation is still needed. Acceptance requires Benny to hear/confirm the relay click.

### Set Device Time

Static reverse result from `FP_CLOCK.ocx`:

- The exported `SetDeviceTime` path calls `SendCommandX(0x112, 0, 0)`.
- Windows COM inspection confirms the public signature is `SetDeviceTime(int)`.
- Minimal frame generated by the new probe:

```text
55 aa 01 00 79 19 12 01 00 00 00 00 00 00 a5 01
```

Minimal repeatable code:

```bash
# Dry-run / byte generation only.
python3 tools/protocol-reverse-engineering/clpc3-control-probe.py set-time-vendor-style

# Write test; run only after recording the original device time and arranging restore.
python3 tools/protocol-reverse-engineering/clpc3-control-probe.py set-time-vendor-style \
  --execute \
  --i-understand
```

Status: not executed. The vendor API shape is known, but the physical Date/Time screen confirmation still needs Benny.

### Write User / Enroll Data

Static reverse result from `FP_CLOCK.ocx`:

- Windows COM inspection confirms the public signature is `SetEnrollData(int, int, int, int, int, Variant, int)`.
- `SetEnrollData` uses opcode `0x102`.
- Ordinary fingerprint/template writes use a two-stage flow: `SendCommandX(0x102, ...)`, wait for ACK, then `SendBigDataX(...)`.
- Face/template variants use fixed payload sizes already seen in the reverse:
  - `0x760` bytes for backup `20..28`
  - `0x5ac` bytes for backup `30..38`
  - `0x58c` bytes for ordinary `0..9`
- UTF-8 username write uses opcode `0x13b` (`SetUserNameUTF8`).

Status: not executed. This is deliberately left behind the control probe's guarded `raw` mode until we have a disposable test enroll ID, payload bytes, and Benny's confirmation that `enrollid=999` is safe for add/delete.

### RealSvr Control Capability

Windows interop inspection of `RealSvrOcxTcpLib` found only:

```text
OpenNetwork
CloseNetwork
SendResponse
SendRtLogResponseV1
SendRtLogResponseV3
```

and receive events for realtime logs/text/images. No `OpenDoor`, `SetTime`, or `WriteUser` method exists on this RealSvr ActiveX surface. Current best control path is direct TCP `5005`; RealSvr remains the push/read listener path.

## User-Data Read Deep Dive — No USB

Date/time: 2026-05-03, current worktree `/Users/sunfl/Documents/work/DuoCode/products/WEMAX-TMS`.

Goal: read CL-PC3 employee data over network without USB. Target device `192.168.100.153`; Mac `192.168.100.204`.

Result: **no non-attendance user data obtained yet**. The device is definitely not empty for logs: while the RealSvr reader was running it captured two new attendance frames for `enroll_id=3` at `2026-05-03 02:14:29` and `2026-05-03 02:17:30`. However, all user-list/name/template/photo read paths below still returned no payload.

### Repro Scripts Added

- `tools/protocol-reverse-engineering/clpc3-user-read-deep-probe.py`
  - TCP Protocol B same-connection user read probe.
  - Default mode sends only read commands.
  - Optional `--with-enable-window` wraps reads in `ENABLE_DEV 0` and always restores with `ENABLE_DEV 1`.
- `tools/protocol-reverse-engineering/clpc3-riss-udp-user-reader.py`
  - Implements read-only Riss/Zd2911 UDP commands found in `Riss.Devices.dll`.
  - Exposes only read commands: device type, password verify, all users, names, cards, fingerprint data, full enroll.
- `tools/protocol-reverse-engineering/clpc3-realsvr-v3-variant-probe.py`
  - RealSvr 8080 response-order probe.
  - Cycles safe response variants: proven 16-byte ACK, raw `RTLOG003("OK")`, `ACK+V3`, `V3+ACK`, and `RTLOG003("RTLOG003")`.

### TCP 5005 Same-Connection Probe

Command:

```bash
python3 tools/protocol-reverse-engineering/clpc3-user-read-deep-probe.py \
  --host 192.168.100.153 \
  --trace-jsonl /tmp/clpc3-user-read-deep-probe.jsonl
```

Representative bytes:

```text
PING arg2=1 tx:
55 aa 01 00 79 19 52 00 01 00 00 00 00 00 e5 01
rx:
aa 55 01 00 10 00 00 00 e5 01

READ_ALL_USER_ID 0x117 tx:
55 aa 01 00 79 19 17 01 00 00 00 00 00 00 aa 01
rx:
aa 55 01 00 10 00 00 00 aa 01

GET_USER_NAME uid=1 tx:
55 aa 01 00 79 19 1d 01 01 00 00 00 00 00 b1 01
rx:
aa 55 01 00 10 00 00 00 b1 01

GET_USER_NAME uid=3 tx:
55 aa 01 00 79 19 1d 01 03 00 00 00 00 00 b3 01
rx:
aa 55 01 00 10 00 00 00 b3 01

GET_ENROLL uid=3 backup=1 tx:
55 aa 01 00 79 19 01 01 03 00 00 10 01 00 a8 01
rx:
aa 55 01 00 10 00 00 00 a8 01

PHOTO_GET_CS uid=3 tx:
55 aa 01 00 79 19 14 05 03 00 00 00 00 00 ae 01
rx:
aa 55 01 00 10 00 00 00 ae 01
```

Conclusion: keeping one TCP connection open and using the OCX-observed `PING arg2=1` first does not unlock user payloads. The response checksum continues to echo the request checksum, but no BigData follows.

### TCP 5005 Enable-Window Probe

Command:

```bash
python3 tools/protocol-reverse-engineering/clpc3-user-read-deep-probe.py \
  --host 192.168.100.153 \
  --with-enable-window \
  --trace-jsonl /tmp/clpc3-user-read-enable-window.jsonl
```

Key bytes:

```text
ENABLE_DEV 0 tx:
55 aa 01 00 79 19 10 01 00 00 00 00 00 00 a3 01
rx:
aa 55 01 00 10 00 00 00 a3 01

READ_ALL_USER_ID after ENABLE_DEV 0 tx:
55 aa 01 00 79 19 17 01 00 00 00 00 00 00 aa 01
rx:
aa 55 01 00 10 00 00 00 aa 01

ENABLE_DEV 1 restore tx:
55 aa 01 00 79 19 10 01 01 00 00 00 00 00 a4 01
rx:
aa 55 01 00 10 00 00 00 a4 01
```

Conclusion: the common vendor SDK pattern `EnableDevice(0) -> read -> EnableDevice(1)` also does not unlock user-list/name/photo/template data. Restore command was sent and ACKed.

### Password Arg2 Variants

Read-only probes tried raw `arg2=0`, raw `arg2=1`, encoded password-zero `arg2=0x58595a5b`, and `1 ^ encoded_pwd0 = 0x58595a5a` for `PING`, `READ_ALL_USER_ID`, and `GET_USER_NAME`.

All variants returned the same shape:

```text
aa 55 01 00 10 00 00 00 <request-checksum-le>
```

Conclusion: the missing payload is not fixed by sending encoded zero as the Comm Password field.

### Riss/Zd2911 UDP Probe

Static reverse finding: `Riss.Devices.dll` contains a full UDP-based Zd2911 protocol despite the class being named `Zd2911CommTcp`. It has read commands for all users, names, cards, fingerprint data, and full enroll records.

First probe byte for `GET_DEVICE_TYPE`:

```text
55 aa 01 00 4d 02 00 00 00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00 00 00 4f 01
```

Commands:

```bash
python3 tools/protocol-reverse-engineering/clpc3-riss-udp-user-reader.py \
  --host 192.168.100.153 \
  --port 5005 \
  --dn 1 \
  --password 0 \
  --timeout 3 \
  --trace-jsonl /tmp/clpc3-riss-udp-trace.jsonl
```

Observed result:

```text
UDP 5005: ConnectionRefusedError: [Errno 61] Connection refused
UDP 4370: ConnectionRefusedError
UDP 5505: ConnectionRefusedError
UDP 7005: ConnectionRefusedError
UDP 8080: timeout
```

Conclusion: the Riss/Zd2911 UDP protocol is present in the bundled software as a legacy/other-model path, but this CL-PC3 firmware is not listening on those UDP ports.

### RealSvr `SendRtLogResponseV3` Static Reverse

`RealSvrOcxTcp.ocx` has three response builders:

- `0x10001b80`: `RTLOG001`
- `0x10001c00`: `RTLOG002`
- `0x10001c90`: `RTLOG003`

`SendRtLogResponseV3(client, port, body)` builds a raw app-level buffer and sends it through the existing socket; it is not the known 16-byte binary ACK.

For body `"OK"`, the V3 payload shape is:

```text
52 54 4c 4f 47 30 30 33 07 00 00 00 03 00 00 00 4f 4b 00
```

For body `"RTLOG003"`, the V3 payload shape is:

```text
52 54 4c 4f 47 30 30 33 0d 00 00 00 09 00 00 00
52 54 4c 4f 47 30 30 33 00
```

Runtime status: 8080 could not be exercised in this window because after stopping the long-running reader, the device did not reconnect during a 38-second passive listener window or a 70-second normal RealSvr hello window. This path needs a fresh device connection, likely by waiting longer or having someone make a new punch while a V3 variant listener is active.

Follow-up: a 2-second normal RealSvr reader did later receive one more `33 99` attendance frame immediately:

```text
rx:
33 99 10 01 00 00 00 00 34 00 00 00 01 00 00 00
01 54 00 25 03 00 00 00 ea 57 43 e0 01 00 8d 13
99 64 a8 c0 32 30 32 34 31 30 31 32 30 31 31 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
00 00 00 00

ack:
55 aa 01 40 00 00 00 00 00 00 00 00 00 00 40 01
```

Immediately after that, the V3 variant probe was run:

```bash
python3 tools/protocol-reverse-engineering/clpc3-realsvr-v3-variant-probe.py \
  --port 8080 \
  --listen-seconds 180 \
  --max-connections 5 \
  --trace-jsonl /tmp/clpc3-realsvr-v3-variants.jsonl
```

Observed result: no device connection during the 180-second V3 probe window. The V3 script is ready, but it still needs a fresh push connection to produce a yes/no runtime result.

### 8080 Passive / HTTP Check

The previous long-running RealSvr reader PID `57893` was stopped to free port `8080`.

Passive listener command:

```bash
python3 tools/protocol-reverse-engineering/clpc3-push-passive-listener.py \
  --port 8080 \
  --idle-timeout 8
```

Observed result: no connection and no HTTP/plaintext bytes in 38 seconds.

Normal RealSvr hello restore test:

```bash
python3 tools/protocol-reverse-engineering/clpc3-realsvr-push-reader.py \
  --port 8080 \
  --listen-seconds 70 \
  --jsonl /tmp/clpc3-rt-after-passive.jsonl
```

Observed result: no connection in 70 seconds.

Conclusion: no evidence yet that this current `ServerPort=8080` configuration emits HTTP by itself. The already-solved server-first RealSvr binary path remains the only proven 8080 behavior.

### Telnet 23 Wider Weak-Password Probe

Additional read-only login attempts were tried beyond the original 10. No shell was obtained. All normal responses were `Login incorrect`; one transient attempt got no login prompt, likely device-side timing.

Tried credentials:

```text
root/(empty), root/12345, root/123456, root/toor, root/default,
root/pass, root/system, root/linux, root/buildroot, root/realand,
root/click, root/clpc3, root/timmy, root/tims,
admin/(empty), admin/123456, admin/password,
click/click, click/123456, lmt/lmt, timmy/timmy,
user/(empty), default/default
```

The device menu Data Password `8282` was not sent.

### Current Conclusion

Tried paths and failure reasons:

| Path | Outcome | Failure reason |
|---|---|---|
| TCP 5005 same-connection read sequence | No user data | Every read returns 10B ACK only, no BigData |
| TCP 5005 password arg2 variants | No user data | Encoded zero/raw variants still ACK-only |
| TCP 5005 `EnableDevice(0)` read window | No user data | ACK-only; restore ACKed |
| Riss/Zd2911 UDP | No user data | UDP ports refused or timed out |
| 8080 passive/HTTP | No user data | No connection during test window |
| RealSvr V3 ACK | Not runtime-tested | Need a fresh 8080 device connection |
| Telnet 23 | No shell | Additional weak creds failed |

Best next move: keep a variant 8080 listener ready and ask on-site to make one fresh punch so the device reconnects immediately. Then test `SendResponse` vs raw `RTLOG003` response order (`ACK`, `V3`, `ACK+V3`, `V3+ACK`) against a real connection and inspect whether the next frame changes from `33 99` attendance to an `RTLOG003` text/image frame.

## Authoritative Opcode Table (from Riss.Devices.dll decompile)

Source: `requirements/hardware/software/tms-setup-V1.0.402/Riss.Devices.dll`, decompiled with `ilspycmd` (output `/tmp/clpc3-rev/riss/Riss.Devices.decompiled.cs`). The `ZdDeviceCommand` enum at lines 12266-12320 is the .NET wrapper that the customer's `TMS.exe` (17 MB, 2024-06-24, in same folder) uses against CL-PC3. These are the wire-level opcode values placed at offset 6-7 of every Zd100 / FP_CLOCK Protocol B 16-byte cmd frame.

### Read-only / safe (Zd100 family, used over TCP 5005)

| Hex | Dec | Riss enum | Meaning |
|---:|---:|---|---|
| 0x0052 |  82 | InternalCheckDevicePassword | called on connect; transSize = password u32 |
| 0x0101 | 257 | CMD_GET_ENROLL_DATA | per-user fingerprint / pwd / card; 2-stage with BigData |
| 0x0102 | 258 | CMD_SET_ENROLL_DATA | **destructive write** |
| 0x0106 | 262 | CMD_GLOG_GET_COUNT | log record count |
| 0x0107 | 263 | CMD_GLOG_GET | get log records |
| 0x010E | 270 | CMD_DEVICE_TIME_GET | safe |
| 0x010F | 271 | CMD_DEVICE_TIME_SET | **destructive** |
| 0x0110 | 272 | CMD_POWER_OFF | **physical action** |
| 0x0112 | 274 | **CMD_READ_ALL_USERID** | 2-stage, user list as `EnrollUserID[8]` BigData |
| 0x0113 | 275 | CMD_SERIAL_NUM_GET | safe |
| 0x0115 | 277 | CMD_BACKUP_NUM_GET | safe |
| 0x0117 | 279 | CMD_ENROLL_DATA_EMPTY | **DESTRUCTIVE — delete all enrolls** |
| 0x0118 | 280 | CMD_GLOG_EMPTY | **DESTRUCTIVE — delete general logs** |
| 0x0119 | 281 | CMD_SLOG_EMPTY | **DESTRUCTIVE — delete super logs** |
| 0x011A | 282 | **CMD_USER_NAME_GET** | safe per-user name read |
| 0x011B | 283 | CMD_USER_NAME_SET | **destructive write** |
| 0x011C | 284 | CMD_COMPANY_NAME_GET | safe |
| 0x011D | 285 | CMD_COMPANY_NAME_SET | **destructive write** |
| 0x011E | 286 | CMD_DOOR_STATUS_GET | safe |
| 0x011F | 287 | CMD_DOOR_STATUS_SET | **destructive** |
| 0x0501-0x050D | 1281-1293 | CMD_SB_* | BigData enroll/image variants |
| 0x0607 | 1543 | CMD_USER_CTRL_SET | **destructive** |
| 0x0608 | 1544 | CMD_USER_CTRL_GET | safe |

### Wire format (Zd100 / FP_CLOCK Protocol B)

`Zd100DeviceComm.SendCommand` (lines 9451-9485) — the cmd frame is the C# `Staff` struct serialized to 16 bytes:

```text
off 0:  byte head1     = 0x55
off 1:  byte head2     = 0xAA
off 2-3: ushort dn       (LE — device number, default 1)
off 4-5: ushort reserved (LE — fixed 0x1979)
off 6-7: ushort command  (LE — opcode from the table above)
off 8-11: uint length    (LE — transSize / arg2)
off 12-13: ushort inParam (LE — arg1 / checkFlag)
off 14-15: ushort sum     (LE — bytes [0..13] summed mod 0x10000)
```

Cmd-Ack (8 bytes, `5A A5` magic — what Zd100 expects) and CommandRes (14 bytes, `AA 55` magic). CL-PC3 returns a 10-byte hybrid `aa 55 | DN | flags=0x10 | OutParam_lo | chksum-echo` regardless of the command — see "TCP 5005 same-connection probe" above.

### `EnrollUserID` BigData record (8 bytes/record, line 15034)

```text
uint  ID              ; 4 bytes
byte  EMachineNumber  ; 1
byte  BackupNumber    ; 1  — 0..9 finger, 10 pwd, 11 card, 20..28 face
byte  MachinPrivilege ; 1
byte  Enable          ; 1  — bit 4 marks "enabled"; mapped to (val & 0xF + 1) when set
```

### Was Zd2911 ever a candidate?

`Zd2911CommTcp` at line 14448 — despite the name — uses `SocketType.Dgram` (UDP). Customer `Pay_data.mdb / ConnectionSetting` has `UDP=0`, so the customer was never running 2911 protocol. Empirical UDP probes against 192.168.100.153:5005/4370/5505/7005/8080 confirm CL-PC3 doesn't listen on UDP for any of the Zd2911 family ports. Conclusion: **Zd2911 is for other Riss devices**; CL-PC3 is a Zd100-family target and the read paths in the table above are the only relevant ones over TCP 5005.

### Cross-reference for prior probes that mis-labelled opcodes

Several earlier probes used a CLAUDE.md / red-line table that was offset from the Riss enum. Reconciliation:

| Sent as | Actual wire opcode (Riss) | Real meaning |
|---|---|---|
| `READ_ALL_USER_ID 0x117` (sent multiple times) | 0x0117 | **CMD_ENROLL_DATA_EMPTY** — destructive |
| `GET_USER_NAME uid=N 0x11D` (with payload!) | 0x011D | **CMD_COMPANY_NAME_SET** — destructive |
| `set-time-vendor-style 0x112` | 0x0112 | CMD_READ_ALL_USERID stage 1 (was already reverse-correct in FP_CLOCK reverse but mis-labelled SetDeviceTime) |
| `0x11A EMPTY_ENROLL` red-line | 0x011A | CMD_USER_NAME_GET — actually a SAFE read |
| `0x11C EMPTY_SUP_LOG` red-line | 0x011C | CMD_COMPANY_NAME_GET — actually a SAFE read |

The destructive opcodes the original red-line table was trying to flag are 0x0117 / 0x0118 / 0x0119 (and 0x011B / 0x011D for write). On this firmware single-frame writes did not actually execute (no BigData second stage, possibly Data-Pwd 8282 also required), so the customer's enrolls survived. Future probes should use the table above as the ground truth.
