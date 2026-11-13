import type { Deadline, RowDef, Source, YearParams } from '../types.ts';

const ZDP = 'https://e-sbirka.gov.cz/sb/1992/586/2025-10-01';
const ZVZP = 'https://e-sbirka.gov.cz/sb/1992/592/2025-07-01';
const DP_FORM = 'https://financnisprava.gov.cz/assets/tiskopisy/5405_30.pdf';
const DP_POKYNY = 'https://financnisprava.gov.cz/assets/tiskopisy/5405-1_33.pdf';
const DP_P1 = 'https://financnisprava.gov.cz/assets/tiskopisy/5405-P1_21.pdf';
const VZP_FORM = 'https://www.vzp.cz/formulare/prehled-osvc-2025.pdf';
const VZP_POUCENI = 'https://www.vzp.cz/formulare/prehled-osvc-2025-pouceni.pdf';
const ZDS = 'https://e-sbirka.gov.cz/sb/1992/589/2025-01-01';
const CSSZ_POKYNY = 'https://eportal.cssz.cz/documents/20122/35805/OSVC_2025_Pokyny+k+vypln%C4%9Bn%C3%AD.pdf/'
    + '97c07bf3-e0ac-53eb-de4a-fc0892ff4fea';
const CSSZ_2025 = 'https://www.cssz.gov.cz/web/cz/-/prehled-nejdulezitejsich-udaju-pro-socialni-zabezpeceni-v-'
    + 'roce-2025';
const CSSZ_ZALOHY = 'https://www.cssz.gov.cz/web/cz/zalohy-na-pojistne-na-duchodove-pojisteni';

const src = (url: string, quote: string): Source => ({ url, quote });

const dpfoRows: RowDef[] = [
    {
        form: 'dpfo',
        key: 'income',
        row: 'Příloha 1, ř. 101',
        label: 'Příjmy podle § 7 zákona',
        explanation: {
            en: 'All the money your business earned in 2025 that counts for income tax. With flat-rate expenses, '
                + 'this is the income from your record of receipts.',
            cs: 'Všechny příjmy z podnikání za rok 2025, které podléhají dani. U paušálních výdajů je to součet '
                + 'příjmů z vaší evidence příjmů.',
        },
        source: src(DP_P1, 'do řádku vyplňte úhrn příjmů ze samostatné činnosti (§ 7 zákona) ovlivňujících základ '
            + 'daně z příjmů fyzických osob podle zákona k 31. 12. 2025.'),
    },
    {
        form: 'dpfo',
        key: 'expenses',
        row: 'Příloha 1, ř. 102',
        label: 'Výdaje související s příjmy podle § 7 zákona',
        explanation: {
            en: 'Your costs. With flat-rate expenses (paušální výdaje) you do not prove them: they are a fixed % of '
                + 'income, capped. Also fill the % and amounts per activity in table "B. Druh činnosti" and tick '
                + '"Uplatňuji výdaje procentem z příjmů" on page 1.',
            cs: 'Vaše výdaje. U paušálních výdajů je nedokládáte, jsou to pevná % z příjmů se stropem. Vyplňte také '
                + 'sazbu a částky v tabulce „B. Druh činnosti“ a zaškrtněte „Uplatňuji výdaje procentem z příjmů“.',
        },
        source: src(DP_P1, 'Neuplatňujete-li výdaje v prokázané výši, uveďte výdaje uplatněné procentem z příjmů '
            + '(§ 7 odst. 7 zákona) [...] Pro výpočet výdajů uváděných na tomto řádku použijte níže uvedenou tabulku '
            + '„B. Druh činnosti“.'),
    },
    {
        form: 'dpfo',
        key: 'profit',
        row: 'Příloha 1, ř. 104 → ř. 113 → DAP ř. 37',
        label: 'Rozdíl mezi příjmy a výdaji / Dílčí základ daně podle § 7',
        explanation: {
            en: 'Income minus expenses: your taxable profit from the business. The same number goes to ř. 104 and '
                + 'ř. 113 of Příloha 1 and to ř. 37 of the main form. It is also the base for both insurance přehledy.',
            cs: 'Příjmy minus výdaje, tedy zisk z podnikání. Stejné číslo patří na ř. 104 a ř. 113 Přílohy 1 a na '
                + 'ř. 37 hlavního formuláře. Z něj se počítají i oba přehledy pro pojišťovny.',
        },
        source: src(DP_POKYNY, 'ř. 37 Dílčí základ daně nebo ztráta ze samostatné činnosti podle § 7 zákona '
            + '(ř. 113 přílohy č. 1 DAP) – přeneste údaj z ř. 113 Přílohy č. 1 DAP.'),
    },
    {
        form: 'dpfo',
        key: 'taxBase',
        row: 'ř. 41, 42, 45, 55',
        label: 'Základ daně',
        explanation: {
            en: 'Your tax base. With only business income and no deductions (odpočty), it equals the profit, so the '
                + 'same value goes to ř. 41, 42, 45 and 55.',
            cs: 'Základ daně. Bez dalších příjmů a odpočtů se rovná zisku, takže stejná hodnota patří na ř. 41, 42, '
                + '45 a 55.',
        },
        source: src(DP_POKYNY, 'ř. 42 Základ daně (ř. 36 + kladná hodnota z ř. 41) – pokud je ř. 41 záporný, '
            + 'uveďte pouze hodnotu z ř. 36.'),
    },
    {
        form: 'dpfo',
        key: 'taxBaseRounded',
        row: 'ř. 56',
        label: 'Základ daně zaokrouhlený na celá sta Kč dolů',
        explanation: {
            en: 'The tax base rounded DOWN to whole hundreds of Kč (e.g. 93 295 → 93 200). '
                + 'Tax is calculated from this.',
            cs: 'Základ daně zaokrouhlený na celé stovky DOLŮ (např. 93 295 → 93 200). Z něj se počítá daň.',
        },
        source: src(DP_POKYNY, 'uveďte základ daně z ř. 55 zaokrouhlený na celá sta Kč dolů (např. 93 295 Kč '
            + 'zaokrouhleno na 93 200 Kč) podle § 16 zákona.'),
    },
    {
        form: 'dpfo',
        key: 'incomeTax',
        row: 'ř. 57, 58, 60',
        label: 'Daň podle § 16 zákona / Daň zaokrouhlená na celé Kč nahoru',
        explanation: {
            en: '15 % of the rounded base up to 1 676 052 Kč, 23 % of anything above. The same amount goes to ř. 58 '
                + 'and, rounded up to whole Kč, to ř. 60.',
            cs: '15 % ze zaokrouhleného základu do 1 676 052 Kč, 23 % z části nad touto hranicí. Stejná částka patří '
                + 'na ř. 58 a zaokrouhlená na celé Kč nahoru na ř. 60.',
        },
        source: src(DP_POKYNY, 'daň podle § 16 zákona činí 15 % pro část základu daně do 36násobku průměrné mzdy '
            + 'a 23 % pro část základu daně přesahující 36násobek průměrné mzdy.'),
    },
    {
        form: 'dpfo',
        key: 'taxpayerCredit',
        row: 'ř. 64 (and ř. 70)',
        label: 'Částka slevy podle § 35ba odst. 1 písm. a) zákona (základní sleva na poplatníka)',
        explanation: {
            en: 'The basic discount every taxpayer gets: a fixed 30 840 Kč subtracted from the tax. With no other '
                + 'discounts, ř. 70 (total discounts) is the same amount.',
            cs: 'Základní sleva, kterou má každý poplatník: pevných 30 840 Kč, které se odečtou od daně. Bez dalších '
                + 'slev je na ř. 70 (úhrn slev) stejná částka.',
        },
        source: src(DP_POKYNY, 'ř. 64 Částka slevy podle § 35ba odst. 1 písm. a) zákona – uveďte částku 30 840 Kč.'),
    },
    {
        form: 'dpfo',
        key: 'taxAfterCredits',
        row: 'ř. 71',
        label: 'Daň po uplatnění slev podle § 35, § 35a, § 35b a § 35ba zákona (ř. 60 – ř. 70)',
        explanation: {
            en: 'Tax minus the discount. It cannot go below zero: the unused part of the discount is lost.',
            cs: 'Daň po odečtení slevy. Nemůže být záporná, nevyužitá část slevy propadá.',
        },
        source: src(DP_POKYNY, 'ř. 71 Daň po uplatnění slev [...] (ř. 60 – ř. 70) – uveďte výpočet podle pokynů. '
            + 'Pokud Vám vyšlo záporné číslo, do řádku uveďte nulu.'),
    },
    {
        form: 'dpfo',
        key: 'childBenefit',
        row: 'ř. 72',
        label: 'Daňové zvýhodnění na vyživované dítě',
        explanation: {
            en: 'The child benefit for the year: 15 204 Kč for the 1st child, 22 320 Kč for the 2nd, 27 840 Kč for '
                + 'each further child (double for a child with ZTP/P, not supported here). Fill in the children\'s '
                + 'details in the table on the form.',
            cs: 'Zvýhodnění na děti za rok: 15 204 Kč na první dítě, 22 320 Kč na druhé, 27 840 Kč na třetí a další '
                + '(u dítěte se ZTP/P dvojnásobek, tento nástroj nepodporuje). Údaje o dětech vyplňte do tabulky.',
        },
        source: src(DP_POKYNY, 'Nárok na daňové zvýhodnění činí 15 204 Kč ročně na jedno dítě (1 267 Kč měsíčně), '
            + '22 320 Kč ročně na druhé dítě (1 860 Kč měsíčně) a 27 840 Kč ročně na třetí a každé další dítě'),
    },
    {
        form: 'dpfo',
        key: 'childDiscount',
        row: 'ř. 73',
        label: 'Sleva na dani (částka z ř. 72, uplatněná maximálně do výše daně na ř. 71)',
        explanation: {
            en: 'The part of the child benefit used to reduce your tax, at most down to zero.',
            cs: 'Část zvýhodnění na děti, která sníží daň, nejvýše na nulu.',
        },
        source: src(DP_POKYNY, 'uveďte výši daňového zvýhodnění, které ve formě slevy na dani můžete uplatnit '
            + 'maximálně do výše vypočtené daňové povinnosti na ř. 71.'),
    },
    {
        form: 'dpfo',
        key: 'taxAfterChild',
        row: 'ř. 74, 75',
        label: 'Daň po uplatnění slevy podle § 35c zákona (ř. 71 – ř. 73) / Daň celkem',
        explanation: {
            en: 'Tax after the child discount. With no separate tax base, ř. 75 (total tax) is the same.',
            cs: 'Daň po slevě na děti. Bez samostatného základu daně je ř. 75 (daň celkem) stejný.',
        },
        source: src(DP_POKYNY, 'uveďte daň po uplatnění slevy podle § 35c, tj. rozdíl daně na ř. 71 a uplatněné '
            + 'slevy na dani na ř. 73.'),
    },
    {
        form: 'dpfo',
        key: 'childBonus',
        row: 'ř. 76',
        label: 'Daňový bonus (ř. 72 – ř. 73)',
        explanation: {
            en: 'If the child benefit is bigger than your tax, the rest is paid out to you as a bonus. Only if '
                + 'your 2025 income was at least 124 800 Kč (6× minimum wage) and the bonus is at least 100 Kč.',
            cs: 'Pokud je zvýhodnění na děti vyšší než daň, zbytek dostanete vyplacený jako bonus. Jen pokud byly '
                + 'vaše příjmy alespoň 124 800 Kč (6× minimální mzda) a bonus je alespoň 100 Kč.',
        },
        source: src(ZDP, '§ 35c (4): Daňový bonus může uplatnit poplatník, který ve zdaňovacím období měl příjem '
            + 'podle § 6 nebo 7 alespoň ve výši šestinásobku minimální mzdy.'),
    },
    {
        form: 'dpfo',
        key: 'taxAfterBonus',
        row: 'ř. 77',
        label: 'Daň celkem po úpravě o daňový bonus (ř. 75 – ř. 76)',
        explanation: {
            en: 'Your final tax for the year after the bonus. Zero if the bonus is bigger.',
            cs: 'Konečná daň za rok po započtení bonusu. Nula, pokud je bonus vyšší.',
        },
        source: src(DP_FORM, 'Daň celkem po úpravě o daňový bonus (ř. 75 – ř. 76), pokud je na řádku záporné číslo '
            + 'uveďte nulu'),
    },
    {
        form: 'dpfo',
        key: 'bonusPayable',
        row: 'ř. 77a',
        label: 'Daňový bonus po odpočtu daně (ř. 76 – ř. 75)',
        explanation: {
            en: 'The bonus that will be paid out to you after your tax is covered.',
            cs: 'Bonus, který vám bude vyplacen po pokrytí daně.',
        },
        source: src(DP_FORM, 'Daňový bonus po odpočtu daně (ř. 76 – ř. 75), pokud je na řádku záporné číslo '
            + 'uveďte nulu'),
    },
    {
        form: 'dpfo',
        key: 'taxAdvancesPaid',
        row: 'ř. 85',
        label: 'Na zbývajících zálohách zaplaceno poplatníkem celkem',
        explanation: {
            en: 'Income tax advances you paid yourself during 2025. Most freelancers have none.',
            cs: 'Zálohy na daň z příjmů, které jste během roku 2025 sami zaplatili. Většina OSVČ žádné nemá.',
        },
        source: src(DP_POKYNY, 'uveďte souhrn záloh, které jste zaplatil (zaplatila), v průběhu zdaňovacího '
            + 'období 2025'),
    },
    {
        form: 'dpfo',
        key: 'taxBalance',
        row: 'ř. 91',
        label: 'Zbývá doplatit: (+) zbývá doplatit, (–) zaplaceno více',
        explanation: {
            en: 'What you owe the tax office. Positive: pay this by the filing deadline. Negative: you get a refund '
                + '(request it in the "Žádost o vrácení přeplatku" block on page 4). Tax of 200 Kč or less is not '
                + 'collected.',
            cs: 'Kolik dlužíte finančnímu úřadu. Kladné číslo zaplaťte do termínu pro podání. Záporné znamená '
                + 'přeplatek (požádejte o vrácení na straně 4). Daň do 200 Kč se nevybírá.',
        },
        source: src(DP_POKYNY, 'ř. 91 Zbývá doplatit – kladná částka znamená, že zbývá na dani doplatit vypočtenou '
            + 'částku. Záporná částka znamená, že bylo zaplaceno více.'),
    },
];

const csszRows: RowDef[] = [
    {
        form: 'cssz',
        key: 'socialTaxBase',
        row: 'ř. 20',
        label: 'Daňový základ',
        explanation: {
            en: 'Your business profit from ř. 37 of the tax return. This form has no income or expense rows.',
            cs: 'Zisk z podnikání z ř. 37 daňového přiznání. Formulář nemá řádky pro příjmy a výdaje.',
        },
        source: src(CSSZ_POKYNY, 'ř. 20 Daňový základ – uveďte dílčí základ daně z příjmů z podnikání a z jiné SVČ '
            + 'stanovený podle § 7 zákona č. 586/1992 Sb., o daních z příjmů'),
    },
    {
        form: 'cssz',
        key: 'socialMonths',
        row: 'ř. 13, 21, 22',
        label: 'V roce 2025 jsem vykonával/a SVČ / Počet měsíců (Hlavní | Vedlejší)',
        explanation: {
            en: 'In ř. 13 tick "jen hlavní" or "jen vedlejší" and "1-12". In ř. 21 and 22 enter 12 in the column for '
                + 'your activity type. Secondary activity also needs the reason in section C (e.g. ř. 14 Zaměstnání). '
                + 'If you do not tick secondary, it is treated as main and cannot be changed later.',
            cs: 'V ř. 13 označte „jen hlavní“ nebo „jen vedlejší“ a „1-12“. Do ř. 21 a 22 napište 12 ve sloupci vaší '
                + 'činnosti. U vedlejší činnosti vyplňte důvod v oddílu C (např. ř. 14 Zaměstnání). '
                + 'Neoznačená vedlejší '
                + 'činnost se bere jako hlavní a později to nejde změnit.',
        },
        source: src(CSSZ_POKYNY, 'ř. 13 V roce 2025 jsem vykonával/a SVČ – označte typ SVČ v jednotlivých měsících '
            + 'roku 2025, pokud jste výkon činnosti hlavní či vedlejší vykonával/a po celý kalendářní rok, označte '
            + 'kolonku „1–12”.'),
    },
    {
        form: 'cssz',
        key: 'socialAvgMonthly',
        row: 'ř. 23',
        label: 'Průměrný měsíční daňový základ',
        explanation: {
            en: 'The profit divided by the 12 months.',
            cs: 'Zisk vydělený 12 měsíci.',
        },
        source: src(CSSZ_POKYNY, 'ř. 23 Průměrný měsíční daňový základ – daňový základ, tj. ř. 20, vydělte počtem '
            + 'měsíců výkonu SVČ'),
    },
    {
        form: 'cssz',
        key: 'socialComputedBase',
        row: 'ř. 25',
        label: 'Vypočtený vyměřovací základ',
        explanation: {
            en: '55 % of your profit, rounded up. Secondary activity with profit under 111 736 Kč pays no pension '
                + 'insurance for 2025, so enter 0 in ř. 25 to 32.',
            cs: '55 % zisku zaokrouhleno nahoru. Vedlejší činnost se ziskem pod 111 736 Kč za rok 2025 pojistné '
                + 'neplatí, do ř. 25 až 32 uveďte 0.',
        },
        source: src(CSSZ_POKYNY, 'OSVČ, která v roce 2025 vykonávala jen hlavní SVČ, stanoví vypočtený VZ jako 55 % '
            + 'daňového základu. Součin ř. 20 a čísla 0,55 zaokrouhleno na celé koruny směrem nahoru.'),
    },
    {
        form: 'cssz',
        key: 'socialFloorBase',
        row: 'ř. 27',
        label: 'Minimální vyměřovací základ',
        explanation: {
            en: 'ř. 25, but at least the yearly minimum: 195 540 Kč for main activity, 61 464 Kč for secondary.',
            cs: 'Hodnota z ř. 25, nejméně však roční minimum: 195 540 Kč u hlavní činnosti, 61 464 Kč u vedlejší.',
        },
        source: src(CSSZ_POKYNY, 'Minimální vyměřovací základ OSVČ vykonávající jen hlavní SVČ – uveďte částku '
            + 'z ř. 25 [...] nesmí činit méně než 195 540 Kč'),
    },
    {
        form: 'cssz',
        key: 'socialBase',
        row: 'ř. 28, 30, 31',
        label: 'Určený vyměřovací základ / Vyměřovací základ ze SVČ',
        explanation: {
            en: 'The base your pension insurance is calculated from: ř. 27, capped at 2 234 736 Kč. You may choose '
                + 'a higher amount (for a higher pension), this tool uses the minimum. With no employment, ř. 29 is 0 '
                + 'and ř. 30 and 31 equal ř. 28.',
            cs: 'Základ, ze kterého se počítá pojistné: ř. 27, nejvýše 2 234 736 Kč. Můžete si určit vyšší (kvůli '
                + 'vyššímu důchodu), nástroj počítá s minimem. Bez zaměstnání je ř. 29 nula a ř. 30 a 31 se rovnají '
                + 'ř. 28.',
        },
        source: src(CSSZ_POKYNY, 'ř. 28 Určený vyměřovací základ [...] tato částka však nemůže být nižší, než je '
            + 'částka v ř. 27, a vyšší, než je maximální VZ, který činí částku 2 234 736 Kč.'),
    },
    {
        form: 'cssz',
        key: 'socialContribution',
        row: 'ř. 32.1, 32.3',
        label: 'Pojistné na DP / Pojistné po slevě',
        explanation: {
            en: 'Your pension insurance for the year: 29,2 % of ř. 31, rounded up. Without a pensioner discount, '
                + 'ř. 32.2 is 0 and ř. 32.3 is the same.',
            cs: 'Pojistné na důchodové pojištění za rok: 29,2 % z ř. 31 zaokrouhleno nahoru. Bez slevy pro důchodce '
                + 'je ř. 32.2 nula a ř. 32.3 stejný.',
        },
        source: src(CSSZ_POKYNY, 'ř. 32.1 Pojistné na DP – [...] činí 29,2 % z VZ. Částku uvedenou v ř. 31 '
            + 'vynásobte 0,292 a zaokrouhlete na celé koruny směrem nahoru.'),
    },
    {
        form: 'cssz',
        key: 'socialAdvancesPaid',
        row: 'ř. 33',
        label: 'Úhrn zaplacených záloh na DP',
        explanation: {
            en: 'All monthly advances you paid for the months of 2025. Do not include old doplatky or penalties.',
            cs: 'Součet záloh zaplacených za měsíce roku 2025. Nezahrnujte doplatky za dřívější roky ani penále.',
        },
        source: src(CSSZ_POKYNY, 'ř. 33 Úhrn zaplacených záloh na DP – do úhrnu se započtou platby na zálohy na DP '
            + 'uhrazené za měsíce roku 2025.'),
    },
    {
        form: 'cssz',
        key: 'socialBalance',
        row: 'ř. 34',
        label: 'Výsledný Doplatek/Přeplatek (rozdíl mezi řádky 32 a 33)',
        explanation: {
            en: 'Positive: you must pay this (doplatek) within 8 days after filing. Negative: you overpaid '
                + '(přeplatek).',
            cs: 'Kladné: doplatek, zaplaťte do 8 dnů po podání. Záporné: přeplatek.',
        },
        source: src(CSSZ_POKYNY, 'je-li výsledné pojistné na DP vyšší než úhrn zaplacených záloh na DP, bude výsledná '
            + 'částka plusová a půjde o doplatek'),
    },
    {
        form: 'cssz',
        key: 'socialNewMonthlyBase',
        row: 'ř. 35',
        label: 'Měsíční vyměřovací základ',
        explanation: {
            en: 'The monthly base for your new advances: 55 % of the profit divided by 12, rounded up, at least the '
                + 'current minimum (17 139 Kč main from July 2026, 5 387 Kč secondary).',
            cs: 'Měsíční základ pro nové zálohy: 55 % zisku děleno 12, zaokrouhleno nahoru, nejméně aktuální minimum '
                + '(hlavní 17 139 Kč od července 2026, vedlejší 5 387 Kč).',
        },
        source: src(CSSZ_POKYNY, 'ř. 35 Měsíční vyměřovací základ – nejnižší měsíční VZ pro placení záloh na DP ř. 20 '
            + 'se vynásobí číslem 0,55 a vydělí číslem z ř. 21'),
    },
    {
        form: 'cssz',
        key: 'socialNewAdvance',
        row: 'ř. 36',
        label: 'Měsíční záloha na DP',
        explanation: {
            en: 'Your new monthly pension insurance advance: 29,2 % of ř. 35, rounded up. It applies from the month '
                + 'AFTER you file this přehled.',
            cs: 'Nová měsíční záloha: 29,2 % z ř. 35 zaokrouhleno nahoru. Platí od měsíce NÁSLEDUJÍCÍHO po podání '
                + 'přehledu.',
        },
        source: src(CSSZ_ZALOHY, 'Nově stanovená výše zálohy platí až od měsíce následujícího po měsíci, ve kterém byl '
            + '(nebo měl být) přehled podán'),
    },
];

const vzpRows: RowDef[] = [
    {
        form: 'vzp',
        key: 'healthTaxBase',
        row: 'ř. 3',
        label: 'Daňový základ',
        explanation: {
            en: 'Your business profit, copied from ř. 37 of the tax return (ř. 113 of Příloha 1). A loss is entered '
                + 'as 0. This form has no income or expense rows.',
            cs: 'Zisk z podnikání, opsaný z ř. 37 daňového přiznání (ř. 113 Přílohy 1). Ztráta se uvádí jako 0. '
                + 'Formulář nemá řádky pro příjmy a výdaje.',
        },
        source: src(VZP_POUCENI, 'Do řádku č. 3 se uvede daňový základ za rok 2025. [...] z řádku 37 Daňového '
            + 'přiznání (řádek 113 Přílohy č. 1).'),
    },
    {
        form: 'vzp',
        key: 'healthMonths',
        row: 'ř. 4, ř. 5',
        label: 'Počet měsíců trvání samostatné výdělečné činnosti v roce 2025 / z toho pojištěna u pojišťovny',
        explanation: {
            en: 'Months you ran the business in 2025 (ř. 4) and how many of them you were insured at VZP (ř. 5). '
                + 'Full year at VZP: 12 and 12.',
            cs: 'Počet měsíců podnikání v roce 2025 (ř. 4) a kolik z nich jste byli pojištěni u VZP (ř. 5). '
                + 'Celý rok u VZP: 12 a 12.',
        },
        source: src(VZP_FORM, 'Počet měsíců trvání samostatné výdělečné činnosti v roce 2025'),
    },
    {
        form: 'vzp',
        key: 'healthMinMonths',
        row: 'ř. 6',
        label: 'Počet měsíců, ve kterých pro OSVČ platil minimální vyměřovací základ',
        explanation: {
            en: 'Months in which the minimum applied. It does not apply in months when you were also an employee '
                + 'paying at least the minimum, or the state paid your insurance (student, pensioner, parental '
                + 'leave). This tool assumes: main activity 12, secondary activity 0. Tick those months in section 2.',
            cs: 'Počet měsíců, kdy platil minimální základ. Neplatí v měsících, kdy jste byli zároveň zaměstnanci '
                + 's odvodem alespoň z minima, nebo za vás platil stát (student, důchodce, rodičovská). Nástroj '
                + 'předpokládá: hlavní činnost 12, vedlejší 0. Měsíce vyznačte v oddílu 2.',
        },
        source: src(VZP_POUCENI, 'Minimální vyměřovací základ pro OSVČ v roce 2025 nebyl stanoven v kalendářním '
            + 'měsíci, ve kterém po celý tento kalendářní měsíc trvala některá z následujících skutečností'),
    },
    {
        form: 'vzp',
        key: 'healthMinBase',
        row: 'ř. 9',
        label: '23 278,50 Kč x Řádek 6',
        explanation: {
            en: 'The minimum yearly base: 23 278,50 Kč for each month in ř. 6.',
            cs: 'Minimální roční vyměřovací základ: 23 278,50 Kč za každý měsíc z ř. 6.',
        },
        source: src(VZP_POUCENI, 'Minimální měsíční vyměřovací základ byl roven částce 23 278,50 Kč (řádek č. 9).'),
    },
    {
        form: 'vzp',
        key: 'healthBase',
        row: 'ř. 14',
        label: 'Vyměřovací základ OSVČ za rok 2025: 0,50 x Řádek 3 (pro < Řádek 9, zapíše se Řádek 9)',
        explanation: {
            en: 'The amount your health insurance is calculated from: half of your profit, but at least the minimum '
                + 'from ř. 9. Keep the haléře (2 decimals).',
            cs: 'Částka, ze které se počítá pojistné: polovina zisku, nejméně však minimum z ř. 9. Uvádí se '
                + 's haléři.',
        },
        source: src(VZP_POUCENI, 'Vyměřovacím základem OSVČ je 50 % daňového základu.'),
    },
    {
        form: 'vzp',
        key: 'healthContribution',
        row: 'ř. 16',
        label: 'Pojistné za rok 2025: 0,135 x (Řádek 14 x Řádek 5) / Řádek 4 (zaokr. na Kč nahoru)',
        explanation: {
            en: 'Your health insurance for the whole year: 13,5 % of ř. 14, rounded up to whole Kč.',
            cs: 'Pojistné za celý rok: 13,5 % z ř. 14, zaokrouhleno na celé Kč nahoru.',
        },
        source: src(ZVZP, '§ 2 odst. 1: Výše pojistného činí 13,5 % z vyměřovacího základu za rozhodné období.'),
    },
    {
        form: 'vzp',
        key: 'healthAdvancesPaid',
        row: 'ř. 41',
        label: 'Úhrn zaplacených záloh na pojistné v roce 2025',
        explanation: {
            en: 'All monthly advances you paid for 2025, including payments made by 8 January 2026. Do not include '
                + 'penalties or old doplatky.',
            cs: 'Součet měsíčních záloh za rok 2025, včetně plateb do 8. 1. 2026. Nezahrnujte penále ani doplatky '
                + 'za dřívější roky.',
        },
        source: src(VZP_POUCENI, 'Do úhrnu zaplacených záloh na pojistné se zahrnují platby za rok 2025, provedené '
            + 'do 8. 1. 2026 včetně.'),
    },
    {
        form: 'vzp',
        key: 'healthOverpayment',
        row: 'ř. 43',
        label: 'Přeplatek (Doplatek): Řádek 41 - Řádek 16',
        explanation: {
            en: 'Paid advances minus the yearly amount. Careful, the sign is the opposite of the tax return: '
                + 'positive = you overpaid (přeplatek), negative = you must pay the difference (doplatek) within 8 '
                + 'days of filing. Overpayments under 200 Kč are not refunded.',
            cs: 'Zaplacené zálohy minus roční pojistné. Pozor, znaménko je opačně než v daňovém přiznání: kladné = '
                + 'přeplatek, záporné = doplatek, splatný do 8 dnů od podání. Přeplatky pod 200 Kč se nevracejí.',
        },
        source: src(VZP_POUCENI, 'Doplatek pojistného za rok 2025 je splatný nejpozději do 8 dnů po dni, ve kterém '
            + 'byl nebo měl být podán Přehled za rok 2025. [...] Přeplatky nižší než 200 Kč není možné vracet.'),
    },
    {
        form: 'vzp',
        key: 'healthNewAdvance',
        row: 'ř. 51',
        label: 'Nová výše zálohy: 0,135 x 0,5 x Řádek 3 / Řádek 4 (zaokr. na Kč nahoru)',
        explanation: {
            en: 'Your new monthly advance, paid from the month you file this přehled. If the minimum applies to you, '
                + 'it is at least 3 306 Kč (Typ zálohy a), otherwise the calculated amount (b). Secondary activity '
                + 'with an exemption pays 0 (c).',
            cs: 'Nová měsíční záloha, platí se od měsíce podání přehledu. Pokud pro vás platí minimum, je alespoň '
                + '3 306 Kč (typ zálohy a), jinak vypočtená částka (b). Vedlejší činnost s výjimkou platí 0 (c).',
        },
        source: src(VZP_POUCENI, 'Částku 3 306 zapíše OSVČ, pro kterou platí minimální vyměřovací základ, a částka '
            + 'vypočtená podle vzorce je nižší nebo rovna hodnotě 3 306.'),
    },
];

const deadlines: Deadline[] = [
    {
        form: 'dpfo',
        date: '1. 4. 2026',
        what: {
            en: 'File the tax return (any form) and pay the tax. Basic deadline.',
            cs: 'Podat daňové přiznání (jakkoli) a zaplatit daň. Základní lhůta.',
        },
        source: src('https://financnisprava.gov.cz/cs/danovy-kalendar?year=2026&month=4', '01.04.2026 podání '
            + 'přiznání k dani z příjmů a úhrada daně za rok 2025'),
    },
    {
        form: 'dpfo',
        date: '4. 5. 2026',
        what: {
            en: 'Extended deadline if you file the tax return electronically (and pay the tax by then).',
            cs: 'Prodloužená lhůta při elektronickém podání přiznání (a zaplacení daně).',
        },
        source: src('https://financnisprava.gov.cz/cs/danovy-kalendar?year=2026&month=5', '04.05.2026 podání '
            + 'přiznání k dani z příjmů a úhrada daně za rok 2025, pokud [...] podání daňového přiznání bude učiněno '
            + 'elektronicky'),
    },
    {
        form: 'dpfo',
        date: '1. 7. 2026',
        what: {
            en: 'Deadline if a daňový poradce files for you.',
            cs: 'Lhůta, pokud přiznání podává daňový poradce.',
        },
        source: src('https://financnisprava.gov.cz/cs/danovy-kalendar?year=2026&month=7', '01.07.2026 podání '
            + 'přiznání k dani z příjmů a úhrada daně za rok 2025'),
    },
    {
        form: 'cssz',
        date: '4. 5. 2026 / 4. 6. 2026 / 3. 8. 2026',
        what: {
            en: 'File the ČSSZ přehled (e.g. ePortál ČSSZ) by 4. 5. if your tax return was due 1. 4., by 4. 6. if you '
                + 'filed the tax return electronically after 1. 4., by 3. 8. with a daňový poradce. Pay any doplatek '
                + 'within 8 days after filing. The new advance applies from the month after you file.',
            cs: 'Podat přehled ČSSZ (např. ePortál ČSSZ) do 4. 5., pokud jste přiznání podávali do 1. 4., do 4. 6. '
                + 'při elektronickém přiznání po 1. 4., do 3. 8. s daňovým poradcem. Doplatek zaplaťte do 8 dnů od '
                + 'podání. Nová záloha platí od měsíce následujícího po podání.',
        },
        source: src('https://www.cssz.gov.cz/web/cz/prehled-o-prijmech-a-vydajich', 'Termíny pro podání přehledu za '
            + 'rok 2025: 4. 5. 2026 [...], 4. 6. 2026 (prodloužená lhůta) [...], 3. 8. 2026 pokud daňové přiznání '
            + 'podal daňový poradce po 1. 4. 2026.'),
    },
    {
        form: 'vzp',
        date: '4. 5. 2026 / 4. 6. 2026 / 3. 8. 2026',
        what: {
            en: 'File the VZP přehled (electronically only, e.g. Moje VZP) by 4. 5. if your tax return was due '
                + '1. 4., by 4. 6. if you filed the tax return electronically after 1. 4., by 3. 8. with a daňový '
                + 'poradce. Pay any doplatek within 8 days after filing. The new advance applies from the month you '
                + 'file (advances are due by the 8th of the following month).',
            cs: 'Podat přehled VZP (jen elektronicky, např. Moje VZP) do 4. 5., pokud jste přiznání podávali do '
                + '1. 4., do 4. 6. při elektronickém přiznání po 1. 4., do 3. 8. s daňovým poradcem. Doplatek '
                + 'zaplaťte do 8 dnů od podání. Nová záloha platí od měsíce podání (splatná do 8. dne následujícího '
                + 'měsíce).',
        },
        source: src('https://www.vzp.cz/platci/informace/osvc/prehled-o-vysi-danoveho-zakladu-osvc-a-doplatek-'
            + 'pojistneho/aktualni-terminy-pro-podani-prehledu', 'OSVČ, kterým nezpracovává daňové přiznání za rok '
            + '2025 daňový poradce - podávají Přehled OSVČ do 4. 5. 2026'),
    },
];

export const params2025: YearParams = {
    year: 2025,
    tax: {
        rateBase: {
            value: 0.15,
            source: src(ZDP, '§ 16 odst. 1: a) 15 % pro část základu daně do 36násobku průměrné mzdy'),
        },
        rateHigh: {
            value: 0.23,
            source: src(ZDP, '§ 16 odst. 1: b) 23 % pro část základu daně přesahující 36násobek průměrné mzdy.'),
        },
        highRateThreshold: {
            value: 1_676_052,
            source: src(DP_POKYNY, '(Pro rok 2025 je 36násobek průměrné mzdy [...] ve výši 1 676 052 Kč.)'),
        },
        flatRateCaps: {
            value: { 80: 1_600_000, 60: 1_200_000, 40: 800_000, 30: 600_000 },
            source: src(DP_P1, '80 % [...] nejvýše lze však uplatnit výdaje do částky 1 600 000 Kč, 60 % [...] '
                + '1 200 000 Kč, 40 % v ostatních případech [...] 800 000 Kč [...] a 30 % [...] 600 000 Kč.'),
        },
        taxpayerCredit: {
            value: 30_840,
            source: src(ZDP, '§ 35ba odst. 1 písm. a): základní slevu ve výši 30 840 Kč na poplatníka'),
        },
        childBenefit: {
            value: [15_204, 22_320, 27_840],
            source: src(ZDP, '§ 35c odst. 1: ve výši 15 204 Kč ročně na jedno dítě, 22 320 Kč ročně na druhé dítě a '
                + '27 840 Kč ročně na třetí a každé další dítě'),
        },
        childBonusMinIncome: {
            value: 124_800,
            source: src(ZDP, '§ 35c odst. 4: příjem podle § 6 nebo 7 alespoň ve výši šestinásobku minimální mzdy '
                + '(6 × 20 800 Kč, Sdělení MPSV 286/2024 Sb.)'),
        },
        childBonusMinAmount: {
            value: 100,
            source: src(ZDP, '§ 35c odst. 3: Poplatník může daňový bonus uplatnit, pokud jeho výše činí '
                + 'alespoň 100 Kč.'),
        },
    },
    social: {
        assessmentShare: { value: 0.55, source: src(ZDS, '§ 5b odst. 1: [...] od roku 2024 55 % daňového základu') },
        rate: { value: 0.292, source: src(ZDS, '§ 7 odst. 1 písm. e) bod 1: 29,2 % z vyměřovacího základu') },
        minMonthlyBase: {
            value: { main: 16_295, secondary: 5_122 },
            source: src(CSSZ_2025, 'Při hlavní činnosti (35 % průměrné mzdy) 16 295 Kč / Při vedlejší činnosti '
                + '(11 % průměrné mzdy) 5 122 Kč'),
        },
        maxYearlyBase: {
            value: 2_234_736,
            source: src(CSSZ_POKYNY, 'maximální VZ, který činí částku 2 234 736 Kč'),
        },
        secondaryThreshold: {
            value: 111_736,
            source: src(CSSZ_POKYNY, 'Rozhodná částka pro období výkonu vedlejší SVČ se vypočte z částky 111 736 Kč.'),
        },
        nextYearMinMonthlyBase: {
            value: { main: 17_139, secondary: 5_387 },
            source: src(CSSZ_ZALOHY, 'Pro rok 2026, je stanoven minimální měsíční vyměřovací základ pro hlavní činnost '
                + 'do června 19 587 Kč, od července 17 139 Kč / vedlejší činnost 5 387 Kč'),
        },
        nextYearMaxMonthlyBase: {
            value: 195_868,
            source: src('https://www.cssz.gov.cz/web/cz/-/prehled-nejdulezitejsich-udaju-pro-socialni-zabezpeceni-v-'
                + 'roce-2026', 'Průměrná mzda (tj. 46 278 Kč × 1,0581) 48 967 Kč [maximum monthly base = 4 × '
                + 'průměrná mzda, derived]'),
        },
    },
    health: {
        assessmentShare: {
            value: 0.5,
            source: src(ZVZP, '§ 3a odst. 1: Vyměřovacím základem osoby samostatně výdělečně činné je 50 % '
                + 'daňového základu'),
        },
        rate: {
            value: 0.135,
            source: src(ZVZP, '§ 2 odst. 1: Výše pojistného činí 13,5 % z vyměřovacího základu za rozhodné období.'),
        },
        minMonthlyBase: {
            value: 23_278.5,
            source: src(
                'https://www.vzp.cz/platci/informace/osvc/osvc-minimalni-vyse-zaloh',
                '1. 1. 2025 - 31. 12. 2025 | 23 278,50 Kč | 3 143 Kč',
            ),
        },
        nextYearMinAdvance: {
            value: 3_306,
            source: src(
                'https://www.vzp.cz/platci/informace/osvc/zalohy-na-pojistne/minimalni-vyse-zaloh',
                'Od 1. ledna 2026 činí minimální měsíční vyměřovací základ OSVČ 24 483,50 Kč a minimální záloha '
                    + 'na pojistné 3 306 Kč.',
            ),
        },
    },
    rows: [...dpfoRows, ...csszRows, ...vzpRows],
    deadlines,
};
