export const activityDefaults = Object.freeze({
  janela_min: 5,
  repeticoes: 4,
  duracao_s: 30
});

export function activityRules(value) {
  const rules = value?.atividade;
  return Number.isInteger(rules?.janela_min) && rules.janela_min >= 1 && rules.janela_min <= 60
    && Number.isInteger(rules.repeticoes) && rules.repeticoes >= 2 && rules.repeticoes <= 100
    && Number.isInteger(rules.duracao_s) && rules.duracao_s >= 2 && rules.duracao_s <= 3600
    ? rules : activityDefaults;
}
