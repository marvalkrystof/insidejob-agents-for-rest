# Odloženo: rozhodnutí a úkoly na později

Seznam věcí, které jsme vědomě odložili, aby nezapadly. Rozsah funkcí podle priorit (MVP, V2, V3) je v [daily-local-digest.md](daily-local-digest.md), tady jsou jen otevřená rozhodnutí, právní dluhy a technické follow-upy ze spiků. Důkazy ze spiků jsou lokálně v `.spikes/` (gitignored, obsahuje osobní údaje, nikdy necommitovat).

## Rozhodnutí

- [ ] **Facebook:** po fixture (1 běh `apify/facebook-groups-scraper`, ~0,05 USD) rozhodnout: živě, jen fixture, nebo vypustit. Předpoklad: URL veřejné kladenské skupiny (najít ručně v aplikaci FB, štítek „Veřejná skupina“) a `APIFY_TOKEN`.
- [ ] **TomTom:** založit klíč (doba jízdy s dopravou, `arriveAt` pro „vyjeď v 7:05“), nebo použít konstantu + penalizaci za uzavírky. Zvážit TomTom Traffic Incidents API jako živý zdroj uzavírek ve Středočeském kraji (pokrytí ČR neověřeno).
- [ ] **Featherless tarif:** zjistit, na jakém plánu jsou kredity (Chat: 4 concurrency units a 32K kontext; Developer / Pay-As-You-Go: 100 units). Podle toho volba modelu a paralelismu.
- [ ] **Hosting:** zatím lokálně; rozhodnout, zda web a Parking MCP přesunout na Apify (Standby Actor).
- [ ] **Umístění v repu:** kořen, nebo podsložka (repo sdílí tým s dalšími nápady).
- [ ] **Otevřené otázky z brainstormu:** demo „wow“ (hloubka) vs. šíře modulů; zdůraznit vrstvu přístupnosti jako sociální dopad?

## Právní a podmínky užití

Prototyp vědomě ignoruje podmínky a robots.txt níže. Před veřejným nasazením nebo publikací Actoru vyřešit.

- [ ] **ČEZ Distribuce (`api.bezstavy.cz`):** Pravidla užití zakazují čtení dat automatizovanými skripty ([informace-o-webu](https://www.cezdistribuce.cz/cs/informace-o-webu)). Požádat o svolení.
- [ ] **mestokladno.cz:** robots.txt `User-agent: * / Disallow: /` zakazuje i open-data URL úřední desky registrovanou v NKOD a přílohy `File.ashx`. Napsat magistrátu, nebo doložit výklad „distribuce v NKOD = určeno k opakovanému použití“. Podmínky webu města nepřečteny.
- [ ] **GoOut:** podmínky povolují bez souhlasu jen soukromé užití ([podmínky užití](https://terms.goout.net/article/450-podminky-uziti)). Požádat GoOut o souhlas nebo partnerství.
- [ ] **Bio Oko:** podmínky obsahu webu nepřečteny.
- [ ] **KSÚS (`stavby.ksus.cz/useky.json`):** interní soubor mapy, není deklarován jako otevřená data.
- [ ] **Facebook / Meta:** ToS 3.2.3 zakazuje automatizovaný sběr bez povolení; robots.txt `Disallow: /`. GDPR: ukládat jen shrnutí, žádná jména.
- [ ] **Osobní údaje ve zdrojích:** úřední deska (jména, data narození, adresy v rozhodnutích), opravujeme.to (jména a telefony odpovědných osob). Nezobrazovat, neukládat, do LLM posílat jen nutné minimum.
- [ ] **Atribuce:** NDIC přes TamTam (CC BY 4.0, „Zdrojem digitalizovaných informací o silničním provozu je NDIC“), IPR Praha ZPS (CC BY 4.0), PID RSS (CC BY).
- [ ] **Golemio:** zákaz opakovat stejná volání (cachovat), klíč nepřenosný; ověřit, zda samoobslužný klíč vidí tarify `tsk_v2` (v DB `open_data=false`).

## Technické follow-upy ze spiků

- [ ] **NDIC:** registrace na mobilitydata.rsd.cz (podepsaný formulář, ruční schválení ŘSD), data uzavírek jen jako HTTP PUSH, takže je potřeba vlastní přijímač.
- [ ] **Úřední deska:** OCR naskenovaných příloh (`tesseract -l ces`, ve vzorku 4 z 15 PDF bez textu), extrakce termínů uzavírek, filtr podle obce (zhruba polovina dopravních položek se týká jiných obcí ORP Kladno), oprava `&amp;` v URL dokumentů.
- [ ] **Úřední deska živě:** ověřit, že JSON-LD endpoint funguje i po 30. 9. 2026 (ověřeno jen na snímku z Wayback Machine).
- [ ] **ČEZ (`api.bezstavy.cz`):** ověřit skutečný horizont dat (pozorováno ~14 dní) a tvar zrušené odstávky (`cancelled_at`).
- [ ] **Akce v Praze 7 přes GoOut:** stránky míst se vykreslují v prohlížeči (Playwright) nebo parsování `window.__NUXT__`.
- [ ] **Golemio s klíčem:** živě ověřit `/v3/parking-measurements`, `/v3/parking/{id}/average-occupancy` a `/v3/parking-tariffs` pro P+R Zličín 1 a 2, Nové Butovice, Kotlářka.
- [ ] **Featherless s klíčem:** živý test tool callingu a JSON mode (skripty v `.spikes/llm/`).
