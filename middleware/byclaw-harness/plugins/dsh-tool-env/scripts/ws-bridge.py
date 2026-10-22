#!/usr/bin/env python3
"""WebSocket-to-TCP bridge inside the tool environment (B).

Serves ws://0.0.0.0:LISTEN and connects each WebSocket to TARGET (B's sshd), so a
runtime (A) behind an HTTP-only ingress can SSH in through scripts/ws-proxy.mjs.
Started by tool-env-sshd.sh when BYCLAW_TOOL_ENV_WS_PORT is set. Needs the
`websockets` package (Debian: python3-websockets)."""
import argparse
import asyncio
from http import HTTPStatus

import websockets


def process_request(connection, request):
    """Plain HTTP (ingress health checks, A's readiness probe) gets 200; WebSocket upgrades proceed."""
    if request.headers.get("Upgrade", "").lower() != "websocket":
        return connection.respond(HTTPStatus.OK, "byclaw-tool-env bridge\n")
    return None


async def handle(ws):
    reader, writer = await asyncio.open_connection(HOST, PORT)

    async def ws_to_tcp():
        try:
            async for message in ws:
                writer.write(message if isinstance(message, bytes) else message.encode())
                await writer.drain()
        finally:
            writer.close()

    async def tcp_to_ws():
        try:
            while True:
                data = await reader.read(65536)
                if not data:
                    break
                await ws.send(data)
        finally:
            await ws.close()

    await asyncio.gather(ws_to_tcp(), tcp_to_ws(), return_exceptions=True)


async def main(listen: int):
    async with websockets.serve(handle, '0.0.0.0', listen, max_size=None, ping_interval=20, process_request=process_request):
        await asyncio.Future()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--listen', type=int, default=8022)
    parser.add_argument('--target', default='127.0.0.1:22')
    args = parser.parse_args()
    HOST, PORT = args.target.rsplit(':', 1)
    PORT = int(PORT)
    asyncio.run(main(args.listen))
