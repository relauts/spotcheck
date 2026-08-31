import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, it } from "node:test";
import { readServicePort, readUiPort } from "../src/config-files.js";
import { extractNpmTarball } from "../src/extract.js";
import {
  copyConfigIfMissing,
  copyTemplateConfigs,
  npmFileArgs,
  packageNeedsInstall,
  readPackageJson,
} from "../src/install.js";
import {
  layoutFor,
  SERVICE_CONFIG_NAME,
  SERVICE_DIR_NAME,
  UI_CONFIG_NAME,
  UI_DIR_NAME,
} from "../src/paths.js";

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spotcheck-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function ustarHeader(name: string, size: number, typeFlag: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "utf8");
  header.write("0000000\0", 108, 8, "utf8");
  header.write("0000000\0", 116, 8, "utf8");
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "utf8");
  header.write("00000000000\0", 136, 12, "utf8");
  header.write("        ", 148, 8, "utf8");
  header.write(typeFlag, 156, 1, "utf8");
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");
  let sum = 0;
  for (const byte of header) {
    sum += byte;
  }
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");
  return header;
}

function npmTarball(entries: Array<{ name: string; body?: string; dir?: boolean }>): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const relative = entry.name.startsWith("package/") ? entry.name : `package/${entry.name}`;
    if (entry.dir) {
      chunks.push(ustarHeader(relative.endsWith("/") ? relative : `${relative}/`, 0, "5"));
      continue;
    }
    const body = Buffer.from(entry.body ?? "", "utf8");
    chunks.push(ustarHeader(relative, body.length, "0"));
    chunks.push(body);
    const pad = (512 - (body.length % 512)) % 512;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

describe("layoutFor", () => {
  it("puts packages and configs in the cwd", () => {
    const cwd = "/tmp/my-spotcheck";
    const layout = layoutFor(cwd);
    assert.equal(layout.serviceDir, path.join(cwd, SERVICE_DIR_NAME));
    assert.equal(layout.uiDir, path.join(cwd, UI_DIR_NAME));
    assert.equal(layout.serviceConfig, path.join(cwd, SERVICE_CONFIG_NAME));
    assert.equal(layout.uiConfig, path.join(cwd, UI_CONFIG_NAME));
  });
});

describe("npmFileArgs", () => {
  it("runs npm through node on Windows so npm.cmd is not spawned", () => {
    const npm = npmFileArgs(["view", "pkg", "version"]);
    if (process.platform === "win32") {
      assert.equal(npm.command, process.execPath);
      assert.equal(npm.args[0], path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"));
      assert.deepEqual(npm.args.slice(1), ["view", "pkg", "version"]);
      return;
    }
    assert.deepEqual(npm, { command: "npm", args: ["view", "pkg", "version"] });
  });
});

describe("packageNeedsInstall", () => {
  it("installs when missing or version differs", () => {
    assert.equal(packageNeedsInstall(undefined, "@relauts/spotcheck-ui", "1.0.0"), true);
    assert.equal(
      packageNeedsInstall({ name: "@relauts/spotcheck-ui", version: "0.9.0" }, "@relauts/spotcheck-ui", "1.0.0"),
      true,
    );
    assert.equal(
      packageNeedsInstall({ name: "@relauts/spotcheck-ui", version: "1.0.0" }, "@relauts/spotcheck-ui", "1.0.0"),
      false,
    );
  });
});

describe("copyTemplateConfigs", () => {
  it("copies both templates into cwd with the same random apiToken", async () => {
    const cwd = tmpDir();
    await copyTemplateConfigs(layoutFor(cwd));
    const service = JSON.parse(fs.readFileSync(path.join(cwd, SERVICE_CONFIG_NAME), "utf8")) as {
      port?: number;
      apiToken?: string;
      installationId?: string;
    };
    const ui = JSON.parse(fs.readFileSync(path.join(cwd, UI_CONFIG_NAME), "utf8")) as {
      uiPort?: number;
      apiToken?: string;
      installationId?: string;
    };
    assert.equal(service.port, 18732);
    assert.equal(ui.uiPort, 18733);
    assert.ok(service.apiToken && service.apiToken.length >= 16);
    assert.equal(service.apiToken, ui.apiToken);
    assert.ok(service.installationId && service.installationId.length >= 16);
    assert.notEqual(service.installationId, service.apiToken);
    assert.equal(ui.installationId, undefined);
  });

  it("reuses an existing token when only one config is missing", async () => {
    const cwd = tmpDir();
    const layout = layoutFor(cwd);
    fs.writeFileSync(layout.serviceConfig, JSON.stringify({ port: 18732, apiToken: "keep-me" }));
    await copyTemplateConfigs(layout);
    const ui = JSON.parse(fs.readFileSync(layout.uiConfig, "utf8")) as { apiToken?: string };
    const service = JSON.parse(fs.readFileSync(layout.serviceConfig, "utf8")) as {
      apiToken?: string;
      installationId?: string;
    };
    assert.equal(ui.apiToken, "keep-me");
    assert.equal(service.apiToken, "keep-me");
    assert.ok(service.installationId && service.installationId.length >= 16);
  });

  it("keeps an existing installationId", async () => {
    const cwd = tmpDir();
    const layout = layoutFor(cwd);
    fs.writeFileSync(
      layout.serviceConfig,
      JSON.stringify({ port: 18732, apiToken: "keep-me", installationId: "already-set" }),
    );
    await copyTemplateConfigs(layout);
    const service = JSON.parse(fs.readFileSync(layout.serviceConfig, "utf8")) as {
      installationId?: string;
    };
    assert.equal(service.installationId, "already-set");
  });
});

describe("copyConfigIfMissing", () => {
  it("copies once and keeps later edits", async () => {
    const dir = tmpDir();
    const from = path.join(dir, "src.json");
    const to = path.join(dir, "out.json");
    fs.writeFileSync(from, '{"a":1}');
    assert.equal(await copyConfigIfMissing(from, to), true);
    assert.equal(fs.readFileSync(to, "utf8"), '{"a":1}');
    fs.writeFileSync(to, '{"a":2}');
    assert.equal(await copyConfigIfMissing(from, to), false);
    assert.equal(fs.readFileSync(to, "utf8"), '{"a":2}');
  });
});

describe("readPackageJson", () => {
  it("reads name and version", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.2.3" }));
    assert.deepEqual(await readPackageJson(dir), { name: "x", version: "1.2.3" });
  });
});

describe("extractNpmTarball", () => {
  it("strips the package/ prefix", () => {
    const dir = tmpDir();
    const tgz = path.join(dir, "pkg.tgz");
    fs.writeFileSync(tgz, npmTarball([{ name: "hello.txt", body: "hi" }]));
    const dest = path.join(dir, "out");
    fs.mkdirSync(dest);
    extractNpmTarball(tgz, dest);
    assert.equal(fs.readFileSync(path.join(dest, "hello.txt"), "utf8"), "hi");
  });
});

describe("config ports", () => {
  it("reads port fields with defaults", () => {
    const dir = tmpDir();
    const service = path.join(dir, "service.json");
    const ui = path.join(dir, "ui.json");
    fs.writeFileSync(service, JSON.stringify({ port: 19000 }));
    fs.writeFileSync(ui, JSON.stringify({ uiPort: 19001 }));
    assert.equal(readServicePort(service), 19000);
    assert.equal(readUiPort(ui), 19001);
    fs.writeFileSync(service, "{}");
    fs.writeFileSync(ui, "{}");
    assert.equal(readServicePort(service), 18732);
    assert.equal(readUiPort(ui), 18733);
  });
});
