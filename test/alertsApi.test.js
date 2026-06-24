import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("alerts API supports server-side pagination, filtering, and sorting", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-sentinel-api-"));
  process.env.SCW_MODE = "demo";
  process.env.DATA_DIR = dataDir;
  process.env.LOG_DIR = path.join(dataDir, "logs");
  process.env.PORT = "0";

  const { createApp } = await import("../src/server.js");
  const app = await createApp();
  await app.pollOnce();

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/alerts?page=1&pageSize=2&status=open&sortBy=severity`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.page, 1);
    assert.equal(payload.pageSize, 2);
    assert.equal(payload.alerts.length, 2);
    assert.equal(payload.total >= 2, true);
    assert.equal(payload.totalPages >= 1, true);
    assert.equal(payload.sortBy, "severity");

    const severities = payload.alerts.map((alert) => alert.severity);
    assert.deepEqual(severities, ["high", "high"]);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});
