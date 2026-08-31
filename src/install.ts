import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
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

export function createApiToken(): string {
  return randomBytes(24).toString("base64url");
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

async function readApiToken(filePath: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!isRecord(parsed) || typeof parsed.apiToken !== "string") {
      return undefined;
    }
    const token = parsed.apiToken.trim();
    return token ? token : undefined;
  } catch {
    return undefined;
  }
}

async function writeConfigWithToken(from: string, to: string, apiToken: string): Promise<void> {
  const parsed: unknown = JSON.parse(await fs.readFile(from, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`Config template must be a JSON object: ${from}`);
  }
  parsed.apiToken = apiToken;
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.writeFile(to, `${JSON.stringify(parsed, null, 2)}\n`);
}

export async function copyConfigIfMissing(from: string, to: string): Promise<boolean> {
  if (await fileExists(to)) {
    return false;
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  return true;
}

function npmBin(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function npmPack(spec: string, destDir: string): Promise<string> {
  const { stdout } = await execFileAsync(npmBin(), ["pack", spec, "--pack-destination", destDir], {
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
  await runQuiet(npmBin(), ["install", "--omit=dev"], dir);
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
  const { stdout } = await execFileAsync(npmBin(), ["view", name, "version"], {
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

  if (!(await fileExists(layout.serviceConfig))) {
    await writeConfigWithToken(serviceTemplate, layout.serviceConfig, apiToken);
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
