import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface BrowserConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function defaultBrowserConfig(): BrowserConfig {
  return {
    command: process.env.HARNESS_BROWSER_COMMAND ?? "npx",
    args: [
      "-y",
      "chrome-devtools-mcp@latest",
      `--executablePath=${process.env.CHROME_PATH ?? "chromium"}`,
      "--isolated",
      "--no-usage-statistics",
    ],
  };
}

export function parseSelectedPageId(text: string): number | null {
  const selected = /^\s*(\d+):.*\[selected\]/m.exec(text);
  if (selected?.[1]) return Number(selected[1]);
  const all = [...text.matchAll(/^\s*(\d+):/gm)];
  const last = all.at(-1);
  return last?.[1] ? Number(last[1]) : null;
}

export function parseEvaluateResult(text: string): unknown {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text);
  const payload = (fence?.[1] ?? text).trim();
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return payload;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export interface BrowserPage {
  readonly pageId: number;
  goto(url: string): Promise<void>;
  evaluate<T>(script: string): Promise<T>;
  waitFor(script: string, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class McpPage implements BrowserPage {
  constructor(
    private readonly browser: McpBrowser,
    readonly pageId: number,
  ) {}

  async goto(url: string): Promise<void> {
    await this.browser.call("navigate_page", { pageId: this.pageId, type: "url", url });
  }

  async evaluate<T>(script: string): Promise<T> {
    const text = await this.browser.call("evaluate_script", {
      pageId: this.pageId,
      function: script,
    });
    return parseEvaluateResult(text) as T;
  }

  async waitFor(script: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ready = await this.evaluate<unknown>(script);
      if (ready) return;
      await sleep(500);
    }
    throw new Error(`page ${this.pageId}: timed out waiting for readiness`);
  }

  async close(): Promise<void> {
    await this.browser.call("close_page", { pageId: this.pageId });
  }
}

export class McpBrowser {
  private constructor(private readonly client: Client) {}

  static async connect(config: BrowserConfig = defaultBrowserConfig()): Promise<McpBrowser> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ?? { ...process.env } as Record<string, string>,
    });
    const client = new Client({ name: "harness", version: "0.1.0" });
    await client.connect(transport);
    return new McpBrowser(client);
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.client.callTool({
      name,
      arguments: args,
    })) as {
      isError?: boolean;
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (result.content ?? [])
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n");
    if (result.isError) throw new Error(text || `${name} failed`);
    return text;
  }

  async newPage(url: string): Promise<BrowserPage> {
    const text = await this.call("new_page", { url });
    let pageId = parseSelectedPageId(text);
    if (pageId === null) {
      const pages = await this.call("list_pages", {});
      pageId = parseSelectedPageId(pages);
    }
    if (pageId === null) throw new Error("could not determine browser page id");
    return new McpPage(this, pageId);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
