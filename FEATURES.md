# Domovník: features

The single list of what Domovník does or could do, with the priority and status of each feature. The vision, personas, research of the sources and the risks are in [daily-local-digest.md](daily-local-digest.md); open decisions and legal debts are in [LATER.md](LATER.md).

## How to read and maintain this file

- **Sections** follow the circles a reader goes through in one briefing: today at a glance, commute, household, home and building, street and neighbourhood, town, free time, tomorrow and later. Delivery, profile, trust, privacy and platform follow.
- **Priority:** `MVP` (hackathon), `V2` (after the hackathon), `V3` (vision), `idea` (unconfirmed, not prioritised yet).
- **Status:** `built`, `partial: <what is missing>`, `not built`.
- **Code:** for `built` and `partial` rows, the files or `yarn` commands that implement the feature. A `not built` row may name the path it is planned in.
- **Rules:**
  - A commit that changes what Domovník does updates the matching rows in the same commit.
  - Each feature appears exactly once; a new idea gets priority `idea` and status `not built`.
  - `yarn check:features` fails when a `built` or `partial` row points to a missing file or `yarn` script, and warns when a `not built` row points to a file that already exists.

## Today at a glance

| Feature | Priority | Status | Code |
|---|---|---|---|
| Headline: one sentence that tells the story of the day, the most important thing first | MVP | partial: the headline cites no entries and is not checked against them | `src/digest/prompts.ts`, `src/digest/graph.ts` |
| A concrete action instead of a list ("Leave at 07:28 for P+R Nové Butovice") | MVP | built | `src/digest/select.ts` |
| Quiet day: a single sentence, or no message, when nothing matters | V2 | not built | |

## Commute

| Feature | Priority | Status | Code |
|---|---|---|---|
| Closures and roadworks within 300 m of the drive: opravujeme.to (Prague) and KSÚS (Central Bohemian roads) | MVP | built | `src/collectors/opravujeme.ts`, `src/collectors/ksus.ts`, `src/pipeline/filter.ts` |
| Public transport disruptions on the commuter's lines (metro B and C) and keywords, from the PID RSS | MVP | partial: the feed's start date can disagree with the text (Florenc C: "since 6 Jun 2022", text says 31 Jan 2025) | `src/collectors/pid.ts`, `src/pipeline/filter.ts` |
| Recommended departure time from the drive time with traffic (TomTom Routing, `arriveAt`), compared with the usual departure | MVP | built | `src/route/tomtom.ts`, `src/route/commute.ts`, `src/digest/select.ts` |
| P+R choice: the fastest P+R that usually still has at least 15 free spaces at arrival, with the free spaces now (Golemio) | MVP | partial: with `--as-of`, "free now" is the count when the digest runs, not at the as-of time | `src/route/parking.ts`, `src/digest/select.ts` |
| Parking agent: answers "Where do I park near Holešovice tomorrow at 8 and what will it cost?" through the Parking MCP tools | MVP | not built | `src/agent/parking-agent.ts` |
| Alternative route or switching to public transport | V2 | not built | |
| Events at the destination (concert, match) taken into account in traffic and parking estimates | V2 | not built | |
| Lift and escalator outages in public transport for people with reduced mobility | V3 | not built | |
| Fuel prices along the route | idea | not built | |

## Household

| Feature | Priority | Status | Code |
|---|---|---|---|
| Shared household profile and briefing (who picks up the kids, who is at home during the outage) | V3 | not built | |
| Upcoming events in the household | idea | not built | |

## Home and building

| Feature | Priority | Status | Code |
|---|---|---|---|
| Planned electricity outages at the home address and elsewhere in the town (ČEZ Distribuce) | MVP | built | `src/collectors/cez.ts`, `src/pipeline/filter.ts` |
| Water and gas outages for the pilot area | V2 | not built | |
| SVJ emails forwarded to a dedicated Domovník mailbox | V2 | not built | |
| Photo of the building bulletin board: vision OCR, dates extracted into a calendar | V2 | not built | |
| Waste collection days, bulky waste collection and recycling centres | V2 | not built | |
| Planned internet and mobile operator outages | idea | not built | |

## Street and neighbourhood

| Feature | Priority | Status | Code |
|---|---|---|---|
| Facebook fixture: one public Kladno group, anonymised, shown in the demo | MVP | not built | |
| Public Facebook groups live: lost and found pets and items nearby | V2 | not built | |
| Photo matching: the user uploads a photo of their pet and is alerted to similar found animals | V3 | not built | |
| Local warnings (outages, car thefts, dangerous intersections) | V3 | not built | |
| Building proceedings and zoning plan changes within a set distance of the home | V3 | not built | |
| Construction work and pavement closures near the home | idea | not built | |

## Town

| Feature | Priority | Status | Code |
|---|---|---|---|
| Kladno notice board: notices that concern the home municipality, summarised in English by the LLM | MVP | partial: the municipality filter is a leading-name heuristic ([LATER.md](LATER.md)) | `src/collectors/uredni-deska.ts`, `src/digest/graph.ts`, `src/digest/prompts.ts` |
| Pharmacies, emergency services and appointments (e.g. free vaccination slots) | idea | not built | |
| Public holidays and shop opening restrictions | idea | not built | |
| School and kindergarten closures, timetable changes | idea | not built | |

## Free time

| Feature | Priority | Status | Code |
|---|---|---|---|
| Events in the evening and at the weekend: GoOut (Kladno) and Bio Oko (Praha 7, weekday evenings) | MVP | partial: chosen by time only; the profile's interests are not used for selection | `src/collectors/goout.ts`, `src/collectors/biooko.ts`, `src/pipeline/filter.ts` |
| Ticket or event page link for every event | MVP | built | `src/collectors/goout.ts`, `src/collectors/biooko.ts` |
| "Pre-sale starts" and "few seats left" alerts (if the source has the data) | V3 | not built | |
| Composing the day: event, transport, parking and dinner in one "Tonight" block | V3 | not built | |
| Agent questions such as "Where can I go with the kids on Saturday if it rains and I have 500 CZK?" over the same data and tools | idea | not built | |
| Weather with an impact on plans (rain on the way home, frost) | idea | not built | |
| Pollen and air quality for allergy sufferers | idea | not built | |

## Interests and news

| Feature | Priority | Status | Code |
|---|---|---|---|
| News on the entered topics with a novelty filter | V2 | not built | |
| A "what is new since last time" summary instead of a list of links | V2 | not built | |

## Tomorrow and later

| Feature | Priority | Status | Code |
|---|---|---|---|
| Upcoming items for the next 7 days, labelled by day (tomorrow, weekday and date) | MVP | built | `src/pipeline/filter.ts`, `src/libs/time.utils.ts` |
| Weekly summary (upcoming outages, weekend events, changes in the municipality); it ignores the daily novelty rule, so it repeats items the daily digests already delivered | V2 | not built | |
| Monthly summary: what changed in the municipality (resolutions, construction, zoning plan, budget) in plain language | V3 | not built | |
| Predicting problems ("in 9 days your building has a water outage, and the same week there is a disruption on your route") | idea | not built | |

## Reading moments and delivery

| Feature | Priority | Status | Code |
|---|---|---|---|
| Morning digest for today | MVP | partial: generated when `yarn digest` runs; nothing schedules it | `yarn digest`, `src/digest/run.ts` |
| Evening edition for tomorrow, read in bed | idea | not built | |
| Up to 3 summaries a day (morning, noon, evening) | V2 | not built | |
| Immediate urgent alert outside the schedule (a disruption on the route 30 minutes before departure) | V2 | not built | |
| Telegram bot message, every citation a link to its source | MVP | partial: not yet delivered to a chat end to end | `src/delivery/telegram.ts`, `src/digest/render.ts` |
| Web overview: digest, commute options, entries with reason, source and confidence | MVP | built | `yarn web`, `src/web/page.ts` |
| Novelty: the daily digest skips events and notices it has already delivered | MVP | built | `src/pipeline/novelty.ts`, `src/digest/select.ts` |
| Test and demo runs: `--dry-run` (no send), `--no-remember` (send without recording novelty), `--as-of` (render a chosen moment), `--offline` (saved fixtures) | MVP | built | `src/digest/run.ts`, `src/pipeline/collect.ts` |
| Email | V2 | not built | |
| iCal feed, push notifications | V3 | not built | |

## Profile and configuration

| Feature | Priority | Status | Code |
|---|---|---|---|
| Home address and coordinates | MVP | partial: set in the profile file; no geocoding and no form | `profile/demo-profile.json`, `src/profile.ts` |
| Work destination, P+R candidates and arrival time, with route calculation | MVP | partial: set in the profile file; no form | `profile/demo-profile.json`, `src/route/commute.ts` |
| Interests as free text | MVP | partial: stored and passed to the composer, not used for selection | `profile/demo-profile.json`, `src/digest/graph.ts` |
| Module selection (on and off) | MVP | not built | |
| Profile view on the web page (demo step 0:25 to 0:50) | MVP | not built | |
| SVJ name and how its information reaches Domovník (forwarded emails, photo of the bulletin board) | V2 | not built | |
| Alert sensitivity (urgent only, everything important, everything) | V2 | not built | |
| Quiet hours and days | V2 | not built | |
| Multiple profiles (home, cottage, parents) | V3 | not built | |
| Accessibility toggle: barrier-free events, lift outages, step-free routes | idea | not built | |

Target profile shape (design; the profile that runs today is `profile/demo-profile.json`):

```yaml
user:
  language: en
home:
  address: "Street 12, Kladno"
  municipality: "Kladno"
  building: { type: panelak, svj: "SVJ Street 12" }
commute:
  to: "Company, Praha 7"
  depart: "07:30"
  days: [mon, tue, wed, thu, fri]
  mode: park_and_ride   # car | transit | bike | park_and_ride (car to a P+R, then public transport)
interests: ["e-mobility", "stand-up", "FC Zbrojovka"]
modules:
  municipality_board: true
  utilities_outages: true
  traffic: true
  parking: true
  events: true
  community_groups: ["<public group url>"]
  news_topics: true
digest:
  schedule:
    morning: "06:30"
    noon: null
    evening: "18:00"
  weekly: { day: sun, time: "18:00" }
  monthly: { day: 1, time: "08:00" }
  channel: [telegram, web]
  sensitivity: important   # urgent | important | all
  quiet_hours: "22:00-06:00"
```

## Trust and guardrails

| Feature | Priority | Status | Code |
|---|---|---|---|
| Every item has a source, a link and a fetch time | MVP | built | `src/item.ts` |
| Confidence per item (official, scraped, inferred) | MVP | built | `src/item.ts`, `src/web/page.ts` |
| Explanation of why an item is shown ("On your drive to P+R Nové Butovice (201 m from the route)") | V2 | built | `src/pipeline/filter.ts`, `src/web/page.ts` |
| Duplicate detection | MVP | partial: merges items with the same source id only, not the same event from two sources | `src/pipeline/collect.ts` |
| Deterministic selection: code picks the entries, the LLM only writes about them | MVP | built | `src/digest/select.ts` |
| A bullet without a valid citation is dropped | MVP | built | `src/digest/graph.ts` |
| The LLM gets no free-text Czech details for closures, transit and notices, and no posting dates for notices | MVP | built | `src/digest/graph.ts` |
| Day labels (today, tomorrow, ongoing, date) computed in code, not by the LLM | MVP | built | `src/digest/select.ts`, `src/libs/time.utils.ts` |
| Fact check: times, dates, prices and counts in a bullet must appear in the entry they belong to, also when a bullet cites several entries with different dates | MVP | not built | |
| Fallback without the LLM: a plain digest built from the entries when Featherless fails | MVP | not built | |
| Feedback (useful, not useful) and relevance learning | V2 | not built | |

## Privacy

| Feature | Priority | Status | Code |
|---|---|---|---|
| Collectors keep only the fields they need (no contractor, investor or responsible-person data from opravujeme.to; notice-board titles, dates and URLs only) | MVP | built | `src/collectors/opravujeme.ts`, `src/collectors/uredni-deska.ts` |
| The web page shows the English summary instead of notice titles that contain personal names | MVP | built | `src/web/page.ts` |
| The address is stored minimally (municipality, street, rounded coordinates) | MVP | not built | |
| No names or personal data from community groups, only summaries | MVP | not built | |
| Deleting all data in one step | V2 | not built | |
| Local mode (processing without an account) | V3 | not built | |

## Platform

| Feature | Priority | Status | Code |
|---|---|---|---|
| LLM through Featherless: one call at a time, retries, tool calling with a JSON-mode fallback | MVP | built | `src/llm/featherless.ts` |
| API smoke test of every key (Golemio, TomTom, Featherless, Telegram, Apify) | MVP | built | `yarn check:apis` |
| Feature list check | MVP | built | `yarn check:features`, `src/check-features.ts` |
| Apify Actor `domovnik-collect` with module switches, wrapping the collection pipeline | MVP | not built | `.actor/actor.json`, `src/actor/main.ts` |
| Daily scheduled run (e.g. Apify Schedules); hosting is undecided ([LATER.md](LATER.md)) | idea | not built | |
| Parking MCP tool `find_parking_near`: destination, arrival time, max. walking distance, type (street, garage, P+R), constraints (disabled parking, EV charging) → spots with distance, price and availability estimate | MVP | not built | `src/mcp/parking-server.ts` |
| Parking MCP tool `get_pr_occupancy`: P+R car park ID → current and usual occupancy | MVP | not built | |
| Parking MCP tool `get_parking_tariff`: place, date and time → tariff, zone, max. duration, exceptions | MVP | not built | |
| Parking MCP tool `estimate_parking_difficulty`: destination, time → score from 0 to 100 from time of day, nearby events, occupancy and history | idea | not built | |
| Parking MCP tool `get_nearby_events`: destination, time → events that make parking harder (concert, match) | idea | not built | |
| Parking MCP tool `suggest_park_and_ride`: destination, arrival time → P+R and public transport combination with total time and price | idea | not built | |
| Parking MCP tool `get_parking_restrictions`: place, date → street cleaning, closures, temporary parking bans | idea | not built | |

Every Parking MCP tool returns a `confidence` field (live data, historical, estimate), so the agent does not claim a certainty it does not have.
