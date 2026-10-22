# Casa — contexto para agentes e desenvolvedores

PWA estático (HTML + CSS + JS puro, sem build, sem framework, sem backend) para a Rosany e a Maria lançarem os gastos da casa pelo iPhone. **A fonte de tudo é a planilha "CASA 2026" no Google Drive da Maria**: o app lê os valores já calculados pelas fórmulas e só grava nas células de digitar.

## Regras que não podem ser quebradas

1. **Sem build e sem dependências.** Os arquivos são servidos como estão.
2. **A versão é carimbada pela Action** (`.github/workflows/deploy.yml`): a cada push na `main`, `VERSION` em `sw.js` e `APP_VERSION` em `app.js` viram o hash do commit. Não precisa mudar à mão, mas não renomeie essas duas constantes (a Action falha se não achar). Arquivo novo do app precisa entrar em `SHELL` no `sw.js` **e** no passo "Montar a pasta publicada" da Action.
3. **`config.js` é o único arquivo de configuração** (`GOOGLE_CLIENT_ID`, `SPREADSHEET_ID`).
4. **O app nunca grava em célula com fórmula.** Só nas colunas de digitar: listas de compras (A:E), contas fixas (A:C e E:F — a coluna D é fórmula), entradas (A, C), Carlos (A, C), cartões (C, D, H), porquinho (A:C, F), mês (B2). Sempre `valueInputOption: RAW`; datas vão como número de série (dias desde 30/12/1899).
5. **Os blocos são achados pelos títulos da coluna A** (`parse()` em `app.js`). Se mudar um título na planilha, mudar também no `parse()`.
6. **Antes de editar ou apagar uma linha, conferir que ela ainda é a mesma** (`sameRow`) — duas pessoas usam a mesma planilha.
7. **Escopo do Google: `openid email https://www.googleapis.com/auth/spreadsheets`.** O `drive.file` não serve: a planilha não foi criada pelo app.
8. **O endereço não pode mudar:** `https://gabrielgneder.github.io/casa/` (GitHub Pages da conta do Gabriel). O ID do cliente OAuth é o mesmo do app das receitas (projeto no Google Cloud da Maria); o redirecionamento cadastrado é essa URL com barra no final.
9. **Nada de dados reais no repositório.** `demo-grid.json` (cópia da planilha para testar) fica fora do git.

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | Estrutura e ícones SVG |
| `styles.css` | Visual "carteira": cartões desenhados nas cores da planilha; compras com amarelo = parcelado, verde = última, rosa = todo mês (iguais à planilha) |
| `app.js` | Login Google, leitura/gravação na planilha, telas, fechar o mês |
| `config.js` | ID do cliente OAuth e ID da planilha |
| `sw.js` | Service worker (abre sem internet com os últimos valores) |

## Testar localmente

```
python -m http.server 8090 --bind 127.0.0.1
```

Abrir `http://localhost:8090/?demo` — usa `demo-grid.json` (gerado da planilha recalculada) e não toca no Google. Gravações ficam só na memória e as fórmulas não recalculam.

## Publicar

Commit e push na `main`. A Action confere a sintaxe, carimba a versão e publica (Settings → Pages → Source: **GitHub Actions**). Acompanhe em github.com/gabrielgneder/casa/actions.
