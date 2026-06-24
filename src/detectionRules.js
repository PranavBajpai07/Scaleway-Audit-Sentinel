const sensitiveResourceHints = [
  "iam",
  "secret",
  "secm",
  "key",
  "credential",
  "token",
  "password",
  "mfa"
];

const credentialMethodHints = [
  "createapikey",
  "deleteapikey",
  "updateapikey",
  "createapi_key",
  "deleteapi_key",
  "createkey",
  "deletekey",
  "createtoken",
  "deletetoken",
  "updatemfa",
  "deletemfa"
];

export function normalizeAuditEvent(event) {
  const principalId = event.principal?.id || event.principal_id || event.user_id || "unknown-principal";
  const resources = event.resources || [];
  const resourceTypes = resources.map((resource) => resource.type).filter(Boolean);
  const resourceNames = resources.map((resource) => resource.name).filter(Boolean);

  return {
    id: `audit:${event.id}`,
    rawId: event.id,
    kind: "audit",
    recordedAt: event.recorded_at || event.recordedAt,
    actor: principalId,
    userId: principalId.startsWith("user-") ? principalId : principalId,
    sourceIp: event.source_ip || event.sourceIp || "",
    countryCode: "",
    productName: event.product_name || event.productName || "",
    serviceName: event.service_name || event.serviceName || "",
    methodName: event.method_name || event.methodName || "",
    statusCode: Number(event.status_code ?? event.statusCode ?? 0),
    result: "",
    failureReason: "",
    resourceTypes,
    resourceNames,
    metadata: {
      requestId: event.request_id || event.requestId || "",
      resources
    },
    raw: event
  };
}

export function normalizeAuthenticationEvent(event) {
  const userResource = (event.resources || []).find((resource) => resource.account_user_info || resource.type === "account_user");
  const email = userResource?.account_user_info?.email || event.email || "";
  const userId = userResource?.id || event.user_id || event.principal_id || email || "unknown-user";

  return {
    id: `auth:${event.id}`,
    rawId: event.id,
    kind: "authentication",
    recordedAt: event.recorded_at || event.recordedAt,
    actor: email || userId,
    userId,
    sourceIp: event.source_ip || event.sourceIp || "",
    countryCode: (event.country_code || event.countryCode || "").toUpperCase(),
    productName: "audit-trail",
    serviceName: "Authentication",
    methodName: event.method || event.method_name || "authentication",
    statusCode: 0,
    result: event.result || "",
    failureReason: event.failure_reason || event.failureReason || "",
    resourceTypes: (event.resources || []).map((resource) => resource.type).filter(Boolean),
    resourceNames: email ? [email] : [],
    metadata: {
      origin: event.origin || "",
      mfaType: event.mfa_type || "",
      resources: event.resources || []
    },
    raw: event
  };
}

export function normalizeEvents({ auditEvents = [], authenticationEvents = [] }) {
  return [
    ...auditEvents.map(normalizeAuditEvent),
    ...authenticationEvents.map(normalizeAuthenticationEvent)
  ].filter((event) => event.recordedAt);
}

export function detectAlerts(events, state, config) {
  const alerts = [
    ...detectFailedLoginBursts(events, config),
    ...detectForbiddenSensitiveAccess(events),
    ...detectUnusualAuthentication(events, state, config),
    ...detectCredentialChanges(events)
  ];

  return alerts;
}

export function principalKey(event) {
  return event.userId || event.actor || "unknown";
}

function detectFailedLoginBursts(events, config) {
  const authFailures = events
    .filter((event) => event.kind === "authentication" && isFailure(event))
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  const byPrincipal = new Map();
  for (const event of authFailures) {
    const key = principalKey(event);
    const current = byPrincipal.get(key) || [];
    current.push(event);
    byPrincipal.set(key, current);
  }

  const alerts = [];
  const windowMs = config.failedLoginWindowMinutes * 60 * 1000;

  for (const [key, principalEvents] of byPrincipal.entries()) {
    for (let index = 0; index < principalEvents.length; index += 1) {
      const windowStart = new Date(principalEvents[index].recordedAt).getTime();
      const cluster = principalEvents.filter((event) => {
        const timestamp = new Date(event.recordedAt).getTime();
        return timestamp >= windowStart && timestamp <= windowStart + windowMs;
      });

      if (cluster.length >= config.failedLoginThreshold) {
        const latest = cluster.at(-1);
        alerts.push({
          fingerprint: `failed-login-burst:${key}:${cluster[0].recordedAt.slice(0, 13)}`,
          ruleId: "failed-login-burst",
          severity: "high",
          title: "Repeated failed authentication attempts",
          actor: latest.actor,
          userId: latest.userId,
          sourceIp: latest.sourceIp,
          recordedAt: latest.recordedAt,
          lastSeenAt: latest.recordedAt,
          description: `${cluster.length} failed login attempts were observed for ${latest.actor} within ${config.failedLoginWindowMinutes} minutes.`,
          remediation: {
            supported: Boolean(latest.userId),
            actions: ["lock", "unlock"]
          },
          evidence: cluster.map(toEvidence),
          metadata: {
            failureReasons: [...new Set(cluster.map((event) => event.failureReason).filter(Boolean))],
            windowMinutes: config.failedLoginWindowMinutes
          }
        });
        break;
      }
    }
  }

  return alerts;
}

function detectForbiddenSensitiveAccess(events) {
  return events
    .filter((event) => event.kind === "audit")
    .filter((event) => event.statusCode === 403)
    .filter((event) => containsSensitiveHint([
      event.productName,
      event.serviceName,
      event.methodName,
      ...event.resourceTypes,
      ...event.resourceNames
    ]))
    .map((event) => ({
      fingerprint: `forbidden-sensitive-access:${event.rawId}`,
      ruleId: "forbidden-sensitive-access",
      severity: "high",
      title: "Forbidden access attempt on sensitive resource",
      actor: event.actor,
      userId: event.userId,
      sourceIp: event.sourceIp,
      recordedAt: event.recordedAt,
      description: `${event.actor} received a 403 while calling ${event.serviceName}.${event.methodName} against ${event.resourceNames[0] || event.resourceTypes[0] || "a sensitive resource"}.`,
      remediation: {
        supported: Boolean(event.userId),
        actions: ["lock", "unlock"]
      },
      evidence: [toEvidence(event)],
      metadata: {
        statusCode: event.statusCode,
        resourceTypes: event.resourceTypes,
        resourceNames: event.resourceNames
      }
    }));
}

function detectUnusualAuthentication(events, state, config) {
  return events
    .filter((event) => event.kind === "authentication" && !isFailure(event))
    .flatMap((event) => {
      const alerts = [];
      const key = principalKey(event);
      const knownIps = new Set(state.principalIps?.[key] || []);
      const hasEstablishedProfile = knownIps.size > 0;
      const countryAllowed = !event.countryCode || config.allowedCountryCodes.includes(event.countryCode);

      if (!countryAllowed) {
        alerts.push({
          fingerprint: `unusual-country:${key}:${event.countryCode}:${event.rawId}`,
          ruleId: "unusual-country",
          severity: "medium",
          title: "Authentication from non-allowlisted country",
          actor: event.actor,
          userId: event.userId,
          sourceIp: event.sourceIp,
          recordedAt: event.recordedAt,
          description: `${event.actor} authenticated from ${event.countryCode}, which is outside the configured country allowlist.`,
          remediation: {
            supported: Boolean(event.userId),
            actions: ["lock", "unlock"]
          },
          evidence: [toEvidence(event)],
          metadata: {
            countryCode: event.countryCode,
            allowedCountryCodes: config.allowedCountryCodes
          }
        });
      }

      if (hasEstablishedProfile && event.sourceIp && !knownIps.has(event.sourceIp)) {
        alerts.push({
          fingerprint: `new-source-ip:${key}:${event.sourceIp}`,
          ruleId: "new-source-ip",
          severity: "medium",
          title: "Authentication from a new source IP",
          actor: event.actor,
          userId: event.userId,
          sourceIp: event.sourceIp,
          recordedAt: event.recordedAt,
          description: `${event.actor} authenticated from a source IP not previously observed by this service.`,
          remediation: {
            supported: Boolean(event.userId),
            actions: ["lock", "unlock"]
          },
          evidence: [toEvidence(event)],
          metadata: {
            knownIps: [...knownIps]
          }
        });
      }

      return alerts;
    });
}

function detectCredentialChanges(events) {
  return events
    .filter((event) => event.kind === "audit")
    .filter((event) => event.statusCode >= 200 && event.statusCode < 300)
    .filter((event) => {
      const method = compact(event.methodName);
      const haystack = [
        method,
        compact(event.serviceName),
        compact(event.productName),
        ...event.resourceTypes.map(compact),
        ...event.resourceNames.map(compact)
      ];
      return haystack.some((value) => credentialMethodHints.some((hint) => value.includes(hint)));
    })
    .map((event) => ({
      fingerprint: `credential-change:${event.rawId}`,
      ruleId: "credential-change",
      severity: "medium",
      title: "Credential or key lifecycle change",
      actor: event.actor,
      userId: event.userId,
      sourceIp: event.sourceIp,
      recordedAt: event.recordedAt,
      description: `${event.actor} performed ${event.serviceName}.${event.methodName}, which changes credential material or access keys.`,
      remediation: {
        supported: Boolean(event.userId),
        actions: ["lock", "unlock"]
      },
      evidence: [toEvidence(event)],
      metadata: {
        methodName: event.methodName,
        resourceTypes: event.resourceTypes,
        resourceNames: event.resourceNames
      }
    }));
}

function isFailure(event) {
  const result = String(event.result || "").toLowerCase();
  const reason = String(event.failureReason || "").toLowerCase();
  return result.includes("fail") || result.includes("denied") || reason.includes("invalid") || Boolean(reason);
}

function containsSensitiveHint(values) {
  return values.some((value) => {
    const compacted = compact(value);
    return sensitiveResourceHints.some((hint) => compacted.includes(hint));
  });
}

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toEvidence(event) {
  return {
    eventId: event.id,
    recordedAt: event.recordedAt,
    kind: event.kind,
    actor: event.actor,
    sourceIp: event.sourceIp,
    methodName: event.methodName,
    statusCode: event.statusCode || undefined,
    result: event.result || undefined,
    resource: event.resourceNames[0] || event.resourceTypes[0] || undefined
  };
}
