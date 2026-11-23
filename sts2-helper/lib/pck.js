// Minimal reader for Godot 4 .pck files (the game's asset pack), used to pull card/relic text
// and images from the player's own install. Reads the file table, then individual files on
// demand; nothing is copied into the repo.
const fs = require('fs');

const PACK_DIR_ENCRYPTED = 1;
const PACK_REL_FILEBASE = 2;

function readIndex(pckPath) {
  const fd = fs.openSync(pckPath, 'r');
  const head = Buffer.alloc(4096);
  fs.readSync(fd, head, 0, head.length, 0);
  if (head.toString('latin1', 0, 4) !== 'GDPC') throw new Error('Not a Godot pack: ' + pckPath);
  const formatVersion = head.readUInt32LE(4);
  const godot = [head.readUInt32LE(8), head.readUInt32LE(12), head.readUInt32LE(16)];
  let off = 20;
  let flags = 0, fileBase = 0n, dirOffset = null;
  if (formatVersion >= 2) {
    flags = head.readUInt32LE(off); off += 4;
    fileBase = head.readBigUInt64LE(off); off += 8;
    if (formatVersion >= 3) { dirOffset = head.readBigUInt64LE(off); off += 8; }
  }
  if (flags & PACK_DIR_ENCRYPTED) throw new Error('The pack directory is encrypted');
  off += 16 * 4; // reserved
  let pos = dirOffset != null ? Number(dirOffset) : off;
  const read = (n) => { const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, pos); pos += n; return b; };
  const count = read(4).readUInt32LE(0);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const len = read(4).readUInt32LE(0);
    const name = read(len).toString('utf8').replace(/\0+$/, '');
    const meta = read(8 + 8 + 16 + 4);
    const offset = meta.readBigUInt64LE(0);
    const size = Number(meta.readBigUInt64LE(8));
    const fflags = meta.readUInt32LE(32);
    const abs = flags & PACK_REL_FILEBASE ? fileBase + offset : offset;
    files.set(name.replace(/^res:\/\//, ''), { offset: Number(abs), size, encrypted: !!(fflags & 1) });
  }
  return { fd, formatVersion, godot, flags, files };
}

function readFile(pack, name) {
  const f = pack.files.get(name);
  if (!f) return null;
  if (f.encrypted) throw new Error('Encrypted file: ' + name);
  const b = Buffer.alloc(f.size);
  fs.readSync(pack.fd, b, 0, f.size, f.offset);
  return b;
}

module.exports = { readIndex, readFile };
