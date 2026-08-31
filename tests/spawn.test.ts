import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import { waitForHttp } from "../src/spawn.js";

const servers: http.Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) {
      continue;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

describe("waitForHttp", () => {
  it("returns when the URL responds ok", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    await waitForHttp(`http://127.0.0.1:${port}/v1/health`, 5_000);
  });

  it("fails when nothing is listening", async () => {
    await assert.rejects(() => waitForHttp("http://127.0.0.1:1/", 400), /Timed out/);
  });
});
