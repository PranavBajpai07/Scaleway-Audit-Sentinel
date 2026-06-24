export class ScalewayClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async listAuditEvents({ recordedAfter, recordedBefore } = {}) {
    return this.#listPaginated("/audit-trail/v1alpha1/regions/{region}/events", {
      organization_id: this.config.organizationId,
      project_id: this.config.projectId,
      recorded_after: recordedAfter,
      recorded_before: recordedBefore,
      order_by: "recorded_at_asc",
      page_size: String(this.config.pageSize)
    }, "events");
  }

  async listAuthenticationEvents({ recordedAfter, recordedBefore } = {}) {
    return this.#listPaginated("/audit-trail/v1alpha1/regions/{region}/authentication-events", {
      organization_id: this.config.organizationId,
      recorded_after: recordedAfter,
      recorded_before: recordedBefore,
      order_by: "recorded_at_asc",
      page_size: String(this.config.pageSize)
    }, "events");
  }

  async lockUser(userId) {
    return this.#request(`/iam/v1alpha1/users/${encodeURIComponent(userId)}/lock`, {
      method: "POST",
      body: {}
    });
  }

  async unlockUser(userId) {
    return this.#request(`/iam/v1alpha1/users/${encodeURIComponent(userId)}/unlock`, {
      method: "POST",
      body: {}
    });
  }

  async #listPaginated(templatePath, query, collectionKey) {
    const results = [];
    let pageToken = "";

    do {
      const payload = await this.#request(templatePath.replace("{region}", this.config.region), {
        method: "GET",
        query: {
          ...query,
          page_token: pageToken
        }
      });

      results.push(...(payload[collectionKey] || []));
      pageToken = payload.next_page_token || "";
    } while (pageToken);

    return results;
  }

  async #request(resourcePath, { method = "GET", query = {}, body } = {}) {
    const url = new URL(resourcePath, this.config.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        "X-Auth-Token": this.config.secretKey,
        "Content-Type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.warn("Scaleway API request failed", {
        method,
        url: url.toString(),
        status: response.status,
        body: text.slice(0, 500)
      });
      throw new Error(`Scaleway API ${method} ${resourcePath} failed with ${response.status}`);
    }

    if (response.status === 204) return {};
    return response.json();
  }
}
