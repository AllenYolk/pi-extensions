#!/usr/bin/env python3
"""Show what this terminal actually sends for a key, with the kitty keyboard
protocol enabled the way pi enables it.

Run it, press the key you want to check, then press q to quit.
"""
import sys, termios, tty, select

MODS = [(1, "shift"), (2, "alt"), (4, "ctrl"), (8, "cmd/super")]


def describe(data: bytes) -> str:
    if data.startswith(b"\x1b[") and data.endswith(b"u"):
        body = data[2:-1].decode("latin1")
        code, _, mods = body.partition(";")
        if not code.isdigit():
            return ""
        base = mods.split(":")[0]
        bits = (int(base) - 1) if base.isdigit() else 0
        names = [n for b, n in MODS if bits & b]
        try:
            key = chr(int(code))
        except ValueError:
            return ""
        return "+".join([*names, key])
    if len(data) == 1 and 0 < data[0] < 32:
        return f"ctrl+{chr(data[0] + 96)}  (no kitty protocol: shift is invisible here)"
    return ""


def main() -> None:
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    sys.stdout.write("\x1b[>1u")  # request the kitty keyboard protocol, as pi does
    sys.stdout.flush()
    try:
        tty.setraw(fd)
        sys.stdout.write("Press keys to inspect them. Press q to quit.\r\n")
        sys.stdout.flush()
        while True:
            if not select.select([fd], [], [], 0.05)[0]:
                continue
            data = sys.stdin.buffer.raw.read(64)
            if not data or data == b"q":
                break
            sys.stdout.write(f"  hex={data.hex():<26} {describe(data)}\r\n")
            sys.stdout.flush()
    finally:
        sys.stdout.write("\x1b[<u")
        sys.stdout.flush()
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        print("\ndone")


main()
