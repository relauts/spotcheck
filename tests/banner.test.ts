import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatGetStarted, formatStatusLine, formatTitle, runStatusStep } from "../src/banner.js";

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
    assert.match(started, /Click below link to get started\./);
    assert.match(started, /http:\/\/127\.0\.0\.1:18733/);
    assert.doesNotMatch(started, /18732/);
  });

  it("wraps the UI url in a terminal hyperlink", () => {
    const url = "http://127.0.0.1:18733";
    const started = formatGetStarted(url, true);
    assert.match(started, new RegExp(`\\x1b]8;;${url.replaceAll(".", "\\.")}\\x1b\\\\`));
  });

  it("formats a cyan check when a step is done", () => {
    const done = formatStatusLine("Downloading required packages...", true, "⠋", false);
    assert.match(done, /✓/);
    assert.match(done, /Downloading required packages/);
    assert.doesNotMatch(done, /⠋/);
  });

  it("formats a spinner mark while a step is running", () => {
    const running = formatStatusLine("Installation complete.", false, "⠙", false);
    assert.match(running, /⠙/);
    assert.match(running, /Installation complete/);
    assert.doesNotMatch(running, /✓/);
  });

  it("writes a check line after work finishes", async () => {
    const chunks: string[] = [];
    await runStatusStep("Downloading required packages...", async () => 1, {
      isTTY: false,
      write(text) {
        chunks.push(text);
      },
    });
    const out = chunks.join("");
    assert.match(out, /✓/);
    assert.match(out, /Downloading required packages/);
    assert.match(out, /\n\n/);
  });
});
