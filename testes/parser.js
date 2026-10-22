// Teste do parse(): roda o parse() de verdade (tirado do app.js) na planilha inventada,
// normal e com os títulos bagunçados (minúsculas, sem acento, espaços), e exige o mesmo resultado.
// Uso: node testes/parser.js   (roda também na Action, antes de publicar)
const fs = require("fs");
const src = fs.readFileSync(process.argv[2] || __dirname + "/../app.js", "utf8");
const pick = re => { const m = src.match(re); if (!m) throw new Error("não achei " + re); return m[0]; };
const code = [
  pick(/const num = .*\n/), pick(/const norm = .*\n/), pick(/const titleCase = .*\n/),
  pick(/function parse\(g\) \{[\s\S]*?\n\}\n/),
].join("\n") + "\nmodule.exports = parse;";
const m = { exports: {} }; new Function("module", code)(m); const parse = m.exports;

const base = JSON.parse(fs.readFileSync(process.argv[3] || __dirname + "/../demo-ficticio.json", "utf8"));
const TITULOS = /^(ENTRADAS|TOTAL QUE ENTROU|FATURAS DOS CARTÕES|C\. |CONTAS FIXAS|TOTAL CONTAS FIXAS|RESULTADO DO MÊS|O QUE O CARLOS DÁ|NUBANK CARLOS|CARTÕES$|TOTAL DAS FATURAS|TOTAL PARCELADO|PORQUINHO|COMPRAS DE CADA CARTÃO|COMPRA$|TOTAL DA FATURA|MÊS [A-Z]+ \d{4}$|CARTÃO )/;
const semAcento = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const jeitos = {
  "minúsculas": s => s.toLowerCase(),
  "Só A Primeira Maiúscula": s => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()),
  "sem acentos": semAcento,
  "espaços nas pontas": s => "  " + s + "   ",
  "espaços duplos no meio": s => s.replace(/ /g, "  "),
  "tudo junto": s => "  " + semAcento(s).toLowerCase().replace(/ /g, "  ") + " ",
};
const resumo = m => JSON.stringify({
  mes: m.cur && m.cur.label, entradas: m.entradas.length, total: m.totalEntrou, faturas: m.faturas.map(f => [f.valor, f.saide]),
  fixas: m.fixas.length, sobra: m.sobraFinal, carlos: m.carlos.total, cartoes: m.cartoes.length,
  proj: Object.keys(m.proj.linhas).length, porq: m.porquinho.length, ranges: m.ranges,
  listas: m.listas.map(l => [norm2(l.nome), l.card.toUpperCase(), l.label, l.itens.length, l.total]),
});
const norm2 = s => semAcento(s).toUpperCase().replace(/\s+/g, " ").trim();
const ok = resumo(parse(base));
const b = parse(base);
console.log(`planilha normal: ${b.listas.length} listas, ${b.cartoes.length} cartões, ${b.fixas.length} linhas de contas fixas, mês ${b.cur.label}, sobra final ${b.sobraFinal.toFixed(2)}`);
let falhas = 0;
for (const [nome, f] of Object.entries(jeitos)) {
  const g = JSON.parse(JSON.stringify(base)); let mexidos = 0;
  g.main.forEach(row => { if (row && typeof row[0] === "string" && TITULOS.test(row[0].trim())) { row[0] = f(row[0]); mexidos++; } });
  g.main.forEach(row => { if (row && row[1] === "VALOR") row[1] = f("VALOR"); });
  g.main[1][1] = f(g.main[1][1]);           // mês em B2
  let r; try { r = resumo(parse(g)) === ok ? "OK" : "DIFERENTE"; } catch (e) { r = "QUEBROU: " + e.message; }
  if (r !== "OK") falhas++;
  console.log(`${r.padEnd(10)} ${nome.padEnd(26)} (${mexidos} títulos mexidos)  ex.: ${JSON.stringify(f("FATURAS DOS CARTÕES"))}`);
}
process.exit(falhas ? 1 : 0);
