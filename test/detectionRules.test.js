import test from "node:test";
import assert from "node:assert/strict";
import { DemoScalewayClient } from "../src/demoData.js";
import { detectAlerts, normalizeEvents } from "../src/detectionRules.js";

const detectionConfig = {
  failedLoginThreshold: 3,
  failedLoginWindowMinutes: 15,
  allowedCountryCodes: ["FR", "IN", "SE"]
};

test("demo events produce the expected security alerts", async () => {
  const client = new DemoScalewayClient();
  const auditEvents = await client.listAuditEvents();
  const authenticationEvents = await client.listAuthenticationEvents();
  const events = normalizeEvents({ auditEvents, authenticationEvents });

  const alerts = detectAlerts(events, { principalIps: {} }, detectionConfig);
  const ruleIds = alerts.map((alert) => alert.ruleId);

  assert.ok(ruleIds.includes("failed-login-burst"));
  assert.ok(ruleIds.includes("forbidden-sensitive-access"));
  assert.ok(ruleIds.includes("credential-change"));
  assert.ok(ruleIds.includes("unusual-country"));
});

test("new source IP rule only fires after a principal has an established profile", () => {
  const event = {
    id: "auth:sample-1",
    rawId: "sample-1",
    kind: "authentication",
    recordedAt: new Date().toISOString(),
    actor: "alice@example.com",
    userId: "user-alice",
    sourceIp: "203.0.113.77",
    countryCode: "FR",
    methodName: "password",
    result: "success",
    failureReason: "",
    resourceTypes: [],
    resourceNames: [],
    metadata: {}
  };

  const alertsWithoutProfile = detectAlerts([event], { principalIps: {} }, detectionConfig);
  const alertsWithProfile = detectAlerts([event], {
    principalIps: {
      "user-alice": ["198.51.100.10"]
    }
  }, detectionConfig);

  assert.equal(alertsWithoutProfile.some((alert) => alert.ruleId === "new-source-ip"), false);
  assert.equal(alertsWithProfile.some((alert) => alert.ruleId === "new-source-ip"), true);
});
