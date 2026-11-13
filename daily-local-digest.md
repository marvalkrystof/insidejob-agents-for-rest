# Domovník: osobní lokální digest

Pracovní název: **Domovník** (alternativy: Okolí, Dnes u nás, Radar).

Jednou větou: aplikace, která za uživatele hlídá všechno, co se děje kolem jeho domova, cesty do práce a zájmů, a třikrát denně (konfigurovatelně) mu pošle krátké shrnutí toho, co je pro něj dnes relevantní, včetně konkrétní akce, kterou má udělat.

Stav dokumentu: výsledek brainstormu a ověřovacích spiků (kapitola 7). Tvrzení označená **(ověřeno)** vychází z průzkumu zdrojů nebo živých requestů, tvrzení označená **(neověřeno)** je nutné před implementací ověřit. Odložená rozhodnutí, právní dluhy a follow-upy jsou v [LATER.md](LATER.md).

---

## 1. Problém

Informace, které ovlivňují každodenní život, jsou roztříštěné na desítkách míst a většina z nich se člověk dozví pozdě nebo vůbec:

- odstávka vody, elektřiny nebo plynu ve vlastním domě se objeví na webu distributora, na vývěsce nebo v e-mailu od SVJ
- výluka nebo uzavírka na cestě do práce se zjistí až v koloně
- úřední deska obce, usnesení zastupitelstva a stavební řízení v okolí nečte nikdo
- akce v okolí (kino, divadlo, koncerty, trhy) se hledají ručně na pěti webech
- lokální komunita (hledání ztracených mazlíčků, nálezy, sousedská pomoc) žije ve Facebook skupinách
- parkování v cíli cesty se řeší až na místě

Žádný existující nástroj to nespojuje do jednoho přehledu osobního pro konkrétní adresu a konkrétní den.

## 2. Vize

Domovník funguje jako osobní "domovník a sekretář" místa, kde člověk žije:

- **Proaktivní.** Neptá se uživatel, ptá se systém: "Zítra ti bude v 8 hodin chybět voda a na tvé trase je výluka, vyjeď o 25 minut dřív."
- **Lokální.** Zná adresu domu, obec, kraj, trasu do práce, zájmy.
- **Akční.** Každá položka obsahuje další krok (odkaz na vstupenky, doporučený čas odjezdu, kam zaparkovat, komu zavolat).
- **Tichý.** Když není co hlásit, neposílá nic nebo jednu větu "dnes je klid". Hodnota stojí na relevanci, ne na objemu.
- **Konfigurovatelný.** Uživatel si skládá moduly, frekvenci a citlivost.

### Persony

| Persona | Co ji zajímá nejvíc |
|---|---|
| Dojíždějící zaměstnanec v paneláku | trasa a zpoždění, odstávky v domě, parkování v cíli, SVJ |
| Rodina s dětmi na vesnici | úřední deska obce, akce pro děti, svoz odpadu, ztracená zvířata |
| Senior | odstávky, lékárny, akce, jednoduchý jazyk, jedno ranní shrnutí |
| Majitel zvířete | ztracení a nalezení mazlíčci v okolí, veterináři |
| Člověk s omezenou mobilitou | výpadky výtahů v MHD, bezbariérové akce a trasy |

## 3. Moduly (zdroje informací)

Každý modul je samostatný Apify Actor (nebo malá služba) s jednotným výstupním schématem (viz sekce 6).

### 3.1 Domov a obec

| Zdroj | Co sleduje | Poznámka |
|---|---|---|
| Úřední deska obce / města / kraje | usnesení, výběrová řízení, územní a stavební řízení, uzavírky, svoz odpadu, volby | Povinná otevřená data pro státní orgány, kraje a obce s rozšířenou působností od 1. 2. 2022, ale **neexistuje jednotné API pro všechny obce** (ověřeno). NKOD je jen katalog odkazů (561 desek podle OFN). Kladno publikuje desku jako OFN JSON-LD, pole `agenda` chybí, přílohy jsou z velké části PDF s textovou vrstvou, zbytek skeny (ověřeno na archivní kopii). |
| Web obce a zpravodaj | novinky, akce, oznámení | Scrapování webu a PDF zpravodaje, LLM extrakce. |
| SVJ a správce domu | odstávky v domě, revize plynu, výtahu, komínů, odečty, shromáždění | Většinou neveřejné (viz blockery). |
| Distributoři energií a vody | plánované odstávky elektřiny, plynu, vody | Elektřina, ČEZ Distribuce: veřejný vyhledávač na webu ČEZ volá JSON API `api.bezstavy.cz` bez přihlášení, data až na úroveň čísla popisného s rozlišením „tato adresa“ a „v obci“, časy v UTC, odkaz na PDF oznámení (ověřeno). Pravidla užití webu ČEZ zakazují automatizované čtení (ověřeno). Praha a Roztoky patří PREdistribuci, ne ČEZ (ověřeno). Voda a plyn: nic strukturovaného nenalezeno. |
| Svoz odpadu a komunální služby | termíny svozu, sběrné dvory | Často v PDF nebo na webu obce. |

### 3.2 Cesta do práce

| Zdroj | Co sleduje |
|---|---|
| Dopravní informace (výluky, uzavírky, nehody) | stav na trase |
| Odhad zdržení | porovnání obvyklé a aktuální doby jízdy |
| MHD | výluky, výpadky linek, výpadky výtahů a eskalátorů |
| Parkování v cíli | viz sekce 5 (MCP) |

### 3.3 Akce a volný čas

| Zdroj | Co sleduje |
|---|---|
| Kina, divadla, kluby, festivaly, GoOut, Ticketportal a podobně | program v okolí podle zájmů |
| Vstupenky | přímý odkaz na nákup, dostupnost (pokud ji zdroj uvádí) |
| Lokální trhy, sportovní akce, akce obce | okolní dění |

Pozn.: scrapování prodejců vstupenek podléhá jejich podmínkám. V MVP stačí odkaz na stránku akce, ne automatický nákup. GoOut má na stránkách výpisů schema.org `Event` v JSON-LD (Kladno ano, Praha 7 ve výpisech chybí), podmínky GoOut ale bez souhlasu povolují jen soukromé užití (ověřeno). Bio Oko (Praha 7) má na úvodní stránce JSON-LD s daty v ISO a cenou (ověřeno). Kudy z nudy vyžaduje písemný souhlas, Apify Store nemá Actor pro GoOut ani Ticketportal (ověřeno).

### 3.4 Komunita

| Zdroj | Co sleduje | Poznámka |
|---|---|---|
| Veřejné Facebook skupiny obce | ztracení a nalezení mazlíčci, nalezené věci, sousedská pomoc, varování | Apify nabízí scrapery pouze pro veřejné skupiny bez přihlášení (ověřeno), ale spolehlivost je u různých Actorů rozdílná. Oficiální `apify/facebook-groups-scraper`: 99,8 % úspěšných běhů za 30 dní, 0,005 USD za příspěvek (ověřeno). Veřejnou skupinu pro Kladno se bez přihlášení dohledat nepodařilo, vyhledávače skupiny neindexují (ověřeno). |
| Alternativní zdroje | weby pro hledání ztracených zvířat, Bazoš, lokální weby | Záloha, pokud Facebook nepůjde. |

### 3.5 Zájmová témata a zprávy

- uživatel zadá témata (volné klíčové věty, např. "elektromobilita", "bydlení v Brně", "FC Zbrojovka")
- zdroje: RSS, zpravodajské weby, lokální média
- LLM filtruje podle tématu a **novosti** (řeší jen to, co se od posledního digestu změnilo)

### 3.6 Nápady navíc (výběr podle důležitosti pro uživatele)

- počasí s dopadem na plány (déšť v době cesty domů, mráz a doporučení)
- pyl a kvalita ovzduší pro alergiky
- lékárny, pohotovost a termíny (např. volné termíny očkování)
- sběrné dny, svoz objemného odpadu
- stavební práce a uzavírky chodníků v okolí domu
- kalendář státních svátků a omezení provozu obchodů
- ceny paliv v okolí trasy
- plánované odstávky internetu a mobilních operátorů
- uzavírky škol a školek, změny jízdních řádů
- bezbariérový režim: bezbariérové akce, výpadky výtahů, trasy bez schodů

## 4. Funkcionality

Priorita: **MVP** (hackathon, 5 hodin), **V2** (po hackathonu), **V3** (vize).

### 4.1 Profil a konfigurace

| Funkce | Priorita |
|---|---|
| Zadání domovské adresy (geokódování, výběr obce, kraje, okresu) | MVP |
| Zadání adresy práce a času odjezdu, výpočet trasy | MVP |
| Výběr modulů (zapnout a vypnout) | MVP |
| Zadání zájmů volným textem | MVP |
| Zadání názvu SVJ a způsobu předávání informací (přeposílání e-mailů, fotka nástěnky) | V2 |
| Citlivost upozornění (jen urgentní, vše důležité, vše) | V2 |
| Tiché hodiny a dny | V2 |
| Více profilů (domov, chata, rodiče) | V3 |
| Sdílený profil domácnosti | V3 |

Příklad profilu (schéma pro implementaci):

```yaml
user:
  language: en
home:
  address: "Ulice 12, Kladno"
  municipality: "Kladno"
  building: { type: panelak, svj: "SVJ Ulice 12" }
commute:
  to: "Firma, Praha 7"
  depart: "07:30"
  days: [mon, tue, wed, thu, fri]
  mode: park_and_ride   # car | transit | bike | park_and_ride (auto na P+R, dál MHD)
interests: ["elektromobilita", "stand-up", "FC Zbrojovka"]
modules:
  municipality_board: true
  utilities_outages: true
  traffic: true
  parking: true
  events: true
  community_groups: ["<url veřejné skupiny>"]
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

### 4.2 Doručování souhrnů

| Funkce | Priorita |
|---|---|
| Ranní souhrn (jeden, konfigurovatelný čas) | MVP |
| Až 3 souhrny denně (ráno, poledne, večer) | V2 |
| Týdenní souhrn (nadcházející odstávky, akce na víkend, změny v obci) | V2 |
| Měsíční souhrn (co se změnilo v obci, výstavba, rozhodnutí zastupitelstva, rozpočet) | V3 |
| Okamžité urgentní upozornění mimo plán (např. výluka na trase 30 minut před odjezdem) | V2 |
| Kanály: Telegram bot | MVP |
| Kanály: webový přehled | MVP |
| Kanály: e-mail | V2 |
| Kanály: iCal feed, push notifikace | V3 |
| Souhrn jednou větou při "klidném dni" | V2 |

### 4.3 Doprava a trasa

| Funkce | Priorita |
|---|---|
| Výluky, uzavírky a nehody na trase | MVP |
| Odhad zdržení a doporučený čas odjezdu ("vyjeď o 20 minut dřív") | MVP |
| Alternativní trasa nebo přesun na MHD | V2 |
| Výpadky výtahů a eskalátorů v MHD pro mobilitně omezené | V3 |
| Zohlednění akcí v cíli (koncert, zápas) v odhadu dopravy a parkování | V2 |

### 4.4 Parkování

Viz sekce 5. Dostupné jako samostatný MCP server i jako modul digestu.

### 4.5 Domov, SVJ a obec

| Funkce | Priorita |
|---|---|
| Úřední deska jedné pilotní obce s LLM extrakcí "co se mě týká" | MVP |
| Plánované odstávky elektřiny podle adresy | MVP |
| Odstávky vody a plynu pro pilotní oblast | V2 |
| Příjem e-mailů z SVJ přes přeposílání na vyhrazenou schránku | V2 |
| Fotka nástěnky v domě, vision OCR, extrakce termínů do kalendáře | V2 |
| Svoz odpadu a kalendář | V2 |
| Stavební řízení a změny územního plánu do vzdálenosti X metrů od domu | V3 |

### 4.5a Události a vstupenky

| Funkce | Priorita |
|---|---|
| Akce v okolí podle zájmů | MVP |
| Odkaz na nákup vstupenek u každé akce | MVP |
| Upozornění "předprodej začíná" a "zbývá málo míst" (pokud zdroj data má) | V3 |
| Skládání dne: akce, doprava, parkování, večeře | V3 |

### 4.6 Komunita

| Funkce | Priorita |
|---|---|
| Veřejné Facebook skupiny: ztracení a nalezení mazlíčci a věci v okolí | V2 (v MVP jen s pevně vybranou skupinou a zálohovanými daty) |
| Párování fotek: uživatel nahraje fotku svého mazlíčka a systém upozorní na podobná nalezená zvířata | V3 |
| Lokální varování (výpadky, krádeže aut, nebezpečné křižovatky) | V3 |

### 4.7 Zájmy a zprávy

| Funkce | Priorita |
|---|---|
| Zprávy podle zadaných témat s filtrem novosti | V2 |
| Shrnutí "co je nového od posledně" místo seznamu odkazů | V2 |

### 4.8 Kvalita a důvěra

| Funkce | Priorita |
|---|---|
| Každá položka má zdroj, odkaz a čas načtení | MVP |
| Skóre jistoty (ověřený zdroj vs. odhad z volného textu) | MVP |
| Vysvětlení, proč se položka zobrazila ("protože bydlíš na X") | V2 |
| Zpětná vazba (užitečné, neužitečné) a učení relevance | V2 |
| Detekce duplicit napříč zdroji | MVP |

### 4.9 Soukromí

| Funkce | Priorita |
|---|---|
| Adresa se ukládá minimálně (obec, ulice, případně souřadnice zaokrouhlené) | MVP |
| Žádné ukládání jmen a osobních údajů z komunitních skupin, jen shrnutí | MVP |
| Smazání všech dat jedním krokem | V2 |
| Lokální režim (zpracování bez účtu) | V3 |

## 5. Parking MCP

Cíl: agent (např. Claude) umí odpovědět na "Kam zaparkuju v cíli cesty a kolik to bude stát?" a Domovník to využije v digestu.

Apify nabízí hostovaný MCP server a umožňuje vystavit Actory jako nástroje (ověřeno: `https://mcp.apify.com`, výběr nástrojů přes parametr `tools`). Parking MCP je vlastní server nad Actory a otevřenými daty.

### Nástroje (tools)

| Tool | Vstup | Výstup |
|---|---|---|
| `find_parking_near` | cíl (adresa nebo souřadnice), čas příjezdu, max. vzdálenost pěšky, typ (ulice, garáž, P+R), omezení (ZTP, EV nabíjení) | seznam míst s vzdáleností, cenou, odhadem volnosti |
| `get_parking_tariff` | místo, datum a čas | tarif, zóna, max. doba, výjimky |
| `get_pr_occupancy` | ID parkoviště P+R | aktuální a historická obsazenost (pokud existuje) |
| `estimate_parking_difficulty` | cíl, čas | skóre 0 až 100 podle denní doby, akcí v okolí, obsazenosti a historie |
| `get_nearby_events` | cíl, čas | akce, které zhorší parkování (koncert, zápas) |
| `suggest_park_and_ride` | cíl, čas příjezdu | kombinace P+R a MHD s celkovým časem a cenou |
| `get_parking_restrictions` | místo, datum | omezení (čištění ulic, uzavírky, dočasné zákazy stání) |

### Datové zdroje parkování

- **Praha, Golemio API (Operátor ICT):** produkční server `api.golemio.cz`, modul Parking pokrývá parkování, zóny, tarify a měření; klíč je samoobslužný přes registraci e-mailem, limit 20 requestů za 8 s (ověřeno z dokumentace). Bez klíče vrací parkovací endpointy 401 (ověřeno). Obsazenost P+R je v `/v3/parking-measurements` (zdroj `tsk-offstreet`), hodinové průměry podle dne v týdnu v `/v3/parking/{id}/average-occupancy` (ověřeno z OpenAPI, živě s klíčem neověřeno). Oficiální P+R na západě Prahy s počítáním míst: Zličín 1, Zličín 2, Nové Butovice, Kotlářka; Nádraží Veleslavín ani Dlouhá Míle oficiální P+R nejsou (ověřeno). Licence: datová sada OICT „Parkování API“ v LKOD deklaruje bez autorských a databázových práv pro open-data podmnožinu, sekundární zdroj `osm` je pod ODbL (ověřeno).
- **Praha, zóny placeného stání:** IPR ArcGIS vrací bez klíče typ úseku a kód tarifu (např. `P7-0169`) pod CC BY 4.0 (ověřeno); ceny tarifů jen přes Golemio `/v3/parking-tariffs` s klíčem (neověřeno).
- **PID mimořádnosti a výluky:** RSS `pid.cz/feed/rss-vyluky` a `rss-mimoradnosti` a GTFS-RT `alerts.pb` na Golemiu fungují bez klíče (ověřeno).
- **Ostatní města:** nenalezeno, bude nutné ověřit (Brno, Ostrava, Plzeň a další městské open data portály) **(neověřeno)**.
- **Záloha:** OpenStreetMap pro polohy parkovišť, tarify ze stránek měst, odhad obtížnosti heuristikou (denní doba, akce poblíž).

Poznámka k návrhu: každý tool vrací pole `confidence` (živá data / historická / odhad), aby agent nepředstíral jistotu, kterou nemá.

## 6. Architektura

```
Konfigurace uživatele
        |
Plánovač (Apify Schedules) --> Actory po modulech (dopravní info, úřední desky,
        |                      odstávky, akce, komunita, zprávy, parkování)
        v
Jednotné schéma položky (Item) --> deduplikace --> geokódování a filtr podle profilu
        |
Skórování relevance (pravidla + LLM) --> sestavení souhrnu s citacemi (LLM)
        |
Doručení (e-mail, Telegram) + webový přehled
```

Jednotné schéma položky:

```json
{
  "id": "hash(zdroj + klíč)",
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

Klíčová rozhodnutí:

- **Scrapuje se podle lokality, ne podle uživatele.** Výsledky pro obec se sdílejí mezi všemi uživateli z ní. Cena i zátěž zdrojů roste s počtem obcí, ne uživatelů.
- **LLM se používá na extrakci a sestavení textu, ne jako zdroj faktů.** Každé tvrzení musí odkazovat na zdrojovou položku.
- **Relevance:** nejdřív tvrdé filtry (poloha, čas, trasa), pak LLM skórování proti zájmům.
- **Plánování:** Apify Schedules na úrovni modulů, souhrn se skládá z již načtených dat.
- **Stack:** TypeScript všude (Actory, logika, web, MCP).
- **LLM:** Featherless.ai (OpenAI-kompatibilní API) orchestrovaný přes LangGraph.js; stav grafu drží checkpointer. U `withStructuredOutput` je nutné `method: "functionCalling"` nebo `"jsonMode"`, výchozí `json_schema` Featherless nedokumentuje (ověřeno v kódu `@langchain/openai`). Kandidát na model: `Qwen/Qwen3-30B-A3B-Instruct-2507` (tool calling podle dokumentace, živě neověřeno).
- **Hosting:** nejdřív lokálně, případně později Apify.

## 7. Blockery a rizika

Hodnocení: **Vysoké** = hrozí, že modul v plném rozsahu nepůjde; **Střední** = řešitelné s kompromisem; **Nízké** = nuisance.

Celkový verdikt: **žádný blocker nebrání MVP v pilotu Kladno → Praha 7, pokud se zúží rozsah**. Největší rizika jsou Facebook skupiny, SVJ, čas na hackathonu a podmínky užití zdrojů; odstávky elektřiny jsou pro pilot řešitelné přes API ČEZ.

| # | Riziko | Úroveň | Co víme | Obejití |
|---|---|---|---|---|
| B1 | Facebook skupiny | Vysoká | Oficiální Apify scraper zvládá jen veřejné skupiny bez přihlášení; scrapování za přihlášením porušuje podmínky Facebooku. Komunitní Actory se liší, některé i veřejné skupiny bez přihlášení nezvládnou (ověřeno). Podmínky Facebooku omezují automatizovaný přístup i k veřejným datům (Meta ToS 3.2.3, robots.txt `Disallow: /`, ověřeno); na jména a polohy se vztahuje GDPR. Veřejnou kladenskou skupinu se bez přihlášení nepodařilo najít (ověřeno). | Fixture z jednoho běhu Actoru na ručně nalezené veřejné skupině, o živém provozu rozhodnout později ([LATER.md](LATER.md)); ukládat jen shrnutí bez jmen; alternativní zdroje (weby pro hledání ztracených zvířat); režim "uživatel přepošle příspěvek". Nespoléhat na něj jako na jádro. |
| B2 | SVJ a informace z domu | Vysoká | Informace jsou obvykle soukromé (e-mail, nástěnka, interní portál). Bez účasti uživatele nejsou dostupné. | Uživatel přeposílá e-maily na vyhrazenou adresu Domovníka; fotka nástěnky se zpracuje vision modelem; ruční zadání termínu. Je to funkce "bring your own data", ne scraping. |
| B3 | Odstávky vody, plynu, elektřiny | Střední | Elektřina: vyhledávač ČEZ Distribuce volá veřejné JSON API `api.bezstavy.cz` bez přihlášení, data až na číslo popisné, pozorovaný horizont asi 14 dní; Pravidla užití webu automatizované čtení zakazují (ověřeno). ČEZ nabízí i e-mail a SMS upozornění na odběrné místo. Pro vodu jen články a agregátory, pro plyn nic (ověřeno). | Pilot Kladno přes API ČEZ s uloženým snímkem pro demo; voda a plyn ve V2; příjem e-mailových upozornění přes přeposílání jako záloha. |
| B4 | Dopravní výluky a zpoždění | Střední | NDIC: registrace přes `mobilitydata.rsd.cz` s podepsaným formulářem a ručním schválením ŘSD, uzavírky jen jako HTTP PUSH (ověřeno z dokumentace), na hackathon nestihnutelné. Praha: `opravujeme.to/api/action` vrací JSON s geometrií bez klíče, aktuální data (ověřeno). Středočeský kraj: KSÚS `useky.json` (silnice II. a III. třídy) a snímek NDIC od TamTam (CC BY 4.0, aktualizace stojí) (ověřeno). PID výluky přes RSS bez klíče (ověřeno). Doba jízdy: TomTom Routing má 20 000 requestů měsíčně zdarma bez karty a parametr `arriveAt` (ověřeno z dokumentace). | opravujeme.to + KSÚS + PID RSS, filtr podle vzdálenosti od trasy; doba jízdy přes TomTom, záložně konstanta + penalizace za uzavírky. NDIC až po hackathonu. |
| B5 | Parkování mimo Prahu | Střední | Golemio pokrývá Prahu; obsazenost P+R je v API s klíčem, licence open-data podmnožiny je volná (ověřeno); pro ostatní města nic nenalezeno (ověřeno). | Parkování v cíli řešit přes pražská P+R; ostatní města heuristikou a odhadem s označenou nízkou jistotou. |
| B6 | Úřední desky obcí | Nízká (pro Kladno) | Povinná otevřená data jen pro část úřadů; jednotné API neexistuje; NKOD je jen katalog odkazů (ověřeno). Kladno má OFN JSON-LD, ale robots.txt webu města zakazuje všechny boty; ve vzorku 4 z 15 příloh skeny, `tesseract -l ces` je přečte (ověřeno). | JSON-LD Kladna, předfiltr podle názvů položek, LLM extrakce; OCR příloh až po MVP. |
| B7 | Vstupenky a akce | Střední | GoOut má JSON-LD, ale podmínky povolují bez souhlasu jen soukromé užití; Kudy z nudy vyžaduje písemný souhlas; Bio Oko má JSON-LD bez zjištěných omezení v robots.txt (ověřeno). | Odkazovat na stránku akce, nezkoušet nákup; GoOut pro Kladno, Bio Oko pro Prahu 7; souhlas GoOut řešit později ([LATER.md](LATER.md)). |
| B8 | Přesnost lokace | Střední | Odstávky bývají po ulicích nebo číslech popisných, výluky po úsecích; spárování s adresou není triviální. | Geokódování a porovnání názvu ulice; u nejistých shod označit jistotu a ukázat zdroj. |
| B9 | Halucinace LLM | Střední | LLM může vymyslet datum nebo místo. | Strukturovaná extrakce s citací původního textu, povinný odkaz, nepřeposílat nic bez zdrojové položky. |
| B10 | Soukromí a GDPR | Střední | Domovská adresa a trasa jsou citlivé osobní údaje; komunitní skupiny obsahují jména. | Minimalizace dat, zaokrouhlení souřadnic, žádné ukládání jmen, jasná možnost smazání. |
| B11 | Náklady a limity | Nízká | Počet Actorů a LLM volání roste s moduly. | Sdílená cache podle lokality, plánování po modulech, LLM jen nad novými položkami. |
| B12 | Přesypání informací | Nízká | Příliš mnoho zpráv uživatele odradí. | Prahy citlivosti, filtr novosti, "klidný den" bez zprávy. |
| B13 | Doručování | Nízká | E-mail je nejjednodušší; push a SMS jsou těžší. | MVP e-mail a Telegram bot; SMS jen později. |
| B14 | Čas na hackathonu | Vysoká | 5 hodin ve třech nestačí na všechny moduly; první zhruba 2 hodiny pracuje každý člen týmu na jiném nápadu, pak se tým sjednotí. | Sekce 9: jeden pilot, jeden profil, 4 až 5 modulů, zbytek ukázat jako roadmapu. |
| B15 | Podmínky užití a robots.txt zdrojů | Střední | Prototyp vědomě ignoruje zákazy automatizovaného čtení u ČEZ Distribuce, mestokladno.cz, GoOut, KSÚS a Facebooku (ověřeno). | Nízká frekvence, žádné přihlašování ani obcházení CAPTCHA; právní řešení před veřejným nasazením ([LATER.md](LATER.md)). |
| B16 | Limity LLM (Featherless) | Střední | Souběh podle tarifu a velikosti modelu, při překročení HTTP 429 bez fronty; tarif Chat má 4 units a kontext 32K (ověřeno z dokumentace). Tool calling živě neověřen. | Omezit souběh, retry na 429, extrakce přes `jsonMode` se zod validací, záložní model pro agenta. |

### Stav ověření (spiky)

| Spike | Verdikt | Klíčový důkaz |
|---|---|---|
| Golemio: obsazenost P+R | funguje s kompromisem | bez klíče 401; data `tsk-offstreet` v `/v3/parking-measurements` (živě s klíčem neověřeno) |
| Golemio a PID: výluky MHD | funguje | RSS výluk a GTFS-RT `alerts.pb` bez klíče vrací 200 |
| Doprava: uzavírky v Praze | funguje | `opravujeme.to/api/action`, JSON s geometrií bez klíče |
| Doprava: uzavírky ve Středočeském kraji | funguje s kompromisem | NDIC jen po registraci a přes PUSH; KSÚS a TamTam bez klíče, data neaktuální |
| Doprava: doba jízdy | funguje s kompromisem | TomTom potřebuje klíč (zdarma, bez karty), živě neověřeno |
| ČEZ Distribuce: odstávky podle adresy | funguje s kompromisem | `api.bezstavy.cz` bez přihlášení, granularita č.p.; podmínky webu automatizaci zakazují |
| Facebook: veřejná skupina Kladna | neověřeno | Actor spolehlivý; skupinu bez přihlášení dohledat nejde, běh Actoru čeká na URL a token |
| Úřední deska Kladno | funguje s kompromisem | OFN JSON-LD ověřen na archivní kopii; živé stažení zatím neproběhlo |
| Akce | funguje s kompromisem | GoOut JSON-LD (Kladno) + Bio Oko JSON-LD (Praha 7); GoOut jen soukromé užití |
| LLM: Featherless + LangGraph.js | funguje s kompromisem | `/v1/models` bez klíče 200, příznak `tool_use`; tool calling živě neověřen |

## 8. Kreativní směry a "wow" prvky

Na demo i do vize se hodí funkce, které ukazují více než agregaci:

- **"Čas odjezdu" místo seznamu.** Souhrn nekončí informací o výluce, ale větou: "Vyjeď v 7:05, ne v 7:30. Zaparkuj v P+R X, to vyjde o 12 minut rychleji."
- **Skládání dne.** Kino v 19:00 + doprava + parkování + vstupenky v jednom bloku "Dnešní večer".
- **Párování ztraceného mazlíčka podle fotky.** Uživatel nahraje fotku, systém hlídá komunitní nálezy a upozorní na podobné zvíře v okolí.
- **Předpověď problémů.** "Za 9 dní bude mít tvůj dům odstávku vody, ve stejném týdnu je výluka na tvé trase."
- **Změny od posledně.** Měsíční souhrn "co se v tvé obci změnilo" (usnesení, stavby, územní plán) v lidské řeči.
- **Příběh dne.** Úvodní věta souhrnu dává kontext: "Dnes je klidný den, jen jedna věc: večer koncert v centru, počítej s horším parkováním."
- **Domácnost jako tým.** Společný souhrn pro rodinu (kdo vyzvedává děti, kdo bude doma při odstávce).
- **Vrstva přístupnosti.** Přepínač pro lidi s omezenou mobilitou: bezbariérové akce, výpadky výtahů, trasy bez schodů.
- **Agentní vrstva.** Uživatel se může zeptat: "Kam v sobotu s dětmi, prší a mám 500 Kč?" Agent využije stejná data a nástroje (včetně Parking MCP).

## 9. MVP pro hackathon (5 hodin, 3 lidé, demo 3 minuty)

### Rozsah

- **Jeden pilot a jeden profil:** dojíždějící z Kladna (Středočeský kraj, ČEZ Distribuce, úřední deska Kladna) autem na pražské P+R a dál MHD do Prahy 7 – Holešovice. Digest a demo v angličtině.
- **Moduly:** doprava a výluky na trase, odstávky elektřiny podle adresy, úřední deska jedné obce, akce v okolí podle zájmů, parkování v cíli přes MCP.
- **Komunita (Facebook):** jen na demo, jedna pevně zvolená veřejná skupina, se zálohovanými daty pro případ selhání.
- **Výstup:** jedna ranní zpráva přes Telegram bot a jednoduchý webový přehled.

### Časový plán

| Čas | Data (osoba 1) | LLM a logika (osoba 2) | UI a demo (osoba 3) |
|---|---|---|---|
| 0:00 až 0:30 | společně: spiky z kapitoly 7, rozhodnutí o zdrojích a schématu Item | | |
| 0:30 až 2:00 | Actory pro 2 až 3 zdroje, výstup do schématu | extrakce a skórování, tvorba textu s citacemi | formulář profilu a kostra přehledu |
| 2:00 až 3:30 | Parking MCP, další zdroj | sestavení souhrnu, "čas odjezdu" | napojení, e-mail nebo Telegram, vzhled souhrnu |
| 3:30 až 4:00 | integrace, opravy, zálohy dat | | |
| 4:00 až 5:00 | nácvik dema, záložní video, slajd s vizí a roadmapou | | |

### Scénář dema (3 minuty)

1. **0:00 až 0:30:** Problém. Fiktivní osoba (dojíždějící v paneláku) a pět otevřených záložek každé ráno.
2. **0:30 až 1:00:** Nastavení profilu: adresa, práce, zájmy, přepínače modulů.
3. **1:00 až 2:15:** Ranní souhrn s konkrétním "vyjeď v 7:05", odstávkou v domě, akcí večer s odkazem na vstupenky a upozorněním z komunitní skupiny.
4. **2:15 až 2:45:** Parking MCP: agent odpoví "kam zaparkuju v cíli a co to bude stát".
5. **2:45 až 3:00:** Vize: týdenní a měsíční souhrn, SVJ přes e-mail, párování mazlíčků, další města.

## 10. Otevřené otázky pro tým

Rozhodnuto: pilot Kladno → Praha 7 (sekce 9), kanál Telegram + webový přehled (sekce 4.2), komunitní skupiny jako bonus s fixture daty (riziko B1). Otevřené otázky a odložená rozhodnutí jsou v [LATER.md](LATER.md).

## 11. Zdroje průzkumu

- [Apify Facebook Groups Scraper (blog)](https://blog.apify.com/scrape-facebook-groups-data/)
- [Apify MCP server (dokumentace)](https://docs.apify.com/mcp)
- [Golemio: Open data a API](https://operator-ict.gitlab.io/golemio/documentation/en/open-data-api/)
- [Golemio Parkings: OpenAPI specifikace](https://cdn.jsdelivr.net/npm/@golemio/parkings@1.28.2/docs/openapi-output.yaml)
- [Golemio: registrace API klíče](https://api.golemio.cz/api-keys/auth/sign-up)
- [PID: RSS výluk](https://pid.cz/feed/rss-vyluky/)
- [ČEZ Distribuce: ověření plánované odstávky](https://www.cezdistribuce.cz/cs/pro-zakazniky/potrebuji-vyresit/stavajici-pripojeni/overeni-planovane-odstavky)
- [ČEZ Distribuce: pravidla užití webu](https://www.cezdistribuce.cz/cs/informace-o-webu)
- [opravujeme.to: API akcí](https://opravujeme.to/api/action)
- [KSÚS Středočeského kraje: úseky staveb](https://stavby.ksus.cz/useky.json)
- [NDIC: registrace odběratele](https://registr.dopravniinfo.cz/cs/providers/cz-ndic/)
- [GoOut: podmínky užití](https://terms.goout.net/article/450-podminky-uziti)
- [Bio Oko: program](https://www.biooko.net/)
- [Featherless: tool calling](https://featherless.ai/docs/tool-calling)
- [Featherless: limity souběhu](https://featherless.ai/docs/concurrency-limits)
- [LangGraph.js: persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Meta: automatizovaný sběr dat](https://developers.facebook.com/docs/development/terms-and-policies/automated-data-collection/)
- [Diskuse o licenci parkovacích dat (OpenStreetMap talk-cz)](https://lists.openstreetmap.org/pipermail/talk-cz/2024-December/027146.html)
- [Metodika ministerstva dopravy: poskytování dopravních informací](https://md.gov.cz/getattachment/Dokumenty/Veda-a-vyzkum/Certifikovane-metodiky/Ostatni-metodiky/Metodika-pro-poskytovani-dopravnich-informaci-exte/Metodika-pro-poskytovani-dopravnich-informaci-externim-odberatelum.pdf.aspx)
- [Aplikační příručka DATEX II v ČR](https://md.gov.cz/getattachment/Dokumenty/Veda-a-vyzkum/Certifikovane-metodiky/Ostatni-metodiky/Metodika-Aplikacni-prirucka-pro-implementaci-DAT/Metodika-Aplikacni-prirucka-pro-implementaci-DATEX-II-v-CR.pdf.aspx)
- [ČEZ Distribuce: nahlášení přerušení dodávky](https://www.cez.cz/cs/podpora/nahlaseni-preruseni-dodavky-elektricke-energie-poruchy)
- [Energozrouti: přerušení dodávek](https://energozrouti.cz/vyhledavani/Přerušení+dodávek+)
- [Ministerstvo vnitra: úřady zveřejňující otevřená data](https://mv.gov.cz/clanek/podpora-transparentnosti-a-digitalizace-uz-pres-170-uradu-zverejnuje-informace-ve-forme-otevrenych-dat.aspx)
- [Otevřená data: datová sada Úřední deska](https://opendata.gov.cz/datova-sada:uredni-deska)
- [Open data MV: popis API](https://opendata.mv.gov.cz/popis-api/)
