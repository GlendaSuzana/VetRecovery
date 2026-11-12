import { database, ref, onValue } from "./firebase.js";

const $ = (id) => document.getElementById(id);
const connection = $("connection");
const connectionText = $("connectionText");

const chart = new Chart($("readingsChart"), {
  type: "line",
  data: {
    labels: [],
    datasets: [
      { label: "Temperatura (°C)", data: [], borderColor: "#16845b", backgroundColor: "#16845b18", yAxisID: "y", tension: 0.3, fill: false },
      { label: "Umidade (%)", data: [], borderColor: "#4787c7", backgroundColor: "#4787c718", yAxisID: "y1", tension: 0.3, fill: false }
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, font: { size: 11 } } } },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 7, font: { size: 10 } } },
      y: { position: "left", title: { display: true, text: "°C" }, suggestedMin: 15, suggestedMax: 35 },
      y1: { position: "right", title: { display: true, text: "%" }, min: 0, max: 100, grid: { drawOnChartArea: false } }
    }
  }
});

function setPill(id, text, type) {
  const el = $(id);
  el.textContent = text;
  el.className = "pill " + type;
}

function addChartPoint(temp, humidity) {
  const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  chart.data.labels.push(now);
  chart.data.datasets[0].data.push(temp);
  chart.data.datasets[1].data.push(humidity);
  if (chart.data.labels.length > 30) {
    chart.data.labels.shift();
    chart.data.datasets.forEach(dataset => dataset.data.shift());
  }
  chart.update();
}

function showError(message) {
  connection.className = "connection offline";
  connectionText.textContent = "Falha na conexão";
  $("alertMessage").className = "alert-box bad";
  $("alertMessage").textContent = message;
}

const telemetryRef = ref(database, "vetrecovery/box01/telemetria");
onValue(telemetryRef, (snapshot) => {
  const data = snapshot.val();
  connection.className = "connection online";
  connectionText.textContent = "Conectado ao Firebase";

  if (!data) {
    $("alertMessage").className = "alert-box warn";
    $("alertMessage").textContent = "Conexão estabelecida, mas ainda não há telemetria em vetrecovery/box01/telemetria.";
    return;
  }

  const temp = Number(data.temperatura);
  const humidity = Number(data.umidade);
  const validTemp = Number.isFinite(temp);
  const validHumidity = Number.isFinite(humidity);

  $("temperature").textContent = validTemp ? `${temp.toFixed(1)} °C` : "-- °C";
  $("humidity").textContent = validHumidity ? `${humidity.toFixed(1)} %` : "-- %";

  const isAlert = String(data.status || "").toUpperCase() === "ALERTA";
  setPill("environmentStatus", isAlert ? "Atenção necessária" : "Ambiente normal", isAlert ? "bad" : "good");

  const moving = Number(data.movimento) === 1 || data.movimento === true;
  setPill("motionStatus", moving ? "Movimento detectado" : "Sem movimento", moving ? "warn" : "good");

  $("ledStatus").textContent = data.led || "--";
  $("buzzerStatus").textContent = data.buzzer || "--";
  $("deviceId").textContent = data.dispositivo || "--";
  $("lastUpdate").textContent = new Date().toLocaleTimeString("pt-BR");

  if (isAlert) {
    $("alertMessage").className = "alert-box bad";
    $("alertMessage").textContent = `Alerta de temperatura: ${validTemp ? temp.toFixed(1) + " °C" : "leitura indisponível"}. Verifique as condições do box.`;
  } else if (moving) {
    $("alertMessage").className = "alert-box warn";
    $("alertMessage").textContent = "Movimentação detectada no box. Acompanhe o animal pelo protocolo de monitoramento.";
  } else {
    $("alertMessage").className = "alert-box good";
    $("alertMessage").textContent = "Nenhuma condição anormal sinalizada pelo dispositivo neste momento.";
  }

  if (validTemp && validHumidity) addChartPoint(temp, humidity);
}, (error) => {
  console.error("Erro ao ler o Firebase:", error);
  showError("Não foi possível ler os dados. Verifique as regras de acesso do Realtime Database e a conexão com a internet.");
});
