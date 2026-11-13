# Seed: první reels k tématu přes Apify

Než agent začne scrollovat feed, stáhne přes [Apify](https://apify.com) pár reels k tématu
a otevře je přímo v prohlížeči: dokouká, olajkuje, občas sleduje autora. To je pro
algoritmus silný signál hned na začátku, místo čekání, až téma přijde ve feedu samo.
Po posledním seed reelu agent prostě scrolluje dál a feed na seed navazuje.

Kód: [`src/seed.ts`](../src/seed.ts), samostatné vyzkoušení: [`src/seed-cli.ts`](../src/seed-cli.ts).

## Nastavení

1. Účet na Apify → **Settings → API & Integrations** → zkopíruj **Personal API token**.
2. Do `.env` přidej `APIFY_TOKEN=apify_api_…`
3. Vyzkoušej bez prohlížeče:

```bash
npm run seed -- --tags supercars,porsche,motorsport
npm run seed -- --keywords "car review" --take 5
npm run seed -- --users topgear,supercarblondie --per 10
```

Výstup jsou URL ve tvaru `https://www.instagram.com/reels/<shortCode>/`. Ty se otevřou přímo
v prohlížeči Reels (stejný formát URL, jaký Instagram ukazuje při scrollování).

## Použité actory

Oba jsou oficiální actory od Apify, scrapují veřejná data a **nepotřebují tvoje přihlášení**.
Vstupy jsou ověřené z jejich input schema (`GET /v2/acts/<actor>/builds/default`).

### `apify/instagram-hashtag-scraper`: reels podle tématu

| Pole | Typ | Poznámka |
|---|---|---|
| `hashtags` | `string[]` | **povinné**, s `#` nebo bez |
| `resultsType` | `"posts"` \| `"reels"` \| `"stories"` | výchozí `posts`, **pro nás `reels`** |
| `resultsLimit` | `number` | počet výsledků (platí se za výsledek) |
| `keywordSearch` | `boolean` | `true` = `hashtags` jsou klíčová slova, ne hashtagy; víc slov výsledky zužuje |

```json
{ "hashtags": ["supercars", "porsche"], "resultsType": "reels", "resultsLimit": 15 }
```

### `apify/instagram-reel-scraper`: reels konkrétních autorů

| Pole | Typ | Poznámka |
|---|---|---|
| `username` | `string[]` | **povinné**: jména, URL profilů, ID nebo přímo URL reelů |
| `resultsLimit` | `number` | reels na profil |
| `skipPinnedPosts` | `boolean` | vynechat připnuté (bývají staré) |
| `onlyPostsNewerThan` | `string` | jen reels od data |

```json
{ "username": ["topgear"], "resultsLimit": 10, "skipPinnedPosts": true }
```

Hodí se, když plánovač zjistí, kteří autoři k tématu fungují (ze seedu nebo z feedu), a chce jich víc.

### Pole z výstupu, která používáme

Oba actory vrací položky ve stejném formátu. Bereme:
`shortCode`, `url`, `type` (`"Video"`), `productType` (`"clips"` = reel), `caption`, `hashtags`,
`ownerUsername`, `videoDuration`, `videoPlayCount` / `igPlayCount` / `videoViewCount`, `timestamp`.

## Jak se volá Apify API

Asynchronní běh s dotazováním. Synchronní `run-sync-get-dataset-items` po 300 s končí chybou 408
a scrapování Instagramu může trvat déle.

```
POST /v2/acts/apify~instagram-hashtag-scraper/runs?waitForFinish=60   (tělo = vstup actoru)
GET  /v2/actor-runs/<runId>?waitForFinish=60                           (opakovat do SUCCEEDED/FAILED/…)
GET  /v2/datasets/<defaultDatasetId>/items?clean=true&format=json
Authorization: Bearer <APIFY_TOKEN>
```

## Výběr seedu (`pickSeed`)

- jen videa 5–90 s,
- ne starší než 180 dní (`maxAgeDays`),
- seřazené podle přehrání, max. 2 od jednoho autora (`maxPerOwner`), bez duplicit,
- vezme `take` (výchozí 8) a zamíchá je, ať agent nejde vždy od nejpopulárnějšího.

Výsledky se ukládají do `logs/seed-cache/` na 24 h, takže stejný dotaz se neplatí dvakrát.

## Cena

Podle stránky actoru zhruba **$1,90–2,60 za 1 000 výsledků** (záleží na plánu). Typický seed:
3 hashtagy × 15 = 45 výsledků, tedy zhruba **10–12 centů**. Na hackathon stačí free kredity.

## Jak seed zapadá do agenta

Je to samostatný stav grafu, viz [architecture.md](architecture.md):

```
checkSession → seed (Apify) → watchSeed (otevřít každý reel, dokoukat, like) → observe → … (feed)
```

- **Vstup stavu:** `goal`, z něj hashtagy a klíčová slova (od plánovače, fallback `toHashtag` z klíčových slov).
- **Výstup:** `seedQueue: SeedReel[]`.
- **watchSeed:** pro každý reel `goto(reelsUrl)` → sledovat celé → like s vyšší pravděpodobností než ve feedu
  → občas follow autora. Mezi reely lidská pauza.
  Poslední seed reel je zároveň vstupní bod do feedu: agent z něj začne scrollovat.
- **Kdy znovu:** plánovač může seed spustit znovu, když podíl reels k tématu ve feedu stagnuje
  (jiné hashtagy, nebo reel scraper na autory, kteří se ve feedu osvědčili).

## Neověřeno

- **Skutečný běh actorů s tokenem:** vstupy jsou převzaté ze schématu, ale actory se zatím nespouštěly.
- **Navazování feedu na otevřený reel:** že feed po otevření `/reels/<code>/` naváže na ten reel, je
  předpoklad z toho, jak se mění URL při scrollování. Ověřit na prvním běhu.
