import { z } from "zod";
import { loadEnvFileIfPresent, readOptionalEnv } from "./libs/env.utils";
import { describeError } from "./libs/error.utils";
import { fetchJson } from "./libs/http.utils";
import { FEATHERLESS_BASE_URL, resolveFeatherlessModel } from "./llm/featherless";
import { loadProfile, type Profile } from "./profile";

type CheckStatus = "OK" | "FAIL" | "MISSING KEY";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

interface ApiCheck {
  name: string;
  envVar: string;
  run: (secret: string, profile: Profile) => Promise<string>;
}

const SECONDS_PER_MINUTE = 60;
const METERS_PER_KILOMETER = 1000;

const checkGolemio = async (apiKey: string): Promise<string> => {
  const url = "https://api.golemio.cz/v3/parking?parkingPolicy[]=park_and_ride&limit=200";
  const response = await fetchJson(url, { headers: { "X-Access-Token": apiKey } });
  const features = z.object({ features: z.array(z.unknown()) }).safeParse(response);
  if (features.success) {
    return `${features.data.features.length} P+R locations (GeoJSON)`;
  }
  const list = z.array(z.unknown()).safeParse(response);
  if (list.success) {
    return `${list.data.length} P+R locations (array)`;
  }
  return `responded, unexpected shape: ${Object.keys(response ?? {}).join(", ")}`;
};

const checkTomTom = async (apiKey: string, profile: Profile): Promise<string> => {
  const [parkAndRide] = profile.commute.parkAndRideCandidates;
  if (!parkAndRide) {
    throw new Error("Profile has no park-and-ride candidate");
  }
  const { home } = profile;
  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/${home.lat},${home.lon}:${parkAndRide.lat},${parkAndRide.lon}/json` +
    `?traffic=true&key=${encodeURIComponent(apiKey)}`;
  const route = z
    .object({
      routes: z
        .array(
          z.object({
            summary: z.object({
              lengthInMeters: z.number(),
              travelTimeInSeconds: z.number(),
              trafficDelayInSeconds: z.number(),
            }),
          }),
        )
        .min(1),
    })
    .parse(await fetchJson(url));
  const summary = route.routes[0]?.summary;
  if (!summary) {
    throw new Error("TomTom returned no route");
  }
  const minutes = Math.round(summary.travelTimeInSeconds / SECONDS_PER_MINUTE);
  const delayMinutes = Math.round(summary.trafficDelayInSeconds / SECONDS_PER_MINUTE);
  const kilometers = (summary.lengthInMeters / METERS_PER_KILOMETER).toFixed(1);
  return `home -> ${parkAndRide.name}: ${minutes} min now (${delayMinutes} min traffic delay), ${kilometers} km`;
};

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z.array(z.object({ function: z.object({ name: z.string(), arguments: z.string() }) })).nullish(),
        }),
      }),
    )
    .min(1),
});

const checkFeatherless = async (apiKey: string, model: string): Promise<string> => {
  const startedAt = Date.now();
  const body = {
    model,
    temperature: 0,
    max_tokens: 600,
    messages: [{ role: "user", content: "When does the planned power outage on Pekařská street in Kladno end? Use the tool." }],
    tools: [
      {
        type: "function",
        function: {
          name: "get_power_outage",
          description: "Look up a planned power outage by street name",
          parameters: { type: "object", properties: { street: { type: "string" } }, required: ["street"] },
        },
      },
    ],
  };
  const response = await fetchJson(`${FEATHERLESS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const completion = completionSchema.safeParse(response);
  if (!completion.success) {
    throw new Error(`${model}: unexpected response ${JSON.stringify(response).slice(0, 300)}`);
  }
  const elapsedMs = Date.now() - startedAt;
  const choice = completion.data.choices[0];
  const [toolCall] = choice?.message.tool_calls ?? [];
  if (!toolCall) {
    const contentPreview = (choice?.message.content ?? "").replace(/\s+/g, " ").slice(0, 160);
    return `${model}: NO tool call in ${elapsedMs} ms, finish=${choice?.finish_reason}, content="${contentPreview}"`;
  }
  return `${model}: tool call ${toolCall.function.name}(${toolCall.function.arguments}) in ${elapsedMs} ms`;
};

const checkTelegram = async (botToken: string): Promise<string> => {
  const baseUrl = `https://api.telegram.org/bot${botToken}`;
  const me = z.object({ result: z.object({ id: z.number(), username: z.string() }) }).parse(await fetchJson(`${baseUrl}/getMe`));
  const botName = `@${me.result.username}`;
  const configuredChatId = readOptionalEnv("TELEGRAM_CHAT_ID");
  // The bot id is the number before ":" in the token, so it is easily mistaken for the chat id.
  const isBotOwnId = configuredChatId === String(me.result.id);
  if (configuredChatId && !isBotOwnId) {
    return `${botName}, TELEGRAM_CHAT_ID is set`;
  }
  const updates = z
    .object({ result: z.array(z.object({ message: z.object({ chat: z.object({ id: z.number() }) }).optional() })) })
    .parse(await fetchJson(`${baseUrl}/getUpdates`));
  const chatIds = [...new Set(updates.result.flatMap((update) => (update.message ? [update.message.chat.id] : [])))];
  const nextStep =
    chatIds.length === 0
      ? `send any message to ${botName} and run this again`
      : `put this into TELEGRAM_CHAT_ID: ${chatIds.join(" or ")}`;
  if (isBotOwnId) {
    throw new Error(`TELEGRAM_CHAT_ID is ${botName}'s own id, and a bot cannot message itself; ${nextStep}`);
  }
  if (chatIds.length === 0) {
    return `${botName} works, but TELEGRAM_CHAT_ID is empty: ${nextStep}`;
  }
  return `${botName} works; ${nextStep}`;
};

const checkApify = async (token: string): Promise<string> => {
  const me = z
    .object({ data: z.object({ username: z.string() }) })
    .parse(await fetchJson("https://api.apify.com/v2/users/me", { headers: { authorization: `Bearer ${token}` } }));
  return `authenticated as ${me.data.username}`;
};

const API_CHECKS: readonly ApiCheck[] = [
  { name: "Golemio", envVar: "GOLEMIO_API_KEY", run: checkGolemio },
  { name: "TomTom", envVar: "TOMTOM_API_KEY", run: checkTomTom },
  { name: "Featherless", envVar: "FEATHERLESS_API_KEY", run: (apiKey) => checkFeatherless(apiKey, resolveFeatherlessModel()) },
  { name: "Telegram", envVar: "TELEGRAM_BOT_TOKEN", run: checkTelegram },
  { name: "Apify", envVar: "APIFY_TOKEN", run: checkApify },
];

const runCheck = async (check: ApiCheck, profile: Profile): Promise<CheckResult> => {
  const secret = readOptionalEnv(check.envVar);
  if (!secret) {
    return { name: check.name, status: "MISSING KEY", detail: `${check.envVar} is empty in .env` };
  }
  try {
    return { name: check.name, status: "OK", detail: await check.run(secret, profile) };
  } catch (error) {
    return { name: check.name, status: "FAIL", detail: describeError(error) };
  }
};

const MODELS_ARG_PREFIX = "--models=";

/** `yarn check:apis --models=a,b` compares Featherless models one by one (sequentially, to respect concurrency limits). */
const readModelsToCompare = (): string[] => {
  const argument = process.argv.find((arg) => arg.startsWith(MODELS_ARG_PREFIX));
  if (!argument) {
    return [];
  }
  return argument.slice(MODELS_ARG_PREFIX.length).split(",").filter(Boolean);
};

const runChecks = async (profile: Profile): Promise<CheckResult[]> => {
  const modelsToCompare = readModelsToCompare();
  if (modelsToCompare.length === 0) {
    return Promise.all(API_CHECKS.map((check) => runCheck(check, profile)));
  }
  const results: CheckResult[] = [];
  for (const model of modelsToCompare) {
    const check: ApiCheck = { name: "Featherless", envVar: "FEATHERLESS_API_KEY", run: (apiKey) => checkFeatherless(apiKey, model) };
    results.push(await runCheck(check, profile));
  }
  return results;
};

const main = async (): Promise<void> => {
  loadEnvFileIfPresent();
  const profile = await loadProfile();
  const results = await runChecks(profile);
  results.forEach(({ name, status, detail }) => {
    console.log(`${name.padEnd(12)} ${status.padEnd(12)} ${detail}`);
  });
  if (results.some((result) => result.status === "FAIL")) {
    process.exitCode = 1;
  }
};

await main();
