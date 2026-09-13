"""Exercise terminal backpressure without contacting a model provider."""
import importlib.util
import os
import sys
from pathlib import Path
import tempfile
import unittest

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("live_harness", Path(__file__).resolve().parents[1] / "scripts/verify-native-live.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


class TerminalExitTest(unittest.TestCase):
    def test_normal_exit_drains_output_and_close_is_idempotent(self):
        with tempfile.TemporaryDirectory(prefix="omp-pty-test-") as directory:
            root = Path(directory)
            program = root / "fake-terminal"
            program.write_text("""#!/usr/bin/env python3
import os, tty
tty.setraw(0)
os.write(1, b'READY')
assert os.read(0, 1) == b'\\x04'
data = b'x' * (1024 * 1024)
while data:
    written = os.write(1, data)
    data = data[written:]
""")
            program.chmod(0o755)
            tui = harness.Tui(str(program), root, {"PATH": os.environ["PATH"], "TERM": "xterm-256color"}, root / "sessions", "")
            try:
                tui.wait(lambda: "READY" in tui.screen, "fake terminal ready", timeout=5)
                self.assertTrue(tui.stop(), "normal exit must not need a termination signal")
                self.assertEqual(tui.process.returncode, 0)
                with (root / "preserve-open-file").open("w") as stream:
                    self.assertTrue(tui.stop())
                    os.fstat(stream.fileno())
            finally:
                if tui.process.poll() is None:
                    tui.process.kill()
                    tui.process.wait(timeout=5)
                if not tui.closed:
                    os.close(tui.master)


if __name__ == "__main__":
    unittest.main()
