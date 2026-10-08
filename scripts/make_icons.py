import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
ROOT.mkdir(parents=True, exist_ok=True)
RGB = (139, 46, 34)


def png(width: int, height: int) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    rgba = bytes((*RGB, 255))
    raw = b"".join(b"\x00" + (rgba * width) for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def ico(image: bytes, width: int, height: int) -> bytes:
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", width if width < 256 else 0, height if height < 256 else 0, 0, 0, 1, 32, len(image), 22)
    return header + entry + image


def icns(images: list[tuple[bytes, bytes]]) -> bytes:
    chunks = b"".join(kind + struct.pack(">I", len(image) + 8) + image for kind, image in images)
    return b"icns" + struct.pack(">I", len(chunks) + 8) + chunks


png32 = png(32, 32)
png128 = png(128, 128)
(ROOT / "32x32.png").write_bytes(png32)
(ROOT / "128x128.png").write_bytes(png128)
(ROOT / "icon.ico").write_bytes(ico(png32, 32, 32))
(ROOT / "icon.icns").write_bytes(
    icns(
        [
            (b"icp4", png(16, 16)),
            (b"icp5", png32),
            (b"icp6", png(64, 64)),
            (b"ic07", png128),
            (b"ic08", png(256, 256)),
            (b"ic09", png(512, 512)),
            (b"ic10", png(1024, 1024)),
        ]
    )
)
print("icons written", ROOT)
