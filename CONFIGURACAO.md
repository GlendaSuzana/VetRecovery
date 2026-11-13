# Configuração de limites e regras — VetRecovery

## Executar

1. Abra `index.html` usando um servidor local (por exemplo, Live Server no VS Code).
2. No Wokwi, substitua o conteúdo de `sketch.ino` pelo de `wokwi/sketch.ino` deste projeto.
3. Em `libraries.txt` do Wokwi, use `DHT sensor library for ESPx` e `ArduinoJson` (versão 7). Preserve outras bibliotecas de que seu projeto precise.
4. Mantenha o diagrama e os pinos existentes: DHT22 4, PIR 12, LED 5, buzzer 2.
5. Inicie a simulação. No site, vá a **Limites e condições de alerta**, ajuste os campos e clique em **Salvar configurações**.
6. Aguarde a indicação **ESP32 confirmou esta configuração na última telemetria recebida**. A confirmação depende de uma consulta HTTP e de um envio de telemetria bem-sucedidos; o tempo varia com a rede.

O sketch foi adaptado da última versão compartilhada na conversa. Se o sketch usado atualmente no Wokwi tiver alterações posteriores, compare antes de substituí-lo.

## Persistência e permissões

O dashboard lê e grava em `vetrecovery/box01/configuracao`, separado de `vetrecovery/box01/telemetria`. O ESP32 consulta a configuração com HTTP GET e mantém o HTTP PUT da telemetria.

As regras existentes do Realtime Database precisam permitir leitura e escrita da configuração para o cliente utilizado pelo projeto e leitura para o ESP32. Não foram alteradas regras nem dados do Firebase real. Em caso de acesso negado, o painel informa o caminho que precisa de permissão. Não substitua todas as regras por acesso público para resolver esse erro.

A configuração contém `temperatura_min`, `temperatura_max`, `umidade_min`, `umidade_max`, `alerta_temperatura`, `alerta_umidade`, `alerta_movimento`, `revisao` e `atualizado_em` (timestamp do servidor). A telemetria retorna `configuracao_revisao` para confirmar a versão aplicada pelo ESP32.

## Comportamento

- Inicialmente, temperatura ativa entre 22 e 28 °C; umidade e movimento não geram alerta. Os valores de umidade 0–100% são limites de preenchimento, não uma recomendação clínica.
- Valores iguais aos limites são aceitos. Qualquer regra ativa atendida gera alerta (lógica OU); várias causas aparecem juntas.
- Mínima precisa ser menor que máxima. Faixas aceitas: temperatura -40 a 80 °C, umidade 0 a 100%.
- Editar ou preencher padrões não aplica nada até salvar. O salvamento confirmado pelo Firebase atualiza o painel. O ESP32 aplica na próxima consulta bem-sucedida e confirma pela telemetria.
- O painel continua mostrando os estados reais de LED e buzzer informados pelo ESP32; não simula seu acionamento.
- O ESP32 mantém a última configuração válida em memória se uma consulta falhar. Ao reiniciar sem acesso ao Firebase, usa os padrões. Se a configuração for removida do banco, volta aos padrões.
- A confirmação significa que a última telemetria informou aquela versão; não é uma garantia de que o dispositivo ainda esteja online.

## Comparativo e demonstração

Antes, a temperatura tinha limites fixos de 22–28 °C e o painel seguia o status do ESP32. Agora as faixas e regras podem ser alteradas pelo site e persistem no Firebase.

1. Coloque 25 °C e 50% no DHT22, PIR sem movimento. Salve os padrões: nenhuma regra acionada.
2. Mude apenas a temperatura máxima no site para 24 °C e salve: painel alerta; após confirmação, LED e buzzer ligam sem alterar a temperatura simulada.
3. Mude a máxima para 28 °C e salve: a condição volta ao normal e o circuito desliga a sinalização após aplicar a configuração.
4. Ative umidade com faixa 40–60%. Mude a simulação para 70%: alerta de umidade no painel e sinalização no circuito.
5. Volte para 50%, ative alerta por movimento e acione o PIR: aparece a causa movimento e a sinalização é acionada.
6. Tente mínima maior que máxima: salvamento bloqueado. Recarregue a página após um salvamento válido: os campos devem carregar os valores do Firebase.

Sem atualizar o sketch no Wokwi, o site já avalia suas regras, mas o LED e o buzzer continuam seguindo o programa antigo. Nesse caso, a confirmação permanece pendente.

## Verificação feita

`node --check script.js` e `tests/configuracao.cjs` (Playwright com Edge e Firebase simulado). Os testes cobrem regras, validação, confirmação, leituras ausentes, erros de acesso e layout mobile. Não escrevem no Firebase real. A compilação e a execução do ESP32 no Wokwi ainda precisam ser feitas com os passos acima.

Para repetir o teste, instale/disponibilize Playwright e execute `node tests/configuracao.cjs` com Microsoft Edge instalado.
