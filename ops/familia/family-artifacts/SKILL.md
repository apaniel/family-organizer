---
name: family-artifacts
description: Create and publish private visual or interactive family pages on Cloudflare when they make a plan, comparison, menu, checklist or explanation easier to use than chat. Keep simple questions and reminders as brief text.
---
# Useful family visuals

Dani wants fewer walls of text when a visual or interactive output improves understanding or use. Choose this naturally; do not turn every answer into an artifact or ask whether to create one for each suitable request. Normal authorization to answer a family planning request includes publishing its private artifact. Other action permissions remain unchanged.

## Choose the right format
- Brief answer, one fact, reminder, simple update → concise Spanish chat.
- Several options with tradeoffs → comparison cards/table, optional filters or a small calculator.
- Weekly adult/kids menus → readable week grid with day/audience controls; distinguish proposed from confirmed meals.
- Trip preparation or backpack contents → grouped checklist with a visible progress count.
- Holidays, birthdays, deadlines → timeline/calendar with useful date labels and preparation lead times.
Use interaction only when it helps a real decision or action. A clean static visual is fine. Avoid elaborate dashboards for small requests. An artifact supplements the family planner; it is not a new source of truth.

## Build
Create one self-contained UTF-8 HTML document in the familia workspace, with inline CSS and optional inline JavaScript. Include doctype, html lang=es, title and viewport metadata. Maximum 500 KB. No build tools or external libraries required.

Design for Dani and Cris opening a WhatsApp link on a phone. Start with the useful content, not a hero or introduction. Use clear visual hierarchy, readable body text (about 16px+), good contrast, comfortable touch targets and a layout that works at 360px. Give buttons meaningful labels, keyboard focus and correct semantics; convey state with text as well as color. Prefer a restrained, coherent palette, clean typography, spacing and small SVG diagrams over decoration. Avoid dense tables that require horizontal scrolling. Show dates, units, totals, sources and uncertainty where they affect decisions. Use Europe/Madrid for family dates.

Only use relevant family information. Read current planner/calendar data with family-mission-control when needed, and render a minimal snapshot. Never embed credentials, private email bodies, personal-profile data, hidden context, tracking, authentication code, or speculative facts as confirmed. Do not use external fonts, scripts, images, fetch calls, iframes or submission forms. Inline SVG and data images are supported.

Pages run with scripts allowed but an isolated origin, no network connections, no cookies/storage access, no forms or parent-page access. All interactive changes are temporary and reset on reload. Label checklists/calculators as temporary where this could be confused with saving; never display “saved” or imply Google Calendar/planner/shopping changes. To save a real task, menu, appointment or completion, use the existing family-mission-control tools under their permissions, then regenerate the visual if useful. Do not weaken the page isolation to add integrations.

## Publish privately on the existing Cloudflare app
Use the existing publisher; no Cloudflare or GitHub tokens, new services, DNS changes, repositories or broad account access are needed:

```sh
HERMES_HOME=/home/hermes/.hermes/profiles/familia /home/hermes/.hermes/hermes-agent/venv/bin/python /home/hermes/.hermes/profiles/familia/tools/family_artifacts.py publish /absolute/path/output.html --title 'Menú de la semana'
```

The result contains `id`, `title`, and a private `url` on https://apalas.apaniel.dev/api/family/artifacts/…. Read access uses the existing approved email login (currently apavicio@gmail.com and dapamar90@gmail.com); publishing does not add viewers. Do not promise that Cris or another recipient can open a link unless their email access has actually been configured. Never bypass Access to share a page. Existing group/sender permissions still apply.

`list` returns the latest 100 published artifacts. `delete ID` removes an artifact when asked or cleans up a test. Identical title and HTML return the same link; modified content produces a new immutable snapshot. Retain the new ID/link with the related planning context so later revisions can be found. Old snapshots remain until explicitly removed. Data persists in Cloudflare D1 across VPS restarts.

## Check and deliver
Before publishing, check the content against its sources, date math, mobile layout in the code, and that every control has working behavior. If browser inspection is available and authorized, exercise relevant interactions; otherwise be honest about what was verified. After publishing, verify the returned ID appears in `list`. If publication fails, inspect the error once and correct a clear cause; do not claim success, repeatedly publish blindly, expose secrets, or use personal credentials as a workaround.

Reply with one short Spanish sentence and the link, plus at most one essential caveat. Do not paste the artifact's full content, reasoning or deployment details into WhatsApp. For short/simple answers, skip the artifact entirely.
