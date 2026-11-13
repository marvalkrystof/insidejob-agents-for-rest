# Deferred: decisions and tasks for later

A list of things we have deliberately deferred so they do not get lost. The features with their priority and status are in [FEATURES.md](FEATURES.md); this file holds only open decisions, legal debts and technical follow-ups from the spikes. Spike evidence is stored locally in `.spikes/` (gitignored, contains personal data, never commit).

## Decisions

- [ ] **Facebook:** after the fixture (1 run of `apify/facebook-groups-scraper`, ~USD 0.05), decide: live, fixture only, or drop. Prerequisite: the URL of a public Kladno group (find it manually in the FB app, labelled "Veřejná skupina" (Public group)); the `APIFY_TOKEN` works (verified live, `/v2/users/me`).
- [ ] **TomTom:** evaluate TomTom Traffic Incidents API coverage for Czechia, as a live source of closures in the Central Bohemian Region.
- [ ] **Hosting:** local for now; decide whether to move the web app and Parking MCP to Apify (Standby Actor).
- [ ] **Location in the repo:** root or a subfolder (the team shares the repo with other ideas).
- [ ] **Open questions from the brainstorm:** demo "wow" (depth) vs. breadth of modules; emphasise the accessibility layer as social impact?

## Legal and terms of use

The prototype knowingly ignores the terms and robots.txt rules below. Resolve them before public deployment or publishing the Actor.

- [ ] **ČEZ Distribuce (`api.bezstavy.cz`):** the terms of use prohibit reading the data with automated scripts ([informace-o-webu](https://www.cezdistribuce.cz/cs/informace-o-webu)). Ask for permission.
- [ ] **mestokladno.cz:** robots.txt `User-agent: * / Disallow: /` also disallows the notice-board open-data URL registered in NKOD and the `File.ashx` attachments. Write to the city hall, or document the interpretation "distribution in NKOD = intended for reuse". The city website's terms have not been read.
- [ ] **GoOut:** the terms allow only private use without consent ([terms of use](https://terms.goout.net/article/450-podminky-uziti)). Ask GoOut for consent or a partnership.
- [ ] **Bio Oko:** the website content terms have not been read.
- [ ] **KSÚS (`stavby.ksus.cz/useky.json`):** an internal map file, not declared as open data.
- [ ] **Facebook / Meta:** ToS 3.2.3 prohibits automated collection without permission; robots.txt `Disallow: /`. GDPR: store only summaries, no names.
- [ ] **Personal data in sources:** notice board (names, dates of birth, addresses in decisions), opravujeme.to (names and phone numbers of responsible persons). Do not display, do not store, send only the necessary minimum to the LLM.
- [ ] **Notice-board links:** official notice URLs contain applicants' names in the slug; the digest and the web page link to them as the source.
- [ ] **Attribution:** NDIC via TamTam (CC BY 4.0, "Zdrojem digitalizovaných informací o silničním provozu je NDIC" (The source of the digitised road traffic information is NDIC)), IPR Praha paid parking zones (ZPS) (CC BY 4.0), PID RSS (CC BY).
- [ ] **Golemio:** the key is non-transferable (relevant if the Parking MCP is hosted for others); repeating identical calls is prohibited, so every call is cached per endpoint TTL in `data/golemio-cache/`. The self-service key sees the `tsk_v2` paid-zone segments and tariffs, but they are `open_data=false` in the DB, so the open-data licence may not cover publishing them.

## Technical follow-ups from the spikes

- [ ] **NDIC:** registration at mobilitydata.rsd.cz (signed form, manual approval by ŘSD); closure data only via HTTP PUSH, so a custom receiver is needed.
- [ ] **Notice board:** OCR of scanned attachments (`tesseract -l ces`, in the sample 4 of 15 PDFs have no text), extraction of closure dates, fixing `&amp;` in document URLs.
- [ ] **Fixtures:** fixtures (`fixtures/`, gitignored) contain personal names from notice-board titles: sanitize them before committing.
- [ ] **ČEZ (`api.bezstavy.cz`):** verify the actual data horizon (~14 days observed) and the shape of a cancelled outage (`cancelled_at`).
- [ ] **Events in Praha 7 via GoOut:** venue pages are rendered in the browser (Playwright), or parse `window.__NUXT__`.
- [ ] **Golemio weekday index:** confirm that index `0` in `/v3/parking/{id}/average-occupancy` is Sunday (inferred from its flat profile, not documented).
- [ ] **Golemio tariff gaps:** the Praha 7 blue and violet zone tariffs have no charge rows for 06:00–07:59 and none for public holidays, and the orange one none at weekends; the Parking MCP reports these hours as not covered (`estimate`). Check the actual zone rules on the city's paid-parking pages.
- [ ] **MR Parkit tariffs in Golemio:** hourly prices with a 6 to 12 hour minimum, day and weekend passes; verify what they mean and whether a booking through MR Parkit is needed.
- [ ] **Notice-board municipality filter:** replace the leading-name heuristic with the list of ORP Kladno municipalities, so that items about another municipality of the ORP are recognised and dropped (the heuristic lets through items such as "Územní plán Kačice").
- [ ] **Featherless:** `Qwen/Qwen3-30B-A3B-Instruct-2507` (1 concurrency unit, cheapest) returns HTTP 500 `no_response`; re-test if a cheaper model is needed.
