import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { storedDigestSchema } from "../digest/schema";
import { loadEnvFileIfPresent, readOptionalEnv } from "../libs/env.utils";
import { DIGEST_PATH } from "../pipeline/paths";
import { loadProfile } from "../profile";
import { renderDigestPage, renderEmptyPage } from "./page";

const DEFAULT_PORT = 3000;

const send = (response: ServerResponse, status: number, contentType: string, body: string): void => {
  response.writeHead(status, { "content-type": `${contentType}; charset=utf-8` });
  response.end(body);
};

/** Reads the digest on every request, so a new `yarn digest` run shows up on reload. */
const readDigestFile = async (): Promise<string | undefined> => {
  if (!existsSync(DIGEST_PATH)) {
    return undefined;
  }
  return readFile(DIGEST_PATH, "utf8");
};

const main = async (): Promise<void> => {
  loadEnvFileIfPresent();
  const profile = await loadProfile();
  const port = Number(readOptionalEnv("PORT") ?? DEFAULT_PORT);

  const server = createServer((request, response) => {
    void (async () => {
      const raw = await readDigestFile();
      if (request.url === "/digest.json") {
        send(response, raw ? 200 : 404, "application/json", raw ?? "{}");
        return;
      }
      if (request.url !== "/") {
        send(response, 404, "text/plain", "Not found");
        return;
      }
      if (!raw) {
        send(response, 200, "text/html", renderEmptyPage("No digest yet. Run `yarn collect && yarn digest` first."));
        return;
      }
      send(response, 200, "text/html", renderDigestPage(storedDigestSchema.parse(JSON.parse(raw)), profile.name));
    })().catch((error: unknown) => {
      send(response, 500, "text/plain", error instanceof Error ? error.message : String(error));
    });
  });

  server.listen(port, () => {
    console.log(`Domovník web overview on http://localhost:${port}`);
  });
};

await main();
