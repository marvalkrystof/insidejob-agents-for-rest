import type { Item } from "../item";
import type { Profile } from "../profile";

export interface CollectorContext {
  profile: Profile;
  fetchedAt: string;
}

export type Collector = (context: CollectorContext) => Promise<Item[]>;
