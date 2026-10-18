// Nó "Conferir resultado da fila" do workflow pQFCtRhzQTKqXTjS.
// Bloqueios conhecidos seguem no monitor de incidentes do 5895; falhas técnicas continuam vermelhas.
const rows = $input.all().map(item => item.json ?? {});
let sent = 0;
let deduplicated = 0;
let cancelled = 0;
let waiting = 0;
let review = 0;
let blocked = 0;
const reasons = {};
for (const item of rows) {
  const result = item.body && typeof item.body === 'object' ? item.body : item;
  if (result.sent === true) {
    if (result.already_sent === true || result.deduplicated === true) deduplicated++;
    else sent++;
    continue;
  }
  if (result.cancelled === true) { cancelled++; continue; }
  const reason = String(result.blocked ?? result.error ?? (result.ok === false ? 'unknown' : ''));
  if (!reason) continue;
  const temporary = result.in_progress === true ||
    result.not_due === true ||
    result.deferred_business_window === true ||
    reason === 'envio-em-andamento' ||
    reason === 'scheduled-message-not-due' ||
    reason === 'peça não pendente' ||
    (reason === 'previous-step-not-sent' &&
      ['pending', 'sending', 'sent'].includes(String(result.previous_status ?? '')));
  if (temporary) { waiting++; continue; }
  if (reason === 'previous-step-not-sent' && result.previous_status === 'failed') {
    review++;
    continue;
  }
  blocked++;
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}
if (blocked > 0) {
  throw new Error('Fila 5895: ' + blocked + ' bloqueios novos: ' +
    Object.entries(reasons).map(([reason, count]) => reason + '=' + count).join(', '));
}
return [{ json: { fetched: rows.length, sent, deduplicated, cancelled, waiting, review, blocked, reasons } }];
