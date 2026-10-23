# Ajuste da planilha: dinheiro que o Carlos manda no meio do mês

> **Já feito em 22/10/2026** (pelo Claude, via a API do app, logado como Gabriel), conferido com um envio de teste de R$ 1,00 e desfeito.
> Antes de mexer foi criada a aba oculta **"CASA backup 22-10-2026"** com a CASA como estava. Para desfazer, use Arquivo → Histórico de versões, ou essa aba.
> Atenção ao formato Brasil: nas fórmulas, os argumentos se separam com **;** (com vírgula dá "erro de análise").
> O texto abaixo fica como registro do que foi feito.

Faça **uma vez**, no Google Planilhas, logado numa conta que edita a "CASA 2026" (a do Gabriel serve). Leva uns 3 minutos. Faça num momento em que ninguém esteja lançando nada no app.

Depois do ajuste, cada "O Carlos mandou dinheiro" lançado no app:
- entra na **Sobra final do mês** (é dinheiro que ela tem);
- abate da **Diferença do Carlos** (conta como pagamento da pensão).

Os números de linha abaixo são os da planilha original. Se alguém já tiver inserido linhas, procure pelo **texto** da coluna A.

## 1. Abrir espaço para os envios do Carlos

1. Abra a planilha **CASA 2026**, aba **CASA**.
2. Ache a linha **"TOTAL QUE ENTROU (1º + 2º)"** (linha 14).
3. Clique com o botão direito no **número da linha** (o 14, na margem da esquerda) → **Inserir 6 linhas acima**.
4. Agora as linhas **14 a 19** estão vazias e o "TOTAL QUE ENTROU" foi para a linha **20**. Não precisa escrever nada nelas: o app usa essas linhas sozinho.

## 2. A Sobra final passa a somar essas linhas

1. Ache **"SOBRA FINAL DO MÊS"** no bloco "RESULTADO DO MÊS" (era a linha 50, agora é a **56**) e clique na **coluna C** dela.
2. Na barra de fórmula, o começo é `=C11+C12+C13+C55-(…`.
3. Troque só o pedaço `C12+C13` por:

   ```
   C12+C13+C14+C15+C16+C17+C18+C19
   ```

   O começo fica `=C11+C12+C13+C14+C15+C16+C17+C18+C19+C55-(…`. Não mexa no resto da fórmula. Aperte **Enter**.

## 3. O que entrou do Carlos passa a contar os envios

1. Ache **"Entrou no mês (1º + 2º)"** no bloco do Carlos (era a linha 74, agora é a **80**).
2. Na **coluna A**, troque o texto por: `Entrou do Carlos (1º + 2º + envios)`
3. Na **coluna C** da mesma linha, a fórmula hoje é `=C20`. Troque por:

   ```
   =C20+SOMASE(A12:A19;"CARLOS";C12:C19)
   ```

   Se a planilha mostrar as fórmulas em inglês (`SUMIF`, com vírgulas), use `=C20+SUMIF(A12:A19,"CARLOS",C12:C19)`.

## 4. Conferir

1. No app, em **Contas → "O Carlos mandou dinheiro"**, lance R$ 1,00 de teste.
2. Na planilha, a linha aparece como **CARLOS** (com a data) entre as linhas 13 e 19, a **Sobra final** sobe R$ 1,00 e a **Diferença do Carlos** muda R$ 1,00.
3. Apague o teste no app (toque na linha → Apagar).

O app acha os blocos pelos títulos da coluna A, então não precisa mudar nada nele.
