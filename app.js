"use strict";
/* Casa — app de celular ligado à planilha "CASA 2026" no Google.
   A planilha é a fonte de tudo: o app lê os valores já calculados pelas fórmulas
   e só grava nas células de digitar (fundo branco). Ver AGENTS.md. */

const CFG = window.CASA_CONFIG || {};
const SCOPES = "openid email https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets/";
// ?demo = modo de teste com dados inventados (demo-ficticio.json); no computador usa demo-grid.json se existir.
// Nada vai para o Google e tudo fica guardado separado do app de verdade (casa-demo.*).
const DEMO = new URLSearchParams(location.search).has("demo");
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = v => (typeof v === "number" && isFinite(v) ? v : 0);
const brl = v => num(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const PREFIX = DEMO ? "casa-demo." : "casa.";
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(PREFIX + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(PREFIX + k); } catch (e) {} },
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
// [nome, cor da planilha, fim do degradê, letra, começo do degradê (se não for a cor da planilha)]
// A letra é a que passa de 4,5:1 no cartão inteiro (WCAG AA): escura nas cores claras, branca nas escuras.
// O fim do degradê foi clareado até a letra escura passar; a Renner começa num vermelho mais fechado
// para a letra branca passar (o vermelho da planilha segue nas barras e títulos).
const INK = "#1b1f1d";
const BRANDS = [
  [/SAMS/, "#6FA8DC", "#4e8bc8", INK], [/CARREFOUR/, "#19D3F0", "#0392ba", INK], [/PICPAY/, "#22D36B", "#0e9b4b", INK],
  [/AMAZON/, "#A3A9B1", "#818791", INK], [/ITI/, "#FF4FD2", "#eb35c0", INK], [/NUBANK/, "#A23CFF", "#5f00b8", "#fff"],
  [/MERCADO PAGO/, "#3a3a3a", "#000000", "#fff"], [/INTER/, "#FF9A1F", "#e85d00", INK], [/RENNER/, "#FF3B3B", "#a30000", "#fff", "#d42b2b"],
];
function brand(name) {
  const n = String(name || "").toUpperCase();
  const [, c1, c2, fg, g1] = BRANDS.find(([re]) => re.test(n)) || [, "#8fa39b", "#778b83", INK];
  const claro = fg !== "#fff", start = g1 || c1;
  return {
    c1, start, c2, fg, bg: `linear-gradient(135deg, ${start}, ${c2})`,
    // letra branca: sombra leve e sem brilho branco atrás; letra escura: brilho ajuda e sombra atrapalha
    sh: claro ? "none" : "0 1px 2px rgba(0,0,0,.25)", shine: claro ? ".3" : "0", pill: claro ? "rgba(255,255,255,.45)" : "rgba(0,0,0,.25)",
  };
}
// Para comparar textos da planilha: sem acento, espaços juntados, tudo maiúsculo ("  Cartões " = "CARTOES").
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
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
  // o último mês fechado fica no topo de ANTERIORES: dá o "mês passado" das contas fixas (se falhar, segue sem)
  const [j, prev, fixMes, pag] = await Promise.all([
    api(`/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`),
    readRange("ANTERIORES!A1:C220").catch(() => []),
    lerFixMes().catch(() => []),
    lerPag().catch(() => []),
  ]);
  const [main, helper, tab] = j.valueRanges.map(v => v.values || []);
  return { main, helper, tab, prev, fixMes, pag };
}

// Acha cada bloco da aba CASA pelos títulos da coluna A (assim o app continua
// funcionando mesmo se alguém inserir linhas na planilha).
function parse(g) {
  const v = (r, c) => { const row = g.main[r - 1]; const x = row ? row[c - 1] : undefined; return x === undefined || x === null ? "" : x; };
  const h = (r, c) => { const row = g.helper[r - 1]; const x = row ? row[c] : undefined; return x === undefined || x === null ? "" : x; };
  const n = g.main.length;
  const A = r => String(v(r, 1)).trim();
  // Os títulos são comparados sem acento, sem espaço sobrando e sem diferença de maiúscula
  // ("  Cartões " acha "CARTÕES"). titulo() = título exato; comeca() = começo do título.
  const find = (test, from = 1) => { for (let r = from; r <= n; r++) if (test(norm(v(r, 1)))) return r; return -1; };
  const titulo = t => x => x === norm(t), comeca = t => x => x.startsWith(norm(t));
  const need = (r, what) => { if (r < 0) throw new Error("A planilha mudou e o app não achou: " + what); return r; };
  // valores digitados na planilha que o app compara: voltam para a grafia que o app usa
  const SAIDE = ["1º DINHEIRO", "2º DINHEIRO", "NO CARTÃO"];
  const saideOf = x => SAIDE.find(k => norm(k) === norm(x)) || String(x).trim();
  const parcOf = x => (norm(x) === "FIXO" ? "FIXO" : x);

  const months = g.tab.filter(r => r[0]).map(r => ({ label: String(r[0]), serial: r[1], idx: Number(r[2]), nome: String(r[3] || "") }));
  const m = { months, mes: String(v(2, 2)).trim() };
  m.cur = months.find(x => norm(x.label) === norm(m.mes)) || null;

  // entradas
  const rEnt = need(find(titulo("ENTRADAS")), "ENTRADAS");
  const rTotEnt = need(find(comeca("TOTAL QUE ENTROU"), rEnt), "TOTAL QUE ENTROU");
  m.entradas = [];
  // "CARLOS" = dinheiro que o Carlos mandou no meio do mês (data na coluna B); sai no fechamento
  for (let r = rEnt + 1; r < rTotEnt; r++) m.entradas.push({ row: r, nome: A(r), data: v(r, 2), valor: v(r, 3), principal: r - rEnt <= 2, carlos: r - rEnt > 2 && norm(A(r)) === "CARLOS" });
  m.totalEntrou = v(rTotEnt, 3);

  // faturas do mês
  const rFat = need(find(titulo("FATURAS DOS CARTÕES")), "FATURAS DOS CARTÕES");
  m.faturas = [];
  for (let r = rFat + 1; /^C\.\s*\S/.test(norm(v(r, 1))); r++)
    m.faturas.push({ row: r, nome: A(r).replace(/^C\.\s*/i, ""), venc: v(r, 2), valor: v(r, 3), previsto: v(r, 4), saide: saideOf(v(r, 5)), onde: String(v(r, 6)) });

  // contas fixas
  const rFix = need(find(titulo("CONTAS FIXAS")), "CONTAS FIXAS");
  const rTotFix = need(find(titulo("TOTAL CONTAS FIXAS"), rFix), "TOTAL CONTAS FIXAS");
  m.fixas = [];
  for (let r = rFix + 1; r < rTotFix; r++)
    m.fixas.push({ row: r, nome: A(r), dia: v(r, 2), valor: v(r, 3), saide: saideOf(v(r, 5)), onde: String(v(r, 6)) });
  m.totalFixas = v(rTotFix, 3);
  // valor de cada conta fixa no último mês fechado (topo de ANTERIORES), pela grafia normalizada do nome
  m.prevFixas = {};
  const P = g.prev || [], pA = i => norm((P[i] || [])[0]);
  const pi = P.findIndex((_, i) => pA(i) === "CONTAS FIXAS");
  if (pi >= 0) for (let i = pi + 1; i < P.length && pA(i) !== "TOTAL CONTAS FIXAS"; i++) { const val = (P[i] || [])[2]; if (pA(i) && typeof val === "number") m.prevFixas[pA(i)] = val; }
  // se o mês anterior tem valores na aba FIXAS POR MÊS, eles valem mais que ANTERIORES
  const antes = m.cur && months.find(x => x.idx === m.cur.idx - 1);
  if (antes) for (const [mes, conta, val] of g.fixMes || []) if (norm(mes) === norm(antes.label) && typeof val === "number") m.prevFixas[norm(conta)] = val;

  // o que já foi pago neste mês (aba PAGAMENTOS): contas fixas (TIPO = CONTA) e faturas (TIPO = FATURA)
  m.pagos = (g.pag || []).filter(x => x[0] && norm(x[0]) === norm(m.mes)).map(x => ({ tipo: norm(x[1]), nome: String(x[2] || ""), data: x[3], valor: x[4], lista: String(x[5] || ""), fat: String(x[6] || "") }));
  const pagoDe = (tipo, nome) => m.pagos.find(x => x.tipo === tipo && norm(x.nome) === norm(nome)) || null;
  for (const f of m.fixas) f.pago = f.nome ? pagoDe("CONTA", f.nome) : null;
  for (const f of m.faturas) f.pago = pagoDe("FATURA", f.nome);

  // resultado
  const rRes = need(find(titulo("RESULTADO DO MÊS")), "RESULTADO DO MÊS");
  m.sobra1 = v(rRes + 1, 3); m.sobraFinal = v(rRes + 2, 3); m.previsto = v(rRes + 3, 3);
  m.alerta = String(v(rRes + 4, 1) || "");

  // Carlos
  const rCH = need(find(titulo("O QUE O CARLOS DÁ")), "bloco do Carlos");
  const rNu = need(find(comeca("NUBANK CARLOS"), rCH), "NUBANK CARLOS");
  m.carlos = { mensalRow: rCH + 1, mensal: v(rCH + 1, 3), extras: [], nubank: v(rNu, 3), total: v(rNu + 1, 3), entrou: v(rNu + 2, 3), dif: v(rNu + 3, 3) };
  // coluna B = "EXTRA": compra extra do mês (lançada pelo app), sai no fechamento; os outros itens são fixos
  for (let r = rCH + 2; r < rNu; r++) m.carlos.extras.push({ row: r, nome: A(r), valor: v(r, 3), extra: norm(v(r, 2)) === "EXTRA" });

  // cartões
  const rCT = need(find(titulo("CARTÕES")), "CARTÕES");
  const rCTt = need(find(titulo("TOTAL DAS FATURAS"), rCT), "TOTAL DAS FATURAS");
  m.cartoes = [];
  for (let r = rCT + 2; r < rCTt; r++)
    m.cartoes.push({ row: r, nome: A(r), final: String(v(r, 2)), dia: num(v(r, 3)), melhor: num(v(r, 4)), venc: v(r, 5), fatura: v(r, 6), hoje: String(v(r, 7)), ajuste: v(r, 8) });

  // total parcelado (próximos 12 meses)
  const rTP = find(comeca("TOTAL PARCELADO"));
  m.proj = { meses: [], linhas: {} }; // linhas: chave = nome do cartão normalizado
  if (rTP > 0) {
    for (let c = 2; c <= 13; c++) m.proj.meses.push(String(v(rTP + 1, c)));
    for (let r = rTP + 2; A(r) && norm(A(r)) !== "TOTAL"; r++) m.proj.linhas[norm(A(r))] = Array.from({ length: 12 }, (_, i) => v(r, i + 2));
  }

  // porquinho
  const rPQ = find(comeca("PORQUINHO"));
  const rLists = find(titulo("COMPRAS DE CADA CARTÃO"));
  m.porquinho = [];
  if (rPQ > 0 && rLists > 0)
    for (let r = rPQ + 2; r < rLists - 1; r++) m.porquinho.push({ row: r, data: v(r, 1), inter: v(r, 2), mp: v(r, 3), total: v(r, 4), dif: v(r, 5), obs: String(v(r, 6)) });

  // listas de compras de cada cartão
  m.listas = [];
  for (let r = 1; r <= n; r++) {
    if (norm(v(r, 1)) !== "COMPRA" || norm(v(r, 2)) !== "VALOR") continue;
    const rT = find(comeca("TOTAL DA FATURA"), r + 1);
    if (rT < 0) break;
    const nome = A(r - 2).replace(/^CART[ÃA]O\s+/i, "").split("•")[0].replace(/\s+/g, " ").trim();
    const itens = [];
    for (let i = r + 1; i < rT; i++)
      itens.push({ row: i, nome: A(i), valor: v(i, 2), data: v(i, 3), parc: parcOf(v(i, 4)), fat: String(v(i, 5)).trim(), sit: String(v(i, 6)), noMes: v(i, 7), ini: h(i, 0), fim: h(i, 1) });
    m.listas.push({ nome, titleRow: r - 2, first: r + 1, last: rT - 1, totalRow: rT, total: v(rT, 7), itens });
    r = rT;
  }
  // liga cada lista ao seu cartão (NUBANK tem duas: a dela e a do Carlos)
  for (const l of m.listas) {
    const ln = norm(l.nome);
    const card = m.cartoes.filter(c => ln.startsWith(norm(c.nome))).sort((a, b) => b.nome.length - a.nome.length)[0];
    l.card = card ? card.nome : l.nome;
    l.label = /CARLOS/.test(ln) ? "Nubank do Carlos" : /\(MEU\)/.test(ln) ? "Nubank (meu)" : titleCase(card && norm(card.nome) === ln ? card.nome : l.nome);
  }
  m.ranges = { rRes, rCH, rNu, rFix, rTotFix, rEnt, rTotEnt, title: need(find(t => /^MES [A-Z]+ \d{4}$/.test(t)), "título do mês"), carlosDif: rNu + 3, rCT, rCTt };
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

// Contas fixas mês a mês (pedido da Rosany): a coluna Valor (C) da CASA mostra só o mês que está na tela.
// O valor de cada mês fica guardado na aba oculta FIXAS POR MÊS (A = mês, B = conta, C = valor).
// Trocar de mês ou fechar o mês: guarda os valores do mês atual lá e põe na coluna C os do mês novo
// (mês que nunca foi lançado começa zerado: em branco, "Lançar").
const FIXTAB = "FIXAS POR MÊS", FIXRANGE = `'${FIXTAB}'!A2:C3000`;
async function lerFixMes() { return readRange(FIXRANGE); }
// para gravar: só aceita "vazio" se a aba ainda não existe (erro de leitura não pode apagar o histórico)
async function lerFixMesSeguro() {
  if (!DEMO) {
    const meta = await api("?fields=sheets.properties(title)");
    if (!meta.sheets.some(s => s.properties.title === FIXTAB)) return [];
  }
  return lerFixMes();
}
async function garanteFixTab() {
  if (DEMO) return;
  const meta = await api("?fields=sheets.properties(title)");
  if (meta.sheets.some(s => s.properties.title === FIXTAB)) return;
  await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: FIXTAB, hidden: true } } }] }) });
  await writeRaw([{ range: `'${FIXTAB}'!A1:C1`, values: [["MÊS", "CONTA", "VALOR"]] }]);
}
// lê de novo, na planilha, o mês da tela e as contas fixas (nome e valor)
async function fixasAgora() {
  const [g, rows] = await Promise.all([readGrid(), lerFixMesSeguro()]), m = parse(g);
  return { m, rows, fixas: doMes(m) };
}
// O 1º e o 2º dinheiro também são de cada mês (pedido de 23/10/2026): guardados na mesma aba FIXAS POR MÊS
// com o nome "ENTRADA 1º DINHEIRO" / "ENTRADA 2º DINHEIRO"; mês novo começa em branco para ela lançar.
const ENTRADA = ["ENTRADA 1º DINHEIRO", "ENTRADA 2º DINHEIRO"];
const entradasDoMes = m => m.entradas.filter(e => e.principal).map(e => ({ row: e.row, nome: ENTRADA[e.row - m.ranges.rEnt - 1], valor: e.valor }));
// tudo o que muda de mês para mês na coluna C: contas fixas + 1º e 2º dinheiro
const doMes = m => m.fixas.filter(f => f.nome).concat(entradasDoMes(m));
// Uma vez só: quando isto foi feito a planilha estava em dez/26 mostrando o 1º e o 2º de nov/26.
// Guarda esses valores como nov/26 e deixa dez/26 em branco (só se ainda não houver nenhuma entrada guardada).
async function migraEntradas() {
  if (DEMO || !S.m || norm(S.m.mes) !== norm("dez/26") || store.get("migrouEntradas")) return;
  const rows = await lerFixMesSeguro();
  if (rows.some(r => ENTRADA.some(k => norm(k) === norm(r[1])))) { store.set("migrouEntradas", 1); return; }
  const ent = entradasDoMes(S.m).filter(e => e.valor !== "");
  if (ent.length) {
    await gravaFixMes(rows.concat(ent.map(e => ["nov/26", e.nome, e.valor])));
    await writeRaw(ent.map(e => ({ range: `CASA!C${e.row}`, values: [[""]] })));
  }
  store.set("migrouEntradas", 1);
  await refresh({ quiet: true });
}
// troca, na lista guardada, os valores do mês `mes` pelos que estão na coluna C agora
function guardaMes(rows, mes, fixas) {
  const outros = rows.filter(r => r[0] !== undefined && r[0] !== "" && norm(r[0]) !== norm(mes));
  return outros.concat(fixas.filter(f => f.valor !== "").map(f => [mes, f.nome, f.valor]));
}
async function gravaFixMes(rows) {
  await garanteFixTab();
  await clearRanges([FIXRANGE]);
  if (rows.length) await writeRaw([{ range: `'${FIXTAB}'!A2:C${rows.length + 1}`, values: rows }]);
}
// valores da coluna C para mostrar o mês `mes` (o que foi guardado dele; o resto em branco)
function valoresDoMes(rows, mes, fixas) {
  return fixas.map(f => {
    const r = rows.find(x => norm(x[0]) === norm(mes) && norm(x[1]) === norm(f.nome));
    return { range: `CASA!C${f.row}`, values: [[r && r[2] !== undefined ? r[2] : ""]] };
  });
}
// depois de salvar/apagar uma conta: atualiza o que está guardado do mês da tela (e o nome, se mudou)
async function sincronizaFixas(antes, nome) {
  const { m, rows, fixas } = await fixasAgora();
  let r = guardaMes(rows, m.mes, fixas);
  if (antes && nome && norm(antes) !== norm(nome)) r = r.map(x => (norm(x[1]) === norm(antes) ? [x[0], nome, x[2]] : x));
  await gravaFixMes(r);
}

// Contas e faturas pagas (pedido da Rosany): aba oculta PAGAMENTOS, uma linha por conta paga em cada mês.
// A = mês (como em B2), B = CONTA ou FATURA, C = nome, D = data em que pagou, E = valor pago,
// F e G = cartão (nome da lista) e fatura em que a conta "no cartão" foi lançada (vazio nas outras).
// O verde do Início = tudo que entrou − o que já foi pago; a planilha CASA não muda.
const PAGTAB = "PAGAMENTOS", PAGRANGE = `'${PAGTAB}'!A2:G3000`;
async function lerPag() { return readRange(PAGRANGE); }
async function existeAba(t) { return DEMO || (await api("?fields=sheets.properties(title)")).sheets.some(s => s.properties.title === t); }
async function gravaPag(rows) {
  if (!(await existeAba(PAGTAB))) {
    await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: PAGTAB, hidden: true } } }] }) });
    await writeRaw([{ range: `'${PAGTAB}'!A1:G1`, values: [["MÊS", "TIPO", "NOME", "PAGOU EM", "VALOR", "CARTÃO", "FATURA"]] }]);
  }
  await clearRanges([PAGRANGE]);
  if (rows.length) await writeRaw([{ range: `'${PAGTAB}'!A2:G${rows.length + 1}`, values: rows }]);
}
// lê de novo (outra pessoa pode ter marcado algo) e troca/tira a linha de `nome` no mês `mes`
async function mudaPag(mes, tipo, nome, linha) {
  const rows = (await existeAba(PAGTAB)) ? await lerPag() : [];
  const ficam = rows.filter(r => r[0] !== undefined && r[0] !== "" && !(norm(r[0]) === norm(mes) && norm(r[1]) === tipo && norm(r[2]) === norm(nome)));
  if (linha) ficam.push([mes, tipo, nome, ...linha]);
  await gravaPag(ficam);
}
// nome da conta sem o "(no Carrefour)" do fim: o cartão agora muda todo mês
const nomeConta = nome => String(nome || "").replace(/\s*\((no [^)]*|m[eê]s anterior)\)\s*$/i, "").trim();
// Conta do mês anterior (ex.: condomínio): ela recebe no fim do mês e paga atrasado a conta que venceu no mês
// anterior. Fica marcada no nome, na planilha: "CONDOMÍNIO (MÊS ANTERIOR)". Na tela de novembro: "Condomínio de outubro".
const SUF_ANT = " (MÊS ANTERIOR)";
const ehAnterior = nome => /\(MES ANTERIOR\)$/.test(norm(nome));
const mesAnt = () => { const x = S.m && S.m.cur && monthByIdx(S.m.cur.idx - 1); return x ? titleCase(x.nome).split(" ")[0].toLowerCase() : "mês passado"; };
const tituloConta = f => nomeConta(f.nome) + (ehAnterior(f.nome) ? ` de ${mesAnt()}` : "");
const casaNome = (a, b) => { const x = norm(nomeConta(a)), y = norm(nomeConta(b)); return !!x && !!y && (x.startsWith(y) || y.startsWith(x)); };

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
    OPS.ultimaLinha = row;
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
  // pago: true = marcar como paga hoje (ou manter a data, se já estava); false = desmarcar; undefined = não mexe
  // (se já estava paga, o valor pago acompanha o valor novo)
  async saveFixa({ row, antes, nome, dia, valor, saide, onde, pago, data }) {
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
    await sincronizaFixas(antes, nome);
    const ja = S.m.fixas.find(x => x.row === row);
    const tinha = ja && ja.pago && !ja.pago.lista && saide !== "NO CARTÃO";
    if (antes && norm(antes) !== norm(nome) && ja && ja.pago) await mudaPag(S.m.mes, "CONTA", antes, null);
    if (pago === false) { await mudaPag(S.m.mes, "CONTA", nome, null); return "Pronto: a conta voltou para “falta pagar”."; }
    if (pago || tinha) await mudaPag(S.m.mes, "CONTA", nome, [tinha ? ja.pago.data : data, valor, "", ""]);
    return pago ? `Paga! ${brl(valor)} saiu do dinheiro disponível.` : "Conta salva.";
  },
  // conta que ela paga no cartão (ex.: Claro): cada mês num cartão diferente. Lança como compra à vista
  // no cartão escolhido (troca a do mês, se já tinha), encerra a compra "todo mês" antiga e marca como lançada.
  async lancaFixaCartao({ row, antes, nome, dia, valor, onde, lista, fat, data }) {
    await OPS.saveFixa({ row, antes, nome, dia, valor, saide: "NO CARTÃO", onde });
    const m = S.m, compra = nomeConta(nome), velho = m.fixas.find(x => x.row === row);
    const msgs = [];
    // a deste mês já estava lançada: apaga de onde estava
    const p = velho && velho.pago;
    if (p && p.lista) {
      const l = m.listas.find(x => x.nome === p.lista), it = l && l.itens.find(i => norm(i.nome) === norm(compra) && i.fat === p.fat && i.parc !== "FIXO");
      if (it) await OPS.delCompra({ row: it.row, antes: it.nome });
    }
    await OPS.addCompra({ lista, nome: compra, valor, data, parc: "", fat });
    // a compra "todo mês" antiga desta conta para antes desta fatura (fica o histórico)
    const novo = monthByLabel(fat);
    for (const l of m.listas) for (const it of l.itens) {
      if (it.parc !== "FIXO" || !casaNome(it.nome, nome) || !novo) continue;
      const ini = monthByLabel(it.fat), n = ini ? novo.idx - ini.idx : 0;
      await sameRow(it.row, it.nome);
      if (n > 0) await writeRaw([{ range: `CASA!D${it.row}`, values: [[n]] }]);
      else await clearRanges([`CASA!A${it.row}:E${it.row}`]);
      msgs.push(`A ${titleCase(it.nome)} “todo mês” do ${l.label} foi encerrada.`);
    }
    await mudaPag(m.mes, "CONTA", nome, [data, valor, lista, fat]);
    const l = m.listas.find(x => x.nome === lista), fm = monthByLabel(fat);
    return [`${titleCase(compra)} lançada no ${l ? l.label : lista}, fatura de ${fm ? titleCase(fm.nome).split(" ")[0].toLowerCase() : fat}.`, ...msgs].join(" ");
  },
  async pagaFatura({ nome, valor, data, pago }) {
    await mudaPag(S.m.mes, "FATURA", nome, pago ? [data, valor, "", ""] : null);
    return pago ? `Fatura paga! ${brl(valor)} saiu do dinheiro disponível.` : "Pronto: a fatura voltou para “falta pagar”.";
  },
  async delFixa({ row, antes }) {
    await sameRow(row, antes);
    await clearRanges([`CASA!A${row}:C${row}`, `CASA!E${row}:F${row}`]);
    await sincronizaFixas();
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
    await clearRanges([`CASA!A${row}:C${row}`]); // B pode ter a marca EXTRA
    return "Item apagado.";
  },
  // compra extra que o Carlos paga (não é cartão): bloco do Carlos com B = "EXTRA"
  async addExtraCarlos({ nome, valor }) {
    const f = S.m.carlos.extras.find(x => !x.nome && x.valor === "");
    if (!f) throw new Error("Não tem linha vazia no bloco do Carlos. Apague um item que não usa mais.");
    await sameRow(f.row, "");
    await writeRaw([{ range: `CASA!A${f.row}:C${f.row}`, values: [[nome, "EXTRA", valor]] }]);
    OPS.ultimaLinha = f.row;
    return "Extra do Carlos anotado.";
  },
  // dinheiro que o Carlos mandou no meio do mês: ENTRADAS, linha "CARLOS" com a data em B
  async saveEnvioCarlos({ row, data, valor }) {
    if (!row) {
      const f = S.m.entradas.find(x => !x.principal && !x.nome && x.valor === "");
      if (!f) throw new Error("Não tem linha livre em ENTRADAS para o dinheiro do Carlos. Peça ao Gabriel para inserir linhas na planilha.");
      row = f.row;
      await sameRow(row, "");
    } else await sameRow(row, "CARLOS");
    await writeRaw([{ range: `CASA!A${row}:C${row}`, values: [["CARLOS", data, valor]] }]);
    OPS.ultimaLinha = row;
    return "Dinheiro do Carlos anotado.";
  },
  async delEnvioCarlos({ row }) {
    await sameRow(row, "CARLOS");
    await clearRanges([`CASA!A${row}:C${row}`]);
    return "Apagado.";
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
    // guarda as contas fixas do mês que sai e mostra as do mês que entra
    const { m, rows, fixas } = await fixasAgora();
    const r = guardaMes(rows, m.mes, fixas);
    await gravaFixMes(r);
    await writeRaw([{ range: "CASA!B2", values: [[label]] }, ...valoresDoMes(r, label, fixas)]);
    return null;
  },
  async fecharMes() { return fecharMes(); },
};

// Executa uma operação. Se o login expirou, guarda a operação e volta a fazê-la depois de entrar de novo.
// Renova o login sozinho, sem toque, no máximo uma tentativa a cada 2 minutos (evita ficar em loop).
const canSilent = () => !!store.get("email") && Date.now() - (store.get("silentTry") || 0) > 120000;
function relogin() { if (canSilent()) googleLogin(true); else googleLogin(); }

// run.erro guarda a última mensagem de erro (a folha mostra ela junto do botão Salvar).
const SEM_NET = "Sem internet agora. Nada foi salvo ainda.";
async function run(op, args, { busyText = "Salvando…", quieto = false } = {}) {
  run.erro = null;
  if (!DEMO && !Token.get()) { store.set("pending", { op, args }); run.erro = "Conectando ao Google…"; toast(run.erro); relogin(); return false; }
  if (!DEMO && navigator.onLine === false) { run.erro = SEM_NET; toast(SEM_NET, true); return false; }
  busy(busyText);
  try {
    const msg = await OPS[op](args);
    store.del("pending");
    await refresh({ quiet: true });
    if (msg && !quieto) toast(msg);
    return true;
  } catch (e) {
    if (e instanceof AuthError) { store.set("pending", { op, args }); relogin(); return false; }
    // erro técnico do navegador (ex.: "Failed to fetch") vira português
    run.erro = e instanceof TypeError ? SEM_NET : (e.message || "Não deu certo. Tente de novo.");
    toast(run.erro, true);
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
  for (const l of m.listas) for (const it of l.itens) if (num(it.noMes) > 0) compras.push([l.label, it.nome, it.valor, it.data, it.sit]);
  const total = 1 + altura + 2 + compras.length + 3;
  const hoje = new Date().toLocaleDateString("pt-BR");
  const r0 = 4 + altura + 2; // linha (1-based) do cabeçalho das compras
  // a data das compras vai como número de série; a coluna D recebe formato de data
  const fmtDatas = compras.length ? [{ repeatCell: { range: { sheetId: histId, startRowIndex: r0, endRowIndex: r0 + compras.length, startColumnIndex: 3, endColumnIndex: 4 },
    cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } }, fields: "userEnteredFormat.numberFormat" } }] : [];
  await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [
    { insertDimension: { range: { sheetId: histId, dimension: "ROWS", startIndex: 3, endIndex: 3 + total }, inheritFromBefore: false } },
    { copyPaste: { source: { sheetId: casaId, startRowIndex: ini - 1, endRowIndex: fim, startColumnIndex: 0, endColumnIndex: 7 },
                   destination: { sheetId: histId, startRowIndex: 4, endRowIndex: 4 + altura, startColumnIndex: 0, endColumnIndex: 7 }, pasteType: "PASTE_FORMAT" } },
    { copyPaste: { source: { sheetId: casaId, startRowIndex: ini - 1, endRowIndex: fim, startColumnIndex: 0, endColumnIndex: 7 },
                   destination: { sheetId: histId, startRowIndex: 4, endRowIndex: 4 + altura, startColumnIndex: 0, endColumnIndex: 7 }, pasteType: "PASTE_VALUES" } },
    ...fmtDatas,
  ] }) });
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
  // 4) contas fixas: os valores do mês ficam guardados em FIXAS POR MÊS; o mês seguinte começa zerado
  //    (ou com o que já tiver sido lançado para ele)
  const fixas = doMes(m), guardadas = guardaMes(await lerFixMesSeguro(), m.mes, fixas);
  await gravaFixMes(guardadas);
  data.push(...valoresDoMes(guardadas, prox.label, fixas));
  // 5) extras do Carlos e dinheiro que ele mandou no meio do mês: eram deste mês, saem
  for (const x of m.carlos.extras) if (x.extra) data.push({ range: `CASA!A${x.row}:C${x.row}`, values: [["", "", ""]] });
  for (const e of m.entradas) if (e.carlos) data.push({ range: `CASA!A${e.row}:C${e.row}`, values: [["", "", ""]] });
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
  if (DEMO) {
    b.innerHTML = `<span>Modo de teste: dados inventados. Nada do que mexer aqui vai para a planilha.</span><a class="btn-sair" href="./">Sair do teste</a>`;
    b.hidden = false;
  } else if (navigator.onLine === false && S.m) {
    b.innerHTML = `<span>Sem internet. Mostrando os últimos valores guardados; para salvar, espere a internet voltar.</span>`;
    b.hidden = false;
  } else if (!Token.get() && S.m) {
    b.innerHTML = `<span>Mostrando os últimos valores guardados. Entre de novo para atualizar.</span><button id="relogin">Entrar</button>`;
    b.hidden = false; $("#relogin").onclick = () => googleLogin();
  } else b.hidden = true;
}
// (o aviso "A planilha está em … Voltar para …" foi tirado a pedido em 23/10/2026: o mês só muda pelas setas)
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
  $$(".tabs [data-tab]").forEach(b => { const on = b.dataset.tab === S.tab || (S.tab === "cartao" && b.dataset.tab === "cartoes"); b.classList.toggle("on", on); on ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"); });
  const views = { inicio: viewInicio, cartoes: viewCartoes, contas: viewContas, mais: viewMais, cartao: viewCartao };
  const corpo = (views[S.tab] || viewInicio)(); // pode trocar S.tab (cartão que sumiu volta para Cartões)
  const titulo = { inicio: "Início", cartoes: "Cartões", contas: "Contas", mais: "Mais", cartao: S.card ? titleCase(S.card) : "Cartão" }[S.tab] || "Início";
  main.innerHTML = `<h1 class="sr-only">${esc(titulo)} · ${esc(m.cur ? titleCase(m.cur.nome) : m.mes)}</h1>` + corpo + statusHtml();
  renderStatus();
}

function loginHtml() {
  return `<div class="login">
    <div class="login-art"><img src="icons/icon-192.png" alt=""></div>
    <h1>Contas da casa</h1>
    <p>Os gastos, os cartões e o que sobra no mês, tudo num lugar só. Fica guardado na planilha CASA, no Google.</p>
    <button class="btn big" data-act="login"><svg><use href="#i-google"/></svg>Entrar com o Google</button>
    <div class="login-hint"><svg><use href="#i-info"/></svg><span>Se aparecer “A Google não validou esta app”, toque em <b>Continuar</b> (à esquerda, não no botão azul) e depois em <b>Continuar</b> de novo. Se pedir, deixe marcada a caixinha das planilhas. É normal: o app é só da família.</span></div>
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
const cardStyle = nome => { const b = brand(nome); return `--c1:${b.start};--c2:${b.c2};--fg:${b.fg};--sh:${b.sh};--shine:${b.shine};--pill:${b.pill}`; };
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
  const m = S.m, c = caixa(m);
  const neg = c.disp < 0, negFim = num(m.sobraFinal) < 0;
  const aPagar = c.aPagar.map(pagarHtml).join(""), pagos = c.pagos.map(pagoHtml).join("");
  return `
    <section class="hero ${neg ? "neg" : ""}">
      <div class="hero-lbl">${neg ? "Pagou mais do que entrou" : "Dinheiro disponível"}</div>
      <div class="hero-big">${brl(c.disp)}</div>
      <div class="hero-sub">Diminui quando marcar uma conta como paga</div>
      <details class="conta-dt">
        <summary>Ver a conta</summary>
        <dl class="conta">
          <div><dt>Dinheiro que entrou</dt><dd>${brl(c.entrou)}</dd></div>
          <div><dt>− Já paguei</dt><dd>${brl(c.pago)}</dd></div>
          <div class="sub"><dt>= Disponível agora</dt><dd>${brl(c.disp)}</dd></div>
          <div><dt>− Falta pagar</dt><dd>${brl(c.falta)}</dd></div>
          <div class="tot"><dt>= ${negFim ? "Vai faltar" : "Sobra depois de pagar tudo"}</dt><dd>${brl(m.sobraFinal)}</dd></div>
        </dl>
      </details>
    </section>
    <section class="inicial ${negFim ? "neg" : ""}">
      <span class="inicial-l">${negFim ? "Depois de pagar tudo, vai faltar" : "Depois de pagar tudo, sobra"}</span>
      <span class="inicial-v">${brl(m.sobraFinal)}</span>
      <span class="inicial-s">diminui a cada compra no cartão</span>
    </section>
    ${m.alerta ? `<div class="alert"><svg><use href="#i-info"/></svg>${esc(m.alerta)}</div>` : ""}
    ${secHead("Para pagar", c.aPagar.length ? `${c.aPagar.length} conta${c.aPagar.length > 1 ? "s" : ""} · ${brl(c.falta)} · toque quando pagar` : "", "#f59f00")}
    <div class="list">${aPagar || `<div class="empty">Tudo pago este mês.</div>`}</div>
    ${pagos ? `${secHead("Já paguei", `${c.pagos.length} · ${brl(c.pago)}`, "#2f9e44")}<div class="list">${pagos}</div>` : ""}
    <button class="btn ghost" data-act="tab" data-tab="contas">Ver todas as contas fixas</button>`;
}

// fatura do mês (bloco FATURAS DOS CARTÕES) de um cartão
const fatDe = c => S.m.faturas.find(x => norm(x.nome) === norm(c.nome)) || null;
// botão de pagar a fatura embaixo do cartão: "Pagar R$ X" ou o carimbo PAGO (tocar abre para desmarcar)
function pagaFaturaHtml(c) {
  const f = fatDe(c);
  if (!f || !(num(f.valor) > 0 || f.pago)) return "";
  const dif = f.pago ? Math.round((num(f.valor) - num(f.pago.valor)) * 100) / 100 : 0;
  if (f.pago && dif <= 0) return `<button class="cc-paga feito" data-act="pagar-fatura" data-card="${esc(f.nome)}"><span class="carimbo">Pago</span><span>${brl(f.pago.valor)}${typeof f.pago.data === "number" ? ` · dia ${esc(fmtDate(f.pago.data, "short"))}` : ""}</span></button>`;
  return `<button class="cc-paga" data-act="pagar-fatura" data-card="${esc(f.nome)}">${dif > 0 ? `Pagar a diferença · ${brl(dif)}` : `Pagar a fatura · ${brl(f.valor)}`}</button>`;
}
function ccHtml(c, big) {
  const f = fatDe(c), pago = f && f.pago && num(f.valor) - num(f.pago.valor) <= 0.004;
  return `<button class="cc ${big ? "cc-big" : ""}" data-act="open-card" data-card="${esc(c.nome)}" style="${cardStyle(c.nome)}">
    ${pago ? `<span class="cc-carimbo" aria-label="fatura paga">Pago</span>` : ""}
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
    ${secHead("Meus cartões", `Toque num cartão para ver as compras · toque em Pagar quando pagar a fatura · total ${brl(tot)}`, "#5c7cfa")}
    <div class="wallet">${m.cartoes.map(c => `<div class="cc-wrap">${ccHtml(c)}${pagaFaturaHtml(c)}</div>`).join("")}</div>
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
    const ln = norm(l.nome);
    const proj = m.proj.linhas[ln] || m.proj.linhas[Object.keys(m.proj.linhas).find(k => k.startsWith(ln)) || ""];
    const prox = proj ? proj.slice(1).map((v, i) => ({ v: num(v), mes: m.proj.meses[i + 1] })).filter(x => x.v > 0) : [];
    const maxP = Math.max(1, ...prox.map(x => x.v));
    return `${secHead(listas.length > 1 ? l.label : "Compras desta fatura", `${ativos.length} compras · total ${brl(l.total)}`, cor)}
      <div class="list">${ativos.map(compraHtml).join("") || `<div class="empty">Nenhuma compra nesta fatura.</div>`}</div>
      ${prox.length ? `${secHead("Próximas faturas", "o que já está comprometido", "#f59f00")}
        <div class="months">${prox.map(x => `<div class="mo"><span class="mo-bar"><i style="height:${Math.max(8, Math.round(x.v / maxP * 100))}%;--c1:${cor}"></i></span><b>${brl(x.v).replace("R$", "").trim()}</b><span>${esc(x.mes)}</span></div>`).join("")}</div>` : ""}
      ${futuras.length ? `${secHead("Já lançadas para depois", "", "#868e96")}<div class="list">${futuras.map(compraHtml).join("")}</div>` : ""}`;
  }).join("");
  return `<button class="back" data-act="tab" data-tab="cartoes"><svg><use href="#i-left"/></svg>Todos os cartões</button>
    <div class="cc-solo">${ccHtml(c, true)}${pagaFaturaHtml(c)}</div>
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

// 2º dinheiro: quanto pedir ao Carlos para pagar os cartões e as contas do 2º sem faltar.
// A Sobra final da planilha = 2º + outros + sobra do 1º − (cartões e contas do 2º); o que zera a sobra é 2º − sobra final.
function pedir2o() {
  const m = S.m, e2 = m.entradas.find(e => e.principal && e.row - m.ranges.rEnt === 2);
  const valor = Math.max(0, Math.round((num(e2 && e2.valor) - num(m.sobraFinal)) * 100) / 100);
  return { valor, faltam: m.fixas.filter(f => f.nome && f.valor === "").length };
}
const pedidoHtml = p => `Para pagar os cartões e as contas do 2º dinheiro sem faltar, peça ao Carlos <b>${brl(p.valor)}</b>.`
  + (p.faltam ? ` <br>Ainda faltam lançar <b>${p.faltam} conta${p.faltam > 1 ? "s" : ""} fixa${p.faltam > 1 ? "s" : ""}</b>: esse valor vai subir quando lançar.` : "");
// O verde do Início (pedido da Rosany): começa com tudo que entrou no mês (1º + 2º dinheiro e outros)
// e diminui quando ela marca uma conta fixa ou uma fatura como paga (aba PAGAMENTOS).
// Com tudo pago, ele fica igual à Sobra final da planilha; a diferença é o que falta pagar.
// Conta "no cartão" não sai do disponível: ela vai na fatura do cartão escolhido.
const pagaCom = x => x === "1º DINHEIRO" || x === "2º DINHEIRO";
// vencimento da conta no mês da tela (conta do mês anterior: no mês anterior)
function venceDia(m, dia, anterior) {
  const d = m.cur && fromSerial(m.cur.serial), n = parseInt(dia, 10);
  if (!d || !(n >= 1)) return null;
  const mo = d.getUTCMonth() - (anterior ? 1 : 0);
  const ult = new Date(Date.UTC(d.getUTCFullYear(), mo + 1, 0)).getUTCDate();
  return Math.round((Date.UTC(d.getUTCFullYear(), mo, Math.min(n, ult)) - EPOCH) / 86400000);
}
function caixa(m) {
  const r = x => Math.round(x * 100) / 100;
  const fixas = m.fixas.filter(f => f.nome && (pagaCom(f.saide) || f.saide === "NO CARTÃO"));
  const fats = m.faturas.filter(f => pagaCom(f.saide));
  const aPagar = [], pagos = [];
  for (const f of fixas) {
    const venc = venceDia(m, f.dia, ehAnterior(f.nome)), x = { tipo: "conta", f, venc };
    if (f.saide === "NO CARTÃO") (f.pago && f.pago.lista ? pagos : aPagar).push(x);
    else if (f.pago && !f.pago.lista) pagos.push(x);
    else aPagar.push(x);
  }
  for (const f of fats) {
    const x = { tipo: "fatura", f, venc: f.venc };
    if (!f.pago) { if (num(f.valor) > 0) aPagar.push(x); continue; }
    pagos.push(x);
    // pagou e depois entrou compra nova nesta fatura: a diferença volta para "Para pagar"
    const dif = r(num(f.valor) - num(f.pago.valor));
    if (dif > 0) aPagar.push({ ...x, dif });
  }
  const porData = (a, b) => (a.venc ?? 1e9) - (b.venc ?? 1e9);
  aPagar.sort(porData); pagos.sort((a, b) => num(b.f.pago.data) - num(a.f.pago.data));
  const entrou = r(m.entradas.reduce((a, e) => a + num(e.valor), 0));
  const pago = r(pagos.filter(x => !(x.tipo === "conta" && x.f.pago.lista)).reduce((a, x) => a + num(x.f.pago.valor), 0));
  const disp = r(entrou - pago);
  return { entrou, pago, disp, falta: r(disp - num(m.sobraFinal)), aPagar, pagos };
}
const nomeDe = x => (x.tipo === "fatura" ? `Fatura ${titleCase(x.f.nome)}` : tituloConta(x.f));
// Linha de conta/fatura com o botão de pagar à direita (pedido da Rosany): o lado esquerdo abre a conta
// (ou o cartão); o direito mostra o valor e "Pagar" — depois de pago, o carimbo PAGO.
function botaoPagar(f, fat, dif) {
  const lp = !fat && f.pago && f.pago.lista && S.m.listas.find(l => l.nome === f.pago.lista);
  const cartao = !fat && f.saide === "NO CARTÃO";
  const attrs = fat ? `data-act="pagar-fatura" data-card="${esc(f.nome)}"` : `data-act="pagar-fixa" data-row="${f.row}"`;
  const nome = fat ? `fatura ${titleCase(f.nome)}` : tituloConta(f);
  if (!fat && f.valor === "") return `<button class="paga" ${attrs} aria-label="Lançar o valor de ${esc(nome)}"><span class="paga-v">—</span><span class="paga-b">Lançar</span></button>`;
  if (dif) return `<button class="paga" ${attrs} aria-label="Pagar a diferença da ${esc(nome)}"><span class="paga-v">${brl(dif)}</span><span class="paga-b">Pagar</span></button>`;
  if (lp) return `<button class="paga feito" ${attrs} aria-label="${esc(nome)}: lançada no ${esc(lp.label)}"><span class="paga-v">${brl(f.pago.valor)}</span><span class="carimbo">No cartão</span></button>`;
  if (cartao) return `<button class="paga" ${attrs} aria-label="Escolher o cartão da ${esc(nome)}"><span class="paga-v">${brl(f.valor)}</span><span class="paga-b">Cartão</span></button>`;
  if (f.pago) return `<button class="paga feito" ${attrs} aria-label="${esc(nome)}: paga"><span class="paga-v">${brl(f.pago.valor)}</span><span class="carimbo">Pago</span></button>`;
  return `<button class="paga" ${attrs} aria-label="Pagar ${esc(nome)}"><span class="paga-v">${brl(f.valor)}</span><span class="paga-b">Pagar</span></button>`;
}
function linhaConta({ f, fat, venc, dif }, sub) {
  const feito = f.pago && !dif;
  const abre = fat ? `data-act="open-card" data-card="${esc(f.nome)}"` : `data-act="edit-fixa" data-row="${f.row}"`;
  return `<div class="linha ${feito ? "ok" : ""}">
    <button class="item" ${abre}>
      ${fat ? miniCard(f.nome) : icoBubble(f.nome)}
      <span class="item-main"><span class="item-t">${esc(fat ? `Fatura ${titleCase(f.nome)}` : tituloConta(f))} ${feito ? "" : dueBadge(venc)}</span><span class="item-s">${sub}</span></span>
    </button>${botaoPagar(f, fat, dif)}</div>`;
}
function pagarHtml(x) {
  const f = x.f, fat = x.tipo === "fatura", cartao = !fat && f.saide === "NO CARTÃO";
  const sub = x.dif ? `já pagou ${brl(f.pago.valor)} · falta o resto`
    : cartao ? "paga no cartão · escolher qual"
    : `${x.venc ? `${ehAnterior(f.nome) ? "venceu" : "vence"} ${esc(fmtDate(x.venc, "short"))} · ` : ""}${ehAnterior(f.nome) ? "paga atrasado · " : ""}${saideChip(f.saide)}`;
  return linhaConta({ f, fat, venc: x.venc, dif: x.dif }, sub);
}
function pagoHtml(x) {
  const f = x.f, fat = x.tipo === "fatura", l = !fat && f.pago.lista && S.m.listas.find(y => y.nome === f.pago.lista);
  const sub = l ? `${esc(l.label)} · fatura de ${esc(mesNome(f.pago.fat))}` : `${typeof f.pago.data === "number" ? `dia ${esc(fmtDate(f.pago.data, "short"))}` : "pago"}`;
  return linhaConta({ f, fat, venc: x.venc }, sub);
}
const mesNome = lbl => { const x = monthByLabel(lbl); return x ? titleCase(x.nome).split(" ")[0].toLowerCase() : lbl; };
const envioHtml = e => `<button class="item" data-act="edit-envio-carlos" data-row="${e.row}">
      <span class="ico" style="--ic:#2f9e44"><svg><use href="#i-in"/></svg></span>
      <span class="item-main"><span class="item-t">O Carlos mandou</span><span class="item-s">${typeof e.data === "number" ? `dia ${esc(fmtDate(e.data, "short"))} · ` : ""}pagamento da pensão</span></span>
      <span class="item-v pos">${brl(e.valor)}</span></button>`;
function viewContas() {
  const m = S.m;
  const ent = m.entradas.filter(e => e.principal || e.nome || e.valor !== "").map(e => {
    if (e.carlos) return envioHtml(e);
    const primeiro = e.row - m.ranges.rEnt === 1;
    const nome = e.principal ? (primeiro ? "1º dinheiro" : "2º dinheiro") : e.nome;
    const sub = e.principal ? `${primeiro ? "pensão fixa do Carlos" : (e.valor === "" ? "para os cartões" : `para os cartões · pedir ${brl(pedir2o().valor)}`)} · dia ${esc(fmtDate(e.data, "short"))}` : "entra junto com o 2º";
    return `<button class="item" data-act="edit-entrada" data-row="${e.row}">
      <span class="ico" style="--ic:#2f9e44"><svg><use href="#i-in"/></svg></span>
      <span class="item-main"><span class="item-t">${esc(nome)}</span><span class="item-s">${sub}</span></span>
      <span class="item-v pos">${e.principal && e.valor === "" ? `<span class="lancar">Lançar</span>` : brl(e.valor)}</span></button>`;
  }).join("");
  const livreOutro = m.entradas.some(e => !e.principal && !e.nome && e.valor === "");
  const fixas = m.fixas.filter(f => f.nome || f.valor !== "");
  const pend = fixas.filter(f => f.nome && f.valor === "").length;
  // conta sem valor = ainda não lançada este mês (o fechamento deixa em branco); mostra o do mês passado como referência
  // contas fixas e faturas dos cartões juntas, pela data de vencimento, cada uma com o botão Pagar
  // (as compras de cada cartão continuam só na aba Cartões)
  const linhas = fixas.map(f => ({ f, fat: false, venc: venceDia(m, f.dia, ehAnterior(f.nome)) }))
    .concat(m.faturas.filter(f => pagaCom(f.saide) && (num(f.valor) > 0 || f.pago)).map(f => ({ f, fat: true, venc: f.venc })));
  const fix = linhas.sort((a, b) => (!a.fat && a.f.valor === "" ? 0 : 1) - (!b.fat && b.f.valor === "" ? 0 : 1) || (a.venc ?? 1e9) - (b.venc ?? 1e9)).map(({ f, fat, venc }) => {
    if (fat) {
      const dif = f.pago ? Math.round((num(f.valor) - num(f.pago.valor)) * 100) / 100 : 0;
      return linhaConta({ f, fat: true, venc, dif: dif > 0 ? dif : 0 }, `cartão · vence ${esc(fmtDate(venc, "short"))} · ${saideChip(f.saide)}${dif > 0 ? ` · já pagou ${brl(f.pago.valor)}` : ""}`);
    }
    const ant = m.prevFixas[norm(f.nome)];
    const falta = f.valor === "", cartao = f.saide === "NO CARTÃO";
    const sub = `${ehAnterior(f.nome) && venc ? `venceu ${esc(fmtDate(venc, "short"))} · paga atrasado` : `dia ${esc(f.dia)}`} · ${saideChip(f.saide)}${f.onde ? ` · ${esc(f.onde)}` : ""}${falta && ant !== undefined ? `<br>mês passado: ${brl(ant)}` : ""}`;
    return linhaConta({ f, fat: false, venc }, sub).replace('class="linha', `class="linha ${falta ? "falta" : ""} ${cartao && !(f.pago && f.pago.lista) ? "dim" : ""}`);
  }).join("");
  const neg = num(m.sobraFinal) < 0;
  return `${secHead("Dinheiro que entrou", `total ${brl(m.totalEntrou)}`, "#2f9e44")}
    <div class="list">${ent}</div>
    ${livreOutro ? `<button class="btn ghost" data-act="novo-envio-carlos"><svg><use href="#i-plus"/></svg>O Carlos mandou dinheiro</button>
    <button class="btn ghost" data-act="nova-entrada"><svg><use href="#i-plus"/></svg>Outro valor (ex.: saldo do Inter)</button>` : ""}
    ${secHead("Contas e cartões do mês", `${pend ? `<b>${pend} para lançar</b> · ` : ""}contas fixas ${brl(m.totalFixas)} · cartões ${brl(m.faturas.filter(f => pagaCom(f.saide)).reduce((a, f) => a + num(f.valor), 0))} · toque em Pagar quando pagar`, "#f59f00")}
    <div class="list">${fix || `<div class="empty">Nenhuma conta.</div>`}</div>
    <button class="btn ghost" data-act="nova-fixa"><svg><use href="#i-plus"/></svg>Nova conta</button>
    ${secHead("Resultado do mês", "", "#2f9e44")}
    <div class="result">
      <div><span>Sobra do 1º dinheiro</span><b>${brl(m.sobra1)}</b><small>passa para o 2º</small></div>
      <div class="${neg ? "neg" : "pos"}"><span>${neg ? "Depois de pagar tudo, vai faltar" : "Depois de pagar tudo, sobra"}</span><b>${brl(m.sobraFinal)}</b></div>
    </div>`;
}

function viewMais() {
  const m = S.m, c = m.carlos;
  const ex = c.extras.filter(x => x.nome || x.valor !== "").map(x => `<button class="item" data-act="edit-carlos" data-row="${x.row}">
      ${icoBubble(x.nome)}<span class="item-main"><span class="item-t">${esc(x.nome)}</span>${x.extra ? `<span class="item-s"><span class="tag tag-extra">EXTRA DO MÊS</span></span>` : ""}</span><span class="item-v">${brl(x.valor)}</span></button>`).join("");
  const envios = m.entradas.filter(e => e.carlos).map(envioHtml).join("");
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
    <button class="btn ghost" data-act="novo-carlos"><svg><use href="#i-plus"/></svg>Novo item fixo do Carlos</button>
    ${envios ? `<p class="sub-lista">Dinheiro que o Carlos mandou neste mês</p><div class="list">${envios}</div>` : ""}
    <button class="btn ghost" data-act="novo-envio-carlos"><svg><use href="#i-plus"/></svg>O Carlos mandou dinheiro</button>

    ${secHead("Porquinho", ult ? `último saldo: ${brl(ult.total)}` : "quanto tem investido", "#e64980")}
    <div class="list">${pq || `<div class="empty">Nada anotado.</div>`}</div>
    <button class="btn ghost" data-act="novo-porquinho"><svg><use href="#i-plus"/></svg>Anotar saldo de hoje</button>

    ${secHead("Fim do mês", "", "#5c7cfa")}
    <div class="endmonth">
      <span class="ico" style="--ic:#5c7cfa"><svg><use href="#i-calendar"/></svg></span>
      <p>Quando tudo do mês estiver pago: guarda o mês em ANTERIORES, tira as compras que já acabaram e passa para o mês seguinte.</p>
      <button class="btn" data-act="fechar">Fechar ${esc(m.cur ? titleCase(m.cur.nome) : "o mês")}</button>
    </div>

    ${secHead("Dia e noite", "cores da tela", "#fab005")}
    <div class="choices theme-pick" role="group" aria-label="Cores da tela">${[["", "i-auto", "Automático"], ["dia", "i-sun", "Dia"], ["noite", "i-moon", "Noite"]].map(([v, ic, l]) =>
      `<button type="button" ${pressed((store.get("tema") || "") === v)} data-act="tema" data-tema="${v}"><svg><use href="#${ic}"/></svg>${l}</button>`).join("")}</div>
    <p class="ver">Automático segue o iPhone: claro de dia, escuro à noite.</p>

    ${secHead("Planilha e conta", email ? esc(email) : "", "#868e96")}
    ${DEMO ? "" : `<a class="btn ghost" href="https://docs.google.com/spreadsheets/d/${esc(CFG.SPREADSHEET_ID)}/edit" target="_blank" rel="noopener">Abrir a planilha no Google</a>`}
    ${DEMO ? "" : `<button class="btn ghost" data-act="atualizar-app"><svg><use href="#i-sync"/></svg>Atualizar o app</button>`}
    <button class="btn ghost" data-act="logout">Sair da conta</button>
    <p class="ver">Casa · versão ${esc(APP_VERSION)}</p>`;
}
const APP_VERSION = "7";

/* ======================= folhas (formulários) ======================= */
// Folha (formulário) por cima do app. Enquanto aberta: o resto fica inerte, o foco fica dentro dela,
// Esc fecha, e ao fechar o foco volta para o botão que abriu. Tocar fora não fecha se algo foi digitado
// (só o ✕ fecha sem salvar), para ninguém perder uma compra por um toque sem querer.
const BEHIND = () => [$(".top"), $("#banner"), $("#main"), $(".tabs"), $("#fab")].filter(Boolean);
let sheetSeq = 0;
let pendingReload = false; // versão nova chegou com um formulário aberto
function openSheet(title, body, onMount) {
  const root = $("#sheet-root"), seq = ++sheetSeq;
  const opener = root.contains(document.activeElement) ? openSheet.opener : document.activeElement;
  openSheet.opener = opener;
  root.innerHTML = `<div class="scrim"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t">
    <div class="grab"></div><div class="sheet-h"><h3 id="sheet-t" tabindex="-1">${esc(title)}</h3><button class="x" aria-label="Fechar sem salvar"><svg><use href="#i-x"/></svg></button></div>${body}</div>`;
  const sheet = $(".sheet", root);
  BEHIND().forEach(e => e.inert = true);
  $("#sheet-t", sheet).focus({ preventScroll: true }); // o VoiceOver começa pelo título da folha
  let fechada = false;
  requestAnimationFrame(() => { if (!fechada && seq === sheetSeq) root.classList.add("open"); }); // não reabre uma folha que já fechou
  const snap = () => $$("input, select, textarea", sheet).map(i => i.value).join("\u0001");
  let inicial = ""; // tirada depois que o formulário se preenche sozinho (data, fatura calculada)
  const close = () => {
    if (seq !== sheetSeq || fechada) return; // outra folha já tomou o lugar desta
    fechada = true;
    root.classList.remove("open");
    BEHIND().forEach(e => e.inert = false);
    document.removeEventListener("keydown", onKey, true);
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    setTimeout(() => { if (seq === sheetSeq && !root.classList.contains("open")) { root.innerHTML = ""; if (pendingReload) location.reload(); } }, 260);
  };
  const fechaSeLimpo = () => { if (snap() === inicial) close(); else toast("Ainda não salvou. Toque em Salvar, ou no ✕ para sair sem salvar."); };
  const onKey = e => {
    if (seq !== sheetSeq) return document.removeEventListener("keydown", onKey, true);
    if (e.key === "Escape") { e.preventDefault(); fechaSeLimpo(); }
    if (e.key === "Tab") { // foco preso dentro da folha
      const f = $$('button:not([disabled]), input, select, textarea, [tabindex="-1"]#sheet-t', sheet).filter(x => !x.closest("[hidden]"));
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener("keydown", onKey, true);
  $(".scrim", root).onclick = fechaSeLimpo; $(".x", root).onclick = close;
  if (onMount) onMount(sheet, close);
  const st = $(":scope > .stack", sheet);
  const del = st && $("#f-del", st); // só o "Apagar" dos formulários; a confirmação de apagar fica no rodapé
  if (del) { del.className = "apagar-link"; sheet.append(del); }
  if (!$("input, select, textarea", sheet)) $(".x", sheet).setAttribute("aria-label", "Fechar");
  const rola = () => sheet.classList.toggle("rola", sheet.scrollHeight > sheet.clientHeight + 2);
  requestAnimationFrame(rola); setTimeout(rola, 320);
  inicial = snap();
  return close;
}
// Mensagem de erro do formulário junto do campo que precisa de atenção (e o campo ganha foco).
function formErr(el, alvo, msg) {
  limpaErro(el);
  const t = typeof alvo === "string" ? $(alvo, el) : alvo;
  const box = (t && t.closest(".field")) || $(".stack", el);
  const p = document.createElement("p"); p.className = "field-err"; p.id = "f-err"; p.setAttribute("role", "alert"); p.textContent = msg;
  if (t) box.append(p); else box.prepend(p); // sem campo: em cima do botão Salvar
  if (t) {
    const marca = t.closest(".cardpick, .choices") || t; // num grupo de botões, quem está "inválido" é o grupo
    marca.setAttribute("aria-invalid", "true"); marca.setAttribute("aria-describedby", "f-err");
    // o erro some assim que a pessoa mexe no campo (não fica um "errado" ao lado do valor certo)
    marca.addEventListener(marca === t ? "input" : "click", () => limpaErro(el), { once: true });
    t.scrollIntoView({ block: "center", behavior: "smooth" }); if (t.focus) t.focus({ preventScroll: true });
  }
  return false;
}
function limpaErro(el) {
  $$(".field-err", el).forEach(x => x.remove());
  $$("[aria-invalid]", el).forEach(x => { x.removeAttribute("aria-invalid"); x.removeAttribute("aria-describedby"); });
}
// Salvar sem perder o que foi digitado: a folha só fecha quando a planilha confirmar.
// Se der errado, o botão volta, a mensagem aparece em cima dele e tudo que foi digitado continua lá.
// botao = o botão tocado (padrão: #f-ok); é nele que aparece "Salvando…"
async function salvarDaFolha(el, close, fazer, botao) {
  const b = botao || $("#f-ok", el), txt = b.textContent;
  $$(".field-err", el).forEach(x => x.remove());
  b.disabled = true; b.textContent = "Salvando…"; el.setAttribute("aria-busy", "true");
  const ok = await fazer();
  el.removeAttribute("aria-busy");
  if (ok) { close(); return true; }
  if (!el.isConnected) return false; // saiu para entrar no Google: a operação ficou guardada
  b.disabled = false; b.textContent = txt;
  formErr(el, null, (run.erro || "Não deu certo.") + " O que você digitou continua aqui: é só tocar em salvar de novo.");
  b.focus({ preventScroll: true });
  return false;
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
// Botões de escolha: o marcado tem .on (visual) e aria-pressed (o VoiceOver diz "selecionado").
const pressed = on => `class="choice ${on ? "on" : ""}" aria-pressed="${on}"`;
const marca = (lista, b) => lista.forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
const choiceBtns = (name, opts, cur) => opts.map(([v, l]) => `<button type="button" ${pressed(String(v) === String(cur))} data-${name}="${esc(v)}">${esc(l)}</button>`).join("");
function bindChoices(el, name, onPick) {
  $$(`[data-${name}]`, el).forEach(b => b.onclick = () => { marca($$(`[data-${name}]`, el), b); onPick(b.dataset[name]); });
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

  let extra = false; // compra que o Carlos paga, fora dos cartões
  const pick = listas.map(l => { const b = brand(l.card); return `<button type="button" data-lista="${esc(l.nome)}" class="${lista && lista.nome === l.nome ? "on" : ""}" aria-pressed="${!!(lista && lista.nome === l.nome)}" style="background:${b.bg};color:${b.fg};--sh:${b.sh}">${esc(l.label)}</button>`; }).join("")
    + (item ? "" : `<button type="button" class="pick-extra" data-lista="__extra" aria-pressed="false">Extra do Carlos<small>não é cartão</small></button>`);
  const body = `
    <div class="field"><span id="g-cartao">Cartão</span><div class="cardpick" role="group" aria-labelledby="g-cartao">${pick}</div></div>
    <p class="tip" id="f-extra-tip" hidden>O Carlos paga esta compra para você: soma no <b>Total do Carlos</b> deste mês e sai quando fechar o mês.</p>
    <label class="field"><span>O que comprou</span><input class="input" id="f-nome" autocomplete="off" autocapitalize="characters" value="${esc(item ? item.nome : "")}" placeholder="ex.: MERCADO"></label>
    <div class="so-cartao">
    <div class="field"><span id="g-tipo">Como pagou</span><div class="choices" role="group" aria-labelledby="g-tipo">${choiceBtns("tipo", [["vista", "À vista"], ["parc", "Parcelado"], ["fixo", "Todo mês"]], tipo)}</div></div>
    <div class="field" id="parc-box"><span>Quantas parcelas</span>
      <div class="stepper"><button type="button" data-step="-1">−</button><div class="num" id="f-n">${nParc}</div><button type="button" data-step="1">+</button></div></div>
    </div>
    <label class="field"><span id="lbl-valor">Valor</span><input class="input money" id="f-valor" inputmode="decimal" autocomplete="off" placeholder="ex.: 49,90" value="${esc(item ? moneyInput(item.valor) : "")}">
      <small id="f-total"></small></label>
    <div class="so-cartao">
    <label class="field"><span>Data da compra</span><input class="input" type="date" id="f-data" value="${esc(serialToIso(dataSerial))}"></label>
    <div class="field"><span id="g-fat">Entra na fatura de</span>
      <div class="tip" id="f-best"></div>
      <div class="choices" id="f-fat-opts" role="group" aria-labelledby="g-fat"></div>
      <button type="button" class="linkbtn" id="f-fat-mudar">Escolher outro mês</button>
      <select class="input" id="f-fat-sel" hidden>${monthOptions(fat)}</select></div>
    </div>
    <div class="stack"><button class="btn" id="f-ok">${item ? "Salvar alteração" : "Salvar compra"}</button>
      ${item ? `<button class="btn danger" id="f-del">Apagar esta compra</button>` : ""}</div>`;

  openSheet(item ? "Editar compra" : "Nova compra", body, (el, close) => {
    const upd = () => {
      $("#parc-box", el).hidden = tipo !== "parc";
      $("#f-n", el).textContent = nParc;
      $("#lbl-valor", el).textContent = extra ? "Valor" : tipo === "parc" ? "Valor de CADA parcela" : tipo === "fixo" ? "Valor por mês" : "Valor";
      $$(".so-cartao", el).forEach(x => x.hidden = extra); $("#f-extra-tip", el).hidden = !extra;
      const v = parseMoney($("#f-valor", el).value);
      $("#f-total", el).textContent = !extra && tipo === "parc" && v ? `Total da compra: ${brl(v * nParc)} (${nParc}× ${brl(v)})` : "";
      const c = cardOf(), auto = monthByLabel(autoFat());
      $("#f-best", el).innerHTML = c && auto
        ? `<b>Melhor dia de compra do ${esc(titleCase(c.nome))}: dia ${c.melhor}.</b> Comprando em ${esc(fmtDate(dataSerial, "short"))}, a compra cai na fatura de <b>${esc(titleCase(auto.nome).split(" ")[0].toLowerCase())}</b>. Se o banco colocou em outra, é só tocar no mês certo.`
        : "Escolha o cartão lá em cima.";
      const opts = auto ? [-1, 0, 1].map(d => monthByIdx(auto.idx + d)).filter(Boolean) : [];
      $("#f-fat-opts", el).innerHTML = opts.map(o => `<button type="button" class="choice month ${o.label === fat ? "on" : ""}" aria-pressed="${o.label === fat}" data-fat="${esc(o.label)}">${esc(titleCase(o.nome).split(" ")[0])}<small>${o.label === auto.label ? "calculado" : esc(o.nome.split(" ")[1] || "")}</small></button>`).join("");
      $$("[data-fat]", el).forEach(b => b.onclick = () => { fat = b.dataset.fat; fatManual = fat !== auto.label; upd(); });
      const fora = fat && !opts.some(o => o.label === fat);
      $("#f-fat-sel", el).hidden = !fora && $("#f-fat-sel", el).dataset.open !== "1";
      $("#f-fat-sel", el).value = fat;
    };
    $$("[data-lista]", el).forEach(b => b.onclick = () => {
      extra = b.dataset.lista === "__extra";
      lista = extra ? null : m.listas.find(l => l.nome === b.dataset.lista);
      marca($$("[data-lista]", el), b);
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
      if (!lista && !extra) return formErr(el, ".cardpick button", "Escolha o cartão (ou “Extra do Carlos”, se não foi no cartão).");
      if (!nome) return formErr(el, "#f-nome", "Escreva o que comprou.");
      if (!valor || valor <= 0) return formErr(el, "#f-valor", "Digite o valor, por exemplo 49,90.");
      if (extra) {
        if (await salvarDaFolha(el, close, () => run("addExtraCarlos", { nome, valor }, { quieto: true }))) reciboExtra({ nome, valor, row: OPS.ultimaLinha });
        return;
      }
      if (!fat) return formErr(el, "#f-fat-opts button, #f-fat-sel", "Escolha em qual fatura entra.");
      const parc = tipo === "fixo" ? "FIXO" : tipo === "parc" ? nParc : "";
      const args = { lista: lista.nome, nome, valor, data: dataSerial, parc, fat };
      const q = { quieto: true }; // o recibo substitui o aviso
      if (item && lista.itens.some(i => i.row === item.row)) {
        const antes = { nome: item.nome, valor: item.valor, data: item.data, parc: item.parc, fat: item.fat };
        if (await salvarDaFolha(el, close, () => run("editCompra", { ...args, row: item.row, antes: item.nome }, q))) reciboCompra({ args, row: item.row, antes });
        return;
      }
      if (item) { // trocou de cartão: lança no novo e apaga do antigo
        if (await salvarDaFolha(el, close, () => run("addCompra", args, q))) {
          const row = OPS.ultimaLinha;
          await run("delCompra", { row: item.row, antes: item.nome }, q);
          reciboCompra({ args, row, trocou: true });
        }
        return;
      }
      if (await salvarDaFolha(el, close, () => run("addCompra", args, q))) reciboCompra({ args, row: OPS.ultimaLinha });
    };
    if (item) $("#f-del", el).onclick = async () => {
      close();
      if (await confirmSheet("Apagar compra?", `<b>${esc(item.nome)}</b> – ${brl(item.valor)}<br>Ela sai da lista e da fatura.`, "Apagar", true))
        run("delCompra", { row: item.row, antes: item.nome });
    };
    if (!item) setTimeout(() => (lista ? $("#f-nome", el) : null)?.focus(), 300);
  });
}

// Recibo depois de salvar uma compra: diz onde ela entrou (cartão, fatura, valor) e fica até tocar em Pronto.
// "Desfazer" apaga a compra nova ou volta a alteração (com a mesma conferência de linha do resto do app).
function reciboCompra({ args, row, antes, trocou }) {
  const l = S.m.listas.find(x => x.nome === args.lista);
  if (!l) return toast("Compra salva.");
  const fatM = monthByLabel(args.fat), mesFat = fatM ? titleCase(fatM.nome).split(" ")[0].toLowerCase() : args.fat;
  const n = Number(args.parc);
  const valor = args.parc === "FIXO" ? `${brl(args.valor)}<small>todo mês</small>`
    : n > 1 ? `${n}× ${brl(args.valor)}<small>total ${brl(args.valor * n)}</small>` : brl(args.valor);
  const quando = args.parc === "FIXO" ? `começa na fatura de <b>${esc(mesFat)}</b>`
    : n > 1 ? `1ª parcela na fatura de <b>${esc(mesFat)}</b>` : `entra na fatura de <b>${esc(mesFat)}</b>`;
  const desfazer = trocou ? "" : `<button type="button" class="linkbtn recibo-desfazer" data-desfazer>${antes ? "Desfazer a alteração" : "Desfazer: apagar esta compra"}</button>`;
  openSheet(antes ? "Compra alterada" : "Compra anotada", `
    <div class="recibo">
      <svg class="recibo-ok" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7.5 7.5L37.5 19"/></svg>
      <p class="recibo-lead">${DEMO ? "Anotada (modo de teste)." : "Está na planilha."}</p>
      <div class="recibo-linha">
        ${miniCard(l.card)}
        <div class="recibo-main"><b>${esc(args.nome)}</b><span>${esc(l.label)} · ${quando}</span></div>
        <div class="recibo-v">${valor}</div>
      </div>
    </div>
    <div class="stack"><button class="btn big" id="f-ok" data-pronto>Pronto</button>
      <button class="btn ghost" data-ver>Ver no cartão</button>${desfazer}</div>`, (el, close) => {
    $("[data-pronto]", el).onclick = close;
    $("[data-ver]", el).onclick = () => {
      close(); S.card = l.card; S.tab = "cartao"; render();
      const b = $(`[data-act="edit-compra"][data-row="${row}"]`);
      if (b) { b.scrollIntoView({ block: "center", behavior: "smooth" }); b.classList.add("recem"); setTimeout(() => b.classList.remove("recem"), 2600); b.focus({ preventScroll: true }); }
    };
    const d = $("[data-desfazer]", el);
    if (d) d.onclick = async () => {
      close();
      const ok = antes ? await run("editCompra", { ...antes, row, antes: args.nome }, { quieto: true, busyText: "Desfazendo…" })
        : await run("delCompra", { row, antes: args.nome }, { quieto: true, busyText: "Desfazendo…" });
      if (ok) toast(antes ? "Pronto, a compra voltou como estava." : "Pronto, a compra saiu da planilha.");
    };
  });
}

// Recibo do extra do Carlos: mesmo jeito do recibo de compra, apontando para o Total do Carlos.
function reciboExtra({ nome, valor, row }) {
  const total = S.m.carlos.total;
  openSheet("Extra anotado", `
    <div class="recibo">
      <svg class="recibo-ok" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7.5 7.5L37.5 19"/></svg>
      <p class="recibo-lead">${DEMO ? "Anotado (modo de teste)." : "Está na planilha."}</p>
      <div class="recibo-linha">
        <span class="ico" style="--ic:#2f9e44"><svg><use href="#i-user"/></svg></span>
        <div class="recibo-main"><b>${esc(nome)}</b><span>o Carlos paga · Total do Carlos agora ${brl(total)}</span></div>
        <div class="recibo-v">${brl(valor)}</div>
      </div>
    </div>
    <div class="stack"><button class="btn big" data-pronto>Pronto</button>
      <button class="btn ghost" data-ver>Ver o Carlos</button>
      <button type="button" class="linkbtn recibo-desfazer" data-desfazer>Desfazer: apagar este extra</button></div>`, (el, close) => {
    $("[data-pronto]", el).onclick = close;
    $("[data-ver]", el).onclick = () => { close(); S.tab = "mais"; render(); scrollTo({ top: 0 }); };
    $("[data-desfazer]", el).onclick = async () => {
      close();
      if (await run("delCarlos", { row, antes: nome }, { quieto: true, busyText: "Desfazendo…" })) toast("Pronto, o extra saiu da planilha.");
    };
  });
}

// Dinheiro que o Carlos mandou no meio do mês (pagamento da pensão, além do 1º e do 2º dinheiro)
function envioCarlosSheet(e) {
  openSheet(e ? "Dinheiro do Carlos" : "O Carlos mandou dinheiro", `
    <p class="tip">Conta como pagamento da pensão: entra no que sobra do mês e abate do que o Carlos ainda deve. Sai quando fechar o mês.</p>
    <label class="field"><span>Quanto ele mandou</span><input class="input money" id="f-valor" inputmode="decimal" placeholder="ex.: 300,00" value="${esc(e ? moneyInput(e.valor) : "")}"></label>
    <label class="field"><span>Quando</span><input class="input" type="date" id="f-data" value="${esc(e && typeof e.data === "number" ? serialToIso(e.data) : serialToIso(todaySerial()))}"></label>
    <div class="stack"><button class="btn" id="f-ok">Salvar</button>${e ? `<button class="btn danger" id="f-del">Apagar</button>` : ""}</div>`, (el, close) => {
    $("#f-ok", el).onclick = () => {
      const valor = parseMoney($("#f-valor", el).value);
      if (!valor || valor <= 0) return formErr(el, "#f-valor", "Digite quanto ele mandou, por exemplo 300,00.");
      salvarDaFolha(el, close, () => run("saveEnvioCarlos", { row: e ? e.row : null, data: isoToSerial($("#f-data", el).value) ?? "", valor }));
    };
    if (e) $("#f-del", el).onclick = async () => { close(); if (await confirmSheet("Apagar?", `O dinheiro de ${brl(e.valor)} que o Carlos mandou sai da planilha.`, "Apagar", true)) run("delEnvioCarlos", { row: e.row }); };
    if (!e) setTimeout(() => $("#f-valor", el).focus(), 300);
  });
}

// Botão "Pagar" da linha: confirma quanto pagou (o valor previsto vem preenchido e pode mudar).
// O valor confirmado vai para a planilha (coluna Valor) e sai do dinheiro disponível.
function pagarSheet(f) {
  if (f.saide === "NO CARTÃO" || f.valor === "" || !pagaCom(f.saide)) return fixaSheet(f);
  const p = f.pago, nome = tituloConta(f);
  openSheet(p ? `${nome}: paga` : `Pagar ${nome}`, `
    ${p ? `<div class="pago-box"><b>✓ Paga${typeof p.data === "number" ? ` dia ${esc(fmtDate(p.data, "short"))}` : ""}</b>: ${brl(p.valor)} já saiu do dinheiro disponível.</div>`
      : `<p class="tip">O valor previsto já está aqui. Se a conta veio diferente, mude antes de confirmar.</p>`}
    <label class="field"><span>${p ? "Valor pago" : "Quanto pagou"}</span><input class="input money" id="f-valor" inputmode="decimal" placeholder="ex.: 180,00" value="${esc(moneyInput(p ? p.valor : f.valor))}">
      ${!p ? `<small>Previsto: ${brl(f.valor)}</small>` : ""}</label>
    <div class="stack">
      <button class="btn big" id="f-ok">${p ? "Salvar o valor" : `Confirmar: paguei`}</button>
      ${p ? `<button type="button" class="linkbtn" id="f-despagar">Desmarcar: ainda não paguei</button>` : `<button class="btn ghost" id="f-abrir">Mudar outros dados da conta</button>`}</div>`, (el, close) => {
    const args = v => ({ row: f.row, antes: f.nome, nome: f.nome, dia: f.dia, valor: v, saide: f.saide, onde: f.onde });
    const b = $("#f-ok", el), inp = $("#f-valor", el);
    const upd = () => { const v = parseMoney(inp.value); if (!p) b.textContent = v ? `Confirmar: paguei ${brl(v)}` : "Confirmar: paguei"; };
    inp.oninput = upd; upd();
    b.onclick = () => {
      const v = parseMoney(inp.value);
      if (!v || v <= 0) return formErr(el, "#f-valor", "Digite quanto pagou, por exemplo 180,00.");
      salvarDaFolha(el, close, () => run("saveFixa", { ...args(v), pago: true, data: p ? p.data : todaySerial() }));
    };
    const dp = $("#f-despagar", el);
    if (dp) dp.onclick = () => salvarDaFolha(el, close, () => run("saveFixa", { ...args(num(f.valor)), pago: false }), dp);
    const ab = $("#f-abrir", el);
    if (ab) ab.onclick = () => { close(); setTimeout(() => fixaSheet(f), 350); };
  });
}

// Conta fixa. Em cima o que ela mexe todo mês: o valor e o botão "Paguei" (sai do dinheiro disponível).
// Conta paga no cartão (ex.: Claro): escolhe o cartão do mês e o app lança na fatura certa.
// Nome, dia, "paga com" e onde pagar ficam em "Mudar os dados da conta" (abertos numa conta nova).
function fixaSheet(f) {
  const m = S.m;
  let saide = f ? f.saide : "1º DINHEIRO", anterior = !!(f && ehAnterior(f.nome));
  const p = f && f.pago;
  const listas = m.listas.filter(l => m.cartoes.some(c => c.nome === l.card));
  let lista = p && p.lista ? listas.find(l => l.nome === p.lista) || null : null;
  const dataSerial = todaySerial();
  let fat = p && p.fat ? p.fat : "", fatManual = !!fat;
  const autoFat = () => { const c = lista && m.cartoes.find(x => x.nome === lista.card), x = c ? faturaPara(c, dataSerial) : null; return x ? x.label : ""; };
  const ant = f ? m.prevFixas[norm(f.nome)] : undefined;
  const pick = listas.map(l => { const b = brand(l.card); return `<button type="button" data-lista="${esc(l.nome)}" class="${lista && lista.nome === l.nome ? "on" : ""}" aria-pressed="${!!(lista && lista.nome === l.nome)}" style="background:${b.bg};color:${b.fg};--sh:${b.sh}">${esc(l.label)}</button>`; }).join("");
  const dados = `
      <label class="field"><span>Nome da conta</span><input class="input" id="f-nome" autocapitalize="characters" value="${esc(f ? f.nome.replace(/\s*\(m[eê]s anterior\)\s*$/i, "") : "")}" placeholder="ex.: LUZ"></label>
      <label class="field"><span>Dia de vencimento</span><input class="input" id="f-dia" inputmode="numeric" value="${esc(f ? f.dia : "")}" placeholder="ex.: 10"></label>
      <div class="field"><span id="g-ant">De qual mês é a conta que ela paga?</span><div class="choices duas" role="group" aria-labelledby="g-ant">${choiceBtns("ant", [["", "Do mês"], ["1", "Do mês anterior"]], anterior ? "1" : "")}</div>
        <small>“Do mês anterior” = paga atrasado com o dinheiro do fim do mês (ex.: no mês de novembro paga o condomínio de outubro).</small></div>
      <div class="field"><span id="g-saide">Paga com</span><div class="choices" role="group" aria-labelledby="g-saide">${choiceBtns("saide", [["1º DINHEIRO", "1º dinheiro"], ["2º DINHEIRO", "2º dinheiro"], ["NO CARTÃO", "No cartão"]], saide)}</div>
        <small>“No cartão” = paga com um cartão de crédito: vai na fatura dele, não sai do dinheiro.</small></div>
      <label class="field"><span>Onde pagar</span><input class="input" id="f-onde" value="${esc(f ? f.onde : "")}" placeholder="ex.: Aplicativo, PIX, boleto"></label>`;
  openSheet(f ? tituloConta(f) || "Conta fixa" : "Nova conta", `
    <div class="pago-box" id="f-status" hidden></div>
    <label class="field"><span>${anterior ? `Valor do boleto de ${mesAnt()}` : "Valor deste mês"}</span><input class="input money" id="f-valor" inputmode="decimal" placeholder="ex.: 120,00" value="${esc(f ? moneyInput(f.valor) : "")}">
      ${ant !== undefined ? `<small>Mês passado: ${brl(ant)}</small>` : ""}</label>
    <div class="so-cartao-fixa">
      <div class="field"><span id="g-cartao">Em qual cartão pagou este mês?</span><div class="cardpick" role="group" aria-labelledby="g-cartao">${pick}</div></div>
      <div class="field"><span id="g-fat">Entra na fatura de</span>
        <div class="tip" id="f-best"></div>
        <div class="choices" id="f-fat-opts" role="group" aria-labelledby="g-fat"></div></div>
    </div>
    ${f ? `<details class="dados"><summary>Mudar os dados da conta</summary>${dados}</details>` : dados}
    <div class="stack">
      <button class="btn big" id="f-pagar"></button>
      <button class="btn ghost" id="f-ok">Salvar</button>
      ${f && p && !p.lista ? `<button type="button" class="linkbtn" id="f-despagar">Desmarcar: ainda não paguei</button>` : ""}
      ${f ? `<button class="btn danger" id="f-del">Apagar esta conta</button>` : ""}</div>`, (el, close) => {
    const cartao = () => saide === "NO CARTÃO";
    const upd = () => {
      $(".so-cartao-fixa", el).hidden = !cartao();
      const st = $("#f-status", el), lp = p && p.lista && listas.find(l => l.nome === p.lista);
      st.hidden = !(p && (lp || !cartao()));
      st.innerHTML = !p ? "" : lp ? `<b>✓ Lançada este mês</b> no ${esc(lp.label)}, fatura de ${esc(mesNome(p.fat))}: ${brl(p.valor)}`
        : `<b>✓ Paga${typeof p.data === "number" ? ` dia ${esc(fmtDate(p.data, "short"))}` : ""}</b>: ${brl(p.valor)} já saiu do dinheiro disponível.`;
      const b = $("#f-pagar", el), v = parseMoney($("#f-valor", el).value);
      if (cartao()) { b.hidden = false; b.textContent = lista ? `${lp ? "Mudar" : "Lançar"} no ${lista.label}` : "Escolha o cartão acima"; }
      else { b.hidden = !!(p && !p.lista) || !pagaCom(saide); b.textContent = v ? `Paguei ${brl(v)}` : "Paguei"; }
      $("#f-ok", el).textContent = cartao() ? "Salvar sem lançar no cartão" : p && !p.lista ? "Salvar" : "Salvar sem marcar como paga";
      if (!cartao()) return;
      const c = lista && m.cartoes.find(x => x.nome === lista.card), auto = monthByLabel(autoFat());
      $("#f-best", el).innerHTML = c && auto
        ? `Pagando hoje no ${esc(titleCase(c.nome))} (melhor dia ${c.melhor}), cai na fatura de <b>${esc(mesNome(auto.label))}</b>. Se o banco colocou em outra, toque no mês certo.`
        : "Escolha o cartão lá em cima.";
      const opts = auto ? [-1, 0, 1].map(d => monthByIdx(auto.idx + d)).filter(Boolean) : [];
      $("#f-fat-opts", el).innerHTML = opts.map(o => `<button type="button" class="choice month ${o.label === fat ? "on" : ""}" aria-pressed="${o.label === fat}" data-fat="${esc(o.label)}">${esc(titleCase(o.nome).split(" ")[0])}<small>${o.label === auto.label ? "calculado" : esc(o.nome.split(" ")[1] || "")}</small></button>`).join("");
      $$("[data-fat]", el).forEach(x => x.onclick = () => { fat = x.dataset.fat; fatManual = fat !== auto.label; upd(); });
    };
    $$("[data-lista]", el).forEach(b => b.onclick = () => { lista = listas.find(l => l.nome === b.dataset.lista); marca($$("[data-lista]", el), b); if (!fatManual) fat = autoFat(); upd(); });
    bindChoices(el, "saide", v => { saide = v; upd(); });
    bindChoices(el, "ant", v => { anterior = v === "1"; });
    $("#f-valor", el).oninput = upd;
    if (lista && !fat) fat = autoFat();
    upd();
    if (f && f.valor === "") setTimeout(() => $("#f-valor", el).focus(), 300);
    const dadosOk = () => {
      const base = $("#f-nome", el).value.trim().toUpperCase().replace(/\s*\(M[EÊ]S ANTERIOR\)\s*$/, ""), valor = parseMoney($("#f-valor", el).value);
      const nome = base && anterior ? base + SUF_ANT : base;
      const dia = parseInt($("#f-dia", el).value, 10);
      const abre = () => { const d = $("details.dados", el); if (d) d.open = true; };
      if (!base) { abre(); return formErr(el, "#f-nome", "Escreva o nome da conta."); }
      if (valor === null) return formErr(el, "#f-valor", "Digite o valor, por exemplo 120,00.");
      if (!(dia >= 1 && dia <= 31)) { abre(); return formErr(el, "#f-dia", "O dia tem que ser de 1 a 31."); }
      return { row: f ? f.row : null, antes: f ? f.nome : "", nome, dia, valor, saide, onde: $("#f-onde", el).value.trim() };
    };
    $("#f-ok", el).onclick = () => { const a = dadosOk(); if (a) salvarDaFolha(el, close, () => run("saveFixa", a)); };
    $("#f-pagar", el).onclick = () => {
      const a = dadosOk(); if (!a) return;
      const pg = $("#f-pagar", el);
      if (!cartao()) return salvarDaFolha(el, close, () => run("saveFixa", { ...a, pago: true, data: todaySerial() }), pg);
      if (!lista) return formErr(el, ".cardpick button", "Escolha em qual cartão pagou.");
      if (!fat) return formErr(el, "#f-fat-opts button", "Escolha em qual fatura entra.");
      if (!a.valor) return formErr(el, "#f-valor", "Digite o valor, por exemplo 163,81.");
      salvarDaFolha(el, close, () => run("lancaFixaCartao", { ...a, lista: lista.nome, fat, data: dataSerial }), pg);
    };
    const dp = $("#f-despagar", el);
    if (dp) dp.onclick = () => { const a = dadosOk(); if (a) salvarDaFolha(el, close, () => run("saveFixa", { ...a, pago: false }), dp); };
    if (f) $("#f-del", el).onclick = async () => {
      close();
      if (await confirmSheet("Apagar conta?", `<b>${esc(f.nome)}</b> sai das contas fixas.`, "Apagar", true)) run("delFixa", { row: f.row, antes: f.nome });
    };
  });
}

// Fatura do cartão: "Confirmar: paguei" tira do dinheiro disponível o valor pago (vem preenchido com a
// fatura e pode mudar). Se pagou menos, ou entrou compra depois, a diferença volta para "Para pagar".
function faturaSheet(f) {
  const p = f.pago, dif = p ? Math.round((num(f.valor) - num(p.valor)) * 100) / 100 : 0;
  const sugere = p ? (dif > 0 ? num(f.valor) : num(p.valor)) : num(f.valor);
  openSheet(`Fatura ${titleCase(f.nome)}`, `
    <div class="recibo-linha">
      ${miniCard(f.nome)}
      <div class="recibo-main"><b>Fatura de ${esc(mesCurto())}</b><span>vence ${esc(fmtDate(f.venc, "dow"))} · ${saideChip(f.saide)}</span></div>
      <div class="recibo-v">${brl(f.valor)}</div>
    </div>
    ${p ? `<div class="pago-box"><b>✓ Paga${typeof p.data === "number" ? ` dia ${esc(fmtDate(p.data, "short"))}` : ""}</b>: ${brl(p.valor)} já saiu do dinheiro disponível.${dif > 0 ? `<br>Ainda falta <b>${brl(dif)}</b> desta fatura.` : ""}</div>`
      : `<p class="tip">Pagou a fatura no aplicativo do banco? Confira o valor e toque em <b>Confirmar</b>: ele sai do dinheiro disponível.</p>`}
    <label class="field"><span>${p ? "Valor pago no total" : "Quanto pagou"}</span><input class="input money" id="f-valor" inputmode="decimal" value="${esc(moneyInput(sugere))}">
      <small>Fatura: ${brl(f.valor)}</small></label>
    <div class="stack">
      <button class="btn big" id="f-ok"></button>
      <button class="btn ghost" id="f-ver">Ver as compras do cartão</button>
      ${p ? `<button type="button" class="linkbtn" id="f-despagar">Desmarcar: ainda não paguei</button>` : ""}</div>`, (el, close) => {
    const b = $("#f-ok", el), inp = $("#f-valor", el);
    const upd = () => { const v = parseMoney(inp.value); b.textContent = p ? `Salvar: paguei ${v ? brl(v) : ""}` : `Confirmar: paguei ${v ? brl(v) : ""}`; };
    inp.oninput = upd; upd();
    b.onclick = () => {
      const v = parseMoney(inp.value);
      if (!v || v <= 0) return formErr(el, "#f-valor", "Digite quanto pagou, por exemplo 377,22.");
      salvarDaFolha(el, close, () => run("pagaFatura", { nome: f.nome, valor: v, data: p ? p.data : todaySerial(), pago: true }));
    };
    $("#f-ver", el).onclick = () => { close(); const c = S.m.cartoes.find(x => norm(x.nome) === norm(f.nome)); if (c) { S.card = c.nome; S.tab = "cartao"; } else S.tab = "cartoes"; render(); scrollTo({ top: 0 }); };
    const dp = $("#f-despagar", el);
    if (dp) dp.onclick = () => salvarDaFolha(el, close, () => run("pagaFatura", { nome: f.nome, pago: false }), dp);
  });
}

function valorSheet(title, { nome, valor, nomeEditavel, onSave, onDel, dica, sugestao }) {
  openSheet(title, `
    ${dica ? `<div class="tip">${dica}${typeof sugestao === "number" ? `<br><button type="button" class="linkbtn" id="f-usar">Usar ${brl(sugestao)}</button>` : ""}</div>` : ""}
    ${nomeEditavel ? `<label class="field"><span>Nome</span><input class="input" id="f-nome" autocapitalize="characters" value="${esc(nome || "")}"></label>` : ""}
    <label class="field"><span>Valor</span><input class="input money" id="f-valor" inputmode="decimal" placeholder="ex.: 120,00" value="${esc(moneyInput(valor))}"></label>
    <div class="stack"><button class="btn" id="f-ok">Salvar</button>${onDel ? `<button class="btn danger" id="f-del">Apagar</button>` : ""}</div>`, (el, close) => {
    const usar = $("#f-usar", el); if (usar) usar.onclick = () => { const i = $("#f-valor", el); i.value = moneyInput(sugestao); i.dispatchEvent(new Event("input", { bubbles: true })); i.focus(); };
    $("#f-ok", el).onclick = () => {
      const v = parseMoney($("#f-valor", el).value), n = nomeEditavel ? $("#f-nome", el).value.trim().toUpperCase() : nome;
      if (nomeEditavel && !n) return formErr(el, "#f-nome", "Escreva o nome.");
      if (v === null) return formErr(el, "#f-valor", "Digite o valor, por exemplo 200,00.");
      salvarDaFolha(el, close, () => onSave(n, v));
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
      if (!(melhor >= 1 && melhor <= 31)) return formErr(el, "#f-melhor", "O melhor dia tem que ser de 1 a 31.");
      if (!(dia >= 1 && dia <= 31)) return formErr(el, "#f-dia", "O dia de vencimento tem que ser de 1 a 31.");
      salvarDaFolha(el, close, () => run("saveCartao", { row: c.row, dia, melhor, ajuste: aj }));
    };
    $("#f-ok", el).onclick = () => save(isoToSerial($("#f-aj", el).value));
    const l = $("#f-limpa", el); if (l) l.onclick = () => save(null);
  });
}

function porquinhoSheet(p) {
  openSheet(p ? "Porquinho" : "Anotar saldo", `
    <label class="field"><span>Data</span><input class="input" type="date" id="f-data" value="${esc(p && typeof p.data === "number" ? serialToIso(p.data) : serialToIso(todaySerial()))}"></label>
    <label class="field"><span>Inter</span><input class="input money" id="f-inter" inputmode="decimal" placeholder="ex.: 120,00" value="${esc(p ? moneyInput(p.inter) : "")}"></label>
    <label class="field"><span>Mercado Pago</span><input class="input money" id="f-mp" inputmode="decimal" placeholder="ex.: 120,00" value="${esc(p ? moneyInput(p.mp) : "")}"></label>
    <label class="field"><span>Observação</span><input class="input" id="f-obs" value="${esc(p ? p.obs : "")}"></label>
    <div class="stack"><button class="btn" id="f-ok">Salvar</button>${p ? `<button class="btn danger" id="f-del">Apagar esta linha</button>` : ""}</div>`, (el, close) => {
    $("#f-ok", el).onclick = () => {
      const inter = parseMoney($("#f-inter", el).value), mp = parseMoney($("#f-mp", el).value);
      if (inter === null && mp === null) return formErr(el, "#f-inter", "Digite pelo menos um valor (Inter ou Mercado Pago).");
      salvarDaFolha(el, close, () => run("savePorquinho", { row: p ? p.row : null, data: isoToSerial($("#f-data", el).value) ?? "", inter: inter ?? "", mp: mp ?? "", obs: $("#f-obs", el).value.trim() }));
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
    case "pagar-fixa": { const f = m.fixas.find(x => x.row === row); return f ? pagarSheet(f) : null; }
    case "pagar-fatura": { const f = m.faturas.find(x => x.nome === t.dataset.card); return f ? faturaSheet(f) : null; }
    case "edit-entrada": {
      const en = m.entradas.find(x => x.row === row);
      const segundo = en.principal && row - m.ranges.rEnt === 2;
      const pede = segundo ? pedir2o() : null;
      return valorSheet(en.principal ? (row - m.ranges.rEnt === 1 ? "1º dinheiro" : "2º dinheiro") : "Outro valor", {
        nome: en.nome, valor: en.valor, nomeEditavel: !en.principal,
        dica: segundo ? pedidoHtml(pede) : (en.principal ? "A parte fixa da pensão do Carlos." : null), sugestao: segundo ? pede.valor : undefined,
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
    case "novo-envio-carlos": return envioCarlosSheet(null);
    case "edit-envio-carlos": return envioCarlosSheet(m.entradas.find(x => x.row === row));
    case "fechar": {
      const prox = m.cur ? monthByIdx(m.cur.idx + 1) : null;
      if (await confirmSheet("Fechar o mês?", `O mês de <b>${esc(m.cur ? titleCase(m.cur.nome) : m.mes)}</b> vai ser guardado em ANTERIORES e a planilha passa para <b>${esc(prox ? titleCase(prox.nome) : "o mês seguinte")}</b>.<br><br>As compras que já acabaram saem das listas, os <b>valores das contas fixas e do 1º e 2º dinheiro</b> ficam guardados e o mês novo começa zerado, e os <b>extras do Carlos</b> e o dinheiro que ele mandou no mês saem.<br><br>Faça isso só quando tudo do mês estiver pago.`, "Sim, fechar o mês"))
        run("fecharMes", {}, { busyText: "Fechando o mês…" });
      return;
    }
    case "tema": {
      if (t.dataset.tema) store.set("tema", t.dataset.tema); else store.del("tema");
      if (window.casaTema) window.casaTema();
      return render();
    }
    case "atualizar-app": return atualizarApp();
    case "logout": {
      if (!(await confirmSheet("Sair da conta?", "Para usar de novo, é só entrar com o Google.", "Sair"))) return;
      const tok = Token.get();
      if (tok) { try { await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(tok), { method: "POST" }); } catch (_) {} }
      Token.clear(); store.del("cache"); store.del("email"); S.m = null; S.tab = "inicio"; renderBanner(); render(); return;
    }
  }
});
$$(".tabs [data-tab]").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; render(); scrollTo({ top: 0 }); });
$("#fab").onclick = () => S.m && compraSheet({ cardNome: S.tab === "cartao" ? S.card : null });
// Trocar o mês muda a planilha para todo mundo: pede confirmação sempre (um toque sem querer na seta não basta).
const mudaMes = async (d, alvo) => {
  const x = alvo || (S.m && S.m.cur ? monthByIdx(S.m.cur.idx + d) : null);
  if (!x) return;
  const ok = await confirmSheet("Trocar o mês da planilha?", `A planilha vai mostrar <b>${esc(titleCase(x.nome))}</b> para todo mundo que usa, a Maria também.`, `Mostrar ${titleCase(x.nome)}`);
  if (!ok) return;
  if (await run("setMes", { label: x.label }, { busyText: "Trocando o mês…" })) toast(`A planilha agora está em ${titleCase(x.nome)}.`);
};
// Mês do calendário (mesma conta de idx da aba Tabelas: ano*12 + mês + 1)
$("#mes-prev").onclick = () => mudaMes(-1);
$("#mes-next").onclick = () => mudaMes(1);
// internet caiu / voltou: avisa no topo e, quando volta, atualiza os valores
addEventListener("offline", () => renderBanner());
addEventListener("online", () => { renderBanner(); if (S.m) refresh({ quiet: true }); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.m && Date.now() - (S.at || 0) > 60000) refresh({ quiet: true }); });

/* ======================= modo de teste (?demo) ======================= */
const Demo = {
  g: null,
  // no computador: a cópia real (demo-grid.json, fora do git) se existir; ?demo=ficticio força os inventados
  async load() {
    const real = LOCAL && new URLSearchParams(location.search).get("demo") !== "ficticio";
    if (real) { try { const r = await fetch("demo-grid.json", { cache: "no-store" }); if (r.ok) return r.json(); } catch (e) {} }
    const r = await fetch("demo-ficticio.json", { cache: "no-store" });
    if (!r.ok) throw new Error("Não achei os dados de teste.");
    return r.json();
  },
  async api(path, opts) {
    if (!this.g) this.g = await Demo.load();
    if (path.startsWith("/values:batchGet")) return { valueRanges: [{ values: this.g.main }, { values: this.g.helper }, { values: this.g.tab }] };
    const put = (range, values) => {
      const mm = /^(\w+)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range); if (!mm || mm[1] !== "CASA") return;
      const c0 = mm[2].charCodeAt(0) - 64, r0 = Number(mm[3]);
      values.forEach((row, i) => row.forEach((val, j) => { const R = this.g.main[r0 - 1 + i] || (this.g.main[r0 - 1 + i] = []); R[c0 - 1 + j] = val; }));
      // A:E de uma compra: faz o papel das fórmulas de SITUAÇÃO e NO MÊS (o resto dos totais não recalcula)
      if (c0 === 1 && values.every(row => row.length === 5)) values.forEach((_, i) => this.simulaCompra(r0 - 1 + i));
    };
    const fixTab = r => r.startsWith(`'${FIXTAB}'!`), pagTab = r => r.startsWith(`'${PAGTAB}'!`);
    if (path.startsWith("/values:batchUpdate")) { JSON.parse(opts.body).data.forEach(d => (pagTab(d.range) ? d.range.includes("!A2") && (this.g.pag = d.values) : fixTab(d.range) ? d.range.includes("!A2") && (this.g.fixMes = d.values) : put(d.range, d.values))); return {}; }
    if (path.startsWith("/values:batchClear")) {
      JSON.parse(opts.body).ranges.forEach(r => { if (pagTab(r)) { this.g.pag = []; return; } if (fixTab(r)) { this.g.fixMes = []; return; } const mm = /!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?/.exec(r); const a = mm[1].charCodeAt(0), b = (mm[3] || mm[1]).charCodeAt(0); put(r.split(":")[0], [Array.from({ length: b - a + 1 }, () => "")]); });
      return {};
    }
    if (path.startsWith("/values/")) {
      const range = decodeURIComponent(path.slice(8).split("?")[0]);
      if (fixTab(range)) return { values: this.g.fixMes || [] };
      if (pagTab(range)) return { values: this.g.pag || [] };
      if (!range.startsWith("CASA!")) return { values: this.g.prev || [] };
      const mm = /!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?/.exec(range);
      const c0 = mm[1].charCodeAt(0) - 65, c1 = (mm[3] || mm[1]).charCodeAt(0) - 65, r0 = Number(mm[2]), r1 = Number(mm[4] || mm[2]);
      const values = []; for (let r = r0; r <= r1; r++) values.push((this.g.main[r - 1] || []).slice(c0, c1 + 1));
      return { values };
    }
    if (path.startsWith("?fields") || path.startsWith(":batchUpdate")) throw new Error("No modo de teste não dá para fechar o mês.");
    return {};
  },
  simulaCompra(i) {
    const R = this.g.main[i], H = this.g.helper[i] || (this.g.helper[i] = []);
    const [nome, valor, , parc, fat] = R;
    if (!nome && valor === "") { R[5] = R[6] = ""; H[0] = H[1] = ""; return; }
    const idx = lbl => { const t = this.g.tab.find(x => norm(x[0]) === norm(lbl)); return t ? Number(t[2]) : null; };
    const cur = idx(this.g.main[1][1]), ini = idx(fat);
    if (ini === null || cur === null) { R[5] = "ESCOLHA A 1ª FATURA"; R[6] = 0; return; }
    const n = parc === "FIXO" ? Infinity : Math.max(1, Number(parc) || 1), k = cur - ini + 1;
    H[0] = ini; H[1] = n === Infinity ? "" : ini + n - 1;
    if (k < 1) { R[5] = "FUTURA"; R[6] = 0; }
    else if (k > n) { R[5] = "ACABOU"; R[6] = 0; }
    else { R[5] = parc === "FIXO" ? "FIXO" : n > 1 ? `P ${k}/${n}` : "À VISTA"; R[6] = valor; }
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
    try { await migraEntradas(); } catch (e) {}
    const p = store.get("pending");
    if (p && OPS[p.op] && S.m) { store.del("pending"); run(p.op, p.args); }
  }
})();

let swReg = null; // registro do service worker (para conferir versão nova)
if ("serviceWorker" in navigator && !DEMO) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").then(reg => {
    swReg = reg;
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {}));
  // No iPhone o app volta do segundo plano sem recarregar: confere versão nova toda vez que ela abre o app
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && swReg) swReg.update().catch(() => {}); });
  let hadController = !!navigator.serviceWorker.controller;
  // versão nova: recarrega, mas nunca no meio de um formulário aberto (espera fechar)
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) { store.set("atualizou", 1); if ($("#sheet-root").classList.contains("open")) pendingReload = true; else location.reload(); }
    hadController = true;
  });
  if (store.get("atualizou")) { store.del("atualizou"); setTimeout(() => toast("O app foi atualizado."), 600); }
}

// Botão "Atualizar o app" (Mais): busca a versão nova (o controllerchange recarrega); se não houver, só recarrega.
async function atualizarApp() {
  busy("Procurando versão nova…");
  try { if (swReg) { await swReg.update(); if (swReg.installing || swReg.waiting) { setTimeout(() => location.reload(), 8000); return; } } } catch (_) {}
  location.reload();
}
