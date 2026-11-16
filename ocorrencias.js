import { database } from "./firebase.js";
import {
  ref, onValue, update, query, orderByChild, limitToLast, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";

const $ = (id) => document.getElementById(id);

// O ESP32 registra alertas de sensores e o monitor registra padrões de atividade.
const OCCURRENCES_PATH = "vetrecovery/box01/ocorrencias";
const occurrenceTypes = {
  temperatura_alta: "Temperatura acima do limite",
  temperatura_baixa: "Temperatura abaixo do limite",
  umidade_alta: "Umidade acima do limite",
  umidade_baixa: "Umidade abaixo do limite",
  movimento: "Movimento detectado",
  movimento_recorrente: "Movimento recorrente",
  movimento_prolongado: "Movimento prolongado"
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
    ? "Nenhuma ocorrência registrada."
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
  if (item.tipo === "movimento_recorrente") return `${rule.repeticoes} inícios em ${rule.janela_min} min`;
  if (item.tipo === "movimento_prolongado") return `Duração de pelo menos ${rule.duracao_s} s`;
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
