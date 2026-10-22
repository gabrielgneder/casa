"use strict";
/* Casa — app de celular ligado à planilha "CASA 2026" no Google.
   A planilha é a fonte de tudo: o app lê os valores já calculados pelas fórmulas
   e só grava nas células de digitar (fundo branco). Ver AGENTS.md. */

const CFG = window.CASA_CONFIG || {};
const SCOPES = "openid email https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets/";
const DEMO = new URLSearchParams(location.search).has("demo") && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = v => (typeof v === "number" && isFinite(v) ? v : 0);
const brl = v => num(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem("casa." + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem("casa." + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem("casa." + k); } catch (e) {} },
};

/* ======================= datas (número de série da planilha) ======================= */
const EPOCH = Date.UTC(1899, 11, 30);
const fromSerial = s => (typeof s === "number" ? new Date(EPOCH + Math.round(s) * 86400000) : null);
const toSerial = d => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000);
const todaySerial = () => toSerial(new Date());
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function fmtDate(s, mode) {
  const d = fromSerial(s); if (!d) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (mode === "dow") return `${DOW[d.getUTCDay()]} ${dd}/${mm}`;
  if (mode === "short") return `${dd}/${mm}`;
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}
const serialToIso = s => { const d = fromSerial(s); return d ? d.toISOString().slice(0, 10) : ""; };
const isoToSerial = iso => { if (!iso) return null; const [y, m, d] = iso.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000); };
function parseMoney(s) {
  s = String(s ?? "").replace(/[R$\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}
const moneyInput = v => (typeof v === "number" ? v.toFixed(2).replace(".", ",") : "");

/* ======================= cores dos cartões (as mesmas da planilha) ======================= */
const BRANDS = [ // [nome, cor da planilha, tom escuro do degradê, letra]
  [/SAMS/, "#6FA8DC", "#2f6fb5", "#fff"], [/CARREFOUR/, "#19D3F0", "#0089b3", "#fff"], [/PICPAY/, "#22D36B", "#0a8f45", "#fff"],
  [/AMAZON/, "#A3A9B1", "#4d5560", "#fff"], [/ITI/, "#FF4FD2", "#c2009a", "#fff"], [/NUBANK/, "#A23CFF", "#5f00b8", "#fff"],
  [/MERCADO PAGO/, "#3a3a3a", "#000000", "#fff"], [/INTER/, "#FF9A1F", "#e85d00", "#fff"], [/RENNER/, "#FF3B3B", "#b30000", "#fff"],
];
function brand(name) {
  const n = String(name || "").toUpperCase();
  for (const [re, c1, c2, fg] of BRANDS) if (re.test(n)) return { c1, c2, fg, bg: `linear-gradient(135deg, ${c1}, ${c2})` };
  return { c1: "#8fa39b", c2: "#5b6f67", fg: "#fff", bg: "linear-gradient(135deg, #8fa39b, #5b6f67)" };
}
const titleCase = s => String(s || "").toLowerCase().replace(/(^|[\s(–-])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bC\/c\b/i, "C/C");

/* ======================= login do Google (redirecionamento) ======================= */
const baseUrl = () => new URL(".", location.href).href;
const Token = {
  get() { const t = store.get("token"); return t && t.exp > Date.now() ? t.access_token : null; },
  set(tok, secs) { store.set("token", { access_token: tok, exp: Date.now() + (Number(secs) || 3600) * 1000 - 60000 }); },
  clear() { store.del("token"); },
};
// silent = tenta renovar sem nenhum toque (o Google já conhece a pessoa); se precisar de algo, volta e mostra o botão.
function googleLogin(silent) {
  if (DEMO) return;
  if (silent === true) store.set("silentTry", Date.now()); else store.del("silentTry");
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  store.set("oauthState", state);
  const p = new URLSearchParams({
    client_id: CFG.GOOGLE_CLIENT_ID, redirect_uri: baseUrl(), response_type: "token",
    scope: SCOPES, state, include_granted_scopes: "true",
  });
  // "pick" = primeira entrada: sempre deixa escolher a conta (o celular pode ter várias)
  const email = store.get("email");
  if (silent === "pick") p.set("prompt", "select_account");
  else if (email) p.set("login_hint", email);
  if (silent === true) p.set("prompt", "none");
  location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + p.toString());
}
function handleOAuthReturn() {
  if (!location.hash || location.hash.length < 2) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.has("access_token") && !p.has("error")) return null;
  const expected = store.get("oauthState");
  store.del("oauthState");
  history.replaceState(null, "", baseUrl());
  if (p.get("error")) {
    if (/interaction_required|login_required|consent_required|account_selection_required/.test(p.get("error"))) return "silent-fail";
    return p.get("error") === "access_denied" ? "Entrada cancelada." : "O Google recusou a entrada. Tente de novo.";
  }
  if (!expected || p.get("state") !== expected) return "Não deu para confirmar a entrada. Tente de novo.";
  if (!(p.get("scope") || "").includes("spreadsheets")) return "Na tela do Google, deixe marcada a permissão das Planilhas Google.";
  Token.set(p.get("access_token"), p.get("expires_in"));
  return "ok";
}
class AuthError extends Error {}

async function api(path, opts = {}) {
  if (DEMO) return Demo.api(path, opts);
  const tok = Token.get();
  if (!tok) throw new AuthError("sem token");
  let res;
  try {
    res = await fetch(API + CFG.SPREADSHEET_ID + path, {
      ...opts, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    });
  } catch (e) { throw new Error("Sem internet. Tente de novo quando a conexão voltar."); }
  if (res.status === 401) { Token.clear(); throw new AuthError("expirado"); }
  if (res.status === 403 || res.status === 404) throw new Error("Este e-mail não tem acesso à planilha CASA. Peça para a Maria compartilhar como Editor.");
  if (!res.ok) throw new Error("O Google respondeu com erro " + res.status + ". Tente de novo.");
  return res.json();
}
async function fetchEmail() {
  if (DEMO) return;
  try {
    const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: "Bearer " + Token.get() } });
    if (r.ok) { const j = await r.json(); if (j.email) store.set("email", j.email); }
  } catch (e) {}
}

/* ======================= leitura da planilha ======================= */
const RANGES = ["CASA!A1:H900", "CASA!X1:Y900", "Tabelas!A2:D300"];
async function readGrid() {
  const q = RANGES.map(r => "ranges=" + encodeURIComponent(r)).join("&");
  const j = await api(`/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  const [main, helper, tab] = j.valueRanges.map(v => v.values || []);
  return { main, helper, tab };
}

// Acha cada bloco da aba CASA pelos títulos da coluna A (assim o app continua
// funcionando mesmo se alguém inserir linhas na planilha).
function parse(g) {
  const v = (r, c) => { const row = g.main[r - 1]; const x = row ? row[c - 1] : undefined; return x === undefined || x === null ? "" : x; };
  const h = (r, c) => { const row = g.helper[r - 1]; const x = row ? row[c] : undefined; return x === undefined || x === null ? "" : x; };
  const n = g.main.length;
  const A = r => String(v(r, 1)).trim();
  const find = (test, from = 1) => { for (let r = from; r <= n; r++) if (test(A(r))) return r; return -1; };
  const need = (r, what) => { if (r < 0) throw new Error("A planilha mudou e o app não achou: " + what); return r; };

  const months = g.tab.filter(r => r[0]).map(r => ({ label: String(r[0]), serial: r[1], idx: Number(r[2]), nome: String(r[3] || "") }));
  const m = { months, mes: String(v(2, 2)).trim() };
  m.cur = months.find(x => x.label === m.mes) || null;

  // entradas
  const rEnt = need(find(t => t === "ENTRADAS"), "ENTRADAS");
  const rTotEnt = need(find(t => t.startsWith("TOTAL QUE ENTROU"), rEnt), "TOTAL QUE ENTROU");
  m.entradas = [];
  for (let r = rEnt + 1; r < rTotEnt; r++) m.entradas.push({ row: r, nome: A(r), data: v(r, 2), valor: v(r, 3), principal: r - rEnt <= 2 });
  m.totalEntrou = v(rTotEnt, 3);

  // faturas do mês
  const rFat = need(find(t => t === "FATURAS DOS CARTÕES"), "FATURAS DOS CARTÕES");
  m.faturas = [];
  for (let r = rFat + 1; A(r).startsWith("C. "); r++)
    m.faturas.push({ row: r, nome: A(r).slice(3), venc: v(r, 2), valor: v(r, 3), previsto: v(r, 4), saide: String(v(r, 5)), onde: String(v(r, 6)) });

  // contas fixas
  const rFix = need(find(t => t === "CONTAS FIXAS"), "CONTAS FIXAS");
  const rTotFix = need(find(t => t === "TOTAL CONTAS FIXAS", rFix), "TOTAL CONTAS FIXAS");
  m.fixas = [];
  for (let r = rFix + 1; r < rTotFix; r++)
    m.fixas.push({ row: r, nome: A(r), dia: v(r, 2), valor: v(r, 3), saide: String(v(r, 5)), onde: String(v(r, 6)) });
  m.totalFixas = v(rTotFix, 3);

  // resultado
  const rRes = need(find(t => t === "RESULTADO DO MÊS"), "RESULTADO DO MÊS");
  m.sobra1 = v(rRes + 1, 3); m.sobraFinal = v(rRes + 2, 3); m.previsto = v(rRes + 3, 3);
  m.alerta = String(v(rRes + 4, 1) || "");

  // Carlos
  const rCH = need(find(t => t === "O QUE O CARLOS DÁ"), "bloco do Carlos");
  const rNu = need(find(t => t.startsWith("NUBANK CARLOS"), rCH), "NUBANK CARLOS");
  m.carlos = { mensalRow: rCH + 1, mensal: v(rCH + 1, 3), extras: [], nubank: v(rNu, 3), total: v(rNu + 1, 3), entrou: v(rNu + 2, 3), dif: v(rNu + 3, 3) };
  for (let r = rCH + 2; r < rNu; r++) m.carlos.extras.push({ row: r, nome: A(r), valor: v(r, 3) });

  // cartões
  const rCT = need(find(t => t === "CARTÕES"), "CARTÕES");
  const rCTt = need(find(t => t === "TOTAL DAS FATURAS", rCT), "TOTAL DAS FATURAS");
  m.cartoes = [];
  for (let r = rCT + 2; r < rCTt; r++)
    m.cartoes.push({ row: r, nome: A(r), final: String(v(r, 2)), dia: num(v(r, 3)), melhor: num(v(r, 4)), venc: v(r, 5), fatura: v(r, 6), hoje: String(v(r, 7)), ajuste: v(r, 8) });

  // total parcelado (próximos 12 meses)
  const rTP = find(t => t.startsWith("TOTAL PARCELADO"));
  m.proj = { meses: [], linhas: {} };
  if (rTP > 0) {
    for (let c = 2; c <= 13; c++) m.proj.meses.push(String(v(rTP + 1, c)));
    for (let r = rTP + 2; A(r) && A(r) !== "TOTAL"; r++) m.proj.linhas[A(r)] = Array.from({ length: 12 }, (_, i) => v(r, i + 2));
  }

  // porquinho
  const rPQ = find(t => t.startsWith("PORQUINHO"));
  const rLists = find(t => t === "COMPRAS DE CADA CARTÃO");
  m.porquinho = [];
  if (rPQ > 0 && rLists > 0)
    for (let r = rPQ + 2; r < rLists - 1; r++) m.porquinho.push({ row: r, data: v(r, 1), inter: v(r, 2), mp: v(r, 3), total: v(r, 4), dif: v(r, 5), obs: String(v(r, 6)) });

  // listas de compras de cada cartão
  m.listas = [];
  for (let r = 1; r <= n; r++) {
    if (A(r) !== "COMPRA" || String(v(r, 2)) !== "VALOR") continue;
    const rT = find(t => t.startsWith("TOTAL DA FATURA"), r + 1);
    if (rT < 0) break;
    const nome = A(r - 2).replace(/^CARTÃO /, "").split(" •")[0].trim();
    const itens = [];
    for (let i = r + 1; i < rT; i++)
      itens.push({ row: i, nome: A(i), valor: v(i, 2), data: v(i, 3), parc: v(i, 4), fat: String(v(i, 5)), sit: String(v(i, 6)), noMes: v(i, 7), ini: h(i, 0), fim: h(i, 1) });
    m.listas.push({ nome, titleRow: r - 2, first: r + 1, last: rT - 1, totalRow: rT, total: v(rT, 7), itens });
    r = rT;
  }
  // liga cada lista ao seu cartão (NUBANK tem duas: a dela e a do Carlos)
  for (const l of m.listas) {
    const card = m.cartoes.filter(c => l.nome.startsWith(c.nome)).sort((a, b) => b.nome.length - a.nome.length)[0];
    l.card = card ? card.nome : l.nome;
    l.label = /CARLOS/.test(l.nome) ? "Nubank do Carlos" : /\(MEU\)/.test(l.nome) ? "Nubank (meu)" : titleCase(l.nome);
  }
  m.ranges = { rRes, rCH, rNu, rFix, rTotFix, rEnt, rTotEnt, title: need(find(t => /^MÊS [A-ZÇ]+ \d{4}$/.test(t)), "título do mês"), carlosDif: rNu + 3, rCT, rCTt };
  return m;
}

const monthByIdx = idx => (S.m ? S.m.months.find(x => x.idx === idx) : null);
const monthByLabel = lbl => (S.m ? S.m.months.find(x => x.label === lbl) : null);
// Mesma regra da planilha: comprou no melhor dia ou depois → pula uma fatura;
// melhor dia depois do vencimento → a fatura é do mês seguinte.
function faturaPara(card, serial) {
  const d = fromSerial(serial);
  const idx = d.getUTCFullYear() * 12 + d.getUTCMonth() + 1 + (d.getUTCDate() >= card.melhor ? 1 : 0) + (card.melhor > card.dia ? 1 : 0);
  return monthByIdx(idx);
}

/* ======================= gravação ======================= */
async function writeRaw(data) {
  return api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
}
async function clearRanges(ranges) {
  return api("/values:batchClear", { method: "POST", body: JSON.stringify({ ranges }) });
}
async function readRange(range) {
  const j = await api(`/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  return j.values || [];
}
// Antes de mexer numa linha, confere se ela ainda é a mesma (outra pessoa pode ter mudado).
async function sameRow(row, nome, col = "A") {
  const vals = await readRange(`CASA!${col}${row}`);
  const cur = vals[0] && vals[0][0] !== undefined ? String(vals[0][0]).trim() : "";
  if (cur !== String(nome || "").trim()) throw new Error("Essa linha mudou na planilha (talvez outra pessoa mexeu). Atualizei a tela, tente de novo.");
}

const OPS = {
  async addCompra({ lista, nome, valor, data, parc, fat }) {
    const l = S.m.listas.find(x => x.nome === lista);
    if (!l) throw new Error("Não achei a lista desse cartão na planilha.");
    const fresh = await readRange(`CASA!A${l.first}:B${l.last}`);
    let row = -1;
    for (let i = 0; i <= l.last - l.first; i++) {
      const r = fresh[i] || [];
      if ((r[0] === undefined || r[0] === "") && (r[1] === undefined || r[1] === "")) { row = l.first + i; break; }
    }
    if (row < 0) throw new Error("A lista desse cartão está cheia. Use “Fechar o mês” (em Mais) para tirar as compras que já acabaram.");
    await writeRaw([{ range: `CASA!A${row}:E${row}`, values: [[nome, valor, data, parc, fat]] }]);
    return `Compra salva em ${l.label}.`;
  },
  async editCompra({ row, antes, nome, valor, data, parc, fat }) {
    await sameRow(row, antes);
    await writeRaw([{ range: `CASA!A${row}:E${row}`, values: [[nome, valor, data, parc, fat]] }]);
    return "Compra alterada.";
  },
  async delCompra({ row, antes }) {
    await sameRow(row, antes);
    await clearRanges([`CASA!A${row}:E${row}`]);
    return "Compra apagada.";
  },
  async saveFixa({ row, antes, nome, dia, valor, saide, onde }) {
    if (row) await sameRow(row, antes);
    else {
      const f = S.m.fixas.find(x => !x.nome && x.valor === "");
      if (!f) throw new Error("Não tem linha vazia em CONTAS FIXAS. Apague uma conta que não usa mais.");
      row = f.row;
      await sameRow(row, "");
    }
    await writeRaw([
      { range: `CASA!A${row}:C${row}`, values: [[nome, dia, valor]] },
      { range: `CASA!E${row}:F${row}`, values: [[saide, onde]] },
    ]);
    return "Conta salva.";
  },
  async delFixa({ row, antes }) {
    await sameRow(row, antes);
    await clearRanges([`CASA!A${row}:C${row}`, `CASA!E${row}:F${row}`]);
    return "Conta apagada.";
  },
  async saveEntrada({ row, nome, valor, principal }) {
    const data = principal ? [{ range: `CASA!C${row}`, values: [[valor]] }] : [{ range: `CASA!A${row}`, values: [[nome]] }, { range: `CASA!C${row}`, values: [[valor]] }];
    await writeRaw(data);
    return "Entrada salva.";
  },
  async saveCarlos({ row, antes, nome, valor, mensal }) {
    if (mensal) { await writeRaw([{ range: `CASA!C${row}`, values: [[valor]] }]); return "Valor salvo."; }
    if (row) await sameRow(row, antes);
    else {
      const f = S.m.carlos.extras.find(x => !x.nome && x.valor === "");
      if (!f) throw new Error("Não tem linha vazia no bloco do Carlos.");
      row = f.row;
    }
    await writeRaw([{ range: `CASA!A${row}`, values: [[nome]] }, { range: `CASA!C${row}`, values: [[valor]] }]);
    return "Valor salvo.";
  },
  async delCarlos({ row, antes }) {
    await sameRow(row, antes);
    await clearRanges([`CASA!A${row}`, `CASA!C${row}`]);
    return "Item apagado.";
  },
  async saveCartao({ row, dia, melhor, ajuste }) {
    await writeRaw([{ range: `CASA!C${row}:D${row}`, values: [[dia, melhor]] }, { range: `CASA!H${row}`, values: [[ajuste === null ? "" : ajuste]] }]);
    return "Cartão salvo.";
  },
  async savePorquinho({ row, data, inter, mp, obs }) {
    if (!row) {
      const f = S.m.porquinho.find(x => x.data === "" && x.inter === "" && x.mp === "");
      if (!f) throw new Error("O Porquinho está cheio na planilha.");
      row = f.row;
    }
    await writeRaw([{ range: `CASA!A${row}:C${row}`, values: [[data, inter, mp]] }, { range: `CASA!F${row}`, values: [[obs]] }]);
    return "Porquinho salvo.";
  },
  async delPorquinho({ row }) {
    await clearRanges([`CASA!A${row}:C${row}`, `CASA!F${row}`]);
    return "Linha apagada.";
  },
  async setMes({ label }) {
    await writeRaw([{ range: "CASA!B2", values: [[label]] }]);
    return null;
  },
  async fecharMes() { return fecharMes(); },
};

// Executa uma operação. Se o login expirou, guarda a operação e volta a fazê-la depois de entrar de novo.
// Renova o login sozinho, sem toque, no máximo uma tentativa a cada 2 minutos (evita ficar em loop).
const canSilent = () => !!store.get("email") && Date.now() - (store.get("silentTry") || 0) > 120000;
function relogin() { if (canSilent()) googleLogin(true); else googleLogin(); }

async function run(op, args, { busyText = "Salvando…" } = {}) {
  if (!DEMO && !Token.get()) { store.set("pending", { op, args }); toast("Conectando ao Google…"); relogin(); return false; }
  busy(busyText);
  try {
    const msg = await OPS[op](args);
    store.del("pending");
    await refresh({ quiet: true });
    if (msg) toast(msg);
    return true;
  } catch (e) {
    if (e instanceof AuthError) { store.set("pending", { op, args }); relogin(); return false; }
    toast(e.message || "Não deu certo. Tente de novo.", true);
    refresh({ quiet: true });
    return false;
  } finally { busy(false); }
}

/* ======================= fechar o mês ======================= */
async function fecharMes() {
  const g = await readGrid();
  const m = parse(g);
  if (!m.cur) throw new Error("O mês da planilha não está na tabela de meses.");
  const prox = m.months.find(x => x.idx === m.cur.idx + 1);
  if (!prox) throw new Error("Acabaram os meses na aba Tabelas. Peça ajuda para incluir mais meses.");
  const meta = await api("?fields=sheets.properties(sheetId,title)");
  const id = t => { const s = meta.sheets.find(x => x.properties.title === t); return s ? s.properties.sheetId : null; };
  const casaId = id("CASA"), histId = id("ANTERIORES");
  if (casaId === null || histId === null) throw new Error("Não achei as abas CASA e ANTERIORES na planilha.");

  // 1) guarda o mês (bloco do mês + Carlos) e as compras dele em ANTERIORES, o mais novo em cima
  const ini = m.ranges.title, fim = m.ranges.carlosDif, altura = fim - ini + 1;
  const compras = [];
  for (const l of m.listas) for (const it of l.itens) if (num(it.noMes) > 0) compras.push([l.label, it.nome, it.valor, it.data === "" ? "" : fmtDate(it.data), it.sit]);
  const total = 1 + altura + 2 + compras.length + 3;
  const hoje = new Date().toLocaleDateString("pt-BR");
  await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [
    { insertDimension: { range: { sheetId: histId, dimension: "ROWS", startIndex: 3, endIndex: 3 + total }, inheritFromBefore: false } },
    { copyPaste: { source: { sheetId: casaId, startRowIndex: ini - 1, endRowIndex: fim, startColumnIndex: 0, endColumnIndex: 7 },
                   destination: { sheetId: histId, startRowIndex: 4, endRowIndex: 4 + altura, startColumnIndex: 0, endColumnIndex: 7 }, pasteType: "PASTE_FORMAT" } },
    { copyPaste: { source: { sheetId: casaId, startRowIndex: ini - 1, endRowIndex: fim, startColumnIndex: 0, endColumnIndex: 7 },
                   destination: { sheetId: histId, startRowIndex: 4, endRowIndex: 4 + altura, startColumnIndex: 0, endColumnIndex: 7 }, pasteType: "PASTE_VALUES" } },
  ] }) });
  const r0 = 4 + altura + 2; // linha (1-based) do cabeçalho das compras
  const data = [
    { range: "ANTERIORES!A4", values: [[`${m.cur.nome} – fechado em ${hoje}`]] },
    { range: `ANTERIORES!A${r0}:E${r0}`, values: [["CARTÃO", "COMPRA", "VALOR", "DATA", "SITUAÇÃO"]] },
  ];
  if (compras.length) data.push({ range: `ANTERIORES!A${r0 + 1}:E${r0 + compras.length}`, values: compras });

  // 2) tira das listas o que acabou neste mês (ou antes) e sobe o resto
  for (const l of m.listas) {
    const ficam = l.itens.filter(it => {
      const vazia = it.nome === "" && it.valor === "" && it.parc === "" && it.fat === "" && it.data === "";
      if (vazia) return false;
      return !(it.fat !== "" && num(it.fim) <= m.cur.idx);
    }).map(it => [it.nome, it.valor, it.data, it.parc, it.fat]);
    while (ficam.length < l.itens.length) ficam.push(["", "", "", "", ""]);
    data.push({ range: `CASA!A${l.first}:E${l.last}`, values: ficam });
  }
  // 3) passa para o mês seguinte e limpa os vencimentos mudados à mão
  data.push({ range: "CASA!B2", values: [[prox.label]] });
  for (const c of m.cartoes) data.push({ range: `CASA!H${c.row}`, values: [[""]] });
  await writeRaw(data);
  return `${titleCase(m.cur.nome)} foi guardado em ANTERIORES. Agora é ${titleCase(prox.nome)}.`;
}

/* ======================= estado e carregamento ======================= */
const S = { m: null, at: null, tab: "inicio", card: null, loading: false, err: null };

async function refresh({ quiet = false } = {}) {
  if (!DEMO && !Token.get()) { renderBanner(); render(); return; }
  S.loading = true; if (!quiet) renderStatus();
  try {
    const g = await readGrid();
    S.m = parse(g); S.at = Date.now(); S.err = null;
    store.set("cache", { g, at: S.at });
  } catch (e) {
    if (e instanceof AuthError) S.err = null; else S.err = e.message;
    if (!quiet || !(e instanceof AuthError)) toast(e instanceof AuthError ? "Entre de novo para atualizar." : e.message, !(e instanceof AuthError));
  } finally { S.loading = false; renderBanner(); render(); }
}

/* ======================= interface ======================= */
function toast(msg, err) {
  const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("on");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), err ? 5200 : 3000);
}
function busy(text) {
  let b = $(".busy");
  if (!text) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement("div"); b.className = "busy"; document.body.append(b); }
  b.innerHTML = `<div class="spin"><svg><use href="#i-sync"/></svg>${esc(text)}</div>`;
}
function renderBanner() {
  const b = $("#banner");
  if (!DEMO && !Token.get() && S.m) {
    b.innerHTML = `<span>Mostrando os últimos valores guardados. Entre de novo para atualizar.</span><button id="relogin">Entrar</button>`;
    b.hidden = false; $("#relogin").onclick = () => googleLogin();
  } else b.hidden = true;
}
function renderStatus() {
  const el = $(".status"); if (!el) return;
  el.classList.toggle("spin", S.loading);
  const when = S.at ? new Date(S.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
  el.querySelector("span").textContent = S.loading ? "Atualizando…" : `Atualizado às ${when}`;
}
const statusHtml = () => `<div class="status"><span></span><button data-act="refresh"><svg><use href="#i-sync"/></svg>Atualizar</button></div>`;

function render() {
  const main = $("#main");
  document.body.classList.toggle("no-app", !S.m);
  if (!S.m) { main.innerHTML = loginHtml(); $("#mes-nome").textContent = "Casa"; return; }
  const m = S.m;
  $("#mes-nome").textContent = m.cur ? titleCase(m.cur.nome) : m.mes;
  $("#mes-prev").disabled = !m.cur || !monthByIdx(m.cur.idx - 1);
  $("#mes-next").disabled = !m.cur || !monthByIdx(m.cur.idx + 1);
  $$(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab));
  const views = { inicio: viewInicio, cartoes: viewCartoes, contas: viewContas, mais: viewMais, cartao: viewCartao };
  main.innerHTML = (views[S.tab] || viewInicio)() + statusHtml();
  renderStatus();
}

function loginHtml() {
  return `<div class="login">
    <div class="login-art"><img src="icons/icon-192.png" alt=""></div>
    <h1>Contas da casa</h1>
    <p>Os gastos, os cartões e o que sobra no mês, tudo num lugar só. Fica guardado na planilha CASA, no Google.</p>
    <button class="btn big" data-act="login"><svg><use href="#i-google"/></svg>Entrar com o Google</button>
    <div class="login-hint"><svg><use href="#i-info"/></svg><span>Se aparecer “O Google não verificou este app”, toque em <b>Avançado</b> e depois em <b>Acessar</b>. É normal: o app é só da família.</span></div>
  </div>`;
}

/* ---------- peças visuais ---------- */
const ICONS = [
  [/LUZ|ENEL|LIGHT|ENERGIA/, "bolt", "#f59f00"], [/G[ÁA]S|NATURGY|COMG[ÁA]S/, "flame", "#f76707"],
  [/CONDOM/, "building", "#5c7cfa"], [/NET|CLARO|INTERNET|VIVO|TIM|OI\b|TELEFONE/, "wifi", "#15aabf"],
  [/IPTU|CASA|ALUGUEL/, "house", "#2b8a3e"], [/INSS|SEGURO|PREVID/, "shield", "#7048e8"],
  [/REM[ÉE]DIO|FARM/, "pill", "#e64980"], [/NETFLIX|SPOTIFY|APPLE|IQIYI|STREAM/, "play", "#e03131"],
  [/MESADA/, "gift", "#d6336c"], [/OBRA|PISCINA/, "tools", "#868e96"],
  [/MARIA|DANIEL|FAXINEIRA|DIARISTA/, "user", "#1c7ed6"],
];
function contaIcon(nome) {
  const n = String(nome || "").toUpperCase();
  for (const [re, ic, cor] of ICONS) if (re.test(n)) return { ic, cor };
  return { ic: "coin", cor: "#2f9e44" };
}
const icoBubble = nome => { const { ic, cor } = contaIcon(nome); return `<span class="ico" style="--ic:${cor}"><svg><use href="#i-${ic}"/></svg></span>`; };
const cardStyle = nome => { const b = brand(nome); return `--c1:${b.c1};--c2:${b.c2};--fg:${b.fg}`; };
const miniCard = nome => `<span class="mini" style="${cardStyle(nome)}"><i></i></span>`;
const diasAte = serial => (typeof serial === "number" ? serial - todaySerial() : null);
function dueBadge(serial) {
  const d = diasAte(serial);
  if (d === null || d < 0 || d > 5) return "";
  if (d === 0) return `<span class="due today">vence hoje</span>`;
  if (d === 1) return `<span class="due soon">vence amanhã</span>`;
  return `<span class="due soon">em ${d} dias</span>`;
}
const saideLabel = s => (s === "1º DINHEIRO" ? "1º dinheiro" : s === "2º DINHEIRO" ? "2º dinheiro" : s === "NO CARTÃO" ? "no cartão" : "sem “paga com”");
const saideChip = s => `<span class="src ${s === "1º DINHEIRO" ? "s1" : s === "2º DINHEIRO" ? "s2" : "s0"}">${esc(saideLabel(s))}</span>`;
const secHead = (titulo, sub, cor) => `<div class="sec"><span class="sec-dot" style="background:${cor}"></span><div><h2>${esc(titulo)}</h2>${sub ? `<p>${sub}</p>` : ""}</div></div>`;
const mesCurto = () => (S.m && S.m.cur ? titleCase(S.m.cur.nome).split(" ")[0].toLowerCase() : "");

function viewInicio() {
  const m = S.m;
  const neg = num(m.sobraFinal) < 0;
  const totFat = m.faturas.reduce((a, f) => a + num(f.valor), 0);
  const fat = [...m.faturas].sort((a, b) => num(a.venc) - num(b.venc)).map(f => `
    <button class="item" data-act="open-card" data-card="${esc(f.nome)}">
      ${miniCard(f.nome)}
      <span class="item-main"><span class="item-t">${esc(titleCase(f.nome))} ${dueBadge(f.venc)}</span>
        <span class="item-s">vence ${esc(fmtDate(f.venc, "dow"))} · ${saideChip(f.saide)}</span></span>
      <span class="item-v">${brl(f.valor)}</span>
    </button>`).join("");
  return `
    <section class="hero ${neg ? "neg" : ""}">
      <div class="hero-lbl">${neg ? "Vai faltar no fim do mês" : "Sobra final do mês"}</div>
      <div class="hero-big">${brl(m.sobraFinal)}</div>
      <div class="hero-sub">2º dinheiro + o que sobrou do 1º, menos as contas do 2º</div>
      <div class="hero-row">
        <div><span>Sobra do 1º dinheiro</span><b>${brl(m.sobra1)}</b></div>
        <div><span>Entrou no mês</span><b>${brl(m.totalEntrou)}</b></div>
      </div>
    </section>
    <button class="free" data-act="tab" data-tab="contas">
      <span class="free-ic"><svg><use href="#i-card"/></svg></span>
      <span><span class="free-l">Livre para gastar no cartão</span><span class="free-v ${num(m.previsto) < 0 ? "neg" : ""}">${brl(m.previsto)}</span></span>
    </button>
    ${m.alerta ? `<div class="alert"><svg><use href="#i-info"/></svg>${esc(m.alerta)}</div>` : ""}
    ${secHead("Faturas dos cartões", `${m.faturas.length} cartões · total ${brl(totFat)}`, "#5c7cfa")}
    <div class="list">${fat || `<div class="empty">Nenhuma fatura.</div>`}</div>
    ${secHead("Contas do mês", "", "#f59f00")}
    <div class="list">
      <button class="item" data-act="tab" data-tab="contas">${icoBubble("CASA")}<span class="item-main"><span class="item-t">Contas fixas</span><span class="item-s">${m.fixas.filter(f => f.nome).length} contas · luz, gás, condomínio…</span></span><span class="item-v">${brl(m.totalFixas)}</span></button>
    </div>`;
}

function ccHtml(c, big) {
  return `<button class="cc ${big ? "cc-big" : ""}" data-act="open-card" data-card="${esc(c.nome)}" style="${cardStyle(c.nome)}">
    <span class="cc-top"><span class="cc-name">${esc(titleCase(c.nome))}</span><span class="cc-pill">melhor dia ${c.melhor}</span></span>
    <span class="cc-chip"></span>
    <span class="cc-lbl">Fatura de ${esc(mesCurto())}</span>
    <span class="cc-val">${brl(c.fatura)}</span>
    <span class="cc-bot"><span>${c.final && c.final !== "—" ? "•••• " + esc(c.final) : "&nbsp;"}</span><span>vence ${esc(fmtDate(c.venc, "dow"))}</span></span>
  </button>`;
}
function viewCartoes() {
  const m = S.m;
  const tot = m.cartoes.reduce((a, c) => a + num(c.fatura), 0);
  const hoje = todaySerial();
  const prazos = m.cartoes.map(c => {
    const f = faturaPara(c, hoje);
    const venc = f && typeof f.serial === "number" ? f.serial + c.dia - 1 : null;
    return { c, f, venc, dias: venc === null ? -1 : venc - hoje };
  }).sort((a, b) => b.dias - a.dias);
  const top = prazos[0];
  const linhas = prazos.map(p => `<button class="item" data-act="edit-cartao" data-card="${esc(p.c.nome)}">
      ${miniCard(p.c.nome)}
      <span class="item-main"><span class="item-t">${esc(titleCase(p.c.nome))}</span>
        <span class="item-s">melhor dia <b>${p.c.melhor}</b> · comprando hoje, paga ${p.venc !== null ? "em " + esc(fmtDate(p.venc, "short")) : "—"}</span></span>
      <span class="item-v">${p.dias >= 0 ? p.dias + " dias" : ""}<small>de prazo</small></span></button>`).join("");
  return `${top && top.dias >= 0 ? `<div class="bestday">
      <span class="ico" style="--ic:#2f9e44"><svg><use href="#i-calendar"/></svg></span>
      <span><span class="bd-l">Hoje, o cartão que dá mais prazo é</span><b>${esc(titleCase(top.c.nome))}</b><span class="bd-s">paga só em ${esc(fmtDate(top.venc, "short"))} · ${top.dias} dias</span></span>
    </div>` : ""}
    ${secHead("Meus cartões", `Toque num cartão para ver as compras · total ${brl(tot)}`, "#5c7cfa")}
    <div class="wallet">${m.cartoes.map(c => ccHtml(c)).join("")}</div>
    ${secHead("Melhor dia para comprar", "Toque num cartão para mudar o melhor dia deste mês", "#2f9e44")}
    <div class="list">${linhas}</div>
    <p class="ver">O melhor dia muda todo mês. Os dias de prazo são contados até o vencimento “regra” do cartão.</p>`;
}

function parcInfo(it) {
  if (!/^P \d+\/\d+$/.test(it.sit)) return null;
  const [a, b] = it.sit.slice(2).split("/").map(Number);
  return { a, b };
}
function itemClass(it) {
  if (it.sit === "FIXO") return "fixo";
  const p = parcInfo(it); if (p) return p.a === p.b ? "ultima" : "parc";
  if (it.sit === "ACABOU" || it.sit === "FUTURA") return "muted";
  if (it.sit === "ESCOLHA A 1ª FATURA") return "warn";
  return "vista";
}
function sitLabel(it) {
  const p = parcInfo(it);
  if (p) return p.a === p.b ? `ÚLTIMA ${p.a}/${p.b}` : `PARCELA ${p.a}/${p.b}`;
  return { "FIXO": "TODO MÊS", "À VISTA": "À VISTA", "ACABOU": "JÁ ACABOU", "FUTURA": "FATURA FUTURA", "ESCOLHA A 1ª FATURA": "FALTA A FATURA" }[it.sit] || it.sit;
}
function compraHtml(it) {
  const p = parcInfo(it);
  return `<button class="buy ${itemClass(it)}" data-act="edit-compra" data-row="${it.row}">
    <span class="buy-main">
      <span class="buy-t">${esc(it.nome || "(sem nome)")}</span>
      <span class="buy-s"><span class="tag">${esc(sitLabel(it))}</span>${it.data !== "" ? `<span class="buy-d">${esc(fmtDate(it.data, "short"))}</span>` : ""}</span>
      ${p ? `<span class="bar"><i style="width:${Math.round(p.a / p.b * 100)}%"></i></span>` : ""}
    </span>
    <span class="buy-v">${brl(it.valor)}${p && p.b > p.a ? `<small>faltam ${p.b - p.a}× · ${brl(num(it.valor) * (p.b - p.a))}</small>` : ""}</span>
  </button>`;
}
function viewCartao() {
  const m = S.m, c = m.cartoes.find(x => x.nome === S.card);
  if (!c) { S.tab = "cartoes"; return viewCartoes(); }
  const listas = m.listas.filter(l => l.card === c.nome);
  const hoje = monthByLabel(c.hoje);
  const cor = brand(c.nome).c1;
  const blocos = listas.map(l => {
    const itens = l.itens.filter(it => it.nome || it.valor !== "");
    const ativos = itens.filter(it => num(it.noMes) > 0 || it.sit === "ESCOLHA A 1ª FATURA");
    const futuras = itens.filter(it => it.sit === "FUTURA");
    const proj = m.proj.linhas[l.nome] || m.proj.linhas[Object.keys(m.proj.linhas).find(k => k.startsWith(l.nome)) || ""];
    const prox = proj ? proj.slice(1).map((v, i) => ({ v: num(v), mes: m.proj.meses[i + 1] })).filter(x => x.v > 0) : [];
    const maxP = Math.max(1, ...prox.map(x => x.v));
    return `${secHead(listas.length > 1 ? l.label : "Compras desta fatura", `${ativos.length} compras · total ${brl(l.total)}`, cor)}
      <div class="list">${ativos.map(compraHtml).join("") || `<div class="empty">Nenhuma compra nesta fatura.</div>`}</div>
      ${prox.length ? `${secHead("Próximas faturas", "o que já está comprometido", "#f59f00")}
        <div class="months">${prox.map(x => `<div class="mo"><span class="mo-bar"><i style="height:${Math.max(8, Math.round(x.v / maxP * 100))}%;--c1:${cor}"></i></span><b>${brl(x.v).replace("R$", "").trim()}</b><span>${esc(x.mes)}</span></div>`).join("")}</div>` : ""}
      ${futuras.length ? `${secHead("Já lançadas para depois", "", "#868e96")}<div class="list">${futuras.map(compraHtml).join("")}</div>` : ""}`;
  }).join("");
  return `<button class="back" data-act="tab" data-tab="cartoes"><svg><use href="#i-left"/></svg>Todos os cartões</button>
    <div class="cc-solo">${ccHtml(c, true)}</div>
    <div class="facts">
      <div><span>Vence</span><b>${esc(fmtDate(c.venc, "dow"))}</b></div>
      <div><span>Melhor dia</span><b>dia ${c.melhor}</b></div>
      <div><span>Compra hoje cai em</span><b>${esc(hoje ? titleCase(hoje.nome).split(" ")[0] : c.hoje)}</b></div>
    </div>
    <button class="btn" data-act="nova-compra" data-card="${esc(c.nome)}"><svg><use href="#i-plus"/></svg>Lançar compra neste cartão</button>
    ${blocos}
    <div class="legend"><span><i class="lg parc"></i>parcelado</span><span><i class="lg ultima"></i>última parcela</span><span><i class="lg fixo"></i>todo mês</span><span><i class="lg vista"></i>à vista</span></div>
    <button class="btn ghost" data-act="edit-cartao" data-card="${esc(c.nome)}">Mudar melhor dia ou vencimento</button>`;
}

function viewContas() {
  const m = S.m;
  const ent = m.entradas.filter(e => e.principal || e.nome || e.valor !== "").map(e => {
    const primeiro = e.row - m.ranges.rEnt === 1;
    const nome = e.principal ? (primeiro ? "1º dinheiro" : "2º dinheiro") : e.nome;
    const sub = e.principal ? `${primeiro ? "chega no fim do mês" : "para os cartões"} · dia ${esc(fmtDate(e.data, "short"))}` : "entra junto com o 2º";
    return `<button class="item" data-act="edit-entrada" data-row="${e.row}">
      <span class="ico" style="--ic:#2f9e44"><svg><use href="#i-in"/></svg></span>
      <span class="item-main"><span class="item-t">${esc(nome)}</span><span class="item-s">${sub}</span></span>
      <span class="item-v pos">${brl(e.valor)}</span></button>`;
  }).join("");
  const livreOutro = m.entradas.some(e => !e.principal && !e.nome && e.valor === "");
  const fix = m.fixas.filter(f => f.nome || f.valor !== "").sort((a, b) => num(a.dia) - num(b.dia)).map(f => `<button class="item ${f.saide === "NO CARTÃO" ? "dim" : ""}" data-act="edit-fixa" data-row="${f.row}">
      ${icoBubble(f.nome)}
      <span class="item-main"><span class="item-t">${esc(f.nome)}</span><span class="item-s">dia ${esc(f.dia)} · ${saideChip(f.saide)}${f.onde ? ` · ${esc(f.onde)}` : ""}</span></span>
      <span class="item-v">${brl(f.valor)}</span></button>`).join("");
  const neg = num(m.sobraFinal) < 0;
  return `${secHead("Dinheiro que entrou", `total ${brl(m.totalEntrou)}`, "#2f9e44")}
    <div class="list">${ent}</div>
    ${livreOutro ? `<button class="btn ghost" data-act="nova-entrada"><svg><use href="#i-plus"/></svg>Outro valor (ex.: saldo do Inter)</button>` : ""}
    ${secHead("Contas fixas", `total ${brl(m.totalFixas)} · sem as que vêm no cartão`, "#f59f00")}
    <div class="list">${fix || `<div class="empty">Nenhuma conta.</div>`}</div>
    <button class="btn ghost" data-act="nova-fixa"><svg><use href="#i-plus"/></svg>Nova conta</button>
    ${secHead("Resultado do mês", "", "#2f9e44")}
    <div class="result">
      <div><span>Sobra do 1º dinheiro</span><b>${brl(m.sobra1)}</b><small>passa para o 2º</small></div>
      <div class="${neg ? "neg" : "pos"}"><span>${neg ? "Falta no fim do mês" : "Sobra final do mês"}</span><b>${brl(m.sobraFinal)}</b></div>
      <div class="yel"><span>Livre p/ gastar no cartão</span><b>${brl(m.previsto)}</b><small>previsto no começo do mês</small></div>
    </div>`;
}

function viewMais() {
  const m = S.m, c = m.carlos;
  const ex = c.extras.filter(x => x.nome || x.valor !== "").map(x => `<button class="item" data-act="edit-carlos" data-row="${x.row}">
      ${icoBubble(x.nome)}<span class="item-main"><span class="item-t">${esc(x.nome)}</span></span><span class="item-v">${brl(x.valor)}</span></button>`).join("");
  const pqRows = m.porquinho.filter(p => p.data !== "" || p.inter !== "" || p.mp !== "");
  const ult = pqRows[pqRows.length - 1];
  const pq = [...pqRows].reverse().map(p => `<button class="item" data-act="edit-porquinho" data-row="${p.row}">
      <span class="ico" style="--ic:#e64980"><svg><use href="#i-piggy"/></svg></span>
      <span class="item-main"><span class="item-t">${p.data !== "" ? esc(fmtDate(p.data)) : "sem data"}</span><span class="item-s">Inter ${brl(p.inter)} · Merc. Pago ${brl(p.mp)}${p.obs ? ` · ${esc(p.obs)}` : ""}</span></span>
      <span class="item-v">${brl(p.total)}${p.dif !== "" ? `<small class="${num(p.dif) < 0 ? "neg" : "pos"}">${num(p.dif) >= 0 ? "▲ " : "▼ "}${brl(Math.abs(num(p.dif)))}</small>` : ""}</span></button>`).join("");
  const email = store.get("email");
  const difOk = Math.abs(num(c.dif)) < 0.01;
  return `${secHead("Carlos", esc(m.cur ? titleCase(m.cur.nome) : m.mes), "#2f9e44")}
    <div class="carlos"><span>Total do Carlos</span><b>${brl(c.total)}</b>
      <small class="${difOk ? "pos" : "neg"}">${difOk ? "bate com o que entrou" : `diferença de ${brl(c.dif)} para o que entrou (${brl(c.entrou)})`}</small></div>
    <div class="list">
      <button class="item" data-act="edit-carlos-mensal"><span class="ico" style="--ic:#2f9e44"><svg><use href="#i-in"/></svg></span><span class="item-main"><span class="item-t">Mensal</span></span><span class="item-v">${brl(c.mensal)}</span></button>
      ${ex}
      <div class="item">${miniCard("NUBANK")}<span class="item-main"><span class="item-t">Nubank do Carlos</span><span class="item-s">vem sozinho da lista do Nubank</span></span><span class="item-v">${brl(c.nubank)}</span></div>
    </div>
    <button class="btn ghost" data-act="novo-carlos"><svg><use href="#i-plus"/></svg>Novo valor do Carlos</button>

    ${secHead("Porquinho", ult ? `último saldo: ${brl(ult.total)}` : "quanto tem investido", "#e64980")}
    <div class="list">${pq || `<div class="empty">Nada anotado.</div>`}</div>
    <button class="btn ghost" data-act="novo-porquinho"><svg><use href="#i-plus"/></svg>Anotar saldo de hoje</button>

    ${secHead("Fim do mês", "", "#5c7cfa")}
    <div class="endmonth">
      <span class="ico" style="--ic:#5c7cfa"><svg><use href="#i-calendar"/></svg></span>
      <p>Quando tudo do mês estiver pago: guarda o mês em ANTERIORES, tira as compras que já acabaram e passa para o mês seguinte.</p>
      <button class="btn" data-act="fechar">Fechar ${esc(m.cur ? titleCase(m.cur.nome) : "o mês")}</button>
    </div>

    ${secHead("Planilha e conta", email ? esc(email) : "", "#868e96")}
    <a class="btn ghost" href="https://docs.google.com/spreadsheets/d/${esc(CFG.SPREADSHEET_ID)}/edit" target="_blank" rel="noopener">Abrir a planilha no Google</a>
    <button class="btn ghost" data-act="logout">Sair da conta</button>
    <p class="ver">Casa · versão ${esc(APP_VERSION)}</p>`;
}
const APP_VERSION = "5";

/* ======================= folhas (formulários) ======================= */
function openSheet(title, body, onMount) {
  const root = $("#sheet-root");
  root.innerHTML = `<div class="scrim"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="grab"></div><div class="sheet-h"><h3>${esc(title)}</h3><button class="x" aria-label="Fechar"><svg><use href="#i-x"/></svg></button></div>${body}</div>`;
  requestAnimationFrame(() => root.classList.add("open"));
  const close = () => { root.classList.remove("open"); setTimeout(() => { if (!root.classList.contains("open")) root.innerHTML = ""; }, 260); };
  $(".scrim", root).onclick = close; $(".x", root).onclick = close;
  if (onMount) onMount($(".sheet", root), close);
  return close;
}
function confirmSheet(title, text, okLabel, danger) {
  return new Promise(res => {
    let done = false;
    const close = openSheet(title, `<p style="font-size:1.05rem;margin:4px 0 16px">${text}</p>
      <div class="stack"><button class="btn ${danger ? "danger" : ""}" data-ok>${esc(okLabel)}</button><button class="btn ghost" data-no>Cancelar</button></div>`, (el) => {
      $("[data-ok]", el).onclick = () => { done = true; close(); res(true); };
      $("[data-no]", el).onclick = () => { done = true; close(); res(false); };
      $(".scrim", el.parentNode).addEventListener("click", () => { if (!done) res(false); });
      $(".x", el).addEventListener("click", () => { if (!done) res(false); });
    });
  });
}
const choiceBtns = (name, opts, cur) => opts.map(([v, l]) => `<button type="button" class="choice ${String(v) === String(cur) ? "on" : ""}" data-${name}="${esc(v)}">${esc(l)}</button>`).join("");
function bindChoices(el, name, onPick) {
  $$(`[data-${name}]`, el).forEach(b => b.onclick = () => {
    $$(`[data-${name}]`, el).forEach(x => x.classList.toggle("on", x === b)); onPick(b.dataset[name]);
  });
}
function monthOptions(sel) {
  const cur = S.m.cur ? S.m.cur.idx : 0;
  return S.m.months.filter(x => x.idx >= cur - 24 && x.idx <= cur + 14).map(x => `<option value="${esc(x.label)}" ${x.label === sel ? "selected" : ""}>${esc(x.nome)}</option>`).join("");
}

// Lançar ou editar uma compra
function compraSheet({ cardNome, item }) {
  const m = S.m;
  const listas = m.listas.filter(l => m.cartoes.some(c => c.nome === l.card));
  let lista = item ? m.listas.find(l => l.itens.some(i => i.row === item.row)) : (cardNome ? listas.find(l => l.card === cardNome && !/CARLOS/.test(l.nome)) || listas.find(l => l.card === cardNome) : null);
  let tipo = item ? (item.parc === "FIXO" ? "fixo" : num(Number(item.parc)) > 1 ? "parc" : "vista") : "vista";
  let nParc = item && num(Number(item.parc)) > 1 ? Number(item.parc) : 2;
  let dataSerial = item && typeof item.data === "number" ? item.data : todaySerial();
  let fat = item ? item.fat : "";
  let fatManual = !!item;

  const cardOf = () => (lista ? m.cartoes.find(c => c.nome === lista.card) : null);
  const autoFat = () => { const c = cardOf(); const x = c ? faturaPara(c, dataSerial) : null; return x ? x.label : ""; };
  if (!item && lista) fat = autoFat();

  const pick = listas.map(l => { const b = brand(l.card); return `<button type="button" data-lista="${esc(l.nome)}" class="${lista && lista.nome === l.nome ? "on" : ""}" style="background:${b.bg};color:${b.fg}">${esc(l.label)}</button>`; }).join("");
  const body = `
    <div class="field"><span>Cartão</span><div class="cardpick">${pick}</div></div>
    <label class="field"><span>O que comprou</span><input class="input" id="f-nome" autocomplete="off" autocapitalize="characters" value="${esc(item ? item.nome : "")}" placeholder="ex.: MERCADO"></label>
    <div class="field"><span>Como pagou</span><div class="choices">${choiceBtns("tipo", [["vista", "À vista"], ["parc", "Parcelado"], ["fixo", "Todo mês"]], tipo)}</div></div>
    <div class="field" id="parc-box"><span>Quantas parcelas</span>
      <div class="stepper"><button type="button" data-step="-1">−</button><div class="num" id="f-n">${nParc}</div><button type="button" data-step="1">+</button></div></div>
    <label class="field"><span id="lbl-valor">Valor</span><input class="input money" id="f-valor" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(item ? moneyInput(item.valor) : "")}">
      <small id="f-total"></small></label>
    <label class="field"><span>Data da compra</span><input class="input" type="date" id="f-data" value="${esc(serialToIso(dataSerial))}"></label>
    <div class="field"><span>Entra na fatura de</span>
      <div class="tip" id="f-best"></div>
      <div class="choices" id="f-fat-opts"></div>
      <button type="button" class="linkbtn" id="f-fat-mudar">Escolher outro mês</button>
      <select class="input" id="f-fat-sel" hidden>${monthOptions(fat)}</select></div>
    <div class="stack"><button class="btn" id="f-ok">${item ? "Salvar alteração" : "Salvar compra"}</button>
      ${item ? `<button class="btn danger" id="f-del">Apagar esta compra</button>` : ""}</div>`;

  openSheet(item ? "Editar compra" : "Nova compra", body, (el, close) => {
    const upd = () => {
      $("#parc-box", el).hidden = tipo !== "parc";
      $("#f-n", el).textContent = nParc;
      $("#lbl-valor", el).textContent = tipo === "parc" ? "Valor de CADA parcela" : tipo === "fixo" ? "Valor por mês" : "Valor";
      const v = parseMoney($("#f-valor", el).value);
      $("#f-total", el).textContent = tipo === "parc" && v ? `Total da compra: ${brl(v * nParc)} (${nParc}× ${brl(v)})` : "";
      const c = cardOf(), auto = monthByLabel(autoFat());
      $("#f-best", el).innerHTML = c && auto
        ? `<b>Melhor dia de compra do ${esc(titleCase(c.nome))}: dia ${c.melhor}.</b> Comprando em ${esc(fmtDate(dataSerial, "short"))}, a compra cai na fatura de <b>${esc(titleCase(auto.nome).split(" ")[0].toLowerCase())}</b>. Se o banco colocou em outra, é só tocar no mês certo.`
        : "Escolha o cartão lá em cima.";
      const opts = auto ? [-1, 0, 1].map(d => monthByIdx(auto.idx + d)).filter(Boolean) : [];
      $("#f-fat-opts", el).innerHTML = opts.map(o => `<button type="button" class="choice month ${o.label === fat ? "on" : ""}" data-fat="${esc(o.label)}">${esc(titleCase(o.nome).split(" ")[0])}<small>${o.label === auto.label ? "calculado" : esc(o.nome.split(" ")[1] || "")}</small></button>`).join("");
      $$("[data-fat]", el).forEach(b => b.onclick = () => { fat = b.dataset.fat; fatManual = fat !== auto.label; upd(); });
      const fora = fat && !opts.some(o => o.label === fat);
      $("#f-fat-sel", el).hidden = !fora && $("#f-fat-sel", el).dataset.open !== "1";
      $("#f-fat-sel", el).value = fat;
    };
    $$("[data-lista]", el).forEach(b => b.onclick = () => {
      lista = m.listas.find(l => l.nome === b.dataset.lista);
      $$("[data-lista]", el).forEach(x => x.classList.toggle("on", x === b));
      if (!fatManual) fat = autoFat();
      upd();
    });
    bindChoices(el, "tipo", t => { tipo = t; upd(); });
    $$("[data-step]", el).forEach(b => b.onclick = () => { nParc = Math.min(48, Math.max(2, nParc + Number(b.dataset.step))); upd(); });
    $("#f-valor", el).oninput = upd;
    $("#f-data", el).onchange = e => { const s = isoToSerial(e.target.value); if (s) { dataSerial = s; if (!fatManual) fat = autoFat(); upd(); } };
    $("#f-fat-mudar", el).onclick = () => { const sel = $("#f-fat-sel", el); sel.dataset.open = "1"; sel.hidden = false; sel.focus(); };
    $("#f-fat-sel", el).onchange = e => { fat = e.target.value; fatManual = true; upd(); };
    upd();
    $("#f-ok", el).onclick = async () => {
      const nome = $("#f-nome", el).value.trim().toUpperCase();
      const valor = parseMoney($("#f-valor", el).value);
      if (!lista) return toast("Escolha o cartão.", true);
      if (!nome) return toast("Escreva o que comprou.", true);
      if (!valor || valor <= 0) return toast("Digite o valor, por exemplo 49,90.", true);
      if (!fat) return toast("Escolha em qual fatura entra.", true);
      const parc = tipo === "fixo" ? "FIXO" : tipo === "parc" ? nParc : "";
      const args = { lista: lista.nome, nome, valor, data: dataSerial, parc, fat };
      close();
      if (item && lista.itens.some(i => i.row === item.row)) await run("editCompra", { ...args, row: item.row, antes: item.nome });
      else if (item) { // trocou de cartão: lança no novo e apaga do antigo
        if (await run("addCompra", args)) await run("delCompra", { row: item.row, antes: item.nome });
      } else await run("addCompra", args);
    };
    if (item) $("#f-del", el).onclick = async () => {
      close();
      if (await confirmSheet("Apagar compra?", `<b>${esc(item.nome)}</b> – ${brl(item.valor)}<br>Ela sai da lista e da fatura.`, "Apagar", true))
        run("delCompra", { row: item.row, antes: item.nome });
    };
    if (!item) setTimeout(() => (lista ? $("#f-nome", el) : null)?.focus(), 300);
  });
}

function fixaSheet(f) {
  let saide = f ? f.saide : "1º DINHEIRO";
  openSheet(f ? "Conta fixa" : "Nova conta", `
    <label class="field"><span>Nome da conta</span><input class="input" id="f-nome" autocapitalize="characters" value="${esc(f ? f.nome : "")}" placeholder="ex.: LUZ"></label>
    <label class="field"><span>Valor</span><input class="input money" id="f-valor" inputmode="decimal" placeholder="0,00" value="${esc(f ? moneyInput(f.valor) : "")}"></label>
    <label class="field"><span>Dia de vencimento</span><input class="input" id="f-dia" inputmode="numeric" value="${esc(f ? f.dia : "")}" placeholder="ex.: 10"></label>
    <div class="field"><span>Paga com</span><div class="choices">${choiceBtns("saide", [["1º DINHEIRO", "1º dinheiro"], ["2º DINHEIRO", "2º dinheiro"], ["NO CARTÃO", "No cartão"]], saide)}</div>
      <small>“No cartão” = já vem na fatura de um cartão, não soma de novo.</small></div>
    <label class="field"><span>Onde pagar</span><input class="input" id="f-onde" value="${esc(f ? f.onde : "")}" placeholder="ex.: Aplicativo, PIX, boleto"></label>
    <div class="stack"><button class="btn" id="f-ok">Salvar</button>${f ? `<button class="btn danger" id="f-del">Apagar esta conta</button>` : ""}</div>`, (el, close) => {
    bindChoices(el, "saide", v => saide = v);
    $("#f-ok", el).onclick = () => {
      const nome = $("#f-nome", el).value.trim().toUpperCase(), valor = parseMoney($("#f-valor", el).value);
      const dia = parseInt($("#f-dia", el).value, 10);
      if (!nome) return toast("Escreva o nome da conta.", true);
      if (valor === null) return toast("Digite o valor.", true);
      if (!(dia >= 1 && dia <= 31)) return toast("O dia tem que ser de 1 a 31.", true);
      close();
      run("saveFixa", { row: f ? f.row : null, antes: f ? f.nome : "", nome, dia, valor, saide, onde: $("#f-onde", el).value.trim() });
    };
    if (f) $("#f-del", el).onclick = async () => {
      close();
      if (await confirmSheet("Apagar conta?", `<b>${esc(f.nome)}</b> sai das contas fixas.`, "Apagar", true)) run("delFixa", { row: f.row, antes: f.nome });
    };
  });
}

function valorSheet(title, { nome, valor, nomeEditavel, onSave, onDel }) {
  openSheet(title, `
    ${nomeEditavel ? `<label class="field"><span>Nome</span><input class="input" id="f-nome" autocapitalize="characters" value="${esc(nome || "")}"></label>` : ""}
    <label class="field"><span>Valor</span><input class="input money" id="f-valor" inputmode="decimal" placeholder="0,00" value="${esc(moneyInput(valor))}"></label>
    <div class="stack"><button class="btn" id="f-ok">Salvar</button>${onDel ? `<button class="btn danger" id="f-del">Apagar</button>` : ""}</div>`, (el, close) => {
    $("#f-ok", el).onclick = () => {
      const v = parseMoney($("#f-valor", el).value), n = nomeEditavel ? $("#f-nome", el).value.trim().toUpperCase() : nome;
      if (nomeEditavel && !n) return toast("Escreva o nome.", true);
      if (v === null) return toast("Digite o valor.", true);
      close(); onSave(n, v);
    };
    if (onDel) $("#f-del", el).onclick = async () => { close(); if (await confirmSheet("Apagar?", `<b>${esc(nome)}</b>`, "Apagar", true)) onDel(); };
    setTimeout(() => $("#f-valor", el).focus(), 300);
  });
}

function cartaoSheet(c) {
  openSheet(titleCase(c.nome), `
    <label class="field"><span>Melhor dia de compra (este mês)</span><input class="input" id="f-melhor" inputmode="numeric" value="${esc(c.melhor)}"></label>
    <label class="field"><span>Dia de vencimento (regra)</span><input class="input" id="f-dia" inputmode="numeric" value="${esc(c.dia)}"></label>
    <label class="field"><span>O banco mudou o vencimento deste mês?</span><input class="input" type="date" id="f-aj" value="${esc(typeof c.ajuste === "number" ? serialToIso(c.ajuste) : "")}">
      <small>Deixe vazio para a planilha calcular sozinha (pula fim de semana e feriado). Agora: ${esc(fmtDate(c.venc, "dow"))}.</small></label>
    <div class="stack"><button class="btn" id="f-ok">Salvar</button>${typeof c.ajuste === "number" ? `<button class="btn ghost" id="f-limpa">Voltar ao vencimento automático</button>` : ""}</div>`, (el, close) => {
    const save = aj => {
      const melhor = parseInt($("#f-melhor", el).value, 10), dia = parseInt($("#f-dia", el).value, 10);
      if (!(melhor >= 1 && melhor <= 31) || !(dia >= 1 && dia <= 31)) return toast("Os dias têm que ser de 1 a 31.", true);
      close(); run("saveCartao", { row: c.row, dia, melhor, ajuste: aj });
    };
    $("#f-ok", el).onclick = () => save(isoToSerial($("#f-aj", el).value));
    const l = $("#f-limpa", el); if (l) l.onclick = () => save(null);
  });
}

function porquinhoSheet(p) {
  openSheet(p ? "Porquinho" : "Anotar saldo", `
    <label class="field"><span>Data</span><input class="input" type="date" id="f-data" value="${esc(p && typeof p.data === "number" ? serialToIso(p.data) : serialToIso(todaySerial()))}"></label>
    <label class="field"><span>Inter</span><input class="input money" id="f-inter" inputmode="decimal" placeholder="0,00" value="${esc(p ? moneyInput(p.inter) : "")}"></label>
    <label class="field"><span>Mercado Pago</span><input class="input money" id="f-mp" inputmode="decimal" placeholder="0,00" value="${esc(p ? moneyInput(p.mp) : "")}"></label>
    <label class="field"><span>Observação</span><input class="input" id="f-obs" value="${esc(p ? p.obs : "")}"></label>
    <div class="stack"><button class="btn" id="f-ok">Salvar</button>${p ? `<button class="btn danger" id="f-del">Apagar esta linha</button>` : ""}</div>`, (el, close) => {
    $("#f-ok", el).onclick = () => {
      const inter = parseMoney($("#f-inter", el).value), mp = parseMoney($("#f-mp", el).value);
      if (inter === null && mp === null) return toast("Digite pelo menos um valor.", true);
      close();
      run("savePorquinho", { row: p ? p.row : null, data: isoToSerial($("#f-data", el).value) ?? "", inter: inter ?? "", mp: mp ?? "", obs: $("#f-obs", el).value.trim() });
    };
    if (p) $("#f-del", el).onclick = async () => { close(); if (await confirmSheet("Apagar linha?", "Essa anotação do Porquinho será apagada.", "Apagar", true)) run("delPorquinho", { row: p.row }); };
  });
}

/* ======================= cliques ======================= */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const m = S.m, act = t.dataset.act, row = Number(t.dataset.row);
  switch (act) {
    case "login": return googleLogin("pick");
    case "refresh": return refresh();
    case "tab": S.tab = t.dataset.tab; render(); return scrollTo({ top: 0 });
    case "open-card": S.card = t.dataset.card; S.tab = "cartao"; render(); return scrollTo({ top: 0 });
    case "nova-compra": return compraSheet({ cardNome: t.dataset.card });
    case "edit-compra": { for (const l of m.listas) { const it = l.itens.find(i => i.row === row); if (it) return compraSheet({ item: it }); } return; }
    case "edit-cartao": { const c = m.cartoes.find(x => x.nome === t.dataset.card); if (c) cartaoSheet(c); return; }
    case "edit-fixa": return fixaSheet(m.fixas.find(f => f.row === row));
    case "nova-fixa": return fixaSheet(null);
    case "edit-entrada": {
      const en = m.entradas.find(x => x.row === row);
      return valorSheet(en.principal ? (row - m.ranges.rEnt === 1 ? "1º dinheiro" : "2º dinheiro") : "Outro valor", {
        nome: en.nome, valor: en.valor, nomeEditavel: !en.principal,
        onSave: (n, v) => run("saveEntrada", { row, nome: n, valor: v, principal: en.principal }),
        onDel: en.principal ? null : () => run("saveEntrada", { row, nome: "", valor: "", principal: false }),
      });
    }
    case "nova-entrada": {
      const en = m.entradas.find(x => !x.principal && !x.nome && x.valor === "");
      if (en) valorSheet("Outro valor", { nome: "", valor: "", nomeEditavel: true, onSave: (n, v) => run("saveEntrada", { row: en.row, nome: n, valor: v, principal: false }) });
      return;
    }
    case "edit-carlos-mensal": return valorSheet("Mensal do Carlos", { nome: "MENSAL", valor: m.carlos.mensal, onSave: (n, v) => run("saveCarlos", { row: m.carlos.mensalRow, valor: v, mensal: true }) });
    case "edit-carlos": {
      const x = m.carlos.extras.find(i => i.row === row);
      return valorSheet("Valor do Carlos", { nome: x.nome, valor: x.valor, nomeEditavel: true,
        onSave: (n, v) => run("saveCarlos", { row, antes: x.nome, nome: n, valor: v }),
        onDel: () => run("delCarlos", { row, antes: x.nome }) });
    }
    case "novo-carlos": return valorSheet("Novo valor do Carlos", { nome: "", valor: "", nomeEditavel: true, onSave: (n, v) => run("saveCarlos", { row: null, nome: n, valor: v }) });
    case "edit-porquinho": return porquinhoSheet(m.porquinho.find(p => p.row === row));
    case "novo-porquinho": return porquinhoSheet(null);
    case "fechar": {
      const prox = m.cur ? monthByIdx(m.cur.idx + 1) : null;
      if (await confirmSheet("Fechar o mês?", `O mês de <b>${esc(m.cur ? titleCase(m.cur.nome) : m.mes)}</b> vai ser guardado em ANTERIORES, as compras que já acabaram saem das listas e a planilha passa para <b>${esc(prox ? titleCase(prox.nome) : "o mês seguinte")}</b>.<br><br>Faça isso só quando tudo do mês estiver pago.`, "Sim, fechar o mês"))
        run("fecharMes", {}, { busyText: "Fechando o mês…" });
      return;
    }
    case "logout": {
      if (!(await confirmSheet("Sair da conta?", "Para usar de novo, é só entrar com o Google.", "Sair"))) return;
      const tok = Token.get();
      if (tok) { try { await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(tok), { method: "POST" }); } catch (_) {} }
      Token.clear(); store.del("cache"); store.del("email"); S.m = null; S.tab = "inicio"; renderBanner(); render(); return;
    }
  }
});
$$(".tabs button").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; render(); scrollTo({ top: 0 }); });
$("#fab").onclick = () => S.m && compraSheet({ cardNome: S.tab === "cartao" ? S.card : null });
const mudaMes = async d => {
  const x = S.m && S.m.cur ? monthByIdx(S.m.cur.idx + d) : null;
  if (!x) return;
  if (!store.get("avisoMes")) {
    const ok = await confirmSheet("Trocar o mês?", `A planilha vai mostrar <b>${esc(x.nome)}</b>. Isso muda o mês da planilha para todo mundo que usa. Para voltar, é só tocar na outra seta.`, "Trocar o mês");
    if (!ok) return; store.set("avisoMes", true);
  }
  run("setMes", { label: x.label }, { busyText: "Trocando o mês…" });
};
$("#mes-prev").onclick = () => mudaMes(-1);
$("#mes-next").onclick = () => mudaMes(1);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.m && Date.now() - (S.at || 0) > 60000) refresh({ quiet: true }); });

/* ======================= modo de teste (só no computador) ======================= */
const Demo = {
  g: null,
  async api(path, opts) {
    if (!this.g) this.g = await (await fetch("demo-grid.json")).json();
    if (path.startsWith("/values:batchGet")) return { valueRanges: [{ values: this.g.main }, { values: this.g.helper }, { values: this.g.tab }] };
    const put = (range, values) => {
      const mm = /^(\w+)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range); if (!mm || mm[1] !== "CASA") return;
      const c0 = mm[2].charCodeAt(0) - 64, r0 = Number(mm[3]);
      values.forEach((row, i) => row.forEach((val, j) => { const R = this.g.main[r0 - 1 + i] || (this.g.main[r0 - 1 + i] = []); R[c0 - 1 + j] = val; }));
    };
    if (path.startsWith("/values:batchUpdate")) { JSON.parse(opts.body).data.forEach(d => put(d.range, d.values)); return {}; }
    if (path.startsWith("/values:batchClear")) {
      JSON.parse(opts.body).ranges.forEach(r => { const mm = /!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?/.exec(r); const a = mm[1].charCodeAt(0), b = (mm[3] || mm[1]).charCodeAt(0); put(r.split(":")[0], [Array.from({ length: b - a + 1 }, () => "")]); });
      return {};
    }
    if (path.startsWith("/values/")) {
      const range = decodeURIComponent(path.slice(8).split("?")[0]);
      const mm = /!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?/.exec(range);
      const c0 = mm[1].charCodeAt(0) - 65, c1 = (mm[3] || mm[1]).charCodeAt(0) - 65, r0 = Number(mm[2]), r1 = Number(mm[4] || mm[2]);
      const values = []; for (let r = r0; r <= r1; r++) values.push((this.g.main[r - 1] || []).slice(c0, c1 + 1));
      return { values };
    }
    if (path.startsWith("?fields") || path.startsWith(":batchUpdate")) throw new Error("No modo de teste não dá para fechar o mês.");
    return {};
  },
};

/* ======================= início ======================= */
(async () => {
  const oauth = handleOAuthReturn();
  // login venceu (dura ~1 h): renova sozinho antes de mostrar qualquer botão
  if (!DEMO && !oauth && !Token.get() && canSilent()) { googleLogin(true); return; }
  const cache = store.get("cache");
  if (cache && cache.g) { try { S.m = parse(cache.g); S.at = cache.at; } catch (e) {} }
  renderBanner(); render();
  if (oauth && oauth !== "ok" && oauth !== "silent-fail") toast(oauth, true);
  if (oauth === "ok") await fetchEmail();
  if (DEMO || Token.get()) {
    await refresh({ quiet: !!S.m });
    const p = store.get("pending");
    if (p && OPS[p.op] && S.m) { store.del("pending"); run(p.op, p.args); }
  }
})();

if ("serviceWorker" in navigator && !DEMO) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").then(reg => {
    // versão nova publicada → recarrega sozinho quando o app abrir de novo
    reg.addEventListener("updatefound", () => {});
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {}));
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) location.reload(); hadController = true; });
}
