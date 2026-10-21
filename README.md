# NoPrecinho

A personal grocery price tracker. Log what you paid, compare package sizes, and see whether today’s shelf price is actually a deal.

This project was **vibe coded for personal use**. It is not a product, a startup, or a carefully engineered platform. It is a small offline web app that grew out of wanting cheaper coffee and fewer “wait, was this cheaper last week?” moments at the supermarket.

It is licensed under the **[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html)**. You may run it, copy it, change it, and share it however you wish, as long as you keep the GPL terms when you redistribute it. Fork it, strip it, restyle it, or ignore half of it. It is yours to use.

## What it does

NoPrecinho keeps a history of purchases (product, price, store, optional quantity) and turns that into a summary you can actually use in the aisle.

- **Price summary** — one row per product: lowest price, latest price, a small trend sparkline, and whether you are still at the historical low.
- **Normalized comparison** — optional quantity in g, kg, ml, L, or units so 500 ml and 1 L can be compared fairly (price per kg / L / unit). The “lowest” is always the best *normalized* price when sizes exist.
- **New purchase** — product, price paid, store, optional size. Dates are recorded automatically. Similar product names get a “did you mean?” prompt so “Leite integral” and “leite Integral” do not fork into two histories.
- **Price checker** — for use in the store. Pick a known product, type the shelf price (and size if needed). Nothing is saved. You get a quick “great deal / normal / expensive” read versus your lowest and latest.
- **Store comparison** — a basket index across stores that carry the same items: how each store stacks up against the cheapest price per item, weighted by how often you buy it.
- **History and formulas** — per-product purchase history, plus a “show formula” drawer that spells out the arithmetic instead of hiding it.

## Data and privacy

Everything stays on your device. There is no account, no server, and no analytics.

- By default, purchases live in **this browser on this device**.
- In Chrome or Edge you can **link a JSON file** on disk (File System Access API). That file becomes the source of truth; browser storage is only a fallback.
- **CSV import/export** for a summary or the full log. Imports are additive; duplicates are skipped. You can also merge two product names if you accidentally split a history.
- Settings (language, currency symbol, decimal mark, theme) stay in the browser.

If local storage is blocked, the app will warn you: data will not survive a refresh.

## How it feels

- Works **offline** as a PWA (service worker caches the app shell). Install it like a standalone app if your browser offers that.
- **Portuguese (Brazil)** and **English**.
- Currency symbol and decimal mark are yours to set (defaults to `R$` and comma).
- Light/dark plus a few palettes (coral, slate, stone, indigo).
- Mobile-first layout, large tap targets, no build step.

## Running it

This is static HTML, CSS, and JavaScript. No npm, no backend.

1. Serve the folder over HTTP (`https://` or `localhost`). A service worker will not register from a `file://` URL.
2. Open `index.html`.
3. Optionally add it to your home screen / install it as an app.

A one-liner if you have Python:

```bash
python -m http.server
```

Then visit `http://localhost:8000`.

## License

**GNU GPLv3.** Free to use for whatever you want. If you distribute the app or a modified version, you must also distribute it under GPLv3 and keep the corresponding source available. See the [full license text](https://www.gnu.org/licenses/gpl-3.0.html).

Made with love (for cheap coffee).
