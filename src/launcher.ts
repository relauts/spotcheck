import { runStatusStep, STORY_COMPLETE, STORY_DOWNLOADING, STORY_REGISTERING } from "./banner.js";
import { readServicePort, readUiPort } from "./config-files.js";
import { ensureInstall, registerInstallationId } from "./install.js";
import { layoutFor } from "./paths.js";
import { startStack, stopStack, type SpawnedStack } from "./spawn.js";

export type { SpawnedStack };

export async function startSpotcheck(cwd = process.cwd()): Promise<SpawnedStack> {
  const layout = layoutFor(cwd);
  await runStatusStep(STORY_DOWNLOADING, () => ensureInstall(layout));
  try {
    await runStatusStep(STORY_REGISTERING, () => registerInstallationId(layout.serviceConfig));
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Could not register installation id (${detail}). Continuing.`);
  }
  const servicePort = readServicePort(layout.serviceConfig);
  const uiPort = readUiPort(layout.uiConfig);
  return runStatusStep(STORY_COMPLETE, () => startStack(layout, servicePort, uiPort));
}

export async function stopSpotcheck(stack: SpawnedStack | undefined): Promise<void> {
  await stopStack(stack);
}
