# Feed Trainer: aplikace

Lokální panel pro řízení agenta a živé grafy výsledků.

```
npm run app        # → http://localhost:4321
```

## Co umí

- **Cíl z přirozeného popisu** (záložka Nový cíl): třeba „chci víc aut a F1, míň vaření, testovací účet, ať skončí dnes do 20:00, max 3 dolary“.
  - Model přes Featherless (`COMPILER_MODEL`, výchozí `deepseek-ai/DeepSeek-V4.1-Flash-1017`) z popisu sestaví job definition podle WORKFLOW.md, sekce 3: téma, popis pro klasifikátor, podtémata k hledání, staré téma, typ účtu, tempo, limity, čas konce a aktivní hodiny.
  - Server výstup zvaliduje (zod, jeden opravný pokus) a doplní výchozí hodnoty (`normalizeGoal`). Vynutí i pravidla: neznámý účet = skutečný, skutečný účet = bezpečné tempo, „Naplno“ jen na výslovné přání, čas v minulosti se zahodí.
  - Model nesmí nastavit `reset_recommendations`, `dm_share_recipient` ani `control_account_id`.
  - Výsledek vyplní formulář a ukáže, co model doplnil sám, na co se ptá a na co upozorňuje. Nic se nespustí, dokud to nepotvrdíš (Spustit nebo Jen uložit cíl). Původní popis se uloží do cíle jako `source_query`.
- **Spustit a zastavit běh**: uložený cíl z `goals/`, nový cíl z formuláře (uloží se do `goals/<id>.json`) nebo test na napodobenině Instagramu (`test/run-fixture.ts`).
  - Režim **Jen sledovat** spouští agenta s `--dry-run`, **Naplno** s `--live`.
  - První **Zastavit** pošle Ctrl+C (agent dokončí akci a uloží stav), druhé ho ukončí hned.
- **Živá data** přes Server-Sent Events z toho, co agent už zapisuje:
  - `logs/events-<goal_id>.jsonl`: reels, měření, cykly, upozornění,
  - `logs/steps-<session>.jsonl`: kde agent právě je,
  - `data/state.json` a `data-test/state.json`: cykly, náklady, rozpočty akcí, konečný stav a zpráva.
- **Běh spuštěný z terminálu** (`npm start`) panel taky ukáže živě. Agenta z aplikace pak nespustí, protože by se pral o profil prohlížeče.

## Grafy

| Graf | Co ukazuje |
|---|---|
| Oficiální měření | T (téma) a O (staré téma) při každém měření M, 95% interval, cíl a práh průkaznosti (horní hranice M0) |
| Živě: reels z feedu | klouzavý `feed_alignment` (posledních 20 reels z feedu) + pruh všech reels podle verdiktu |
| Reels podle zdroje | měření / feed / hledání / startovní / navazující / Explore / profil, rozdělené podle verdiktu |
| Akce dnes vs. rozpočet | využití denních rozpočtů ze sekce 8 WORKFLOW.md |
| Klasifikace (Judge) | podíl reels ohodnocených z textu, se screenshotem a těch, kde Judge nestihl odpovědět |

## Technika

- Server: `app/server.ts`, jen `node:http`, bez nových závislostí. Kód agenta se nemění, aplikace ho spouští jako samostatný proces.
- Panel: `app/public/`, čisté HTML/CSS/JS a ručně kreslené SVG grafy, takže funguje i offline. Má světlý i tmavý režim.
- Server poslouchá jen na `127.0.0.1`. Akce (`POST`) vyžadují hlavičku `x-feed-trainer`, aby je nemohla spustit jiná webová stránka.
