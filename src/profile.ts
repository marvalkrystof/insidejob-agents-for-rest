import { readFile } from "node:fs/promises";
import { z } from "zod";

const DEFAULT_PROFILE_PATH = "profile/demo-profile.json";

const coordinatesSchema = z.object({ lat: z.number(), lon: z.number() });
const clockTimeSchema = z.string().regex(/^\d{2}:\d{2}$/);

export const profileSchema = z.object({
  name: z.string(),
  language: z.literal("en"),
  timeZone: z.literal("Europe/Prague"),
  home: coordinatesSchema.extend({
    address: z.string(),
    municipality: z.string(),
    municipalityParts: z.array(z.string()),
  }),
  work: coordinatesSchema.extend({ label: z.string() }),
  commute: z.object({
    days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])),
    arriveAtParkAndRide: clockTimeSchema,
    usualDriveMinutes: z.number().int().positive(),
    parkAndRideCandidates: z.array(coordinatesSchema.extend({ name: z.string() })),
    transitLines: z.array(z.string()),
    transitKeywords: z.array(z.string()),
    routeCorridorMeters: z.number().int().positive(),
  }),
  interests: z.array(z.string()),
  events: z.object({
    gooutListingUrls: z.array(z.string().url()),
    eveningFrom: clockTimeSchema,
  }),
  horizonDays: z.number().int().positive(),
});

export type Profile = z.infer<typeof profileSchema>;
export type Coordinates = z.infer<typeof coordinatesSchema>;
export type ParkAndRide = Profile["commute"]["parkAndRideCandidates"][number];

export const loadProfile = async (path = DEFAULT_PROFILE_PATH): Promise<Profile> =>
  profileSchema.parse(JSON.parse(await readFile(path, "utf8")));
