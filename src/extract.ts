import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BLOCK = 512;

function readCString(block: Buffer, start: number, length: number): string {
  const end = block.indexOf(0, start);
  const sliceEnd = end === -1 || end > start + length ? start + length : end;
  return block.subarray(start, sliceEnd).toString("utf8").trim();
}

function parseOctal(block: Buffer, start: number, length: number): number {
  const raw = readCString(block, start, length).replace(/^[0\s]+/, "") || "0";
  const parsed = Number.parseInt(raw, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeRelPath(entryName: string): string | undefined {
  const stripped = entryName.replace(/^package\//, "").replace(/\\/g, "/");
  if (!stripped || stripped.endsWith("/")) {
    return stripped.replace(/\/$/, "") || undefined;
  }
  const normalized = path.posix.normalize(stripped);
  if (normalized.startsWith("/") || normalized.startsWith("../") || normalized === "..") {
    return undefined;
  }
  return normalized;
}

/** Extract an `npm pack` tarball (`package/` prefix) into dest. */
export function extractNpmTarball(tgzPath: string, dest: string): void {
  const unzipped = zlib.gunzipSync(fs.readFileSync(tgzPath));
  let offset = 0;

  while (offset + BLOCK <= unzipped.length) {
    const header = unzipped.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = readCString(header, 0, 100);
    const size = parseOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const prefix = readCString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    offset += BLOCK;

    const dataEnd = offset + size;
    const data = unzipped.subarray(offset, dataEnd);
    offset += Math.ceil(size / BLOCK) * BLOCK;

    if (typeFlag === "g" || typeFlag === "x") {
      continue;
    }

    const relative = safeRelPath(fullName);
    if (!relative) {
      continue;
    }

    const target = path.join(dest, ...relative.split("/"));
    if (typeFlag === "5") {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }

    if (typeFlag === "0" || typeFlag === "\0") {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
  }
}
