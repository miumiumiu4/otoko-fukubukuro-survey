/** 回答者に回答内容のコピーをメールで送る */
function sendCopyMail_(email, name, survey, answers) {
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var visible = answers.filter(function (a) { return a.answer !== ''; });
  var plain = [
    (name ? name + ' 様' : '') ,
    '',
    '「' + survey.title + '」へのご回答ありがとうございました。',
    '以下の内容で受け付けました。',
    '',
    visible.map(function (a) { return '■ ' + a.text + '\n' + a.answer; }).join('\n\n'),
    '',
    '――',
    survey.community || '漢の福袋'
  ].join('\n');

  var html =
    '<div style="background:#0d0d0d;padding:24px;font-family:sans-serif;color:#eee">' +
    '<div style="max-width:560px;margin:0 auto;border:1px solid #c9a24a;padding:24px">' +
    '<p style="color:#c9a24a;letter-spacing:.2em;margin:0 0 8px">' + esc(survey.community || '漢の福袋') + '</p>' +
    '<h2 style="margin:0 0 16px;color:#fff">' + esc(survey.title) + '</h2>' +
    '<p>' + (name ? esc(name) + ' 様<br>' : '') + 'ご回答ありがとうございました。以下の内容で受け付けました。</p>' +
    visible.map(function (a) {
      return '<p style="margin:16px 0 4px;color:#c9a24a;font-weight:bold">' + esc(a.text) + '</p>' +
        '<p style="margin:0;white-space:pre-wrap">' + esc(a.answer) + '</p>';
    }).join('') +
    '</div></div>';

  MailApp.sendEmail({
    to: email,
    subject: '【' + (survey.community || '漢の福袋') + '】ご回答の控え：' + survey.title,
    body: plain,
    htmlBody: html,
    name: survey.community || '漢の福袋'
  });
}
