"""Run the real Pi CLI in a sized PTY, drain its output, and let it exit on its own.

The probe command is passed as the CLI's last argument, so Pi runs it at startup and the probe
shuts the process down when it is done. No terminal input is sent.
"""

import errno
import fcntl
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
deadline = time.monotonic() + float(os.environ.get("PI_COMPACTION_PTY_TIMEOUT", "90"))
try:
    while True:
        if time.monotonic() >= deadline:
            os.killpg(pid, signal.SIGKILL)
            sys.stdout.buffer.write(b"\nPI_COMPACTION_PTY_TIMEOUT\n")
            sys.stdout.buffer.flush()
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
finally:
    os.close(fd)
    _, status = os.waitpid(pid, 0)

sys.exit(os.waitstatus_to_exitcode(status))
