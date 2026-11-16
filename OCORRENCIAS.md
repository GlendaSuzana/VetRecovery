# Ocorrências do VetRecovery

## O que já funciona no dashboard

A página **Ocorrências**, acessível pelo botão **Ver ocorrências** no painel principal, consulta `vetrecovery/box01/ocorrencias` em tempo real. Mostra 50 registros inicialmente e permite carregar mais 50 por vez. Os totais e filtros consideram somente os registros carregados, não todo o banco.

- Filtros por tipo (temperatura, umidade, movimento), situação e data de início.
- Lista do mais recente para o mais antigo, com início, duração observada/final e revisão da equipe.
- Tabela de detalhes com nove linhas: tipo de ocorrência, local, data e hora de início, temperatura inicial, regra aplicada, situação, data e hora de encerramento, duração e identificação do dispositivo. Observações e revisão ficam abaixo da tabela.
- Formulário de observações (até 2.000 caracteres) e marcação de revisão, com salvamento no Firebase.
- Dados do episódio são somente leitura. Revisão pela equipe não encerra nem apaga o alerta.
- Datas no fuso America/Fortaleza. O período filtra a data de início, incluindo os dias selecionados.
- Um episódio em andamento sem atualização há mais de 30 segundos recebe aviso de comunicação. Não é encerrado automaticamente. A duração observada é calculada até a última atualização recebida, não até o relógio do navegador.
- Erros de acesso são apresentados separadamente: erro na consulta de ocorrências não interrompe a telemetria e as configurações.

## Integração do ESP32 preparada

O navegador não cria episódios a partir da telemetria. Isso evita depender de uma aba aberta e evita registros duplicados entre abas. Até o código do Wokwi ser integrado e enviar episódios, a seção deve mostrar **Nenhuma ocorrência registrada**.

A integração está preparada em `wokwi/sketch.ino` e `wokwi/ocorrencias.h`, usando o sketch enviado pela usuária em 13/11 como base. A instalação e os limites da rotina estão descritos em `wokwi/LEIA-ME.md`. É necessário copiar os arquivos para o projeto no Wokwi para executá-la.

Fluxo esperado:

1. Consultar a configuração salva pelo site.
2. Ao entrar numa condição, criar um ID único e estável para o episódio e salvar sua leitura e regra inicial.
3. Nas leituras seguintes, atualizar o mesmo ID enquanto a condição persistir (não criar uma ocorrência por leitura).
4. Quando a condição terminar, registrar fim, leitura final e motivo do encerramento.
5. Condições diferentes podem ter episódios simultâneos.
6. Se a configuração mudar e encerrar a condição, informar esse motivo, preservando a regra inicial. Se passar de temperatura alta para baixa, encerrar uma ocorrência e abrir outra.
7. Se houver falha de leitura/reinício, não afirmar retorno à normalidade. Na retomada, reconciliar o episódio aberto ou registrar interrupção com motivo explícito.
8. Retentativas de rede devem usar o mesmo ID para não duplicar episódios. Persistência de eventos durante falhas prolongadas depende da estratégia a implementar no dispositivo.

## Contrato de dados para a integração

Exemplo ilustrativo; não é carregado automaticamente no banco:

```json
{
  "tipo": "temperatura_alta",
  "estado": "encerrada",
  "box": "Box 01",
  "dispositivo": "esp32_01",
  "inicio_em": 1794578400000,
  "fim_em": 1794578700000,
  "ultima_atualizacao_em": 1794578700000,
  "leitura_inicial": { "temperatura": 30, "umidade": 50, "movimento": 0 },
  "ultima_leitura": { "temperatura": 27, "umidade": 50, "movimento": 0 },
  "leitura_final": { "temperatura": 27, "umidade": 50, "movimento": 0 },
  "regra": { "ativa": true, "min": 22, "max": 28 },
  "configuracao_revisao": "ID-da-configuracao",
  "motivo_encerramento": "Retorno à faixa configurada",
  "acompanhamento": {
    "revisada": true,
    "observacao": "Condições verificadas pela equipe.",
    "atualizado_em": 1794578760000
  }
}
```

- Caminho de cada objeto: `vetrecovery/box01/ocorrencias/{id}`.
- `tipo`: `temperatura_alta`, `temperatura_baixa`, `umidade_alta`, `umidade_baixa` ou `movimento`.
- `estado`: `em_andamento`, `encerrada` ou `interrompida`.
- Datas: número Unix em **milissegundos**, com relógio sincronizado; `millis()` do ESP32 não é uma data real. Ausência de horário deve ser representada como ausência/null, nunca como horário inventado pelo navegador.
- Em andamento: omitir `fim_em` e `leitura_final`; enviar `ultima_atualizacao_em` e `ultima_leitura` periodicamente, mesmo se o valor não variar.
- A duração exibida é calculada pelas datas; se elas faltarem ou estiverem invertidas, aparece “Não informada”.
- `regra`: snapshot dos limites no início do episódio. Movimento usa `{ "ativa": true }`.
- O dispositivo deve criar o registro e depois usar **PATCH** somente nos campos do episódio. Não usar PUT do objeto inteiro sobre um registro existente, pois isso apagaria o acompanhamento da equipe.
- O dashboard grava com `update` somente em `{id}/acompanhamento`: observação, revisão e timestamp do servidor. Várias pessoas podem editar; prevalece o último salvamento confirmado. Não há identificação autenticada do autor nesta etapa.
- Não existe comando de encerramento manual do episódio no dashboard.

## Firebase / administrador

Nenhum dado ou regra do Firebase real foi alterado nesta implementação. Caminhos surgem na primeira gravação autorizada; não é necessário cadastrar campos manualmente.

Solicitar ao administrador:

- Leitura dos registros de ocorrências pelo dashboard.
- Escrita dos campos dos episódios pelo dispositivo, quando for integrado.
- Leitura/escrita de `{id}/acompanhamento` pelo cliente do dashboard, conforme o controle de acesso do projeto.
- Índice `.indexOn: ["inicio_em"]` no nó `vetrecovery/box01/ocorrencias`, para a consulta ordenada. Acrescentar o índice às regras existentes; não substituir o conjunto de permissões.
- Validar tipos e tamanho da observação nas regras do banco. A validação do formulário não substitui a validação no servidor.

## Como conferir

1. Abra `index.html` pelo Live Server e clique em **Ver ocorrências**. A página também pode ser aberta diretamente em `ocorrencias.html`. Use **Voltar ao painel** para retornar.
2. Sem registros no Firebase, verá a mensagem de lista vazia; com permissão negada, verá a mensagem correspondente.
3. Após copiar os arquivos para o Wokwi, cada episódio enviado com sucesso aparece automaticamente. As saídas locais também usam os limites e alertas imediatos salvos no painel.
4. Clique em **Ver detalhes**, registre uma observação, marque revisão e salve. O sucesso é mostrado somente quando o Firebase confirmar. Falhas mantêm o rascunho no formulário.
5. Feche e abra os detalhes para consultar o acompanhamento salvo. Os limites continuam sendo alterados na seção de configuração existente.

## Testes

- `node --check script.js`
- `node tests/configuracao.cjs`
- `node tests/ocorrencias.cjs`

Os testes de navegador usam Playwright com Microsoft Edge e um Firebase simulado, sem gravações no banco real. Cobrem consulta vazia, filtros, datas, detalhes, duração, falta de atualização, escrita parcial, falha de escrita/leitura, preservação de formulário, texto tratado com segurança, carregamento de mais registros e layout mobile.
