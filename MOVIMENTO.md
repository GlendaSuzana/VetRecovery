# Gráfico e estatísticas do movimento

No painel principal, o cartão **Atividade do sensor de movimento** apresenta as últimas 60 amostras em degraus: 0 significa sem movimento e 1 significa movimento detectado. O eixo vertical é fixo em 0–1. Não é necessário alterar o ESP32 ou o Firebase para o gráfico funcionar: é usado o campo `movimento` da telemetria atual.

## Frequência e duração

- **Inícios observados**: transições recebidas de 0 para 1. Leituras repetidas em 1 não criam novos eventos.
- **Frequência média observada**: inícios observados por minuto de intervalos acompanhados nesta sessão. Não significa quantidade na última janela de um minuto.
- **Duração observada atual**: tempo estimado do evento ainda ativo, atualizado somente quando chegam leituras.
- **Último evento observado**: duração estimada da atividade que voltou a 0.

Quando disponível, os intervalos usam `tempo_execucao_ms` enviado pelo ESP32; caso contrário, usam o relógio monotônico de recebimento do navegador. Uma mesma amostra do ESP32 não é contada duas vezes. Reinício do dispositivo, mudança de relógio, dados inválidos e intervalos superiores a 15 segundos interrompem a continuidade. Ausência de dados é uma lacuna, nunca um valor 0.

Se o primeiro valor recebido for 1, o início do evento é desconhecido: não é adicionado um início e a duração é identificada como parcial. As durações são estimativas amostradas, não tempos exatos das transições físicas. Movimentos inteiros entre duas leituras podem não ser observados.

## Sessão e histórico

O gráfico e estas estatísticas são da sessão aberta: reiniciam ao recarregar a página ou retornar ao painel. Não são gravados no Firebase pelo navegador e não alteram os registros de ocorrências.

O requisito original de registro de frequência e duração não deve ser considerado totalmente concluído apenas por este gráfico. Na versão atual do firmware, o registro persistente de episódios de movimento em **Ocorrências** depende da regra `alerta_movimento` ativada. O gráfico funciona mesmo com essa regra desativada. Um histórico contínuo de todos os movimentos, independentemente das regras e do navegador, exige que o dispositivo registre esses eventos de forma independente; não foi modificado o firmware nesta etapa.

## Testar

1. Inicie a simulação e abra o painel. Aguarde leituras de movimento em 0.
2. Com a simulação em execução, clique no sensor PIR e em **Simulate Motion**.
3. Quando a leitura 1 chegar ao Firebase, o gráfico sobe para 1 e conta o início observado.
4. Aguarde o PIR voltar a 0: o gráfico desce e a duração observada é apresentada.
5. Para conferir o histórico persistente, ative a regra de alerta por movimento e consulte **Ocorrências**.

Testes locais: `node tests/movimento.cjs` e `node tests/configuracao.cjs` (este último com Playwright e Firebase simulado). Nenhuma escrita de teste é feita no banco real.
