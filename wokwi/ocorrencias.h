#pragma once

// Regras compartilhadas pelas saídas locais e pelo registro de ocorrências.
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_timer.h>
#include <esp_system.h>
#include <sys/time.h>
#include <time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <freertos/semphr.h>

class RegistroOcorrencias {
  static const int CAPACIDADE = 16;
  struct Amostra {
    float temperatura, umidade;
    bool movimento, perdaAnterior;
    uint64_t instante;
  };
  QueueHandle_t fila = nullptr;
  TaskHandle_t tarefa = nullptr;
  bool perdaNaFila = false;
  unsigned long ultimoAvisoFila = 0;
  struct Regras {
    float tempMin = 22, tempMax = 28, umidMin = 0, umidMax = 100;
    bool temperatura = true, umidade = false, movimento = false;
    String revisao = "";
  } regras;
  SemaphoreHandle_t mutexRegras = nullptr;

  void aplicarRegras(const Regras& nova) {
    xSemaphoreTake(mutexRegras, portMAX_DELAY);
    regras = nova;
    xSemaphoreGive(mutexRegras);
    regrasDisponiveis = true;
  }
  struct Episodio {
    JsonDocument dados;
    String id;
    bool usado = false, pendente = false, recuperar = false, usaRelogio = false;
    uint64_t inicioMono = 0, ultimaMono = 0;
    int tipoAtivo = -1;
  } episodios[CAPACIDADE];
  int ativos[5] = {-1, -1, -1, -1, -1};
  const char* tipos[5] = {"temperatura_alta", "temperatura_baixa", "umidade_alta", "umidade_baixa", "movimento"};
  String host, sessao;
  unsigned long ultimaConsulta = 0, ultimoEnvio = 0, ultimoAviso = 0;
  uint32_t sequencia = 0;
  uint64_t ultimaAmostra = 0;
  int64_t origemUtcMs = 0;
  bool armazenamento = false;
  bool regrasDisponiveis = false;
  Preferences memoria;
  WiFiClientSecure cliente;

  String chave(int i) { return "evt" + String(i); }
  void salvar(int i) {
    if (!armazenamento) return;
    JsonDocument cache;
    cache["id"] = episodios[i].id;
    cache["dados"].set(episodios[i].dados.as<JsonObject>());
    String texto;
    serializeJson(cache, texto);
    if (!memoria.putString(chave(i).c_str(), texto)) Serial.println("[OCORRENCIAS] Falha ao persistir episodio; mantido em RAM.");
  }
  void liberar(int i) {
    episodios[i].dados.clear();
    episodios[i].id = "";
    episodios[i].usado = episodios[i].pendente = episodios[i].recuperar = episodios[i].usaRelogio = false;
    episodios[i].tipoAtivo = -1;
    if (armazenamento) memoria.remove(chave(i).c_str());
  }
  int requisicao(const char* metodo, const String& caminho, const String& corpo, String& resposta) {
    if (WiFi.status() != WL_CONNECTED) return -1;
    HTTPClient http;
    if (!http.begin(cliente, host + caminho + ".json")) return -1;
    http.setConnectTimeout(1500);
    http.setTimeout(1500);
    http.addHeader("Content-Type", "application/json");
    int codigo = String(metodo) == "GET" ? http.GET() : http.sendRequest(metodo, corpo);
    if (codigo > 0) resposta = http.getString();
    http.end();
    return codigo;
  }
  void consultarRegras() {
    String resposta;
    int codigo = requisicao("GET", "/vetrecovery/box01/configuracao", "", resposta);
    if (codigo != 200) {
      Serial.printf("[OCORRENCIAS] Configuracao indisponivel (HTTP %d). Mantendo regras anteriores.\n", codigo);
      return;
    }
    JsonDocument doc;
    if (deserializeJson(doc, resposta)) return;
    if (doc.isNull()) { aplicarRegras(Regras()); return; }
    if (!doc["temperatura_min"].is<float>() || !doc["temperatura_max"].is<float>() ||
        !doc["umidade_min"].is<float>() || !doc["umidade_max"].is<float>() ||
        !doc["alerta_temperatura"].is<bool>() || !doc["alerta_umidade"].is<bool>() ||
        !doc["alerta_movimento"].is<bool>() ||
        (!doc["revisao"].isNull() && !doc["revisao"].is<const char*>())) {
      Serial.println("[OCORRENCIAS] Configuracao incompleta. Mantendo regras anteriores.");
      return;
    }
    Regras nova;
    nova.tempMin = doc["temperatura_min"].as<float>();
    nova.tempMax = doc["temperatura_max"].as<float>();
    nova.umidMin = doc["umidade_min"].as<float>();
    nova.umidMax = doc["umidade_max"].as<float>();
    if (!isfinite(nova.tempMin) || !isfinite(nova.tempMax) || !isfinite(nova.umidMin) || !isfinite(nova.umidMax) ||
        nova.tempMin < -40 || nova.tempMax > 80 || nova.tempMin >= nova.tempMax ||
        nova.umidMin < 0 || nova.umidMax > 100 || nova.umidMin >= nova.umidMax) {
      Serial.println("[OCORRENCIAS] Limites invalidos. Mantendo regras anteriores.");
      return;
    }
    nova.temperatura = doc["alerta_temperatura"].as<bool>();
    nova.umidade = doc["alerta_umidade"].as<bool>();
    nova.movimento = doc["alerta_movimento"].as<bool>();
    nova.revisao = doc["revisao"] | "";
    aplicarRegras(nova);
  }
  void atualizarRelogio() {
    if (origemUtcMs) return;
    timeval agora;
    gettimeofday(&agora, nullptr);
    // Não transforma millis() em data. Aguarda sincronização SNTP real.
    if (agora.tv_sec < 1704067200) return;
    origemUtcMs = int64_t(agora.tv_sec) * 1000 + agora.tv_usec / 1000 - esp_timer_get_time() / 1000;
    Serial.println("[OCORRENCIAS] Relogio sincronizado.");
    for (int i = 0; i < CAPACIDADE; i++) {
      if (episodios[i].usado && episodios[i].usaRelogio) { carimbar(i); salvar(i); }
    }
  }
  void carimbar(int i) {
    Episodio& e = episodios[i];
    if (!origemUtcMs || !e.usaRelogio) return;
    e.dados["inicio_em"] = origemUtcMs + e.inicioMono / 1000;
    e.dados["ultima_atualizacao_em"] = origemUtcMs + e.ultimaMono / 1000;
    if (e.dados["estado"] == "encerrada") e.dados["fim_em"] = origemUtcMs + e.ultimaMono / 1000;
  }
  void preencherLeitura(JsonObject objeto, float temperatura, float umidade, bool movimento) {
    if (isfinite(temperatura)) objeto["temperatura"] = temperatura;
    else objeto["temperatura"] = nullptr;
    if (isfinite(umidade)) objeto["umidade"] = umidade;
    else objeto["umidade"] = nullptr;
    objeto["movimento"] = movimento ? 1 : 0;
  }
  void encerrar(int tipo, const char* estado, const char* motivo, uint64_t agora, float temp, float umid, bool mov) {
    int i = ativos[tipo];
    if (i < 0) return;
    Episodio& e = episodios[i];
    e.dados["estado"] = estado;
    e.dados["motivo_encerramento"] = motivo;
    if (String(estado) == "encerrada") {
      e.ultimaMono = agora;
      preencherLeitura(e.dados["leitura_final"].to<JsonObject>(), temp, umid, mov);
      preencherLeitura(e.dados["ultima_leitura"].to<JsonObject>(), temp, umid, mov);
    }
    // Em interrupções, o fim é desconhecido: preserva a última observação.
    e.tipoAtivo = -1;
    e.pendente = true;
    ativos[tipo] = -1;
    carimbar(i);
    salvar(i);
    Serial.printf("[OCORRENCIAS] %s: %s\n", estado, e.id.c_str());
  }
  void observarTipo(int tipo, bool condicao, bool leituraValida, uint64_t agora, float temp, float umid, bool mov) {
    int i = ativos[tipo];
    if (!leituraValida) {
      encerrar(tipo, "interrompida", "Leitura do sensor indisponivel; fim nao observado", agora, temp, umid, mov);
      return;
    }
    if (i >= 0 && String(episodios[i].dados["configuracao_revisao"] | "") != regras.revisao) {
      encerrar(tipo, "encerrada", "Configuracao alterada pelo sistema", agora, temp, umid, mov);
      i = -1;
    }
    if (!condicao) {
      encerrar(tipo, "encerrada", "Condicao deixou de atender a regra configurada", agora, temp, umid, mov);
      return;
    }
    if (i < 0) {
      for (int j = 0; j < CAPACIDADE; j++) if (!episodios[j].usado) { i = j; break; }
      if (i < 0) {
        if (millis() - ultimoAviso >= 10000) {
          Serial.println("[OCORRENCIAS] Fila cheia (16 episodios). Novos inicios nao podem ser registrados ate liberar espaco.");
          ultimoAviso = millis();
        }
        return;
      }
      Episodio& e = episodios[i];
      e.usado = e.pendente = e.usaRelogio = true;
      e.tipoAtivo = tipo;
      e.inicioMono = e.ultimaMono = agora;
      e.id = "esp32_01_" + sessao + "_" + String(++sequencia);
      e.dados["tipo"] = tipos[tipo];
      e.dados["estado"] = "em_andamento";
      e.dados["box"] = "Box 01";
      e.dados["dispositivo"] = "esp32_01";
      e.dados["configuracao_revisao"] = regras.revisao;
      preencherLeitura(e.dados["leitura_inicial"].to<JsonObject>(), temp, umid, mov);
      e.dados["regra"]["ativa"] = true;
      if (tipo < 4) {
        e.dados["regra"]["min"] = tipo < 2 ? regras.tempMin : regras.umidMin;
        e.dados["regra"]["max"] = tipo < 2 ? regras.tempMax : regras.umidMax;
      }
      ativos[tipo] = i;
      carimbar(i);
      salvar(i);
      Serial.printf("[OCORRENCIAS] Inicio: %s (%s)\n", tipos[tipo], e.id.c_str());
    }
    Episodio& e = episodios[i];
    e.ultimaMono = agora;
    preencherLeitura(e.dados["ultima_leitura"].to<JsonObject>(), temp, umid, mov);
    e.pendente = true;
    carimbar(i);
  }
  bool reconciliar(int i) {
    Episodio& e = episodios[i];
    String resposta;
    int codigo = requisicao("GET", "/vetrecovery/box01/ocorrencias/" + e.id, "", resposta);
    if (codigo != 200) return false;
    JsonDocument remoto;
    if (deserializeJson(remoto, resposta)) return false;
    if (!remoto.isNull()) {
      if (!remoto.is<JsonObject>()) return false;
      String estado = remoto["estado"] | "";
      if (estado == "encerrada" || estado == "interrompida") { liberar(i); return true; }
      e.dados.set(remoto.as<JsonObject>());
      e.dados.remove("acompanhamento");
    }
    e.dados["estado"] = "interrompida";
    e.dados["motivo_encerramento"] = "Dispositivo reiniciado; fim nao observado";
    e.dados.remove("fim_em");
    e.recuperar = false;
    e.pendente = true;
    salvar(i);
    return true;
  }

  void iniciarTransporte() {
    fila = xQueueCreate(64, sizeof(Amostra));
    if (!fila || xTaskCreate(executar, "vet-eventos", 12288, this, 1, &tarefa) != pdPASS) {
      if (fila) { vQueueDelete(fila); fila = nullptr; }
      tarefa = nullptr;
      Serial.println("[OCORRENCIAS] Falha ao iniciar tarefa. Monitoramento original preservado.");
    }
  }
  static void executar(void* contexto) {
    RegistroOcorrencias* self = static_cast<RegistroOcorrencias*>(contexto);
    for (;;) {
      Amostra amostra;
      while (xQueueReceive(self->fila, &amostra, 0) == pdTRUE) self->processar(amostra);
      self->sincronizar();
      ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(100));
    }
  }

public:
  void begin(const char* firebaseHost) {
    host = firebaseHost;
    cliente.setInsecure(); // Mantém a política HTTPS do protótipo original.
    cliente.setHandshakeTimeout(2);
    sessao = String(esp_random(), HEX) + String(esp_random(), HEX);
    armazenamento = memoria.begin("vet-eventos", false);
    if (!armazenamento) Serial.println("[OCORRENCIAS] Persistencia indisponivel. Episodios ficarao apenas em RAM.");
    for (int i = 0; i < CAPACIDADE && armazenamento; i++) {
      String texto = memoria.getString(chave(i).c_str(), "");
      if (!texto.length()) continue;
      JsonDocument cache;
      if (deserializeJson(cache, texto) || !cache["id"].is<const char*>() || !cache["dados"].is<JsonObject>()) continue;
      Episodio& e = episodios[i];
      e.id = cache["id"].as<String>();
      e.dados.set(cache["dados"].as<JsonObject>());
      e.usado = e.pendente = true;
      e.recuperar = e.dados["estado"] == "em_andamento";
    }
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    ultimaConsulta = millis() - 10000UL;
    ultimoEnvio = millis() - 10000UL;
    Serial.println("[OCORRENCIAS] Rotina iniciada; aguardando regras e horario.");
    mutexRegras = xSemaphoreCreateMutex();
    if (mutexRegras) iniciarTransporte();
    else Serial.println("[OCORRENCIAS] Falha ao iniciar sincronizacao. Usando regras padrao.");
  }
  bool avaliarSinalizacao(float temperatura, float umidade, bool movimento, String& revisao) {
    Regras atuais;
    if (mutexRegras) {
      xSemaphoreTake(mutexRegras, portMAX_DELAY);
      atuais = regras;
      xSemaphoreGive(mutexRegras);
    }
    revisao = atuais.revisao;
    return (atuais.temperatura && isfinite(temperatura) && temperatura >= -40 && temperatura <= 80 &&
            (temperatura < atuais.tempMin || temperatura > atuais.tempMax)) ||
           (atuais.umidade && isfinite(umidade) && umidade >= 0 && umidade <= 100 &&
            (umidade < atuais.umidMin || umidade > atuais.umidMax)) ||
           (atuais.movimento && movimento);
  }

  void observe(float temperatura, float umidade, bool movimento) {
    if (!fila) return;
    Amostra amostra = {temperatura, umidade, movimento, perdaNaFila, uint64_t(esp_timer_get_time())};
    if (xQueueSend(fila, &amostra, 0) == pdTRUE) perdaNaFila = false;
    else {
      perdaNaFila = true;
      if (millis() - ultimoAvisoFila >= 10000UL) {
        Serial.println("[OCORRENCIAS] Fila de amostras cheia. Monitoramento original continua.");
        ultimoAvisoFila = millis();
      }
    }
  }
  void sync() { if (tarefa) xTaskNotifyGive(tarefa); }

private:
  void processar(const Amostra& amostra) {
    const float temperatura = amostra.temperatura, umidade = amostra.umidade;
    const bool movimento = amostra.movimento;
    if (!regrasDisponiveis) return; // Aguarda a primeira consulta; evita registrar com regras desconhecidas.
    uint64_t agora = amostra.instante;
    if (amostra.perdaAnterior) {
      for (int tipo = 0; tipo < 5; tipo++) encerrar(tipo, "interrompida", "Perda de amostras; fim nao observado", agora, temperatura, umidade, movimento);
    }
    if (ultimaAmostra && agora - ultimaAmostra > 15000000ULL) {
      for (int tipo = 0; tipo < 5; tipo++) encerrar(tipo, "interrompida", "Intervalo sem leituras; fim nao observado", agora, temperatura, umidade, movimento);
    }
    ultimaAmostra = agora;
    bool tempValida = isfinite(temperatura) && temperatura >= -40 && temperatura <= 80;
    bool umidValida = isfinite(umidade) && umidade >= 0 && umidade <= 100;
    observarTipo(0, regras.temperatura && temperatura > regras.tempMax, tempValida, agora, temperatura, umidade, movimento);
    observarTipo(1, regras.temperatura && temperatura < regras.tempMin, tempValida, agora, temperatura, umidade, movimento);
    observarTipo(2, regras.umidade && umidade > regras.umidMax, umidValida, agora, temperatura, umidade, movimento);
    observarTipo(3, regras.umidade && umidade < regras.umidMin, umidValida, agora, temperatura, umidade, movimento);
    observarTipo(4, regras.movimento && movimento, true, agora, temperatura, umidade, movimento);
  }
  void sincronizar() {
    atualizarRelogio();
    if (WiFi.status() != WL_CONNECTED) return;
    unsigned long agora = millis();
    if (agora - ultimaConsulta >= 10000UL) {
      ultimaConsulta = agora;
      consultarRegras();
    }
    if (agora - ultimoEnvio < 10000UL) return;
    ultimoEnvio = agora;
    // Recupera no máximo um episódio por rodada para limitar operações extras.
    for (int i = 0; i < CAPACIDADE; i++) {
      if (episodios[i].usado && episodios[i].recuperar) { reconciliar(i); break; }
    }
    JsonDocument lote;
    for (int i = 0; i < CAPACIDADE; i++) {
      Episodio& e = episodios[i];
      if (!e.usado || !e.pendente || e.recuperar || (e.usaRelogio && !origemUtcMs)) continue;
      carimbar(i);
      for (JsonPair campo : e.dados.as<JsonObject>()) {
        // PATCH em caminhos dos campos do dispositivo: nunca envia acompanhamento.
        if (String(campo.key().c_str()) != "acompanhamento") lote[e.id + "/" + campo.key().c_str()].set(campo.value());
      }
    }
    if (lote.isNull()) return;
    String corpo, resposta;
    serializeJson(lote, corpo);
    int codigo = requisicao("PATCH", "/vetrecovery/box01/ocorrencias", corpo, resposta);
    if (codigo != 200 && codigo != 204) {
      Serial.printf("[OCORRENCIAS] Falha HTTP %d. Registros mantidos para nova tentativa.\n", codigo);
      return;
    }
    for (int i = 0; i < CAPACIDADE; i++) {
      Episodio& e = episodios[i];
      if (!e.usado || !e.pendente || e.recuperar || (e.usaRelogio && !origemUtcMs)) continue;
      if (e.tipoAtivo < 0) liberar(i);
      else e.pendente = false;
    }
    Serial.println("[OCORRENCIAS] Episodios sincronizados com o Firebase.");
  }
};

