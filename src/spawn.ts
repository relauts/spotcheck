import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { InstallLayout } from "./paths.js";

const READY_TIMEOUT_MS = 120_000;
const KILL_WAIT_MS = 5_000;

export interface SpawnedStack {
  readonly layout: InstallLayout;
  readonly service: ChildProcess;
  readonly ui: ChildProcess;
  readonly serviceUrl: string;
  readonly uiUrl: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForHttp(url: string, timeoutMs = READY_TIMEOUT_MS): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error: unknown) {
      lastError = error;
    }
    await sleep(250);
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Timed out waiting for ${url} (${detail})`);
}

export function startNodeEntry(entry: string, cwd: string): ChildProcess {
  const child = spawn(process.execPath, [entry], {
    cwd,
    stdio: ["ignore", "ignore", "inherit"],
    env: process.env,
  });
  child.on("error", (error: Error) => {
    console.error(`Failed to start ${entry}`, error);
  });
  return child;
}

export async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.signalCode) {
        child.kill("SIGKILL");
      }
    }, KILL_WAIT_MS);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    child.kill("SIGTERM");
  });
}

export async function startService(
  layout: InstallLayout,
  servicePort: number,
): Promise<{ service: ChildProcess; serviceUrl: string }> {
  const serviceEntry = path.join(layout.serviceDir, "dist", "api", "server.js");
  const service = startNodeEntry(serviceEntry, layout.cwd);
  const serviceUrl = `http://127.0.0.1:${servicePort}`;
  try {
    await waitForHttp(`${serviceUrl}/v1/health`);
  } catch (error: unknown) {
    await stopChild(service);
    throw error;
  }
  return { service, serviceUrl };
}

export async function startUi(
  layout: InstallLayout,
  uiPort: number,
): Promise<{ ui: ChildProcess; uiUrl: string }> {
  const uiEntry = path.join(layout.uiDir, "dist", "server.js");
  const ui = startNodeEntry(uiEntry, layout.cwd);
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  try {
    await waitForHttp(uiUrl);
  } catch (error: unknown) {
    await stopChild(ui);
    throw error;
  }
  return { ui, uiUrl };
}

export async function startStack(
  layout: InstallLayout,
  servicePort: number,
  uiPort: number,
): Promise<SpawnedStack> {
  const { service, serviceUrl } = await startService(layout, servicePort);
  try {
    const { ui, uiUrl } = await startUi(layout, uiPort);
    return { layout, service, ui, serviceUrl, uiUrl };
  } catch (error: unknown) {
    await stopChild(service);
    throw error;
  }
}

export async function stopStack(stack: SpawnedStack | undefined): Promise<void> {
  if (!stack) {
    return;
  }
  await stopChild(stack.ui);
  await stopChild(stack.service);
}
