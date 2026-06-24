# Scaleway Audit Sentinel

Scaleway Audit Sentinel is a standalone monitoring dashboard for Scaleway Audit Trail and authentication activity. It periodically ingests events, applies detection rules, stores alerts locally, and lets an analyst lock or unlock IAM users from the UI.

## Features

- Polls Scaleway Audit Trail events and authentication events.
- Runs deterministic detection rules for failed-login bursts, forbidden access to sensitive services, unusual authentication location/IP, and credential lifecycle changes.
- Serves a dashboard with auto-refresh, filters, alert evidence, recent events, and remediation history.
- Supports lock/unlock IAM user remediation.
- Runs in `demo` mode without credentials and `live` mode against Scaleway.
- Uses file-backed JSON persistence for local state and a JSON-lines operational log.
- Includes unit tests and Docker support.

## Quick Start

```bash
cp .env.example .env
npm test
npm start
```

On a Windows UNC/network path, `npm.cmd` may default to `C:\Windows`. If that happens, run the same commands directly with Node or move/map the folder to a drive letter:

```bash
node --test
node src/server.js
```

Open `http://localhost:3000`.

The default `SCW_MODE=demo` produces a larger synthetic dataset immediately: roughly 176 normalized events and 149 alerts. This is intentional so pagination, sorting, filtering, and remediation can be demonstrated without Scaleway credentials. Click `Run Scan` to re-run ingestion and detection.

## Live Scaleway Setup

Create `.env` from `.env.example` and set:

```bash
SCW_MODE=live
SCW_SECRET_KEY=<your-scaleway-secret-key>
SCW_ORGANIZATION_ID=<your-organization-id>
SCW_PROJECT_ID=<optional-project-id>
SCW_REGION=fr-par
```

The integration uses Scaleway's REST APIs:

- Audit Trail events: `GET /audit-trail/v1alpha1/regions/{region}/events`
- Authentication events: `GET /audit-trail/v1alpha1/regions/{region}/authentication-events`
- Lock user: `POST /iam/v1alpha1/users/{user_id}/lock`
- Unlock user: `POST /iam/v1alpha1/users/{user_id}/unlock`

Relevant docs:

- https://www.scaleway.com/en/developers/api/audit-trail/
- https://www.scaleway.com/en/developers/api/iam/

## Docker

```bash
docker build -t scaleway-audit-sentinel .
docker run --rm -p 3000:3000 --env-file .env scaleway-audit-sentinel
```

For local persistence outside the container:

```bash
docker run --rm -p 3000:3000 --env-file .env -v "$PWD/data:/app/data" -v "$PWD/logs:/app/logs" scaleway-audit-sentinel
```

## Architecture

```text
public/               Static dashboard UI
src/server.js         HTTP server and REST routes
src/scalewayClient.js Live Scaleway REST integration
src/demoData.js       Credential-free demo provider
src/poller.js         Scheduled ingestion pipeline
src/detectionRules.js Normalization and alert rules
src/remediation.js    Lock/unlock workflow and audit record
src/store.js          File-backed state store
src/logger.js         JSON-lines operational logging
```

Data is stored in `data/state.json`. Logs are written to `logs/app.log`. Both paths are configurable through `DATA_DIR` and `LOG_DIR`.

## Detection Rules

`failed-login-burst`: high severity. Raises an alert when a user has at least `FAILED_LOGIN_THRESHOLD` failed authentication events within `FAILED_LOGIN_WINDOW_MINUTES`.

`forbidden-sensitive-access`: high severity. Raises an alert on HTTP 403 audit events involving IAM, secrets, keys, credentials, tokens, passwords, or MFA-related resources.

`unusual-country`: medium severity. Raises an alert when a successful authentication comes from a country outside `ALLOWED_COUNTRY_CODES`.

`new-source-ip`: medium severity. Raises an alert when a successful authentication comes from a source IP not previously observed for a principal after that principal has a known profile.

`credential-change`: medium severity. Raises an alert on successful API key, token, or MFA lifecycle changes.

## API

- `GET /api/status`
- `GET /api/alerts?page=1&pageSize=25&status=open&severity=high&sortBy=lastSeenAt` returns `{ alerts, page, pageSize, total, totalPages, sortBy }`
- `GET /api/events?limit=25`
- `GET /api/remediations`
- `POST /api/poll`
- `POST /api/alerts/:id/remediate` with `{ "action": "lock", "actor": "analyst" }`
- `PATCH /api/alerts/:id/status` with `{ "status": "dismissed" }`

## Extensibility

New detection rules can be added in `src/detectionRules.js` without changing the HTTP layer. New remediation actions should be added in `src/remediation.js` and exposed through the alert's `remediation.actions` array. The client boundary in `src/scalewayClient.js` keeps Scaleway-specific REST behavior separate from detection and UI code.

## AI Usage

AI assistance was used to compare assignment scope, design the architecture, scaffold the Node.js application, draft the detection rules, and prepare this README. The implementation was reviewed against the assignment requirements and includes tests for the highest-risk logic.
