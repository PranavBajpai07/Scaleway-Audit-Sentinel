const state = {
  alerts: [],
  events: [],
  remediations: [],
  selectedAlertId: null,
  pagination: {
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
    sortBy: "lastSeenAt"
  }
};

const els = {
  actorInput: document.querySelector("#actorInput"),
  refreshButton: document.querySelector("#refreshButton"),
  pollButton: document.querySelector("#pollButton"),
  statusFilter: document.querySelector("#statusFilter"),
  severityFilter: document.querySelector("#severityFilter"),
  sortBySelect: document.querySelector("#sortBySelect"),
  pageSizeSelect: document.querySelector("#pageSizeSelect"),
  prevPageButton: document.querySelector("#prevPageButton"),
  nextPageButton: document.querySelector("#nextPageButton"),
  paginationRange: document.querySelector("#paginationRange"),
  pageSummary: document.querySelector("#pageSummary"),
  modeMetric: document.querySelector("#modeMetric"),
  openAlertsMetric: document.querySelector("#openAlertsMetric"),
  eventsMetric: document.querySelector("#eventsMetric"),
  lastPollMetric: document.querySelector("#lastPollMetric"),
  statusLine: document.querySelector("#statusLine"),
  alertsTableBody: document.querySelector("#alertsTableBody"),
  detailContent: document.querySelector("#detailContent"),
  selectedSubtitle: document.querySelector("#selectedSubtitle"),
  eventsList: document.querySelector("#eventsList"),
  remediationList: document.querySelector("#remediationList"),
  toast: document.querySelector("#toast")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

async function refresh() {
  const [status, alertsPayload, eventsPayload, remediationsPayload] = await Promise.all([
    api("/api/status"),
    api(buildAlertsPath()),
    api("/api/events?limit=25"),
    api("/api/remediations")
  ]);

  state.alerts = alertsPayload.alerts;
  state.events = eventsPayload.events;
  state.remediations = remediationsPayload.remediations;
  state.pagination = {
    page: alertsPayload.page,
    pageSize: alertsPayload.pageSize,
    total: alertsPayload.total,
    totalPages: alertsPayload.totalPages,
    sortBy: alertsPayload.sortBy
  };

  if (state.selectedAlertId && !state.alerts.some((alert) => alert.id === state.selectedAlertId)) {
    state.selectedAlertId = null;
  }

  syncControlValues();
  renderStatus(status);
  renderAlerts();
  renderDetail();
  renderPagination();
  renderEvents();
  renderRemediations();
}

function buildAlertsPath() {
  const url = new URL("/api/alerts", window.location.origin);
  if (els.statusFilter.value) url.searchParams.set("status", els.statusFilter.value);
  if (els.severityFilter.value) url.searchParams.set("severity", els.severityFilter.value);
  url.searchParams.set("page", String(state.pagination.page));
  url.searchParams.set("pageSize", els.pageSizeSelect.value || String(state.pagination.pageSize));
  url.searchParams.set("sortBy", els.sortBySelect.value || state.pagination.sortBy);
  return `${url.pathname}${url.search}`;
}

function syncControlValues() {
  els.pageSizeSelect.value = String(state.pagination.pageSize);
  els.sortBySelect.value = state.pagination.sortBy;
}

function renderStatus(status) {
  els.modeMetric.textContent = status.mode;
  els.openAlertsMetric.textContent = status.counts.openAlerts;
  els.eventsMetric.textContent = status.counts.events;
  els.lastPollMetric.textContent = status.lastPollAt ? relativeTime(status.lastPollAt) : "Never";
  els.statusLine.textContent = status.lastPollError
    ? `Last poll failed: ${status.lastPollError}`
    : `${state.pagination.total} alert${state.pagination.total === 1 ? "" : "s"} match the current filters.`;
}

function renderAlerts() {
  if (!state.alerts.length) {
    els.alertsTableBody.innerHTML = `<tr><td colspan="6" class="empty">No alerts match the current filters.</td></tr>`;
    return;
  }

  els.alertsTableBody.innerHTML = state.alerts.map((alert) => `
    <tr data-alert-id="${escapeHtml(alert.id)}" class="${alert.id === state.selectedAlertId ? "selected" : ""}">
      <td><span class="badge ${escapeHtml(alert.severity)}">${escapeHtml(alert.severity)}</span></td>
      <td>
        <strong>${escapeHtml(alert.title)}</strong>
        <div class="compact-meta">${escapeHtml(alert.ruleId)} - ${alert.occurrences || 1} occurrence${(alert.occurrences || 1) === 1 ? "" : "s"}</div>
      </td>
      <td>${escapeHtml(alert.actor || "unknown")}</td>
      <td>${escapeHtml(alert.sourceIp || "n/a")}</td>
      <td><span class="badge ${escapeHtml(alert.status)}">${escapeHtml(alert.status)}</span></td>
      <td>${escapeHtml(relativeTime(alert.lastSeenAt || alert.recordedAt))}</td>
    </tr>
  `).join("");

  els.alertsTableBody.querySelectorAll("tr[data-alert-id]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedAlertId = row.dataset.alertId;
      renderAlerts();
      renderDetail();
    });
  });
}

function renderPagination() {
  const { page, pageSize, total, totalPages } = state.pagination;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = total === 0 ? 0 : Math.min(start + state.alerts.length - 1, total);

  els.paginationRange.textContent = `Showing ${start}-${end} of ${total} alerts`;
  els.pageSummary.textContent = `Page ${page} of ${totalPages}`;
  els.prevPageButton.disabled = page <= 1;
  els.nextPageButton.disabled = page >= totalPages;
}

function renderDetail() {
  const alert = state.alerts.find((item) => item.id === state.selectedAlertId);
  if (!alert) {
    els.selectedSubtitle.textContent = "Select an alert to inspect evidence.";
    els.detailContent.className = "detail-empty";
    els.detailContent.textContent = "No alert selected.";
    return;
  }

  els.selectedSubtitle.textContent = `${alert.ruleId} - ${relativeTime(alert.recordedAt)}`;
  els.detailContent.className = "detail-body";
  els.detailContent.innerHTML = `
    <div class="detail-title">
      <div>
        <span class="badge ${escapeHtml(alert.severity)}">${escapeHtml(alert.severity)}</span>
        <span class="badge ${escapeHtml(alert.status)}">${escapeHtml(alert.status)}</span>
      </div>
      <h3>${escapeHtml(alert.title)}</h3>
      <p>${escapeHtml(alert.description)}</p>
    </div>

    <div class="detail-meta">
      ${kv("Actor", alert.actor || "unknown")}
      ${kv("User target", alert.userId || "n/a")}
      ${kv("Source IP", alert.sourceIp || "n/a")}
      ${kv("Created", formatDate(alert.createdAt))}
    </div>

    <div class="actions-row">
      ${alert.remediation?.supported ? `
        <button class="button danger" data-action="lock">Lock User</button>
        <button class="button secondary" data-action="unlock">Unlock User</button>
      ` : ""}
      <button class="button secondary" data-status="${alert.status === "dismissed" ? "open" : "dismissed"}">
        ${alert.status === "dismissed" ? "Reopen" : "Dismiss"}
      </button>
    </div>

    <div>
      <h3>Evidence</h3>
      <ul class="evidence-list">
        ${(alert.evidence || []).map((item) => `
          <li>
            <strong>${escapeHtml(item.kind || "event")} - ${escapeHtml(item.eventId || "")}</strong>
            <div class="evidence-meta">
              ${escapeHtml(formatDate(item.recordedAt))} - ${escapeHtml(item.actor || "unknown")} - ${escapeHtml(item.sourceIp || "n/a")}
              ${item.methodName ? ` - ${escapeHtml(item.methodName)}` : ""}
              ${item.result ? ` - ${escapeHtml(item.result)}` : ""}
            </div>
          </li>
        `).join("")}
      </ul>
    </div>
  `;

  els.detailContent.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => remediate(alert, button.dataset.action));
  });

  els.detailContent.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => updateStatus(alert, button.dataset.status));
  });
}

function renderEvents() {
  if (!state.events.length) {
    els.eventsList.innerHTML = `<div class="empty">No events stored yet.</div>`;
    return;
  }

  els.eventsList.innerHTML = state.events.map((event) => `
    <div class="compact-item">
      <div class="compact-title">
        <span>${escapeHtml(event.kind)} - ${escapeHtml(event.methodName || "event")}</span>
        <span>${escapeHtml(relativeTime(event.recordedAt))}</span>
      </div>
      <div class="compact-meta">
        ${escapeHtml(event.actor || "unknown")} - ${escapeHtml(event.sourceIp || "n/a")} - ${escapeHtml(event.serviceName || "n/a")}
      </div>
    </div>
  `).join("");
}

function renderRemediations() {
  if (!state.remediations.length) {
    els.remediationList.innerHTML = `<div class="empty">No remediation actions yet.</div>`;
    return;
  }

  els.remediationList.innerHTML = state.remediations.map((item) => `
    <div class="compact-item">
      <div class="compact-title">
        <span>${escapeHtml(item.action)} - ${escapeHtml(item.targetId)}</span>
        <span>${escapeHtml(relativeTime(item.createdAt))}</span>
      </div>
      <div class="compact-meta">
        Triggered by ${escapeHtml(item.actor)} - mode ${escapeHtml(item.mode)}
      </div>
    </div>
  `).join("");
}

async function runPoll() {
  setBusy(els.pollButton, true, "Scanning...");
  try {
    const result = await api("/api/poll", { method: "POST", body: "{}" });
    showToast(`Scan complete: ${result.createdAlerts} new alerts`);
    await refresh();
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(els.pollButton, false, "Run Scan");
  }
}

async function remediate(alert, action) {
  const label = action === "lock" ? "lock" : "unlock";
  const confirmed = window.confirm(`Confirm ${label} for ${alert.userId}?`);
  if (!confirmed) return;

  try {
    await api(`/api/alerts/${encodeURIComponent(alert.id)}/remediate`, {
      method: "POST",
      body: JSON.stringify({
        action,
        actor: els.actorInput.value || "local-analyst"
      })
    });
    showToast(`User ${label} action recorded`);
    await refresh();
  } catch (error) {
    showToast(error.message);
  }
}

async function updateStatus(alert, status) {
  try {
    await api(`/api/alerts/${encodeURIComponent(alert.id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    showToast(`Alert marked ${status}`);
    await refresh();
  } catch (error) {
    showToast(error.message);
  }
}

function goToPage(page) {
  state.pagination.page = Math.max(1, Math.min(page, state.pagination.totalPages));
  refresh().catch((error) => showToast(error.message));
}

function resetToFirstPageAndRefresh() {
  state.pagination.page = 1;
  state.pagination.pageSize = Number(els.pageSizeSelect.value || 25);
  state.pagination.sortBy = els.sortBySelect.value || "lastSeenAt";
  refresh().catch((error) => showToast(error.message));
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function kv(label, value) {
  return `<div class="kv"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "n/a")}</strong></div>`;
}

function relativeTime(value) {
  if (!value) return "n/a";
  const diffMs = Date.now() - new Date(value).getTime();
  const absMs = Math.abs(diffMs);
  const units = [
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
    ["second", 1000]
  ];

  for (const [unit, ms] of units) {
    if (absMs >= ms || unit === "second") {
      const count = Math.max(1, Math.round(absMs / ms));
      return diffMs >= 0
        ? `${count} ${unit}${count === 1 ? "" : "s"} ago`
        : `in ${count} ${unit}${count === 1 ? "" : "s"}`;
    }
  }
}

function formatDate(value) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => els.toast.classList.remove("visible"), 2600);
}

els.refreshButton.addEventListener("click", () => {
  refresh().catch((error) => showToast(error.message));
});
els.pollButton.addEventListener("click", runPoll);
els.statusFilter.addEventListener("change", resetToFirstPageAndRefresh);
els.severityFilter.addEventListener("change", resetToFirstPageAndRefresh);
els.sortBySelect.addEventListener("change", resetToFirstPageAndRefresh);
els.pageSizeSelect.addEventListener("change", resetToFirstPageAndRefresh);
els.prevPageButton.addEventListener("click", () => goToPage(state.pagination.page - 1));
els.nextPageButton.addEventListener("click", () => goToPage(state.pagination.page + 1));

refresh().catch((error) => showToast(error.message));
window.setInterval(() => refresh().catch(() => {}), 10000);