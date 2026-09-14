#!/usr/bin/env python3
"""Stdlib WebSocket sender for BeeLadybug PythonBridge. No pip packages."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import random
import socket
import struct
import time

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def accept_key(key: str) -> str:
    digest = hashlib.sha1((key + GUID).encode("utf-8")).digest()
    return base64.b64encode(digest).decode("ascii")


def encode(payload: bytes) -> bytes:
    n = len(payload)
    if n < 126:
        header = struct.pack("!BB", 0x81, n)
    elif n < 65536:
        header = struct.pack("!BBH", 0x81, 126, n)
    else:
        header = struct.pack("!BBQ", 0x81, 127, n)
    return header + payload


def send_json(conn: socket.socket, packet: dict) -> None:
    conn.sendall(encode(json.dumps(packet).encode("utf-8")))


def handshake(conn: socket.socket) -> bool:
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(4096)
        if not chunk:
            return False
        data += chunk
    text = data.decode("utf-8", errors="replace")
    key = ""
    for line in text.split("\r\n"):
        if line.lower().startswith("sec-websocket-key:"):
            key = line.split(":", 1)[1].strip()
            break
    if not key:
        return False
    accept = accept_key(key)
    response = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n"
        "\r\n"
    )
    conn.sendall(response.encode("ascii"))
    return True


def stream(conn: socket.socket) -> None:
    send_json(conn, {
        "type": "log",
        "payload": {"message": "python sender online", "source": "python"},
    })
    send_json(conn, {
        "type": "state",
        "payload": {"key": "ai.model", "value": "demo-llm"},
    })
    tick = 0
    tokens = 0
    while True:
        tick += 1
        loss = 0.35 + 0.12 * math.sin(tick / 8) + random.random() * 0.02
        tokens += random.randint(4, 18)
        send_json(conn, {
            "type": "metric",
            "payload": {"name": "loss", "value": round(loss, 4), "unit": ""},
        })
        send_json(conn, {
            "type": "metric",
            "payload": {"name": "tokens", "value": tokens, "unit": "tok"},
        })
        send_json(conn, {
            "type": "state",
            "payload": {"key": "ai.status", "value": "train" if tick % 14 < 9 else "eval"},
        })
        if tick % 20 == 0:
            send_json(conn, {
                "type": "log",
                "payload": {"message": f"epoch heartbeat {tick}"},
            })
        if random.random() < 0.08:
            send_json(conn, {
                "type": "error",
                "payload": {
                    "message": f"latency spike {random.randint(180, 640)}ms",
                },
            })
        time.sleep(0.45)


def main() -> None:
    parser = argparse.ArgumentParser(description="BeeLadybug PythonBridge demo sender")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((args.host, args.port))
    server.listen(4)
    print(f"BeeLadybug Python sender on ws://{args.host}:{args.port}")
    print("Open examples/python.html and click Connect.")

    while True:
        conn, addr = server.accept()
        print("client", addr)
        try:
            if handshake(conn):
                stream(conn)
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            print("disconnect", exc)
        finally:
            conn.close()


if __name__ == "__main__":
    main()
