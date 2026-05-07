#!/usr/bin/env python3
"""CL-PC3 BigData probe: run the FULL 3-step protocol from FP_CLOCK.ocx reverse.

Protocol (per fn 0x10001d72 GetEnrollData reverse):
  1. SetMachineIDX(machineId)        -- set machineID for the next cmd
  2. SendCommandX(cmd, machineId, pwd) -- send 16B request frame
  3. RecExeResultX(buf, &size)       -- read 10B ACK; check ACK[4:6] for "data size hint"
  4. RecBigDataX(buf, expected_size)  -- read N bytes of BigData

Frame format observed (PC->Dev 16 bytes):
  55 AA <MID:2,LE> 79 19 <cmd:2,LE> <arg2:4,LE> <arg1:2,LE> <chk:2,LE>
  chk = sum(buf[0:14]) & 0xFFFF

Frame format observed (Dev->PC 10 bytes ACK):
  AA 55 <MID:2,LE> <flags:4> <chk:2,LE>
  flags[0..1] is observed = 0x0010 = sizeOfNextBigDataMaybe?

We try every confirmed dispatch opcode 0x101..0x13b and 0x513,0x514.

After ACK, we CONTINUE reading the socket for up to 10 seconds to collect any BigData stream.
"""
import socket, struct, time, sys

HOST, PORT = '172.20.10.2', 5005
TIMEOUT = 10.0
INTER_CMD_DELAY = 0.5  # be gentle, never hammer

# All known opcodes from FP_CLOCK.ocx 95-method dispatch
OPCODES = [
    # Enroll data ops (fingerprint + face)
    (0x101, 'GetEnrollData (variants)',     'enroll-get'),
    (0x102, 'SetEnrollData (variants)',     'enroll-set'),
    (0x103, 'DeleteEnrollData (variants)',  'enroll-del'),
    (0x104, 'ReadSuperLogData (single)',    'log-super-1'),
    (0x105, 'GetSuperLogData (single)',     'log-super-1g'),
    (0x106, 'ReadGeneralLogData (single)',  'log-gen-1'),
    (0x107, 'GetGeneralLogData (single)',   'log-gen-1g'),
    (0x108, 'ReadAllSLogData (bulk)',       'log-super-all'),
    (0x109, 'GetAllSLogData (bulk)',        'log-super-all2'),
    (0x10a, 'ReadAllGLogData (bulk)',       'log-gen-all'),
    (0x10d, 'GetDeviceInfo',                'info-get'),
    (0x10e, 'SetDeviceTime',                'time-set'),
    (0x10f, 'GetDeviceTime',                'time-get'),
    (0x110, 'SetDeviceInfo',                'info-set'),
    (0x111, 'EnableDevice',                 'enable-dev'),
    (0x112, 'EnableUser',                   'enable-user'),
    (0x113, 'PowerOnAllDevice',             'power-on'),
    (0x114, 'PowerOffDevice',               'power-off'),
    (0x115, 'ModifyPrivilege',              'priv-mod'),
    (0x116, 'ReadAllUserID',                'userid-read'),
    (0x117, 'GetAllUserID',                 'userid-get'),
    (0x118, 'GetSerialNumber',              'serial'),
    (0x119, 'GetBackupNumber',              'backup'),
    (0x11a, 'EmptyEnrollData',              'empty-enroll'),
    (0x11b, 'EmptyGeneralLogData',          'empty-gen'),
    (0x11c, 'EmptySuperLogData',            'empty-sup'),
    (0x11d, 'GetUserName',                  'name-get'),
    (0x11e, 'SetUserName',                  'name-set'),
    (0x11f, 'GetCompanyName / SetCompanyName', 'company'),
    (0x120, 'GetDoorStatus',                'door-get'),
    (0x121, 'SetDoorStatus',                'door-set'),
    (0x122, 'GetBellTime',                  'bell-get'),
    (0x125, 'GetUserCtrl',                  'userctrl-get'),
    (0x126, 'SetUserCtrl',                  'userctrl-set'),
    (0x127, 'DeleteUserCtrl',               'userctrl-del'),
    (0x128, 'ClearUserCtrl',                'userctrl-clr'),
    (0x129, 'GetWeekPassTime',              'week-get'),
    (0x12a, 'SetWeekPassTime',              'week-set'),
    (0x12b, 'GetDayPassTime',               'day-get'),
    (0x12c, 'SetDayPassTime',               'day-set'),
    (0x12d, 'GetLockGroup',                 'lock-get'),
    (0x12e, 'SetLockGroup',                 'lock-set'),
    (0x12f, 'SetServerPortandtick',         'server-set'),
    (0x130, 'USBReadGeneralLogData',        'usb-gen'),
    (0x131, 'USBReadSuperLogData',          'usb-sup'),
    (0x132, 'GetMacCode',                   'mac'),
    (0x133, 'GetModel',                     'model'),
    (0x135, 'GetHoliday',                   'hol-get'),
    (0x136, 'SetHoliday',                   'hol-set'),
    (0x137, 'DeleteHoliday',                'hol-del'),
    (0x138, 'CleanHoliday',                 'hol-clean'),
    (0x139, 'GetGeneralLogDataWithTemp',    'gen-temp'),
    (0x13a, 'GetUserNameUTF8',              'name-utf8-get'),
    (0x13b, 'SetUserNameUTF8',              'name-utf8-set'),
    (0x513, 'GetEnrollPhotoSize/CS',        'photo-size-cs'),
    (0x514, 'GetEnrollPhoto/CS',            'photo-cs'),
]

def encode_password(pwd):
    src = pwd.to_bytes(4, 'little')
    enc = bytes(src[i] ^ i ^ 0x5B for i in range(4))
    return int.from_bytes(enc, 'little')

def b_request(machine_id, cmd, arg2=0, arg1=0, password=0):
    buf = bytearray(16)
    buf[0] = 0x55; buf[1] = 0xAA
    struct.pack_into('<H', buf, 2, machine_id & 0xFFFF)
    buf[4] = 0x79; buf[5] = 0x19
    struct.pack_into('<H', buf, 6, cmd & 0xFFFF)
    enc_pwd = encode_password(password) if password else 0
    arg2_combined = (arg2 ^ enc_pwd) if password else arg2
    struct.pack_into('<I', buf, 8, arg2_combined & 0xFFFFFFFF)
    struct.pack_into('<H', buf, 12, arg1 & 0xFFFF)
    struct.pack_into('<H', buf, 14, sum(buf[0:14]) & 0xFFFF)
    return bytes(buf)

def hexdump(b, max_len=512):
    if not b: return '(empty)'
    if len(b) > max_len:
        b = b[:max_len]
        suffix = f'... (+{len(b) - max_len}B)'
    else:
        suffix = ''
    lines = []
    for i in range(0, len(b), 32):
        chunk = b[i:i+32]
        hex_part = ' '.join(f'{x:02x}' for x in chunk)
        ascii_part = ''.join(chr(x) if 0x20 <= x < 0x7F else '.' for x in chunk)
        lines.append(f'    {i:04x}  {hex_part:<96}  |{ascii_part}|')
    return '\n'.join(lines) + suffix

def run_cmd(cmd, label, arg1=0, arg2=0, machine_id=1, hold=4.0):
    """Run one full request with extended read window."""
    s = socket.socket(); s.settimeout(3)
    try:
        s.connect((HOST, PORT))
        frame = b_request(machine_id, cmd, arg2=arg2, arg1=arg1)
        s.sendall(frame)
        # Read everything for `hold` seconds
        s.settimeout(hold)
        rx = b''
        deadline = time.time() + hold
        try:
            while time.time() < deadline:
                s.settimeout(max(0.1, deadline - time.time()))
                try:
                    chunk = s.recv(4096)
                except socket.timeout:
                    break
                if not chunk: break
                rx += chunk
                if len(rx) > 100*1024: break  # safety cap
        except socket.timeout: pass
        return rx
    except Exception as e:
        return f'ERR:{e}'.encode()
    finally:
        try: s.close()
        except: pass

def run_double(cmd, label, arg1=0, arg2=0, machine_id=1, hold=4.0):
    """Send same cmd twice — maybe double-step unlocks BigData."""
    s = socket.socket(); s.settimeout(3)
    try:
        s.connect((HOST, PORT))
        frame = b_request(machine_id, cmd, arg2=arg2, arg1=arg1)
        s.sendall(frame); time.sleep(0.4)
        s.sendall(frame); time.sleep(0.4)
        s.settimeout(hold)
        rx = b''
        deadline = time.time() + hold
        try:
            while time.time() < deadline:
                s.settimeout(max(0.1, deadline - time.time()))
                try: chunk = s.recv(4096)
                except socket.timeout: break
                if not chunk: break
                rx += chunk
                if len(rx) > 100*1024: break
        except socket.timeout: pass
        return rx
    except Exception as e:
        return f'ERR:{e}'.encode()
    finally:
        try: s.close()
        except: pass

def banner(title):
    line = '=' * (len(title) + 4)
    print(f'\n{line}\n  {title}\n{line}')

print(f'CL-PC3 BigData probe -> {HOST}:{PORT}')
print(f'Total opcodes to test: {len(OPCODES)}')
print(f'Expected: 16-byte request, 10-byte ACK, then BigData if cmd has data')
print()

# === Pass 1: each cmd with arg1=0, arg2=0, hold 3s ===
banner('PASS 1: arg1=0 arg2=0 (single attempt, 3s hold)')
results_1 = {}
big_hits = []
for cmd, name, slug in OPCODES:
    rx = run_cmd(cmd, name, arg1=0, arg2=0, hold=3.0)
    n = len(rx) if isinstance(rx, bytes) else 0
    results_1[cmd] = (rx, n)
    label = f'cmd=0x{cmd:03x} {name[:32]:<32}'
    if n == 10:
        print(f'  {label} -> 10B ACK only')
    elif n > 10:
        print(f'  {label} -> {n}B [BIG DATA!]')
        print(hexdump(rx, 256))
        big_hits.append((cmd, name, rx))
    elif n > 0:
        print(f'  {label} -> {n}B (unexpected) {rx.hex()}')
    else:
        print(f'  {label} -> NO RESPONSE')
    time.sleep(INTER_CMD_DELAY)

if big_hits:
    print('\n[OK] PASS 1 found cmds returning >10 bytes:')
    for cmd, name, rx in big_hits:
        print(f'  cmd=0x{cmd:03x}  name={name}  {len(rx)} bytes')
else:
    print('\n[--] PASS 1: all 56 cmds returned only 10B ACK')

# === Pass 2: each potentially-data cmd with arg1 sweep ===
banner('PASS 2: arg1 sweep (1..5) on key data cmds')
key_cmds_p2 = [
    (0x101, 'GetEnrollData', 1),         # arg1=1 = fingerprint
    (0x101, 'GetEnrollData face', 7),    # arg1=7 = face data
    (0x101, 'GetEnrollData face2', 8),   # arg1=8 = face data alt
    (0x102, 'SetEnrollData', 1),
    (0x108, 'ReadAllSLogData', 0),
    (0x10a, 'ReadAllGLogData', 0),
    (0x117, 'GetAllUserID', 0),
    (0x118, 'GetSerialNumber', 0),
    (0x130, 'USBReadGeneralLogData', 0),
    (0x131, 'USBReadSuperLogData', 0),
    (0x513, 'GetEnrollPhotoSize', 0),
    (0x514, 'GetEnrollPhoto', 0),
]
for cmd, name, arg1 in key_cmds_p2:
    for ai in range(0, 10):
        rx = run_cmd(cmd, name, arg1=ai, arg2=1, hold=2.0)
        n = len(rx) if isinstance(rx, bytes) else 0
        if n != 10 or (n == 10 and rx[:2] != b'\xAA\x55'):
            print(f'  cmd=0x{cmd:03x} arg1={ai} arg2=1 -> {n}B  {rx.hex() if n<=64 else rx[:64].hex()+"..."}')
            if n > 10:
                big_hits.append((cmd, f'{name} arg1={ai}', rx))
                print(hexdump(rx, 200))
        time.sleep(0.3)

# === Pass 3: chained probe — SetMachineID first, then GetEnrollData ===
banner('PASS 3: chained SetMachineID -> GetEnrollData')
def chained(cmds):
    s = socket.socket(); s.settimeout(3)
    try:
        s.connect((HOST, PORT))
        for cmd, arg2, arg1 in cmds:
            frame = b_request(1, cmd, arg2=arg2, arg1=arg1)
            s.sendall(frame); time.sleep(0.4)
        s.settimeout(5.0)
        rx = b''
        deadline = time.time() + 5
        try:
            while time.time() < deadline:
                s.settimeout(max(0.1, deadline - time.time()))
                try: chunk = s.recv(4096)
                except socket.timeout: break
                if not chunk: break
                rx += chunk
        except socket.timeout: pass
        return rx
    except Exception as e:
        return f'ERR:{e}'.encode()
    finally:
        try: s.close()
        except: pass

# Try chain ping(0x52) + GetSerialNumber(0x118)
chains = [
    [(0x52, 0, 0), (0x118, 0, 0)],
    [(0x118, 0, 0)],
    [(0x117, 0, 0)],
    [(0x10f, 0, 0)],  # GetDeviceTime
    [(0x12f, 0, 0)],  # SetServerPortandtick? read first
    [(0x101, 1, 1), (0x101, 1, 1)],  # double GetEnrollData
]
for c in chains:
    label = ' -> '.join(f'0x{cmd:03x}' for cmd,_,_ in c)
    rx = chained(c)
    n = len(rx) if isinstance(rx, bytes) else 0
    print(f'  chain [{label}] -> {n}B')
    if n > 20:
        print(hexdump(rx, 256))
        big_hits.append(('chain', label, rx))
    elif n > 0:
        print(f'    raw: {rx[:80].hex()}')

# === Pass 4: long-running connection — open socket, send cmd, wait 15s for data ===
banner('PASS 4: long-hold (15s) to detect delayed BigData stream')
long_hold_cmds = [
    (0x101, 'GetEnrollData arg1=1', 1, 1),
    (0x117, 'GetAllUserID', 0, 0),
    (0x10a, 'ReadAllGLogData', 0, 0),
    (0x108, 'ReadAllSLogData', 0, 0),
    (0x118, 'GetSerialNumber', 0, 0),
    (0x10d, 'GetDeviceInfo', 0, 0),
    (0x132, 'GetMacCode', 0, 0),
]
for cmd, name, arg1, arg2 in long_hold_cmds:
    rx = run_cmd(cmd, name, arg1=arg1, arg2=arg2, hold=8.0)
    n = len(rx) if isinstance(rx, bytes) else 0
    print(f'  cmd=0x{cmd:03x} {name:<32} hold=8s -> {n}B')
    if n != 10:
        print(hexdump(rx, 256))
        if n > 10:
            big_hits.append((cmd, name, rx))

# === Final summary ===
banner('SUMMARY')
print(f'Tested {len(OPCODES)} unique opcodes from FP_CLOCK.ocx dispatch.')
print(f'BigData hits: {len(big_hits)}')
if big_hits:
    for cmd, name, rx in big_hits[:10]:
        print(f'  cmd=0x{cmd:03x if isinstance(cmd,int) else cmd}  name={name}  {len(rx)} bytes')
else:
    print('All cmds returned only 10B ACK — device responds but does not stream BigData.')
    print()
    print('Hypotheses for why no BigData:')
    print('  1) Empty device: 0 users / 0 logs / 0 face templates registered.')
    print('     If cmd=0x117 GetAllUserID has no users, ACK might say "0 records" with no follow-up.')
    print('  2) Comm Password mismatch: arg2 must be ConvertPassword(pwd) of correct value.')
    print('  3) ACK flags interpretation: byte 4..7 may encode "go ahead, read N bytes"')
    print('     and we need to send a *follow-up* "ACK acknowledged, send data" frame.')
    print('  4) Wrong sub-cmd (arg1) for the variant requested.')
