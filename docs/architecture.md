# Architektura agenta

Agent je implementace pracovního postupu z **WORKFLOW.md** (Executor) jako stavový automat
v [LangGraph.js](https://langchain-ai.github.io/langgraphjs/). Kód je v `src/workflow/`.

## Stavový automat (WORKFLOW.md, sekce 6)

```
  start ─▶ M ─▶ CHECK ─┬─▶ F1 (úklid) ─▶ F2 ─▶ F3 ─▶ F4 ─▶ F5 ─┬─▶ PAUSE ─────▶ M
                       ├─▶ F2 …                                ├─▶ PAUSE_DAY ─▶ M
                       ├─▶ PERSIST_WAIT ─▶ M_PERSIST ─▶ CHECK  └─▶ FINAL_M ───▶ M_final ─▶ CHECK
                       └─▶ REPORT ─┬─▶ MAINTAIN (M → F3 10 min → F4, 1–2× denně)
                                   └─▶ END
  Z jakéhokoli uzlu:  STOP (sekce 11) ─▶ cooldown 24/48 h, druhý STOP ─▶ ABORTED ─▶ REPORT
                      hard limit (15.3) ─▶ FINAL_M
                      konec session (Ctrl+C, selector_missing 5×, karta 5 min neviditelná) ─▶ END
```

| Uzel | Co dělá | Kód |
|---|---|---|
| `start` | cooldown, PERSIST_WAIT, MAINTAIN, active_hours → kam začít | `graph.ts` |
| `measure` | protokol M: 10 min klidu, 20 dlaždic Explore bez klikání + 20 reels neutrálně 3–5 s, vždy Judge se screenshotem, surová data do `data/measurements/` | `phases.measure` |
| `check` | čítače (`delta`, `stagnation_count`, `success_streak`) a konečné stavy 15.1 v pořadí | `metrics.check` |
| `f1` | unfollow jen z `followed_by_agent` archivovaných cílů se starým tématem, 15–45 s mezi nimi | `phases.f1Cleanup` |
| `f2` | 3–5 / 1–2 dotazy (bez opakování 24 h), 3–5 výsledků; startovní reels + navazující reels; 1–3 tvůrci z Discovery | `phases.f2Search` |
| `f3` | smyčka reels 15–20 min, průběžný `feed_alignment` každých 20 reels | `phases.f3Reels` |
| `f4` | horké měření Explore před interakcí, otevřít 3–5 dlaždic s `target_score ≥ 0,8`, konec cyklu | `phases.f4Explore` |
| `f5` | pravidla F5_PLAN shora dolů (hard limit, denní limit, stagnace → nová podtémata) + `cycle_summary` | `phases.f5Plan` |
| `pause` / `pauseDay` | 10–30 min se zavřenou kartou / do dalšího `active_hours` | `graph.ts` |
| `persistWait` | ≥ 12 h bez tréninku; session skončí, další spuštění udělá M_PERSIST | `graph.ts` |
| `finalM` | ≥ 30 min pauza → M_final (vynechá se, kdyby nestihlo `hard_stop_at`) | `graph.ts` |
| `stop` | cooldown, `notify_user`, druhý STOP → ABORTED | `graph.ts` |
| `report` | závěrečná zpráva (sekce 16), `terminal` do stavu i logu | `report.ts` |

Reakce na každý reel (feed, search, profile, explore, seed, seed_chain) jde přes jednu funkci
`react.ts` podle **rozhodovací tabulky ze sekce 7**: TARGET_STRONG / OLD_TOPIC / TARGET_WEAK / NEUTRAL,
like až ve druhé polovině sledování, pravidlo sledování (2× TARGET_STRONG), rozpočty ze sekce 8.

## Konečné stavy (sekce 15)

Čistá funkce `metrics.check()` bez prohlížeče, otestovaná offline na všech větvích:

| Stav | Kdy |
|---|---|
| ABORTED | druhý STOP signál v cíli |
| SUCCESS_CONFIRMED | po M_PERSIST `T ≥ target − 0,1` a průkazné |
| SUCCESS | `T ≥ target`, `lift ≥ min_lift`, průkazné, 2× po sobě → PERSIST_WAIT nebo DONE |
| PLATEAU | stagnace ≥ 3, rozšíření ≥ 2, průkazné; nebo 2× nevydržené M_PERSIST |
| NO_EFFECT | k ≥ 6 bez průkaznosti, nebo stagnace bez průkaznosti |
| LIMIT_REACHED | po FINAL_M |
| CANCELLED | přepnutí cíle (`run.ts`, `switchGoal`) |

Průkaznost = 95% Wilsonův interval: `L_k > U_0`.

## Moduly

| Soubor | Obsah |
|---|---|
| `workflow/goal.ts` | konfigurace cíle (sekce 3), výchozí limity a rozpočty podle `mode` (8, 15.3), `real` → `safe` |
| `workflow/store.ts` | trvalý stav `data/state.json` (sekce 10), rozpočty den/hodina |
| `workflow/judge.ts` | Judge přes Featherless (`ChatOpenAI`): `target_score`, `old_topic_score`, `subtopic`; text → při nejistotě screenshot v 1,5 s → po 4 s NEUTRAL; bez klíče klíčová slova (`judge-kw-v1`). Zrychlení viz níže |
| `workflow/discovery.ts` | fronta startovních reels a tvůrců přes Apify, ověřených přes Judge (≥ 0,85, staré < 0,2, ≤ 30 dní) |
| `workflow/metrics.ts` | Wilson, T/O/lift, CHECK |
| `workflow/react.ts` | rozhodovací tabulka |
| `workflow/phases.ts` | M, F1–F5 |
| `workflow/graph.ts` | stavový automat v LangGraph |
| `workflow/guards.ts` | STOP signály, viditelnost karty, hard limity, `selector_missing` |
| `workflow/actions.ts` | Explore, profil, follow/unfollow, zvuk, hledání |
| `workflow/report.ts` | závěrečná zpráva |
| `workflow/run.ts` | spuštění session, přepnutí cíle |

## Rychlost Judge

Reel mimo téma se má přeskočit za 1–2 s, ale model odpovídá 1,5–4 s, takže reakce stojí hlavně na hodnocení dopředu:

| Mechanismus | Kde |
|---|---|
| **Rychlá shoda**: celé slovo nebo hashtag z tématu/podtémat → TARGET_STRONG bez modelu (jen pozitivně, ne při měření M) | `Judge.quickMatch` |
| **Hodnocení dopředu**: popisky 2 dalších reels v DOM se hodnotí, zatímco agent kouká na aktuální | `react.prefetchUpcoming`, `Judge.prefetch` |
| **Nápověda z dlaždice**: alt text dlaždice (hledání, profil) se hodnotí před kliknutím; v F4 se použije skóre z mřížky | `phases.tileHint` |
| **Krátký výstup** `{"t","o","s"}` bez zdůvodnění, `maxTokens` 60, bez „thinking“ u Qwen3 | `Judge.prompt` |
| **Model** `Qwen3-VL-30B-A3B` pro text i obrázky. Qwen2.5-7B (rychlejší, 1,4–2 s) na skutečných popiscích hádal t=1,0 i s „důkazem“ u 4/7 nesmyslných popisků; VL-30B 0 falešných shod. Latence 1,2–3,5 s, občas 18–31 s | `config.ts` |
| **Důkaz `e`**: odměna (like, uložení, follow) jen když text nebo obrázek téma výslovně dokládá; jinak max. TARGET_WEAK | `react.ts`, `Judge.prompt` |
| **Obrázek u každého reelu ve feedu**: snímek v ~1,2 s jde souběžně s textem, platí první podložený výsledek; jinak po 4 s NEUTRAL | `Judge.judgeReel` |
| **Protichůdné skóre** (cíl ≥ 0,5 i staré téma ≥ 0,6) = NEUTRAL | `categorize` |
| **M bez blokování**: snímek hned, reel přesně 3–5 s, hodnocení na pozadí; chyba Judge 1× opakovaná | `phases.measure` |

Změna Judge zvedá `judge_version` (teď `judge-v2:…`) a CHECK před porovnáním přehodnotí uložené M0 (`rescoreBaseline`).

## Rychlé iterování

`npm start -- --live --iterate --goal …` zkrátí dlouhá čekání × 0,15 (F3 15–20 → 2,3–3 min, pauza 10–30 → 1,5–4,5 min,
studený start 10 → 1,5 min, pauza před FINAL_M 30 → 4,5 min). Tempo reakcí na reel a protokol M zůstávají skutečné,
limity se počítají ve skutečných minutách. Čísla z takového běhu nejsou srovnatelná s během v plném tempu.

## Logy

- `logs/events-<goal_id>.jsonl`: události podle sekce 12 (`reel`, `measurement`, `check`, `cycle_summary`, `stop`, `terminal`, `selector_missing`, `capability_missing`, `notify` …).
- `logs/steps-<session>.jsonl` + konzole: každý krok grafu (`▶` vstup, `✓` výstup s dobou a výsledkem, `!` varování, `✗` chyba).

## Kde se implementace liší od WORKFLOW.md

| Co | Proč / stav |
|---|---|
| odměna u TARGET_STRONG | like 0,6 → 0,9 a uložení 0,3 → 0,5 podle skóre (0,8 → 1,0), nastavitelné v `goal.reward`; WORKFLOW.md má like 0,5 a save 0,2 napevno. Rozpočty ze sekce 8 platí dál |
| `not_interested` | webové Reels ho nemají; první pokus zaloguje `capability_missing` a v session se dál nezkouší. Uložit na webu funguje (Reels i příspěvky) |
| `share_dm` | neimplementováno (zaloguje `capability_missing`) |
| kontrolní účet | neimplementováno (jeden prohlížeč = jeden účet); `net_lift` je `null` |
| `reset_recommendations` | jen zaloguje, reset přes web neimplementován |
| Discovery | ověřuje z popisku a hashtagů, ne z celého videa s přepisem; „čistotu“ autora neověřuje |
| střídání jazyků dotazů | dotazy se berou náhodně z podtémat (podtémata zadej v různých jazycích) |
| PERSIST_WAIT | session skončí; po 12 h agenta spusť znovu |
| náklady | LLM z tokenů × cena modelu, Apify odhadem $2,60 / 1 000 výsledků, proxy se nepočítá |
| selektory Explore, profil, unfollow, hledání | **zatím neověřené na živém Instagramu** (Reels ano) |

## Zjištění z ostrého běhu (2026-11-13, účet real, režim safe)

- **M0** prošlo: Explore mřížka i 20 reels se čtou správně, výchozí stav T₀ = 0 % (U₀ ≈ 9 %).
- **Hledání** funguje (dotaz → výsledky → otevření → reakce). Okno příspěvku z hledání i Reels mají tlačítko Uložit (`save` prošlo).
- **Startovní reels (hypotéza 14a):** web po otevření `/reels/<kód>/` pokračuje dalšími reels, ale **tématicky nenavazují**
  (u obou startovních reels byly navazující 3× po sobě NEUTRAL → řetěz skončil). Signál je tedy hlavně z odměny startovního reelu.
- **Latence Judge** byla hlavní problém: s původním modelem a dlouhou odpovědí mělo 17 ze 43 hodnocení `timeout` (> 4 s)
  a reels k tématu z hledání se přeskakovaly jako NEUTRAL. Řešení viz „Rychlost Judge“.
- **Discovery**: Apify + ověření 60 kandidátů trvalo ~3 min (sekvenčně); teď po 3 najednou a s rychlejším modelem.
