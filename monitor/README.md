# Monitor do Box 01

Use Node.js 24 e mantenha uma instância de `npm start` em execução para acompanhar a telemetria mesmo com o dashboard fechado.

```powershell
Set-Location monitor
npm install
$env:FIREBASE_DATABASE_URL = "https://vetrecovery-6f390-default-rtdb.firebaseio.com"
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:/caminho/credencial.json"
$env:VETRECOVERY_WEBHOOK_URL = "https://seu-endpoint-de-notificacoes"
npm start
```

Use uma conta de serviço do projeto autorizada a acessar o Realtime Database e guarde a credencial fora do repositório. Em um ambiente Google com credenciais padrão disponíveis, a variável com o arquivo é dispensável.

O webhook é opcional e precisa aceitar POST JSON com `id`, `tipo`, `inicio_em` e `box`. Conecte o endpoint ao canal da equipe. A resposta 2xx confirma o recebimento pelo endpoint. O serviço tenta novamente em caso de falha e envia `Idempotency-Key` para que o receptor reconheça reenvios. As entregas começam na primeira ativação do webhook e abrangem as ocorrências persistidas pelo ESP32 e pelo monitor.

No Firebase, permita ao dashboard ler `vetrecovery/box01/atividade/resumo` e `vetrecovery/box01/atividade/movimentos` conforme a política de acesso existente. Indexe `inicio_em` em `atividade/movimentos` e `ocorrencias`. O formulário grava os campos adicionais `modo` e `atividade` na configuração existente. Se as regras de validação enumerarem campos, inclua esses dois.

Em **Limites e condições de alerta**, Rotina começa com quatro inícios em cinco minutos ou 30 segundos de movimento observado. Intensiva começa com três inícios em cinco minutos ou 15 segundos. Personalizada permite editar os três valores. São critérios operacionais ajustáveis. Os limites ambientais continuam disponíveis no mesmo formulário.

O histórico de movimento usa as amostras que chegam ao Firebase e independe da opção de alerta imediato por movimento. Uma lacuna interrompe o episódio e uma leitura já ativa após uma interrupção tem início desconhecido. Como o ESP32 sobrescreve a última telemetria, amostras perdidas durante desconexões não podem ser recuperadas. O painel mostra os 20 registros mais recentes.
