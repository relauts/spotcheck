import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatGetStarted,
  formatStatusLine,
  formatTitle,
  runStatusStep,
  STORY_DOWNLOADING_SERVICE,
  STORY_GET_STARTED,
  STORY_INSTALLING_CHROMIUM,
  STORY_PREPARING_CONFIG,
  STORY_REGISTERING,
  STORY_SERVICE_UP_TO_DATE,
  STORY_STARTING_UI,
} from "../src/banner.js";

describe("banner", () => {
  it("prints the RELAUTS title with space after it", () => {
    const title = formatTitle(false);
    assert.match(title, /█/);
    assert.match(title, /\n\n$/);
    assert.doesNotMatch(title, /Click/);
    assert.doesNotMatch(title, /http:/);
  });

  it("prints get started with the UI url", () => {
    const started = formatGetStarted("http://127.0.0.1:18733", false);
    assert.match(started, new RegExp(STORY_GET_STARTED.replaceAll(".", "\\.")));
    assert.match(started, /http:\/\/127\.0\.0\.1:18733/);
    assert.doesNotMatch(started, /18732/);
  });

  it("wraps the UI url in a terminal hyperlink", () => {
    const url = "http://127.0.0.1:18733";
    const started = formatGetStarted(url, true);
    assert.match(started, new RegExp(`\\x1b]8;;${url.replaceAll(".", "\\.")}\\x1b\\\\`));
  });

  it("formats a cyan check when a step is done", () => {
    const done = formatStatusLine(STORY_DOWNLOADING_SERVICE, true, "⠋", false);
    assert.match(done, /✓/);
    assert.match(done, /Downloading service/);
    assert.doesNotMatch(done, /⠋/);
  });

  it("formats a spinner mark while a step is running", () => {
    const running = formatStatusLine(STORY_STARTING_UI, false, "⠙", false);
    assert.match(running, /⠙/);
    assert.match(running, /Starting UI/);
    assert.doesNotMatch(running, /✓/);
  });

  it("writes a check line after work finishes", async () => {
    const chunks: string[] = [];
    await runStatusStep(STORY_PREPARING_CONFIG, async () => 1, {
      isTTY: false,
      write(text) {
        chunks.push(text);
      },
    });
    const out = chunks.join("");
    assert.match(out, /✓/);
    assert.match(out, /Preparing config/);
    assert.match(out, /\n$/);
    assert.doesNotMatch(out, /\n\n/);
  });

  it("formats the registering installation step", () => {
    const done = formatStatusLine(STORY_REGISTERING, true, "⠋", false);
    assert.match(done, /✓/);
    assert.match(done, /Registering installation/);
  });

  it("formats chromium and skip labels", () => {
    const chromium = formatStatusLine(STORY_INSTALLING_CHROMIUM, true, "⠋", false);
    const skipped = formatStatusLine(STORY_SERVICE_UP_TO_DATE, true, "⠋", false);
    assert.match(chromium, /Installing Chromium/);
    assert.match(skipped, /Service already up to date/);
  });

  it("uses a done label from the result", async () => {
    const chunks: string[] = [];
    await runStatusStep(
      STORY_DOWNLOADING_SERVICE,
      async () => "skip",
      {
        isTTY: false,
        write(text) {
          chunks.push(text);
        },
      },
      (result) => (result === "skip" ? STORY_SERVICE_UP_TO_DATE : STORY_DOWNLOADING_SERVICE),
    );
    const out = chunks.join("");
    assert.match(out, /Service already up to date/);
    assert.doesNotMatch(out, /Downloading service/);
  });
});
