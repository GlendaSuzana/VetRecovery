# Configuração de limites e regras — VetRecovery

## Executar

1. Abra `index.html` usando um servidor local (por exemplo, Live Server no VS Code).
2. No Wokwi, substitua o conteúdo de `sketch.ino` pelo de `wokwi/sketch.ino` deste projeto.
3. Copie também `wokwi/ocorrencias.h` para uma aba de mesmo nome no Wokwi e use o `wokwi/libraries.txt` desta pasta: DHT sensor library, PubSubClient e ArduinoJson 7.4.2.
4. Mantenha o diagrama e os pinos existentes: DHT22 4, PIR 12, LED 5, buzzer 2.
5. Inicie a simulação. No site, vá a **Limites e condições de alerta**, ajuste os campos e clique em **Salvar configurações**.
6. O painel aplica as regras após confirmar o salvamento no banco. O sketch atual preserva as saídas originais fixas em 22–28 °C; a rotina nova consulta as regras para registrar ocorrências. Consulte `wokwi/LEIA-ME.md` para instalação e teste.

O sketch foi adaptado da última versão compartilhada na conversa. Se o sketch usado atualmente no Wokwi tiver alterações posteriores, compare antes de substituí-lo.

## Persistência e permissões

O dashboard lê e grava em `vetrecovery/box01/configuracao`, separado de `vetrecovery/box01/telemetria`. O ESP32 consulta a configuração com HTTP GET e mantém o HTTP PUT da telemetria.

As regras existentes do Realtime Database precisam permitir leitura e escrita da configuração para o cliente utilizado pelo projeto e leitura para o ESP32. Não foram alteradas regras nem dados do Firebase real. Em caso de acesso negado, o painel informa o caminho que precisa de permissão. Não substitua todas as regras por acesso público para resolver esse erro.

A configuração contém `temperatura_min`, `temperatura_max`, `umidade_min`, `umidade_max`, `alerta_temperatura`, `alerta_umidade`, `alerta_movimento`, `revisao` e `atualizado_em` (timestamp do servidor). A rotina de ocorrências registra `configuracao_revisao` em cada episódio. O sketch atual não emite a confirmação geral na telemetria, pois preserva o comportamento original das saídas; o indicador geral de confirmação permanece pendente.

## Comportamento

- Inicialmente, temperatura ativa entre 22 e 28 °C; umidade e movimento não geram alerta. Os valores de umidade 0–100% são limites de preenchimento, não uma recomendação clínica.
- Valores iguais aos limites são aceitos. Qualquer regra ativa atendida gera alerta (lógica OU); várias causas aparecem juntas.
- Mínima precisa ser menor que máxima. Faixas aceitas: temperatura -40 a 80 °C, umidade 0 a 100%.
- Editar ou preencher padrões não aplica nada até salvar. O salvamento confirmado pelo Firebase atualiza o painel. A rotina de ocorrências usa as regras após consultá-las; o controle original do LED e do buzzer foi mantido, conforme o escopo solicitado.
- O painel continua mostrando os estados reais de LED e buzzer informados pelo ESP32; não simula seu acionamento.
- A rotina de ocorrências aguarda a primeira consulta válida. Depois disso, mantém a última configuração válida em memória se uma consulta falhar. Se a configuração não existir no banco, usa os padrões.
- A confirmação significa que a última telemetria informou aquela versão; não é uma garantia de que o dispositivo ainda esteja online.

## Comparativo e demonstração

Antes, a temperatura tinha limites fixos de 22–28 °C e o painel seguia o status do ESP32. Agora as faixas e regras podem ser alteradas pelo site e persistem no Firebase.

1. Coloque 25 °C e 50% no DHT22, PIR sem movimento. Salve os padrões: nenhuma regra acionada.
2. Mude apenas a temperatura máxima no site para 24 °C e salve: o painel alerta e a rotina registra o episódio após consultar a nova regra. LED e buzzer continuam seguindo os limites fixos do sketch original.
3. Mude a máxima para 28 °C e salve: a condição do painel volta ao normal e o episódio anterior é encerrado pela rotina de ocorrências.
4. Ative umidade com faixa 40–60%. Mude a simulação para 70%: alerta de umidade no painel e ocorrência registrada.
5. Volte para 50%, ative alerta por movimento e acione o PIR: aparece a causa movimento e a ocorrência é registrada.
6. Tente mínima maior que máxima: salvamento bloqueado. Recarregue a página após um salvamento válido: os campos devem carregar os valores do Firebase.

O site avalia suas regras independentemente das saídas locais. Nesta versão, inclusive após instalar a rotina de ocorrências, LED, buzzer e o status original continuam seguindo 22–28 °C. Alterar esse controle não faz parte da integração de ocorrências solicitada.

## Verificação feita

`node --check script.js` e `tests/configuracao.cjs` (Playwright com Edge e Firebase simulado). Os testes cobrem regras, validação, confirmação, leituras ausentes, erros de acesso e layout mobile. Não escrevem no Firebase real. A execução integrada no Wokwi precisa ser conferida após copiar os arquivos indicados.

Para repetir o teste, instale/disponibilize Playwright e execute `node tests/configuracao.cjs` com Microsoft Edge instalado.
