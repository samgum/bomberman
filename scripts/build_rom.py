"""Rebuild the original NES program from its public disassembly and verify it."""
from pathlib import Path
import hashlib
import subprocess
import sys
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "vendor" / "bomberman-source"
with tempfile.TemporaryDirectory(prefix="bomberman-build-") as temporary:
    program_path = Path(temporary) / "bomber.prg"
    subprocess.run([sys.executable, str(SOURCE / "breakasm.py"), "BMAN.NAS", str(program_path)], cwd=SOURCE, check=True)
    program = program_path.read_bytes()[0xC000:]
    graphics = (SOURCE / "BOMBER.CHR").read_bytes()
    assert zlib.crc32(program) == 0xA913A222, "Program differs from original"
    assert zlib.crc32(graphics) == 0x1DB14E97, "Graphics differ from original"
    rom = (SOURCE / "NES_Header.bin").read_bytes() + program + graphics
    assert hashlib.sha256(rom).hexdigest() == "4e57f08754a2ff7ec788245629fb70f99d4e003f66f86742566bca99c810a244"
    target = ROOT / "game" / "bomberman.nes"
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(rom)
    print(f"Original NES image verified: {len(rom)} bytes")
