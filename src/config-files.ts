import fs from "node:fs";
import { DEFAULT_SERVICE_PORT, DEFAULT_UI_PORT } from "./paths.js";

function readJsonObject(filePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config file must be a JSON object: ${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

function readPositiveInt(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  if (value === undefined) {
    return fallback;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key} in config: "${String(value)}"`);
  }
  return parsed;
}

export function readServicePort(configPath: string): number {
  return readPositiveInt(readJsonObject(configPath), "port", DEFAULT_SERVICE_PORT);
}

export function readUiPort(configPath: string): number {
  return readPositiveInt(readJsonObject(configPath), "uiPort", DEFAULT_UI_PORT);
}
