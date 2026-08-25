// Streaming UTF-8 decoder with a fallback for runtimes without TextDecoder.
// Keeps incomplete multi-byte sequences (common with Chinese text) across chunks.
export class Utf8StreamDecoder {
  private td: TextDecoder | null =
    typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
  private carry: number[] = [];

  decode(chunk: Uint8Array): string {
    if (this.td) return this.td.decode(chunk, { stream: true });

    const bytes = this.carry.length ? [...this.carry, ...chunk] : [...chunk];
    this.carry = [];
    let end = bytes.length;
    for (let i = Math.max(0, bytes.length - 4); i < bytes.length; i++) {
      const b = bytes[i];
      const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 0;
      if (need > 0 && i + need > bytes.length) {
        end = i;
        break;
      }
    }
    this.carry = bytes.slice(end);
    return utf8ToString(bytes.slice(0, end));
  }
}

function utf8ToString(bytes: number[]): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp: number;
    if (b < 0x80) {
      cp = b;
      i += 1;
    } else if (b < 0xe0) {
      cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if (b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      i += 4;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}
