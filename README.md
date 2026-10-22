# noprecinho

## English

A personal grocery price tracker. Log what you paid, compare package sizes, and see whether today’s shelf price is actually a deal.

This project was **vibe coded for personal use**. It is not a product, a startup, or a carefully engineered platform. It is a small offline web app that grew out of wanting cheaper coffee and fewer “wait, was this cheaper last week?” moments at the supermarket.

It is licensed under the **[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html)**. You may run it, copy it, change it, and share it however you wish, as long as you keep the GPL terms when you redistribute it. Fork it, strip it, restyle it, or ignore half of it. It is yours to use.

### What it does

**noprecinho** keeps a history of purchases (product, price, store, optional quantity) and turns that into a summary you can actually use in the aisle.

- **Price summary** — one row per product: lowest price, latest price, a small trend sparkline, and whether you are still at the historical low.
- **Normalized comparison** — optional quantity in g, kg, ml, L, or units so 500 ml and 1 L can be compared fairly (price per kg / L / unit). The “lowest” is always the best *normalized* price when sizes exist.
- **New purchase** — product, price paid, store, optional size. Dates are recorded automatically. Similar product names get a “did you mean?” prompt so “Leite integral” and “leite Integral” do not fork into two histories.
- **Price checker** — for use in the store. Pick a known product, type the shelf price (and size if needed). Nothing is saved. You get a quick “great deal / normal / expensive” read versus your lowest and latest.
- **Store comparison** — a basket index across stores that carry the same items: how each store stacks up against the cheapest price per item, weighted by how often you buy it.
- **History and formulas** — per-product purchase history, plus a “show formula” drawer that spells out the arithmetic instead of hiding it.

### Data and privacy

Everything stays on your device. There is no account, no server, and no analytics.

- By default, purchases live in **this browser on this device**.
- In Chrome or Edge you can **link a JSON file** on disk (File System Access API). That file becomes the source of truth; browser storage is only a fallback.
- **CSV import/export** for a summary or the full log. Imports are additive; duplicates are skipped. You can also merge two product names if you accidentally split a history.
- Settings (language, currency symbol, decimal mark, theme) stay in the browser.

If local storage is blocked, the app will warn you: data will not survive a refresh.

### How it feels

- Works **offline** as a PWA (service worker caches the app shell). Install it like a standalone app if your browser offers that.
- **Portuguese (Brazil)** and **English**.
- Currency symbol and decimal mark are yours to set (defaults to `R$` and comma).
- Light/dark plus a few palettes (coral, slate, stone, indigo).
- Mobile-friendly layout, large tap targets, no build step.

### Running it

The app is published as a GitHub Page. You can just visit [https://bottanpontocom.github.io/noprecinho/](https://bottanpontocom.github.io/noprecinho/).

If you want to run it yourself: this is static HTML, CSS, and JavaScript. No npm, no backend.

1. Serve the folder over HTTP (`https://` or `localhost`). A service worker will not register from a `file://` URL.
2. Open `index.html`.
3. Optionally add it to your home screen / install it as an app.

A one-liner if you have Python:

```bash
python -m http.server
```

Then visit `http://localhost:8000`.

### License

**GNU GPLv3.** Free to use for whatever you want. If you distribute the app or a modified version, you must also distribute it under GPLv3 and keep the corresponding source available. See the [full license text](https://www.gnu.org/licenses/gpl-3.0.html).

---

## Português (Brasil)

Rastreador pessoal de preços de mercado. Registre o que você pagou, compare embalagens de tamanhos diferentes e veja se o preço da prateleira realmente vale a pena.

Este projeto foi **vibe coded para uso pessoal**. Não é um produto, uma startup nem uma plataforma cuidadosamente engenheirada. É um app web pequeno e offline, nascido da vontade de ter café mais barato e de menos momentos de “peraí, isso não tava mais barato semana passada?”.

Está licenciado sob a **[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html)**. Você pode executar, copiar, alterar e compartilhar como quiser, desde que mantenha os termos da GPL ao redistribuir. Faça um fork, desmonte, mude o visual ou ignore metade do código. É seu para usar.

### O que ele faz

O **noprecinho** guarda um histórico de compras (produto, preço, local e quantidade) e transforma isso num resumo que dá para usar no corredor do mercado.

- **Resumo de preços** — uma linha por produto: menor preço, último preço, um sparkline de tendência de preços, e se você ainda está na mínima histórica.
- **Comparação normalizada** — informe a quantidade em g, kg, ml, L ou unidades, para 500ml e 1L poderem ser comparados de forma justa (preço por kg / L / un). O “menor” é sempre o melhor preço *normalizado* quando há tamanho informado.
- **Nova compra** — produto, preço pago, local, tamanho da embalagem (ou quantidade de ítens). A data é registrada automaticamente. Nomes parecidos disparam um “você quis dizer x?” para “Leite integral” e “leite Integrall” não virarem dois históricos acidentalmente.
- **Verificador de preço** — para usar no mercado. Escolha um produto já registrado, informe o preço da prateleira (e o tamanho, se precisar). Nada é salvo. Você recebe uma análise rápida de como o preço indicato está em relação ao menor e ao último.
- **Comparação entre lojas** — um índice da cesta entre lojas que têm os mesmos itens: como cada uma se sai frente ao preço mais barato de cada produto, ponderado por quantas vezes você compra.
- **Histórico e contas** — histórico de compras por produto, mais um painel “ver cálculo” que mostra o cálculo completo para conferência.

### Dados e privacidade

Tudo fica no seu dispositivo. Não há conta, servidor nem analytics.

- Por padrão, as compras ficam salvas no armazenamento do navegador usado, restritas ao seu dispositivo.
- No Chrome ou no Edge você pode **vincular um arquivo JSON** em disco (File System Access API). Esse arquivo se torna seu banco de dados permitindo sincronização e compartilhamento com outros dispositivos; o armazenamento do navegador é só reserva.
- **Importar/exportar CSV** do resumo ou do histórico completo. Importações se somam ao que já existe; duplicatas são ignoradas. Também dá para unir dois nomes de produto se o histórico tiver se dividido por acidente.
- Configurações (idioma, símbolo da moeda, separador decimal, tema) ficam no navegador.

Se o armazenamento local estiver bloqueado, o app avisa: os dados não sobrevivem um refresh.

### Como é o uso

- Funciona **offline** como PWA (o service worker guarda o app). Dá para instalar como app se o navegador oferecer essa opção (Chrome/Edge).
- **Português (Brasil)** e **inglês**.
- Símbolo da moeda e separador decimal são seus (o padrão é `R$` e vírgula).
- Modos claro/escuro em algumas paletas diferentes (coral, slate, stone, indigo).
- Layout compatível com mobnile, alvos de toque grandes, sem etapa de build.

### Como rodar

O app está publicado como GitHub Page. Basta visitar [https://bottanpontocom.github.io/noprecinho/](https://bottanpontocom.github.io/noprecinho/).

Se quiser rodar por conta própria: é em HTML, CSS e JavaScript estáticos. Sem npm, sem backend.

1. Sirva a pasta via HTTP (`https://` ou `localhost`). O service worker não registra a partir de um URL `file://`.
2. Abra `index.html`.
3. Se quiser, adicione à tela inicial / instale como app.

Um único comando se você tiver Python instalado na máquina:

```bash
python -m http.server
```

Depois acesse `http://localhost:8000`.

### Licença

**GNU GPLv3.** Livre para usar do jeito que quiser. Se você distribuir o app ou uma versão modificada, também precisa distribuir sob GPLv3 e manter o código-fonte correspondente disponível. Veja o [texto completo da licença](https://www.gnu.org/licenses/gpl-3.0.html).
