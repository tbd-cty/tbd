// app.js - Giao diện ứng dụng điện thoại TBD: cài đặt, đăng nhập, mã PIN, Việc của tôi, Giao việc, Hóa đơn mua khẩn, Thông báo.

import { Session, loadStored, seenAt, setSeenAt, wipe } from "./session.js";
import { UserError, todayIso } from "./base.js";
import { CHAIN, ROLE_LABELS, STAGE_LABELS, STATE_LABELS } from "./pt.js";
import { STATE_LABELS as RC_LABELS, money, parseAmount } from "./receipts.js";
import { FinanceAccounting, INCOME_KINDS, METHODS as FA_METHODS, key as faKey, parseMoney, recipientTotals } from "./finance.js";

export const VERSION = "2026.11.11";
const $app = document.getElementById("app");
const $sheet = document.getElementById("sheet");
const $toast = document.getElementById("toast");

const S = {
  session: null, setupSession: null, tab: "tasks", taskSeg: "pending", rcSeg: "", data: null, loading: false, loadedAt: 0, error: "",
};

// ---------------- tiện ích ----------------
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ESC[c]);
const fmtTime = (iso) => (iso && iso.length >= 16 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}` : esc(iso || ""));
const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const nm = (u) => (S.session ? S.session.name(u) : u);
const KNOWN = new Set(["UserError", "DriveError", "OfflineError", "ConflictError", "AuthExpiredError", "CryptoError"]);
const friendly = (e) => (e instanceof UserError || (e && e.constructor && KNOWN.has(e.constructor.name)) ? e.message : `Có lỗi không mong đợi: ${e && e.message ? e.message : e}`);

const ICON = {
  fin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
  receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
};

function toast(msg, bad = false) {
  $toast.textContent = msg;
  $toast.className = "toast" + (bad ? " bad" : "");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.add("hidden"), bad ? 5000 : 2600);
}

function busy(button, text) {
  if (!button) return () => {};
  const old = button.textContent;
  button.disabled = true;
  button.textContent = text;
  return () => { button.disabled = false; button.textContent = old; };
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function standalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

// ---------------- màn hình cài đặt / đăng nhập / PIN ----------------
function brand(sub) {
  return `<div class="brand"><img src="icons/icon-192.png" alt=""><div><h1>TBD Công việc</h1><p>${esc(sub)}</p></div></div>`;
}

function showSetup(prefill = "") {
  const iosHint = isIOS() && !standalone()
    ? `<div class="box warn">iPhone: bấm nút <b>Chia sẻ</b> rồi <b>Thêm vào MH chính</b>, sau đó mở ứng dụng từ biểu tượng TBD trên màn hình chính và dán mã cài đặt vào ô dưới.
       <button class="btn small ghost" id="copyCode">Sao chép mã cài đặt</button></div>` : "";
  $app.innerHTML = `<div class="auth">${brand("Công ty Thái Bình Dương")}
    <h2>Cài đặt lần đầu</h2>
    <p class="hint">Nhập mã cài đặt (Giám đốc gửi qua Zalo) và mật khẩu kích hoạt (Giám đốc báo trực tiếp).</p>
    ${iosHint}
    <label class="field" for="code">Mã cài đặt</label>
    <textarea class="inp" id="code" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="TBDM1....">${esc(prefill)}</textarea>
    <label class="field" for="act">Mật khẩu kích hoạt</label>
    <input class="inp" id="act" autocomplete="off" autocapitalize="off" spellcheck="false">
    <p class="err" id="err"></p>
    <button class="btn" id="go">Tiếp tục</button></div>`;
  const copy = document.getElementById("copyCode");
  if (copy) copy.onclick = async () => {
    try { await navigator.clipboard.writeText(document.getElementById("code").value.trim()); toast("Đã sao chép mã."); } catch (e) { toast("Hãy chọn và sao chép mã bằng tay.", true); }
  };
  document.getElementById("go").onclick = async (ev) => {
    const err = document.getElementById("err");
    err.textContent = "";
    const done = busy(ev.target, "Đang kiểm tra...");
    try {
      S.setupSession = await Session.setup(document.getElementById("code").value, document.getElementById("act").value);
      history.replaceState(null, "", location.pathname);                      // xóa mã khỏi thanh địa chỉ
      showLogin();
    } catch (e) {
      err.textContent = friendly(e);
      done();
    }
  };
}

function showLogin() {
  $app.innerHTML = `<div class="auth">${brand("Đăng nhập")}
    <p class="hint">Dùng tên đăng nhập và mật khẩu giống trên máy tính.</p>
    <label class="field" for="u">Tên đăng nhập</label>
    <input class="inp" id="u" autocomplete="username" autocapitalize="off" spellcheck="false">
    <label class="field" for="p">Mật khẩu</label>
    <input class="inp" id="p" type="password" autocomplete="current-password">
    <p class="err" id="err"></p>
    <button class="btn" id="go">Đăng nhập</button></div>`;
  document.getElementById("go").onclick = async (ev) => {
    const err = document.getElementById("err");
    err.textContent = "";
    const done = busy(ev.target, "Đang đăng nhập...");
    try {
      await S.setupSession.login(document.getElementById("u").value, document.getElementById("p").value);
      showPinCreate();
    } catch (e) {
      err.textContent = friendly(e);
      done();
    }
  };
}

function showPinCreate() {
  const user = S.setupSession.user;
  $app.innerHTML = `<div class="auth">${brand(`${user.full_name} · ${ROLE_LABELS[user.role] || user.role}`)}
    <h2>Đặt mã PIN cho điện thoại</h2>
    <p class="hint">Mỗi lần mở ứng dụng chỉ cần nhập 6 số này. Không dùng ngày sinh hay 123456. Sai 5 lần thì phải cài đặt lại.</p>
    <label class="field" for="p1">Mã PIN (6 số)</label>
    <input class="inp pin" id="p1" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">
    <label class="field" for="p2">Nhập lại mã PIN</label>
    <input class="inp pin" id="p2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">
    <p class="err" id="err"></p>
    <button class="btn" id="go">Lưu và vào ứng dụng</button></div>`;
  document.getElementById("go").onclick = async (ev) => {
    const p1 = document.getElementById("p1").value, p2 = document.getElementById("p2").value, err = document.getElementById("err");
    if (!/^\d{6}$/.test(p1)) { err.textContent = "Mã PIN gồm đúng 6 chữ số."; return; }
    if (p1 !== p2) { err.textContent = "Hai lần nhập không giống nhau."; return; }
    if (/^(\d)\1{5}$/.test(p1) || ["123456", "654321", "012345"].includes(p1)) { err.textContent = "Mã PIN quá dễ đoán, hãy chọn số khác."; return; }
    const done = busy(ev.target, "Đang lưu...");
    try {
      await S.setupSession.savePin(p1);
      keepStorage();
      S.session = S.setupSession;
      S.setupSession = null;
      showMain();
    } catch (e) {
      err.textContent = friendly(e);
      done();
    }
  };
}

function showUnlock() {
  const stored = loadStored();
  $app.innerHTML = `<div class="auth">${brand(stored.full_name)}
    <h2>Nhập mã PIN</h2>
    <input class="inp pin" id="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" autofocus>
    <p class="err" id="err"></p>
    <button class="btn" id="go">Mở</button>
    <button class="linkbtn" id="forget">Quên mã PIN / đổi người dùng</button></div>`;
  const pin = document.getElementById("pin"), go = document.getElementById("go");
  pin.addEventListener("input", () => { if (pin.value.length === 6) go.click(); });
  go.onclick = async () => {
    const err = document.getElementById("err");
    err.textContent = "";
    const done = busy(go, "Đang mở...");
    try {
      const session = await Session.unlock(pin.value);
      S.session = session;
      try {
        await session.refreshUser();
      } catch (e) {
        if (!loadStored()) { S.session = null; throw e; }     // tài khoản bị khóa -> đã xóa dữ liệu
        session.user = { username: session.pendingUsername, full_name: stored.full_name, role: "", active: true };
        S.error = `Chưa tải được tài khoản: ${friendly(e)}`;
      }
      showMain();
    } catch (e) {
      err.textContent = friendly(e);
      pin.value = "";
      done();
      if (!loadStored()) setTimeout(() => showSetup(), 2500);
    }
  };
  document.getElementById("forget").onclick = () => {
    if (confirm("Xóa dữ liệu ứng dụng trên điện thoại này? Bạn sẽ cần mã cài đặt và mật khẩu kích hoạt để cài lại.")) {
      wipe();
      showSetup();
    }
  };
}

// ---------------- khung chính ----------------
function showMain() {
  render();
  refresh(true);
}

async function refresh(force = false) {
  if (!S.session || S.loading) return;
  if (!force && Date.now() - S.loadedAt < 20000) return;
  S.loading = true;
  render();
  try {
    await S.session.refreshUser();
    const role = S.session.user.role;
    const [pt, rc, wl, at, fa] = await Promise.all([S.session.readPT(), S.session.readRC(),
      role === "director" ? null : S.session.readWL().catch(() => null),
      role === "team_leader" ? S.session.readAT().catch(() => null) : null,
      role === "director" || role === "purchasing_head" ? S.session.readFA().catch(() => null) : null]);
    S.data = { pt, rc, wl, at, fa };
    S.loadedAt = Date.now();
    S.error = "";
  } catch (e) {
    S.error = friendly(e);
    if (!loadStored()) { S.session = null; S.loading = false; showSetup(); toast(S.error, true); return; }
  }
  S.loading = false;
  render();
}

function pendingItems() {
  if (!S.data) return [];
  const items = [];
  for (const it of S.data.pt.myPending()) items.push({ src: "pt", ...it });
  for (const it of S.data.rc.myPending()) items.push({ src: "rc", ...it });
  const fa = S.data.fa;
  if (fa) {
    for (const it of fa.myPending()) items.push({ src: "fa", ...it });
    if (fa.isAccountant) {                                   // hóa đơn khẩn đã xác nhận mà chưa có phiếu chi hoàn ứng
      const links = fa.receiptLinks();
      for (const r of S.data.rc.list()) {
        if (r.state === "confirmed" && !links[r.id]) items.push({ src: "fa", kind: "receipt_to_voucher", id: r.id, content: r.note, total: r.amount, project_label: r.project_label, since: r.reviewed_at || r.submitted_at });
      }
    }
  }
  return items;
}

function notifications() {
  if (!S.data) return [];
  const me = S.session.user.username;
  const out = [];
  for (const ev of S.data.pt.myNotifications()) out.push({ at: ev.at, text: ptNotifText(ev, me), open: ev.ref_type === "task" ? { task: ev.ref_id } : null });
  for (const ev of S.data.rc.myNotifications()) out.push({ at: ev.at, text: rcNotifText(ev, me), open: { receipt: ev.id } });
  if (S.data.fa) for (const ev of S.data.fa.myNotifications()) out.push({ at: ev.at, text: faNotifText(ev), open: { voucher: ev.id } });
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 60);
}

function faNotifText(ev) {
  const by = nm(ev.by);
  return {
    "Gửi duyệt": `${by} gửi phiếu chi ${ev.id} chờ duyệt: «${ev.content}» (${money(ev.total)} đ)`,
    "Duyệt": `${by} đã duyệt phiếu chi ${ev.id} (${money(ev.total)} đ)`,
    "Trả lại": `${by} trả lại phiếu chi ${ev.id} · Lý do: ${ev.note}`,
    "Hủy phiếu": `${by} hủy phiếu chi ${ev.id} · Lý do: ${ev.note}`,
  }[ev.event] || `${by}: ${ev.event} phiếu chi ${ev.id}`;
}

function where(code, name) {
  return code ? `${code} ${name}` : "Việc ngoài dự án";
}

function ptNotifText(ev, me) {
  const by = nm(ev.by), title = `«${ev.title}»`, noun = ev.ref_type === "survey" ? "phiếu khảo sát" : "việc";
  const w = where(ev.project_code, "").trim() || "việc ngoài dự án";
  const note = ev.note && !["Giao việc", "Giao phiếu khảo sát"].includes(ev.kind) ? `: ${ev.note}` : "";
  switch (ev.kind) {
    case "stage": return `${by} chuyển dự án ${ev.project_code} ${ev.project_name} sang «${STAGE_LABELS[ev.to] || ev.to}»${ev.note ? ` (${ev.note})` : ""}`;
    case "Giao việc": case "Giao phiếu khảo sát": return `${by} giao ${noun} ${title} cho ${ev.assignee === me ? "bạn" : nm(ev.assignee)} (${w})`;
    case "Báo cáo xong": return `${by} báo cáo xong ${noun} ${title} (${w})${ev.assigner === me ? ", chờ bạn xác nhận" : ""}${note}`;
    case "Rút lại báo cáo": return `${by} rút lại báo cáo ${noun} ${title} (${w})`;
    case "Xác nhận hoàn thành": return `${by} xác nhận ${noun} ${title} ${ev.assignee === me ? "của bạn" : `của ${nm(ev.assignee)}`} đã hoàn thành (${w})`;
    case "Trả lại làm lại": return `${by} trả lại ${noun} ${title} ${ev.assignee === me ? "để bạn làm lại" : `để ${nm(ev.assignee)} làm lại`} (${w})${note}`;
    default: return `${by}: ${ev.kind} ${noun} ${title} (${w})`;
  }
}

function rcNotifText(ev, me) {
  const by = nm(ev.by), whose = ev.submitter === me ? "của bạn" : `của ${nm(ev.submitter)}`;
  return {
    "Gửi hóa đơn": `${by} gửi hóa đơn mua khẩn ${ev.id}: «${ev.note}»`,
    "Gửi lại": `${by} gửi lại hóa đơn ${ev.id}: «${ev.note}»`,
    "Xác nhận": `${by} xác nhận hóa đơn ${ev.id} ${whose}: ${ev.note}`,
    "Sửa phân loại": `${by} sửa phân loại hóa đơn ${ev.id} ${whose}: ${ev.note}`,
    "Trả lại": `${by} trả lại hóa đơn ${ev.id} ${whose} · Lý do: ${ev.note}`,
  }[ev.event] || `${by}: ${ev.event} hóa đơn ${ev.id}`;
}

const PENDING_HEAD = {
  assign: "Dự án mới chưa giao Trưởng phòng", review_quote: "Báo giá chờ Giám đốc duyệt", negotiate: "Dự án đang đàm phán",
  start_plan: "Dự án mới giao cho bạn", make_quote: "Đến lượt bạn lập báo giá", quote_returned: "Giám đốc trả lại báo giá",
  new_project: "Dự án mới giao cho bạn: giao việc cho Trưởng nhóm",
  todo: "Việc được giao", returned: "Việc bị trả lại làm lại", to_confirm: "Chờ bạn xác nhận",
  survey_todo: "Phiếu khảo sát được giao", survey_returned: "Phiếu khảo sát bị trả lại", survey_to_confirm: "Phiếu khảo sát chờ bạn xác nhận",
  receipt_to_review: "Hóa đơn chờ bạn xác nhận", receipt_returned: "Hóa đơn bị trả lại",
  voucher_to_approve: "Phiếu chi chờ duyệt", voucher_returned: "Phiếu chi bị trả lại", voucher_to_pay: "Phiếu chi chờ ghi chi", receipt_to_voucher: "Hóa đơn cần lập phiếu chi",
};

function pendingCard(it) {
  const head = PENDING_HEAD[it.kind] || it.kind;
  const red = it.overdue || ["returned", "survey_returned", "receipt_returned", "quote_returned", "voucher_returned"].includes(it.kind);
  const urgent = ["to_confirm", "survey_to_confirm", "receipt_to_review"].includes(it.kind);
  if (it.src === "fa") {
    const open = it.kind === "receipt_to_voucher" ? `data-open-receipt="${esc(it.id)}"` : `data-open-voucher="${esc(it.id)}"`;
    return `<button class="card" ${open}><div class="tag ${red ? "red" : "amber"}">${head}</div><div class="title">${esc(it.content)}</div>
      <div class="meta">${money(it.total)} đ · ${esc(it.project_label)}${it.reason ? ` · ${esc(it.reason)}` : ""}</div></button>`;
  }
  if (it.src === "rc") {
    const line = it.kind === "receipt_to_review" ? `${nm(it.submitter)} · ${it.images} ảnh · ${fmtTime(it.since)}` : `Lý do: ${esc(it.note)}`;
    return `<button class="card" data-open-receipt="${esc(it.id)}"><div class="tag ${red ? "red" : "amber"}">${head}</div>
      <div class="title">${esc(it.kind === "receipt_to_review" ? it.note : it.id)}</div><div class="meta">${it.kind === "receipt_to_review" ? esc(line) : line}</div></button>`;
  }
  const w = esc(where(it.project_code, it.project_name));
  if (it.ref_type === "task") {
    const who = it.kind === "to_confirm" ? `${esc(nm(it.other))} báo cáo xong` : `giao bởi ${esc(nm(it.other))}`;
    const due = it.due ? ` · hạn ${fmtDate(it.due)}${it.overdue ? " (QUÁ HẠN)" : ""}` : "";
    const note = it.note ? `<div class="note">${it.kind === "to_confirm" ? "Kết quả" : "Lý do trả lại"}: ${esc(it.note)}</div>` : "";
    const kids = it.pending_children ? `<div class="meta">Đã chia nhỏ, còn ${it.pending_children} việc nhỏ chưa xong</div>` : "";
    return `<button class="card" data-open-task="${esc(it.ref_id)}"><div class="tag ${red ? "red" : urgent ? "amber" : ""}">${head}</div>
      <div class="title">${esc(it.title)}</div><div class="meta">${w} · ${who}${due}</div>${note}${kids}</button>`;
  }
  return `<div class="card"><div class="tag ${red ? "red" : ""}">${head}</div><div class="title">${esc(it.title)}</div>
    <div class="meta">${w}${it.note ? ` · ${esc(it.note)}` : ""}</div><div class="meta">Xử lý việc này trên phần mềm máy tính.</div></div>`;
}

function tasksTab() {
  if (!S.data) return S.loading ? `<p class="empty">Đang tải...</p>` : "";
  const seg = `<div class="seg"><button data-seg="pending" class="${S.taskSeg === "pending" ? "on" : ""}">Đang chờ tôi</button>
    <button data-seg="all" class="${S.taskSeg === "all" ? "on" : ""}">Tất cả việc</button></div>`;
  let body;
  if (S.taskSeg === "pending") {
    const items = pendingItems();
    body = items.length ? items.map(pendingCard).join("") : `<p class="empty">Không có việc nào đang chờ bạn.</p>`;
  } else {
    const me = S.session.user.username;
    const rows = S.data.pt.myTasks();
    const mine = rows.filter((t) => t.assignee === me), given = rows.filter((t) => t.assigner === me);
    const card = (t, other) => `<button class="card" data-open-task="${esc(t.id)}"><div class="tag ${t.state === "done" ? "green" : t.state === "reported" ? "amber" : ""}">${STATE_LABELS[t.state]}</div>
      <div class="title">${esc(t.title)}</div><div class="meta">${esc(where(t.project_code, t.project_name))} · ${esc(other)}${t.due_date ? ` · hạn ${fmtDate(t.due_date)}` : ""}</div></button>`;
    body = `<div class="section">Việc tôi được giao (${mine.length})</div>${mine.map((t) => card(t, `giao bởi ${nm(t.assigner)}`)).join("") || `<p class="empty">Chưa có.</p>`}
      <div class="section">Việc tôi đã giao (${given.length})</div>${given.map((t) => card(t, `cho ${nm(t.assignee)}`)).join("") || `<p class="empty">Chưa có.</p>`}`;
  }
  const fab = CHAIN[S.session.user.role] ? `<button class="fab" id="assign">+ Giao việc</button>` : "";
  return todayCard() + seg + body + fab;
}

// ---------------- nhật ký «Hôm nay tôi đang làm» (mọi người trừ Giám đốc) ----------------
function todayCard() {
  if (S.session.user.role === "director" || !S.data.wl) return "";
  const e = S.data.wl.mineToday();
  if (!e) {
    return `<button class="card today-missing" id="today"><div class="tag red">Nhật ký hôm nay</div>
      <div class="title">Hôm nay tôi đang làm... (chưa ghi)</div><div class="meta">Bấm để ghi</div></button>`;
  }
  const p = e.project_id ? S.data.pt.myProjects().find((x) => x.id === e.project_id) : null;
  const w = e.project_id ? (p ? `${p.code} ${p.name}` : e.project_id) : "Việc ngoài dự án";
  const crew = S.data.at ? S.data.at.myDay(todayIso()) : null;
  const crewNote = crew ? ` · chấm công ${crew.entries.length + 1} người${crew.state === "confirmed" ? " (đã xác nhận)" : ""}` : (S.data.at ? " · chưa chấm công công nhân" : "");
  return `<button class="card" id="today"><div class="tag green">Nhật ký hôm nay · ghi lúc ${fmtTime(e.updated_at).slice(6)}</div>
    <div class="title">${esc(e.text)}</div><div class="meta">${esc(w)}${crewNote} · bấm để sửa</div></button>`;
}

function crewRows(at, day) {
  const marked = new Map((day ? day.entries : []).map((x) => [x.person_id, x]));
  const locked = day && (day.state === "confirmed" || at.locked(day.date.slice(0, 7)));
  const rows = at.people().map((p) => {
    const m = marked.get(p.id), ot = m ? m.overtime : 0;
    return `<div class="card crew" data-pid="${esc(p.id)}"><label class="crewname"><input type="checkbox" class="c-present" ${m ? "checked" : ""} ${locked ? "disabled" : ""}> ${esc(p.name)} <span class="meta">(${p.kind === "official" ? "chính thức" : "thời vụ"})</span></label>
      <div class="crewot"><label><input type="checkbox" class="c-half" ${ot === 0.5 ? "checked" : ""} ${locked ? "disabled" : ""}> Tăng ca ½ công</label>
      <label><input type="checkbox" class="c-full" ${ot === 1 ? "checked" : ""} ${locked ? "disabled" : ""}> Tăng ca 1 công</label></div></div>`;
  }).join("");
  const lead = `<div class="card crew" data-lead="1"><div class="crewname">Tôi (Trưởng nhóm) · đi làm khi ghi nhật ký</div>
    <div class="crewot"><label><input type="checkbox" class="c-half" ${day && day.leader_overtime === 0.5 ? "checked" : ""} ${locked ? "disabled" : ""}> Tăng ca ½ công</label>
    <label><input type="checkbox" class="c-full" ${day && day.leader_overtime === 1 ? "checked" : ""} ${locked ? "disabled" : ""}> Tăng ca 1 công</label></div></div>`;
  return { html: lead + (rows || `<p class="empty">Chưa có công nhân nào. Bấm «+ Thêm công nhân» (mỗi dòng một tên).</p>`), locked };
}

function collectCrew() {
  const entries = [];
  let leaderOt = 0;
  for (const el of document.querySelectorAll("#crew .crew")) {
    const half = el.querySelector(".c-half").checked, full = el.querySelector(".c-full").checked;
    const ot = full ? 1 : half ? 0.5 : 0;
    if (el.dataset.lead) { leaderOt = ot; continue; }
    if (el.querySelector(".c-present").checked || ot) entries.push({ person_id: el.dataset.pid, overtime: ot });
  }
  return { entries, leaderOt };
}

function wireCrew() {
  for (const el of document.querySelectorAll("#crew .crew")) {
    const half = el.querySelector(".c-half"), full = el.querySelector(".c-full"), present = el.querySelector(".c-present");
    half.onchange = () => { if (half.checked) { full.checked = false; if (present) present.checked = true; } };         // tăng ca ½ công hoặc 1 công: chọn một
    full.onchange = () => { if (full.checked) { half.checked = false; if (present) present.checked = true; } };
  }
}

function openAddPeople() {
  openSheet("Thêm công nhân", `<label class="field" for="npnames">Họ tên (mỗi dòng một người)</label>
    <textarea class="inp" id="npnames" rows="5" placeholder="Nguyễn Văn A&#10;Trần Văn B"></textarea>
    <label class="field" for="npkind">Loại</label><select class="inp" id="npkind"><option value="seasonal">Thời vụ</option><option value="official">Chính thức</option></select>
    <button class="btn" id="npsave">Thêm</button>`, () => openToday());
  document.getElementById("npsave").onclick = async (ev) => {
    const done = busy(ev.target, "Đang thêm...");
    try {
      const names = document.getElementById("npnames").value, kind = document.getElementById("npkind").value;
      await S.session.editAT((m) => m.addPeople(names, kind));
      toast("Đã thêm công nhân.");
      S.data.at = await S.session.readAT();
      openToday();
    } catch (e) {
      done();
      toast(friendly(e), true);
    }
  };
}

function openToday() {
  const wl = S.data.wl, e = wl.mineToday();
  const at = S.data.at, day = at ? at.myDay(todayIso()) : null;
  const projects = S.data.pt.myProjects();
  const recent = wl.mine(7).filter((x) => !e || x.id !== e.id);
  openSheet("Nhật ký hôm nay", `<p class="hint">Hôm nay ${fmtDate(todayIso())}. Ghi lại trong ngày thì nội dung được cập nhật.</p>
    <label class="field" for="wproj">Dự án</label><select class="inp" id="wproj"><option value="">Việc ngoài dự án</option>
      ${projects.map((p) => `<option value="${esc(p.id)}" ${e && e.project_id === p.id ? "selected" : ""}>${esc(p.code)} ${esc(p.name)}</option>`).join("")}</select>
    <label class="field" for="wtext">Hôm nay tôi đang làm</label>
    <textarea class="inp" id="wtext" maxlength="300" placeholder="Ví dụ: Đấu tủ điện A tại xưởng AB2">${esc(e ? e.text : "")}</textarea>
    ${at ? `<div class="section">Chấm công hôm nay</div><p class="hint">Tick người đi làm; tăng ca chọn ½ công hoặc 1 công. Ngày nào không ghi nhật ký thì cả tổ tính nghỉ.</p>
      <div id="crew">${crewRows(at, day).html}</div><button class="btn secondary" id="npadd">+ Thêm công nhân</button>` : ""}
    <button class="btn" id="wsave">${at ? "Ghi nhật ký và chấm công" : "Ghi"}</button>
    ${recent.length ? `<div class="section">Các ngày trước</div>${recent.map((x) => `<div class="card"><div class="meta">${fmtDate(x.date)}</div><div class="note">${esc(x.text)}</div></div>`).join("")}` : ""}`);
  document.getElementById("wsave").onclick = (ev) => {
    const text = document.getElementById("wtext").value, pid = document.getElementById("wproj").value;
    if (!text.trim()) { toast("Hãy ghi hôm nay bạn đang làm gì.", true); return; }
    if (!at) { runEdit(ev.target, "Đang ghi...", () => S.session.editWL((m) => m.setToday(text, pid)), "Đã ghi nhật ký hôm nay."); return; }
    const { entries, leaderOt } = collectCrew();
    const proj = projects.find((p) => p.id === pid);
    runEdit(ev.target, "Đang ghi...", async () => {
      await S.session.editAT((m) => m.saveDay(todayIso(), pid, proj ? `${proj.code} ${proj.name}` : "", text, entries, leaderOt));
      await S.session.editWL((m) => m.setToday(text, pid));                                           // nhật ký hôm nay: Giám đốc thấy ở mục Theo dõi
    }, "Đã ghi nhật ký và chấm công.");
  };
  if (at) {
    wireCrew();
    document.getElementById("npadd").onclick = openAddPeople;
    if (crewRows(at, day).locked) { toast("Công hôm nay đã được xác nhận hoặc tháng đã chốt, không sửa được.", true); document.getElementById("wsave").disabled = true; }
  }
}

function receiptsTab() {
  if (!S.data) return S.loading ? `<p class="empty">Đang tải...</p>` : "";
  const me = S.session.user.username, rc = S.data.rc;
  const all = rc.list();
  const canSend = S.session.user.role !== "director";
  const toReview = all.filter((r) => r.actions.includes("confirm"));
  const mine = all.filter((r) => r.submitter === me);
  const others = all.filter((r) => r.submitter !== me);
  const card = (r) => `<button class="card" data-open-receipt="${esc(r.id)}"><div class="tag ${{ submitted: "amber", returned: "red", confirmed: "green" }[r.state]}">${r.id} · ${RC_LABELS[r.state]}</div>
    <div class="title">${esc(r.note)}</div><div class="meta">${r.submitter === me ? "" : esc(nm(r.submitter)) + " · "}${fmtTime(r.submitted_at)} · ${r.images.length} ảnh${r.state === "confirmed" ? ` · ${esc(r.project_label)} · ${money(r.amount)} đ` : ""}</div>
    ${r.state === "returned" ? `<div class="note">Lý do trả lại: ${esc(r.return_reason)}</div>` : ""}</button>`;
  let html = canSend ? `<button class="big-action" id="newReceipt">${ICON.camera}<span>Chụp hóa đơn và gửi</span></button>` : "";
  if (others.length || !canSend) {
    const seg = S.rcSeg || (toReview.length ? "review" : "all");
    html += `<div class="seg"><button data-rcseg="review" class="${seg === "review" ? "on" : ""}">Chờ tôi xác nhận (${toReview.length})</button>
      <button data-rcseg="all" class="${seg === "all" ? "on" : ""}">Tất cả</button>${canSend ? `<button data-rcseg="mine" class="${seg === "mine" ? "on" : ""}">Của tôi</button>` : ""}</div>`;
    const list = seg === "review" ? toReview : seg === "mine" ? mine : all;
    html += list.length ? list.map(card).join("") : `<p class="empty">Không có hóa đơn nào.</p>`;
    if (seg === "all") {
      const totals = rc.totalsByProject();
      if (totals.length) {
        html += `<div class="section">Tổng đã chi (đã xác nhận)</div><div class="box">${totals.map((t) =>
          `<div class="total"><span>${esc(t.label)} (${t.count})</span><b>${money(t.total)} đ</b></div>`).join("")}</div>`;
      }
    }
  } else {
    html += `<div class="section">Hóa đơn của tôi</div>` + (mine.length ? mine.map(card).join("") : `<p class="empty">Chưa gửi hóa đơn nào.</p>`);
  }
  return html;
}

function notifTab() {
  if (!S.data) return S.loading ? `<p class="empty">Đang tải...</p>` : "";
  const list = notifications();
  const seen = seenAt(S.session.user.username);
  const html = list.length ? list.map((n, i) => `<button class="card ${n.at > seen ? "unread" : ""}" data-notif="${i}">
      <div class="meta">${fmtTime(n.at)}</div><div class="note">${esc(n.text)}</div></button>`).join("") : `<p class="empty">Chưa có thông báo nào.</p>`;
  S.notifList = list;
  if (list.length) setTimeout(() => setSeenAt(S.session.user.username, list[0].at), 1500);
  return html;
}

function moreTab() {
  const u = S.session.user;
  return `<div class="box"><div class="kv"><b>Họ tên:</b> ${esc(u.full_name)}</div><div class="kv"><b>Tên đăng nhập:</b> ${esc(u.username)}</div>
    <div class="kv"><b>Vai trò:</b> ${esc(ROLE_LABELS[u.role] || u.role)}</div><div class="kv"><b>Cấp trên:</b> ${esc(nm(u.supervisor) || "-")}</div></div>
    <button class="btn ghost" id="lock">Khóa ứng dụng</button>
    <button class="btn ghost" id="logout">Đăng xuất khỏi điện thoại này</button>
    <p class="hint mt">Bản ${VERSION}. Đổi mật khẩu, báo giá, danh mục: dùng phần mềm trên máy tính.</p>`;
}

function badgeCounts() {
  const pend = pendingItems().length;
  const seen = S.session ? seenAt(S.session.user.username) : "";
  const unread = notifications().filter((n) => n.at > seen).length;
  const rcPending = S.data ? S.data.rc.myPending().length : 0;
  const faPending = S.data ? pendingItems().filter((i) => i.src === "fa").length : 0;
  return { pend: pend - rcPending - faPending, rc: rcPending, fa: faPending, unread };
}

function render() {
  if (!S.session) return;
  const counts = S.data ? badgeCounts() : { pend: 0, rc: 0, fa: 0, unread: 0 };
  const hasFin = !!(S.data && S.data.fa);
  if (S.tab === "fin" && !hasFin) S.tab = "tasks";
  const titles = { tasks: "Việc của tôi", receipts: "Hóa đơn mua khẩn", fin: "Tài chính", notif: "Thông báo", more: "Tài khoản" };
  const body = { tasks: tasksTab, receipts: receiptsTab, fin: financeTab, notif: notifTab, more: moreTab }[S.tab]();
  const badge = (n) => (n ? `<span class="badge">${n > 99 ? "99+" : n}</span>` : "");
  const banner = S.error ? `<div class="banner">${esc(S.error)}</div>` : "";
  $app.innerHTML = `<header class="top"><h1>${titles[S.tab]}<span class="sub">${esc(S.session.user.full_name)}${S.loadedAt ? ` · cập nhật ${new Date(S.loadedAt).toTimeString().slice(0, 5)}` : ""}</span></h1>
      <button class="iconbtn ${S.loading ? "spin" : ""}" id="refresh" aria-label="Làm mới">${ICON.refresh}</button></header>
    <main>${banner}${body}</main>
    <nav class="tabs">
      <button data-tab="tasks" class="${S.tab === "tasks" ? "on" : ""}">${ICON.tasks}Việc${badge(counts.pend)}</button>
      <button data-tab="receipts" class="${S.tab === "receipts" ? "on" : ""}">${ICON.receipt}Hóa đơn${badge(counts.rc)}</button>
      ${hasFin ? `<button data-tab="fin" class="${S.tab === "fin" ? "on" : ""}">${ICON.fin}Tiền${badge(counts.fa)}</button>` : ""}
      <button data-tab="notif" class="${S.tab === "notif" ? "on" : ""}">${ICON.bell}Thông báo${badge(S.tab === "notif" ? 0 : counts.unread)}</button>
      <button data-tab="more" class="${S.tab === "more" ? "on" : ""}">${ICON.more}Tài khoản</button></nav>`;
  try { if (navigator.setAppBadge) (counts.pend + counts.rc + counts.fa ? navigator.setAppBadge(counts.pend + counts.rc + counts.fa) : navigator.clearAppBadge()); } catch (e) { /* bỏ qua */ }
}

$app.addEventListener("click", (ev) => {
  const t = ev.target.closest("button");
  if (!t || !S.session) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.seg) { S.taskSeg = t.dataset.seg; render(); return; }
  if (t.dataset.rcseg) { S.rcSeg = t.dataset.rcseg; render(); return; }
  if (t.dataset.finseg) { S.finSeg = t.dataset.finseg; render(); return; }
  if (t.dataset.openVoucher) { openVoucher(t.dataset.openVoucher); return; }
  if (t.dataset.openIncome) { openIncome(t.dataset.openIncome); return; }
  if (t.dataset.openTask) { openTask(t.dataset.openTask); return; }
  if (t.dataset.openReceipt) { openReceipt(t.dataset.openReceipt); return; }
  if (t.dataset.notif) {
    const n = S.notifList[+t.dataset.notif];
    if (n && n.open && n.open.task) openTask(n.open.task);
    else if (n && n.open && n.open.receipt) openReceipt(n.open.receipt);
    else if (n && n.open && n.open.voucher) openVoucher(n.open.voucher);
    return;
  }
  if (t.id === "refresh") refresh(true);
  else if (t.id === "today") openToday();
  else if (t.id === "assign") openAssign({ projectId: null, parentId: null });
  else if (t.id === "newReceipt") openNewReceipt();
  else if (t.id === "newVoucher") openVoucherForm();
  else if (t.id === "newIncome") openIncomeForm();
  else if (t.id === "lock") { S.session = null; S.data = null; showUnlock(); }
  else if (t.id === "logout") {
    if (confirm("Đăng xuất và xóa dữ liệu ứng dụng trên điện thoại này? Lần sau cần mã cài đặt để cài lại.")) { wipe(); S.session = null; S.data = null; showSetup(); }
  }
});

// ---------------- tấm chi tiết ----------------
function openSheet(title, html, onBack) {
  $sheet.innerHTML = `<header class="top"><button class="iconbtn" id="sheetBack" aria-label="Quay lại">${ICON.back}</button><h1>${esc(title)}</h1></header><main>${html}</main>`;
  $sheet.classList.remove("hidden");
  $sheet.scrollTop = 0;
  document.body.style.overflow = "hidden";
  document.getElementById("sheetBack").onclick = () => (onBack ? onBack() : closeSheet());
}

function closeSheet() {
  for (const url of closeSheet.urls || []) URL.revokeObjectURL(url);
  closeSheet.urls = [];
  $sheet.classList.add("hidden");
  $sheet.innerHTML = "";
  document.body.style.overflow = "";
}

async function runEdit(button, label, work, okMsg) {
  const done = busy(button, label);
  try {
    await work();
    toast(okMsg);
    closeSheet();
    await refresh(true);
  } catch (e) {
    done();
    toast(friendly(e), true);
  }
}

function openTask(id) {
  let t;
  try { t = S.data.pt.taskView(id); } catch (e) { toast(friendly(e), true); return; }
  const me = S.session.user.username;
  const hist = (t.history || []).slice().reverse().map((h) => `<div>${fmtTime(h.at)} · ${esc(nm(h.by))}: ${esc(h.event)}${h.note && h.event !== "Giao việc" ? ` - ${esc(h.note)}` : ""}</div>`).join("");
  const kids = t.children.length ? `<div class="section">Việc nhỏ</div>${t.children.map((k) => `<button class="card" data-kid="${esc(k.id)}">
      <div class="tag ${k.state === "done" ? "green" : ""}">${STATE_LABELS[k.state]}</div><div class="title">${esc(k.title)}</div><div class="meta">${esc(nm(k.assignee))}</div></button>`).join("")}` : "";
  const a = t.actions;
  const btns = [
    a.includes("report") ? `<label class="field" for="note">Ghi chú kết quả (không bắt buộc)</label><textarea class="inp" id="note"></textarea><button class="btn okc" data-act="report">Báo cáo đã làm xong</button>` : "",
    a.includes("withdraw") ? `<button class="btn ghost" data-act="withdraw">Rút lại báo cáo</button>` : "",
    a.includes("confirm") ? `<button class="btn okc" data-act="confirm">Xác nhận hoàn thành</button>` : "",
    a.includes("return") ? `<label class="field" for="reason">Lý do trả lại</label><textarea class="inp" id="reason"></textarea><button class="btn danger" data-act="return">Trả lại làm lại</button>` : "",
    a.includes("split") ? `<button class="btn ghost" data-act="split">Chia nhỏ: giao cho ${t.project_id === "" ? "cấp dưới" : "người làm"}</button>` : "",
    a.includes("delete") ? `<button class="btn ghost" data-act="delete">Xóa việc này</button>` : "",
  ].join("");
  const state = t.state === "open" && t.overdue ? "Đang làm · QUÁ HẠN" : STATE_LABELS[t.state];
  openSheet("Công việc", `<div class="box">
      <div class="tag">${esc(where(t.project_code, t.project_name))}${t.parent_title ? ` › ${esc(t.parent_title)}` : ""}</div>
      <div class="bigtitle">${esc(t.title)}</div>
      <div class="kv"><b>Trạng thái:</b> ${state}</div>
      <div class="kv"><b>Giao bởi:</b> ${esc(t.assigner === me ? "bạn" : nm(t.assigner))} → <b>Người làm:</b> ${esc(t.assignee === me ? "bạn" : nm(t.assignee))}</div>
      ${t.due_date ? `<div class="kv"><b>Hạn:</b> ${fmtDate(t.due_date)}</div>` : ""}
      ${t.description ? `<div class="desc">${esc(t.description)}</div>` : ""}
      ${t.result_note ? `<div class="kv"><b>Kết quả báo cáo:</b> ${esc(t.result_note)}</div>` : ""}</div>
    ${btns}${kids}<div class="section">Lịch sử</div><div class="hist">${hist}</div>`);
  $sheet.querySelectorAll("[data-kid]").forEach((b) => (b.onclick = () => openTask(b.dataset.kid)));
  $sheet.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => {
    const act = b.dataset.act, pt = (fn) => S.session.editPT(fn);
    if (act === "report") runEdit(b, "Đang gửi...", () => pt((m) => m.reportTask(id, document.getElementById("note").value)), "Đã báo cáo xong, chờ người giao xác nhận.");
    else if (act === "withdraw") runEdit(b, "Đang lưu...", () => pt((m) => m.withdrawTask(id)), "Đã rút lại báo cáo.");
    else if (act === "confirm") runEdit(b, "Đang lưu...", () => pt((m) => m.confirmTask(id)), "Đã xác nhận hoàn thành.");
    else if (act === "return") {
      const reason = document.getElementById("reason").value.trim();
      if (!reason) { toast("Hãy nhập lý do trả lại.", true); return; }
      runEdit(b, "Đang lưu...", () => pt((m) => m.returnTask(id, reason)), "Đã trả lại để làm lại.");
    } else if (act === "split") openAssign({ projectId: t.project_id, parentId: id, parentTitle: t.title });
    else if (act === "delete") { if (confirm("Xóa việc này?")) runEdit(b, "Đang xóa...", () => pt((m) => m.deleteTask(id)), "Đã xóa việc."); }
  }));
}

function openAssign({ projectId, parentId, parentTitle }) {
  const pt = S.data.pt;
  const fixed = projectId !== null;
  const projects = fixed ? [] : pt.assignableProjects();
  const opts = fixed ? "" : `<label class="field" for="proj">Thuộc</label><select class="inp" id="proj">
      <option value="">Việc ngoài dự án</option>${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.code)} ${esc(p.name)}</option>`).join("")}</select>`;
  openSheet(parentId ? "Chia nhỏ việc" : "Giao việc", `${parentId ? `<div class="box">Việc lớn: <b>${esc(parentTitle)}</b></div>` : ""}${opts}
    <label class="field" for="title">Tên công việc</label><input class="inp" id="title" maxlength="200">
    <label class="field" for="desc">Mô tả (không bắt buộc)</label><textarea class="inp" id="desc"></textarea>
    <label class="field" for="due">Hạn hoàn thành (không bắt buộc)</label><input class="inp" id="due" type="date" min="${todayIso()}">
    <label class="field">Người nhận (chọn một hoặc nhiều)</label><div class="checks" id="people"></div>
    <button class="btn" id="save">Giao việc</button>`);
  const paint = () => {
    const pid = fixed ? projectId : document.getElementById("proj").value;
    let people = [];
    try { people = pt.candidates(pid, parentId); } catch (e) { /* bỏ qua */ }
    document.getElementById("people").innerHTML = people.length ? people.map((u) =>
      `<label><input type="checkbox" value="${esc(u.username)}" ${people.length === 1 ? "checked" : ""}> ${esc(u.full_name)} <span class="meta">(${esc(u.username)})</span></label>`).join("")
      : `<p class="hint">Không có người nhận phù hợp.</p>`;
  };
  paint();
  if (!fixed) document.getElementById("proj").onchange = paint;
  document.getElementById("save").onclick = (ev) => {
    const pid = fixed ? projectId : document.getElementById("proj").value;
    const who = [...document.querySelectorAll("#people input:checked")].map((i) => i.value);
    const title = document.getElementById("title").value, desc = document.getElementById("desc").value, due = document.getElementById("due").value;
    if (!title.trim()) { toast("Hãy nhập tên công việc.", true); return; }
    if (!who.length) { toast("Hãy chọn người nhận.", true); return; }
    runEdit(ev.target, "Đang giao...", () => S.session.editPT((m) => m.createTasks(pid, title, who, parentId, desc, due)),
      who.length > 1 ? `Đã giao việc cho ${who.length} người.` : "Đã giao việc.");
  };
}

// ---------------- hóa đơn ----------------
function photoPicker(files) {
  // files: mảng File (dùng chung khi chọn thêm)
  const wrap = document.getElementById("thumbs");
  const paint = () => {
    for (const u of photoPicker.urls || []) URL.revokeObjectURL(u);
    photoPicker.urls = files.map((f) => URL.createObjectURL(f));
    wrap.innerHTML = files.map((f, i) => `<div class="thumb"><img src="${photoPicker.urls[i]}" alt=""><button data-rm="${i}" aria-label="Bỏ ảnh">×</button></div>`).join("")
      + `<button class="addphoto" id="addPhoto">📷 Chụp ảnh</button><button class="addphoto" id="addGallery">🖼 Chọn từ thư viện</button>`;
    wrap.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { files.splice(+b.dataset.rm, 1); paint(); }));
    document.getElementById("addPhoto").onclick = () => document.getElementById("file").click();                  // mở thẳng máy ảnh
    document.getElementById("addGallery").onclick = () => document.getElementById("fileGallery").click();         // mở thư viện ảnh (chọn được nhiều ảnh)
  };
  const onPick = (ev) => {
    let skipped = 0;
    for (const f of ev.target.files) {
      if (files.length >= 10) { skipped++; continue; }
      if (f.type && !f.type.startsWith("image/")) { skipped++; continue; }                                         // chỉ nhận ảnh
      files.push(f);
    }
    ev.target.value = "";
    if (skipped) toast("Chỉ nhận tối đa 10 ảnh và đúng định dạng ảnh; các tệp thừa đã bị bỏ qua.", true);
    paint();
  };
  document.getElementById("file").onchange = onPick;
  document.getElementById("fileGallery").onchange = onPick;
  paint();
}

function openNewReceipt() {
  const files = [];
  openSheet("Gửi hóa đơn", `<p class="hint">Chụp rõ cả tờ hóa đơn (nhiều trang thì chụp nhiều ảnh) hoặc chọn ảnh đã có trong thư viện, ghi mua cho việc gì rồi bấm Gửi. Trưởng phòng sẽ chọn dự án và xác nhận.</p>
    <input type="file" id="file" accept="image/*" capture="environment" multiple class="hidden">
    <input type="file" id="fileGallery" accept="image/*" multiple class="hidden">
    <div class="thumbs" id="thumbs"></div>
    <label class="field" for="note">Mua cho việc gì?</label>
    <textarea class="inp" id="note" maxlength="500" placeholder="Ví dụ: Mua 20m dây 2.5 đấu tủ A - xưởng AB2"></textarea>
    <p class="err" id="prog"></p>
    <button class="btn" id="send">Gửi hóa đơn</button>`);
  photoPicker(files);
  document.getElementById("send").onclick = (ev) => {
    const note = document.getElementById("note").value;
    if (!files.length) { toast("Hãy chụp hoặc chọn ít nhất một ảnh hóa đơn.", true); return; }
    if (!note.trim()) { toast("Hãy ghi mua cho việc gì.", true); return; }
    const prog = document.getElementById("prog");
    runEdit(ev.target, "Đang gửi...", () => S.session.submitReceipt(note, files, (i, n) => {
      prog.className = "hint"; prog.textContent = i < n ? `Đang tải ảnh ${i + 1}/${n}...` : "Đang lưu phiếu...";
    }), "Đã gửi hóa đơn.");
  };
}

async function showPhotos(r) {
  const box = document.getElementById("photos");
  closeSheet.urls = [];
  box.innerHTML = r.images.map((_, i) => `<img class="photo-full" id="ph${i}" alt="Ảnh ${i + 1} đang tải...">`).join("");
  for (let i = 0; i < r.images.length; i++) {
    try {
      const bytes = await S.session.photo(r.images[i].file_id);
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
      closeSheet.urls.push(url);
      const img = document.getElementById(`ph${i}`);
      if (img) { img.src = url; img.onclick = () => window.open(url, "_blank"); }
    } catch (e) {
      const img = document.getElementById(`ph${i}`);
      if (img) img.alt = `Không tải được ảnh ${i + 1}: ${friendly(e)}`;
    }
  }
}

function openReceipt(id) {
  let r;
  try { r = S.data.rc.view(id); } catch (e) { toast(friendly(e), true); return; }
  const me = S.session.user.username, a = r.actions;
  const info = `<div class="box"><div class="tag">${r.id} · ${RC_LABELS[r.state]}</div>
    <div class="bigtitle">${esc(r.note)}</div>
    <div class="kv"><b>Người gửi:</b> ${esc(r.submitter === me ? "bạn" : nm(r.submitter))} · ${fmtTime(r.submitted_at)}</div>
    ${r.state === "confirmed" ? `<div class="kv"><b>Dự án:</b> ${esc(r.project_label)}</div><div class="kv"><b>Tổng tiền:</b> ${money(r.amount)} đ</div>
      <div class="kv"><b>Xác nhận:</b> ${esc(nm(r.reviewed_by))} · ${fmtTime(r.reviewed_at)}</div>` : ""}
    ${r.state === "returned" ? `<div class="kv danger-text"><b>Lý do trả lại:</b> ${esc(r.return_reason)}</div>` : ""}</div>`;
  let form = "";
  if (a.includes("confirm") || a.includes("reclassify")) {
    const re = a.includes("reclassify");
    const projects = S.data.pt.myProjects();
    const known = projects.some((p) => p.id === r.project_id);
    form = `<div class="section">${re ? "Sửa phân loại" : "Phân loại và xác nhận"}</div>
      <label class="field" for="proj">Dự án</label><select class="inp" id="proj"><option value="__">— Chọn dự án —</option>
        <option value="" ${re && r.project_id === "" ? "selected" : ""}>Việc ngoài dự án</option>
        ${projects.map((p) => `<option value="${esc(p.id)}" data-label="${esc(p.code + " " + p.name)}" ${re && p.id === r.project_id ? "selected" : ""}>${esc(p.code)} ${esc(p.name)}</option>`).join("")}
        ${re && r.project_id && !known ? `<option value="${esc(r.project_id)}" data-label="${esc(r.project_label)}" selected>${esc(r.project_label)}</option>` : ""}</select>
      <label class="field" for="amt">Tổng tiền theo hóa đơn (đồng)</label>
      <input class="inp amount" id="amt" inputmode="numeric" placeholder="0" value="${re ? money(r.amount) : ""}">
      <button class="btn okc" id="ok">${re ? "Lưu phân loại" : "Xác nhận"}</button>
      ${re ? "" : `<label class="field" for="reason">Hoặc trả lại (ảnh mờ, thiếu...): lý do</label><textarea class="inp" id="reason"></textarea>
      <button class="btn danger" id="back">Trả lại</button>`}`;
  }
  if (a.includes("resubmit")) {
    form += `<div class="section">Gửi lại</div><input type="file" id="file" accept="image/*" capture="environment" multiple class="hidden">
      <input type="file" id="fileGallery" accept="image/*" multiple class="hidden">
      <p class="hint">Chụp hoặc chọn thêm ảnh từ thư viện (nếu cần), sửa ghi chú rồi gửi lại.</p><div class="thumbs" id="thumbs"></div>
      <label class="field" for="note">Mua cho việc gì?</label><textarea class="inp" id="note">${esc(r.note)}</textarea>
      <p class="err" id="prog"></p><button class="btn" id="resend">Gửi lại</button>`;
  }
  if (a.includes("cancel")) form += `<button class="btn ghost" id="cancel">Hủy hóa đơn này (gửi nhầm)</button>`;
  const fa = S.data.fa;
  if (fa && fa.isAccountant && r.state === "confirmed" && !fa.receiptLinks()[r.id]) form += `<button class="btn" id="refund">Lập phiếu chi hoàn ứng</button>`;
  const hist = (r.history || []).slice().reverse().map((h) => `<div>${fmtTime(h.at)} · ${esc(nm(h.by))}: ${esc(h.event)}${h.note ? ` - ${esc(h.note)}` : ""}</div>`).join("");
  openSheet(`Hóa đơn ${r.id}`, `${info}<div class="section">Ảnh hóa đơn (${r.images.length})</div><div id="photos"></div>${form}
    <div class="section">Lịch sử</div><div class="hist">${hist}</div>`);
  showPhotos(r);
  const amt = document.getElementById("amt");
  if (amt) amt.oninput = () => {
    const digits = amt.value.replace(/\D/g, "").replace(/^0+/, "");
    amt.value = digits ? money(+digits) : "";
  };
  const ok = document.getElementById("ok");
  if (ok) ok.onclick = () => {
    const sel = document.getElementById("proj");
    if (sel.value === "__") { toast("Hãy chọn dự án (hoặc «Việc ngoài dự án»).", true); return; }
    let amount;
    try { amount = parseAmount(amt.value); } catch (e) { toast(e.message, true); return; }
    const label = sel.value === "" ? "" : sel.selectedOptions[0].dataset.label;
    const re = a.includes("reclassify");
    runEdit(ok, "Đang lưu...", () => S.session.editRC((m) => (re ? m.reclassify(id, sel.value, label, amount) : m.confirm(id, sel.value, label, amount))),
      re ? "Đã lưu phân loại." : `Đã xác nhận ${money(amount)} đ.`);
  };
  const back = document.getElementById("back");
  if (back) back.onclick = () => {
    const reason = document.getElementById("reason").value.trim();
    if (!reason) { toast("Hãy nhập lý do trả lại.", true); return; }
    runEdit(back, "Đang lưu...", () => S.session.editRC((m) => m.returnReceipt(id, reason)), "Đã trả lại hóa đơn.");
  };
  if (a.includes("resubmit")) {
    const files = [];
    photoPicker(files);
    document.getElementById("resend").onclick = (ev) => {
      const prog = document.getElementById("prog");
      runEdit(ev.target, "Đang gửi...", () => S.session.resubmitReceipt(id, document.getElementById("note").value, files, (i, n) => {
        prog.className = "hint"; prog.textContent = i < n ? `Đang tải ảnh ${i + 1}/${n}...` : "Đang lưu phiếu...";
      }), "Đã gửi lại hóa đơn.");
    };
  }
  const refund = document.getElementById("refund");
  if (refund) refund.onclick = () => {                                       // hoàn ứng cho người gửi hóa đơn khẩn: điền sẵn dự án, số tiền, người nhận
    openVoucherForm({ receipt_id: r.id, project_id: r.project_id, project_label: r.project_label, content: `Hoàn ứng ${r.id}: ${r.note}`.slice(0, 300), recipient: nm(r.submitter), payee: "",
      amount_net: money(r.amount), method: "cash" });
  };
  const cancel = document.getElementById("cancel");
  if (cancel) cancel.onclick = () => {
    if (confirm("Hủy hóa đơn này?")) runEdit(cancel, "Đang hủy...", () => S.session.editRC((m) => m.cancel(id)), "Đã hủy hóa đơn.");
  };
}

// ---------------- Tài chính: Giám đốc duyệt phiếu chi; Trưởng phòng vật tư lập phiếu chi, ghi đã chi, phiếu thu ----------------
const FA_TAG = { draft: "", pending: "amber", approved: "", paid: "green", cancelled: "red" };

function financeTab() {
  if (!S.data) return S.loading ? `<p class="empty">Đang tải...</p>` : "";
  const fa = S.data.fa;
  if (!fa) return `<p class="empty">Không mở được dữ liệu tài chính.</p>`;
  const vcard = (v) => `<button class="card" data-open-voucher="${esc(v.id)}"><div class="tag ${v.returned ? "red" : FA_TAG[v.state]}">${v.id} · ${v.state_label}</div>
    <div class="title">${esc(v.content)}</div><div class="meta">${money(v.total)} đ · ${esc(v.recipient || "—")} · ${fmtDate(v.date).slice(0, 5)}</div></button>`;
  const icard = (i) => `<button class="card" data-open-income="${esc(i.id)}"><div class="tag ${i.state === "active" ? "green" : "red"}">${i.id} · ${i.kind_label}</div>
    <div class="title">${money(i.total)} đ</div><div class="meta">${esc(i.project_label)} · ${fmtDate(i.date).slice(0, 5)}${i.state === "active" ? "" : " · đã hủy"}</div></button>`;
  const none = `<p class="empty">Chưa có.</p>`;
  if (fa.isDirector) {
    const all = fa.vouchers(), wait = all.filter((v) => v.state === "pending");
    const seg = S.finSeg === "all" || (!S.finSeg && !wait.length) ? "all" : "wait";
    return `<div class="seg"><button data-finseg="wait" class="${seg === "wait" ? "on" : ""}">Chờ duyệt (${wait.length})</button><button data-finseg="all" class="${seg === "all" ? "on" : ""}">Tất cả</button></div>`
      + (seg === "wait" ? (wait.map(vcard).join("") || none) : finSearchBlock(all));
  }
  const seg = S.finSeg === "pt" ? "pt" : "pc";
  const head = `<div class="seg"><button data-finseg="pc" class="${seg === "pc" ? "on" : ""}">Phiếu chi</button><button data-finseg="pt" class="${seg === "pt" ? "on" : ""}">Phiếu thu</button></div>`;
  if (seg === "pc") return `${head}<button class="big-action" id="newVoucher">${ICON.fin}<span>Phiếu chi</span></button>${finSearchBlock(fa.vouchers())}`;
  return `${head}<button class="big-action" id="newIncome">${ICON.fin}<span>Phiếu thu</span></button>${fa.incomes().map(icard).join("") || none}`;
}

const faKv = (k, v) => (v ? `<div class="kv"><b>${k}:</b> ${esc(v)}</div>` : "");

// Ô tìm phiếu chi: lọc theo người nhận tiền (và nội dung, số phiếu...), kèm tổng CẦN CHI (đã duyệt, chưa chi) của người đó
const finMatch = (v, q) => !q || faKey([v.id, v.content, v.recipient, v.payee, v.invoice_no, v.project_label, v.category_name, v.note].join(" ")).includes(faKey(q));

function finListHtml(all, q) {
  const list = all.filter((v) => finMatch(v, q));
  return list.length ? list.map((v) => `<button class="card" data-open-voucher="${esc(v.id)}"><div class="tag ${v.returned ? "red" : FA_TAG[v.state]}">${v.id} · ${v.state_label}</div>
    <div class="title">${esc(v.content)}</div><div class="meta">${money(v.total)} đ · ${esc(v.recipient || "—")} · ${fmtDate(v.date).slice(0, 5)}</div></button>`).join("") : `<p class="empty">Không có phiếu nào.</p>`;
}

function finOwedHtml(all, q) {
  const groups = recipientTotals(all, q), total = groups.reduce((s, g) => s + g.total, 0), count = groups.reduce((s, g) => s + g.count, 0);
  let html = `<div class="box"><div class="total"><span>Cần chi${q ? ` · ${esc(q)}` : ""}</span><b>${money(total)} đ</b></div><div class="meta">Đã duyệt, chưa chi · ${count} phiếu</div>`;
  if (q) {
    html += groups.slice(0, 8).map((g) => `<div class="total"><span>${esc(g.name)} (${g.count})</span><b>${money(g.total)} đ</b></div>`).join("");
    if (groups.length > 8) html += `<div class="meta">... và ${groups.length - 8} người khác</div>`;
  }
  return `${html}</div>`;
}

function finSearchBlock(all) {
  const q = S.finQ || "";
  return `<input class="inp" id="finq" type="search" placeholder="Tìm người nhận, nội dung..." autocomplete="off" value="${esc(q)}">
    <div id="finowed">${finOwedHtml(all, q)}</div><div id="finlist">${finListHtml(all, q)}</div>`;
}

$app.addEventListener("input", (ev) => {                                    // gõ vào ô tìm: chỉ vẽ lại danh sách và tổng, không vẽ lại cả màn hình (giữ bàn phím)
  if (ev.target.id !== "finq" || !S.data || !S.data.fa) return;
  S.finQ = ev.target.value.trim();
  const all = S.data.fa.vouchers();
  document.getElementById("finowed").innerHTML = finOwedHtml(all, S.finQ);
  document.getElementById("finlist").innerHTML = finListHtml(all, S.finQ);
});

function openVoucher(id) {
  let v;
  try { v = S.data.fa.voucher(id); } catch (e) { toast(friendly(e), true); return; }
  const dir = S.data.fa.isDirector, a = v.actions;
  const info = `<div class="box"><div class="tag ${v.returned ? "red" : FA_TAG[v.state]}">${v.id} · ${v.state_label}</div><div class="bigtitle">${esc(v.content)}</div>
    <div class="kv"><b>Tổng:</b> ${money(v.total)} đ</div><div class="kv"><b>Chưa VAT:</b> ${money(v.amount_net)} · <b>VAT:</b> ${money(v.vat)}</div>
    ${faKv("Người nhận", v.recipient)}${faKv("Dự án", v.project_label)}${faKv("Loại", v.category_name)}${faKv("Ngày", fmtDate(v.date))}${faKv("Nhà cung cấp", v.payee && v.payee !== v.recipient ? v.payee : "")}${faKv("Số HĐ", v.invoice_no)}
    ${faKv("Hình thức", v.method_label)}${faKv("Lập bởi", nm(v.created_by))}${v.receipt_id ? faKv("Hoàn ứng", v.receipt_id) : ""}${v.paid_at ? faKv("Đã chi", fmtDate(v.paid_at)) : ""}${faKv("Ghi chú", v.note)}
    ${v.returned ? `<div class="kv danger-text"><b>Trả lại:</b> ${esc(v.return_reason)}</div>` : ""}${v.state === "cancelled" ? `<div class="kv danger-text"><b>Đã hủy:</b> ${esc(v.cancel_reason)}</div>` : ""}</div>`;
  let form = "";
  if (dir && a.includes("approve")) {
    form = `<button class="btn okc" id="vok">Duyệt</button><label class="field" for="vreason">Trả lại: lý do</label><textarea class="inp" id="vreason"></textarea><button class="btn danger" id="vback">Trả lại</button>`;
  } else if (!dir) {
    if (a.includes("edit")) form += `<button class="btn" id="vedit">Sửa và gửi duyệt</button>`;
    if (a.includes("withdraw")) form += `<button class="btn ghost" id="vwithdraw">Rút về nháp</button>`;
    if (a.includes("pay")) form += `<label class="field" for="vpaid">Ngày chi</label><input class="inp" id="vpaid" type="date" value="${todayIso()}"><button class="btn okc" id="vpay">Đã chi</button>`;
    if (a.includes("cancel")) form += `<button class="btn ghost" id="vcancel">Hủy phiếu</button>`;
  }
  const hist = (v.history || []).slice().reverse().map((h) => `<div>${fmtTime(h.at)} · ${esc(nm(h.by))}: ${esc(h.event)}${h.note ? ` - ${esc(h.note)}` : ""}</div>`).join("");
  openSheet(`Phiếu ${v.id}`, `${info}${form}<div class="section">Lịch sử</div><div class="hist">${hist}</div>`);
  const on = (id2, fn) => { const el = document.getElementById(id2); if (el) el.onclick = fn; };
  on("vok", (ev) => runEdit(ev.target, "Đang duyệt...", () => S.session.editFA((m) => m.approve(id)), "Đã duyệt."));
  on("vback", (ev) => {
    const reason = document.getElementById("vreason").value.trim();
    if (!reason) { toast("Hãy nhập lý do trả lại.", true); return; }
    runEdit(ev.target, "Đang lưu...", () => S.session.editFA((m) => m.returnVoucher(id, reason)), "Đã trả lại.");
  });
  on("vedit", () => { closeSheet(); openVoucherForm({}, v); });
  on("vwithdraw", (ev) => runEdit(ev.target, "Đang lưu...", () => S.session.editFA((m) => m.withdraw(id)), "Đã rút về nháp."));
  on("vpay", (ev) => runEdit(ev.target, "Đang lưu...", () => S.session.editFA((m) => m.markPaid(id, document.getElementById("vpaid").value)), "Đã ghi chi."));
  on("vcancel", (ev) => {
    const reason = (prompt("Lý do hủy phiếu:") || "").trim();
    if (!reason) { toast("Hãy nhập lý do hủy.", true); return; }
    runEdit(ev.target, "Đang hủy...", () => S.session.editFA((m) => m.cancel(id, reason)), "Đã hủy phiếu.");
  });
}

function wireMoney(ids, sum) {
  for (const id of ids) {
    const el = document.getElementById(id);
    el.oninput = () => {
      const d = el.value.replace(/\D/g, "").replace(/^0+/, "");
      el.value = d ? money(+d) : "";
      sum();
    };
  }
}

const faOptions = (items, sel) => items.map((o) => `<option value="${esc(o[0])}" ${o[0] === sel ? "selected" : ""}>${esc(o[1])}</option>`).join("");

/** Phiếu chi: MỘT nút «Gửi duyệt» (lưu rồi gửi duyệt cùng lúc). seed = điền sẵn (hoàn ứng); existing = phiếu nháp hoặc bị trả lại đang sửa. */
function openVoucherForm(seed = {}, existing = null) {
  const fa = S.data.fa, cats = fa.categories();
  if (!cats.length) { toast("Chưa có loại chi phí: mở phần mềm máy tính một lần.", true); return; }
  const v = existing ? { ...existing, amount_net: money(existing.amount_net), vat: existing.vat ? money(existing.vat) : "" } : seed;
  const projects = FinanceAccounting.projectLabels(S.data.pt);
  if (v.project_id && !projects.some((p) => p.id === v.project_id)) projects.push({ id: v.project_id, label: v.project_label || v.project_id });
  const cat = v.category_id || (cats.find((c) => c.name === "Vật tư") || cats[0]).id;
  openSheet(existing ? `Sửa ${existing.id}` : "Phiếu chi", `
    <div class="pair"><div><label class="field" for="fd">Ngày</label><input class="inp" id="fd" type="date" value="${esc(v.date || todayIso())}"></div>
      <div><label class="field" for="fm">Chi bằng</label><select class="inp" id="fm">${faOptions(Object.entries(FA_METHODS), v.method || "transfer")}</select></div></div>
    <label class="field" for="fc">Loại</label><select class="inp" id="fc">${faOptions(cats.map((c) => [c.id, c.name]), cat)}</select>
    <label class="field" for="fp">Dự án</label><select class="inp" id="fp"><option value="">Chi phí chung</option>
      ${projects.map((p) => `<option value="${esc(p.id)}" data-label="${esc(p.label)}" ${p.id === v.project_id ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>
    <label class="field" for="ft">Nội dung</label><input class="inp" id="ft" maxlength="300" value="${esc(v.content || "")}">
    <label class="field" for="fr">Người nhận tiền</label><input class="inp" id="fr" maxlength="120" list="recipientList" autocomplete="off" value="${esc(v.recipient || "")}">
    <datalist id="recipientList">${fa.recipientNames().map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
    <div class="pair"><div><label class="field" for="fn">Chưa VAT</label><input class="inp amount" id="fn" inputmode="numeric" placeholder="0" value="${esc(v.amount_net || "")}"></div>
      <div><label class="field" for="fv">VAT</label><input class="inp amount" id="fv" inputmode="numeric" placeholder="0" value="${esc(v.vat || "")}"></div></div>
    <div class="total"><span>Tổng</span><b id="fsum">0 đ</b></div>
    <div class="pair"><div><label class="field" for="fy">Nhà cung cấp</label><input class="inp" id="fy" maxlength="120" value="${esc(v.payee || "")}"></div>
      <div><label class="field" for="fo">Ghi chú</label><input class="inp" id="fo" maxlength="500" value="${esc(v.note || "")}"></div></div>
    ${v.receipt_id ? `<p class="hint">Hoàn ứng ${esc(v.receipt_id)}</p>` : ""}
    <button class="btn" id="fsend">Gửi duyệt</button>`);
  const sum = () => {
    try { document.getElementById("fsum").textContent = `${money(parseMoney(document.getElementById("fn").value, "x", true) + parseMoney(document.getElementById("fv").value, "x", true))} đ`; }
    catch (e) { document.getElementById("fsum").textContent = "—"; }
  };
  wireMoney(["fn", "fv"], sum);
  sum();
  document.getElementById("fsend").onclick = (ev) => {
    const sel = document.getElementById("fp"), g = (i) => document.getElementById(i).value;
    const fields = { date: g("fd"), category_id: g("fc"), project_id: sel.value, project_label: sel.value ? sel.selectedOptions[0].dataset.label : "", content: g("ft"), recipient: g("fr"), payee: g("fy"),
      amount_net: g("fn"), vat: g("fv"), method: g("fm"), note: g("fo"), receipt_id: v.receipt_id || "" };
    if (existing && existing.invoice_no) fields.invoice_no = existing.invoice_no;                      // phiếu cũ có số hóa đơn: giữ nguyên
    runEdit(ev.target, "Đang gửi...", () => S.session.editFA((m) => m.submit(m.saveVoucher(existing ? existing.id : null, fields).id)), "Đã gửi duyệt.");
  };
}

function openIncomeForm() {
  const projects = FinanceAccounting.projectLabels(S.data.pt);
  openSheet("Phiếu thu", `
    <div class="pair"><div><label class="field" for="id">Ngày</label><input class="inp" id="id" type="date" value="${todayIso()}"></div>
      <div><label class="field" for="im">Thu bằng</label><select class="inp" id="im">${faOptions(Object.entries(FA_METHODS), "transfer")}</select></div></div>
    <label class="field" for="ip">Dự án</label><select class="inp" id="ip"><option value="">— Chọn —</option>
      ${projects.map((p) => `<option value="${esc(p.id)}" data-label="${esc(p.label)}">${esc(p.label)}</option>`).join("")}</select>
    <label class="field" for="ik">Loại thu</label><select class="inp" id="ik">${faOptions(Object.entries(INCOME_KINDS), "final")}</select>
    <div class="pair"><div><label class="field" for="in">Chưa VAT</label><input class="inp amount" id="in" inputmode="numeric" placeholder="0"></div>
      <div><label class="field" for="iv">VAT</label><input class="inp amount" id="iv" inputmode="numeric" placeholder="0"></div></div>
    <div class="total"><span>Tổng</span><b id="isum">0 đ</b></div>
    <div class="pair"><div><label class="field" for="ii">Số HĐ</label><input class="inp" id="ii" maxlength="60"></div>
      <div><label class="field" for="io">Ghi chú</label><input class="inp" id="io" maxlength="500"></div></div>
    <button class="btn" id="isave">Ghi thu</button>`);
  const sum = () => {
    try { document.getElementById("isum").textContent = `${money(parseMoney(document.getElementById("in").value, "x", true) + parseMoney(document.getElementById("iv").value, "x", true))} đ`; }
    catch (e) { document.getElementById("isum").textContent = "—"; }
  };
  wireMoney(["in", "iv"], sum);
  document.getElementById("isave").onclick = (ev) => {
    const sel = document.getElementById("ip"), g = (i) => document.getElementById(i).value;
    const fields = { date: g("id"), project_id: sel.value, project_label: sel.value ? sel.selectedOptions[0].dataset.label : "", kind: g("ik"), amount_net: g("in"), vat: g("iv"), method: g("im"),
      invoice_no: g("ii"), note: g("io") };
    runEdit(ev.target, "Đang ghi...", () => S.session.editFA((m) => m.saveIncome(fields)), "Đã ghi phiếu thu.");
  };
}

function openIncome(id) {
  let i;
  try { i = S.data.fa.incomes().find((x) => x.id === id); } catch (e) { toast(friendly(e), true); return; }
  if (!i) { toast("Không tìm thấy phiếu thu.", true); return; }
  const info = `<div class="box"><div class="tag ${i.state === "active" ? "green" : "red"}">${i.id} · ${i.kind_label} · ${i.state_label}</div><div class="bigtitle">${money(i.total)} đ</div>
    <div class="kv"><b>Chưa VAT:</b> ${money(i.amount_net)} · <b>VAT:</b> ${money(i.vat)}</div>${faKv("Dự án", i.project_label)}${faKv("Ngày", fmtDate(i.date))}${faKv("Hình thức", i.method_label)}
    ${faKv("Số HĐ", i.invoice_no)}${faKv("Ghi bởi", nm(i.created_by))}${faKv("Ghi chú", i.note)}${i.state === "cancelled" ? `<div class="kv danger-text"><b>Đã hủy:</b> ${esc(i.cancel_reason)}</div>` : ""}</div>`;
  openSheet(`Phiếu thu ${i.id}`, `${info}${i.actions.includes("cancel") ? `<button class="btn ghost" id="icancel">Hủy phiếu thu</button>` : ""}`);
  const c = document.getElementById("icancel");
  if (c) c.onclick = (ev) => {
    const reason = (prompt("Lý do hủy phiếu thu:") || "").trim();
    if (!reason) { toast("Hãy nhập lý do hủy.", true); return; }
    runEdit(ev.target, "Đang hủy...", () => S.session.editFA((m) => m.cancelIncome(id, reason)), "Đã hủy phiếu thu.");
  };
}

// ---------------- khởi động ----------------
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.session) refresh(false);
});
window.addEventListener("popstate", () => { if (!$sheet.classList.contains("hidden")) closeSheet(); });

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

function start() {
  const m = location.hash.match(/setup=([^&]+)/);
  const code = m ? decodeURIComponent(m[1]) : "";
  if (code) history.replaceState(null, "", location.pathname);        // không để mã cài đặt nằm lại trên thanh địa chỉ / lối tắt
  // Máy đã cài rồi thì LUÔN chỉ hỏi mã PIN, kể cả khi mở lại bằng đường dẫn cài đặt trong Zalo hay lối tắt có mã.
  // Muốn cài lại (đổi người, mã mới): bấm «Quên mã PIN / đổi người dùng» trên màn hình nhập PIN.
  if (loadStored()) showUnlock();
  else showSetup(code);
}

// Xin trình duyệt giữ dữ liệu lâu dài (không tự xóa khi máy thiếu bộ nhớ hoặc lâu không mở)
async function keepStorage() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch (e) { /* bỏ qua */ }
}

start();
if (loadStored()) keepStorage();
window.__tbd = { S, VERSION };
