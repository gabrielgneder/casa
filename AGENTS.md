# Casa — contexto para agentes e desenvolvedores

PWA estático (HTML + CSS + JS puro, sem build, sem framework, sem backend) para a Rosany e a Maria lançarem os gastos da casa pelo iPhone. **A fonte de tudo é a planilha "CASA 2026" no Google Drive da Maria**: o app lê os valores já calculados pelas fórmulas e só grava nas células de digitar.

## Regras que não podem ser quebradas

1. **Sem build e sem dependências.** Os arquivos são servidos como estão.
2. **A versão é carimbada pela Action** (`.github/workflows/deploy.yml`): a cada push na `main`, `VERSION` em `sw.js` e `APP_VERSION` em `app.js` viram o hash do commit. Não precisa mudar à mão, mas não renomeie essas duas constantes (a Action falha se não achar). O `index.html` e o `SHELL` do `sw.js` pedem `styles.css?v=dev`, `app.js?v=dev` e `config.js?v=dev`; a Action troca `dev` pelo hash, para um HTML novo nunca rodar com JS/CSS velho do cache. Não escreva `?v=dev` em nenhum outro lugar desses arquivos (a Action conta 3 em cada). Arquivo novo do app precisa entrar em `SHELL` no `sw.js` **e** no passo "Montar a pasta publicada" da Action.
3. **`config.js` é o único arquivo de configuração** (`GOOGLE_CLIENT_ID`, `SPREADSHEET_ID`).
4. **O app nunca grava em célula com fórmula.** Só nas colunas de digitar: listas de compras (A:E), contas fixas (A:C e E:F — a coluna D é fórmula), entradas (A, C; e B nas linhas de "outros valores", que não têm fórmula), Carlos (A:C — B guarda a marca `EXTRA`), cartões (C, D, H), porquinho (A:C, F), mês (B2). Sempre `valueInputOption: RAW`; datas vão como número de série (dias desde 30/12/1899).
5. **Os blocos são achados pelos títulos da coluna A** (`parse()` em `app.js`), comparados com `norm()` (sem acento, espaços extras ou diferença de maiúscula). Se mudar as palavras de um título na planilha, mudar também no `parse()`. `node testes/parser.js` testa o `parse()` com títulos bagunçados (roda na Action); ele extrai do `app.js` as linhas `const num`, `const norm`, `const titleCase` e `function parse` — mantenha cada uma dessas constantes numa linha só.
6. **Antes de editar ou apagar uma linha, conferir que ela ainda é a mesma** (`sameRow`) — duas pessoas usam a mesma planilha.
7. **Escopo do Google: `openid email https://www.googleapis.com/auth/spreadsheets`.** O `drive.file` não serve: a planilha não foi criada pelo app.
8. **O endereço não pode mudar:** `https://gabrielgneder.github.io/casa/` (GitHub Pages da conta do Gabriel). O ID do cliente OAuth é o mesmo do app das receitas (projeto no Google Cloud da Maria); o redirecionamento cadastrado é essa URL com barra no final.
9. **Nada de dados reais no repositório.** `demo-grid.json` (cópia da planilha para testar) fica fora do git. `demo-ficticio.json` é inventado (gerado de uma cópia da planilha com valores falsos, recalculada no Excel) e é publicado para o modo de teste.
10. **O modo de teste (`?demo`) guarda tudo em `casa-demo.*`**, separado do app de verdade (mesmo endereço, mesmo `localStorage`). Não use `localStorage` direto: use `store`.
11. **Formulário nunca fecha antes de gravar.** Use `salvarDaFolha(el, close, () => run(...))` (a folha só fecha quando a planilha confirmar; se falhar, o que foi digitado fica) e `formErr(el, campo, msg)` para erro junto do campo. Escolhas usam `pressed()`/`marca()` (aria-pressed). Trocar o mês sempre pede confirmação.

## Regras do mês (combinadas com o Gabriel em 2026-10-22)

- **Contas fixas:** a Rosany lança o valor certo todo mês. O **Fechar o mês** deixa só a coluna Valor (C) em branco; nome, dia, "sai de" e "onde pagar" ficam. O app mostra "Lançar" e o valor do mês passado (lido do topo de ANTERIORES).
- **Pensão do Carlos = 5.000 fixos + contas extras.** Tudo que ele manda é pagamento da pensão.
  - **Extra do Carlos** (compra que ele paga, fora dos cartões): no botão Compra → "Extra do Carlos". Vai para o bloco "O QUE O CARLOS DÁ" com `EXTRA` na coluna B e sai no fechamento. Itens sem `EXTRA` (Netflix, INSS…) são fixos e ficam.
  - **Dinheiro que o Carlos mandou no meio do mês:** linha `CARLOS` nas "outras entradas" (B = data, C = valor). Soma na Sobra final e abate (ajuste da planilha em `PLANILHA-AJUSTE-CARLOS.md`, já feito) da diferença do Carlos. Sai no fechamento.
  - **2º dinheiro é variável:** o app sugere quanto pedir ao Carlos = 2º dinheiro atual − Sobra final (o que zera a sobra).
- Planilha ajustada em 22/10/2026 (6 linhas em ENTRADAS, fórmulas da Sobra final e do "Entrou do Carlos"); backup oculto "CASA backup 22-10-2026". Fórmulas na planilha são no formato Brasil (separador `;`). O "Previsto livre p/ cartão" (C57) também soma os envios do Carlos.
- **Verde do Início = "Pode gastar este mês"** = Sobra final da planilha (pedido da Rosany em 22/10/2026). Embaixo do valor, a conta linha a linha (`contaMes()`): dinheiro que entrou − contas fixas − parcelas que continuam (coluna "Já previsto" das faturas) − compras novas do mês. Cada compra lançada diminui o verde. A antiga barra amarela "Ainda pode gastar no cartão" (baseada no "Previsto livre p/ cartão") foi tirada: dois números parecidos e diferentes confundiam. Não criar outro número de "quanto pode gastar".
- **1º dinheiro = 5.000** (parte fixa). Se ele mandar mais junto, a diferença vai como "O Carlos mandou dinheiro" (ex.: 31/10/2026, 5.500 = 5.000 + 500).

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | Estrutura e ícones SVG |
| `styles.css` | Visual "carteira": cartões desenhados nas cores da planilha; compras com amarelo = parcelado, verde = última, rosa = todo mês (iguais à planilha). Modo dia/noite: cor que depende do fundo é variável em `:root`, e `:root[data-theme="dark"]` troca as variáveis — não use cor fixa para fundo, texto ou borda de superfície |
| `app.js` | Login Google, leitura/gravação na planilha, telas, fechar o mês |
| `config.js` | ID do cliente OAuth e ID da planilha |
| `sw.js` | Service worker (abre sem internet com os últimos valores) |

## Testar localmente

```
python -m http.server 8090 --bind 127.0.0.1
```

Abrir `http://localhost:8090/?demo` — usa `demo-grid.json` se existir (cópia real), senão `demo-ficticio.json`; `?demo=ficticio` força os inventados. Não toca no Google. Gravações ficam só na memória e as fórmulas não recalculam.

No celular: `https://gabrielgneder.github.io/casa/?demo` (sempre dados inventados).

## Publicar

Commit e push na `main`. A Action confere a sintaxe, carimba a versão e publica (Settings → Pages → Source: **GitHub Actions**). Acompanhe em github.com/gabrielgneder/casa/actions.
