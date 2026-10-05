"""Run the real Pi CLI in a sized PTY without terminal input or a model request."""

import errno
import fcntl
import json
import os
import select
import signal
import struct
import sys
import termios
import time

pid, fd = os.forkpty()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))
deadline = time.monotonic() + 20
pending = b""
expected = [text.encode() for text in json.loads(os.environ.get("PI_FIRST_PAINT_EXPECT", "[]"))]
first_frame = b""
try:
    while True:
        if time.monotonic() >= deadline:
            os.killpg(pid, signal.SIGKILL)
            raise TimeoutError("Pi CLI probe timed out")
        if not select.select([fd], [], [], 0.1)[0]:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            break
        if not data:
            break
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
        if expected:
            first_frame += data
            if b"FIRST_PAINT_RAW_OUTPUT" in first_frame:
                os.killpg(pid, signal.SIGKILL)
                raise AssertionError("Native tool output appeared before minimal first paint")
            if all(text in first_frame for text in expected):
                sys.stdout.buffer.write(b"\nFIRST_PAINT_VERIFIED\n")
                sys.stdout.buffer.flush()
                expected = []
                first_frame = b""
                os.write(fd, b"\x04")
        pending += data
        marker = b"PI_DISPLAY_PROBE_READY"
        while marker in pending:
            _, pending = pending.split(marker, 1)
            os.write(fd, b"/display-probe\r")
        pending = pending[-len(marker):]
finally:
    os.close(fd)
    _, status = os.waitpid(pid, 0)

sys.exit(os.waitstatus_to_exitcode(status))
