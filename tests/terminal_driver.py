import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

pid, terminal = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])

fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 100, 0, 0))
signal.signal(signal.SIGTERM, lambda *_: os.kill(pid, signal.SIGTERM))
try:
    while True:
        ready, _, _ = select.select([sys.stdin.fileno(), terminal], [], [])
        for source in ready:
            try:
                data = os.read(source, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                data = b""
            if not data:
                raise EOFError
            if source == terminal:
                os.write(sys.stdout.fileno(), data)
            else:
                os.write(terminal, data)
except EOFError:
    pass
finally:
    os.close(terminal)
    _, status = os.waitpid(pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status))
