export async function remediateAlert({ alertId, action, actor, client, store, logger, mode }) {
  const state = store.snapshot();
  const alert = state.alerts.find((item) => item.id === alertId);
  if (!alert) {
    const error = new Error("Alert not found");
    error.statusCode = 404;
    throw error;
  }

  if (!alert.remediation?.supported || !alert.userId) {
    const error = new Error("This alert does not have a user remediation target");
    error.statusCode = 400;
    throw error;
  }

  if (!["lock", "unlock"].includes(action)) {
    const error = new Error("Unsupported remediation action");
    error.statusCode = 400;
    throw error;
  }

  logger.info("Starting remediation", {
    alertId,
    action,
    userId: alert.userId,
    actor,
    mode
  });

  const before = state.users[alert.userId] || { userId: alert.userId, locked: false };
  const result = action === "lock"
    ? await client.lockUser(alert.userId)
    : await client.unlockUser(alert.userId);
  const locked = action === "lock";

  await store.setUserLockState(alert.userId, locked);
  const updatedAlert = await store.setAlertStatus(alertId, action === "lock" ? "remediated" : "open");
  const remediation = await store.recordRemediation({
    alertId,
    action,
    actor: actor || "local-analyst",
    targetType: "iam_user",
    targetId: alert.userId,
    before,
    after: {
      userId: alert.userId,
      locked,
      scalewayResponse: result
    },
    mode
  });

  logger.info("Remediation completed", {
    remediationId: remediation.id,
    alertId,
    action,
    userId: alert.userId
  });

  return {
    alert: updatedAlert,
    remediation
  };
}
