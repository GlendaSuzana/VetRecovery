
// Importação da conexão com o Firebase
import { database } from "./firebase.js";
import { MotionSession } from "./movimento.js";
import { activityDefaults, activityRules } from "./observacao.js";

import {
  ref,
  onValue,
  set,
  push,
  query,
  orderByChild,
  limitToLast,
  serverTimestamp
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

// O eixo é binário: não há valores intermediários entre repouso e movimento.
const motionSession = new MotionSession();
const motionChart = new Chart($("motionChart"), {
  type: "line",
  data: { datasets: [{ label: "Sensor PIR", data: [], stepped: true, spanGaps: false, clip: false,
    borderColor: "#a66a12", backgroundColor: "#fff6e6", fill: true,
    pointRadius: 6, pointHoverRadius: 8, pointHitRadius: 12,
    pointBackgroundColor: "#a66a12", pointBorderColor: "#ffffff", pointBorderWidth: 2 }] },
  options: {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: {
      title: items => items.length ? new Date(items[0].parsed.x).toLocaleTimeString("pt-BR") : "",
      label: item => item.parsed.y === 1 ? "1 — Movimento detectado" : "0 — Sem movimento"
    } } },
    scales: {
      x: { type: "linear", title: { display: true, text: "Horário de recebimento" },
        ticks: { maxTicksLimit: 6, callback: value => new Date(value).toLocaleTimeString("pt-BR") } },
      y: { min: 0, max: 1, ticks: { stepSize: 1, precision: 0 }, title: { display: true, text: "Movimento (0 ou 1)" } }
    }
  }
});
let lastMotionReceivedAt = null;
function motionDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
}
function renderMotionMetrics() {
  $("motionEventCount").textContent = motionSession.events;
  $("motionFrequency").textContent = motionSession.frequency === null ? "--" : `${motionSession.frequency.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} eventos/min`;
  $("motionCurrentDuration").textContent = motionSession.previous === 1
    ? motionDuration(motionSession.currentMs) + (motionSession.partial ? " (parcial)" : "") : "--";
  $("motionLastDuration").textContent = motionSession.lastEvent
    ? motionDuration(motionSession.lastEvent.durationMs) + (motionSession.lastEvent.partial ? " (parcial)" : "") : "--";
}
function addMotionPoint(data) {
  const uptime = data?.tempo_execucao_ms;
  const hasUptime = typeof uptime === "number" && Number.isFinite(uptime) && uptime >= 0;
  const now = Date.now();
  const result = motionSession.add(data?.movimento, hasUptime ? uptime : performance.now(), hasUptime ? "esp32" : "browser");
  if (result.duplicate) return;
  lastMotionReceivedAt = result.state === null ? null : performance.now();
  const points = motionChart.data.datasets[0].data;
  if (result.gap && points.length && points[points.length - 1].y !== null) points.push({ x: now - 1, y: null });
  points.push({ x: now, y: result.state });
  while (points.length > 60) points.shift();
  motionChart.update();
  $("motionChartMessage").textContent = result.state === null ? "Leitura de movimento indisponível. Nenhum repouso foi presumido."
    : result.state === 1 ? "1 — Movimento detectado. A duração avança somente com novas leituras."
    : "0 — Sem movimento detectado.";
  renderMotionMetrics();
}
setInterval(() => {
  if (lastMotionReceivedAt !== null && performance.now() - lastMotionReceivedAt > 15000) {
    lastMotionReceivedAt = null;
    motionSession.interrupt();
    const points = motionChart.data.datasets[0].data;
    points.push({ x: Date.now(), y: null });
    while (points.length > 60) points.shift();
    motionChart.update();
    renderMotionMetrics();
    $("motionChartMessage").textContent = "Sem novas leituras de movimento. A duração foi interrompida até receber novos dados.";
  }
}, 1000);

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
const activityFields = Object.keys(activityDefaults);
const modes = { rotina: activityDefaults, intensiva: { janela_min: 5, repeticoes: 3, duracao_s: 15 } };
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
  $("observationMode").value = ["rotina", "intensiva", "personalizada"].includes(value.modo) ? value.modo : "rotina";
  const rules = activityRules(value);
  activityFields.forEach(key => { $(key).value = rules[key]; });
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
        : "Configuração salva; aguardando confirmação do ESP32 pela telemetria.";
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

$("settingsForm").addEventListener("input", event => {
  if (event.target.id === "observationMode") {
    const preset = modes[event.target.value];
    if (preset) activityFields.forEach(key => { $(key).value = preset[key]; });
  } else if (activityFields.includes(event.target.id)) {
    $("observationMode").value = "personalizada";
  }
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
  candidate.modo = $("observationMode").value;
  candidate.atividade = Object.fromEntries(activityFields.map(key => [key, $(key).valueAsNumber]));
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
  addMotionPoint(latestData);
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
  addMotionPoint(null);
  showError("Não foi possível ler a telemetria. Verifique a conexão e as regras de acesso do Firebase.");
  console.error("Erro ao ler Firebase:", error);
});

const activityPath = "vetrecovery/box01/atividade";
let activitySummary;
function renderActivitySummary() {
  const summary = activitySummary;
  if (!summary?.disponivel || Date.now() - summary.atualizado_em > 30000) {
    $("activitySummary").textContent = "Sem amostras recentes do serviço de monitoramento.";
    return;
  }
  const patterns = [];
  if (summary.movimento_recorrente) patterns.push("Movimento recorrente");
  if (summary.movimento_prolongado) patterns.push("Movimento prolongado");
  const frequency = (summary.count / summary.janela_min).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const metrics = `${summary.count} início(s) nos últimos ${summary.janela_min} min · ${frequency} por min na janela.`;
  $("activitySummary").textContent = [metrics, ...patterns].join(" ");
}
onValue(ref(database, `${activityPath}/resumo`), snapshot => {
  activitySummary = snapshot.val();
  renderActivitySummary();
}, () => {
  activitySummary = null;
  renderActivitySummary();
});
setInterval(renderActivitySummary, 5000);
const motionHistoryQuery = query(ref(database, `${activityPath}/movimentos`), orderByChild("inicio_em"), limitToLast(20));
onValue(motionHistoryQuery, snapshot => {
  const events = Object.values(snapshot.val() ?? {}).sort((a, b) => b.inicio_em - a.inicio_em);
  const status = { em_andamento: "Em andamento", encerrada: "Encerrado", interrompida: "Interrompido" };
  const rows = events.map(event => {
    const row = document.createElement("li");
    row.textContent = `${new Date(event.inicio_em).toLocaleString("pt-BR")} · ${motionDuration(event.duracao_ms)} · ${status[event.estado]}${event.parcial ? " · início desconhecido" : ""}`;
    return row;
  });
  $("motionHistory").replaceChildren(...rows);
  $("motionHistoryStatus").textContent = rows.length ? "Até 20 movimentos mais recentes." : "Nenhum movimento registrado pelo serviço.";
}, () => {
  $("motionHistory").replaceChildren();
  $("motionHistoryStatus").textContent = "Histórico indisponível. Verifique o acesso ao Firebase.";
});
