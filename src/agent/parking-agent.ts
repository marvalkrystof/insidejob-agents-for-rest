import { createInterface } from "node:readline/promises";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MCPAdapter } from "@langchain/mcp-adapters";
import { loadEnvFileIfPresent } from "../libs/env.utils";
import { addDays, atPragueClock, formatDateTimeLabel, isCzechPublicHoliday, toPragueIso } from "../libs/time.utils";
import { createFeatherlessChatModel } from "../llm/featherless";
import { loadProfile, type Profile } from "../profile";

const DEMO_QUESTION = "Where do I park near Holešovice tomorrow at 8 and what will it cost?";
const PARKING_SERVER_ENTRY = "src/mcp/parking-server.ts";
// MemorySaver keeps one conversation per thread for the lifetime of the process.
const THREAD_ID = "parking-agent-cli";
const ASSUMED_STAY_HOURS = 9;
const EXAMPLE_ARRIVAL_CLOCK = "08:00";
const TOOL_RESULT_PREVIEW_LENGTH = 400;

/** The home address is left out: the LLM does not need it to find parking at a destination. */
const describeKnownPlaces = ({ work, commute }: Profile): string =>
  [{ name: `Work, ${work.label}`, lat: work.lat, lon: work.lon }, ...commute.parkAndRideCandidates]
    .map(({ name, lat, lon }) => `- ${name}: lat ${lat}, lon ${lon}`)
    .join("\n");

/** Dates are computed here so the LLM never has to work out what "tomorrow" is. */
const buildSystemPrompt = (profile: Profile, now: Date): string => {
  const tomorrowExample = atPragueClock(addDays(now, 1), EXAMPLE_ARRIVAL_CLOCK);
  const holidayLabel = isCzechPublicHoliday(tomorrowExample) ? "a Czech public holiday" : "not a public holiday";
  return [
    "You are Domovník's parking assistant for Prague. You answer from the parking tools only.",
    "",
    `Now is ${formatDateTimeLabel(now)} (Europe/Prague). Tomorrow at ${EXAMPLE_ARRIVAL_CLOCK} is ${formatDateTimeLabel(tomorrowExample)}, ` +
      `in ISO 8601 ${toPragueIso(tomorrowExample)}; tomorrow is ${holidayLabel}.`,
    "",
    "Known places (use these coordinates when the user names them or a part of their name):",
    describeKnownPlaces(profile),
    "",
    "Rules:",
    "- Take every price, distance and availability figure from a tool result; never compute or guess one yourself.",
    "- Pass times as ISO 8601 with the Prague offset, like the example above.",
    `- If the user gives no end time, assume a ${ASSUMED_STAY_HOURS}-hour working day from arrival ` +
      `(durationMinutes ${ASSUMED_STAY_HOURS * 60}) and say that you assumed it.`,
    "- Never recommend a place whose price.fitsStay is false; mention it at most as a short-stay option with its maximum stay.",
    '- Word each figure by its confidence: live = measured now or the current tariff; historical = "usually"; ' +
      "estimate = say that there is no data or that the data does not cover it.",
    "- A price of 0 with confidence estimate means the tariff does not cover that time, not that parking is free.",
    '- Distances are straight lines from the destination: say "about N m".',
    "- Prices are in CZK. Do not mention conditions (tickets, permits, opening hours) that no tool result states.",
    "- Answer in English and briefly: one line with the arrival and stay you priced (weekday, date, times, and whether the length is assumed), " +
      "then the recommendation (place, price for the stay, distance, availability), then up to three alternatives, then the caveats in one line.",
  ].join("\n");
};

const formatContent = (content: BaseMessage["content"]): string =>
  typeof content === "string" ? content : JSON.stringify(content);

const printMessages = (messages: readonly BaseMessage[]): void => {
  messages.forEach((message) => {
    if (AIMessage.isInstance(message) && message.tool_calls?.length) {
      message.tool_calls.forEach(({ name, args }) => console.log(`-> ${name}(${JSON.stringify(args)})`));
      return;
    }
    if (ToolMessage.isInstance(message)) {
      const preview = formatContent(message.content).slice(0, TOOL_RESULT_PREVIEW_LENGTH);
      console.log(`<- ${message.name ?? "tool"}: ${preview}${preview.length === TOOL_RESULT_PREVIEW_LENGTH ? " …" : ""}`);
      return;
    }
    if (AIMessage.isInstance(message)) {
      console.log(`\nA: ${formatContent(message.content)}`);
    }
  });
};

const readQuestion = (): string => process.argv.slice(2).join(" ").trim() || DEMO_QUESTION;

const main = async (): Promise<void> => {
  loadEnvFileIfPresent();
  const profile = await loadProfile();
  const adapter = new MCPAdapter({
    servers: {
      parking: { transport: "stdio", command: process.execPath, args: ["--import", "tsx", PARKING_SERVER_ENTRY], cwd: process.cwd() },
    },
    prefixToolNameWithServerName: false,
  });
  try {
    const tools = await adapter.listTools();
    console.log(`Tools: ${tools.map((tool) => tool.name).join(", ")}`);
    const agent = createReactAgent({
      llm: createFeatherlessChatModel(),
      tools,
      prompt: buildSystemPrompt(profile, new Date()),
      checkpointer: new MemorySaver(),
    });
    let printedMessageCount = 0;
    const ask = async (question: string): Promise<void> => {
      console.log(`\nQ: ${question}`);
      const { messages } = await agent.invoke({ messages: [new HumanMessage(question)] }, { configurable: { thread_id: THREAD_ID } });
      // The thread holds the whole conversation; skip what was printed before and the question itself.
      printMessages(messages.slice(printedMessageCount + 1));
      printedMessageCount = messages.length;
    };
    await ask(readQuestion());
    if (!process.stdin.isTTY) {
      return;
    }
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    for (;;) {
      const followUp = (await readline.question("\nFollow-up (empty line to quit): ")).trim();
      if (!followUp) {
        break;
      }
      await ask(followUp);
    }
    readline.close();
  } finally {
    await adapter.close();
  }
};

await main();
