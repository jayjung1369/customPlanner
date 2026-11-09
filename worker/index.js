const original = [["", "", "10:00 공항 출발", "11:10 \n성인 3 , 애기 1\n광저우 도착 (OZ369,T2)", "12:10 \n성인 6 , 애기 1\n광저우 도착 (KE867,T2)", "", "", "", "", "", "저녁밥 (가족)", "", "", "", "", ""], ["", "", "", "", "12:00~12:40 엄마 화장 (성인 1)", "", "", "15:00 가족 결혼식 도착", "16:00~18:00 결혼식", "", "18:00 식사시작", "", "", "", "", ""], ["", "", "", "", "", "", "", "", "", "", "17:50 가족 일부, 화두 결혼식 도착", "", "20:00 화두 결혼식 종료", "", "", "11/16 01:15 형수 광저우 출발 (OZ358 ,T2)"]];
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const json = (data, status = 200) => Response.json(data, { status, headers });

function validEdit({day, slot, note, revision}) {
  const scheduleCell = Number.isInteger(day) && day >= 0 && day < 3 &&
    Number.isInteger(slot) && slot >= 0 && slot < 16;
  return (scheduleCell || (day === 0 && slot === -1)) && typeof note === "string" &&
    note.length <= 2000 && Number.isSafeInteger(revision) && revision >= 0;
}

async function importSchedule(db, edits) {
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 49 ||
      edits.some(edit => !edit || !validEdit(edit)) ||
      new Set(edits.map(({day, slot}) => day + ":" + slot)).size !== edits.length) {
    return json({ error: "가져올 일정 정보를 확인해 주세요." }, 400);
  }
  // Check all revisions before writing any cell, in a single SQLite statement.
  const { results } = await db.prepare(`
    WITH incoming AS MATERIALIZED (
      SELECT json_extract(value, '$.day') AS day, json_extract(value, '$.slot') AS slot,
             json_extract(value, '$.note') AS note, json_extract(value, '$.revision') AS revision
      FROM json_each(?)
    ), allowed AS MATERIALIZED (
      SELECT NOT EXISTS (
        SELECT 1 FROM incoming i LEFT JOIN schedule_cells s USING (day, slot)
        WHERE i.revision != COALESCE(s.revision, 0)
      ) AS ok
    )
    INSERT INTO schedule_cells (day, slot, note, revision)
    SELECT day, slot, note, revision + 1 FROM incoming, allowed WHERE ok
    ON CONFLICT (day, slot) DO UPDATE SET note = excluded.note, revision = excluded.revision
    RETURNING day, slot, note, revision
  `).bind(JSON.stringify(edits)).all();
  if (results.length !== edits.length) return json({ error: "미리보기 이후 일정이 변경됐어요. 파일을 다시 선택해 확인해 주세요." }, 409);
  return json({ cells: results });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/assets/excel.js") {
      return new Response(excelScript, { headers: {...headers, "Content-Type": "text/javascript; charset=utf-8"} });
    }
    if (request.method === "GET" && url.pathname === "/assets/schedule-template.xlsx") {
      const bytes = Uint8Array.from(atob(excelTemplate), character => character.charCodeAt(0));
      return new Response(bytes, { headers: {...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"} });
    }
    if (["/", "/admin"].includes(url.pathname) && request.method === "GET") {
      return new Response(url.pathname === "/admin" ? page.replace("<!-- excel-script -->", '<script src="/assets/excel.js"></script>') : page, { headers: {
        ...headers, "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      } });
    }
    if (url.pathname !== "/api/schedule") return json({ error: "페이지를 찾을 수 없습니다." }, 404);
    try {
      if (request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT day, slot, note, revision FROM schedule_cells").all();
        const days = original.map(day => day.map(note => ({ note, revision: 0 })));
        for (const { day, slot, note, revision } of results) {
          if (slot !== -1) days[day][slot] = { note, revision };
        }
        const memo = results.find(row => row.slot === -1) ?? { note: "", revision: 0 };
        return json({ days, memo });
      }
      if (!["PUT", "POST"].includes(request.method)) return json({ error: "지원하지 않는 요청입니다." }, 405);
      if (request.headers.get("Origin") !== url.origin) return json({ error: "페이지를 새로고침해 주세요." }, 403);
      const data = await request.json().catch(() => null);
      if (!data) return json({ error: "입력 내용을 확인해 주세요." }, 400);
      if (request.method === "POST") return await importSchedule(env.DB, data.edits);
      if (!validEdit(data)) return json({ error: "입력 내용을 확인해 주세요." }, 400);
      const { day, slot, note, revision } = data;
      const query = revision === 0
        ? "INSERT INTO schedule_cells (note, day, slot, revision) VALUES (?, ?, ?, 1) ON CONFLICT DO NOTHING RETURNING note, revision"
        : "UPDATE schedule_cells SET note = ?, revision = revision + 1 WHERE day = ? AND slot = ? AND revision = ? RETURNING note, revision";
      const statement = env.DB.prepare(query);
      const updated = await (revision === 0 ? statement.bind(note, day, slot) : statement.bind(note, day, slot, revision)).first();
      if (updated) return json(updated);
      const current = await env.DB.prepare("SELECT note, revision FROM schedule_cells WHERE day = ? AND slot = ?").bind(day, slot).first();
      return json({ error: "다른 사람이 먼저 저장했습니다.", current }, 409);
    } catch (error) {
      console.error("Schedule database error", error);
      return json({ error: "저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요." }, 503);
    }
  },
};

const page = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>광저우 웨딩 일정</title><meta name="robots" content="noindex,nofollow">
<style>
:root{color-scheme:light;--ink:#232b26;--muted:#53645a;--green:#244b39;--line:#dbe3db;--cream:#f6f5ee}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font-family:system-ui,"Malgun Gothic","Microsoft Yahei",sans-serif}
main{max-width:900px;margin:auto;padding:40px 20px 64px}.hero{background:#1c382b;color:#fffdf2;border-radius:22px;padding:30px clamp(20px,5vw,44px);position:relative;overflow:hidden}.hero:after{content:"";position:absolute;right:-70px;top:-110px;width:320px;height:320px;border:1px solid #698474;border-radius:50%;box-shadow:0 0 0 25px #ffffff0b,0 0 0 55px #ffffff09;pointer-events:none}
.eyebrow{font-size:.72rem;letter-spacing:.17em;font-weight:750;color:#d4dfc7}h1{font-size:clamp(1.9rem,5vw,3.2rem);letter-spacing:-.07em;margin:.42em 0 .24em}.hero p{margin:0;color:#e1eadb;font-size:.9rem}
nav{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:20px 0}button{font:inherit;cursor:pointer;border:1px solid var(--line);background:white;color:var(--ink);border-radius:11px;padding:10px 13px;font-weight:650}button:hover{border-color:var(--green)}button:focus-visible,textarea:focus-visible{outline:2px solid #477f61;outline-offset:2px}button[aria-pressed=true],.primary{background:var(--green);color:white;border-color:var(--green)}button:disabled{opacity:.5;cursor:default}
section{background:#fff;border:1px solid var(--line);border-radius:17px;padding:18px;margin-bottom:16px}.bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}h2{font-size:1.2rem;letter-spacing:-.04em;margin:0}.muted{color:var(--muted);font-size:.84rem}.tools{display:flex;gap:6px}.tools button{font-size:.8rem}.status{margin:9px 0;min-height:1.2em}
.excel-actions{display:flex;gap:6px;flex-wrap:wrap}#excel-summary{margin:12px 0}#excel-changes{max-height:42vh;overflow:auto;padding-left:20px;white-space:pre-wrap;overflow-wrap:anywhere}#excel-changes li{margin-bottom:10px}
.row{display:grid;grid-template-columns:115px minmax(0,1fr);gap:10px;align-items:start;padding:8px 0;border-top:1px solid #edf0eb}.time{font-variant-numeric:tabular-nums;font-size:.8rem;padding-top:11px;color:var(--muted);font-weight:700}.event{display:flex;align-items:center;justify-content:space-between;text-align:left;width:100%;min-height:40px;gap:10px;background:#eff5ef;border-color:#e3ebe2}.event span:first-child{white-space:pre-wrap;overflow-wrap:anywhere}.event.empty{background:#fff;color:var(--muted);border-style:dashed}.edit{font-size:.74rem;color:var(--muted);flex:none}
dialog{width:min(94vw,530px);border:1px solid var(--line);border-radius:17px;padding:22px;color:var(--ink);box-shadow:0 16px 70px #0003}dialog::backdrop{background:#14261bbb}textarea{width:100%;min-height:142px;font:inherit;padding:11px;border:1px solid #aab9ad;border-radius:9px;resize:vertical;margin:12px 0}.actions{display:flex;gap:7px;justify-content:flex-end;flex-wrap:wrap}.message{white-space:pre-wrap;overflow-wrap:anywhere;color:#843629;font-size:.86rem}.memo{margin-top:10px}[hidden]{display:none !important}.event.readonly{cursor:default}.hero a{color:#e1eadb;font-size:.85rem;display:inline-block;margin-top:9px}
@media(max-width:520px){main{padding:16px 12px 36px}.hero{padding:24px 18px}section{padding:12px}.row{grid-template-columns:78px minmax(0,1fr);gap:6px}.time{font-size:.7rem}.event{padding:9px;font-size:.9rem}}
</style></head><body><main>
<header class="hero"><div class="eyebrow">MOAAHUB · FAMILY SCHEDULE</div><h1>광저우 웨딩 일정</h1><p>2026년 11월 13–15일 · 광저우 현지 시간 (UTC+8)</p><a id="viewer" href="/" hidden>공개 일정 보기</a></header>
<nav aria-label="날짜 선택" id="days"></nav>
<section id="excel-tools" aria-labelledby="excel-title" hidden><div class="bar">
<h2 id="excel-title">엑셀 일정 관리</h2><div class="excel-actions"><button id="excel-export">엑셀 내보내기</button><button id="excel-import">엑셀 가져오기</button></div>
</div><p class="muted" id="excel-status" role="status">원본 양식의 .xlsx 파일을 사용할 수 있습니다.</p>
<input type="file" id="excel-file" accept=".xlsx" hidden></section>
<section aria-labelledby="date"><div class="bar"><h2 id="date"></h2><div class="tools"><button id="empty" aria-pressed="true">빈 시간 숨기기</button><button id="refresh">새로고침</button></div></div>
<p id="status" class="status muted" role="status">일정을 불러오는 중…</p><div id="list"></div></section>
<section aria-labelledby="memo-title"><h2 id="memo-title">공용 메모 · 준비물 · 이동 정보</h2><div id="memo" class="memo"></div></section>
</main><dialog id="excel-preview" aria-labelledby="excel-preview-title"><h2 id="excel-preview-title">엑셀 변경 사항 확인</h2>
<p id="excel-summary"></p><ul id="excel-changes"></ul><div id="excel-error" class="message" role="status"></div>
<div class="actions"><button id="excel-cancel">취소</button><button class="primary" id="excel-apply">일정에 적용</button></div></dialog>
<dialog id="editor"><form id="form"><h2 id="edit-title"></h2><textarea id="note" maxlength="2000" aria-label="일정 또는 메모 내용" placeholder="일정이나 전달할 내용을 입력하세요"></textarea><div id="error" class="message" role="status"></div><div class="actions"><button type="button" id="latest" hidden>최신 내용 불러오기</button><button type="button" id="cancel">취소</button><button class="primary" id="save">저장</button></div></form></dialog>
<script>
const $ = id => document.getElementById(id);
const labels = ["11/13 (금)", "11/14 (토)", "11/15 (일)"];
const times = Array.from({length:16}, (_, i) => String(i+8).padStart(2,"0")+":00–"+String((i+9)%24).padStart(2,"0")+":00");
const adminPage = location.pathname === "/admin";
if (adminPage) {
  if (location.hash) history.replaceState(null, "", "/admin");
  localStorage.removeItem("weddingAdminKey");
  sessionStorage.removeItem("weddingAdminKey");
  $("viewer").hidden = false;
  document.title = "광저우 웨딩 일정 관리";
  document.querySelector("h1").textContent = "광저우 웨딩 일정 관리";
}
let data, day = 0, all = true, target, conflict, saving = false, loading = false;
const tabs = labels.map((label,index) => {
  const button = document.createElement("button");
  button.textContent = label;
  button.onclick = () => { day = index; render(); };
  $("days").append(button);
  return button;
});
function card(cell, slot) {
  const canEdit = adminPage;
  const button = document.createElement(canEdit ? "button" : "div");
  button.className = "event" + (cell.note ? "" : " empty") + (canEdit ? "" : " readonly");
  const body = document.createElement("span");
  body.textContent = cell.note || (canEdit ? (slot === -1 ? "공용 메모 추가" : "일정 추가") : (slot === -1 ? "등록된 메모가 없어요." : "일정 없음"));
  if (!canEdit) {
    button.append(body);
    return button;
  }
  const edit = document.createElement("span");
  edit.className = "edit";
  edit.textContent = cell.note ? "수정" : "+";
  button.append(body,edit);
  button.onclick = () => {
    target = {day:slot === -1 ? 0 : day, slot, revision:cell.revision};
    $("edit-title").textContent = slot === -1 ? "공용 메모" : labels[day] + " · " + times[slot];
    $("note").value = cell.note;
    $("error").textContent = "";
    $("latest").hidden = true;
    conflict = null;
    $("save").disabled = false;
    $("editor").showModal();
  };
  return button;
}
function render() {
  tabs.forEach((button,index) => button.setAttribute("aria-pressed",String(index === day)));
  $("date").textContent = labels[day] + " 일정";
  $("empty").textContent = all ? "빈 시간 숨기기" : "빈 시간 보기";
  $("empty").setAttribute("aria-pressed",String(all));
  $("list").replaceChildren();
  $("memo").replaceChildren();
  if (!data) return;
  const cells = data.days[day];
  const hasEvents = cells.some(cell => cell.note);
  for (const [slot,cell] of cells.entries()) {
    if (!all && hasEvents && !cell.note) continue;
    const row = document.createElement("div");
    row.className = "row";
    const time = document.createElement("div");
    time.className = "time";
    time.textContent = times[slot];
    row.append(time,card(cell,slot));
    $("list").append(row);
  }
  $("memo").append(card(data.memo,-1));
}
async function load(announce = false) {
  if (loading || $("editor").open) return;
  loading = true;
  try {
    const response = await fetch("/api/schedule");
    if (!response.ok) throw Error();
    const fresh = await response.json();
    if ($("editor").open) return;
    data = fresh;
    render();
    $("status").textContent = announce ? "최신 일정을 불러왔어요." : adminPage ? "일정을 누르면 수정할 수 있어요." : "날짜를 선택해 일정을 확인하세요.";
  } catch {
    $("status").textContent = "일정을 불러오지 못했어요. 새로고침을 눌러 다시 시도해 주세요.";
  } finally { loading = false; }
}
$("empty").onclick = () => { all = !all; render(); };
$("refresh").onclick = () => load(true);
$("cancel").onclick = () => $("editor").close();
$("editor").addEventListener("cancel",event => { if (saving) event.preventDefault(); });
$("latest").onclick = () => {
  $("note").value = conflict.note;
  target.revision = conflict.revision;
  $("error").textContent = "최신 내용을 불러왔어요. 수정 후 저장할 수 있어요.";
  $("latest").hidden = true;
  conflict = null;
  $("save").disabled = false;
  $("note").focus();
};
$("form").onsubmit = async event => {
  event.preventDefault();
  if (saving || conflict) return;
  saving = true;
  $("error").textContent = "저장 중…";
  $("save").disabled = $("cancel").disabled = $("note").disabled = true;
  try {
    const response = await fetch("/api/schedule", {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...target,note:$("note").value.trim()})});
    const result = await response.json();
    if (response.status === 409 && result.current) {
      conflict = result.current;
      $("latest").hidden = false;
      throw Error(result.error + " 아래 버튼을 누르면 입력 중인 내용이 최신 내용으로 바뀝니다.");
    }
    if (!response.ok) throw Error(result.error);
    if (target.slot === -1) data.memo = result;
    else data.days[target.day][target.slot] = result;
    $("editor").close();
    render();
    $("status").textContent = "저장했어요. 함께 보는 일정에 반영됐습니다.";
  } catch (error) { $("error").textContent = error.message || "저장하지 못했어요. 다시 시도해 주세요."; }
  finally { saving = false; $("cancel").disabled = $("note").disabled = false; $("save").disabled = Boolean(conflict); }
};
render();
load();
window.addEventListener("focus",() => load());
setInterval(() => { if (document.visibilityState === "visible") load(); },30000);
</script><!-- excel-script --></body></html>`;
