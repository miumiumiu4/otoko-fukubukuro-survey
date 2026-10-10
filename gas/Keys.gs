/**
 * 鍵（ログインキー）と権限。
 * - owner  : すべての操作＋鍵の発行・停止ができる。スクリプトプロパティ ADMIN_KEY（元の持ち主。管理画面からは
 *            停止できない）と、「鍵」タブで発行したオーナーの鍵がある
 * - editor : アンケートの作成・編集・公開/停止、AI分析、タグ編集ができる（鍵の管理はできない）
 * - viewer : 閲覧専用。回答・人別・AI分析の結果・タグを見るだけ
 * owner 以外の鍵は管理画面の「鍵」タブで発行する。値は保存せず、SHA-256 のハッシュだけを
 * スクリプトプロパティ KEY_<id> に JSON で持つ（発行時に一度だけ画面に表示）。
 */

var ROLES = { owner: 'オーナー', editor: '編集できる', viewer: '閲覧専用' };
var ROLE_RANK = { viewer: 1, editor: 2, owner: 3 };
var KEY_PREFIX = 'KEY_';

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** 鍵を確かめて { id, name, role } を返す。違えば例外 */
function authenticate_(key) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  key = String(key || '');
  if (key && all.ADMIN_KEY && safeEqual_(key, all.ADMIN_KEY)) {
    return { id: 'owner', name: 'オーナー', role: 'owner' };
  }
  if (key) {
    var hash = sha256Hex_(key);
    for (var prop in all) {
      if (prop.indexOf(KEY_PREFIX) !== 0) continue;
      var rec;
      try { rec = JSON.parse(all[prop]); } catch (e) { continue; }
      if (!rec.disabled && safeEqual_(hash, rec.hash)) {
        // 最終利用日時は1時間に1回だけ書き込む（毎回書くと遅くなるため）
        if (!rec.last_used || Date.now() - new Date(rec.last_used).getTime() > 3600000) {
          rec.last_used = nowIso_();
          props.setProperty(prop, JSON.stringify(rec));
        }
        return { id: prop.slice(KEY_PREFIX.length), name: rec.name, role: rec.role };
      }
    }
  }
  if (!all.ADMIN_KEY) throw new Error('ADMIN_KEY が未設定です。');
  Utilities.sleep(800); // 総当たり対策のささやかな遅延
  throw new Error('管理者キーが違います。');
}

function requireRole_(user, role) {
  if (ROLE_RANK[user.role] < ROLE_RANK[role]) {
    throw new Error('この操作をする権限がありません（' + ROLES[user.role] + 'の鍵です）。');
  }
}

function apiListKeys_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(all).filter(function (k) { return k.indexOf(KEY_PREFIX) === 0; }).map(function (k) {
    var rec = {};
    try { rec = JSON.parse(all[k]); } catch (e) {}
    return { id: k.slice(KEY_PREFIX.length), name: rec.name || '', role: rec.role || '',
      created_at: rec.created_at || '', last_used: rec.last_used || '', disabled: !!rec.disabled };
  }).sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
}

function apiCreateKey_(p) {
  var name = String(p.name || '').trim().slice(0, 30);
  var role = String(p.role || '');
  if (!name) throw new Error('名前を入力してください。');
  if (!ROLES[role]) throw new Error('権限を選んでください。');
  if (apiListKeys_().some(function (k) { return k.name === name && !k.disabled; })) {
    throw new Error('「' + name + '」の鍵はすでにあります。先に停止してから作り直してください。');
  }
  var key = role.charAt(0) + '-' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  var id = newId_('k');
  PropertiesService.getScriptProperties().setProperty(KEY_PREFIX + id, JSON.stringify({
    name: name, role: role, hash: sha256Hex_(key), created_at: nowIso_(), last_used: '', disabled: false
  }));
  return { id: id, name: name, role: role, key: key };
}

function apiRevokeKey_(p) {
  var prop = KEY_PREFIX + String(p.id || '');
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(prop)) throw new Error('鍵が見つかりません。');
  props.deleteProperty(prop);
  return { id: p.id, revoked: true };
}
