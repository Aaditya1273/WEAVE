// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// zip.ts — minimal STORE-only (no compression) zip writer, so the publish
// approval flow can hand the human a real site bundle without adding a
// dependency. Store entries are fine here: the payload is small text files.
// ponytail: no compression; switch to CompressionStream + deflate-raw if
// bundle size ever matters.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(v: number): number[] { return [v & 0xff, (v >>> 8) & 0xff]; }
function u32(v: number): number[] { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

/** Build a zip archive (store method) from `path → text content`. */
export function buildZip(files: Map<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: number[] = [];
  const central: number[] = [];
  let offset = 0;

  for (const [path, content] of files) {
    const nameBytes = encoder.encode(path);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const localHeader = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), // sig, version, flags, method=store
      ...u16(0), ...u16(0),                                  // mod time/date (epoch — content is what matters)
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0),
    ];
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
      ...nameBytes,
    );
    chunks.push(...localHeader, ...nameBytes, ...data);
    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralOffset = offset;
  chunks.push(...central);
  chunks.push(
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.size), ...u16(files.size),
    ...u32(central.length), ...u32(centralOffset), ...u16(0),
  );
  return Uint8Array.from(chunks);
}
