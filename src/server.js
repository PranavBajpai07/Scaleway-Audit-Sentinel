import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig, assertLiveConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { JsonStore } from "./store.js";
import { ScalewayClient } from "./scalewayClient.js";
import { DemoScalewayClient } from "./demoData.js";
import { runDetectionCycle, startScheduler } from "./poller.js";
import { remediateAlert } from "./remediation.js";
import { readJsonBody, sendError, sendJson, serveStatic } from "./httpUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const allowedAlertSortFields = new Set(["lastSeenAt", "createdAt", "severity", "status", "ruleId", "actor"]);

export async function createApp() {
  const config = loadConfig();
  assertLiveConfig(config);

  const logger = createLogger({ logDir: config.logDir, level: process.env.LOG_LEVEL || "info" });
  const store = new JsonStore(config.stateFile);
  await store.init();

  const client = config.mode === "live"
    ? new ScalewayClient(config.scaleway, logger)
    : new DemoScalewayClient();

  async function route(request, response) {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

      if (url.pathname === "/api/status" && request.method === "GET") {
        const state = store.snapshot();
        sendJson(response, 200, {
          mode: config.mode,
          region: config.scaleway.region,
          pollIntervalSeconds: config.scheduler.pollIntervalSeconds,
          lastPollAt: state.meta.lastPollAt,
          lastPollError: state.meta.lastPollError,
          counts: {
            openAlerts: state.alerts.filter((alert) => alert.status === "open").length,
            remediatedAlerts: state.alerts.filter((alert) => alert.status === "remediated").length,
            events: state.events.length,
            remediations: state.remediations.length
          }
        });
        return;
      }

      if (url.pathname === "/api/alerts" && request.method === "GET") {
        const state = store.snapshot();
        const status = url.searchParams.get("status");
        const severity = url.searchParams.get("severity");
        const page = positiveInteger(url.searchParams.get("page"), 1);
        const pageSize = Math.min(positiveInteger(url.searchParams.get("pageSize"), 25), 100);
        const requestedSortBy = url.searchParams.get("sortBy") || "lastSeenAt";
        const sortBy = allowedAlertSortFields.has(requestedSortBy) ? requestedSortBy : "lastSeenAt";

        const filteredAlerts = state.alerts.filter((alert) => {
          return (!status || alert.status === status) && (!severity || alert.severity === severity);
        });
        const sortedAlerts = [...filteredAlerts].sort((a, b) => compareAlerts(a, b, sortBy));
        const total = sortedAlerts.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const currentPage = Math.min(page, totalPages);
        const start = (currentPage - 1) * pageSize;
        const alerts = sortedAlerts.slice(start, start + pageSize);

        sendJson(response, 200, {
          alerts,
          page: currentPage,
          pageSize,
          total,
          totalPages,
          sortBy
        });
        return;
      }

      if (url.pathname === "/api/events" && request.method === "GET") {
        const limit = Number(url.searchParams.get("limit") || 100);
        const state = store.snapshot();
        sendJson(response, 200, { events: state.events.slice(0, limit) });
        return;
      }

      if (url.pathname === "/api/remediations" && request.method === "GET") {
        const state = store.snapshot();
        sendJson(response, 200, { remediations: state.remediations });
        return;
      }

      if (url.pathname === "/api/poll" && request.method === "POST") {
        const result = await runDetectionCycle({ client, store, config, logger });
        sendJson(response, 202, result);
        return;
      }

      const remediationMatch = url.pathname.match(/^\/api\/alerts\/([^/]+)\/remediate$/);
      if (remediationMatch && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await remediateAlert({
          alertId: remediationMatch[1],
          action: body.action,
          actor: body.actor,
          client,
          store,
          logger,
          mode: config.mode
        });
        sendJson(response, 200, result);
        return;
      }

      const statusMatch = url.pathname.match(/^\/api\/alerts\/([^/]+)\/status$/);
      if (statusMatch && request.method === "PATCH") {
        const body = await readJsonBody(request);
        if (!["open", "dismissed", "remediated"].includes(body.status)) {
          const error = new Error("Invalid alert status");
          error.statusCode = 400;
          throw error;
        }
        const alert = await store.setAlertStatus(statusMatch[1], body.status);
        if (!alert) {
          const error = new Error("Alert not found");
          error.statusCode = 404;
          throw error;
        }
        sendJson(response, 200, { alert });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "API route not found" });
        return;
      }

      await serveStatic(request, response, publicDir);
    } catch (error) {
      logger.error("Request failed", { error: error.message, stack: error.stack });
      sendError(response, error);
    }
  }

  const server = http.createServer(route);
  return {
    server,
    config,
    logger,
    store,
    client,
    startScheduler: () => startScheduler({ client, store, config, logger }),
    pollOnce: () => runDetectionCycle({ client, store, config, logger })
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createApp();
  const scheduler = app.startScheduler();

  app.server.listen(app.config.port, () => {
    app.logger.info("Audit Sentinel listening", {
      port: app.config.port,
      mode: app.config.mode,
      logFile: app.logger.logFile
    });
  });

  scheduler.tick().catch((error) => {
    app.logger.error("Initial detection cycle failed", { error: error.message });
  });
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function compareAlerts(a, b, sortBy) {
  if (sortBy === "severity") {
    return severityRank(b.severity) - severityRank(a.severity) || compareDates(b.lastSeenAt, a.lastSeenAt);
  }

  if (sortBy === "lastSeenAt" || sortBy === "createdAt") {
    return compareDates(b[sortBy], a[sortBy]);
  }

  return String(a[sortBy] || "").localeCompare(String(b[sortBy] || "")) || compareDates(b.lastSeenAt, a.lastSeenAt);
}

function compareDates(left, right) {
  return new Date(left || 0).getTime() - new Date(right || 0).getTime();
}

function severityRank(severity) {
  return {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1
  }[severity] || 0;
}