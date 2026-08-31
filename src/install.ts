import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { extractNpmTarball } from "./extract.js";
import { SERVICE_PACKAGE, UI_PACKAGE, templatesDir, type InstallLayout } from "./paths.js";

const execFileAsync = promisify(execFile);

function runQuiet(command: string, args: readonly string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const append = (chunk: Buffer | string): void => {
      output += String(chunk);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = output.trim();
      const suffix = detail ? `\n${detail}` : "";
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}${suffix}`));
    });
  });
}

export interface PackageJsonFields {
  readonly name?: string;
  readonly version?: string;
}

export function packageNeedsInstall(
  pkg: PackageJsonFields | undefined,
  name: string,
  version: string,
): boolean {
  return pkg?.name !== name || pkg?.version !== version;
}

export async function readPackageJson(dir: string): Promise<PackageJsonFields | undefined> {
  try {
    const raw = await fs.readFile(path.join(dir, "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    return {
      name: typeof record.name === "string" ? record.name : undefined,
      version: typeof record.version === "string" ? record.version : undefined,
    };
  } catch {
    return undefined;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function createApiToken(): string {
  return randomBytes(24).toString("base64url");
}

export function createInstallationId(): string {
  return randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readNonEmptyString(filePath: string, key: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!isRecord(parsed) || typeof parsed[key] !== "string") {
      return undefined;
    }
    const value = parsed[key].trim();
    return value ? value : undefined;
  } catch {
    return undefined;
  }
}

async function readApiToken(filePath: string): Promise<string | undefined> {
  return readNonEmptyString(filePath, "apiToken");
}

async function writeJsonObject(filePath: string, parsed: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

async function writeConfigWithToken(
  from: string,
  to: string,
  apiToken: string,
  installationId?: string,
): Promise<void> {
  const parsed: unknown = JSON.parse(await fs.readFile(from, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`Config template must be a JSON object: ${from}`);
  }
  parsed.apiToken = apiToken;
  if (installationId) {
    parsed.installationId = installationId;
  }
  await writeJsonObject(to, parsed);
}

async function readInstallationId(filePath: string): Promise<string | undefined> {
  const value = await readNonEmptyString(filePath, "installationId");
  return value && isUuid(value) ? value : undefined;
}

async function ensureInstallationId(filePath: string, installationId: string): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!isRecord(parsed)) {
      return;
    }
    if (typeof parsed.installationId === "string" && isUuid(parsed.installationId.trim())) {
      return;
    }
    parsed.installationId = installationId;
    await writeJsonObject(filePath, parsed);
  } catch {
    return;
  }
}

export async function copyConfigIfMissing(from: string, to: string): Promise<boolean> {
  if (await fileExists(to)) {
    return false;
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  return true;
}

export function npmFileArgs(args: readonly string[]): { command: string; args: string[] } {
  if (process.platform === "win32") {
    const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    return { command: process.execPath, args: [npmCli, ...args] };
  }
  return { command: "npm", args: [...args] };
}

async function npmPack(spec: string, destDir: string): Promise<string> {
  const npm = npmFileArgs(["pack", spec, "--pack-destination", destDir]);
  const { stdout } = await execFileAsync(npm.command, npm.args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const fileName = stdout.trim().split(/\r?\n/).pop();
  if (!fileName) {
    throw new Error(`npm pack produced no tarball for ${spec}`);
  }
  return path.join(destDir, path.basename(fileName));
}

async function npmInstall(dir: string): Promise<void> {
  const npm = npmFileArgs(["install", "--omit=dev"]);
  await runQuiet(npm.command, npm.args, dir);
}

async function installPlaywrightChromium(serviceDir: string): Promise<void> {
  const cli = path.join(serviceDir, "node_modules", "playwright", "cli.js");
  try {
    await fs.access(cli);
  } catch {
    return;
  }
  await runQuiet(process.execPath, [cli, "install", "chromium"], serviceDir);
}

async function installNpmPackage(spec: string, dest: string, withPlaywright: boolean): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "spotcheck-pack-"));
  try {
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(dest, { recursive: true });
    const tgz = await npmPack(spec, tmp);
    extractNpmTarball(tgz, dest);
    await npmInstall(dest);
    if (withPlaywright) {
      await installPlaywrightChromium(dest);
    }
  } catch (error: unknown) {
    await fs.rm(dest, { recursive: true, force: true });
    throw error;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function npmLatestVersion(name: string): Promise<string> {
  const npm = npmFileArgs(["view", name, "version"]);
  const { stdout } = await execFileAsync(npm.command, npm.args, {
    encoding: "utf8",
  });
  const version = stdout.trim();
  if (!version) {
    throw new Error(`npm view produced no version for ${name}`);
  }
  return version;
}

async function ensurePackage(dest: string, name: string, withPlaywright: boolean): Promise<void> {
  const latest = await npmLatestVersion(name);
  const current = await readPackageJson(dest);
  if (!packageNeedsInstall(current, name, latest)) {
    return;
  }

  await installNpmPackage(`${name}@${latest}`, dest, withPlaywright);
}

export async function copyTemplateConfigs(layout: InstallLayout, fromUrl = import.meta.url): Promise<void> {
  const templates = templatesDir(fromUrl);
  const serviceTemplate = path.join(templates, path.basename(layout.serviceConfig));
  const uiTemplate = path.join(templates, path.basename(layout.uiConfig));
  const apiToken =
    (await readApiToken(layout.serviceConfig)) ??
    (await readApiToken(layout.uiConfig)) ??
    createApiToken();
  const installationId = (await readInstallationId(layout.serviceConfig)) ?? createInstallationId();

  if (!(await fileExists(layout.serviceConfig))) {
    await writeConfigWithToken(serviceTemplate, layout.serviceConfig, apiToken, installationId);
  } else {
    await ensureInstallationId(layout.serviceConfig, installationId);
  }

  if (!(await fileExists(layout.uiConfig))) {
    await writeConfigWithToken(uiTemplate, layout.uiConfig, apiToken);
  }
}

export async function ensureInstall(layout: InstallLayout): Promise<void> {
  await copyTemplateConfigs(layout);
  await ensurePackage(layout.serviceDir, SERVICE_PACKAGE, true);
  await ensurePackage(layout.uiDir, UI_PACKAGE, false);
}
