"""Regenerate a raster-only PDF: python generate-ocr-smoke.py --font /path/to/font.ttf."""
import argparse
import pathlib
import zlib

from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--font", required=True)
args = parser.parse_args()

width, height = 1600, 240
image = Image.new("L", (width, height), 255)
draw = ImageDraw.Draw(image)
font = ImageFont.truetype(args.font, 88)
text = "DOCUMENT OCR CHECK 12345"
box = draw.textbbox((0, 0), text, font=font)
draw.text(((width - box[2] + box[0]) / 2 - box[0],
           (height - box[3] + box[1]) / 2 - box[1]), text, font=font, fill=0)

pixels = zlib.compress(image.tobytes(), level=9)
content = b"q 576 0 0 86.4 0 0 cm /Im1 Do Q\n"
objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 576 86.4] "
    b"/Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
    b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"endstream",
    f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} "
    f"/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode "
    f"/Length {len(pixels)} >>\nstream\n".encode() + pixels + b"\nendstream",
]
pdf = bytearray(b"%PDF-1.4\n%GlyphMend raster OCR smoke\n")
offsets = []
for number, obj in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
xref = len(pdf)
pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode() + b"0000000000 65535 f \n")
for offset in offsets:
    pdf.extend(f"{offset:010} 00000 n \n".encode())
pdf.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
           f"startxref\n{xref}\n%%EOF\n".encode())
output = pathlib.Path(__file__).with_name("ocr-smoke.pdf")
output.write_bytes(pdf)
print(f"Wrote {output.name}: {len(pdf)} bytes, raster only, no font or text objects.")
