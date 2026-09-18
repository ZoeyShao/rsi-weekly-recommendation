export class OmaHttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "OmaHttpError";
    this.status = status;
    this.body = body;
  }
}

export class OmaClient {
  constructor({ baseUrl, apiKey, fetchFn = fetch }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  async request(path, options = {}) {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(30_000),
      ...options,
      headers: {
        "x-api-key": this.apiKey,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      let body = text;
      try { body = JSON.parse(text); } catch {}
      const detail = typeof body === "object" && body?.error ? body.error : text;
      throw new OmaHttpError(`OMA request failed (${response.status}): ${detail || response.statusText}`, response.status, body);
    }
    if (!text) return null;
    const contentType = response.headers.get("content-type") ?? "";
    return contentType.includes("application/json") ? JSON.parse(text) : text;
  }

  createSession(agentId, workspaceName) {
    return this.request("/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ agent: agentId, workspace_name: workspaceName }),
    });
  }

  submitMessage(sessionId, text) {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/events`, {
      method: "POST",
      body: JSON.stringify({
        events: [{
          type: "user.message",
          data: { content: [{ type: "text", text }] },
        }],
      }),
    });
  }

  getSession(sessionId) {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  getSessionEvents(sessionId, afterSeq = 0) {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/events?after_seq=${afterSeq}&limit=100`);
  }

  async getWorkspaceText(workspaceId, path) {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    try {
      const value = await this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/files/${encodedPath}`);
      if (value && typeof value === "object" && typeof value.url === "string") {
        const signedUrl = new URL(value.url);
        const isLocalHttp = signedUrl.protocol === "http:"
          && ["localhost", "127.0.0.1", "::1"].includes(signedUrl.hostname);
        if (signedUrl.protocol !== "https:" && !isLocalHttp) {
          throw new Error("OMA returned an unsafe Workspace preview URL");
        }
        // The signed URL is already its own short-lived credential. Fetch it
        // directly and never forward the Tenant's OMA API key to object storage.
        const response = await this.fetchFn(signedUrl.toString(), { redirect: "follow" });
        if (!response.ok) {
          throw new OmaHttpError(
            `OMA Workspace preview download failed (${response.status})`,
            response.status,
            null,
          );
        }
        return response.text();
      }
      return typeof value === "string" ? value : JSON.stringify(value);
    } catch (error) {
      if (error instanceof OmaHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async terminateSession(sessionId) {
    try {
      await this.request(`/v1/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    } catch (error) {
      if (!(error instanceof OmaHttpError && [404, 410].includes(error.status))) throw error;
    }
  }
}
