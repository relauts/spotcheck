import path from "node:path";
import { fileURLToPath } from "node:url";

export const SERVICE_PACKAGE = "@relauts/spotcheck-service";
export const UI_PACKAGE = "@relauts/spotcheck-ui";

export const SERVICE_DIR_NAME = "relauts-spotcheck-service";
export const UI_DIR_NAME = "relauts-spotcheck-ui";
export const SERVICE_CONFIG_NAME = "relauts-spotcheck-service-config.json";
export const UI_CONFIG_NAME = "relauts-spotcheck-ui-config.json";

export const DEFAULT_SERVICE_PORT = 18732;
export const DEFAULT_UI_PORT = 18733;

export interface InstallLayout {
  readonly cwd: string;
  readonly serviceDir: string;
  readonly uiDir: string;
  readonly serviceConfig: string;
  readonly uiConfig: string;
}

export function launcherRoot(fromUrl = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(fromUrl)), "..");
}

export function templatesDir(fromUrl = import.meta.url): string {
  return path.join(launcherRoot(fromUrl), "files");
}

export function layoutFor(cwd: string): InstallLayout {
  return {
    cwd,
    serviceDir: path.join(cwd, SERVICE_DIR_NAME),
    uiDir: path.join(cwd, UI_DIR_NAME),
    serviceConfig: path.join(cwd, SERVICE_CONFIG_NAME),
    uiConfig: path.join(cwd, UI_CONFIG_NAME),
  };
}
