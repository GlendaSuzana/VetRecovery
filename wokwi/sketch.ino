#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <DHT.h>
#include "ocorrencias.h"

RegistroOcorrencias registroOcorrencias;

// =====================================
// PINOS
// =====================================

#define DHTPIN 4
#define DHTTYPE DHT22
#define PIN_MOVIMENTO 12
#define LED_VERMELHO 5
#define BUZZER_PIN 2

DHT dht(DHTPIN, DHTTYPE);

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

  dht.begin();

  pinMode(LED_VERMELHO, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(PIN_MOVIMENTO, INPUT);

  setup_wifi();

  // Configuracao HTTPS para prototipo
  secureClient.setInsecure();

  registroOcorrencias.begin(firebase_host);

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

    // Leitura dos sensores
    float umidade = dht.readHumidity();
    float temperatura = dht.readTemperature();

    bool movimentoDetectado =
      (digitalRead(PIN_MOVIMENTO) == HIGH);

    String revisao;
    bool condicaoAnormal =
      registroOcorrencias.avaliarSinalizacao(temperatura, umidade, movimentoDetectado, revisao);
    registroOcorrencias.observe(temperatura, umidade, movimentoDetectado);

    if (condicaoAnormal) {

      Serial.println("[ALERTA] Regra de sinalizacao acionada!");

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

    JsonDocument telemetria;
    if (isfinite(temperatura)) telemetria["temperatura"] = temperatura;
    if (isfinite(umidade)) telemetria["umidade"] = umidade;
    telemetria["movimento"] = movimentoDetectado ? 1 : 0;
    telemetria["status"] = condicaoAnormal ? "ALERTA" : "NORMAL";
    telemetria["led"] = condicaoAnormal ? "LIGADO" : "DESLIGADO";
    telemetria["buzzer"] = condicaoAnormal ? "LIGADO" : "DESLIGADO";
    telemetria["dispositivo"] = "esp32_01";
    telemetria["tempo_execucao_ms"] = agora;
    if (revisao.length()) telemetria["configuracao_revisao"] = revisao;

    String payload;
    serializeJson(telemetria, payload);

    Serial.println();
    Serial.println("JSON GERADO:");
    Serial.println(payload);
     // =================================
    // ENVIO HTTP
    // =================================

    enviarFirebase(payload);

    // Registros separados, depois do envio original da telemetria.
    registroOcorrencias.sync();

    Serial.println("=======================");
  }
}
