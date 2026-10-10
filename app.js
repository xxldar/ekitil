// EkiTil: страница переводчика. Перевод делает сервер:
//  - на своём компьютере (app.py): POST api/translate;
//  - в интернете — приложение на Hugging Face (space/app.py), к нему браузер посетителя обращается напрямую
//    через @gradio/client, тогда дневной лимит видеокарты считается для каждого посетителя отдельно.
// Где сервер: ?backend=<адрес или uncleel/ekitil> в адресе страницы, иначе по месту запуска.
const API = "api/translate";
const SPACE = "uncleel/ekitil";
const LOCAL = /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(location.hostname);
const BACKEND = new URLSearchParams(location.search).get("backend") || (LOCAL ? "local" : SPACE);
const MAX = 5000;
const NAMES = { kum: "Кумыкский", ru: "Русский" };

const $ = (id) => document.getElementById(id);
const src = $("src"), out = $("out"), note = $("note"), counter = $("counter");
const btn = $("translate"), clearBtn = $("clear"), copyBtn = $("copy"), dirBtn = $("direction");
const reportBtn = $("report");

// направление: по умолчанию определяется автоматически по тексту; после нажатия на переключатель — вручную,
// пока поле не очистят
let direction = "ru-kum";  // при заходе на страницу: русский → кумыкский
let manual = false;
let busy = false;
let lastText = "";
let current = "";  // что сейчас в поле перевода: копируется и уходит в левое поле при смене языков
let lastKind = "model";  // откуда последний перевод: model / dictionary (для сообщения об ошибке)

function renderDirection() {
  const [from, to] = direction.split("-");
  $("lang-from").textContent = NAMES[from];
  $("lang-to").textContent = NAMES[to];
  dirBtn.classList.toggle("is-flipped", direction === "kum-ru");
}

// поле ввода растёт вместе с текстом, но не выше 60% экрана — дальше прокрутка внутри
function autosize() {
  src.style.height = "";  // по умолчанию поле занимает всю карточку (flex), явная высота — только если текст не влез
  if (src.scrollHeight > src.clientHeight + 1) {
    src.style.height = Math.min(src.scrollHeight, Math.round(window.innerHeight * 0.6)) + "px";
  }
}

function renderInput() {
  autosize();
  const n = src.value.length;
  counter.textContent = `${n} / ${MAX}`;
  counter.classList.toggle("is-full", n >= MAX);
  clearBtn.hidden = n === 0;
  btn.disabled = busy || !src.value.trim();  // нечего переводить — кнопка неактивна
}

function setOutput(text, { error = false, loading = false, hint = "" } = {}) {
  closeMenu();
  out.textContent = text;
  current = error || loading ? "" : text;
  out.classList.toggle("is-error", error);
  out.classList.toggle("is-loading", loading);
  note.textContent = hint;
  copyBtn.disabled = !current;
  reportBtn.disabled = !current;
}

const CHEVRON = '<svg class="word__chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK = '<svg class="menu__check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// слово из словаря: показываем первый (предпочтительный) перевод, остальные — в выпадающем списке
function setSenses(senses, hint) {
  const total = senses.reduce((n, s) => n + s.length, 0);
  if (total < 2) return setOutput(senses[0][0], { hint });
  setOutput("", { hint: [hint, `Ещё ${total - 1} ${plural(total - 1, "вариант", "варианта", "вариантов")} — нажмите на слово.`].filter(Boolean).join(" ") });
  const wrap = document.createElement("div");
  wrap.className = "word-wrap";
  const word = document.createElement("button");
  word.type = "button";
  word.className = "word";
  word.setAttribute("aria-haspopup", "listbox");
  word.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  const head = document.createElement("div");
  head.className = "menu__head";
  head.textContent = "Варианты перевода";
  menu.append(head);
  senses.forEach((variants, i) => {
    const group = document.createElement("div");
    group.className = "menu__group";
    if (senses.length > 1) {
      const label = document.createElement("div");
      label.className = "menu__label";
      label.textContent = `${i + 1}`;
      group.append(label);
    }
    const items = document.createElement("div");
    items.className = "menu__items";
    variants.forEach((v) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "menu__item";
      item.setAttribute("role", "option");
      item.dataset.value = v;
      item.innerHTML = `<span></span>${CHECK}`;
      item.firstChild.textContent = v;
      item.addEventListener("click", () => { choose(v); closeMenu(); word.focus(); });
      items.append(item);
    });
    group.append(items);
    menu.append(group);
  });
  function choose(v) {
    current = v;
    word.innerHTML = `<span></span>${CHEVRON}`;
    word.firstChild.textContent = v;
    menu.querySelectorAll(".menu__item").forEach((el) => {
      const on = el.dataset.value === v;
      el.classList.toggle("is-selected", on);
      el.setAttribute("aria-selected", on);
    });
  }
  word.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden ? openMenu(word, menu) : closeMenu();
  });
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll(".menu__item")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(i + 1, items.length - 1)].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); i <= 0 ? word.focus() : items[i - 1].focus(); }
  });
  word.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); openMenu(word, menu); menu.querySelector(".menu__item").focus(); }
  });
  wrap.append(word, menu);
  out.append(wrap);
  choose(senses[0][0]);
  copyBtn.disabled = false;
  reportBtn.disabled = false;
}

let openWord = null;
function openMenu(word, menu) {
  menu.hidden = false;
  word.setAttribute("aria-expanded", "true");
  openWord = word;
}
function closeMenu() {
  if (!openWord) return;
  openWord.setAttribute("aria-expanded", "false");
  openWord.nextElementSibling.hidden = true;
  openWord = null;
}
document.addEventListener("click", (e) => { if (openWord && !e.target.closest(".word-wrap")) closeMenu(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openWord) { const w = openWord; closeMenu(); w.focus(); }
});

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// --- вход через Hugging Face ---
// Гостям Hugging Face даёт всего несколько переводов в день (лимит по IP). Вошедший переводит со своим
// лимитом: 5 минут видеокарты в день на бесплатном аккаунте. Права — только имя и аватар (openid profile).
// Номер «приложения для входа»: на странице в Hugging Face его подставляет сам Hugging Face (README: hf_oauth),
// на GitHub Pages и ekitil.com — наше приложение EkiTil из настроек аккаунта Hugging Face. На своём компьютере
// входа нет.
const HUB = "https://cdn.jsdelivr.net/npm/@huggingface/hub@2/+esm";
const OWN_OAUTH_HOSTS = ["xxldar.github.io", "ekitil.com", "www.ekitil.com"];
const OWN_OAUTH_CLIENT_ID = "e176b377-fe64-4ab0-b834-28d49819c947";  // не секрет: виден любому посетителю
const OAUTH_CLIENT_ID = window.huggingface?.variables?.OAUTH_CLIENT_ID ||
  (OWN_OAUTH_HOSTS.includes(location.hostname) ? OWN_OAUTH_CLIENT_ID : "");
const AUTH_KEY = "ekitil-oauth";
let auth = null;  // {accessToken, accessTokenExpiresAt, userInfo}

function loadAuth() {
  try {
    const a = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    if (a && new Date(a.accessTokenExpiresAt) > new Date()) return a;
    localStorage.removeItem(AUTH_KEY);
  } catch {}
  return null;
}

function renderAuth() {
  $("guest").hidden = !!auth;
  $("user-wrap").hidden = !auth;
  if (auth) {
    $("username").textContent = auth.userInfo.preferred_username || auth.userInfo.name || "";
  }
}

async function login() {
  const { oauthLoginUrl } = await import(HUB);
  const url = await oauthLoginUrl(window.huggingface?.variables?.OAUTH_CLIENT_ID
    ? { scopes: "openid profile" }  // на Hugging Face — как было
    // адрес возврата — точно как в настройках приложения EkiTil, без ?параметров
    : { scopes: "openid profile", clientId: OAUTH_CLIENT_ID, redirectUrl: location.origin + location.pathname });
  // внутри рамки на huggingface.co вход открываем в новой вкладке, иначе браузер может не сохранить вход
  if (window.top !== window.self) window.open(url, "_blank");
  else location.href = url;
}

function logout() {
  try { localStorage.removeItem(AUTH_KEY); } catch {}
  auth = null;
  spaceClient = null;
  $("user-menu").hidden = true;
  renderAuth();
  toast("Вы вышли");
}

async function initAuth() {
  if (!OAUTH_CLIENT_ID) return;  // нет приложения для входа (например, на своём компьютере) — без входа
  $("auth").hidden = false;
  auth = loadAuth();
  if (!auth && /[?&](code|state)=/.test(location.search)) {
    try {
      const { oauthHandleRedirectIfPresent } = await import(HUB);
      auth = await oauthHandleRedirectIfPresent();
      if (auth) {
        try { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); } catch {}
        toast("Вы вошли через Hugging Face");
      }
    } catch (e) {
      console.error(e);
    }
    history.replaceState(null, "", location.pathname);  // убрать code/state из адреса
  }
  renderAuth();
  $("login").addEventListener("click", login);
  $("user").addEventListener("click", (e) => {
    e.stopPropagation();
    const m = $("user-menu");
    m.hidden = !m.hidden;
    $("user").setAttribute("aria-expanded", String(!m.hidden));
  });
  $("logout").addEventListener("click", logout);
  document.addEventListener("click", () => { $("user-menu").hidden = true; $("user").setAttribute("aria-expanded", "false"); });
}

// случайный номер этого браузера — только чтобы считать, сколько разных людей пользуются переводчиком.
// Ни имени, ни текстов в статистику не попадает.
function clientId() {
  try {
    let id = localStorage.getItem("ekitil-client");
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/-/g, "");
      localStorage.setItem("ekitil-client", id);
    }
    return id;
  } catch {
    return "nostorage";
  }
}

let spaceClient = null;
async function getSpace() {
  if (!spaceClient) {
    const { Client } = await import("https://cdn.jsdelivr.net/npm/@gradio/client@2/dist/index.min.js");
    spaceClient = await Client.connect(BACKEND, auth ? { token: auth.accessToken } : {});
  }
  return spaceClient;
}

async function callSpace(text, dir) {
  await getSpace();
  const res = await spaceClient.predict("/translate", { text, direction: dir, client: `${clientId()}:${auth ? "in" : "guest"}` });
  return res.data[0];
}

async function callLocal(text, dir) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, direction: dir }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// понятное сообщение вместо технической ошибки
function errorText(e) {
  const msg = String((e && (e.message || e)) || "");
  if (navigator.onLine === false) return "Нет подключения к интернету.";
  if (/quota|exceeded|limit|лимит/i.test(msg)) {
    if (!auth && !$("auth").hidden) {
      return "Бесплатные переводы для гостей на сегодня закончились. Войдите через Hugging Face — это бесплатно " +
        "и даёт больше переводов в день. Отдельные слова из словаря переводятся и без входа.";
    }
    return "Дневной лимит переводов исчерпан. Попробуйте завтра. Отдельные слова из словаря по-прежнему переводятся.";
  }
  if (/sleep|starting|building|loading/i.test(msg)) {
    return "Переводчик просыпается после перерыва — это занимает пару минут. Попробуйте ещё раз чуть позже.";
  }
  return "Не удалось перевести: сервер недоступен. Попробуйте ещё раз через минуту.";
}

async function translate() {
  const text = src.value.trim();
  if (!text || busy) return;
  busy = true;
  btn.disabled = true;
  btn.textContent = "Перевожу";
  setOutput("Перевожу", { loading: true });
  try {
    const dir = manual ? direction : "auto";
    const data = BACKEND === "local" ? await callLocal(text, dir) : await callSpace(text, dir);
    direction = data.direction;
    renderDirection();
    lastText = text;
    lastKind = data.senses && data.senses.length ? "dictionary" : "model";
    if (data.senses && data.senses.length) setSenses(data.senses, data.notes.join(" "));
    else setOutput(data.translation, { hint: data.notes.join(" ") });
  } catch (e) {
    console.error(e);
    setOutput(errorText(e), { error: true });
    if (auth && /quota|exceeded|limit/i.test(String(e && (e.message || e)))) {
      const a = document.createElement("a");  // точный расход видно только на сайте Hugging Face
      a.href = "https://huggingface.co/settings/billing";
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "out-link";
      a.textContent = "Посмотреть мой лимит";
      out.append(document.createElement("br"), a);
    }
    if (!auth && !$("auth").hidden && /quota|exceeded|limit/i.test(String(e && (e.message || e)))) {
      const b = document.createElement("button");  // вход прямо из сообщения
      b.type = "button";
      b.className = "btn out-action";
      b.textContent = "Войти через Hugging Face";
      b.addEventListener("click", login);
      out.append(document.createElement("br"), b);
    }
  } finally {
    busy = false;
    btn.disabled = !src.value.trim();
    btn.textContent = "Перевести";
  }
}

function swap() {
  direction = direction === "kum-ru" ? "ru-kum" : "kum-ru";
  manual = true;
  renderDirection();
  // перевод становится исходным текстом, как в привычных переводчиках
  if (current && !busy && src.value.trim() === lastText) {
    src.value = current;
    renderInput();
    translate();
  } else if (src.value.trim()) {
    translate();
  }
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("is-shown");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-shown"), 1800);
}

src.addEventListener("input", () => {
  renderInput();
  if (!src.value.trim()) {
    manual = false;
    setOutput("");
  }
});
src.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    translate();
  }
});
btn.addEventListener("click", translate);
dirBtn.addEventListener("click", swap);
clearBtn.addEventListener("click", () => {
  src.value = "";
  manual = false;
  lastText = "";
  renderInput();
  setOutput("");
  src.focus();
});
copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(current);
    toast("Скопировано");
  } catch {
    toast("Не удалось скопировать");
  }
});

// --- сообщение об ошибке перевода: сервер пересылает автору в Telegram, ничего не сохраняет ---
const reportDialog = $("report-dialog");
const reportError = (msg) => { $("report-error").textContent = msg; $("report-error").hidden = !msg; };

function openReport() {
  if (!current) return;
  $("report-src").textContent = lastText;
  $("report-tr").textContent = current;
  $("report-suggestion").value = "";
  $("report-comment").value = "";
  $("report-website").value = "";
  reportError("");
  reportDialog.showModal();
  $("report-suggestion").focus();
}

async function sendReport(e) {
  e.preventDefault();
  const suggestion = $("report-suggestion").value.trim(), comment = $("report-comment").value.trim();
  if (!suggestion && !comment) return reportError("Напишите, как правильно, или комментарий.");
  const send = $("report-send");
  send.disabled = true;
  send.textContent = "Отправляю…";
  reportError("");
  try {
    const client = await getSpace();
    await client.predict("/report", {
      direction, kind: lastKind, src: lastText, translation: current, suggestion, comment,
      client: clientId(), token: auth ? auth.accessToken : "", website: $("report-website").value,
    });
    reportDialog.close();
    toast("Спасибо! Мы проверим перевод");
  } catch (err) {
    console.error(err);
    const msg = String((err && (err.message || err)) || "").replace(/^'|'$/g, "");
    reportError(/[а-яё]/i.test(msg) ? msg : "Не удалось отправить. Попробуйте позже.");
  } finally {
    send.disabled = false;
    send.textContent = "Отправить";
  }
}

reportBtn.hidden = BACKEND === "local";  // на своём компьютере сообщать некуда
reportBtn.addEventListener("click", openReport);
$("report-form").addEventListener("submit", sendReport);
$("report-cancel").addEventListener("click", () => reportDialog.close());
reportDialog.addEventListener("click", (e) => { if (e.target === reportDialog) reportDialog.close(); });  // клик мимо окна

renderDirection();
renderInput();
initAuth();
window.addEventListener("resize", autosize);
// на компьютере сразу ставим курсор в поле; на телефоне — нет, иначе клавиатура закроет пол-экрана
if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) src.focus();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
