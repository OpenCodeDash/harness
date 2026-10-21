import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { serializeBrief, toYaml } from "../brief/brief.ts";
import type { CampaignManager, CampaignRuntime } from "./manager.ts";

export interface DaemonServerOptions {
  manager: CampaignManager;
  token?: string;
  host?: string;
  port?: number;
}

export interface DaemonServer {
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

function authorized(req: IncomingMessage, token?: string): boolean {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

function streamEvents(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: CampaignRuntime,
  manager: CampaignManager,
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const sendEvent = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  sendEvent({ type: "status", campaign: manager.status(runtime) });

  const listener = (payload: unknown) => sendEvent(payload);
  runtime.events.on("event", listener);
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);

  req.on("close", () => {
    clearInterval(ping);
    runtime.events.off("event", listener);
  });
}

export function createDaemonServer(options: DaemonServerOptions): DaemonServer {
  const { manager } = options;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const segments = path.split("/").filter(Boolean);

    if (path === "/health") {
      return send(res, 200, { status: "ok" });
    }

    if (!authorized(req, options.token)) {
      return send(res, 401, { error: "unauthorized" });
    }

    try {
      if (segments[0] !== "campaigns") {
        return send(res, 404, { error: `no route for ${req.method} ${path}` });
      }

      if (
        segments.length === 2 &&
        segments[1] === "preview" &&
        req.method === "POST"
      ) {
        const body = await readJson(req);
        const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
        if (!prompt) return send(res, 400, { error: "prompt is required" });
        const preview = await manager.preview({
          prompt,
        });
        return send(res, 200, {
          brief: toYaml(preview.brief),
          criteria: preview.brief.criteria,
          echo: preview.echo,
          warnings: preview.brief.warnings,
        });
      }

      if (segments.length === 1) {
        if (req.method === "GET") {
          return send(res, 200, { campaigns: manager.list() });
        }
        if (req.method === "POST") {
          const body = await readJson(req);
          const prompt =
            typeof body.prompt === "string" ? body.prompt.trim() : undefined;
          const brief =
            typeof body.brief === "string" ||
            (body.brief !== null &&
              typeof body.brief === "object" &&
              !Array.isArray(body.brief))
              ? (body.brief as string | Record<string, unknown>)
              : undefined;
          if (!prompt && !brief) {
            return send(res, 400, { error: "prompt or brief is required" });
          }
          const runtime = await manager.create({
            prompt,
            brief,
              name: typeof body.name === "string" ? body.name : undefined,
          });
          manager.start(runtime.record.id);
          return send(res, 202, { campaign: manager.status(runtime) });
        }
        return send(res, 405, { error: "method not allowed" });
      }

      const runtime = manager.get(segments[1]!);
      if (!runtime) {
        return send(res, 404, { error: "campaign not found" });
      }
      const action = segments[2];

      if (!action) {
        if (req.method !== "GET") {
          return send(res, 405, { error: "method not allowed" });
        }
        return send(res, 200, {
          campaign: manager.status(runtime),
          brief: serializeBrief(runtime.brief),
          criteria: runtime.brief.criteria,
          warnings: runtime.brief.warnings,
        });
      }

      if (action === "results" && req.method === "GET") {
        return send(res, 200, manager.results(runtime.record.id));
      }

      if (action === "export.csv" && req.method === "GET") {
        res.setHeader(
          "content-disposition",
          `attachment; filename="${runtime.record.id}.csv"`,
        );
        return send(res, 200, manager.exportCsv(runtime.record.id), "text/csv");
      }

      if (action === "events" && req.method === "GET") {
        return streamEvents(req, res, runtime, manager);
      }

      if (action === "feedback" && req.method === "POST") {
        const body = await readJson(req);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return send(res, 400, { error: "text is required" });
        return send(res, 200, await manager.feedback(runtime.record.id, text));
      }

      if (action === "pause" && req.method === "POST") {
        manager.pause(runtime.record.id);
        return send(res, 200, { campaign: manager.status(runtime) });
      }

      if (action === "resume" && req.method === "POST") {
        manager.resume(runtime.record.id);
        return send(res, 200, { campaign: manager.status(runtime) });
      }

      if (action === "stop" && req.method === "POST") {
        manager.stop(runtime.record.id);
        return send(res, 200, { campaign: manager.status(runtime) });
      }

      return send(res, 404, { error: `no route for ${req.method} ${path}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return send(res, 500, { error: message });
    }
  });

  return {
    server,
    listen(port = options.port ?? 7332, host = options.host ?? "127.0.0.1") {
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
