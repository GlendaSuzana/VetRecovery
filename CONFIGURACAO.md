# Configuração de limites e regras — VetRecovery

## Executar

1. Abra `index.html` usando um servidor local (por exemplo, Live Server no VS Code).
2. No Wokwi, substitua o conteúdo de `sketch.ino` pelo de `wokwi/sketch.ino` deste projeto.
3. Copie `wokwi/ocorrencias.h` para a aba de mesmo nome e use a lista de bibliotecas do projeto Wokwi, que já inclui ArduinoJson 7.4.2.
4. Mantenha o diagrama e os pinos existentes: DHT22 4, PIR 12, LED 5, buzzer 2.
5. Inicie a simulação. No site, vá a **Limites e condições de alerta**, ajuste os campos e clique em **Salvar configurações**.
6. O ESP32 consulta o Firebase a cada 10 segundos e aplica as regras válidas à sinalização local e às ocorrências.

O sketch foi adaptado da última versão compartilhada na conversa. Se o sketch usado atualmente no Wokwi tiver alterações posteriores, compare antes de substituí-lo.

## Persistência e permissões

O dashboard lê e grava em `vetrecovery/box01/configuracao`, separado de `vetrecovery/box01/telemetria`. O ESP32 consulta a configuração com HTTP GET e mantém o HTTP PUT da telemetria.

As regras existentes do Realtime Database precisam permitir leitura e escrita da configuração para o cliente utilizado pelo projeto e leitura para o ESP32. Não foram alteradas regras nem dados do Firebase real. Em caso de acesso negado, o painel informa o caminho que precisa de permissão. Não substitua todas as regras por acesso público para resolver esse erro.

A configuração inclui limites, regras ativas, modo de observação, revisão e horário de salvamento. O ESP32 informa a revisão aplicada na telemetria e nos episódios.

## Comportamento

- Inicialmente, temperatura ativa entre 22 e 28 °C; umidade e movimento não geram alerta. Os valores de umidade 0–100% são limites de preenchimento, não uma recomendação clínica.
- Valores iguais aos limites são aceitos. Qualquer regra ativa atendida gera alerta (lógica OU); várias causas aparecem juntas.
- Mínima precisa ser menor que máxima. Faixas aceitas: temperatura -40 a 80 °C, umidade 0 a 100%.
- Edite e salve para aplicar ao painel. Quando o ESP32 consulta a revisão, as regras de temperatura, umidade e movimento imediato passam a controlar LED e buzzer.
- O painel continua mostrando os estados reais de LED e buzzer informados pelo ESP32; não simula seu acionamento.
- A rotina de ocorrências aguarda a primeira consulta válida. Depois disso, mantém a última configuração válida em memória se uma consulta falhar. Se a configuração não existir no banco, usa os padrões.
- A confirmação significa que a última telemetria informou aquela versão; não é uma garantia de que o dispositivo ainda esteja online.

## Comparativo e demonstração

Antes, a temperatura tinha limites fixos de 22–28 °C e o painel seguia o status do ESP32. Agora as faixas e regras podem ser alteradas pelo site e persistem no Firebase.

1. Coloque 25 °C e 50% no DHT22, PIR sem movimento. Salve os padrões: nenhuma regra acionada.
2. Mude a temperatura máxima para 24 °C com o DHT22 em 25 °C. Após a confirmação do ESP32, verifique o LED, o buzzer e a ocorrência.
3. Mude a máxima para 28 °C e salve: a condição do painel volta ao normal e o episódio anterior é encerrado pela rotina de ocorrências.
4. Ative umidade com faixa 40–60%. Mude a simulação para 70%: alerta de umidade no painel e ocorrência registrada.
5. Volte para 50%, ative alerta por movimento e acione o PIR: aparece a causa movimento e a ocorrência é registrada.
6. Tente mínima maior que máxima: salvamento bloqueado. Recarregue a página após um salvamento válido: os campos devem carregar os valores do Firebase.

Os critérios de movimento recorrente e prolongado são avaliados pelo serviço de monitoramento.

## Verificação feita

`node --check script.js` e `tests/configuracao.cjs` (Playwright com Edge e Firebase simulado). Os testes cobrem regras, validação, confirmação, leituras ausentes, erros de acesso e layout mobile. Não escrevem no Firebase real. A execução integrada no Wokwi precisa ser conferida após copiar os arquivos indicados.

Para repetir o teste, instale/disponibilize Playwright e execute `node tests/configuracao.cjs` com Microsoft Edge instalado.
