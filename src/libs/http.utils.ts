import { describeError } from "./error.utils";

const USER_AGENT = "Domovnik/0.1 (hackathon prototype)";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 2;
const ERROR_BODY_PREVIEW_LENGTH = 300;
const SECRET_QUERY_PARAM_PATTERN = /([?&](?:key|api_key|apikey|token)=)[^&]+/gi;
const TELEGRAM_BOT_TOKEN_PATTERN = /\/bot[^/]+\//;

interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

/** Keeps API keys passed in URLs (TomTom query param, Telegram bot path) out of error messages and logs. */
export const redactUrl = (url: string): string =>
  url.replace(SECRET_QUERY_PARAM_PATTERN, "$1***").replace(TELEGRAM_BOT_TOKEN_PATTERN, "/bot***/");

const requestOnce = (url: string, options: RequestOptions): Promise<Response> =>
  fetch(url, {
    method: options.method ?? "GET",
    headers: { "user-agent": USER_AGENT, ...options.headers },
    body: options.body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

export const fetchText = async (url: string, options: RequestOptions = {}): Promise<string> => {
  const method = options.method ?? "GET";
  for (let attempt = 1; ; attempt += 1) {
    const isLastAttempt = attempt >= MAX_ATTEMPTS;
    let response: Response;
    try {
      response = await requestOnce(url, options);
    } catch (error) {
      if (isLastAttempt) {
        const reason = describeError(error);
        throw new Error(`${method} ${redactUrl(url)} failed: ${reason}`);
      }
      continue;
    }
    if (response.ok) {
      return response.text();
    }
    if (isLastAttempt || !isRetryableStatus(response.status)) {
      const errorBody = (await response.text()).slice(0, ERROR_BODY_PREVIEW_LENGTH);
      throw new Error(`${method} ${redactUrl(url)} -> HTTP ${response.status} ${errorBody}`.trim());
    }
  }
};

export const fetchJson = async (url: string, options: RequestOptions = {}): Promise<unknown> => {
  const body = await fetchText(url, { ...options, headers: { accept: "application/json", ...options.headers } });
  return JSON.parse(body);
};
