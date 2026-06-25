/* ===========================================================================
   RCC HRIS Portal — live data layer over the visual mockup.
   Auth + injects real employee data into Dashboard, Employees, Worksites,
   and the Employee Record. Other mockup pages remain designed previews.
   =========================================================================== */
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.RCC_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = (s)=> (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtDate=(d)=>{ if(!d) return "—"; const x=new Date(/[TZ:]/.test(String(d))?d:d+"T00:00:00"); return isNaN(x)?String(d):x.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}); };
const fmtMDY=(d)=>{ if(!d) return "—"; const x=new Date(d); if(isNaN(x)) return String(d); const p=n=>String(n).padStart(2,"0"); return p(x.getMonth()+1)+"-"+p(x.getDate())+"-"+String(x.getFullYear()).slice(2); };

let EMPLOYEES=[];
let BRANCHES=[];
let DISERS=[];
let PREHIRE=[];
let ONBOARDING=[];
let ONBTASKS=[];
let EXITCASES=[];
let CONTRACTS=[];
let PHDOCS=[];
let COMPLIANCE=[];
let LOANS=[];
let MANPOWER=[];
let SIGNATURES=[];
let CANDIDATE_FEEDBACK=[];
let MEMOS=[];
let EVALUATIONS=[];
let CHANGE_LOG=[];
let CURRENT_USER=null;
async function logChange(entity,id,name,action,detail){
  try{ await sb.from("change_log").insert({ entity, entity_id:id||null, entity_name:name||null, action, detail:detail||null, changed_by:(CURRENT_USER&&CURRENT_USER.email)||"unknown" }); }catch(e){}
}
// Who may see salary / bank / government IDs. Locked to anj for now (add more emails here when decided).
// Access roles by login:
//   admin    (anj)    = everything
//   payroll  (Grazel) = recruiting view + Employees + sees pay/bank/government
//   recruiter(others) = recruiting only, pay hidden
const ROLE_BY_EMAIL={ "anj@hassarams.com":"admin", "hr@hassarams.com":"payroll" };
function userRole(){ return ROLE_BY_EMAIL[((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase()] || "recruiter"; }
function isAdminUser(){ return userRole()==="admin"; }
function canSeePay(){ const r=userRole(); return r==="admin"||r==="payroll"; }
function isLimitedUser(){ return userRole()!=="admin"; }
const RECRUITER_PAGES=["dashboard","manning","prehire","onboarding"];
function allowedPages(){ const r=userRole(); if(r==="admin") return null; if(r==="payroll") return RECRUITER_PAGES.concat(["employees"]); return RECRUITER_PAGES; }
function pageAllowed(id){ const a=allowedPages(); return !a || a.indexOf(id)!==-1; }
window.isLimitedUser=isLimitedUser; window.pageAllowed=pageAllowed;
function applyRoleUI(){
  const allow=allowedPages(), limited=isLimitedUser();
  document.querySelectorAll('.nav-item[data-page]').forEach(n=>{ n.style.display=(allow&&allow.indexOf(n.getAttribute('data-page'))===-1)?'none':''; });
  document.querySelectorAll('.nav-sec').forEach(s=>{ s.style.display=limited?'none':''; });
  const topSearch=document.querySelector('.topbar .search'); if(topSearch) topSearch.style.display=limited?'none':'';
}
// HMO provider to notify on every separation — set these to the real provider + email.
const HMO_NAME="our HMO provider";
const HMO_EMAIL="";  // ← fill in the HMO's email address
const DEFAULT_PH_DOCS=[["nbi","NBI / Police Clearance",true],["birth","PSA Birth Certificate",false],["sss","SSS (E-1 / number)",false],["philhealth","PhilHealth",false],["pagibig","Pag-IBIG (MID)",false],["tin","TIN / BIR 1902",false],["photo","2×2 ID Photos",false],["diploma","Diploma / TOR",false],["medical","Medical / Health Certificate",false]];
let empFilter="All";
let scFilter="All";
let prehireTab="pipeline";
let prehireSrc=null;
let landed=false;

/* ---------- AUTH ---------- */
async function init(){
  const { data:{session} } = await sb.auth.getSession();
  if(session) showApp(session.user); else $("#login").style.display="flex";
  sb.auth.onAuthStateChange((_e,s)=>{ if(_e==='SIGNED_OUT'){ location.reload(); } });
}
$("#loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const btn=$("#liBtn"), msg=$("#liMsg"); msg.textContent=""; btn.disabled=true; btn.textContent="Signing in…";
  const { data, error } = await sb.auth.signInWithPassword({ email:$("#liEmail").value.trim(), password:$("#liPass").value });
  btn.disabled=false; btn.textContent="Sign in";
  if(error){ msg.textContent=error.message; return; }
  showApp(data.user);
});
async function showApp(user){
  CURRENT_USER=user; $("#login").style.display="none";
  patchSidebarFoot(user);
  applyRoleUI();
  await loadEmployees();
}
function patchSidebarFoot(user){
  const foot=$(".sidebar-foot"); if(!foot) return;
  const name=(user.email||"").split("@")[0];
  const initials=name.slice(0,2).toUpperCase();
  foot.innerHTML=`
    <div class="av">${esc(initials)}</div>
    <div style="flex:1;min-width:0;"><div style="color:#fff;font-weight:600;overflow:hidden;text-overflow:ellipsis;">${esc(name)}</div>
      <div style="opacity:.55;font-size:11px;">Signed in</div></div>
    <button id="chgPw" title="Change password" style="background:rgba(255,255,255,.14);color:#fff;border:none;padding:6px 9px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;margin-right:6px;">🔑</button>
    <button id="signOut" style="background:rgba(255,255,255,.14);color:#fff;border:none;padding:6px 10px;border-radius:7px;font-size:11.5px;font-weight:600;cursor:pointer;">Sign out</button>`;
  $("#signOut").addEventListener("click", async ()=>{ await sb.auth.signOut(); });
  $("#chgPw").addEventListener("click", openChangePassword);
}
function openChangePassword(){
  let m=document.getElementById("pwModal"); if(!m){ m=document.createElement("div"); m.id="pwModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:380px;width:100%;padding:24px;">
    <h2 style="color:var(--green-dark);font-size:18px;margin-bottom:4px;">Change your password</h2>
    <div style="color:#6B7785;font-size:13px;margin-bottom:14px;">Set a password only you know — at least 8 characters.</div>
    <label style="font-size:12px;font-weight:700;color:#6B7785;">NEW PASSWORD</label>
    <input id="pwNew" type="password" autocomplete="new-password" style="width:100%;padding:10px 12px;border:1px solid #E3E8EF;border-radius:8px;margin:4px 0 12px;">
    <label style="font-size:12px;font-weight:700;color:#6B7785;">CONFIRM PASSWORD</label>
    <input id="pwConf" type="password" autocomplete="new-password" style="width:100%;padding:10px 12px;border:1px solid #E3E8EF;border-radius:8px;margin:4px 0 4px;">
    <div id="pwMsg" style="font-size:13px;margin:8px 0;min-height:18px;"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px;">
      <button id="pwCancel" class="btn ghost">Cancel</button>
      <button id="pwSave" class="btn">Save password</button>
    </div></div>`;
  const close=()=>m.remove();
  $("#pwCancel").addEventListener("click",close);
  m.addEventListener("click",(ev)=>{ if(ev.target===m) close(); });
  $("#pwSave").addEventListener("click", async ()=>{
    const np=$("#pwNew").value, cf=$("#pwConf").value, msg=$("#pwMsg");
    if(np.length<8){ msg.style.color="#a4322a"; msg.textContent="Password must be at least 8 characters."; return; }
    if(np!==cf){ msg.style.color="#a4322a"; msg.textContent="Passwords don't match — please re-type."; return; }
    const btn=$("#pwSave"); btn.disabled=true; btn.textContent="Saving…";
    const { error } = await sb.auth.updateUser({ password: np });
    btn.disabled=false; btn.textContent="Save password";
    if(error){ msg.style.color="#a4322a"; msg.textContent=error.message; return; }
    msg.style.color="#1c6b3f"; msg.textContent="✓ Password updated — use it next time you sign in.";
    setTimeout(close, 1900);
  });
}

/* ---------- DATA ---------- */
async function loadEmployees(){
  const [emp, br, di, ph, oc, ot, ex, ct, pd, cm, ln, mr, sg, cf, me, evl, clg] = await Promise.all([
    sb.from("employees").select("*").order("full_name"),
    sb.from("branches").select("*").order("name"),
    sb.from("disers").select("*").order("name"),
    sb.from("prehire").select("*").order("created_at"),
    sb.from("onboarding_cases").select("*").order("created_at"),
    sb.from("onboarding_tasks").select("*").order("sort_order"),
    sb.from("exit_clearance").select("*").order("created_at"),
    sb.from("contracts").select("*").order("created_at"),
    sb.from("prehire_documents").select("*"),
    sb.from("compliance_items").select("*").order("name"),
    sb.from("loans").select("*").order("created_at", {ascending:false}),
    sb.from("manpower_requests").select("*").order("date_posted", {ascending:false}),
    sb.from("signature_requests").select("*").order("created_at", {ascending:false}),
    sb.from("candidate_feedback").select("*").order("created_at", {ascending:false}),
    sb.from("memos").select("*").order("created_at", {ascending:false}),
    sb.from("evaluations").select("*").order("eval_date", {ascending:false}),
    sb.from("change_log").select("*").order("created_at", {ascending:false}).limit(500)
  ]);
  if(emp.error){ alert("Could not load employees: "+emp.error.message); return; }
  EMPLOYEES=emp.data||[];
  BRANCHES=br.data||[];
  DISERS=di.data||[];
  PREHIRE=(ph&&ph.data)||[];
  ONBOARDING=(oc&&oc.data)||[];
  ONBTASKS=(ot&&ot.data)||[];
  EXITCASES=(ex&&ex.data)||[];
  CONTRACTS=(ct&&ct.data)||[];
  PHDOCS=(pd&&pd.data)||[];
  COMPLIANCE=(cm&&cm.data)||[];
  LOANS=(ln&&ln.data)||[];
  MANPOWER=(mr&&mr.data)||[];
  SIGNATURES=(sg&&sg.data)||[];
  CANDIDATE_FEEDBACK=(cf&&cf.data)||[];
  MEMOS=(me&&me.data)||[];
  EVALUATIONS=(evl&&evl.data)||[];
  CHANGE_LOG=(clg&&clg.data)||[];
  renderDashboard();
  renderCompliance();
  renderEmployeesPage();
  renderBranchesPage();
  renderManning();
  renderPrehire();
  renderOnboarding();
  renderExit();
  renderContracts();
  renderLoans();
  renderSettings();
  renderSignatures();
  renderMemos();
  renderEvaluations();
  tagPreviewPages();
  wireGlobalSearch();
  if(!landed){ landed=true; if(typeof window.go==="function") window.go("dashboard"); }
}
/* ---------- SETTINGS — PayPlus Sync ----------
   Pulls the PayPlus masterlist + recent attendance and reconciles employee
   Active/Separated status. Status is decided by ATTENDANCE (present>0 in the
   window), never by PayPlus resignationDate (that field is unreliable).
   Flow: Preview (dry-run, no changes) → review the diff → Apply (writes).
   Separations are only written if the "apply separations" box is ticked, so
   nobody on maternity/sick leave gets auto-separated. */
const PP_GATE="sync-Rcc7Yq2";
let PP_LAST=null;

async function ppSyncFetch(params){
  const { data:{session} } = await sb.auth.getSession();
  if(!session) throw new Error("You're signed out — sign in again and retry.");
  const r = await fetch(`${SUPABASE_URL}/functions/v1/payplus-sync?`+params, {
    headers:{ apikey: SUPABASE_ANON_KEY, Authorization:`Bearer ${session.access_token}` }});
  const j = await r.json().catch(()=>({}));
  if(!r.ok || j.error) throw new Error(j.error || ("PayPlus sync failed (HTTP "+r.status+")."));
  return j;
}

// Honesty pass: every screen NOT backed by live data gets a visible "Preview" ribbon,
// so HR never mistakes an illustrative mock-up for real data. Real pages are listed here.
const REAL_PAGES=new Set(["dashboard","employees","branches","manning","prehire","onboarding","exit","contracts","loans","compliance","settings","signatures","memos","evaluations"]);
function tagPreviewPages(){
  document.querySelectorAll('section.page').forEach(sec=>{
    const id=(sec.id||"").replace("page-","");
    if(REAL_PAGES.has(id) || sec.querySelector(':scope > .preview-tag')) return;
    const b=document.createElement('div'); b.className='preview-tag';
    b.style.cssText="background:#fdf6e3;border:1px solid #ecd9a6;color:#8a6a14;border-radius:10px;padding:9px 13px;margin:0 0 12px;font-size:12.5px;font-weight:600;";
    b.textContent="👁 Preview — this screen is an illustrative mock-up, not live data yet. Tell Claude to wire it up, or it gets built for real on Tally.";
    sec.insertBefore(b, sec.firstChild);
  });
}
function renderSettings(){
  const pg=$("#page-settings"); if(!pg) return;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>PayPlus Sync <span class="count-tag">live</span></h2>
      <div class="psub">Reconcile employee <b>Active / Separated</b> status against PayPlus.
        Status is decided by recent <b>attendance</b> (anyone with attendance in the window is Active) —
        not by PayPlus's unreliable resignation dates. Always <b>Preview</b> first; nothing is changed until you click <b>Apply</b>.</div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:4px 0 12px;">
        <label style="font-size:12.5px;color:var(--muted);font-weight:600;">Attendance window
          <select id="ppDays" style="margin-left:6px;padding:6px 8px;border:1px solid var(--line);border-radius:7px;font-size:13px;">
            <option value="30">last 30 days</option>
            <option value="60" selected>last 60 days</option>
            <option value="90">last 90 days</option>
          </select></label>
        <button id="ppPreview" class="btn">Preview sync (dry run)</button>
        <span id="ppBusy" style="font-size:12.5px;color:var(--muted);display:none;">Contacting PayPlus…</span>
      </div>
      <div id="ppResult"></div>
    </div>`;
  $("#ppDays").value="60";
  $("#ppPreview").addEventListener("click",()=>runPayPlusPreview());
}

function ppCard(label,n,tone){
  const col = tone==="good" ? "#1c6b3f" : tone==="warn" ? "#9a6a00" : tone==="bad" ? "#a4322a" : "var(--green-dark)";
  return `<div class="kpi" style="flex:1;min-width:130px;"><div class="k-l">${label}</div><div class="k-n" style="color:${col};">${n}</div></div>`;
}
function ppList(title,rows,cols){
  if(!rows||!rows.length) return "";
  const body=rows.map(r=>`<tr class="clickable" data-ppid="${esc(r.id)}" style="cursor:pointer;"><td>${esc(r.id)}</td><td>${esc(r.name||"—")}</td>${cols.from?`<td>${esc(r.from||"—")}</td>`:""}<td style="text-align:right;">${esc(String(r.present??"—"))}</td></tr>`).join("");
  return `<details${cols.open?" open":""} style="margin-top:10px;"><summary style="cursor:pointer;font-weight:700;color:var(--green-dark);font-size:13.5px;">${title} — ${rows.length} ${rows.length===80||rows.length===300?"(showing first "+rows.length+")":""} <span style="font-weight:400;color:var(--muted);font-size:12px;">· click a name to view their record</span></summary>
    <table style="margin-top:8px;"><thead><tr><th>PayPlus ID</th><th>Name</th>${cols.from?"<th>From status</th>":""}<th style="text-align:right;">Present days</th></tr></thead><tbody>${body}</tbody></table></details>`;
}

async function runPayPlusPreview(){
  const out=$("#ppResult"), busy=$("#ppBusy"), btn=$("#ppPreview");
  const days=$("#ppDays").value||"60";
  out.innerHTML=""; busy.style.display="inline"; btn.disabled=true;
  try{
    const j=await ppSyncFetch(`mode=dry&days=${days}`);
    PP_LAST=j; const res=j.result||{}; const w=j.window||{}; const p=j.pulled||{};
    const nA=res.will_activate||0, nS=res.will_separate||0, nI=res.will_insert_new_active||0;
    const hasChanges = nA||nI||nS;
    out.innerHTML=`
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:8px;">
        Window <b>${esc(w.dateFrom)} → ${esc(w.dateTo)}</b> ·
        pulled ${p.masterlist} masterlist, ${p.active_in_window} active in window ·
        matched ${res.matched}, already in sync ${res.already_consistent}.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
        ${ppCard("Will activate",nA,nA?"good":"")}
        ${ppCard("Will add (new active)",nI,nI?"good":"")}
        ${ppCard("Flagged separated",nS,nS?"warn":"")}
        ${ppCard("Already consistent",res.already_consistent||0,"")}
      </div>
      ${ppList("To activate (back to Active)",res.sample_activate,{from:true})}
      ${ppList("To add as new Active employees",res.sample_insert,{from:false})}
      ${ppList("No recent attendance → would be Separated",res.list_separate,{from:false,open:true})}
      ${ hasChanges ? `
        <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px;">
          ${ nS ? `<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--ink);margin-bottom:12px;background:#fff8ec;border:1px solid #f0d9a8;border-radius:9px;padding:10px 12px;">
            <input type="checkbox" id="ppDowngrades" style="margin-top:3px;">
            <span><b>Also mark the ${nS} flagged people as Separated.</b> Leave this <b>unticked</b> unless you've reviewed the list above —
            anyone on maternity, sick, or other approved leave will have no attendance and must NOT be separated. Activations and new adds apply either way.</span></label>` : "" }
          <button id="ppApply" class="btn">Apply changes${nS?" (review separations first)":""}</button>
          <button id="ppRefresh" class="btn ghost" style="margin-left:8px;">Re-run preview</button>
        </div>` : `<div style="margin-top:14px;color:#1c6b3f;font-weight:700;">✓ Everything is already in sync — nothing to apply.</div>` }`;
    $$("#ppResult [data-ppid]").forEach(tr=>tr.addEventListener("click",()=>{
      const e=EMPLOYEES.find(x=>String(x.employee_id)===String(tr.dataset.ppid));
      if(e) openForm(e); else alert("This person isn't in the portal yet — they're new in PayPlus, so there's no record to open.");
    }));
    if(hasChanges){
      $("#ppApply").addEventListener("click",()=>runPayPlusApply());
      $("#ppRefresh").addEventListener("click",()=>runPayPlusPreview());
    }
  }catch(e){
    out.innerHTML=`<div style="color:#a4322a;font-weight:600;">${esc(e.message)}</div>`;
  }finally{ busy.style.display="none"; btn.disabled=false; }
}

async function runPayPlusApply(){
  if(!PP_LAST){ return; }
  const res=PP_LAST.result||{};
  const days=$("#ppDays").value||"60";
  const dg = $("#ppDowngrades") && $("#ppDowngrades").checked;
  const nA=res.will_activate||0, nI=res.will_insert_new_active||0, nS=res.will_separate||0;
  const parts=[]; if(nA)parts.push(`reactivate ${nA}`); if(nI)parts.push(`add ${nI} new`); if(dg&&nS)parts.push(`separate ${nS}`);
  const msg=`Apply to the live directory now?\n\nThis will ${parts.join(", ")}.`+
    (nS&&!dg?`\n\nThe ${nS} no-attendance people will NOT be separated (box unticked).`:"")+
    `\n\nThis writes to employee records.`;
  if(!confirm(msg)) return;
  const out=$("#ppResult"), busy=$("#ppBusy");
  busy.style.display="inline"; const apply=$("#ppApply"); if(apply){ apply.disabled=true; apply.textContent="Applying…"; }
  try{
    const j=await ppSyncFetch(`mode=apply&days=${days}&downgrades=${dg?"1":"0"}&gate=${PP_GATE}`);
    const r=j.result||{};
    const successHtml=`<div style="background:var(--green-light);border:1px solid #bcdcc8;border-radius:10px;padding:14px 16px;">
      <div style="color:#1c6b3f;font-weight:800;font-size:15px;margin-bottom:6px;">✓ Sync applied — directory updated</div>
      <div style="font-size:13.5px;color:var(--ink);">
        Reactivated <b>${r.will_activate||0}</b> · added <b>${r.will_insert_new_active||0}</b> new ·
        separated <b>${dg?(r.will_separate||0):0}</b> · identity-refreshed <b>${r.identity_refreshed||0}</b>.
      </div>
      <div style="font-size:12.5px;color:var(--muted);margin-top:6px;">Run Preview again any time to re-check.</div></div>`;
    PP_LAST=null;
    await loadEmployees();      // refresh KPIs + directory; this also re-renders the Settings panel (clearing #ppResult)
    go("settings");             // keep the user on Settings
    const fresh=$("#ppResult"); if(fresh) fresh.innerHTML=successHtml;   // re-show the result after the panel rebuild
    return;
  }catch(e){
    out.innerHTML=`<div style="color:#a4322a;font-weight:600;">Apply failed: ${esc(e.message)}</div>`;
  }finally{ busy.style.display="none"; }
}

/* ---------- COMPLIANCE — live register (IPO trademarks; licenses/permits next) ---------- */
function renderCompliance(){
  const pg=$("#page-compliance"); if(!pg) return;
  const CY=new Date().getFullYear();
  const tm=COMPLIANCE.filter(c=>c.kind==="Trademark");
  const verify=tm.filter(c=>c.needs_verify);
  const dueNow=tm.filter(c=>c.next_due_year===CY && !c.needs_verify);
  const upcoming=tm.filter(c=>c.next_due_year>CY && !c.needs_verify).sort((a,b)=>a.next_due_year-b.next_due_year);
  const pending=tm.filter(c=>c.status==="PENDING");
  const expired=tm.filter(c=>c.status==="EXPIRED");
  const row=(c,dotClass,extra)=>`<div class="task"><div class="dot ${dotClass}"></div>
    <div style="flex:1;"><div class="tt">${esc(c.name)}</div>
      <div class="td">${esc(c.ref_no||"no case # on file")} · ${esc(c.authority||"")}${c.reg_year?" · registered "+c.reg_year:""}</div></div>
    <div class="due ${dotClass}">${esc(extra)}</div></div>`;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Compliance — IPO Trademarks <span class="count-tag">live</span></h2>
      <div class="psub">Every registered mark needs a <b>Declaration of Actual Use</b> (3rd / 5th / 7th year) and a <b>10-year renewal</b> — missing a DAU can cancel the mark. Source: IPO Trademark Calendar. Dates are year-level; confirm exact dates against the certificates.</div>
      <div class="grid kpis" style="grid-template-columns:repeat(5,1fr);">
        <div class="kpi ${verify.length?'alert':''}"><div class="k-l">Verify</div><div class="k-n">${verify.length}</div><div class="k-s">deadline passed on file</div></div>
        <div class="kpi ${dueNow.length?'warn':''}"><div class="k-l">Due ${CY}</div><div class="k-n">${dueNow.length}</div><div class="k-s">DAU / renewals this year</div></div>
        <div class="kpi"><div class="k-l">Upcoming</div><div class="k-n">${upcoming.length}</div><div class="k-s">${CY+1} onwards</div></div>
        <div class="kpi"><div class="k-l">Pending Apps</div><div class="k-n">${pending.length}</div><div class="k-s">awaiting IPOPHL</div></div>
        <div class="kpi"><div class="k-l">Expired</div><div class="k-n">${expired.length}</div><div class="k-s">re-file decisions</div></div>
      </div>
      ${verify.length?`<h2 style="margin-top:18px;">⚠ Verify with IPO records — deadline on file has passed</h2>
        <div class="psub">These show a renewal/DAU year already past. Either it was filed (update the record) or the mark is at risk.</div>
        ${verify.map(c=>row(c,"r",(c.next_due_label||"")+" "+(c.next_due_year||""))).join("")}`:""}
      ${dueNow.length?`<h2 style="margin-top:18px;">Due this year (${CY})</h2>
        ${dueNow.map(c=>row(c,"a",(c.next_due_label||"")+" "+CY)).join("")}`:""}
      <h2 style="margin-top:18px;">Upcoming</h2>
      ${upcoming.map(c=>row(c,"g",(c.next_due_label||"")+" "+(c.next_due_year||""))).join("")||'<div class="psub">None upcoming.</div>'}
      ${pending.length?`<h2 style="margin-top:18px;">Pending applications</h2>
        ${pending.map(c=>row(c,"a","awaiting registration")).join("")}`:""}
      ${expired.length?`<h2 style="margin-top:18px;">Expired marks</h2>
        <div class="psub">Decide per brand: re-file or let go. (GEAR UP is here — note the GearUp stores.)</div>
        ${expired.map(c=>row(c,"r","expired")).join("")}`:""}
      <div class="psub" style="margin-top:16px;">Next for this section: <b>License to Operate</b> + business permits with expiry reminders — send me the permits and I'll add them.</div>
    </div>`;
}

/* ---------- LOANS — HR review queue (employees apply via the public link) ---------- */
const LOAN_APPLY_URL="https://agenovi.github.io/rcc-hris-portal/loan-apply.html";
const LOAN_STAGES=["Submitted","HR Review","Supervisor","Management","Approved","Released","Rejected"];
const loanTypeLabel=(t)=>({discretionary:"Discretionary",emergency:"Emergency",educational:"Educational",moto:"Motorcycle"}[t]||t||"—");
async function openLoanDoc(path,btn){
  if(btn){ btn.disabled=true; btn.textContent="Opening…"; }
  const {data,error}=await sb.storage.from("loan-docs").createSignedUrl(path,3600);
  if(btn){ btn.disabled=false; btn.textContent="View"; }
  if(error||!data){ alert("Couldn't open this document: "+(error&&error.message||"unknown error")); return; }
  window.open(data.signedUrl,"_blank");
}
window.openLoanDoc=openLoanDoc;
async function openPrehireDoc(path,btn){
  if(btn){ btn.disabled=true; btn.textContent="Opening…"; }
  const {data,error}=await sb.storage.from("prehire-docs").createSignedUrl(path,3600);
  if(btn){ btn.disabled=false; btn.textContent="View resume"; }
  if(error||!data){ alert("Couldn't open this file: "+(error&&error.message||"unknown error")); return; }
  window.open(data.signedUrl,"_blank");
}
window.openPrehireDoc=openPrehireDoc;
const LOAN_SIGN_BASE="https://agenovi.github.io/rcc-hris-portal/loan-sign.html";
const LOAN_RATES={discretionary:12,emergency:12,educational:0,moto:6};
// Per-department approver routing (Anj 2026-06-18): Head Office → Anj, Store/Warehouse → Kaira.
function loanApprover(l){ const t=((l.department||"")+" "+(l.position||"")).toLowerCase(); return /warehouse|store/.test(t)?"Kaira":"Anj"; }
function newLoanToken(){ try{ if(crypto&&crypto.randomUUID) return crypto.randomUUID().replace(/-/g,""); }catch(e){} return Date.now().toString(36)+Math.random().toString(36).slice(2,12); }
// DOLE-cleaned loan agreement (Art. 113 compliant; no void post-separation penalty interest).
function buildLoanAgreement(l,approver){
  const P=n=>"PHP "+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const rate=LOAN_RATES[l.loan_type]??12, term=l.term_months||12, amt=Number(l.amount||0);
  const monthly=term?(amt+amt*(rate/100)*(term/12))/term:0;
  const today=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});
  const moto=l.loan_type==="moto", L=[];
  L.push(`This Employee Loan Agreement is made on ${today} between ROSHAN COMMERCIAL CORPORATION ("the Company") and ${l.applicant_name} ("the Borrower"), ${l.department||"employee"}.`,"");
  L.push(`1. LOAN. The Company grants the Borrower a ${loanTypeLabel(l.loan_type)} loan of ${P(amt)} for the purpose stated by the Borrower: ${l.purpose||"—"}.`);
  if(l.loan_type==="educational"){
    L.push(`2. NATURE. This is educational assistance covering up to 50% of the child's tuition, paid directly to the school, at 0% interest. The Borrower's family shoulders the remaining tuition. The student/child shall sign a waiver as a condition of release.`);
    L.push(`3. REPAYMENT. The Borrower shall repay ${P(amt)} over ${term} month(s) in equal amortizations of approximately ${P(monthly)} each, by salary deduction every payroll.`);
  } else {
    L.push(`2. INTEREST. Interest is ${rate}% per annum, computed on a flat basis.`);
    L.push(`3. REPAYMENT. The Borrower shall repay over ${term} month(s) in equal amortizations of approximately ${P(monthly)} each (principal plus interest), by salary deduction every payroll.`);
  }
  L.push(`4. SALARY DEDUCTION AUTHORIZATION. The Borrower freely authorizes the Company, in writing, to deduct the agreed amortization from his/her salary each payroll until the loan is fully paid. Such deductions shall not reduce the Borrower's take-home pay below the applicable minimum wage (Article 113, Labor Code).`);
  L.push(`5. SEPARATION. Upon separation for any cause, the outstanding balance becomes due and may be deducted from the Borrower's final pay only to the extent allowed by law. Any remaining balance is settled directly, without additional penalty interest.`);
  if(moto) L.push(`6. OWNERSHIP. The motorcycle remains the property of the Company until the loan and all related charges are fully paid; ownership transfers to the Borrower upon full payment.`);
  L.push(`${moto?7:6}. APPROVAL. The amount and terms are subject to the Company's approval and the Borrower's capacity to pay.`);
  L.push(`${moto?8:7}. ELECTRONIC SIGNATURE (RA 8792). The Borrower's electronic signature below has the same legal effect as a handwritten signature.`,"");
  L.push(`Borrower: ${l.applicant_name}`,`Approved for the Company: ${approver||loanApprover(l)}`);
  return L.join("\n");
}
const loanStatusPill=(s)=>{ const m={"Submitted":"a","HR Review":"a","Supervisor":"a","Management":"a","Approved":"g","Released":"g","Rejected":"r"}; return `<span class="pill ${({a:'probation',g:'active',r:'closed'})[m[s]||'a']}">${esc(s)}</span>`; };
function renderLoans(){
  const pg=$("#page-loans"); if(!pg) return;
  const open=LOANS.filter(l=>!["Released","Rejected"].includes(l.status));
  const newCt=LOANS.filter(l=>l.status==="Submitted").length;
  const approved=LOANS.filter(l=>["Approved","Released"].includes(l.status)).length;
  const peso=(n)=>n==null?"—":"₱"+Number(n).toLocaleString(undefined,{maximumFractionDigits:0});
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Employee Loans <span class="count-tag">live</span></h2>
      <div class="psub">Employees apply through the public link — no portal login. Applications land here for HR to review and move through the stages.</div>
      <div class="actionbar">
        <button class="btn" onclick="navigator.clipboard&&navigator.clipboard.writeText('${LOAN_APPLY_URL}');this.textContent='Link copied ✓'">Copy employee application link</button>
        <a class="btn blue" href="${LOAN_APPLY_URL}" target="_blank" style="text-decoration:none;">Open the form ↗</a>
      </div>
      <div class="grid kpis" style="grid-template-columns:repeat(4,1fr);">
        <div class="kpi ${newCt?'warn':''}"><div class="k-l">New</div><div class="k-n">${newCt}</div><div class="k-s">just submitted</div></div>
        <div class="kpi"><div class="k-l">In Progress</div><div class="k-n">${open.length}</div><div class="k-s">under review</div></div>
        <div class="kpi"><div class="k-l">Approved / Released</div><div class="k-n">${approved}</div></div>
        <div class="kpi"><div class="k-l">Total Applications</div><div class="k-n">${LOANS.length}</div></div>
      </div>
      ${LOANS.length?`<table><thead><tr><th>Ref</th><th>Applicant</th><th>Type</th><th>Amount</th><th>Monthly (est.)</th><th>Status</th></tr></thead>
        <tbody id="loanRows"></tbody></table>`
        : `<div class="placeholder"><div class="pi"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#1E3A5F" stroke-width="2"><path d="M12 1v22M5 8h9a3 3 0 010 6H7"/></svg></div><h2>No applications yet</h2><p>Share the employee application link above. Submissions appear here automatically.</p></div>`}
    </div>`;
  const rows=$("#loanRows");
  if(rows){
    rows.innerHTML=LOANS.map(l=>`<tr class="clickable" data-id="${l.id}">
      <td><b>${esc(l.loan_ref)}</b></td>
      <td>${esc(l.applicant_name)}${l.department?`<div class="esub">${esc(l.department)}</div>`:""}</td>
      <td>${esc(loanTypeLabel(l.loan_type))}</td>
      <td>${peso(l.amount)}</td>
      <td>${peso(l.monthly_estimate)}</td>
      <td>${loanStatusPill(l.status)}</td></tr>`).join("");
    $$("#loanRows tr").forEach(tr=>tr.addEventListener("click",()=>openLoan(tr.dataset.id)));
  }
}
function openLoan(id){
  const l=LOANS.find(x=>String(x.id)===String(id)); if(!l) return;
  const peso=(n)=>n==null?"—":"₱"+Number(n).toLocaleString(undefined,{maximumFractionDigits:0});
  const idx=LOAN_STAGES.indexOf(l.status); const next=idx>=0&&idx<4?LOAN_STAGES[idx+1]:null;
  let m=document.getElementById("loanModal"); if(!m){ m=document.createElement("div"); m.id="loanModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:540px;height:100%;overflow-y:auto;">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;">
      <div style="font-size:20px;font-weight:800;">${esc(l.applicant_name)}</div>
      <div style="font-size:12.5px;opacity:.9;">${esc(l.loan_ref)} · ${esc(loanTypeLabel(l.loan_type))} · ${peso(l.amount)}</div>
    </div>
    <div style="padding:18px 22px 60px;">
      <div class="panel" style="margin-top:0;">
        <h2>Application</h2>
        ${phRow("Loan type",loanTypeLabel(l.loan_type))}${phRow("Amount",peso(l.amount))}${phRow("Term",(l.term_months||"—")+" months")}${phRow("Est. monthly",peso(l.monthly_estimate))}${phRow("Mobile",l.contact_number)}${phRow("Email",l.email)}${phRow("Employee ID",l.employee_id)}${phRow("Position",l.department)}${phRow("Take-home given",l.net_pay?peso(l.net_pay):"—")}${phRow("Purpose",l.purpose)}${phRow("Authorized",l.authorized?"Yes (RA 8792)":"—")}
      </div>
      <div class="panel">
        <h2>Supporting documents</h2>
        ${(Array.isArray(l.documents)&&l.documents.length)
          ? l.documents.map(d=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);">
              <div><div style="font-weight:600;">${esc(d.label||d.name||"Document")}</div><div class="esub">${esc(d.name||"")}</div></div>
              <button class="btn ghost" style="flex:none;" onclick="openLoanDoc('${esc(d.path)}',this)">View</button></div>`).join("")
          : `<div class="psub">No documents were attached. Use the applicant's mobile / email above to request them.</div>`}
      </div>
      ${l.loan_type==="educational"?`
      <div class="panel" style="border:2px solid ${l.waiver_signed?'var(--green)':'#e0b400'};">
        <h2>Educational waiver ${l.waiver_signed?'<span style="color:var(--green);font-size:13px;">✓ signed</span>':'<span style="color:#9a7500;font-size:13px;">— required before release</span>'}</h2>
        <div class="psub">This loan <b>cannot be released</b> until the student/child has signed the waiver.</div>
        ${l.waiver_doc?`<div style="margin-top:8px;"><button class="btn ghost" onclick="openLoanDoc('${esc(l.waiver_doc.path)}',this)">View signed waiver</button></div>`:""}
        <label style="font-size:12px;font-weight:700;color:var(--muted);display:block;margin-top:12px;">Upload the signed waiver</label>
        <input type="file" id="waiverFile" accept="image/*,application/pdf,.pdf" style="margin-top:4px;">
        <label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-size:13.5px;cursor:pointer;">
          <input type="checkbox" id="waiverChk" ${l.waiver_signed?"checked":""}> The student/child has signed the waiver
        </label>
        <button class="btn" id="waiverSave" style="margin-top:12px;">Save waiver status</button>
      </div>`:""}
      ${(l.status==="Approved"||l.status==="Released"||l.agreement_status!=="none")?`
      <div class="panel" style="border:2px solid ${l.agreement_status==="signed"?'var(--green)':l.agreement_status==="declined"?'#f1c9c5':'#e0b400'};">
        <h2>Loan agreement ${l.agreement_status==="signed"?'<span style="color:var(--green);font-size:13px;">✓ signed</span>':l.agreement_status==="declined"?'<span style="color:var(--red);font-size:13px;">declined</span>':'<span style="color:#9a7500;font-size:13px;">— awaiting employee signature</span>'}</h2>
        <div class="psub">Approver: <b>${esc(l.mgmt_approver||loanApprover(l))}</b> · This loan <b>cannot be released</b> until the employee signs the agreement.</div>
        ${l.agreement_status==="none"
          ? `<button class="btn" id="loanGenAgr" style="margin-top:10px;">Generate agreement</button>`
          : `<button class="btn ghost" id="loanViewAgr" style="margin-top:10px;">View agreement</button>
             ${l.agreement_status==="signed"
               ? `<div style="margin-top:10px;color:var(--green);font-weight:700;">✓ Signed by ${esc(l.agreement_signer||"")}${l.agreement_signed_at?(" · "+fmtDate(l.agreement_signed_at)):""}</div>${l.agreement_signature?`<img src="${esc(l.agreement_signature)}" alt="signature" style="max-height:80px;margin-top:6px;border:1px solid var(--line);border-radius:6px;background:#fff;">`:""}`
               : l.agreement_status==="declined"
                 ? `<div class="note" style="margin-top:10px;">Employee declined: ${esc(l.agreement_decline_reason||"no reason given")}</div>`
                 : `<label style="font-size:12px;font-weight:700;color:var(--muted);display:block;margin-top:12px;">Employee signing link — send this to the employee</label>
                    <div style="display:flex;gap:8px;margin-top:4px;"><input id="agrLink" readonly value="${esc(LOAN_SIGN_BASE+'?ref='+encodeURIComponent(l.loan_ref)+'&t='+encodeURIComponent(l.agreement_token||''))}" style="flex:1;padding:8px;border:1px solid var(--line);border-radius:8px;font-size:12px;">
                    <button class="btn" id="agrCopy" style="flex:none;">Copy</button></div>
                    <div class="psub" style="margin-top:6px;">They read &amp; sign on their phone (RA 8792). Once signed, release unlocks.</div>`}`}
      </div>`:""}
      <div class="panel">
        <h2>Status</h2>
        <div class="psub">Current: ${loanStatusPill(l.status)}</div>
        <textarea id="loanNotes" rows="2" placeholder="HR notes…" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;margin-top:8px;">${esc(l.hr_notes||"")}</textarea>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
          ${next?`<button class="btn" id="loanAdv">Advance → ${esc(next)}</button>`:""}
          ${l.status!=="Rejected"&&l.status!=="Released"?`<button class="btn ghost" id="loanRej" style="color:var(--red);border-color:#f1c9c5;">Reject</button>`:""}
          ${l.status==="Approved"?`<button class="btn" id="loanRel">Mark Released</button>`:""}
          <button class="btn ghost" id="loanClose" style="margin-left:auto;">Close</button>
        </div>
      </div>
    </div></div>`;
  $("#loanClose").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  const setLoan=async(patch)=>{ patch.hr_notes=document.getElementById("loanNotes").value; patch.updated_at=new Date().toISOString();
    const {error}=await sb.from("loans").update(patch).eq("id",l.id); if(error){alert(error.message);return;} await loadEmployees(); m.remove(); };
  const waiverBlocked=()=>{
    if(l.loan_type==="educational" && !l.waiver_signed){
      alert("Educational loan — the student/child's signed waiver is required before release.\n\nIn the Educational waiver panel: upload the signed waiver, tick “The student/child has signed the waiver”, Save, then release.");
      return true;
    }
    return false;
  };
  const agreementBlocked=()=>{
    if(l.agreement_status!=="signed"){
      alert("The loan agreement isn't signed yet.\n\nIn the “Loan agreement” panel, copy the employee's signing link and have them sign it. Once signed, you can release.");
      return true;
    }
    return false;
  };
  const approvePatch=()=>{ const approver=loanApprover(l); return { status:"Approved", mgmt_approver:approver, agreement_body:buildLoanAgreement(l,approver), agreement_token:newLoanToken(), agreement_status:"awaiting" }; };
  const adv=document.getElementById("loanAdv"); if(adv) adv.addEventListener("click",()=>{
    if(next==="Approved"){ setLoan(approvePatch()); return; }
    if(next==="Released"&&(waiverBlocked()||agreementBlocked())) return;
    setLoan({status:next});
  });
  const rel=document.getElementById("loanRel"); if(rel) rel.addEventListener("click",()=>{ if(waiverBlocked()||agreementBlocked()) return; setLoan({status:"Released"}); });
  const genAgr=document.getElementById("loanGenAgr"); if(genAgr) genAgr.addEventListener("click",()=>{ const approver=loanApprover(l); setLoan({mgmt_approver:approver,agreement_body:buildLoanAgreement(l,approver),agreement_token:newLoanToken(),agreement_status:"awaiting"}); });
  const viewAgr=document.getElementById("loanViewAgr"); if(viewAgr) viewAgr.addEventListener("click",()=>{ const w=window.open("","_blank"); if(w){ w.document.write(`<title>${esc(l.loan_ref)} — Loan Agreement</title><pre style="white-space:pre-wrap;font-family:-apple-system,sans-serif;font-size:14px;line-height:1.6;padding:28px;max-width:680px;margin:0 auto;color:#1F2A37;">${esc(l.agreement_body||"")}</pre>`); w.document.close(); } });
  const agrCopy=document.getElementById("agrCopy"); if(agrCopy) agrCopy.addEventListener("click",()=>{ const inp=document.getElementById("agrLink"); inp.select(); navigator.clipboard.writeText(inp.value).then(()=>{ agrCopy.textContent="Copied"; setTimeout(()=>agrCopy.textContent="Copy",1500); }); });
  const wSave=document.getElementById("waiverSave");
  if(wSave) wSave.addEventListener("click",async()=>{
    wSave.disabled=true; wSave.textContent="Saving…";
    const chk=document.getElementById("waiverChk").checked;
    const fi=document.getElementById("waiverFile"); let waiver_doc=l.waiver_doc||null;
    if(fi&&fi.files&&fi.files[0]){
      const f=fi.files[0];
      const path="waivers/"+l.loan_ref+"-"+Date.now().toString(36)+"-"+f.name.replace(/[^a-zA-Z0-9._-]+/g,"_").slice(0,80);
      const {error:upErr}=await sb.storage.from("loan-docs").upload(path,f,{upsert:true});
      if(upErr){ alert("Couldn't upload the waiver: "+upErr.message); wSave.disabled=false; wSave.textContent="Save waiver status"; return; }
      waiver_doc={path:path,name:f.name};
    }
    if(chk && !waiver_doc){ if(!confirm("No waiver file uploaded. Mark the waiver as signed anyway?")){ wSave.disabled=false; wSave.textContent="Save waiver status"; return; } }
    const {error}=await sb.from("loans").update({waiver_signed:chk,waiver_doc:waiver_doc,hr_notes:document.getElementById("loanNotes").value,updated_at:new Date().toISOString()}).eq("id",l.id);
    if(error){ alert(error.message); wSave.disabled=false; wSave.textContent="Save waiver status"; return; }
    await loadEmployees(); m.remove();
  });
  const rej=document.getElementById("loanRej"); if(rej) rej.addEventListener("click",()=>setLoan({status:"Rejected"}));
}
const isActive=(e)=>e.status==="Active";
const typePill=(e)=>{
  if(e.hire_source && e.hire_source!=="Direct") return `<span class="pill ag">${esc(e.hire_source)}</span>`;
  if(e.group_name==="Head Office"||e.group_name==="Warehouse") return `<span class="pill ho">${esc(e.group_name)}</span>`;
  return `<span class="pill di">Direct</span>`;
};
const statusPill=(s)=>{
  const m={"Active":"active","Separated":"closed","On Leave":"probation","AWOL":"awol","Suspended":"awol"};
  return `<span class="pill ${m[s]||'active'}">${esc(s||"—")}</span>`;
};

/* ---------- DASHBOARD (workforce intelligence) ---------- */
function chartRows(obj, max){
  const ents=Object.entries(obj).filter(([k])=>k&&k!=="—").sort((a,b)=>b[1]-a[1]);
  const mx=max||Math.max(1,...ents.map(e=>e[1]));
  return ents.map(([k,v])=>`<div class="barrow" style="margin:8px 0;">
    <div style="width:150px;font-size:13px;flex-shrink:0;">${esc(k)}</div>
    <div class="bartrack"><div class="bar" style="width:${Math.round(v/mx*100)}%"></div></div>
    <div style="width:42px;text-align:right;font-weight:800;font-size:13px;color:var(--green-dark);">${v}</div></div>`).join("");
}
function tenureYears(d){ if(!d) return null; const y=(Date.parse(d)); if(isNaN(y)) return null; return (Date.now()-y)/(365.25*24*3600*1000); }
const DASH_PANEL_LABELS=[
  ["Your pending tasks","Pending tasks"],["Waiting on others","Waiting on others"],
  ["Where we're lagging","Where we're lagging"],["Workforce composition","Workforce composition"],
  ["Store network","Store network"],["Store footprint","Store footprint"],["Merchandiser pay","Merchandiser pay"]
];
function dashHiddenKey(){ return "dashHidden:"+((CURRENT_USER&&CURRENT_USER.email)||"x"); }
function dashHidden(){ try{ return JSON.parse(localStorage.getItem(dashHiddenKey())||"[]"); }catch(e){ return []; } }
function dashWidgets(){
  const pg=document.getElementById("page-dashboard"); const out=[]; if(!pg) return out;
  const rowLabels=["People stats","Hiring stats","Merchandiser pay"];
  pg.querySelectorAll(".grid.kpis").forEach((row,i)=>{ const id="kpis"+i; row.dataset.w=id; out.push({id,label:rowLabels[i]||("Stats row "+(i+1))}); });
  pg.querySelectorAll(".panel").forEach(p=>{ const h=p.querySelector("h2"); if(!h) return;
    const t=(h.textContent||"").replace(/\s+/g," ").trim();
    const hit=DASH_PANEL_LABELS.find(([k])=>t.indexOf(k)===0);
    if(hit){ const id="p_"+hit[0].replace(/\W+/g,"").slice(0,14); p.dataset.w=id; out.push({id,label:hit[1]}); } });
  return out;
}
function applyDashPrefs(){ const h=dashHidden(); dashWidgets().forEach(w=>{ const el=document.querySelector('#page-dashboard [data-w="'+w.id+'"]'); if(el) el.style.display=h.includes(w.id)?"none":""; }); }
function customizeDash(){
  const widgets=dashWidgets(), h=dashHidden();
  let m=document.getElementById("dashCustModal"); if(!m){ m=document.createElement("div"); m.id="dashCustModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:360px;width:100%;padding:22px;max-height:80vh;overflow-y:auto;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:3px;">Customize your dashboard</h2>
    <div class="psub" style="margin-bottom:10px;">Tick what you want to see — saved to your login.</div>
    ${widgets.map(w=>`<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;padding:6px 0;"><input type="checkbox" data-wid="${w.id}" ${h.includes(w.id)?"":"checked"}> ${esc(w.label)}</label>`).join("")}
    <div style="display:flex;gap:10px;margin-top:14px;"><button class="btn ghost" id="dcCancel" style="flex:1;">Cancel</button><button class="btn" id="dcSave" style="flex:1;">Save</button></div>
  </div>`;
  m.addEventListener("click",e=>{ if(e.target===m) m.remove(); });
  document.getElementById("dcCancel").addEventListener("click",()=>m.remove());
  document.getElementById("dcSave").addEventListener("click",()=>{
    const hidden=[]; m.querySelectorAll("[data-wid]").forEach(cb=>{ if(!cb.checked) hidden.push(cb.dataset.wid); });
    try{ localStorage.setItem(dashHiddenKey(), JSON.stringify(hidden)); }catch(e){}
    m.remove(); applyDashPrefs();
  });
}
function renderDashboard(){
  const A=EMPLOYEES.filter(isActive);
  const hr=new Date().getHours(); const greet=hr<12?"Good morning":hr<18?"Good afternoon":"Good evening";
  const nm=(CURRENT_USER?.email||"").split("@")[0];
  const ho=A.filter(e=>e.group_name==="Head Office").length, wh=A.filter(e=>e.group_name==="Warehouse").length, rt=A.filter(e=>e.group_name==="Retail").length;
  const prob=A.filter(e=>e.contract_type==="Probationary").length, sep=EMPLOYEES.filter(e=>e.status==="Separated").length;
  const open=BRANCHES.filter(b=>b.status==="Open");
  const SCs=[...new Set(open.map(b=>b.sc).filter(x=>x&&x!=='Unassigned'))];
  const totAHC=open.reduce((s,b)=>s+b.ahc_stationary+b.ahc_reliever,0);
  const totCHC=open.reduce((s,b)=>s+chcFor(b.name),0);
  const merchDef=Math.max(0,totAHC-totCHC);
  const _openMR=MANPOWER.filter(o=>o.status==="Open"); const openSlots=_openMR.reduce((s,o)=>s+(Number(o.count_needed)||0),0), openStores=_openMR.length;
  // composition
  const byGroup={"Head Office":ho,"Warehouse":wh,"Retail":rt};
  const byDept={}; A.filter(e=>e.group_name==="Head Office").forEach(e=>{const d=e.department||"—";byDept[d]=(byDept[d]||0)+1;});
  const byArea={}; open.forEach(b=>{const a=b.area||"—";byArea[a]=(byArea[a]||0)+1;});
  const bySC={}; SCs.forEach(s=>bySC[s]=open.filter(b=>b.sc===s).length);
  const bySource={}; A.forEach(e=>{const s=e.hire_source||"Direct";bySource[s]=(bySource[s]||0)+1;});
  // merchandiser pay (Manning Sheet) — basic is reliable; company allowances (mostly Lead Disers) come from PayPlus
  const actDi=DISERS.filter(d=>(d.status||'').toLowerCase().startsWith('active'));
  const basics=actDi.filter(d=>d.basic_rate).map(d=>Number(d.basic_rate));
  const avgBasic=basics.length?Math.round(basics.reduce((a,b)=>a+b,0)/basics.length):0;
  const minBasic=basics.length?Math.min(...basics):0, maxBasic=basics.length?Math.max(...basics):0;
  const posBasic={}; actDi.filter(d=>d.basic_rate).forEach(d=>{const p=d.position||'—'; (posBasic[p]=posBasic[p]||[]).push(Number(d.basic_rate));});
  const posAvg={}; Object.entries(posBasic).forEach(([p,arr])=>{ posAvg[p]=Math.round(arr.reduce((a,b)=>a+b,0)/arr.length); });
  const promoAvg=posAvg["Promo Diser"]||0, leadAvg=posAvg["Lead"]||0;
  // tenure
  const ten=A.map(e=>tenureYears(e.hire_date)).filter(x=>x!=null);
  const avgTen=ten.length?(ten.reduce((a,b)=>a+b,0)/ten.length).toFixed(1):"—";
  const concession=open.filter(b=>b.category==="CN").length, coOp=open.filter(b=>b.category==="CO").length;
  const dAct=DISERS.filter(d=>(d.status||"").toLowerCase().startsWith("active")); // agency merchandisers come from the diser roster (hired_by), not employees.hire_source
  const agJellon=dAct.filter(d=>/jell/i.test(d.hired_by||"")).length, agMG=dAct.filter(d=>/^mg|m&g/i.test(d.hired_by||"")).length, agency=agJellon+agMG;
  const awol=EMPLOYEES.filter(e=>e.status==="AWOL").length;
  const phPipe=PREHIRE.filter(p=>!["HIRED","REJECTED"].includes(p.phase)).length;
  const phReady=PREHIRE.filter(p=>["HR_SIGNOFF","CONTRACT_SIGNING"].includes(p.phase)).length;
  const onbOpen=ONBOARDING.filter(c=>c.status!=="Complete").length;
  const onbTasksOpen=ONBTASKS.filter(t=>t.status!=="Done").length;
  const exitOpen=EXITCASES.filter(x=>x.overall_status!=="Complete").length;
  const CY=new Date().getFullYear();
  const compDue=COMPLIANCE.filter(c=>c.next_due_year===CY && !c.needs_verify).length;
  const compVerify=COMPLIANCE.filter(c=>c.needs_verify).length;
  // "Waiting on others" — items sent out / stuck with someone else (real data)
  const waiting=[];
  PREHIRE.filter(p=>p.phase==="CONTRACT_SIGNING").slice(0,2).forEach(p=>waiting.push({t:"Contract — "+p.full_name, d:"In the signature pipeline", go:"prehire"}));
  PREHIRE.filter(p=>p.phase==="RECRUITER_REVIEW").slice(0,2).forEach(p=>waiting.push({t:"Recruiter review — "+p.full_name, d:"Vetting / offer", go:"prehire"}));
  EXITCASES.filter(x=>x.overall_status!=="Complete").slice(0,2).forEach(x=>{const pend=EXIT_STAGES.filter(s=>x[s.s]==="Pending").length; waiting.push({t:"Exit sign-off — "+x.employee_name, d:pend+" department(s) still to clear", go:"exit"});});
  ONBOARDING.filter(c=>c.status!=="Complete").slice(0,2).forEach(c=>{const op=tasksFor(c.id).filter(t=>t.status!=="Done").length; waiting.push({t:"Onboarding — "+c.employee_name, d:op+" task(s) outstanding", go:"onboarding"});});
  try{ const _ev=evDueList(); const _evDue=_ev.filter(x=>x.bucket==="due"||x.bucket==="overdue"); if(_evDue.length) waiting.push({t:_evDue.length+" evaluation(s) due", d:"3rd/5th-month · regularization · annual", go:"evaluations"}); }catch(e){}
  { const _allow=allowedPages(); if(_allow){ for(let i=waiting.length-1;i>=0;i--){ if(_allow.indexOf(waiting[i].go)===-1) waiting.splice(i,1); } } }

  const pg=$("#page-dashboard");
  pg.innerHTML=`
    <div class="hello">
      <div class="hd">${new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}).toUpperCase()}</div>
      <div class="hh">${greet}, <span>${esc(nm)}.</span></div>
      <div class="hsub">Your whole workforce, live from the database — ${A.length} active people across ${open.length} stores.</div>
      <button class="btn ghost" id="dashCust" style="margin-top:10px;font-size:12.5px;padding:5px 12px;">Customize dashboard</button>
    </div>
    <div class="grid kpis">
      <div class="kpi" style="cursor:pointer;" onclick="go('employees')"><div class="k-l">Active Employees</div><div class="k-n">${A.length}</div><div class="k-break"><span>HO+WH<b>${ho+wh}</b></span><span>Retail<b>${rt}</b></span></div></div>
      <div class="kpi" style="cursor:pointer;" onclick="go('branches')"><div class="k-l">Agency Merchandisers</div><div class="k-n">${agency}</div><div class="k-break"><span>Jell-on<b>${agJellon}</b></span><span>M&amp;G<b>${agMG}</b></span></div></div>
      <div class="kpi warn" style="cursor:pointer;" onclick="go('employees')"><div class="k-l">On Probation</div><div class="k-n">${prob}</div><div class="k-s">regularization reviews ahead</div></div>
      <div class="kpi ${awol?'alert':''}" style="cursor:pointer;" onclick="go('employees')"><div class="k-l">AWOL Cases</div><div class="k-n">${awol}</div><div class="k-s">${awol?'NTE / due process':'none open'}</div></div>
    </div>
    <div class="grid kpis" style="margin-top:13px;">
      <div class="kpi" style="cursor:pointer;" onclick="go('prehire')"><div class="k-l">Pre-hire in Pipeline</div><div class="k-n">${phPipe}</div><div class="k-s">${phReady} ready for contract</div></div>
      <div class="kpi" style="cursor:pointer;" onclick="go('onboarding')"><div class="k-l">Onboarding in Progress</div><div class="k-n">${onbOpen}</div><div class="k-s">${onbTasksOpen} open tasks</div></div>
      <div class="kpi warn" style="cursor:pointer;" onclick="go('manning')"><div class="k-l">Open Positions</div><div class="k-n">${openSlots}</div><div class="k-s">${openStores} stores need staffing · ${totAHC} approved overall</div></div>
      <div class="kpi" style="cursor:pointer;" onclick="go('exit')"><div class="k-l">Exit Clearances Open</div><div class="k-n">${exitOpen}</div><div class="k-s">offboarding in progress</div></div>
    </div>

    <div class="two-col">
      <div class="panel" style="margin-top:0;">
        <h2>Your pending tasks <span class="count-tag">live · click to act</span></h2>
        <div class="psub">Computed from your data — most actionable first</div>
        ${phReady?`<div class="task" style="cursor:pointer;" onclick="go('prehire')"><div class="dot r"></div><div><div class="tt">${phReady} candidate(s) ready for contract / onboarding</div><div class="td">Move them into an onboarding case</div></div><div class="due r">hiring</div></div>`:''}
        ${onbTasksOpen?`<div class="task" style="cursor:pointer;" onclick="go('onboarding')"><div class="dot a"></div><div><div class="tt">${onbTasksOpen} open onboarding task(s)</div><div class="td">${onbOpen} case(s) in progress — bank, uniform, gov forms, Employee ID</div></div><div class="due a">onboarding</div></div>`:''}
        ${exitOpen?`<div class="task" style="cursor:pointer;" onclick="go('exit')"><div class="dot a"></div><div><div class="tt">${exitOpen} exit clearance(s) in progress</div><div class="td">Department sign-offs &amp; final-pay computation</div></div><div class="due a">offboarding</div></div>`:''}
        ${compVerify?`<div class="task" style="cursor:pointer;" onclick="go('compliance')"><div class="dot r"></div><div><div class="tt">${compVerify} trademark(s) past a deadline on file — verify with IPO records</div><div class="td">Renewal year has passed (e.g. SPYDER, AIRFLEX) — confirm renewed or lapsed</div></div><div class="due r">compliance</div></div>`:''}
        ${compDue?`<div class="task" style="cursor:pointer;" onclick="go('compliance')"><div class="dot a"></div><div><div class="tt">${compDue} trademark deadline(s) due ${CY}</div><div class="td">DAU filings &amp; renewals — missing a DAU can cancel the mark</div></div><div class="due a">compliance</div></div>`:''}
        <div class="task" style="cursor:pointer;" onclick="go('employees')"><div class="dot a"></div><div><div class="tt">${prob} employees on probation</div><div class="td">3rd / 5th-month evaluations &amp; regularization reviews</div></div><div class="due a">review</div></div>
        <div class="task" style="cursor:pointer;" onclick="go('manning')"><div class="dot a"></div><div><div class="tt">Merchandiser headcount gap to verify</div><div class="td">${openSlots} positions open across ${openStores} stores (from manning) · ${SCs.length} SCs</div></div><div class="due a">staffing</div></div>
      </div>
      <div>
        <div class="panel" style="margin-top:0;">
          <h2>Waiting on others <span class="count-tag">nudge</span></h2>
          <div class="psub">Sent out — now stuck with someone else</div>
          ${waiting.length? waiting.map(w=>`<div class="nudge-item"><div class="ni"><div class="nt">${esc(w.t)}</div><div class="nd">${esc(w.d)}</div></div><button class="nbtn" onclick="event.stopPropagation();this.textContent='Nudged ✓';this.style.background='#1E3A5F';this.style.color='#fff';go('${w.go}')">Nudge</button></div>`).join("")
            : '<div class="psub" style="margin-top:8px;">Nothing waiting on anyone right now. ✓</div>'}
        </div>
        <div class="panel">
          <h2>Where we're lagging</h2>
          <div class="psub">Open items by work area</div>
          <div class="team-row"><div class="tn">Pre-hire pipeline</div>${phReady?`<span class="mini bad">${phReady} ready</span>`:''}<span class="mini ok">${phPipe} open</span></div>
          <div class="team-row"><div class="tn">Onboarding</div><span class="mini ok">${onbTasksOpen} tasks</span></div>
          <div class="team-row"><div class="tn">Exit clearances</div><span class="mini ${exitOpen?'bad':'ok'}">${exitOpen} open</span></div>
          <div class="team-row"><div class="tn">Probation reviews</div><span class="mini ok">${prob} due</span></div>
          <div class="team-row"><div class="tn">Merchandiser staffing</div><span class="mini ok">${totAHC} approved</span><span class="mini ${openSlots?'bad':'ok'}">${openSlots} open positions</span></div>
          <div class="team-row" style="cursor:pointer;" onclick="go('compliance')"><div class="tn">Compliance (IPO)</div>${compVerify?`<span class="mini bad">${compVerify} verify</span>`:''}<span class="mini ${compDue?'bad':'ok'}">${compDue} due ${CY}</span></div>
        </div>
        <div class="panel">
          <h2>Workforce composition</h2>
          <div class="psub">Active staff by group</div>
          ${chartRows(byGroup)}
        </div>
      </div>
    </div>

    <div class="two-col">
      <div class="panel" style="margin-top:0;">
        <h2>Store network by Sales Coordinator</h2>
        <div class="psub">Number of open (operating) stores each SC covers — store count, not headcount</div>
        ${chartRows(bySC)}
      </div>
      <div class="panel" style="margin-top:0;">
        <h2>Store footprint by region</h2>
        <div class="psub">Open stores per area</div>
        ${chartRows(byArea)}
      </div>
    </div>

    <div class="two-col">
      <div class="panel" style="margin-top:0;">
        <h2>Head Office by department</h2>
        <div class="psub">${ho} head-office staff across ${Object.keys(byDept).length} departments</div>
        ${chartRows(byDept)}
      </div>
      <div class="panel" style="margin-top:0;">
        <h2>Merchandiser pay <span class="count-tag">daily basic</span></h2>
        <div class="psub">Basic daily rate across ${basics.length} merchandisers (Manning Sheet)</div>
        <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
          <div class="kpi"><div class="k-l">Avg Basic</div><div class="k-n">₱${avgBasic.toLocaleString()}</div><div class="k-s">₱${minBasic.toLocaleString()}–₱${maxBasic.toLocaleString()}</div></div>
          <div class="kpi"><div class="k-l">Promo Diser</div><div class="k-n">₱${promoAvg.toLocaleString()}</div><div class="k-s">avg basic</div></div>
          <div class="kpi"><div class="k-l">Lead Diser</div><div class="k-n">₱${leadAvg.toLocaleString()}</div><div class="k-s">higher basic + allowances</div></div>
        </div>
        <div class="task" style="margin-top:10px;"><div class="dot a"></div><div><div class="tt">Company allowances (COLA / SOLA / SA / LA) — mostly for Lead Disers</div><div class="td">Not reliably recorded in the Manning Sheet, so they're not in the totals above. The actual per-person allowance comes from <b>PayPlus</b> once connected.</div></div></div>
      </div>
    </div>`;
  const dc=document.getElementById("dashCust"); if(dc) dc.addEventListener("click",customizeDash);
  applyDashPrefs();
}
/* legacy KPI-only updater (unused, kept for safety) */
function renderDashboardKPIs(){
  const A=EMPLOYEES.filter(isActive);
  const ho=A.filter(e=>e.group_name==="Head Office").length;
  const wh=A.filter(e=>e.group_name==="Warehouse").length;
  const rt=A.filter(e=>e.group_name==="Retail").length;
  const _dA=DISERS.filter(d=>(d.status||"").toLowerCase().startsWith("active")); const agJ=_dA.filter(d=>/jell/i.test(d.hired_by||"")).length, agM=_dA.filter(d=>/^mg|m&g/i.test(d.hired_by||"")).length; const ag=agJ+agM;
  const prob=A.filter(e=>e.contract_type==="Probationary").length;
  const sep=EMPLOYEES.filter(e=>e.status==="Separated").length;
  const grids=$$("#page-dashboard .kpis");
  if(grids[0]) grids[0].innerHTML=`
    <div class="kpi"><div class="k-l">Total Employees</div><div class="k-n">${A.length}</div><div class="k-s">Head Office ${ho} · Warehouse ${wh} · Retail ${rt}</div></div>
    <div class="kpi"><div class="k-l">Agency Merchandisers</div><div class="k-n">${ag}</div><div class="k-break"><span>Jell-on<b>${agJ}</b></span><span>M&amp;G<b>${agM}</b></span></div></div>
    <div class="kpi warn"><div class="k-l">On Probation</div><div class="k-n">${prob}</div><div class="k-s">probationary contracts</div></div>
    <div class="kpi"><div class="k-l">Separated (records)</div><div class="k-n">${sep}</div><div class="k-s">past employees retained</div></div>`;
  if(grids[1]) grids[1].innerHTML=`
    <div class="kpi"><div class="k-l">Retail / Merchandisers</div><div class="k-n">${rt}</div><div class="k-s">active in stores</div></div>
    <div class="kpi"><div class="k-l">Worksites</div><div class="k-n">${new Set(A.filter(e=>e.worksite).map(e=>e.worksite)).size}</div><div class="k-s">with active staff</div></div>
    <div class="kpi"><div class="k-l">Head Office + Warehouse</div><div class="k-n">${ho+wh}</div><div class="k-s">internal staff</div></div>
    <div class="kpi"><div class="k-l">Departments</div><div class="k-n">${new Set(A.map(e=>e.department).filter(Boolean)).size}</div><div class="k-s">across the company</div></div>`;
  // greeting
  const hh=$("#page-dashboard .hello .hh");
  if(hh){ const hr=new Date().getHours(); const g=hr<12?"Good morning":hr<18?"Good afternoon":"Good evening"; const nm=(CURRENT_USER?.email||"").split("@")[0];
    hh.innerHTML=`${g}, <span>${esc(nm)}.</span>`; }
  const hsub=$("#page-dashboard .hello .hsub"); if(hsub) hsub.textContent="Here is your workforce at a glance — live from the database.";
}

/* ---------- EMPLOYEES ---------- */
function renderEmployeesPage(){
  const A=EMPLOYEES.filter(isActive);
  const ho=A.filter(e=>e.group_name==="Head Office").length;
  const wh=A.filter(e=>e.group_name==="Warehouse").length;
  const rt=A.filter(e=>e.group_name==="Retail").length;
  const _dA=DISERS.filter(d=>(d.status||"").toLowerCase().startsWith("active")); const agJ=_dA.filter(d=>/jell/i.test(d.hired_by||"")).length, agM=_dA.filter(d=>/^mg|m&g/i.test(d.hired_by||"")).length; const ag=agJ+agM;
  const prob=A.filter(e=>e.contract_type==="Probationary").length;
  const panel=$("#page-employees .panel"); if(!panel) return;
  panel.innerHTML=`
    <h2>Employee Master</h2>
    <div class="psub">${EMPLOYEES.length} records · ${A.length} active · click any row to open the record</div>
    <div class="actionbar">
      <button class="btn blue" id="exportEmp">Export CSV</button>
    </div>
    <div class="psub" style="margin:-2px 0 8px;">🔒 Employees can't be added here. A new employee is created only through <b>hire → onboarding</b> and confirmed against PayPlus attendance — this prevents ghost employees.</div>
    <div class="grid kpis" style="grid-template-columns:repeat(5,1fr);">
      <div class="kpi"><div class="k-l">Active</div><div class="k-n">${A.length}</div></div>
      <div class="kpi"><div class="k-l">Head Office</div><div class="k-n">${ho}</div></div>
      <div class="kpi"><div class="k-l">Warehouse</div><div class="k-n">${wh}</div></div>
      <div class="kpi"><div class="k-l">Retail</div><div class="k-n">${rt}</div></div>
      <div class="kpi"><div class="k-l">On Probation</div><div class="k-n">${prob}</div></div>
    </div>
    <div class="filterbar" id="empChips">
      ${["All","Head Office","Warehouse","Retail","Agency"].map(c=>`<div class="chip${c===empFilter?' active':''}" data-f="${c}">${c}</div>`).join("")}
    </div>
    <input id="empSearch" class="search" style="width:100%;margin-bottom:12px;" placeholder="Search name, position, worksite, department…">
    <table>
      <thead><tr><th>Name</th><th>Job Title</th><th>Department</th><th>Worksite</th><th>Source</th><th>Type</th><th>Status</th></tr></thead>
      <tbody id="empRows"></tbody>
    </table>
    <div id="empCount" style="font-size:12px;color:var(--muted);margin-top:10px;"></div>`;
  const _addEmp=$("#addEmp"); if(_addEmp) _addEmp.addEventListener("click",()=>openForm(null)); // free-hand add removed (anti-ghost control); creation only via hire→onboarding→PayPlus
  $("#exportEmp").addEventListener("click",exportCSV);
  $$("#empChips .chip").forEach(c=>c.addEventListener("click",()=>{ empFilter=c.dataset.f; renderEmployeesPage(); }));
  $("#empSearch").addEventListener("input",paintEmpRows);
  paintEmpRows();
}
function empMatchesFilter(e){
  if(empFilter==="All") return true;
  if(empFilter==="Agency") return e.hire_source&&e.hire_source!=="Direct";
  return e.group_name===empFilter;
}
function hireSourceBadge(e){ const s=(e.hire_source||"").toLowerCase();
  if(!s||s==="payplus") return '<span class="note">—</span>';
  if(s==="direct") return '<span class="pill active">Direct</span>';
  if(/jell/.test(s)) return '<span class="pill di">Jell-on</span>';
  if(/mg|m&g/.test(s)) return '<span class="pill di">M&amp;G</span>';
  if(/smi/.test(s)) return '<span class="pill di">SMI</span>';
  return `<span class="pill di">${esc(e.hire_source)}</span>`;
}
function paintEmpRows(){
  const q=($("#empSearch")?.value||"").trim().toLowerCase();
  const list=EMPLOYEES.filter(e=>{
    if(!empMatchesFilter(e)) return false;
    if(q){ const hay=[e.full_name,e.position,e.department,e.worksite,e.agency_name,e.email].join(" ").toLowerCase(); if(!hay.includes(q)) return false; }
    return true;
  });
  const rows=$("#empRows"); if(!rows) return;
  rows.innerHTML=list.slice(0,400).map((e,i)=>`
    <tr class="clickable" data-idx="${EMPLOYEES.indexOf(e)}">
      <td><b>${esc(e.full_name)}</b></td><td>${esc(e.position||"—")}</td><td>${esc(e.department||"—")}</td>
      <td>${esc(e.worksite||"—")}</td><td>${hireSourceBadge(e)}</td><td>${typePill(e)}</td><td>${statusPill(e.status)}</td></tr>`).join("");
  $("#empCount").textContent=`Showing ${Math.min(list.length,400)} of ${list.length} matching · ${EMPLOYEES.length} total`;
  $$("#empRows tr").forEach(tr=>tr.addEventListener("click",()=>openRecord(EMPLOYEES[+tr.dataset.idx])));
}
function exportCSV(){
  const cols=["full_name","department","position","worksite","group_name","hire_source","status","contract_type","email","phone","hire_date"];
  const head=cols.join(",");
  const body=EMPLOYEES.map(e=>cols.map(c=>`"${(e[c]==null?"":String(e[c])).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([head+"\n"+body],{type:"text/csv"}); const u=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=u; a.download="rcc-employees.csv"; a.click(); URL.revokeObjectURL(u);
}

/* ---------- EMPLOYEE RECORD (full page) ---------- */
function f(label,val,who){ const blank=val==null||val===""; return `<div class="efield"><div class="el">${label}</div><div class="ev${blank?'':''}">${blank?'<span class="note">—</span>':esc(val)}</div><div class="em">${who||''}</div></div>`; }
const TAGHR='<span class="tag-s hr">HR</span>', TAGEMP='<span class="tag-s emp">Employee</span>', TAGAUTO='<span class="tag-s auto">Auto</span>';
function sec(n,title,rows){ return `<div class="esec${n===1?' first':''}"><div class="esec-h"><span class="esec-n">${n}</span><span class="esec-t">${title}</span></div>${rows}</div>`; }
function openRecord(e){
  if(!e) return;
  const initials=(e.full_name||"?").split(/[ ,]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  const pg=$("#page-employee");
  pg.innerHTML=`
    <div class="erec-bar"><span class="back" id="recBack">← Back to Employee Master</span></div>
    <div class="panel" style="margin-top:0;">
      <div class="emp-head">
        <div class="emp-av">${esc(initials)}</div>
        <div style="flex:1;"><div class="en">${esc(e.full_name)}</div>
          <div class="em">${esc(e.position||"—")} · ${esc(e.department||"—")} · ${esc(e.group_name||"—")}${e.hire_source?(" · "+esc(e.hire_source)):""}</div></div>
        ${typePill(e)} ${statusPill(e.status)}
        <button class="btn" id="recEdit" style="margin-left:6px;">Edit</button>
      </div>
      ${sec(1,"Identity &amp; Status",
        f("PayPlus ID",e.employee_id,TAGHR)+f("Group",e.group_name,TAGAUTO)+f("Hire Source",e.hire_source,TAGAUTO)+(e.agency_name?f("Agency",e.agency_name,TAGAUTO):"")+f("Status",e.status,TAGHR))}
      ${sec(2,"Personal Details",
        f("Email",e.email,TAGEMP)+f("Mobile",e.phone,TAGEMP)+f("Date of Birth",e.date_of_birth?fmtDate(e.date_of_birth):"",TAGEMP)+f("Gender",e.gender,TAGEMP)+f("Civil Status",e.civil_status,TAGEMP)+f("Permanent Address",e.permanent_address,TAGEMP)+f("Current Address",e.current_address,TAGEMP))}
      ${sec(3,"Emergency Contact",
        f("Name",e.emergency_contact_name,TAGEMP)+f("Relationship",e.emergency_contact_relation,TAGEMP)+f("Contact Number",e.emergency_contact_number,TAGEMP))}
      ${canSeePay()?sec(4,"Government Numbers",
        f("SSS",e.sss_number,TAGHR)+f("PhilHealth",e.philhealth_number,TAGHR)+f("Pag-IBIG",e.pagibig_number,TAGHR)+f("TIN",e.tin_number,TAGHR))
        :sec(4,"Government Numbers",`<div class="efield"><div class="ev"><span class="note">🔒 Restricted — visible to authorised payroll only</span></div></div>`)}
      ${canSeePay()?sec(5,"Bank",
        f("Bank Name",e.bank_name,TAGAUTO)+f("Account Number",e.bank_account_number,TAGHR))
        :sec(5,"Bank",`<div class="efield"><div class="ev"><span class="note">🔒 Restricted — visible to authorised payroll only</span></div></div>`)}
      ${sec(6,"Placement",
        f("Department",e.department,TAGHR)+f("Position",e.position,TAGHR)+f("Worksite",e.worksite,TAGHR)+f("Supervisor",e.supervisor_name,TAGHR)+f("Approver 2",e.approver2_name||e.approver2_email,TAGAUTO))}
      ${sec(7,"Employment Terms, Pay &amp; Dates",
        f("Contract Type",e.contract_type,TAGHR)
        +(canSeePay()
          ? f("Daily Rate",e.daily_rate?("₱"+Number(e.daily_rate).toLocaleString()):"",TAGHR)+f("Daily Allowance",e.daily_allowance?("₱"+Number(e.daily_allowance).toLocaleString()):"",TAGHR)
          : `<div class="efield"><div class="el">Pay</div><div class="ev"><span class="note">🔒 Restricted — payroll only</span></div></div>`)
        +f("Hire Date",e.hire_date?fmtDate(e.hire_date):"",TAGHR)+f("Regularization Date",e.regularization_date?fmtDate(e.regularization_date):"",TAGHR)+f("End Date",e.end_date?fmtDate(e.end_date):"",TAGHR)+f("End Reason",e.end_reason,TAGHR))}
      ${e.notes?sec(8,"Notes",`<div style="font-size:13.5px;white-space:pre-wrap;padding:4px 8px;">${esc(e.notes)}</div>`):""}
    </div>`;
  window.go("employee");
  $("#recBack").addEventListener("click",()=>window.go("employees"));
  $("#recEdit").addEventListener("click",()=>openForm(e));
}

/* ---------- WORKSITES (Branches page) — real store list from Branch Directory ---------- */
const catPill=(c)=> c==="CN"?'<span class="pill cn">Concession</span>':(c==="CO"?'<span class="pill co">Company-Op</span>':'<span class="pill ho">'+esc(c||"—")+'</span>');
const statusBranchPill=(s)=> s==="Open"?'<span class="pill open">Open</span>':'<span class="pill closed">Closed</span>';
const disersAt=(store)=> DISERS.filter(d=>d.store===store && (d.status||"").toLowerCase().startsWith("active"));
const chcFor=(store)=> disersAt(store).length;

/* ---------- STORE DRILL-DOWN (drawer) ---------- */
function diserSourceBadge(h){ const x=(h||"").toLowerCase();
  const lbl=/jell/.test(x)?"Jell-on":(/(^|[^a-z])(mg|m&g)/.test(x)?"M&G":(/smi/.test(x)?"SMI":(/rcc|direct/.test(x)?"Direct":"—")));
  if(lbl==="—") return '<span class="note">—</span>';
  return `<span class="pill ${lbl==="Direct"?"active":"di"}">${lbl}</span>`;
}
function storeForm(b){
  const isNew=!b; b=b||{};
  let m=document.getElementById("stModal"); if(!m){ m=document.createElement("div"); m.id="stModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;padding:22px;max-height:90vh;overflow-y:auto;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:10px;">${isNew?"Add a store":"Edit store"}</h2>
    ${fld("st_name","Store name *",b.name)}
    <div class="form-grid">${fld("st_city","City",b.city)}${fld("st_area","Area",b.area)}</div>
    ${fld("st_sc","Sales Coordinator",b.sc)}
    <div class="form-grid">${sel("st_cat","Type",["CO","CN"],b.category||"CO")}${sel("st_status","Status",["Open","Closed","No Manning","Pending"],b.status||"Open")}</div>
    <div class="form-grid">${fld("st_ahcs","Approved stationary",b.ahc_stationary??0,"number")}${fld("st_ahcr","Approved reliever",b.ahc_reliever??0,"number")}</div>
    <div class="psub" style="margin:2px 0 6px;">CO = Company Store · CN = Concession. Approved headcount = how many this store should have.</div>
    <div id="stMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
    <div style="display:flex;gap:10px;"><button class="btn ghost" id="stCancel" style="flex:1;">Cancel</button><button class="btn" id="stSave" style="flex:1;">${isNew?"Add store":"Save"}</button></div>
  </div>`;
  m.addEventListener("click",e=>{ if(e.target===m) m.remove(); });
  document.getElementById("stCancel").addEventListener("click",()=>m.remove());
  document.getElementById("stSave").addEventListener("click",async()=>{
    const name=v("st_name"); if(!name){ document.getElementById("stMsg").textContent="Store name is required."; return; }
    const payload={ name, city:v("st_city"), area:v("st_area"), sc:v("st_sc"), category:v("st_cat"), status:v("st_status"),
      ahc_stationary:nv("st_ahcs")||0, ahc_reliever:nv("st_ahcr")||0 };
    const btn=document.getElementById("stSave"); btn.disabled=true; btn.textContent="Saving…";
    let res, newId=b.id;
    if(isNew){ res=await sb.from("branches").insert(payload).select().single(); newId=res.data&&res.data.id; }
    else res=await sb.from("branches").update(payload).eq("id",b.id);
    if(res.error){ document.getElementById("stMsg").textContent=res.error.message; btn.disabled=false; btn.textContent=isNew?"Add store":"Save"; return; }
    if(isNew){ await logChange("branch",newId,name,"Added","Approved "+payload.ahc_stationary+" stationary · "+payload.ahc_reliever+" reliever · SC "+(payload.sc||"—")); }
    else { const ch=[];
      if((b.ahc_stationary||0)!=payload.ahc_stationary||(b.ahc_reliever||0)!=payload.ahc_reliever) ch.push("Approved "+(b.ahc_stationary||0)+"/"+(b.ahc_reliever||0)+" → "+payload.ahc_stationary+"/"+payload.ahc_reliever);
      if((b.sc||"")!=(payload.sc||"")) ch.push("SC "+(b.sc||"—")+" → "+(payload.sc||"—"));
      if((b.status||"")!=(payload.status||"")) ch.push("Status "+(b.status||"—")+" → "+payload.status);
      if((b.name||"")!=name) ch.push("Renamed "+(b.name||"")+" → "+name);
      await logChange("branch",b.id,name,"Edited", ch.length?ch.join(" · "):"Details updated"); }
    m.remove(); const sm=document.getElementById("storeModal"); if(sm) sm.remove(); await loadEmployees(); window.go("manning");
  });
}
window.storeForm=storeForm;
function openStore(b){
  const here=disersAt(b.name).sort((a,c)=>(a.name||"").localeCompare(c.name||""));
  const ahc=(b.ahc_stationary||0)+(b.ahc_reliever||0); const chc=here.length; const def=Math.max(0,ahc-chc);
  let m=document.getElementById("storeModal"); if(!m){ m=document.createElement("div"); m.id="storeModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:600px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;">
      <div style="font-size:21px;font-weight:800;">${esc(b.name)}</div>
      <div style="font-size:12.5px;opacity:.9;margin-top:3px;">${esc(b.city||"")}${b.area?" · "+esc(b.area):""} · SC: ${esc(b.sc||"—")} · ${b.category==="CN"?"Concession":"Company-Operated"} · ${esc(b.status||"")}</div>
    </div>
    <div style="padding:18px 22px 60px;">
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi"><div class="k-l">Approved (AHC)</div><div class="k-n">${ahc}</div><div class="k-s">${b.ahc_stationary||0} stationary · ${b.ahc_reliever||0} reliever</div></div>
        <div class="kpi"><div class="k-l">Confirmed (CHC)</div><div class="k-n">${chc}</div><div class="k-s">on file</div></div>
        <div class="kpi ${def>0?'alert':''}"><div class="k-l">Shortfall</div><div class="k-n">${def}</div></div>
      </div>
      <div class="panel" style="margin-top:14px;">
        <h2>Merchandisers at this store <span class="count-tag">${here.length}</span></h2>
        <div class="psub">From your Manning Sheet · live placement completes when PayPlus connects</div>
        ${here.length? `<table><thead><tr><th>Name</th><th>Source</th><th>Type</th><th>Position</th>${canSeePay()?'<th>Daily Rate</th>':''}<th>Status</th></tr></thead>
          <tbody>${here.map(d=>`<tr><td><b>${esc(d.name)}</b><div style="font-size:11px;color:var(--muted);">${esc(d.emp_no||"")}</div></td>
            <td>${diserSourceBadge(d.hired_by)}</td>
            <td>${esc(d.diser_type||"—")}</td><td>${esc(d.position||"—")}</td>
            ${canSeePay()?`<td>${d.total_rate?("₱"+Number(d.total_rate).toLocaleString()):"—"}</td>`:''}
            <td><span class="pill ${(d.status||'').includes('Probation')?'probation':'active'}">${esc(d.status||"—")}</span></td></tr>`).join("")}</tbody></table>`
          : `<div class="placeholder" style="padding:30px;"><p>No current merchandiser placement on file for this store.<br>Live placement comes through the PayPlus connection.</p></div>`}
      </div>
      ${(()=>{ const h=CHANGE_LOG.filter(c=>c.entity==='branch'&&String(c.entity_id)===String(b.id)).slice(0,8); return h.length?`<div class="panel" style="margin-top:14px;"><h2>Change log <span class="count-tag">${h.length}</span></h2>${h.map(c=>`<div class="task" style="align-items:flex-start;"><div style="flex:1;"><div class="tt">${esc(c.action)}${c.detail?` — ${esc(c.detail)}`:""}</div><div class="td">${esc(c.changed_by||"")} · ${c.created_at?fmtDate(c.created_at):""}</div></div></div>`).join("")}</div>`:""; })()}
      <div style="display:flex;gap:10px;margin-top:14px;">
        <button class="btn" id="storeEdit">Edit store</button>
        <button class="btn ghost" id="storeToggle" style="color:${b.status==='Closed'?'var(--green-dark)':'var(--red)'};border-color:#e2e7e4;">${b.status==='Closed'?'Reopen store':'Close store'}</button>
        <button class="btn ghost" id="storeClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  document.getElementById("storeClose").addEventListener("click",()=>m.remove());
  document.getElementById("storeEdit").addEventListener("click",()=>storeForm(b));
  document.getElementById("storeToggle").addEventListener("click",async()=>{
    const closing=b.status!=="Closed"; const ns=closing?"Closed":"Open";
    let reason="";
    if(closing){ reason=prompt("Close "+b.name+"? Give a brief reason (this is logged):",""); if(reason===null) return; }
    const {error}=await sb.from("branches").update({status:ns}).eq("id",b.id);
    if(error){ alert(error.message); return; }
    await logChange("branch",b.id,b.name, closing?"Closed":"Reopened", reason||null);
    m.remove(); await loadEmployees(); window.go("manning");
  });
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
}
function renderBranchesPage(){
  const pg=$("#page-branches");
  const open=BRANCHES.filter(b=>b.status==="Open");
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Worksites — every store</h2>
      <div class="psub">${BRANCHES.length} stores · ${open.length} open · each broken out individually, with its Sales Coordinator</div>
      <div class="grid kpis" style="grid-template-columns:repeat(4,1fr);">
        <div class="kpi"><div class="k-l">Open Stores</div><div class="k-n">${open.length}</div></div>
        <div class="kpi"><div class="k-l">Concession</div><div class="k-n">${open.filter(b=>b.category==="CN").length}</div></div>
        <div class="kpi"><div class="k-l">Company-Operated</div><div class="k-n">${open.filter(b=>b.category==="CO").length}</div></div>
        <div class="kpi"><div class="k-l">Sales Coordinators</div><div class="k-n">${new Set(open.map(b=>b.sc).filter(x=>x&&x!=='Unassigned')).size}</div></div>
      </div>
      <input id="wsSearch" class="search" style="width:100%;margin:10px 0;" placeholder="Search store, city, SC…">
      <table>
        <thead><tr><th>Store</th><th>Sales Coordinator</th><th>City · Area</th><th>Type</th><th>Status</th><th>Approved HC</th></tr></thead>
        <tbody id="wsRows"></tbody>
      </table>
      <div id="wsCount" style="font-size:12px;color:var(--muted);margin-top:10px;"></div>
    </div>`;
  const paint=()=>{
    const q=($("#wsSearch").value||"").trim().toLowerCase();
    const shown=BRANCHES.filter(b=>!q || [b.name,b.city,b.sc,b.area].join(" ").toLowerCase().includes(q))
      .sort((a,b)=> (a.status===b.status?0:(a.status==="Open"?-1:1)) || a.name.localeCompare(b.name));
    $("#wsRows").innerHTML=shown.map((b,i)=>`
      <tr class="clickable" data-bi="${BRANCHES.indexOf(b)}"><td><b>${esc(b.name)}</b></td><td>${esc(b.sc||"—")}</td><td>${esc(b.city||"—")}${b.area?" · "+esc(b.area):""}</td>
      <td>${catPill(b.category)}</td><td>${statusBranchPill(b.status)}</td>
      <td><span class="pill di">${b.ahc_stationary}</span> stationary${b.ahc_reliever?` · ${b.ahc_reliever} reliever`:""}</td></tr>`).join("");
    $("#wsCount").textContent=`${shown.length} of ${BRANCHES.length} stores · click a store to see its merchandisers`;
    $$("#wsRows tr").forEach(tr=>tr.addEventListener("click",()=>openStore(BRANCHES[+tr.dataset.bi])));
  };
  $("#wsSearch").addEventListener("input",paint); paint();
}

/* ---------- MANNING / HEADCOUNT — grouped by Sales Coordinator ---------- */
/* ============================ SIGNATURES — sign-this inbox (RA 8792 prototype) ============================ */
const SIG_ICON={contract:"contract",advance:"advance",memo:"memo",coe:"contract",claim:"advance"};
const sigInitial=s=>((s.subject_name||s.doc_title||"?").trim()[0]||"?").toUpperCase();
function fmtAgo(d){ if(!d) return ""; const h=(Date.now()-new Date(d).getTime())/36e5; if(h<1) return "just now"; if(h<24) return Math.round(h)+"h ago"; const dd=Math.round(h/24); return dd+(dd===1?" day ago":" days ago"); }
function sigParts(){
  const pend=SIGNATURES.filter(s=>s.awaiting==="you"&&s.status==="pending");
  const oth=SIGNATURES.filter(s=>s.awaiting==="other"&&s.status==="pending");
  const signed=SIGNATURES.filter(s=>s.status==="signed").sort((a,b)=>new Date(b.signed_at||0)-new Date(a.signed_at||0));
  const now=new Date();
  const signedMonth=signed.filter(s=>s.signed_at&&new Date(s.signed_at).getMonth()===now.getMonth()&&new Date(s.signed_at).getFullYear()===now.getFullYear());
  let avg="—"; const durs=signed.filter(s=>s.signed_at&&s.created_at).map(s=>(new Date(s.signed_at)-new Date(s.created_at))/36e5).filter(h=>h>=0);
  if(durs.length){ const h=durs.reduce((a,b)=>a+b,0)/durs.length; avg=h<48?Math.max(1,Math.round(h))+"h":Math.round(h/24)+"d"; }
  return {pend,oth,signed,signedMonth,avg};
}
function renderSignatures(){
  const pg=$("#page-signatures"); if(!pg) return;
  const {pend,oth,signed,signedMonth,avg}=sigParts();
  const nb=document.querySelector('.nav-item[data-page="signatures"] .nav-badge'); if(nb) nb.textContent=pend.length;
  const row=(s)=>`<div class="sigrow"><div class="sigicon ${SIG_ICON[s.doc_type]||'memo'}">${esc(sigInitial(s))}</div>
    <div class="sigbody"><div class="sig-t">${esc(s.doc_title)}${s.subject_name?" — "+esc(s.subject_name):""}</div>
      <div class="sig-m">From ${esc(s.from_name||"HR")}${s.amount?" · ₱"+Number(s.amount).toLocaleString():""}${s.meta?" · "+esc(s.meta):" · sent "+fmtAgo(s.created_at)}</div></div>
    <button class="btn" data-sign="${esc(s.id)}">Review &amp; Sign</button></div>`;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Signatures</h2>
      <div class="psub">Your sign-this inbox. RA 8792 compliant · works on mobile + personal email · every signature audit-logged. One place for contracts, memos, advance releases, claim authorizations.</div>
      <div class="grid kpis" style="grid-template-columns:repeat(4,1fr);">
        <div class="kpi alert clickable" data-jump="pendPanel" style="cursor:pointer;"><div class="k-l">Pending Your Signature</div><div class="k-n">${pend.length}</div></div>
        <div class="kpi warn clickable" data-jump="othPanel" style="cursor:pointer;"><div class="k-l">Sent — Awaiting Others</div><div class="k-n">${oth.length}</div></div>
        <div class="kpi clickable" data-jump="histPanel" style="cursor:pointer;"><div class="k-l">Signed This Month</div><div class="k-n">${signedMonth.length}</div></div>
        <div class="kpi"><div class="k-l">Avg. Sign Time</div><div class="k-n">${avg}</div></div>
      </div>
    </div>
    <div class="two-col">
      <div class="panel" style="margin-top:0;" id="pendPanel">
        <h2>Pending your signature <span class="count-tag">${pend.length}</span></h2>
        <div class="psub">Open each, review the document, sign.</div>
        ${pend.length?pend.map(row).join(""):'<div class="psub">Nothing waiting on you right now. 🎉</div>'}
      </div>
      <div>
        <div class="panel" style="margin-top:0;" id="othPanel">
          <h2>Sent — waiting on others <span class="count-tag">${oth.length}</span></h2>
          <div class="psub">Things you sent, now with someone else.</div>
          ${oth.length?oth.map(s=>`<div class="nudge-item"><div class="ni"><div class="nt">${esc(s.doc_title)}${s.subject_name?" — "+esc(s.subject_name):""}</div><div class="nd">With ${esc(s.with_whom||"—")} · ${fmtAgo(s.created_at)}</div></div><button class="nbtn" data-nudge="${esc(s.id)}">Nudge</button></div>`).join(""):'<div class="psub">Nothing pending with others.</div>'}
        </div>
        <div class="panel" id="histPanel">
          <h2>History <span class="count-tag">${signed.length}</span></h2>
          <div class="psub">Signed documents · audit log (signer + timestamp).</div>
          ${signed.length?signed.slice(0,12).map(s=>`<div class="task"><div class="dot g"></div><div><div class="tt">${esc(s.doc_title)}${s.subject_name?" — "+esc(s.subject_name):""}</div><div class="td">Signed ${s.signed_at?fmtDate(s.signed_at):""}${s.signer_name?" · by "+esc(s.signer_name):""}</div></div></div>`).join(""):'<div class="psub">No signed documents yet.</div>'}
        </div>
      </div>
    </div>`;
  $$('#page-signatures [data-sign]').forEach(b=>b.addEventListener("click",()=>openSignDoc(b.dataset.sign)));
  $$('#page-signatures [data-jump]').forEach(c=>c.addEventListener("click",()=>{ const el=document.getElementById(c.dataset.jump); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); }));
  $$('#page-signatures [data-nudge]').forEach(b=>b.addEventListener("click",()=>{ b.textContent="Reminded ✓"; b.disabled=true; }));
}
function openSignDoc(id){
  const s=SIGNATURES.find(x=>String(x.id)===String(id)); if(!s) return;
  let m=document.getElementById("sigModal"); if(!m){ m=document.createElement("div"); m.id="sigModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:10001;background:rgba(14,30,50,.55);display:flex;align-items:center;justify-content:center;padding:20px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:92vh;overflow-y:auto;padding:22px;">
    <h2 style="font-size:18px;color:#1E3A5F;margin-bottom:2px;">${esc(s.doc_title)}${s.subject_name?" — "+esc(s.subject_name):""}</h2>
    <div class="psub">From ${esc(s.from_name||"HR")}${s.amount?" · ₱"+Number(s.amount).toLocaleString():""}${s.meta?" · "+esc(s.meta):""}</div>
    <div style="background:#f7f9fb;border:1px solid #E3E8EF;border-radius:10px;padding:14px 16px;margin:12px 0;white-space:pre-wrap;font-size:13.5px;line-height:1.6;max-height:34vh;overflow-y:auto;">${esc(s.body||"(document body)")}</div>
    <div style="font-size:12px;color:#6B7785;margin-bottom:6px;">Sign below — drawn with your finger or mouse. RA 8792 e-signature · timestamped + recorded against your account.</div>
    <canvas id="sigPad" width="500" height="150" style="width:100%;height:150px;border:1px dashed #b9c4cf;border-radius:10px;background:#fff;touch-action:none;cursor:crosshair;"></canvas>
    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
      <button class="btn ghost" id="sigClear" style="flex:0 0 auto;">Clear</button>
      <span id="sigMsg" style="font-size:12.5px;color:#a4322a;flex:1;"></span>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn ghost" id="sigDecline" style="color:#c0392b;border-color:#f1c9c5;">Decline</button>
      <button class="btn ghost" id="sigCancel" style="margin-left:auto;">Cancel</button>
      <button class="btn" id="sigDo">Sign document</button>
    </div></div>`;
  m.addEventListener("click",e=>{ if(e.target===m) m.remove(); });
  document.getElementById("sigCancel").onclick=()=>m.remove();
  const cv=document.getElementById("sigPad"), ctx=cv.getContext("2d"); let drawing=false, dirty=false;
  ctx.lineWidth=2.2; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.strokeStyle="#13243b";
  const pos=e=>{ const r=cv.getBoundingClientRect(), t=e.touches&&e.touches[0]?e.touches[0]:e; return {x:(t.clientX-r.left)*(cv.width/r.width), y:(t.clientY-r.top)*(cv.height/r.height)}; };
  const start=e=>{ drawing=true; dirty=true; const p=pos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); e.preventDefault(); };
  const move=e=>{ if(!drawing) return; const p=pos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); e.preventDefault(); };
  const end=()=>{ drawing=false; };
  cv.addEventListener("mousedown",start); cv.addEventListener("mousemove",move); window.addEventListener("mouseup",end);
  cv.addEventListener("touchstart",start,{passive:false}); cv.addEventListener("touchmove",move,{passive:false}); cv.addEventListener("touchend",end);
  document.getElementById("sigClear").onclick=()=>{ ctx.clearRect(0,0,cv.width,cv.height); dirty=false; document.getElementById("sigMsg").textContent=""; };
  document.getElementById("sigDo").onclick=async()=>{
    if(!dirty){ document.getElementById("sigMsg").textContent="Please draw your signature first."; return; }
    const btn=document.getElementById("sigDo"); btn.disabled=true; btn.textContent="Signing…";
    const signer=(CURRENT_USER&&(CURRENT_USER.email||CURRENT_USER.name))||"Signed-in user";
    const { error } = await sb.from("signature_requests").update({ status:"signed", signed_at:new Date().toISOString(), signer_name:signer, signature_data:cv.toDataURL("image/png"), updated_at:new Date().toISOString() }).eq("id",s.id);
    if(error){ document.getElementById("sigMsg").textContent=error.message; btn.disabled=false; btn.textContent="Sign document"; return; }
    m.remove(); await loadEmployees(); window.go("signatures");
  };
  document.getElementById("sigDecline").onclick=async()=>{
    const why=prompt("Reason for declining (optional):",""); if(why===null) return;
    const { error } = await sb.from("signature_requests").update({ status:"declined", decline_reason:why||null, updated_at:new Date().toISOString() }).eq("id",s.id);
    if(error){ alert(error.message); return; }
    m.remove(); await loadEmployees(); window.go("signatures");
  };
}
/* ============================ MEMOS & NOTICES (RCC letterhead · routed to Signatures) ============================ */
const MEMO_TYPES=[
  {k:"Written Warning", tmpl:(n,d,x)=>`WRITTEN WARNING\n\nTo: ${n}\n\nThis is a written warning regarding the following:\n${x||"[describe the matter]"}\n\nThis is a corrective measure to help you meet company standards — not a penalty. You may submit a written explanation within five (5) days of receipt. Related or repeated infractions may lead to further disciplinary action under due process.\n\nYour signature acknowledges RECEIPT only — it does not signify agreement.`},
  {k:"Notice to Explain (NTE)", tmpl:(n,d,x)=>`NOTICE TO EXPLAIN\n\nTo: ${n}\n\nIt has been reported that, on or about ${d||"[date]"}, the following occurred:\n${x||"[state the act/omission]"}\n\nThis may constitute a violation of company rules and/or the Labor Code. You are directed to submit a WRITTEN EXPLANATION within five (5) days of receipt as to why no disciplinary action should be taken against you. You may request a conference and be assisted by a representative of your choice.\n\nThis is the FIRST of the twin notices required by due process. No decision has been made at this stage.`},
  {k:"Notice of Decision", tmpl:(n,d,x)=>`NOTICE OF DECISION\n\nTo: ${n}\n\nAfter considering the Notice to Explain${d?" dated "+d:""} and your response (or your failure to respond within the period given), management's decision is as follows:\n${x||"[decision + basis]"}\n\nThis decision was reached after due process, weighing the facts and your explanation.`},
  {k:"Notice of Termination", tmpl:(n,d,x)=>`NOTICE OF TERMINATION\n\nTo: ${n}\n\nFollowing due process (twin notices and the opportunity to be heard), your employment with Roshan Commercial Corporation is terminated effective ${d||"[date]"} on the following ground:\n${x||"[just/authorized cause]"}\n\nFinal pay and your Certificate of Employment will be released in accordance with DOLE rules. Please complete the clearance process.`},
  {k:"Acceptance of Resignation", tmpl:(n,d,x)=>`ACCEPTANCE OF RESIGNATION\n\nTo: ${n}\n\nWe acknowledge and accept your resignation. Your last day of work is ${d||"[date]"}.\n${x||""}\n\nPlease complete the clearance process. Your final pay and Certificate of Employment will be released within the periods provided by DOLE. We thank you for your service.`},
  {k:"End of Contract", tmpl:(n,d,x)=>`NOTICE OF END OF CONTRACT\n\nTo: ${n}\n\nThis is to inform you that your fixed-term/probationary contract ends on ${d||"[date]"}.\n${x||""}\n\nThis is the natural expiration of your contract term, not a dismissal. Final pay and your Certificate of Employment will be processed accordingly.`},
  {k:"Certificate of Employment (COE)", tmpl:(n,d,x)=>`CERTIFICATE OF EMPLOYMENT\n\nThis is to certify that ${n} was employed by Roshan Commercial Corporation.\n${x||"[position held · dates of employment]"}\n\nIssued upon the employee's request for whatever legal purpose it may serve. (Per DOLE Labor Advisory No. 06-20, a COE states the dates of employment and position held, and is issued within three (3) days of request.)`},
  {k:"Custom memo", tmpl:(n,d,x)=>x||""}
];
function renderMemos(){
  const pg=$("#page-memos"); if(!pg) return;
  const M=MEMOS||[];
  const drafts=M.filter(m=>m.status==="Draft"), issued=M.filter(m=>m.status==="Issued"), signed=M.filter(m=>m.status==="Signed");
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Memos &amp; Notices</h2>
      <div class="psub">The 7 standard HR letters + a custom memo — generated on RCC letterhead, routed through Signatures, and logged. DOLE twin-notice flow: <b>NTE → (employee explains) → Notice of Decision</b>.</div>
      <div class="actionbar"><button class="btn" id="memoNew">+ New memo</button></div>
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi"><div class="k-l">Drafts</div><div class="k-n">${drafts.length}</div></div>
        <div class="kpi warn"><div class="k-l">Awaiting signature</div><div class="k-n">${issued.length}</div></div>
        <div class="kpi"><div class="k-l">Signed</div><div class="k-n">${signed.length}</div></div>
      </div>
    </div>
    <div class="panel"><h2>All memos <span class="count-tag">${M.length}</span></h2>
      ${M.length?`<table><thead><tr><th>Ref</th><th>Type</th><th>Employee</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>`+
        M.map(m=>`<tr><td>${esc(m.ref_no||"—")}</td><td>${esc(m.memo_type)}</td><td>${esc(m.subject_name||"—")}</td><td><span class="pill ${m.status==="Signed"?"active":(m.status==="Issued"?"awol":"")}">${esc(m.status)}</span></td><td>${m.created_at?fmtDate(m.created_at):""}</td>
          <td style="text-align:right;white-space:nowrap;"><button class="btn ghost" data-memoview="${esc(m.id)}">View</button>${m.status==="Draft"?` <button class="btn ghost" data-memoissue="${esc(m.id)}">Issue</button>`:""}</td></tr>`).join("")+
        `</tbody></table>`:'<div class="psub">No memos yet — click “New memo”.</div>'}
    </div>`;
  $("#memoNew").addEventListener("click",()=>newMemo());
  $$('#page-memos [data-memoview]').forEach(b=>b.addEventListener("click",()=>viewMemo(b.dataset.memoview)));
  $$('#page-memos [data-memoissue]').forEach(b=>b.addEventListener("click",()=>issueMemo(b.dataset.memoissue)));
}
function newMemo(){
  let m=document.getElementById("memoModal"); if(!m){ m=document.createElement("div"); m.id="memoModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,30,50,.5);display:flex;justify-content:flex-end;";
  const names=[...new Set(EMPLOYEES.map(e=>e.full_name).filter(Boolean))].sort();
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:600px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;"><div style="font-size:20px;font-weight:800;">New memo / notice</div><div style="font-size:12.5px;opacity:.85;">Generates DOLE-aware text on RCC letterhead. Edit before issuing.</div></div>
    <div style="padding:18px 22px;">
      <div class="panel" style="margin-top:0;">
        ${sel("mm_type","Memo type",MEMO_TYPES.map(t=>t.k),"")}
        ${sel("mm_emp","Employee",names,"")}
        ${fld("mm_date","Relevant date (incident / effective / last day)","","date")}
        <div style="margin:8px 0;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">Details / specifics</label><textarea id="mm_details" rows="3" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;" placeholder="The facts, ground, or specifics to weave into the letter"></textarea></div>
        <button class="btn ghost" id="mm_gen">↻ Generate letter text</button>
      </div>
      <div class="panel"><div class="subhead">Letter (renders on RCC letterhead) — editable</div>
        <textarea id="mm_body" rows="14" style="width:100%;padding:10px 12px;border:1px solid #e2e7e4;border-radius:8px;font-size:13px;line-height:1.5;font-family:ui-monospace,Menlo,monospace;"></textarea>
      </div>
      <div id="mmMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
      <div style="display:flex;gap:10px;"><button class="btn ghost" id="mm_cancel" style="flex:1;">Cancel</button><button class="btn ghost" id="mm_draft" style="flex:1;">Save draft</button><button class="btn" id="mm_issue" style="flex:1;">Issue for signature</button></div>
    </div></div>`;
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  document.getElementById("mm_cancel").onclick=()=>m.remove();
  const gen=()=>{ const t=MEMO_TYPES.find(x=>x.k===v("mm_type")); if(!t){ document.getElementById("mmMsg").textContent="Pick a memo type first."; return; } document.getElementById("mm_body").value=t.tmpl(v("mm_emp")||"[employee]", v("mm_date")||"", v("mm_details")||""); document.getElementById("mmMsg").textContent=""; };
  document.getElementById("mm_gen").onclick=gen;
  const save=async(issue)=>{
    const type=v("mm_type"); if(!type){ document.getElementById("mmMsg").textContent="Pick a memo type."; return; }
    let body=document.getElementById("mm_body").value.trim(); if(!body){ gen(); body=document.getElementById("mm_body").value.trim(); }
    const stamp=new Date().toISOString().slice(0,10).replace(/-/g,"");
    const ref="M-"+stamp+"-"+String(Math.abs((v("mm_emp")||type).split("").reduce((a,c)=>a*31+c.charCodeAt(0),7))%1000).padStart(3,"0");
    const row={ ref_no:ref, memo_type:type, subject_name:v("mm_emp"), title:type, body, relevant_date:v("mm_date"), status:"Draft", created_by:(CURRENT_USER&&CURRENT_USER.email)||"HR" };
    const { data, error } = await sb.from("memos").insert(row).select().single();
    if(error){ document.getElementById("mmMsg").textContent=error.message; return; }
    m.remove();
    if(issue){ await issueMemo(data.id, true); } else { await loadEmployees(); window.go("memos"); }
  };
  document.getElementById("mm_draft").onclick=()=>save(false);
  document.getElementById("mm_issue").onclick=()=>save(true);
}
async function issueMemo(id, skipConfirm){
  const m=(MEMOS.find(x=>String(x.id)===String(id)))||(await sb.from("memos").select("*").eq("id",id).single()).data;
  if(!m) return;
  if(!skipConfirm && !confirm("Issue this "+m.memo_type+" for "+(m.subject_name||"the employee")+"?\n\nIt will be sent to Signatures for the employee's acknowledgment and logged.")) return;
  const { data:sig, error:e1 } = await sb.from("signature_requests").insert({ doc_type:"memo", doc_title:m.memo_type, subject_name:m.subject_name, body:m.body, from_name:(CURRENT_USER&&CURRENT_USER.email)||"HR", awaiting:"other", with_whom:"Employee (acknowledgment)", status:"pending" }).select().single();
  if(e1){ alert(e1.message); return; }
  const { error:e2 } = await sb.from("memos").update({ status:"Issued", signature_request_id:sig.id, updated_at:new Date().toISOString() }).eq("id",m.id);
  if(e2){ alert(e2.message); return; }
  await loadEmployees(); window.go("memos");
}
function viewMemo(id){
  const m=MEMOS.find(x=>String(x.id)===String(id)); if(!m) return;
  let el=document.getElementById("memoView"); if(!el){ el=document.createElement("div"); el.id="memoView"; document.body.appendChild(el); }
  el.style.cssText="position:fixed;inset:0;z-index:10001;background:rgba(14,30,50,.55);display:flex;align-items:center;justify-content:center;padding:20px;";
  el.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:92vh;overflow-y:auto;padding:22px;">
    <h2 style="font-size:18px;color:#1E3A5F;margin-bottom:2px;">${esc(m.memo_type)}${m.subject_name?" — "+esc(m.subject_name):""}</h2>
    <div class="psub">${esc(m.ref_no||"")} · ${esc(m.status)}${m.created_at?" · "+fmtDate(m.created_at):""}</div>
    <div style="background:#fff;border:1px solid #E3E8EF;border-radius:10px;padding:16px 18px;margin:12px 0;white-space:pre-wrap;font-size:13.5px;line-height:1.6;">${esc(m.body||"")}</div>
    <div class="note">↳ This renders on RCC letterhead when printed/served. Twin-notice flow + counsel review apply for real disciplinary use.</div>
    <div style="display:flex;gap:10px;margin-top:14px;">${m.status==="Draft"?`<button class="btn" id="mvIssue">Issue for signature</button>`:""}<button class="btn ghost" id="mvClose" style="margin-left:auto;">Close</button></div>
  </div>`;
  el.addEventListener("click",e=>{ if(e.target===el) el.remove(); });
  document.getElementById("mvClose").onclick=()=>el.remove();
  const iv=document.getElementById("mvIssue"); if(iv) iv.onclick=()=>{ el.remove(); issueMemo(m.id); };
}
function renderManning(){
  const pg=$("#page-manning"); if(!pg) return;
  const open=BRANCHES.filter(b=>b.status==="Open");
  const SCs=[...new Set(open.map(b=>b.sc).filter(x=>x&&x!=='Unassigned'))].sort();
  const totAHC=open.reduce((s,b)=>s+b.ahc_stationary+b.ahc_reliever,0);
  const totCHC=open.reduce((s,b)=>s+chcFor(b.name),0);
  const OPENINGS=MANPOWER.filter(o=>o.status==="Open");
  const opInReview=(store)=>PREHIRE.filter(p=>p.worksite===store && !["HIRED","REJECTED","DRAFT"].includes(p.phase)).length;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Openings <span class="count-tag">${OPENINGS.length} stores · ${OPENINGS.reduce((s,o)=>s+(Number(o.count_needed)||0),0)} positions</span></h2>
      <div class="psub">Manpower requests you post. These drive the agency links — each agency sees the shortfall + an in-review count, then submits candidates into the pipeline.</div>
      <div class="actionbar"><button class="btn" id="opNew">+ Post opening</button> <button class="btn ghost" id="stNew">+ Add store</button></div>
      ${OPENINGS.length?`<table><thead><tr><th>Store</th><th>SC</th><th>Need</th><th>In review</th><th>Posted</th><th>Deadline</th><th></th></tr></thead><tbody id="opRows"></tbody></table>`:`<div class="psub" style="margin-top:6px;">No open requests yet — click “Post opening”.</div>`}
    </div>
    ${phLinksBar()}
    <div class="panel">
      <h2>Manning / Headcount <span class="count-tag">by Sales Coordinator</span></h2>
      <div class="psub">Every Sales Coordinator → their stores → approved vs. confirmed headcount. Store sales and live attendance plug in here once PayPlus and the sales system are connected.</div>
      <div class="grid kpis" style="grid-template-columns:repeat(4,1fr);">
        <div class="kpi"><div class="k-l">Sales Coordinators</div><div class="k-n">${SCs.length}</div></div>
        <div class="kpi"><div class="k-l">Open Stores</div><div class="k-n">${open.length}</div></div>
        <div class="kpi"><div class="k-l">Approved HC (AHC)</div><div class="k-n">${totAHC}</div></div>
        <div class="kpi warn"><div class="k-l">Confirmed HC (CHC)</div><div class="k-n">${totCHC}</div><div class="k-s">matched from active list</div></div>
      </div>
      <div class="filterbar" id="scChips">
        ${["All",...SCs].map(s=>`<div class="chip${s===scFilter?' active':''}" data-sc="${esc(s)}">${esc(s)}${s!=="All"?` (${open.filter(b=>b.sc===s).length})`:""}</div>`).join("")}
      </div>
      <div id="scBlocks"></div>
    </div>`;
  const opNewBtn=$("#opNew"); if(opNewBtn) opNewBtn.addEventListener("click",()=>openingForm());
  const stNewBtn=$("#stNew"); if(stNewBtn) stNewBtn.addEventListener("click",()=>storeForm());
  const opRows=$("#opRows");
  if(opRows){
    const today=new Date(new Date().toDateString());
    opRows.innerHTML=OPENINGS.map(o=>{
      const overdue=o.target_fill_date && new Date(o.target_fill_date+"T00:00:00")<today;
      let dl;
      if(o.priority==="Urgent"&&!o.target_fill_date) dl=`<span class="pill awol">Urgent</span>`;
      else if(o.target_fill_date) dl=`${fmtDate(o.target_fill_date)}${overdue?' <span class="pill awol">overdue</span>':''}`;
      else dl=`<span class="note">—</span>`;
      return `<tr><td><b>${esc(o.worksite)}</b></td><td>${esc(o.sc||"—")}</td><td>${o.count_needed}</td><td>${opInReview(o.worksite)}</td><td>${o.date_posted?fmtDate(o.date_posted):"—"}</td><td>${dl}</td>
        <td style="text-align:right;white-space:nowrap;"><button class="btn ghost" data-opedit="${o.id}">Edit</button> <button class="btn ghost" data-opclose="${o.id}" style="color:var(--red);border-color:#f1c9c5;">Close</button></td></tr>`;
    }).join("");
    $$("#opRows [data-opedit]").forEach(b=>b.addEventListener("click",()=>openingForm(MANPOWER.find(o=>o.id===b.dataset.opedit))));
    $$("#opRows [data-opclose]").forEach(b=>b.addEventListener("click",()=>closeOpening(MANPOWER.find(o=>o.id===b.dataset.opclose))));
  }
  const paint=()=>{
    const list=(scFilter==="All"?SCs:[scFilter]);
    $("#scBlocks").innerHTML=list.map(sc=>{
      const stores=open.filter(b=>b.sc===sc).sort((a,b)=>a.name.localeCompare(b.name));
      const ahc=stores.reduce((s,b)=>s+b.ahc_stationary+b.ahc_reliever,0);
      const chc=stores.reduce((s,b)=>s+chcFor(b.name),0);
      const def=Math.max(0,ahc-chc);
      return `<div class="panel" style="margin-top:14px;">
        <div class="sc-card">
          <div class="sc-av">${esc(sc[0])}</div>
          <div style="flex:1;"><div class="sc-l">Sales Coordinator</div><div class="sc-n">${esc(sc)}</div></div>
          <div style="text-align:center;"><div class="sc-l">Stores</div><div class="sc-n">${stores.length}</div></div>
          <div style="text-align:center;"><div class="sc-l">Approved</div><div class="sc-n">${ahc}</div></div>
          <div style="text-align:center;"><div class="sc-l">Confirmed</div><div class="sc-n">${chc}</div></div>
          <div style="text-align:center;"><div class="sc-l">Shortfall</div><div class="sc-n" style="color:${def>0?'var(--red)':'var(--green-dark)'}">${def}</div></div>
        </div>
        <table>
          <thead><tr><th>Store</th><th>City · Area</th><th>Type</th><th>AHC</th><th>CHC</th><th>Shortfall</th><th>Store Sales</th><th>Attendance</th></tr></thead>
          <tbody>${stores.map(b=>{
            const a=b.ahc_stationary+b.ahc_reliever, c=chcFor(b.name), d=Math.max(0,a-c);
            return `<tr class="clickable" data-bi="${BRANCHES.indexOf(b)}"><td><b>${esc(b.name)}</b></td><td>${esc(b.city||"—")}${b.area?" · "+esc(b.area):""}</td><td>${catPill(b.category)}</td>
              <td>${a}</td><td>${c}</td><td>${d>0?`<span class="pill awol">${d}</span>`:`<span class="pill active">0</span>`}</td>
              <td><span style="color:var(--muted);font-size:12px;">— PayPlus</span></td><td><span style="color:var(--muted);font-size:12px;">— PayPlus</span></td></tr>`;
          }).join("")}</tbody>
        </table>
      </div>`;
    }).join("");
    $$("#scBlocks tr.clickable").forEach(tr=>tr.addEventListener("click",()=>openStore(BRANCHES[+tr.dataset.bi])));
  };
  $$("#scChips .chip").forEach(c=>c.addEventListener("click",()=>{ scFilter=c.dataset.sc; renderManning(); }));
  paint();
}
function openingForm(o){
  const isNew=!o; o=o||{};
  const stores=[...new Set(BRANCHES.map(b=>b.name))].sort();
  let m=document.getElementById("opModal"); if(!m){ m=document.createElement("div"); m.id="opModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:22px;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:8px;">${isNew?"Post an opening":"Edit opening"}</h2>
    ${sel("op_store","Store *",stores,o.worksite)}
    ${fld("op_count","How many needed *",o.count_needed??1,"number")}
    ${sel("op_priority","Priority",["Normal","Urgent"],o.priority||"Normal")}
    ${fld("op_fill","Fill-by date (optional)",o.target_fill_date,"date")}
    <div class="psub" style="margin:-4px 0 8px;">Leave the date blank and set Priority = Urgent if it's just “needed now”.</div>
    <div id="opMsg" style="font-size:13px;color:#a4322a;margin:4px 0;"></div>
    <div style="display:flex;gap:10px;"><button class="btn ghost" id="opCancel" style="flex:1;">Cancel</button><button class="btn" id="opSave" style="flex:1;">${isNew?"Post opening":"Save"}</button></div>
  </div>`;
  m.addEventListener("click",e=>{ if(e.target===m) m.remove(); });
  document.getElementById("opCancel").addEventListener("click",()=>m.remove());
  document.getElementById("opSave").addEventListener("click",async()=>{
    const store=v("op_store"); if(!store){ document.getElementById("opMsg").textContent="Pick a store."; return; }
    const br=BRANCHES.find(b=>b.name===store);
    const payload={ worksite:store, sc:br?br.sc:null, count_needed:nv("op_count")||1, priority:v("op_priority")||"Normal",
      target_fill_date:v("op_fill")||null, status:"Open", updated_at:new Date().toISOString() };
    let res;
    if(isNew){ payload.date_posted=new Date().toISOString().slice(0,10); res=await sb.from("manpower_requests").insert(payload); }
    else res=await sb.from("manpower_requests").update(payload).eq("id",o.id);
    if(res.error){ document.getElementById("opMsg").textContent=res.error.message; return; }
    m.remove(); await loadEmployees();
  });
}
function closeOpening(o){
  if(!o) return;
  if(!confirm("Close the opening for "+o.worksite+"? It will stop showing on the agency links.")) return;
  sb.from("manpower_requests").update({status:"Filled", updated_at:new Date().toISOString()}).eq("id",o.id).then(async({error})=>{
    if(error){ alert(error.message); return; }
    await loadEmployees();
  });
}

/* ---------- GLOBAL SEARCH (topbar) ---------- */
function wireGlobalSearch(){
  const s=$(".topbar .search"); if(!s||s.dataset.wired) return; s.dataset.wired="1";
  s.addEventListener("input",()=>{ window.go("employees"); setTimeout(()=>{ const es=$("#empSearch"); if(es){ es.value=s.value; paintEmpRows(); } },20); });
}

/* ---------- ADD / EDIT FORM (modal) ---------- */
const DEPARTMENTS=["Accounting","Administration","E-Commerce","Finance","Human Resource","Inventory","Logistics","Marketing","MIS","Product","Production","Purchasing","Sales","Warehouse Solaris","Warehouse"];
const STATUSES=["Active","On Leave","AWOL","Suspended","Separated"];
const CONTRACT_TYPES=["Probationary","Regular","Project-Based","Seasonal/Fixed-Term","Casual","Agency"];
const HIRE_SOURCES=["Direct","Jell-on","M&G"];
const GENDERS=["Male","Female"]; const CIVIL=["Single","Married","Widowed","Separated","Annulled"];
const RELATIONS=["Spouse","Parent","Sibling","Child","Relative","Friend"];
const END_REASONS=["Resigned","Terminated","End of Contract","AWOL","Retired","Deceased","Other"];
const deriveGroup=(d)=> !d?"":(["Warehouse Solaris","Warehouse"].includes(d)?"Warehouse":(d==="Sales"?"Retail":"Head Office"));
const deriveBank=(g)=> g==="Retail"?"Union Bank":((g==="Head Office"||g==="Warehouse")?"China Bank":"");
function opt(arr,sel){ return ['<option value=""></option>'].concat(arr.map(o=>`<option ${o===sel?"selected":""}>${esc(o)}</option>`)).join(""); }
function fld(id,label,val,type){ return `<div style="margin-bottom:10px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">${label}</label><input id="${id}" type="${type||'text'}" value="${esc(val??"")}" style="width:100%;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;"></div>`; }
function sel(id,label,arr,val){ return `<div style="margin-bottom:10px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">${label}</label><select id="${id}" style="width:100%;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;background:#fff;">${opt(arr,val)}</select></div>`; }
function openForm(e){
  const isNew=!e; e=e||{};
  let m=document.getElementById("empModal");
  if(!m){ m=document.createElement("div"); m.id="empModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:560px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;">
      <div style="font-size:20px;font-weight:800;">${isNew?"Add Employee":"Edit Record"}</div>
      <div style="font-size:12.5px;opacity:.85;">${isNew?"New employee record":esc(e.full_name||"")}</div></div>
    <div style="padding:18px 22px 60px;">
      <div class="panel" style="margin-top:0;">
        ${fld("f_full_name","Full name *",e.full_name)}
        ${sel("f_department","Department",DEPARTMENTS,e.department)}
        ${fld("f_group_name","Group (auto)",e.group_name)}
        ${fld("f_position","Position",e.position)}
        ${sel("f_hire_source","Hire source",HIRE_SOURCES,e.hire_source)}
        ${sel("f_status","Status",STATUSES,e.status||"Active")}
        ${fld("f_employee_id","PayPlus ID",e.employee_id)}
        ${fld("f_agency_name","Agency name (if agency)",e.agency_name)}
      </div>
      <div class="panel">
        ${fld("f_email","Email",e.email,"email")}${fld("f_phone","Mobile (09XXXXXXXXX)",e.phone)}
        ${fld("f_date_of_birth","Date of birth",e.date_of_birth,"date")}${sel("f_gender","Gender",GENDERS,e.gender)}
        ${sel("f_civil_status","Civil status",CIVIL,e.civil_status)}
        ${fld("f_permanent_address","Permanent address",e.permanent_address)}${fld("f_current_address","Current address",e.current_address)}
      </div>
      <div class="panel">
        ${fld("f_emergency_contact_name","Emergency contact name",e.emergency_contact_name)}
        ${sel("f_emergency_contact_relation","Relationship",RELATIONS,e.emergency_contact_relation)}
        ${fld("f_emergency_contact_number","Emergency contact number",e.emergency_contact_number)}
      </div>
      ${canSeePay()?`<div class="panel">
        ${fld("f_sss_number","SSS",e.sss_number)}${fld("f_philhealth_number","PhilHealth",e.philhealth_number)}
        ${fld("f_pagibig_number","Pag-IBIG",e.pagibig_number)}${fld("f_tin_number","TIN",e.tin_number)}
        ${fld("f_bank_name","Bank name",e.bank_name)}${fld("f_bank_account_number","Bank account number",e.bank_account_number)}
      </div>`:`<div class="panel"><div style="font-size:13px;color:#6a766f;">🔒 Government IDs &amp; bank details are restricted to authorised payroll.</div></div>`}
      <div class="panel">
        ${fld("f_worksite","Worksite",e.worksite)}${fld("f_supervisor_name","Supervisor",e.supervisor_name)}${fld("f_approver2_name","Approver 2",e.approver2_name)}
        ${sel("f_contract_type","Contract type",CONTRACT_TYPES,e.contract_type)}
        ${canSeePay()?`${fld("f_daily_rate","Daily rate (₱)",e.daily_rate,"number")}${fld("f_daily_allowance","Daily allowance (₱)",e.daily_allowance,"number")}`:`<div style="margin-bottom:10px;font-size:13px;color:#6a766f;">🔒 Pay (daily rate / allowance) is restricted to authorised payroll.</div>`}
        ${fld("f_hire_date","Hire date",e.hire_date,"date")}${fld("f_regularization_date","Regularization date",e.regularization_date,"date")}
        ${fld("f_end_date","End date",e.end_date,"date")}${sel("f_end_reason","End reason",END_REASONS,e.end_reason)}
        <div style="margin-bottom:10px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:4px;">Notes</label><textarea id="f_notes" rows="3" style="width:100%;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;">${esc(e.notes||"")}</textarea></div>
      </div>
      <div id="fMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
      <div style="display:flex;gap:10px;">
        <button class="btn ghost" id="fCancel" style="flex:1;">Cancel</button>
        <button class="btn" id="fSave" style="flex:1;">${isNew?"Create":"Save changes"}</button>
      </div>
    </div></div>`;
  const dept=document.getElementById("f_department");
  dept.addEventListener("change",()=>{ const g=deriveGroup(dept.value); document.getElementById("f_group_name").value=g; const b=document.getElementById("f_bank_name"); if(b&&!b.value) b.value=deriveBank(g); });
  document.getElementById("fCancel").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  document.getElementById("fSave").addEventListener("click",()=>saveEmployee(isNew?null:e.id,m));
}
const v=(id)=>{ const el=document.getElementById(id); if(!el) return null; const x=el.value.trim(); return x===""?null:x; };
const nv=(id)=>{ const el=document.getElementById(id); if(!el) return null; const x=el.value.trim(); return x===""?null:Number(x); };
async function saveEmployee(id,modal){
  const msg=document.getElementById("fMsg"), btn=document.getElementById("fSave");
  let phone=v("f_phone"); if(phone) phone=phone.replace(/[\s-]/g,"");
  const p={ full_name:v("f_full_name"), department:v("f_department"), group_name:v("f_group_name")||deriveGroup(document.getElementById("f_department").value)||null,
    position:v("f_position"), hire_source:v("f_hire_source"), status:v("f_status")||"Active", employee_id:v("f_employee_id"), agency_name:v("f_agency_name"),
    email:v("f_email"), phone, date_of_birth:v("f_date_of_birth"), gender:v("f_gender"), civil_status:v("f_civil_status"),
    permanent_address:v("f_permanent_address"), current_address:v("f_current_address"),
    emergency_contact_name:v("f_emergency_contact_name"), emergency_contact_relation:v("f_emergency_contact_relation"), emergency_contact_number:v("f_emergency_contact_number"),
    worksite:v("f_worksite"), supervisor_name:v("f_supervisor_name"), approver2_name:v("f_approver2_name"),
    contract_type:v("f_contract_type"),
    hire_date:v("f_hire_date"), regularization_date:v("f_regularization_date"), end_date:v("f_end_date"), end_reason:v("f_end_reason"),
    notes:v("f_notes"), updated_at:new Date().toISOString() };
  // salary / bank / government IDs only written by an authorised payroll viewer — others never touch these columns
  if(canSeePay()){ Object.assign(p,{ sss_number:v("f_sss_number"), philhealth_number:v("f_philhealth_number"), pagibig_number:v("f_pagibig_number"), tin_number:v("f_tin_number"), bank_name:v("f_bank_name"), bank_account_number:v("f_bank_account_number"), daily_rate:nv("f_daily_rate"), daily_allowance:nv("f_daily_allowance") }); }
  if(!p.full_name){ msg.textContent="Full name is required."; return; }
  btn.disabled=true; btn.textContent="Saving…";
  const res=id? await sb.from("employees").update(p).eq("id",id) : await sb.from("employees").insert(p);
  btn.disabled=false; btn.textContent=id?"Save changes":"Create";
  if(res.error){ msg.textContent=res.error.message; return; }
  modal.remove(); await loadEmployees();
}

/* ============================ EVALUATIONS MODULE ============================ */
const EVAL_CRITERIA=["Quality of work","Attendance & punctuality","Attitude & teamwork","Job knowledge","Initiative & reliability"];
const EVAL_RECS={ "regularization":["Regularize","Extend probation","Do not regularize"], "3rd-month":["On track","Needs coaching","At risk"], "5th-month":["On track","Needs coaching","At risk"], "annual":["Exceeds expectations","Meets expectations","Below expectations"] };
const EVAL_LABEL={ "3rd-month":"3rd-month review","5th-month":"5th-month review","regularization":"Regularization","annual":"Annual review" };
function evAddMonths(d,n){ const x=new Date(d); const day=x.getDate(); x.setMonth(x.getMonth()+n); if(x.getDate()<day) x.setDate(0); return x; }
function evIso(d){ const p=n=>String(n).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); }
function evVal(id){ const el=document.getElementById(id); return el&&el.value.trim()!==""?el.value.trim():null; }
function evRecorded(empId,type,due){ return EVALUATIONS.some(e=>String(e.employee_ref)===String(empId)&&e.eval_type===type&&e.period_due&&Math.abs((new Date(e.period_due)-new Date(due))/86400000)<45); }
function evDueList(){
  const today=new Date(); today.setHours(0,0,0,0);
  const horizon=new Date(today); horizon.setDate(horizon.getDate()+60);
  const backstop=new Date(today); backstop.setMonth(backstop.getMonth()-4);
  const monthStart=new Date(today.getFullYear(),today.getMonth(),1);
  const out=[];
  EMPLOYEES.filter(e=>(e.status||"").toLowerCase().startsWith("active")&&e.hire_date).forEach(e=>{
    const hire=new Date(e.hire_date+"T00:00:00"); if(isNaN(hire)) return;
    const tenureMo=(today-hire)/(86400000*30.44);
    const cands=[];
    if(tenureMo<8){ cands.push(["3rd-month",evAddMonths(hire,3)]); cands.push(["5th-month",evAddMonths(hire,5)]); cands.push(["regularization",evAddMonths(hire,6)]); }
    if(tenureMo>=11){ let ann=new Date(today.getFullYear(),hire.getMonth(),hire.getDate()); if(ann<backstop) ann=new Date(today.getFullYear()+1,hire.getMonth(),hire.getDate()); cands.push(["annual",ann]); }
    cands.forEach(([type,due])=>{
      if(due<backstop||due>horizon) return;
      if(evRecorded(e.id,type,due)) return;
      const overdue=due<monthStart, thisMonth=due.getFullYear()===today.getFullYear()&&due.getMonth()===today.getMonth();
      out.push({emp:e,type,due:evIso(due),bucket:overdue?"overdue":(thisMonth?"due":"upcoming")});
    });
  });
  out.sort((a,b)=>a.due<b.due?-1:1);
  return out;
}
function renderEvaluations(){
  const pg=$("#page-evaluations"); if(!pg) return;
  const list=evDueList();
  const due=list.filter(x=>x.bucket==="due"), overdue=list.filter(x=>x.bucket==="overdue"), upcoming=list.filter(x=>x.bucket==="upcoming");
  const noHire=EMPLOYEES.filter(e=>(e.status||"").toLowerCase().startsWith("active")&&!e.hire_date).length;
  const card=(l,n)=>`<div class="kpi"><div class="k-l">${l}</div><div class="k-n">${n}</div></div>`;
  const itemRow=(x)=>`<div class="task" style="cursor:pointer;align-items:center;" onclick="openEvalForm('${x.emp.id}','${x.type}','${x.due}')">
      <div class="dot ${x.bucket==='overdue'?'r':(x.bucket==='due'?'a':'g')}"></div>
      <div style="flex:1;min-width:0;"><div class="tt">${esc(x.emp.full_name)}</div><div class="td">${EVAL_LABEL[x.type]} · ${esc(x.emp.position||x.emp.department||"")}</div></div>
      <div style="text-align:right;flex-shrink:0;"><div style="font-size:12px;font-weight:700;color:${x.bucket==='overdue'?'#c0392b':'#6a766f'};">${fmtDate(x.due)}</div><button class="btn ghost" style="padding:4px 10px;font-size:12px;margin-top:3px;">Record</button></div></div>`;
  const section=(title,arr,empty)=>`<div class="panel"><h2>${title} <span class="count-tag">${arr.length}</span></h2>${arr.length?arr.map(itemRow).join(""):`<div class="psub">${empty}</div>`}</div>`;
  const recent=EVALUATIONS.slice(0,10).map(e=>`<div class="task" style="align-items:center;"><div class="dot g"></div><div style="flex:1;"><div class="tt">${esc(e.employee_name||"")}</div><div class="td">${EVAL_LABEL[e.eval_type]||e.eval_type} · ${esc(e.recommendation||"")}${e.overall_rating?` · ${e.overall_rating}/5`:""}</div></div><div style="font-size:12px;color:#6a766f;flex-shrink:0;">${e.eval_date?fmtDate(e.eval_date):""}${e.evaluator?`<div style="font-size:10.5px;">${esc(e.evaluator)}</div>`:""}</div></div>`).join("");
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Evaluations</h2>
      <div class="psub">Computed from each employee's <b>hire date</b> — 3rd &amp; 5th-month probationary reviews, the 6-month regularization decision, and annual reviews.${noHire?` <span style="color:#9a6a00;">⚠ ${noHire} active staff have no hire date yet — upload the hires list to include them.</span>`:""}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px;">${card("Due this month",due.length)}${card("Overdue",overdue.length)}${card("Upcoming 60d",upcoming.length)}${card("Completed",EVALUATIONS.length)}</div>
    </div>
    ${section("Due this month",due,"Nothing due this month.")}
    ${overdue.length?section("Overdue — needs attention",overdue,""):""}
    ${section("Upcoming (next 60 days)",upcoming,"Nothing upcoming.")}
    ${EVALUATIONS.length?`<div class="panel"><h2>Recently completed</h2>${recent}</div>`:""}`;
}
function openEvalForm(empId,type,due){
  const e=EMPLOYEES.find(x=>String(x.id)===String(empId)); if(!e) return;
  const recs=EVAL_RECS[type]||["Meets expectations"];
  let m=document.getElementById("evalModal"); if(!m){ m=document.createElement("div"); m.id="evalModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  const ratingSel=(id)=>`<select id="${id}" style="padding:6px 9px;border:1px solid var(--line);border-radius:7px;font-size:13px;background:#fff;"><option value="">—</option>${[5,4,3,2,1].map(n=>`<option value="${n}">${n} — ${["","Poor","Fair","Good","Very good","Excellent"][n]}</option>`).join("")}</select>`;
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:560px;height:100%;overflow-y:auto;">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;">
      <div style="font-size:20px;font-weight:800;">${esc(e.full_name)}</div>
      <div style="font-size:12.5px;opacity:.9;">${EVAL_LABEL[type]} · due ${fmtDate(due)} · ${esc(e.position||e.department||"")}</div>
    </div>
    <div style="padding:18px 22px 60px;">
      <div class="panel" style="margin-top:0;"><h2>Ratings</h2>
        ${EVAL_CRITERIA.map((c,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--line);"><span style="font-size:13.5px;">${c}</span>${ratingSel("ev_r"+i)}</div>`).join("")}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0 2px;"><span style="font-size:13.5px;font-weight:700;">Overall</span>${ratingSel("ev_overall")}</div>
      </div>
      <div class="panel"><h2>Recommendation</h2>
        <select id="ev_rec" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:#fff;">${recs.map(r=>`<option>${r}</option>`).join("")}</select>
        <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin:12px 0 4px;">Strengths</label><textarea id="ev_str" rows="2" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;font-size:13.5px;"></textarea>
        <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin:10px 0 4px;">Areas to improve</label><textarea id="ev_imp" rows="2" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;font-size:13.5px;"></textarea>
        <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin:10px 0 4px;">Evaluator</label><input id="ev_by" value="${esc((CURRENT_USER&&CURRENT_USER.email)||'')}" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;font-size:13.5px;">
        <div id="evMsg" style="font-size:13px;color:#a4322a;margin:8px 0;"></div>
        <div style="display:flex;gap:10px;"><button class="btn" id="evSave">Save evaluation</button><button class="btn ghost" id="evClose" style="margin-left:auto;">Close</button></div>
      </div>
    </div></div>`;
  $("#evClose").addEventListener("click",()=>m.remove());
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  $("#evSave").addEventListener("click",async()=>{
    const btn=$("#evSave"); btn.disabled=true; btn.textContent="Saving…";
    const ratings={}; EVAL_CRITERIA.forEach((c,i)=>{ const val=document.getElementById("ev_r"+i).value; if(val) ratings[c]=Number(val); });
    const ov=document.getElementById("ev_overall").value;
    const row={ employee_ref:e.id, employee_name:e.full_name, position:e.position||e.department||null, eval_type:type, period_due:due,
      overall_rating: ov?Number(ov):null, ratings, recommendation:document.getElementById("ev_rec").value,
      strengths:evVal("ev_str"), improvements:evVal("ev_imp"), evaluator:evVal("ev_by"), eval_date:evIso(new Date()) };
    const {error}=await sb.from("evaluations").insert(row);
    if(error){ document.getElementById("evMsg").textContent=error.message; btn.disabled=false; btn.textContent="Save evaluation"; return; }
    m.remove(); await loadEmployees();
  });
}
window.openEvalForm=openEvalForm;

/* ============================ PRE-HIRE MODULE ============================ */
const PH_PHASES=[
  {key:"APPLIED",label:"Applied",actor:"Recruiter / applicant"},
  {key:"SCREENING",label:"Screening",actor:"Recruiter"},
  {key:"DOCUMENTS",label:"Documents",actor:"Candidate + HR"},
  {key:"RECRUITER_REVIEW",label:"Recruiter Review",actor:"Recruiter · incl. offer"},
  {key:"HR_SIGNOFF",label:"HR Sign-off",actor:"HR"},
  {key:"CONTRACT_SIGNING",label:"Contract Signing",actor:"Contracts module"},
  {key:"HIRED",label:"Hired",actor:"— becomes Employee"}
];
const phLabel=(k)=> (PH_PHASES.find(p=>p.key===k)||{}).label || (k==="REJECTED"?"Rejected":k);
const srcPill=(s)=> s&&s!=="Direct" ? `<span class="pill ag">${esc(s)}</span>` : `<span class="pill di">Direct</span>`;

const SHARE_BASE="https://agenovi.github.io/rcc-hris-portal/";
function phLinksBar(){
  const links=[
    {l:"Direct applicants — apply link", s:"Public · share anywhere", u:SHARE_BASE+"direct-apply.html"},
    {l:"Agency · Jell-on", s:"Private · send only to Jell-on", u:SHARE_BASE+"agency.html?t=3a28000c77be400f97c1d2e36c9b416e"},
    {l:"Agency · M&G", s:"Private · send only to M&G", u:SHARE_BASE+"agency.html?t=60fc360932f049dd851131dccbd185af"},
    {l:"Employee loan application", s:"Public · Head Office &amp; Warehouse staff", u:SHARE_BASE+"loan-apply.html"},
    {l:"Candidate feedback — experience survey", s:"Send to applicants after their interview / decision", u:SHARE_BASE+"feedback.html"}
  ];
  return `<div style="background:#eef4ef;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-top:12px;">
    <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Share these links</div>
    ${links.map(x=>`<div style="display:flex;align-items:center;gap:10px;padding:5px 0;">
      <div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;">${esc(x.l)} <span style="font-weight:400;color:var(--muted);font-size:11.5px;">${esc(x.s)}</span></div></div>
      <button class="btn ghost" data-copy="${esc(x.u)}" style="flex-shrink:0;">Copy</button>
      <a class="btn ghost" href="${esc(x.u)}" target="_blank" rel="noopener" style="flex-shrink:0;text-decoration:none;">Open</a>
    </div>`).join("")}
  </div>`;
}
function renderPrehire(){
  const pg=$("#page-prehire"); if(!pg) return;
  const inPipe=PREHIRE.filter(p=>p.phase!=="HIRED"&&p.phase!=="REJECTED");
  const docs=PREHIRE.filter(p=>p.phase==="DOCUMENTS").length;
  const ready=PREHIRE.filter(p=>p.phase==="HR_SIGNOFF").length;
  const rejected=PREHIRE.filter(p=>p.phase==="REJECTED").length;
  const bySrc=(s)=>inPipe.filter(p=>(s==="Direct"?(!p.hire_source||p.hire_source==="Direct"):p.hire_source===s)).length;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Pre-hire &amp; Recruiting</h2>
      <div class="psub">Applicant pipeline — from application through screening, documents, and into a contract. This module carries its own architecture &amp; data model (tabs below).</div>
      <div class="actionbar">
        <button class="btn" id="phNew">+ New Application</button>
        <button class="btn blue" id="phExport">Export CSV</button>
      </div>
      ${phLinksBar()}
      <div class="grid kpis" style="grid-template-columns:repeat(4,1fr);">
        <div class="kpi" data-gopipe="1" style="cursor:pointer;user-select:none;"><div class="k-l">In Pipeline ▸</div><div class="k-n">${inPipe.length}</div>
          <div class="k-break">${[["","All",inPipe.length],["Direct","Direct",bySrc("Direct")],["Jell-on","Jell-on",bySrc("Jell-on")],["M&G","M&amp;G",bySrc("M&G")]].map(a=>`<span data-psrc="${a[0]}" style="cursor:pointer;user-select:none;${(prehireSrc||"")===a[0]?'background:#dbe7f0;border-radius:7px;':''}">${a[1]}<b>${a[2]}</b></span>`).join("")}</div></div>
        <div class="kpi warn"><div class="k-l">Documents</div><div class="k-n">${docs}</div><div class="k-s">awaiting uploads</div></div>
        <div class="kpi"><div class="k-l">HR Sign-off</div><div class="k-n">${ready}</div><div class="k-s">ready for contract</div></div>
        <div class="kpi ${rejected?'':''}"><div class="k-l">Rejected</div><div class="k-n">${rejected}</div><div class="k-s">pipeline closed</div></div>
      </div>
      <div class="tabs" id="phTabs" style="margin-top:14px;">
        <div class="tab ${prehireTab==='pipeline'?'active':''}" data-t="pipeline">Pipeline</div>
        <div class="tab ${prehireTab==='funnel'?'active':''}" data-t="funnel">Recruitment Funnel</div>
        <div class="tab ${prehireTab==='arch'?'active':''}" data-t="arch">How it works (Architecture)</div>
        <div class="tab ${prehireTab==='data'?'active':''}" data-t="data">Data model</div>
        <div class="tab ${prehireTab==='feedback'?'active':''}" data-t="feedback">Candidate Feedback</div>
      </div>
      <div id="phBody"></div>
    </div>`;
  $("#phNew").addEventListener("click",newPrehire);
  $$("#page-prehire [data-copy]").forEach(b=>b.addEventListener("click",()=>{ navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copy); const t=b.textContent; b.textContent="Copied ✓"; setTimeout(()=>b.textContent=t,1200); }));
  $("#phExport").addEventListener("click",()=>{
    const cols=["prehire_id","full_name","phase","position","department","hire_source","worksite","contract_type","daily_rate","email"];
    const csv=cols.join(",")+"\n"+PREHIRE.map(p=>cols.map(c=>`"${(p[c]==null?"":String(p[c])).replace(/"/g,'""')}"`).join(",")).join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="prehire.csv";a.click();
  });
  $$("#phTabs .tab").forEach(t=>t.addEventListener("click",()=>{ prehireTab=t.dataset.t; renderPrehire(); }));
  $$("#page-prehire [data-psrc]").forEach(el=>el.addEventListener("click",(ev)=>{ ev.stopPropagation(); prehireSrc=(prehireSrc===el.dataset.psrc?null:el.dataset.psrc); prehireTab="pipeline"; renderPrehire(); const pb=document.getElementById("phBody"); if(pb) pb.scrollIntoView({behavior:"smooth",block:"start"}); }));
  $$("#page-prehire [data-gopipe]").forEach(el=>el.addEventListener("click",()=>{ prehireSrc=null; prehireTab="pipeline"; renderPrehire(); const pb=document.getElementById("phBody"); if(pb) pb.scrollIntoView({behavior:"smooth",block:"start"}); }));
  if(prehireTab==="arch") phBodyArch();
  else if(prehireTab==="data") phBodyData();
  else if(prehireTab==="feedback") phBodyFeedback();
  else if(prehireTab==="funnel") phBodyFunnel();
  else phBodyPipeline();
}

function phBodyPipeline(){
  const srcMatch=p=>!prehireSrc || (prehireSrc==="Direct"?(!p.hire_source||p.hire_source==="Direct"):p.hire_source===prehireSrc);
  const cols=PH_PHASES.map(ph=>{
    const cards=PREHIRE.filter(p=>p.phase===ph.key && srcMatch(p));
    return `<div class="col"><div class="col-h">${ph.label}<span>${cards.length} · ${esc(ph.actor)}</span></div>
      ${cards.map(c=>`<div class="ccard clickable" data-id="${c.id}" ${ph.key==="HR_SIGNOFF"?'style="border-color:#bcdcc7;background:var(--green-light);"':''}>
        <div class="cn">${esc(c.full_name)}</div>
        <div class="cd">${esc(c.position||"—")} · ${esc(c.hire_source||"Direct")}${c.daily_rate?` · ₱${Number(c.daily_rate).toLocaleString()}/day`:""}${c.assessment_score!=null?` · exam ${c.assessment_score}`:""}${c.sm_acceptance&&c.sm_acceptance!=="NA"?` · SM ${esc(c.sm_acceptance)}`:""}</div>${c.created_at?`<div style="font-size:10.5px;margin-top:3px;color:${(Date.now()-new Date(c.created_at))/86400000>14?'#c0392b':'var(--muted)'};">Submitted ${fmtMDY(c.created_at)} · ${fmtAgo(c.created_at)}</div>`:""}</div>`).join("")
       || `<div style="font-size:11.5px;color:var(--muted);padding:6px 2px;">—</div>`}
    </div>`;
  }).join("");
  const rej=PREHIRE.filter(p=>p.phase==="REJECTED" && srcMatch(p));
  $("#phBody").innerHTML=`
    ${prehireSrc?`<div style="margin-top:12px;"><span class="pill ag" id="clrSrc" style="cursor:pointer;font-size:12px;">Showing ${esc(prehireSrc)} only · ✕ clear</span></div>`:""}
    <div class="psub" style="margin-top:12px;">Seven stages, left → right (Applied → Hired). Click any card to open the candidate and advance the stage. Onboarding is a separate phase.</div>
    <div class="pipe">${cols}</div>
    <div class="two-col" style="margin-top:14px;">
      <div class="panel" style="margin-top:0;"><h2>Agency Submissions — the two-way loop</h2>
        <div class="psub">RCC posts an open slot → Jell-on &amp; M&amp;G propose candidates → RCC approves → candidate enters this pipeline</div>
        <div class="task"><div class="dot g"></div><div><div class="tt">How it connects</div><div class="td">An approved agency candidate is created here at <b>Applied</b>, with Hire Source = the proposing agency. The agency login only sees its own submissions.</div></div></div>
      </div>
      <div class="panel" style="margin-top:0;"><h2>Hard Gate — SM / Retail-Ops Acceptance</h2>
        <div class="psub">For consigned (concession) merchandisers, the host store must accept before pre-hire can close</div>
        ${PREHIRE.filter(p=>p.sm_acceptance&&p.sm_acceptance!=="NA").map(p=>`<div class="task"><div class="dot ${p.sm_acceptance==='Accepted'?'g':(p.sm_acceptance==='Rejected'?'r':'a')}"></div><div><div class="tt">${esc(p.full_name)} · ${esc(p.worksite||"—")}</div><div class="td">SM acceptance: ${esc(p.sm_acceptance)}</div></div></div>`).join("")||'<div class="psub">No consigned candidates awaiting SM acceptance.</div>'}
      </div>
    </div>
    ${rej.length?`<div class="panel"><h2>Rejected <span class="count-tag">${rej.length}</span></h2>${rej.map(c=>`<div class="task clickable" data-id="${c.id}"><div class="dot r"></div><div><div class="tt">${esc(c.full_name)}</div><div class="td">${esc(c.position||"—")} · ${esc(c.rejection_reason||"no reason recorded")}</div></div></div>`).join("")}</div>`:""}`;
  $$("#phBody .clickable").forEach(el=>el.addEventListener("click",()=>openPrehire(PREHIRE.find(p=>String(p.id)===el.dataset.id))));
  const _cs=document.getElementById("clrSrc"); if(_cs) _cs.addEventListener("click",()=>{ prehireSrc=null; renderPrehire(); });
}

function phBodyArch(){
  const stages=[
    ["1 · Applied","Recruiter / applicant","Candidate applies (direct link or agency submission). Core identity captured.","full_name, email, phone, position, department, hire_source, resume_url","Auto-create pre-hire record; per-candidate Drive folder provisioned"],
    ["2 · Screening","Recruiter","Assessment + interview; pass/fail gate.","assessment_type, assessment_score, assessment_passed → assessments table","Assessment link emailed; auto-score; fail can auto-reject"],
    ["3 · Documents","Candidate + HR","Candidate uploads the required documents; HR verifies each.","prehire_documents (one row per doc: status PENDING/RECEIVED/REJECTED)","Upload reminders; completeness check"],
    ["4 · Recruiter Review","Recruiter","Vets candidate + documents and extends the job offer. Offer is conditional: formal only when a range was posted; fixed rate or small bump = no formal offer.","recruiter_notes, review_type, comp_basis, offer_required, offer_accepted, contract_type, daily_rate, start_date","Offer letter generated when offer_required"],
    ["5 · HR Sign-off","HR","Final HR review and sign-off. Gov numbers + bank confirmed.","hr_signoff_notes, hr_signoff_date, sss/philhealth/pagibig/tin, bank","Sign-off unlocks contract generation"],
    ["6 · Contract Signing","Contracts module","Employment contract generated and routed through signers for e-signature.","contract_id (links to the Contracts signing pipeline)","Contract auto-generated from pre-hire data"],
    ["7 · Hired","System","Contract fully signed — pre-hire closes, the record becomes an Employee and an Onboarding case opens.","assigned_employee_id → creates employees row","Promotes pre-hire → employees; opens Onboarding (separate phase)"]
  ];
  $("#phBody").innerHTML=`
    <div class="panel" style="margin-top:14px;"><h2>The pipeline — stage by stage</h2>
      <div class="psub">Each stage names who acts, what happens, the data it captures, and the automation behind it.</div>
      <table><thead><tr><th>Stage</th><th>Who acts</th><th>What happens</th><th>Data captured</th><th>Automation</th></tr></thead>
        <tbody>${stages.map(s=>`<tr><td><b>${s[0]}</b></td><td>${s[1]}</td><td>${s[2]}</td><td style="font-size:12px;color:var(--muted);">${s[3]}</td><td style="font-size:12px;">${s[4]}</td></tr>`).join("")}</tbody></table>
    </div>
    <div class="two-col">
      <div class="panel" style="margin-top:0;"><h2>Two gates that can block a close</h2>
        <div class="task"><div class="dot a"></div><div><div class="tt">Agency Submissions loop</div><div class="td">Agency-sourced candidates enter at Applied (Hire Source = Jell-on / M&amp;G). The agency sees only its own.</div></div></div>
        <div class="task"><div class="dot a"></div><div><div class="tt">SM / Retail-Ops hard gate</div><div class="td">Consigned merchandisers cannot reach Complete until the host store (SM / retail-ops) accepts — <code>sm_acceptance</code>.</div></div></div>
      </div>
      <div class="panel" style="margin-top:0;"><h2>Where the data lives &amp; what it connects to</h2>
        <div class="task"><div class="dot g"></div><div><div class="tt">prehire</div><div class="td">One row per candidate — the spine of this module (the full lifecycle above).</div></div></div>
        <div class="task"><div class="dot g"></div><div><div class="tt">prehire_documents</div><div class="td">The 6-document checklist, one row per document, per candidate.</div></div></div>
        <div class="task"><div class="dot g"></div><div><div class="tt">assessments</div><div class="td">Each exam attempt — score, pass/fail, answers.</div></div></div>
        <div class="task"><div class="dot g"></div><div><div class="tt">→ employees · contracts</div><div class="td">On Complete, becomes an <b>employees</b> record; the contract links to the <b>Contracts</b> module.</div></div></div>
      </div>
    </div>`;
}

function phBodyData(){
  const groups=[
    ["Identity & Stage","prehire_id, phase (7 stages + Rejected), full_name, email, phone, date_of_birth, civil_status, permanent_address, current_address, emergency_contact_name / _relation / _number, hire_source, worksite"],
    ["Assessment","assessment_type, assessment_sent_date, assessment_score, assessment_passed, assessment_notes"],
    ["Position & Compensation","position, department, contract_type, daily_rate, daily_allowance, start_date, end_date, supervisor_name, supervisor_email"],
    ["Approvals & Review","approver1_email, approver2_email, hr_officer_notes, hr_officer_review_date, juvelyn_notes, juvelyn_review_date, amendment_request, sm_acceptance (hard gate), rejection_reason, reviewed_by"],
    ["Government & Bank","sss_number, philhealth_number, pagibig_number, tin_number, bank_name, bank_account_number"],
    ["Contract & Onboarding","contract_id, payplus_setup (+date), assigned_employee_id (+date), uniform_issued (+date), orientation_complete (+date), drive_folder_url, docs_folder_url"],
    ["System","id (uuid), created_at, updated_at"]
  ];
  $("#phBody").innerHTML=`
    <div class="panel" style="margin-top:14px;"><h2>prehire — the candidate record</h2>
      <div class="psub">${groups.reduce((n,g)=>n+g[1].split(",").length,0)} fields across ${groups.length} groups. Already built in Supabase.</div>
      ${groups.map(g=>`<div class="subhead">${esc(g[0])}</div><div style="font-size:13px;color:#3a4540;line-height:1.7;">${esc(g[1])}</div>`).join("")}
    </div>
    <div class="two-col">
      <div class="panel" style="margin-top:0;"><h2>prehire_documents</h2>
        <div class="psub">The document checklist — one row per required doc, per candidate</div>
        <div style="font-size:13px;color:#3a4540;line-height:1.7;">document_key, document_label, is_mandatory, status (PENDING / RECEIVED / REJECTED), file_url, rejection_reason, submitted_at, verified_by, verified_at</div>
      </div>
      <div class="panel" style="margin-top:0;"><h2>assessments</h2>
        <div class="psub">Each exam attempt for a candidate</div>
        <div style="font-size:13px;color:#3a4540;line-height:1.7;">assessment_type, is_timed, time_limit_minutes, started_at, completed_at, score, total_questions, correct_answers, passing_score, passed, answers (jsonb)</div>
      </div>
    </div>`;
}

function phRow(k,v){ const blank=v==null||v===""; return `<div class="efield"><div class="el">${k}</div><div class="ev">${blank?'<span class="note">—</span>':esc(v)}</div><div class="em"></div></div>`; }
function phDocFor(c,key){ return PHDOCS.find(d=>String(d.prehire_id)===String(c.id)&&d.document_key===key); }
function phDocsReceived(c){ return DEFAULT_PH_DOCS.filter(([k])=>{const d=phDocFor(c,k); return d&&d.status==="RECEIVED";}).length; }
function phDocsRows(c){
  return DEFAULT_PH_DOCS.map(([k,lbl,tf])=>{ const d=phDocFor(c,k); const st=d?d.status:"PENDING"; const got=st==="RECEIVED";
    return `<div class="task clickable" data-doc="${k}" data-label="${esc(lbl)}" data-tofollow="${tf?1:0}" style="cursor:pointer;align-items:center;">
      <div class="dot ${got?'g':'a'}"></div>
      <div style="flex:1;"><div class="tt">${esc(lbl)}</div></div>
      ${tf?'<span class="pill cn" style="margin-right:6px;">to-follow OK</span>':''}
      <span class="pill ${got?'active':'probation'}">${got?'Received':'Pending'}</span></div>`;
  }).join("");
}
async function togglePhDoc(c,key,label,toFollow){
  const d=phDocFor(c,key);
  if(d){ const ns=d.status==="RECEIVED"?"PENDING":"RECEIVED"; await sb.from("prehire_documents").update({status:ns, submitted_at:ns==="RECEIVED"?new Date().toISOString():null}).eq("id",d.id); }
  else { await sb.from("prehire_documents").insert({prehire_id:c.id, document_key:key, document_label:label, is_mandatory:!toFollow, is_to_follow:toFollow, status:"RECEIVED", submitted_at:new Date().toISOString()}); }
  await loadEmployees();
  openPrehire(PREHIRE.find(p=>String(p.id)===String(c.id)));
}
const FUNNEL_INVITED=["Invited","Interviewed","Final interview","Offered","Hired","No-show","Failed","Declined"];
const FUNNEL_SHOWED=["Interviewed","Final interview","Offered","Hired","Failed","Declined"];
const FUNNEL_OFFERED=["Offered","Hired","Declined"];
function phBodyFunnel(){
  const byRole={};
  PREHIRE.filter(p=>p.interview_status||p.position).forEach(p=>{ const r=(p.position||"—").trim()||"—"; (byRole[r]=byRole[r]||[]).push(p); });
  const today=new Date(new Date().toDateString());
  const step=(l,n,strong)=>`<div style="text-align:center;flex:1;min-width:56px;"><div style="font-size:22px;font-weight:800;color:${strong?'#1E3A5F':'#9aa6b2'};">${n}</div><div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;">${l}</div></div>`;
  const arrow=`<span style="color:#cdd5de;font-size:14px;">→</span>`;
  const roleCard=(role,list)=>{
    const c=(arr)=>list.filter(p=>arr.includes(p.interview_status)).length;
    const screened=list.length, invited=c(FUNNEL_INVITED), showed=c(FUNNEL_SHOWED), offered=c(FUNNEL_OFFERED);
    const hired=list.filter(p=>p.interview_status==="Hired"||p.phase==="HIRED").length;
    const noshow=list.filter(p=>p.interview_status==="No-show").length;
    const failed=list.filter(p=>p.interview_status==="Failed").length;
    const declined=list.filter(p=>p.interview_status==="Declined").length;
    const upcoming=list.filter(p=>p.interview_date && new Date(p.interview_date+"T00:00:00")>=today).sort((a,b)=>a.interview_date<b.interview_date?-1:1);
    return `<div class="panel" style="margin-top:12px;">
      <h2>${esc(role)} <span class="count-tag">${screened} in funnel</span></h2>
      <div style="display:flex;gap:6px;align-items:center;margin:12px 0 4px;flex-wrap:wrap;">
        ${step("Screened",screened,screened>0)}${arrow}${step("Invited",invited,invited>0)}${arrow}${step("Interviewed",showed,showed>0)}${arrow}${step("Offer",offered,offered>0)}${arrow}${step("Hired",hired,hired>0)}
      </div>
      <div class="psub">${noshow?`<span class="pill awol">No-show ${noshow}</span> `:""}${failed?`<span class="pill awol">Failed ${failed}</span> `:""}${declined?`<span class="pill awol">Declined ${declined}</span> `:""}${(!noshow&&!failed&&!declined)?'<span class="note">No drop-offs recorded.</span>':""}</div>
      ${upcoming.length?`<div class="psub" style="margin-top:8px;">📅 Scheduled: ${upcoming.map(p=>esc(p.full_name||"candidate")+" — "+fmtDate(p.interview_date)).join(" · ")}</div>`:""}
    </div>`;
  };
  const roles=Object.entries(byRole).sort((a,b)=>b[1].length-a[1].length);
  $("#phBody").innerHTML=`
    <div class="psub" style="margin-top:12px;">Live recruitment funnel by role — <b>Screened → Invited → Interviewed → Offer → Hired</b>, with drop-offs (no-show / failed / declined) and scheduled interviews. This is your weekly report, generated from the pipeline. Set each candidate's stage in <b>open a candidate → Edit applicant → Recruiting / interview</b>.</div>
    ${roles.length?roles.map(([r,l])=>roleCard(r,l)).join(""):'<div class="panel" style="margin-top:12px;"><div class="psub">No candidates with a recruiting stage yet. Add applicants and set their stage to populate the funnel.</div></div>'}`;
}
function phBodyFeedback(){
  const F=CANDIDATE_FEEDBACK||[];
  const avg=(k)=>{ const v=F.map(x=>x[k]).filter(n=>n!=null); return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):"—"; };
  const cnt=(k,val)=>F.filter(x=>x[k]===val).length;
  const stars=(n)=> n==="—"?"—":"★".repeat(Math.round(+n))+"☆".repeat(5-Math.round(+n))+" "+n;
  const declines=F.filter(x=>x.outcome==="I declined the offer");
  $("#phBody").innerHTML=`
    <div class="psub" style="margin-top:12px;">What candidates say about applying with RCC. Share the “Candidate feedback” link (in Share these links, above) after an interview or a decision. <b>${F.length}</b> response${F.length===1?"":"s"} so far.</div>
    ${!F.length?'<div class="panel" style="margin-top:12px;"><div class="psub">No feedback yet — send the survey link to applicants and responses will appear here.</div></div>':`
    <div class="grid kpis" style="grid-template-columns:repeat(4,1fr);margin-top:12px;">
      <div class="kpi"><div class="k-l">Overall</div><div class="k-n" style="font-size:17px;">${stars(avg("overall_rating"))}</div></div>
      <div class="kpi"><div class="k-l">Process clarity</div><div class="k-n" style="font-size:17px;">${stars(avg("clarity_rating"))}</div></div>
      <div class="kpi"><div class="k-l">Communication</div><div class="k-n" style="font-size:17px;">${stars(avg("comms_rating"))}</div></div>
      <div class="kpi"><div class="k-l">Interview</div><div class="k-n" style="font-size:17px;">${stars(avg("interview_rating"))}</div></div>
    </div>
    <div class="two-col" style="margin-top:14px;">
      <div class="panel" style="margin-top:0;">
        <h2>Treated fairly &amp; respectfully?</h2>
        <div class="psub">Yes ${cnt("treated_fairly","Yes")} · Somewhat ${cnt("treated_fairly","Somewhat")} · No ${cnt("treated_fairly","No")}</div>
        <h2 style="margin-top:14px;">Would apply / recommend again</h2>
        <div class="psub">Yes ${cnt("would_recommend","Yes")} · Maybe ${cnt("would_recommend","Maybe")} · No ${cnt("would_recommend","No")}</div>
        ${declines.length?`<h2 style="margin-top:14px;">Why offers were declined</h2>${declines.map(d=>`<div class="task"><div class="dot a"></div><div><div class="tt">${esc(d.decline_reason||"—")}</div><div class="td">${esc(d.position||"")}${d.full_name?" · "+esc(d.full_name):""}</div></div></div>`).join("")}`:""}
      </div>
      <div class="panel" style="margin-top:0;"><h2>Recent comments</h2>
        ${F.filter(x=>x.improve||x.comments).slice(0,12).map(x=>`<div class="task"><div class="dot ${(x.overall_rating||3)>=4?'g':((x.overall_rating||3)<=2?'r':'a')}"></div><div><div class="tt">${esc(x.full_name||"Anonymous")}${x.position?" · "+esc(x.position):""}${x.overall_rating?" · "+x.overall_rating+"★":""}</div><div class="td">${esc(x.improve||x.comments||"")}</div></div></div>`).join("")||'<div class="psub">No written comments yet.</div>'}
      </div>
    </div>`}`;
}
function phAppRows(a){
  if(typeof a==="string"){ try{ a=JSON.parse(a); }catch(e){ return ""; } }
  if(!a) return "";
  const row=(l,val)=>val?`<div class="efield"><div class="el">${esc(l)}</div><div class="ev">${esc(val)}</div></div>`:"";
  const yn=(l,val,d)=>val?`<div class="efield"><div class="el">${esc(l)}</div><div class="ev">${esc(val)}${val==="Yes"&&d?" — "+esc(d):""}</div></div>`:"";
  const resumeRow=(a.resume_doc&&a.resume_doc.path)?`<div class="efield"><div class="el">Resume</div><div class="ev"><button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="openPrehireDoc('${esc(a.resume_doc.path)}',this)">View resume</button></div></div>`:"";
  const out=[
    row("Can start",a.availability), row("OK with pay structure?",a.pay_ack), resumeRow,
    row("Nickname",a.nickname), row("Place of birth",a.place_of_birth), row("Sex",a.sex),
    row("Telegram",a.telegram), row("Viber",a.viber), row("Facebook",a.facebook),
    row("Religion (SM)",a.religion), row("Height",a.height), row("Weight",a.weight),
    row("Recent employer",a.prev_employer), row("Position held",a.prev_position), row("Dates",a.prev_duration), row("Reason for leaving",a.prev_reason),
    row("OK to contact employer?",a.may_contact_employer),
    row("Education / school",a.education_school), row("Year graduated",a.education_year),
    yn("Discharged / asked to resign?",a.q_discharged,a.q_discharged_detail),
    yn("Convicted of a crime?",a.q_criminal,a.q_criminal_detail),
    yn("Able to perform the duties?",a.q_can_perform,a.q_can_perform_detail)
  ].join("");
  return out||'<div class="psub">No extra details provided.</div>';
}
function openPrehire(c){
  if(!c) return;
  const idx=PH_PHASES.findIndex(p=>p.key===c.phase);
  const next=idx>=0&&idx<PH_PHASES.length-1?PH_PHASES[idx+1]:null;
  let m=document.getElementById("phModal"); if(!m){ m=document.createElement("div"); m.id="phModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:580px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;">
      <div style="font-size:21px;font-weight:800;">${esc(c.full_name)}</div>
      <div style="font-size:12.5px;opacity:.9;margin-top:3px;">${esc(c.prehire_id)} · ${esc(c.position||"—")} · ${esc(c.hire_source||"Direct")} · <b>${esc(phLabel(c.phase))}</b></div>
    </div>
    <div style="padding:18px 22px 60px;">
      <div class="panel" style="margin-top:0;">
        ${sec(1,"Application &amp; Stage", phRow("Pre-hire ID",c.prehire_id)+phRow("Stage",phLabel(c.phase))+phRow("Hire source",c.hire_source||"Direct")+phRow("Position",c.position)+phRow("Department",c.department)+phRow("Worksite",c.worksite))}
      </div>
      <div class="panel">
        ${sec(2,"Personal Details", phRow("Email",c.email)+phRow("Mobile",c.phone)+phRow("Date of birth",c.date_of_birth?fmtDate(c.date_of_birth):"")+phRow("Civil status",c.civil_status)+phRow("Permanent address",c.permanent_address)+phRow("Current address",c.current_address))}
      </div>
      <div class="panel">
        ${sec(3,"Emergency Contact", phRow("Name",c.emergency_contact_name)+phRow("Relationship",c.emergency_contact_relation)+phRow("Contact number",c.emergency_contact_number))}
      </div>
      <div class="panel">
        ${sec(4,"Assessment", phRow("Type",c.assessment_type)+phRow("Sent",c.assessment_sent_date?fmtDate(c.assessment_sent_date):"")+phRow("Score",c.assessment_score)+phRow("Passed",c.assessment_passed==null?"":(c.assessment_passed?"Yes":"No"))+phRow("Notes",c.assessment_notes))}
      </div>
      <div class="panel">
        ${sec(5,"Offer &amp; Compensation",
          phRow("Contract type",c.contract_type)
          + (canSeePay()
              ? `<div class="efield"><div class="el">Daily rate (offered)</div><div class="ev">${c.daily_rate?("₱"+Number(c.daily_rate).toLocaleString()):'<span class="note">—</span>'} <span class="note">— may change at the contract stage</span></div><div class="em"></div></div>`+phRow("Daily allowance",c.daily_allowance?("₱"+Number(c.daily_allowance).toLocaleString()):"")
              : `<div class="efield"><div class="el">Daily rate</div><div class="ev"><span class="note">🔒 restricted — payroll only</span></div></div>`)
          + phRow("Target start date",c.start_date?fmtDate(c.start_date):"")+phRow("Supervisor",c.supervisor_name)+phRow("Approver 2",c.approver2_email))}
      </div>
      ${canSeePay()?`<div class="panel">
        ${sec(6,"Government Numbers", phRow("SSS",c.sss_number)+phRow("PhilHealth",c.philhealth_number)+phRow("Pag-IBIG",c.pagibig_number)+phRow("TIN",c.tin_number))}
      </div>
      <div class="panel">
        ${sec(7,"Bank", phRow("Bank name",c.bank_name)+phRow("Account number",c.bank_account_number))}
      </div>`:""}
      <div class="panel">
        ${sec(8,"Review, Gates &amp; Onboarding", phRow("HR officer notes",c.hr_officer_notes)+phRow("Juvelyn sign-off",c.juvelyn_review_date?"Signed":"")+phRow("SM acceptance (hard gate)",c.sm_acceptance)+phRow("Contract ID",c.contract_id)+phRow("PayPlus setup",c.payplus_setup?"Done":"")+phRow("Assigned Employee ID",c.assigned_employee_id))}
      </div>
      <div class="panel"><h2>Required Documents <span class="count-tag">${phDocsReceived(c)}/${DEFAULT_PH_DOCS.length}</span></h2>
        <div class="psub">NBI / police clearance may be <b>"to follow"</b>; the rest are needed to close onboarding. Tap to mark received.</div>
        ${phDocsRows(c)}
      </div>
      ${c.application?`<div class="panel"><h2>Application <span class="count-tag">as submitted</span></h2>${phAppRows(c.application)}</div>`:''}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
        <button class="btn" id="phEdit">Edit applicant details</button>
        ${next?`<button class="btn blue" id="phAdvance">Advance → ${esc(next.label)}</button>`:'<span class="pill active">Pipeline complete</span>'}
        ${c.phase!=="REJECTED"?'<button class="btn ghost" id="phReject" style="color:var(--red);border-color:#f1c9c5;">Reject</button>':''}
        <button class="btn ghost" id="phClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  $("#phClose").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  $("#phEdit").addEventListener("click",()=>editPrehire(c));
  $$("#phModal [data-doc]").forEach(el=>el.addEventListener("click",()=>togglePhDoc(c, el.dataset.doc, el.dataset.label, el.dataset.tofollow==="1")));
  if(next) $("#phAdvance").addEventListener("click",()=>{
    const grp=deriveGroup(c.department);
    // DEPARTMENT GATE: department decides group (HO / Warehouse / Retail) → pay basis, ID type, SM rule. Require it before the contract.
    if(next.key==="CONTRACT_SIGNING" && !c.department){
      alert("Department not set.\n\nSet the candidate's department first — it decides Head-Office vs Warehouse vs Retail, which drives pay basis, ID type and the SM rule.\n\nOpen “Edit applicant details” → Identity → Department.");
      return;
    }
    // PAY-BASIS GATE: a Head Office hire must have Daily/Monthly chosen before the contract.
    if(next.key==="CONTRACT_SIGNING" && grp==="Head Office" && !c.pay_basis){
      alert("Pay basis not set.\n\nThis is a Head Office hire — choose Daily or Monthly before the contract is prepared.\n\nOpen “Edit applicant details” → Offer & compensation → Pay basis.");
      return;
    }
    // SM HARD GATE: only store-based hires need host-store acceptance. Head Office & Warehouse are not store-based → skip.
    const storeBased=!(grp==="Head Office"||grp==="Warehouse");
    if(next.key==="HIRED" && storeBased && !["Accepted","NA"].includes(c.sm_acceptance||"")){
      alert("SM hard gate\n\nThis store-based candidate can't be marked Hired until store / Retail-ops acceptance is recorded.\n\nOpen “Edit applicant details” → set “SM / Retail-ops acceptance” to:\n • Accepted — the host store has taken them, or\n • NA — this role isn't store-based.\n\n(It is currently: "+(c.sm_acceptance||"blank")+".)");
      return;
    }
    // HIRED auto-opens the onboarding case so the hire→onboard hand-off can't be missed.
    if(next.key==="HIRED"){ advanceToHired(c,m); return; }
    setPhase(c,next.key,m);
  });
  const rej=document.getElementById("phReject"); if(rej) rej.addEventListener("click",()=>rejectPrehire(c,m));
}
function editPrehire(c){
  let m=document.getElementById("phEditModal"); if(!m){ m=document.createElement("div"); m.id="phEditModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.5);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:560px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;"><div style="font-size:20px;font-weight:800;">Edit applicant — ${esc(c.full_name)}</div><div style="font-size:12.5px;opacity:.85;">${esc(c.prehire_id)} · ${esc(phLabel(c.phase))}</div></div>
    <div style="padding:18px 22px;">
      <div class="panel" style="margin-top:0;"><div class="subhead">Identity</div>
        ${fld("pe_full_name","Full name *",c.full_name)}${sel("pe_department","Department",DEPARTMENTS,c.department)}${fld("pe_position","Position",c.position)}${sel("pe_hire_source","Hire source",HIRE_SOURCES,c.hire_source||"Direct")}${sel("pe_worksite","Worksite / location",[...new Set(["Head Office","Warehouse Solaris",...BRANCHES.map(b=>b.name).sort(),...(c.worksite?[c.worksite]:[])])],c.worksite)}
      </div>
      <div class="panel"><div class="subhead">Personal details</div>
        ${fld("pe_email","Email",c.email,"email")}${fld("pe_phone","Mobile (09XXXXXXXXX)",c.phone)}${fld("pe_dob","Date of birth",c.date_of_birth,"date")}${sel("pe_civil","Civil status",CIVIL,c.civil_status)}${fld("pe_perm","Permanent address",c.permanent_address)}${fld("pe_curr","Current address",c.current_address)}
      </div>
      <div class="panel"><div class="subhead">Emergency contact</div>
        ${fld("pe_ecn","Name",c.emergency_contact_name)}${sel("pe_ecr","Relationship",RELATIONS,c.emergency_contact_relation)}${fld("pe_ecnum","Contact number",c.emergency_contact_number)}
      </div>
      <div class="panel"><div class="subhead">Assessment</div>
        ${fld("pe_atype","Type",c.assessment_type)}${fld("pe_ascore","Score",c.assessment_score,"number")}
      </div>
      <div class="panel"><div class="subhead">Offer &amp; compensation <span class="sh-note">daily rate may change at contract</span></div>
        ${sel("pe_ctype","Contract type",CONTRACT_TYPES,c.contract_type)}${sel("pe_paybasis","Pay basis — Head Office only (others are daily-rated)",["Daily","Monthly"],c.pay_basis)}${canSeePay()?`${fld("pe_rate","Daily rate offered (₱)",c.daily_rate,"number")}${fld("pe_allow","Daily allowance (₱)",c.daily_allowance,"number")}`:`<div style="font-size:12.5px;color:#6a766f;margin:6px 0;">🔒 Daily rate is restricted to payroll.</div>`}${fld("pe_start","Target start date",c.start_date,"date")}${fld("pe_super","Supervisor",c.supervisor_name)}
      </div>
      ${canSeePay()?`<div class="panel"><div class="subhead">Government numbers &amp; bank</div>
        ${fld("pe_sss","SSS",c.sss_number)}${fld("pe_phil","PhilHealth",c.philhealth_number)}${fld("pe_pag","Pag-IBIG",c.pagibig_number)}${fld("pe_tin","TIN",c.tin_number)}${fld("pe_bank","Bank name",c.bank_name)}${fld("pe_acct","Bank account number",c.bank_account_number)}
      </div>`:""}
      <div class="panel"><div class="subhead">HR notes &amp; gate</div>
        <div style="margin-bottom:8px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">HR officer notes</label><textarea id="pe_notes" rows="2" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;">${esc(c.hr_officer_notes||"")}</textarea></div>
        ${sel("pe_sm","SM / Retail-ops acceptance",["Pending","Accepted","Rejected","NA"],c.sm_acceptance)}
      </div>
      <div class="panel"><div class="subhead">Recruiting / interview <span class="sh-note">drives the funnel report</span></div>
        ${sel("pe_istatus","Stage in the hiring funnel",["Screened","Invited","Interviewed","No-show","Failed","Final interview","Offered","Declined","Hired"],c.interview_status)}${fld("pe_idate","Interview date (if scheduled)",c.interview_date,"date")}${fld("pe_interviewer","Interviewer",c.interviewer)}
      </div>
      <div id="peMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
      <div style="display:flex;gap:10px;"><button class="btn ghost" id="peCancel" style="flex:1;">Cancel</button><button class="btn" id="peSave" style="flex:1;">Save</button></div>
    </div></div>`;
  document.getElementById("peCancel").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  document.getElementById("peSave").addEventListener("click",async()=>{
    const name=document.getElementById("pe_full_name").value.trim();
    if(!name){ document.getElementById("peMsg").textContent="Full name is required."; return; }
    let phone=v("pe_phone"); if(phone) phone=phone.replace(/[\s-]/g,"");
    const p={ full_name:name, department:v("pe_department"), position:v("pe_position"), hire_source:v("pe_hire_source"), worksite:v("pe_worksite"),
      email:v("pe_email"), phone, date_of_birth:v("pe_dob"), civil_status:v("pe_civil"), permanent_address:v("pe_perm"), current_address:v("pe_curr"),
      emergency_contact_name:v("pe_ecn"), emergency_contact_relation:v("pe_ecr"), emergency_contact_number:v("pe_ecnum"),
      assessment_type:v("pe_atype"), assessment_score:nv("pe_ascore"),
      contract_type:v("pe_ctype"), pay_basis:v("pe_paybasis"), start_date:v("pe_start"), supervisor_name:v("pe_super"),
      hr_officer_notes:v("pe_notes"), sm_acceptance:v("pe_sm"),
      interview_status:v("pe_istatus"), interview_date:v("pe_idate"), interviewer:v("pe_interviewer"), updated_at:new Date().toISOString() };
    if(canSeePay()){ Object.assign(p,{ daily_rate:nv("pe_rate"), daily_allowance:nv("pe_allow"), sss_number:v("pe_sss"), philhealth_number:v("pe_phil"), pagibig_number:v("pe_pag"), tin_number:v("pe_tin"), bank_name:v("pe_bank"), bank_account_number:v("pe_acct") }); }
    const { error } = await sb.from("prehire").update(p).eq("id",c.id);
    if(error){ document.getElementById("peMsg").textContent=error.message; return; }
    m.remove(); const pm=document.getElementById("phModal"); if(pm) pm.remove();
    await loadEmployees(); window.go("prehire");
  });
}
async function setPhase(c,phase,modal,extra){
  const patch=Object.assign({phase, updated_at:new Date().toISOString()}, extra||{});
  const { error } = await sb.from("prehire").update(patch).eq("id",c.id);
  if(error){ alert(error.message); return; }
  if(modal) modal.remove();
  await loadEmployees(); window.go("prehire");
}
// Reaching HIRED auto-opens the onboarding case (one per candidate) so the hire→onboard hand-off can't be missed.
async function advanceToHired(c, modal){
  if(modal) modal.remove();
  const existing=(typeof ONBOARDING!=="undefined"&&Array.isArray(ONBOARDING)?ONBOARDING:[]).find(o=>o.prehire_id===c.id);
  if(existing){ await setPhase(c,"HIRED"); window.go("onboarding"); openOnboardingCase(existing.id); return; }
  await createOnboardingCase(c);  // creates the case + tasks, sets phase HIRED, opens onboarding
}
const REJECT_REASONS=["Did not meet the position qualifications","Incomplete requirements / documents","Failed assessment / interview","Store / Retail-ops did not accept","Position already filled","Withdrew / no longer available","Other"];
function rejectPrehire(c, parentModal){
  let m=document.getElementById("phRejModal"); if(!m){ m=document.createElement("div"); m.id="phRejModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:10000;background:rgba(14,50,25,.5);display:flex;align-items:center;justify-content:center;padding:24px;";
  const agencyNote=(c.hire_source&&c.hire_source!=="Direct")?`The agency (<b>${esc(c.hire_source)}</b>) will see this reason as their basis.`:`This is recorded on the candidate's record.`;
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:22px;">
    <h2 style="font-size:17px;color:var(--red);margin-bottom:2px;">Reject — ${esc(c.full_name)}</h2>
    <div class="psub">${agencyNote}</div>
    <label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin:10px 0 3px;">Reason</label>
    <select id="rjReason" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:#fff;">${REJECT_REASONS.map(r=>`<option>${esc(r)}</option>`).join("")}</select>
    <textarea id="rjNote" rows="2" placeholder="Optional note (added to the reason)" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;margin-top:8px;"></textarea>
    <div style="display:flex;gap:10px;margin-top:12px;"><button class="btn ghost" id="rjCancel" style="flex:1;">Cancel</button><button class="btn" id="rjGo" style="flex:1;background:var(--red);border-color:var(--red);">Reject candidate</button></div>
  </div>`;
  m.addEventListener("click",e=>{ if(e.target===m) m.remove(); });
  document.getElementById("rjCancel").addEventListener("click",()=>m.remove());
  document.getElementById("rjGo").addEventListener("click",()=>{
    const base=document.getElementById("rjReason").value, note=document.getElementById("rjNote").value.trim();
    const reason=note?base+" — "+note:base;
    m.remove(); setPhase(c,"REJECTED",parentModal,{rejection_reason:reason});
  });
}
const HO_DEPTS=DEPARTMENTS.filter(d=>!["Sales","Warehouse","Warehouse Solaris"].includes(d));
// Position drives the worksite (and department): store roles → store list · Warehouse → Warehouse · Head Office → Head Office + a dept picker.
function npPosChange(){
  const pos=(document.getElementById("np_position")||{}).value||"";
  const ww=document.getElementById("np_worksite_wrap"), dw=document.getElementById("np_dept_wrap");
  if(!ww||!dw) return;
  const stores=[...new Set(BRANCHES.map(b=>b.name))].sort();
  if(["Merchandiser","Store Representative","Store Supervisor"].includes(pos)){
    ww.innerHTML=sel("np_worksite","Worksite — store",stores,""); dw.innerHTML="";
  } else if(pos==="Warehouse Staff"){
    ww.innerHTML=sel("np_worksite","Worksite",["Warehouse Solaris"],"Warehouse Solaris"); dw.innerHTML="";
  } else if(pos==="Head Office / Admin"){
    ww.innerHTML=sel("np_worksite","Worksite",["Head Office"],"Head Office"); dw.innerHTML=sel("np_department","Department",HO_DEPTS,"");
  } else {
    ww.innerHTML=sel("np_worksite","Worksite / location",["Head Office","Warehouse Solaris"].concat(stores),""); dw.innerHTML="";
  }
}
function newPrehire(){
  const e={};
  let m=document.getElementById("phModal"); if(!m){ m=document.createElement("div"); m.id="phModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:520px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;"><div style="font-size:20px;font-weight:800;">New Application</div><div style="font-size:12.5px;opacity:.85;">Enters the pipeline at “Applied”.</div></div>
    <div style="padding:18px 22px;"><div class="panel" style="margin-top:0;">
      ${fld("np_full_name","Full name *",e.full_name)}
      ${sel("np_position","Position",["Merchandiser","Store Representative","Store Supervisor","Warehouse Staff","Head Office / Admin"],e.position)}
      <div id="np_worksite_wrap"></div>
      <div id="np_dept_wrap"></div>
      ${fld("np_email","Email",e.email,"email")}
      ${fld("np_phone","Phone",e.phone)}
      <div class="psub" style="margin-top:2px;">Contract type, pay basis and rate are set later at the offer stage — not on the application.</div>
      <div id="npMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
      <div style="display:flex;gap:10px;"><button class="btn ghost" id="npCancel" style="flex:1;">Cancel</button><button class="btn" id="npSave" style="flex:1;">Create</button></div>
    </div></div></div>`;
  $("#npCancel").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  const _np=$("#np_position"); if(_np) _np.addEventListener("change",npPosChange); npPosChange();
  $("#npSave").addEventListener("click",async()=>{
    const fullname=document.getElementById("np_full_name").value.trim();
    if(!fullname){ document.getElementById("npMsg").textContent="Full name is required."; return; }
    const stamp=new Date().toISOString().slice(0,10).replace(/-/g,"");
    const rnd=Math.abs(fullname.split("").reduce((a,ch)=>a*31+ch.charCodeAt(0),7))%1000;
    const pos=v("np_position");
    const dept=document.getElementById("np_department")?v("np_department"):(["Merchandiser","Store Representative","Store Supervisor"].includes(pos)?"Sales":(pos==="Warehouse Staff"?"Warehouse":null));
    const payload={ prehire_id:"PH-"+stamp+"-"+String(rnd).padStart(3,"0"), phase:"APPLIED", full_name:fullname,
      department:dept, position:pos, hire_source:"Direct", worksite:v("np_worksite"),
      email:v("np_email"), phone:v("np_phone") };
    const { error } = await sb.from("prehire").insert(payload);
    if(error){ document.getElementById("npMsg").textContent=error.message; return; }
    m.remove(); await loadEmployees(); window.go("prehire");
  });
}

/* ============================ ONBOARDING MODULE ============================ */
function tasksFor(caseId){ return ONBTASKS.filter(t=>t.case_id===caseId).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)); }
function caseProgress(caseId){ const ts=tasksFor(caseId); const done=ts.filter(t=>t.status==="Done").length; return {done, total:ts.length}; }
// Onboarding task timing — derived from task_key (no DB column needed).
const ONB_TIMING={schedule:"before_start",bank:"before_start",gov_forms:"early_legal",uniform:"day_1",orientation:"day_1",itime:"day_1",payplus:"by_2nd_payroll",employee_id:"by_2nd_payroll",id_badge:"by_2nd_payroll"};
const ONB_TIMING_GROUPS=[
  {key:"before_start",  label:"① Before they start"},
  {key:"early_legal",   label:"② Government — file early (legal deadline)"},
  {key:"day_1",         label:"③ Day 1 — first day at work"},
  {key:"by_2nd_payroll",label:"④ By 2nd payroll (15-day gate)"}
];
function defaultOnbTasks(c){
  const grp=c.group_name||"";
  const isHOWH=grp==="Head Office"||grp==="Warehouse";
  const bank=isHOWH?"China Bank":"Union Bank";
  const idBadge=isHOWH?"Company ID":"Mall ID";
  const isSM=/\bSM\b|dept|department/i.test((c.worksite||"")+" "+(c.position||""));
  const t=[
    {task_key:"schedule",   label:"Set Day-1 plan / schedule",                                            owner_role:"HR"},
    {task_key:"bank",       label:"Open bank account — "+bank+" (begin early)",                            owner_role:"HR / Finance"},
    {task_key:"gov_forms",  label:"Government registration (SSS R-1A · PhilHealth · Pag-IBIG · BIR 1902)", owner_role:"HR"},
    {task_key:"uniform",    label:"Issue uniform + capture signed deduction authorization",               owner_role:"HR / Admin"},
    {task_key:"orientation",label:"Orientation / product training",                                       owner_role:"HR / Supervisor"}
  ];
  if(isSM) t.push({task_key:"itime",label:"iTime enrollment (SM department store)",owner_role:"HR"});
  t.push({task_key:"payplus",    label:"Encode in PayPlus",           owner_role:"Payroll"});
  t.push({task_key:"employee_id",label:"Assign Employee ID (PayPlus)",owner_role:"HR"});
  t.push({task_key:"id_badge",   label:"Issue "+idBadge,              owner_role:"HR"});
  return t.map((x,i)=>Object.assign({sort_order:i+1},x));
}
function renderOnboarding(){
  const pg=$("#page-onboarding"); if(!pg) return;
  const active=ONBOARDING.filter(c=>c.status!=="Complete");
  const done=ONBOARDING.filter(c=>c.status==="Complete").length;
  const pendingTasks=ONBTASKS.filter(t=>t.status!=="Done").length;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Onboarding Tasks</h2>
      <div class="psub">Once Hired, each new employee becomes an onboarding case. Tasks are grouped by <b>when they're due</b> — before-start · day-1 · by-2nd-payroll — and adapt by population (iTime for SM; Company vs Mall ID; Union vs China Bank). Auto-flows from Pre-hire.</div>
      <div class="actionbar"><button class="btn" id="onbNew">+ Start onboarding</button></div>
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi"><div class="k-l">In Progress</div><div class="k-n">${active.length}</div></div>
        <div class="kpi"><div class="k-l">Completed</div><div class="k-n">${done}</div></div>
        <div class="kpi warn"><div class="k-l">Open Tasks</div><div class="k-n">${pendingTasks}</div><div class="k-s">across all cases</div></div>
      </div>
      ${ONBOARDING.length? `<table><thead><tr><th>New hire</th><th>Group · Worksite</th><th>Employee ID</th><th>Progress</th><th>Status</th></tr></thead>
        <tbody id="onbRows"></tbody></table>`
        : `<div class="placeholder"><div class="pi"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#1E3A5F" stroke-width="2"><path d="M3 12l5 5L21 5"/></svg></div><h2>No onboarding cases yet</h2><p>Click “Start onboarding” to create a case from a pre-hire who has reached the contract stage.</p></div>`}
    </div>`;
  $("#onbNew").addEventListener("click",pickPrehireForOnboarding);
  const rows=$("#onbRows");
  if(rows){
    rows.innerHTML=ONBOARDING.map(c=>{ const p=caseProgress(c.id); const pct=p.total?Math.round(p.done/p.total*100):0;
      return `<tr class="clickable" data-id="${c.id}"><td><b>${esc(c.employee_name)}</b><div class="esub">${esc(c.position||"")}</div></td>
        <td>${esc(c.group_name||"—")}${c.worksite?" · "+esc(c.worksite):""}</td>
        <td>${c.assigned_employee_id?`<span class="pill di">${esc(c.assigned_employee_id)}</span>`:'<span class="note" style="color:var(--muted);">unassigned</span>'}</td>
        <td><div class="barrow"><div class="bartrack"><div class="bar${pct===100?'':' def'}" style="width:${pct}%"></div></div><span style="font-size:11.5px;color:var(--muted);">${p.done}/${p.total}</span></div></td>
        <td>${c.status==="Complete"?'<span class="pill active">Complete</span>':'<span class="pill probation">In Progress</span>'}</td></tr>`;
    }).join("");
    $$("#onbRows tr").forEach(tr=>tr.addEventListener("click",()=>openOnboardingCase(tr.dataset.id)));
  }
}
function pickPrehireForOnboarding(){
  const has=new Set(ONBOARDING.map(c=>c.prehire_id).filter(Boolean));
  const eligible=PREHIRE.filter(p=>["HR_SIGNOFF","CONTRACT_SIGNING","HIRED"].includes(p.phase)&&!has.has(p.id));
  let m=document.getElementById("onbPick"); if(!m){ m=document.createElement("div"); m.id="onbPick"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;max-height:80vh;overflow-y:auto;padding:22px;">
    <h2 style="color:var(--green-dark);font-size:17px;margin-bottom:4px;">Start onboarding</h2>
    <div class="psub">Pick a candidate who has reached the contract stage:</div>
    ${eligible.length? eligible.map(p=>`<div class="task clickable" data-id="${p.id}"><div class="dot g"></div><div><div class="tt">${esc(p.full_name)}</div><div class="td">${esc(p.position||"—")} · ${esc(p.hire_source||"Direct")} · ${esc(phLabel(p.phase))}</div></div></div>`).join("")
      : '<div class="psub" style="margin-top:10px;">No pre-hires at the contract stage right now. Advance a candidate to “Ready for Contract” first.</div>'}
    <div style="display:flex;justify-content:flex-end;margin-top:14px;"><button class="btn ghost" id="onbPickClose">Close</button></div>
  </div>`;
  $("#onbPickClose").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  $$("#onbPick .task.clickable").forEach(el=>el.addEventListener("click",()=>{ m.remove(); createOnboardingCase(PREHIRE.find(p=>p.id===el.dataset.id)); }));
}
async function createOnboardingCase(pre){
  if(!pre) return;
  const grp=deriveGroup(pre.department);
  const c={ prehire_id:pre.id, employee_name:pre.full_name, group_name:grp||null, hire_source:pre.hire_source||null,
    worksite:pre.worksite||null, position:pre.position||null, deployment_date:pre.start_date||null, pay_method:"GCash", status:"In Progress" };
  const { data, error } = await sb.from("onboarding_cases").insert(c).select().single();
  if(error){ alert(error.message); return; }
  const tasks=defaultOnbTasks(data).map(t=>Object.assign({case_id:data.id},t));
  await sb.from("onboarding_tasks").insert(tasks);
  // advance the pre-hire to ONBOARDING
  if(pre.phase!=="HIRED") await sb.from("prehire").update({phase:"HIRED"}).eq("id",pre.id);
  await loadEmployees(); window.go("onboarding"); openOnboardingCase(data.id);
}
function openOnboardingCase(id){
  const c=ONBOARDING.find(x=>String(x.id)===String(id)); if(!c) return;
  const ts=tasksFor(c.id); const p=caseProgress(c.id);
  const scheme=c.group_name==="Retail"?"DISER":"RCC";
  let m=document.getElementById("onbModal"); if(!m){ m=document.createElement("div"); m.id="onbModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:580px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;">
      <div style="font-size:21px;font-weight:800;">${esc(c.employee_name)}</div>
      <div style="font-size:12.5px;opacity:.9;margin-top:3px;">${esc(c.position||"—")} · ${esc(c.group_name||"—")}${c.worksite?" · "+esc(c.worksite):""} · ${p.done}/${p.total} tasks done</div>
    </div>
    <div style="padding:18px 22px 60px;">
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi"><div class="k-l">Employee ID</div><div class="k-n" style="font-size:18px;">${c.assigned_employee_id?esc(c.assigned_employee_id):"—"}</div><div class="k-s">${scheme} scheme</div></div>
        <div class="kpi"><div class="k-l">Pay method</div><div class="k-n" style="font-size:18px;">${esc(c.pay_method||"GCash")}</div></div>
        <div class="kpi"><div class="k-l">Deployment</div><div class="k-n" style="font-size:18px;">${c.deployment_date?fmtDate(c.deployment_date):"—"}</div></div>
      </div>
      ${!c.assigned_employee_id?`<button class="btn" id="onbAssignId" style="margin-top:12px;">Assign ${scheme} Employee ID →</button>`:""}
      <div class="panel" style="margin-top:14px;"><h2>Onboarding checklist</h2>
        <div class="psub">Grouped by <b>when it's due</b> relative to the start date. Tap a task to mark it done. Bank &amp; ID set by group; iTime shows only for SM department-store hires; government registration stays early (legal deadlines).</div>
        ${ONB_TIMING_GROUPS.map(g=>{
          const items=ts.filter(t=>(ONB_TIMING[t.task_key]||"by_2nd_payroll")===g.key);
          if(!items.length) return "";
          return `<div style="margin:14px 0 4px;font-weight:700;font-size:12.5px;color:var(--green-dark);">${g.label}</div>`+
            items.map(t=>`<div class="task clickable" data-tid="${t.id}" style="cursor:pointer;">
              <div class="dot ${t.status==="Done"?"g":"a"}"></div>
              <div style="flex:1;"><div class="tt">${esc(t.label)}</div><div class="td">${esc(t.owner_role||"")}</div></div>
              <div class="due ${t.status==="Done"?"g":"a"}">${t.status==="Done"?"✓ Done":"Pending"}</div></div>`).join("");
        }).join("")}
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;">
        ${c.status!=="Complete"&&p.done===p.total&&p.total>0?'<button class="btn" id="onbComplete">Mark onboarding complete</button>':''}
        <button class="btn ghost" id="onbClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  $("#onbClose").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  const aid=document.getElementById("onbAssignId"); if(aid) aid.addEventListener("click",()=>assignEmployeeId(c));
  const cmp=document.getElementById("onbComplete"); if(cmp) cmp.addEventListener("click",()=>completeOnboarding(c));
  $$("#onbModal .task.clickable").forEach(el=>el.addEventListener("click",()=>toggleOnbTask(ts.find(t=>t.id===el.dataset.tid))));
}
async function toggleOnbTask(t){
  if(!t) return;
  const ns=t.status==="Done"?"Pending":"Done";
  const { error } = await sb.from("onboarding_tasks").update({status:ns}).eq("id",t.id);
  if(error){ alert(error.message); return; }
  await loadEmployees(); openOnboardingCase(t.case_id);
}
async function assignEmployeeId(c){
  const scheme=c.group_name==="Retail"?"DISER":"RCC";
  const { data, error } = await sb.rpc("next_employee_id",{ p_scheme:scheme });
  if(error){ alert(error.message); return; }
  await sb.from("onboarding_cases").update({assigned_employee_id:data, updated_at:new Date().toISOString()}).eq("id",c.id);
  const t=ONBTASKS.find(x=>x.case_id===c.id&&x.task_key==="employee_id");
  if(t) await sb.from("onboarding_tasks").update({status:"Done"}).eq("id",t.id);
  await loadEmployees(); window.go("onboarding"); openOnboardingCase(c.id);
}
async function completeOnboarding(c){
  await sb.from("onboarding_cases").update({status:"Complete", updated_at:new Date().toISOString()}).eq("id",c.id);
  if(c.prehire_id) await sb.from("prehire").update({phase:"HIRED", assigned_employee_id:c.assigned_employee_id}).eq("id",c.prehire_id);
  const md=document.getElementById("onbModal"); if(md) md.remove();
  await loadEmployees(); window.go("onboarding");
}

/* ============================ CONTRACTS MODULE (7-signature stepper) ============================ */
const CONTRACT_STEPS=[
  {key:"recruiter",label:"Recruiter inputs data",actor:"Recruiter",done:c=>!!c.recruiter_data_at},
  {key:"hr_salary",label:"HR adds salary",actor:"HR",done:c=>!!c.salary_entered_at},
  {key:"employee",label:"Employee signs",actor:"Employee",done:c=>!!c.employee_sign_date},
  {key:"se",label:"SE signs (sets deployment date)",actor:"Sales Coordinator",done:c=>!!c.se_date},
  {key:"supervisor",label:"Supervisor",actor:"Supervisor",done:c=>!!c.supervisor_date},
  {key:"management",label:"Management (Griselle)",actor:"Management",done:c=>!!c.mgmt_date},
  {key:"employee_id",label:"Employee ID assignment",actor:"HR",done:c=>!!c.employee_id_assigned}
];
function contractCurrentStep(c){ const i=CONTRACT_STEPS.findIndex(s=>!s.done(c)); return i<0?CONTRACT_STEPS.length:i; }
function contractDoneCount(c){ return CONTRACT_STEPS.filter(s=>s.done(c)).length; }
function deployDue(c){ if(!c.employee_sign_date) return null; const d=new Date(c.employee_sign_date); d.setDate(d.getDate()+5); return d; }
function deployDaysLeft(c){ const due=deployDue(c); if(!due) return null; return Math.ceil((due-new Date(new Date().toISOString().slice(0,10)))/86400000); }

function renderContracts(){
  const pg=$("#page-contracts"); if(!pg) return;
  const inPipe=CONTRACTS.filter(c=>contractDoneCount(c)<7 && c.stage!=="REJECTED" && !c.rejected_at);
  const awaitingMgmt=CONTRACTS.filter(c=>contractCurrentStep(c)===5).length;
  const fullyExec=CONTRACTS.filter(c=>contractDoneCount(c)===7).length;
  const deployRisk=CONTRACTS.filter(c=>{ const dl=deployDaysLeft(c); return contractCurrentStep(c)===3 && dl!=null && dl<=2; }).length;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Contracts</h2>
      <div class="psub">Seven signatures, in strict order: Recruiter → HR (salary) → Employee → SE (deployment date) → Supervisor → Management → Employee ID. A 5-day deployment window protects the candidate.</div>
      <div class="actionbar"><button class="btn" id="ctNew">+ New contract</button></div>
      <div class="grid kpis" style="grid-template-columns:repeat(4,1fr);">
        <div class="kpi"><div class="k-l">In Pipeline</div><div class="k-n">${inPipe.length}</div></div>
        <div class="kpi warn"><div class="k-l">Awaiting Management</div><div class="k-n">${awaitingMgmt}</div></div>
        <div class="kpi ${deployRisk?'alert':''}"><div class="k-l">Deployment Due ≤2d</div><div class="k-n">${deployRisk}</div><div class="k-s">5-day window</div></div>
        <div class="kpi"><div class="k-l">Fully Executed</div><div class="k-n">${fullyExec}</div></div>
      </div>
      ${CONTRACTS.length? `<table><thead><tr><th>Employee</th><th>Position</th><th>Stage</th><th>Deployment</th><th>Progress</th></tr></thead>
        <tbody id="ctRows"></tbody></table>`
        : `<div class="placeholder"><div class="pi"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#1E3A5F" stroke-width="2"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/></svg></div><h2>No contracts yet</h2><p>Click “New contract” to generate one from a pre-hire who reached “Ready for Contract”.</p></div>`}
    </div>`;
  $("#ctNew").addEventListener("click",pickPrehireForContract);
  const rows=$("#ctRows");
  if(rows){
    rows.innerHTML=CONTRACTS.map(c=>{ const dn=contractDoneCount(c); const cs=contractCurrentStep(c); const stepLbl=cs<7?CONTRACT_STEPS[cs].label:"Fully executed"; const dl=deployDaysLeft(c);
      return `<tr class="clickable" data-id="${c.id}"><td><b>${esc(c.employee_name)}</b></td><td>${esc(c.position||"—")}</td>
        <td>${c.rejected_at?'<span class="pill awol">Rejected</span>':(dn===7?'<span class="pill active">Executed</span>':esc(stepLbl))}</td>
        <td>${c.deployment_date?fmtDate(c.deployment_date):(cs===3&&dl!=null?`<span class="pill ${dl<=2?'awol':'cn'}">${dl}d to set</span>`:"—")}</td>
        <td><div class="barrow"><div class="bartrack"><div class="bar${dn===7?'':' def'}" style="width:${Math.round(dn/7*100)}%"></div></div><span style="font-size:11.5px;color:var(--muted);">${dn}/7</span></div></td></tr>`;
    }).join("");
    $$("#ctRows tr").forEach(tr=>tr.addEventListener("click",()=>openContract(tr.dataset.id)));
  }
}
function pickPrehireForContract(){
  const has=new Set(CONTRACTS.map(c=>c.prehire_id).filter(Boolean));
  const eligible=PREHIRE.filter(p=>["HR_SIGNOFF","CONTRACT_SIGNING"].includes(p.phase)&&!has.has(p.id));
  let m=document.getElementById("ctPick"); if(!m){ m=document.createElement("div"); m.id="ctPick"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;max-height:80vh;overflow-y:auto;padding:22px;">
    <h2 style="color:var(--green-dark);font-size:17px;">New contract</h2>
    <div class="psub">Pick a candidate at “Ready for Contract”:</div>
    ${eligible.length? eligible.map(p=>`<div class="task clickable" data-id="${p.id}"><div class="dot g"></div><div><div class="tt">${esc(p.full_name)}</div><div class="td">${esc(p.position||"—")} · ${esc(p.hire_source||"Direct")}</div></div></div>`).join("")
      : '<div class="psub" style="margin-top:10px;">No candidates at “Ready for Contract”. Advance a pre-hire there first.</div>'}
    <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn ghost" id="ctPickClose">Close</button></div>
  </div>`;
  $("#ctPickClose").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  $$("#ctPick .task.clickable").forEach(el=>el.addEventListener("click",()=>{ m.remove(); createContract(PREHIRE.find(p=>p.id===el.dataset.id)); }));
}
async function createContract(pre){
  if(!pre) return;
  const stamp=new Date().toISOString().slice(0,10).replace(/-/g,"");
  const c={ contract_id:"CON-"+stamp+"-"+String(Math.abs((pre.full_name||"").split("").reduce((a,ch)=>a*31+ch.charCodeAt(0),3))%1000).padStart(3,"0"),
    prehire_id:pre.id, employee_name:pre.full_name, employee_email:pre.email, position:pre.position, department:pre.department,
    group_name:deriveGroup(pre.department)||null, contract_type:pre.contract_type||"Probationary", daily_rate:pre.daily_rate||null,
    recruiter_data_at:new Date().toISOString(), stage:"hr_review" };
  const { data, error } = await sb.from("contracts").insert(c).select().single();
  if(error){ alert(error.message); return; }
  if(pre.phase!=="CONTRACT_SIGNING") await sb.from("prehire").update({phase:"CONTRACT_SIGNING", contract_id:data.contract_id}).eq("id",pre.id);
  await loadEmployees(); window.go("contracts"); openContract(data.id);
}
function openContract(id){
  const c=CONTRACTS.find(v=>String(v.id)===String(id)); if(!c) return;
  const cs=contractCurrentStep(c); const dn=contractDoneCount(c); const dl=deployDaysLeft(c);
  const scheme=c.group_name==="Retail"?"DISER":"RCC";
  let m=document.getElementById("ctModal"); if(!m){ m=document.createElement("div"); m.id="ctModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:580px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;">
      <div style="font-size:21px;font-weight:800;">${esc(c.employee_name)}</div>
      <div style="font-size:12.5px;opacity:.9;margin-top:3px;">${esc(c.position||"—")} · ${esc(c.contract_id)} · ${dn}/7 signatures</div>
    </div>
    <div style="padding:18px 22px 60px;">
      ${cs===3?`<div class="${dl!=null&&dl<0?'restrict-s':'madv'}" style="margin-top:0;">${dl!=null&&dl<0?`<b>Deployment window expired</b> — it has been more than 5 days since the employee signed. Candidate drop-off risk; set the deployment date now or log a reason.`:`<div class="madv-h">⏱ Deployment window</div><div style="font-size:12.5px;color:#5c4720;">SE must set a deployment date within <b>5 days</b> of the employee's signature${dl!=null?` — <b>${dl} day${dl===1?'':'s'} left</b>`:""}.</div>`}</div>`:""}
      <div class="panel" style="margin-top:14px;"><h2>Signature sequence</h2>
        <div class="psub">Strict order — each unlocks the next. Advance the current step only.</div>
        ${CONTRACT_STEPS.map((s,i)=>{ const done=s.done(c); const current=i===cs;
          return `<div class="task" style="align-items:center;${current?'background:var(--green-light);border-radius:8px;padding:8px 6px;':''}">
            <div style="width:24px;height:24px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;${done?'background:var(--green);color:#fff;':(current?'background:#fff;border:2px solid var(--green);color:var(--green-dark);':'background:#eef0ef;color:var(--muted);')}">${done?'✓':(i+1)}</div>
            <div style="flex:1;margin-left:10px;"><div class="tt">${s.label}</div><div class="td">${esc(s.actor)}${done?'':(current?' · current step':'')}</div></div>
            ${done?'<span class="pill active">Done</span>':(current?'':'<span class="pill" style="background:#eef0ef;color:var(--muted);">Waiting</span>')}
          </div>`;
        }).join("")}
      </div>
      ${cs===3?`<div class="panel"><h2>Set deployment date</h2><div class="psub">Required for the SE signature (within 5 days of employee signing).</div>
        <input id="ct_deploy" type="date" value="${esc(c.deployment_date||"")}" style="width:100%;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;"></div>`:""}
      ${cs===6?`<div class="panel"><h2>Employee ID</h2><div class="psub">Final step — mint the ${scheme} Employee ID, then this contract is fully executed.</div></div>`:""}
      <div id="ctMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;">
        ${dn<7&&!c.rejected_at?`<button class="btn" id="ctAdvance">${cs===6?`Assign ${scheme} ID & execute`:'Advance — '+esc(CONTRACT_STEPS[cs].label)}</button>`:(dn===7?'<span class="pill active">Fully executed ✓</span>':'')}
        ${!c.rejected_at&&dn<7?'<button class="btn ghost" id="ctReject" style="color:var(--red);border-color:#f1c9c5;">Reject</button>':''}
        <button class="btn ghost" id="ctClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  $("#ctClose").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  const adv=document.getElementById("ctAdvance"); if(adv) adv.addEventListener("click",()=>advanceContract(c,cs,m));
  const rej=document.getElementById("ctReject"); if(rej) rej.addEventListener("click",()=>{ const r=prompt("Rejection reason?"); if(r!=null) rejectContract(c,r,m); });
}
async function advanceContract(c,step,modal){
  const now=new Date().toISOString();
  let patch={updated_at:now};
  if(step===0){ patch.recruiter_data_at=now; }
  else if(step===1){ patch.salary_entered_at=now; patch.hr_review_status="Completed"; patch.hr_review_date=now; }
  else if(step===2){ patch.employee_sign_status="Signed"; patch.employee_sign_date=now; }
  else if(step===3){ const d=document.getElementById("ct_deploy"); const dv=d&&d.value; if(!dv){ document.getElementById("ctMsg").textContent="Set the deployment date first."; return; }
    const due=deployDue(c); if(due && new Date(dv) > due){ if(!confirm("Deployment date is beyond the 5-day window. Continue anyway (logged)?")) return; }
    patch.se_status="Signed"; patch.se_date=now; patch.deployment_date=dv; }
  else if(step===4){ patch.supervisor_status="Approved"; patch.supervisor_date=now; }
  else if(step===5){ patch.mgmt_status="Approved"; patch.mgmt_date=now; }
  else if(step===6){ const scheme=c.group_name==="Retail"?"DISER":"RCC"; const { data, error } = await sb.rpc("next_employee_id",{p_scheme:scheme}); if(error){ document.getElementById("ctMsg").textContent=error.message; return; } patch.employee_id_assigned=data; patch.employee_id_assigned_at=now; patch.stage="fully_executed";
    if(c.prehire_id) await sb.from("prehire").update({assigned_employee_id:data}).eq("id",c.prehire_id); }
  const { error } = await sb.from("contracts").update(patch).eq("id",c.id);
  if(error){ document.getElementById("ctMsg").textContent=error.message; return; }
  if(modal) modal.remove();
  await loadEmployees(); window.go("contracts"); openContract(c.id);
}
async function rejectContract(c,reason,modal){
  await sb.from("contracts").update({rejected_at:new Date().toISOString(), rejection_reason:reason, stage:"rejected"}).eq("id",c.id);
  if(modal) modal.remove();
  await loadEmployees(); window.go("contracts");
}

/* ============================ EXIT CLEARANCE MODULE ============================ */
const EXIT_STAGES=[
  {key:"supervisor",label:"Immediate Supervisor",s:"supervisor_status",c:"supervisor_charges",items:"Office records & documents · computer files · summary of pending work · turn-over"},
  {key:"admin",label:"Admin Services",s:"admin_status",c:"admin_charges",items:"Office equipment (laptop, cellphone) · non-consumable supplies · property accountability"},
  {key:"finance_receivables",label:"Finance — Receivables",s:"finance_receivables_status",c:"finance_receivables_charges",items:"Employee purchases balance"},
  {key:"finance_disbursement",label:"Finance — Payables / Disbursement",s:"finance_disbursement_status",c:"finance_disbursement_charges",items:"Outstanding cash advances / liquidation · other damages"},
  {key:"finance_inventory",label:"Finance — Inventory",s:"finance_inventory_status",c:"finance_inventory_charges",items:"Inventory losses"},
  {key:"finance_payroll",label:"Finance — Payroll",s:"finance_payroll_status",c:"finance_payroll_charges",items:"Office / salary / bike / educational loan balances · pending deductions"},
  {key:"accounting",label:"Accounting",s:"accounting_status",c:null,items:"Taxes / tax refund computation"},
  {key:"hr",label:"Human Resources",s:"hr_status",c:"hr_charges",items:"Company ID · HMO / health card · locker key · uniform · staff handbook · breach / 30-day notice"}
];
const HR_RETURN_ITEMS=[["id","Company ID"],["hmo_card","HMO / Health card"],["locker","Locker / cabinet keys"],["handbook","Staff handbook"],["laptop","Laptop / desktop"],["cellphone","Cellphone + charger"],["camera","Camera / devices"],["broadband","Broadband stick"],["vehicle","Company vehicle + keys"],["cards","Business cards"]];
const EXIT_INTERVIEW_Q=[
  "What prompted your decision to leave the company?",
  "What aspects of your job did you find most satisfying / challenging?",
  "How would you describe the work environment and culture?",
  "How would you rate your immediate supervisor/manager? Any team conflicts?",
  "Did you see opportunities for career growth & advancement?",
  "Overall experience (1–10) and recommendations / suggestions:"
];
const EXIT_STATUSES=["Pending","Cleared","With Charges"];
const SEPARATION_TYPES=["Resignation","End of Contract","Termination","AWOL","Retirement","Redundancy"];
function monthsBetween(a,b){ if(!a||!b) return null; const d1=new Date(a), d2=new Date(b); if(isNaN(d1)||isNaN(d2)) return null; return Math.max(0, (d2.getFullYear()-d1.getFullYear())*12 + (d2.getMonth()-d1.getMonth()) - (d2.getDate()<d1.getDate()?1:0)); }
function exitStagesDone(x){ return EXIT_STAGES.filter(s=>x[s.s]&&x[s.s]!=="Pending").length; }
function exitDeductions(x){ let d=Number(x.uniform_deduction||0); EXIT_STAGES.forEach(s=>{ if(s.c) d+=Number(x[s.c]||0); }); return d; }
function exitPayables(x){ return Number(x.outstanding_salary||0)+Number(x.sil_payment||0)+Number(x.thirteenth_month||0)+Number(x.tax_refund||0)+Number(x.pending_commission||0); }
function exitNet(x){ return exitPayables(x)-exitDeductions(x); }
const peso=(n)=>"₱"+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2});

function renderExit(){
  const pg=$("#page-exit"); if(!pg) return;
  const open=EXITCASES.filter(x=>x.overall_status!=="Complete");
  const done=EXITCASES.filter(x=>x.overall_status==="Complete").length;
  const charges=EXITCASES.filter(x=>EXIT_STAGES.some(s=>x[s.s]==="With Charges")).length;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Exit Clearance</h2>
      <div class="psub">Multi-department sign-off + lawful final-pay computation. On completion, the employee's status flips to Separated. Uniform cost (&lt;6 months) only deducts where the signed contract authorizes it (Art. 113).</div>
      <div class="actionbar"><button class="btn" id="exNew">+ New exit clearance</button></div>
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi"><div class="k-l">In Progress</div><div class="k-n">${open.length}</div></div>
        <div class="kpi warn"><div class="k-l">With Charges</div><div class="k-n">${charges}</div><div class="k-s">a dept flagged a charge</div></div>
        <div class="kpi"><div class="k-l">Completed</div><div class="k-n">${done}</div></div>
      </div>
      ${EXITCASES.length? `<table><thead><tr><th>Employee</th><th>Last day · Tenure</th><th>Separation</th><th>Sign-offs</th><th>Net pay</th><th>Status</th></tr></thead>
        <tbody id="exRows"></tbody></table>`
        : `<div class="placeholder"><div class="pi"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#1E3A5F" stroke-width="2"><path d="M14 3H5v18h9"/><path d="M10 12h11M17 8l4 4-4 4"/></svg></div><h2>No exit clearances yet</h2><p>Click “New exit clearance” to start an employee's offboarding.</p></div>`}
    </div>`;
  $("#exNew").addEventListener("click",pickEmployeeForExit);
  const rows=$("#exRows");
  if(rows){
    rows.innerHTML=EXITCASES.map(x=>{ const dn=exitStagesDone(x); const t=x.tenure_months;
      const age=(x.overall_status!=="Complete" && x.created_at)?Math.floor((Date.now()-new Date(x.created_at).getTime())/86400000):null;
      const ageTag=age!=null?` <span style="font-size:11px;font-weight:700;color:${age>30?'var(--red)':'var(--muted)'};">· ${age}d open${age>30?' ⚠':''}</span>`:"";
      return `<tr class="clickable" data-id="${x.id}"><td><b>${esc(x.employee_name)}</b><div class="esub">${esc(x.position||"")}</div></td>
        <td>${x.last_working_day?fmtDate(x.last_working_day):"—"}${t!=null?` · ${t} mo`:""}</td>
        <td>${esc(x.separation_type||"—")}</td>
        <td><div class="barrow"><div class="bartrack"><div class="bar${dn===8?'':' def'}" style="width:${Math.round(dn/8*100)}%"></div></div><span style="font-size:11.5px;color:var(--muted);">${dn}/8</span></div></td>
        <td><b>${peso(exitNet(x))}</b></td>
        <td>${x.overall_status==="Complete"?'<span class="pill closed">Separated</span>':'<span class="pill probation">In Progress</span>'+ageTag}</td></tr>`;
    }).join("");
    $$("#exRows tr").forEach(tr=>tr.addEventListener("click",()=>openExitCase(tr.dataset.id)));
  }
}
function pickEmployeeForExit(){
  const active=EMPLOYEES.filter(e=>e.status==="Active").slice().sort((a,b)=>a.full_name.localeCompare(b.full_name));
  let m=document.getElementById("exPick"); if(!m){ m=document.createElement("div"); m.id="exPick"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;max-height:80vh;overflow-y:auto;padding:22px;">
    <h2 style="color:var(--green-dark);font-size:17px;">Start exit clearance</h2>
    <div class="psub">Search and pick the separating employee:</div>
    <input id="exPickSearch" class="search" style="width:100%;margin:10px 0;" placeholder="Search name…">
    <div id="exPickList"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn ghost" id="exPickClose">Close</button></div>
  </div>`;
  const paint=()=>{ const q=($("#exPickSearch").value||"").toLowerCase();
    $("#exPickList").innerHTML=active.filter(e=>e.full_name.toLowerCase().includes(q)).slice(0,40).map(e=>`<div class="task clickable" data-id="${e.id}"><div class="dot a"></div><div><div class="tt">${esc(e.full_name)}</div><div class="td">${esc(e.position||"—")} · ${esc(e.group_name||"—")}</div></div></div>`).join("");
    $$("#exPickList .task.clickable").forEach(el=>el.addEventListener("click",()=>{ m.remove(); createExitCase(EMPLOYEES.find(e=>e.id===el.dataset.id)); }));
  };
  $("#exPickSearch").addEventListener("input",paint); paint();
  $("#exPickClose").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
}
async function createExitCase(emp){
  if(!emp) return;
  const today=new Date().toISOString().slice(0,10);
  const tenure=monthsBetween(emp.hire_date, today);
  const stamp=today.replace(/-/g,"");
  const c={ clearance_id:"EXIT-"+stamp+"-"+String(Math.abs(emp.full_name.split("").reduce((a,ch)=>a*31+ch.charCodeAt(0),5))%1000).padStart(3,"0"),
    employee_id:emp.id, employee_name:emp.full_name, position:emp.position, department:emp.department,
    hire_date:emp.hire_date||null, last_working_day:today, tenure_months:tenure, separation_type:"Resignation",
    overall_status:"In Progress" };
  EXIT_STAGES.forEach(s=>{ c[s.s]="Pending"; });
  const { data, error } = await sb.from("exit_clearance").insert(c).select().single();
  if(error){ alert(error.message); return; }
  await loadEmployees(); window.go("exit"); openExitCase(data.id);
}
function exNumField(id,label,val){ return `<div style="margin-bottom:8px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px;">${label}</label><input id="${id}" type="number" step="0.01" value="${val??""}" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;font-size:13.5px;"></div>`; }
function openExitCase(id){
  const x=EXITCASES.find(v=>String(v.id)===String(id)); if(!x) return;
  const t=x.tenure_months; const under6=t!=null&&t<6;
  let m=document.getElementById("exModal"); if(!m){ m=document.createElement("div"); m.id="exModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:600px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;">
      <div style="font-size:21px;font-weight:800;">${esc(x.employee_name)}</div>
      <div style="font-size:12.5px;opacity:.9;margin-top:3px;">${esc(x.position||"—")} · ${esc(x.department||"—")} · ${esc(x.clearance_id)}</div>
    </div>
    <div style="padding:18px 22px 60px;">
      <div class="panel" style="margin-top:0;"><h2>Separation</h2>
        <div class="form-grid">
          <div style="margin-bottom:8px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">Last working day</label><input id="ex_lwd" type="date" value="${esc(x.last_working_day||"")}" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;"></div>
          <div style="margin-bottom:8px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">Separation type</label><select id="ex_septype" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;background:#fff;">${opt(SEPARATION_TYPES,x.separation_type)}</select></div>
        </div>
        <div class="psub">Tenure: <b>${t!=null?t+" months":"—"}</b>${under6?' · <span style="color:var(--red);font-weight:700;">under 6 months</span>':""}</div>
      </div>

      <div class="panel"><h2>Department sign-offs <span class="count-tag">${exitStagesDone(x)}/8 cleared</span></h2>
        <div class="psub">Each department clears its items (per RCC's Exit Clearance form) and flags any charges.</div>
        ${EXIT_STAGES.map(s=>`<div class="task" style="align-items:flex-start;">
          <div class="dot ${x[s.s]==='Cleared'?'g':(x[s.s]==='With Charges'?'r':'a')}" style="margin-top:6px;"></div>
          <div style="flex:1;min-width:0;"><div class="tt">${s.label}</div><div class="td">${s.items||''}</div></div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <select data-stage="${s.s}" style="padding:5px 8px;border:1px solid var(--line);border-radius:6px;font-size:12px;background:#fff;">${opt(EXIT_STATUSES,x[s.s]||"Pending")}</select>
            ${s.c?`<input data-charge="${s.c}" type="number" step="0.01" placeholder="₱" value="${x[s.c]??""}" style="width:84px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;font-size:12px;">`:''}
          </div>
        </div>`).join("")}
      </div>

      <div class="panel"><h2>Property to return</h2>
        <div class="psub">Tick only what was <b>actually issued</b> to this employee (issuance varies per person). <b>Uniform is not collected back</b> — its cost is handled by the &lt;6-month rule below. Cash advances / loan balances settle under the Finance sign-offs above.</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px 18px;">
          ${HR_RETURN_ITEMS.map(([k,lbl])=>`<label style="font-size:13px;"><input type="checkbox" data-return="${k}" ${(x.hr_returns&&x.hr_returns[k])?"checked":""}> ${esc(lbl)}</label>`).join("")}
        </div>
        <div style="margin-top:10px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">Other issued items / advances (specify)</label><input id="ex_other_return" value="${esc((x.hr_returns&&x.hr_returns.other)||"")}" placeholder="e.g. cellphone model, cash advance ₱___, tools, SIM…" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px;font-size:13.5px;"></div>
      </div>

      ${under6?`<div class="madv"><div class="madv-h">⚖️ Uniform cost — tenure under 6 months</div>
        <div style="font-size:12.5px;color:#5c4720;">The uniform is kept by the employee (not collected back), so its cost is recoverable for under-6-month tenure — lawful <b>only with the employee's signed authorization</b> (the employment-contract clause, Art. 113) and never below minimum wage.</div>
        <div style="margin-top:8px;">
          <label style="font-size:12.5px;"><input type="checkbox" id="ex_uniform_auth" ${x.uniform_auth_on_file?"checked":""}> Signed authorization on file (contract clause)</label>
        </div>
        ${exNumField("ex_uniform_deduction","Uniform cost to deduct (₱)",x.uniform_deduction)}
        </div>`:""}

      <div class="panel"><h2>Final pay computation</h2>
        <div class="psub">Amounts owed to the employee, less lawful deductions. (Salary is entered manually — not stored as a queryable field.)</div>
        <div class="form-grid">
          ${exNumField("ex_outstanding_salary","Outstanding salary",x.outstanding_salary)}
          ${exNumField("ex_sil_payment","SIL conversion",x.sil_payment)}
          ${exNumField("ex_thirteenth_month","13th-month pro-rata",x.thirteenth_month)}
          ${exNumField("ex_tax_refund","Tax refund",x.tax_refund)}
          ${exNumField("ex_pending_commission","Pending commission",x.pending_commission)}
        </div>
        <div id="ex_netbox" style="background:var(--green-light);border-radius:9px;padding:12px 14px;margin-top:6px;font-size:13.5px;"></div>
      </div>

      <div class="panel"><h2>Closeout</h2>
        <div class="task" style="align-items:center;"><div class="dot ${x.exit_interview_done?'g':'a'}"></div>
          <div style="flex:1;"><div class="tt">Exit interview</div><div class="td">${x.exit_interview_done?'Completed ✓':'6-question RCC exit interview'}</div></div>
          <button class="btn ghost" id="ex_interview_btn" style="flex-shrink:0;">${x.exit_interview_done?'View / edit':'Conduct interview'}</button></div>
        <div style="border:1px solid ${x.hmo_notified_at?'var(--green)':'#f0c14b'};border-radius:9px;padding:11px 13px;margin:8px 0;background:${x.hmo_notified_at?'var(--green-light)':'#fffaf0'};">
          <div style="font-weight:700;font-size:13.5px;">HMO delisting ${x.hmo_notified_at?`<span style="color:var(--green-dark);">✓ notified ${fmtDate(x.hmo_notified_at)}</span>`:`<span style="color:#9a6a00;">— not yet sent</span>`}</div>
          <div class="td" style="margin:3px 0 8px;">Tell ${esc(HMO_NAME)} to remove this employee, or coverage keeps billing.</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn ghost" id="ex_hmo_email" type="button">✉️ Email HMO to delist</button>
            <button class="btn ghost" id="ex_hmo_mark" type="button">${x.hmo_notified_at?"Undo notified":"Mark HMO notified"}</button>
          </div>
        </div>
        <label style="display:block;font-size:13px;margin:5px 0;"><input type="checkbox" id="ex_coe" ${x.coe_issued?"checked":""}> Certificate of Employment issued <span style="color:var(--muted);">(DOLE: within 3 days of request)</span></label>
        <label style="display:block;font-size:13px;margin:5px 0;"><input type="checkbox" id="ex_quitclaim" ${x.quitclaim_signed?"checked":""}> Quitclaim / release &amp; waiver signed by employee <span style="color:var(--muted);">(on receipt of final pay — keep their signed copy)</span></label>
      </div>

      <div id="exMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;">
        <button class="btn" id="exSave">Save</button>
        ${x.overall_status!=="Complete"?'<button class="btn blue" id="exComplete">Complete &amp; mark Separated</button>':'<span class="pill closed">Separated</span>'}
        <button class="btn ghost" id="exClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  const recompute=()=>{
    const tmp=collectExit(x);
    $("#ex_netbox").innerHTML=`Payables <b>${peso(exitPayables(tmp))}</b> − Deductions <b>${peso(exitDeductions(tmp))}</b> = <b style="color:var(--green-dark);font-size:15px;">Net ${peso(exitNet(tmp))}</b>`;
  };
  m.querySelectorAll("input,select").forEach(el=>el.addEventListener("input",recompute));
  recompute();
  $("#exClose").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  $("#exSave").addEventListener("click",()=>saveExitCase(x,m,false));
  const cmp=document.getElementById("exComplete"); if(cmp) cmp.addEventListener("click",()=>saveExitCase(x,m,true));
  document.getElementById("ex_interview_btn").addEventListener("click",()=>openExitInterview(x));
  const hmoEmailBtn=document.getElementById("ex_hmo_email");
  if(hmoEmailBtn) hmoEmailBtn.addEventListener("click",()=>{
    const lwd=x.last_working_day?fmtDate(x.last_working_day):"(last working day)";
    const subject="HMO delisting request — "+x.employee_name;
    const body="Hello "+HMO_NAME+",\n\nPlease remove the following employee from our HMO coverage, effective their last working day:\n\nName: "+x.employee_name+"\nPosition: "+(x.position||"—")+"\nLast working day: "+lwd+"\nSeparation type: "+(x.separation_type||"—")+"\n\nKindly confirm once the delisting is done.\n\nThank you,\nRCC HR";
    window.location.href="mailto:"+HMO_EMAIL+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
  });
  const hmoMarkBtn=document.getElementById("ex_hmo_mark");
  if(hmoMarkBtn) hmoMarkBtn.addEventListener("click",async()=>{
    hmoMarkBtn.disabled=true;
    const patch=x.hmo_notified_at?{hmo_notified_at:null,hmo_notified_by:null}
      :{hmo_notified_at:new Date().toISOString(),hmo_notified_by:(CURRENT_USER&&CURRENT_USER.email)||"HR"};
    const {error}=await sb.from("exit_clearance").update(patch).eq("id",x.id);
    if(error){ alert(error.message); hmoMarkBtn.disabled=false; return; }
    await loadEmployees(); openExitCase(x.id);
  });
}
function openExitInterview(x){
  const ei=x.exit_interview||{};
  let m=document.getElementById("eiModal"); if(!m){ m=document.createElement("div"); m.id="eiModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.5);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:600px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;"><div style="font-size:20px;font-weight:800;">Exit Interview — ${esc(x.employee_name)}</div><div style="font-size:12.5px;opacity:.85;">${esc(x.position||"—")} · ${esc(x.department||"—")} · last day ${x.last_working_day?fmtDate(x.last_working_day):"—"}</div></div>
    <div style="padding:18px 22px 50px;"><div class="panel" style="margin-top:0;">
      <div class="psub">RCC's 6-question exit interview. Answers are saved with the clearance.</div>
      ${EXIT_INTERVIEW_Q.map((q,i)=>`<div style="margin:12px 0;"><label style="display:block;font-size:13px;font-weight:600;color:var(--ink);margin-bottom:5px;">${i+1}. ${esc(q)}</label><textarea id="ei_q${i}" rows="${i===5?3:2}" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;font-size:13.5px;">${esc(ei["q"+i]||"")}</textarea></div>`).join("")}
      <div id="eiMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
      <div style="display:flex;gap:10px;"><button class="btn ghost" id="eiCancel" style="flex:1;">Cancel</button><button class="btn" id="eiSave" style="flex:1;">Save interview</button></div>
    </div></div></div>`;
  document.getElementById("eiCancel").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  document.getElementById("eiSave").addEventListener("click",async()=>{
    const ans={}; EXIT_INTERVIEW_Q.forEach((q,i)=>{ ans["q"+i]=document.getElementById("ei_q"+i).value.trim(); });
    const { error } = await sb.from("exit_clearance").update({exit_interview:ans, exit_interview_done:true, updated_at:new Date().toISOString()}).eq("id",x.id);
    if(error){ document.getElementById("eiMsg").textContent=error.message; return; }
    m.remove(); const xm=document.getElementById("exModal"); if(xm) xm.remove();
    await loadEmployees(); window.go("exit");
  });
}
function collectExit(x){
  const m=document.getElementById("exModal");
  const num=(id)=>{ const e=m.querySelector("#"+id); return e&&e.value.trim()!==""?Number(e.value):0; };
  const o={ last_working_day:m.querySelector("#ex_lwd").value||null, separation_type:m.querySelector("#ex_septype").value,
    outstanding_salary:num("ex_outstanding_salary"), sil_payment:num("ex_sil_payment"), thirteenth_month:num("ex_thirteenth_month"),
    tax_refund:num("ex_tax_refund"), pending_commission:num("ex_pending_commission"),
    uniform_deduction:num("ex_uniform_deduction"),
    uniform_auth_on_file:!!(m.querySelector("#ex_uniform_auth")&&m.querySelector("#ex_uniform_auth").checked),
    hmo_cancelled:!!(m.querySelector("#ex_hmo")&&m.querySelector("#ex_hmo").checked), coe_issued:m.querySelector("#ex_coe").checked,
    quitclaim_signed:!!(m.querySelector("#ex_quitclaim")&&m.querySelector("#ex_quitclaim").checked) };
  const ret={}; m.querySelectorAll("[data-return]").forEach(el=>{ ret[el.dataset.return]=el.checked; });
  const otherEl=m.querySelector("#ex_other_return"); if(otherEl) ret.other=otherEl.value.trim();
  o.hr_returns=ret;
  m.querySelectorAll("[data-stage]").forEach(el=>{ o[el.dataset.stage]=el.value; });
  m.querySelectorAll("[data-charge]").forEach(el=>{ o[el.dataset.charge]=el.value.trim()!==""?Number(el.value):0; });
  if(o.last_working_day) o.tenure_months=monthsBetween(x.hire_date,o.last_working_day);
  return o;
}
async function saveExitCase(x,modal,complete){
  const o=collectExit(x);
  // fairness guard: uniform deduction needs signed authorization
  if(Number(o.uniform_deduction||0)>0 && !o.uniform_auth_on_file){
    document.getElementById("exMsg").textContent="Uniform deduction requires the signed authorization (contract clause) on file — tick the box or set the deduction to 0.";
    return;
  }
  // a department flagged "With Charges" but entered no amount → ambiguous/unfair; require the figure
  const badCharge=EXIT_STAGES.find(s=>s.c && o[s.s]==="With Charges" && !(Number(o[s.c])>0));
  if(badCharge){
    document.getElementById("exMsg").textContent=`“${badCharge.label}” is marked With Charges but has no amount — enter the charge (₱) or change its status.`;
    return;
  }
  o.total_payable=exitPayables(o); o.total_deductions=exitDeductions(o); o.net_payable=exitNet(o); o.updated_at=new Date().toISOString();
  if(complete){ o.overall_status="Complete"; o.completion_date=new Date().toISOString(); }
  const { error } = await sb.from("exit_clearance").update(o).eq("id",x.id);
  if(error){ document.getElementById("exMsg").textContent=error.message; return; }
  if(complete && x.employee_id){
    const er=o.separation_type==="AWOL"?"AWOL":(o.separation_type==="Termination"?"Terminated":(o.separation_type==="End of Contract"?"End of Contract":(o.separation_type==="Retirement"?"Retired":"Resigned")));
    await sb.from("employees").update({status:"Separated", end_date:o.last_working_day, end_reason:er}).eq("id",x.employee_id);
  }
  if(modal) modal.remove();
  await loadEmployees(); window.go("exit");
}

init();
