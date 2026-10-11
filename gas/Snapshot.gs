/**
 * 管理画面用の「まとめ取り」。各シートを1回ずつだけ読み、画面に必要なデータを1回の通信で返す。
 * 管理画面はこれを手元に持ち、タブの切り替えや絞り込みは通信なしで行う（スマホでも速くするため）。
 */
function apiSnapshot_(p, user) {
  var surveysRaw = readAll_('Surveys');
  var questionsRaw = readAll_('Questions');
  var responsesRaw = readAll_('Responses');
  var answersRaw = readAll_('Answers');
  var aiRaw = readAll_('AI_Analysis');
  var peopleRaw = readAll_('Respondents');

  var questions = {}, questionText = {};
  questionsRaw.slice().sort(function (a, b) { return Number(a.order) - Number(b.order); }).forEach(function (q) {
    var o = strip_(q);
    o.required = q.required === true || String(q.required).toUpperCase() === 'TRUE';
    o.choices = splitList_(q.choices);
    o.options = parseOptions_(q.type, q.options);
    (questions[q.survey_id] = questions[q.survey_id] || []).push(o);
    questionText[q.question_id] = q.text;
  });

  var counts = {}, titles = {};
  responsesRaw.forEach(function (r) { counts[r.survey_id] = (counts[r.survey_id] || 0) + 1; });
  var surveys = surveysRaw.map(function (s) {
    var o = strip_(s);
    o.response_count = counts[s.survey_id] || 0;
    titles[s.survey_id] = s.title;
    return o;
  }).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });

  var answersBy = {};
  answersRaw.forEach(function (a) {
    var o = strip_(a);
    o.question_text = questionText[a.question_id] || '';
    (answersBy[a.response_id] = answersBy[a.response_id] || []).push(o);
  });
  var aiBy = {};
  aiRaw.forEach(function (a) { aiBy[a.response_id] = strip_(a); });
  var people = {};
  peopleRaw.forEach(function (r) { people[r.respondent_id] = r; });

  var responses = responsesRaw.map(function (r) {
    var person = people[r.respondent_id] || {};
    return {
      response_id: r.response_id, survey_id: r.survey_id, survey_title: titles[r.survey_id] || '',
      respondent_id: r.respondent_id, email: person.email || '', name: person.name || '',
      submitted_at: r.submitted_at, answers: answersBy[r.response_id] || [], ai: aiBy[r.response_id] || null
    };
  }).sort(function (a, b) { return String(b.submitted_at).localeCompare(String(a.submitted_at)); });

  return {
    user: user, labels: MEANING_LABELS, types: QUESTION_TYPES, roles: ROLES,
    surveys: surveys, questions: questions, responses: responses,
    respondents: peopleRaw.map(strip_).sort(function (a, b) { return String(b.last_seen).localeCompare(String(a.last_seen)); }),
    tags: readAll_('Tags').map(strip_),
    keys: ROLE_RANK[user.role] >= ROLE_RANK.owner ? apiListKeys_() : null,
    at: nowIso_()
  };
}
