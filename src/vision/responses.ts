export interface ResponsesClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface StructuredRequest {
  model: string;
  input: unknown[];
  schema: Record<string, unknown>;
  name: string;
  maxOutputTokens?: number;
}

export interface StructuredResult<T> {
  data: T;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

interface ResponseBody {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: StructuredResult<unknown>["usage"];
}

export function extractOutputText(body: ResponseBody): string | null {
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
}

export class ResponsesClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ResponsesClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async structured<T>(request: StructuredRequest): Promise<StructuredResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 60_000,
    );
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (this.options.apiKey) {
        headers.authorization = `Bearer ${this.options.apiKey}`;
      }
      const response = await this.fetchImpl(
        `${this.options.baseUrl.replace(/\/$/, "")}/responses`,
        {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: request.model,
            input: request.input,
            ...(request.maxOutputTokens === undefined
              ? {}
              : { max_output_tokens: request.maxOutputTokens }),
            text: {
              format: {
                type: "json_schema",
                name: request.name,
                strict: true,
                schema: request.schema,
              },
            },
          }),
        },
      );

      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `Responses API ${response.status}: ${text.slice(0, 300)}`,
        );
      }

      let body: ResponseBody;
      try {
        body = JSON.parse(text) as ResponseBody;
      } catch {
        throw new Error(`Responses API returned non-JSON: ${text.slice(0, 200)}`);
      }

      const output = extractOutputText(body);
      if (!output) throw new Error("Responses API returned no output text");

      let data: T;
      try {
        data = JSON.parse(output) as T;
      } catch {
        throw new Error(
          `Responses API returned invalid JSON: ${output.slice(0, 200)}`,
        );
      }
      return { data, usage: body.usage };
    } finally {
      clearTimeout(timer);
    }
  }
}
