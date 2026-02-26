/**
 * HTTP client for fathom-server REST API.
 *
 * Handles search, rooms, workspaces, and access notifications.
 * Uses native fetch (Node 18+). Auth via Bearer token from .fathom.json.
 */

/**
 * @param {object} config - Resolved config from config.js
 */
export function createClient(config) {
  const baseUrl = config.server;
  const apiKey = config.apiKey;
  const workspace = config.workspace;

  /**
   * Make an authenticated request to the server.
   * Returns parsed JSON on success, { error } on failure.
   */
  async function request(method, path, { params, body, timeout = 30000 } = {}) {
    const url = new URL(path, baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    }

    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const resp = await fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await resp.json();

      if (!resp.ok) {
        return { error: data.error || `Server returned ${resp.status}` };
      }

      return data;
    } catch (e) {
      if (e.name === "AbortError") {
        return { error: `Request timed out after ${timeout / 1000}s` };
      }
      return { error: `Server unavailable: ${e.message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Search ----------------------------------------------------------------

  async function search(query, { mode = "bm25", limit, ws } = {}) {
    return request("GET", "/api/search", {
      params: { q: query, mode, n: limit, workspace: ws || workspace },
    });
  }

  async function vsearch(query, { limit, ws } = {}) {
    return search(query, { mode: "vector", limit, ws });
  }

  async function hybridSearch(query, { limit, ws } = {}) {
    return search(query, { mode: "hybrid", limit, ws });
  }

  // --- Rooms -----------------------------------------------------------------

  async function roomPost(room, message, sender) {
    return request("POST", `/api/room/${encodeURIComponent(room)}`, {
      body: { message, sender },
    });
  }

  async function roomRead(room, hours) {
    return request("GET", `/api/room/${encodeURIComponent(room)}`, {
      params: { hours },
    });
  }

  async function roomList() {
    return request("GET", "/api/room/list");
  }

  async function roomDescribe(room, description) {
    return request("PUT", `/api/room/${encodeURIComponent(room)}/description`, {
      body: { description },
    });
  }

  // --- Workspaces ------------------------------------------------------------

  async function listWorkspaces() {
    return request("GET", "/api/workspaces/profiles");
  }

  async function registerWorkspace(name, projectPath, { vault, description, agents, type } = {}) {
    const body = { name, path: projectPath };
    if (vault) body.vault = vault;
    if (description) body.description = description;
    if (agents && agents.length > 0) body.agents = agents;
    if (type) body.type = type;
    return request("POST", "/api/workspaces", { body });
  }

  // --- Access tracking -------------------------------------------------------

  async function notifyAccess(filePath, ws) {
    return request("POST", "/api/vault/access", {
      params: { workspace: ws || workspace },
      body: { path: filePath },
    });
  }

  // --- Activity-enriched listings (via server) --------------------------------

  async function vaultList(ws) {
    return request("GET", "/api/vault", {
      params: { workspace: ws || workspace },
    });
  }

  async function vaultFolder(folder, ws) {
    const folderPath = folder || "";
    return request("GET", `/api/vault/folder/${folderPath}`, {
      params: { workspace: ws || workspace },
    });
  }

  // --- Auth ------------------------------------------------------------------

  async function getApiKey() {
    return request("GET", "/api/auth/key");
  }

  async function healthCheck() {
    try {
      const resp = await fetch(`${baseUrl}/api/auth/status`, {
        signal: AbortSignal.timeout(5000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  return {
    search,
    vsearch,
    hybridSearch,
    roomPost,
    roomRead,
    roomList,
    roomDescribe,
    listWorkspaces,
    registerWorkspace,
    notifyAccess,
    vaultList,
    vaultFolder,
    getApiKey,
    healthCheck,
  };
}
