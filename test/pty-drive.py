"""Drive the real Pi CLI in a sized PTY through a scripted expect/send sequence.

Each step waits for `expect` in the output produced after the previous step, then
writes `send`. Matching is plain substring matching on the rendered frames, which is
why the fixtures keep their expected strings short enough not to wrap at width 100.
"""

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
steps = json.loads(os.environ["PI_DRIVE_SCRIPT"])
deadline = time.monotonic() + float(os.environ.get("PI_DRIVE_TIMEOUT", "60"))
seen = b""
try:
    while True:
        if time.monotonic() >= deadline:
            os.killpg(pid, signal.SIGKILL)
            pending = steps[0]["expect"] if steps else "<exit>"
            sys.stderr.write("PI_DRIVE_TIMEOUT waiting for %r\n" % pending)
            break
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
        seen += data
        while steps and steps[0]["expect"].encode() in seen:
            step = steps.pop(0)
            seen = b""
            sys.stdout.buffer.write(("\nPI_DRIVE_MATCHED %s\n" % step["expect"]).encode())
            sys.stdout.buffer.flush()
            # The TUI needs a frame to settle before the next key is meaningful.
            time.sleep(float(step.get("settle", 0.4)))
            if step.get("send"):
                os.write(fd, step["send"].encode())
finally:
    os.close(fd)
    _, status = os.waitpid(pid, 0)

if steps:
    sys.stderr.write("PI_DRIVE_UNMATCHED %s\n" % json.dumps([s["expect"] for s in steps]))
    sys.exit(1)
sys.exit(os.waitstatus_to_exitcode(status))
