import { detectAlerts, normalizeEvents, principalKey } from "./detectionRules.js";

export async function runDetectionCycle({ client, store, config, logger }) {
  const stateBefore = store.snapshot();
  const now = new Date();
  const recordedBefore = now.toISOString();
  const recordedAfter = stateBefore.meta.lastPollAt
    || new Date(now.getTime() - config.scaleway.lookbackMinutes * 60 * 1000).toISOString();

  logger.info("Starting detection cycle", {
    mode: config.mode,
    recordedAfter,
    recordedBefore
  });

  try {
    const [auditEvents, authenticationEvents] = await Promise.all([
      client.listAuditEvents({ recordedAfter, recordedBefore }),
      client.listAuthenticationEvents({ recordedAfter, recordedBefore })
    ]);

    const normalizedEvents = normalizeEvents({ auditEvents, authenticationEvents });
    const uniqueEventCount = await store.addEvents(normalizedEvents);
    const alerts = detectAlerts(normalizedEvents, stateBefore, config.detection);
    const { created, updated } = await store.upsertAlerts(alerts);

    for (const event of normalizedEvents.filter((item) => item.kind === "authentication" && item.sourceIp)) {
      await store.rememberPrincipalIp(principalKey(event), event.sourceIp);
    }

    store.state.meta.lastPollAt = recordedBefore;
    store.state.meta.lastPollError = null;
    await store.save();

    logger.info("Detection cycle completed", {
      fetchedEvents: normalizedEvents.length,
      uniqueEventCount,
      createdAlerts: created.length,
      updatedAlerts: updated.length
    });

    return {
      fetchedEvents: normalizedEvents.length,
      uniqueEventCount,
      createdAlerts: created.length,
      updatedAlerts: updated.length
    };
  } catch (error) {
    store.state.meta.lastPollError = error.message;
    await store.save();
    logger.error("Detection cycle failed", { error: error.message, stack: error.stack });
    throw error;
  }
}

export function startScheduler({ client, store, config, logger }) {
  const intervalMs = config.scheduler.pollIntervalSeconds * 1000;
  let running = false;

  async function tick() {
    if (running) {
      logger.warn("Skipping poll because previous cycle is still running");
      return;
    }

    running = true;
    try {
      await runDetectionCycle({ client, store, config, logger });
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
