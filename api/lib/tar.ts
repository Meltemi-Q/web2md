import crypto from 'crypto';
import { gzipSync } from 'zlib';

export type TarEntry =
  | {
      type: 'file';
      path: string;
      content: Buffer;
      mode?: number;
      mtime?: number;
    }
  | {
      type: 'dir';
      path: string;
      mode?: number;
      mtime?: number;
    };

function toPosixPath(path: string): string {
  return (path || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function ensureTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

function writeString(buffer: Buffer, offset: number, length: number, value: string) {
  const str = (value || '').slice(0, length);
  buffer.write(str, offset, Math.min(length, Buffer.byteLength(str)), 'ascii');
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number) {
  const oct = Math.max(0, value).toString(8);
  const padded = oct.padStart(length - 1, '0');
  writeString(buffer, offset, length - 1, padded);
  buffer[offset + length - 1] = 0;
}

function splitTarPath(path: string): { name: string; prefix: string } {
  const normalized = toPosixPath(path);
  if (Buffer.byteLength(normalized) <= 100) {
    return { name: normalized, prefix: '' };
  }

  const idx = normalized.lastIndexOf('/');
  if (idx > 0) {
    const prefix = normalized.slice(0, idx);
    const name = normalized.slice(idx + 1);
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) {
      return { name, prefix };
    }
  }

  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return { name: `path_${hash}`, prefix: '' };
}

function createHeader(path: string, size: number, mode: number, mtime: number, typeflag: '0' | '5'): Buffer {
  const header = Buffer.alloc(512, 0);
  const { name, prefix } = splitTarPath(path);

  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0); // uid
  writeOctal(header, 116, 8, 0); // gid
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, mtime);

  // checksum placeholder (spaces)
  header.fill(0x20, 148, 156);
  header[156] = typeflag.charCodeAt(0);

  writeString(header, 257, 6, 'ustar');
  header[262] = 0;
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, 'root');
  writeString(header, 297, 32, 'root');
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeString(header, 345, 155, prefix);

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  const chk = sum.toString(8).padStart(6, '0');
  writeString(header, 148, 6, chk);
  header[154] = 0;
  header[155] = 0x20;

  return header;
}

function padTo512(buffer: Buffer): Buffer {
  const remainder = buffer.length % 512;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(512 - remainder, 0)]);
}

function addParentDirs(paths: string[]): TarEntry[] {
  const dirs = new Set<string>();
  for (const p of paths) {
    const normalized = toPosixPath(p);
    const parts = normalized.split('/').filter(Boolean);
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      dirs.add(ensureTrailingSlash(current));
    }
  }
  return Array.from(dirs)
    .sort()
    .map(d => ({ type: 'dir', path: d } as TarEntry));
}

export function createTar(entries: TarEntry[]): Buffer {
  const now = Math.floor(Date.now() / 1000);
  const normalizedEntries = entries
    .map(e => ({ ...e, path: toPosixPath(e.path) }))
    .filter(e => e.path);

  const filePaths = normalizedEntries.map(e => e.path);
  const dirEntries = addParentDirs(filePaths);

  const all = [...dirEntries, ...normalizedEntries];
  const parts: Buffer[] = [];

  for (const entry of all) {
    if (entry.type === 'dir') {
      const p = ensureTrailingSlash(entry.path);
      const mode = entry.mode ?? 0o755;
      const mtime = entry.mtime ?? now;
      parts.push(createHeader(p, 0, mode, mtime, '5'));
      continue;
    }

    const mode = entry.mode ?? 0o644;
    const mtime = entry.mtime ?? now;
    const content = entry.content ?? Buffer.alloc(0);
    parts.push(createHeader(entry.path, content.length, mode, mtime, '0'));
    parts.push(padTo512(content));
  }

  // End of archive: two 512-byte blocks of zeros
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

export function createTarGz(entries: TarEntry[]): Buffer {
  const tar = createTar(entries);
  return gzipSync(tar, { level: 9 });
}
