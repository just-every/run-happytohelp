"""Bound the exceptional system-library install and retain downloaded apt packages."""
import os
from pathlib import Path
import signal
import subprocess
import tempfile

archives = Path(os.environ["APT_ARCHIVES"])
if not archives.is_absolute() or any(c in str(archives) for c in '\n\r"\\'):
    raise SystemExit("APT_ARCHIVES must be an absolute apt cache path")
archives.mkdir(parents=True, exist_ok=True)
(archives / "partial").mkdir(exist_ok=True)

with tempfile.TemporaryDirectory(prefix="chromium-apt-") as directory:
    config = Path(directory) / "apt.conf"
    config.write_text(
        f'Dir::Cache::archives "{archives}";\n'
        'Acquire::Retries "1";\n'
        'Acquire::http::Timeout "30";\n'
        'Acquire::https::Timeout "30";\n'
        'Binary::apt::APT::Keep-Downloaded-Packages "true";\n'
        'APT::Keep-Downloaded-Packages "true";\n'
        # Hosted runner cleanup hooks must not discard the fallback cache.
        '#clear DPkg::Post-Invoke;\n'
        '#clear APT::Update::Post-Invoke;\n'
    )
    child = subprocess.Popen(
        ["pnpm", "exec", "playwright", "install-deps", "chromium"],
        env={**os.environ, "APT_CONFIG": str(config), "DEBIAN_FRONTEND": "noninteractive"},
        start_new_session=True,
    )
    try:
        raise SystemExit(child.wait(timeout=180))
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
        raise SystemExit("Chromium system-library fallback exceeded 180 seconds") from None
