#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <DHTesp.h>
#include <ArduinoJson.h>

// =====================================
// PINOS
// =====================================

#define DHTPIN 4

#define PIN_MOVIMENTO 12
#define LED_VERMELHO 5
#define BUZZER_PIN 2

DHTesp dht;

// =====================================
// WIFI
// =====================================

const char* ssid = "Wokwi-GUEST";
const char* password = "";

// =====================================
// FIREBASE
// =====================================

const char* firebase_host =
  "https://vetrecovery-6f390-default-rtdb.firebaseio.com";

WiFiClientSecure secureClient;

// =====================================
// PARAMETROS DO SISTEMA
// =====================================

struct Configuracao {
  float tempMin = 22, tempMax = 28, umidMin = 0, umidMax = 100;
  bool temperatura = true, umidade = false, movimento = false;
  String revisao = "";
};
Configuracao configuracao;
bool configuracaoConfirmada = false;

// Consulta por HTTP antes de cada ciclo. Em falha, mantém a última regra válida.
void receberConfiguracao() {
  HTTPClient http;
  String url = String(firebase_host) + "/vetrecovery/box01/configuracao.json";
  if (!http.begin(secureClient, url)) return;
  http.setTimeout(5000);
  int resposta = http.GET();
  String corpo = resposta == HTTP_CODE_OK ? http.getString() : "";
  http.end();
  if (resposta != HTTP_CODE_OK) {
    Serial.println("Falha ao consultar configuracao. Mantendo regras anteriores.");
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, corpo)) {
    Serial.println("JSON de configuracao invalido. Mantendo regras anteriores.");
    return;
  }
  if (doc.isNull()) {
    configuracao = Configuracao();
    configuracaoConfirmada = false;
    return;
  }
  if (!doc["temperatura_min"].is<float>() || !doc["temperatura_max"].is<float>() ||
      !doc["umidade_min"].is<float>() || !doc["umidade_max"].is<float>() ||
      !doc["alerta_temperatura"].is<bool>() || !doc["alerta_umidade"].is<bool>() ||
      !doc["alerta_movimento"].is<bool>() || !doc["revisao"].is<const char*>()) {
    Serial.println("Configuracao incompleta. Mantendo regras anteriores.");
    return;
  }
  Configuracao nova;
  nova.tempMin = doc["temperatura_min"].as<float>();
  nova.tempMax = doc["temperatura_max"].as<float>();
  nova.umidMin = doc["umidade_min"].as<float>();
  nova.umidMax = doc["umidade_max"].as<float>();
  if (!isfinite(nova.tempMin) || !isfinite(nova.tempMax) ||
      !isfinite(nova.umidMin) || !isfinite(nova.umidMax) ||
      nova.tempMin < -40 || nova.tempMax > 80 || nova.tempMin >= nova.tempMax ||
      nova.umidMin < 0 || nova.umidMax > 100 || nova.umidMin >= nova.umidMax) {
    Serial.println("Limites invalidos. Mantendo regras anteriores.");
    return;
  }
  nova.temperatura = doc["alerta_temperatura"].as<bool>();
  nova.umidade = doc["alerta_umidade"].as<bool>();
  nova.movimento = doc["alerta_movimento"].as<bool>();
  nova.revisao = doc["revisao"].as<String>();
  if (nova.revisao != configuracao.revisao) {
    Serial.print("Configuracao aplicada: ");
    Serial.println(nova.revisao);
  }
  configuracao = nova;
  configuracaoConfirmada = true;
}

unsigned long ultimaLeitura = 0;
const unsigned long intervaloLeitura = 2000;

// =====================================
// CONEXAO WIFI
// =====================================

void setup_wifi() {

  Serial.println("Conectando ao Wi-Fi...");

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("Wi-Fi conectado!");

  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

// =====================================
// ENVIO AO FIREBASE
// =====================================

void enviarFirebase(String payload) {

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi desconectado. Envio cancelado.");
    return;
  }

  HTTPClient http;

  String url = String(firebase_host) +
    "/vetrecovery/box01/telemetria.json";

  http.begin(secureClient, url);

  http.addHeader("Content-Type", "application/json");

  http.setTimeout(5000);

  Serial.println("Enviando dados ao Firebase...");

  int resposta = http.PUT(payload);

  Serial.print("Codigo HTTP: ");
  Serial.println(resposta);

  if (resposta == HTTP_CODE_OK) {

    Serial.println("Dados enviados com sucesso!");

  } else if (resposta > 0) {

    Serial.println("Resposta do servidor:");
    Serial.println(http.getString());

  } else {

    Serial.print("Erro HTTP: ");
    Serial.println(http.errorToString(resposta));

  }

  http.end();
}

// =====================================
// SETUP
// =====================================

void setup() {

  Serial.begin(115200);
  delay(1000);

  dht.setup(DHTPIN, DHTesp::DHT22);

  pinMode(LED_VERMELHO, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(PIN_MOVIMENTO, INPUT);

  setup_wifi();

  ultimaLeitura = millis();

  // Configuracao HTTPS para prototipo
  secureClient.setInsecure();

  Serial.println("==============================");
  Serial.println("VETRECOVERY INICIADO");
  Serial.println("Comunicacao HTTP + FIREBASE");
  Serial.println("==============================");
}

// =====================================
// LOOP
// =====================================

void loop() {

  // Reconexao Wi-Fi
  if (WiFi.status() != WL_CONNECTED) {
    setup_wifi();
  }

  unsigned long agora = millis();

  if (agora - ultimaLeitura >= intervaloLeitura) {

    ultimaLeitura = agora;

    receberConfiguracao();

    // Leitura dos sensores
    TempAndHumidity leitura = dht.getTempAndHumidity();
    float umidade = leitura.humidity;
    float temperatura = leitura.temperature;

    bool movimentoDetectado =
      (digitalRead(PIN_MOVIMENTO) == HIGH);

    // Validacao do sensor
    if (dht.getStatus() != DHTesp::ERROR_NONE || isnan(umidade) || isnan(temperatura)) {

      Serial.print("Erro ao ler DHT22: ");
      Serial.println(dht.getStatusString());
      return;

    }

    // =================================
    // ANALISE AMBIENTAL
    // =================================

    bool alertaTemperatura = configuracao.temperatura &&
      (temperatura < configuracao.tempMin || temperatura > configuracao.tempMax);
    bool alertaUmidade = configuracao.umidade &&
      (umidade < configuracao.umidMin || umidade > configuracao.umidMax);
    bool alertaMovimento = configuracao.movimento && movimentoDetectado;
    bool condicaoAnormal = alertaTemperatura || alertaUmidade || alertaMovimento;

    if (condicaoAnormal) {

      if (alertaTemperatura) Serial.println("[ALERTA] Temperatura fora da faixa!");
      if (alertaUmidade) Serial.println("[ALERTA] Umidade fora da faixa!");
      if (alertaMovimento) Serial.println("[ALERTA] Movimento detectado!");

      digitalWrite(LED_VERMELHO, HIGH);
      tone(BUZZER_PIN, 1000);

    } else {

      digitalWrite(LED_VERMELHO, LOW);
      noTone(BUZZER_PIN);

    }

    if (movimentoDetectado) {
      Serial.println("[AVISO] Movimento detectado!");
    }

    // =================================
    // EXIBICAO LOCAL
    // =================================

    Serial.println();
    Serial.println("===== VETRECOVERY =====");

    Serial.print("Temperatura: ");
    Serial.print(temperatura);
    Serial.println(" C");

    Serial.print("Umidade: ");
    Serial.print(umidade);
    Serial.println(" %");

    Serial.print("Movimento: ");
    Serial.println(movimentoDetectado ? "ATIVO" : "REPOUSO");

    Serial.print("Status: ");
    Serial.println(condicaoAnormal ? "ALERTA" : "NORMAL");

    // =================================
    // MONTAGEM DO JSON
    // =================================

    String payload = "{";

    payload += "\"temperatura\":" + String(temperatura, 1) + ",";
    payload += "\"umidade\":" + String(umidade, 1) + ",";
    payload += "\"movimento\":" +
      String(movimentoDetectado ? 1 : 0) + ",";

    payload += "\"status\":\"";
    payload += condicaoAnormal ? "ALERTA" : "NORMAL";
    payload += "\",";

    payload += "\"led\":\"";
    payload += condicaoAnormal ? "LIGADO" : "DESLIGADO";
    payload += "\",";

    payload += "\"buzzer\":\"";
    payload += condicaoAnormal ? "LIGADO" : "DESLIGADO";
    payload += "\",";

    payload += "\"dispositivo\":\"esp32_01\",";
    payload += "\"configuracao_revisao\":\"";
    payload += configuracaoConfirmada ? configuracao.revisao : "";
    payload += "\",";
    payload += "\"tempo_execucao_ms\":" + String(agora);

    payload += "}";

    Serial.println();
    Serial.println("JSON GERADO:");
    Serial.println(payload);

    // =================================
    // ENVIO HTTP
    // =================================

    enviarFirebase(payload);

    Serial.println("=======================");
  }
}
