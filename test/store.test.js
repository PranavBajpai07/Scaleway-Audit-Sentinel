import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.js";

test("store deduplicates events and upserts alerts by fingerprint", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-sentinel-"));
  const store = new JsonStore(path.join(dir, "state.json"));
  await store.init();

  const event = {
    id: "event-1",
    kind: "audit",
    recordedAt: new Date().toISOString()
  };

  assert.equal(await store.addEvents([event, event]), 1);
  assert.equal(await store.addEvents([event]), 0);

  const alert = {
    fingerprint: "rule:entity:bucket",
    ruleId: "rule",
    severity: "medium",
    title: "Sample alert",
    actor: "user",
    userId: "user",
    recordedAt: new Date().toISOString(),
    description: "Sample",
    remediation: { supported: true, actions: ["lock"] },
    evidence: [{ eventId: "event-1" }],
    metadata: {}
  };

  const first = await store.upsertAlerts([alert]);
  const second = await store.upsertAlerts([alert]);
  const state = store.snapshot();

  assert.equal(first.created.length, 1);
  assert.equal(second.updated.length, 1);
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0].occurrences, 2);
});
