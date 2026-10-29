// app.js - Giao diện ứng dụng điện thoại TBD: cài đặt, đăng nhập, mã PIN, Việc của tôi, Giao việc, Hóa đơn mua khẩn, Thông báo.

import { Session, loadStored, seenAt, setSeenAt, wipe } from "./session.js";
import { UserError, todayIso } from "./base.js";
import { CHAIN, ROLE_LABELS, STAGE_LABELS, STATE_LABELS } from "./pt.js";
import { STATE_LABELS as RC_LABELS, money, parseAmount } from "./receipts.js";

export const VERSION = "2026.10.29";
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
    const [pt, rc, wl] = await Promise.all([S.session.readPT(), S.session.readRC(),
      S.session.user.role === "director" ? null : S.session.readWL().catch(() => null)]);
    S.data = { pt, rc, wl };
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
  return items;
}

function notifications() {
  if (!S.data) return [];
  const me = S.session.user.username;
  const out = [];
  for (const ev of S.data.pt.myNotifications()) out.push({ at: ev.at, text: ptNotifText(ev, me), open: ev.ref_type === "task" ? { task: ev.ref_id } : null });
  for (const ev of S.data.rc.myNotifications()) out.push({ at: ev.at, text: rcNotifText(ev, me), open: { receipt: ev.id } });
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 60);
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
  todo: "Việc được giao", returned: "Việc bị trả lại làm lại", to_confirm: "Chờ bạn xác nhận",
  survey_todo: "Phiếu khảo sát được giao", survey_returned: "Phiếu khảo sát bị trả lại", survey_to_confirm: "Phiếu khảo sát chờ bạn xác nhận",
  receipt_to_review: "Hóa đơn chờ bạn xác nhận", receipt_returned: "Hóa đơn bị trả lại",
};

function pendingCard(it) {
  const head = PENDING_HEAD[it.kind] || it.kind;
  const red = it.overdue || ["returned", "survey_returned", "receipt_returned", "quote_returned"].includes(it.kind);
  const urgent = ["to_confirm", "survey_to_confirm", "receipt_to_review"].includes(it.kind);
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
  return `<button class="card" id="today"><div class="tag green">Nhật ký hôm nay · ghi lúc ${fmtTime(e.updated_at).slice(6)}</div>
    <div class="title">${esc(e.text)}</div><div class="meta">${esc(w)} · bấm để sửa</div></button>`;
}

function openToday() {
  const wl = S.data.wl, e = wl.mineToday();
  const projects = S.data.pt.myProjects();
  const recent = wl.mine(7).filter((x) => !e || x.id !== e.id);
  openSheet("Nhật ký hôm nay", `<p class="hint">Hôm nay ${fmtDate(todayIso())}. Ghi lại trong ngày thì nội dung được cập nhật.</p>
    <label class="field" for="wproj">Dự án</label><select class="inp" id="wproj"><option value="">Việc ngoài dự án</option>
      ${projects.map((p) => `<option value="${esc(p.id)}" ${e && e.project_id === p.id ? "selected" : ""}>${esc(p.code)} ${esc(p.name)}</option>`).join("")}</select>
    <label class="field" for="wtext">Hôm nay tôi đang làm</label>
    <textarea class="inp" id="wtext" maxlength="300" placeholder="Ví dụ: Đấu tủ điện A tại xưởng AB2">${esc(e ? e.text : "")}</textarea>
    <button class="btn" id="wsave">Ghi</button>
    ${recent.length ? `<div class="section">Các ngày trước</div>${recent.map((x) => `<div class="card"><div class="meta">${fmtDate(x.date)}</div><div class="note">${esc(x.text)}</div></div>`).join("")}` : ""}`);
  document.getElementById("wsave").onclick = (ev) => {
    const text = document.getElementById("wtext").value, pid = document.getElementById("wproj").value;
    if (!text.trim()) { toast("Hãy ghi hôm nay bạn đang làm gì.", true); return; }
    runEdit(ev.target, "Đang ghi...", () => S.session.editWL((m) => m.setToday(text, pid)), "Đã ghi nhật ký hôm nay.");
  };
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
    <p class="hint mt">Bản ${VERSION}. Đổi mật khẩu, phiếu khảo sát, báo giá: dùng phần mềm trên máy tính.</p>`;
}

function badgeCounts() {
  const pend = pendingItems().length;
  const seen = S.session ? seenAt(S.session.user.username) : "";
  const unread = notifications().filter((n) => n.at > seen).length;
  const rcPending = S.data ? S.data.rc.myPending().length : 0;
  return { pend: pend - rcPending, rc: rcPending, unread };
}

function render() {
  if (!S.session) return;
  const counts = S.data ? badgeCounts() : { pend: 0, rc: 0, unread: 0 };
  const titles = { tasks: "Việc của tôi", receipts: "Hóa đơn mua khẩn", notif: "Thông báo", more: "Tài khoản" };
  const body = { tasks: tasksTab, receipts: receiptsTab, notif: notifTab, more: moreTab }[S.tab]();
  const badge = (n) => (n ? `<span class="badge">${n > 99 ? "99+" : n}</span>` : "");
  const banner = S.error ? `<div class="banner">${esc(S.error)}</div>` : "";
  $app.innerHTML = `<header class="top"><h1>${titles[S.tab]}<span class="sub">${esc(S.session.user.full_name)}${S.loadedAt ? ` · cập nhật ${new Date(S.loadedAt).toTimeString().slice(0, 5)}` : ""}</span></h1>
      <button class="iconbtn ${S.loading ? "spin" : ""}" id="refresh" aria-label="Làm mới">${ICON.refresh}</button></header>
    <main>${banner}${body}</main>
    <nav class="tabs">
      <button data-tab="tasks" class="${S.tab === "tasks" ? "on" : ""}">${ICON.tasks}Việc${badge(counts.pend)}</button>
      <button data-tab="receipts" class="${S.tab === "receipts" ? "on" : ""}">${ICON.receipt}Hóa đơn${badge(counts.rc)}</button>
      <button data-tab="notif" class="${S.tab === "notif" ? "on" : ""}">${ICON.bell}Thông báo${badge(S.tab === "notif" ? 0 : counts.unread)}</button>
      <button data-tab="more" class="${S.tab === "more" ? "on" : ""}">${ICON.more}Tài khoản</button></nav>`;
  try { if (navigator.setAppBadge) (counts.pend + counts.rc ? navigator.setAppBadge(counts.pend + counts.rc) : navigator.clearAppBadge()); } catch (e) { /* bỏ qua */ }
}

$app.addEventListener("click", (ev) => {
  const t = ev.target.closest("button");
  if (!t || !S.session) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.seg) { S.taskSeg = t.dataset.seg; render(); return; }
  if (t.dataset.rcseg) { S.rcSeg = t.dataset.rcseg; render(); return; }
  if (t.dataset.openTask) { openTask(t.dataset.openTask); return; }
  if (t.dataset.openReceipt) { openReceipt(t.dataset.openReceipt); return; }
  if (t.dataset.notif) {
    const n = S.notifList[+t.dataset.notif];
    if (n && n.open && n.open.task) openTask(n.open.task);
    else if (n && n.open && n.open.receipt) openReceipt(n.open.receipt);
    return;
  }
  if (t.id === "refresh") refresh(true);
  else if (t.id === "today") openToday();
  else if (t.id === "assign") openAssign({ projectId: null, parentId: null });
  else if (t.id === "newReceipt") openNewReceipt();
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
      + `<button class="addphoto" id="addPhoto">+ Chụp / chọn ảnh</button>`;
    wrap.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { files.splice(+b.dataset.rm, 1); paint(); }));
    document.getElementById("addPhoto").onclick = () => document.getElementById("file").click();
  };
  document.getElementById("file").onchange = (ev) => {
    for (const f of ev.target.files) if (files.length < 10) files.push(f);
    ev.target.value = "";
    paint();
  };
  paint();
}

function openNewReceipt() {
  const files = [];
  openSheet("Gửi hóa đơn", `<p class="hint">Chụp rõ cả tờ hóa đơn (nhiều trang thì chụp nhiều ảnh), ghi mua cho việc gì rồi bấm Gửi. Trưởng phòng sẽ chọn dự án và xác nhận.</p>
    <input type="file" id="file" accept="image/*" capture="environment" multiple class="hidden">
    <div class="thumbs" id="thumbs"></div>
    <label class="field" for="note">Mua cho việc gì?</label>
    <textarea class="inp" id="note" maxlength="500" placeholder="Ví dụ: Mua 20m dây 2.5 đấu tủ A - xưởng AB2"></textarea>
    <p class="err" id="prog"></p>
    <button class="btn" id="send">Gửi hóa đơn</button>`);
  photoPicker(files);
  document.getElementById("file").click();
  document.getElementById("send").onclick = (ev) => {
    const note = document.getElementById("note").value;
    if (!files.length) { toast("Hãy chụp ít nhất một ảnh hóa đơn.", true); return; }
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
      <p class="hint">Chụp thêm ảnh (nếu cần), sửa ghi chú rồi gửi lại.</p><div class="thumbs" id="thumbs"></div>
      <label class="field" for="note">Mua cho việc gì?</label><textarea class="inp" id="note">${esc(r.note)}</textarea>
      <p class="err" id="prog"></p><button class="btn" id="resend">Gửi lại</button>`;
  }
  if (a.includes("cancel")) form += `<button class="btn ghost" id="cancel">Hủy hóa đơn này (gửi nhầm)</button>`;
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
  const cancel = document.getElementById("cancel");
  if (cancel) cancel.onclick = () => {
    if (confirm("Hủy hóa đơn này?")) runEdit(cancel, "Đang hủy...", () => S.session.editRC((m) => m.cancel(id)), "Đã hủy hóa đơn.");
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
