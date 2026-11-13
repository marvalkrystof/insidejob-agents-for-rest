# Feed Trainer (PoC)

Agent, který trénuje tvůj Instagram Reels feed směrem, který si zvolíš („chci víc aut“).
Běží lokálně ve skutečném prohlížeči: reels k tématu dokouká a občas olajkuje nebo uloží,
ostatní po 1–2 s přeskočí a občas označí „Nemám zájem“. Každý reel zapíše do logu,
ze kterého je vidět, jak roste podíl reels k tématu.

> ⚠️ Automatizace porušuje podmínky Instagramu. Používej **testovací účet**, na **osobním
> počítači a síti** (firemní sítě Instagram často blokují).

## Spuštění

```bash
npm install
cp .env.example .env          # doplň FEATHERLESS_API_KEY a GOAL
npm start -- --inspect        # 1. kontrola selektorů: vypíše, co vidí ve 3 reelech
npm start                     # 2. DRY RUN: jen kouká a přeskakuje, žádné akce
npm start -- --live           # 3. naostro: like, uložit, sledovat, vyhledávání
npm start -- --live --goal goals/fitness-2026-11-13.json   # cíl podle WORKFLOW.md (vzor: docs/examples/goal.example.json)
```

Při prvním spuštění se otevře okno prohlížeče a přihlásíš se ručně (zvládne i 2FA).
Přihlášení zůstane v profilu `.profile/`, agent heslo nikdy nevidí.

## Jak to „simuluje člověka“

- **Skutečný prohlížeč s oknem** (Chrome, nebo Edge), trvalý profil, tvoje IP. Žádný podvržený
  fingerprint: lokálně je nejvěrohodnější ten skutečný.
- **[Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)** místo Playwrightu odstraňuje
  stopy automatizace (`navigator.webdriver`, únik přes CDP `Runtime.enable` aj.).
- **Myš po Bézierových křivkách** s přestřelením, kliky mimo střed, scroll po několika impulzech,
  log-normální prodlevy, občas delší pauza.
- **Doba sledování se počítá z `video.currentTime`**, ne z hodin, takže buffering se nezapočítá.
- **Rozpočty akcí za hodinu a den** podle WORKFLOW.md (sekce 8) a okamžitý STOP s cooldownem,
  když Instagram ukáže „Zkuste to později“, ověření nebo captchu.

## Struktura

| Soubor | Co dělá |
|---|---|
| `src/main.ts` | vstup: přihlášení člověkem, `--inspect`, spuštění workflow, souhrn |
| `src/workflow/` | agent podle WORKFLOW.md: stavový automat v LangGraph, měření, konečné stavy ([docs/architecture.md](docs/architecture.md)) |
| `src/instagram.ts` | **vše, co závisí na DOM Reels** (selektory podle `aria-label`, CZ + EN) |
| `src/human.ts` | lidský pohyb myši, švihnutí, psaní, prodlevy |
| `src/log.ts` | logování každého kroku (konzole + `logs/steps-*.jsonl`) |
| `src/seed.ts` | stahování reels přes Apify ([docs/apify-seed.md](docs/apify-seed.md)) |
| `src/browser.ts` | spuštění prohlížeče (místo pro výměnu za Crawlee + fingerprint-suite v cloudu) |
| `goals/` | cíle, které ukazuje dashboard a spouští `npm start -- --goal …`; vzor se všemi poli je v `docs/examples/goal.example.json` |
| `test/` | napodobenina Instagramu a end-to-end test celého workflow (`npm run test:fixture`) |

Bez `FEATHERLESS_API_KEY` Judge klasifikuje jen podle klíčových slov.
Trvalý stav: `data/state.json`. Logy: `logs/events-<cíl>.jsonl` (události) a `logs/steps-*.jsonl` (kroky).

## Dokumentace

- [docs/architecture.md](docs/architecture.md): stavový automat podle WORKFLOW.md, konečné stavy, odchylky
- [docs/apify-seed.md](docs/apify-seed.md): jak získat první reels k tématu přes Apify (`npm run seed`)
