from __future__ import annotations

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from typing import Literal


ROOT = Path(__file__).resolve().parents[2]
PortStatus = Literal["open", "closed", "unknown"]


def port_status(host: str, port: int) -> PortStatus:
    try:
        with socket.create_connection((host, port), timeout=0.25):
            return "open"
    except PermissionError:
        return "unknown"
    except OSError:
        return "closed"


def wait_for_port(host: str, port: int, process: subprocess.Popen[bytes], label: str, timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{label} stopped before it was ready.")
        status = port_status(host, port)
        if status == "open":
            return
        if status == "unknown":
            grace_deadline = time.monotonic() + 5
            while time.monotonic() < grace_deadline:
                if process.poll() is not None:
                    raise RuntimeError(f"{label} stopped before it was ready.")
                time.sleep(0.2)
            return
        time.sleep(0.2)
    raise RuntimeError(f"Timed out waiting for {label} on {host}:{port}.")


def command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def start_process(command: list[str], *, env: dict[str, str] | None = None) -> subprocess.Popen[bytes]:
    return subprocess.Popen(command, cwd=ROOT, env=env)


def terminate(processes: list[subprocess.Popen[bytes]]) -> None:
    for process in processes:
        if process.poll() is None:
            process.terminate()
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline and any(process.poll() is None for process in processes):
        time.sleep(0.1)
    for process in processes:
        if process.poll() is None:
            process.kill()


def run(args: argparse.Namespace) -> int:
    if not command_exists("npm"):
        print("Numdux needs npm to start the frontend. Install Node.js/npm, then run this again.", file=sys.stderr)
        return 1

    env = os.environ.copy()
    env["VITE_API_URL"] = f"http://{args.backend_host}:{args.backend_port}"

    backend_command = [
        sys.executable,
        "-m",
        "uvicorn",
        "backend.app.main:app",
        "--host",
        args.backend_host,
        "--port",
        str(args.backend_port),
    ]
    frontend_command = [
        "npm",
        "run",
        "dev",
        "--",
        "--host",
        args.frontend_host,
        "--port",
        str(args.frontend_port),
        "--strictPort",
    ]

    if args.reload:
        backend_command.append("--reload")

    processes: list[subprocess.Popen[bytes]] = []
    stopping = False

    def stop(_signum: int | None = None, _frame: object | None = None) -> None:
        nonlocal stopping
        if stopping:
            return
        stopping = True
        print("\nStopping Numdux...")
        terminate(processes)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    try:
        print(f"Starting Numdux backend on http://{args.backend_host}:{args.backend_port}")
        backend = start_process(backend_command, env=env)
        processes.append(backend)
        wait_for_port(args.backend_host, args.backend_port, backend, "backend")

        print(f"Starting Numdux app on http://{args.frontend_host}:{args.frontend_port}")
        frontend = start_process(frontend_command, env=env)
        processes.append(frontend)
        browser_host = "localhost" if args.frontend_host in {"0.0.0.0", "::"} else args.frontend_host
        url = f"http://{browser_host}:{args.frontend_port}"
        wait_for_port(browser_host, args.frontend_port, frontend, "frontend")

        print(f"\nNumdux is running: {url}")
        print("Press Ctrl+C to stop the backend and frontend.")
        if not args.no_browser:
            webbrowser.open(url)

        while True:
            for process in processes:
                if process.poll() is not None:
                    stop()
                    return process.returncode or 1
            time.sleep(0.5)
    except RuntimeError as exc:
        print(f"Numdux could not start: {exc}", file=sys.stderr)
        terminate(processes)
        return 1
    finally:
        terminate(processes)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="numdux", description="Run the Numdux notebook app.")
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="Start the backend and frontend together.")
    run_parser.add_argument("--backend-host", default="127.0.0.1", help="Backend host. Default: 127.0.0.1")
    run_parser.add_argument("--backend-port", type=int, default=8000, help="Backend port. Default: 8000")
    run_parser.add_argument("--frontend-host", default="0.0.0.0", help="Frontend host. Default: 0.0.0.0")
    run_parser.add_argument("--frontend-port", type=int, default=5173, help="Frontend port. Default: 5173")
    run_parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically.")
    run_parser.add_argument("--reload", action="store_true", help="Restart the backend when Python files change.")
    run_parser.set_defaults(func=run)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
