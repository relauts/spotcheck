import {
  runStatusStep,
  STORY_ALREADY_REGISTERED,
  STORY_DOWNLOADING_SERVICE,
  STORY_DOWNLOADING_UI,
  STORY_INSTALLING_CHROMIUM,
  STORY_INSTALLING_SERVICE,
  STORY_INSTALLING_UI,
  STORY_PREPARING_CONFIG,
  STORY_REGISTERING,
  STORY_SERVICE_UP_TO_DATE,
  STORY_STARTING_SERVICE,
  STORY_STARTING_UI,
  STORY_UI_UP_TO_DATE,
} from "./banner.js";
import { readServicePort, readUiPort } from "./config-files.js";
import {
  copyTemplateConfigs,
  downloadNpmPackage,
  installNpmDependencies,
  installPlaywrightChromium,
  npmLatestVersion,
  packageNeedsInstall,
  readPackageJson,
  registerInstallationId,
  removePackageDir,
} from "./install.js";
import { layoutFor, SERVICE_PACKAGE, UI_PACKAGE, type InstallLayout } from "./paths.js";
import { startService, startUi, stopChild, stopStack, type SpawnedStack } from "./spawn.js";

export type { SpawnedStack };

type PackageAction = { action: "skip" } | { action: "install" };

async function planAndDownload(
  dest: string,
  name: string,
): Promise<PackageAction> {
  const latest = await npmLatestVersion(name);
  const current = await readPackageJson(dest);
  if (!packageNeedsInstall(current, name, latest)) {
    return { action: "skip" };
  }
  await downloadNpmPackage(`${name}@${latest}`, dest);
  return { action: "install" };
}

async function finishPackageInstall(
  dest: string,
  installLabel: string,
  extra?: { label: string; work: () => Promise<void> },
): Promise<void> {
  try {
    await runStatusStep(installLabel, () => installNpmDependencies(dest));
    if (extra) {
      await runStatusStep(extra.label, extra.work);
    }
  } catch (error: unknown) {
    await removePackageDir(dest);
    throw error;
  }
}

async function ensureService(layout: InstallLayout): Promise<void> {
  const plan = await runStatusStep(
    STORY_DOWNLOADING_SERVICE,
    () => planAndDownload(layout.serviceDir, SERVICE_PACKAGE),
    process.stdout,
    (result) => (result.action === "skip" ? STORY_SERVICE_UP_TO_DATE : STORY_DOWNLOADING_SERVICE),
  );
  if (plan.action === "skip") {
    return;
  }
  await finishPackageInstall(layout.serviceDir, STORY_INSTALLING_SERVICE, {
    label: STORY_INSTALLING_CHROMIUM,
    work: () => installPlaywrightChromium(layout.serviceDir),
  });
}

async function ensureUi(layout: InstallLayout): Promise<void> {
  const plan = await runStatusStep(
    STORY_DOWNLOADING_UI,
    () => planAndDownload(layout.uiDir, UI_PACKAGE),
    process.stdout,
    (result) => (result.action === "skip" ? STORY_UI_UP_TO_DATE : STORY_DOWNLOADING_UI),
  );
  if (plan.action === "skip") {
    return;
  }
  await finishPackageInstall(layout.uiDir, STORY_INSTALLING_UI);
}

export async function startSpotcheck(cwd = process.cwd()): Promise<SpawnedStack> {
  const layout = layoutFor(cwd);
  await runStatusStep(STORY_PREPARING_CONFIG, () => copyTemplateConfigs(layout));
  await ensureService(layout);
  await ensureUi(layout);
  try {
    await runStatusStep(
      STORY_REGISTERING,
      () => registerInstallationId(layout.serviceConfig),
      process.stdout,
      (wrote) => (wrote ? STORY_REGISTERING : STORY_ALREADY_REGISTERED),
    );
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Could not register installation id (${detail}). Continuing.`);
  }
  const servicePort = readServicePort(layout.serviceConfig);
  const uiPort = readUiPort(layout.uiConfig);
  const { service, serviceUrl } = await runStatusStep(STORY_STARTING_SERVICE, () =>
    startService(layout, servicePort),
  );
  try {
    const { ui, uiUrl } = await runStatusStep(STORY_STARTING_UI, () => startUi(layout, uiPort));
    return { layout, service, ui, serviceUrl, uiUrl };
  } catch (error: unknown) {
    await stopChild(service);
    throw error;
  }
}

export async function stopSpotcheck(stack: SpawnedStack | undefined): Promise<void> {
  await stopStack(stack);
}
