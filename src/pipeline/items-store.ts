import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { itemSchema } from "../item";
import { ITEMS_PATH } from "./paths";

const collectedItemsSchema = z.object({
  collectedAt: z.string(),
  isOffline: z.boolean(),
  items: z.array(itemSchema),
});

export type CollectedItems = z.infer<typeof collectedItemsSchema>;

export const toPrettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const writeCollectedItems = (collected: CollectedItems): Promise<void> => writeFile(ITEMS_PATH, toPrettyJson(collected));

export const readCollectedItems = async (): Promise<CollectedItems> =>
  collectedItemsSchema.parse(JSON.parse(await readFile(ITEMS_PATH, "utf8")));
