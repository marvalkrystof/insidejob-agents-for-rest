import { mkdir, readFile, writeFile } from "node:fs/promises";
import { sendTelegramMessage } from "../delivery/telegram";
import { loadEnvFileIfPresent, readOptionalEnv } from "../libs/env.utils";
import { parseIsoDate, pragueClock, toPragueIso } from "../libs/time.utils";
import { resolveFeatherlessModel } from "../llm/featherless";
import { selectCandidates, type Candidate } from "../pipeline/filter";
import { readCollectedItems, toPrettyJson } from "../pipeline/items-store";
import { readSeenIds, rememberDelivered } from "../pipeline/novelty";
import { COMMUTE_FIXTURE_PATH, DIGEST_PATH, FIXTURES_DIR } from "../pipeline/paths";
import { loadProfile } from "../profile";
import { commutePlanSchema, planCommute, type CommutePlan } from "../route/commute";
import { buildDigestGraph } from "./graph";
import { renderPlainText, renderTelegramHtml } from "./render";
import type { StoredDigest } from "./schema";

const SECONDS_PER_MINUTE = 60;
const CANDIDATES_SHOWN_PER_TYPE = 6;
const AS_OF_ARG_PREFIX = "--as-of=";

/** `--as-of=2026-11-16T06:30:00+01:00` renders the digest as it would arrive at that moment (demo). */
const resolveNow = (): Date => {
  const argument = process.argv.find((arg) => arg.startsWith(AS_OF_ARG_PREFIX));
  return argument ? parseIsoDate(argument.slice(AS_OF_ARG_PREFIX.length)) : new Date();
};

const loadCommutePlan = async (isOffline: boolean, plan: () => Promise<CommutePlan>): Promise<CommutePlan> => {
  if (isOffline) {
    return commutePlanSchema.parse(JSON.parse(await readFile(COMMUTE_FIXTURE_PATH, "utf8")));
  }
  const commute = await plan();
  await mkdir(FIXTURES_DIR, { recursive: true });
  await writeFile(COMMUTE_FIXTURE_PATH, toPrettyJson(commute));
  return commute;
};

const printCommute = (commute: CommutePlan): void => {
  console.log(`Next commute: arrive at P+R ${commute.arriveAt}, usual departure ${pragueClock(new Date(commute.usualDepartureTime))}`);
  commute.options.forEach(({ parkAndRide, route }) => {
    const minutes = Math.round(route.travelTimeSeconds / SECONDS_PER_MINUTE);
    const delay = Math.round(route.trafficDelaySeconds / SECONDS_PER_MINUTE);
    console.log(`  ${parkAndRide.padEnd(20)} leave ${pragueClock(new Date(route.departureTime))}, ${minutes} min (delay ${delay} min), ${(route.lengthMeters / 1000).toFixed(1)} km`);
  });
};

const printCandidates = (candidates: readonly Candidate[]): void => {
  Map.groupBy(candidates, (candidate) => candidate.item.type).forEach((group, type) => {
    console.log(`\n${type} (${group.length})`);
    group.slice(0, CANDIDATES_SHOWN_PER_TYPE).forEach(({ item, reason }) => {
      const when = item.timeRange ? item.timeRange.from.slice(0, 16).replace("T", " ") : "";
      console.log(`  - [${when}] ${item.title.slice(0, 80)}\n      ${reason}`);
    });
  });
};

const deliverToTelegram = async (stored: StoredDigest): Promise<boolean> => {
  const botToken = readOptionalEnv("TELEGRAM_BOT_TOKEN");
  const chatId = readOptionalEnv("TELEGRAM_CHAT_ID");
  if (!botToken || !chatId) {
    console.warn("Telegram skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is empty (see yarn check:apis)");
    return false;
  }
  await sendTelegramMessage(botToken, chatId, renderTelegramHtml(stored));
  return true;
};

const main = async (): Promise<void> => {
  loadEnvFileIfPresent();
  const isOffline = process.argv.includes("--offline");
  const isDryRun = process.argv.includes("--dry-run");
  const isVerbose = process.argv.includes("--verbose");
  const profile = await loadProfile();
  const now = resolveNow();

  const { items, collectedAt } = await readCollectedItems();
  const commute = await loadCommutePlan(isOffline, () => planCommute(profile, now));
  const candidates = selectCandidates(items, {
    profile,
    now,
    routes: commute.options.map(({ parkAndRide, route }) => ({ parkAndRide, polyline: route.polyline })),
  });
  console.log(`Items collected at ${collectedAt}: ${items.length}, candidates after hard filters: ${candidates.length}`);
  printCommute(commute);
  if (isVerbose) {
    printCandidates(candidates);
  }

  const seenIds = await readSeenIds();
  const startedAt = Date.now();
  const result = await buildDigestGraph().invoke(
    { profile, commute, candidates, seenIds: [...seenIds], now: toPragueIso(now) },
    { configurable: { thread_id: `digest:${profile.name}` } },
  );
  const stored: StoredDigest = {
    generatedAt: toPragueIso(new Date()),
    asOf: toPragueIso(now),
    model: resolveFeatherlessModel(),
    commute,
    entries: result.entries,
    digest: result.digest,
  };
  await writeFile(DIGEST_PATH, toPrettyJson(stored));
  console.log(`\nDigest (${stored.model}, ${Date.now() - startedAt} ms) -> ${DIGEST_PATH}\n`);
  console.log(renderPlainText(stored));

  if (isDryRun) {
    console.log("\nDry run: not delivered, novelty store unchanged.");
    return;
  }
  if (await deliverToTelegram(stored)) {
    await rememberDelivered(
      stored.entries.map((entry) => entry.itemId),
      stored.generatedAt,
    );
    console.log("\nDelivered to Telegram.");
  }
};

await main();
