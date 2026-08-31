import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function realPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function isMainModule(moduleUrl: string, entry = process.argv[1]): boolean {
  if (!entry) {
    return false;
  }
  return realPath(fileURLToPath(moduleUrl)) === realPath(entry);
}
