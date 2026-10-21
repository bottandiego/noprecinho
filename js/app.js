(function () {
  "use strict";

  // ─── Storage keys ────────────────────────────────────────────────────────────
  var LOG_KEY = "groceryTracker.log.v1";
  var SET_KEY = "groceryTracker.settings.v2";
  var IDB_DB  = "noprecinho";
  var IDB_STORE = "handles";
  var IDB_KEY   = "dataFile";

  // ─── In-memory fallback ───────────────────────────────────────────────────────
  var mem = {}, storageOk = true;
  var $ = function (id) { return document.getElementById(id); };

  // ─── Simple localStorage helpers (settings only) ─────────────────────────────
  function lsLoad(k, fb) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; }
    catch (e) { storageOk = false; return (k in mem) ? mem[k] : fb; }
  }
  function lsSave(k, v) {
    mem[k] = v;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { storageOk = false; }
    $("storageNote").hidden = storageOk;
  }

  // ─── IndexedDB wrapper (for FSA file handle) ─────────────────────────────────
  var idbReady = null;
  function openIDB() {
    if (idbReady) return idbReady;
    idbReady = new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(null); return; }
      var req = indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = function (e) {
        e.target.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror   = function ()  { resolve(null); };
    });
    return idbReady;
  }
  function idbGet(key) {
    return openIDB().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx  = db.transaction(IDB_STORE, "readonly");
        var req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror   = function () { resolve(null); };
      });
    });
  }
  function idbSet(key, val) {
    return openIDB().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        var tx  = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = resolve;
        tx.onerror    = resolve;
      });
    });
  }
  function idbDel(key) {
    return openIDB().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = resolve;
        tx.onerror    = resolve;
      });
    });
  }

  // ─── File System Access API persistence ──────────────────────────────────────
  var fsaSupported = (typeof window.showOpenFilePicker === "function");
  var fileHandle   = null;   // FileSystemFileHandle | null
  var fsaActive    = false;  // true once we have a valid, writable handle

  // Write log to the linked file (silent – errors fall back to localStorage)
  // Once the file write succeeds, clear the localStorage copy — the file is the source of truth.
  function fsaWrite(data) {
    if (!fsaActive || !fileHandle) return Promise.resolve();
    return fileHandle.createWritable().then(function (w) {
      return w.write(JSON.stringify(data, null, 2)).then(function () {
        return w.close();
      });
    }).then(function () {
      // Silently evict the log from localStorage — no longer needed as backup
      try { localStorage.removeItem(LOG_KEY); } catch (e) {}
    }).catch(function () {
      // Permission may have lapsed; mark inactive so LS takes over again
      fsaActive = false;
      updateFsaUI();
    });
  }

  // Read log from the linked file
  function fsaRead() {
    if (!fileHandle) return Promise.resolve(null);
    return fileHandle.getFile().then(function (f) {
      return f.text();
    }).then(function (txt) {
      try { return JSON.parse(txt); } catch (e) { return null; }
    }).catch(function () { return null; });
  }

  // Restore a previously stored handle from IndexedDB and verify permission
  function fsaRestore() {
    return idbGet(IDB_KEY).then(function (h) {
      if (!h) return false;
      fileHandle = h;
      // queryPermission is synchronous-ish; readwrite covers read too
      return h.queryPermission({ mode: "readwrite" }).then(function (perm) {
        if (perm === "granted") { fsaActive = true; return true; }
        // Permission not yet granted in this session – ask silently
        return h.requestPermission({ mode: "readwrite" }).then(function (p) {
          fsaActive = (p === "granted");
          if (!fsaActive) fileHandle = null;
          return fsaActive;
        });
      });
    }).catch(function () { return false; });
  }

  // Let user pick / create the JSON file (called from Settings).
  // Uses showOpenFilePicker so the user can select an existing file without overwriting it.
  // After picking: read the file, merge with current in-memory log (file entries win on
  // duplicate id), then write the merged result back.
  function fsaLink() {
    if (!fsaSupported) return;
    var opts = {
      id: "noprecinho",
      suggestedName: "noprecinho.json",
      types: [{ description: "NoPrecinho data", accept: { "application/json": [".json"] } }],
      excludeAcceptAllOption: false
    };
    // showOpenFilePicker with create:true lets the user both open existing files and
    // type a new filename — same UX as save but read-first semantics.
    var pickerFn = window.showOpenFilePicker || null;
    if (!pickerFn) return; // shouldn't happen given fsaSupported check, but guard anyway

    pickerFn(opts).then(function (handles) {
      var h = handles[0];
      fileHandle = h;
      fsaActive  = true;
      return idbSet(IDB_KEY, h).then(function () {
        // Read the file first — it may contain existing data
        return fsaRead();
      }).then(function (fileData) {
        if (Array.isArray(fileData) && fileData.length > 0) {
          // Merge: build a set of existing ids then append file entries not in memory
          var existingIds = {};
          log.forEach(function (e) { existingIds[e.id] = true; });
          var added = 0;
          fileData.forEach(function (e) {
            if (!existingIds[e.id]) { log.push(e); added++; }
          });
          if (added > 0) {
            rebuildIndex();
            render();
            populateMergeSelects();
          }
        }
        // Write the (now merged) log to the file
        return fsaWrite(log);
      }).then(function () {
        updateFsaUI();
        setStatus(t("fsaLinked"), "");
      });
    }).catch(function () { /* user cancelled */ });
  }

  function fsaUnlink() {
    fileHandle = null;
    fsaActive  = false;
    idbDel(IDB_KEY);
    updateFsaUI();
  }

  function updateFsaUI() {
    var btn  = $("fsaBtn");
    var hint = $("fsaHintEl");
    if (!fsaSupported) {
      if (btn)  btn.hidden  = true;
      if (hint) hint.textContent = t("fsaUnsupported");
    } else if (fsaActive && fileHandle) {
      if (btn)  { btn.textContent = t("fsaUnlink"); btn.hidden = false; }
      if (hint) hint.textContent  = t("fsaHintLinked", { n: fileHandle.name });
    } else {
      if (btn)  { btn.textContent = t("fsaLink"); btn.hidden = false; }
      if (hint) hint.textContent  = t("fsaHint");
    }
    // Update context-sensitive strings that depend on FSA state
    var hintEl = $("localHint");
    if (hintEl) hintEl.textContent = fsaActive ? t("localHint") : t("localHintNoFsa");
    var wipeEl = $("wipe");
    if (wipeEl) wipeEl.textContent = t("wipe");
  }

  // Master save: always writes to localStorage AND to the FSA file if active
  function saveLog() {
    lsSave(LOG_KEY, log);
    fsaWrite(log);
  }

  // ─── i18n strings ─────────────────────────────────────────────────────────────
  var T = {
    pt: {
      title: "Rastreador de preços",
      fPalette: "Tema", btnCheck: "Verificar preço", btnStores: "Comparar lojas",
      trend: "Tendência de preço: de {a} até {b}",
      qTitle: "Verificador de preço", qHint: "Para usar no mercado. Nada é salvo.",
      qFill: "Escolha um produto já registrado e informe preço e quantidade.",
      qNoProd: "Produto não encontrado. Escolha um da lista.",
      qNeedSize: "O histórico deste produto tem quantidade: informe a quantidade e a unidade.",
      qUnit: "Sem como comparar: a unidade não bate com o histórico deste produto.",
      qGreat: "Ótimo negócio", qStd: "Preço normal", qExp: "Caro",
      qVsLow: "vs. menor preço", qVsLast: "vs. último preço",
      sTitle: "Comparação entre lojas",
      sHint: "Índice da cesta: preço de cada loja em relação ao mais barato de cada item (100% = sempre o mais barato), ponderado pelo número de compras. Só entram itens com preços em 2 ou mais lojas.",
      sEmpty: "Registre o mesmo produto em pelo menos duas lojas para comparar.",
      sCheap: "Mais barata em {c} de {n} itens",
      tagline: "feito com amor (por café barato)", showHist: "Ver histórico",
      histTitle: "Histórico de compras",
      hDate: "Data", hStore: "Local", hPrice: "Preço", hNorm: "Por Kg/L/un",
      hTagLow: "menor", hTagLast: "último",
      themeLight: "Mudar para o tema claro", themeDark: "Mudar para o tema escuro",
      fNormG: "Preço por Kg = Preço ÷ Quantidade (g) × 1000",
      fNormM: "Preço por L = Preço ÷ Quantidade (ml) × 1000",
      fNormU: "Preço por un = Preço ÷ Quantidade (un)",
      lblLast: "Último", lblLow: "Menor",
      fNorm: "Preço por Kg/L = Preço ÷ Embalagem × 1000",
      fDiffN: "Diferença = Último (normalizado) − Menor (normalizado)",
      noCompare: "Não dá para comparar: o último preço não tem quantidade, mas o menor tem. Informe a quantidade nas próximas compras.",
      newLow: "Nova mínima!", lowSaved: "Nova mínima histórica! {p}: {v} em {s}.",
      lead: "Registre o que você pagou. Cada preço aparece com o valor por Kg, L ou un ao lado, e o menor preço é sempre o de menor valor normalizado, para comparar embalagens de tamanhos diferentes.",
      summary: "Resumo de preços", newPurchase: "Nova compra", settings: "Configurações",
      colProduct: "Produto", colLowest: "Menor preço (e onde)", colLatest: "Último preço",
      colNominal: "Preço nominal", colActions: "Ações",
      one: "compra", many: "compras", atLowest: "No menor preço", above: "acima do menor",
      pack: "embalagem", noSize: "Sem embalagem informada", cheapest: "Mais barato por {u}",
      showCalc: "Ver cálculo", remove: "Remover", removeAria: "Remover {n} e todo o histórico",
      empty: "Nenhuma compra ainda. Toque em \u201cNova compra\u201d para começar.",
      fProduct: "Produto", fPrice: "Preço pago", fStore: "Onde comprou",
      fSize: "Quantidade", fUnit: "Unidade de medida",
      phProduct: "ex.: Leite integral", phPrice: "ex.: 4,99",
      phStore: "ex.: Mercado do Bairro", phSize: "ex.: 500",
      sizeHint: "Opcional. Gramas (g), mililitros (ml) ou unidades (un). Com a quantidade, o app compara o preço por Kg, por L ou por un.",
      addHint: "Use sempre o mesmo nome para o mesmo produto (maiúsculas e espaços extras são ignorados). A data é registrada automaticamente.",
      cancel: "Cancelar", savePurchase: "Salvar compra", close: "Fechar",
      eProduct: "Informe o nome do produto.", ePriceEmpty: "Informe o preço pago.",
      ePriceBad: "Use um número com no máximo 2 casas decimais, como 4,99.",
      ePriceZero: "O preço deve ser maior que zero.",
      ePriceHigh: "Esse preço parece alto demais. Confira se há erro de digitação.",
      eStore: "Informe onde você comprou.",
      eSizeBad: "Use um número maior que zero, como 500.",
      eSizeHigh: "Esse tamanho parece grande demais. Confira a unidade.",
      saved: "Salvo: {p} {v} em {s}.",
      calcTitle: "Como o resultado é calculado",
      calcEmpty: "Escolha \u201cVer cálculo\u201d em um produto para ver a conta.",
      fDiff: "Diferença = Último preço − Menor preço",
      fPct: "Percentual = Diferença ÷ Menor preço × 100",
      fNomG: "Preço nominal = Preço ÷ Embalagem (g) × 1000",
      fNomM: "Preço nominal = Preço ÷ Embalagem (ml) × 1000",
      resUp: "Resultado: o último preço está {p} acima do menor que você já pagou ({v} em {s}).",
      resOk: "Resultado: o último preço é igual ao menor que você já pagou ({v} em {s}).",
      resNom: "Preço nominal do último preço: {v}.",
      fLang: "Idioma", fCurrency: "Símbolo da moeda", fDecimal: "Separador decimal",
      decComma: "Vírgula (4,99)", decDot: "Ponto (4.99)",
      impTitle: "Backup e restauração",
      impHint: "As compras importadas são somadas às existentes; duplicadas são ignoradas.",
      impBtn: "Importar arquivo CSV\u2026",
      impEmpty: "O arquivo está vazio ou só tem o cabeçalho.",
      impHeader: "Cabeçalho não reconhecido. São necessárias as colunas Produto, Preço e Local.",
      impRead: "Não foi possível ler o arquivo.",
      impDone: "Importadas: {a}. Duplicadas ignoradas: {d}. Com erro: {e}.",
      impLine: "Linha {n}: {m}",
      iProd: "produto ou local em branco", iPrice: "preço inválido",
      iDate: "data inválida ou no futuro", iSize: "quantidade ou unidade inválida",
      iMore: "\u2026 e mais {n} linha(s) com erro.",
      expSummary: "Baixar resumo (CSV)", expLog: "Baixar histórico completo (CSV)",
      wipe: "Apagar dados do navegador",
      wipeFsa: "Apagar dados do navegador",
      localHint: "As configurações são sempre salvas neste navegador. Os dados de compras são salvos no arquivo JSON vinculado — o armazenamento do navegador é usado apenas como reserva temporária e é limpo automaticamente após cada gravação no arquivo.",
      localHintNoFsa: "Tudo fica salvo apenas neste navegador, neste dispositivo. Vincule um arquivo JSON nas configurações para persistência real. As configurações são salvas automaticamente.",
      storageNote: "O navegador está bloqueando o armazenamento local. Os dados serão perdidos ao fechar esta página.",
      confirmRemove: "Remover \u201c{n}\u201d e as {c} compra(s) salvas?",
      confirmWipe: "Apagar os dados do navegador? O arquivo JSON vinculado não será afetado.",
      confirmWipeNoFsa: "Apagar todas as compras salvas? Isso não pode ser desfeito.",
      csvSummary: ["Produto","Menor preço","Quantidade (menor)","Preço normalizado (menor)","Local do menor","Data do menor","Último preço","Quantidade (último)","Preço normalizado (último)","Local do último","Data do último"],
      csvLog: ["Data","Produto","Preço","Local","Quantidade","Unidade"],
      fileSummary: "resumo-precos.csv", fileLog: "historico-precos.csv",
      // FSA
      fsaTitle: "Arquivo de dados persistente",
      fsaHint: "Vincule um arquivo JSON no seu dispositivo. Selecione um arquivo existente para importar os dados, ou crie um novo para começar a salvar.",
      fsaHintLinked: "Dados sendo salvos em {n}. O armazenamento do navegador é limpo automaticamente a cada gravação.",
      fsaLink: "Vincular arquivo\u2026", fsaUnlink: "Desvincular arquivo",
      fsaActive: "Vinculado: {n}", fsaInactive: "Não vinculado — usando armazenamento do navegador.",
      fsaUnsupported: "Seu navegador não suporta a API de acesso a arquivos. Use Chrome ou Edge para esta funcionalidade.",
      fsaLinked: "Arquivo vinculado com sucesso.",
      // Normalization
      didYouMean: "Produto parecido já existe: \u201c{existing}\u201d. Usar o nome existente?",
      dymYes: "Usar \u201c{existing}\u201d", dymNo: "Manter \u201c{typed}\u201d",
      // Merge
      mergeTitle: "Unir produtos", mergeHint: "Selecione dois produtos para unir todo o histórico em um único nome. Essa ação não pode ser desfeita.",
      mergeA: "Produto a manter", mergeB: "Produto a remover",
      mergeBtn: "Unir produtos", mergeDone: "Produtos unidos: \u201c{b}\u201d foi incorporado em \u201c{a}\u201d.",
      mergeSame: "Selecione dois produtos diferentes.", mergeEmpty: "Selecione os dois produtos."
    },
    en: {
      title: "Grocery price tracker",
      fPalette: "Theme", btnCheck: "Check a price", btnStores: "Compare stores",
      trend: "Price trend: from {a} to {b}",
      qTitle: "Price checker", qHint: "For use in the aisle. Nothing is saved.",
      qFill: "Choose a product you\u2019ve already logged and enter price and quantity.",
      qNoProd: "Product not found. Pick one from the list.",
      qNeedSize: "This product\u2019s history has a quantity: enter the quantity and unit.",
      qUnit: "Can\u2019t compare: the unit doesn\u2019t match this product\u2019s history.",
      qGreat: "Great deal", qStd: "Standard price", qExp: "Expensive",
      qVsLow: "vs. lowest price", qVsLast: "vs. latest price",
      sTitle: "Store comparison",
      sHint: "Basket index: each store\u2019s price relative to the cheapest for each item (100% = always cheapest), weighted by number of purchases. Only items priced at 2 or more stores count.",
      sEmpty: "Log the same product at two or more stores to compare.",
      sCheap: "Cheapest on {c} of {n} items",
      tagline: "made with love (for cheap coffee)", showHist: "Show history",
      histTitle: "Purchase history",
      hDate: "Date", hStore: "Store", hPrice: "Price", hNorm: "Per Kg/L/un",
      hTagLow: "lowest", hTagLast: "latest",
      themeLight: "Switch to light theme", themeDark: "Switch to dark theme",
      fNormG: "Price per Kg = Price \u00f7 Quantity (g) \u00d7 1000",
      fNormM: "Price per L = Price \u00f7 Quantity (ml) \u00d7 1000",
      fNormU: "Price per unit = Price \u00f7 Quantity (un)",
      lblLast: "Latest", lblLow: "Lowest",
      fNorm: "Price per Kg/L = Price \u00f7 Size \u00d7 1000",
      fDiffN: "Difference = Latest (normalized) \u2212 Lowest (normalized)",
      noCompare: "Can\u2019t compare: the latest price has no quantity, but the lowest does. Enter the quantity on future purchases.",
      newLow: "New low!", lowSaved: "New historical low! {p}: {v} at {s}.",
      lead: "Log what you paid. Each price shows its per-Kg, per-L or per-unit value beside it, and the lowest price is always the one with the lowest normalized value, so different package sizes can be compared.",
      summary: "Price summary", newPurchase: "New purchase", settings: "Settings",
      colProduct: "Product", colLowest: "Lowest price (and where)", colLatest: "Latest price",
      colNominal: "Nominal price", colActions: "Actions",
      one: "purchase", many: "purchases", atLowest: "At the lowest price", above: "above lowest",
      pack: "package", noSize: "No package size entered", cheapest: "Cheapest per {u}",
      showCalc: "Show formula", remove: "Remove", removeAria: "Remove {n} and its history",
      empty: "No purchases yet. Tap \u201cNew purchase\u201d to start.",
      fProduct: "Product", fPrice: "Price paid", fStore: "Where you bought it",
      fSize: "Quantity", fUnit: "Unit of measure",
      phProduct: "e.g. Whole milk", phPrice: "e.g. 4.99",
      phStore: "e.g. Corner Market", phSize: "e.g. 500",
      sizeHint: "Optional. Grams (g), millilitres (ml) or units (un). With the quantity, the app compares price per Kg, per L or per unit.",
      addHint: "Always use the same name for the same product (capitals and extra spaces are ignored). The date is recorded automatically.",
      cancel: "Cancel", savePurchase: "Save purchase", close: "Close",
      eProduct: "Enter the product name.", ePriceEmpty: "Enter the price you paid.",
      ePriceBad: "Use a number with at most 2 decimals, like 4.99.",
      ePriceZero: "Price must be greater than zero.",
      ePriceHigh: "That price looks too high. Check for a typo.",
      eStore: "Enter where you bought it.",
      eSizeBad: "Use a number greater than zero, like 500.",
      eSizeHigh: "That size looks too large. Check the unit.",
      saved: "Saved: {p} {v} at {s}.",
      calcTitle: "How the result is calculated",
      calcEmpty: "Choose \u201cShow formula\u201d on a product to see the working.",
      fDiff: "Difference = Latest price \u2212 Lowest price",
      fPct: "Percent = Difference \u00f7 Lowest price \u00d7 100",
      fNomG: "Nominal price = Price \u00f7 Size (g) \u00d7 1000",
      fNomM: "Nominal price = Price \u00f7 Size (ml) \u00d7 1000",
      resUp: "Result: the latest price is {p} above the lowest you have paid ({v} at {s}).",
      resOk: "Result: the latest price matches the lowest you have paid ({v} at {s}).",
      resNom: "Nominal price of the latest purchase: {v}.",
      fLang: "Language", fCurrency: "Currency symbol", fDecimal: "Decimal mark",
      decComma: "Comma (4,99)", decDot: "Dot (4.99)",
      impTitle: "Backup & restore",
      impHint: "Imported purchases are added to existing ones; duplicates are skipped.",
      impBtn: "Import CSV file\u2026",
      impEmpty: "The file is empty or has only a header.",
      impHeader: "Header not recognised. The columns Product, Price and Store are required.",
      impRead: "Could not read the file.",
      impDone: "Imported: {a}. Duplicates skipped: {d}. With errors: {e}.",
      impLine: "Line {n}: {m}",
      iProd: "product or store is blank", iPrice: "invalid price",
      iDate: "invalid or future date", iSize: "invalid quantity or unit",
      iMore: "\u2026 and {n} more line(s) with errors.",
      expSummary: "Download summary (CSV)", expLog: "Download full history (CSV)",
      wipe: "Clear browser data",
      wipeFsa: "Clear browser data",
      localHint: "Settings are always saved in this browser. Purchase data is saved to the linked JSON file \u2014 browser storage is used only as a temporary fallback and is cleared automatically after each successful file write.",
      localHintNoFsa: "Everything is stored only in this browser on this device. Link a JSON file in settings for real persistence. Settings save automatically.",
      storageNote: "Your browser is blocking local storage, so data will be lost when you close this page.",
      confirmRemove: "Remove \u201c{n}\u201d and all {c} saved purchase(s)?",
      confirmWipe: "Clear browser data? Your linked JSON file will not be affected.",
      confirmWipeNoFsa: "Delete every saved purchase? This cannot be undone.",
      csvSummary: ["Product","Lowest price","Quantity (lowest)","Normalized price (lowest)","Lowest store","Lowest date","Latest price","Quantity (latest)","Normalized price (latest)","Latest store","Latest date"],
      csvLog: ["Date","Product","Price","Store","Quantity","Unit"],
      fileSummary: "price-summary.csv", fileLog: "price-history.csv",
      // FSA
      fsaTitle: "Persistent data file",
      fsaHint: "Link a JSON file on your device. Select an existing file to load its data, or pick a new filename to start saving there.",
      fsaHintLinked: "Data is being saved to {n}. Browser storage is cleared automatically after each write.",
      fsaLink: "Link file\u2026", fsaUnlink: "Unlink file",
      fsaActive: "Linked: {n}", fsaInactive: "Not linked \u2014 using browser storage.",
      fsaUnsupported: "Your browser does not support the File System Access API. Use Chrome or Edge for this feature.",
      fsaLinked: "File linked successfully.",
      // Normalization
      didYouMean: "Similar product already exists: \u201c{existing}\u201d. Use the existing name?",
      dymYes: "Use \u201c{existing}\u201d", dymNo: "Keep \u201c{typed}\u201d",
      // Merge
      mergeTitle: "Merge products", mergeHint: "Select two products to merge all history into one name. This cannot be undone.",
      mergeA: "Product to keep", mergeB: "Product to remove",
      mergeBtn: "Merge products", mergeDone: "\u201c{b}\u201d was merged into \u201c{a}\u201d.",
      mergeSame: "Please select two different products.", mergeEmpty: "Please select both products."
    }
  };

  // ─── App state ────────────────────────────────────────────────────────────────
  var log      = lsLoad(LOG_KEY, []);
  var settings = lsLoad(SET_KEY, { lang: "pt", currency: "R$", decimal: ",", theme: "dark", palette: "coral" });
  if (!settings.palette) settings.palette = "coral";
  if (settings.theme !== "light") settings.theme = "dark";

  var calcKey = null, flashKey = null, lastFocus = null;
  var celebrate = { key: null, on: false, fresh: false };
  var drawerMode = "calc";
  var pendingDym = null; // "did you mean?" pending resolution

  var TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>';

  // ─── Date helpers ─────────────────────────────────────────────────────────────
  function pad(n) { return ("0" + n).slice(-2); }
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  // ─── Migration (old entries stored timestamps) ────────────────────────────────
  var migrated = false;
  log.forEach(function (e) {
    if (!e.date) { var d = new Date(e.ts || Date.now()); e.date = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); migrated = true; }
    if ("ts" in e) { delete e.ts; migrated = true; }
  });
  if (migrated) saveLog();

  // ─── Index ────────────────────────────────────────────────────────────────────
  var groups = {}, idx = { prod: {}, store: {} };
  function indexEntry(e) {
    (groups[e.key] = groups[e.key] || []).push(e);
    if (!idx.prod[e.key]) idx.prod[e.key] = e.product;
    var sk = e.store.toLowerCase(); if (!idx.store[sk]) idx.store[sk] = e.store;
  }
  function rebuildIndex() { groups = {}; idx = { prod: {}, store: {} }; log.forEach(indexEntry); }
  rebuildIndex();

  // ─── i18n ─────────────────────────────────────────────────────────────────────
  function t(k, v) {
    var s = (T[settings.lang] || T.pt)[k];
    if (!s) return k;
    if (v) Object.keys(v).forEach(function (n) { s = s.replace("{" + n + "}", v[n]); });
    return s;
  }

  // ─── Theme / lang ─────────────────────────────────────────────────────────────
  // ─── Theme / lang ─────────────────────────────────────────────────────────────
  // data-theme values:
  //   dark  → "coral" / "slate" / "stone" / "emerald" / "indigo"
  //   light → "coral-light" / "slate-light" / "stone-light" / "emerald-light" / "indigo-light"
  function themeAttr() {
    var pal = settings.palette || "coral";
    return settings.theme === "light" ? pal + "-light" : pal;
  }
  function applyTheme() {
    var isLight = settings.theme === "light";
    var b = $("themeBtn"), s = t(isLight ? "themeDark" : "themeLight");
    document.documentElement.setAttribute("data-theme", themeAttr());
    b.setAttribute("aria-label", s); b.title = s;
    var palSel = $("palette"); if (palSel) palSel.value = settings.palette || "coral";
  }
  function applyLang() {
    document.documentElement.lang = settings.lang === "en" ? "en" : "pt-BR";
    document.title = "NoPrecinho";
    applyTheme();
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) { n.placeholder = t(n.getAttribute("data-i18n-ph")); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) {
      var s = t(n.getAttribute("data-i18n-aria")); n.setAttribute("aria-label", s); n.title = s;
    });
    updateFsaUI();
    populateMergeSelects();
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  function norm(s) { return s.trim().replace(/\s+/g, " "); }
  function keyOf(s) { return norm(s).toLowerCase(); }

  // Strip trailing size notation from a product name before keying/storing
  // e.g. "Leite Integral 1L" → "Leite Integral", "Arroz 5kg" → "Arroz"
  function stripSize(s) {
    return s.replace(/\s+\d+[,.]?\d*\s*(kg|g|ml|l|litro|litros|un|und|unid)\s*$/i, "").trim();
  }
  function cleanProductName(s) {
    return norm(stripSize(s));
  }

  function groupNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, settings.decimal === "," ? "." : ","); }
  function num(c) { c = Math.abs(c); return groupNum(Math.floor(c / 100)) + settings.decimal + pad(c % 100); }
  function money(c) { return (c < 0 ? "\u2212" : "") + (settings.currency ? settings.currency + " " : "") + num(c); }
  function signed(c) { return (c > 0 ? "+" : c < 0 ? "\u2212" : "") + money(Math.abs(c)); }
  function when(d) {
    var q = d.split("-"); return new Date(+q[0], +q[1] - 1, +q[2]).toLocaleDateString(settings.lang === "en" ? "en-GB" : "pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  function plainNum(n) { var s = String(n); return settings.decimal === "," ? s.replace(".", ",") : s; }

  function normNum(raw) {
    var s = String(raw).replace(/[^\d.,]/g, "");
    if (!s) return null;
    var lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc > -1 && ld > -1) {
      if (lc > ld) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (lc > -1) {
      if (s.split(",").length > 2) return null;
      s = s.replace(",", ".");
    } else if (ld > -1 && s.split(".").length > 2) return null;
    return /^\d+(\.\d+)?$/.test(s) ? s : null;
  }
  function parsePrice(raw) {
    var s = normNum(raw);
    if (s === null || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
    return Math.round(parseFloat(s) * 100);
  }
  function parseSize(raw) {
    var s = normNum(raw);
    if (s === null || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
    return parseFloat(s);
  }
  function readSize(raw, u) {
    raw = raw.trim(); if (!raw) return { none: true };
    var s = parseSize(raw); if (s === null || s <= 0) return { err: "eSizeBad" };
    s = Math.round(s * ((u === "kg" || u === "L") ? 1000 : 1) * 100) / 100;
    if (s > 1000000) return { err: "eSizeHigh" };
    return { size: s, unit: u === "kg" ? "g" : u === "L" ? "ml" : u };
  }
  function chrono(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id; }
  function nominal(e) {
    if (!e || !e.size) return null;
    if (e.unit === "un") return { cents: Math.round(e.cents / e.size), u: "un" };
    return { cents: Math.round(e.cents * 1000 / e.size), u: e.unit === "g" ? "Kg" : "L" };
  }
  function sizeTxt(e) { return plainNum(e.size) + e.unit; }
  function canon(v) {
    var p = idx.prod[keyOf(v.product)]; if (p) v.product = p;
    var s = idx.store[v.store.toLowerCase()]; if (s) v.store = s;
  }
  function nextId() { return log.reduce(function (m, e) { return Math.max(m, e.id); }, 0) + 1; }
  function setStatus(msg, cls) { var s = $("status"); s.className = cls || ""; s.textContent = msg; }

  // ─── Jaro-Winkler similarity (0–1) ───────────────────────────────────────────
  function jaroWinkler(s1, s2) {
    s1 = s1.toLowerCase(); s2 = s2.toLowerCase();
    if (s1 === s2) return 1;
    var l1 = s1.length, l2 = s2.length;
    if (!l1 || !l2) return 0;
    var matchDist = Math.max(Math.floor(Math.max(l1, l2) / 2) - 1, 0);
    var m1 = new Array(l1).fill(false), m2 = new Array(l2).fill(false);
    var matches = 0, trans = 0;
    for (var i = 0; i < l1; i++) {
      var lo = Math.max(0, i - matchDist), hi = Math.min(i + matchDist + 1, l2);
      for (var j = lo; j < hi; j++) {
        if (m2[j] || s1[i] !== s2[j]) continue;
        m1[i] = m2[j] = true; matches++; break;
      }
    }
    if (!matches) return 0;
    var k = 0;
    for (var i = 0; i < l1; i++) {
      if (!m1[i]) continue;
      while (!m2[k]) k++;
      if (s1[i] !== s2[k]) trans++;
      k++;
    }
    var jaro = (matches / l1 + matches / l2 + (matches - trans / 2) / matches) / 3;
    var prefix = 0;
    for (var i = 0; i < Math.min(4, l1, l2); i++) {
      if (s1[i] !== s2[i]) break; prefix++;
    }
    return jaro + prefix * 0.1 * (1 - jaro);
  }

  // Find the best matching existing product key for a typed name (returns null if none good enough)
  var DYM_THRESHOLD = 0.88;
  function findSimilar(typedKey) {
    var best = null, bestScore = 0;
    Object.keys(idx.prod).forEach(function (k) {
      if (k === typedKey) return; // exact match — no suggestion needed
      var score = jaroWinkler(typedKey, k);
      if (score > bestScore) { bestScore = score; best = k; }
    });
    return bestScore >= DYM_THRESHOLD ? best : null;
  }

  // ─── Summary / stats ──────────────────────────────────────────────────────────
  function metric(e) { var n = nominal(e); return n ? n.cents : e.cents; }
  function lowestOf(entries) {
    var sized = entries.filter(function (e) { return e.size; }), pool = entries;
    if (sized.length) { var u = sized[sized.length - 1].unit; pool = sized.filter(function (e) { return e.unit === u; }); }
    var best = null;
    pool.forEach(function (e) { if (!best || metric(e) <= metric(best)) best = e; });
    return best;
  }
  function stats(entries) {
    var s = entries.slice().sort(chrono), latest = s[s.length - 1], low = lowestOf(s), mode, diff = null;
    if (latest.size && low.size && latest.unit === low.unit) { mode = "norm"; diff = metric(latest) - metric(low); }
    else if (!latest.size && !low.size) { mode = "abs"; diff = latest.cents - low.cents; }
    else mode = "none";
    return { count: s.length, latest: latest, lowest: low, mode: mode, diff: diff, name: latest.product };
  }
  function summarize() {
    return Object.keys(groups).map(function (k) { var g = stats(groups[k]); g.key = k; return g; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  // ─── Table rendering ──────────────────────────────────────────────────────────
  function cell(tr, label, cls) {
    var td = document.createElement("td");
    if (label) td.setAttribute("data-label", label);
    if (cls) td.className = cls;
    tr.appendChild(td); return td;
  }
  function priceCell(td, e) {
    var pr = document.createElement("span"); pr.className = "pr";
    var b = document.createElement("span"); b.className = "big"; b.textContent = money(e.cents); pr.appendChild(b);
    var n = nominal(e);
    if (n) { var m = document.createElement("span"); m.className = "norm"; m.textContent = money(n.cents) + "/" + n.u; pr.appendChild(m); }
    var s = document.createElement("span"); s.className = "sub";
    s.textContent = e.store + (e.size ? " (" + sizeTxt(e) + ")" : "") + " \u00b7 " + when(e.date);
    td.appendChild(pr); td.appendChild(s);
  }

  var rowEls = {}, tbodyEl = null;
  function rowState(tr, key) {
    var c = [];
    if (key === flashKey || (key === calcKey && document.body.classList.contains("open"))) c.push("sel");
    if (celebrate.fresh && key === celebrate.key) c.push("celebrate");
    tr.className = c.join(" ");
  }
  function refreshRows(keys) { keys.forEach(function (k) { if (k && rowEls[k]) rowState(rowEls[k], k); }); }

  function trendLine(es) {
    var s = es.slice().sort(chrono), sized = s.filter(function (e) { return e.size; }), pool = s;
    if (sized.length) { var u = sized[sized.length - 1].unit; pool = sized.filter(function (e) { return e.unit === u; }); }
    if (pool.length < 2) return null;
    var v = pool.map(metric), mn = Math.min.apply(null, v), mx = Math.max.apply(null, v);
    var W = 60, H = 18, P = 2, NS = "http://www.w3.org/2000/svg";
    var pts = v.map(function (y, i) { return [P + i * (W - 2 * P) / (v.length - 1), mx === mn ? H / 2 : P + (mx - y) / (mx - mn) * (H - 2 * P)]; });
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "trend"); svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", t("trend", { a: money(v[0]), b: money(v[v.length - 1]) }));
    var pl = document.createElementNS(NS, "polyline");
    pl.setAttribute("points", pts.map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" "));
    pl.setAttribute("fill", "none"); pl.setAttribute("stroke", "currentColor");
    pl.setAttribute("stroke-width", "1.5"); pl.setAttribute("stroke-linecap", "round"); pl.setAttribute("stroke-linejoin", "round");
    var l = pts[pts.length - 1], c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", l[0]); c.setAttribute("cy", l[1]); c.setAttribute("r", "2"); c.setAttribute("fill", "currentColor");
    svg.appendChild(pl); svg.appendChild(c); return svg;
  }

  function fillRow(tr, g) {
    tr.textContent = ""; tr.dataset.key = g.key; tr.dataset.name = g.name;
    var n = cell(tr, t("colProduct"), "name"); n.textContent = g.name;
    var c = document.createElement("span"); c.className = "sub"; c.style.fontFamily = "var(--mono)"; c.style.fontWeight = "400";
    c.textContent = g.count + " " + (g.count === 1 ? t("one") : t("many")); n.appendChild(c);
    var tl = trendLine(groups[g.key]); if (tl) n.appendChild(tl);
    var lc = cell(tr, t("colLowest"), "lowcell"); priceCell(lc, g.lowest);
    if (celebrate.on && g.key === celebrate.key) {
      var nw = document.createElement("span"); nw.className = "chip new" + (celebrate.fresh ? " pop" : ""); nw.textContent = t("newLow"); lc.appendChild(nw);
    }
    var lt = cell(tr, t("colLatest")); priceCell(lt, g.latest);
    if (g.mode !== "none") {
      var isLow = g.latest.id === g.lowest.id || g.diff <= 0;
      var chip = document.createElement("span"); chip.className = "chip" + (isLow ? "" : " up");
      chip.textContent = isLow ? t("atLowest") : signed(g.diff) + (g.mode === "norm" ? "/" + nominal(g.latest).u : "") + " " + t("above");
      lt.appendChild(chip);
    }
    var a = cell(tr, "", "act"), rb = document.createElement("div"); rb.className = "rowbtns";
    var sh = document.createElement("button"); sh.type = "button"; sh.className = "ghost small"; sh.textContent = t("showCalc");
    sh.onclick = function () { openCalc(g.key, sh, "calc"); };
    var hs = document.createElement("button"); hs.type = "button"; hs.className = "ghost small"; hs.textContent = t("showHist");
    hs.onclick = function () { openCalc(g.key, hs, "hist"); };
    rb.appendChild(sh); rb.appendChild(hs); a.appendChild(rb);
    var tc = cell(tr, "", "trashcell"), del = document.createElement("button");
    del.type = "button"; del.className = "trash"; del.title = t("remove");
    del.setAttribute("aria-label", t("removeAria", { n: g.name })); del.innerHTML = TRASH;
    del.onclick = function () {
      if (confirm(t("confirmRemove", { n: g.name, c: g.count }))) {
        log = log.filter(function (e) { return e.key !== g.key; });
        saveLog(); rebuildIndex();
        if (calcKey === g.key) closeCalc();
        render([g.key]);
        populateMergeSelects();
      }
    };
    tc.appendChild(del); rowState(tr, g.key);
  }

  function groupOf(k) { if (!groups[k]) return null; var g = stats(groups[k]); g.key = k; return g; }

  function render(keys) {
    var wrap = $("tableWrap"), full = !keys || !tbodyEl;
    if (!full) {
      keys.filter(function (k, i) { return k && keys.indexOf(k) === i; }).forEach(function (k) {
        var g = groupOf(k), tr = rowEls[k];
        if (!g) { if (tr) { tr.remove(); delete rowEls[k]; } return; }
        if (tr) { fillRow(tr, g); return; }
        tr = document.createElement("tr"); rowEls[k] = tr; fillRow(tr, g);
        var after = null;
        Array.prototype.some.call(tbodyEl.children, function (r) { if (r.dataset.name.localeCompare(g.name) > 0) { after = r; return true; } });
        tbodyEl.insertBefore(tr, after);
      });
      if (!Object.keys(rowEls).length) full = true;
    }
    if (full) {
      wrap.textContent = ""; rowEls = {}; tbodyEl = null;
      var rows = summarize();
      if (!rows.length) { var p = document.createElement("p"); p.className = "empty"; p.textContent = t("empty"); wrap.appendChild(p); }
      else {
        var tbl = document.createElement("table"), thead = document.createElement("thead"), hr = document.createElement("tr");
        ["colProduct", "colLowest", "colLatest", "colActions", "remove"].forEach(function (k, i) {
          var th = document.createElement("th"); th.scope = "col";
          if (i >= 3) { var sp = document.createElement("span"); sp.textContent = t(k); sp.style.cssText = "position:absolute;left:-9999px"; th.appendChild(sp); }
          else th.textContent = t(k);
          hr.appendChild(th);
        });
        thead.appendChild(hr); tbl.appendChild(thead);
        tbodyEl = document.createElement("tbody");
        rows.forEach(function (g) { var tr = document.createElement("tr"); rowEls[g.key] = tr; fillRow(tr, g); tbodyEl.appendChild(tr); });
        tbl.appendChild(tbodyEl); wrap.appendChild(tbl);
      }
    }
    celebrate.fresh = false;
    renderCalc(); fillLists();
  }

  // ─── Burst animation ─────────────────────────────────────────────────────────
  function burst(key) {
    var tr = Array.prototype.filter.call(document.querySelectorAll("#tableWrap tbody tr"), function (r) { return r.dataset.key === key; })[0];
    if (!tr) return;
    tr.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (!tr.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var td = tr.querySelector("td.lowcell"), big = td.querySelector(".big");
    var cx = big.offsetLeft + big.offsetWidth / 2, cy = big.offsetTop + big.offsetHeight / 2;
    function done(el) { return function () { el.remove(); }; }
    var ring = document.createElement("span"); ring.className = "ring";
    ring.style.left = cx + "px"; ring.style.top = cy + "px"; td.appendChild(ring);
    ring.animate([{ transform: "translate(-50%,-50%) scale(.3)", opacity: .9 }, { transform: "translate(-50%,-50%) scale(4.5)", opacity: 0 }], { duration: 800, easing: "ease-out" }).onfinish = done(ring);
    var cs = getComputedStyle(document.documentElement), colors = ["--accent", "--good", "--accent-text", "--ink"].map(function (v) { return cs.getPropertyValue(v).trim(); });
    for (var i = 0; i < 18; i++) {
      var a = Math.PI * 2 * i / 18 + Math.random() * .4, d = 45 + Math.random() * 55, sz = 4 + Math.random() * 4;
      var sp = document.createElement("span"); sp.className = "spark";
      sp.style.cssText = "left:" + cx + "px;top:" + cy + "px;width:" + sz + "px;height:" + sz + "px;background:" + colors[i % 4];
      td.appendChild(sp);
      sp.animate([{ transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
      { transform: "translate(calc(-50% + " + (Math.cos(a) * d) + "px),calc(-50% + " + (Math.sin(a) * d) + "px)) scale(0)", opacity: 0 }],
        { duration: 650 + Math.random() * 450, easing: "cubic-bezier(.15,.8,.3,1)" }).onfinish = done(sp);
    }
  }

  // ─── History / calc drawer ────────────────────────────────────────────────────
  function renderHist(g, wrap) {
    var h = document.createElement("h3"); h.textContent = g.name; h.style.cssText = "margin:0 0 10px;font-size:1rem"; wrap.appendChild(h);
    var es = log.filter(function (e) { return e.key === g.key; }).sort(function (a, b) { return chrono(b, a); });
    var tbl = document.createElement("table"); tbl.className = "hist";
    var th = document.createElement("thead"), hr = document.createElement("tr");
    ["hDate", "hStore", "hPrice", "hNorm"].forEach(function (k) { var c = document.createElement("th"); c.scope = "col"; c.textContent = t(k); hr.appendChild(c); });
    th.appendChild(hr); tbl.appendChild(th);
    var tb = document.createElement("tbody");
    es.forEach(function (e, i) {
      var tr = document.createElement("tr"); if (e.id === g.lowest.id) tr.className = "low";
      var d = document.createElement("td"); d.textContent = when(e.date);
      [[e.id === g.lowest.id, "hTagLow"], [i === 0, "hTagLast"]].forEach(function (x) {
        if (x[0]) { var c = document.createElement("span"); c.className = "chip"; c.textContent = t(x[1]); d.appendChild(document.createElement("br")); d.appendChild(c); }
      });
      var s = document.createElement("td"); s.textContent = e.store;
      if (e.size) { var q = document.createElement("span"); q.className = "sub"; q.textContent = sizeTxt(e); s.appendChild(q); }
      var pr = document.createElement("td"); pr.className = "num"; pr.textContent = money(e.cents);
      var n = nominal(e), nm = document.createElement("td"); nm.className = "num"; nm.textContent = n ? money(n.cents) + "/" + n.u : "\u2014";
      [d, s, pr, nm].forEach(function (c) { tr.appendChild(c); }); tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    var box = document.createElement("div"); box.style.overflowX = "auto"; box.appendChild(tbl); wrap.appendChild(box);
  }

  function renderCalc() {
    var wrap = $("calcWrap"); wrap.textContent = "";
    $("calcH").textContent = t(drawerMode === "hist" ? "histTitle" : "calcTitle");
    var g = calcKey && groups[calcKey] ? groupOf(calcKey) : null;
    if (!g) { var p = document.createElement("p"); p.className = "empty"; p.textContent = t("calcEmpty"); wrap.appendChild(p); return; }
    if (drawerMode === "hist") { renderHist(g, wrap); return; }
    var A = g.latest, B = g.lowest, lines = [], res = null;
    var h = document.createElement("h3"); h.textContent = g.name; h.style.cssText = "margin:0 0 10px;font-size:1rem"; wrap.appendChild(h);
    if (g.mode === "none") { lines = [t("noCompare")]; }
    else {
      var isNorm = g.mode === "norm", na = nominal(A), nb = nominal(B);
      var N = isNorm ? na.cents : A.cents, L = isNorm ? nb.cents : B.cents, D = N - L, pct = L > 0 ? D / L * 100 : 0, u = isNorm ? "/" + na.u : "";
      var pctStr = (pct > 0 ? "+" : pct < 0 ? "\u2212" : "") + Math.abs(pct).toFixed(1).replace(".", settings.decimal) + "%";
      var sg = (D > 0 ? "+" : D < 0 ? "\u2212" : "") + num(D);
      if (isNorm) {
        var x = A.unit === "un" ? "" : " \u00d7 1000";
        lines.push(t(A.unit === "un" ? "fNormU" : A.unit === "g" ? "fNormG" : "fNormM"),
          "  " + t("lblLast") + ": " + num(A.cents) + " \u00f7 " + plainNum(A.size) + x + " = " + money(N) + u,
          "  " + t("lblLow") + ": " + num(B.cents) + " \u00f7 " + plainNum(B.size) + x + " = " + money(L) + u, "");
      }
      lines.push(t(isNorm ? "fDiffN" : "fDiff"), "  = " + money(N) + " \u2212 " + money(L) + " = " + signed(D) + u, "",
        t("fPct"), "  = " + sg + " \u00f7 " + num(L) + " \u00d7 100 = " + pctStr);
      var low = money(B.cents) + (B.size ? ", " + sizeTxt(B) + ", " + money(L) + u : "");
      res = { up: D > 0, text: D > 0 ? t("resUp", { p: pctStr.replace("+", ""), v: low, s: B.store }) : t("resOk", { v: low, s: B.store }) };
    }
    var box = document.createElement("div"); box.className = "calc";
    lines.forEach(function (line) { var d = document.createElement("div"); d.textContent = line || " "; box.appendChild(d); });
    wrap.appendChild(box);
    if (res) { var r = document.createElement("p"); r.className = "result " + (res.up ? "up" : "ok"); r.textContent = res.text; wrap.appendChild(r); }
  }

  function fillLists() {
    [["productList", idx.prod], ["storeList", idx.store]].forEach(function (p) {
      var dl = $(p[0]); dl.textContent = "";
      Object.keys(p[1]).map(function (k) { return p[1][k]; }).sort().forEach(function (v) { var o = document.createElement("option"); o.value = v; dl.appendChild(o); });
    });
  }

  // ─── Sidebar ──────────────────────────────────────────────────────────────────
  function openCalc(key, trigger, mode) {
    var old = calcKey; calcKey = key; drawerMode = mode || "calc"; lastFocus = trigger || null;
    document.body.classList.add("open");
    $("drawer").setAttribute("aria-hidden", "false");
    refreshRows([old, key]); renderCalc(); $("closeCalc").focus();
  }
  function closeCalc() {
    if (!document.body.classList.contains("open")) return;
    document.body.classList.remove("open");
    $("drawer").setAttribute("aria-hidden", "true");
    refreshRows([calcKey]);
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus(); else $("openAdd").focus();
  }
  $("closeCalc").onclick = closeCalc;
  $("scrim").onclick = closeCalc;
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeCalc(); } });

  // ─── Add dialog ───────────────────────────────────────────────────────────────
  var f = { product: $("product"), price: $("price"), size: $("size"), store: $("store") };

  function setErr(n, m) { $(n + "Err").textContent = m || ""; f[n].setAttribute("aria-invalid", m ? "true" : "false"); }

  function validate() {
    var ok = true, first = null;
    function bad(n, m) { setErr(n, m); ok = false; if (!first) first = f[n]; }
    var prod = cleanProductName(f.product.value);
    var store = norm(f.store.value), raw = f.price.value.trim(), c = parsePrice(raw);
    ["product", "price", "size", "store"].forEach(function (n) { setErr(n); });
    if (!prod) bad("product", t("eProduct"));
    if (!raw) bad("price", t("ePriceEmpty"));
    else if (c === null) bad("price", t("ePriceBad"));
    else if (c <= 0) bad("price", t("ePriceZero"));
    else if (c > 10000000) bad("price", t("ePriceHigh"));
    var rs = readSize(f.size.value, $("unit").value);
    if (rs.err) bad("size", t(rs.err));
    if (!store) bad("store", t("eStore"));
    if (first) first.focus();
    return ok ? { product: prod, store: store, cents: c, size: rs.size || null, unit: rs.unit } : null;
  }

  $("openAdd").onclick = function () {
    $("form").reset();
    ["product", "price", "size", "store"].forEach(function (n) { setErr(n); });
    hideDym();
    openModal($("addDlg")); f.product.focus();
  };
  $("cancelAdd").onclick = function () { $("addDlg").close(); };

  function openModal(d) { d._ret = document.activeElement; d.showModal(); }
  ["addDlg", "setDlg", "qcDlg", "siDlg", "mergeDlg"].forEach(function (id) {
    var d = $(id);
    if (!d) return;
    d.addEventListener("click", function (e) { if (e.target === this) this.close(); });
    d.addEventListener("close", function () { var r = this._ret; if (r && document.contains(r) && r.focus) r.focus(); });
  });
  ["product", "price", "size", "store"].forEach(function (n) { f[n].addEventListener("input", function () { setErr(n); }); });

  // ─── "Did you mean?" inline banner ───────────────────────────────────────────
  function hideDym() {
    var b = $("dymBanner"); if (b) b.hidden = true;
    pendingDym = null;
  }
  function showDym(typedName, existingKey) {
    var existingName = idx.prod[existingKey];
    pendingDym = { typed: typedName, existingKey: existingKey, existingName: existingName };
    var b = $("dymBanner"), msg = $("dymMsg"), yes = $("dymYes"), no = $("dymNo");
    msg.textContent = t("didYouMean", { existing: existingName });
    yes.textContent = t("dymYes", { existing: existingName });
    no.textContent  = t("dymNo",  { typed: typedName });
    b.hidden = false;
  }

  $("dymYes") && ($("dymYes").onclick = function () {
    if (!pendingDym) return;
    // Replace field value with canonical name and re-submit
    f.product.value = pendingDym.existingName;
    hideDym();
    $("form").requestSubmit ? $("form").requestSubmit() : $("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  $("dymNo") && ($("dymNo").onclick = function () {
    if (!pendingDym) return;
    var v = pendingDym; hideDym();
    // Proceed with the typed name, skip DYM check this time
    commitEntry(v.typed, true);
  });

  // Core save logic, extracted so both submit and dymNo can call it
  var _skipDym = false;
  function commitEntry(productName, skipDym) {
    var store = norm(f.store.value), raw = f.price.value.trim(), c = parsePrice(raw);
    var rs = readSize(f.size.value, $("unit").value);
    if (!productName || !store || c === null || c <= 0 || rs.err) return; // shouldn't reach here

    var key = keyOf(productName);

    // DYM check — only if key is new and we're not skipping
    if (!skipDym && !groups[key]) {
      var sim = findSimilar(key);
      if (sim) { showDym(productName, sim); return; }
    }

    var v = { product: productName, store: store, cents: c, size: rs.size || null, unit: rs.unit };
    canon(v);
    key = keyOf(v.product);
    var prev = groups[key] ? stats(groups[key]) : null;
    var entry = { id: nextId(), key: key, product: v.product, store: v.store, cents: v.cents, date: todayStr() };
    if (v.size) { entry.size = v.size; entry.unit = v.unit; }
    log.push(entry); indexEntry(entry); saveLog();

    var comparable = prev && ((prev.lowest.size && entry.size && prev.lowest.unit === entry.unit) || (!prev.lowest.size && !entry.size));
    var isLow = !!comparable && stats(groups[key]).lowest.id === entry.id && metric(entry) < metric(prev.lowest);
    var oldFlash = flashKey; flashKey = key; celebrate = { key: key, on: isLow, fresh: isLow };
    render([oldFlash, key]);
    $("addDlg").close();
    hideDym();
    setStatus(t(isLow ? "lowSaved" : "saved", { p: v.product, v: money(v.cents), s: v.store }), isLow ? "low" : "");
    if (isLow) burst(key);
    populateMergeSelects();
    setTimeout(function () {
      if (flashKey !== key) return;
      flashKey = null; celebrate.on = false; setStatus("", ""); render([key]);
    }, 5500);
  }

  $("form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var v = validate(); if (!v) return;
    hideDym();
    commitEntry(v.product, false);
  });

  // ─── Merge products ───────────────────────────────────────────────────────────
  function populateMergeSelects() {
    var names = summarize().map(function (g) { return { key: g.key, name: g.name }; });
    ["mergeKeep", "mergeRemove"].forEach(function (id) {
      var sel = $(id); if (!sel) return;
      var cur = sel.value;
      sel.textContent = "";
      var ph = document.createElement("option"); ph.value = ""; ph.textContent = "— " + t(id === "mergeKeep" ? "mergeA" : "mergeB") + " —"; ph.disabled = true; ph.selected = !cur;
      sel.appendChild(ph);
      names.forEach(function (n) { var o = document.createElement("option"); o.value = n.key; o.textContent = n.name; sel.appendChild(o); });
      if (cur) sel.value = cur;
    });
  }

  $("openMerge") && ($("openMerge").onclick = function () {
    populateMergeSelects();
    $("mergeMsg").textContent = "";
    openModal($("mergeDlg"));
  });
  $("closeMerge") && ($("closeMerge").onclick = function () { $("mergeDlg").close(); });

  $("mergeBtn") && ($("mergeBtn").onclick = function () {
    var keepKey   = $("mergeKeep").value;
    var removeKey = $("mergeRemove").value;
    var msg = $("mergeMsg");
    if (!keepKey || !removeKey) { msg.textContent = t("mergeEmpty"); msg.className = "bad"; return; }
    if (keepKey === removeKey)   { msg.textContent = t("mergeSame");  msg.className = "bad"; return; }

    var keepName   = idx.prod[keepKey];
    var removeName = idx.prod[removeKey];

    // Re-stamp all entries that belonged to the removed product
    log.forEach(function (e) {
      if (e.key === removeKey) { e.key = keepKey; e.product = keepName; }
    });
    saveLog(); rebuildIndex();

    if (calcKey === removeKey) calcKey = keepKey;
    render();
    populateMergeSelects();
    $("mergeKeep").value   = "";
    $("mergeRemove").value = "";
    msg.textContent = t("mergeDone", { a: keepName, b: removeName });
    msg.className = "ok";
  });

  // ─── CSV import ───────────────────────────────────────────────────────────────
  function parseCSV(text) {
    text = text.replace(/^\ufeff/, "");
    var first = text.split(/\r?\n/)[0] || "";
    var sep = first.split(";").length > first.split(",").length ? ";" : ",";
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; rows.push(row); row = []; }
      else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ""; }); });
  }
  function hkey(s) { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, ""); }
  function parseDate(s) {
    var m, y, mo, d; s = s.trim();
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else return null;
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    var iso = y + "-" + pad(mo) + "-" + pad(d);
    return iso > todayStr() ? null : iso;
  }
  function parsePack(sraw, uraw) {
    var m = sraw.trim().match(/^([\d.,]+)\s*([^\d\s]*)$/);
    if (!m) return null;
    var n = normNum(m[1]); if (n === null) return null;
    n = parseFloat(n); if (!(n > 0)) return null;
    var u = hkey(m[2] || uraw || "");
    var mult = { g: 1, gr: 1, grama: 1, gramas: 1, kg: 1000, quilo: 1000, quilos: 1000, ml: 1, l: 1000, lt: 1000, litro: 1000, litros: 1, un: 1, und: 1, unid: 1, unidade: 1, unidades: 1, unit: 1, units: 1, u: 1 };
    if (!(u in mult)) return null;
    var unit = /^(g|gr|grama|gramas|kg|quilo|quilos)$/.test(u) ? "g" : /^(un|und|unid|unidade|unidades|unit|units|u)$/.test(u) ? "un" : "ml";
    var size = Math.round(n * mult[u] * 100) / 100;
    return size > 0 && size <= 1000000 ? { size: size, unit: unit } : null;
  }
  function importCSV(text) {
    var rows = parseCSV(text);
    if (rows.length < 2) return { fatal: t("impEmpty") };
    var head = rows[0].map(hkey), col = {};
    var alias = { date: ["date", "data"], product: ["product", "produto"], price: ["price", "preco", "valor"], store: ["store", "local", "loja", "mercado", "onde"], size: ["size", "quantity", "quantidade", "qtd", "embalagem", "tamanho"], unit: ["unit", "unidade"] };
    Object.keys(alias).forEach(function (k) { col[k] = head.findIndex(function (h) { return alias[k].indexOf(h) > -1; }); });
    if (col.product < 0 || col.price < 0 || col.store < 0) return { fatal: t("impHeader") };
    function g(r, k) { return col[k] >= 0 && r[col[k]] !== undefined ? r[col[k]].trim() : ""; }
    var sig = {};
    log.forEach(function (e) { sig[[e.date, e.key, e.cents, e.store.toLowerCase(), e.size || "", e.unit || ""].join("|")] = 1; });
    var res = { added: 0, dup: 0, errs: [], keys: {} };
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i], msg = null;
      var v = { product: cleanProductName(g(r, "product")), store: norm(g(r, "store")) };
      var cents = parsePrice(g(r, "price")), date = todayStr(), pk = null;
      if (!v.product || !v.store) msg = "iProd";
      else if (cents === null || cents <= 0 || cents > 10000000) msg = "iPrice";
      if (!msg && g(r, "date")) { date = parseDate(g(r, "date")); if (!date) msg = "iDate"; }
      if (!msg && g(r, "size")) { pk = parsePack(g(r, "size"), g(r, "unit")); if (!pk) msg = "iSize"; }
      if (msg) { res.errs.push(t("impLine", { n: i + 1, m: t(msg) })); continue; }
      canon(v);
      var key = keyOf(v.product);
      var s = [date, key, cents, v.store.toLowerCase(), pk ? pk.size : "", pk ? pk.unit : ""].join("|");
      if (sig[s]) { res.dup++; continue; }
      sig[s] = 1;
      var entry = { id: nextId(), key: key, product: v.product, store: v.store, cents: cents, date: date };
      if (pk) { entry.size = pk.size; entry.unit = pk.unit; }
      log.push(entry); indexEntry(entry); res.keys[key] = 1; res.added++;
    }
    if (res.added) { saveLog(); populateMergeSelects(); }
    return res;
  }
  function showImp(msg, cls) { var m = $("impMsg"); m.textContent = msg; m.className = cls || ""; }
  $("impBtn").onclick = function () { $("impFile").click(); };
  $("impFile").onchange = function () {
    var file = this.files && this.files[0], input = this;
    if (!file) return;
    file.arrayBuffer().then(function (buf) {
      var text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
      catch (e) { text = new TextDecoder("windows-1252").decode(buf); }
      var res = importCSV(text);
      if (res.fatal) { showImp(res.fatal, "bad"); }
      else {
        var lines = [t("impDone", { a: res.added, d: res.dup, e: res.errs.length })].concat(res.errs.slice(0, 5));
        if (res.errs.length > 5) lines.push(t("iMore", { n: res.errs.length - 5 }));
        showImp(lines.join("\n"), res.errs.length ? "bad" : "ok");
        render(Object.keys(res.keys));
      }
      input.value = "";
    }).catch(function () { showImp(t("impRead"), "bad"); input.value = ""; });
  };

  // ─── Settings dialog ──────────────────────────────────────────────────────────
  $("themeBtn").onclick = function () {
    settings.theme = settings.theme === "light" ? "dark" : "light";
    lsSave(SET_KEY, settings); applyTheme();
  };
  $("palette").onchange = function () { settings.palette = this.value; lsSave(SET_KEY, settings); applyTheme(); };
  $("openSettings").onclick = function () {
    $("lang").value = settings.lang; $("currency").value = settings.currency; $("decimal").value = settings.decimal;
    showImp(""); updateFsaUI();
    openModal($("setDlg"));
  };
  $("closeSet").onclick = function () { $("setDlg").close(); };
  $("lang").onchange = function () { settings.lang = this.value; lsSave(SET_KEY, settings); applyLang(); render(); };
  $("currency").oninput = function () { settings.currency = this.value.trim(); lsSave(SET_KEY, settings); render(); };
  $("decimal").onchange = function () { settings.decimal = this.value; lsSave(SET_KEY, settings); render(); };

  // FSA buttons (inside settings)
  $("fsaBtn") && ($("fsaBtn").onclick = function () {
    if (fsaActive) fsaUnlink(); else fsaLink();
  });

  // ─── CSV export & wipe ────────────────────────────────────────────────────────
  function csv(rows) {
    var sep = settings.decimal === "," ? ";" : ",";
    return rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(sep); }).join("\r\n");
  }
  function plain(c) { var s = (c / 100).toFixed(2); return settings.decimal === "," ? s.replace(".", ",") : s; }
  function download(name, text) {
    var blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  $("expSummary").onclick = function () {
    var rows = [t("csvSummary")];
    function pk(e) { return e.size ? plainNum(e.size) + e.unit : ""; }
    function np(e) { var n = nominal(e); return n ? plain(n.cents) + "/" + n.u : ""; }
    summarize().forEach(function (g) {
      rows.push([g.name, plain(g.lowest.cents), pk(g.lowest), np(g.lowest), g.lowest.store, g.lowest.date,
        plain(g.latest.cents), pk(g.latest), np(g.latest), g.latest.store, g.latest.date]);
    });
    download(t("fileSummary"), csv(rows));
  };
  $("expLog").onclick = function () {
    var rows = [t("csvLog")];
    log.slice().sort(chrono).forEach(function (e) { rows.push([e.date, e.product, plain(e.cents), e.store, e.size ? plainNum(e.size) : "", e.unit || ""]); });
    download(t("fileLog"), csv(rows));
  };
  $("wipe").onclick = function () {
    var msg = fsaActive ? t("confirmWipe") : t("confirmWipeNoFsa");
    if (log.length && confirm(msg)) {
      log = [];
      // Always clear localStorage
      try { localStorage.removeItem(LOG_KEY); } catch (e) {}
      mem[LOG_KEY] = [];
      // If FSA active, write the empty array to the file too
      if (fsaActive) fsaWrite(log);
      rebuildIndex(); calcKey = null; closeCalc(); render(); populateMergeSelects();
    }
  };

  // ─── Quick price checker ──────────────────────────────────────────────────────
  function pctTxt(x) { return (x > 0 ? "+" : x < 0 ? "\u2212" : "") + Math.abs(x).toFixed(1).replace(".", settings.decimal) + "%"; }
  function checkPrice() {
    var out = $("qcOut"); out.textContent = "";
    function say(k) { var p = document.createElement("p"); p.className = "qline"; p.textContent = t(k); out.appendChild(p); }
    var raw = $("qcProd").value, es = groups[keyOf(raw)], c = parsePrice($("qcPrice").value), rs = readSize($("qcSize").value, $("qcUnit").value);
    if (!es || c === null || c <= 0 || rs.err) return say(raw.trim() && !es ? "qNoProd" : "qFill");
    var g = stats(es), N, L, A, u = "";
    if (rs.none) {
      if (g.latest.size || g.lowest.size) return say("qNeedSize");
      N = c; L = g.lowest.cents; A = g.latest.cents;
    } else {
      if (!(g.latest.size && g.latest.unit === rs.unit && g.lowest.size && g.lowest.unit === rs.unit)) return say("qUnit");
      var n = nominal({ cents: c, size: rs.size, unit: rs.unit }); N = n.cents; A = nominal(g.latest).cents; L = nominal(g.lowest).cents; u = "/" + n.u;
    }
    var vsA = (N - A) / A * 100, vsL = (N - L) / L * 100;
    var k = Math.abs(vsA) <= 5 ? "std" : vsA < 0 ? "great" : "exp";
    var chip = document.createElement("span"); chip.className = "chip" + (k === "exp" ? " up" : k === "std" ? " neutral" : "");
    chip.textContent = t(k === "great" ? "qGreat" : k === "std" ? "qStd" : "qExp");
    var big = document.createElement("p"); big.className = "bigres"; big.textContent = money(N) + u;
    out.appendChild(chip); out.appendChild(big);
    [["qVsLow", vsL, L], ["qVsLast", vsA, A]].forEach(function (r) {
      var p = document.createElement("p"); p.className = "qline"; p.textContent = t(r[0]) + ": " + pctTxt(r[1]) + " (" + money(r[2]) + u + ")"; out.appendChild(p);
    });
  }
  ["qcProd", "qcPrice", "qcSize"].forEach(function (id) { $(id).addEventListener("input", checkPrice); });
  $("qcUnit").addEventListener("change", checkPrice);
  $("openCheck").onclick = function () { $("qcOut").textContent = ""; openModal($("qcDlg")); $("qcProd").focus(); checkPrice(); };
  $("qcClose").onclick = function () { $("qcDlg").close(); };

  // ─── Store basket index ───────────────────────────────────────────────────────
  function storeIndex() {
    var per = {}, items = 0;
    Object.keys(groups).forEach(function (k) {
      var es = groups[k].slice().sort(chrono), sized = es.filter(function (e) { return e.size; }), pool = es;
      if (sized.length) { var u = sized[sized.length - 1].unit; pool = sized.filter(function (e) { return e.unit === u; }); }
      var by = {}; pool.forEach(function (e) { by[e.store.toLowerCase()] = e; });
      var ss = Object.keys(by); if (ss.length < 2) return;
      var min = Math.min.apply(null, ss.map(function (s) { return metric(by[s]); })); items++;
      ss.forEach(function (s) {
        var r = per[s] || (per[s] = { name: by[s].store, sum: 0, w: 0, cheap: 0 });
        r.sum += metric(by[s]) / min * 100 * es.length; r.w += es.length; if (metric(by[s]) === min) r.cheap++;
      });
    });
    var rows = Object.keys(per).map(function (s) { var r = per[s]; r.index = r.sum / r.w; return r; }).sort(function (a, b) { return a.index - b.index || b.cheap - a.cheap; });
    return { items: items, rows: rows };
  }
  $("openStores").onclick = function () {
    var out = $("siOut"), r = storeIndex(); out.textContent = "";
    if (!r.rows.length) { var p = document.createElement("p"); p.className = "empty"; p.textContent = t("sEmpty"); out.appendChild(p); }
    else {
      var ol = document.createElement("ol"); ol.className = "stores";
      r.rows.forEach(function (s, i) {
        var li = document.createElement("li"), a = document.createElement("strong");
        a.textContent = (i + 1) + ". " + s.name + " \u2014 " + s.index.toFixed(1).replace(".", settings.decimal) + "%";
        var b = document.createElement("span"); b.className = "qline"; b.style.display = "block"; b.textContent = t("sCheap", { c: s.cheap, n: r.items });
        var m = document.createElement("div"); m.className = "meter"; var sp = document.createElement("span"); sp.style.width = (10000 / s.index) + "%"; m.appendChild(sp);
        li.appendChild(a); li.appendChild(b); li.appendChild(m); ol.appendChild(li);
      });
      out.appendChild(ol);
    }
    openModal($("siDlg"));
  };
  $("siClose").onclick = function () { $("siDlg").close(); };

  // ─── Service Worker ───────────────────────────────────────────────────────────
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  // ─── Boot: try to restore FSA handle, then load data ─────────────────────────
  $("storageNote").hidden = storageOk;

  fsaRestore().then(function (restored) {
    if (restored) {
      // Load from the file (it may be newer than localStorage, e.g. from another device)
      return fsaRead().then(function (fileData) {
        if (Array.isArray(fileData) && fileData.length >= log.length) {
          log = fileData;
          // Re-run migration on file data
          var m2 = false;
          log.forEach(function (e) {
            if (!e.date) { var d = new Date(e.ts || Date.now()); e.date = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); m2 = true; }
            if ("ts" in e) { delete e.ts; m2 = true; }
          });
          if (m2) saveLog();
          rebuildIndex();
        }
      });
    }
  }).then(function () {
    applyLang();
    render();
    populateMergeSelects();
    updateFsaUI();
  });

})();
