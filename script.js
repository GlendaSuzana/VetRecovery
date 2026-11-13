
// Importação da conexão com o Firebase
import { database } from "./firebase.js";

import {
  ref,
  onValue,
  set,
  push,
  serverTimestamp,
  update,
  query,
  orderByChild,
  limitToLast
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";

// Função auxiliar para localizar elementos HTML pelo ID
const $ = (id) => document.getElementById(id);

// Elementos responsáveis pelo status da conexão
const connection = $("connection");
const connectionText = $("connectionText");

// Inicialização do gráfico com Chart.js
const chart = new Chart($("readingsChart"), {
  type: "line",

  data: {
    labels: [],

    datasets: [
      {
        label: "Temperatura (°C)",
        data: [],
        borderColor: "#16845b",
        backgroundColor: "#16845b18",
        yAxisID: "y",
        tension: 0.3,
        fill: false
      },

      {
        label: "Umidade (%)",
        data: [],
        borderColor: "#4787c7",
        backgroundColor: "#4787c718",
        yAxisID: "y1",
        tension: 0.3,
        fill: false
      }
    ]
  },

  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,

    interaction: {
      mode: "index",
      intersect: false
    },

    plugins: {
      legend: {
        position: "bottom",

        labels: {
          usePointStyle: true,
          boxWidth: 7,
          font: {
            size: 11
          }
        }
      }
    },

    scales: {
      x: {
        grid: {
          display: false
        },

        ticks: {
          maxTicksLimit: 7,
          font: {
            size: 10
          }
        }
      },

      y: {
        position: "left",

        title: {
          display: true,
          text: "°C"
        },

        suggestedMin: 15,
        suggestedMax: 35
      },

      y1: {
        position: "right",

        title: {
          display: true,
          text: "%"
        },

        min: 0,
        max: 100,

        grid: {
          drawOnChartArea: false
        }
      }
    }
  }
});

// Atualização dos indicadores de status
function setPill(id, text, type) {
  const element = $(id);

  element.textContent = text;
  element.className = "pill " + type;
}

// Adiciona uma nova leitura ao gráfico
function addChartPoint(temp, humidity) {

  const now = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  chart.data.labels.push(now);

  chart.data.datasets[0].data.push(temp);
  chart.data.datasets[1].data.push(humidity);

  // Mantém no máximo 30 leituras no gráfico
  if (chart.data.labels.length > 30) {

    chart.data.labels.shift();

    chart.data.datasets.forEach(dataset => {
      dataset.data.shift();
    });

  }

  chart.update();
}

// Exibe mensagens de erro na conexão
function showError(message) {

  connection.className = "connection offline";

  connectionText.textContent = "Falha na conexão";

  $("alertMessage").className = "alert-box bad";

  $("alertMessage").textContent = message;
}

// Configuração compartilhada entre o painel e o ESP32.
const DEFAULT_SETTINGS = Object.freeze({
  temperatura_min: 22, temperatura_max: 28,
  umidade_min: 0, umidade_max: 100,
  alerta_temperatura: true, alerta_umidade: false, alerta_movimento: false
});
const numberFields = ["temperatura_min", "temperatura_max", "umidade_min", "umidade_max"];
const boolFields = ["alerta_temperatura", "alerta_umidade", "alerta_movimento"];
const configRef = ref(database, "vetrecovery/box01/configuracao");
let settings = { ...DEFAULT_SETTINGS };
let settingsReady = false;
let latestData = null;
let telemetryError = false;
let dirty = false;
let saving = false;

function validSettings(value) {
  return value && numberFields.every(key => typeof value[key] === "number" && Number.isFinite(value[key]))
    && boolFields.every(key => typeof value[key] === "boolean")
    && value.temperatura_min >= -40 && value.temperatura_max <= 80
    && value.temperatura_min < value.temperatura_max
    && value.umidade_min >= 0 && value.umidade_max <= 100
    && value.umidade_min < value.umidade_max
    && (value.revisao === undefined || typeof value.revisao === "string");
}
function reading(value) {
  if (typeof value !== "number" && typeof value !== "string") return NaN;
  if (typeof value === "string" && !value.trim()) return NaN;
  return Number(value);
}
function settingsMessage(text, error = false) {
  $("settingsMessage").textContent = text;
  $("settingsMessage").className = "settings-message" + (error ? " error" : "");
}
function fillForm(value) {
  numberFields.forEach(key => { $(key).value = value[key]; });
  boolFields.forEach(key => { $(key).checked = value[key]; });
}
function updateSummary() {
  $("temperatureRange").textContent = settings.alerta_temperatura
    ? `Faixa configurada: ${settings.temperatura_min} °C a ${settings.temperatura_max} °C`
    : "Alerta de temperatura desativado";
  $("humidityRange").textContent = settings.alerta_umidade
    ? `Faixa configurada: ${settings.umidade_min}% a ${settings.umidade_max}%`
    : "Alerta de umidade desativado";
}
function renderRules() {
  const confirmed = settings.revisao && latestData?.configuracao_revisao === settings.revisao;
  $("deviceConfigStatus").textContent = !settingsReady
    ? "Configurações indisponíveis. Não foi possível confirmar as regras."
    : !settings.revisao
      ? "Valores padrão no painel. Salve para enviar uma configuração ao ESP32."
      : confirmed
        ? "ESP32 confirmou esta configuração na última telemetria recebida."
        : "Configuração salva; aguardando confirmação do ESP32. Atualize o sketch do Wokwi se necessário.";
  if (telemetryError) return;
  if (!latestData) {
    setPill("environmentStatus", "Aguardando dados", "neutral");
    setPill("motionStatus", "Aguardando dados", "neutral");
    $("alertMessage").className = "alert-box warn";
    $("alertMessage").textContent = "Aguardando telemetria do ESP32.";
    return;
  }
  const temp = reading(latestData.temperatura);
  const humidity = reading(latestData.umidade);
  const validTemp = Number.isFinite(temp) && temp >= -40 && temp <= 80;
  const validHumidity = Number.isFinite(humidity) && humidity >= 0 && humidity <= 100;
  const motionKnown = [0, 1, "0", "1", true, false].includes(latestData.movimento);
  const moving = latestData.movimento === true || Number(latestData.movimento) === 1;
  $("temperature").textContent = validTemp ? `${temp.toFixed(1)} °C` : "-- °C";
  $("humidity").textContent = validHumidity ? `${humidity.toFixed(1)} %` : "-- %";
  setPill("motionStatus", !motionKnown ? "Leitura indisponível" : moving ? "Movimento detectado" : "Sem movimento",
    !motionKnown ? "neutral" : moving ? "warn" : "good");
  if (!settingsReady) {
    setPill("environmentStatus", "Regras indisponíveis", "neutral");
    $("alertMessage").className = "alert-box warn";
    $("alertMessage").textContent = "Não foi possível carregar as regras. A condição do ambiente não foi avaliada.";
    return;
  }
  const reasons = [];
  if (settings.alerta_temperatura && validTemp && (temp < settings.temperatura_min || temp > settings.temperatura_max)) reasons.push("Temperatura fora da faixa");
  if (settings.alerta_umidade && validHumidity && (humidity < settings.umidade_min || humidity > settings.umidade_max)) reasons.push("Umidade fora da faixa");
  if (settings.alerta_movimento && motionKnown && moving) reasons.push("Movimento detectado");
  const missing = !validTemp || !validHumidity || !motionKnown;
  const active = boolFields.some(key => settings[key]);
  setPill("environmentStatus", reasons.length ? "Atenção necessária" : missing ? "Leitura incompleta" : active ? "Dentro das regras" : "Alertas desativados",
    reasons.length ? "bad" : missing || !active ? "warn" : "good");
  $("alertMessage").className = "alert-box " + (reasons.length ? "bad" : missing || !active ? "warn" : "good");
  $("alertMessage").textContent = reasons.length
    ? reasons.join(". ") + ". Verifique as condições do box." + (missing ? " Há também leituras indisponíveis." : "")
    : missing ? "Há leituras indisponíveis. Não é possível confirmar todas as condições do box."
    : !active ? "Todas as regras de alerta estão desativadas. As leituras continuam sendo exibidas."
    : "Nenhuma das regras de alerta configuradas foi acionada.";
}

$("settingsForm").addEventListener("input", () => {
  dirty = true;
  settingsMessage("Alterações não salvas. Clique em Salvar configurações para aplicar.");
});
$("resetSettings").addEventListener("click", () => {
  fillForm(DEFAULT_SETTINGS);
  dirty = true;
  settingsMessage("Valores padrão preenchidos. Clique em Salvar configurações para aplicar.");
});
$("settingsForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!settingsReady || saving) return;
  const candidate = {};
  numberFields.forEach(key => { candidate[key] = reading($(key).value); });
  boolFields.forEach(key => { candidate[key] = $(key).checked; });
  if (!validSettings(candidate)) {
    settingsMessage("Verifique os limites: mínima deve ser menor que máxima. Temperatura: -40 a 80 °C; umidade: 0 a 100%.", true);
    return;
  }
  candidate.revisao = push(configRef).key;
  candidate.atualizado_em = serverTimestamp();
  saving = true;
  $("settingsFields").disabled = true;
  settingsMessage("Salvando configurações no Firebase...");
  try {
    // Só aplica no painel após o servidor confirmar a gravação.
    await set(configRef, candidate);
    settings = { ...candidate };
    dirty = false;
    fillForm(settings);
    updateSummary();
    renderRules();
    settingsMessage("Configurações salvas no Firebase. Regras aplicadas ao painel.");
  } catch (error) {
    settingsMessage("Não foi possível salvar. As regras anteriores foram mantidas. Verifique sua conexão e a permissão de escrita em vetrecovery/box01/configuracao.", true);
    console.error("Erro ao salvar configurações:", error);
  } finally {
    saving = false;
    $("settingsFields").disabled = !settingsReady;
  }
});

onValue(configRef, snapshot => {
  // O Firebase emite também a escrita local otimista; não a trate como confirmação.
  if (saving) return;
  const value = snapshot.val();
  if (value !== null && !validSettings(value)) {
    settingsReady = false;
    $("settingsFields").disabled = true;
    settingsMessage("Configuração inválida no Firebase. Corrija os dados antes de editar as regras.", true);
    renderRules();
    return;
  }
  settings = value === null ? { ...DEFAULT_SETTINGS } : { ...value };
  settingsReady = true;
  $("settingsFields").disabled = false;
  if (!dirty) fillForm(settings);
  updateSummary();
  renderRules();
  settingsMessage(dirty ? "As regras salvas foram atualizadas. Seu formulário tem alterações não salvas."
    : value === null ? "Usando valores padrão. Salve para registrar suas regras no Firebase."
    : "Configurações carregadas do Firebase.");
}, error => {
  settingsReady = false;
  $("settingsFields").disabled = true;
  settingsMessage("Não foi possível ler as configurações. Verifique a conexão e a permissão de leitura em vetrecovery/box01/configuracao.", true);
  renderRules();
  console.error("Erro ao ler configurações:", error);
});

const telemetryRef = ref(database, "vetrecovery/box01/telemetria");
onValue(telemetryRef, snapshot => {
  latestData = snapshot.val();
  telemetryError = false;
  connection.className = "connection online";
  connectionText.textContent = "Conectado ao Firebase";
  $("ledStatus").textContent = latestData?.led ?? "--";
  $("buzzerStatus").textContent = latestData?.buzzer ?? "--";
  $("deviceId").textContent = latestData?.dispositivo ?? "--";
  $("lastUpdate").textContent = latestData ? new Date().toLocaleTimeString("pt-BR") : "--";
  renderRules();
  const temp = reading(latestData?.temperatura);
  const humidity = reading(latestData?.umidade);
  if (Number.isFinite(temp) && Number.isFinite(humidity) && temp >= -40 && temp <= 80 && humidity >= 0 && humidity <= 100) addChartPoint(temp, humidity);
}, error => {
  telemetryError = true;
  showError("Não foi possível ler a telemetria. Verifique a conexão e as regras de acesso do Firebase.");
  console.error("Erro ao ler Firebase:", error);
});

// Ocorrências: os episódios são produzidos pelo ESP32, nunca pelas abas do dashboard.
const OCCURRENCES_PATH = "vetrecovery/box01/ocorrencias";
const occurrenceTypes = {
  temperatura_alta: "Temperatura acima do limite",
  temperatura_baixa: "Temperatura abaixo do limite",
  umidade_alta: "Umidade acima do limite",
  umidade_baixa: "Umidade abaixo do limite",
  movimento: "Movimento detectado"
};
const occurrenceStates = { em_andamento: "Em andamento", encerrada: "Encerrada", interrompida: "Interrompida" };
let occurrenceRecords = [];
let occurrenceLimit = 50;
let stopOccurrences = null;
let stopOccurrenceDetails = null;
let selectedOccurrenceId = null;
let selectedOccurrence = null;
let reviewDirty = false;
let reviewSaving = false;
let occurrencesReady = false;
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "medium" });
const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" });
function eventTime(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 8640000000000000 ? value : null;
}
function eventDate(value) { return eventTime(value) ? dateFormatter.format(value) : "Não informado"; }
function eventDay(value) {
  const parts = dayFormatter.formatToParts(value);
  const part = type => parts.find(item => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function durationText(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "Não informada";
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `${hours ? hours + "h " : ""}${minutes ? minutes + "min " : ""}${seconds % 60}s`;
}
function eventDuration(item) {
  const start = eventTime(item.inicio_em);
  const end = item.estado === "em_andamento" ? eventTime(item.ultima_atualizacao_em) : eventTime(item.fim_em);
  if (start && end && end >= start) return durationText(end - start);
  return "Não informada";
}
function staleOccurrence(item) {
  const last = eventTime(item.ultima_atualizacao_em);
  return item.estado === "em_andamento" && (!last || Date.now() - last > 30000);
}
function occurrenceMessage(text, error = false) {
  $("occurrenceMessage").textContent = text;
  $("occurrenceMessage").className = "settings-message" + (error ? " error" : "");
}
function reviewMessage(text, error = false) {
  $("occurrenceReviewMessage").textContent = text;
  $("occurrenceReviewMessage").className = "settings-message" + (error ? " error" : "");
}
function textNode(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
function typeLabel(item) { return occurrenceTypes[item.tipo] || "Tipo não reconhecido"; }
function stateLabel(item) { return occurrenceStates[item.estado] || "Situação não informada"; }
function renderOccurrences() {
  if (!occurrencesReady) return;
  const active = occurrenceRecords.filter(item => item.estado === "em_andamento").length;
  const reviewed = occurrenceRecords.filter(item => item.acompanhamento?.revisada === true).length;
  $("occurrenceCount").textContent = `${active} em andamento nos registros carregados`;
  $("occurrenceSummary").textContent = `${occurrenceRecords.length} registros carregados · ${reviewed} revisados pela equipe`;
  const type = $("occurrenceType").value;
  const state = $("occurrenceState").value;
  const from = $("occurrenceFrom").value;
  const to = $("occurrenceTo").value;
  const list = $("occurrenceList");
  list.replaceChildren();
  if (from && to && from > to) {
    occurrenceMessage("A data inicial não pode ser posterior à data final.", true);
    return;
  }
  const filtered = occurrenceRecords.filter(item => {
    const start = eventTime(item.inicio_em);
    const day = start ? eventDay(start) : null;
    return (!type || (typeof item.tipo === "string" && item.tipo.startsWith(type)))
      && (!state || item.estado === state)
      && (!from || (day && day >= from)) && (!to || (day && day <= to));
  });
  occurrenceMessage(!occurrenceRecords.length
    ? "Nenhuma ocorrência registrada. Os episódios aparecerão aqui quando o ESP32 começar a enviá-los ao Firebase."
    : !filtered.length ? "Nenhuma ocorrência corresponde aos filtros nos registros carregados."
    : `${filtered.length} ocorrência(s) exibida(s). Atualização automática ativada.`);
  filtered.forEach(item => {
    const card = textNode("article", "", "occurrence-item");
    const heading = textNode("div", "", "occurrence-heading");
    heading.append(textNode("h3", typeLabel(item)), textNode("span", stateLabel(item), "pill " + (item.estado === "em_andamento" ? "bad" : item.estado === "encerrada" ? "good" : "warn")));
    const meta = textNode("div", "", "occurrence-meta");
    meta.append(textNode("span", `Início: ${eventDate(item.inicio_em)}`), textNode("span", `${item.estado === "em_andamento" ? "Duração observada" : "Duração"}: ${eventDuration(item)}`), textNode("span", item.acompanhamento?.revisada === true ? "Revisada pela equipe" : "Revisão pendente"));
    card.append(heading, meta);
    if (staleOccurrence(item)) card.append(textNode("p", "Sem atualização recente do episódio. O encerramento ainda não foi confirmado pelo dispositivo.", "metric-note"));
    const button = textNode("button", "Ver detalhes", "secondary");
    button.type = "button";
    button.setAttribute("aria-label", `Ver detalhes: ${typeLabel(item)}, ${eventDate(item.inicio_em)}`);
    button.addEventListener("click", () => openOccurrence(item.id));
    card.append(button);
    list.append(card);
  });
}
function describeRule(item) {
  const rule = item.regra;
  if (!rule || typeof rule !== "object") return "Não informada";
  if (item.tipo === "movimento") return rule.ativa === true ? "Alerta por movimento ativado" : "Regra de movimento não informada";
  const unit = typeof item.tipo === "string" && item.tipo.startsWith("umidade") ? "%" : "°C";
  return typeof rule.min === "number" && Number.isFinite(rule.min) && typeof rule.max === "number" && Number.isFinite(rule.max)
    ? `Faixa de ${rule.min} a ${rule.max} ${unit}` : "Limites não informados";
}
function renderOccurrenceDetails() {
  const item = selectedOccurrence;
  if (!item) return;
  const details = $("occurrenceDetails");
  details.replaceChildren();
  const temperature = item.leitura_inicial?.temperatura;
  const rows = [
    ["Tipo de ocorrência", typeLabel(item)],
    ["Local", typeof item.box === "string" ? item.box : "Box 01"],
    ["Data e hora de início", eventDate(item.inicio_em)],
    ["Temperatura inicial", typeof temperature === "number" && Number.isFinite(temperature) ? `${temperature.toFixed(1)} °C` : "Não informada"],
    ["Regra aplicada", describeRule(item)],
    ["Situação", stateLabel(item)],
    ["Data e hora de encerramento", item.estado === "em_andamento" ? "Ainda não confirmado" : eventDate(item.fim_em)],
    ["Duração", eventDuration(item) + (item.estado === "em_andamento" ? " (até a última atualização)" : "")],
    ["Identificação do dispositivo", typeof item.dispositivo === "string" ? item.dispositivo : "Não informada"]
  ];
  rows.forEach(([label, value]) => {
    const row = document.createElement("tr");
    const heading = textNode("th", label);
    heading.scope = "row";
    row.append(heading, textNode("td", value));
    details.append(row);
  });
  $("occurrenceCommunication").textContent = staleOccurrence(item)
    ? "Sem atualização recente. O encerramento não foi confirmado pelo dispositivo."
    : "";
}
function openOccurrence(id) {
  stopOccurrenceDetails?.();
  selectedOccurrenceId = id;
  selectedOccurrence = null;
  reviewDirty = false;
  $("occurrenceDetails").replaceChildren();
  $("occurrenceCommunication").textContent = "";
  $("occurrenceReviewFields").disabled = true;
  $("occurrenceNotes").value = "";
  $("occurrenceReviewed").checked = false;
  reviewMessage("Carregando detalhes...");
  $("occurrenceDialog").showModal();
  stopOccurrenceDetails = onValue(ref(database, `${OCCURRENCES_PATH}/${id}`), snapshot => {
    if (selectedOccurrenceId !== id) return;
    const value = snapshot.val();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      selectedOccurrence = null;
      $("occurrenceReviewFields").disabled = true;
      reviewMessage("Esta ocorrência não está mais disponível.", true);
      return;
    }
    selectedOccurrence = value;
    renderOccurrenceDetails();
    $("occurrenceReviewFields").disabled = reviewSaving;
    if (!reviewDirty && !reviewSaving) {
      $("occurrenceNotes").value = typeof value.acompanhamento?.observacao === "string" ? value.acompanhamento.observacao : "";
      $("occurrenceReviewed").checked = value.acompanhamento?.revisada === true;
      reviewMessage("Você pode registrar observações e a revisão da equipe.");
    }
  }, error => {
    if (selectedOccurrenceId !== id) return;
    selectedOccurrence = null;
    $("occurrenceReviewFields").disabled = true;
    reviewMessage("Não foi possível carregar os detalhes. Verifique a conexão e as permissões de leitura.", true);
    console.error("Erro ao ler ocorrência:", error);
  });
}
$("closeOccurrenceDialog").addEventListener("click", () => $("occurrenceDialog").close());
$("occurrenceDialog").addEventListener("close", () => {
  stopOccurrenceDetails?.();
  stopOccurrenceDetails = null;
  selectedOccurrenceId = null;
  selectedOccurrence = null;
});
$("occurrenceReviewForm").addEventListener("input", () => {
  reviewDirty = true;
  reviewMessage("Alterações não salvas no acompanhamento.");
});
$("occurrenceReviewForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!selectedOccurrenceId || !selectedOccurrence || reviewSaving) return;
  const id = selectedOccurrenceId;
  const observation = $("occurrenceNotes").value.trim();
  if (observation.length > 2000) {
    reviewMessage("A observação deve ter até 2.000 caracteres.", true);
    return;
  }
  reviewSaving = true;
  $("occurrenceReviewFields").disabled = true;
  reviewMessage("Salvando acompanhamento no Firebase...");
  try {
    // Atualiza somente os campos da equipe; não sobrescreve dados do sensor.
    await update(ref(database, `${OCCURRENCES_PATH}/${id}/acompanhamento`), {
      observacao: observation, revisada: $("occurrenceReviewed").checked, atualizado_em: serverTimestamp()
    });
    if (selectedOccurrenceId === id) {
      reviewDirty = false;
      reviewMessage("Acompanhamento salvo no Firebase. A situação do episódio continua sendo determinada pelo dispositivo.");
    }
  } catch (error) {
    if (selectedOccurrenceId === id) reviewMessage("Não foi possível salvar. Suas alterações continuam no formulário. Verifique a conexão e a permissão de escrita em ocorrencias/" + id + "/acompanhamento.", true);
    console.error("Erro ao salvar acompanhamento:", error);
  } finally {
    reviewSaving = false;
    $("occurrenceReviewFields").disabled = !selectedOccurrence;
  }
});
function subscribeOccurrences() {
  stopOccurrences?.();
  occurrencesReady = false;
  $("loadMoreOccurrences").disabled = true;
  occurrenceMessage("Carregando ocorrências...");
  const source = query(ref(database, OCCURRENCES_PATH), orderByChild("inicio_em"), limitToLast(occurrenceLimit + 1));
  stopOccurrences = onValue(source, snapshot => {
    const value = snapshot.val();
    const entries = value && typeof value === "object" ? Object.entries(value).filter(([, item]) => item && typeof item === "object" && !Array.isArray(item)).map(([id, item]) => ({ ...item, id })) : [];
    entries.sort((a, b) => (eventTime(b.inicio_em) || 0) - (eventTime(a.inicio_em) || 0) || b.id.localeCompare(a.id));
    occurrenceRecords = entries.slice(0, occurrenceLimit);
    occurrencesReady = true;
    $("loadMoreOccurrences").hidden = entries.length <= occurrenceLimit;
    $("loadMoreOccurrences").disabled = false;
    renderOccurrences();
  }, error => {
    occurrencesReady = false;
    occurrenceRecords = [];
    $("occurrenceList").replaceChildren();
    $("occurrenceCount").textContent = "Consulta indisponível";
    $("occurrenceSummary").textContent = "Não foi possível confirmar os totais de ocorrências.";
    $("loadMoreOccurrences").hidden = true;
    occurrenceMessage("Não foi possível consultar ocorrências. Verifique a conexão e a permissão de leitura em vetrecovery/box01/ocorrencias.", true);
    console.error("Erro ao ler ocorrências:", error);
  });
}
["occurrenceType", "occurrenceState", "occurrenceFrom", "occurrenceTo"].forEach(id => $(id).addEventListener("change", renderOccurrences));
$("clearOccurrenceFilters").addEventListener("click", () => {
  ["occurrenceType", "occurrenceState", "occurrenceFrom", "occurrenceTo"].forEach(id => { $(id).value = ""; });
  renderOccurrences();
});
$("loadMoreOccurrences").addEventListener("click", () => { occurrenceLimit += 50; subscribeOccurrences(); });
setInterval(() => {
  if (!$("occurrenceDialog").open) renderOccurrences();
  else renderOccurrenceDetails();
}, 15000);
subscribeOccurrences();
