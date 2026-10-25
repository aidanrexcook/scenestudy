// zip.js — minimal ZIP writer, store-only (no compression; the audio is
// already compressed). Used when the browser can't write a real folder.

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// entries: [{ path: 'folder/file.webm', blob }] → ZIP file as a Blob
export async function makeZip(entries) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { path, blob } of entries) {
    const data = new Uint8Array(await blob.arrayBuffer());
    const name = encoder.encode(path);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);  // local file header signature
    local.setUint16(4, 20, true);          // version needed
    local.setUint16(6, 0x0800, true);      // flags: UTF-8 names
    local.setUint16(8, 0, true);           // method: store
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(local, name, data);
    central.push({ name, crc, size: data.length, offset });
    offset += 30 + name.length + data.length;
  }

  let centralSize = 0;
  for (const e of central) {
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true);      // central directory signature
    h.setUint16(4, 20, true);              // version made by
    h.setUint16(6, 20, true);              // version needed
    h.setUint16(8, 0x0800, true);          // flags: UTF-8 names
    h.setUint32(16, e.crc, true);
    h.setUint32(20, e.size, true);
    h.setUint32(24, e.size, true);
    h.setUint16(28, e.name.length, true);
    h.setUint32(42, e.offset, true);
    parts.push(h, e.name);
    centralSize += 46 + e.name.length;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);      // end of central directory
  end.setUint16(8, central.length, true);
  end.setUint16(10, central.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  parts.push(end);

  return new Blob(parts, { type: 'application/zip' });
}
