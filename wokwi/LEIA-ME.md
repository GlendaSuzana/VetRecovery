# Instalar a rotina de ocorrências no Wokwi

## Arquivos

1. Substitua o conteúdo de `sketch.ino` pelo arquivo `sketch.ino` desta pasta.
2. No Wokwi, crie uma nova aba/arquivo chamado **ocorrencias.h** e copie o conteúdo do arquivo de mesmo nome desta pasta. O nome deve ser exatamente esse, pois o sketch usa `#include "ocorrencias.h"`.
3. Use o `libraries.txt` do projeto no Wokwi, com DHT sensor library, PubSubClient e ArduinoJson 7.4.2.
4. Não altere `diagram.json`, os pinos nem as ligações.
5. Inicie a simulação e abra o dashboard pelo servidor local.

## O que foi preservado

O sketch usado como base é o enviado na conversa em 13/11. Todas as instruções originais foram mantidas, incluindo:

- DHT.h, DHT22 no GPIO 4, PIR no 12, LED no 5 e buzzer no 2;
- leitura a cada intervalo mínimo de 2 segundos, validação e mensagens existentes;
- faixa padrão de temperatura de 22–28 °C até a consulta de uma configuração válida;
- Wi-Fi, endereço do banco, HTTPS e HTTP PUT da telemetria original;
- formato dos dados já enviados ao painel.

As regras do Firebase também controlam a sinalização local. Qualquer regra imediata ativa pode ligar o LED e o buzzer.

A telemetria inclui a revisão aplicada para confirmação pelo painel. Se a consulta falhar, o ESP32 mantém a última configuração válida em memória.

## Como observar a nova funcionalidade

1. Com a simulação ligada, no site ative a regra de temperatura com faixa de 22–28 °C e salve.
2. Se o DHT22 estiver em 23,9 °C, configure a máxima no site para 23 °C (mínima 22 °C). Não é necessário alterar o sensor para demonstrar o registro.
3. Após a consulta das regras e o próximo envio, deve aparecer uma ocorrência de temperatura alta.
4. Abra **Ver detalhes**: estarão presentes tipo, local, início, temperatura inicial, faixa usada, situação, fim, duração e dispositivo.
5. Registre uma observação pelo site. As atualizações do ESP32 não devem apagar esse acompanhamento.
6. No site, volte a máxima para 28 °C e salve. O episódio anterior será encerrado com motivo de alteração da configuração.
7. Para testar sem depender do site aberto, mantenha a simulação rodando, feche o dashboard, mude as condições do sensor e depois abra o site: os episódios enviados ao Firebase continuarão disponíveis.

Para um exemplo em que a regra não muda durante o episódio: mantenha 22–28 °C, simule 30 °C no DHT22, aguarde o registro e depois volte a 25 °C. O mesmo ID será encerrado; não surge um registro por leitura.

## Mensagens e tempos

- `[OCORRENCIAS] Rotina iniciada`: nova rotina disponível.
- `[OCORRENCIAS] Relogio sincronizado`: datas reais disponíveis.
- `[OCORRENCIAS] Inicio`: criado um episódio local.
- `[OCORRENCIAS] Episodios sincronizados com o Firebase`: gravação confirmada.
- Erro HTTP 401/403: conferir permissões no Firebase com o administrador.

Configuração e envio de ocorrências são tentados a cada 10 segundos. O tempo percebido depende também dos envios HTTP originais, da rede e da simulação. O transporte das ocorrências roda em uma tarefa separada (FreeRTOS), com cliente HTTPS próprio: o loop original apenas enfileira uma cópia da leitura, sem aguardar as requisições novas. O transporte usa timeout HTTP e de conexão de 1,5 s e handshake TLS de 2 s; compartilha CPU e rede com a aplicação, mas não acrescenta essas esperas ao fluxo original dos sensores.

Antes da primeira consulta bem-sucedida das regras, nenhuma ocorrência nova é inferida. Se o caminho de configuração não existir, usa os padrões: temperatura ativa 22–28 °C, umidade e movimento desativados. Se consultas posteriores falharem, mantém a última regra válida em memória.

## Falhas e recuperação

- O início/fim de cada episódio usa um ID fixo nas retentativas. O envio usa PATCH dos campos do dispositivo, sem sobrescrever `acompanhamento`.
- A fila de entrada comporta 64 amostras. Se a tarefa de transporte não acompanhar o ritmo, a perda é sinalizada no serial e os episódios afetados são interrompidos na retomada, sem afirmar continuidade não observada.
- Até 16 episódios ativos ou pendentes são mantidos. Na lotação, o monitoramento original continua; novos inícios deixam de ser registrados até liberar espaço, com aviso explícito no serial. Não é uma fila ilimitada.
- O estado inicial e as transições são persistidos na NVS do ESP32 quando disponível. Atualizações periódicas não são gravadas na flash para evitar desgaste.
- Após reinício, episódios anteriormente abertos são consultados no Firebase e marcados como interrompidos, sem inventar horário de fim. Episódios já encerrados no banco não são reabertos. Fechamentos pendentes são reenviados.
- A retenção da NVS ao parar/reiniciar a simulação depende do ambiente Wokwi; não há garantia de persistência ao recriar o projeto virtual ou apagar a flash.
- Datas reais dependem de sincronização SNTP. Episódios novos aguardam horário válido antes do envio. Um episódio recuperado de reinício anterior à sincronização pode ficar sem data conhecida; o dashboard informa a ausência.
- Uma leitura inválida interrompe o episódio ambiental afetado; não é tratada como retorno à normalidade. Falhas/gaps superiores a 15 segundos entre amostras também interrompem episódios anteriores.
- A reconexão Wi-Fi bloqueante já existente foi preservada. Não se recuperam leituras ou movimentos que não tenham sido observados enquanto o programa estava sem amostrar sensores.

## Firebase

A nova rotina lê `vetrecovery/box01/configuracao` e lê/grava `vetrecovery/box01/ocorrencias`. A permissão de leitura também é necessária para reconciliar episódios após reinício. Não foram alteradas regras nem criados registros de teste no banco real.

No nó de ocorrências, o administrador deve preservar as permissões existentes e acrescentar o índice `inicio_em` se necessário para a lista ordenada. Observações continuam sendo gravadas somente pelo dashboard em `{id}/acompanhamento`.

## Validação no Wokwi

A versão anterior foi compilada localmente. Esta revisão precisa ser compilada e executada no Wokwi.

Compile o projeto e confira a confirmação da configuração, as saídas e o envio ao Firebase na simulação.
