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
from typing import Literal

from .paths import APP_ROOT, FRONTEND_DIR

PortStatus = Literal["open", "closed", "unknown"]
DEFAULT_BACKEND_PORT = 8000
DEFAULT_FRONTEND_PORT = 5173


def port_status(host: str, port: int) -> PortStatus:
    try:
        with socket.create_connection((host, port), timeout=0.25):
            return "open"
    except PermissionError:
        return "unknown"
    except OSError:
        return "closed"


def connect_host(host: str) -> str:
    return "127.0.0.1" if host in {"0.0.0.0", "::"} else host


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


def find_available_port(host: str, preferred_port: int) -> int:
    for port in range(preferred_port, preferred_port + 100):
        status = port_status(host, port)
        if status == "closed":
            return port
        if status == "unknown":
            return preferred_port
    raise RuntimeError(f"No available port found on {host} from {preferred_port} to {preferred_port + 99}.")


def start_process(command: list[str], *, env: dict[str, str] | None = None) -> subprocess.Popen[bytes]:
    return subprocess.Popen(command, cwd=APP_ROOT, env=env)


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
    has_compiled_frontend = FRONTEND_DIR.exists() and (FRONTEND_DIR / "index.html").exists()
    dev_mode = args.dev or not has_compiled_frontend
    backend_probe_host = connect_host(args.backend_host)
    backend_port = args.backend_port or find_available_port(backend_probe_host, DEFAULT_BACKEND_PORT)
    frontend_port = args.frontend_port or DEFAULT_FRONTEND_PORT
    if args.backend_port is None and backend_port != DEFAULT_BACKEND_PORT:
        print(f"[INFO] Backend port {DEFAULT_BACKEND_PORT} is busy. Using {backend_port} instead.")

    if dev_mode:
        if not command_exists("npm"):
            if args.dev:
                print("Numdux needs npm to start the frontend in dev mode. Install Node.js/npm, then run this again.", file=sys.stderr)
            else:
                print("Compiled frontend not found. Attempting to start in dev mode, but npm is not installed.\n"
                      "Please build the frontend using 'npm run build' or install Node.js/npm to run in dev mode.", file=sys.stderr)
            return 1
        if not (APP_ROOT / "package.json").exists():
            print(
                "Numdux dev mode needs a source checkout with package.json. "
                "Run from the project folder or use the packaged frontend without --dev.",
                file=sys.stderr,
            )
            return 1
        frontend_probe_host = connect_host(args.frontend_host)
        frontend_port = args.frontend_port or find_available_port(frontend_probe_host, DEFAULT_FRONTEND_PORT)
        if args.frontend_port is None and frontend_port != DEFAULT_FRONTEND_PORT:
            print(f"[INFO] Frontend port {DEFAULT_FRONTEND_PORT} is busy. Using {frontend_port} instead.")

    env = os.environ.copy()
    env["VITE_API_URL"] = f"http://{args.backend_host}:{backend_port}"
    env.setdefault("NUMDUX_HOME", str(APP_ROOT))

    backend_command = [
        sys.executable,
        "-m",
        "uvicorn",
        "backend.app.main:app",
        "--host",
        args.backend_host,
        "--port",
        str(backend_port),
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
        print(f"Starting Numdux backend on http://{args.backend_host}:{backend_port}")
        print(f"Using Numdux workspace: {APP_ROOT}")
        backend = start_process(backend_command, env=env)
        processes.append(backend)
        wait_for_port(backend_probe_host, backend_port, backend, "backend")

        if dev_mode:
            frontend_command = [
                "npm",
                "run",
                "dev",
                "--",
                "--host",
                args.frontend_host,
                "--port",
                str(frontend_port),
                "--strictPort",
            ]
            print(f"Starting Numdux app on http://{args.frontend_host}:{frontend_port}")
            frontend = start_process(frontend_command, env=env)
            processes.append(frontend)
            browser_host = "localhost" if args.frontend_host in {"0.0.0.0", "::"} else args.frontend_host
            url = f"http://{browser_host}:{frontend_port}"
            wait_for_port(browser_host, frontend_port, frontend, "frontend")
        else:
            browser_host = "localhost" if args.backend_host in {"0.0.0.0", "::"} else args.backend_host
            url = f"http://{browser_host}:{backend_port}"

        print(f"\nNumdux is running: {url}")
        print("Press Ctrl+C to stop.")
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
    run_parser.add_argument("--backend-port", type=int, default=None, help="Backend port. Default: first available from 8000")
    run_parser.add_argument("--frontend-host", default="0.0.0.0", help="Frontend host. Default: 0.0.0.0")
    run_parser.add_argument("--frontend-port", type=int, default=None, help="Frontend port in dev mode. Default: first available from 5173")
    run_parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically.")
    run_parser.add_argument("--reload", action="store_true", help="Restart the backend when Python files change.")
    run_parser.add_argument("--dev", action="store_true", help="Run in development mode (starts Vite dev server).")
    run_parser.set_defaults(func=run)

    return parser


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    
    # If no subcommand is specified, and the first argument isn't help or another known flag,
    # default to "run"
    if not argv:
        argv = ["run"]
    elif argv[0] not in ("run", "-h", "--help") and not any(arg in ("-h", "--help") for arg in argv):
        argv = ["run"] + argv

    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
