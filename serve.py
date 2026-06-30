#!/usr/bin/env python3
"""Serve the chess coach app on your local network."""

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import errno
import re
import socket
import subprocess
import sys


PORT = 4173


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
    }


class Server(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        error = sys.exc_info()[1]
        if isinstance(error, OSError) and error.errno in {errno.ENOTCONN, errno.ECONNRESET}:
            return
        super().handle_error(request, client_address)


def candidate_ips():
    interfaces = []
    fallback_ip = None

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        fallback_ip = sock.getsockname()[0]
    except OSError:
        pass
    finally:
        sock.close()

    try:
        _, _, host_ips = socket.gethostbyname_ex(socket.gethostname())
        interfaces.extend(("hostname", ip) for ip in host_ips)
    except OSError:
        pass

    for command in (("/sbin/ifconfig",), ("ifconfig",)):
        try:
            output = subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL)
        except (OSError, subprocess.CalledProcessError):
            continue
        for block in re.split(r"\n(?=\S)", output):
            name = block.split(":", 1)[0].strip()
            if "status: active" not in block:
                continue
            for ip in re.findall(r"\binet (?:addr:)?(\d+\.\d+\.\d+\.\d+)", block):
                interfaces.append((name, ip))

    for command in (("ip", "-4", "addr"),):
        try:
            output = subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL)
        except (OSError, subprocess.CalledProcessError):
            continue
        for line in output.splitlines():
            match = re.search(r"inet (\d+\.\d+\.\d+\.\d+)/", line)
            if match:
                interfaces.append(("network", match.group(1)))

    unique = []
    for name, ip in interfaces:
        if ip.startswith("127.") or ip == "0.0.0.0" or ip in unique:
            continue
        if name.startswith(("utun", "awdl", "llw")):
            continue
        unique.append(ip)
    if unique:
        return unique
    if fallback_ip and not fallback_ip.startswith("127."):
        return [fallback_ip]
    return ["127.0.0.1"]


def main():
    ips = candidate_ips()
    server = Server(("0.0.0.0", PORT), Handler)
    print("Chess Coach is running.", flush=True)
    print(f"This computer: http://127.0.0.1:{PORT}/index.html", flush=True)
    for ip in ips:
        print(f"Phone / same Wi-Fi: http://{ip}:{PORT}/index.html", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)


if __name__ == "__main__":
    main()
