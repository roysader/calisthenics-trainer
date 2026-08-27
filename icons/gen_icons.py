import struct, zlib, os

def make_png(path, size, bg=(26, 26, 46), fg=(255, 209, 102)):
    w = h = size
    bar_h = max(2, size // 10)
    cy = h // 2
    knob = max(4, size // 6)
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            on_bar = abs(y - cy) <= bar_h // 2 and knob <= x <= w - knob
            on_knob_l = knob * 0.4 <= x <= knob * 1.4 and abs(y - cy) <= knob
            on_knob_r = (w - knob * 1.4) <= x <= (w - knob * 0.4) and abs(y - cy) <= knob
            if on_bar or on_knob_l or on_knob_r:
                r, g, b = fg
            else:
                r, g, b = bg
            row += bytes((r, g, b))
        rows.append(bytes([0]) + bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)

base = os.path.dirname(__file__)
make_png(os.path.join(base, "icon-192.png"), 192)
make_png(os.path.join(base, "icon-512.png"), 512)
make_png(os.path.join(base, "apple-touch-icon.png"), 180)
print("done")
