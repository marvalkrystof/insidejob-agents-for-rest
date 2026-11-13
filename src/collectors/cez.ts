import { z } from "zod";
import { buildItem, type Item } from "../item";
import { fetchJson } from "../libs/http.utils";
import { truncate } from "../libs/text.utils";
import { parseIsoDate, toPragueIso } from "../libs/time.utils";
import type { Collector } from "./types";

const API_BASE_URL = "https://api.bezstavy.cz";
const ANNOUNCEMENT_BASE_URL = "https://cdn.bezstavy.cz";
const CEZ_DISTRIBUTION_CODE = "CEZd";
const EVIDENCE_MAX_LENGTH = 300;
const TITLE_STREETS_LIMIT = 3;

const addressSchema = z.object({
  id: z.number(),
  street: z.string(),
  town: z.string(),
  dso: z.string(),
  lat: z.number(),
  lon: z.number(),
});

const streetSchema = z.object({ name: z.string(), house_nums: z.string().default("") });
const townSchema = z.object({
  name: z.string(),
  town_districts: z
    .array(z.object({ town_parts: z.array(z.object({ streets: z.array(streetSchema).default([]) })).default([]) }))
    .default([]),
});
const outageSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  announcement_key: z.string(),
  opened_at: z.string(),
  fix_expected_at: z.string(),
  addresses: z.object({ towns: z.array(townSchema).default([]) }),
});
const inspectionSchema = z.object({ outages: z.array(outageSchema), outages_in_town: z.array(outageSchema) });

type Address = z.infer<typeof addressSchema>;
type Outage = z.infer<typeof outageSchema>;

const listStreets = (outage: Outage): z.infer<typeof streetSchema>[] =>
  outage.addresses.towns
    .flatMap((town) => town.town_districts)
    .flatMap((district) => district.town_parts)
    .flatMap((part) => part.streets)
    .filter((street) => street.name !== "");

const toOutageItem = (outage: Outage, address: Address, isAtHome: boolean, fetchedAt: string): Item => {
  const streets = listStreets(outage);
  const streetNames = [...new Set(streets.map((street) => street.name))];
  const title = isAtHome
    ? `Planned power outage at your address (${address.street})`
    : `Planned power outage in ${address.town}: ${streetNames.slice(0, TITLE_STREETS_LIMIT).join(", ")}`;
  return buildItem({
    source: "cez",
    sourceKey: outage.id,
    type: "outage",
    title,
    geo: isAtHome
      ? { lat: address.lat, lon: address.lon, municipality: address.town, street: address.street }
      : { municipality: address.town, street: streetNames[0] },
    timeRange: {
      from: toPragueIso(parseIsoDate(outage.opened_at)),
      to: toPragueIso(parseIsoDate(outage.fix_expected_at)),
    },
    url: `${ANNOUNCEMENT_BASE_URL}/${outage.announcement_key}`,
    fetchedAt,
    confidence: "official",
    severity: isAtHome ? "high" : "low",
    tags: ["electricity", isAtHome ? "home" : "town"],
    evidence: truncate(streets.map((street) => `${street.name} ${street.house_nums}`.trim()).join("; "), EVIDENCE_MAX_LENGTH),
  });
};

export const collectCezOutages: Collector = async ({ profile, fetchedAt }) => {
  const searchUrl = `${API_BASE_URL}/address/search?q=${encodeURIComponent(profile.home.address)}`;
  const [address] = z.array(addressSchema).parse(await fetchJson(searchUrl));
  if (!address) {
    throw new Error(`ČEZ address search found nothing for "${profile.home.address}"`);
  }
  if (address.dso !== CEZ_DISTRIBUTION_CODE) {
    throw new Error(`"${profile.home.address}" is served by distributor ${address.dso}, not ČEZ Distribuce`);
  }
  const inspection = inspectionSchema.parse(await fetchJson(`${API_BASE_URL}/cezd/api/inspectaddress/${address.id}`));
  const homeOutageIds = new Set(inspection.outages.map((outage) => outage.id));
  const homeItems = inspection.outages.map((outage) => toOutageItem(outage, address, true, fetchedAt));
  const townItems = inspection.outages_in_town
    .filter((outage) => !homeOutageIds.has(outage.id))
    .map((outage) => toOutageItem(outage, address, false, fetchedAt));
  return [...homeItems, ...townItems];
};
