import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { echoBrief, serializeBrief } from "../brief/brief.ts";
import type { Brief } from "../brief/types.ts";
import type { CampaignStore } from "../campaign/store.ts";
import { applyFeedbackWithInterpreter } from "../feedback/model.ts";
import type { FeedbackInterpreter } from "../feedback/model.ts";
import { persistScores, scoreCampaign } from "../runner/score.ts";

export interface ControlState {
  store: CampaignStore;
  brief: Brief;
  paused: boolean;
  token?: string;
  feedbackInterpreter?: FeedbackInterpreter;
  runId?: number;
  lastSummary?: unknown;
  onResearch?: (brief: Brief) => Promise<unknown>;
  onResume?: (runId: number) => Promise<unknown>;
}

export interface ControlServer {
  server: Server;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

const MAX_BODY = 1_000_000;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  contentType = "application/json",
): void {
  const payload =
    typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": `${contentType}; charset=utf-8` });
  res.end(payload);
}

function statusBody(state: ControlState) {
  const scored = scoreCampaign(state.store, state.brief);
  const latest = state.store.latestBrief();
  return {
    paused: state.paused,
    runId: state.runId ?? null,
    run: state.runId ? state.store.getRun(state.runId) : null,
    briefVersion: latest?.id ?? null,
    brief: echoBrief(state.brief),
    counts: {
      listings: state.store.listListings().length,
      hardPass: scored.hardPass,
      withGaps: scored.withGaps,
    },
    lastSummary: state.lastSummary ?? null,
  };
}

function authorized(req: IncomingMessage, token?: string): boolean {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

export function createControlServer(state: ControlState): ControlServer {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      if (!authorized(req, state.token)) {
        return send(res, 401, { error: "unauthorized" });
      }
      if (req.method === "GET" && path === "/status") {
        return send(res, 200, statusBody(state));
      }

      if (req.method === "GET" && path === "/brief") {
        return send(res, 200, serializeBrief(state.brief), "text/yaml");
      }

      if (req.method === "GET" && path === "/export.csv") {
        const scored = scoreCampaign(state.store, state.brief);
        res.setHeader(
          "content-disposition",
          'attachment; filename="latest.csv"',
        );
        return send(res, 200, scored.csv, "text/csv");
      }

      if (req.method === "POST" && path === "/feedback") {
        const body = await readJson(req);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return send(res, 400, { error: "text is required" });

        const applied = await applyFeedbackWithInterpreter(
          state.brief,
          text,
          state.feedbackInterpreter,
        );
        const feedback = state.store.addFeedback(
          text,
          applied.delta.action,
          applied.delta,
        );

        if (!applied.changed) {
          return send(res, 200, {
            changed: false,
            summary: applied.summary,
            action: applied.delta.action,
          });
        }

        state.brief = applied.brief;
        const version = state.store.saveBrief(
          serializeBrief(state.brief),
          state.brief.prompt,
        );
        const scored = scoreCampaign(state.store, state.brief);
        persistScores(state.store, version.id, scored.items);
        state.store.markFeedbackApplied(feedback.id);

        if (applied.delta.action === "re-search" && state.onResearch) {
          state.paused = false;
          state.lastSummary = await state.onResearch(state.brief);
          const summary = state.lastSummary as { runId?: number } | undefined;
          if (summary?.runId) state.runId = summary.runId;
        }

        return send(res, 200, {
          changed: true,
          summary: applied.summary,
          action: applied.delta.action,
          briefVersion: version.id,
          rescored: scored.items.length,
          run: state.lastSummary ?? null,
        });
      }

      if (req.method === "POST" && path === "/pause") {
        state.paused = true;
        return send(res, 200, { paused: true });
      }

      if (req.method === "POST" && path === "/resume") {
        state.paused = false;
        if (state.onResume && state.runId) {
          state.lastSummary = await state.onResume(state.runId);
          const summary = state.lastSummary as { runId?: number } | undefined;
          if (summary?.runId) state.runId = summary.runId;
        }
        return send(res, 200, { paused: false, run: state.lastSummary ?? null });
      }

      if (req.method === "POST" && path === "/run") {
        if (!state.onResearch) {
          return send(res, 400, { error: "no research runner configured" });
        }
        state.paused = false;
        state.lastSummary = await state.onResearch(state.brief);
        const summary = state.lastSummary as { runId?: number } | undefined;
        if (summary?.runId) state.runId = summary.runId;
        return send(res, 200, { run: state.lastSummary });
      }

      return send(res, 404, { error: `no route for ${req.method} ${path}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return send(res, 500, { error: message });
    }
  });

  return {
    server,
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("server did not bind to a port"));
            return;
          }
          resolve(address.port);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
