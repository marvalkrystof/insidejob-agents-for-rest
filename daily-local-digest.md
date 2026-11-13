# Domovník: personal local digest

Working name: **Domovník** (alternatives: Okolí, Dnes u nás, Radar).

In one sentence: an app that watches everything happening around the user's home, commute and interests, and three times a day (configurable) sends them a short summary of what is relevant to them today, including a concrete action to take.

Document status: outcome of the brainstorm and the validation spikes (section 7). Claims marked **(verified)** are based on source research or live requests; claims marked **(unverified)** must be verified before implementation. Deferred decisions, legal debts and follow-ups are in [LATER.md](LATER.md).

---

## 1. Problem

Information that affects everyday life is scattered across dozens of places, and people learn most of it late or not at all:

- a water, electricity or gas outage in their own building appears on the distributor's website, on a notice in the hallway or in an email from the homeowners' association (SVJ)
- a public transport disruption or a road closure on the way to work is discovered only in the traffic jam
- nobody reads the municipal notice board (úřední deska), council resolutions or building proceedings in the neighbourhood
- local events (cinema, theatre, concerts, markets) have to be searched for manually on five websites
- the local community (lost pets, found items, neighbourly help) lives in Facebook groups
- parking at the destination is dealt with only on arrival

No existing tool combines this into one personal overview for a specific address and a specific day.

## 2. Vision

Domovník acts as a personal "building caretaker and secretary" for the place where a person lives:

- **Proactive.** The system asks, not the user: "Tomorrow at 8 you will have no water and there is a disruption on your route, leave 25 minutes earlier."
- **Local.** It knows the home address, municipality, region, commute route and interests.
- **Actionable.** Every item contains a next step (link to tickets, recommended departure time, where to park, whom to call).
- **Quiet.** When there is nothing to report, it sends nothing or a single sentence "all quiet today". Its value lies in relevance, not volume.
- **Configurable.** The user picks the modules, frequency and sensitivity.

### Personas

| Persona | What matters to them most |
|---|---|
| Commuting employee in a prefab apartment block | route and delays, outages in the building, parking at the destination, SVJ |
| Family with children in a village | municipal notice board, events for children, waste collection, lost animals |
| Senior | outages, pharmacies, events, simple language, one morning summary |
| Pet owner | lost and found pets nearby, vets |
| Person with reduced mobility | lift outages in public transport, barrier-free events and routes |

## 3. Modules (information sources)

Each module is a standalone Apify Actor (or a small service) with a unified output schema (see section 6).

### 3.1 Home and municipality

| Source | What it watches | Note |
|---|---|---|
| Notice board of the municipality / city / region | resolutions, tenders, zoning and building proceedings, closures, waste collection, elections | Open data has been mandatory for state bodies, regions and municipalities with extended powers (ORP) since 1 February 2022, but **there is no unified API for all municipalities** (verified). NKOD is only a catalogue of links (561 boards in the OFN format). Kladno publishes its board as OFN JSON-LD at `https://www.mestokladno.cz/opendata-uredni-deska` (verified live); the project's prefilter (title/document-name regex + home-municipality filter) keeps 15 relevant items. Item titles can contain names of natural persons (e.g. applicants in "Stanovení přechodné úpravy" (temporary traffic arrangement order) notices), so collected fixtures must be sanitized before committing. The `agenda` field is missing; attachments are mostly PDFs with a text layer, the rest are scans (verified on an archived copy). |
| Municipal website and newsletter | news, events, announcements | Scraping the website and the PDF newsletter, LLM extraction. |
| SVJ and building manager | outages in the building, inspections of gas, lifts and chimneys, meter readings, owners' meetings | Mostly non-public (see blockers). |
| Energy and water distributors | planned electricity, gas and water outages | Electricity, ČEZ Distribuce: the public search on the ČEZ website calls the JSON API `api.bezstavy.cz` without login, data down to the building number (číslo popisné) level with a distinction between "tato adresa" (this address) and "v obci" (in the municipality), times in UTC, link to the PDF notice (verified). The ČEZ website terms of use prohibit automated reading (verified). Prague and Roztoky are served by PREdistribuce, not ČEZ (verified). Water and gas: nothing structured found. |
| Waste collection and municipal services | collection dates, recycling centres | Often in PDF or on the municipal website. |

### 3.2 Commute

| Source | What it watches |
|---|---|
| Traffic information (disruptions, closures, accidents) | situation on the route |
| Delay estimate | comparison of the usual and the current travel time |
| Public transport | disruptions, line outages, lift and escalator outages |
| Parking at the destination | see section 5 (MCP) |

### 3.3 Events and leisure

| Source | What it watches |
|---|---|
| Cinemas, theatres, clubs, festivals, GoOut, Ticketportal and similar | programme nearby matching the user's interests |
| Tickets | direct purchase link, availability (if the source provides it) |
| Local markets, sports events, municipal events | what is happening nearby |

Note: scraping ticket sellers is subject to their terms. In the MVP a link to the event page is enough, no automated purchase. GoOut has schema.org `Event` in JSON-LD on its listing pages (Kladno yes, the Praha 7 listings lack it), but GoOut's terms allow only private use without consent (verified). Bio Oko (Praha 7) has JSON-LD on its home page with ISO dates and prices (verified). Kudy z nudy requires written consent; the Apify Store has no Actor for GoOut or Ticketportal (verified).

### 3.4 Community

| Source | What it watches | Note |
|---|---|---|
| Public Facebook groups of the municipality | lost and found pets, found items, neighbourly help, warnings | Apify offers scrapers only for public groups without login (verified), but reliability varies between Actors. The official `apify/facebook-groups-scraper`: 99.8 % successful runs over 30 days, USD 0.005 per post (verified). A public group for Kladno could not be found without login; search engines do not index groups (verified). |
| Alternative sources | lost-pet websites, Bazoš, local websites | Fallback if Facebook does not work. |

### 3.5 Interest topics and news

- the user enters topics (free-form key phrases, e.g. "e-mobility", "housing in Brno", "FC Zbrojovka")
- sources: RSS, news websites, local media
- the LLM filters by topic and **novelty** (it only deals with what has changed since the last digest)

### 3.6 Extra ideas (selected by importance to the user)

- weather with an impact on plans (rain during the trip home, frost and recommendations)
- pollen and air quality for allergy sufferers
- pharmacies, emergency services and appointments (e.g. free vaccination slots)
- collection days, bulky waste collection
- construction work and pavement closures near the home
- calendar of public holidays and shop opening restrictions
- fuel prices along the route
- planned internet and mobile operator outages
- school and kindergarten closures, timetable changes
- barrier-free mode: barrier-free events, lift outages, step-free routes

## 4. Features

Priority: **MVP** (hackathon, 5 hours), **V2** (after the hackathon), **V3** (vision).

### 4.1 Profile and configuration

| Feature | Priority |
|---|---|
| Entering the home address (geocoding, selecting the municipality, region, district) | MVP |
| Entering the work address and departure time, route calculation | MVP |
| Module selection (on and off) | MVP |
| Entering interests as free text | MVP |
| Entering the SVJ name and how information is passed on (forwarding emails, photo of the building bulletin board) | V2 |
| Alert sensitivity (urgent only, everything important, everything) | V2 |
| Quiet hours and days | V2 |
| Multiple profiles (home, cottage, parents) | V3 |
| Shared household profile | V3 |

Example profile (schema for implementation):

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

### 4.2 Summary delivery

| Feature | Priority |
|---|---|
| Morning summary (one, configurable time) | MVP |
| Up to 3 summaries a day (morning, noon, evening) | V2 |
| Weekly summary (upcoming outages, weekend events, changes in the municipality) | V2 |
| Monthly summary (what changed in the municipality, construction, council decisions, budget) | V3 |
| Immediate urgent alert outside the schedule (e.g. a disruption on the route 30 minutes before departure) | V2 |
| Channels: Telegram bot | MVP |
| Channels: web overview | MVP |
| Channels: email | V2 |
| Channels: iCal feed, push notifications | V3 |
| One-sentence summary on a "quiet day" | V2 |

### 4.3 Traffic and route

| Feature | Priority |
|---|---|
| Disruptions, closures and accidents on the route | MVP |
| Delay estimate and recommended departure time ("leave 20 minutes earlier") | MVP |
| Alternative route or switching to public transport | V2 |
| Lift and escalator outages in public transport for people with reduced mobility | V3 |
| Taking events at the destination (concert, match) into account in traffic and parking estimates | V2 |

### 4.4 Parking

See section 5. Available both as a standalone MCP server and as a digest module.

### 4.5 Home, SVJ and municipality

| Feature | Priority |
|---|---|
| Notice board of one pilot municipality with LLM extraction of "what concerns me" | MVP |
| Planned electricity outages by address | MVP |
| Water and gas outages for the pilot area | V2 |
| Receiving SVJ emails by forwarding them to a dedicated mailbox | V2 |
| Photo of the building bulletin board, vision OCR, extraction of dates into a calendar | V2 |
| Waste collection and calendar | V2 |
| Building proceedings and zoning plan changes within X metres of the home | V3 |

### 4.5a Events and tickets

| Feature | Priority |
|---|---|
| Events nearby matching the user's interests | MVP |
| Ticket purchase link for every event | MVP |
| "Pre-sale starts" and "few seats left" alerts (if the source has the data) | V3 |
| Composing the day: event, transport, parking, dinner | V3 |

### 4.6 Community

| Feature | Priority |
|---|---|
| Public Facebook groups: lost and found pets and items nearby | V2 (in the MVP only with one fixed group and backed-up data) |
| Photo matching: the user uploads a photo of their pet and the system alerts them to similar found animals | V3 |
| Local warnings (outages, car thefts, dangerous intersections) | V3 |

### 4.7 Interests and news

| Feature | Priority |
|---|---|
| News on the entered topics with a novelty filter | V2 |
| Summary "what is new since last time" instead of a list of links | V2 |

### 4.8 Quality and trust

| Feature | Priority |
|---|---|
| Every item has a source, a link and a fetch time | MVP |
| Confidence score (verified source vs. estimate from free text) | MVP |
| Explanation of why an item is shown ("because you live at X") | V2 |
| Feedback (useful, not useful) and relevance learning | V2 |
| Duplicate detection across sources | MVP |

### 4.9 Privacy

| Feature | Priority |
|---|---|
| The address is stored minimally (municipality, street, possibly rounded coordinates) | MVP |
| No storing of names and personal data from community groups, only summaries | MVP |
| Deleting all data in one step | V2 |
| Local mode (processing without an account) | V3 |

## 5. Parking MCP

Goal: an agent (e.g. Claude) can answer "Where do I park at my destination and how much will it cost?", and Domovník uses this in the digest.

Apify offers a hosted MCP server and allows exposing Actors as tools (verified: `https://mcp.apify.com`, tool selection via the `tools` parameter). Parking MCP is a custom server on top of Actors and open data.

### Tools

| Tool | Input | Output |
|---|---|---|
| `find_parking_near` | destination (address or coordinates), arrival time, max. walking distance, type (street, garage, P+R), constraints (disabled parking (ZTP), EV charging) | list of spots with distance, price, availability estimate |
| `get_parking_tariff` | place, date and time | tariff, zone, max. duration, exceptions |
| `get_pr_occupancy` | P+R car park ID | current and historical occupancy (if available) |
| `estimate_parking_difficulty` | destination, time | score from 0 to 100 based on time of day, nearby events, occupancy and history |
| `get_nearby_events` | destination, time | events that make parking harder (concert, match) |
| `suggest_park_and_ride` | destination, arrival time | P+R and public transport combination with total time and price |
| `get_parking_restrictions` | place, date | restrictions (street cleaning, closures, temporary parking bans) |

### Parking data sources

- **Prague, Golemio API (Operátor ICT):** production server `api.golemio.cz`; the Parking module covers parking, zones, tariffs and measurements; the key is self-service via email registration, limit 20 requests per 8 s (from documentation). Without a key the parking endpoints return 401 (verified). The key works: `GET /v3/parking?parkingPolicy[]=park_and_ride` returns 110 P+R locations (verified live). P+R occupancy works live: `/v3/parking-measurements` (source `tsk-offstreet`) returns free and total spaces updated within minutes, and `/v3/parking/{id}/average-occupancy` returns hourly averages of occupied spaces per weekday (`{weekdayIndex: {"HH": avgOccupiedSpots}}`); for a Monday 08:00 arrival Zličín 1+2 usually have ~8 of 154 spaces free and Nové Butovice ~38 of 201 (verified live). Index `0` = Sunday is inferred from its flat profile, not documented **(unverified)**. Tariff prices are not verified yet. Official P+R car parks in western Prague with space counting: Zličín 1, Zličín 2, Nové Butovice, Kotlářka; neither Nádraží Veleslavín nor Dlouhá Míle is an official P+R (verified). Licence: the OICT dataset "Parkování API" (Parking API) in LKOD declares no copyright or database rights for the open-data subset; the secondary source `osm` is under ODbL (verified).
- **Prague, paid parking zones:** IPR ArcGIS returns the segment type and the tariff code (e.g. `P7-0169`) without a key under CC BY 4.0 (verified); tariff prices only via Golemio `/v3/parking-tariffs` with a key (unverified).
- **PID incidents and disruptions:** the RSS feeds `pid.cz/feed/rss-vyluky` and `rss-mimoradnosti` and the GTFS-RT `alerts.pb` on Golemio work without a key (verified).
- **Other cities:** nothing found, to be checked (Brno, Ostrava, Plzeň and other city open data portals) **(unverified)**.
- **Fallback:** OpenStreetMap for car park locations, tariffs from city websites, difficulty estimated by a heuristic (time of day, nearby events).

Design note: every tool returns a `confidence` field (live data / historical / estimate) so the agent does not pretend to a certainty it does not have.

## 6. Architecture

```
User configuration
        |
Scheduler (Apify Schedules) --> Actors per module (traffic info, notice boards,
        |                       outages, events, community, news, parking)
        v
Unified item schema (Item) --> deduplication --> geocoding and profile filter
        |
Relevance scoring (rules + LLM) --> summary assembly with citations (LLM)
        |
Delivery (email, Telegram) + web overview
```

Unified item schema:

```json
{
  "id": "hash(source + key)",
  "source": "cez-distribuce",
  "type": "outage | closure | event | notice | community | news | parking",
  "title": "...",
  "summary": "...",
  "geo": { "lat": 0, "lon": 0, "radiusM": 0, "municipality": "..." },
  "timeRange": { "from": "ISO", "to": "ISO" },
  "url": "...",
  "fetchedAt": "ISO",
  "confidence": "official | scraped | inferred",
  "actionHint": "..."
}
```

Key decisions:

- **Scraping is done per location, not per user.** Results for a municipality are shared among all users from it. Cost and load on the sources grow with the number of municipalities, not users.
- **The LLM is used for extraction and for composing text, not as a source of facts.** Every claim must reference a source item.
- **Relevance:** hard filters first (location, time, route), then LLM scoring against interests.
- **Scheduling:** Apify Schedules per module; the summary is assembled from already fetched data.
- **Stack:** TypeScript everywhere (Actors, logic, web, MCP).
- **Language:** the whole project (code, docs, LLM prompts, generated digest, demo) is in English.
- **LLM:** Featherless.ai (OpenAI-compatible API) orchestrated via LangGraph.js; the graph state is held by a checkpointer. `withStructuredOutput` requires `method: "functionCalling"` or `"jsonMode"`, because Featherless does not document the default `json_schema` (verified in the `@langchain/openai` code). Default model: `moonshotai/Kimi-K2-Instruct-0905` (tool calling verified live). The team is on the Featherless $25 "Chat" plan with 4 concurrency units and 32K context; Kimi takes all 4 units, so exactly one LLM call runs at a time, and anything beyond that gets HTTP 429.
- **Hosting:** locally first, possibly Apify later.

## 7. Blockers and risks

Rating: **High** = the module may not work in its full scope; **Medium** = solvable with a compromise; **Low** = nuisance.

Overall verdict: **no blocker prevents the MVP in the Kladno → Praha 7 pilot if the scope is narrowed**. The biggest risks are Facebook groups, the SVJ, time at the hackathon and the sources' terms of use; electricity outages are solvable for the pilot via the ČEZ API.

| # | Risk | Level | What we know | Workaround |
|---|---|---|---|---|
| B1 | Facebook groups | High | The official Apify scraper handles only public groups without login; scraping behind a login violates Facebook's terms. Community Actors differ, and some cannot handle even public groups without login (verified). Facebook's terms restrict automated access even to public data (Meta ToS 3.2.3, robots.txt `Disallow: /`, verified); GDPR applies to names and locations. A public Kladno group could not be found without login (verified). | Fixture from one Actor run on a manually found public group, decide on live operation later ([LATER.md](LATER.md)); store only summaries without names; alternative sources (lost-pet websites); "user forwards a post" mode. Do not rely on it as the core. |
| B2 | SVJ and building information | High | The information is usually private (email, bulletin board, internal portal). It is not available without the user's participation. | The user forwards emails to a dedicated Domovník address; a photo of the bulletin board is processed by a vision model; manual entry of a date. This is a "bring your own data" feature, not scraping. |
| B3 | Water, gas and electricity outages | Medium | Electricity: the ČEZ Distribuce search calls the public JSON API `api.bezstavy.cz` without login, data down to the building number, observed horizon about 14 days; the website terms of use prohibit automated reading (verified). ČEZ also offers email and SMS alerts per supply point. For water only articles and aggregators, for gas nothing (verified). | Kladno pilot via the ČEZ API with a saved snapshot for the demo; water and gas in V2; receiving email alerts via forwarding as a fallback. |
| B4 | Traffic disruptions and delays | Medium | NDIC: registration via `mobilitydata.rsd.cz` with a signed form and manual approval by ŘSD, closures only via HTTP PUSH (from documentation), not feasible within the hackathon. Prague: `opravujeme.to/api/action` returns JSON with geometry without a key, current data (verified). Central Bohemian Region: KSÚS `useky.json` (class II and III roads) and an NDIC snapshot from TamTam (CC BY 4.0, not being updated) (verified). PID disruptions via RSS without a key (verified). Travel time: TomTom Routing offers 20,000 free requests per month without a card and an `arriveAt` parameter (from documentation); the key works, and the route from the persona's home in Kladno to P+R Zličín returns 23 min, 25.2 km with a traffic-delay field (verified live). | opravujeme.to + KSÚS + PID RSS, filtered by distance from the route; travel time via TomTom, with a constant + penalty for closures as a fallback. NDIC only after the hackathon. |
| B5 | Parking outside Prague | Medium | Golemio covers Prague; the key works and returns 110 P+R locations (verified live); current P+R occupancy and the usual occupancy per weekday and hour work with the key (verified live; the weekday index is inferred), tariff prices (unverified); the licence of the open-data subset is permissive (verified); nothing found for other cities (verified). | Handle parking at the destination via Prague P+R car parks; other cities via heuristics and estimates marked as low confidence. |
| B6 | Municipal notice boards | Low (for Kladno) | Open data is mandatory only for some authorities; no unified API exists; NKOD is only a catalogue of links (verified). Kladno's live endpoint `https://www.mestokladno.cz/opendata-uredni-deska` returns OFN JSON-LD (verified live), and the prefilter (title/document-name regex + home-municipality filter) keeps 15 relevant items; titles can contain names of natural persons. The city website's robots.txt disallows all bots; in a sample, 4 of 15 attachments are scans, and `tesseract -l ces` reads them (verified). | Kladno JSON-LD, prefilter on item titles and document names, LLM extraction; sanitize names in fixtures before committing; OCR of attachments after the MVP. |
| B7 | Tickets and events | Medium | GoOut has JSON-LD, but its terms allow only private use without consent; Kudy z nudy requires written consent; Bio Oko has JSON-LD with no restrictions found in robots.txt (verified). | Link to the event page, do not attempt purchases; GoOut for Kladno, Bio Oko for Praha 7; GoOut consent to be resolved later ([LATER.md](LATER.md)). |
| B8 | Location accuracy | Medium | Outages tend to be listed by street or building number, disruptions by road segment; matching them to an address is not trivial. | Geocoding and street name comparison; for uncertain matches, flag the confidence and show the source. |
| B9 | LLM hallucinations | Medium | The LLM may invent a date or place. | Structured extraction citing the original text, mandatory link, pass nothing on without a source item. |
| B10 | Privacy and GDPR | Medium | Home address and route are sensitive personal data; community groups and notice-board titles contain names. | Data minimisation, rounded coordinates, no storing of names, a clear deletion option. |
| B11 | Costs and limits | Low | The number of Actors and LLM calls grows with the modules. | Shared cache per location, per-module scheduling, LLM only on new items. |
| B12 | Information overload | Low | Too many messages will put the user off. | Sensitivity thresholds, novelty filter, "quiet day" without a message. |
| B13 | Delivery | Low | Email is the simplest; push and SMS are harder. | MVP: Telegram bot and web overview; email in V2; SMS later. |
| B14 | Hackathon time | High | 5 hours for three people is not enough for all modules; for roughly the first 2 hours each team member works on a different idea, then the team converges. | Section 9: one pilot, one profile, 4 to 5 modules, show the rest as a roadmap. |
| B15 | Sources' terms of use and robots.txt | Medium | The prototype knowingly ignores bans on automated reading at ČEZ Distribuce, mestokladno.cz, GoOut, KSÚS and Facebook (verified). | Low frequency, no logging in and no CAPTCHA circumvention; legal resolution before public deployment ([LATER.md](LATER.md)). |
| B16 | LLM limits (Featherless) | Medium | Concurrency depends on the plan and model size; beyond the limit HTTP 429 with no queue (from documentation). The team is on the Chat plan: 4 concurrency units and 32K context, so `moonshotai/Kimi-K2-Instruct-0905` (4 units) allows one call at a time. Tool calling verified live with Kimi-K2, GLM-4.7-Flash and Qwen3.8-27B; models that think before answering need a generous `max_tokens` (120 is too low, 600 works). | Limit concurrency, retry on 429, extraction via `jsonMode` with zod validation, fallback model for the agent. |

### Verification status (spikes)

| Spike | Verdict | Key evidence |
|---|---|---|
| Golemio: P+R occupancy | works | `/v3/parking?parkingPolicy[]=park_and_ride` returns 110 P+R locations; `/v3/parking-measurements` gives free spaces now, `/v3/parking/{id}/average-occupancy` the usual occupancy per weekday and hour (weekday index inferred); Monday 08:00: Zličín ~8 of 154 free, Nové Butovice ~38 of 201; tariff prices unverified |
| Golemio and PID: public transport disruptions | works | disruption RSS and GTFS-RT `alerts.pb` return 200 without a key |
| Traffic: closures in Prague | works | `opravujeme.to/api/action`, JSON with geometry without a key |
| Traffic: closures in the Central Bohemian Region | works with compromise | NDIC only after registration and via PUSH; KSÚS and TamTam without a key, data out of date |
| Traffic: travel time | works | TomTom Routing key verified: home in Kladno → P+R Zličín 23 min, 25.2 km, with a traffic-delay field |
| ČEZ Distribuce: outages by address | works with compromise | `api.bezstavy.cz` without login, building-number granularity; the website terms prohibit automation |
| Facebook: public Kladno group | unverified | Actor reliable and Apify token verified live; the group cannot be found without login, the Actor run needs a group URL |
| Kladno notice board | works | live endpoint `mestokladno.cz/opendata-uredni-deska` returns OFN JSON-LD; the prefilter keeps 15 relevant items; titles contain personal names, fixtures must be sanitized |
| Events | works with compromise | GoOut JSON-LD (Kladno) + Bio Oko JSON-LD (Praha 7); GoOut private use only |
| LLM: Featherless + LangGraph.js | works | tool calling verified live: Kimi-K2 2.3 s, GLM-4.7-Flash 3.5 s, Qwen3.8-27B 5.7 s; Chat plan allows one Kimi call at a time (4 units), 32K context |

## 8. Creative directions and "wow" elements

Features that show more than aggregation suit both the demo and the vision:

- **"Departure time" instead of a list.** The summary does not end with information about a disruption but with a sentence: "Leave at 7:05, not 7:30. Park at P+R X, that makes it 12 minutes faster."
- **Composing the day.** Cinema at 19:00 + transport + parking + tickets in one "Tonight" block.
- **Lost pet matching by photo.** The user uploads a photo, the system watches community reports of found animals and alerts them to a similar animal nearby.
- **Predicting problems.** "In 9 days your building will have a water outage, and the same week there is a disruption on your route."
- **Changes since last time.** A monthly summary "what changed in your municipality" (resolutions, construction, zoning plan) in plain language.
- **Story of the day.** The opening sentence of the summary sets the context: "Today is a quiet day, just one thing: a concert in the centre tonight, expect parking to be harder."
- **Household as a team.** A shared summary for the family (who picks up the kids, who will be at home during the outage).
- **Accessibility layer.** A toggle for people with reduced mobility: barrier-free events, lift outages, step-free routes.
- **Agent layer.** The user can ask: "Where can I go with the kids on Saturday if it rains and I have 500 CZK?" The agent uses the same data and tools (including Parking MCP).

## 9. MVP for the hackathon (5 hours, 3 people, 3-minute demo)

### Scope

- **One pilot and one profile** (`profile/demo-profile.json`): a commuter who lives in Kladno, drives to a Prague P+R (Zličín or Nové Butovice) by 08:00 on weekdays and continues by metro B/C to Praha 7 – Holešovice. Digest and demo in English.
- **Phase A, solo proof of concept (built):** `yarn collect && yarn digest` produces a morning digest from live data.
  - Seven collectors: ČEZ outages by address, opravujeme.to (Prague closures), KSÚS (Central Bohemian roads), PID disruption RSS, GoOut (Kladno events), Bio Oko (Praha 7 screenings), the Kladno notice board.
  - Departure time from TomTom Routing (`arriveAt`); the digest picks the fastest P+R that usually still has at least 15 free spaces at arrival (Golemio average occupancy) and reports the free spaces now alongside.
  - Hard filters (time window, 300 m route corridor, metro lines B/C, home outage, evenings and weekends), then a LangGraph.js graph: notice extraction (LLM), deterministic selection, composition with `[n]` citations (LLM).
  - Output: a Telegram bot message and a web overview (`yarn web`); `--offline` runs over saved fixtures.
- **Phase B, team of three (if the team picks Domovník):** Parking MCP and an agent, one Apify Actor for collection, a Facebook fixture, web polish and the demo.
- **Not in the MVP** (roadmap and [LATER.md](LATER.md)): live Facebook, NDIC, OCR of notice-board attachments, water and gas, SVJ, weekly and monthly summaries, more profiles, hosting on Apify, Praha 7 events via GoOut.

### Phase B roles

| Role | Tasks |
|---|---|
| **Person 1: data and Apify** | One Actor `domovnik-collect` with module switches (`.actor/actor.json`, `src/actor/main.ts`, run via `npx apify-cli run`) wrapping the collection pipeline. Facebook fixture: one run of `apify/facebook-groups-scraper` with `resultsLimit: 10` and `maxTotalChargeUsd=0.10`, anonymized. Sanitizing fixtures. |
| **Person 2: LLM and Parking MCP** | MCP server (`src/mcp/parking-server.ts`) with `find_parking_near`, `get_pr_occupancy` and `get_parking_tariff`, each returning `confidence`. Agent (`src/agent/parking-agent.ts`): LangGraph.js ReAct agent with `@langchain/mcp-adapters` and a checkpointer. Tuning the departure time and digest quality. |
| **Person 3: UI and demo** | Web overview (profile, digest, items with source and confidence), Telegram message format, demo script, backup video, vision slide from [LATER.md](LATER.md). |

Names are assigned at the team sync.

### Timeline

| Step | Length | What |
|---|---|---|
| Phase A | until the team sync | solo proof of concept, shown at the sync from `yarn web` and the Telegram message |
| Team sync | | pick one idea, assign the Phase B roles |
| Phase B | 1:30 | parallel work in the three roles |
| Integration | 0:30 | integration, `--offline` fallback, feature freeze |
| Rehearsal | 0:30 | demo rehearsal, backup video |

### Demo script (3 minutes)

All message content is generated from real data on the demo day; nothing is hard-coded.

1. **0:00 to 0:25:** The problem. A commuter from Kladno to Holešovice opens six tabs every morning: ČEZ, closures, PID, P+R, events, the notice board.
2. **0:25 to 0:50:** The profile: address, work, arrival time, interests, modules.
3. **0:50 to 2:00:** The morning message arrives live in Telegram. It opens with "Leave at …" and the reason: the drive time and closures on the route, plus the P+R chosen by occupancy. For a Monday 08:00 arrival, Zličín is the faster drive (25 min) but usually has only ~8 of 154 spaces free, so the digest sends the commuter to Nové Butovice (32 min, ~38 of 201 free) and leaves at 07:28. Then the outage at home, an evening event with a link and a notice-board item. Every point links to its source. The Facebook fixture is a bonus.
4. **2:00 to 2:40:** Parking MCP: the agent answers "Where do I park near Holešovice tomorrow at 8 and what will it cost?" through tool calls.
5. **2:40 to 3:00:** The vision from [LATER.md](LATER.md) and the roadmap: SVJ, weekly summaries, more cities, the accessibility layer.

Fallback: `--offline` over fixtures and a recorded video.

## 10. Open questions for the team

Decided: Kladno → Praha 7 pilot (section 9), Telegram + web overview as channels (section 4.2), community groups as a bonus with fixture data (risk B1). Open questions and deferred decisions are in [LATER.md](LATER.md).

## 11. Research sources

- [Apify Facebook Groups Scraper (blog)](https://blog.apify.com/scrape-facebook-groups-data/)
- [Apify MCP server (documentation)](https://docs.apify.com/mcp)
- [Golemio: Open data and API](https://operator-ict.gitlab.io/golemio/documentation/en/open-data-api/)
- [Golemio Parkings: OpenAPI specification](https://cdn.jsdelivr.net/npm/@golemio/parkings@1.28.2/docs/openapi-output.yaml)
- [Golemio: API key registration](https://api.golemio.cz/api-keys/auth/sign-up)
- [PID: disruptions RSS](https://pid.cz/feed/rss-vyluky/)
- [ČEZ Distribuce: checking planned outages](https://www.cezdistribuce.cz/cs/pro-zakazniky/potrebuji-vyresit/stavajici-pripojeni/overeni-planovane-odstavky)
- [ČEZ Distribuce: website terms of use](https://www.cezdistribuce.cz/cs/informace-o-webu)
- [opravujeme.to: actions API](https://opravujeme.to/api/action)
- [KSÚS of the Central Bohemian Region: construction segments](https://stavby.ksus.cz/useky.json)
- [NDIC: subscriber registration](https://registr.dopravniinfo.cz/cs/providers/cz-ndic/)
- [GoOut: terms of use](https://terms.goout.net/article/450-podminky-uziti)
- [Bio Oko: programme](https://www.biooko.net/)
- [Featherless: tool calling](https://featherless.ai/docs/tool-calling)
- [Featherless: concurrency limits](https://featherless.ai/docs/concurrency-limits)
- [LangGraph.js: persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Meta: automated data collection](https://developers.facebook.com/docs/development/terms-and-policies/automated-data-collection/)
- [Discussion on parking data licensing (OpenStreetMap talk-cz)](https://lists.openstreetmap.org/pipermail/talk-cz/2024-December/027146.html)
- [Ministry of Transport methodology: providing traffic information](https://md.gov.cz/getattachment/Dokumenty/Veda-a-vyzkum/Certifikovane-metodiky/Ostatni-metodiky/Metodika-pro-poskytovani-dopravnich-informaci-exte/Metodika-pro-poskytovani-dopravnich-informaci-externim-odberatelum.pdf.aspx)
- [DATEX II application guide for the Czech Republic](https://md.gov.cz/getattachment/Dokumenty/Veda-a-vyzkum/Certifikovane-metodiky/Ostatni-metodiky/Metodika-Aplikacni-prirucka-pro-implementaci-DAT/Metodika-Aplikacni-prirucka-pro-implementaci-DATEX-II-v-CR.pdf.aspx)
- [ČEZ Distribuce: reporting an electricity supply interruption](https://www.cez.cz/cs/podpora/nahlaseni-preruseni-dodavky-elektricke-energie-poruchy)
- [Energozrouti: supply interruptions](https://energozrouti.cz/vyhledavani/Přerušení+dodávek+)
- [Ministry of the Interior: authorities publishing open data](https://mv.gov.cz/clanek/podpora-transparentnosti-a-digitalizace-uz-pres-170-uradu-zverejnuje-informace-ve-forme-otevrenych-dat.aspx)
- [Open data: Úřední deska (notice board) dataset](https://opendata.gov.cz/datova-sada:uredni-deska)
- [Open data MV: API description](https://opendata.mv.gov.cz/popis-api/)
