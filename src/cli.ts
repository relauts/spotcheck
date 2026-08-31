#!/usr/bin/env node

import { printGetStarted, printTitle } from "./banner.js";
import { startSpotcheck, stopSpotcheck, type SpawnedStack } from "./launcher.js";
import { isMainModule } from "./main-module.js";

let active: SpawnedStack | undefined;
let shuttingDown = false;

async function shutdown(exitCode: number, reason: string): Promise<never> {
  if (shuttingDown) {
    process.exit(exitCode);
  }
  shuttingDown = true;
  console.info(reason);
  try {
    await stopSpotcheck(active);
  } catch (error: unknown) {
    console.error("Shutdown error", error);
  }
  active = undefined;
  process.exit(exitCode);
}

function registerShutdownHandlers(): void {
  const onSignal = (signal: NodeJS.Signals): void => {
    void shutdown(0, `Received ${signal}, shutting down`);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
}

export async function main(cwd = process.cwd()): Promise<SpawnedStack> {
  registerShutdownHandlers();
  printTitle();
  const stack = await startSpotcheck(cwd);
  active = stack;
  const onChildExit = (name: string) => (code: number | null, signal: NodeJS.Signals | null): void => {
    if (shuttingDown) {
      return;
    }
    void shutdown(1, `${name} exited (${code ?? signal ?? "unknown"})`);
  };
  stack.service.once("exit", onChildExit("Service"));
  stack.ui.once("exit", onChildExit("UI"));
  printGetStarted(stack.uiUrl);
  return stack;
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error("Fatal error", error);
    void shutdown(1, "Exiting after fatal error");
  });
}
