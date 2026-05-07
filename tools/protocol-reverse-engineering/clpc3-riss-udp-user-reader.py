#!/usr/bin/env python3
"""Read CL-PC3 users through the Riss/Zd2911 UDP protocol.

This script is intentionally read-only. It implements the packet layout found
in ``Riss.Devices.dll`` / ``Zd2911DeviceComm`` and exposes only commands that
read device type, password status, user IDs, names, cards, fingerprints, and
full enroll records.

The vendor class is named ``Zd2911CommTcp``, but it uses a UDP socket.
"""

from __future__ import annotations

import argparse
import json
import socket
import struct
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


DEFAULT_HOST = "192.168.100.153"
DEFAULT_PORT = 5005
DEFAULT_DN = 1

CMD_PREFIX = 0xAA55
CMD_DATA_PREFIX = 0xA55A
RCM_PREFIX = 0x55AA
RCM_DATA_PREFIX = 0x5AA5

CMD_GET_DEVICE_TYPE = 0x024D
CMD_VERIFY_DEVPASS = 0x0215
CMD_GET_ALL_USER_ENROLL_INFO = 0x0242
CMD_GET_USER_NAME = 0x0221
CMD_READ_FP_DATA = 0x0206
CMD_READ_CARD_ID = 0x0212
CMD_GET_USER_ENROLL = 0x0255

READ_ONLY_COMMANDS = {
    CMD_GET_DEVICE_TYPE: "GET_DEVICE_TYPE",
    CMD_VERIFY_DEVPASS: "VERIFY_DEVPASS",
    CMD_GET_ALL_USER_ENROLL_INFO: "GET_ALL_USER_ENROLL_INFO",
    CMD_GET_USER_NAME: "GET_USER_NAME",
    CMD_READ_FP_DATA: "READ_FP_DATA",
    CMD_READ_CARD_ID: "READ_CARD_ID",
    CMD_GET_USER_ENROLL: "GET_USER_ENROLL",
}

DESTRUCTIVE_COMMANDS = {
    0x0201: "CLEAR_FP",
    0x0202: "CLEAR_PWD",
    0x0203: "CLEAR_USER",
    0x0204: "CLEAR_ALL_USER",
    0x0217: "INIT_DEVICE",
    0x021B: "CLEAR_GLOG",
    0x021C: "CLEAR_SLOG",
    0x0256: "SET_USER_ENROLL",
}


@dataclass
class TraceEntry:
    ts: float
    direction: str
    label: str
    cmd: str
    data_hex: str
    length: int


@dataclass
class UserSummary:
    enrollid: int
    enroll_type_mask: int | None = None
    privilege: int | None = None
    name: str | None = None
    card: int | None = None
    full_name: str | None = None
    full_card: int | None = None
    password_present: bool | None = None
    fingerprint_slots: list[int] = field(default_factory=list)
    fingerprint_template_bytes: int = 0
    fingerprint_checksums_ok: int = 0
    errors: list[str] = field(default_factory=list)


class ProtocolError(RuntimeError):
    pass


def hexsp(data: bytes) -> str:
    return data.hex(" ")


def u16(data: bytes, offset: int) -> int:
    return struct.unpack_from("<H", data, offset)[0]


def u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def u64(data: bytes, offset: int) -> int:
    return struct.unpack_from("<Q", data, offset)[0]


def checksum(data: bytes) -> int:
    return sum(data) & 0xFFFF


def decode_utf16le(raw: bytes) -> str:
    end = len(raw)
    for i in range(0, len(raw) - 1, 2):
        if raw[i] == 0 and raw[i + 1] == 0:
            end = i
            break
    return raw[:end].decode("utf-16le", errors="ignore").replace("\x00", "").strip()


def command_name(cmd: int) -> str:
    return READ_ONLY_COMMANDS.get(cmd, f"CMD_0x{cmd:04x}")


def build_send_data_request(
    cmd: int,
    payload: bytes = b"",
    *,
    dn: int = DEFAULT_DN,
    trans_size: int | None = None,
    check_flag: bool = True,
) -> bytes:
    """Build the vendor SendData request.

    ``Zd2911DeviceComm.SendData`` always calls ``Send()``, which sends a
    28-byte command packet. The checksum position still depends on check_flag:
    offset 26 for normal command packets, or offset 8+trans_size for data
    prefix packets such as GET_USER_ENROLL.
    """

    if cmd in DESTRUCTIVE_COMMANDS:
        raise ValueError(f"refusing destructive command 0x{cmd:04x} ({DESTRUCTIVE_COMMANDS[cmd]})")
    if cmd not in READ_ONLY_COMMANDS:
        raise ValueError(f"refusing unknown/non-whitelisted command 0x{cmd:04x}")
    if trans_size is None:
        trans_size = len(payload)
    if len(payload) > 18:
        raise ValueError("SendData command payload is too large for the 28-byte command packet")

    prefix = CMD_PREFIX if check_flag else CMD_DATA_PREFIX
    buf = bytearray(28)
    struct.pack_into("<H", buf, 0, prefix)
    struct.pack_into("<H", buf, 2, dn & 0xFFFF)
    struct.pack_into("<H", buf, 4, cmd & 0xFFFF)
    struct.pack_into("<H", buf, 6, trans_size & 0xFFFF)
    buf[8 : 8 + len(payload)] = payload

    check_len = 26 if check_flag else 8 + trans_size
    struct.pack_into("<H", buf, check_len, checksum(buf[:check_len]))
    return bytes(buf)


def validate_command_response(data: bytes, cmd: int) -> None:
    if len(data) < 28:
        raise ProtocolError(f"short command response for {command_name(cmd)}: {len(data)} bytes")
    if u16(data, 0) != RCM_PREFIX:
        raise ProtocolError(f"bad command response prefix: {data[:2].hex(' ')}")
    if u16(data, 4) != cmd:
        raise ProtocolError(f"command mismatch: expected 0x{cmd:04x}, got 0x{u16(data, 4):04x}")
    expected = checksum(data[:26])
    actual = u16(data, 26)
    if actual != expected:
        raise ProtocolError(f"bad command checksum: expected 0x{expected:04x}, got 0x{actual:04x}")


def validate_bigdata_response(data: bytes, cmd: int) -> None:
    if len(data) < 10:
        raise ProtocolError(f"short bigdata response for {command_name(cmd)}: {len(data)} bytes")
    if u16(data, 0) != RCM_DATA_PREFIX:
        raise ProtocolError(f"bad bigdata prefix: {data[:2].hex(' ')}")
    if u16(data, 4) != cmd:
        raise ProtocolError(f"bigdata command mismatch: expected 0x{cmd:04x}, got 0x{u16(data, 4):04x}")
    data_len = u16(data, 6)
    expected_len = 8 + data_len + 2
    if len(data) < expected_len:
        raise ProtocolError(f"short bigdata body: expected {expected_len}, got {len(data)}")
    expected = checksum(data[: 8 + data_len])
    actual = u16(data, 8 + data_len)
    if actual != expected:
        raise ProtocolError(f"bad bigdata checksum: expected 0x{expected:04x}, got 0x{actual:04x}")


def response_ok(data: bytes) -> bool:
    return len(data) >= 10 and u16(data, 8) == 0


class RissUdpClient:
    def __init__(
        self,
        host: str,
        port: int,
        *,
        dn: int,
        timeout: float,
        trace_jsonl: Path | None = None,
    ) -> None:
        self.host = host
        self.port = port
        self.dn = dn
        self.timeout = timeout
        self.trace_jsonl = trace_jsonl
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(timeout)
        self.sock.connect((host, port))

    def close(self) -> None:
        self.sock.close()

    def trace(self, direction: str, label: str, cmd: int, data: bytes) -> None:
        entry = TraceEntry(
            ts=time.time(),
            direction=direction,
            label=label,
            cmd=command_name(cmd),
            data_hex=hexsp(data),
            length=len(data),
        )
        if self.trace_jsonl:
            with self.trace_jsonl.open("a", encoding="utf-8") as f:
                f.write(json.dumps(asdict(entry), ensure_ascii=False) + "\n")

    def send_command(
        self,
        cmd: int,
        payload: bytes = b"",
        *,
        trans_size: int | None = None,
        check_flag: bool = True,
        expect_bigdata: bool = False,
    ) -> tuple[bytes, bytes | None]:
        req = build_send_data_request(
            cmd,
            payload,
            dn=self.dn,
            trans_size=trans_size,
            check_flag=check_flag,
        )
        self.trace("tx", "command", cmd, req)
        self.sock.send(req)

        cmd_resp = self.recv_datagram(cmd, "command-response")
        validate_command_response(cmd_resp, cmd)
        if not response_ok(cmd_resp):
            raise ProtocolError(f"{command_name(cmd)} returned response code 0x{u16(cmd_resp, 8):04x}")

        if not expect_bigdata:
            return cmd_resp, None

        big = self.recv_bigdata(cmd)
        validate_bigdata_response(big, cmd)
        return cmd_resp, big

    def recv_datagram(self, cmd: int, label: str) -> bytes:
        data = self.sock.recv(65535)
        self.trace("rx", label, cmd, data)
        return data

    def recv_bigdata(self, cmd: int) -> bytes:
        first = self.recv_datagram(cmd, "bigdata-header")
        if len(first) < 8:
            raise ProtocolError(f"short bigdata header: {len(first)} bytes")
        total = bytearray(first)
        data_len = u16(total, 6)
        expected_len = 8 + data_len + 2
        while len(total) < expected_len:
            chunk = self.recv_datagram(cmd, "bigdata-chunk")
            total.extend(chunk)
        return bytes(total[:expected_len])


def parse_simple_users(bigdata: bytes, user_count: int) -> list[UserSummary]:
    payload = bigdata[12 : 12 + user_count * 12]
    users: list[UserSummary] = []
    for i in range(user_count):
        row = payload[i * 12 : (i + 1) * 12]
        users.append(
            UserSummary(
                enrollid=u64(row, 0),
                enroll_type_mask=u16(row, 8),
                privilege=row[10],
            )
        )
    return users


def parse_full_enroll(user: UserSummary, bigdata: bytes) -> None:
    record = bigdata[12 : 12 + 5096]
    if len(record) < 116:
        user.errors.append(f"short full enroll record: {len(record)} bytes")
        return

    user.full_card = u32(record, 36)
    user.full_name = decode_utf16le(record[40:64])
    user.password_present = any(record[28:36])
    user.fingerprint_slots = []
    for slot in range(10):
        if u16(record, 8 + slot * 2) != 0:
            user.fingerprint_slots.append(slot)

    fp_blob = record[116 : 116 + 4980]
    user.fingerprint_template_bytes = len(fp_blob)
    ok = 0
    for slot in range(10):
        templ = fp_blob[slot * 498 : (slot + 1) * 498]
        if len(templ) == 498 and any(templ) and checksum(templ[:496]) == u16(templ, 496):
            ok += 1
    user.fingerprint_checksums_ok = ok


def get_device_type(client: RissUdpClient) -> int:
    cmd_resp, _ = client.send_command(CMD_GET_DEVICE_TYPE, b"\x00", trans_size=0)
    return struct.unpack_from("<i", cmd_resp, 10)[0]


def verify_password(client: RissUdpClient, password: int) -> None:
    payload = struct.pack("<HH", password & 0xFFFF, (password >> 16) & 0xFFFF)
    client.send_command(CMD_VERIFY_DEVPASS, payload, trans_size=4)


def get_all_users(client: RissUdpClient, max_users: int) -> list[UserSummary]:
    payload = b"\x00\x00" + struct.pack("<H", max_users & 0xFFFF)
    cmd_resp, big = client.send_command(CMD_GET_ALL_USER_ENROLL_INFO, payload, trans_size=4, expect_bigdata=True)
    assert big is not None
    user_count = u16(cmd_resp, 10)
    return parse_simple_users(big, user_count)


def get_user_name(client: RissUdpClient, enrollid: int) -> str:
    _, big = client.send_command(CMD_GET_USER_NAME, struct.pack("<Q", enrollid), trans_size=8, expect_bigdata=True)
    assert big is not None
    return decode_utf16le(big[12:36])


def read_card(client: RissUdpClient, enrollid: int) -> int:
    cmd_resp, _ = client.send_command(CMD_READ_CARD_ID, struct.pack("<Q", enrollid), trans_size=8)
    return u32(cmd_resp, 12)


def get_full_enroll(client: RissUdpClient, user: UserSummary) -> None:
    _, big = client.send_command(
        CMD_GET_USER_ENROLL,
        struct.pack("<Q", user.enrollid),
        trans_size=8,
        check_flag=False,
        expect_bigdata=True,
    )
    assert big is not None
    parse_full_enroll(user, big)


def read_fingerprint(client: RissUdpClient, enrollid: int, slot: int) -> bytes:
    payload = struct.pack("<Q", enrollid) + bytes([slot & 0xFF])
    _, big = client.send_command(CMD_READ_FP_DATA, payload, trans_size=9, expect_bigdata=True)
    assert big is not None
    return big[12 : 12 + 498]


def user_to_json(user: UserSummary) -> dict[str, Any]:
    return asdict(user)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--dn", type=int, default=DEFAULT_DN)
    parser.add_argument("--password", type=int, default=0)
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--max-users", type=int, default=0xFFFF)
    parser.add_argument("--trace-jsonl", type=Path, help="Append tx/rx byte traces as JSONL")
    parser.add_argument("--skip-full-enroll", action="store_true", help="Do not try CMD2911_GET_USER_ENROLL")
    parser.add_argument("--read-fp", action="store_true", help="Also try per-slot READ_FP_DATA for slots listed by full enroll")
    parser.add_argument("--enrollid", type=int, action="append", help="Read specific enroll ID(s) instead of all users")
    args = parser.parse_args(argv)

    if args.trace_jsonl and args.trace_jsonl.exists():
        args.trace_jsonl.unlink()

    client = RissUdpClient(
        args.host,
        args.port,
        dn=args.dn,
        timeout=args.timeout,
        trace_jsonl=args.trace_jsonl,
    )
    try:
        device_type = get_device_type(client)
        verify_password(client, args.password)

        if args.enrollid:
            users = [UserSummary(enrollid=eid) for eid in args.enrollid]
        else:
            users = get_all_users(client, args.max_users)

        for user in users:
            try:
                user.name = get_user_name(client, user.enrollid)
            except Exception as exc:  # noqa: BLE001 - keep probing other read-only fields.
                user.errors.append(f"GET_USER_NAME failed: {exc}")
            try:
                user.card = read_card(client, user.enrollid)
            except Exception as exc:  # noqa: BLE001
                user.errors.append(f"READ_CARD_ID failed: {exc}")
            if not args.skip_full_enroll:
                try:
                    get_full_enroll(client, user)
                except Exception as exc:  # noqa: BLE001
                    user.errors.append(f"GET_USER_ENROLL failed: {exc}")
            if args.read_fp and user.fingerprint_slots:
                for slot in user.fingerprint_slots:
                    try:
                        templ = read_fingerprint(client, user.enrollid, slot)
                        if any(templ) and checksum(templ[:496]) == u16(templ, 496):
                            user.fingerprint_checksums_ok += 1
                    except Exception as exc:  # noqa: BLE001
                        user.errors.append(f"READ_FP_DATA slot {slot} failed: {exc}")

        output = {
            "host": args.host,
            "port": args.port,
            "dn": args.dn,
            "device_type": device_type,
            "user_count": len(users),
            "users": [user_to_json(user) for user in users],
            "trace_jsonl": str(args.trace_jsonl) if args.trace_jsonl else None,
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
