import type { DigestEntry, StoredDigest } from "../digest/schema";
import { escapeHtml } from "../libs/text.utils";
import { formatDateTimeLabel, pragueClock } from "../libs/time.utils";

const SECONDS_PER_MINUTE = 60;

const STYLES = `
:root { --bg: #f7f7f5; --card: #ffffff; --text: #1d1d1b; --muted: #6b6b66; --accent: #1f6feb; --border: #e3e3df; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #151514; --card: #1f1f1d; --text: #ecece8; --muted: #a3a39c; --accent: #6ea8ff; --border: #33332f; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
header p { color: var(--muted); margin: 4px 0 0; font-size: 14px; }
h1 { font-size: 24px; margin: 0; }
.headline { font-size: 20px; font-weight: 600; margin: 24px 0; }
section, .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; margin: 16px 0; }
h2 { font-size: 17px; margin: 0 0 8px; }
ul { margin: 0; padding-left: 20px; }
li { margin: 6px 0; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.ref { font-size: 13px; margin-left: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
td { border-top: 1px solid var(--border); padding: 8px 6px; vertical-align: top; }
.muted { color: var(--muted); }
.badge { display: inline-block; font-size: 12px; padding: 0 6px; border-radius: 6px; border: 1px solid var(--border); color: var(--muted); }
`;

/** Notice-board titles can contain names of private persons; show the English summary instead when there is one. */
const displayTitle = (entry: DigestEntry): string => (entry.source === "uredni-deska" && entry.summary ? entry.summary : entry.title);

const renderCommute = ({ commute }: StoredDigest): string => {
  const rows = commute.options
    .map(({ parkAndRide, route, parking }) => {
      const minutes = Math.round(route.travelTimeSeconds / SECONDS_PER_MINUTE);
      const kilometers = (route.lengthMeters / 1000).toFixed(1);
      const spaces = parking
        ? ` · ${parking.freeNow}/${parking.totalSpots} free now${parking.usualFreeAtArrival === undefined ? "" : `, usually ~${parking.usualFreeAtArrival} free on arrival`}`
        : "";
      return `<li>${escapeHtml(parkAndRide)}: leave <strong>${pragueClock(new Date(route.departureTime))}</strong>, ${minutes} min, ${kilometers} km<span class="muted">${spaces}</span></li>`;
    })
    .join("");
  return `<div class="card"><h2>Drive to P+R, arrive by ${pragueClock(new Date(commute.arriveAt))}</h2>
<p class="muted">Usual departure ${pragueClock(new Date(commute.usualDepartureTime))}. Travel times from TomTom.</p><ul>${rows}</ul></div>`;
};

const renderSections = ({ digest }: StoredDigest): string =>
  digest.sections
    .map((section) => {
      const bullets = section.bullets
        .map((bullet) => {
          const refs = bullet.refs.map((ref) => `<a class="ref" href="#source-${ref}">[${ref}]</a>`).join("");
          return `<li>${escapeHtml(bullet.text)}${refs}</li>`;
        })
        .join("");
      return `<section><h2>${escapeHtml(section.title)}</h2><ul>${bullets}</ul></section>`;
    })
    .join("");

const renderSources = ({ entries }: StoredDigest): string => {
  const rows = entries
    .map(
      (entry) => `<tr id="source-${entry.ref}">
<td>[${entry.ref}]</td>
<td><a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener">${escapeHtml(displayTitle(entry))}</a>
<div class="muted">${escapeHtml(entry.reason)}${entry.when ? ` · ${escapeHtml(entry.when)}` : ""}</div></td>
<td><span class="badge">${escapeHtml(entry.source)}</span> <span class="badge">${escapeHtml(entry.confidence)}</span></td>
</tr>`,
    )
    .join("");
  return `<section><h2>Sources</h2><table>${rows}</table></section>`;
};

export const renderDigestPage = (stored: StoredDigest, profileName: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Domovník</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<header>
<h1>Domovník</h1>
<p>${escapeHtml(profileName)} · digest for ${escapeHtml(formatDateTimeLabel(new Date(stored.asOf)))} · ${escapeHtml(stored.model)}</p>
</header>
<p class="headline">${escapeHtml(stored.digest.headline)}</p>
${renderCommute(stored)}
${renderSections(stored)}
${renderSources(stored)}
</main>
</body>
</html>`;

export const renderEmptyPage = (message: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Domovník</title><style>${STYLES}</style></head><body><main><h1>Domovník</h1><p>${escapeHtml(message)}</p></main></body></html>`;
