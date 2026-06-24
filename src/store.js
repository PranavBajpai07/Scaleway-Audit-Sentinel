import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const defaultState = {
  meta: {
    createdAt: null,
    updatedAt: null,
    lastPollAt: null,
    lastPollError: null
  },
  events: [],
  alerts: [],
  remediations: [],
  users: {},
  principalIps: {}
};

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = structuredClone(defaultState);
    this.ready = false;
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.state = {
        ...structuredClone(defaultState),
        ...JSON.parse(raw)
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.state.meta.createdAt = new Date().toISOString();
      await this.save();
    }

    this.ready = true;
  }

  snapshot() {
    this.#ensureReady();
    return structuredClone(this.state);
  }

  async save() {
    this.state.meta.updatedAt = new Date().toISOString();
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(this.state, null, 2)}\n`);
    await fs.rename(tempPath, this.filePath);
  }

  async addEvents(events, maxEvents = 500) {
    this.#ensureReady();
    const seenIds = new Set(this.state.events.map((event) => event.id));
    const uniqueEvents = [];
    for (const event of events) {
      if (!event?.id || seenIds.has(event.id)) continue;
      seenIds.add(event.id);
      uniqueEvents.push(event);
    }

    this.state.events.push(...uniqueEvents);
    this.state.events.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
    this.state.events = this.state.events.slice(0, maxEvents);

    await this.save();
    return uniqueEvents.length;
  }

  async upsertAlerts(alerts) {
    this.#ensureReady();
    const created = [];
    const updated = [];

    for (const alert of alerts) {
      const existing = this.state.alerts.find((item) => item.fingerprint === alert.fingerprint);
      if (existing) {
        existing.lastSeenAt = alert.lastSeenAt || alert.recordedAt;
        existing.occurrences = (existing.occurrences || 1) + (alert.occurrences || 1);
        existing.evidence = mergeEvidence(existing.evidence, alert.evidence);
        existing.metadata = { ...existing.metadata, ...alert.metadata };
        updated.push(existing);
      } else {
        const now = new Date().toISOString();
        const nextAlert = {
          id: crypto.randomUUID(),
          status: "open",
          createdAt: now,
          lastSeenAt: alert.lastSeenAt || alert.recordedAt || now,
          occurrences: alert.occurrences || 1,
          ...alert
        };
        this.state.alerts.push(nextAlert);
        created.push(nextAlert);
      }
    }

    this.state.alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
    await this.save();
    return { created, updated };
  }

  async setAlertStatus(alertId, status) {
    this.#ensureReady();
    const alert = this.state.alerts.find((item) => item.id === alertId);
    if (!alert) return null;

    alert.status = status;
    alert.updatedAt = new Date().toISOString();
    await this.save();
    return alert;
  }

  async recordRemediation(remediation) {
    this.#ensureReady();
    const entry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...remediation
    };
    this.state.remediations.unshift(entry);
    this.state.remediations = this.state.remediations.slice(0, 200);
    await this.save();
    return entry;
  }

  async setUserLockState(userId, locked) {
    this.#ensureReady();
    const existing = this.state.users[userId] || { userId };
    this.state.users[userId] = {
      ...existing,
      locked,
      updatedAt: new Date().toISOString()
    };
    await this.save();
  }

  async rememberPrincipalIp(principalKey, sourceIp) {
    this.#ensureReady();
    if (!principalKey || !sourceIp) return;

    const current = new Set(this.state.principalIps[principalKey] || []);
    current.add(sourceIp);
    this.state.principalIps[principalKey] = [...current].sort();
    await this.save();
  }

  #ensureReady() {
    if (!this.ready) {
      throw new Error("Store has not been initialized.");
    }
  }
}

function mergeEvidence(existing = [], next = []) {
  const byId = new Map();
  for (const item of [...existing, ...next]) {
    if (!item?.eventId) continue;
    byId.set(item.eventId, item);
  }
  return [...byId.values()].slice(-10);
}

function severityRank(severity) {
  return {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1
  }[severity] || 0;
}
