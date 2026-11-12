
// Importação da conexão com o Firebase
import { database } from "./firebase.js";

import {
  ref,
  onValue
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

// Caminho da telemetria no Firebase
const telemetryRef = ref(
  database,
  "vetrecovery/box01/telemetria"
);

// Recebimento dos dados em tempo real
onValue(
  telemetryRef,

  (snapshot) => {

    const data = snapshot.val();

    // Atualiza o status da conexão
    connection.className = "connection online";

    connectionText.textContent = "Conectado ao Firebase";

    // Verifica se existem dados disponíveis
    if (!data) {

      $("alertMessage").className = "alert-box warn";

      $("alertMessage").textContent =
        "Conexão estabelecida, mas ainda não há telemetria em vetrecovery/box01/telemetria.";

      return;
    }

    // Conversão dos valores recebidos
    const temp = Number(data.temperatura);

    const humidity = Number(data.umidade);

    const validTemp = Number.isFinite(temp);

    const validHumidity = Number.isFinite(humidity);

    // Atualização da temperatura
    $("temperature").textContent = validTemp
      ? `${temp.toFixed(1)} °C`
      : "-- °C";

    // Atualização da umidade
    $("humidity").textContent = validHumidity
      ? `${humidity.toFixed(1)} %`
      : "-- %";

    // Verificação da condição do ambiente
    const isAlert =
      String(data.status || "").toUpperCase() === "ALERTA";

    setPill(
      "environmentStatus",

      isAlert
        ? "Atenção necessária"
        : "Ambiente normal",

      isAlert ? "bad" : "good"
    );

    // Verificação do sensor de movimento
    const moving =
      Number(data.movimento) === 1 ||
      data.movimento === true;

    setPill(
      "motionStatus",

      moving
        ? "Movimento detectado"
        : "Sem movimento",

      moving ? "warn" : "good"
    );

    // Atualização dos dispositivos
    $("ledStatus").textContent = data.led || "--";

    $("buzzerStatus").textContent = data.buzzer || "--";

    $("deviceId").textContent = data.dispositivo || "--";

    // Horário em que o dashboard recebeu a atualização
    $("lastUpdate").textContent =
      new Date().toLocaleTimeString("pt-BR");

    // Exibição das mensagens de alerta
    if (isAlert) {

      $("alertMessage").className = "alert-box bad";

      $("alertMessage").textContent =
        `Alerta de temperatura: ${
          validTemp
            ? temp.toFixed(1) + " °C"
            : "leitura indisponível"
        }. Verifique as condições do box.`;

    } else if (moving) {

      $("alertMessage").className = "alert-box warn";

      $("alertMessage").textContent =
        "Movimentação detectada no box. Acompanhe o animal pelo protocolo de monitoramento.";

    } else {

      $("alertMessage").className = "alert-box good";

      $("alertMessage").textContent =
        "Nenhuma condição anormal sinalizada pelo dispositivo neste momento.";

    }

    // Atualização do gráfico
    if (validTemp && validHumidity) {

      addChartPoint(temp, humidity);

    }

  },

  // Tratamento de erros na leitura do Firebase
  (error) => {

    console.error("Erro ao ler o Firebase:", error);

    showError(
      "Não foi possível ler os dados. Verifique as regras de acesso do Realtime Database e a conexão com a internet."
    );

  }
);
