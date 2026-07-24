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
let SC_STATUS={};  // sc_name -> {status:'Active'|'Vacant'|'Pending', note}
let MATERNITY=[];  // maternity_claims rows
let NPAS=[];       // personnel_actions rows (Movements / NPA module)
let POLICIES=[];      // policies rows (Policies & Processes group)
let CONCERNS=[];      // arbitration / ongoing legal cases (Concerns Tracker — Director only)
let DEPT_HEADS=[];    // department_heads — HRIS-owned org structure (dept → head employee); editable by Rhel/admins in Org Chart
let TRANSFERS=[];     // employee_transfers — SC-requested store transfers/deployments w/ store-head before+after confirmation
let SC_LINKS=[];      // sc_links — per-SC private transfer-request tokens (cascade to their people + anti-tamper)
let POSITION_PROFILES=[]; // position_profiles — per-position Job Description / Key Tasks / Deliverables / Reports-To (HRIS-owned, fill once per role)
let POLICY_ACKS=[];   // policy_acknowledgments rows (read-and-sign roster)
let PROCESSES=[];     // processes rows (SOPs)
let MEETINGS=[];   // meeting_attendance rows (merchandiser meeting sign-in + reimbursement)
let MEETING_ROSTER=[]; // meeting_roster rows (who was EXPECTED at each meeting; snapshot of active merchandisers)
let AGENCY_PAYROLL=[];  // agency_payroll rows (M&G / Jell-On real pay + contributions from payroll files)
let HR_NOTES=[];   // hr_notes — personal sticky notes (private per HR user)
let HR_IDEAS=[];   // hr_ideas — suggestion pool routed to the Director (anj)
let HR_TASKS=[];   // hr_tasks — assignable pending tasks with owner + due date
let EXT_SIGNOFFS=[];  // external_signoffs — no-login e-sign links for non-portal signers (e.g. SC in charge on an exit)
// The HR team, for task assignment + name display. Email → display name.
const HR_TEAM=[
  {email:"anj@hassarams.com", name:"Anj (Director)"},
  {email:"sanjay@hassarams.com", name:"Sanjay"},
  {email:"hr4@hassarams.com", name:"Rhel (HR Manager)"},
  {email:"hr3@hassarams.com", name:"Grazel (Payroll)"},
  {email:"hr@hassarams.com", name:"Juvy (HR Relations)"},
  {email:"hr2@hassarams.com", name:"Vina (Recruitment)"},
  {email:"richard@hassarams.com", name:"Richard (IT)"}
];
function myEmail(){ return ((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase(); }
function nameForEmail(e){ const m=HR_TEAM.find(x=>x.email===((e||"").toLowerCase())); return m?m.name:(e||"—"); }
function myName(){ return nameForEmail(myEmail()); }
// Latest agency payroll row for an employee/diser id (handles the "500002.0" float form)
function agencyPayFor(id){ if(!id) return null; const key=String(id).replace(/\.0$/,""); const rows=AGENCY_PAYROLL.filter(r=>String(r.emp_no).replace(/\.0$/,"")===key); if(!rows.length) return null; return rows.sort((a,b)=>String(b.cutoff||"").localeCompare(String(a.cutoff||"")))[0]; }
let MEETING_CFG={}; // system_settings: meeting_active / meeting_allowed_ips / meeting_require_selfie
const MEETING_FN="https://jtfkpmvievetihhfdmqb.supabase.co/functions/v1/meeting-signin";
const MEETING_SIGNIN_URL="https://agenovi.github.io/rcc-hris-portal/meeting.html";
function scStatus(sc){ return (SC_STATUS[sc]&&SC_STATUS[sc].status)||"Active"; }
function scIsGone(sc){ const s=scStatus(sc); return s==="Vacant"||s==="Pending"; }
async function setScStatus(sc,status,note){
  SC_STATUS[sc]={sc_name:sc,status,note:note||null};
  await sb.from("sc_status").upsert({ sc_name:sc, status, note:note||null, updated_at:new Date().toISOString() }, { onConflict:"sc_name" });
  await logChange("coordinator",null,sc,status==="Active"?"Coordinator restored":"Coordinator "+status.toLowerCase(),note||"");
}
async function logChange(entity,id,name,action,detail){
  try{ await sb.from("change_log").insert({ entity, entity_id:id||null, entity_name:name||null, action, detail:detail||null, changed_by:(CURRENT_USER&&CURRENT_USER.email)||"unknown" }); }catch(e){}
}
// Who may see salary / bank / government IDs. Locked to anj for now (add more emails here when decided).
// Access roles by login:
//   admin    (anj)    = everything
//   payroll  (Grazel) = recruiting view + Employees + sees pay/bank/government
//   recruiter(others) = recruiting only, pay hidden
const ROLE_BY_EMAIL={ "anj@hassarams.com":"admin", "sanjay@hassarams.com":"admin", "hr3@hassarams.com":"payroll", "hr4@hassarams.com":"manager", "hr@hassarams.com":"relations", "richard@hassarams.com":"manager", "claude.test@hassarams.com":"admin" };  // hr3@=Grazel(payroll) · hr4@=Rhel(HR Manager) · hr@=Juvy(HR Relations) · richard@=IT reviewer (manager view, salary masked)
function userRole(){ return ROLE_BY_EMAIL[((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase()] || "recruiter"; }
function isAdminUser(){ return userRole()==="admin"; }
function canSeePay(){ const r=userRole(); return r==="admin"||r==="payroll"; }
// Gov IDs (SSS/PhilHealth/Pag-IBIG/TIN) + bank: VIEWABLE by all logged-in HR, but ENTERED/EDITED by ONE person only — Vina (anj call, 2026-07-17), so there's a single source of truth for these numbers. Owners retain override. Salary stays payroll-only via canSeePay().
function canSeeIds(){ return !!CURRENT_USER; }
const IDS_EDITOR="hr2@hassarams.com";      // Vina — primary bank/gov data-entry
const IDS_EDITOR_BACKUP="hr3@hassarams.com"; // Grazel — backup encoder (anj, 2026-07-17)
function canEditIds(){ const e=((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase(); return isAdminUser()||e===IDS_EDITOR||e===IDS_EDITOR_BACKUP; }
function roField(label,val){ return `<div class="efield"><div class="el">${esc(label)}</div><div class="ev">${val?esc(val):'<span class="note">—</span>'}</div></div>`; }
function isLimitedUser(){ return userRole()!=="admin"; }
function canManageStores(){ const r=userRole(); return r==="admin"||r==="payroll"||r==="manager"; }  // Anj + Grazel + Rhel (HR Mgr) — add/edit/close STORES
// Posting/editing OPENINGS = Recruitment owns it too (anj, 2026-07-17, per Grazel's note). Anyone with the Manning page except HR-Relations.
function canPostOpenings(){ const r=userRole(); return r==="admin"||r==="payroll"||r==="manager"||r==="recruiter"; }
// Merchandiser meeting attendance + reimbursement = Anj + Grazel(payroll) + Rhel(manager) + Vina(hr2, builds the bank report)
function canRunMeetings(){ const r=userRole(); const e=((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase(); return r==="admin"||r==="payroll"||r==="manager"||e===IDS_EDITOR; }
// Only owners/payroll edit the meeting settings (open/close, venue-IP lock); Vina/Rhel operate + export
function canConfigMeetings(){ const r=userRole(); return r==="admin"||r==="payroll"; }
// Personnel Movement / NPA module = Anj + Grazel(payroll) + Rhel(manager) — the people who prepare/route/approve movements.
function canSeeMovements(){ const r=userRole(); return r==="admin"||r==="payroll"||r==="manager"; }
// Concerns & Cases (arbitration / legal-labor matters) = Anj/Sanjay (admin) + Juvy (HR Relations, hr@) + Rhel (HR Manager, hr4@) — they handle these. Explicit emails on purpose: Richard (also "manager", IT reviewer) is excluded.
function canSeeConcerns(){ const e=((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase(); return isAdminUser()||e==="hr@hassarams.com"||e==="hr4@hassarams.com"; }
// Org Chart editing = admins + Rhel (HR Manager, hr4@). Reporting lines / dept heads are HRIS-owned org structure (NOT the PayPlus roster), so they're safe to edit here. Everyone else = read-only.
function canEditOrg(){ return isAdminUser() || ((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase()==="hr4@hassarams.com"; }
const RECRUITER_PAGES=["dashboard","manning","prehire","onboarding","reports"];
// HR Relations (Juvy) — employee-relations desk: onboarding→exit lifecycle, discipline/compliance, notices, loans/benefits. NO salary, NO recruiting funnel.
const RELATIONS_PAGES=["dashboard","onboarding","evaluations","exit","compliance","memos","signatures","loans","timekeeping"];
// HR Manager (Rhel) — oversees the whole department: every page except owner-only Settings.
const MANAGER_PAGES=["dashboard","employees","branches","prehire","contracts","onboarding","evaluations","loans","exit","manning","compliance","signatures","memos","reports","timekeeping"];
// Per-person extra pages on top of their role. Vina = sole bank/gov encoder → needs the Employees directory to enter/correct those numbers (salary stays masked for her).
const EXTRA_PAGES_BY_EMAIL={ "hr2@hassarams.com":["employees"] };
function allowedPages(){ const r=userRole(); if(r==="admin") return null;
  let base;
  if(r==="manager") base = MANAGER_PAGES.slice();
  else if(r==="payroll") base = RECRUITER_PAGES.concat(["employees","timekeeping"]);
  else if(r==="relations") base = RELATIONS_PAGES.slice();
  else base = RECRUITER_PAGES.slice();
  const extra = EXTRA_PAGES_BY_EMAIL[((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase()]||[];
  return base.concat(extra); }
function pageAllowed(id){ if(id==='parking') return ((CURRENT_USER&&CURRENT_USER.email)||'').toLowerCase()==='anj@hassarams.com'; if(id==='activity') return isAdminUser(); if(id==='demodata') return isAdminUser(); if(id==='concerns') return canSeeConcerns(); if(id==='maternity') return canSeePay(); if(id==='meetings') return canRunMeetings(); if(id==='movements') return canSeeMovements(); if(id==='govremit') return canEditIds(); if(id==='policies'||id==='processes'||id==='desk'||id==='storemap'||id==='orgchart'||id==='positions'||id==='links') return !!CURRENT_USER; const a=allowedPages(); return !a || a.indexOf(id)!==-1; }
// Policies & Processes = reference library: every logged-in HR VIEWS; only admin/manager create/edit.
function canEditPolicies(){ const r=userRole(); return r==="admin"||r==="manager"; }
window.isLimitedUser=isLimitedUser; window.pageAllowed=pageAllowed;
function applyRoleUI(){
  const allow=allowedPages(), limited=isLimitedUser();
  document.querySelectorAll('.nav-item[data-page]').forEach(n=>{
    const pg=n.getAttribute('data-page');
    if(pg==='parking'){ n.style.display=(((CURRENT_USER&&CURRENT_USER.email)||'').toLowerCase()==='anj@hassarams.com')?'':'none'; return; }  // Parking Lot = anj only
    if(pg==='activity'){ n.style.display=isAdminUser()?'':'none'; return; }  // Access & Activity = owners only
    if(pg==='demodata'){ n.style.display=isAdminUser()?'':'none'; return; } // Demo Data sandbox = owners only
    if(pg==='maternity'){ n.style.display=canSeePay()?'':'none'; return; }   // Maternity = salary viewers (Anj/Sanjay/Grazel)
    if(pg==='meetings'){ n.style.display=canRunMeetings()?'':'none'; return; } // Meetings = Anj/Grazel/Rhel/Vina
    if(pg==='movements'){ n.style.display=canSeeMovements()?'':'none'; return; } // Movements/NPA = Anj/Grazel/Rhel
    if(pg==='govremit'){ n.style.display=canEditIds()?'':'none'; return; } // Gov't Remittances = gov-ID owners (Anj/Vina/Grazel)
    if(pg==='concerns'){ n.style.display=canSeeConcerns()?'':'none'; return; } // Concerns & Cases = Anj + Juvy (hr@) + Rhel (hr4@) — they handle arbitration/legal
    if(pg==='policies'||pg==='processes'||pg==='desk'||pg==='orgchart'||pg==='positions'||pg==='links'){ n.style.display=CURRENT_USER?'':'none'; return; } // Policies, Processes, HR Desk, Org Chart, Positions & JD, Links = every logged-in HR
    n.style.display=(allow&&allow.indexOf(pg)===-1)?'none':'';
  });
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
// Talent Pool — filters for the pooled-candidates list
let poolFilterPos="", poolFilterScale="", poolFilterPrio="", poolSearch="";
// Salary scales are one-line editable — tell Claude to change them and they update everywhere.
const POOL_SALARY_SCALES=["Entry / minimum wage","Daily ₱650–800","Daily ₱800–1,000","Monthly ₱15–20k","Monthly ₱20–30k","Monthly ₱30k+","Not specified"];
const POOL_PRIORITIES=["High","Medium","Low"];
const POOL_PRIO_RANK={High:0,Medium:1,Low:2};
let landed=false;

/* ---------- AUTH ---------- */
async function init(){
  const { data:{session} } = await sb.auth.getSession();
  if(session) showResumeGate(session.user); else $("#login").style.display="flex";
  sb.auth.onAuthStateChange((_e,s)=>{ if(_e==='SIGNED_OUT'){ location.reload(); } });
}
// When a saved session exists (shared device), confirm identity before entering —
// prevents landing in / signing documents under the wrong person's account.
function showResumeGate(user){
  const email=(user.email||"");
  const name=email.split("@")[0];
  $("#login").style.display="flex";
  const lc=$("#loginCard"), rc=$("#resumeCard");
  if(!rc){ showApp(user); return; }            // fallback if markup missing
  if(lc) lc.style.display="none";
  rc.style.display="block";
  $("#resumeName").textContent=name;
  $("#resumeEmail").textContent=email;
  $("#resumeContinue").onclick=()=>{ rc.style.display="none"; showApp(user); };
  $("#resumeSwitch").onclick=async ()=>{ await sb.auth.signOut(); };  // SIGNED_OUT → reload → login form
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
  try{ sb.rpc("touch_presence"); }catch(e){}  // stamp real last-active (updates even on a resumed session, unlike last_sign_in_at)
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
  const [emp, br, di, ph, oc, ot, ex, ct, pd, cm, ln, mr, sg, cf, me, evl, clg, scs, mcl, mtg, sysset, apay, npa, pol, pack, proc, mros, hnotes, hideas, htasks, xso, cncrn, trf, scl, dh, ppf] = await Promise.all([
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
    sb.from("change_log").select("*").order("created_at", {ascending:false}).limit(500),
    sb.from("sc_status").select("*"),
    sb.from("maternity_claims").select("*").order("created_at", {ascending:false}),
    sb.from("meeting_attendance").select("*").order("signed_in_at", {ascending:false}),
    sb.from("system_settings").select("*"),
    sb.from("agency_payroll").select("*").order("cutoff", {ascending:false}),
    sb.from("personnel_actions").select("*").order("created_at", {ascending:false}),
    sb.from("policies").select("*").order("title"),
    sb.from("policy_acknowledgments").select("*").order("acknowledged_at", {ascending:false}),
    sb.from("processes").select("*").order("title"),
    sb.from("meeting_roster").select("*"),
    sb.from("hr_notes").select("*").order("created_at", {ascending:false}),
    sb.from("hr_ideas").select("*").order("created_at", {ascending:false}),
    sb.from("hr_tasks").select("*").order("created_at", {ascending:false}),
    sb.from("external_signoffs").select("*").order("created_at", {ascending:false}),
    sb.from("concerns").select("*").order("created_at", {ascending:false}),
    sb.from("employee_transfers").select("*").order("created_at", {ascending:false}),
    sb.from("sc_links").select("*").order("sc_name"),
    sb.from("department_heads").select("*"),
    sb.from("position_profiles").select("*")
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
  SC_STATUS={}; ((scs&&scs.data)||[]).forEach(r=>{ SC_STATUS[r.sc_name]=r; });
  MATERNITY=(mcl&&mcl.data)||[];
  MEETINGS=(mtg&&mtg.data)||[];
  MEETING_ROSTER=(mros&&mros.data)||[];
  MEETING_CFG={}; ((sysset&&sysset.data)||[]).forEach(r=>{ MEETING_CFG[r.key]=r.value; });
  AGENCY_PAYROLL=(apay&&apay.data)||[];
  NPAS=(npa&&npa.data)||[];
  POLICIES=(pol&&pol.data)||[];
  POLICY_ACKS=(pack&&pack.data)||[];
  PROCESSES=(proc&&proc.data)||[];
  HR_NOTES=(hnotes&&hnotes.data)||[];
  HR_IDEAS=(hideas&&hideas.data)||[];
  HR_TASKS=(htasks&&htasks.data)||[];
  EXT_SIGNOFFS=(xso&&xso.data)||[];
  CONCERNS=(cncrn&&cncrn.data)||[];
  TRANSFERS=(trf&&trf.data)||[];
  SC_LINKS=(scl&&scl.data)||[];
  DEPT_HEADS=(dh&&dh.data)||[];
  POSITION_PROFILES=(ppf&&ppf.data)||[];
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
  renderReports();
  renderActivity();
  renderMaternity();
  renderMovements();
  renderPolicies();
  renderProcesses();
  renderStoremap();
  renderLinks();
  renderOrgChart();
  renderPositions();
  renderConcerns();
  renderMeetings();
  renderDemoData();
  renderTimekeeping();
  renderGovRemit();
  renderDesk();
  tagPreviewPages();
  wireGlobalSearch();
  if(!landed){ landed=true;
    // Deep link from the approval email: ?sign=<id> opens that item straight on the sign screen.
    let deep=null; try{ deep=new URLSearchParams(location.search).get("sign"); }catch(_){}
    if(deep && (SIGNATURES||[]).some(s=>String(s.id)===String(deep))){
      if(typeof window.go==="function") window.go("signatures");
      setTimeout(()=>{ try{ openSignDoc(deep); }catch(_){} history.replaceState(null,"",location.pathname); }, 60);
    } else if(typeof window.go==="function") window.go("dashboard");
  }
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
const REAL_PAGES=new Set(["dashboard","employees","branches","manning","prehire","onboarding","exit","contracts","loans","compliance","settings","signatures","memos","evaluations","reports","activity","maternity","timekeeping","meetings","govremit","movements","policies","processes","orgchart","storemap","concerns","links","positions"]);
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
async function delLoanHist(histId,loanId){
  if(!confirm("Remove this loan-history entry?")) return;
  const {error}=await sb.from("loan_history").delete().eq("id",histId);
  if(error){ alert(error.message); return; }
  const mm=document.getElementById("loanModal"); if(mm) mm.remove(); openLoan(loanId);
}
window.delLoanHist=delLoanHist;
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
// NCR daily minimum wage (2026 order). Monthly floor ≈ daily × 26. Regional rates vary — HR confirms.
const NCR_MIN_DAILY=755, MIN_WAGE_MONTHLY_EST=Math.round(755*26);
// Eligibility snapshot for the loan review — reads the linked roster record + open loans.
function loanEligibilityHtml(l){
  if(!l.employee_id) return `<div class="note">No Employee ID linked yet — link the PayPlus ID to see tenure, status and second-loan checks.</div>`;
  const e=EMPLOYEES.find(x=>String(x.employee_id)===String(l.employee_id));
  const flags=[];
  let tenureTxt="—", ct="—", stTxt="—", src="—";
  if(e){
    const ty=tenureYears(e.hire_date);
    tenureTxt=ty!=null?(ty<1?Math.round(ty*12)+" months":ty.toFixed(1)+" years")+(e.hire_date?` (since ${fmtDate(e.hire_date)})`:""):"no hire date on file";
    ct=e.contract_type||"—"; stTxt=e.status||"—"; src=e.hire_source||e.group_name||"Direct";
    if((e.status||"")!=="Active") flags.push(`⚠ Roster status is <b>${esc(e.status||"unknown")}</b> — loans are for active employees.`);
    if(/probation/i.test(ct)) flags.push(`⚠ <b>Probationary</b> — moto & discretionary loans need regular status / minimum tenure.`);
    if(ty!=null && ty<2 && l.loan_type==="moto") flags.push(`⚠ Motorcycle loan needs <b>2+ years</b> tenure (currently ${ty.toFixed(1)}y).`);
    if(/jell|m&g|^mg|agency/i.test(src)) flags.push(`⚠ Appears <b>agency-placed</b> (${esc(src)}) — company loans are for direct hires; confirm.`);
  } else {
    flags.push(`⚠ No roster record found for ID ${esc(l.employee_id)} — verify the employee exists in PayPlus.`);
  }
  // Second active loan (clear-first rule): any OTHER portal loan for this ID not Rejected/Released…
  const others=(typeof LOANS!=="undefined"?LOANS:[]).filter(x=>String(x.employee_id)===String(l.employee_id) && String(x.id)!==String(l.id) && !["Rejected","Released"].includes(x.status));
  if(others.length) flags.push(`⚠ <b>${others.length} other open loan application(s)</b> in the portal (${esc(others.map(o=>o.loan_ref).join(", "))}) — clear-first rule.`);
  return `${phRow("Tenure",tenureTxt)}${phRow("Contract type",ct)}${phRow("Roster status",stTxt)}${phRow("Source",src)}
    ${flags.length
      ? `<div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">${flags.map(f=>`<div style="padding:8px 11px;border-radius:9px;background:#fbeee6;border:1px solid #ecdca6;font-size:13px;">${f}</div>`).join("")}</div>`
      : `<div style="margin-top:10px;padding:9px 12px;border-radius:9px;background:#eef4ef;border:1px solid #cfe0d4;font-size:13px;"><b style="color:var(--green);">✓ No eligibility flags</b> — active, and no other open loan.</div>`}`;
}
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
        ${phRow("Loan type",loanTypeLabel(l.loan_type))}${phRow("Amount",peso(l.amount))}${phRow("Term",(l.term_months||"—")+" months")}${phRow("Est. monthly",peso(l.monthly_estimate))}${phRow("Mobile",l.contact_number)}${phRow("Email",l.email)}${phRow("Employee ID",l.employee_id)}${phRow("Position",l.department)}${phRow("Take-home given",l.net_pay?peso(l.net_pay):"—")}${phRow("Purpose",l.purpose)}${phRow("Authorized",l.authorized?"Applied & consented online (RA 8792)":"—")}
      </div>
      <div class="panel" style="border:2px solid #cfe0d4;">
        <h2>Eligibility snapshot</h2>
        ${loanEligibilityHtml(l)}
      </div>
      <div class="panel" style="border:2px solid #cfe0d4;">
        <h2>Loan history <span style="font-size:12px;font-weight:600;color:var(--muted);">— HR check (PayPlus can't supply this)</span></h2>
        <div class="psub">Previous &amp; still-running loans for this employee. PayPlus doesn't expose loan balances, so HR records them here from the payslip / old ledger. What you enter shows on every future loan review for this person.</div>
        <div id="loanHistBody" style="margin-top:10px;"><div class="psub">Loading history…</div></div>
        <div style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px;">
          <label style="font-size:12px;font-weight:700;color:var(--muted);display:block;margin-bottom:6px;">＋ Add a past / existing loan</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;">
            <select id="lhType" style="padding:8px;border:1px solid var(--line);border-radius:8px;font-size:13px;">
              <option value="">Type…</option><option value="discretionary">Discretionary</option><option value="emergency">Emergency</option><option value="educational">Educational</option><option value="moto">Motorcycle</option><option value="sss">SSS</option><option value="pagibig">Pag-IBIG</option><option value="other">Other</option>
            </select>
            <input id="lhDate" type="date" title="Date granted" style="padding:8px;border:1px solid var(--line);border-radius:8px;font-size:13px;">
            <input id="lhAmt" type="number" inputmode="numeric" placeholder="Original amount ₱" style="padding:8px;border:1px solid var(--line);border-radius:8px;font-size:13px;">
            <input id="lhOut" type="number" inputmode="numeric" placeholder="Outstanding balance ₱" style="padding:8px;border:1px solid var(--line);border-radius:8px;font-size:13px;">
            <input id="lhMonthly" type="number" inputmode="numeric" placeholder="Monthly deduction ₱" style="padding:8px;border:1px solid var(--line);border-radius:8px;font-size:13px;">
            <select id="lhStatus" style="padding:8px;border:1px solid var(--line);border-radius:8px;font-size:13px;">
              <option value="Active">Active (still deducting)</option><option value="Paid">Fully paid</option>
            </select>
            <input id="lhSource" placeholder="Source (payslip / old ledger)" style="padding:8px;border:1px solid var(--line);border-radius:8px;font-size:13px;grid-column:1/3;">
            <input id="lhNote" placeholder="Note (optional)" style="padding:8px;border:1px solid var(--line);border-radius:8px;font-size:13px;grid-column:1/3;">
          </div>
          <button class="btn" id="lhAdd" style="margin-top:9px;">Add to history</button>
        </div>
      </div>
      <div class="panel" style="border:2px solid #cfe0d4;">
        <h2>Affordability — 15%-of-pay rule</h2>
        <div id="loanAfford"><div class="psub">Calculating…</div></div>
      </div>
      <div class="panel">
        <h2>Recent attendance <span style="font-size:12px;font-weight:600;color:var(--muted);">— last 3 months (PayPlus)</span></h2>
        <div id="loanAtt"><div class="psub">Loading attendance…</div></div>
      </div>
      <div class="panel">
        <h2>Supporting documents</h2>
        ${(Array.isArray(l.documents)&&l.documents.length)
          ? l.documents.map(d=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);">
              <div><div style="font-weight:600;">${esc(d.label||d.name||"Document")}</div><div class="esub">${esc(d.name||"")}</div></div>
              <button class="btn ghost" style="flex:none;" onclick="openLoanDoc('${esc(d.path)}',this)">View</button></div>`).join("")
          : `<div class="psub">No documents were attached. Use the applicant's mobile / email above to request them.</div>`}
        <label style="font-size:12px;font-weight:700;color:var(--muted);display:block;margin-top:12px;">Add documents (HR — e.g. handed over after applying)</label>
        <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
          <input type="file" id="loanDocAdd" multiple accept="image/*,application/pdf,.pdf" style="flex:1;">
          <button class="btn ghost" id="loanDocUp" style="flex:none;">Upload</button>
        </div>
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
          ${(l.status!=="Submitted"&&l.status!=="Rejected"&&l.status!=="Released")?`<button class="btn ghost" id="loanBack" style="color:#8a5a00;border-color:#ecdca6;">↩ Send back to HR</button>`:""}
          ${l.status!=="Rejected"&&l.status!=="Released"?`<button class="btn ghost" id="loanRej" style="color:var(--red);border-color:#f1c9c5;">Reject</button>`:""}
          ${l.status==="Approved"?`<button class="btn" id="loanRel">Mark Released</button>`:""}
          <button class="btn ghost" id="loanClose" style="margin-left:auto;">Close</button>
        </div>
      </div>
    </div></div>`;
  $("#loanClose").addEventListener("click",()=>m.remove());
  // ── Loan history (HR-maintained; PayPlus doesn't expose loan balances) ──
  const renderLoanHist=(rows)=>{
    const body=document.getElementById("loanHistBody"); if(!body) return;
    if(!l.employee_id){ body.innerHTML=`<div class="note">No Employee ID on this application yet — link the PayPlus ID first, then history can be attached to the person.</div>`; return; }
    if(!rows||!rows.length){ body.innerHTML=`<div class="psub">No previous loans recorded yet. If you know this person has running loans (SSS, Pag-IBIG, company), add them below so the take-home check is accurate.</div>`; return; }
    const activeOut=rows.filter(r=>r.status==="Active").reduce((s,r)=>s+Number(r.outstanding||0),0);
    const activeMon=rows.filter(r=>r.status==="Active").reduce((s,r)=>s+Number(r.monthly_deduction||0),0);
    body.innerHTML=`
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <div style="flex:1;min-width:130px;background:#eef4ef;border-radius:10px;padding:8px 12px;"><div class="esub">Active outstanding</div><div style="font-weight:800;font-size:16px;">${peso(activeOut)}</div></div>
        <div style="flex:1;min-width:130px;background:#eef4ef;border-radius:10px;padding:8px 12px;"><div class="esub">Monthly deductions now</div><div style="font-weight:800;font-size:16px;">${peso(activeMon)}</div></div>
      </div>
      ${rows.map(r=>`<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);">
        <div>
          <div style="font-weight:700;">${esc(loanTypeLabel(r.loan_type))} · ${peso(r.amount)} <span class="pill ${r.status==="Active"?"active":"closed"}" style="margin-left:4px;">${esc(r.status||"")}</span></div>
          <div class="esub">${r.date_granted?("Granted "+fmtDate(r.date_granted)+" · "):""}Outstanding ${peso(r.outstanding)} · ${peso(r.monthly_deduction)}/mo${r.source?(" · "+esc(r.source)):""}${r.note?(" · "+esc(r.note)):""}</div>
        </div>
        <button class="btn ghost" style="flex:none;padding:4px 10px;font-size:12px;color:var(--red);border-color:#f1c9c5;" onclick="delLoanHist('${r.id}','${esc(l.id)}')">Remove</button>
      </div>`).join("")}`;
  };
  const renderAfford=(activeMon)=>{
    const box=document.getElementById("loanAfford"); if(!box) return;
    const disposable=Number(l.net_pay||0);
    const guide=disposable*0.15;
    const thisMon=Number(l.monthly_estimate||0);
    const combined=thisMon+Number(activeMon||0);
    if(!disposable){ box.innerHTML=`<div class="note">No pay figure captured with this application — HR must check the 15% rule against the payslip manually.</div>`; return; }
    const ok=combined<=guide;
    box.innerHTML=`
      ${phRow("Pay available for repayment","₱"+disposable.toLocaleString())}
      ${phRow("15% guide (max monthly)","₱"+guide.toLocaleString(undefined,{maximumFractionDigits:0}))}
      ${phRow("This loan — monthly","₱"+thisMon.toLocaleString(undefined,{maximumFractionDigits:0}))}
      ${activeMon?phRow("Existing loan deductions (from history)","₱"+Number(activeMon).toLocaleString(undefined,{maximumFractionDigits:0})):""}
      ${phRow("Combined monthly","₱"+combined.toLocaleString(undefined,{maximumFractionDigits:0}))}
      <div style="margin-top:10px;padding:11px 13px;border-radius:10px;font-size:13.5px;background:${ok?'#e6f4ea':'#fbeee6'};border:1px solid ${ok?'#bfe0c8':'#ecdca6'};">
        ${ok?`<b style="color:var(--green);">✓ Within the 15% guide.</b> Combined ₱${combined.toLocaleString(undefined,{maximumFractionDigits:0})} fits under ₱${guide.toLocaleString(undefined,{maximumFractionDigits:0})}.`
             :`<b style="color:#b26a00;">⚠ Over the 15% guide.</b> Combined ₱${combined.toLocaleString(undefined,{maximumFractionDigits:0})} exceeds ₱${guide.toLocaleString(undefined,{maximumFractionDigits:0})} — consider a smaller amount or longer term, or clear the existing loan first.`}
      </div>
      ${(()=>{ const residual=disposable-combined; const below=residual<MIN_WAGE_MONTHLY_EST;
        return `<div style="margin-top:8px;padding:11px 13px;border-radius:10px;font-size:13px;background:${below?'#fbeee6':'#eef4ef'};border:1px solid ${below?'#ecdca6':'#cfe0d4'};">
          <b>Art. 113 — take-home floor.</b> After all loan deductions, pay left ≈ <b>₱${residual.toLocaleString(undefined,{maximumFractionDigits:0})}</b>/mo vs the minimum-wage floor ≈ ₱${MIN_WAGE_MONTHLY_EST.toLocaleString()} (NCR est.).
          ${below?` <span style="color:#b26a00;font-weight:700;">⚠ Below the floor — deductions may not lawfully reduce take-home below minimum wage.</span>`:` <span style="color:var(--green);font-weight:700;">✓ Stays above the floor.</span>`}</div>`; })()}
      <div class="psub" style="margin-top:8px;">Pay figure was declared on the application. Confirm against the latest payslip before approving. The 15% guide applies <b>after</b> government (SSS/PhilHealth/Pag-IBIG/tax) deductions. Min-wage floor is an NCR estimate — adjust for the employee's region.</div>`;
  };
  renderAfford(0);
  // ── Recent attendance (last 3 completed months from PayPlus) ──
  (async()=>{
    const box=document.getElementById("loanAtt"); if(!box) return;
    if(!l.employee_id){ box.innerHTML=`<div class="psub">No Employee ID linked — can't pull attendance.</div>`; return; }
    const now=new Date(); let ey=now.getFullYear(), em=now.getMonth(); if(em===0){ em=12; ey--; } // month before current (1-12)
    let sy=ey, sm=em-2; while(sm<1){ sm+=12; sy--; }
    try{
      const { data:{ session } }=await sb.auth.getSession();
      const url=`${SUPABASE_URL}/functions/v1/payplus-attendance?emp=${encodeURIComponent(l.employee_id)}&y1=${sy}&m1=${sm}&y2=${ey}&m2=${em}`;
      const r=await fetch(url,{ headers:{ Authorization:`Bearer ${session.access_token}`, apikey:SUPABASE_ANON_KEY } });
      const j=await r.json();
      if(j.error){ box.innerHTML=`<div class="note">Couldn't pull attendance: ${esc(j.error)}</div>`; return; }
      const ms=(j.months||[]).filter(x=>x.hasData);
      if(!ms.length){ box.innerHTML=`<div class="note" style="background:#fffaf0;border-color:#f0d9a6;">No attendance found in the last 3 months — may be agency (not enrolled) or newly hired. Verify manually.</div>`; return; }
      const totAbs=ms.reduce((s,x)=>s+Number(x.absent||0),0);
      const flag=totAbs>=6;
      box.innerHTML=`<table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr style="color:var(--muted);"><th style="text-align:left;">Month</th><th style="text-align:right;">Present</th><th style="text-align:right;">Absent</th><th style="text-align:right;">Late(m)</th><th style="text-align:right;">UT(m)</th></tr></thead><tbody>${ms.map(x=>`<tr><td>${esc(x.month)}</td><td style="text-align:right;">${Number(x.present||0)}</td><td style="text-align:right;${Number(x.absent||0)>=3?'color:var(--red);font-weight:700;':''}">${x.absent||0}</td><td style="text-align:right;">${Number(x.lateMinutes||0).toFixed(0)}</td><td style="text-align:right;">${Number(x.undertimeMinutes||0).toFixed(0)}</td></tr>`).join("")}</tbody></table>
        <div style="margin-top:8px;padding:9px 12px;border-radius:9px;font-size:13px;background:${flag?'#fbeee6':'#eef4ef'};border:1px solid ${flag?'#ecdca6':'#cfe0d4'};">${flag?`<b style="color:#b26a00;">⚠ ${totAbs} absences across 3 months</b> — check attendance/reliability before granting a loan.`:`${totAbs} absences across 3 months — attendance looks steady.`}</div>`;
    }catch(e){ box.innerHTML=`<div class="note">Couldn't reach PayPlus: ${esc(String(e&&e.message||e))}</div>`; }
  })();
  (async()=>{
    if(!l.employee_id){ renderLoanHist(null); renderAfford(0); return; }
    const {data}=await sb.from("loan_history").select("*").eq("employee_id",l.employee_id).order("date_granted",{ascending:false,nullsFirst:false});
    renderLoanHist(data||[]);
    const activeMon=(data||[]).filter(r=>r.status==="Active").reduce((s,r)=>s+Number(r.monthly_deduction||0),0);
    renderAfford(activeMon);
  })();
  const lhAdd=document.getElementById("lhAdd"); if(lhAdd) lhAdd.addEventListener("click",async()=>{
    if(!l.employee_id){ alert("Link this application's Employee ID first — history is attached to the person's PayPlus ID."); return; }
    const type=document.getElementById("lhType").value;
    const amt=parseFloat(document.getElementById("lhAmt").value||"0");
    if(!type){ alert("Pick a loan type."); return; }
    if(!amt){ alert("Enter the original loan amount."); return; }
    lhAdd.disabled=true; lhAdd.textContent="Saving…";
    const row={ employee_id:l.employee_id, applicant_name:l.applicant_name, loan_type:type,
      amount:amt, outstanding:parseFloat(document.getElementById("lhOut").value||"0")||null,
      monthly_deduction:parseFloat(document.getElementById("lhMonthly").value||"0")||null,
      date_granted:document.getElementById("lhDate").value||null,
      status:document.getElementById("lhStatus").value, source:document.getElementById("lhSource").value||null,
      note:document.getElementById("lhNote").value||null, added_by:myEmail()||"HR" };
    const {error}=await sb.from("loan_history").insert(row);
    if(error){ alert(error.message); lhAdd.disabled=false; lhAdd.textContent="Add to history"; return; }
    const {data}=await sb.from("loan_history").select("*").eq("employee_id",l.employee_id).order("date_granted",{ascending:false,nullsFirst:false});
    renderLoanHist(data||[]);
    ["lhType","lhDate","lhAmt","lhOut","lhMonthly","lhSource","lhNote"].forEach(id=>{const el=document.getElementById(id); if(el) el.value="";});
    lhAdd.disabled=false; lhAdd.textContent="Add to history";
  });
  const dUp=document.getElementById("loanDocUp"); if(dUp) dUp.addEventListener("click",async()=>{
    const inp=document.getElementById("loanDocAdd");
    if(!inp||!inp.files||!inp.files.length){ alert("Choose the file(s) first."); return; }
    dUp.disabled=true; dUp.textContent="Uploading…";
    const added=[];
    for(let i=0;i<inp.files.length;i++){
      const f=inp.files[i];
      const path=(l.loan_ref||"loan")+"/hr-"+Date.now().toString(36)+"-"+f.name.replace(/[^a-zA-Z0-9._-]+/g,"_").slice(0,100);
      const {error:upErr}=await sb.storage.from("loan-docs").upload(path,f,{upsert:true});
      if(upErr){ alert("Couldn't upload "+f.name+": "+upErr.message); dUp.disabled=false; dUp.textContent="Upload"; return; }
      added.push({label:f.name+" (added by HR)",path:path,name:f.name});
    }
    const docs=(Array.isArray(l.documents)?l.documents:[]).concat(added);
    const {error}=await sb.from("loans").update({documents:docs,updated_at:new Date().toISOString()}).eq("id",l.id);
    if(error){ alert(error.message); dUp.disabled=false; dUp.textContent="Upload"; return; }
    await loadEmployees(); m.remove(); openLoan(l.id);
  });
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  const setLoan=async(patch)=>{ patch.hr_notes=document.getElementById("loanNotes").value; patch.updated_at=new Date().toISOString();
    const {error}=await sb.from("loans").update(patch).eq("id",l.id); if(error){alert(error.message);return;}
    if(patch.status && patch.status!==l.status) await logChange("loan",l.id,l.applicant_name,patch.status,l.loan_ref+" · "+loanTypeLabel(l.loan_type)+" "+peso(l.amount));
    await loadEmployees(); m.remove(); };
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
  const back=document.getElementById("loanBack"); if(back) back.addEventListener("click",async()=>{
    const c=prompt("Send back to HR — what should they add or check?\n(e.g. \"attach latest payslip\", \"confirm existing SSS loan balance\", \"missing valid ID\")");
    if(c==null) return;
    const stamp=`[Sent back to HR by ${myName()||myEmail()||"reviewer"} · ${fmtDate(new Date().toISOString())}] ${c.trim()}`;
    const prev=document.getElementById("loanNotes").value;
    const merged=(prev?prev+"\n":"")+stamp;
    const {error}=await sb.from("loans").update({status:"HR Review",hr_notes:merged,updated_at:new Date().toISOString()}).eq("id",l.id);
    if(error){ alert(error.message); return; }
    await logChange("loan",l.id,l.applicant_name,"Sent back to HR",l.loan_ref+" — "+c.trim().slice(0,80));
    await loadEmployees(); m.remove();
  });
}
const isActive=(e)=>e.status==="Active";
// "Store / Concession" classification, derived (display-only) from the worksite.
// Rule (anj): worksite for Spyder / Ridelab / Gear Up = our own STORE; anything else = a CONCESSION.
// PayPlus stays the master of the raw worksite — this never edits the roster.
const STORE_BRANDS=/\b(spyder|ride\s*lab|gear\s*up)\b/i;
function deriveConcession(e){
  if(e.group_name==="Head Office"||e.group_name==="Warehouse") return "—"; // office/WH aren't retail
  const w=(e.worksite||"").trim();
  if(!w) return "—";
  return STORE_BRANDS.test(w) ? "Store" : "Concession";
}
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
  const phPipe=PREHIRE.filter(p=>!["HIRED","REJECTED","POOLED","DRAFT"].includes(p.phase)).length;
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
  // evaluations now surface as a broken-down line in "Your pending tasks" (2.5-mo / 5.5-mo / regularization) — not lumped here
  { const _allow=allowedPages(); if(_allow){ for(let i=waiting.length-1;i>=0;i--){ if(_allow.indexOf(waiting[i].go)===-1) waiting.splice(i,1); } } }

  const recruiterMode = ["recruiter","manager"].includes(userRole());  // recruiters + HR Manager land on a recruitment-first scorecard
  const pg=$("#page-dashboard");
  pg.innerHTML=`
    <div class="hello">
      <div class="hd">${new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}).toUpperCase()}</div>
      <div class="hh">${greet}, <span>${esc(nm)}.</span></div>
      <div class="hsub">${recruiterMode?`Recruitment at a glance — ${openSlots} open position${openSlots===1?"":"s"} across ${openStores} stores, ${phPipe} candidate${phPipe===1?"":"s"} in the pipeline.`:`Your whole workforce, live from the database — ${A.length} active people across ${open.length} stores.`}</div>
      <button class="btn ghost" id="dashCust" style="margin-top:10px;font-size:12.5px;padding:5px 12px;">Customize dashboard</button>
    </div>
    ${recruiterMode?recruitmentScorecard():""}
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
        ${(()=>{ if(!canSeePay()) return ''; const fpAwait=(SIGNATURES||[]).filter(s=>s.doc_type==="claim"&&s.awaiting==="you"&&s.status==="pending"); return fpAwait.length?`<div class="task" style="cursor:pointer;" onclick="go('signatures')"><div class="dot r"></div><div><div class="tt">${fpAwait.length} final-pay quitclaim(s) awaiting your sign-off</div><div class="td">Full figures are on the sign screen — review &amp; e-sign in one place${fpAwait[0]?` · e.g. ${esc(fpAwait[0].subject_name||"")} ${fpAwait[0].amount!=null?"("+peso(fpAwait[0].amount)+")":""}`:""}</div></div><div class="due r">sign-off</div></div>`:''; })()}
        ${(()=>{ if(!canSeeMovements()) return ''; const mine=(NPAS||[]).filter(r=>{ const st=mvCanSignNow(r); return st!=null; }); return mine.length?`<div class="task" style="cursor:pointer;" onclick="go('movements')"><div class="dot r"></div><div><div class="tt">${mine.length} personnel movement(s) awaiting your sign-off</div><div class="td">Notice of Personnel Action — review the figures &amp; e-sign${mine[0]?" · e.g. "+esc(mine[0].employee_name||""):""}</div></div><div class="due r">sign-off</div></div>`:''; })()}
        ${(()=>{ if(!isAdminUser()) return ''; const sep=(EXITCASES||[]).filter(e=>e.separation_status==="Submitted"&&e.overall_status!=="Complete"); return sep.length?`<div class="task" style="cursor:pointer;" onclick="go('exit')"><div class="dot r"></div><div><div class="tt">${sep.length} separation(s) awaiting your approval</div><div class="td">HR prepared these — approve to flip the employee to Separated${sep[0]?" · e.g. "+esc(sep[0].employee_name||""):""}</div></div><div class="due r">approve</div></div>`:''; })()}
        ${(()=>{ if(!canSeeConcerns()) return ''; const hs=(CONCERNS||[]).filter(c=>{ const n=daysUntil(c.next_hearing); return n!=null&&n<=14&&(c.status==="Open"||c.status==="Ongoing"); }).sort((a,b)=>daysUntil(a.next_hearing)-daysUntil(b.next_hearing)); if(!hs.length) return ''; const c0=hs[0]; const n0=daysUntil(c0.next_hearing); const when=n0<0?`overdue ${-n0}d`:n0===0?"today":`in ${n0}d`; return `<div class="task" style="cursor:pointer;" onclick="go('concerns')"><div class="dot r"></div><div><div class="tt">${hs.length} case hearing${hs.length!==1?"s":""} within 14 days</div><div class="td">${esc(c0.title||"Case")} — ${when}${c0.forum?" · "+esc(c0.forum):""}</div></div><div class="due r">hearing</div></div>`; })()}
        ${phReady?`<div class="task" style="cursor:pointer;" onclick="go('prehire')"><div class="dot r"></div><div><div class="tt">${phReady} candidate(s) ready for contract / onboarding</div><div class="td">Move them into an onboarding case</div></div><div class="due r">hiring</div></div>`:''}
        ${onbTasksOpen?`<div class="task" style="cursor:pointer;" onclick="go('onboarding')"><div class="dot a"></div><div><div class="tt">${onbTasksOpen} open onboarding task(s)</div><div class="td">${onbOpen} case(s) in progress — bank, uniform, gov forms, Employee ID</div></div><div class="due a">onboarding</div></div>`:''}
        ${exitOpen?`<div class="task" style="cursor:pointer;" onclick="go('exit')"><div class="dot a"></div><div><div class="tt">${exitOpen} exit clearance(s) in progress</div><div class="td">Department sign-offs &amp; final-pay computation</div></div><div class="due a">offboarding</div></div>`:''}
        ${(()=>{ const gone=Object.keys(SC_STATUS).filter(k=>scIsGone(k)); if(!gone.length) return ''; const stn=BRANCHES.filter(b=>b.status==='Open'&&gone.includes(b.sc)).length; return `<div class="task" style="cursor:pointer;" onclick="go('manning')"><div class="dot r"></div><div><div class="tt">${gone.length} sales coordinator seat(s) vacant — ${gone.map(esc).join(", ")}</div><div class="td">${stn} store(s) with no active SC · reassign or backfill</div></div><div class="due r">manning</div></div>`; })()}
        ${compVerify?`<div class="task" style="cursor:pointer;" onclick="go('compliance')"><div class="dot r"></div><div><div class="tt">${compVerify} trademark(s) past a deadline on file — verify with IPO records</div><div class="td">Renewal year has passed (e.g. SPYDER, AIRFLEX) — confirm renewed or lapsed</div></div><div class="due r">compliance</div></div>`:''}
        ${compDue?`<div class="task" style="cursor:pointer;" onclick="go('compliance')"><div class="dot a"></div><div><div class="tt">${compDue} trademark deadline(s) due ${CY}</div><div class="td">DAU filings &amp; renewals — missing a DAU can cancel the mark</div></div><div class="due a">compliance</div></div>`:''}
        ${(()=>{ const _al=allowedPages(); if(_al&&_al.indexOf('evaluations')===-1) return ''; let _ev; try{_ev=evDueList();}catch(e){return '';} const act=_ev.filter(x=>x.bucket==='due'||x.bucket==='overdue'); if(!act.length) return ''; const c=t=>act.filter(x=>x.type===t).length; const od=act.filter(x=>x.bucket==='overdue').length; const parts=[]; if(c('3rd-month'))parts.push('<b>'+c('3rd-month')+'</b> × 2.5-mo'); if(c('5th-month'))parts.push('<b>'+c('5th-month')+'</b> × 5.5-mo'); if(c('regularization'))parts.push('<b>'+c('regularization')+'</b> × regularization'); if(c('annual'))parts.push('<b>'+c('annual')+'</b> × annual'); const dot=od?'r':'a'; return `<div class="task" style="cursor:pointer;" onclick="go('evaluations')"><div class="dot ${dot}"></div><div><div class="tt">${act.length} evaluation(s) pending${od?` · ${od} overdue`:''}</div><div class="td">${parts.join(' · ')}${c('regularization')?' — regularization must be decided <b>before</b> the 6-month mark (DOLE)':''}</div></div><div class="due ${dot}">record</div></div>`; })()}
        <div class="task" style="cursor:pointer;" onclick="go('employees')"><div class="dot a"></div><div><div class="tt">${prob} employees on probation</div><div class="td">2.5 / 5.5-month evaluations &amp; regularization reviews</div></div><div class="due a">review</div></div>
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
      ${canSeePay()?`<div class="panel" style="margin-top:0;">
        <h2>Merchandiser pay <span class="count-tag">daily basic</span></h2>
        <div class="psub">Basic daily rate across ${basics.length} merchandisers (Manning Sheet)</div>
        <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
          <div class="kpi"><div class="k-l">Avg Basic</div><div class="k-n">₱${avgBasic.toLocaleString()}</div><div class="k-s">₱${minBasic.toLocaleString()}–₱${maxBasic.toLocaleString()}</div></div>
          <div class="kpi"><div class="k-l">Promo Diser</div><div class="k-n">₱${promoAvg.toLocaleString()}</div><div class="k-s">avg basic</div></div>
          <div class="kpi"><div class="k-l">Lead Diser</div><div class="k-n">₱${leadAvg.toLocaleString()}</div><div class="k-s">higher basic + allowances</div></div>
        </div>
        <div class="task" style="margin-top:10px;"><div class="dot a"></div><div><div class="tt">Company allowances (COLA / SOLA / SA / LA) — mostly for Lead Disers</div><div class="td">Not reliably recorded in the Manning Sheet, so they're not in the totals above. The actual per-person allowance comes from <b>PayPlus</b> once connected.</div></div></div>
      </div>`:""}
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
      <thead><tr><th>Name</th><th>Job Title</th><th>Store / Concession</th><th>Worksite</th><th>Type</th><th>Status</th></tr></thead>
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
      <td><b>${esc(e.full_name)}</b></td><td>${esc(e.position||"—")}</td><td>${esc(deriveConcession(e))}</td>
      <td>${esc(e.worksite||"—")}</td><td>${typePill(e)}</td><td>${statusPill(e.status)}</td></tr>`).join("");
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
        ${canManageStores()?'<button class="btn ghost" id="recNpa" style="margin-left:6px;">Personnel Action</button>':''}
        <button class="btn ghost" id="recDownload" style="margin-left:6px;">Download PDF</button>
        <button class="btn" id="recEdit" style="margin-left:6px;">Edit</button>
      </div>
      ${sec(1,"Identity &amp; Status",
        f("PayPlus ID",e.employee_id,TAGHR)+f("Group",e.group_name,TAGAUTO)+f("Hire Source",e.hire_source,TAGAUTO)+(e.agency_name?f("Agency",e.agency_name,TAGAUTO):"")+f("Status",e.status,TAGHR))}
      ${sec(2,"Personal Details",
        f("Email",e.email,TAGEMP)+f("Mobile",e.phone,TAGEMP)+f("Date of Birth",e.date_of_birth?fmtDate(e.date_of_birth):"",TAGEMP)+f("Gender",e.gender,TAGEMP)+f("Civil Status",e.civil_status,TAGEMP)+f("Permanent Address",e.permanent_address,TAGEMP)+f("Current Address",e.current_address,TAGEMP))}
      ${sec(3,"Emergency Contact",
        f("Name",e.emergency_contact_name,TAGEMP)+f("Relationship",e.emergency_contact_relation,TAGEMP)+f("Contact Number",e.emergency_contact_number,TAGEMP))}
      ${canSeeIds()?sec(4,"Government Numbers",
        f("SSS",e.sss_number,TAGHR)+f("PhilHealth",e.philhealth_number,TAGHR)+f("Pag-IBIG",e.pagibig_number,TAGHR)+f("TIN",e.tin_number,TAGHR))
        :sec(4,"Government Numbers",`<div class="efield"><div class="ev"><span class="note">🔒 Restricted</span></div></div>`)}
      ${canSeeIds()?sec(5,"Bank",
        f("Bank Name",e.bank_name,TAGAUTO)+f("Account Number",e.bank_account_number,TAGHR))
        :sec(5,"Bank",`<div class="efield"><div class="ev"><span class="note">🔒 Restricted</span></div></div>`)}
      ${sec(6,"Placement",
        f("Department",e.department,TAGHR)+f("Position",e.position,TAGHR)+f("Worksite",e.worksite,TAGHR)+f("Supervisor",e.supervisor_name,TAGHR)+f("Approver 2",e.approver2_name||e.approver2_email,TAGAUTO))}
      ${sec(7,"Employment Terms, Pay &amp; Dates",
        f("Contract Type",e.contract_type,TAGHR)
        +(canSeePay()
          ? f("Daily Rate",e.daily_rate?("₱"+Number(e.daily_rate).toLocaleString()):"",TAGHR)+f("Daily Allowance",e.daily_allowance?("₱"+Number(e.daily_allowance).toLocaleString()):"",TAGHR)
          : `<div class="efield"><div class="el">Pay</div><div class="ev"><span class="note">🔒 Restricted — payroll only</span></div></div>`)
        +f("Hire Date",e.hire_date?fmtDate(e.hire_date):"",TAGHR)+f("Regularization Date",e.regularization_date?fmtDate(e.regularization_date):"",TAGHR)+f("End Date",e.end_date?fmtDate(e.end_date):"",TAGHR)+f("End Reason",e.end_reason,TAGHR))}
      ${(()=>{ if(!canSeePay()) return ""; const ap=agencyPayFor(e.employee_id); if(!ap) return ""; return sec(8,"Latest Agency Payroll <span class=\"tag-s auto\">"+esc(ap.agency||"")+"</span>",
        f("Cut-off",ap.cutoff,TAGAUTO)+f("Daily rate (derived)",peso(ap.daily_rate),TAGAUTO)+f("Basic pay",peso(ap.basic),TAGAUTO)+f("Gross pay",peso(ap.gross),TAGAUTO)+f("Net pay",peso(ap.netpay),TAGAUTO)
        +f("Hours worked",ap.hours,TAGAUTO)+f("SSS (EE)",peso(ap.sss_ee),TAGAUTO)+f("PhilHealth (EE)",peso(ap.phic_ee),TAGAUTO)+f("Pag-IBIG (EE)",peso(ap.hdmf_ee),TAGAUTO)+f("Withholding tax",peso(ap.wtax),TAGAUTO))
        +`<div class="psub" style="padding:2px 8px;">Source: ${esc(ap.source||"agency payroll file")}. Employee-share contributions (SSS/PhilHealth/Pag-IBIG) feed the maternity differential &amp; loan capacity checks.</div>`; })()}
      ${e.notes?sec(e.employee_id&&agencyPayFor(e.employee_id)&&canSeePay()?9:8,"Notes",`<div style="font-size:13.5px;white-space:pre-wrap;padding:4px 8px;">${esc(e.notes)}</div>`):""}
      ${(()=>{ const base=(e.employee_id&&agencyPayFor(e.employee_id)&&canSeePay())?9:8; const n=e.notes?base+1:base;
        const list=(NPAS||[]).filter(r=>(r.employee_id!=null&&r.employee_id===e.id)||(r.employee_number!=null&&String(r.employee_number)===String(e.employee_id)))
          .sort((a,b)=>String(b.effective_date||b.created_at||"").localeCompare(String(a.effective_date||a.created_at||"")));
        const rows=list.length?list.map(r=>{ const sc=mvSignedCount(r), tot=mvChain(r).length;
          const cur=r.current_daily_rate, nw=r.new_daily_rate; const inc=(nw!=null&&cur!=null)?(Number(nw)-Number(cur)):null;
          const reason=String(r.remarks||"").replace(/^\[[^\]]*\]\s*/,"").trim();
          const payLine=(cur!=null||nw!=null)?`<b>${peso(cur)} → ${peso(nw)}</b>${inc!=null?` <span style="color:#1f6b3a;">(${inc>=0?"+":""}${peso(inc)})</span>`:""}`:"";
          return `<div class="efield mv-npa-row" data-nid="${esc(String(r.id))}" style="cursor:pointer;">
            <div class="el">${r.effective_date?fmtDate(r.effective_date):"—"}</div>
            <div class="ev">${esc(MV_ACTION_LABEL[r.action_type]||r.action_type||"—")}${payLine?" · "+payLine:""}${reason?` · <span class="note" style="display:inline;">${esc(reason)}</span>`:""} · ${mvStatusPill(r.status)} <span class="note" style="display:inline;padding:0 5px;">${sc}/${tot} signed</span></div></div>`; }).join("")
          :`<div class="efield"><div class="ev"><span class="note">No pay or personnel actions on file yet.</span></div></div>`;
        return sec(n,"Pay &amp; Personnel History (NPA)",rows); })()}
    </div>
    ${(()=>{ const nteN=(MEMOS||[]).filter(m=>/notice to explain/i.test(m.memo_type||"")&&mNorm(m.subject_name)===mNorm(e.full_name)).length;
      return `<div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <h2 style="margin:0;">Attendance <span style="font-size:12px;font-weight:600;color:var(--muted);">— live from PayPlus (last 6 months)</span></h2>
        <div class="psub" style="margin:0;">${nteN?`<b style="color:#a4322a;">${nteN}</b> NTE${nteN===1?"":"s"} on file`:"No NTEs on file"}</div>
      </div>
      <div class="psub">Present / absent / late are daily-timekeeping figures straight from PayPlus. Whether an absence was <b>authorized</b> (approved leave) isn't in the API — confirm against the DTR before acting.</div>
      <div id="recAttendance" style="margin-top:10px;"><div class="psub">Loading attendance…</div></div>
    </div>`; })()}`;
  window.go("employee");
  $("#recBack").addEventListener("click",()=>window.go("employees"));
  $("#recEdit").addEventListener("click",()=>openForm(e));
  const _dl=$("#recDownload"); if(_dl) _dl.addEventListener("click",()=>printEmployeeRecord(e));
  const _npa=$("#recNpa"); if(_npa) _npa.addEventListener("click",()=>openNpaForm(e));
  $$("#page-employee .mv-npa-row").forEach(el=>el.addEventListener("click",()=>{ const r=(NPAS||[]).find(x=>String(x.id)===el.dataset.nid); if(r) openMovementDrawer(r); }));
  // ── Live attendance from PayPlus (keyed on the PayPlus ID) ──
  (async()=>{
    const box=document.getElementById("recAttendance"); if(!box) return;
    if(!e.employee_id){ box.innerHTML=`<div class="note" style="background:#fffaf0;border-color:#f0d9a6;">No PayPlus ID linked — attendance can't be pulled. (Agency merchandisers aren't enrolled in PayPlus timekeeping.)</div>`; return; }
    const now=new Date(); let ey=now.getFullYear(), em=now.getMonth(); if(em===0){ em=12; ey--; } // last completed month (1-12)
    let sy=ey, sm=em-5; while(sm<1){ sm+=12; sy--; } // 6-month window
    try{
      const { data:{ session } }=await sb.auth.getSession();
      const url=`${SUPABASE_URL}/functions/v1/payplus-attendance?emp=${encodeURIComponent(e.employee_id)}&y1=${sy}&m1=${sm}&y2=${ey}&m2=${em}`;
      const r=await fetch(url,{ headers:{ Authorization:`Bearer ${session.access_token}`, apikey:SUPABASE_ANON_KEY } });
      const j=await r.json();
      if(j.error){ box.innerHTML=`<div class="note">Couldn't pull attendance: ${esc(j.error)}</div>`; return; }
      const ms=(j.months||[]).filter(x=>x.hasData);
      if(!ms.length){ box.innerHTML=`<div class="note" style="background:#fffaf0;border-color:#f0d9a6;">No attendance found in the last 6 months — may be agency (not enrolled), on approved leave, or newly hired.</div>`; return; }
      const totAbs=ms.reduce((s,x)=>s+Number(x.absent||0),0);
      const totPres=ms.reduce((s,x)=>s+Number(x.present||0),0);
      const totLate=ms.reduce((s,x)=>s+Number(x.lateMinutes||0),0);
      const flag=totAbs>=6;
      box.innerHTML=`<div style="overflow-x:auto;"><table style="width:100%;font-size:12.5px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:right;"><th style="text-align:left;">Month</th><th>Present</th><th>Absent</th><th>Late (min)</th><th>Undertime (min)</th></tr></thead><tbody>${ms.map(x=>`<tr style="text-align:right;"><td style="text-align:left;">${esc(x.month)}</td><td>${Number(x.present||0)}</td><td style="${Number(x.absent||0)>=3?'color:var(--red);font-weight:700;':''}">${x.absent||0}</td><td>${Number(x.lateMinutes||0).toFixed(0)}</td><td>${Number(x.undertimeMinutes||0).toFixed(0)}</td></tr>`).join("")}</tbody><tfoot><tr style="text-align:right;font-weight:700;border-top:1px solid var(--line);"><td style="text-align:left;">Total (6 mo)</td><td>${totPres}</td><td style="${flag?'color:var(--red);':''}">${totAbs}</td><td>${totLate.toFixed(0)}</td><td></td></tr></tfoot></table></div>
        <div style="margin-top:8px;padding:9px 12px;border-radius:9px;font-size:13px;background:${flag?'#fbeee6':'#eef4ef'};border:1px solid ${flag?'#ecdca6':'#cfe0d4'};">${flag?`<b style="color:#b26a00;">⚠ ${totAbs} absences over 6 months</b> — review reliability; confirm which were unauthorized before any action.`:`${totAbs} absences over 6 months — attendance looks steady.`}</div>`;
    }catch(err){ box.innerHTML=`<div class="note">Couldn't reach PayPlus: ${esc(String(err&&err.message||err))}</div>`; }
  })();
}

// Standalone NPA entry: search who → opens the same NPA form (tick purpose → generate). No need to open the person first.
function newNpa(){
  let m=document.getElementById("npaPick"); if(!m){ m=document.createElement("div"); m.id="npaPick"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;padding:22px;max-height:82vh;display:flex;flex-direction:column;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:2px;">New Personnel Action</h2>
    <div class="psub">Search the employee — the NPA fills in from their live record, then you tick the purpose and generate.</div>
    <input id="npaQ" placeholder="Type a name…" autocomplete="off" style="width:100%;padding:10px 12px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;margin:4px 0 8px;">
    <div id="npaHits" style="overflow-y:auto;flex:1;"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn ghost" id="npaPickClose">Cancel</button></div>
  </div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("npaPickClose").onclick=()=>m.remove();
  const q=document.getElementById("npaQ"), hits=document.getElementById("npaHits");
  const paint=()=>{
    const s=(q.value||"").trim().toLowerCase();
    let list=(EMPLOYEES||[]).slice().sort((a,b)=>(a.full_name||"").localeCompare(b.full_name||""));
    if(s) list=list.filter(e=>(e.full_name||"").toLowerCase().includes(s)||String(e.employee_id||"").includes(s));
    list=list.slice(0,20);
    hits.innerHTML=list.length?list.map(e=>`<div class="task clickable" data-eid="${esc(String(e.id))}" style="cursor:pointer;">
      <div class="dot ${(e.status||'Active')==='Active'?'g':'r'}"></div>
      <div><div class="tt">${esc(e.full_name)}</div><div class="td">${esc(e.position||"—")} · ${esc(e.worksite||e.department||"—")}${e.employee_id?" · "+esc(e.employee_id):""}${(e.status&&e.status!=='Active')?" · "+esc(e.status):""}</div></div></div>`).join("")
      : `<div class="psub" style="padding:8px 2px;">${s?"No match.":"Start typing a name…"}</div>`;
    hits.querySelectorAll("[data-eid]").forEach(el=>el.addEventListener("click",()=>{ const emp=EMPLOYEES.find(x=>String(x.id)===el.dataset.eid); m.remove(); if(emp) openNpaForm(emp); }));
  };
  q.addEventListener("input",paint); paint(); q.focus();
}
/* ---------- NOTICE OF PERSONNEL ACTION (NPA) — generated from the employee record ---------- */
const NPA_ACTIONS=["Regularization","Reappointment","Promotion in Rank","Separation from Employment","Job / Lateral Transfer","Salary Adjustment"];
const NPA_SIGNATORIES=[["Grazel Lyn Agulto","HR Officer","PREPARED BY"],["Pervin Chaltani","AVP, Admin & Logistics","NOTED BY"],["Anju C. Genomal","Director, Admin & Finance","APPROVED BY"]];
function openNpaForm(e){
  let m=document.getElementById("npaModal"); if(!m){ m=document.createElement("div"); m.id="npaModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;padding:22px;max-height:92vh;overflow-y:auto;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:2px;">Notice of Personnel Action</h2>
    <div class="psub" style="margin-bottom:10px;">${esc(e.full_name)} · ${esc(e.position||"—")} · ${esc(e.worksite||e.department||"—")} — employee details fill in automatically.</div>
    ${sel("npa_action","Action *",NPA_ACTIONS,"")}
    <div id="npa_extra"></div>
    ${fld("npa_eff","Effective date *","","date")}
    <div style="margin-bottom:10px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:4px;">Remarks</label><textarea id="npa_remarks" rows="2" style="width:100%;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:13.5px;"></textarea></div>
    <div id="npaMsg" style="font-size:13px;color:#a4322a;margin:4px 0;"></div>
    <div style="display:flex;gap:10px;"><button class="btn ghost" id="npaCancel" style="flex:1;">Cancel</button><button class="btn" id="npaGo" style="flex:1;">Generate form</button></div>
  </div>`;
  const extra=()=>{
    const a=document.getElementById("npa_action").value, x=document.getElementById("npa_extra");
    if(a==="Separation from Employment") x.innerHTML=sel("npa_sep","Separation type",["Resignation","End of Contract"],"Resignation");
    else if(a==="Job / Lateral Transfer") x.innerHTML=fld("npa_from","From (old location / position)",(e.worksite||"")+(e.position?" · "+e.position:""))+fld("npa_to","To (new location / position)","");
    else if(a==="Salary Adjustment") x.innerHTML=canSeePay()
      ? `<div class="form-grid">${fld("npa_bp_from","Basic pay — FROM","","number")}${fld("npa_bp_adj","Basic pay — adjustment","","number")}</div>
         <div class="form-grid">${fld("npa_al_from","Allowance — FROM","","number")}${fld("npa_al_adj","Allowance — adjustment","","number")}</div>
         <div class="psub">Totals compute automatically on the form. Salary data is confidential.</div>`
      : `<div class="note">🔒 Salary adjustments can only be prepared by authorised payroll.</div>`;
    else x.innerHTML="";
  };
  document.getElementById("npa_action").addEventListener("change",extra);
  document.getElementById("npaCancel").addEventListener("click",()=>m.remove());
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("npaGo").addEventListener("click",async()=>{
    const a=v("npa_action"), eff=v("npa_eff"), msg=document.getElementById("npaMsg");
    if(!a){ msg.textContent="Pick the action."; return; }
    if(!eff){ msg.textContent="Set the effective date."; return; }
    if(a==="Salary Adjustment"&&!canSeePay()){ msg.textContent="Salary adjustments are payroll-only."; return; }
    const d={ action:a, eff, remarks:v("npa_remarks"), sep:v("npa_sep"), from:v("npa_from"), to:v("npa_to"),
      bp_from:nv("npa_bp_from"), bp_adj:nv("npa_bp_adj"), al_from:nv("npa_al_from"), al_adj:nv("npa_al_adj") };
    const ref="NPA-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+Math.random().toString(36).slice(2,6).toUpperCase();
    try{ await sb.from("memos").insert({ ref_no:ref, memo_type:"Personnel Action", subject_name:e.full_name, title:a, is_demo:!!e.is_demo,
      body:"NPA — "+a+(d.sep?" ("+d.sep+")":"")+(d.to?" → "+d.to:"")+" · effective "+eff+(d.remarks?" · "+d.remarks:""),
      relevant_date:eff, status:"Issued", created_by:(CURRENT_USER&&CURRENT_USER.email)||"HR" }); }catch(_){}
    printNpa(e,d,ref); m.remove(); await loadEmployees();
  });
}
// Downloadable / printable Employee Record — RCC-branded. Respects the same visibility gates as the on-screen record
// (pay only if canSeePay, gov IDs + bank only if canSeeIds), so a download never exposes more than the person can already see.
function printEmployeeRecord(e){
  const w=window.open("","_blank"); if(!w){ alert("Allow pop-ups to download the record."); return; }
  const E=s=>String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
  const D=v=>(v==null||v==="")?"—":E(v);
  const dt=v=>v?fmtDate(v):"—";
  const rows=arr=>arr.map(([k,v])=>`<tr><td class="k">${E(k)}</td><td class="v">${v}</td></tr>`).join("");
  const sec=(t,body)=>`<h3>${E(t)}</h3><table class="rec">${body}</table>`;
  const idRows=[["PayPlus ID",D(e.employee_id)],["Group",D(e.group_name)],["Hire source",D(e.hire_source)]];
  if(e.agency_name) idRows.push(["Agency",D(e.agency_name)]);
  idRows.push(["Status",D(e.status)]);
  const payRows = canSeePay()
    ? [["Contract type",D(e.contract_type)],["Daily rate", e.daily_rate?("₱"+Number(e.daily_rate).toLocaleString()):"—"],["Daily allowance", e.daily_allowance?("₱"+Number(e.daily_allowance).toLocaleString()):"—"],["Hire date",dt(e.hire_date)],["Regularization date",dt(e.regularization_date)],["End date",dt(e.end_date)],["End reason",D(e.end_reason)]]
    : [["Contract type",D(e.contract_type)],["Pay","🔒 restricted — payroll only"],["Hire date",dt(e.hire_date)],["Regularization date",dt(e.regularization_date)],["End date",dt(e.end_date)]];
  const ids = canSeeIds()
    ? sec("Government Numbers", rows([["SSS",D(e.sss_number)],["PhilHealth",D(e.philhealth_number)],["Pag-IBIG",D(e.pagibig_number)],["TIN",D(e.tin_number)]]))
      + sec("Bank", rows([["Bank name",D(e.bank_name)],["Account number",D(e.bank_account_number)]]))
    : "";
  const gen="Generated "+new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})+" · "+E((CURRENT_USER&&CURRENT_USER.email)||"RCC HRIS");
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${E(e.full_name||"Employee")} — Employee Record</title><style>
    *{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#12241b;margin:32px;font-size:12.5px;}
    .hdr{border-bottom:3px solid #1F6B52;padding-bottom:10px;margin-bottom:12px;}
    .co{font-size:18px;font-weight:800;color:#12352a;}.sub{font-size:10.5px;color:#6b7785;letter-spacing:.6px;text-transform:uppercase;}
    h2{font-size:16px;margin:8px 0 2px;}.meta{color:#6b7785;font-size:12px;margin-bottom:6px;}
    h3{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#1F6B52;margin:16px 0 4px;border-bottom:1px solid #dbe4dd;padding-bottom:3px;}
    table.rec{width:100%;border-collapse:collapse;}table.rec td{padding:5px 6px;border-bottom:1px solid #eef2ef;vertical-align:top;}
    td.k{width:210px;color:#6b7785;font-weight:600;}td.v{color:#12241b;}
    .foot{margin-top:22px;font-size:10px;color:#9aa4ac;border-top:1px solid #dbe4dd;padding-top:8px;}
    @media print{body{margin:14mm;}}
  </style></head><body>
    <div class="hdr"><div class="co">Roshan Commercial Corporation</div><div class="sub">Human Resources — Employee Record</div></div>
    <h2>${D(e.full_name)}</h2>
    <div class="meta">${D(e.position)} · ${D(e.department)}${e.worksite?" · "+E(e.worksite):""} · ${D(e.status)}</div>
    ${sec("Identity & Status", rows(idRows))}
    ${sec("Personal Details", rows([["Email",D(e.email)],["Mobile",D(e.phone)],["Date of birth",dt(e.date_of_birth)],["Gender",D(e.gender)],["Civil status",D(e.civil_status)],["Permanent address",D(e.permanent_address)],["Current address",D(e.current_address)]]))}
    ${sec("Emergency Contact", rows([["Name",D(e.emergency_contact_name)],["Relationship",D(e.emergency_contact_relation)],["Contact number",D(e.emergency_contact_number)]]))}
    ${ids}
    ${sec("Placement", rows([["Department",D(e.department)],["Position",D(e.position)],["Worksite",D(e.worksite)],["Supervisor",D(e.supervisor_name)],["Approver 2",D(e.approver2_name||e.approver2_email)]]))}
    ${sec("Employment Terms, Pay & Dates", rows(payRows))}
    ${e.notes?`<h3>Notes</h3><div style="white-space:pre-wrap;font-size:12.5px;padding:4px 2px;">${E(e.notes)}</div>`:""}
    <div class="foot">${gen}. Sourced from the RCC HRIS; roster fields mirror PayPlus.${(canSeePay()||canSeeIds())?" Contains confidential data — handle accordingly.":""}</div>
    <scr`+`ipt>window.onload=function(){setTimeout(function(){window.print();},150);}</scr`+`ipt>
  </body></html>`;
  w.document.write(html); w.document.close();
}
function printNpa(e,d,ref){
  const P=n=>(n==null||isNaN(n))?"":"₱"+Number(n).toLocaleString(undefined,{minimumFractionDigits:2});
  const T=(f,adj)=>(f==null&&adj==null)?"":P((Number(f)||0)+(Number(adj)||0));
  const cb=(on)=>on?"☒":"☐";
  const st=(e.status||"").toLowerCase(); const ct=(e.contract_type||"").toLowerCase();
  const statusLine=["Regular","Probationary","Contractual","Seasonal"].map(s=>cb(ct.includes(s.toLowerCase())||(s==="Regular"&&e.regularization_date&&!ct))+" "+s).join("&nbsp;&nbsp;&nbsp;");
  const acts=NPA_ACTIONS.map(a=>{ let line=cb(a===d.action)+" <b>"+a.toUpperCase()+"</b>";
    if(a==="Separation from Employment"&&a===d.action) line+=" — "+cb(d.sep==="Resignation")+" Resignation &nbsp;"+cb(d.sep==="End of Contract")+" End of Contract";
    if(a==="Job / Lateral Transfer"&&a===d.action) line+="<br><span style='margin-left:22px'>From: "+esc(d.from||"")+" &nbsp;→&nbsp; To: "+esc(d.to||"")+"</span>";
    return "<div style='margin:3px 0'>"+line+"</div>"; }).join("");
  const fin=d.action==="Salary Adjustment"?`
    <h3>III. FINANCIAL DETAILS</h3>
    <table><tr><th></th><th>FROM</th><th>ADJUSTMENT</th><th>TOTAL</th></tr>
    <tr><td><b>BASIC PAY</b></td><td>${P(d.bp_from)}</td><td>${P(d.bp_adj)}</td><td>${T(d.bp_from,d.bp_adj)}</td></tr>
    <tr><td><b>ALLOWANCE</b></td><td>${P(d.al_from)}</td><td>${P(d.al_adj)}</td><td>${T(d.al_from,d.al_adj)}</td></tr>
    <tr><td><b>TOTAL COMPENSATION</b></td><td>${T(d.bp_from,d.al_from)}</td><td>${T(d.bp_adj,d.al_adj)}</td><td>${P((Number(d.bp_from)||0)+(Number(d.bp_adj)||0)+(Number(d.al_from)||0)+(Number(d.al_adj)||0))}</td></tr></table>
    <div class="conf">SALARY data in this form is strictly CONFIDENTIAL.</div>`:"";
  const sigs=NPA_SIGNATORIES.map(s=>`<td style="width:33%"><div class="sr">${s[2]}</div><div class="sl">&nbsp;</div><b>${s[0]}</b><br><span class="mut">${s[1]}</span><br><span class="mut">Date: ____________</span></td>`).join("");
  const w=window.open("","_blank"); if(!w){ alert("Allow pop-ups to print the form."); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>${ref} — Notice of Personnel Action</title><style>
    body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1F2A37;max-width:760px;margin:24px auto;padding:0 24px;font-size:13.5px;line-height:1.5;}
    .lh{text-align:center;border-bottom:2.5px solid #1E3A5F;padding-bottom:8px;margin-bottom:14px;}
    .lh b{font-size:17px;color:#1E3A5F;letter-spacing:.5px;} .lh div{font-size:11px;color:#667;}
    h2{text-align:center;font-size:15px;margin:10px 0 14px;} h3{font-size:12.5px;color:#1E3A5F;border-bottom:1px solid #ccd;padding-bottom:2px;margin:16px 0 8px;}
    table{width:100%;border-collapse:collapse;margin:6px 0;} td,th{border:1px solid #bbc;padding:6px 8px;text-align:left;font-size:12.5px;}
    .sr{font-size:10.5px;color:#667;font-weight:700;} .sl{border-bottom:1px solid #333;height:34px;margin-bottom:4px;} .mut{color:#667;font-size:11.5px;}
    .conf{background:#fdf6e3;border:1px solid #ecdca6;padding:6px 10px;font-size:11.5px;font-weight:600;color:#8a6a14;margin-top:6px;}
    @media print{ body{margin:0 auto;} }
  </style></head><body>
    <div class="lh"><b>ROSHAN COMMERCIAL CORPORATION</b><div>104 Shaw Boulevard, Pasig City</div></div>
    <h2>NOTICE OF PERSONNEL ACTION &nbsp;·&nbsp; ${ref}</h2>
    <h3>I. EMPLOYEE INFORMATION</h3>
    <table>
      <tr><td><b>Employee Name</b></td><td>${esc(e.full_name)}</td><td><b>Date Issued</b></td><td>${new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}</td></tr>
      <tr><td><b>Employee ID</b></td><td>${esc(e.employee_id||"—")}</td><td><b>Position</b></td><td>${esc(e.position||"—")}</td></tr>
      <tr><td><b>Location</b></td><td>${esc(e.worksite||e.department||"—")}</td><td><b>Effective Date</b></td><td>${fmtDate(d.eff)}</td></tr>
    </table>
    <div style="margin:6px 0"><b>Employment Status:</b> ${statusLine}</div>
    <h3>II. REASON FOR PERSONNEL ACTION</h3>${acts}
    ${fin}
    ${d.remarks?`<div style="margin-top:8px"><b>Remarks:</b> ${esc(d.remarks)}</div>`:""}
    <h3>IV. SIGNATURES AND APPROVALS</h3>
    <table><tr>${sigs}</tr></table>
    <h3>V. ACKNOWLEDGEMENT</h3>
    <div><b>EMPLOYEE CONFORME</b> &nbsp;·&nbsp; Signature: ______________________ &nbsp;·&nbsp; Date Received: ______________</div>
    <div class="mut" style="margin-top:8px;">Distribution: Original — HR 201 File · Duplicate — Employee Copy · Triplicate — Payroll</div>
    <script>window.print();</` + `script></body></html>`);
  w.document.close();
}
window.openNpaForm=openNpaForm;

/* ======================= MOVEMENTS · PERSONNEL MOVEMENT (NPA) =======================
   Implements the RCC Personnel Movement Guideline over the personnel_actions table.
   Every movement carries a BASIS that decides its lane:
     · Operational   → a MEMO (no NPA, no approval chain) — documented by the Dept Head.
     · Statutory     → an NPA processed by HR with NO approval gate (min-wage / mandated COLA).
                       An optional single "HR authorized" stamp (sig1) is available.
     · Discretionary → an NPA on the full 4-step sign chain
                       Grazel (Prepared) → Pervin (Noted) → Sanjay (Reviewed) → Anj (Approved).
   Uses ONLY existing columns; sig1..sig4 hold the ordered e-signatures.
   ----------------------------------------------------------------------------------- */
// Movement type → action_type enum bucket + which extra fields the form should show.
const MV_TYPES=[
  {label:"Promotion",                    action:"PROMOTION",         pay:true, pos:true},
  {label:"Salary Increase",              action:"SALARY_ADJUSTMENT", pay:true},
  {label:"Salary Adjustment",            action:"SALARY_ADJUSTMENT", pay:true},
  {label:"Allowance Adjustment",         action:"SALARY_ADJUSTMENT", pay:true},
  {label:"Transfer of Department",       action:"TRANSFER",          dept:true},
  {label:"Transfer of Branch / Location",action:"TRANSFER",          loc:true},
  {label:"Change of Position",           action:"RECLASSIFICATION",  pos:true},
  {label:"Change of Reporting Line",     action:"RECLASSIFICATION",  report:true},
  {label:"Temporary Assignment",         action:"TRANSFER",          loc:true},
  {label:"Change of Employment Status",  action:"RECLASSIFICATION",  estatus:true},
  {label:"Regularization",               action:"REGULARIZATION"},
  {label:"Schedule Change",              action:"SCHEDULE_CHANGE",   sched:true}
];
const MV_ACTION_LABEL={DEMOTION:"Demotion",PROMOTION:"Promotion",RECLASSIFICATION:"Reclassification",REGULARIZATION:"Regularization",SALARY_ADJUSTMENT:"Salary Adjustment",SCHEDULE_CHANGE:"Schedule Change",TRANSFER:"Transfer"};
const MV_BASES=["Operational","Statutory","Discretionary"];
// ── SELECTABLE, per-NPA approval chain (max 5 slots → sig1..sig5). ──────────────
// Step 1 is ALWAYS Grazel (Prepared / Paymaster) — locked. Grazel may add middle
// signatories, and the LAST slot must be a Management final approver (enforced).
const MV_STEP1={role:"Prepared by / Paymaster", name:"Grazel Lyn Agulto", email:"hr3@hassarams.com"};
// Middle signatories Grazel may append (in order). SC / Dept Head = name typed by
// Grazel, email optional (may have no login → wet-sign on the printed NPA).
const MV_SIGNATORY_OPTIONS=[
  {key:"sc",     role:"Sales Coordinator", name:"", email:"", typed:true},
  {key:"dh",     role:"Department Head",   name:"", email:"", typed:true},
  {key:"hrhead", role:"HR Head",           name:"Rhel Vinluan", email:"hr4@hassarams.com", typed:false}
];
// The final approver — the chain CANNOT be saved without exactly one of these, last.
const MV_MANAGEMENT=[
  {name:"Anju C. Genomal", email:"anj@hassarams.com"},
  {name:"Sanjay Chatlani", email:"sanjay@hassarams.com"},
  {name:"Pervin Chatlani", email:"pervin@hassarams.com"}
];
const MV_MGMT_ROLE="Approved by (Management)";
// Basis of a record: prefer the stored `basis` column, fall back to status inference.
function mvBasisFor(status){ return status==="memo"?"Operational":((status==="processing"||status==="scheduled")?"Statutory":"Discretionary"); }
function mvBasis(r){ if(r&&r.basis){ const b=String(r.basis); return b.charAt(0).toUpperCase()+b.slice(1).toLowerCase(); } return mvBasisFor(r&&r.status); }
// The ordered chain for a record — from `signers`, or a safe default (Grazel → Anj).
function mvChain(r){
  if(r && Array.isArray(r.signers) && r.signers.length) return r.signers.slice().sort((a,b)=>(a.seq||0)-(b.seq||0));
  return [ {seq:1, role:MV_STEP1.role, name:MV_STEP1.name, email:MV_STEP1.email},
           {seq:2, role:MV_MGMT_ROLE, name:"Anju C. Genomal", email:"anj@hassarams.com"} ];
}
function mvSignedCount(r){ let c=0; for(const st of mvChain(r)){ if(r["sig"+st.seq+"_data"]) c++; } return c; }
// First unsigned step in the chain (may be a no-email wet-sign step), or null if all signed.
function mvNextStep(r){ for(const st of mvChain(r)){ if(!r["sig"+st.seq+"_data"]) return st; } return null; }
// First unsigned step that is e-signable in-portal (has an email). No-email steps are
// wet-signed on the printed NPA — they don't gate the in-portal e-sign flow.
function mvActiveStep(r){ for(const st of mvChain(r)){ if(r["sig"+st.seq+"_data"]) continue; if(st.email) return st; } return null; }
function mvCanSignNow(r){ if(r.status!=="awaiting_signoff") return null;
  const me=((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase(); if(!me) return null;
  // Statutory (mandated) NPAs: order is NOT enforced — any signatory may sign their own unsigned step, in any order.
  if(mvBasis(r).toLowerCase()==="statutory"){
    for(const st of mvChain(r)){ if(!r["sig"+st.seq+"_data"] && me===String(st.email||"").toLowerCase()) return st; }
    return null; }
  // Discretionary: strict sequential order — only the current first-unsigned e-signable step.
  const st=mvActiveStep(r); if(!st) return null;
  return (me===String(st.email||"").toLowerCase())?st:null; }
function mvStatusPill(s){ const map={memo:["closed","Memo — Dept Head"],processing:["co","Processing (HR)"],awaiting_signoff:["cn","Awaiting sign-off"],approved:["active","Approved"],declined:["awol","Declined"],cancelled:["closed","Cancelled"]};
  const m=map[s]||["closed",esc(s||"—")]; return `<span class="pill ${m[0]}">${m[1]}</span>`; }
function mvPeso(n){ return (n==null||n==="")?"—":"₱"+Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }

// Categorise a movement into the two buckets anj tracks: Store/field vs Head Office/Warehouse.
function mvCat(r){ const d=String(r.department||"").toUpperCase(), p=String(r.current_position||"").toUpperCase();
  if(d.includes("DISER")||d.includes("STORE")||d.includes("RETAIL")||p.includes("DISER")||p.includes("ROVING")||p.includes("PROMO")||p.includes("MERCHAND")) return "Store / Promo Diser";
  return "Head Office / Warehouse"; }

// Group movements into "batches" — one increase/event = many people sharing effective date + basis + action.
let MV_FILTER=null;
function mvBatchKey(r){ return (r.effective_date||"—")+"|"+mvBasis(r)+"|"+(r.action_type||""); }
function mvBatchLabel(r){ const act=MV_ACTION_LABEL[r.action_type]||r.action_type||"Movement"; return mvBasis(r)+" · "+act; }

function renderMovements(){
  const pg=$("#page-movements"); if(!pg||!canSeeMovements()) return;
  const R=NPAS||[];
  let Rf = MV_FILTER ? R.filter(r=>mvBatchKey(r)===MV_FILTER) : R;
  if(MV_FILTER && !Rf.length){ MV_FILTER=null; Rf=R; }
  const now=new Date(), ym=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
  const awaiting=R.filter(r=>r.status==="awaiting_signoff").length;
  const forMemo=R.filter(r=>r.status==="memo").length;
  const apprMonth=R.filter(r=>r.status==="approved" && (r.approval_date||"").slice(0,7)===ym).length;
  const approvedAll=R.filter(r=>r.status==="approved").length;
  const cancelledAll=R.filter(r=>r.status==="cancelled").length;
  // Statutory NPAs where the current user is still an unsigned signatory — drives the batch-sign button (order not enforced).
  const mvMineStat=R.filter(r=>mvBasis(r).toLowerCase()==="statutory" && r.status==="awaiting_signoff" && mvCanSignNow(r));
  // Where does the CURRENT user stand? Only show tick/sign chrome to whoever still has to sign.
  const meEmail=((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase();
  const openRows=R.filter(r=>r.status==="awaiting_signoff");
  const iCanSign=openRows.filter(r=>mvCanSignNow(r));                          // rows waiting on ME to sign
  const iSignedWaiting=openRows.filter(r=>{ const mine=mvChain(r).find(s=>String(s.email||"").toLowerCase()===meEmail); return mine && r["sig"+mine.seq+"_data"] && !mvCanSignNow(r); }); // I signed, waiting on others
  const nextSigners=[...new Set(iSignedWaiting.map(r=>{ const ns=mvNextStep(r); return ns?(ns.name?ns.name+(ns.role?" ("+ns.role+")":""):(ns.role||"another signer")):""; }).filter(Boolean))];
  const mvSelCount=Rf.filter(r=>r.status==="awaiting_signoff"&&mvCanSignNow(r)&&(r.current_daily_rate!=null||r.new_daily_rate!=null||r.current_allowance!=null||r.new_allowance!=null)).length;
  // Batch progress cards — one card per increase/event (effective date + basis + action).
  const _batches={}; R.forEach(r=>{ const k=mvBatchKey(r); (_batches[k]=_batches[k]||{key:k,rows:[]}).rows.push(r); });
  const batchArr=Object.values(_batches).sort((a,b)=>String(b.rows[0].effective_date||"").localeCompare(String(a.rows[0].effective_date||"")));
  const batchCardsHtml=batchArr.map(b=>{ const rows=b.rows, tot=rows.length;
    const ap=rows.filter(r=>r.status==="approved").length, aw=rows.filter(r=>r.status==="awaiting_signoff").length, cx=rows.filter(r=>r.status==="cancelled").length, mo=rows.filter(r=>r.status==="memo").length;
    const eff=rows[0].effective_date, label=mvBatchLabel(rows[0]);
    const awRows=rows.filter(r=>r.status==="awaiting_signoff"); const myTurn=awRows.filter(r=>mvCanSignNow(r)).length;
    const nexts=[...new Set(awRows.map(r=>{ const s=mvNextStep(r); return s?(s.name||s.role||""):""; }).filter(Boolean))];
    const step=myTurn?`▶ <b>Your turn</b> — ${myTurn} to sign`:(aw?`⏳ Waiting on <b>${esc(nexts.join(", ")||"the next signer")}</b>`:(ap===tot?`✓ <b>Complete</b> — all approved`:(cx?`✓ Done — remainder cancelled`:"—")));
    const seg=(n,c)=> n>0?`<div style="width:${(n/tot*100).toFixed(1)}%;background:${c};"></div>`:"";
    const sel=MV_FILTER===b.key;
    return `<div class="mvbatch" data-bk="${esc(b.key)}" style="cursor:pointer;border:1px solid ${sel?"#2f9e5f":"#e2ebe5"};background:${sel?"#f2faf5":"#fff"};border-radius:11px;padding:12px 14px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;">
        <div style="font-weight:800;color:#12352a;">${esc(label)} <span class="note" style="display:inline;font-weight:600;">— effective ${eff?fmtDate(eff):"—"}</span></div>
        <div class="note" style="display:inline;">${tot} staff${sel?" · ▼ showing below":""}</div></div>
      <div style="display:flex;height:9px;border-radius:5px;overflow:hidden;background:#eef0ef;margin:8px 0 6px;">${seg(ap,"#2f9e5f")}${seg(aw,"#e0a92a")}${seg(cx,"#b9c0c7")}${seg(mo,"#8fa7d8")}</div>
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12.5px;">
        <div style="color:#3a5a48;"><b style="color:#2f9e5f;">${ap}</b> approved · <b style="color:#b5891f;">${aw}</b> awaiting${cx?` · <b style="color:#7a828a;">${cx}</b> cancelled`:""}${mo?` · <b>${mo}</b> memo`:""}</div>
        <div style="color:#12352a;">${step}</div></div></div>`; }).join("");
  // Batch-wide split by group (Store/Promo Diser vs Head Office/Warehouse) across all pay movements.
  const mvCatCounts=(()=>{ const c={}; R.filter(r=>(r.current_daily_rate!=null||r.new_daily_rate!=null||r.current_allowance!=null||r.new_allowance!=null)).forEach(r=>{ const k=mvCat(r); c[k]=(c[k]||0)+1; }); return c; })();
  const mvCatLine=Object.entries(mvCatCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${esc(k)} <b>${v}</b>`).join(" &nbsp;·&nbsp; ");
  const nb=document.querySelector('.nav-item[data-page="movements"] .nav-badge'); if(nb){ nb.textContent=awaiting||""; nb.style.display=awaiting?"":"none"; }
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Personnel Movement <span class="count-tag">Notice of Personnel Action</span></h2>
      <div class="psub">Every movement is filed by its <b>basis</b>. <b>Operational</b> (no change in terms) is a memo — no NPA.
        <b>Statutory</b> (min-wage / mandated COLA) and <b>Discretionary</b> (merit · promotion · market) each run a
        <b>chosen approval chain</b>: HR always prepares (Grazel), optional middle signatories are added per NPA, and a
        <b>Management</b> approver always signs last. Meal allowance is carried on every pay movement.</div>
      <div class="note" style="margin:8px 0;background:#fff8e6;border-color:#f0e2b8;color:#6b5a17;">📅 Reminder — NCR-27 2nd tranche: +₱25 → ₱780, effective Jan 20, 2027 (105 staff). Not yet filed; generate nearer the date.</div>
      <div class="actionbar">
        <button class="btn" id="mvNew">＋ New Movement</button>
        ${mvSelCount?`<button class="btn ghost" id="mvTickAll">✓ Tick all to increase · ${mvSelCount}</button>`:""}
        ${canSeePay()?`<button class="btn ghost" id="mvUpload">⬆ Upload batch (Excel)</button>`:""}
        ${canSeePay()?`<a class="btn ghost" href="./NPA-batch-template.xlsx" download style="text-decoration:none;">⬇ Excel template</a>`:""}
        ${canSeePay()?`<button class="btn ghost" id="mvBatch">Batch statutory increase</button>`:""}
        ${R.some(r=>r.status==="approved")?`<button class="btn ghost" id="mvDownloadAll">⬇ Download all approved (print)</button>`:""}
      </div>
      <input type="file" id="mvUpFile" accept=".xlsx,.xls,.csv" style="display:none;">
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi warn"><div class="k-l">Awaiting sign-off</div><div class="k-n">${awaiting}</div><div class="k-s">on the sign chain</div></div>
        <div class="kpi"><div class="k-l">Approved this month</div><div class="k-n">${apprMonth}</div></div>
        <div class="kpi"><div class="k-l">For memo</div><div class="k-n">${forMemo}</div><div class="k-s">operational</div></div>
      </div>
      <div class="psub" style="margin:6px 0 2px;"><b>${R.length}</b> total = <b>${awaiting}</b> awaiting sign-off · <b>${approvedAll}</b> approved${cancelledAll?` · <b>${cancelledAll}</b> cancelled`:""}${forMemo?` · <b>${forMemo}</b> memo`:""}</div>
      ${iCanSign.length?`<div class="note" style="margin:2px 0 6px;background:#fff8e6;border-color:#f0e2b8;color:#6b5a17;">✍ <b>${iCanSign.length}</b> NPA${iCanSign.length>1?"s":""} ${iCanSign.length>1?"are":"is"} waiting on <b>your</b> signature. Use <b>Tick all → Sign the selected</b>.</div>`
        :(iSignedWaiting.length?`<div class="note" style="margin:2px 0 6px;background:#eef7f0;border-color:#cfe6d6;color:#12352a;">✓ You've already signed your part on <b>${iSignedWaiting.length}</b> NPA${iSignedWaiting.length>1?"s":""}. Now waiting on ${nextSigners.length?"<b>"+nextSigners.join(", ")+"</b>":"the other signatory"} to countersign — then ${iSignedWaiting.length>1?"they become":"it becomes"} <b>Approved</b>. Nothing more for you to do here.</div>`:"")}
      ${mvCatLine?`<div class="psub" style="margin:2px 0 6px;padding:8px 12px;background:#f4f7f5;border:1px solid #e2ebe5;border-radius:9px;"><b>By group:</b> ${mvCatLine} &nbsp;·&nbsp; <b>${Object.values(mvCatCounts).reduce((a,b)=>a+b,0)}</b> total</div>`:""}
      ${batchCardsHtml?`<div class="subhead" style="margin:10px 0 6px;">By increase — click a card to see just those people</div>${batchCardsHtml}`:""}
      ${MV_FILTER?`<div class="psub" style="margin:2px 0 6px;">Showing one batch below · <a href="#" id="mvClearFilter" style="color:#1f6b3a;font-weight:700;">↺ show all</a></div>`:""}
      <div id="mvRecap" style="display:none;"></div>
      ${Rf.length?`<table><thead><tr><th style="width:30px;text-align:center;">${mvSelCount?'<input type="checkbox" id="mvChkAll" title="Tick all to increase">':""}</th><th>Employee</th><th>Movement</th><th>Effective</th><th>Status</th><th>Sign chain</th></tr></thead><tbody>
        ${Rf.map(r=>{ const disc=r.status==="awaiting_signoff"||r.status==="approved"; const sc=mvSignedCount(r); const tot=mvChain(r).length;
          const paychg=(r.current_daily_rate!=null||r.new_daily_rate!=null||r.current_allowance!=null||r.new_allowance!=null);
          const selectable=r.status==="awaiting_signoff"&&paychg;
          const curPay=(Number(r.current_daily_rate)||0)+(Number(r.current_allowance)||0)+(Number(r.meal_allowance)||0);
          const newPay=(Number(r.new_daily_rate!=null?r.new_daily_rate:r.current_daily_rate)||0)+(Number(r.new_allowance!=null?r.new_allowance:r.current_allowance)||0)+(Number(r.new_meal_allowance!=null?r.new_meal_allowance:r.meal_allowance)||0);
          const canSign=selectable&&!!mvCanSignNow(r);
          const nextS=mvNextStep(r); const waitName=nextS?(nextS.name?nextS.name+(nextS.role?" ("+nextS.role+")":""):(nextS.role||"another signer")):"";
          return `<tr class="clickable" data-nid="${esc(String(r.id))}">
          <td class="mvchk-cell" style="text-align:center;">${canSign?`<input type="checkbox" class="mvchk" data-nid="${esc(String(r.id))}" data-cur="${curPay}" data-new="${newPay}" data-cat="${esc(mvCat(r))}" data-waiting="${esc(waitName)}" data-cansign="1" checked>`:""}</td>
          <td><b>${esc(r.employee_name||"—")}</b><div class="esub">${esc(r.current_position||"")}${r.employee_number?" · "+esc(r.employee_number):""}</div></td>
          <td>${esc(MV_ACTION_LABEL[r.action_type]||r.action_type||"—")}<div class="esub">${esc(mvBasis(r))}</div></td>
          <td>${r.effective_date?fmtDate(r.effective_date):"—"}</td>
          <td>${mvStatusPill(r.status)}</td>
          <td>${disc?`<span class="pill ${sc>=tot?"active":(sc>0?"cn":"closed")}">${sc}/${tot} signed</span>`:'<span class="note" style="display:inline;padding:1px 6px;">—</span>'}</td></tr>`; }).join("")}
      </tbody></table>`:`<div class="psub" style="margin-top:6px;">No movements filed yet — click “＋ New Movement”.</div>`}
    </div>`;
  const bN=$("#mvNew"); if(bN) bN.addEventListener("click",mvPickEmployee);
  const bB=$("#mvBatch"); if(bB) bB.addEventListener("click",mvBatchStatutory);
  const bDA=$("#mvDownloadAll"); if(bDA) bDA.addEventListener("click",()=>mvDownloadAll(R.filter(r=>r.status==="approved")));
  // Checklist recap: tick rows → see the running total + increase, and sign the ticked ones in place.
  function mvRecalc(){
    const boxes=$$("#page-movements .mvchk"), checked=boxes.filter(b=>b.checked);
    const rb=$("#mvRecap"); if(!rb) return;
    const all=$("#mvChkAll"); if(all) all.checked=boxes.length>0&&checked.length===boxes.length;
    if(!checked.length){ rb.style.display="none"; rb.innerHTML=""; return; }
    // Group the ticked rows by their pay change (from → to) so the bar reads like the actual raise, not a meaningless sum.
    const groups={}, cats={}; let totalInc=0, nSign=0;
    checked.forEach(b=>{ const cur=Number(b.dataset.cur)||0, nw=Number(b.dataset.new)||0; const k=cur+"|"+nw; (groups[k]=groups[k]||{cur,nw,n:0}).n++; totalInc+=(nw-cur); const c=b.dataset.cat||"Other"; cats[c]=(cats[c]||0)+1; if(b.dataset.cansign==="1") nSign++; });
    const g=Object.values(groups).sort((a,b)=>b.n-a.n);
    const lines=g.map(x=>`<span style="white-space:nowrap;"><b>${x.n}</b> ${x.n===1?"item":"items"} · ${mvPeso(x.cur)} → <b>${mvPeso(x.nw)}</b> <span style="color:#1f6b3a;">(+${mvPeso(x.nw-x.cur)}/day)</span></span>`).join(' &nbsp;·&nbsp; ');
    const catLine=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${esc(k)} <b>${v}</b>`).join(" &nbsp;·&nbsp; ");
    rb.style.cssText="display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin:8px 0;padding:11px 15px;background:#eef7f0;border:1px solid #cfe6d6;border-radius:10px;";
    rb.innerHTML=`<div style="font-weight:800;color:#12352a;">${checked.length} selected to increase</div>
      <div style="flex:1 1 100%;color:#3a5a48;font-size:12.5px;">${catLine}</div>
      <div style="color:#2c5b41;">${lines}</div>
      ${g.length>1?`<div style="font-weight:800;color:#1f6b3a;">Total +${mvPeso(totalInc)}/day</div>`:""}
      <div style="flex:1;"></div>
      ${nSign?`<button class="btn" id="mvSignSel">✍ Sign the ${nSign} selected</button>`:(()=>{ const waits=[...new Set(checked.map(b=>b.dataset.waiting).filter(Boolean))]; return waits.length?`<span class="note" style="display:inline;">✓ Your signature is already in — now waiting on <b>${waits.join(", ")}</b> to sign.</span>`:`<span class="note" style="display:inline;">Nothing here needs your signature.</span>`; })()}`;
    const bss=$("#mvSignSel"); if(bss) bss.addEventListener("click",()=>{
      const ids=new Set(checked.filter(b=>b.dataset.cansign==="1").map(b=>b.dataset.nid));
      const list=(NPAS||[]).filter(r=>ids.has(String(r.id)));
      if(list.length) mvBatchSign(list);
    });
  }
  const bTA=$("#mvTickAll");
  if(bTA) bTA.addEventListener("click",()=>{ const cbs=$$("#page-movements .mvchk"); const allOn=cbs.length>0&&cbs.every(c=>c.checked); cbs.forEach(c=>{c.checked=!allOn;}); bTA.textContent=allOn?("✓ Tick all to increase · "+cbs.length):"✕ Untick all"; mvRecalc(); });
  $$("#page-movements .mvchk").forEach(cb=>{ cb.addEventListener("click",e=>e.stopPropagation()); cb.addEventListener("change",mvRecalc); });
  const chkAll=$("#mvChkAll");
  if(chkAll){ chkAll.addEventListener("click",e=>e.stopPropagation());
    chkAll.addEventListener("change",()=>{ $$("#page-movements .mvchk").forEach(cb=>{cb.checked=chkAll.checked;}); mvRecalc(); }); }
  mvRecalc();
  const bU=$("#mvUpload"), fU=$("#mvUpFile");
  if(bU&&fU){ bU.addEventListener("click",()=>fU.click());
    fU.addEventListener("change",e=>{ const f=e.target.files&&e.target.files[0]; if(f) mvUploadBatch(f); e.target.value=""; }); }
  $$("#page-movements tr.clickable[data-nid]").forEach(tr=>tr.addEventListener("click",()=>openMovementDrawer(NPAS.find(r=>String(r.id)===tr.dataset.nid))));
  // Batch cards: click to filter the table to just that increase (click again to clear).
  $$("#page-movements .mvbatch").forEach(el=>el.addEventListener("click",()=>{ const k=el.dataset.bk; MV_FILTER=(MV_FILTER===k)?null:k; renderMovements(); }));
  const bCF=$("#mvClearFilter"); if(bCF) bCF.addEventListener("click",e=>{ e.preventDefault(); MV_FILTER=null; renderMovements(); });
}
window.renderMovements=renderMovements;

function mvPickEmployee(){
  let m=document.getElementById("mvPick"); if(!m){ m=document.createElement("div"); m.id="mvPick"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;padding:22px;max-height:82vh;display:flex;flex-direction:column;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:2px;">New personnel movement</h2>
    <div class="psub">Search the employee — their record fills the movement automatically.</div>
    <input id="mvQ" placeholder="Type a name or ID…" autocomplete="off" style="width:100%;padding:10px 12px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;margin:4px 0 8px;">
    <div id="mvHits" style="overflow-y:auto;flex:1;"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn ghost" id="mvPickClose">Cancel</button></div>
  </div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("mvPickClose").onclick=()=>m.remove();
  const q=document.getElementById("mvQ"), hits=document.getElementById("mvHits");
  const paint=()=>{ const s=(q.value||"").trim().toLowerCase();
    let list=(EMPLOYEES||[]).slice().sort((a,b)=>(a.full_name||"").localeCompare(b.full_name||""));
    if(s) list=list.filter(e=>(e.full_name||"").toLowerCase().includes(s)||String(e.employee_id||"").includes(s));
    list=list.slice(0,20);
    hits.innerHTML=list.length?list.map(e=>`<div class="task clickable" data-eid="${esc(String(e.id))}" style="cursor:pointer;"><div class="dot ${(e.status||'Active')==='Active'?'g':'r'}"></div><div><div class="tt">${esc(e.full_name)}</div><div class="td">${esc(e.position||"—")} · ${esc(e.worksite||e.department||"—")}${e.employee_id?" · "+esc(e.employee_id):""}</div></div></div>`).join(""):`<div class="psub" style="padding:8px 2px;">${s?"No match.":"Start typing…"}</div>`;
    hits.querySelectorAll("[data-eid]").forEach(el=>el.addEventListener("click",()=>{ const e=EMPLOYEES.find(x=>String(x.id)===el.dataset.eid); m.remove(); if(e) openMovementForm(e); }));
  };
  q.addEventListener("input",paint); paint(); q.focus();
}

function openMovementForm(e){
  let m=document.getElementById("mvModal"); if(!m){ m=document.createElement("div"); m.id="mvModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:540px;width:100%;padding:22px;max-height:92vh;overflow-y:auto;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:2px;">Personnel Movement</h2>
    <div class="psub" style="margin-bottom:10px;">${esc(e.full_name)} · ${esc(e.position||"—")} · ${esc(e.worksite||e.department||"—")} — current details fill in automatically.</div>
    ${sel("mv_type","Movement type *",MV_TYPES.map(t=>t.label),"")}
    ${sel("mv_basis","Basis *",MV_BASES,"")}
    <div id="mv_basisNote" class="psub" style="margin:-4px 0 8px;"></div>
    <div id="mv_extra"></div>
    ${fld("mv_eff","Effective date *","","date")}
    <div id="mv_chain" style="margin:2px 0 10px;"></div>
    <div style="margin-bottom:10px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:4px;">Remarks / justification</label><textarea id="mv_remarks" rows="2" style="width:100%;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:13.5px;"></textarea></div>
    <div style="margin-bottom:10px;background:#f7faf8;border:1px solid #e2e7e4;border-radius:9px;padding:10px 12px;">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer;"><input type="checkbox" id="mv_notify" style="width:16px;height:16px;"> Notify the employee by email</label>
      <div class="psub" style="margin:4px 0 6px;">Optional — DOLE doesn't require notifying the employee of a salary movement (e.g. a minimum-wage increase). Tick only if you want to send them a copy.</div>
      <input id="mv_notify_email" placeholder="Employee email" value="${esc(e.email||"")}" autocomplete="off" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;font-size:13px;">
    </div>
    <div id="mvMsg" style="font-size:13px;color:#a4322a;margin:4px 0;"></div>
    <div style="display:flex;gap:10px;"><button class="btn ghost" id="mvCancel" style="flex:1;">Cancel</button><button class="btn" id="mvGo" style="flex:1;">File movement</button></div>
  </div>`;
  const mf=(id,l,val)=>fld(id,l,val,"number");
  const paintExtra=()=>{
    const t=MV_TYPES.find(x=>x.label===document.getElementById("mv_type").value)||{}; const x=document.getElementById("mv_extra");
    let h="";
    if(t.pay){ h += canSeePay()
      ? `<div class="form-grid">${mf("mv_dr_c","Current daily rate (₱)",e.daily_rate)}${mf("mv_dr_n","New daily rate (₱)","")}</div>
         <div class="form-grid">${mf("mv_al_c","Current allowance (₱)",e.daily_allowance)}${mf("mv_al_n","New allowance (₱)","")}</div>
         <div class="form-grid">${mf("mv_ml_c","Current meal allowance (₱)","")}${mf("mv_ml_n","New meal allowance (₱)","")}</div>
         <div class="psub" style="margin:-2px 0 6px;">Total compensation (basic + allowance + meal) computes on the NPA form. Salary data is confidential.</div>`
      : `<div class="note" style="margin-bottom:10px;">🔒 Pay movements can only be prepared by authorised payroll.</div>`; }
    if(t.dept){ h += `<div class="form-grid">${fld("mv_dep_c","From department",e.department)}${fld("mv_dep_n","To department","")}</div>`; }
    if(t.loc){ h += `<div class="form-grid">${fld("mv_loc_c","From branch / location",e.worksite||e.department)}${fld("mv_loc_n","To branch / location","")}</div>`; }
    if(t.pos){ h += `<div class="form-grid">${fld("mv_pos_c","Current position",e.position)}${fld("mv_pos_n","New position","")}</div>`; }
    if(t.report){ h += `<div class="form-grid">${fld("mv_rep_c","Current reporting line",e.supervisor_name)}${fld("mv_rep_n","New reporting line / supervisor","")}</div>`; }
    if(t.estatus){ h += `<div class="form-grid">${fld("mv_est_c","Current status",e.contract_type||e.status)}${sel("mv_est_n","New employment status",["Regular","Probationary","Contractual","Project-based","Seasonal"],"")}</div>`; }
    if(t.sched){ h += fld("mv_sch_n","New schedule",e.work_schedule||""); }
    x.innerHTML=h;
  };
  const paintBasis=()=>{ const b=document.getElementById("mv_basis").value; const n=document.getElementById("mv_basisNote");
    n.innerHTML = b==="Operational"? "📄 <b>Memo lane</b> — no NPA, no approval chain. Recorded as documented by the Dept Head."
      : b==="Statutory"? "⚖ <b>Approval lane</b> — HR prepares (Grazel) and a Management approver signs. Add signatories below."
      : b==="Discretionary"? "✍ <b>Approval lane</b> — build the sign chain below: Grazel → (optional signatories) → Management."
      : ""; paintChain(); };
  // ── Selectable approval-chain builder ─────────────────────────────────────────
  // mvMid = the middle signatories Grazel adds (between step 1 and Management).
  let mvMid=[]; let mvMgmt="";
  const syncMid=()=>{ mvMid.forEach((s,i)=>{ const nEl=document.getElementById("mv_mid_name_"+i); if(nEl) s.name=nEl.value; const eEl=document.getElementById("mv_mid_email_"+i); if(eEl) s.email=eEl.value; });
    const mg=document.getElementById("mv_mgmt"); if(mg) mvMgmt=mg.value; };
  const paintChain=()=>{
    const wrap=document.getElementById("mv_chain"); if(!wrap) return;
    const b=document.getElementById("mv_basis").value;
    if(b!=="Statutory" && b!=="Discretionary"){ wrap.innerHTML=""; return; }
    const total=1+mvMid.length+1; // Grazel + middles + Management
    const canAdd=total<5;
    const midRows=mvMid.map((s,i)=>{
      const nameInput=s.typed?`<input id="mv_mid_name_${i}" placeholder="Full name *" value="${esc(s.name||"")}" autocomplete="off" style="width:100%;padding:7px 9px;border:1px solid #e2e7e4;border-radius:7px;font-size:13px;margin-top:4px;">
        <input id="mv_mid_email_${i}" placeholder="Email (optional — leave blank to wet-sign on print)" value="${esc(s.email||"")}" autocomplete="off" style="width:100%;padding:7px 9px;border:1px solid #e2e7e4;border-radius:7px;font-size:12.5px;margin-top:4px;">`:"";
      const who=s.typed?"":`<span style="color:#3a4a41;font-weight:600;">${esc(s.name||"")}</span> · ${esc(s.email||"")}`;
      return `<div style="background:#f7faf8;border:1px solid #e2e7e4;border-radius:8px;padding:8px 10px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="font-size:12.5px;"><b>${i+2}.</b> ${esc(s.role)} ${who}</div>
          <button type="button" class="btn ghost" data-midrm="${i}" style="padding:2px 9px;font-size:12px;">Remove</button>
        </div>${nameInput}</div>`;
    }).join("");
    const addCtrl=canAdd
      ? `<div style="display:flex;gap:8px;margin:2px 0 8px;">
          <select id="mv_addPick" style="flex:1;padding:8px 10px;border:1px solid #e2e7e4;border-radius:8px;font-size:13px;background:#fff;">
            ${MV_SIGNATORY_OPTIONS.map(o=>`<option value="${o.key}">${esc(o.role)}${o.typed?"":" — "+esc(o.name)}</option>`).join("")}
          </select>
          <button type="button" class="btn ghost" id="mv_addSig" style="flex:0 0 auto;">＋ Add signatory</button>
        </div>`
      : `<div class="psub" style="margin:2px 0 8px;">Maximum of 5 signatories reached.</div>`;
    wrap.innerHTML=`<div style="border:1px solid #e2e7e4;border-radius:10px;padding:12px 12px 10px;background:#fff;">
      <div style="font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Approval chain (add signatory)</div>
      <div style="background:#eef4ef;border:1px solid #d6e5db;border-radius:8px;padding:8px 10px;margin-bottom:6px;font-size:12.5px;">
        <b>1.</b> ${esc(MV_STEP1.role)} · <span style="font-weight:600;">${esc(MV_STEP1.name)}</span> <span class="note" style="display:inline;padding:0 5px;">locked</span></div>
      ${midRows}
      ${addCtrl}
      <div style="margin-top:4px;">
        <label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">Final approver (Management) *</label>
        <select id="mv_mgmt" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:8px;font-size:13.5px;background:#fff;">
          <option value=""></option>
          ${MV_MANAGEMENT.map(mm=>`<option value="${esc(mm.email)}" ${mm.email===mvMgmt?"selected":""}>${esc(mm.name)}</option>`).join("")}
        </select>
      </div>
      <div class="psub" style="margin-top:6px;">Signs in order shown. Signatories without an email wet-sign on the printed NPA. Min 2, max 5.</div>
    </div>`;
    const ap=document.getElementById("mv_addSig"); if(ap) ap.onclick=()=>{ syncMid();
      const k=document.getElementById("mv_addPick").value; const o=MV_SIGNATORY_OPTIONS.find(x=>x.key===k); if(!o) return;
      if(1+mvMid.length+1>=5) return;
      mvMid.push({key:o.key, role:o.role, name:o.name||"", email:o.email||"", typed:!!o.typed}); paintChain(); };
    wrap.querySelectorAll("[data-midrm]").forEach(b2=>b2.onclick=()=>{ syncMid(); mvMid.splice(Number(b2.dataset.midrm),1); paintChain(); });
    const mg=document.getElementById("mv_mgmt"); if(mg) mg.onchange=()=>{ mvMgmt=mg.value; };
  };
  document.getElementById("mv_type").addEventListener("change",paintExtra);
  document.getElementById("mv_basis").addEventListener("change",paintBasis);
  document.getElementById("mvCancel").addEventListener("click",()=>m.remove());
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("mvGo").addEventListener("click",async()=>{
    const msg=document.getElementById("mvMsg");
    const tLabel=v("mv_type"), basis=v("mv_basis"), eff=v("mv_eff");
    const t=MV_TYPES.find(x=>x.label===tLabel);
    if(!t){ msg.textContent="Pick the movement type."; return; }
    if(!basis){ msg.textContent="Pick the basis (Operational / Statutory / Discretionary)."; return; }
    if(!eff){ msg.textContent="Set the effective date."; return; }
    if(t.pay && !canSeePay()){ msg.textContent="Pay movements are payroll-only."; return; }
    const notify=!!(document.getElementById("mv_notify")&&document.getElementById("mv_notify").checked);
    const notifyEmail=v("mv_notify_email");
    if(notify && !notifyEmail){ msg.textContent="Add the employee's email to notify them, or untick “Notify the employee”."; return; }
    // Build the ordered approval chain (Statutory + Discretionary both route it). Operational = memo, no chain.
    let signers=null;
    const status = basis==="Operational"?"memo":"awaiting_signoff";
    if(basis!=="Operational"){
      syncMid();
      if(!mvMgmt){ msg.textContent="Pick the final Management approver (Anj / Sanjay / Pervin)."; return; }
      for(const s of mvMid){ if(s.typed && !String(s.name||"").trim()){ msg.textContent="Enter a name for the "+s.role+" signatory (or remove it)."; return; } }
      const mm=MV_MANAGEMENT.find(x=>x.email===mvMgmt);
      const chain=[{role:MV_STEP1.role, name:MV_STEP1.name, email:MV_STEP1.email}]
        .concat(mvMid.map(s=>({role:s.role, name:String(s.name||"").trim(), email:String(s.email||"").trim()||null})))
        .concat([{role:MV_MGMT_ROLE, name:mm.name, email:mm.email}]);
      if(chain.length<2){ msg.textContent="The chain needs at least 2 signatories."; return; }
      if(chain.length>5){ msg.textContent="The chain can have at most 5 signatories."; return; }
      signers=chain.map((s,i)=>({seq:i+1, role:s.role, name:s.name, email:s.email||null}));
    }
    // Fold fields without a dedicated column (reporting line, employment status) into remarks so nothing is lost.
    const remarkParts=[]; if(v("mv_remarks")) remarkParts.push(v("mv_remarks"));
    if(t.report && (v("mv_rep_c")||v("mv_rep_n"))) remarkParts.push("Reporting line: "+(v("mv_rep_c")||"—")+" → "+(v("mv_rep_n")||"—"));
    if(t.estatus && (v("mv_est_c")||v("mv_est_n"))) remarkParts.push("Employment status: "+(v("mv_est_c")||"—")+" → "+(v("mv_est_n")||"—"));
    remarkParts.unshift("["+tLabel+" · "+basis+"]");
    const npa_id="NPA-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+Math.random().toString(36).slice(2,6).toUpperCase();
    const payload={ npa_id, action_type:t.action, employee_id:e.id||null, employee_name:e.full_name, employee_number:e.employee_id||null,
      department:e.department||null, current_position:e.position||null,
      new_position:v("mv_pos_n")||null, new_department:v("mv_dep_n")||null, new_location:v("mv_loc_n")||null,
      current_daily_rate:nv("mv_dr_c"), new_daily_rate:nv("mv_dr_n"), current_allowance:nv("mv_al_c"), new_allowance:nv("mv_al_n"),
      meal_allowance:nv("mv_ml_c"), new_meal_allowance:nv("mv_ml_n"), new_schedule:v("mv_sch_n")||null,
      effective_date:eff, remarks:remarkParts.join(" · "), status, basis:basis.toLowerCase(), signers,
      notify_employee:notify, notify_email:notify?notifyEmail:null,
      prepared_by:(CURRENT_USER&&CURRENT_USER.email)||"HR", created_by:(CURRENT_USER&&CURRENT_USER.id)||null };
    const btn=document.getElementById("mvGo"); btn.disabled=true; btn.textContent="Filing…";
    const { error }=await sb.from("personnel_actions").insert(payload);
    if(error){ msg.textContent=error.message; btn.disabled=false; btn.textContent="File movement"; return; }
    await logChange("movement",null,e.full_name,"Movement filed — "+tLabel,basis+" · "+npa_id+" · eff "+eff);
    m.remove(); await loadEmployees(); window.go("movements");
  });
  paintExtra(); paintBasis();
}
window.openMovementForm=openMovementForm;

function openMovementDrawer(r){
  if(!r) return;
  // The real document this record represents: operational basis = a Memorandum; anything else = an NPA.
  const docType=mvBasis(r).toLowerCase()==="operational"?"Memorandum":"Notice of Personnel Action (NPA)";
  const disc=r.status==="awaiting_signoff"||r.status==="approved";
  const stat=r.status==="processing";
  const signable=mvCanSignNow(r);
  const P=mvPeso;
  const payRows=(r.current_daily_rate!=null||r.new_daily_rate!=null||r.current_allowance!=null||r.new_allowance!=null||r.meal_allowance!=null||r.new_meal_allowance!=null);
  const tot=(dr,al,ml)=>{ if(dr==null&&al==null&&ml==null) return null; return (Number(dr)||0)+(Number(al)||0)+(Number(ml)||0); };
  const kv=(k,val)=>`<div class="efield"><div class="el">${esc(k)}</div><div class="ev">${val}</div></div>`;
  let m=document.getElementById("mvDrawer"); if(!m){ m=document.createElement("div"); m.id="mvDrawer"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  const chain=disc?mvChain(r):[];
  const active=disc?mvActiveStep(r):null;
  const chainHtml=disc?chain.map(st=>{ const done=!!r["sig"+st.seq+"_data"]; const by=r["sig"+st.seq+"_by"]; const at=r["sig"+st.seq+"_at"];
    const isNext=signable&&signable.seq===st.seq;
    const wet=!st.email;
    const state=done?("Signed"+(by?" by "+esc(by):"")+(at?" · "+fmtDate(at):""))
      :isNext?"Waiting on you now"
      :(wet?"Wet-sign on the printed NPA":(active&&active.seq===st.seq?("Waiting on "+esc(st.name)):"Pending"));
    return `<div class="task" style="align-items:flex-start;${isNext?'background:#fff8e6;border-radius:8px;':''}">
      <div class="dot ${done?'g':(isNext?'a':'')}" style="${done?'':'background:#d6ddd8;'}"></div>
      <div style="flex:1;"><div class="tt">Step ${st.seq} · ${esc(st.role)} — ${esc(st.name)}</div>
        <div class="td">${state}</div>
        ${done&&r["sig"+st.seq+"_data"]?`<img src="${r["sig"+st.seq+"_data"]}" style="height:32px;margin-top:5px;background:#fff;border:1px solid #e2e7e4;border-radius:4px;padding:2px 4px;">`:""}
      </div></div>`; }).join(""):"";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:600px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;z-index:2;">
      <div style="font-size:20px;font-weight:800;">${esc(r.employee_name||docType)}</div>
      <div style="font-size:12.5px;opacity:.9;">${esc(MV_ACTION_LABEL[r.action_type]||r.action_type||"")} · ${esc(mvBasis(r))} · ${esc(r.npa_id||"")}</div>
    </div>
    <div style="padding:16px 20px 70px;">
      <div class="panel" style="margin-top:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><h2 style="margin:0;">${esc(docType)}</h2>${mvStatusPill(r.status)}</div>
        <div class="egrid" style="margin-top:8px;">
          ${kv("Employee",esc(r.employee_name||"—")+(r.employee_number?' <span class="note" style="display:inline;padding:0 4px;">'+esc(r.employee_number)+'</span>':""))}
          ${kv("Current position",esc(r.current_position||"—"))}
          ${kv("Department",esc(r.department||"—"))}
          ${kv("Effective date",r.effective_date?fmtDate(r.effective_date):"—")}
          ${r.new_position?kv("New position",esc(r.new_position)):""}
          ${r.new_department?kv("To department",esc(r.new_department)):""}
          ${r.new_location?kv("To location",esc(r.new_location)):""}
          ${r.new_schedule?kv("New schedule",esc(r.new_schedule)):""}
        </div>
        ${r.remarks?`<div class="psub" style="margin-top:8px;"><b>Remarks:</b> ${esc(r.remarks)}</div>`:""}
        ${r.notify_employee?`<div class="psub" style="margin-top:6px;">📧 <b>Employee to be notified:</b> ${esc(r.notify_email||"—")} ${r.notified_at?`· sent ${fmtDate(r.notified_at)}`:`· <span style="color:#9a6a00;">pending — email sends once notifications are switched on</span>`}</div>`:""}
        ${r.status==="cancelled"?`<div class="note" style="margin-top:8px;background:#fbf3e2;border-color:#f0e2b8;color:#6b5a17;">✖ <b>Cancelled</b>${r.cancel_reason?" — "+esc(r.cancel_reason):""}${r.cancelled_by?` · by ${esc(r.cancelled_by)}`:""}${r.cancelled_at?" · "+fmtDate(r.cancelled_at):""}. Not counted in the awaiting/sign lists. Use <b>Reopen</b> to restore it.</div>`:""}
      </div>
      ${payRows&&canSeePay()?`<div class="panel"><div class="subhead">Financial details <span class="sh-note">confidential</span></div>
        <table><thead><tr><th></th><th style="text-align:right;">Current</th><th style="text-align:right;">New</th></tr></thead><tbody>
          <tr><td><b>Basic pay</b></td><td style="text-align:right;">${P(r.current_daily_rate)}</td><td style="text-align:right;">${P(r.new_daily_rate)}</td></tr>
          <tr><td><b>Allowance</b></td><td style="text-align:right;">${P(r.current_allowance)}</td><td style="text-align:right;">${P(r.new_allowance)}</td></tr>
          <tr><td><b>Meal allowance</b></td><td style="text-align:right;">${P(r.meal_allowance)}</td><td style="text-align:right;">${P(r.new_meal_allowance)}</td></tr>
          <tr><td><b>Total compensation</b></td><td style="text-align:right;">${P(tot(r.current_daily_rate,r.current_allowance,r.meal_allowance))}</td><td style="text-align:right;">${P(tot(r.new_daily_rate,r.new_allowance,r.new_meal_allowance))}</td></tr>
        </tbody></table></div>`:""}
      ${disc?`<div class="panel"><div class="subhead">Approval chain <span class="sh-note">${mvSignedCount(r)}/${chain.length} signed</span></div>${chainHtml}
        ${r.status==="approved"?`<div class="note" style="margin-top:8px;background:#eef6f0;border-color:#cfe6d8;color:#12352a;">✓ Fully approved${r.approval_date?" on "+fmtDate(r.approval_date):""}.</div>`:""}
      </div>`:stat?`<div class="panel"><div class="subhead">Statutory processing</div>
        <div class="psub">No approval chain — HR processes this and it takes effect on the effective date.${r.sig1_by?" <b>HR authorized</b> by "+esc(r.sig1_by)+(r.sig1_at?" · "+fmtDate(r.sig1_at):"")+".":""}</div>
        ${canSeePay()&&!r.sig1_by?`<button class="btn" id="mvAuth" style="margin-top:8px;">Stamp HR authorization</button>`:""}
      </div>`:`<div class="panel"><div class="subhead">Operational memo</div>
        <div class="psub">No change in terms — documented by memo (Dept Head). No NPA approval chain required.</div></div>`}
      <div style="display:flex;gap:10px;margin-top:6px;flex-wrap:wrap;">
        <button class="btn ghost" id="mvPrint">Download / Print NPA</button>
        ${signable?`<button class="btn" id="mvSign">Sign this step (${esc(signable.role)})</button>`:""}
        ${(isAdminUser()||canSeePay())&&r.status!=="cancelled"&&(r.status!=="approved"||isAdminUser())?`<button class="btn ghost" id="mvCancel" style="color:#9a6a00;border-color:#f0e2b8;">${r.status==="approved"?"✖ Void this approved NPA":"✖ Cancel NPA (e.g. reached EOC)"}</button>`:""}
        ${(isAdminUser()||canSeePay())&&r.status==="cancelled"?`<button class="btn ghost" id="mvReopen" style="color:#1f6b3a;border-color:#cfe6d6;">↩ Reopen NPA</button>`:""}
        <button class="btn ghost" id="mvDrawerClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("mvDrawerClose").onclick=()=>m.remove();
  document.getElementById("mvPrint").onclick=()=>printMovementNpa(r);
  const mvCancelBtn=document.getElementById("mvCancel"); if(mvCancelBtn) mvCancelBtn.onclick=async()=>{
    const origLabel=mvCancelBtn.textContent;
    const reason=prompt((r.status==="approved"?"⚠ This NPA is already APPROVED. Voiding it marks it Cancelled (kept on record, reopenable).\n\n":"Cancel this NPA for "+(r.employee_name||"")+"?\n\n")+"Type a reason (e.g. \"Reached end of contract\", \"Duplicate\", \"Wrong rate\"). Who cancelled, when, and this reason are all logged.");
    if(reason===null) return;
    if(!(reason||"").trim()){ alert("A reason is required so the cancellation is logged."); return; }
    mvCancelBtn.disabled=true; mvCancelBtn.textContent="Cancelling…";
    const em=(CURRENT_USER&&(CURRENT_USER.email||CURRENT_USER.name))||"HR";
    const { error }=await sb.from("personnel_actions").update({ status:"cancelled", cancel_reason:(reason||"").trim()||null, cancelled_by:em, cancelled_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq("id",r.id);
    if(error){ alert("Couldn't cancel: "+error.message); mvCancelBtn.disabled=false; mvCancelBtn.textContent=origLabel; return; }
    await logChange("movement",null,r.employee_name,"NPA cancelled",(r.npa_id||"")+(reason?" — "+reason:""));
    m.remove(); await loadEmployees(); window.go("movements");
  };
  const mvReopenBtn=document.getElementById("mvReopen"); if(mvReopenBtn) mvReopenBtn.onclick=async()=>{
    mvReopenBtn.disabled=true; mvReopenBtn.textContent="Reopening…";
    const chain=mvChain(r); const allSigned=chain.length>0 && chain.every(st=>r["sig"+st.seq+"_data"]);
    const back=allSigned?"approved":"awaiting_signoff";
    const { error }=await sb.from("personnel_actions").update({ status:back, cancel_reason:null, cancelled_by:null, cancelled_at:null, updated_at:new Date().toISOString() }).eq("id",r.id);
    if(error){ alert("Couldn't reopen: "+error.message); mvReopenBtn.disabled=false; mvReopenBtn.textContent="↩ Reopen NPA"; return; }
    await logChange("movement",null,r.employee_name,"NPA reopened",r.npa_id||"");
    m.remove(); await loadEmployees(); window.go("movements");
  };
  const sg=document.getElementById("mvSign"); if(sg) sg.onclick=()=>mvSignStep(r,signable);
  const au=document.getElementById("mvAuth"); if(au) au.onclick=async()=>{
    au.disabled=true; au.textContent="Stamping…";
    const em=(CURRENT_USER&&CURRENT_USER.email)||"HR";
    const { error }=await sb.from("personnel_actions").update({ sig1_by:em, sig1_at:new Date().toISOString(), noted_by:em, updated_at:new Date().toISOString() }).eq("id",r.id);
    if(error){ alert(error.message); au.disabled=false; au.textContent="Stamp HR authorization"; return; }
    await logChange("movement",null,r.employee_name,"Statutory movement HR-authorized",r.npa_id||"");
    m.remove(); await loadEmployees(); window.go("movements");
  };
}
window.openMovementDrawer=openMovementDrawer;

// Shared: turn an uploaded signature photo into a transparent-background PNG (white knocked out), PDF-style.
function mvSigMakeTransparent(img){ const c=document.createElement("canvas"); const s2=Math.min(1,700/img.width); c.width=Math.round(img.width*s2); c.height=Math.round(img.height*s2); const xx=c.getContext("2d"); xx.drawImage(img,0,0,c.width,c.height); const dd=xx.getImageData(0,0,c.width,c.height), p=dd.data; for(let i=0;i<p.length;i+=4){ const lum=(p[i]+p[i+1]+p[i+2])/3; if(lum>205){ p[i+3]=0; } else if(lum>130){ p[i+3]=Math.round((205-lum)/75*255); } else { p[i]=18;p[i+1]=53;p[i+2]=31; } } xx.putImageData(dd,0,0); return c.toDataURL("image/png"); }
// Shared: wire a "Upload signature" button + hidden file input to draw a knocked-out image onto a sign canvas.
function mvWireSigUpload(cv,ctx,btn,file,onDone){ if(!btn||!file) return; btn.onclick=()=>file.click();
  file.onchange=(ev)=>{ const f=ev.target.files&&ev.target.files[0]; if(!f) return; const rd=new FileReader();
    rd.onload=()=>{ const img=new Image(); img.onload=()=>{ const ti=new Image(); ti.onload=()=>{ ctx.clearRect(0,0,cv.width,cv.height); const s3=Math.min(cv.width/ti.width, cv.height/ti.height); const dw=ti.width*s3, dh=ti.height*s3; ctx.drawImage(ti,(cv.width-dw)/2,(cv.height-dh)/2,dw,dh); onDone&&onDone(); }; ti.src=mvSigMakeTransparent(img); }; img.src=rd.result; };
    rd.readAsDataURL(f); }; }

// Sign one step of a discretionary NPA — reuses the canvas draw widget.
function mvSignStep(r,step){
  if(!step) return;
  let m=document.getElementById("mvSignModal"); if(!m){ m=document.createElement("div"); m.id="mvSignModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:10001;background:rgba(14,30,50,.55);display:flex;align-items:center;justify-content:center;padding:20px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:92vh;overflow-y:auto;padding:22px;">
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1.6px;color:#6B7785;">NOTICE OF PERSONNEL ACTION · ${esc(r.npa_id||"")}</div>
    <div style="font-size:18px;font-weight:800;color:#12352a;margin:2px 0 3px;">${esc(step.role)} — sign to advance</div>
    <div class="psub" style="margin-bottom:8px;">${esc(r.employee_name||"")} · ${esc(MV_ACTION_LABEL[r.action_type]||r.action_type||"")} · effective ${r.effective_date?fmtDate(r.effective_date):"—"}. Step ${step.seq} of ${mvChain(r).length}.</div>
    <div style="font-size:12px;color:#6B7785;margin-bottom:6px;"><b>Upload your signature image</b> or draw it below. RA 8792 e-signature · timestamped + recorded against your account.</div>
    <canvas id="mvPad" width="480" height="150" style="width:100%;height:150px;border:1px dashed #b9c4cf;border-radius:10px;background:#fff;touch-action:none;cursor:crosshair;"></canvas>
    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
      <button class="btn ghost" id="mvSigUpload" type="button" style="flex:0 0 auto;">📷 Upload signature</button>
      <input type="file" id="mvSigFile" accept="image/*" style="display:none;">
      <button class="btn ghost" id="mvSigClear" style="flex:0 0 auto;">Clear</button>
      <span id="mvSigMsg" style="font-size:12.5px;color:#a4322a;flex:1 1 100%;"></span>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn ghost" id="mvSigCancel" style="margin-left:auto;">Cancel</button>
      <button class="btn" id="mvSigDo">Approve &amp; Sign</button>
    </div></div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("mvSigCancel").onclick=()=>m.remove();
  const cv=document.getElementById("mvPad"), ctx=cv.getContext("2d"); let drawing=false, dirty=false;
  ctx.lineWidth=2.2; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.strokeStyle="#13243b";
  const pos=e=>{ const rc=cv.getBoundingClientRect(), t=e.touches&&e.touches[0]?e.touches[0]:e; return {x:(t.clientX-rc.left)*(cv.width/rc.width), y:(t.clientY-rc.top)*(cv.height/rc.height)}; };
  const start=e=>{ drawing=true; dirty=true; const p=pos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); e.preventDefault(); };
  const move=e=>{ if(!drawing) return; const p=pos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); e.preventDefault(); };
  const end=()=>{ drawing=false; };
  cv.addEventListener("mousedown",start); cv.addEventListener("mousemove",move); window.addEventListener("mouseup",end);
  cv.addEventListener("touchstart",start,{passive:false}); cv.addEventListener("touchmove",move,{passive:false}); cv.addEventListener("touchend",end);
  document.getElementById("mvSigClear").onclick=()=>{ ctx.clearRect(0,0,cv.width,cv.height); dirty=false; };
  mvWireSigUpload(cv,ctx,document.getElementById("mvSigUpload"),document.getElementById("mvSigFile"),()=>{ dirty=true; document.getElementById("mvSigMsg").textContent=""; });
  document.getElementById("mvSigDo").onclick=async()=>{
    const msg=document.getElementById("mvSigMsg");
    if(!dirty){ msg.textContent="Add your signature first — upload an image or draw it."; return; }
    const btn=document.getElementById("mvSigDo"); btn.disabled=true; btn.textContent="Signing…";
    const now=new Date().toISOString(); const signer=(CURRENT_USER&&(CURRENT_USER.email||CURRENT_USER.name))||"Signed-in user";
    const chain=mvChain(r);
    // Fully approved once EVERY step carries a signature — count THIS step as signed. Handles out-of-order statutory signing.
    const allSigned=chain.every(st=> st.seq===step.seq || !!r["sig"+st.seq+"_data"]);
    const upd={ updated_at:now };
    upd["sig"+step.seq+"_by"]=signer; upd["sig"+step.seq+"_at"]=now; upd["sig"+step.seq+"_data"]=cv.toDataURL("image/png");
    if(allSigned){ upd.status="approved"; upd.approval_date=now.slice(0,10); upd.approved_by=signer; }
    const { error }=await sb.from("personnel_actions").update(upd).eq("id",r.id);
    if(error){ msg.textContent=error.message; btn.disabled=false; btn.textContent="Approve & Sign"; return; }
    await logChange("movement",null,r.employee_name,"NPA "+step.role.toLowerCase()+" (e-signed)",r.npa_id+(allSigned?" · fully approved":""));
    m.remove(); const dw=document.getElementById("mvDrawer"); if(dw) dw.remove(); await loadEmployees(); window.go("movements");
  };
}

// Batch e-sign: draw ONCE, then apply the current user's signature to their own unsigned
// step on every statutory awaiting_signoff NPA where they're a signatory. Order not enforced.
function mvBatchSign(list){
  list=(list||[]).filter(r=>mvBasis(r).toLowerCase()==="statutory" && r.status==="awaiting_signoff" && mvCanSignNow(r));
  if(!list.length) return;
  let m=document.getElementById("mvBatchModal"); if(!m){ m=document.createElement("div"); m.id="mvBatchModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:10001;background:rgba(14,30,50,.55);display:flex;align-items:center;justify-content:center;padding:20px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:92vh;overflow-y:auto;padding:22px;">
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1.6px;color:#6B7785;">STATUTORY NPA · BATCH SIGN-OFF</div>
    <div style="font-size:18px;font-weight:800;color:#12352a;margin:2px 0 3px;">Sign all ${list.length} NPA${list.length>1?"s":""} as you</div>
    <div class="psub" style="margin-bottom:8px;">Your signature is applied to your own step on ${list.length} mandated (statutory) NPA${list.length>1?"s":""}, in any order. Any that become fully signed are marked Approved.</div>
    <div style="font-size:12px;color:#6B7785;margin-bottom:6px;"><b>Upload your signature image</b> or draw it below — applied to all ${list.length}. RA 8792 e-signature · timestamped + recorded against your account.</div>
    <canvas id="mvBPad" width="480" height="150" style="width:100%;height:150px;border:1px dashed #b9c4cf;border-radius:10px;background:#fff;touch-action:none;cursor:crosshair;"></canvas>
    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
      <button class="btn ghost" id="mvBUpload" type="button" style="flex:0 0 auto;">📷 Upload signature</button>
      <input type="file" id="mvBFile" accept="image/*" style="display:none;">
      <button class="btn ghost" id="mvBClear" style="flex:0 0 auto;">Clear</button>
      <span id="mvBMsg" style="font-size:12.5px;color:#a4322a;flex:1 1 100%;"></span>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn ghost" id="mvBCancel" style="margin-left:auto;">Cancel</button>
      <button class="btn" id="mvBDo">Approve &amp; Sign all</button>
    </div></div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("mvBCancel").onclick=()=>m.remove();
  const cv=document.getElementById("mvBPad"), ctx=cv.getContext("2d"); let drawing=false, dirty=false;
  ctx.lineWidth=2.2; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.strokeStyle="#13243b";
  const pos=e=>{ const rc=cv.getBoundingClientRect(), t=e.touches&&e.touches[0]?e.touches[0]:e; return {x:(t.clientX-rc.left)*(cv.width/rc.width), y:(t.clientY-rc.top)*(cv.height/rc.height)}; };
  const start=e=>{ drawing=true; dirty=true; const p=pos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); e.preventDefault(); };
  const move=e=>{ if(!drawing) return; const p=pos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); e.preventDefault(); };
  const end=()=>{ drawing=false; };
  cv.addEventListener("mousedown",start); cv.addEventListener("mousemove",move); window.addEventListener("mouseup",end);
  cv.addEventListener("touchstart",start,{passive:false}); cv.addEventListener("touchmove",move,{passive:false}); cv.addEventListener("touchend",end);
  document.getElementById("mvBClear").onclick=()=>{ ctx.clearRect(0,0,cv.width,cv.height); dirty=false; };
  mvWireSigUpload(cv,ctx,document.getElementById("mvBUpload"),document.getElementById("mvBFile"),()=>{ dirty=true; document.getElementById("mvBMsg").textContent=""; });
  document.getElementById("mvBDo").onclick=async()=>{
    const msg=document.getElementById("mvBMsg");
    if(!dirty){ msg.textContent="Add your signature first — upload an image or draw it."; return; }
    const signer=(CURRENT_USER&&(CURRENT_USER.email||CURRENT_USER.name))||"Signed-in user";
    if(!confirm("Sign "+list.length+" NPA"+(list.length>1?"s":"")+" as "+signer+"?")) return;
    const btn=document.getElementById("mvBDo"); btn.disabled=true; btn.textContent="Signing…";
    const data=cv.toDataURL("image/png"); const now=new Date().toISOString();
    let signed=0, approved=0, failed=0;
    for(const r of list){
      const st=mvCanSignNow(r); if(!st) continue;
      const chain=mvChain(r);
      const allSigned=chain.every(s=> s.seq===st.seq || !!r["sig"+s.seq+"_data"]);
      const upd={ updated_at:now };
      upd["sig"+st.seq+"_by"]=signer; upd["sig"+st.seq+"_at"]=now; upd["sig"+st.seq+"_data"]=data;
      if(allSigned){ upd.status="approved"; upd.approval_date=now.slice(0,10); upd.approved_by=signer; }
      const { error }=await sb.from("personnel_actions").update(upd).eq("id",r.id);
      if(error){ failed++; continue; }
      signed++; if(allSigned) approved++;
    }
    await logChange("movement",null,null,"Batch e-signed statutory NPAs",signed+" signed"+(approved?" · "+approved+" fully approved":"")+(failed?" · "+failed+" failed":""));
    if(failed){ msg.textContent=failed+" could not be signed — signed "+signed+"."; }
    m.remove(); await loadEmployees(); window.go("movements");
  };
}

// Read-only NPA form + print on RCC letterhead. Mirrors the official
// "Notice of Personnel Action Form"; signatures are stamped where signed.
const MV_NPA_CSS=`
    *{box-sizing:border-box;} body{font-family:Arial,Helvetica,sans-serif;color:#1F2A37;max-width:760px;margin:18px auto;padding:0 22px;font-size:9.5pt;line-height:1.35;}
    .hd{display:flex;align-items:center;gap:12px;} .hd img{height:56px;}
    .rule{border-bottom:3px solid #1B5E20;margin:6px 0 10px;}
    .title{text-align:center;font-weight:800;font-size:13pt;letter-spacing:.5px;color:#12352a;margin:2px 0 12px;}
    h3{font-size:9.5pt;color:#1B5E20;font-weight:800;border-bottom:1px solid #cfe0d5;padding-bottom:2px;margin:13px 0 6px;letter-spacing:.3px;}
    table{width:100%;border-collapse:collapse;margin:4px 0;} td,th{border:1px solid #9fb0a6;padding:4px 7px;text-align:left;font-size:9pt;vertical-align:middle;}
    th{background:#eef4ef;color:#12352a;font-size:8.5pt;text-transform:uppercase;letter-spacing:.3px;} .r{text-align:right;} .tot td{background:#f3f8f4;font-weight:700;}
    .estat{margin:6px 0 2px;} .estat b{color:#12352a;} .chk{display:inline-block;margin:0 14px 3px 0;font-size:9pt;}
    .reasons{columns:2;margin:4px 0;} .reasons .chk{display:block;}
    .sc{height:48px;text-align:center;} .rmk{margin:6px 0;font-size:9pt;}
    .conf{background:#fdf6e3;border:1px solid #ecdca6;padding:6px 9px;font-size:8.5pt;font-weight:700;color:#8a6a14;margin:8px 0;}
    .conforme{margin:8px 0;font-size:9pt;} .dist{color:#667;font-size:8.5pt;margin-top:6px;}
    .ft{display:flex;justify-content:space-between;align-items:flex-end;border-top:2px solid #1B5E20;margin-top:22px;padding-top:6px;}
    .ft .tm{font-weight:800;color:#1B5E20;letter-spacing:.5px;font-size:10pt;} .ft .ad{text-align:right;color:#667;font-size:8pt;}
    .npa-page{max-width:760px;margin:0 auto;} @media print{ body{margin:0 auto;} .npa-page{page-break-after:always;} .npa-page:last-child{page-break-after:auto;} }
`;
// Build the NPA body HTML (sections I–V on RCC letterhead). Shared by single-print and Download-all.
function mvNpaBody(r){
  const pf=n=>(n==null||n==="")?"":"P"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  const num=n=>(n==null||n==="")?null:Number(n);
  const basis=mvBasis(r);
  const today=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});
  const dateIssued=r.created_at?new Date(r.created_at).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}):today;
  // ── II. Reason (Select One) ──
  const reasons=[
    {label:"Regularization",              at:["REGULARIZATION"]},
    {label:"Reappointment",               at:["REAPPOINTMENT"]},
    {label:"Promotion in Rank",           at:["PROMOTION"]},
    {label:"Separation",                  at:["SEPARATION","TERMINATION"]},
    {label:"Job-Lateral Transfer",        at:["TRANSFER","RECLASSIFICATION"]},
    {label:"Salary Adjustment (Complete Section III)", at:["SALARY_ADJUSTMENT"]}
  ];
  const reasonRows=reasons.map(x=>{ const on=x.at.includes(r.action_type); return `<div class="chk">[${on?"X":"&nbsp;"}] ${esc(x.label)}</div>`; }).join("");
  // ── III. Financial details (From / Adjustment / Total) ──
  const payRows=(r.current_daily_rate!=null||r.new_daily_rate!=null||r.current_allowance!=null||r.new_allowance!=null||r.meal_allowance!=null||r.new_meal_allowance!=null);
  const finRow=(label,cur,nw)=>{ const c=num(cur), n=num(nw); const adj=(c!=null||n!=null)?((n||0)-(c||0)):null;
    return `<tr><td><b>${label}</b></td><td class="r">${pf(cur)}</td><td class="r">${adj==null?"":pf(adj)}</td><td class="r">${pf(nw)}</td></tr>`; };
  const sum=(...xs)=>{ let any=false,t=0; xs.forEach(x=>{ if(x!=null){ any=true; t+=Number(x)||0; } }); return any?t:null; };
  const fromTot=sum(r.current_daily_rate,r.current_allowance,r.meal_allowance);
  const newTot=sum(r.new_daily_rate,r.new_allowance,r.new_meal_allowance);
  const adjTot=(fromTot!=null||newTot!=null)?((newTot||0)-(fromTot||0)):null;
  const remarksClean=String(r.remarks||"").replace(/^\s*\[[^\]]*\]\s*(·\s*)?/,"").trim();
  const fin=payRows?`
    <h3>III. FINANCIAL DETAILS</h3>
    <table><tr><th>CATEGORY</th><th class="r">FROM</th><th class="r">ADJUSTMENT</th><th class="r">TOTAL</th></tr>
      ${finRow("BASIC PAY",r.current_daily_rate,r.new_daily_rate)}
      ${finRow("ALLOWANCE",r.current_allowance,r.new_allowance)}
      ${finRow("MEAL ALLOWANCE",r.meal_allowance,r.new_meal_allowance)}
      <tr class="tot"><td><b>TOTAL COMPENSATION</b></td><td class="r">${pf(fromTot)}</td><td class="r">${adjTot==null?"":pf(adjTot)}</td><td class="r">${pf(newTot)}</td></tr></table>
    ${remarksClean?`<div class="rmk"><b>Remarks:</b> ${esc(remarksClean)}</div>`:""}`
    :`<h3>III. FINANCIAL DETAILS</h3><div class="rmk">No change in compensation under this action.${remarksClean?` <b>Remarks:</b> ${esc(remarksClean)}`:""}</div>`;
  // ── IV. Signatures (one column per signatory in the chain) ──
  const chain=mvChain(r);
  const w0=Math.max(16,Math.floor(84/Math.max(1,chain.length)));
  const roleHead=chain.map(st=>`<th style="width:${w0}%">${esc((st.role||"").toUpperCase())}</th>`).join("");
  const nameRow=chain.map(st=>`<td>${esc(st.name||"")}</td>`).join("");
  const sigRow=chain.map(st=>{ const d=r["sig"+st.seq+"_data"]; return `<td class="sc">${d?`<img src="${d}" style="height:40px;">`:"&nbsp;"}</td>`; }).join("");
  const dateRow=chain.map(st=>{ const at=r["sig"+st.seq+"_at"]; return `<td>${at?fmtDate(at):"________________"}</td>`; }).join("");
  return `
    <div class="hd"><img src="./rcc_logo.png" onerror="this.style.display='none'"><div style="font-weight:800;font-size:12pt;color:#1B5E20;">ROSHAN COMMERCIAL CORPORATION</div></div>
    <div class="rule"></div>
    <div class="title">NOTICE OF PERSONNEL ACTION FORM</div>
    <h3>I. EMPLOYEE INFORMATION</h3>
    <table>
      <tr><td><b>Employee Name</b></td><td>${esc(r.employee_name||"—")}</td><td><b>Date Issued</b></td><td>${esc(dateIssued)}</td></tr>
      <tr><td><b>Employee ID</b></td><td>${esc(r.employee_number||"—")}</td><td><b>Position</b></td><td>${esc(r.current_position||"—")}</td></tr>
      <tr><td><b>Location</b></td><td>${esc(r.department||"—")}</td><td><b>Effective Date</b></td><td>${r.effective_date?fmtDate(r.effective_date):"—"}</td></tr>
    </table>
    <div class="estat"><b>Employment Status (Select One):</b> &nbsp; [X] Regular &nbsp; [&nbsp;] Probationary &nbsp; [&nbsp;] Contractual &nbsp; [&nbsp;] Seasonal</div>
    <h3>II. REASON FOR PERSONNEL ACTION (Select One)</h3>
    <div class="reasons">${reasonRows}</div>
    ${fin}
    <h3>IV. SIGNATURES AND APPROVALS</h3>
    <table>
      <tr>${roleHead}</tr>
      <tr>${nameRow}</tr>
      <tr>${sigRow}</tr>
      <tr>${dateRow}</tr>
    </table>
    <div style="font-size:8pt;color:#667;margin-top:2px;">Row order: Role · Name · Signature · Date.</div>
    <h3>V. ACKNOWLEDGEMENT AND DISTRIBUTION</h3>
    <div class="conf">Important Note: SALARY data indicated in this form is strictly CONFIDENTIAL.</div>
    <div class="conforme"><b>EMPLOYEE CONFORME</b> &nbsp;·&nbsp; Employee Signature: ______________________ &nbsp;·&nbsp; Date Received: ______________</div>
    <div class="dist">Distribution: Original – HR 201 File, Duplicate – Employee Copy, Triplicate – Payroll.</div>
    <div class="ft"><div class="tm">THE RIGHT MOVE</div><div class="ad">3rd Floor RCC Center, 104 Shaw Boulevard, Pasig, Manila, 1603, Philippines · +632 86386556</div></div>`;
}
function printMovementNpa(r){
  const w=window.open("","_blank"); if(!w){ alert("Allow pop-ups to view/print the form."); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>${esc(r.npa_id||"NPA")} — Notice of Personnel Action Form</title><style>${MV_NPA_CSS}</style></head><body>${mvNpaBody(r)}<scr`+`ipt>window.print();</scr`+`ipt></body></html>`);
  w.document.close();
}
// Download/print ALL supplied NPAs in ONE document, one per page — for 201-file printing.
function mvDownloadAll(list){
  list=(list||[]).filter(Boolean); if(!list.length){ alert("No NPAs to download yet."); return; }
  const w=window.open("","_blank"); if(!w){ alert("Allow pop-ups to print."); return; }
  const pages=list.map(r=>`<div class="npa-page">${mvNpaBody(r)}</div>`).join("");
  w.document.write(`<!DOCTYPE html><html><head><title>NPAs — ${list.length} record(s)</title><style>${MV_NPA_CSS}</style></head><body>${pages}<scr`+`ipt>window.print();</scr`+`ipt></body></html>`);
  w.document.close();
}

// Batch statutory increase — ONE HR authorization covers a filtered set; one personnel_actions row each, status "processing".
function mvBatchStatutory(){
  if(!canSeePay()){ alert("Statutory batch is payroll-only."); return; }
  const sites=[...new Set((EMPLOYEES||[]).map(e=>e.worksite).filter(Boolean))].sort();
  let m=document.getElementById("mvBatchModal"); if(!m){ m=document.createElement("div"); m.id="mvBatchModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:480px;width:100%;padding:22px;max-height:92vh;overflow-y:auto;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:2px;">Batch statutory increase</h2>
    <div class="psub" style="margin-bottom:10px;">For a mandated increase (min-wage order / COLA). One HR authorization covers everyone in scope — no per-person approval chain. Creates one NPA per employee, status <b>Processing</b>, under a shared batch label.</div>
    ${fld("mvb_label","Batch label * (e.g. NCR Wage Order 2026)","")}
    ${fld("mvb_eff","Effective date *","","date")}
    <div class="form-grid">${sel("mvb_scope","Scope",["All active employees"].concat(sites),"All active employees")}${fld("mvb_amt","Daily increase (₱, optional)","","number")}</div>
    <div id="mvbCount" class="psub" style="margin:2px 0 6px;"></div>
    <div id="mvbMsg" style="font-size:13px;color:#a4322a;margin:4px 0;"></div>
    <div style="display:flex;gap:10px;"><button class="btn ghost" id="mvbCancel" style="flex:1;">Cancel</button><button class="btn" id="mvbGo" style="flex:1;">File batch</button></div>
  </div>`;
  const scopeList=()=>{ const sc=v("mvb_scope"); return (EMPLOYEES||[]).filter(e=>(e.status||"Active")==="Active" && (sc==="All active employees"||e.worksite===sc)); };
  const refresh=()=>{ const el=document.getElementById("mvbCount"); if(el) el.textContent=scopeList().length+" active employee(s) in scope."; };
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("mvbCancel").onclick=()=>m.remove();
  document.getElementById("mvb_scope").addEventListener("change",refresh);
  document.getElementById("mvbGo").onclick=async()=>{
    const msg=document.getElementById("mvbMsg");
    const label=v("mvb_label"), eff=v("mvb_eff"), amt=nv("mvb_amt");
    if(!label){ msg.textContent="Give the batch a label."; return; }
    if(!eff){ msg.textContent="Set the effective date."; return; }
    const list=scopeList();
    if(!list.length){ msg.textContent="No active employees in that scope."; return; }
    if(!confirm("File a statutory movement for "+list.length+" employee(s) under \""+label+"\"?\nThis is ONE HR authorization — no per-person approval chain.")) return;
    const btn=document.getElementById("mvbGo"); btn.disabled=true; btn.textContent="Filing "+list.length+"…";
    const em=(CURRENT_USER&&CURRENT_USER.email)||"HR"; const now=new Date().toISOString();
    const stamp="NPA-"+now.slice(0,10).replace(/-/g,"");
    const rows=list.map((e,i)=>({ npa_id:stamp+"-B"+String(i+1).padStart(3,"0"), action_type:"SALARY_ADJUSTMENT",
      employee_id:e.id||null, employee_name:e.full_name, employee_number:e.employee_id||null, department:e.department||null, current_position:e.position||null,
      current_daily_rate:(canSeePay()?e.daily_rate:null)??null, new_daily_rate:(amt!=null&&e.daily_rate!=null)?(Number(e.daily_rate)+amt):null,
      effective_date:eff, remarks:"[Statutory batch: "+label+"]"+(amt!=null?" · +₱"+amt+"/day":""), status:"processing",
      prepared_by:em, noted_by:em, sig1_by:em, sig1_at:now, created_by:(CURRENT_USER&&CURRENT_USER.id)||null }));
    const { error }=await sb.from("personnel_actions").insert(rows);
    if(error){ msg.textContent=error.message; btn.disabled=false; btn.textContent="File batch"; return; }
    await logChange("movement",null,label,"Statutory batch filed",list.length+" employee(s) · eff "+eff+(amt!=null?" · +₱"+amt+"/day":""));
    m.remove(); await loadEmployees(); window.go("movements");
  };
  refresh();
}
window.mvBatchStatutory=mvBatchStatutory;

/* ── Excel batch upload → one NPA (Salary Adjustment) per row ──────────────────
   Reads the min-wage-style workbook (Emp ID · Last · First · Department · Job
   Title · Current Daily Rate · Allowance · Meal Allowance · Basic Increase ·
   Allowance Increase · New Total Daily · Resigning? · Effective Date). Reuses the
   Timekeeping SheetJS loader + parser. Each row becomes an awaiting_signoff NPA
   with the standard chain Grazel → chosen Management approver. */
let MV_UPLOAD=null; // {rows:[{...}], fileDate:"yyyy-mm-dd"|null, name}
function mvNum(v){ if(v==null||v==="") return null; const n=Number(String(v).replace(/[,₱\s]/g,"")); return isFinite(n)?n:null; }
function mvExcelDate(v){ // → yyyy-mm-dd (or null)
  if(v==null||v==="") return null;
  if(typeof v==="number" && isFinite(v) && window.XLSX && window.XLSX.SSF){ const d=window.XLSX.SSF.parse_date_code(v);
    if(d&&d.y) return d.y+"-"+String(d.m).padStart(2,"0")+"-"+String(d.d).padStart(2,"0"); }
  if(v instanceof Date && !isNaN(v)) return v.getFullYear()+"-"+String(v.getMonth()+1).padStart(2,"0")+"-"+String(v.getDate()).padStart(2,"0");
  const s=String(v).trim(); if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const d=new Date(s); return isNaN(d)?null:d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function mvNorm(s){ return String(s==null?"":s).toLowerCase().replace(/[^a-z0-9]/g,""); }
// Map a header row to column indexes — tolerant of missing / re-worded columns.
function mvMapCols(hdr){
  const idx={}; const find=(...keys)=>{ for(let c=0;c<hdr.length;c++){ const h=mvNorm(hdr[c]); if(!h) continue;
    if(keys.some(k=>h===k||h.includes(k))) return c; } return -1; };
  idx.empid=find("empid","employeeid","employeeno","empno","idno");
  idx.last=find("lastname","surname");
  idx.first=find("firstname","givenname");
  idx.name=find("employeename","fullname"); // fallback single-name column
  if(idx.name<0){ for(let c=0;c<hdr.length;c++){ if(mvNorm(hdr[c])==="name"){ idx.name=c; break; } } }
  idx.dept=find("department","dept");
  idx.job=find("jobtitle","position","designation");
  idx.dr=find("currentdailyrate","dailyrate","currentrate","currentdaily");
  idx.ainc=find("allowanceincrease");
  // Current allowance = "Current Allowance", or a plain "Allowance" that is NOT the increase / meal column.
  idx.allow=find("currentallowance");
  if(idx.allow<0){ for(let c=0;c<hdr.length;c++){ const h=mvNorm(hdr[c]); if(h==="allowance"&&c!==idx.ainc){ idx.allow=c; break; } } }
  idx.meal=find("mealallowance");
  if(idx.meal<0){ for(let c=0;c<hdr.length;c++){ const h=mvNorm(hdr[c]); if(h==="meal"){ idx.meal=c; break; } } }
  idx.binc=find("basicincrease","basicincreasedaily","increasebasic");
  idx.newtot=find("newtotaldaily","newtotal","newdailyrate","newdaily");
  idx.resign=find("resigning","resign","resigned");
  idx.eff=find("effectivedate","effectivity","effective");
  return idx;
}
async function mvUploadBatch(file){
  if(!canSeePay()){ alert("Excel batch upload is payroll-only."); return; }
  try{
    await tkLoadSheetJS();
    const buf=await file.arrayBuffer();
    const wb=window.XLSX.read(new Uint8Array(buf),{type:"array"});
    const sh=wb.Sheets[wb.SheetNames[0]]; if(!sh) throw new Error("The workbook has no sheets.");
    const grid=window.XLSX.utils.sheet_to_json(sh,{header:1,defval:null});
    if(!grid.length) throw new Error("The sheet is empty.");
    // Auto-detect the header row: scan the first ~15 rows for an Emp/Employee ID or Last Name cell.
    let hr=-1;
    for(let r=0;r<Math.min(15,grid.length);r++){ const row=grid[r]||[];
      if(row.some(c=>{ const h=mvNorm(c); return h==="empid"||h==="employeeid"||h==="employeeno"||h==="lastname"||h==="surname"; })){ hr=r; break; } }
    if(hr<0) throw new Error("Couldn't find the header row (looked for “Emp ID” / “Employee ID” / “Last Name” in the first 15 rows).");
    const idx=mvMapCols(grid[hr]);
    const rows=[]; let fileDate=null;
    for(let r=hr+1;r<grid.length;r++){ const row=grid[r]||[];
      const cell=c=>c>=0?row[c]:null;
      const first=cell(idx.first), last=cell(idx.last), single=cell(idx.name), empid=cell(idx.empid);
      const nm=[first,last].filter(x=>x!=null&&String(x).trim()!=="").join(" ").trim() || String(single||"").trim();
      if(!nm && (empid==null||String(empid).trim()==="")) continue; // skip blank rows
      const drC=mvNum(cell(idx.dr)), binc=mvNum(cell(idx.binc)), newtot=mvNum(cell(idx.newtot));
      const alC=mvNum(cell(idx.allow)), ainc=mvNum(cell(idx.ainc)), meal=mvNum(cell(idx.meal));
      const eff=mvExcelDate(cell(idx.eff)); if(eff&&!fileDate) fileDate=eff;
      const newDr=(newtot!=null)?newtot:((drC!=null&&binc!=null)?drC+binc:(drC!=null?drC:null));
      const newAl=(alC!=null&&ainc!=null)?alC+ainc:(ainc!=null?ainc:null);
      const resignRaw=cell(idx.resign); const resigning=/^(y|yes|true|1|resign)/i.test(String(resignRaw==null?"":resignRaw).trim());
      rows.push({ empid:empid!=null?String(empid).trim():null, name:nm, dept:cell(idx.dept)!=null?String(cell(idx.dept)).trim():null,
        job:cell(idx.job)!=null?String(cell(idx.job)).trim():null, drC, newDr, alC, newAl, meal, resigning, eff });
    }
    if(!rows.length) throw new Error("No data rows found under the header.");
    MV_UPLOAD={ rows, fileDate, name:file.name };
    mvUploadPreview();
  }catch(e){ alert("⚠ "+((e&&e.message)||e)); }
}
function mvUploadPreview(){
  if(!MV_UPLOAD) return;
  const { rows, fileDate, name }=MV_UPLOAD;
  let m=document.getElementById("mvUpModal"); if(!m){ m=document.createElement("div"); m.id="mvUpModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  const first5=rows.slice(0,5).map(r=>esc(r.name||"—")+(r.empid?' <span class="note" style="display:inline;padding:0 4px;">'+esc(r.empid)+"</span>":"")).join("<br>");
  const dflt=fileDate||new Date().toISOString().slice(0,10);
  const resigningN=rows.filter(r=>r.resigning).length;
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;padding:22px;max-height:92vh;overflow-y:auto;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:2px;">Upload batch — ${esc(name||"Excel")}</h2>
    <div class="psub" style="margin-bottom:8px;"><b>${rows.length}</b> row(s) parsed. One <b>Salary Adjustment</b> NPA is filed per row, each routed for sign-off (Grazel → Management).${resigningN?' <span style="color:#9a6a00;">'+resigningN+" flagged “resigning”.</span>":""}</div>
    <div style="background:#f7faf8;border:1px solid #e2e7e4;border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:13px;">
      <div style="font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:4px;">First ${Math.min(5,rows.length)} of ${rows.length}</div>${first5||"—"}</div>
    ${sel("mvu_basis","Basis *",["Statutory","Discretionary"],"Statutory")}
    ${fld("mvu_eff","Effective date (applied to all rows) *",dflt,"date")}
    <div style="margin-bottom:10px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">Final approver (Management) *</label>
      <select id="mvu_mgmt" style="width:100%;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;background:#fff;">
        ${MV_MANAGEMENT.map((mm,i)=>`<option value="${esc(mm.email)}" ${i===0?"selected":""}>${esc(mm.name)}</option>`).join("")}
      </select></div>
    <div id="mvuMsg" style="font-size:13px;color:#a4322a;margin:4px 0;"></div>
    <div style="display:flex;gap:10px;"><button class="btn ghost" id="mvuCancel" style="flex:1;">Cancel</button><button class="btn" id="mvuGo" style="flex:1;">Create ${rows.length} NPA(s)</button></div>
  </div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("mvuCancel").onclick=()=>m.remove();
  document.getElementById("mvuGo").onclick=async()=>{
    const msg=document.getElementById("mvuMsg");
    const basis=v("mvu_basis")||"Statutory", eff=v("mvu_eff"), mgmt=(document.getElementById("mvu_mgmt")||{}).value;
    if(!eff){ msg.textContent="Set the effective date."; return; }
    const mm=MV_MANAGEMENT.find(x=>x.email===mgmt); if(!mm){ msg.textContent="Pick the Management approver."; return; }
    const btn=document.getElementById("mvuGo"); btn.disabled=true; btn.textContent="Creating "+rows.length+"…";
    const signers=[{seq:1, role:MV_STEP1.role, name:MV_STEP1.name, email:MV_STEP1.email},
                   {seq:2, role:MV_MGMT_ROLE, name:mm.name, email:mm.email}];
    const payload=rows.map(r=>{
      const emp=(EMPLOYEES||[]).find(x=>r.empid&&String(x.employee_id)===String(r.empid));
      const npa_id="NPA-UP-"+(r.empid||"X")+"-"+Math.random().toString(36).slice(2,6).toUpperCase();
      const remarkParts=["[Salary Adjustment · "+basis+"]","Excel batch upload"];
      if(r.resigning) remarkParts.push("Flagged resigning");
      return { npa_id, action_type:"SALARY_ADJUSTMENT", employee_id:emp?emp.id:null, employee_name:r.name,
        employee_number:r.empid||null, department:r.dept||null, current_position:r.job||null,
        current_daily_rate:r.drC, new_daily_rate:r.newDr, current_allowance:r.alC, new_allowance:r.newAl,
        meal_allowance:r.meal, new_meal_allowance:r.meal, effective_date:eff,
        remarks:remarkParts.join(" · "), status:"awaiting_signoff", basis:basis.toLowerCase(), signers,
        prepared_by:"Grazel Lyn Agulto", created_by:(CURRENT_USER&&CURRENT_USER.id)||null };
    });
    const { error }=await sb.from("personnel_actions").insert(payload);
    if(error){ msg.textContent=error.message; btn.disabled=false; btn.textContent="Create "+rows.length+" NPA(s)"; return; }
    await logChange("movement",null,MV_UPLOAD.name||"Excel batch","Movement batch uploaded (Excel)",rows.length+" NPA(s) · "+basis+" · eff "+eff);
    MV_UPLOAD=null; m.remove(); alert("Created "+rows.length+" salary-adjustment NPA(s) — each is awaiting sign-off.");
    await loadEmployees(); window.go("movements");
  };
}
window.mvUploadBatch=mvUploadBatch;

/* ================= POLICIES & PROCESSES ==================
   Reference library. Everyone logged-in can READ; only admin/manager
   (canEditPolicies) create/edit. Policies flagged requires_ack ask each
   employee to read + e-sign (canvas widget, same as the NPA sign step) →
   a row in policy_acknowledgments. Processes carry a steps[] SOP list.
   Uses ONLY the policies / policy_acknowledgments / processes columns.
   --------------------------------------------------------- */
// Resolve the signed-in user to an employee record (by email) — used for the ack roster.
function currentEmployee(){ const e=((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase(); if(!e) return null; return (EMPLOYEES||[]).find(x=>(x.email||"").toLowerCase()===e)||null; }
function polStatusPill(s){ const map={active:["active","Active"],draft:["cn","Draft"],superseded:["closed","Superseded"]}; const m=map[s]||["closed",esc(s||"—")]; return `<span class="pill ${m[0]}">${m[1]}</span>`; }
function procStatusPill(s){ const map={active:["active","Active"],draft:["cn","Draft"],archived:["closed","Archived"]}; const m=map[s]||["closed",esc(s||"—")]; return `<span class="pill ${m[0]}">${m[1]}</span>`; }
// Acks matching this policy at its current version.
function polAcksFor(p){ return (POLICY_ACKS||[]).filter(a=>String(a.policy_id)===String(p.id) && String(a.policy_version||"")===String(p.version||"")); }
// Identity of the signed-in user for the ack roster. employee_id is a UUID FK to employees.id
// (null for HR-only logins with no employee record); we match those by name instead.
function polMyIdentity(){ const me=currentEmployee(); return { name:(me&&me.full_name)||(CURRENT_USER&&CURRENT_USER.email)||"User", empId:(me&&me.id)||null, empNo:(me&&me.employee_id)||null, emp:me }; }
function polMatchesMe(a){ const id=polMyIdentity(); if(id.empId) return String(a.employee_id||"")===String(id.empId); return (a.employee_name||"")===id.name; }
function polIAcked(p){ return polAcksFor(p).some(polMatchesMe); }

function renderPolicies(){
  const pg=$("#page-policies"); if(!pg||!CURRENT_USER) return;
  const edit=canEditPolicies();
  const R=(POLICIES||[]).slice().sort((a,b)=>(a.title||"").localeCompare(b.title||""));
  const active=R.filter(p=>p.status==="active").length;
  const draft=R.filter(p=>p.status==="draft").length;
  const pending=R.filter(p=>p.status==="active"&&p.requires_ack&&!polIAcked(p)).length;
  const nb=document.querySelector('.nav-item[data-page="policies"] .nav-badge'); if(nb){ nb.textContent=pending||""; nb.style.display=pending?"":"none"; }
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Policies <span class="count-tag">Company handbook</span></h2>
      <div class="psub">Reference library of RCC policies. Everyone can read them here; ${edit?"you can add and update policies.":"only HR management can add or edit."} Policies marked <b>Acknowledgment required</b> ask each employee to read and e-sign.</div>
      ${edit?`<div class="actionbar"><button class="btn" id="polNew">＋ New Policy</button></div>`:""}
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi"><div class="k-l">Active policies</div><div class="k-n">${active}</div></div>
        <div class="kpi"><div class="k-l">Draft</div><div class="k-n">${draft}</div></div>
        <div class="kpi ${pending?"warn":""}"><div class="k-l">Pending acknowledgments</div><div class="k-n">${pending}</div><div class="k-s">you haven't signed</div></div>
      </div>
      ${R.length?`<table><thead><tr><th>Policy</th><th>Category</th><th>Version</th><th>Status</th><th>Effective</th><th>Acknowledgment</th></tr></thead><tbody>
        ${R.map(p=>{ const n=polAcksFor(p).length;
          return `<tr class="clickable" data-pid="${esc(String(p.id))}"><td><b>${esc(p.title||"—")}</b>${p.policy_no?`<div class="esub">${esc(p.policy_no)}</div>`:""}</td>
          <td>${esc(p.category||"—")}</td>
          <td>${esc(p.version||"—")}</td>
          <td>${polStatusPill(p.status)}</td>
          <td>${p.effective_date?fmtDate(p.effective_date):"—"}</td>
          <td>${p.requires_ack?`<span class="pill ${polIAcked(p)?"active":"cn"}">${n} acknowledged</span>`:'<span class="note" style="display:inline;padding:1px 6px;">—</span>'}</td></tr>`; }).join("")}
      </tbody></table>`:`<div class="psub" style="margin-top:6px;">No policies yet${edit?" — click “＋ New Policy”.":"."}</div>`}
    </div>`;
  const bN=$("#polNew"); if(bN) bN.addEventListener("click",()=>openPolicyForm(null));
  $$("#page-policies tr.clickable[data-pid]").forEach(tr=>tr.addEventListener("click",()=>openPolicyDrawer(POLICIES.find(p=>String(p.id)===tr.dataset.pid))));
}
window.renderPolicies=renderPolicies;

function openPolicyDrawer(p){
  if(!p) return;
  const edit=canEditPolicies();
  const acks=polAcksFor(p).slice().sort((a,b)=>String(b.acknowledged_at||"").localeCompare(String(a.acknowledged_at||"")));
  const mine=acks.find(polMatchesMe);
  const kv=(k,val)=>`<div class="efield"><div class="el">${esc(k)}</div><div class="ev">${val}</div></div>`;
  let m=document.getElementById("polDrawer"); if(!m){ m=document.createElement("div"); m.id="polDrawer"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:600px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;z-index:2;">
      <div style="font-size:20px;font-weight:800;">${esc(p.title||"Policy")}</div>
      <div style="font-size:12.5px;opacity:.9;">${esc(p.category||"Uncategorised")}${p.policy_no?" · "+esc(p.policy_no):""} · v${esc(p.version||"1")}</div>
    </div>
    <div style="padding:16px 20px 70px;">
      <div class="panel" style="margin-top:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><h2 style="margin:0;">Policy</h2>${polStatusPill(p.status)}</div>
        <div class="egrid" style="margin-top:8px;">
          ${kv("Category",esc(p.category||"—"))}
          ${kv("Version",esc(p.version||"—"))}
          ${kv("Effective date",p.effective_date?fmtDate(p.effective_date):"—")}
          ${kv("Acknowledgment",p.requires_ack?"Required":"Not required")}
        </div>
        ${p.summary?`<div class="psub" style="margin-top:8px;"><b>Summary:</b> ${esc(p.summary)}</div>`:""}
        ${p.doc_url?`<div style="margin-top:8px;"><a class="btn ghost" href="${esc(p.doc_url)}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block;">View document ↗</a></div>`:""}
        <div class="psub" style="margin-top:8px;">Version ${esc(p.version||"1")} · ${p.updated_at?"updated "+fmtDate(p.updated_at):(p.created_at?"created "+fmtDate(p.created_at):"—")}</div>
      </div>
      ${p.body?`<div class="panel"><div class="subhead">Policy text</div><div style="white-space:pre-wrap;font-size:13.5px;line-height:1.55;color:#22302a;">${esc(p.body)}</div></div>`:""}
      ${p.requires_ack?`<div class="panel"><div class="subhead">Acknowledgment <span class="sh-note">${acks.length} signed</span></div>
        ${mine?`<div class="note" style="background:#eef6f0;border-color:#cfe6d8;color:#12352a;">✓ You acknowledged this version${mine.acknowledged_at?" on "+fmtDate(mine.acknowledged_at):""}.</div>`:`<div class="psub">Read the policy above, then acknowledge &amp; sign.</div><button class="btn" id="polAck" style="margin-top:8px;">Acknowledge &amp; sign</button>`}
        ${acks.length?`<div style="margin-top:10px;">${acks.map(a=>`<div class="task" style="align-items:flex-start;"><div class="dot g"></div><div style="flex:1;"><div class="tt">${esc(a.employee_name||"—")}${a.employee_number?' <span class="note" style="display:inline;padding:0 4px;">'+esc(a.employee_number)+'</span>':""}</div><div class="td">Acknowledged${a.acknowledged_at?" · "+fmtDate(a.acknowledged_at):""}</div>${a.signature_data?`<img src="${a.signature_data}" style="height:30px;margin-top:4px;background:#fff;border:1px solid #e2e7e4;border-radius:4px;padding:2px 4px;">`:""}</div></div>`).join("")}</div>`:`<div class="psub" style="margin-top:6px;">No acknowledgments yet.</div>`}
      </div>`:""}
      <div style="display:flex;gap:10px;margin-top:6px;flex-wrap:wrap;">
        ${edit?`<button class="btn ghost" id="polEdit">Edit</button>`:""}
        <button class="btn ghost" id="polClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("polClose").onclick=()=>m.remove();
  const be=document.getElementById("polEdit"); if(be) be.onclick=()=>{ m.remove(); openPolicyForm(p); };
  const ba=document.getElementById("polAck"); if(ba) ba.onclick=()=>polAckSign(p);
}
window.openPolicyDrawer=openPolicyDrawer;

// Read-and-sign: canvas draw widget (same approach as mvSignStep) → policy_acknowledgments row.
function polAckSign(p){
  const id=polMyIdentity();
  let m=document.getElementById("polSignModal"); if(!m){ m=document.createElement("div"); m.id="polSignModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:10001;background:rgba(14,30,50,.55);display:flex;align-items:center;justify-content:center;padding:20px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:92vh;overflow-y:auto;padding:22px;">
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1.6px;color:#6B7785;">POLICY ACKNOWLEDGMENT${p.policy_no?" · "+esc(p.policy_no):""}</div>
    <div style="font-size:18px;font-weight:800;color:#12352a;margin:2px 0 3px;">${esc(p.title||"Policy")}</div>
    <div class="psub" style="margin-bottom:8px;">Version ${esc(p.version||"1")}. By signing, <b>${esc(id.name)}</b> confirms having read and understood this policy.</div>
    <div style="font-size:12px;color:#6B7785;margin-bottom:6px;"><b>Upload your signature image</b> or draw it below. RA 8792 e-signature · timestamped + recorded against your account.</div>
    <canvas id="polPad" width="480" height="150" style="width:100%;height:150px;border:1px dashed #b9c4cf;border-radius:10px;background:#fff;touch-action:none;cursor:crosshair;"></canvas>
    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
      <button class="btn ghost" id="polSigUpload" type="button" style="flex:0 0 auto;">📷 Upload signature</button>
      <input type="file" id="polSigFile" accept="image/*" style="display:none;">
      <button class="btn ghost" id="polSigClear" style="flex:0 0 auto;">Clear</button>
      <span id="polSigMsg" style="font-size:12.5px;color:#a4322a;flex:1 1 100%;"></span>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn ghost" id="polSigCancel" style="margin-left:auto;">Cancel</button>
      <button class="btn" id="polSigDo">Acknowledge &amp; Sign</button>
    </div></div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("polSigCancel").onclick=()=>m.remove();
  const cv=document.getElementById("polPad"), ctx=cv.getContext("2d"); let drawing=false, dirty=false;
  ctx.lineWidth=2.2; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.strokeStyle="#13243b";
  const pos=e=>{ const rc=cv.getBoundingClientRect(), t=e.touches&&e.touches[0]?e.touches[0]:e; return {x:(t.clientX-rc.left)*(cv.width/rc.width), y:(t.clientY-rc.top)*(cv.height/rc.height)}; };
  const start=e=>{ drawing=true; dirty=true; const pt=pos(e); ctx.beginPath(); ctx.moveTo(pt.x,pt.y); e.preventDefault(); };
  const move=e=>{ if(!drawing) return; const pt=pos(e); ctx.lineTo(pt.x,pt.y); ctx.stroke(); e.preventDefault(); };
  const end=()=>{ drawing=false; };
  cv.addEventListener("mousedown",start); cv.addEventListener("mousemove",move); window.addEventListener("mouseup",end);
  cv.addEventListener("touchstart",start,{passive:false}); cv.addEventListener("touchmove",move,{passive:false}); cv.addEventListener("touchend",end);
  document.getElementById("polSigClear").onclick=()=>{ ctx.clearRect(0,0,cv.width,cv.height); dirty=false; };
  mvWireSigUpload(cv,ctx,document.getElementById("polSigUpload"),document.getElementById("polSigFile"),()=>{ dirty=true; document.getElementById("polSigMsg").textContent=""; });
  document.getElementById("polSigDo").onclick=async()=>{
    const msg=document.getElementById("polSigMsg");
    if(!dirty){ msg.textContent="Add your signature first — upload an image or draw it."; return; }
    const btn=document.getElementById("polSigDo"); btn.disabled=true; btn.textContent="Signing…";
    const payload={ policy_id:p.id, policy_version:p.version||null, employee_id:id.empId, employee_name:id.name, employee_number:id.empNo, acknowledged_at:new Date().toISOString(), signature_data:cv.toDataURL("image/png") };
    const { error }=await sb.from("policy_acknowledgments").insert(payload);
    if(error){ msg.textContent=error.message; btn.disabled=false; btn.textContent="Acknowledge & Sign"; return; }
    await logChange("policy",p.id,p.title,"Policy acknowledged (e-signed)",(p.policy_no||"")+" v"+(p.version||"1"));
    m.remove(); const dw=document.getElementById("polDrawer"); if(dw) dw.remove(); await loadEmployees(); window.go("policies");
  };
}

// Textarea field matching the fld()/sel() look.
function txtfld(id,label,val,rows){ return `<div style="margin-bottom:10px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">${label}</label><textarea id="${id}" rows="${rows||3}" style="width:100%;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:13.5px;">${esc(val||"")}</textarea></div>`; }

function openPolicyForm(p){
  if(!canEditPolicies()){ alert("Only HR management can add or edit policies."); return; }
  const isNew=!p; p=p||{};
  let m=document.getElementById("polFormModal"); if(!m){ m=document.createElement("div"); m.id="polFormModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:560px;width:100%;padding:22px;max-height:92vh;overflow-y:auto;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:2px;">${isNew?"New policy":"Edit policy"}</h2>
    <div class="psub" style="margin-bottom:10px;">Publish a policy to the handbook. Tick <b>Acknowledgment required</b> for policies employees must read and e-sign.</div>
    <div class="form-grid">${fld("pol_no","Policy no.",p.policy_no)}${fld("pol_ver","Version",p.version||"1")}</div>
    ${fld("pol_title","Title *",p.title)}
    ${fld("pol_cat","Category",p.category)}
    ${txtfld("pol_summary","Summary",p.summary,2)}
    ${txtfld("pol_body","Policy text (body)",p.body,7)}
    <div class="form-grid">${fld("pol_eff","Effective date",p.effective_date,"date")}${sel("pol_status","Status",["draft","active","superseded"],p.status||"draft")}</div>
    ${fld("pol_doc","Document link (optional)",p.doc_url)}
    <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;margin:2px 0 12px;"><input type="checkbox" id="pol_ack" ${p.requires_ack?"checked":""}> Acknowledgment required (employees must read &amp; e-sign)</label>
    <div id="polFormMsg" style="font-size:13px;color:#a4322a;margin:4px 0;"></div>
    <div style="display:flex;gap:10px;"><button class="btn ghost" id="polFormCancel" style="flex:1;">Cancel</button><button class="btn" id="polFormSave" style="flex:1;">${isNew?"Publish policy":"Save changes"}</button></div>
  </div>`;
  document.getElementById("polFormCancel").onclick=()=>m.remove();
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("polFormSave").onclick=async()=>{
    const msg=document.getElementById("polFormMsg");
    const title=v("pol_title"); if(!title){ msg.textContent="Enter a title."; return; }
    const now=new Date().toISOString();
    const payload={ policy_no:v("pol_no"), title, category:v("pol_cat"), summary:v("pol_summary"), body:v("pol_body"),
      version:v("pol_ver")||"1", effective_date:v("pol_eff"), status:v("pol_status")||"draft",
      requires_ack:document.getElementById("pol_ack").checked, doc_url:v("pol_doc"), updated_at:now };
    const btn=document.getElementById("polFormSave"); btn.disabled=true; btn.textContent="Saving…";
    let error;
    if(isNew){ payload.created_by=(CURRENT_USER&&CURRENT_USER.id)||null; payload.created_at=now; ({ error }=await sb.from("policies").insert(payload)); }
    else { ({ error }=await sb.from("policies").update(payload).eq("id",p.id)); }
    if(error){ msg.textContent=error.message; btn.disabled=false; btn.textContent=isNew?"Publish policy":"Save changes"; return; }
    await logChange("policy",p.id||null,title,isNew?"Policy created":"Policy updated",(payload.policy_no||"")+" v"+payload.version+" · "+payload.status);
    m.remove(); await loadEmployees(); window.go("policies");
  };
}
window.openPolicyForm=openPolicyForm;

/* ---- Processes / SOPs ---- */
// steps may arrive as a jsonb array (parsed by supabase-js) or a string — normalise to a string[].
function procSteps(p){ let s=p&&p.steps; if(s==null) return []; if(typeof s==="string"){ try{ s=JSON.parse(s); }catch(_){ return s.split(/\r?\n+/).map(x=>x.trim()).filter(Boolean); } } if(!Array.isArray(s)) return []; return s.map(x=>typeof x==="string"?x:(x&&(x.text||x.step)||"")).filter(Boolean); }

function renderProcesses(){
  const pg=$("#page-processes"); if(!pg||!CURRENT_USER) return;
  const edit=canEditPolicies();
  const R=(PROCESSES||[]).slice().sort((a,b)=>(a.title||"").localeCompare(b.title||""));
  const active=R.filter(p=>p.status==="active").length;
  const draft=R.filter(p=>p.status==="draft").length;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Processes &amp; SOPs <span class="count-tag">How we do it</span></h2>
      <div class="psub">Standard operating procedures — the step-by-step of how RCC runs each process. ${edit?"You can add and update SOPs.":"Read-only; HR management maintains these."}</div>
      ${edit?`<div class="actionbar"><button class="btn" id="procNew">＋ New Process</button></div>`:""}
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi"><div class="k-l">Active SOPs</div><div class="k-n">${active}</div></div>
        <div class="kpi"><div class="k-l">Draft</div><div class="k-n">${draft}</div></div>
        <div class="kpi"><div class="k-l">Total documented</div><div class="k-n">${R.length}</div></div>
      </div>
      ${R.length?`<table><thead><tr><th>Process</th><th>Category</th><th>Owner</th><th>Version</th><th>Status</th></tr></thead><tbody>
        ${R.map(p=>`<tr class="clickable" data-prid="${esc(String(p.id))}"><td><b>${esc(p.title||"—")}</b>${p.process_no?`<div class="esub">${esc(p.process_no)}</div>`:""}</td>
          <td>${esc(p.category||"—")}</td><td>${esc(p.owner||"—")}</td><td>${esc(p.version||"—")}</td><td>${procStatusPill(p.status)}</td></tr>`).join("")}
      </tbody></table>`:`<div class="psub" style="margin-top:6px;">No processes documented yet${edit?" — click “＋ New Process”.":"."}</div>`}
    </div>`;
  const bN=$("#procNew"); if(bN) bN.addEventListener("click",()=>openProcessForm(null));
  $$("#page-processes tr.clickable[data-prid]").forEach(tr=>tr.addEventListener("click",()=>openProcessDrawer(PROCESSES.find(p=>String(p.id)===tr.dataset.prid))));
}
window.renderProcesses=renderProcesses;

function openProcessDrawer(p){
  if(!p) return;
  const edit=canEditPolicies();
  const steps=procSteps(p);
  const kv=(k,val)=>`<div class="efield"><div class="el">${esc(k)}</div><div class="ev">${val}</div></div>`;
  let m=document.getElementById("procDrawer"); if(!m){ m=document.createElement("div"); m.id="procDrawer"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:600px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;z-index:2;">
      <div style="font-size:20px;font-weight:800;">${esc(p.title||"Process")}</div>
      <div style="font-size:12.5px;opacity:.9;">${esc(p.category||"Uncategorised")}${p.process_no?" · "+esc(p.process_no):""} · v${esc(p.version||"1")}</div>
    </div>
    <div style="padding:16px 20px 70px;">
      <div class="panel" style="margin-top:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><h2 style="margin:0;">SOP</h2>${procStatusPill(p.status)}</div>
        <div class="egrid" style="margin-top:8px;">
          ${kv("Category",esc(p.category||"—"))}
          ${kv("Owner",esc(p.owner||"—"))}
          ${kv("Version",esc(p.version||"—"))}
          ${kv("Last updated",p.updated_at?fmtDate(p.updated_at):(p.created_at?fmtDate(p.created_at):"—"))}
        </div>
        ${p.summary?`<div class="psub" style="margin-top:8px;"><b>Summary:</b> ${esc(p.summary)}</div>`:""}
      </div>
      ${p.body?`<div class="panel"><div class="subhead">Overview</div><div style="white-space:pre-wrap;font-size:13.5px;line-height:1.55;color:#22302a;">${esc(p.body)}</div></div>`:""}
      ${steps.length?`<div class="panel"><div class="subhead">Procedure <span class="sh-note">${steps.length} step${steps.length>1?"s":""}</span></div>
        <ol style="margin:4px 0 0;padding-left:20px;font-size:13.5px;line-height:1.55;color:#22302a;">${steps.map(s=>`<li style="margin-bottom:6px;">${esc(s)}</li>`).join("")}</ol></div>`:""}
      <div style="display:flex;gap:10px;margin-top:6px;flex-wrap:wrap;">
        ${edit?`<button class="btn ghost" id="procEdit">Edit</button>`:""}
        <button class="btn ghost" id="procClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("procClose").onclick=()=>m.remove();
  const be=document.getElementById("procEdit"); if(be) be.onclick=()=>{ m.remove(); openProcessForm(p); };
}
window.openProcessDrawer=openProcessDrawer;

function openProcessForm(p){
  if(!canEditPolicies()){ alert("Only HR management can add or edit processes."); return; }
  const isNew=!p; p=p||{};
  let m=document.getElementById("procFormModal"); if(!m){ m=document.createElement("div"); m.id="procFormModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:560px;width:100%;padding:22px;max-height:92vh;overflow-y:auto;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:2px;">${isNew?"New process":"Edit process"}</h2>
    <div class="psub" style="margin-bottom:10px;">Document a standard operating procedure. Put each step on its own line — they render as a numbered list.</div>
    <div class="form-grid">${fld("proc_no","Process no.",p.process_no)}${fld("proc_ver","Version",p.version||"1")}</div>
    ${fld("proc_title","Title *",p.title)}
    <div class="form-grid">${fld("proc_cat","Category",p.category)}${fld("proc_owner","Owner",p.owner)}</div>
    ${txtfld("proc_summary","Summary",p.summary,2)}
    ${txtfld("proc_body","Overview / notes (body)",p.body,4)}
    ${txtfld("proc_steps","Steps (one per line)",procSteps(p).join("\n"),7)}
    ${sel("proc_status","Status",["draft","active","archived"],p.status||"draft")}
    <div id="procFormMsg" style="font-size:13px;color:#a4322a;margin:4px 0;"></div>
    <div style="display:flex;gap:10px;"><button class="btn ghost" id="procFormCancel" style="flex:1;">Cancel</button><button class="btn" id="procFormSave" style="flex:1;">${isNew?"Publish process":"Save changes"}</button></div>
  </div>`;
  document.getElementById("procFormCancel").onclick=()=>m.remove();
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("procFormSave").onclick=async()=>{
    const msg=document.getElementById("procFormMsg");
    const title=v("proc_title"); if(!title){ msg.textContent="Enter a title."; return; }
    const now=new Date().toISOString();
    const stepsArr=((document.getElementById("proc_steps").value)||"").split(/\r?\n+/).map(x=>x.trim()).filter(Boolean);
    const payload={ process_no:v("proc_no"), title, category:v("proc_cat"), owner:v("proc_owner"), summary:v("proc_summary"),
      body:v("proc_body"), steps:stepsArr, version:v("proc_ver")||"1", status:v("proc_status")||"draft", updated_at:now };
    const btn=document.getElementById("procFormSave"); btn.disabled=true; btn.textContent="Saving…";
    let error;
    if(isNew){ payload.created_by=(CURRENT_USER&&CURRENT_USER.id)||null; payload.created_at=now; ({ error }=await sb.from("processes").insert(payload)); }
    else { ({ error }=await sb.from("processes").update(payload).eq("id",p.id)); }
    if(error){ msg.textContent=error.message; btn.disabled=false; btn.textContent=isNew?"Publish process":"Save changes"; return; }
    await logChange("process",p.id||null,title,isNew?"Process created":"Process updated",(payload.process_no||"")+" v"+payload.version+" · "+payload.status);
    m.remove(); await loadEmployees(); window.go("processes");
  };
}
window.openProcessForm=openProcessForm;

/* ================= TIMEKEEPING & ATTENDANCE → NTE ==================
   Upload the monthly "ATTENDANCE SUMMARY REPORT HO & WH.xlsx", flag everyone
   whose (unauthorized absences + late-days) reaches the threshold, and generate
   a DOLE twin-notice NTE per person on RCC letterhead. Reads the maintained
   Excel (not the raw PayPlus feed) on purpose — the Excel carries the
   authorized/unauthorized coding the API doesn't expose, which is what keeps
   maternity/approved-leave cases from being wrongly flagged.
   ------------------------------------------------------------------ */
const TK_COMBINED_THRESHOLD=5;     // unauthorized absences + late-days >= this -> NTE
const TK_LEAVE_REVIEW_ABSENCES=10; // absences >= this -> HELD (likely leave), never auto-drafted
const TK_EXPLAIN_DAYS=5;           // calendar days to explain
const TK_YEAR=2026;
const TK_MONTHS=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const TK_MONTH_FULL={JAN:"January",FEB:"February",MAR:"March",APR:"April",MAY:"May",JUN:"June",JUL:"July",AUG:"August",SEP:"September",OCT:"October",NOV:"November",DEC:"December"};
const TK_CUTOFF={JAN:"December 25, 2025 – January 24, 2026",FEB:"January 25 – February 24, 2026",MAR:"February 25 – March 24, 2026",APR:"March 25 – April 24, 2026",MAY:"April 25 – May 24, 2026",JUN:"May 25 – June 24, 2026",JUL:"June 25 – July 24, 2026",AUG:"July 25 – August 24, 2026",SEP:"August 25 – September 24, 2026",OCT:"September 25 – October 24, 2026",NOV:"October 25 – November 24, 2026",DEC:"November 25 – December 24, 2026"};
let TK_RESULT=null;

function tkLoadSheetJS(){
  return new Promise((res,rej)=>{
    if(window.XLSX) return res(window.XLSX);
    const s=document.createElement("script");
    s.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload=()=>res(window.XLSX); s.onerror=()=>rej(new Error("Could not load the spreadsheet reader."));
    document.head.appendChild(s);
  });
}
function tkLatePhrase(d){ if(!d) return ""; const mins=Math.round(d*8*60); return d.toFixed(1)+" day-equivalent of tardiness/undertime (approx. "+mins+" minutes accumulated)"; }
function tkNoted(pos){ return (pos||"").toLowerCase().includes("warehouse")?"Pervin Chatlani":"Anj Genomal"; }

function tkParse(wb, monthArg){
  const XLSX=window.XLSX;
  const grab=(name)=>{ const sh=wb.Sheets[name]; if(!sh) throw new Error('Sheet "'+name+'" not found — is this the right attendance file?'); return XLSX.utils.sheet_to_json(sh,{header:1,defval:null}); };
  const absent=grab("ABSENT"); // data from row index 10; month block every 3 cols from col 4
  const late=grab("LATE");     // data from row index 6; month cols from col 4
  let mi;
  if(monthArg){ mi=TK_MONTHS.indexOf(monthArg); if(mi<0) throw new Error("Unknown month "+monthArg); }
  else{ mi=-1;
    for(let m=0;m<12;m++){ const ua=4+m*3+2; let sum=0;
      for(let r=10;r<absent.length;r++) sum+=Number(absent[r]&&absent[r][ua])||0;
      const lc=4+m; for(let r=6;r<late.length;r++) sum+=Number(late[r]&&late[r][lc])||0;
      if(sum>0) mi=m; }
    if(mi<0) throw new Error("No attendance data found in the file."); }
  const MON=TK_MONTHS[mi];
  // Build per-person 12-month arrays so we can look back for repeat offenders.
  const byId={};
  const ensure=(id,name,pos)=>{ if(!byId[id]) byId[id]={id,name,pos,mU:new Array(12).fill(0),mA:new Array(12).fill(0),mL:new Array(12).fill(0)}; return byId[id]; };
  for(let r=10;r<absent.length;r++){ const row=absent[r]; if(!row) continue; const name=row[2]; if(!name) continue; const rec=ensure(String(row[1]),name,row[3]);
    for(let m=0;m<12;m++){ rec.mA[m]=Number(row[4+m*3])||0; rec.mU[m]=Number(row[4+m*3+2])||0; } }
  for(let r=6;r<late.length;r++){ const row=late[r]; if(!row) continue; const name=row[2]; if(!name) continue; const rec=ensure(String(row[1]),name,row[3]);
    for(let m=0;m<12;m++){ rec.mL[m]=Number(row[4+m])||0; } }
  // Repeat window = every POPULATED month from January through the current cutoff (year-to-date).
  const recs=Object.values(byId);
  const monthHasData=(k)=> recs.some(r=> r.mA[k]||r.mU[k]||r.mL[k]);
  const win=[]; for(let k=0;k<=mi;k++){ if(monthHasData(k)) win.push(k); }
  if(!win.length) win.push(mi);
  const monthFlagged=(rec,k)=>{ const c=rec.mU[k]+rec.mL[k]; return c>=TK_COMBINED_THRESHOLD && rec.mA[k]<TK_LEAVE_REVIEW_ABSENCES; };
  const people=Object.values(byId).map(p=>{
    const hist=win.map(k=>({ mon:TK_MONTHS[k], combined:Number((p.mU[k]+p.mL[k]).toFixed(1)), held:p.mA[k]>=TK_LEAVE_REVIEW_ABSENCES, flagged:monthFlagged(p,k) }));
    const repeat=hist.filter(h=>h.flagged).length;
    return { id:p.id, name:p.name, pos:p.pos, absent:p.mA[mi], unauth:p.mU[mi], late:p.mL[mi], combined:p.mU[mi]+p.mL[mi], repeat, hist };
  });
  const flagged=people.filter(p=>p.combined>=TK_COMBINED_THRESHOLD).sort((a,b)=> b.repeat-a.repeat || b.combined-a.combined);
  const held=flagged.filter(p=>p.absent>=TK_LEAVE_REVIEW_ABSENCES);
  const draft=flagged.filter(p=>p.absent<TK_LEAVE_REVIEW_ABSENCES);
  return {MON,mi,draft,held,total:people.length,window:win.map(k=>TK_MONTHS[k])};
}

function tkPrintNTE(p, MON, approval){
  const today=new Date();
  const dateStr=today.toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});
  const bits=[]; if(p.unauth>0) bits.push(p.unauth+" unauthorized absence"+(p.unauth===1?"":"s")); if(p.late>0) bits.push(tkLatePhrase(p.late));
  const record=bits.join(", and ");
  const w=window.open("","_blank"); if(!w){ alert("Allow pop-ups to print the NTE."); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>NTE — ${esc(p.name)}</title><style>
    body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1F2A37;max-width:760px;margin:24px auto;padding:0 24px;font-size:13.5px;line-height:1.6;}
    .lh{border-bottom:2.5px solid #1B5E20;padding-bottom:8px;margin-bottom:16px;}
    .lh b{font-size:17px;color:#1B5E20;letter-spacing:.4px;} .lh div{font-size:11px;color:#667;}
    .mf{margin:2px 0;} .mf b{display:inline-block;width:90px;}
    .sub{border-top:2px solid #1B5E20;margin:14px 0 16px;padding-top:2px;}
    p{margin:0 0 11px;} .sig{margin-top:26px;} .sigrole{font-weight:700;margin-top:16px;}
    .line{border-bottom:1px solid #333;width:280px;height:26px;margin:4px 0 2px;}
    .ack{font-style:italic;color:#555;font-size:11.5px;margin-top:4px;}
    @media print{ body{margin:0 auto;} }
  </style></head><body>
    <div class="lh"><b>ROSHAN COMMERCIAL CORPORATION</b><div>3rd Floor RCC Center, 104 Shaw Boulevard, Pasig, Manila, 1603 · +632 86386556</div></div>
    <div class="mf">${dateStr}</div>
    <div class="sub"></div>
    <div class="mf"><b>TO</b>: ${esc((p.name||"").toUpperCase())}</div>
    <div class="mf"><b>FROM</b>: HUMAN RESOURCES DEPARTMENT</div>
    <div class="mf"><b>SUBJECT</b>: NOTICE TO EXPLAIN — ATTENDANCE (UNAUTHORIZED ABSENCE / TARDINESS)</div>
    <div class="sub"></div>
    <p>This notice concerns your attendance record for the ${TK_MONTH_FULL[MON]} ${TK_YEAR} payroll cutoff (${TK_CUTOFF[MON]}).</p>
    <p>Based on the timekeeping records for that period, you incurred ${record}. The detailed daily record is reflected in your Daily Time Record (DTR), which is available for your reference.</p>
    <p>Regular attendance and punctuality are essential to your role and to the operations of the Company. Absences without prior authorization and repeated tardiness or undertime, when habitual, may constitute a violation of Company policy and a ground for disciplinary action under the Labor Code.</p>
    <p>In line with your right to due process, you are directed to submit a <b>WRITTEN EXPLANATION within ${TK_EXPLAIN_DAYS} calendar days</b> from your receipt of this notice, stating why no disciplinary action should be taken against you for the above.</p>
    <p>If any of the absences or tardiness were in fact authorized, or were due to a valid or justifiable reason (for example approved leave, medical, or emergency), please state this clearly and attach any supporting documents. These will be duly considered.</p>
    <p>You may request a conference to be heard, and you may be assisted by a representative of your choice. Your explanation will be evaluated fairly before any decision is made. This notice is issued to give you the opportunity to be heard; it is not a finding or a penalty.</p>
    <p>We trust you will give this matter your immediate attention.</p>
    <div class="sig">
      <div class="sigrole">Prepared by:</div><div class="line"></div>Juvelyn Belvistre<br><span style="color:#667;">Human Resources Department</span>
      <div class="sigrole">Noted by:</div>${(approval&&approval.img)?`<div style="margin:2px 0;"><img src="${approval.img}" style="height:44px;display:block;">${esc(approval.signer||tkNoted(p.pos))}<br><span style="color:#667;">Management · e-signed via RCC Portal${approval.date?" on "+new Date(approval.date).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}):""}</span></div>`:`<div class="line"></div>${esc(tkNoted(p.pos))}<br><span style="color:#667;">Management</span>`}
      <div class="sigrole">Received by:</div><div class="line"></div>${esc(p.name)}<br><span style="color:#667;">Signature over printed name / Date</span>
      <div class="ack">By signing, I acknowledge receipt of this notice. My signature does not mean I admit the contents.</div>
    </div>
    <script>window.print();</`+`script></body></html>`);
  w.document.close();
}

// Plain-text NTE body — travels WITH the signature so the approver reads exactly what gets served.
function tkNteText(p, MON){
  const bits=[]; if(p.unauth>0) bits.push(p.unauth+" unauthorized absence"+(p.unauth===1?"":"s")); if(p.late>0) bits.push(tkLatePhrase(p.late));
  return `NOTICE TO EXPLAIN — ATTENDANCE (UNAUTHORIZED ABSENCE / TARDINESS)\n\n`
    +`To: ${p.name} · ${p.pos||"—"}\n\n`
    +`This notice concerns your attendance record for the ${TK_MONTH_FULL[MON]} ${TK_YEAR} payroll cutoff (${TK_CUTOFF[MON]}). Based on the timekeeping records, you incurred ${bits.join(", and ")}. The detailed daily record is in your DTR.\n\n`
    +`Absences without prior authorization and repeated tardiness/undertime, when habitual, may constitute a violation of Company policy and a ground for disciplinary action under the Labor Code.\n\n`
    +`You are directed to submit a WRITTEN EXPLANATION within ${TK_EXPLAIN_DAYS} calendar days of receipt as to why no disciplinary action should be taken. If any of these were authorized or had a valid reason (approved leave, medical, emergency), state so with proof — it will be considered. You may request a conference and be assisted by a representative.\n\n`
    +`This is the first of the twin notices required by due process. No decision has been made at this stage.\n\n`
    +`Prepared by: Juvelyn Belvistre — Human Resources Department\nNoted by: ${tkNoted(p.pos)} — Management`;
}
// State of a flagged person's NTE this cutoff: none / pending sign-off / signed / declined.
function tkSignState(p){
  const MON=TK_RESULT&&TK_RESULT.MON;
  const sig=(SIGNATURES||[]).find(s=>s.doc_type==="nte" && s.details && s.details.month===MON && (s.subject_name||"")===p.name);
  if(!sig) return {state:"none"};
  if(sig.status==="signed") return {state:"signed",sig};
  if(sig.status==="declined") return {state:"declined",sig};
  return {state:"pending",sig};
}
// Send an NTE to the Signatures inbox for the "Noted by" authority to approve & sign.
async function tkSendSignoffDo(p, MON, btn){
  if(btn){ btn.disabled=true; btn.textContent="Sending…"; }
  const body=tkNteText(p, MON);
  const details={ month:MON, cutoff:TK_CUTOFF[MON], employee:p.name, employee_id:p.id||null, position:p.pos||null,
    unauth:p.unauth, late:Number(p.late.toFixed(1)), combined:Number(p.combined.toFixed(1)), noted_by:tkNoted(p.pos),
    repeat:p.repeat||1, hist:(p.hist||[]).map(h=>({mon:h.mon,combined:h.combined,held:h.held,flagged:h.flagged})) };
  const { data:sig, error } = await sb.from("signature_requests").insert({ doc_type:"nte", doc_title:"Notice to Explain — Attendance",
    subject_name:p.name, body, from_name:(CURRENT_USER&&CURRENT_USER.email)||"HR", awaiting:"you",
    with_whom:tkNoted(p.pos)+" (Noted by)", signer_email:(/warehouse/i.test(p.pos||"")?"pervin@hassarams.com":"anj@hassarams.com"), status:"pending", meta:"Attendance · "+TK_MONTH_FULL[MON]+" "+TK_YEAR, details }).select().single();
  if(error){ if(btn){ btn.disabled=false; btn.textContent="Send for sign-off"; } alert("Couldn't send: "+error.message); return; }
  const ref="NTE-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+String(p.id||"").slice(-4);
  try{ await sb.from("memos").insert({ ref_no:ref, memo_type:"Notice to Explain", subject_name:p.name, title:"NTE — Attendance ("+TK_MONTH_FULL[MON]+" "+TK_YEAR+")",
    body:"NTE — attendance, "+TK_MONTH_FULL[MON]+" "+TK_YEAR+" cutoff: "+p.unauth+" unauthorized absence(s) + "+p.late.toFixed(1)+"d late (combined "+p.combined.toFixed(1)+"). Sent to "+tkNoted(p.pos)+" for sign-off.",
    relevant_date:new Date().toISOString().slice(0,10), status:"Issued", signature_request_id:sig.id, created_by:(CURRENT_USER&&CURRENT_USER.email)||"HR" }); }catch(_){}
  try{ const sg=await sb.from("signature_requests").select("*").order("created_at",{ascending:false}); SIGNATURES=(sg&&sg.data)||SIGNATURES;
       const me=await sb.from("memos").select("*").order("id",{ascending:false}).limit(400); MEMOS=(me&&me.data)||MEMOS;
       renderSignatures(); renderMemos(); }catch(_){}
  tkRenderResults();
}
window.tkSendSignoff=(i,btn)=>{ if(TK_RESULT&&TK_RESULT.draft[i]) tkSendSignoffDo(TK_RESULT.draft[i], TK_RESULT.MON, btn); };
window.tkSignoffAll=async()=>{ if(!TK_RESULT) return; for(let i=0;i<TK_RESULT.draft.length;i++){ if(tkSignState(TK_RESULT.draft[i]).state==="none") await tkSendSignoffDo(TK_RESULT.draft[i], TK_RESULT.MON, document.getElementById("tkGen"+i)); } };
window.tkDraftPrint=(i)=>{ if(TK_RESULT&&TK_RESULT.draft[i]) tkPrintNTE(TK_RESULT.draft[i], TK_RESULT.MON); };
// Print the APPROVED NTE — the e-signature is stamped on the "Noted by" line.
window.tkPrintSigned=(sigId)=>{
  const s=(SIGNATURES||[]).find(x=>String(x.id)===String(sigId)); if(!s||!s.details) return;
  const d=s.details, p={ name:d.employee, pos:d.position, id:d.employee_id, unauth:d.unauth, late:Number(d.late)||0, combined:Number(d.combined)||0 };
  tkPrintNTE(p, d.month, { signer:s.signer_name, date:s.signed_at, img:s.signature_data });
};

function tkRepeatBadge(p){
  if(p.repeat>=3) return '<span class="pill" style="background:#fdeaea;color:#a4322a;font-weight:700;white-space:nowrap;">'+p.repeat+'× this year</span>';
  if(p.repeat===2) return '<span class="pill" style="background:#fdf0d9;color:#9a6a00;font-weight:700;white-space:nowrap;">2× this year</span>';
  return '';
}
// Count NTEs actually issued to this person (the paper trail) — the gap vs flagged months drives escalate-vs-first-notice.
function tkNteCountBadge(p){
  const n=(MEMOS||[]).filter(m=>m.memo_type==="Notice to Explain" && (m.subject_name||"")===p.name).length;
  if(n>0) return '<span class="pill" style="background:#e9eef5;color:#33465f;font-weight:600;white-space:nowrap;">'+n+' NTE'+(n>1?'s':'')+' issued</span>';
  return '<span class="pill" style="background:#f1efe8;color:#7a7268;white-space:nowrap;">no NTE yet</span>';
}
function tkHistLine(p){
  if(!p.hist||!p.hist.length) return '';
  const parts=p.hist.map(h=>{ const lbl=(TK_MONTH_FULL[h.mon]||h.mon).slice(0,3); const val=h.held?'leave':h.combined.toFixed(1);
    const col=h.held?'#8a8f96':(h.flagged?'#a4322a':'#8a9a90'); const w=h.flagged?'700':'400';
    return '<span style="color:'+col+';font-weight:'+w+';">'+lbl+' '+val+'</span>'; }).join(' · ');
  return '<div style="font-size:11px;margin-top:3px;">'+parts+'</div>';
}
function tkRenderResults(){
  const box=document.getElementById("tkResults"); if(!box||!TK_RESULT) return;
  const {MON,draft,held,total}=TK_RESULT;
  const row=(p,i)=>{ const st=tkSignState(p); let action;
    if(st.state==="signed") action='<span class="pill active">Approved · signed ✓</span> <button class="btn ghost" onclick="tkPrintSigned(\''+st.sig.id+'\')">Print signed NTE</button>';
    else if(st.state==="pending") action='<span class="pill awol">Awaiting sign-off</span> <button class="btn ghost" onclick="tkDraftPrint('+i+')">Preview</button>';
    else if(st.state==="declined") action='<span class="pill" style="color:#c0392b;">Declined</span> <button class="btn" id="tkGen'+i+'" onclick="tkSendSignoff('+i+',this)">Re-send</button>';
    else action='<button class="btn" id="tkGen'+i+'" onclick="tkSendSignoff('+i+',this)">Send for sign-off</button> <button class="btn ghost" onclick="tkDraftPrint('+i+')">Preview</button>';
    return `<tr>
      <td>${i+1}</td>
      <td style="min-width:230px;"><div style="font-weight:700;">${esc(p.name)}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin:3px 0;">${tkRepeatBadge(p)}${tkNteCountBadge(p)}</div>
        <div style="font-size:11.5px;color:#667;">${esc(p.pos||"—")}</div>${tkHistLine(p)}</td>
      <td style="text-align:center;">${p.unauth}</td>
      <td style="text-align:center;">${p.late.toFixed(1)}</td>
      <td style="text-align:center;font-weight:700;">${p.combined.toFixed(1)}</td>
      <td style="text-align:right;white-space:nowrap;">${action}</td></tr>`; };
  const heldRow=(p)=>`<tr style="background:#fdf6e3;">
      <td>—</td><td><b>${esc(p.name)}</b><div style="font-size:11.5px;color:#8a6a14;">${esc(p.pos||"—")}</div></td>
      <td style="text-align:center;">${p.absent}</td><td colspan="2" style="color:#8a6a14;font-size:12px;">${p.absent} absences this cutoff</td>
      <td style="text-align:right;color:#8a6a14;font-weight:600;">HELD — verify leave</td></tr>`;
  box.innerHTML=`
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h2 style="margin:0;">${TK_MONTH_FULL[MON]} ${TK_YEAR} — ${draft.length} to notify</h2>
        ${draft.filter(p=>tkSignState(p).state==="none").length?'<button class="btn" onclick="tkSignoffAll()">Send all '+draft.filter(p=>tkSignState(p).state==="none").length+' for sign-off</button>':''}
      </div>
      <div class="psub">Cutoff ${TK_CUTOFF[MON]} · rule: unauthorized absences + late-days ≥ ${TK_COMBINED_THRESHOLD} · ${total} staff scanned. Each NTE goes to the <b>“Noted by” approver</b> (HO → Anj, Warehouse → Pervin) for sign-off before it's served.</div>
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        <thead><tr style="text-align:left;border-bottom:2px solid #e2e7e4;font-size:11.5px;color:#667;text-transform:uppercase;">
          <th style="padding:6px 4px;">#</th><th>Employee</th><th style="text-align:center;">Unauth. abs</th><th style="text-align:center;">Late (days)</th><th style="text-align:center;">Combined</th><th></th></tr></thead>
        <tbody>${draft.map(row).join("")||'<tr><td colspan="6" style="padding:10px;color:#667;">No one crossed the threshold this cutoff.</td></tr>'}</tbody>
      </table>
      ${held.length?`<div style="margin-top:16px;">
        <h3 style="font-size:13px;color:#8a6a14;margin:0 0 4px;">⚠ Held for leave review — do NOT issue an NTE without checking (${held.length})</h3>
        <div class="psub" style="margin-top:0;">${held.length} person(s) with ${TK_LEAVE_REVIEW_ABSENCES}+ absences this cutoff — almost always approved / maternity leave, not AWOL. Confirm with payroll first.</div>
        <table style="width:100%;border-collapse:collapse;margin-top:6px;"><tbody>${held.map(heldRow).join("")}</tbody></table>
      </div>`:""}
      <div class="note" style="margin-top:14px;">Before serving any NTE: (1) confirm the days were truly <b>unauthorized</b> (not approved leave), (2) attach the employee's <b>DTR</b> with the specific dates, (3) confirm the <b>“Noted by”</b> name. Each generated NTE is logged to <b>Memos</b>.</div>
    </div>`;
}

async function tkHandleFile(file){
  const status=document.getElementById("tkStatus"); if(status) status.textContent="Reading "+file.name+"…";
  try{
    await tkLoadSheetJS();
    const buf=await file.arrayBuffer();
    const wb=window.XLSX.read(new Uint8Array(buf),{type:"array"});
    TK_RESULT=tkParse(wb, null);
    if(status) status.textContent="✓ "+file.name+" — "+TK_MONTH_FULL[TK_RESULT.MON]+" "+TK_YEAR;
    tkRenderResults();
  }catch(e){ if(status){ status.textContent="⚠ "+(e&&e.message||e); status.style.color="#a4322a"; } }
}

function renderTimekeeping(){
  const pg=document.getElementById("page-timekeeping"); if(!pg) return;
  pg.innerHTML=`
    <div class="panel">
      <h2>Attendance → Notice to Explain</h2>
      <div class="psub">Upload the month's <b>ATTENDANCE SUMMARY REPORT HO &amp; WH.xlsx</b>. The portal flags everyone with <b>unauthorized absences + late-days ≥ ${TK_COMBINED_THRESHOLD}</b> and drafts a DOLE-compliant NTE per person on RCC letterhead. Anyone with ${TK_LEAVE_REVIEW_ABSENCES}+ absences is <b>held</b> (likely leave), never auto-drafted.</div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap;">
        <label class="btn" style="cursor:pointer;">Choose attendance file
          <input type="file" id="tkFile" accept=".xlsx" style="display:none;">
        </label>
        <span id="tkStatus" class="psub" style="margin:0;">No file loaded yet.</span>
      </div>
    </div>
    <div id="tkResults"></div>`;
  const fi=pg.querySelector("#tkFile");
  if(fi) fi.addEventListener("change",e=>{ const f=e.target.files&&e.target.files[0]; if(f) tkHandleFile(f); });
  if(TK_RESULT){ const st=document.getElementById("tkStatus"); if(st) st.textContent="✓ "+TK_MONTH_FULL[TK_RESULT.MON]+" "+TK_YEAR+" (loaded)"; tkRenderResults(); }
}
window.renderTimekeeping=renderTimekeeping;

/* ---------- GOVERNMENT REMITTANCES — Pag-IBIG (.MCL) converter ----------
   Vina drops the monthly PayPlus "PAGIBIG CONTRIBUTIONS.xlsx" → this builds the
   exact Pag-IBIG electronic upload file (.MCL) that the HDMF uploader accepts.
   Proven byte-for-byte identical to the CBC-converter output on the May 2026 file.
   Pure in-browser conversion — no data is stored. Salary/computation stays in
   PayPlus; Pag-IBIG is a flat ₱200/₱200 so only the ID + name + DOB travel here. */
// Header line is a constant RCC template (employer 200743180003, company, address);
// only the 6-char period [4:10] = YYYYMM changes each month.
const HDMF_HEADER_TMPL="EH09202605200743180003   PMCROSHAN COMMERCIAL CORPORATION                                                                       3F RCC CENTER SHAW BLVD PASIG CITY                                                                                        ";
const HDMF_EMPLOYER=HDMF_HEADER_TMPL.slice(10,22); // 200743180003
let GR_RESULT=null;

function grPad(s,width,right){ s=(s==null?"":String(s)); if(s.length>width) s=s.slice(0,width);
  return right ? s.padStart(width," ") : s.padEnd(width," "); }
function grNormTin(t){ t=(t==null?"":String(t)).replace(/\D/g,"").replace(/^0+/,""); return t||"0"; }
function grDob(v){ // → YYYYMMDD (timezone-free; Excel stores dates as serial numbers)
  if(typeof v==="number" && isFinite(v) && window.XLSX && window.XLSX.SSF){
    const d=window.XLSX.SSF.parse_date_code(v);
    if(d && d.y) return d.y+String(d.m).padStart(2,"0")+String(d.d).padStart(2,"0");
  }
  if(v instanceof Date && !isNaN(v)) return v.getFullYear()+String(v.getMonth()+1).padStart(2,"0")+String(v.getDate()).padStart(2,"0");
  const s=String(v==null?"":v); const d=s.replace(/\D/g,"");
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10).replace(/-/g,"");
  return d.slice(0,8);
}
function grAmt(v){ const n=Number(v||0); return n.toFixed(2); }
function grMclRow(r){ // r = {hdmf,last,first,middle,ee,er,tin,dob}
  const line=new Array(168).fill(" ");
  const put=(s,start,width,right)=>{ s=grPad(s,width,right); for(let i=0;i<width;i++) line[start+i]=s[i]; };
  put("DT",0,2);
  put(String(r.hdmf||"").replace(/\D/g,""),2,12);
  put(String(r.last||"").replace(/\s/g,""),29,30);
  put(String(r.first||"").replace(/\s/g,""),59,30);
  put((String(r.middle||"").replace(/\s/g,""))||"A",89,30);
  put(grAmt(r.ee),119,13,true);
  put(grAmt(r.er),132,13,true);
  put(grNormTin(r.tin),145,12);
  put(grDob(r.dob),160,8);
  return line.join("");
}
// Locate the header row (contains "HDMF") and map columns by name — works for the
// combined sheet (has a "No." column) and the per-division ho/diser sheets alike.
function grParseSheet(rows){
  let hi=-1;
  for(let i=0;i<Math.min(rows.length,15);i++){
    const cells=(rows[i]||[]).map(c=>String(c==null?"":c).trim().toLowerCase());
    if(cells.indexOf("hdmf")!==-1 && cells.some(c=>c.indexOf("last")!==-1)){ hi=i; break; }
  }
  if(hi<0) return null;
  const hdr=(rows[hi]||[]).map(c=>String(c==null?"":c).trim().toLowerCase());
  const col=(want)=>hdr.findIndex(h=>h===want);
  const colLike=(want)=>hdr.findIndex(h=>h.indexOf(want)!==-1);
  const idx={ hdmf:col("hdmf"), tin:col("tin"), last:colLike("last"), first:colLike("first"),
    middle:colLike("middle"), dob:colLike("birth"), ee:col("employee"), er:col("employer"), period:col("period") };
  const out=[];
  for(let i=hi+1;i<rows.length;i++){
    const row=rows[i]||[]; const hd=String(row[idx.hdmf]==null?"":row[idx.hdmf]).replace(/\D/g,"");
    if(!hd) continue; // skip blanks / subtotal rows
    out.push({ hdmf:hd, tin:row[idx.tin], last:row[idx.last], first:row[idx.first], middle:row[idx.middle],
      dob:row[idx.dob], ee:row[idx.ee], er:row[idx.er], period:row[idx.period] });
  }
  return out;
}
function grPeriodYYYYMM(rows){ // from a "5-2026" Period cell → "202605"
  for(const r of rows){ const p=String(r.period==null?"":r.period).trim();
    let m=p.match(/^(\d{1,2})[-\/](\d{4})$/); if(m) return m[2]+m[1].padStart(2,"0");
    m=p.match(/^(\d{4})[-\/](\d{1,2})$/); if(m) return m[1]+m[2].padStart(2,"0"); }
  return null;
}
async function grHandleFile(file){
  const status=document.getElementById("grStatus"); if(status){ status.style.color=""; status.textContent="Reading "+file.name+"…"; }
  try{
    await tkLoadSheetJS();
    const buf=await file.arrayBuffer();
    const wb=window.XLSX.read(new Uint8Array(buf),{type:"array"}); // no cellDates — read dates as serials, convert tz-free in grDob
    // Prefer a "combined" sheet; else merge every sheet that parses.
    const names=wb.SheetNames;
    const combined=names.find(n=>/combined/i.test(n));
    let rows=[];
    const toRows=(sh)=>window.XLSX.utils.sheet_to_json(sh,{header:1,defval:null});
    if(combined){ rows=grParseSheet(toRows(wb.Sheets[combined]))||[]; }
    if(!rows.length){ // fall back: concat all division sheets, de-dupe by HDMF
      const seen={}; for(const n of names){ const p=grParseSheet(toRows(wb.Sheets[n])); if(!p) continue;
        for(const r of p){ if(!seen[r.hdmf]){ seen[r.hdmf]=1; rows.push(r); } } }
    }
    if(!rows.length) throw new Error("Couldn't find a Pag-IBIG contribution sheet (needs an HDMF + name header). Is this the PayPlus PAGIBIG export?");
    const yyyymm=grPeriodYYYYMM(rows);
    GR_RESULT={ rows, yyyymm, fname:file.name, ee:rows.reduce((a,r)=>a+Number(r.ee||0),0), er:rows.reduce((a,r)=>a+Number(r.er||0),0) };
    if(status) status.textContent="✓ "+file.name+" — "+rows.length+" members"+(yyyymm?(" · period "+yyyymm):"");
    grRenderResults();
  }catch(e){ if(status){ status.textContent="⚠ "+((e&&e.message)||e); status.style.color="#a4322a"; } GR_RESULT=null; grRenderResults(); }
}
function grBuildMCL(){
  if(!GR_RESULT) return "";
  let header=HDMF_HEADER_TMPL;
  if(GR_RESULT.yyyymm && /^\d{6}$/.test(GR_RESULT.yyyymm)) header=header.slice(0,4)+GR_RESULT.yyyymm+header.slice(10);
  const lines=[header].concat(GR_RESULT.rows.map(grMclRow));
  return lines.join("\r\n"); // no trailing newline — matches HDMF format
}
function grDownloadMCL(){
  const text=grBuildMCL(); if(!text) return;
  const fname="MC"+HDMF_EMPLOYER+".MCL";
  const blob=new Blob([text],{type:"text/plain"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=fname;
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },100);
}
window.grDownloadMCL=grDownloadMCL;
const GR_MONTHS=["","January","February","March","April","May","June","July","August","September","October","November","December"];
function grRenderResults(){
  const box=document.getElementById("grResults"); if(!box) return;
  if(!GR_RESULT){ box.innerHTML=""; return; }
  const {rows,yyyymm,ee,er}=GR_RESULT;
  const per = yyyymm ? (GR_MONTHS[+yyyymm.slice(4)]+" "+yyyymm.slice(0,4)) : "—";
  const noPagibig=rows.filter(r=>!String(r.hdmf||"").replace(/\D/g,"")).length; // (parser already drops these, kept for safety)
  const preview=rows.slice(0,8).map((r,i)=>`<tr><td>${i+1}</td><td><b>${esc(r.last||"")}</b>, ${esc(r.first||"")} ${esc(r.middle||"")}</td>
    <td>${esc(String(r.hdmf||""))}</td><td>${esc(grNormTin(r.tin))}</td><td>${esc(grDob(r.dob))}</td>
    <td style="text-align:right;">${grAmt(r.ee)}</td><td style="text-align:right;">${grAmt(r.er)}</td></tr>`).join("");
  box.innerHTML=`
    <div class="panel" style="margin-top:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div><h2 style="margin:0;">Ready — Pag-IBIG upload file</h2>
          <div class="psub" style="margin:4px 0 0;">Period <b>${per}</b> · <b>${rows.length}</b> members · Employee ₱${ee.toLocaleString()} + Employer ₱${er.toLocaleString()} = <b>₱${(ee+er).toLocaleString()}</b></div></div>
        <button class="btn" onclick="grDownloadMCL()">⬇ Download MC${HDMF_EMPLOYER}.MCL</button>
      </div>
      <div class="psub" style="margin-top:10px;">This is the electronic file the HDMF employer uploader accepts — hand it to Accounting to upload. Below is a preview of the first rows so you can eyeball it before sending.</div>
      <div style="overflow:auto;margin-top:10px;"><table><thead><tr><th>#</th><th>Name</th><th>Pag-IBIG MID</th><th>TIN</th><th>Birthdate</th><th style="text-align:right;">EE</th><th style="text-align:right;">ER</th></tr></thead>
        <tbody>${preview}</tbody></table></div>
      ${rows.length>8?`<div class="psub" style="margin-top:6px;">…and ${rows.length-8} more. The download contains all ${rows.length}.</div>`:""}
    </div>`;
}
function renderGovRemit(){
  const pg=document.getElementById("page-govremit"); if(!pg) return;
  pg.innerHTML=`
    <div class="panel">
      <h2>Government Remittances — Pag-IBIG</h2>
      <div class="psub">Drop the month's PayPlus <b>Pag-IBIG Contributions</b> export (the <code>MAY 2026 - PAGIBIG CONTRIBUTIONS.xlsx</code>-style file). This builds the exact <b>.MCL upload file</b> the HDMF employer portal accepts — replacing the old "CBC converter" step. Nothing is stored; the file is built in your browser.</div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap;">
        <label class="btn" style="cursor:pointer;">Choose Pag-IBIG file
          <input type="file" id="grFile" accept=".xlsx,.xls" style="display:none;">
        </label>
        <span id="grStatus" class="psub" style="margin:0;">No file loaded yet.</span>
      </div>
      <div class="psub" style="margin-top:12px;padding:10px 12px;background:#f4f8f5;border-radius:8px;">
        <b>SSS is coming next</b> — once we have the SSS upload file format, this page gets an SSS button too. SSS amounts come from each person's salary (from PayPlus), unlike Pag-IBIG's flat ₱200/₱200.
      </div>
    </div>
    <div id="grResults"></div>`;
  const fi=pg.querySelector("#grFile");
  if(fi) fi.addEventListener("change",e=>{ const f=e.target.files&&e.target.files[0]; if(f) grHandleFile(f); });
  if(GR_RESULT) grRenderResults();
}
window.renderGovRemit=renderGovRemit;

/* ---------- WORKSITES (Branches page) — real store list from Branch Directory ---------- */
const catPill=(c)=> c==="CN"?'<span class="pill cn">Concession</span>':(c==="CO"?'<span class="pill co">Boutique</span>':'<span class="pill ho">'+esc(c||"—")+'</span>');
const statusBranchPill=(s)=> s==="Open"?'<span class="pill open">Open</span>':'<span class="pill closed">Closed</span>';
const disersAt=(store)=> DISERS.filter(d=>d.store===store && (d.status||"").toLowerCase().startsWith("active"));
// Normalize PayPlus worksite labels that don't exactly match our store names (spelling/format only — same store).
const WORKSITE_ALIAS={
  "SM CUBAO":"SM Cubao", "The SM Store Caloocan":"SM Caloocan", "The SM Store Zamboanga":"SM Zamboanga",
  "The SM Store La Union":"SM La Union", "The SM Store Sto.Tomas":"SM Sto. Tomas", "Spyder Northedsa":"Spyder NorthEdsa",
  "GearUp MarketMarket":"GearUp Market Market", "Tiongsan Harrison Baguio":"Tiongsan Harrison",
  "Metro Retail Store Group Inc. / Metro Ayala":"Metro Ayala"
};
const normWorksite=(w)=> WORKSITE_ALIAS[w]||w;
// Confirmed staff at a store = LIVE PayPlus roster only (active employees whose worksite matches the store). Manning Sheet is retired now that PayPlus is the source.
function staffAtStore(store){
  return (EMPLOYEES||[]).filter(e=> normWorksite(e.worksite)===store && (e.status||"Active")==="Active")
    .map(e=>({ name:e.full_name, emp_no:e.employee_id, position:e.position, diser_type:null, hired_by:e.hire_source, status:e.status||"Active", total_rate:e.daily_rate }));
}
const chcFor=(store)=> staffAtStore(store).length;

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
    <div class="psub" style="margin:2px 0 6px;">CO = Boutique · CN = Concession. Approved headcount = how many this store should have.</div>
    ${demoChk("st_isdemo",b.is_demo)}
    <div id="stMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
    <div style="display:flex;gap:10px;"><button class="btn ghost" id="stCancel" style="flex:1;">Cancel</button><button class="btn" id="stSave" style="flex:1;">${isNew?"Add store":"Save"}</button></div>
  </div>`;
  m.addEventListener("click",e=>{ if(e.target===m) m.remove(); });
  document.getElementById("stCancel").addEventListener("click",()=>m.remove());
  document.getElementById("stSave").addEventListener("click",async()=>{
    const name=v("st_name"); if(!name){ document.getElementById("stMsg").textContent="Store name is required."; return; }
    const payload={ name, city:v("st_city"), area:v("st_area"), sc:v("st_sc"), category:v("st_cat"), status:v("st_status"),
      ahc_stationary:nv("st_ahcs")||0, ahc_reliever:nv("st_ahcr")||0, is_demo:demoChecked("st_isdemo") };
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
  const here=staffAtStore(b.name).sort((a,c)=>(a.name||"").localeCompare(c.name||""));
  const ahc=(b.ahc_stationary||0)+(b.ahc_reliever||0); const chc=here.length; const def=Math.max(0,ahc-chc);
  let m=document.getElementById("storeModal"); if(!m){ m=document.createElement("div"); m.id="storeModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:600px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;">
      <div style="font-size:21px;font-weight:800;">${esc(b.name)}</div>
      <div style="font-size:12.5px;opacity:.9;margin-top:3px;">${esc(b.city||"")}${b.area?" · "+esc(b.area):""} · SC: ${esc(b.sc||"—")} · ${b.category==="CN"?"Concession":"Boutique"} · ${esc(b.status||"")}</div>
    </div>
    <div style="padding:18px 22px 60px;">
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi"><div class="k-l">Approved (AHC)</div><div class="k-n">${ahc}</div><div class="k-s">${b.ahc_stationary||0} stationary · ${b.ahc_reliever||0} reliever</div></div>
        <div class="kpi"><div class="k-l">Confirmed (CHC)</div><div class="k-n">${chc}</div><div class="k-s">on file</div></div>
        <div class="kpi ${def>0?'alert':''}"><div class="k-l">Shortfall</div><div class="k-n">${def}</div></div>
      </div>
      <div class="panel" style="margin-top:14px;">
        <h2>Merchandisers at this store <span class="count-tag">${here.length}</span></h2>
        <div class="psub">Live from PayPlus — active employees assigned to this worksite. Daily rate is blank until PayPlus exposes pay via the API.</div>
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
        ${canManageStores()?`<button class="btn" id="storeEdit">Edit store</button>
        <button class="btn ghost" id="storeToggle" style="color:${b.status==='Closed'?'var(--green-dark)':'var(--red)'};border-color:#e2e7e4;">${b.status==='Closed'?'Reopen store':'Close store'}</button>`:`<span class="psub" style="align-self:center;">Store setup (headcount · open/close) is set by Management.</span>`}
        <button class="btn ghost" id="storeClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  document.getElementById("storeClose").addEventListener("click",()=>m.remove());
  const _se=document.getElementById("storeEdit"); if(_se) _se.addEventListener("click",()=>storeForm(b));
  const _st=document.getElementById("storeToggle"); if(_st) _st.addEventListener("click",async()=>{
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
/* City → [lat, lng] lookup for the Worksites Map lens. Case-insensitive matched. */
const CITY_LATLNG={"Quezon City":[14.68,121.05],"Cebu":[10.32,123.90],"Cebu City":[10.32,123.90],"Cagayan de Oro":[8.48,124.65],"Baguio":[16.41,120.60],"Pasay":[14.54,121.00],"Caloocan":[14.65,120.97],"Tuguegarao":[17.61,121.73],"Davao":[7.19,125.46],"Davao City":[7.19,125.46],"San Fernando":[15.03,120.69],"Pasig":[14.58,121.06],"Legazpi":[13.14,123.74],"Iloilo":[10.72,122.56],"General Santos":[6.11,125.17],"Batangas":[13.76,121.06],"Taguig":[14.52,121.05],"Mandaluyong":[14.58,121.03],"Manila":[14.60,120.98],"Angeles":[15.15,120.59],"Zamboanga":[6.92,122.08],"Cabanatuan":[15.49,120.97],"San Jose":[15.79,120.99],"Quezon":[14.00,122.00],"Olongapo":[14.83,120.28],"Lucena":[13.93,121.62],"Rosales":[15.90,120.63],"Calamba":[14.21,121.16],"Makati":[14.55,121.03],"Taytay":[14.57,121.13],"Cauayan":[16.93,121.77],"Paranaque":[14.48,121.02],"Bacoor":[14.46,120.95],"Santa Rosa":[14.31,121.11],"Butuan":[8.95,125.53],"Bacolod":[10.68,122.95],"Rosario":[13.85,121.20],"Balanga":[14.68,120.54],"Baliwag":[14.95,120.90],"Mandaue":[10.33,123.94]};
/* Fixed palette (~10) for coloring pins by Sales Coordinator. */
const SC_MAP_COLORS=["#1F6B52","#C7562E","#2E6FB0","#8B5CA6","#B5872A","#2E9E8F","#C23B6B","#5A7D2A","#4B5563","#B03A3A"];
function renderBranchesPage(){
  const pg=$("#page-branches");
  const open=BRANCHES.filter(b=>b.status==="Open");
  let lens="list";  // "list" | "map"
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Worksites — every store</h2>
      <div class="psub">${BRANCHES.length} stores · ${open.length} open · each broken out individually, with its Sales Coordinator</div>
      <div class="grid kpis" style="grid-template-columns:repeat(4,1fr);">
        <div class="kpi"><div class="k-l">Open Stores</div><div class="k-n">${open.length}</div></div>
        <div class="kpi"><div class="k-l">Concession</div><div class="k-n">${open.filter(b=>b.category==="CN").length}</div></div>
        <div class="kpi"><div class="k-l">Boutique</div><div class="k-n">${open.filter(b=>b.category==="CO").length}</div></div>
        <div class="kpi"><div class="k-l">Sales Coordinators</div><div class="k-n">${new Set(open.map(b=>b.sc).filter(x=>x&&x!=='Unassigned')).size}</div></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0 4px;">
        <div class="toggle" id="wsToggle" style="display:inline-flex;border:1px solid var(--line,#dbe4dd);border-radius:9px;overflow:hidden;">
          <div id="wsList" style="padding:7px 14px;cursor:pointer;font-size:13px;font-weight:600;background:#1F6B52;color:#fff;">List</div>
          <div id="wsMap" style="padding:7px 14px;cursor:pointer;font-size:13px;font-weight:600;">Map</div>
        </div>
        <input id="wsSearch" class="search" style="flex:1;min-width:180px;" placeholder="Search store, city, SC…">
      </div>
      <div id="wsListBody" style="margin-top:8px;">
        <table>
          <thead><tr><th>Store</th><th>Sales Coordinator</th><th>City · Area</th><th>Type</th><th>Status</th><th>Approved HC</th></tr></thead>
          <tbody id="wsRows"></tbody>
        </table>
        <div id="wsCount" style="font-size:12px;color:var(--muted);margin-top:10px;"></div>
      </div>
      <div id="wsMapBody" style="margin-top:8px;display:none;"></div>
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
  const paintMap=()=>{
    const W=520,H=760;
    // Projection: lng 116→127 → x 0→W ; lat 21.5→4.0 → y 0→H (lat inverts).
    const proj=(lat,lng)=>[ (lng-116)/(127-116)*W, (21.5-lat)/(21.5-4.0)*H ];
    const rxDeg=d=>d/11*W, ryDeg=d=>d/17.5*H;
    // Active, non-demo stores only.
    const stores=BRANCHES.filter(b=>!b.is_demo);
    // SC → color (each distinct SC gets a fixed palette color).
    const scList=[...new Set(stores.map(b=>(b.sc||"").trim()).filter(x=>x&&x!=="Unassigned"))].sort((a,b)=>a.localeCompare(b));
    const scColor={}; scList.forEach((sc,i)=>scColor[sc]=SC_MAP_COLORS[i%SC_MAP_COLORS.length]);
    const scCount={}; // stores per SC (mapped)
    // Group by city via the lookup (case-insensitive).
    const keyLower={}; Object.keys(CITY_LATLNG).forEach(k=>keyLower[k.toLowerCase()]=CITY_LATLNG[k]);
    const cityGroups={}; const notPlaced={};
    stores.forEach(b=>{
      const c=(b.city||"").trim(); if(!c) return;
      const ll=keyLower[c.toLowerCase()];
      if(!ll){ notPlaced[c]=(notPlaced[c]||0)+1; return; }
      (cityGroups[c]=cityGroups[c]||{ll,rows:[]}).rows.push(b);
    });
    // Build pins.
    const pins=Object.keys(cityGroups).map(city=>{
      const g=cityGroups[city]; const [x,y]=proj(g.ll[0],g.ll[1]);
      const scTally={}; g.rows.forEach(b=>{ const s=(b.sc||"").trim()||"Unassigned"; scTally[s]=(scTally[s]||0)+1; if(s!=="Unassigned"){scCount[s]=(scCount[s]||0)+1;} });
      const scKeys=Object.keys(scTally);
      // dominant SC (most stores); neutral gray if >1 distinct SC and no clear single.
      let dom=scKeys.sort((a,b)=>scTally[b]-scTally[a])[0];
      const distinct=scKeys.filter(s=>s!=="Unassigned");
      const color = distinct.length===0 ? "#9AA5B1"
        : distinct.length>1 ? (scColor[dom]&&dom!=="Unassigned"?scColor[dom]:"#9AA5B1")
        : scColor[distinct[0]];
      const r=Math.min(14, 5+(g.rows.length-1));
      const names=g.rows.map(b=>`${b.name}${b.sc?" ("+b.sc+")":""}`).join("\n");
      return {city,x,y,r,color,count:g.rows.length,names};
    });
    const mapped=pins.reduce((s,p)=>s+p.count,0);
    const npKeys=Object.keys(notPlaced);
    // SVG map
    const blob=(lat,lng,dLat,dLng)=>{ const [cx,cy]=proj(lat,lng); return `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rxDeg(dLng).toFixed(1)}" ry="${ryDeg(dLat).toFixed(1)}" fill="#E1F0EA" stroke="#B9D8CC" stroke-width="1.5"/>`; };
    const lbl=(lat,lng,t)=>{ const [x,y]=proj(lat,lng); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="#9CC3B4" letter-spacing="1">${t}</text>`; };
    const svg=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto;">
      <rect x="0" y="0" width="${W}" height="${H}" fill="#F7FBF9"/>
      <!-- Luzon -->
      ${blob(15.7,121.25,3.1,1.55)}${blob(13.4,122.6,1.4,1.2)}${blob(14.4,120.9,1.6,1.0)}
      <!-- Visayas -->
      ${blob(10.7,123.5,1.35,1.6)}
      <!-- Mindanao -->
      ${blob(7.5,124.35,2.0,2.25)}
      ${lbl(17.0,120.4,"LUZON")}${lbl(11.6,124.6,"VISAYAS")}${lbl(9.2,123.4,"MINDANAO")}
      ${pins.map((p,i)=>`<circle class="wsPin" data-city="${esc(p.city)}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r}" fill="${p.color}" fill-opacity="0.82" stroke="#fff" stroke-width="1.5" style="cursor:pointer;"><title>${esc(p.city)} — ${p.count} store${p.count!==1?"s":""}\n${esc(p.names)}</title></circle>`).join("")}
    </svg>`;
    const legend=scList.map(sc=>`<div style="display:flex;align-items:center;gap:6px;font-size:12px;"><span style="width:12px;height:12px;border-radius:50%;background:${scColor[sc]};display:inline-block;"></span>${esc(sc)} <span style="color:var(--muted,#6b7785);">· ${scCount[sc]||0}</span></div>`).join("");
    $("#wsMapBody").innerHTML=`
      <div style="font-size:12px;color:var(--muted,#6b7785);margin-bottom:8px;"><b>${mapped}</b> stores mapped · <b>${pins.length}</b> cities · <b>${scList.length}</b> coordinators · click a pin to see that city's stores</div>
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">
        <div style="overflow:auto;border:1px solid var(--line,#dbe4dd);border-radius:10px;background:#fff;">${svg}</div>
        <div style="min-width:180px;">
          <div style="font-size:12.5px;font-weight:800;color:#12352a;margin-bottom:6px;">Sales Coordinators</div>
          <div style="display:flex;flex-direction:column;gap:5px;">${legend||'<div style="font-size:12px;color:var(--muted);">No coordinators</div>'}</div>
        </div>
      </div>
      ${npKeys.length?`<div style="font-size:12px;color:#a12;margin-top:10px;">Not on map yet (${npKeys.length}): ${npKeys.map(c=>esc(c)+" ("+notPlaced[c]+")").join(" · ")}</div>`:""}`;
    $$("#wsMapBody circle.wsPin").forEach(el=>el.addEventListener("click",()=>{
      const city=el.getAttribute("data-city");
      setLens("list"); $("#wsSearch").value=city; paint();
    }));
  };
  const setLens=(l)=>{ lens=l;
    $("#wsList").style.background=l==="list"?"#1F6B52":""; $("#wsList").style.color=l==="list"?"#fff":"";
    $("#wsMap").style.background=l==="map"?"#1F6B52":""; $("#wsMap").style.color=l==="map"?"#fff":"";
    $("#wsListBody").style.display=l==="list"?"":"none";
    $("#wsMapBody").style.display=l==="map"?"":"none";
    if(l==="map") paintMap();
  };
  $("#wsList").addEventListener("click",()=>setLens("list"));
  $("#wsMap").addEventListener("click",()=>setLens("map"));
  $("#wsSearch").addEventListener("input",()=>{ if(lens==="list") paint(); });
  paint();
}

/* ================= STORE MAPPING — every store laid out under its Store Coordinator (store lead), with vacancy flags =================
   Reuses BRANCHES + SC_STATUS (no new data). Two lenses: By Store Coordinator (the "store lead separated" view — each SC = a card
   with the cluster of stores they cover) and By Location (grouped by city). The SC is linked to each store throughout. */
function scVacancy(sc){
  const name=(sc||"").trim();
  if(!name || name==="Unassigned") return { vacant:true, note:"No coordinator assigned" };
  const s=SC_STATUS[name];
  if(s && s.status && s.status!=="Active") return { vacant:true, note:s.note||s.status };
  return { vacant:false, note:(s&&s.note)||"" };
}
function branchHC(b){ return (Number(b.ahc_stationary)||0)+(Number(b.ahc_reliever)||0); }
function renderStoremap(){
  const pg=$("#page-storemap"); if(!pg) return;
  let view="sc";  // "sc" | "loc"
  const open=BRANCHES.filter(b=>b.status==="Open");
  const scSet=new Set(BRANCHES.map(b=>(b.sc||"").trim()).filter(x=>x&&x!=="Unassigned"));
  const noLead=BRANCHES.filter(b=>b.status==="Open" && !((b.sc||"").trim()) ).length;  // stores with no coordinator on file (a data gap)
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Store Mapping</h2>
      <div class="psub">Every store mapped to its Store Coordinator (store lead). ${BRANCHES.length} stores · ${open.length} open · ${scSet.size} coordinators</div>
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi"><div class="k-l">Open Stores</div><div class="k-n">${open.length}</div></div>
        <div class="kpi"><div class="k-l">Store Coordinators</div><div class="k-n">${scSet.size}</div></div>
        <div class="kpi ${noLead?"warn":""}"><div class="k-l">Stores w/o a lead</div><div class="k-n">${noLead}</div><div class="k-s">no coordinator on file</div></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0 4px;">
        <div class="toggle" id="smToggle" style="display:inline-flex;border:1px solid var(--line,#dbe4dd);border-radius:9px;overflow:hidden;">
          <div id="smBySc" class="active" style="padding:7px 14px;cursor:pointer;font-size:13px;font-weight:600;background:#1F6B52;color:#fff;">By Store Coordinator</div>
          <div id="smByLoc" style="padding:7px 14px;cursor:pointer;font-size:13px;font-weight:600;">By Location</div>
        </div>
        <input id="smSearch" class="search" style="flex:1;min-width:180px;" placeholder="Search store, city, coordinator…">
      </div>
      <div id="smBody" style="margin-top:8px;"></div>
    </div>`;
  const card=(title,badge,sub,rows)=>`
    <div class="panel" style="margin-top:0;margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div style="font-size:15.5px;font-weight:800;color:#12352a;">${title} ${badge||""}</div>
        <div style="font-size:12px;color:var(--muted,#6b7785);">${sub}</div>
      </div>
      <table style="margin-top:8px;"><thead><tr><th>Store</th><th>City · Area</th><th>Type</th><th>Status</th><th>Approved HC</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
  const storeRow=b=>`<tr class="clickable" data-bi="${BRANCHES.indexOf(b)}"><td><b>${esc(b.name)}</b></td>
    <td>${esc(b.city||"—")}${b.area?" · "+esc(b.area):""}</td><td>${catPill(b.category)}</td>
    <td>${statusBranchPill(b.status)}</td><td><span class="pill di">${b.ahc_stationary||0}</span>${b.ahc_reliever?` · ${b.ahc_reliever} rlv`:""}</td></tr>`;
  const paint=()=>{
    const q=($("#smSearch").value||"").trim().toLowerCase();
    const match=b=> !q || [b.name,b.city,b.area,b.sc].filter(Boolean).join(" ").toLowerCase().includes(q);
    const body=$("#smBody");
    if(view==="sc"){
      // group by coordinator; vacant/unassigned clusters float to the top, flagged red.
      const groups={};
      BRANCHES.filter(match).forEach(b=>{ const k=((b.sc||"").trim())||"Unassigned"; (groups[k]=groups[k]||[]).push(b); });
      const keys=Object.keys(groups).sort((a,b)=>{
        return a==="Unassigned"?-1:b==="Unassigned"?1:a.localeCompare(b);  // Unassigned first, then A–Z
      });
      body.innerHTML = keys.length ? keys.map(k=>{
        const list=groups[k].slice().sort((a,b)=>(a.status===b.status?0:(a.status==="Open"?-1:1))||a.name.localeCompare(b.name));
        const totHC=list.reduce((s,b)=>s+branchHC(b),0);
        const openN=list.filter(b=>b.status==="Open").length;
        // "Unassigned" = a store with no coordinator on file (a data gap) — mild note only. Coordinator RESIGNATIONS are not flagged here; they prompt on the dashboard.
        const badge = k==="Unassigned" ? `<span class="pill" style="background:#fff3e0;color:#8a5a12;border:1px solid #ecd9a6;">No coordinator on file</span>` : "";
        const title = k==="Unassigned" ? `⚠ Unassigned` : `👤 ${esc(k)}`;
        return card(title, badge, `${list.length} store${list.length!==1?"s":""} · ${openN} open · ${totHC} approved heads`, list.map(storeRow).join(""));
      }).join("") : `<div class="psub">No stores match “${esc(q)}”.</div>`;
    } else {
      // group by city
      const groups={};
      BRANCHES.filter(match).forEach(b=>{ const k=(b.city||"—").trim()||"—"; (groups[k]=groups[k]||[]).push(b); });
      const keys=Object.keys(groups).sort((a,b)=>a.localeCompare(b));
      const locRow=b=>{ return `<tr class="clickable" data-bi="${BRANCHES.indexOf(b)}"><td><b>${esc(b.name)}</b></td>
        <td>${b.sc?esc(b.sc):`<span style="color:#8a5a12;">Unassigned</span>`}</td>
        <td>${catPill(b.category)}</td><td>${statusBranchPill(b.status)}</td><td><span class="pill di">${b.ahc_stationary||0}</span>${b.ahc_reliever?` · ${b.ahc_reliever} rlv`:""}</td></tr>`; };
      body.innerHTML = keys.length ? keys.map(k=>{
        const list=groups[k].slice().sort((a,b)=>(a.status===b.status?0:(a.status==="Open"?-1:1))||a.name.localeCompare(b.name));
        const scs=new Set(list.map(b=>(b.sc||"").trim()).filter(x=>x&&x!=="Unassigned"));
        return `<div class="panel" style="margin-top:0;margin-bottom:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div style="font-size:15.5px;font-weight:800;color:#12352a;">📍 ${esc(k)}</div>
            <div style="font-size:12px;color:var(--muted,#6b7785);">${list.length} store${list.length!==1?"s":""} · ${scs.size} coordinator${scs.size!==1?"s":""}</div>
          </div>
          <table style="margin-top:8px;"><thead><tr><th>Store</th><th>Coordinator</th><th>Type</th><th>Status</th><th>Approved HC</th></tr></thead>
          <tbody>${list.map(locRow).join("")}</tbody></table></div>`;
      }).join("") : `<div class="psub">No stores match “${esc(q)}”.</div>`;
    }
    $$("#smBody tr.clickable").forEach(tr=>tr.addEventListener("click",()=>openStore(BRANCHES[+tr.dataset.bi])));
  };
  const setView=(v)=>{ view=v;
    $("#smBySc").style.background=v==="sc"?"#1F6B52":""; $("#smBySc").style.color=v==="sc"?"#fff":"";
    $("#smByLoc").style.background=v==="loc"?"#1F6B52":""; $("#smByLoc").style.color=v==="loc"?"#fff":"";
    paint();
  };
  $("#smBySc").addEventListener("click",()=>setView("sc"));
  $("#smByLoc").addEventListener("click",()=>setView("loc"));
  $("#smSearch").addEventListener("input",paint);
  paint();
}
window.renderStoremap=renderStoremap;

/* ================= ORG CHART — reporting structure from the real roster =================
   Data-driven view of the org. Two lenses:
   (1) By Department — company → department (with head + headcount) → staff grouped under supervisors.
   (2) By Reporting Line — supervisor tree built from supervisor_email → employee.
   The roster stays PayPlus-owned, BUT reporting lines / dept heads are HRIS-owned org structure
   (supervisor_* on the employee row; department_heads table), so Rhel/admins (canEditOrg) can assign
   them inline here — the nightly PayPlus sync never touches those fields. Everyone else = read-only.
   Assigned dept heads come from DEPT_HEADS first, then fall back to the old department_head_email logic. */
function renderOrgChart(){
  const pg=$("#page-orgchart"); if(!pg) return;
  const canEdit=canEditOrg();
  const ACT=EMPLOYEES.filter(e=>(e.status||"").toLowerCase().startsWith("active"));
  // resolve an email to an active employee's name (else show the raw email)
  const emailToEmp={}; ACT.forEach(e=>{ if(e.email) emailToEmp[String(e.email).toLowerCase()]=e; });
  const resolveName=(email)=>{ if(!email) return ""; const m=emailToEmp[String(email).toLowerCase()]; return m?m.full_name:email; };
  // departments (active only)
  const depts=[...new Set(ACT.map(e=>(e.department||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  // Assigned head from the department_heads table (HRIS-owned), matched by department name.
  const deptHeadRow=(d)=>DEPT_HEADS.find(h=>(h.department||"").trim().toLowerCase()===String(d).trim().toLowerCase());
  // Fallback: infer a head from any department_head_email set on the roster rows.
  const deptHeadEmail=(d)=>{ const c={}; ACT.filter(e=>(e.department||"").trim()===d).forEach(e=>{ const h=(e.department_head_email||"").trim(); if(h) c[h]=(c[h]||0)+1; }); const k=Object.keys(c); return k.length?k.sort((a,b)=>c[b]-c[a])[0]:""; };
  // Resolved head name: assigned row wins, else the roster-inferred email.
  const deptHeadName=(d)=>{ const r=deptHeadRow(d); if(r&&(r.head_name||r.head_email)) return r.head_name||resolveName(r.head_email); const em=deptHeadEmail(d); return em?resolveName(em):""; };
  const deptHasHead=(d)=>!!(deptHeadRow(d)||deptHeadEmail(d));
  // supervisor tree scaffolding
  const childrenOf={}; ACT.forEach(e=>{ const se=String(e.supervisor_email||"").toLowerCase(); if(se && emailToEmp[se] && emailToEmp[se]!==e){ (childrenOf[se]=childrenOf[se]||[]).push(e); } });
  const hasKids=(e)=> e.email && childrenOf[String(e.email).toLowerCase()];
  const resolvableSup=(e)=>{ const se=String(e.supervisor_email||"").toLowerCase(); return !!(se && emailToEmp[se] && emailToEmp[se]!==e); };
  // KPI figures + data-gap flags
  const supRefs=new Set(); ACT.forEach(e=>{ const lbl=String(e.supervisor_email||e.supervisor_name||"").trim().toLowerCase(); if(lbl) supRefs.add(lbl); });
  const noSup=ACT.filter(e=>!String(e.supervisor_name||"").trim() && !String(e.supervisor_email||"").trim());
  const deptsNoHead=depts.filter(d=>!deptHasHead(d));
  const initialsOf=(e)=>(e.full_name||"?").split(/[ ,]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  // Unobtrusive ghost button to (re)assign a person's supervisor — only editors see it; stops the row's open-record click.
  const supBtn=(e)=> canEdit ? `<button class="oc-setsup" data-idx="${EMPLOYEES.indexOf(e)}" title="Set / replace / clear supervisor" style="flex-shrink:0;background:none;border:1px solid #dbe4dd;color:#1F6B52;font-size:11px;padding:2px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;">⇧ supervisor</button>` : "";
  // Unobtrusive JD link → opens the position's Job Description / Key Tasks / Deliverables (Positions & JD module).
  const jdBtn=(e)=> String(e.position||"").trim() ? `<button class="oc-jd" data-idx="${EMPLOYEES.indexOf(e)}" title="View the job description for ${esc(e.position||"")}" style="flex-shrink:0;background:none;border:1px solid #dbe4dd;color:#1F6B52;font-size:11px;padding:2px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;">📋 JD</button>` : "";
  const personRow=(e,extra)=>`<div class="oc-person clickable" data-idx="${EMPLOYEES.indexOf(e)}" style="display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:7px;cursor:pointer;">
      <span style="width:26px;height:26px;border-radius:50%;background:#e6efe9;color:#1F6B52;font-size:10.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">${esc(initialsOf(e))}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><b style="font-size:13px;color:#12352a;">${esc(e.full_name)}</b> <span style="color:#6b7785;font-size:12px;">· ${esc(e.position||"—")}</span>${extra||""}</span>
      ${jdBtn(e)}${supBtn(e)}
    </div>`;

  let lens="dept";                 // "dept" | "tree" | "map"
  const ocExpanded=new Set(depts); // departments expanded by default (list lens)
  const ocMapOpen=new Set();       // departments expanded in the visual Map lens (collapsed by default)
  // CSS for the classic top-down org-chart connectors (scoped to .octree; injected with the map body).
  const MAP_CSS=`<style>
    .octree{list-style:none;margin:0;padding:0;}
    .octree ul{list-style:none;margin:0;padding:22px 0 0;position:relative;display:flex;justify-content:center;}
    .octree li{list-style:none;position:relative;padding:22px 12px 0;display:flex;flex-direction:column;align-items:center;}
    .octree li::before,.octree li::after{content:'';position:absolute;top:0;right:50%;width:50%;height:22px;border-top:2px solid #cdd9d1;}
    .octree li::after{right:auto;left:50%;border-left:2px solid #cdd9d1;}
    .octree li:only-child::before,.octree li:only-child::after{display:none;}
    .octree li:only-child{padding-top:0;}
    .octree li:first-child::before,.octree li:last-child::after{border:0 none;}
    .octree li:last-child::before{border-right:2px solid #cdd9d1;border-radius:0 6px 0 0;}
    .octree li:first-child::after{border-radius:6px 0 0 0;}
    .octree li ul::before{content:'';position:absolute;top:0;left:50%;width:0;height:22px;border-left:2px solid #cdd9d1;}
    .octree > li{padding-top:0;}
    .oc-map-root{background:#123528;color:#fff;border-radius:10px;padding:12px 22px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.15);}
    .oc-map-root .ocmr-name{font-size:15px;font-weight:800;}
    .oc-map-root .ocmr-sub{font-size:11.5px;opacity:.82;margin-top:2px;}
    .oc-map-dept{background:#fff;border:1px solid #dbe4dd;border-top:3px solid #1F6B52;border-radius:9px;padding:9px 14px;text-align:center;cursor:pointer;min-width:150px;max-width:230px;transition:box-shadow .15s,border-color .15s;}
    .oc-map-dept:hover{box-shadow:0 2px 10px rgba(31,107,82,.18);border-color:#1F6B52;}
    .oc-map-dept.exp{background:#f2f8f4;border-color:#1F6B52;}
    .oc-map-dept .ocmd-name{font-size:13.5px;font-weight:800;color:#12352a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .oc-map-dept .ocmd-head{font-size:11.5px;color:#3f5a4e;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .oc-map-dept .ocmd-nohead{color:#a12;}
    .oc-map-dept .ocmd-count{font-size:11px;color:#6b7785;margin-top:3px;}
    .oc-map-dept .ocmd-caret{color:#1F6B52;font-weight:700;}
    .oc-map-person{background:#fff;border:1px solid #dbe4dd;border-radius:8px;padding:7px 12px;text-align:center;cursor:pointer;min-width:120px;max-width:180px;transition:box-shadow .15s,border-color .15s;}
    .oc-map-person:hover{box-shadow:0 2px 8px rgba(31,107,82,.16);border-color:#1F6B52;}
    .oc-map-person.hit{border-color:#e0a63a;background:#fdf6e7;}
    .oc-map-person .ocmp-name{font-size:12.5px;font-weight:700;color:#12352a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .oc-map-person .ocmp-pos{font-size:11px;color:#6b7785;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .oc-map-person .ocmp-badge{display:inline-block;margin-top:3px;font-size:10px;font-weight:700;color:#1F6B52;background:#e6efe9;border-radius:10px;padding:1px 7px;}
    .oc-map-empty{color:#6b7785;font-size:12px;padding:6px 10px;}
  </style>`;

  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Org Chart</h2>
      <div class="psub">Reporting structure built live from the roster (active staff). The roster stays PayPlus-owned; click any person to open their record.${canEdit?` <b style="color:#1F6B52;">Rhel/admins can assign department heads and supervisors here</b> — this feeds the discretionary NPA approval chain.`:` Reporting lines are read-only for your role.`}</div>
      <div class="grid kpis" style="grid-template-columns:repeat(4,1fr);">
        <div class="kpi"><div class="k-l">Departments</div><div class="k-n">${depts.length}</div></div>
        <div class="kpi"><div class="k-l">Supervisors</div><div class="k-n">${supRefs.size}</div></div>
        <div class="kpi"><div class="k-l">Active staff</div><div class="k-n">${ACT.length}</div></div>
        <div class="kpi ${noSup.length?"warn":""}"><div class="k-l">No supervisor set</div><div class="k-n">${noSup.length}</div><div class="k-s">reporting line blank</div></div>
      </div>
      ${(noSup.length||deptsNoHead.length)?`<div class="psub" style="margin:6px 0 0;color:#8a5a1c;">⚠ Data gaps: ${noSup.length?`<b>${noSup.length}</b> staff have no supervisor set`:""}${(noSup.length&&deptsNoHead.length)?" · ":""}${deptsNoHead.length?`<b>${deptsNoHead.length}</b> department${deptsNoHead.length!==1?"s have":" has"} no head assigned (${esc(deptsNoHead.slice(0,6).join(", "))}${deptsNoHead.length>6?"…":""})`:""}. Fill <i>Supervisor</i> / <i>Department head</i> on the employee record to complete the chart.</div>`:""}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0 4px;">
        <div class="toggle" style="display:inline-flex;border:1px solid var(--line,#dbe4dd);border-radius:9px;overflow:hidden;">
          <div id="ocByDept" class="active" style="padding:7px 14px;cursor:pointer;font-size:13px;font-weight:600;background:#1F6B52;color:#fff;">By Department</div>
          <div id="ocByTree" style="padding:7px 14px;cursor:pointer;font-size:13px;font-weight:600;">By Reporting Line</div>
          <div id="ocByMap" style="padding:7px 14px;cursor:pointer;font-size:13px;font-weight:600;">Map</div>
        </div>
        <input id="ocSearch" class="search" style="flex:1;min-width:180px;" placeholder="Search name, department, position…">
      </div>
      <div id="ocBody" style="margin-top:8px;"></div>
    </div>`;

  const paint=()=>{
    const q=(($("#ocSearch")||{}).value||"").trim().toLowerCase();
    const match=e=> !q || [e.full_name,e.department,e.position,e.worksite].filter(Boolean).join(" ").toLowerCase().includes(q);
    const body=$("#ocBody");
    if(lens==="dept"){
      const headBox=`<div class="panel" style="margin-top:0;margin-bottom:12px;background:#123528;color:#fff;">
        <div style="font-size:16px;font-weight:800;">🏢 Roshan Commercial Corporation</div>
        <div style="font-size:12px;opacity:.8;">${ACT.length} active staff · ${depts.length} departments</div></div>`;
      const cards=depts.map(d=>{
        const staff=ACT.filter(e=>(e.department||"").trim()===d && match(e));
        if(q && !staff.length) return "";
        const all=ACT.filter(e=>(e.department||"").trim()===d);
        const headName=deptHeadName(d);
        const expanded=q?true:ocExpanded.has(d);   // always expand when searching
        let inner="";
        if(expanded){
          // group staff under their supervisor; those with none report directly to the department
          const groups={}; const direct=[];
          staff.forEach(e=>{ const sup=String(e.supervisor_name||e.supervisor_email||"").trim(); if(sup){ (groups[sup]=groups[sup]||[]).push(e); } else direct.push(e); });
          const byName=(a,b)=>(a.full_name||"").localeCompare(b.full_name||"");
          inner=`<div style="margin-top:8px;">`;
          if(direct.length) inner+=direct.slice().sort(byName).map(e=>personRow(e)).join("");
          Object.keys(groups).sort((a,b)=>a.localeCompare(b)).forEach(sup=>{
            inner+=`<div style="margin-top:8px;padding:4px 8px;font-size:11.5px;font-weight:700;color:#1F6B52;text-transform:uppercase;letter-spacing:.4px;">↳ reports to ${esc(resolveName(sup)||sup)}</div>`;
            inner+=`<div style="margin-left:14px;">`+groups[sup].slice().sort(byName).map(e=>personRow(e)).join("")+`</div>`;
          });
          inner+=`</div>`;
        }
        return `<div class="panel" style="margin-top:0;margin-bottom:12px;">
          <div class="oc-dept-h clickable" data-dept="${esc(d)}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;cursor:pointer;">
            <div style="font-size:15px;font-weight:800;color:#12352a;">${q?"":`<span style="color:#6b7785;">${expanded?"▾":"▸"}</span> `}${esc(d)}</div>
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted,#6b7785);">
              <span>${headName?`Head: <b>${esc(headName)}</b>`:`<span style="color:#a12;">⚠ no head assigned</span>`} · ${all.length} staff${q&&staff.length!==all.length?` · ${staff.length} matching`:""}</span>
              ${canEdit?`<button class="oc-sethead" data-dept="${esc(d)}" title="Assign the department head" style="background:none;border:1px solid #dbe4dd;color:#1F6B52;font-size:11px;padding:2px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;">${headName?"change":"✎ set head"}</button>`:""}
            </div>
          </div>${inner}</div>`;
      }).join("");
      body.innerHTML=headBox+(cards || `<div class="psub">No staff match “${esc(q)}”.</div>`);
    } else if(lens==="map"){
      // ---- Visual top-down org map (CSS boxes + connector lines, no library) ----
      const byName=(a,b)=>(a.full_name||"").localeCompare(b.full_name||"");
      // compact person box → click-through to the record; highlight search hits
      const mapPersonBox=(e,nkids)=>`<div class="oc-map-person${q&&match(e)?" hit":""}" data-idx="${EMPLOYEES.indexOf(e)}" title="Open ${esc(e.full_name)}">
          <div class="ocmp-name">${esc(e.full_name)}</div>
          <div class="ocmp-pos">${esc(e.position||"—")}</div>
          ${nkids?`<div class="ocmp-badge">${nkids} report${nkids!==1?"s":""}</div>`:""}
          ${String(e.position||"").trim()?`<div class="oc-jd-map" data-idx="${EMPLOYEES.indexOf(e)}" title="View job description" style="margin-top:4px;font-size:10px;font-weight:700;color:#1F6B52;cursor:pointer;">📋 JD</div>`:""}
        </div>`;
      // Build a department's reporting sub-tree (dept-scoped): supervisors → their reports.
      // If no supervisors are set, every staff member is a leaf hanging directly under the department.
      const buildDeptTree=(staff)=>{
        const emailIn={}; staff.forEach(e=>{ if(e.email) emailIn[String(e.email).toLowerCase()]=e; });
        const kidsOf={};
        staff.forEach(e=>{ const se=String(e.supervisor_email||"").toLowerCase(); if(se && emailIn[se] && emailIn[se]!==e){ (kidsOf[se]=kidsOf[se]||[]).push(e); } });
        const hasSup=e=>{ const se=String(e.supervisor_email||"").toLowerCase(); return !!(se && emailIn[se] && emailIn[se]!==e); };
        const roots=staff.filter(e=>!hasSup(e)).slice().sort(byName); // report directly to the department
        const visited=new Set();
        const node=(e)=>{
          if(visited.has(e)) return ""; visited.add(e);
          const kids=(kidsOf[String(e.email||"").toLowerCase()]||[]).slice().sort(byName);
          return `<li>${mapPersonBox(e,kids.length)}${kids.length?`<ul>${kids.map(node).join("")}</ul>`:""}</li>`;
        };
        return roots.map(node).join("");
      };
      // which departments to show (all, or those matching the search)
      const mapDepts = q ? depts.filter(d=> d.toLowerCase().includes(q) || ACT.some(e=>(e.department||"").trim()===d && match(e))) : depts;
      const deptLis = mapDepts.map(d=>{
        const all=ACT.filter(e=>(e.department||"").trim()===d);
        const staff = q ? all.filter(match) : all;   // when searching, only matching people show under the dept
        const headName=deptHeadName(d);
        const expanded = q ? true : ocMapOpen.has(d); // auto-expand matched depts while searching
        let sub="";
        if(expanded){
          const t=buildDeptTree(staff);
          sub=`<ul>${t||`<li><div class="oc-map-empty">No staff${q?" match":""}</div></li>`}</ul>`;
        }
        return `<li><div class="oc-map-dept${expanded?" exp":""}" data-dept="${esc(d)}">
            <div class="ocmd-name">${esc(d)}</div>
            <div class="ocmd-head">${headName?"Head: "+esc(headName):`<span class="ocmd-nohead">— no head —</span>`}</div>
            <div class="ocmd-count">${all.length} staff${q&&staff.length!==all.length?" · "+staff.length+" match":""} <span class="ocmd-caret">${expanded?"▾":"▸"}</span></div>
          </div>${sub}</li>`;
      }).join("");
      body.innerHTML=MAP_CSS+`<div class="psub" style="margin-bottom:6px;">Top-down org map — click a department to expand its people; click any person to open their record.${q?"":" Scroll sideways to see all departments."}</div>
        <div style="overflow-x:auto;padding:6px 2px 18px;">
          <ul class="octree"><li>
            <div class="oc-map-root"><div class="ocmr-name">Roshan Commercial Corporation</div><div class="ocmr-sub">${ACT.length} active staff · ${depts.length} departments</div></div>
            ${deptLis?`<ul>${deptLis}</ul>`:`<div class="oc-map-empty" style="margin-top:14px;">No departments match “${esc(q)}”.</div>`}
          </li></ul>
        </div>`;
    } else {
      // reporting-line tree
      const byName=(a,b)=>(a.full_name||"").localeCompare(b.full_name||"");
      if(q){
        const hits=ACT.filter(match).sort(byName);
        body.innerHTML=`<div class="panel" style="margin-top:0;"><div style="font-size:12px;color:#6b7785;margin-bottom:6px;">${hits.length} matching · showing flat list (clear search to see the tree)</div>${hits.map(e=>{
          const sup=e.supervisor_name||resolveName(e.supervisor_email)||"—";
          return personRow(e,` <span style="color:#6b7785;font-size:11.5px;">· ${esc(e.department||"—")} · ↳ ${esc(sup)}</span>`);
        }).join("")||`<div class="psub">No one matches.</div>`}</div>`;
      } else {
        const roots=ACT.filter(e=>hasKids(e) && !resolvableSup(e)).sort(byName);
        const visited=new Set();
        const treeHtml=(e,depth)=>{
          if(visited.has(e)) return ""; visited.add(e);
          const kids=(childrenOf[String(e.email||"").toLowerCase()]||[]).slice().sort(byName);
          const badge=kids.length?` <span class="pill di" style="font-size:10px;">${kids.length} report${kids.length!==1?"s":""}</span>`:"";
          let h=`<div style="margin-left:${depth*22}px;border-left:${depth?"2px solid #e3ece6":"none"};padding-left:${depth?10:0}px;">`+personRow(e,badge)+`</div>`;
          h+=kids.map(k=>treeHtml(k,depth+1)).join("");
          return h;
        };
        const treeRows=roots.map(r=>treeHtml(r,0)).join("");
        const leftover=ACT.filter(e=>!visited.has(e)).sort(byName); // no boss & no reports (or unresolved supervisor)
        body.innerHTML=`<div class="panel" style="margin-top:0;margin-bottom:12px;">
            <div style="font-size:12px;color:#6b7785;margin-bottom:6px;">${roots.length} top-level supervisor${roots.length!==1?"s":""} · nested by reporting line</div>
            ${treeRows||`<div class="psub">No reporting lines are set yet — fill the Supervisor field on employee records.</div>`}
          </div>
          ${leftover.length?`<div class="panel" style="margin-top:0;">
            <div style="font-size:14px;font-weight:800;color:#12352a;">Unassigned / flat <span class="pill di">${leftover.length}</span></div>
            <div style="font-size:12px;color:#6b7785;margin-bottom:6px;">No supervisor set and no direct reports — not yet placed in the tree.</div>
            ${leftover.map(e=>personRow(e,e.supervisor_name?` <span style="color:#8a5a1c;font-size:11px;">· supervisor “${esc(e.supervisor_name)}” not in roster</span>`:"")).join("")}
          </div>`:""}`;
      }
    }
    $$("#ocBody .oc-person").forEach(el=>el.addEventListener("click",()=>openRecord(EMPLOYEES[+el.dataset.idx])));
    $$("#ocBody .oc-dept-h").forEach(el=>el.addEventListener("click",()=>{ const d=el.dataset.dept; if(ocExpanded.has(d)) ocExpanded.delete(d); else ocExpanded.add(d); paint(); }));
    // Map lens: person box → open record; department box → toggle its sub-tree (accordion allows multiple open).
    $$("#ocBody .oc-map-person").forEach(el=>el.addEventListener("click",()=>openRecord(EMPLOYEES[+el.dataset.idx])));
    $$("#ocBody .oc-map-dept").forEach(el=>el.addEventListener("click",()=>{ const d=el.dataset.dept; if(ocMapOpen.has(d)) ocMapOpen.delete(d); else ocMapOpen.add(d); paint(); }));
    // JD links (all lenses) → open the position's Job Description; stop propagation so the row's open-record click doesn't also fire.
    $$("#ocBody .oc-jd, #ocBody .oc-jd-map").forEach(el=>el.addEventListener("click",ev=>{ ev.stopPropagation(); const e=EMPLOYEES[+el.dataset.idx]; if(e) openPositionProfile(e.position, e.department); }));
    // Inline org-structure editing (editors only) — stop propagation so we don't toggle the card / open the record.
    $$("#ocBody .oc-sethead").forEach(el=>el.addEventListener("click",ev=>{ ev.stopPropagation(); ocSetDeptHead(el.dataset.dept); }));
    $$("#ocBody .oc-setsup").forEach(el=>el.addEventListener("click",ev=>{ ev.stopPropagation(); ocSetSupervisor(EMPLOYEES[+el.dataset.idx]); }));
  };
  const setLens=(v)=>{ lens=v;
    $("#ocByDept").style.background=v==="dept"?"#1F6B52":""; $("#ocByDept").style.color=v==="dept"?"#fff":"";
    $("#ocByTree").style.background=v==="tree"?"#1F6B52":""; $("#ocByTree").style.color=v==="tree"?"#fff":"";
    $("#ocByMap").style.background=v==="map"?"#1F6B52":""; $("#ocByMap").style.color=v==="map"?"#fff":"";
    paint();
  };
  $("#ocByDept").addEventListener("click",()=>setLens("dept"));
  $("#ocByTree").addEventListener("click",()=>setLens("tree"));
  $("#ocByMap").addEventListener("click",()=>setLens("map"));
  $("#ocSearch").addEventListener("input",paint);
  paint();
}
window.renderOrgChart=renderOrgChart;
window.openRecord=openRecord;

/* ---- Org Chart inline editing (editors only): pick an employee, then assign a dept head / supervisor ---- */
// Reusable employee picker modal (mirrors pickEmployeeForExit). onChoose gets the employee, or null when cleared.
function ocPickEmployee(title, opts, onChoose){
  opts=opts||{};
  const list=EMPLOYEES.slice().sort((a,b)=>(a.full_name||"").localeCompare(b.full_name||""));
  let m=document.getElementById("ocPick"); if(!m){ m=document.createElement("div"); m.id="ocPick"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:10002;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;max-height:80vh;overflow-y:auto;padding:22px;">
    <h2 style="color:#1F6B52;font-size:17px;margin:0 0 2px;">${esc(title)}</h2>
    <div class="psub">Search and pick a person:</div>
    <input id="ocPickSearch" class="search" style="width:100%;margin:10px 0;" placeholder="Search name, position…">
    ${opts.allowClear?`<button class="btn ghost" id="ocPickClear" style="width:100%;margin-bottom:8px;color:#a12;border-color:#e9b9b9;">${esc(opts.clearLabel||"Clear")}</button>`:""}
    <div id="ocPickList"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn ghost" id="ocPickClose">Close</button></div>
  </div>`;
  const paint=()=>{ const q=(($("#ocPickSearch")||{}).value||"").toLowerCase();
    $("#ocPickList").innerHTML=list.filter(e=>[e.full_name,e.position,e.department,e.worksite].filter(Boolean).join(" ").toLowerCase().includes(q)).slice(0,50)
      .map(e=>`<div class="task clickable" data-id="${esc(String(e.id))}"><div class="dot a"></div><div><div class="tt">${esc(e.full_name)}</div><div class="td">${esc(e.position||"—")} · ${esc(e.department||e.worksite||"—")}</div></div></div>`).join("")||`<div class="psub">No one matches.</div>`;
    $$("#ocPickList .task.clickable").forEach(el=>el.addEventListener("click",()=>{ const emp=EMPLOYEES.find(e=>String(e.id)===el.dataset.id); m.remove(); onChoose(emp); }));
  };
  $("#ocPickSearch").addEventListener("input",paint); paint();
  const cl=$("#ocPickClear"); if(cl) cl.addEventListener("click",()=>{ m.remove(); onChoose(null); });
  $("#ocPickClose").addEventListener("click",()=>m.remove());
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
}
// Assign the head of a department → upsert department_heads (HRIS-owned org structure).
async function ocSetDeptHead(dept){
  if(!canEditOrg()||!dept) return;
  ocPickEmployee("Set head of "+dept, {}, async(emp)=>{
    if(!emp) return;
    const { error } = await sb.from("department_heads").upsert({
      department:dept, head_employee_id:emp.id, head_name:emp.full_name, head_email:emp.email||null,
      updated_by:(CURRENT_USER&&CURRENT_USER.email)||null, updated_at:new Date().toISOString()
    }, { onConflict:"department" });
    if(error){ alert("Could not set department head: "+error.message); return; }
    await logChange("orgchart", null, dept, "Set department head", emp.full_name);
    await loadEmployees();
  });
}
// Set / replace / clear a person's supervisor → updates the employee row (supervisor_* is HRIS-owned, not synced from PayPlus).
async function ocSetSupervisor(person){
  if(!canEditOrg()||!person) return;
  const hasSup=!!(String(person.supervisor_name||"").trim()||String(person.supervisor_email||"").trim());
  ocPickEmployee("Supervisor for "+(person.full_name||""),
    { allowClear:hasSup, clearLabel:"✕ Clear supervisor"+(person.supervisor_name?" (now: "+person.supervisor_name+")":"") },
    async(emp)=>{
      if(emp && String(emp.id)===String(person.id)){ alert("A person can't be their own supervisor."); return; }
      const patch = emp ? { supervisor_name:emp.full_name, supervisor_email:emp.email||null } : { supervisor_name:null, supervisor_email:null };
      const { error } = await sb.from("employees").update(patch).eq("id", person.id);
      if(error){ alert("Could not update supervisor: "+error.message); return; }
      await logChange("orgchart", person.id, person.full_name, emp?"Set supervisor":"Cleared supervisor", emp?emp.full_name:"");
      await loadEmployees();
    });
}
window.ocSetDeptHead=ocSetDeptHead;
window.ocSetSupervisor=ocSetSupervisor;

/* ================= POSITIONS & JOB DESCRIPTIONS =================
   Per-position Job Description · Key Tasks · Deliverables · Reports-To. Fill ONCE per role
   (position+department pair) and it applies to everyone in that role. The list of roles is
   derived live from active EMPLOYEES (PayPlus roster); the JD content is HRIS-owned
   (position_profiles). Everyone logged-in VIEWS; only admins + Rhel (canEditOrg) edit. */
function posKey(pos,dept){ return String(pos||"").trim().toLowerCase()+"||"+String(dept||"").trim().toLowerCase(); }
function positionProfileFor(pos,dept){ const k=posKey(pos,dept); return POSITION_PROFILES.find(p=>posKey(p.position,p.department)===k)||null; }
function positionHasJD(p){ if(!p) return false; const t=x=>String(x||"").trim(); const arr=x=>Array.isArray(x)?x.filter(v=>t(v)):[]; return !!(t(p.job_description) || arr(p.key_tasks).length || arr(p.deliverables).length); }
// Distinct (position, department) pairs across ACTIVE staff, with headcount + matching profile.
function positionPairs(){
  const ACT=EMPLOYEES.filter(e=>(e.status||"").toLowerCase().startsWith("active") && String(e.position||"").trim());
  const map={};
  ACT.forEach(e=>{ const pos=String(e.position).trim(), dept=String(e.department||"").trim(); const k=posKey(pos,dept);
    if(!map[k]) map[k]={ position:pos, department:dept, people:[] };
    map[k].people.push(e); });
  return Object.values(map).map(r=>({ ...r, headcount:r.people.length, profile:positionProfileFor(r.position,r.department) }));
}
let posSearch="";
function renderPositions(){
  const pg=$("#page-positions"); if(!pg) return;
  const canEdit=canEditOrg();
  const pairs=positionPairs();
  const filled=pairs.filter(p=>positionHasJD(p.profile));
  const coveredStaff=filled.reduce((s,p)=>s+p.headcount,0);
  const totalStaff=pairs.reduce((s,p)=>s+p.headcount,0);
  const q=posSearch.trim().toLowerCase();
  const shown=pairs.filter(p=> !q || [p.position,p.department].filter(Boolean).join(" ").toLowerCase().includes(q))
    .sort((a,b)=> b.headcount-a.headcount || a.position.localeCompare(b.position) || a.department.localeCompare(b.department));
  const rows=shown.map(p=>{
    const jd=positionHasJD(p.profile);
    const status=jd?`<span class="pill" style="background:#e4f3ea;color:#155e3f;border:1px solid #bfe0cc;">JD ✓</span>`
                   :`<span class="pill" style="background:#eceff1;color:#8a6a14;border:1px solid #ecd9a6;">— not filled</span>`;
    return `<tr class="pos-row clickable" data-key="${esc(posKey(p.position,p.department))}" style="cursor:pointer;">
      <td><b style="color:#12352a;">${esc(p.position)}</b></td>
      <td>${p.department?esc(p.department):'<span class="note">—</span>'}</td>
      <td style="text-align:center;">${p.headcount}</td>
      <td>${status}</td></tr>`;
  }).join("");
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Positions &amp; Job Descriptions</h2>
      <div class="psub">Job descriptions, key tasks, and deliverables per position. Fill once — applies to everyone in that role. ${canEdit?"Admins/Rhel can edit.":"Read-only for your role."} Roles are derived live from active staff (PayPlus roster); the JD content is HRIS-owned.</div>
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi"><div class="k-l">Distinct positions</div><div class="k-n">${pairs.length}</div><div class="k-s">position · department pairs</div></div>
        <div class="kpi ${filled.length?'':'warn'}"><div class="k-l">Positions with a JD</div><div class="k-n">${filled.length}</div><div class="k-s">${pairs.length-filled.length} still to fill</div></div>
        <div class="kpi"><div class="k-l">Staff covered by a JD</div><div class="k-n">${coveredStaff}</div><div class="k-s">of ${totalStaff} active in a role</div></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0 4px;">
        <input id="posSearch" class="search" style="flex:1;min-width:200px;" placeholder="Search position or department…" value="${esc(posSearch)}">
      </div>
      <table style="margin-top:8px;"><thead><tr><th>Position</th><th>Department</th><th style="text-align:center;">Headcount</th><th>Job description</th></tr></thead>
        <tbody>${rows||`<tr><td colspan="4"><div class="psub" style="padding:8px 0;">No positions match “${esc(posSearch)}”.</div></td></tr>`}</tbody></table>
    </div>`;
  const s=$("#posSearch"); if(s){ s.addEventListener("input",()=>{ posSearch=s.value; renderPositions(); const el=$("#posSearch"); if(el){ el.focus(); const v=el.value.length; el.setSelectionRange(v,v); } }); }
  $$("#page-positions .pos-row").forEach(el=>el.addEventListener("click",()=>{
    const pair=pairs.find(p=>posKey(p.position,p.department)===el.dataset.key);
    if(pair) openPositionProfile(pair.position, pair.department);
  }));
}
window.renderPositions=renderPositions;

// Drawer — one position's full JD, the people in the role, and (editors) an Edit button.
function openPositionProfile(position, department){
  const canEdit=canEditOrg();
  const prof=positionProfileFor(position,department);
  const people=EMPLOYEES.filter(e=>(e.status||"").toLowerCase().startsWith("active") && String(e.position||"").trim().toLowerCase()===String(position||"").trim().toLowerCase() && String(e.department||"").trim().toLowerCase()===String(department||"").trim().toLowerCase())
    .sort((a,b)=>(a.full_name||"").localeCompare(b.full_name||""));
  const tasks=Array.isArray(prof&&prof.key_tasks)?prof.key_tasks.filter(t=>String(t||"").trim()):[];
  const delivs=Array.isArray(prof&&prof.deliverables)?prof.deliverables.filter(t=>String(t||"").trim()):[];
  const hasJD=positionHasJD(prof);
  const peopleHtml=people.length?people.map(e=>`<span class="pos-person clickable" data-idx="${EMPLOYEES.indexOf(e)}" style="display:inline-block;background:#eef4f0;border:1px solid #d6e3db;border-radius:20px;padding:3px 11px;margin:0 6px 6px 0;font-size:12.5px;color:#155e3f;cursor:pointer;">${esc(e.full_name)}</span>`).join(""):`<span class="note">No active staff in this role.</span>`;
  let m=document.getElementById("posDrawer"); if(!m){ m=document.createElement("div"); m.id="posDrawer"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  const sec=(title,body)=>`<div class="panel"><div class="subhead">${esc(title)}</div>${body}</div>`;
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:600px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#123528,#1F6B52);color:#fff;padding:18px 22px;position:sticky;top:0;z-index:2;">
      <div style="font-size:20px;font-weight:800;">${esc(position)}</div>
      <div style="font-size:12.5px;opacity:.9;">${esc(department||"No department")} · ${people.length} in this role</div>
    </div>
    <div style="padding:16px 20px 70px;">
      <div class="panel" style="margin-top:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <h2 style="margin:0;">Job description</h2>
          ${canEdit?`<button class="btn" id="posEdit">✎ Edit</button>`:""}
        </div>
        <div class="subhead" style="margin-top:10px;">People in this role <span class="sh-note">${people.length}</span></div>
        <div style="margin-top:6px;">${peopleHtml}</div>
      </div>
      ${!hasJD?`<div class="panel"><div class="psub">No job description yet.${canEdit?" Click <b>✎ Edit</b> above to fill it in.":""}</div></div>`:`
        ${sec("Job Description", `<div class="psub" style="white-space:pre-wrap;">${prof.job_description?esc(prof.job_description):'<span class="note">—</span>'}</div>`)}
        ${sec("Key Tasks", tasks.length?`<ol style="margin:2px 0 0;padding-left:20px;font-size:13px;color:#2c3b33;line-height:1.6;">${tasks.map(t=>`<li>${esc(t)}</li>`).join("")}</ol>`:`<div class="psub"><span class="note">—</span></div>`)}
        ${sec("Deliverables", delivs.length?`<ul style="margin:2px 0 0;padding-left:20px;font-size:13px;color:#2c3b33;line-height:1.6;">${delivs.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`:`<div class="psub"><span class="note">—</span></div>`)}
        ${sec("Reports To", `<div class="psub">${prof.reports_to?esc(prof.reports_to):'<span class="note">—</span>'}</div>`)}
        <div class="psub" style="margin-top:6px;color:#6b7785;">${prof.updated_by?"Last updated by "+esc(prof.updated_by)+(prof.updated_at?" · "+fmtDate(prof.updated_at):""):""}</div>`}
      <div style="display:flex;gap:10px;margin-top:6px;">
        <button class="btn ghost" id="posDrawerClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  $("#posDrawerClose").onclick=()=>m.remove();
  const eb=$("#posEdit"); if(eb) eb.onclick=()=>openPositionForm(position, department, prof);
  $$("#posDrawer .pos-person").forEach(el=>el.addEventListener("click",()=>{ m.remove(); openRecord(EMPLOYEES[+el.dataset.idx]); }));
}
window.openPositionProfile=openPositionProfile;

// Form — editors only. Upsert the JD on the (position, department) unique key.
function openPositionForm(position, department, existing){
  if(!canEditOrg()) return;
  const p=existing||{};
  const tasksTxt=Array.isArray(p.key_tasks)?p.key_tasks.filter(t=>String(t||"").trim()).join("\n"):"";
  const delivTxt=Array.isArray(p.deliverables)?p.deliverables.filter(t=>String(t||"").trim()).join("\n"):"";
  let m=document.getElementById("posForm"); if(!m){ m=document.createElement("div"); m.id="posForm"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:10001;background:rgba(14,30,50,.55);display:flex;align-items:center;justify-content:center;padding:20px;";
  const fld="width:100%;padding:9px 11px;border:1px solid var(--line,#dbe4dd);border-radius:8px;background:#fff;font-size:13px;font-family:inherit;box-sizing:border-box;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:92vh;overflow-y:auto;padding:22px;">
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1.4px;color:#1F6B52;">POSITION · JOB DESCRIPTION</div>
    <div style="font-size:18px;font-weight:800;color:#12352a;margin:2px 0 1px;">${esc(position)}</div>
    <div class="psub" style="margin-bottom:12px;">${esc(department||"No department")} · fill once — applies to everyone in this role.</div>
    <label class="el" style="display:block;margin:0 0 4px;">Job Description</label>
    <textarea id="pfJD" rows="4" style="${fld}" placeholder="Purpose and scope of the role…">${esc(p.job_description||"")}</textarea>
    <label class="el" style="display:block;margin:12px 0 4px;">Key Tasks <span class="note" style="font-weight:400;">— one per line</span></label>
    <textarea id="pfTasks" rows="6" style="${fld}" placeholder="Open and merchandise the store&#10;Submit the daily sales report&#10;…">${esc(tasksTxt)}</textarea>
    <label class="el" style="display:block;margin:12px 0 4px;">Deliverables <span class="note" style="font-weight:400;">— one per line</span></label>
    <textarea id="pfDeliv" rows="4" style="${fld}" placeholder="Daily sales report&#10;Monthly inventory count&#10;…">${esc(delivTxt)}</textarea>
    <label class="el" style="display:block;margin:12px 0 4px;">Reports To</label>
    <input id="pfReports" type="text" style="${fld}" placeholder="e.g. Store Coordinator" value="${esc(p.reports_to||"")}">
    <div id="pfMsg" style="font-size:12.5px;color:#a4322a;margin-top:8px;min-height:16px;"></div>
    <div style="display:flex;gap:10px;margin-top:8px;">
      <button class="btn ghost" id="pfCancel" style="margin-left:auto;">Cancel</button>
      <button class="btn" id="pfSave">Save job description</button>
    </div></div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  $("#pfCancel").onclick=()=>m.remove();
  $("#pfSave").onclick=async()=>{
    const toArr=v=>String(v||"").split("\n").map(x=>x.trim()).filter(Boolean);
    const jd=$("#pfJD").value.trim();
    const tasks=toArr($("#pfTasks").value);
    const delivs=toArr($("#pfDeliv").value);
    const reports=$("#pfReports").value.trim();
    const btn=$("#pfSave"); btn.disabled=true; btn.textContent="Saving…";
    const { error } = await sb.from("position_profiles").upsert({
      position:String(position).trim(), department:String(department||"").trim(),
      job_description:jd||null, key_tasks:tasks, deliverables:delivs, reports_to:reports||null,
      updated_by:(CURRENT_USER&&CURRENT_USER.email)||null, updated_at:new Date().toISOString()
    }, { onConflict:"position,department" });
    if(error){ $("#pfMsg").textContent="Could not save: "+error.message; btn.disabled=false; btn.textContent="Save job description"; return; }
    await logChange("position", null, position, "Updated JD", department||"");
    m.remove();
    await loadEmployees();
    openPositionProfile(position, department);
  };
}
window.openPositionForm=openPositionForm;

/* ================= CONCERNS & CASES — arbitration + ongoing legal matters (Director/owner only) ================= */
const CASE_TYPES=["SEnA (DOLE)","NLRC","Voluntary Arbitration","Internal Grievance","Civil","Criminal","Other"];
const CASE_STATUSES=["Open","Ongoing","Settled","Dismissed","Awarded","Withdrawn","Closed"];
function concernStatusPill(s){
  const map={ "Open":"warn", "Ongoing":"warn", "Settled":"active", "Dismissed":"", "Awarded":"danger", "Withdrawn":"", "Closed":"" };
  const cls=map[s]!=null?map[s]:"";
  const bg={ warn:"#fdf0d5;color:#8a6a14;border:1px solid #ecd9a6", active:"#e4f3ea;color:#155e3f;border:1px solid #bfe0cc", danger:"#f7dcdc;color:#8a1c1c;border:1px solid #e9b9b9", "":"#eceff1;color:#55606a;border:1px solid #d9dee2" }[cls];
  return `<span class="pill" style="background:${bg};">${esc(s||"—")}</span>`;
}
function caseTypePill(t){ return t?`<span class="pill" style="background:#e7edf6;color:#28425f;border:1px solid #c6d5e6;">${esc(t)}</span>`:""; }
function daysUntil(d){ if(!d) return null; const t=new Date(d); if(isNaN(t)) return null; const now=new Date(); const a=new Date(now.getFullYear(),now.getMonth(),now.getDate()); const b=new Date(t.getFullYear(),t.getMonth(),t.getDate()); return Math.round((b-a)/86400000); }
function hearingBadge(d){
  const n=daysUntil(d); if(n==null) return `<span style="color:var(--muted,#6b7785);">—</span>`;
  const dt=fmtDate(d);
  if(n<0)  return `<span style="color:#a12;font-weight:700;">${dt} · overdue ${-n}d</span>`;
  if(n===0)return `<span style="color:#a12;font-weight:700;">${dt} · today</span>`;
  if(n<=7) return `<span style="color:#8a6a14;font-weight:700;">${dt} · in ${n}d</span>`;
  return `<span>${dt} · in ${n}d</span>`;
}
function activeCases(){ return CONCERNS.filter(c=>c.status==="Open"||c.status==="Ongoing"); }
function renderConcerns(){
  const pg=$("#page-concerns"); if(!pg) return;
  if(!canSeeConcerns()){ pg.innerHTML=`<div class="panel" style="margin-top:0;"><div class="psub">Concerns &amp; Cases is restricted to the Director, HR Relations (Juvy) and the HR Manager (Rhel).</div></div>`; return; }
  const active=activeCases();
  const soon=CONCERNS.filter(c=>{ const n=daysUntil(c.next_hearing); return n!=null && n>=0 && n<=14 && c.status!=="Closed"&&c.status!=="Settled"&&c.status!=="Dismissed"&&c.status!=="Withdrawn"; });
  const exposure=active.reduce((s,c)=>s+(Number(c.exposure)||0),0);
  const sorted=CONCERNS.slice().sort((a,b)=>{
    const rank=s=>(s==="Open"||s==="Ongoing")?0:1;
    if(rank(a.status)!==rank(b.status)) return rank(a.status)-rank(b.status);
    const na=daysUntil(a.next_hearing), nb=daysUntil(b.next_hearing);
    if(na==null&&nb==null) return String(b.created_at||"").localeCompare(String(a.created_at||""));
    if(na==null) return 1; if(nb==null) return -1; return na-nb;
  });
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div><h2 style="margin:0;">Concerns &amp; Cases</h2>
          <div class="psub">Arbitration and ongoing legal/labor matters. For Anju Genomal, Juvy (HR Relations) and Rhel (HR Manager).</div></div>
        <button class="btn" id="cxNew">＋ New concern / case</button>
      </div>
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);margin-top:12px;">
        <div class="kpi ${active.length?"warn":""}"><div class="k-l">Open / Ongoing</div><div class="k-n">${active.length}</div></div>
        <div class="kpi ${soon.length?"warn":""}"><div class="k-l">Hearing ≤ 14 days</div><div class="k-n">${soon.length}</div></div>
        <div class="kpi"><div class="k-l">Exposure (active)</div><div class="k-n" style="font-size:20px;">${exposure?peso(exposure):"—"}</div></div>
      </div>
      <input id="cxSearch" class="search" style="width:100%;margin:12px 0 4px;" placeholder="Search case, employee, forum, counsel…">
      ${CONCERNS.length?`<table style="margin-top:6px;"><thead><tr><th>Case</th><th>Employee</th><th>Type</th><th>Status</th><th>Next hearing</th><th>Exposure</th></tr></thead>
        <tbody id="cxRows"></tbody></table><div id="cxCount" style="font-size:12px;color:var(--muted,#6b7785);margin-top:10px;"></div>`
      :`<div class="psub" style="margin-top:10px;">No cases logged yet — click “＋ New concern / case”.</div>`}
    </div>`;
  const bN=$("#cxNew"); if(bN) bN.addEventListener("click",()=>openConcernForm(null));
  const paint=()=>{
    const q=($("#cxSearch")?$("#cxSearch").value:"").trim().toLowerCase();
    const shown=sorted.filter(c=>!q || [c.title,c.employee_name,c.employee_number,c.forum,c.counsel,c.case_type,c.complainant].filter(Boolean).join(" ").toLowerCase().includes(q));
    const rows=$("#cxRows"); if(!rows) return;
    rows.innerHTML=shown.map(c=>`<tr class="clickable" data-cid="${esc(String(c.id))}">
      <td><b>${esc(c.title||"—")}</b>${c.forum?`<div class="esub">${esc(c.forum)}</div>`:""}</td>
      <td>${esc(c.employee_name||"—")}${c.employee_number?`<div class="esub">${esc(c.employee_number)}</div>`:""}</td>
      <td>${caseTypePill(c.case_type)}</td><td>${concernStatusPill(c.status)}</td>
      <td>${hearingBadge(c.next_hearing)}</td>
      <td>${c.exposure!=null&&c.exposure!==""?peso(Number(c.exposure)):"—"}</td></tr>`).join("");
    const cc=$("#cxCount"); if(cc) cc.textContent=`${shown.length} of ${CONCERNS.length} case${CONCERNS.length!==1?"s":""}`;
    $$("#cxRows tr.clickable").forEach(tr=>tr.addEventListener("click",()=>openConcern(CONCERNS.find(x=>String(x.id)===tr.dataset.cid))));
  };
  const s=$("#cxSearch"); if(s) s.addEventListener("input",paint); paint();
}
window.renderConcerns=renderConcerns;

function openConcern(c){
  if(!c) return;
  const kv=(k,val)=>`<div class="efield"><div class="el">${esc(k)}</div><div class="ev">${val}</div></div>`;
  let m=document.getElementById("cxDrawer"); if(!m){ m=document.createElement("div"); m.id="cxDrawer"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:620px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#3a1414,#6b1f1f);color:#fff;padding:18px 22px;position:sticky;top:0;z-index:2;">
      <div style="font-size:20px;font-weight:800;">${esc(c.title||"Case")}</div>
      <div style="font-size:12.5px;opacity:.92;">${esc(c.case_type||"—")}${c.forum?" · "+esc(c.forum):""}</div>
    </div>
    <div style="padding:16px 20px 70px;">
      <div class="panel" style="margin-top:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><h2 style="margin:0;">Case</h2>${concernStatusPill(c.status)}</div>
        <div class="egrid" style="margin-top:8px;">
          ${kv("Employee",esc(c.employee_name||"—")+(c.employee_number?` · ${esc(c.employee_number)}`:""))}
          ${kv("Complainant / filed by",esc(c.complainant||"—"))}
          ${kv("Type",esc(c.case_type||"—"))}
          ${kv("Forum / venue",esc(c.forum||"—"))}
          ${kv("Filed",c.filed_date?fmtDate(c.filed_date):"—")}
          ${kv("Next hearing",hearingBadge(c.next_hearing))}
          ${kv("Handling counsel",esc(c.counsel||"—"))}
          ${kv("Exposure",c.exposure!=null&&c.exposure!==""?peso(Number(c.exposure)):"—")}
        </div>
        ${(Array.isArray(c.attachments)&&c.attachments.length)?`<div style="margin-top:10px;"><div class="subhead" style="margin-bottom:4px;">Case files <span class="count-tag">${c.attachments.length}</span></div>${c.attachments.map(a=>`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📎 ${esc(a.name)}</span><button class="btn ghost" style="padding:3px 10px;font-size:12px;flex-shrink:0;" onclick="openLoanDoc('${esc(a.path)}',this)">View</button></div>`).join("")}</div>`:""}
        ${c.doc_url?`<div style="margin-top:8px;"><a class="btn ghost" href="${esc(c.doc_url)}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block;">Open case file link ↗</a></div>`:""}
      </div>
      ${c.summary?`<div class="panel"><div class="subhead">Nature of the case</div><div style="white-space:pre-wrap;font-size:13.5px;line-height:1.55;color:#22302a;">${esc(c.summary)}</div></div>`:""}
      ${c.timeline?`<div class="panel"><div class="subhead">Timeline / notes</div><div style="white-space:pre-wrap;font-size:13.5px;line-height:1.55;color:#22302a;">${esc(c.timeline)}</div></div>`:""}
      <div class="psub" style="margin-top:2px;">${c.updated_at?"Updated "+fmtDate(c.updated_at):(c.created_at?"Created "+fmtDate(c.created_at):"")}${c.created_by?" · "+esc(c.created_by):""}</div>
      <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;">
        <button class="btn" id="cxEdit">Edit</button>
        <button class="btn ghost" id="cxDel" style="color:#a12;border-color:#e9b9b9;">Delete</button>
        <button class="btn ghost" id="cxClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("cxClose").onclick=()=>m.remove();
  document.getElementById("cxEdit").onclick=()=>{ m.remove(); openConcernForm(c); };
  document.getElementById("cxDel").onclick=()=>deleteConcern(c);
}
window.openConcern=openConcern;

function openConcernForm(c){
  const isNew=!c; c=c||{};
  const opt=(arr,sel)=>arr.map(v=>`<option value="${esc(v)}"${v===sel?" selected":""}>${esc(v)}</option>`).join("");
  const empList=[...new Set((EMPLOYEES||[]).map(e=>e.full_name).filter(Boolean))].sort();
  let m=document.getElementById("cxForm"); if(!m){ m=document.createElement("div"); m.id="cxForm"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:10001;background:rgba(14,30,20,.55);display:flex;align-items:center;justify-content:center;padding:20px;";
  const fld=(label,inner)=>`<div style="margin-bottom:10px;"><div style="font-size:11.5px;font-weight:700;color:#4a5560;margin-bottom:3px;">${label}</div>${inner}</div>`;
  const inp=(id,val,ph,type)=>`<input id="${id}" ${type?`type="${type}"`:""} value="${val!=null?esc(String(val)):""}" placeholder="${ph||""}" style="width:100%;padding:8px 10px;border:1px solid #cdd6cf;border-radius:8px;font-size:13.5px;">`;
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:92vh;overflow-y:auto;padding:22px;">
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1.6px;color:#8a1c1c;">${isNew?"NEW":"EDIT"} CONCERN / CASE</div>
    <div style="font-size:18px;font-weight:800;color:#3a1414;margin:2px 0 10px;">${isNew?"Log a new case":esc(c.title||"Edit case")}</div>
    ${fld("Case title *",inp("cxfTitle",c.title,"e.g. Dela Cruz — illegal dismissal (NLRC)"))}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${fld("Employee name",`<input id="cxfEmp" list="cxfEmpList" value="${c.employee_name?esc(c.employee_name):""}" placeholder="Search employee…" style="width:100%;padding:8px 10px;border:1px solid #cdd6cf;border-radius:8px;font-size:13.5px;"><datalist id="cxfEmpList">${empList.map(n=>`<option value="${esc(n)}"></option>`).join("")}</datalist>`)}
      ${fld("Employee no.",inp("cxfEmpNo",c.employee_number,"optional"))}
    </div>
    ${fld("Complainant / filed by",inp("cxfComplainant",c.complainant,"if different from the employee"))}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${fld("Type",`<select id="cxfType" style="width:100%;padding:8px 10px;border:1px solid #cdd6cf;border-radius:8px;font-size:13.5px;"><option value="">—</option>${opt(CASE_TYPES,c.case_type)}</select>`)}
      ${fld("Status",`<select id="cxfStatus" style="width:100%;padding:8px 10px;border:1px solid #cdd6cf;border-radius:8px;font-size:13.5px;">${opt(CASE_STATUSES,c.status||"Open")}</select>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${fld("Filed date",inp("cxfFiled",c.filed_date,"","date"))}
      ${fld("Next hearing",inp("cxfHearing",c.next_hearing,"","date"))}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${fld("Forum / venue",inp("cxfForum",c.forum,"e.g. NLRC-NCR, DOLE field office"))}
      ${fld("Handling counsel",inp("cxfCounsel",c.counsel,"lawyer / firm"))}
    </div>
    ${fld("Monetary exposure (₱)",inp("cxfExposure",c.exposure,"estimated claim / potential award","number"))}
    ${fld("Nature of the case",`<textarea id="cxfSummary" rows="3" placeholder="What the case is about" style="width:100%;padding:8px 10px;border:1px solid #cdd6cf;border-radius:8px;font-size:13.5px;">${c.summary?esc(c.summary):""}</textarea>`)}
    ${fld("Timeline / notes",`<textarea id="cxfTimeline" rows="4" placeholder="Running log — conferences, submissions, orders received…" style="width:100%;padding:8px 10px;border:1px solid #cdd6cf;border-radius:8px;font-size:13.5px;">${c.timeline?esc(c.timeline):""}</textarea>`)}
    ${fld("Upload case files (complaint, orders, submissions…)",`
      <input type="file" id="cxfFile" multiple style="font-size:12.5px;">
      <div id="cxfFileList" style="margin-top:6px;"></div>`)}
    ${fld("Case file link (Drive/Dropbox) — optional",inp("cxfDoc",c.doc_url,"optional URL"))}
    <div id="cxfMsg" style="color:#a12;font-size:12.5px;min-height:16px;margin:2px 0;"></div>
    <div style="display:flex;gap:10px;margin-top:6px;">
      <button class="btn" id="cxfSave">${isNew?"Log case":"Save changes"}</button>
      <button class="btn ghost" id="cxfCancel" style="margin-left:auto;">Cancel</button>
    </div>
  </div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("cxfCancel").onclick=()=>m.remove();
  // ── Case-file attachments — upload to the shared docs bucket, keep a jsonb list on the case ──
  let cxAttach = Array.isArray(c.attachments)?c.attachments.slice():[];
  const caseKey = c.id || ("new-"+Math.random().toString(36).slice(2,9));
  const renderAttach=()=>{ const w=document.getElementById("cxfFileList"); if(!w) return;
    w.innerHTML = cxAttach.length ? cxAttach.map((a,i)=>`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12.5px;"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📎 ${esc(a.name)}</span><button type="button" class="btn ghost" data-axr="${i}" style="padding:2px 8px;font-size:11.5px;flex-shrink:0;">Remove</button></div>`).join("") : `<div class="psub">No files attached yet.</div>`;
    w.querySelectorAll("[data-axr]").forEach(b=>b.onclick=()=>{ cxAttach.splice(+b.dataset.axr,1); renderAttach(); });
  };
  renderAttach();
  const fInput=document.getElementById("cxfFile");
  if(fInput) fInput.onchange=async()=>{
    const files=[...fInput.files]; if(!files.length) return;
    const msg=document.getElementById("cxfMsg"); const setMsg=(t,c)=>{ if(msg){ msg.style.color=c||"#4a5560"; msg.textContent=t; } };
    for(const f of files){
      if(f.size>25*1024*1024){ setMsg(`“${f.name}” is over 25 MB — please attach a smaller file or a link.`, "#a12"); continue; }
      setMsg("Uploading "+f.name+"…");
      const path=`concerns/${caseKey}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g,"_")}`;
      const {error:upErr}=await sb.storage.from("loan-docs").upload(path,f,{upsert:true});
      if(upErr){ setMsg("Upload failed: "+upErr.message, "#a12"); continue; }
      cxAttach.push({name:f.name, path, uploaded_at:new Date().toISOString(), uploaded_by:(CURRENT_USER&&CURRENT_USER.email)||null});
    }
    setMsg(""); fInput.value=""; renderAttach();
  };
  document.getElementById("cxfSave").onclick=()=>saveConcern(c,isNew,cxAttach);
}
window.openConcernForm=openConcernForm;

async function saveConcern(c,isNew,attachments){
  const val=id=>{ const el=document.getElementById(id); return el?el.value.trim():""; };
  const title=val("cxfTitle");
  const msg=document.getElementById("cxfMsg");
  if(!title){ if(msg) msg.textContent="A case title is required."; return; }
  const exposureRaw=val("cxfExposure");
  const payload={
    title,
    employee_name:val("cxfEmp")||null,
    employee_number:val("cxfEmpNo")||null,
    complainant:val("cxfComplainant")||null,
    case_type:val("cxfType")||null,
    status:val("cxfStatus")||"Open",
    filed_date:val("cxfFiled")||null,
    next_hearing:val("cxfHearing")||null,
    forum:val("cxfForum")||null,
    counsel:val("cxfCounsel")||null,
    exposure:exposureRaw!==""?Number(exposureRaw):null,
    summary:val("cxfSummary")||null,
    timeline:val("cxfTimeline")||null,
    doc_url:val("cxfDoc")||null,
    attachments:Array.isArray(attachments)?attachments:[],
    updated_at:new Date().toISOString(),
    updated_by:(CURRENT_USER&&CURRENT_USER.email)||null
  };
  const btn=document.getElementById("cxfSave"); if(btn){ btn.disabled=true; btn.textContent="Saving…"; }
  let error;
  if(isNew){ payload.created_by=(CURRENT_USER&&CURRENT_USER.email)||null; payload.created_at=new Date().toISOString(); ({ error }=await sb.from("concerns").insert(payload)); }
  else { ({ error }=await sb.from("concerns").update(payload).eq("id",c.id)); }
  if(error){ if(msg) msg.textContent="Could not save: "+error.message; if(btn){ btn.disabled=false; btn.textContent=isNew?"Log case":"Save changes"; } return; }
  try{ await logChange("concern", isNew?null:c.id, title, isNew?"Case logged":"Case updated", payload.status); }catch(_){}
  const fm=document.getElementById("cxForm"); if(fm) fm.remove();
  await loadConcerns(); renderConcerns();
}
window.saveConcern=saveConcern;

async function deleteConcern(c){
  if(!c||!c.id) return;
  if(!confirm(`Delete the case “${c.title||""}”? This cannot be undone.`)) return;
  const { error }=await sb.from("concerns").delete().eq("id",c.id);
  if(error){ alert("Could not delete: "+error.message); return; }
  try{ await logChange("concern", c.id, c.title||"", "Case deleted", ""); }catch(_){}
  const d=document.getElementById("cxDrawer"); if(d) d.remove();
  await loadConcerns(); renderConcerns();
}
window.deleteConcern=deleteConcern;

async function loadConcerns(){
  const { data }=await sb.from("concerns").select("*").order("created_at",{ascending:false});
  CONCERNS=data||[];
}

/* ================= LINKS TO SEND — one hub for every self-service / share link, named by purpose ================= */
function lkRow(purpose, who, url, opts){
  opts=opts||{};
  const tag=opts.tag?` <span class="pill ${opts.tagCls||'di'}" style="font-size:9.5px;">${esc(opts.tag)}</span>`:'';
  const right = url
    ? `<button class="btn ghost lk-copy" data-copy="${esc(url)}" style="flex-shrink:0;padding:5px 12px;font-size:12px;">Copy</button>
       <a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener" style="flex-shrink:0;padding:5px 12px;font-size:12px;text-decoration:none;">Open</a>`
    : opts.mkSc
      ? `<button class="btn ghost lk-mksc" data-sc="${esc(opts.mkSc)}" style="flex-shrink:0;padding:5px 12px;font-size:12px;">Create link</button>`
      : opts.goto
        ? `<button class="btn ghost lk-go" data-go="${esc(opts.goto)}" style="flex-shrink:0;padding:5px 12px;font-size:12px;">${esc(opts.gotoLabel||'Open module')}</button>`
        : '';
  return `<div class="lk-row" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line,#e4eae6);flex-wrap:wrap;">
    <div style="flex:1;min-width:190px;">
      <div style="font-size:13.5px;font-weight:700;color:#12352a;">${esc(purpose)}${tag}</div>
      <div style="font-size:11.5px;color:var(--muted,#6b7785);">${who}</div>
    </div>${right}</div>`;
}
function lkGroup(title, sub, rowsHtml){
  return `<div class="panel lk-group">
    <div style="font-size:15px;font-weight:800;color:#12352a;">${esc(title)}</div>
    ${sub?`<div class="psub" style="margin:2px 0 2px;">${sub}</div>`:''}
    ${rowsHtml}
  </div>`;
}
function renderLinks(){
  const pg=$("#page-links"); if(!pg) return;
  const recruit=[
    lkRow("Job application — open to anyone","Public. Post it anywhere; applicants apply themselves.", SHARE_BASE+"direct-apply.html"),
    lkRow("Agency intake — Jell-on","Private. Send ONLY to Jell-on — shows their placements under their name.", SHARE_BASE+"agency.html?t=3a28000c77be400f97c1d2e36c9b416e",{tag:"private",tagCls:"ag"}),
    lkRow("Agency intake — M&G","Private. Send ONLY to M&amp;G.", SHARE_BASE+"agency.html?t=60fc360932f049dd851131dccbd185af",{tag:"private",tagCls:"ag"}),
    lkRow("Candidate experience survey","Send to an applicant after their interview / decision.", SHARE_BASE+"feedback.html")
  ].join("");
  const services=[
    lkRow("Employee loan application","Public. Head Office &amp; Warehouse staff apply + upload documents.", LOAN_APPLY_URL),
    lkRow("Merchandiser meeting sign-in","Show the QR or send the link on meeting day (locks to venue Wi-Fi).", MEETING_SIGNIN_URL)
  ].join("");
  const scs=[...new Set((BRANCHES||[]).map(b=>b.sc).filter(x=>x&&x!=='Unassigned'))].sort()
    .filter(sc=>!(SC_STATUS[sc]&&SC_STATUS[sc].status&&SC_STATUS[sc].status!=='Active'));  // don't offer send-links for coordinators who've left
  const scRows=scs.length ? scs.map(sc=>{
    const link=scLinkFor(sc);
    return link
      ? lkRow(`Store Transfer Request — ${sc}`, `Private. Only ${esc(sc)}'s own staff — they request a store move, the store head confirms.`, SHARE_BASE+"transfer-request.html?who="+encodeURIComponent(sc)+"&sc="+link.token, {tag:"per-SC",tagCls:"di"})
      : lkRow(`Store Transfer Request — ${sc}`, "No link yet — create one to send.", null, {mkSc:sc});
  }).join("") : `<div class="lk-row psub" style="border-top:1px solid var(--line,#e4eae6);padding-top:9px;">No Store Coordinators on file yet.</div>`;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Links to Send</h2>
      <div class="psub">Every self-service link in one place, named by what it's for. <b>Copy</b> a link, then paste it into email or WhatsApp. Links marked <b>private</b> are keyed to one person or partner — only send to that recipient.</div>
      <input id="lkSearch" class="search" style="width:100%;margin:10px 0 2px;" placeholder="Search links…">
    </div>
    <div id="lkBody">
      ${lkGroup("Recruitment", "Applicants and agencies.", recruit)}
      ${lkGroup("Employee services", "For current staff.", services)}
      ${lkGroup("Store transfers — one private link per Store Coordinator", "Send each SC their own link so they only request moves for their own staff.", scRows)}
    </div>`;
  $$("#page-links .lk-copy").forEach(b=>b.addEventListener("click",async()=>{ try{ await navigator.clipboard.writeText(b.dataset.copy); const t=b.textContent; b.textContent="Copied ✓"; setTimeout(()=>b.textContent=t,1200); }catch(_){ prompt("Copy this link:", b.dataset.copy); } }));
  $$("#page-links .lk-go").forEach(b=>b.addEventListener("click",()=>window.go(b.dataset.go)));
  $$("#page-links .lk-mksc").forEach(b=>b.addEventListener("click",async()=>{ b.disabled=true; b.textContent="Creating…"; await createScLinkForHub(b.dataset.sc); }));
  const s=$("#lkSearch"); if(s) s.addEventListener("input",()=>{
    const q=s.value.trim().toLowerCase();
    $$("#page-links .lk-row").forEach(r=>{ r.style.display=(!q||r.textContent.toLowerCase().includes(q))?'':'none'; });
    $$("#page-links .lk-group").forEach(g=>{ const vis=[...g.querySelectorAll('.lk-row')].some(r=>r.style.display!=='none'); g.style.display=(!q||vis)?'':'none'; });
  });
}
window.renderLinks=renderLinks;
async function createScLinkForHub(sc){
  const token=(crypto&&crypto.randomUUID?crypto.randomUUID():String(Math.random())).replace(/-/g,"");
  const { error }=await sb.from("sc_links").insert({ sc_name:sc, token });
  if(error){ alert(error.message); return; }
  await loadEmployees(); window.go("links");
}

/* ---------- MANNING / HEADCOUNT — grouped by Sales Coordinator ---------- */
/* ============================ SIGNATURES — sign-this inbox (RA 8792 prototype) ============================ */
const SIG_ICON={contract:"contract",advance:"advance",memo:"memo",coe:"contract",claim:"advance"};
const sigInitial=s=>((s.subject_name||s.doc_title||"?").trim()[0]||"?").toUpperCase();
function fmtAgo(d){ if(!d) return ""; const h=(Date.now()-new Date(d).getTime())/36e5; if(h<1) return "just now"; if(h<24) return Math.round(h)+"h ago"; const dd=Math.round(h/24); return dd+(dd===1?" day ago":" days ago"); }
// Director-approval items — final-pay quitclaims (and anything routed to the Director).
// Maker-checker: only an admin (Director: Anj / Sanjay) may sign these; they stay in the
// Director's inbox and never appear as signable to HR/managers.
function isDirectorItem(s){ return s && (s.doc_type==="claim" || /director/i.test(s.with_whom||"")); }
// Person-based routing: an item names ONE signer (signer_email). Only that person sees it
// as theirs to sign; nobody else's inbox shows it. The Director (admin) keeps an owner
// override so anj/sanjay can always act. Legacy items with no signer_email → Director only.
function canSignItem(s){
  if(!s) return false;
  if(isAdminUser()) return true;                        // owner/Director override
  const assigned=(s.signer_email||"").toLowerCase();
  return assigned ? myEmail()===assigned : false;       // strictly the named person
}
function sigParts(){
  const rawPend=SIGNATURES.filter(s=>s.awaiting==="you"&&s.status==="pending");
  const rawOth=SIGNATURES.filter(s=>s.awaiting==="other"&&s.status==="pending");
  // "Pending your signature" = only items routed to YOU. Others never appear in your inbox.
  const pend = rawPend.filter(canSignItem);
  // "Awaiting others" = things you sent that are with someone else (+ for the Director,
  // oversight of any pending item routed to another named person).
  const notMine = rawPend.filter(s=>!canSignItem(s));
  const oth = isAdminUser()
    ? rawOth.concat(notMine)
    : rawOth.filter(s=>(s.from_name||"").toLowerCase()===myEmail());
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
        ${(()=>{ const pn=pend.filter(x=>x.doc_type==="nte"); return pn.length>1?`<div style="margin:2px 0 12px;"><button class="btn" onclick="approveAllPendingNtes()">Approve &amp; sign all ${pn.length} NTEs</button> <span class="psub" style="margin:0;">with your saved signature — review each below if unsure</span></div>`:""; })()}
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
// Default sign-screen header (memos, contracts, advances) — plain document body.
function defaultSignTop(s){ return `<h2 style="font-size:18px;color:#1E3A5F;margin-bottom:2px;">${esc(s.doc_title)}${s.subject_name?" — "+esc(s.subject_name):""}</h2>
    <div class="psub">From ${esc(s.from_name||"HR")}${s.amount?" · ₱"+Number(s.amount).toLocaleString():""}${s.meta?" · "+esc(s.meta):""}</div>
    <div style="background:#f7f9fb;border:1px solid #E3E8EF;border-radius:10px;padding:14px 16px;margin:12px 0;white-space:pre-wrap;font-size:13.5px;line-height:1.6;max-height:34vh;overflow-y:auto;">${esc(s.body||"(document body)")}</div>`; }
// Branded approval card for final-pay quitclaims — the figures you review sit in one clean table (RCC-Portal style).
function hrDisplayName(email){ const M={ "anj@hassarams.com":"Anju C. Genomal — Director, Admin & Finance", "hr@hassarams.com":"Juvelyn Belvistre — HR Officer", "hr1@hassarams.com":"Vina — Human Resources", "hr3@hassarams.com":"Grazel Lyn Agulto — HR Officer", "hr4@hassarams.com":"Rhel Vinluan — HR Manager" }; return M[(email||"").toLowerCase()]||email||"Human Resources"; }
// The full line-by-line breakdown (salary + allowance per line) rendered ON the approval card.
function claimLines(fp,P){
  const amt=(lbl,v,strong,pad)=>`<tr><td style="padding:6px 14px 6px ${pad||26}px;color:${strong?'#12352a':'#6B7785'};font-size:12px;${strong?'font-weight:800;':''}border-bottom:1px solid #f2f5f7;">${lbl}</td><td style="padding:6px 14px;font-size:12.5px;${strong?'font-weight:800;color:#12352a;':''}border-bottom:1px solid #f2f5f7;text-align:right;white-space:nowrap;">${P(v)}</td></tr>`;
  const sub=(lbl,v)=>`<tr><td style="padding:2px 14px 2px 42px;color:#9aa3ac;font-size:11px;">${lbl}</td><td style="padding:2px 14px;color:#6B7785;font-size:11px;text-align:right;white-space:nowrap;">${P(v)}</td></tr>`;
  const head=(lbl)=>`<tr><td colspan="2" style="padding:9px 14px 3px;font-size:10.5px;font-weight:800;letter-spacing:.6px;color:#12352a;background:#f4f8f5;">${lbl}</td></tr>`;
  let h=head("CLAIMS — OWED TO EMPLOYEE");
  FP_CLAIMS.forEach(([k,lbl])=>{ if(Number(fp[k]||0)===0 && !fp[k+"_note"]) return;
    h+=amt(lbl,fp[k]);
    if(FP_SPLIT.has(k) && (fp[k+"_basic"]!=null||fp[k+"_allowance"]!=null)){ h+=sub("• Basic salary",fp[k+"_basic"]||0)+sub("• Allowance",fp[k+"_allowance"]||0); }
  });
  h+=amt("Total claims",fpClaims(fp),true);
  h+=head("LESS — DEDUCTIONS");
  let any=false; FP_DEDUCTIONS.forEach(([k,lbl])=>{ if(Number(fp[k]||0)===0 && !fp[k+"_note"]) return; any=true; h+=amt(lbl,fp[k]); });
  if(!any) h+=`<tr><td style="padding:5px 14px 5px 26px;color:#9aa3ac;font-size:11.5px;border-bottom:1px solid #f2f5f7;">None</td><td style="border-bottom:1px solid #f2f5f7;"></td></tr>`;
  h+=amt("Total deductions",fpDeductions(fp),true);
  return h;
}
function claimCard(s){ const d=s.details||{}; const P=n=>"₱"+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const row=(k,v)=>`<tr><td style="padding:9px 14px;color:#6B7785;font-size:12.5px;border-bottom:1px solid #eef1f4;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:9px 14px;font-weight:700;font-size:13px;border-bottom:1px solid #eef1f4;">${v}</td></tr>`;
  return `<div style="background:linear-gradient(135deg,#12352a,#1c4b39);margin:-22px -22px 0;padding:15px 20px;border-radius:14px 14px 0 0;color:#fff;">
      <div style="font-weight:800;font-size:15px;letter-spacing:.2px;">RCC Portal <span style="opacity:.72;font-weight:500;font-size:12.5px;">Roshan Commercial Corporation</span></div>
    </div>
    <div style="padding:16px 2px 0;">
      <div style="font-size:10.5px;font-weight:800;letter-spacing:1.6px;color:#6B7785;">FINAL PAY · QUITCLAIM</div>
      <div style="font-size:18px;font-weight:800;color:#12352a;margin:2px 0 3px;">Final pay needs your approval</div>
      <div class="psub" style="margin-bottom:11px;">Prepared by ${esc(d.prepared_by||s.from_name||"HR")}${s.created_at?" · "+fmtAgo(s.created_at):""}. Review the figures, then e-sign below.</div>
      <table style="width:100%;border:1px solid #e6eaee;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden;">
        ${row("Employee",esc(d.employee||s.subject_name||"—"))}
        ${(d.employee_id||d.position)?row("ID / Position",esc([d.employee_id,d.position].filter(Boolean).join(" · ")||"—")):""}
        ${d.branch?row("Branch",esc(d.branch)):""}
        ${d.last_day?row("Last day",fmtDate(d.last_day)):""}
        ${d.separation?row("Separation",esc(d.separation)):""}
        ${d.fp?claimLines(d.fp,P):(row("Total claims",P(d.claims))+row("Less: deductions",P(d.deductions)))}
        <tr><td style="padding:12px 14px;background:#eaf4ec;font-size:12.5px;font-weight:800;color:#12352a;">NET TO EMPLOYEE</td><td style="padding:12px 14px;background:#eaf4ec;font-weight:800;font-size:15.5px;color:#12352a;">${P(d.net!=null?d.net:s.amount)}</td></tr>
        ${d.payment?row("Payment",esc(d.payment)):""}
      </table>
    </div>`; }
// Branded approval card for attendance NTEs — the record the approver is signing off on.
function nteCard(s){ const d=s.details||{};
  const rw=(k,v)=>`<tr><td style="padding:9px 14px;color:#6B7785;font-size:12.5px;border-bottom:1px solid #eef1f4;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:9px 14px;font-weight:700;font-size:13px;border-bottom:1px solid #eef1f4;">${v}</td></tr>`;
  return `<div style="background:linear-gradient(135deg,#12352a,#1c4b39);margin:-22px -22px 0;padding:15px 20px;border-radius:14px 14px 0 0;color:#fff;">
      <div style="font-weight:800;font-size:15px;letter-spacing:.2px;">RCC Portal <span style="opacity:.72;font-weight:500;font-size:12.5px;">Roshan Commercial Corporation</span></div>
    </div>
    <div style="padding:16px 2px 0;">
      <div style="font-size:10.5px;font-weight:800;letter-spacing:1.6px;color:#6B7785;">NOTICE TO EXPLAIN · ATTENDANCE</div>
      <div style="font-size:18px;font-weight:800;color:#12352a;margin:2px 0 3px;">NTE needs your sign-off</div>
      <div class="psub" style="margin-bottom:11px;">Submitted by ${esc(s.from_name||"HR")}${s.created_at?" · "+fmtAgo(s.created_at):""}. Review the record, then approve &amp; e-sign as “Noted by”.</div>
      <table style="width:100%;border:1px solid #e6eaee;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden;">
        ${rw("Employee",esc(d.employee||s.subject_name||"—"))}
        ${(d.employee_id||d.position)?rw("ID / Position",esc([d.employee_id,d.position].filter(Boolean).join(" · ")||"—")):""}
        ${d.cutoff?rw("Cutoff",esc((d.month?TK_MONTH_FULL[d.month]+" "+TK_YEAR+" · ":"")+d.cutoff)):""}
        ${rw("Unauthorized absences",d.unauth)}
        ${rw("Late / undertime",Number(d.late||0).toFixed(1)+" day(s)")}
        <tr><td style="padding:12px 14px;background:#eaf4ec;font-size:12.5px;font-weight:800;color:#12352a;">COMBINED SCORE</td><td style="padding:12px 14px;background:#eaf4ec;font-weight:800;font-size:15.5px;color:#12352a;">${Number(d.combined||0).toFixed(1)}</td></tr>
        ${(d.hist&&d.hist.length)?rw("This year", d.hist.map(h=>{ const lbl=(TK_MONTH_FULL[h.mon]||h.mon).slice(0,3); const v=h.held?"leave":Number(h.combined).toFixed(1); const c=h.held?"#8a8f96":(h.flagged?"#a4322a":"#5a6b60"); const w=h.flagged?"800":"500"; return '<span style="color:'+c+';font-weight:'+w+';">'+lbl+' '+v+'</span>'; }).join(" · ")+(Number(d.repeat)>=2?' &nbsp;<span style="color:#a4322a;font-weight:800;">('+d.repeat+'× flagged)</span>':"")):""}
        ${d.noted_by?rw("Noted by",esc(d.noted_by)):""}
      </table>
      ${Number(d.repeat)>=2?`<div class="note" style="margin-top:10px;background:#fdeaea;border-color:#f0c9c5;color:#8a2e26;">⚠ Repeat offender — flagged in ${d.repeat} months so far this year. If prior NTEs were already served, consider escalating (Notice of Decision) rather than another first notice.</div>`:""}
      <div class="note" style="margin-top:10px;">Confirm the absences were truly <b>unauthorized</b> (not approved leave) and that the DTR is attached before serving.</div>
      <details style="margin:11px 0 2px;"><summary style="cursor:pointer;font-size:12.5px;color:#1E3A5F;font-weight:600;">Read the full notice text</summary>
        <div style="background:#f7f9fb;border:1px solid #E3E8EF;border-radius:10px;padding:12px 14px;margin-top:8px;white-space:pre-wrap;font-size:12.5px;line-height:1.55;max-height:30vh;overflow-y:auto;">${esc(s.body||"")}</div>
      </details>
    </div>`; }
// ---- Saved signature (per user, on this device) + shared sign logic ----
function mySigKey(){ return "rcc_sig_"+(((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase()); }
function getSavedSig(){ try{ return localStorage.getItem(mySigKey())||""; }catch(_){ return ""; } }
function saveSavedSig(dataUrl){ try{ localStorage.setItem(mySigKey(), dataUrl); }catch(_){} }
// Apply a signature image to a pending request and run its doc-type side effects. Returns an error or null.
async function applySignature(s, dataUrl){
  // Final-pay quitclaim: Anj is the SOLE final sign-off (her explicit call). No one else — not even Sanjay.
  if(s.doc_type==="claim" && ((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase()!=="anj@hassarams.com"){
    return { message:"Only Anj (Director, Admin & Finance) is the final sign-off for a final-pay quitclaim. It stays in her Signatures inbox until she signs." };
  }
  // Other Director items may be signed by any admin (Anj or Sanjay).
  if(isDirectorItem(s) && !isAdminUser()){
    return { message:"Only the Director can approve this. It stays in the Director's Signatures inbox until they sign — HR cannot clear it." };
  }
  // Person-based routing: an item routed to a NAMED signer can only be signed by that person
  // (or the Director). Defense-in-depth behind the inbox filter — blocks a stale page too.
  if(!canSignItem(s)){
    const who=s.with_whom||nameForEmail((s.signer_email||"").toLowerCase())||"its named signer";
    return { message:"This item is routed to "+who+" — only they (or the Director) can sign it. It won't appear in anyone else's inbox." };
  }
  const signer=(CURRENT_USER&&(CURRENT_USER.email||CURRENT_USER.name))||"Signed-in user";
  const { error } = await sb.from("signature_requests").update({ status:"signed", signed_at:new Date().toISOString(), signer_name:signer, signature_data:dataUrl, updated_at:new Date().toISOString() }).eq("id",s.id);
  if(error) return error;
  if(s.doc_type==="claim"){
    await sb.from("exit_clearance").update({ quitclaim_status:"Approved", quitclaim_signed:true, quitclaim_date:new Date().toISOString().slice(0,10), updated_at:new Date().toISOString() }).eq("quitclaim_signature_id",s.id);
    try{ await logChange("exit",null,s.subject_name||"","Final pay approved (e-signed)","Net "+(s.amount!=null?peso(s.amount):"—")); }catch(_){}
  }
  if(s.doc_type==="nte"){
    try{ await sb.from("memos").update({ status:"Signed", updated_at:new Date().toISOString() }).eq("signature_request_id",s.id); }catch(_){}
    try{ await logChange("memo",null,s.subject_name||"","NTE approved (e-signed)",(s.details?("combined "+s.details.combined+" · "+(s.details.month||"")):"")); }catch(_){}
  }
  if(s.doc_type==="meeting_nte"){
    try{ await sb.from("memos").update({ status:"Signed", updated_at:new Date().toISOString() }).eq("signature_request_id",s.id); }catch(_){}
    try{ await logChange("memo",null,s.subject_name||"","Meeting-absence NTE approved (e-signed)",(s.details?("missed "+s.details.missed+" of "+s.details.expected+" · "+(s.details.label||"")):"")); }catch(_){}
  }
  return null;
}
// Batch: approve & e-sign every pending NTE awaiting you, using your saved signature.
async function approveAllPendingNtes(){
  const saved=getSavedSig(); if(!saved){ alert("Save your signature first — open any pending item, sign once, and tick “Remember my signature.”"); return; }
  const pend=(SIGNATURES||[]).filter(s=>s.doc_type==="nte"&&s.awaiting==="you"&&s.status==="pending");
  if(!pend.length){ alert("No NTEs are waiting for your sign-off."); return; }
  if(!confirm("Approve & e-sign all "+pend.length+" pending NTE(s) with your saved signature?\n\nBy doing so you confirm the attendance records were reviewed and the absences are unauthorized.")) return;
  for(const s of pend){ const e=await applySignature(s, saved); if(e){ alert("Stopped — "+e.message); break; } }
  await loadEmployees(); window.go("signatures");
}
window.approveAllPendingNtes=approveAllPendingNtes;
function openSignDoc(id){
  const s=SIGNATURES.find(x=>String(x.id)===String(id)); if(!s) return;
  const savedSig=getSavedSig();
  let m=document.getElementById("sigModal"); if(!m){ m=document.createElement("div"); m.id="sigModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:10001;background:rgba(14,30,50,.55);display:flex;align-items:center;justify-content:center;padding:20px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:92vh;overflow-y:auto;padding:22px;">
    ${(s.doc_type==="claim"&&s.details)?claimCard(s):(s.doc_type==="nte"&&s.details)?nteCard(s):(s.doc_type==="meeting_nte"&&s.details)?meetingNteCard(s):defaultSignTop(s)}
    ${savedSig?`<div style="display:flex;align-items:center;gap:10px;background:#eef6f0;border:1px solid #cfe6d8;border-radius:9px;padding:8px 12px;margin-bottom:10px;">
      <img src="${savedSig}" style="height:34px;background:#fff;border-radius:4px;padding:2px 4px;border:1px solid #e2e7e4;">
      <div style="flex:1;font-size:12.5px;color:#12352a;">Your saved signature is on file — one tap to approve.</div>
      <button class="btn" id="sigSaved">Approve &amp; Sign with this</button>
    </div>
    <div style="font-size:12px;color:#6B7785;margin-bottom:6px;">…or draw a new signature below:</div>`
    :`<div style="font-size:12px;color:#6B7785;margin-bottom:6px;">Sign below — drawn with your finger or mouse. RA 8792 e-signature · timestamped + recorded against your account.</div>`}
    <canvas id="sigPad" width="500" height="150" style="width:100%;height:150px;border:1px dashed #b9c4cf;border-radius:10px;background:#fff;touch-action:none;cursor:crosshair;"></canvas>
    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
      <button class="btn ghost" id="sigClear" style="flex:0 0 auto;">Clear</button>
      <button class="btn ghost" id="sigUpload" type="button" style="flex:0 0 auto;">📷 Upload signature</button>
      <input type="file" id="sigFile" accept="image/*" style="display:none;">
      <label style="font-size:12px;color:#6B7785;display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="checkbox" id="sigRemember" ${savedSig?"":"checked"}> Remember my signature on this device</label>
      <span id="sigMsg" style="font-size:12.5px;color:#a4322a;flex:1 1 100%;"></span>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn ghost" id="sigDecline" style="color:#c0392b;border-color:#f1c9c5;">Decline</button>
      <button class="btn ghost" id="sigCancel" style="margin-left:auto;">Cancel</button>
      <button class="btn" id="sigDo">${(s.doc_type==="claim"||s.doc_type==="nte"||s.doc_type==="meeting_nte")?"Approve &amp; Sign":"Sign document"}</button>
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
  // Upload a real signature photo → knock out the white background → drop it onto the pad (transparent, PDF-style).
  const sigMakeTransparent=(img)=>{ const c=document.createElement("canvas"); const s2=Math.min(1,700/img.width); c.width=Math.round(img.width*s2); c.height=Math.round(img.height*s2); const xx=c.getContext("2d"); xx.drawImage(img,0,0,c.width,c.height); const dd=xx.getImageData(0,0,c.width,c.height), p=dd.data; for(let i=0;i<p.length;i+=4){ const lum=(p[i]+p[i+1]+p[i+2])/3; if(lum>205){ p[i+3]=0; } else if(lum>130){ p[i+3]=Math.round((205-lum)/75*255); } else { p[i]=18;p[i+1]=53;p[i+2]=31; } } xx.putImageData(dd,0,0); return c.toDataURL("image/png"); };
  const sigUp=document.getElementById("sigUpload"), sigFile=document.getElementById("sigFile");
  if(sigUp&&sigFile){ sigUp.onclick=()=>sigFile.click();
    sigFile.onchange=(ev)=>{ const f=ev.target.files&&ev.target.files[0]; if(!f) return; const rd=new FileReader();
      rd.onload=()=>{ const img=new Image(); img.onload=()=>{ const ti=new Image(); ti.onload=()=>{ ctx.clearRect(0,0,cv.width,cv.height); const s3=Math.min(cv.width/ti.width, cv.height/ti.height); const dw=ti.width*s3, dh=ti.height*s3; ctx.drawImage(ti,(cv.width-dw)/2,(cv.height-dh)/2,dw,dh); dirty=true; document.getElementById("sigMsg").textContent=""; }; ti.src=sigMakeTransparent(img); }; img.src=rd.result; };
      rd.readAsDataURL(f); }; }
  const finishSign=async(dataUrl,btn,label)=>{
    if(btn){ btn.disabled=true; btn.textContent="Signing…"; }
    const err=await applySignature(s, dataUrl);
    if(err){ document.getElementById("sigMsg").textContent=err.message; if(btn){ btn.disabled=false; btn.textContent=label; } return; }
    m.remove(); await loadEmployees(); window.go("signatures");
  };
  document.getElementById("sigDo").onclick=async()=>{
    if(!dirty){ document.getElementById("sigMsg").textContent="Add your signature first — upload an image or draw it."; return; }
    const remember=document.getElementById("sigRemember"); const data=cv.toDataURL("image/png");
    if(remember&&remember.checked) saveSavedSig(data);
    finishSign(data, document.getElementById("sigDo"), (s.doc_type==="claim"||s.doc_type==="nte"||s.doc_type==="meeting_nte")?"Approve & Sign":"Sign document");
  };
  const savedBtn=document.getElementById("sigSaved");
  if(savedBtn) savedBtn.onclick=()=> finishSign(savedSig, savedBtn, "Approve & Sign with this");
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
      <div class="actionbar"><button class="btn" id="memoNew">+ New memo</button>${canManageStores()?' <button class="btn ghost" id="npaNew">+ New NPA</button>':''}</div>
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
  const npaBtn=$("#npaNew"); if(npaBtn) npaBtn.addEventListener("click",()=>newNpa());
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
    const row={ ref_no:ref, memo_type:type, subject_name:v("mm_emp"), title:type, body, relevant_date:v("mm_date"), status:"Draft", is_demo:EMPLOYEES.some(x=>x.full_name===v("mm_emp")&&x.is_demo), created_by:(CURRENT_USER&&CURRENT_USER.email)||"HR" };
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
/* ---------- STORE TRANSFERS / DEPLOYMENTS ----------
   SC raises → store head confirms BEFORE (agrees to receive) → in effect →
   store head confirms AFTER (attests the person was at the store for the period → payroll proof).
   Worksite stays PayPlus-owned; on completion HR updates the assignment in PayPlus. */
function transferStatusPill(s){
  const c={Requested:'#8a6d1a',InEffect:'#1c6b3f',Completed:'#2b5c8a',Declined:'#c0392b',Cancelled:'#6a766f'}[s]||'#6a766f';
  const bg={Requested:'#fdf6e3',InEffect:'#e7f3ec',Completed:'#e8f0f8',Declined:'#fdecea',Cancelled:'#eef1ef'}[s]||'#eef1ef';
  const lbl={Requested:'Requested',InEffect:'In effect',Completed:'Completed',Declined:'Declined',Cancelled:'Cancelled'}[s]||s;
  return `<span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;color:${c};background:${bg};">${esc(lbl)}</span>`;
}
function transferPeriod(t){
  const s=t.start_date?fmtDate(t.start_date):'—';
  if(t.request_type==='Permanent') return s+' · permanent';
  const e=t.end_date?fmtDate(t.end_date):'open';
  return s+' → '+e;
}
function scLinkFor(sc){ return (SC_LINKS||[]).find(x=>x.sc_name===sc); }
function scLinksBlock(){
  const scs=[...new Set((BRANCHES||[]).map(b=>b.sc).filter(x=>x&&x!=='Unassigned'))].sort();
  const rows=scs.map(sc=>{
    const link=scLinkFor(sc);
    if(link){ const u=`${SHARE_BASE}transfer-request.html?who=${encodeURIComponent(sc)}&sc=${link.token}`;
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;flex-wrap:wrap;">
        <div style="flex:1;min-width:140px;font-size:13px;font-weight:600;">${esc(sc)} <span style="font-weight:400;color:var(--muted);font-size:11px;">private link — only their own people</span></div>
        <button class="btn ghost" data-copy="${u}" style="flex-shrink:0;padding:5px 10px;font-size:12px;">Copy link</button>
        <a class="btn ghost" href="${u}" target="_blank" rel="noopener" style="flex-shrink:0;padding:5px 10px;font-size:12px;text-decoration:none;">Open</a>
      </div>`;
    }
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">
        <div style="flex:1;min-width:140px;font-size:13px;font-weight:600;">${esc(sc)} <span style="font-weight:400;color:var(--muted);font-size:11px;">no link yet</span></div>
        <button class="btn ghost sc-mklink" data-sc="${esc(sc)}" style="flex-shrink:0;padding:5px 10px;font-size:12px;">Create link</button>
      </div>`;
  }).join("");
  return `<div style="background:#eef4ef;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-top:12px;">
    <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">Store Coordinator request links</div>
    <div class="psub" style="margin:0 0 6px;">Each SC gets their <b>own private link</b> — it only shows <b>their own people</b> and files under their name, so no one can request for someone else's staff.</div>
    ${rows||'<div class="psub" style="margin:0;">No Store Coordinators on file yet.</div>'}
  </div>`;
}
async function createScLink(sc){
  if(!sc) return;
  const token=(crypto&&crypto.randomUUID?crypto.randomUUID():String(Math.random())).replace(/-/g,"");
  const { error } = await sb.from("sc_links").insert({ sc_name:sc, token });
  if(error){ alert(error.message); return; }
  await loadEmployees(); window.go("manning");
}
function manningTransfersPanel(){
  const active=(TRANSFERS||[]).filter(t=>['Requested','InEffect'].includes(t.status));
  const done=(TRANSFERS||[]).filter(t=>['Completed','Declined','Cancelled'].includes(t.status)).slice(0,8);
  const rowsHtml=(arr)=>arr.map(t=>`<tr class="trf-open" data-id="${t.id}" style="cursor:pointer;">
     <td><b>${esc(t.emp_name||'—')}</b>${t.is_demo?' <span class="pill ag" style="font-size:9.5px;">DEMO</span>':''}<div style="font-size:11px;color:var(--muted);">${esc(t.emp_no||'')}</div></td>
     <td>${esc(t.from_worksite||'—')} <span style="color:var(--muted);">→</span> <b>${esc(t.to_worksite||'—')}</b></td>
     <td style="font-size:12px;white-space:nowrap;">${transferPeriod(t)}</td>
     <td>${esc(t.sc_requested_by||'—')}</td>
     <td>${transferStatusPill(t.status)}${t.status==='InEffect'&&t.before_by?`<div style="font-size:10.5px;color:var(--muted);margin-top:2px;">✓ before: ${esc(t.before_by)}</div>`:''}</td>
   </tr>`).join('');
  return `<div class="panel">
     <h2>Store Transfers &amp; Deployments <span class="count-tag">${active.length} active</span></h2>
     <div class="psub">Move an employee to another store for a set period. <b>The SC raises the request → the store head confirms before (agrees to receive) → after the period the store head confirms the person was there</b> — that attestation is the proof for payroll / reliever credit. Worksite stays owned by PayPlus; once completed, update the assignment in PayPlus.</div>
     ${scLinksBlock()}
     <div class="actionbar"><button class="btn" id="trfNew">+ New transfer request</button> <span class="psub" style="margin:0;align-self:center;">or record one on the SC's behalf</span></div>
     ${active.length?`<table><thead><tr><th>Employee</th><th>From → To</th><th>Period</th><th>Requested by (SC)</th><th>Status</th></tr></thead><tbody>${rowsHtml(active)}</tbody></table>`:`<div class="psub" style="margin-top:6px;">No active transfer requests. Click “New transfer request”.</div>`}
     ${done.length?`<div class="subhead" style="margin-top:16px;">Recent — completed / closed</div><table><thead><tr><th>Employee</th><th>From → To</th><th>Period</th><th>Requested by (SC)</th><th>Status</th></tr></thead><tbody>${rowsHtml(done)}</tbody></table>`:''}
   </div>`;
}
function wireTransfers(){
  const nb=document.getElementById("trfNew"); if(nb) nb.addEventListener("click",()=>transferForm());
  $$("#page-manning [data-copy]").forEach(b=>b.addEventListener("click",()=>{ navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copy); const t=b.textContent; b.textContent="Copied ✓"; setTimeout(()=>b.textContent=t,1200); }));
  $$("#page-manning .sc-mklink").forEach(b=>b.addEventListener("click",()=>createScLink(b.dataset.sc)));
  $$("#page-manning .trf-open").forEach(r=>r.addEventListener("click",()=>openTransfer((TRANSFERS||[]).find(t=>String(t.id)===r.dataset.id))));
}
function transferForm(t){
  t=t||{}; const isNew=!t.id;
  const emps=(EMPLOYEES||[]).filter(e=>e.full_name).sort((a,b)=>(a.full_name||'').localeCompare(b.full_name||''));
  const stores=[...new Set((BRANCHES||[]).filter(b=>b.status==="Open").map(b=>b.name))].sort();
  const scNames=[...new Set((BRANCHES||[]).map(b=>b.sc).filter(x=>x&&x!=='Unassigned'))].sort();
  const lbl=(s)=>`<label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin:10px 0 3px;">${s}</label>`;
  const inp=(id,val,type)=>`<input id="${id}" ${type?`type="${type}"`:''} value="${esc(val==null?'':val)}" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;">`;
  const opts=(arr,cur)=>arr.map(o=>`<option ${cur===o?'selected':''}>${esc(o)}</option>`).join('');
  let m=document.getElementById("trfModal"); if(!m){ m=document.createElement("div"); m.id="trfModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.5);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:520px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;"><div style="font-size:20px;font-weight:800;">${isNew?'New transfer request':'Edit transfer'}</div><div style="font-size:12.5px;opacity:.85;">Raised by the Store Coordinator · store head confirms before &amp; after</div></div>
    <div style="padding:18px 22px;"><div class="panel" style="margin-top:0;">
      ${lbl('Employee')}<input id="trf_emp" list="trf_emplist" value="${esc(t.emp_name||'')}" placeholder="Type a name…" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;">
      <datalist id="trf_emplist">${emps.map(e=>`<option value="${esc(e.full_name)}">`).join('')}</datalist>
      ${lbl('Current store (from)')}${inp('trf_from',t.from_worksite)}<div style="font-size:11px;color:var(--muted);margin-top:2px;">Auto-fills from the employee's record; edit if needed.</div>
      ${lbl('Transfer to (store)')}<select id="trf_to" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:#fff;"><option value="">Select store…</option>${opts(stores,t.to_worksite)}</select>
      ${lbl('Requested by — Store Coordinator')}<input id="trf_sc" list="trf_sclist" value="${esc(t.sc_requested_by||'')}" placeholder="SC name" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;">
      <datalist id="trf_sclist">${scNames.map(s=>`<option value="${esc(s)}">`).join('')}</datalist>
      ${lbl('Type')}<select id="trf_type" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:#fff;">${opts(['Temporary','Permanent'],t.request_type||'Temporary')}</select>
      <div style="display:flex;gap:10px;">
        <div style="flex:1;">${lbl('Start date')}${inp('trf_start',t.start_date,'date')}</div>
        <div style="flex:1;">${lbl('End date')}${inp('trf_end',t.end_date,'date')}<div style="font-size:11px;color:var(--muted);margin-top:2px;">Blank if permanent.</div></div>
      </div>
      ${lbl('Reason')}<textarea id="trf_reason" rows="2" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;">${esc(t.reason||'')}</textarea>
      <div style="margin-top:6px;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;">Emails for the advisory (optional)</div>
      ${lbl("SC's email")}${inp('trf_scemail',t.sc_email,'email')}${lbl("Employee's email")}${inp('trf_empemail',t.emp_email,'email')}
      <div style="margin-top:8px;padding:8px 10px;background:#eef4ef;border:1px solid var(--line);border-radius:8px;font-size:11.5px;color:#4a5751;">Fairness check: a transfer must keep the same rank and pay and be to a reasonable location — never a way to force someone out.</div>
      <div id="trfMsg" style="font-size:13px;color:#a4322a;margin:8px 0;"></div>
      <div style="display:flex;gap:10px;"><button class="btn ghost" id="trfCancel" style="flex:1;">Cancel</button><button class="btn" id="trfSave" style="flex:1;">${isNew?'Raise request':'Save'}</button></div>
    </div></div></div>`;
  m.addEventListener("click",e=>{ if(e.target===m) m.remove(); });
  document.getElementById("trfCancel").addEventListener("click",()=>m.remove());
  const empEl=document.getElementById("trf_emp");
  empEl.addEventListener("input",()=>{ const e=emps.find(x=>(x.full_name||'').toLowerCase()===empEl.value.trim().toLowerCase()); if(e){ const fe=document.getElementById("trf_from"); if(fe&&!fe.value) fe.value=e.worksite||''; } });
  document.getElementById("trfSave").addEventListener("click",async()=>{
    const name=v("trf_emp").trim(); if(!name){ document.getElementById("trfMsg").textContent="Employee is required."; return; }
    if(!v("trf_to")){ document.getElementById("trfMsg").textContent="Choose the store to transfer to."; return; }
    const e=emps.find(x=>(x.full_name||'').toLowerCase()===name.toLowerCase());
    const perm=v("trf_type")==='Permanent';
    const payload={ emp_name:name, emp_no:e?e.employee_id:(t.emp_no||null), from_worksite:v("trf_from")||null, to_worksite:v("trf_to")||null,
      sc_requested_by:v("trf_sc")||null, request_type:v("trf_type"), reason:v("trf_reason")||null,
      sc_email:v("trf_scemail")||null, emp_email:v("trf_empemail")||null,
      start_date:v("trf_start")||null, end_date:perm?null:(v("trf_end")||null), updated_at:new Date().toISOString() };
    let res;
    if(isNew){ payload.status='Requested'; payload.created_by=myEmail()||null; res=await sb.from("employee_transfers").insert(payload); }
    else res=await sb.from("employee_transfers").update(payload).eq("id",t.id);
    if(res.error){ document.getElementById("trfMsg").textContent=res.error.message; return; }
    await logChange("transfer",t.id||null,name, isNew?"Transfer requested":"Transfer edited", `${v("trf_from")||'—'} → ${v("trf_to")}`);
    m.remove(); await loadEmployees(); window.go("manning");
  });
}
function openTransfer(t){
  if(!t) return;
  const row=(k,val)=>`<div class="efield"><div class="el">${k}</div><div class="ev">${val==null||val===''?'<span class="note">—</span>':esc(val)}</div><div class="em"></div></div>`;
  let m=document.getElementById("trfViewModal"); if(!m){ m=document.createElement("div"); m.id="trfViewModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  const beforeDone=!!t.before_at, afterDone=!!t.after_at;
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:560px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;">
      <div style="font-size:21px;font-weight:800;">${esc(t.emp_name||'—')}</div>
      <div style="font-size:12.5px;opacity:.9;margin-top:3px;">${esc(t.from_worksite||'—')} → <b>${esc(t.to_worksite||'—')}</b> · ${transferPeriod(t)} · ${transferStatusPill(t.status)}</div>
    </div>
    <div style="padding:18px 22px 60px;">
      <div class="panel" style="margin-top:0;">
        ${row('Employee', (t.emp_name||'')+(t.emp_no?` · ${t.emp_no}`:''))}${row('From', t.from_worksite)}${row('To', t.to_worksite)}${row('Type', t.request_type)}${row('Period', transferPeriod(t))}${row('Requested by (SC)', t.sc_requested_by)}${row('Reason', t.reason)}
      </div>
      <div class="panel">
        <h2>Store-head confirmation</h2>
        <div class="task" style="align-items:flex-start;"><div class="dot ${beforeDone?'g':'a'}"></div><div style="flex:1;"><div class="tt">Before — store head agrees to receive</div><div class="td">${beforeDone?`✓ ${esc(t.before_by||'')} · ${fmtDate(t.before_at)}${t.before_note?` — ${esc(t.before_note)}`:''}`:'Pending — the receiving store head confirms they will take the employee for the period.'}</div></div></div>
        <div class="task" style="align-items:flex-start;"><div class="dot ${afterDone?'g':'a'}"></div><div style="flex:1;"><div class="tt">After — store head attests presence</div><div class="td">${afterDone?`✓ ${esc(t.after_by||'')} · ${fmtDate(t.after_at)}${t.after_note?` — ${esc(t.after_note)}`:''}`:`Pending — after the period, the store head confirms <b>${esc(t.emp_name||'the employee')}</b> was at <b>${esc(t.to_worksite||'the store')}</b> for ${transferPeriod(t)}.`}</div></div></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
        ${t.status==='Requested'?`<button class="btn blue" id="trfBefore">Store head confirmed (before)</button><button class="btn ghost" id="trfEdit">Edit</button><button class="btn ghost" id="trfDecline" style="color:var(--red);border-color:#f1c9c5;">Store head declined</button>`:''}
        ${t.status==='InEffect'?`<button class="btn blue" id="trfAfter">Store head confirms — was here for the period</button>`:''}
        ${['Requested','InEffect'].includes(t.status)?`<button class="btn ghost" id="trfCancel2" style="color:var(--muted);">Cancel request</button>`:''}
        ${t.status==='Completed'?`<span class="pill active">✓ Completed — attestation on record</span><span class="psub" style="align-self:center;margin:0 0 0 6px;">Next: update the worksite in PayPlus.</span>`:''}
        <button class="btn ghost" id="trfViewClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  m.addEventListener("click",e=>{ if(e.target===m) m.remove(); });
  document.getElementById("trfViewClose").addEventListener("click",()=>m.remove());
  const wireStep=(id,fn)=>{ const b=document.getElementById(id); if(b) b.addEventListener("click",fn); };
  wireStep("trfEdit",()=>{ m.remove(); transferForm(t); });
  wireStep("trfBefore",()=>transferConfirm(t,'before',m));
  wireStep("trfAfter",()=>transferConfirm(t,'after',m));
  wireStep("trfDecline",async()=>{ if(!confirm("Mark this request as declined by the store head?")) return; await transferSet(t,{status:'Declined'},m,"Store head declined"); });
  wireStep("trfCancel2",async()=>{ if(!confirm("Cancel this transfer request?")) return; await transferSet(t,{status:'Cancelled'},m,"Request cancelled"); });
}
function transferConfirm(t,phase,parent){
  const isBefore=phase==='before';
  let m=document.getElementById("trfCfmModal"); if(!m){ m=document.createElement("div"); m.id="trfCfmModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:10001;background:rgba(14,50,25,.5);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:22px;">
    <h2 style="font-size:17px;margin-bottom:2px;">${isBefore?'Store head confirms — before':'Store head confirms — after'}</h2>
    <div class="psub">${isBefore?`The receiving store head agrees to take <b>${esc(t.emp_name||'')}</b> at <b>${esc(t.to_worksite||'')}</b> for ${transferPeriod(t)}.`:`The store head attests that <b>${esc(t.emp_name||'')}</b> was at <b>${esc(t.to_worksite||'')}</b> for ${transferPeriod(t)}. This is the payroll / reliever-credit proof.`}</div>
    <label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin:12px 0 3px;">Store head name</label>
    <input id="cf_name" placeholder="Name of the store head confirming" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;">
    <label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin:10px 0 3px;">Note (optional)</label>
    <textarea id="cf_note" rows="2" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;"></textarea>
    <div id="cfMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
    <div style="display:flex;gap:10px;margin-top:12px;"><button class="btn ghost" id="cfCancel" style="flex:1;">Cancel</button><button class="btn" id="cfGo" style="flex:1;">Record confirmation</button></div>
  </div>`;
  m.addEventListener("click",e=>{ if(e.target===m) m.remove(); });
  document.getElementById("cfCancel").addEventListener("click",()=>m.remove());
  document.getElementById("cfGo").addEventListener("click",async()=>{
    const nm=document.getElementById("cf_name").value.trim(); if(!nm){ document.getElementById("cfMsg").textContent="Store head name is required."; return; }
    const note=document.getElementById("cf_note").value.trim();
    const now=new Date().toISOString();
    const patch=isBefore
      ? { before_by:nm, before_at:now, before_note:note||null, status:'InEffect' }
      : { after_by:nm, after_at:now, after_note:note||null, status:'Completed' };
    m.remove();
    await transferSet(t,patch,parent, isBefore?`Store head confirmed (before): ${nm}`:`Store head attested presence (after): ${nm}`);
  });
}
async function transferSet(t,patch,parent,logMsg){
  patch.updated_at=new Date().toISOString();
  const { error } = await sb.from("employee_transfers").update(patch).eq("id",t.id);
  if(error){ alert(error.message); return; }
  if(logMsg) await logChange("transfer",t.id,t.emp_name,logMsg,`${t.from_worksite||'—'} → ${t.to_worksite||'—'}`);
  if(parent) parent.remove();
  await loadEmployees(); window.go("manning");
}
function renderManning(){
  const pg=$("#page-manning"); if(!pg) return;
  const open=BRANCHES.filter(b=>b.status==="Open");
  const SCs=[...new Set(open.map(b=>b.sc).filter(x=>x&&x!=='Unassigned'))].sort();
  const totAHC=open.reduce((s,b)=>s+b.ahc_stationary+b.ahc_reliever,0);
  const totCHC=open.reduce((s,b)=>s+chcFor(b.name),0);
  const OPENINGS=MANPOWER.filter(o=>o.status==="Open");
  const opInReview=(store)=>PREHIRE.filter(p=>p.worksite===store && !["HIRED","REJECTED","DRAFT","POOLED"].includes(p.phase)).length;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Openings <span class="count-tag">${OPENINGS.length} stores · ${OPENINGS.reduce((s,o)=>s+(Number(o.count_needed)||0),0)} positions</span></h2>
      <div class="psub">Manpower requests you post. These drive the agency links — each agency sees the shortfall + an in-review count, then submits candidates into the pipeline.</div>
      <div class="actionbar">${canPostOpenings()?'<button class="btn" id="opNew">+ Post opening</button> ':''}${canManageStores()?'<button class="btn ghost" id="stNew">+ Add store</button>':''}${!canPostOpenings()?'<span class="psub" style="margin:0;">Openings open automatically when someone resigns. You can view and fill them below.</span>':''}</div>
      ${OPENINGS.length?`<table><thead><tr><th>Store</th><th>SC</th><th>Need</th><th>In review</th><th>Posted</th><th>Deadline</th><th></th></tr></thead><tbody id="opRows"></tbody></table>`:`<div class="psub" style="margin-top:6px;">No open requests yet — click “Post opening”.</div>`}
    </div>
    ${manningTransfersPanel()}
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
        ${["All",...SCs].map(s=>{ const gone=s!=="All"&&scIsGone(s); return `<div class="chip${s===scFilter?' active':''}" data-sc="${esc(s)}"${gone?' style="color:var(--red);border-color:#f1c9c5;font-weight:700;"':''}>${gone?'● ':''}${esc(s)}${s!=="All"?` (${open.filter(b=>b.sc===s).length})`:""}</div>`; }).join("")}
      </div>
      <div id="scBlocks"></div>
    </div>`;
  const opNewBtn=$("#opNew"); if(opNewBtn) opNewBtn.addEventListener("click",()=>openingForm());
  const stNewBtn=$("#stNew"); if(stNewBtn) stNewBtn.addEventListener("click",()=>storeForm());
  wireTransfers();
  const opRows=$("#opRows");
  if(opRows){
    const today=new Date(new Date().toDateString());
    opRows.innerHTML=OPENINGS.map(o=>{
      const overdue=o.target_fill_date && new Date(o.target_fill_date+"T00:00:00")<today;
      let dl;
      if(o.priority==="Urgent"&&!o.target_fill_date) dl=`<span class="pill awol">Urgent</span>`;
      else if(o.target_fill_date) dl=`${fmtDate(o.target_fill_date)}${overdue?' <span class="pill awol">overdue</span>':''}`;
      else dl=`<span class="note">—</span>`;
      const dtag=o.diser_type==="Roving"?` <span class="pill ag">Roving</span>${o.second_worksite?`<div style="font-size:11px;color:var(--muted);">+ ${esc(o.second_worksite)}</div>`:""}`:` <span class="pill di">Stationary</span>`;
      return `<tr><td><b>${esc(o.worksite)}</b>${dtag}<div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(o.position||"Merchandiser")}</div></td><td>${esc(o.sc||"—")}</td><td>${o.count_needed}</td><td>${opInReview(o.worksite)}</td><td>${o.date_posted?fmtDate(o.date_posted):"—"}</td><td>${dl}</td>
        <td style="text-align:right;white-space:nowrap;">${canPostOpenings()?`<button class="btn ghost" data-opedit="${o.id}">Edit</button> <button class="btn ghost" data-opclose="${o.id}" style="color:var(--red);border-color:#f1c9c5;">Close</button>`:'<span class="note">—</span>'}</td></tr>`;
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
      // Coordinator-departure is intentionally NOT flagged on this card (anj, 2026-07-25) — a resignation
      // surfaces as a DASHBOARD prompt instead. Admins keep a discreet "SC status" control to record one.
      return `<div class="panel" style="margin-top:14px;">
        <div class="sc-card">
          <div class="sc-av">${esc(sc[0])}</div>
          <div style="flex:1;"><div class="sc-l">Sales Coordinator</div><div class="sc-n">${esc(sc)}</div></div>
          <div style="text-align:center;"><div class="sc-l">Stores</div><div class="sc-n">${stores.length}</div></div>
          <div style="text-align:center;"><div class="sc-l">Approved</div><div class="sc-n">${ahc}</div></div>
          <div style="text-align:center;"><div class="sc-l">Confirmed</div><div class="sc-n">${chc}</div></div>
          <div style="text-align:center;"><div class="sc-l">Shortfall</div><div class="sc-n" style="color:${def>0?'var(--red)':'var(--green-dark)'}">${def}</div></div>
          ${canManageStores()?`<button class="btn ghost" data-scstatus="${esc(sc)}" style="flex-shrink:0;font-size:11px;color:var(--muted);border-color:var(--line,#dbe4dd);padding:4px 9px;">SC status</button>`:""}
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
    $$("#scBlocks [data-scstatus]").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); scStatusPrompt(b.dataset.scstatus); }));
  };
  $$("#scChips .chip").forEach(c=>c.addEventListener("click",()=>{ scFilter=c.dataset.sc; renderManning(); }));
  paint();
}
function scStatusPrompt(sc){
  const cur=scStatus(sc), curNote=(SC_STATUS[sc]&&SC_STATUS[sc].note)||"";
  let m=document.getElementById("scModal"); if(!m){ m=document.createElement("div"); m.id="scModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:22px;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:4px;">Coordinator status — ${esc(sc)}</h2>
    <div class="psub">Marks the SC seat. When it's Vacant or Pending, ${esc(sc)}'s stores show red in Manning so the gap is visible.</div>
    ${sel("sc_status","Status",["Active","Vacant","Pending"],cur)}
    <div style="margin:6px 0 10px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">Note (optional)</label>
      <input id="sc_note" value="${esc(curNote)}" placeholder="e.g. resigned 07/15 — Bryan covering interim" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;font-size:13.5px;"></div>
    <div style="display:flex;gap:10px;"><button class="btn ghost" id="scCancel" style="flex:1;">Cancel</button><button class="btn" id="scSave" style="flex:1;">Save</button></div>
  </div>`;
  m.addEventListener("click",e=>{ if(e.target===m) m.remove(); });
  document.getElementById("scCancel").onclick=()=>m.remove();
  document.getElementById("scSave").onclick=async()=>{
    const btn=document.getElementById("scSave"); btn.disabled=true; btn.textContent="Saving…";
    await setScStatus(sc, v("sc_status")||"Active", v("sc_note"));
    m.remove(); renderManning(); renderDashboard();
  };
}
function openingForm(o){
  const isNew=!o; o=o||{};
  const stores=[...new Set(BRANCHES.map(b=>b.name))].sort();
  let m=document.getElementById("opModal"); if(!m){ m=document.createElement("div"); m.id="opModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:22px;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:8px;">${isNew?"Post an opening":"Edit opening"}</h2>
    ${sel("op_store","Store *",stores,o.worksite)}
    ${sel("op_position","Position *",["Merchandiser","Lead Diser","Store Coordinator","Store Supervisor"],o.position||"Merchandiser")}
    ${sel("op_dtype","Diser type *",["Stationary","Roving"],o.diser_type||"Stationary")}
    <div id="op_secondWrap" style="display:${(o.diser_type==="Roving")?'block':'none'};">${sel("op_store2","Also covers (2nd branch)",stores,o.second_worksite)}
      <div class="psub" style="margin:-4px 0 8px;">Roving diser — the other store this person will also be assigned to.</div></div>
    ${fld("op_count","How many needed *",o.count_needed??1,"number")}
    ${sel("op_priority","Priority",["Normal","Urgent"],o.priority||"Normal")}
    ${fld("op_fill","Fill-by date (optional)",o.target_fill_date,"date")}
    <div class="psub" style="margin:-4px 0 8px;">Leave the date blank and set Priority = Urgent if it's just “needed now”.</div>
    ${demoChk("op_isdemo",o.is_demo)}
    <div id="opMsg" style="font-size:13px;color:#a4322a;margin:4px 0;"></div>
    <div style="display:flex;gap:10px;"><button class="btn ghost" id="opCancel" style="flex:1;">Cancel</button><button class="btn" id="opSave" style="flex:1;">${isNew?"Post opening":"Save"}</button></div>
  </div>`;
  m.addEventListener("click",e=>{ if(e.target===m) m.remove(); });
  const dtypeSel=document.getElementById("op_dtype");
  if(dtypeSel) dtypeSel.addEventListener("change",()=>{ const w=document.getElementById("op_secondWrap"); if(w) w.style.display=dtypeSel.value==="Roving"?'block':'none'; });
  document.getElementById("opCancel").addEventListener("click",()=>m.remove());
  document.getElementById("opSave").addEventListener("click",async()=>{
    const store=v("op_store"); if(!store){ document.getElementById("opMsg").textContent="Pick a store."; return; }
    const br=BRANCHES.find(b=>b.name===store);
    const dtype=v("op_dtype")||"Stationary";
    const payload={ worksite:store, sc:br?br.sc:null, count_needed:nv("op_count")||1, priority:v("op_priority")||"Normal",
      position:v("op_position")||"Merchandiser",
      diser_type:dtype, second_worksite:dtype==="Roving"?(v("op_store2")||null):null,
      target_fill_date:v("op_fill")||null, status:"Open", is_demo:demoChecked("op_isdemo"), updated_at:new Date().toISOString() };
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

/* ---------- GLOBAL SEARCH (topbar) — universal, access-gated ---------- */
// One bar: type any name/word/ref and it pulls matches from every module the
// logged-in user is allowed to see (pageAllowed gates each group), click to open.
function wireGlobalSearch(){
  const s=$(".topbar .search"); if(!s||s.dataset.wired) return; s.dataset.wired="1";
  s.placeholder="Search anything — people, stores, memos, loans, exits…";
  const bar=s.parentElement; if(bar) bar.style.position="relative";
  let dd=document.getElementById("gsDrop");
  if(!dd){ dd=document.createElement("div"); dd.id="gsDrop"; bar.appendChild(dd); }
  dd.style.cssText="position:absolute;top:100%;right:0;margin-top:6px;width:min(480px,82vw);max-height:72vh;overflow-y:auto;background:#fff;border:1px solid #e2e7e4;border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.16);z-index:9997;display:none;";
  let ACTS=[];
  const hide=()=>{ dd.style.display="none"; };
  const run=(i)=>{ const a=ACTS[i]; hide(); if(typeof a==="function"){ try{a();}catch(err){} } };
  const build=(raw)=>{
    const q=(raw||"").trim().toLowerCase(); ACTS=[];
    if(q.length<2){ hide(); return; }
    const mt=(...fs)=>fs.some(f=>f&&String(f).toLowerCase().includes(q));
    const groups=[];
    const add=(pageId,title,items)=>{ if(!pageAllowed(pageId)||!items.length) return; groups.push({title,items:items.slice(0,6)}); };
    add('employees','People', EMPLOYEES.filter(e=>mt(e.full_name,e.position,e.worksite,e.department,e.employee_id,e.agency_name,e.email)).map(e=>({label:e.full_name,sub:[e.position,e.worksite].filter(Boolean).join(' · '),act:()=>openRecord(e)})));
    add('branches','Stores', BRANCHES.filter(b=>mt(b.name,b.sc,b.city,b.area)).map(b=>({label:b.name,sub:['SC '+(b.sc||'—'),b.city].filter(Boolean).join(' · '),act:()=>openStore(b)})));
    add('memos','Memos', MEMOS.filter(m=>mt(m.subject_name,m.ref_no,m.memo_type)).map(m=>({label:m.subject_name||m.ref_no,sub:['Memo',m.memo_type,m.ref_no].filter(Boolean).join(' · '),act:()=>viewMemo(m.id)})));
    add('loans','Loans', LOANS.filter(l=>mt(l.applicant_name,l.loan_ref,l.loan_type,l.department)).map(l=>({label:l.applicant_name,sub:['Loan',loanTypeLabel(l.loan_type),l.loan_ref].filter(Boolean).join(' · '),act:()=>openLoan(l.id)})));
    add('exit','Exit clearance', EXITCASES.filter(x=>mt(x.employee_name,x.position,x.department,x.clearance_id,x.separation_type)).map(x=>({label:x.employee_name,sub:['Exit',x.separation_type].filter(Boolean).join(' · '),act:()=>openExitCase(x.id)})));
    add('movements','Movements / NPA', NPAS.filter(r=>mt(r.employee_name,r.npa_id,r.action,r.new_position)).map(r=>({label:r.employee_name,sub:['NPA',r.action,r.npa_id].filter(Boolean).join(' · '),act:()=>openMovementDrawer(r)})));
    add('prehire','Pre-hire', PREHIRE.filter(c=>mt(c.full_name,c.position,c.worksite,c.prehire_id)).map(c=>({label:c.full_name,sub:['Pre-hire',c.position].filter(Boolean).join(' · '),act:()=>openPrehire(c)})));
    add('onboarding','Onboarding', ONBOARDING.filter(o=>mt(o.employee_name,o.position,o.worksite)).map(o=>({label:o.employee_name,sub:['Onboarding',o.position].filter(Boolean).join(' · '),act:()=>openOnboardingCase(o.id)})));
    add('maternity','Maternity', MATERNITY.filter(c=>mt(c.employee_name,c.claim_ref,c.category)).map(c=>({label:c.employee_name,sub:['Maternity',c.claim_ref].filter(Boolean).join(' · '),act:()=>openMaternityForm(c)})));
    add('contracts','Contracts', CONTRACTS.filter(c=>mt(c.employee_name)).map(c=>({label:c.employee_name,sub:'Contract',act:()=>openContract(c.id)})));
    add('signatures','Signatures', SIGNATURES.filter(x=>mt(x.subject_name,x.doc_type)).map(x=>({label:x.subject_name||'(unnamed)',sub:['Signature',x.doc_type].filter(Boolean).join(' · '),act:()=>openSignDoc(x.id)})));
    if(!groups.length){ dd.innerHTML='<div style="padding:14px;color:#6a766f;font-size:13px;">No matches you have access to.</div>'; dd.style.display="block"; return; }
    let html='', idx=0;
    groups.forEach(g=>{
      html+=`<div style="padding:8px 14px 3px;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#8a938c;background:#f7f9f8;">${esc(g.title)}</div>`;
      g.items.forEach(it=>{ ACTS.push(it.act); html+=`<div class="gsRow" data-i="${idx}" style="padding:9px 14px;cursor:pointer;border-top:0.5px solid #f0f2f0;"><div style="font-size:13.5px;font-weight:600;color:#17281d;">${esc(it.label||'—')}</div>${it.sub?`<div style="font-size:11.5px;color:#6a766f;">${esc(it.sub)}</div>`:''}</div>`; idx++; });
    });
    dd.innerHTML=html; dd.style.display="block";
    dd.querySelectorAll('.gsRow').forEach(r=>{
      r.addEventListener('mouseenter',()=>r.style.background='#f1f7f3');
      r.addEventListener('mouseleave',()=>r.style.background='');
      r.addEventListener('mousedown',ev=>{ ev.preventDefault(); run(+r.dataset.i); s.value=''; });
    });
  };
  s.addEventListener("input",()=>build(s.value));
  s.addEventListener("focus",()=>{ if((s.value||"").trim().length>=2) build(s.value); });
  s.addEventListener("keydown",e=>{ if(e.key==="Escape"){ hide(); s.blur(); } });
  document.addEventListener("click",e=>{ if(bar && !bar.contains(e.target)) hide(); });
}

/* ============================ HR DESK — notes · ideas · pending tasks ============================ */
const DMINI='style="font-size:11.5px;padding:4px 9px;border:1px solid #cfe0d5;background:#fff;border-radius:7px;cursor:pointer;white-space:nowrap;"';
function deskTodayMid(){ const n=new Date(); n.setHours(0,0,0,0); return n; }
function deskOverdue(t){ if(!t.due_date) return false; return new Date(t.due_date+"T00:00:00")<deskTodayMid(); }
function deskDueChip(due){
  if(!due) return '';
  const d=new Date(due+"T00:00:00"), days=Math.round((d-deskTodayMid())/86400000);
  let bg='#e8f3ec',fg='#0f6e56',txt="in "+days+"d";
  if(days<0){ bg='#fbe9e7'; fg='#a4322a'; txt=(-days)+"d overdue"; }
  else if(days===0){ bg='#fef3d9'; fg='#8a5a00'; txt="due today"; }
  else if(days<=3){ bg='#fef3d9'; fg='#8a5a00'; }
  return `<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;background:${bg};color:${fg};">${txt}</span>`;
}
function canMarkTask(t){ const me=myEmail(); return isAdminUser()||userRole()==="manager"||t.assignee_email===me||t.assigned_by===me; }
function deskByDue(a,b){ const x=a.due_date||"9999", y=b.due_date||"9999"; return x<y?-1:x>y?1:0; }

async function reloadDesk(){
  const [n,i,t]=await Promise.all([
    sb.from("hr_notes").select("*").order("created_at",{ascending:false}),
    sb.from("hr_ideas").select("*").order("created_at",{ascending:false}),
    sb.from("hr_tasks").select("*").order("created_at",{ascending:false})
  ]);
  HR_NOTES=(n&&n.data)||HR_NOTES; HR_IDEAS=(i&&i.data)||HR_IDEAS; HR_TASKS=(t&&t.data)||HR_TASKS;
  renderDesk();
}
/* notes */
async function deskAddNote(){ await sb.from("hr_notes").insert({owner_email:myEmail(), body:"", color:"yellow"}); await reloadDesk(); setTimeout(()=>{ const f=document.querySelector('#deskNotes textarea'); if(f) f.focus(); },40); }
async function deskSaveNote(id,body){ await sb.from("hr_notes").update({body, updated_at:new Date().toISOString()}).eq("id",id); const n=HR_NOTES.find(x=>x.id===id); if(n) n.body=body; }
async function deskNoteDone(id,done){ await sb.from("hr_notes").update({done, updated_at:new Date().toISOString()}).eq("id",id); await reloadDesk(); }
async function deskDeleteNote(id){ if(!confirm("Delete this note?")) return; await sb.from("hr_notes").delete().eq("id",id); await reloadDesk(); }
/* ideas */
async function deskSendIdea(){ const t=document.getElementById("ideaTitle"), d=document.getElementById("ideaDetail"); const title=(t.value||"").trim(); if(!title){ t.focus(); return; } await sb.from("hr_ideas").insert({from_email:myEmail(), from_name:myName(), title, detail:(d.value||"").trim()||null}); t.value=""; d.value=""; await reloadDesk(); }
async function deskIdeaStatus(id,status){ await sb.from("hr_ideas").update({status}).eq("id",id); await reloadDesk(); }
/* tasks */
async function deskAddTask(){ const el=id=>document.getElementById(id); const title=(el("taskTitle").value||"").trim(); if(!title){ el("taskTitle").focus(); return; } const assignee=el("taskAssignee").value||null; await sb.from("hr_tasks").insert({ title, detail:(el("taskDetail").value||"").trim()||null, assignee_email:assignee, assignee_name:assignee?nameForEmail(assignee):null, assigned_by:myEmail(), assigned_by_name:myName(), due_date:el("taskDue").value||null, ongoing:el("taskOngoing").checked, status:"Open" }); el("taskTitle").value=""; el("taskDetail").value=""; el("taskDue").value=""; el("taskOngoing").checked=false; await reloadDesk(); }
async function deskTaskDone(id){ await sb.from("hr_tasks").update({status:"Done", completed_at:new Date().toISOString(), completed_by:myName()}).eq("id",id); await reloadDesk(); }
async function deskTaskReopen(id){ await sb.from("hr_tasks").update({status:"Open", completed_at:null, completed_by:null}).eq("id",id); await reloadDesk(); }
async function deskDeleteTask(id){ if(!confirm("Delete this task?")) return; await sb.from("hr_tasks").delete().eq("id",id); await reloadDesk(); }

function deskTaskRow(t){
  const del=(isAdminUser()||t.assigned_by===myEmail());
  return `<div class="task" style="align-items:flex-start;">
    <div class="dot ${t.ongoing?'a':(deskOverdue(t)?'r':'g')}"></div>
    <div style="flex:1;"><div class="tt">${esc(t.title)} ${deskDueChip(t.due_date)}</div>
      <div class="td">${t.assignee_name?('→ '+esc(t.assignee_name)):'unassigned'}${t.assigned_by_name?(' · by '+esc(t.assigned_by_name)):''}${t.detail?(' · '+esc(t.detail)):''}</div></div>
    <div style="display:flex;gap:6px;">${canMarkTask(t)?`<button ${DMINI} data-taskdone="${t.id}">Mark done</button>`:''}${del?`<button ${DMINI} data-taskdel="${t.id}">✕</button>`:''}</div>
  </div>`;
}

function renderDesk(){
  const root=document.getElementById("deskRoot"); if(!root) return;
  const me=myEmail(), admin=isAdminUser(), mgr=admin||userRole()==="manager";
  const myNotes=HR_NOTES.filter(n=>n.owner_email===me && !n.done);
  const myNotesDone=HR_NOTES.filter(n=>n.owner_email===me && n.done).length;
  const mineTasks=HR_TASKS.filter(t=>t.status==="Open" && !t.ongoing && t.assignee_email===me).sort(deskByDue);
  const ongoing=HR_TASKS.filter(t=>t.status==="Open" && t.ongoing).sort(deskByDue);
  const teamTasks=(mgr?HR_TASKS.filter(t=>t.status==="Open"&&!t.ongoing&&t.assignee_email!==me):HR_TASKS.filter(t=>t.status==="Open"&&!t.ongoing&&t.assigned_by===me&&t.assignee_email!==me)).sort(deskByDue);
  const doneRecent=HR_TASKS.filter(t=>t.status==="Done").slice(0,8);
  const newIdeas=HR_IDEAS.filter(i=>i.status==="New").length;
  const ideasList=admin?HR_IDEAS:HR_IDEAS.filter(i=>i.from_email===me);

  const badge=document.getElementById("deskBadge");
  if(badge){ const c=mineTasks.filter(t=>deskOverdue(t)||(t.due_date&&deskDueChip(t.due_date).includes("today"))).length + (admin?newIdeas:0); badge.textContent=c||""; badge.style.display=c?"":"none"; }

  const notesHtml=`<div class="panel" style="margin-top:0;">
    <div style="display:flex;justify-content:space-between;align-items:center;"><h2 style="margin:0;">My notes</h2><button ${DMINI} id="deskAddNote">+ Add note</button></div>
    <div class="psub">Private sticky notes — only you see these. Type freely; edits save automatically. Tick ✓ Done to file it away.</div>
    <div id="deskNotes" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:12px;margin-top:10px;">
      ${myNotes.length?myNotes.map(n=>`<div style="background:#fff7cc;border:1px solid #efe08a;border-radius:10px;padding:10px;display:flex;flex-direction:column;min-height:118px;">
        <textarea data-note="${n.id}" placeholder="Write a note…" style="flex:1;border:none;background:transparent;resize:none;font-size:13px;line-height:1.4;outline:none;min-height:66px;font-family:inherit;color:#4a3f14;">${esc(n.body||"")}</textarea>
        <div style="display:flex;justify-content:space-between;margin-top:6px;"><button ${DMINI} data-notedone="${n.id}">✓ Done</button><button ${DMINI} data-notedel="${n.id}">Delete</button></div></div>`).join(""):`<div class="psub" style="grid-column:1/-1;">No notes yet — click “+ Add note”.</div>`}
    </div>
    ${myNotesDone?`<div class="psub" style="margin-top:8px;">${myNotesDone} note(s) marked done (hidden).</div>`:""}
  </div>`;

  const ideaInbox=admin?`<div style="margin-top:12px;"><div class="subhead">Ideas inbox <span class="count-tag">${HR_IDEAS.length}</span></div>
    ${HR_IDEAS.length?HR_IDEAS.map(i=>`<div class="task" style="align-items:flex-start;"><div class="dot ${i.status==='New'?'a':'g'}"></div><div style="flex:1;"><div class="tt">${esc(i.title)} <span style="font-size:11px;color:#8a938c;">· ${esc(i.status)}</span></div><div class="td">from ${esc(i.from_name||i.from_email)}${i.detail?(' · '+esc(i.detail)):''}</div></div><div style="display:flex;gap:6px;">${i.status!=='Reviewed'?`<button ${DMINI} data-ideastatus="Reviewed" data-idea="${i.id}">Reviewed</button>`:''}${i.status!=='Actioned'?`<button ${DMINI} data-ideastatus="Actioned" data-idea="${i.id}">Actioned</button>`:''}${i.status!=='Archived'?`<button ${DMINI} data-ideastatus="Archived" data-idea="${i.id}">Archive</button>`:''}</div></div>`).join(""):`<div class="psub">No ideas submitted yet.</div>`}</div>`
    :`<div style="margin-top:12px;"><div class="subhead">Your suggestions</div>${ideasList.length?ideasList.map(i=>`<div class="task"><div class="dot ${i.status==='New'?'a':'g'}"></div><div><div class="tt">${esc(i.title)}</div><div class="td">${esc(i.status)}${i.detail?(' · '+esc(i.detail)):''}</div></div></div>`).join(""):`<div class="psub">You haven’t sent any yet.</div>`}</div>`;

  const ideasHtml=`<div class="panel">
    <h2 style="margin:0 0 2px;">💡 Ideas &amp; suggestions</h2>
    <div class="psub">Share an idea with anj and the team — anything that could make the work better. ${admin?"New ideas land in your inbox below.":"anj sees these; you’ll see the status here."}</div>
    <input id="ideaTitle" placeholder="Your idea in one line…" style="width:100%;margin-top:8px;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;">
    <textarea id="ideaDetail" rows="2" placeholder="Any detail (optional)" style="width:100%;margin-top:8px;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;font-family:inherit;"></textarea>
    <div style="margin-top:8px;"><button class="btn" id="ideaSend">Share idea</button></div>
    ${ideaInbox}
  </div>`;

  const assignOpts=['<option value="">— assign to —</option>'].concat(HR_TEAM.map(m=>`<option value="${m.email}">${esc(m.name)}</option>`)).join("");
  const tasksHtml=`<div class="panel">
    <h2 style="margin:0 0 2px;">Pending tasks</h2>
    <div class="psub">Assign an action to whoever’s responsible, with a due date. They see it under “Assigned to me” and tick it done. Ongoing items sit at the bottom.</div>
    <div style="background:#f6f9f7;border:1px solid #e2e7e4;border-radius:10px;padding:11px;margin-top:10px;">
      <input id="taskTitle" placeholder="What needs doing? e.g. Memo issuance for attendance concerns" style="width:100%;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <select id="taskAssignee" style="flex:1;min-width:160px;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;background:#fff;">${assignOpts}</select>
        <input id="taskDue" type="date" style="padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#4a544c;"><input id="taskOngoing" type="checkbox"> Ongoing</label>
      </div>
      <input id="taskDetail" placeholder="Detail (optional)" style="width:100%;margin-top:8px;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;">
      <div style="margin-top:8px;"><button class="btn" id="taskAdd">Add task</button></div>
    </div>
    <div class="subhead" style="margin-top:14px;">Assigned to me <span class="count-tag">${mineTasks.length}</span></div>
    ${mineTasks.length?mineTasks.map(deskTaskRow).join(""):`<div class="psub">Nothing on your plate right now.</div>`}
    <div class="subhead" style="margin-top:14px;">${mgr?"Team — all open tasks":"Tasks I assigned"} <span class="count-tag">${teamTasks.length}</span></div>
    ${teamTasks.length?teamTasks.map(deskTaskRow).join(""):`<div class="psub">${mgr?"No other open tasks.":"You haven’t assigned any."}</div>`}
    <div class="subhead" style="margin-top:14px;color:#8a5a00;">Ongoing <span class="count-tag">${ongoing.length}</span></div>
    ${ongoing.length?ongoing.map(deskTaskRow).join(""):`<div class="psub">No ongoing items.</div>`}
    ${doneRecent.length?`<div class="subhead" style="margin-top:14px;">Recently done</div>${doneRecent.map(t=>`<div class="task"><div class="dot g"></div><div style="flex:1;"><div class="tt" style="text-decoration:line-through;color:#7a847c;">${esc(t.title)}</div><div class="td">done by ${esc(t.completed_by||"—")}${t.completed_at?(" · "+fmtDate(t.completed_at)):""}</div></div>${canMarkTask(t)?`<button ${DMINI} data-taskreopen="${t.id}">Reopen</button>`:''}</div>`).join("")}`:""}
  </div>`;

  root.innerHTML=notesHtml+ideasHtml+tasksHtml;

  // wire
  const q=s=>root.querySelectorAll(s);
  const add=document.getElementById("deskAddNote"); if(add) add.onclick=deskAddNote;
  q('textarea[data-note]').forEach(t=>t.addEventListener("blur",()=>deskSaveNote(+t.dataset.note, t.value)));
  q('[data-notedone]').forEach(b=>b.onclick=()=>deskNoteDone(+b.dataset.notedone,true));
  q('[data-notedel]').forEach(b=>b.onclick=()=>deskDeleteNote(+b.dataset.notedel));
  const isend=document.getElementById("ideaSend"); if(isend) isend.onclick=deskSendIdea;
  q('[data-ideastatus]').forEach(b=>b.onclick=()=>deskIdeaStatus(+b.dataset.idea, b.dataset.ideastatus));
  const tadd=document.getElementById("taskAdd"); if(tadd) tadd.onclick=deskAddTask;
  q('[data-taskdone]').forEach(b=>b.onclick=()=>deskTaskDone(+b.dataset.taskdone));
  q('[data-taskreopen]').forEach(b=>b.onclick=()=>deskTaskReopen(+b.dataset.taskreopen));
  q('[data-taskdel]').forEach(b=>b.onclick=()=>deskDeleteTask(+b.dataset.taskdel));
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
        ${isNew?fld("f_full_name","Full name *",e.full_name):roField("Full name",e.full_name)}
        ${isNew?sel("f_department","Department",DEPARTMENTS,e.department):roField("Department",e.department)}
        ${isNew?fld("f_group_name","Group (auto)",e.group_name):""}
        ${isNew?fld("f_position","Position",e.position):roField("Position",e.position)}
        ${isNew?sel("f_hire_source","Hire source",HIRE_SOURCES,e.hire_source):roField("Hire source",e.hire_source)}
        ${isNew?sel("f_status","Status",STATUSES,e.status||"Active"):roField("Status",e.status)}
        ${isNew?fld("f_employee_id","PayPlus ID",e.employee_id):roField("PayPlus ID",e.employee_id)}
        ${isNew?fld("f_agency_name","Agency name (if agency)",e.agency_name):(e.agency_name?roField("Agency",e.agency_name):"")}
        ${!isNew?'<div class="psub" style="margin-top:2px;">🔒 These come from <b>PayPlus</b> (the roster mirror) and can\'t be edited here — fix them in PayPlus and they sync back. Status changes go through Exit Clearance.</div>':''}
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
      ${canEditIds()?`<div class="panel">
        ${fld("f_sss_number","SSS",e.sss_number)}${fld("f_philhealth_number","PhilHealth",e.philhealth_number)}
        ${fld("f_pagibig_number","Pag-IBIG",e.pagibig_number)}${fld("f_tin_number","TIN",e.tin_number)}
        ${fld("f_bank_name","Bank name",e.bank_name)}${fld("f_bank_account_number","Bank account number",e.bank_account_number)}
      </div>`:canSeeIds()?`<div class="panel"><div class="subhead">Government numbers &amp; bank <span class="sh-note">view only — entered by Vina (backup: Grazel)</span></div>
        ${roField("SSS",e.sss_number)}${roField("PhilHealth",e.philhealth_number)}${roField("Pag-IBIG",e.pagibig_number)}${roField("TIN",e.tin_number)}${roField("Bank name",e.bank_name)}${roField("Bank account number",e.bank_account_number)}
      </div>`:`<div class="panel"><div style="font-size:13px;color:#6a766f;">🔒 Government IDs &amp; bank details are restricted.</div></div>`}
      <div class="panel">
        ${isNew?fld("f_worksite","Worksite",e.worksite):roField("Worksite",e.worksite)}${fld("f_supervisor_name","Supervisor",e.supervisor_name)}${fld("f_approver2_name","Approver 2",e.approver2_name)}
        ${sel("f_contract_type","Contract type",CONTRACT_TYPES,e.contract_type)}
        ${canSeePay()?`${fld("f_daily_rate","Daily rate (₱)",e.daily_rate,"number")}${fld("f_daily_allowance","Daily allowance (₱)",e.daily_allowance,"number")}`:`<div style="margin-bottom:10px;font-size:13px;color:#6a766f;">🔒 Pay (daily rate / allowance) is restricted to authorised payroll.</div>`}
        ${isNew?fld("f_hire_date","Hire date",e.hire_date,"date"):roField("Hire date",e.hire_date)}${isNew?fld("f_regularization_date","Regularization date",e.regularization_date,"date"):roField("Regularization date",e.regularization_date)}
        ${fld("f_end_date","End date",e.end_date,"date")}${sel("f_end_reason","End reason",END_REASONS,e.end_reason)}
        <div style="margin-bottom:10px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:4px;">Notes</label><textarea id="f_notes" rows="3" style="width:100%;padding:9px 11px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;">${esc(e.notes||"")}</textarea></div>
      </div>
      ${demoChk("f_isdemo",e.is_demo)}
      <div id="fMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
      <div style="display:flex;gap:10px;">
        <button class="btn ghost" id="fCancel" style="flex:1;">Cancel</button>
        <button class="btn" id="fSave" style="flex:1;">${isNew?"Create":"Save changes"}</button>
      </div>
    </div></div>`;
  const dept=document.getElementById("f_department");
  if(dept) dept.addEventListener("change",()=>{ const g=deriveGroup(dept.value); const gn=document.getElementById("f_group_name"); if(gn) gn.value=g; const b=document.getElementById("f_bank_name"); if(b&&!b.value) b.value=deriveBank(g); });
  document.getElementById("fCancel").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  document.getElementById("fSave").addEventListener("click",()=>saveEmployee(isNew?null:e.id,m));
}
const v=(id)=>{ const el=document.getElementById(id); if(!el) return null; const x=el.value.trim(); return x===""?null:x; };
const nv=(id)=>{ const el=document.getElementById(id); if(!el) return null; const x=el.value.trim(); return x===""?null:Number(x); };
async function saveEmployee(id,modal){
  const msg=document.getElementById("fMsg"), btn=document.getElementById("fSave");
  let phone=v("f_phone"); if(phone) phone=phone.replace(/[\s-]/g,"");
  const isNew=!id;
  // HRIS-owned fields — always editable
  const p={ email:v("f_email"), phone, date_of_birth:v("f_date_of_birth"), gender:v("f_gender"), civil_status:v("f_civil_status"),
    permanent_address:v("f_permanent_address"), current_address:v("f_current_address"),
    emergency_contact_name:v("f_emergency_contact_name"), emergency_contact_relation:v("f_emergency_contact_relation"), emergency_contact_number:v("f_emergency_contact_number"),
    supervisor_name:v("f_supervisor_name"), approver2_name:v("f_approver2_name"),
    contract_type:v("f_contract_type"),
    end_date:v("f_end_date"), end_reason:v("f_end_reason"),
    notes:v("f_notes"), is_demo:demoChecked("f_isdemo"), updated_at:new Date().toISOString() };
  // Roster fields (PayPlus-owned) — only written when ADDING a new person (pre-PayPlus). On existing records these render read-only, so we never touch them here (fixing them = fix in PayPlus, syncs back).
  if(isNew){ Object.assign(p,{ full_name:v("f_full_name"), department:v("f_department"), group_name:v("f_group_name")||deriveGroup((document.getElementById("f_department")||{}).value)||null,
    position:v("f_position"), hire_source:v("f_hire_source"), status:v("f_status")||"Active", employee_id:v("f_employee_id"), agency_name:v("f_agency_name"),
    worksite:v("f_worksite"), hire_date:v("f_hire_date"), regularization_date:v("f_regularization_date") }); }
  // gov IDs + bank written ONLY by the sole editor (Vina/owners) — others never touch these columns (their form shows read-only, no inputs)
  if(canEditIds()){ Object.assign(p,{ sss_number:v("f_sss_number"), philhealth_number:v("f_philhealth_number"), pagibig_number:v("f_pagibig_number"), tin_number:v("f_tin_number"), bank_name:v("f_bank_name"), bank_account_number:v("f_bank_account_number") }); }
  if(canSeePay()){ Object.assign(p,{ daily_rate:nv("f_daily_rate"), daily_allowance:nv("f_daily_allowance") }); }
  const before = id ? (EMPLOYEES.find(e=>e.id===id)||{}) : {};
  const nameForLog = isNew ? p.full_name : before.full_name;
  if(isNew && !p.full_name){ msg.textContent="Full name is required."; return; }
  btn.disabled=true; btn.textContent="Saving…";
  const res=id? await sb.from("employees").update(p).eq("id",id) : await sb.from("employees").insert(p);
  btn.disabled=false; btn.textContent=id?"Save changes":"Create";
  if(res.error){ msg.textContent=res.error.message; return; }
  // log SENSITIVE changes for the owner audit trail
  if(id){
    const ch=[];
    if(canSeePay()){
      if(Number(before.daily_rate||0)!==Number(p.daily_rate||0)) ch.push("Daily rate "+(before.daily_rate?"₱"+Number(before.daily_rate).toLocaleString():"—")+" → "+(p.daily_rate?"₱"+Number(p.daily_rate).toLocaleString():"—"));
      if(Number(before.daily_allowance||0)!==Number(p.daily_allowance||0)) ch.push("Allowance "+(before.daily_allowance?"₱"+Number(before.daily_allowance).toLocaleString():"—")+" → "+(p.daily_allowance?"₱"+Number(p.daily_allowance).toLocaleString():"—"));
    }
    if(canEditIds()){  // bank/gov entered by Vina/owners — log who changed them
      if((before.bank_account_number||"")!==(p.bank_account_number||"")) ch.push("Bank account changed");
      if((before.bank_name||"")!==(p.bank_name||"")) ch.push("Bank name changed");
      ["sss_number","philhealth_number","pagibig_number","tin_number"].forEach(k=>{ if((before[k]||"")!==(p[k]||"")) ch.push(k.replace("_number","").toUpperCase()+" changed"); });
    }
    if(ch.length) await logChange("employee",id,nameForLog,"Sensitive field edited",ch.join(" · "));
  } else { await logChange("employee",null,nameForLog,"Added",""); }
  modal.remove(); await loadEmployees();
}

/* ============================ EVALUATIONS MODULE ============================ */
const EVAL_CRITERIA=["Quality of work","Attendance & punctuality","Attitude & teamwork","Job knowledge","Initiative & reliability"];
const EVAL_RECS={ "regularization":["Regularize","Extend probation","Do not regularize"], "3rd-month":["On track","Needs coaching","At risk"], "5th-month":["On track","Needs coaching","At risk"], "annual":["Exceeds expectations","Meets expectations","Below expectations"] };
const EVAL_LABEL={ "3rd-month":"2.5-month review","5th-month":"5.5-month review","regularization":"Regularization","annual":"Annual review" };
function evAddMonths(d,n){ const x=new Date(d); const day=x.getDate(); x.setMonth(x.getMonth()+n); if(x.getDate()<day) x.setDate(0); return x; }
function evAddDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
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
    // Probationary track — only 2026-onward hires (earlier hires are already past probation)
    if(hire.getFullYear()>=2026 && tenureMo<8){ cands.push(["3rd-month",evAddDays(evAddMonths(hire,2),15)]); cands.push(["5th-month",evAddDays(evAddMonths(hire,5),15)]); cands.push(["regularization",evAddMonths(hire,6)]); }  /* 2.5-mo & 5.5-mo check-ins (half-month buffer); regularization at 6 */
    // Annual track — starts 2027 (no annual reviews generated in 2026)
    if(today.getFullYear()>=2027 && tenureMo>=11){ let ann=new Date(today.getFullYear(),hire.getMonth(),hire.getDate()); if(ann<backstop) ann=new Date(today.getFullYear()+1,hire.getMonth(),hire.getDate()); cands.push(["annual",ann]); }
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
  const today=new Date();
  const list=evDueList();
  const due=list.filter(x=>x.bucket==="due"), overdue=list.filter(x=>x.bucket==="overdue"), upcoming=list.filter(x=>x.bucket==="upcoming");
  const noHire=EMPLOYEES.filter(e=>(e.status||"").toLowerCase().startsWith("active")&&!e.hire_date).length;
  const card=(l,n)=>`<div class="kpi"><div class="k-l">${l}</div><div class="k-n">${n}</div></div>`;
  const itemRow=(x)=>`<div class="task" style="cursor:pointer;align-items:center;" onclick="openEvalForm('${x.emp.id}','${x.type}','${x.due}')">
      <div class="dot ${x.bucket==='overdue'?'r':(x.bucket==='due'?'a':'g')}"></div>
      <div style="flex:1;min-width:0;"><div class="tt">${esc(x.emp.full_name)}</div><div class="td">${EVAL_LABEL[x.type]} · ${esc(x.emp.position||x.emp.department||"")}</div></div>
      <div style="text-align:right;flex-shrink:0;"><div style="font-size:12px;font-weight:700;color:${x.bucket==='overdue'?'#c0392b':'#6a766f'};">${fmtDate(x.due)}</div>
        <div style="margin-top:3px;display:flex;gap:6px;justify-content:flex-end;">
          <button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="event.stopPropagation();openEvalForm('${x.emp.id}','${x.type}','${x.due}')">Record</button>
          <button class="btn ghost" style="padding:4px 10px;font-size:12px;" title="Already evaluated on paper — clear it from pending" onclick="event.stopPropagation();evMarkPrePortal('${x.emp.id}','${x.type}','${x.due}')">Done on paper</button>
        </div></div></div>`;
  const byType=(t)=>list.filter(x=>x.type===t);
  const typeSection=(t,title,sub)=>{ const arr=byType(t); return `<div class="panel"><h2>${title} <span class="count-tag">${arr.length}</span></h2>${sub?`<div class="psub" style="margin:2px 0 8px;">${sub}</div>`:""}${arr.length?arr.map(itemRow).join(""):`<div class="psub">Nothing due.</div>`}</div>`; };
  const recent=EVALUATIONS.slice(0,10).map(e=>`<div class="task" style="align-items:center;"><div class="dot g"></div><div style="flex:1;"><div class="tt">${esc(e.employee_name||"")}</div><div class="td">${EVAL_LABEL[e.eval_type]||e.eval_type} · ${esc(e.recommendation||"")}${e.overall_rating?` · ${e.overall_rating}/5`:""}</div></div><div style="font-size:12px;color:#6a766f;flex-shrink:0;">${e.eval_date?fmtDate(e.eval_date):""}${e.evaluator?`<div style="font-size:10.5px;">${esc(e.evaluator)}</div>`:""}</div></div>`).join("");
  const annualBlock = today.getFullYear()>=2027
    ? typeSection("annual","Annual reviews","Yearly performance review for regular employees.")
    : `<div class="panel"><h2>Annual reviews</h2><div class="psub">Annual performance reviews for regular staff <b>start 2027</b> — nothing is scheduled for 2026.</div></div>`;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Evaluations</h2>
      <div class="psub">Auto-computed from each employee's <b>hire date</b>. Probationary reviews (3rd / 5th month + regularization) cover <b>2026 hires only</b> — earlier staff are already past probation. Annual reviews start 2027.${noHire?` <span style="color:#9a6a00;">⚠ ${noHire} active staff have no hire date yet — upload the hires list to include them.</span>`:""}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px;">${card("Due this month",due.length)}${card("Overdue",overdue.length)}${card("Upcoming 60d",upcoming.length)}${card("Completed",EVALUATIONS.length)}</div>
      ${overdue.length?`<div style="margin-top:12px;padding:10px 12px;background:#eef4ef;border:1px solid var(--line);border-radius:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div style="flex:1;min-width:190px;font-size:12.5px;color:var(--muted);">Already did some of these <b>on paper</b> before the portal? Clear the backlog so it stops flagging them.</div><button class="btn ghost" onclick="evClearBacklog()" style="flex-shrink:0;">✓ Clear ${overdue.length} overdue as done pre-portal…</button></div>`:""}
    </div>
    ${typeSection("3rd-month","First review · 2.5 months","Early coaching check-in — timed 2 weeks early so a delay still lands by the 3-month mark.")}
    ${typeSection("5th-month","Second review · 5.5 months","Decision prep — lands 2 weeks before the 6-month regularization deadline, so there's room for delays.")}
    ${typeSection("regularization","Regularization decision · 6 months","⚠ DOLE: decide &amp; notify <b>before</b> the 6-month probation ends, or the employee becomes regular by law.")}
    ${annualBlock}
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
      strengths:evVal("ev_str"), improvements:evVal("ev_imp"), evaluator:evVal("ev_by"), eval_date:evIso(new Date()), is_demo:!!e.is_demo };
    await logChange("evaluation",e.id,e.full_name,"Recorded",EVAL_LABEL[type]+" · "+(row.recommendation||"")+(row.overall_rating?" · "+row.overall_rating+"/5":""));
    const {error}=await sb.from("evaluations").insert(row);
    if(error){ document.getElementById("evMsg").textContent=error.message; btn.disabled=false; btn.textContent="Save evaluation"; return; }
    m.remove(); await loadEmployees();
  });
}
window.openEvalForm=openEvalForm;

/* Interim helper — clear evaluations already done OUTSIDE the portal (on paper / prior record), so the
   auto-generated due list stops flagging them. Records a lightweight, audited "done on file" entry. */
async function evInsertPrePortal(emp,type,due){
  const row={ employee_ref:emp.id, employee_name:emp.full_name, position:emp.position||emp.department||null, eval_type:type, period_due:due,
    overall_rating:null, ratings:{}, recommendation:"Done pre-portal (on file)",
    strengths:null, improvements:"Marked complete outside the portal (paper / prior record) — no scored form on file.",
    evaluator:(CURRENT_USER&&CURRENT_USER.email)||null, eval_date:evIso(new Date()), is_demo:!!emp.is_demo };
  await logChange("evaluation",emp.id,emp.full_name,"Cleared (pre-portal)",EVAL_LABEL[type]+" · marked done on file");
  return sb.from("evaluations").insert(row);
}
async function evMarkPrePortal(empId,type,due){
  const emp=EMPLOYEES.find(x=>String(x.id)===String(empId)); if(!emp) return;
  if(!confirm(`Mark ${emp.full_name}'s ${EVAL_LABEL[type]} as done pre-portal?\n\nIt moves to “Recently completed” tagged on-file (recorded under your name, dated today) and leaves the pending list.\n\nUse this only for a review you already handled on paper.`)) return;
  const {error}=await evInsertPrePortal(emp,type,due);
  if(error){ alert(error.message); return; }
  await loadEmployees();
}
async function evClearBacklog(){
  const list=evDueList().filter(x=>x.bucket==='overdue');
  if(!list.length){ alert("No overdue evaluations to clear."); return; }
  if(!confirm(`Clear the pre-portal backlog?\n\n${list.length} OVERDUE evaluation(s) will be marked “done on file” — recorded under your name, dated today — and will leave the pending list.\n\nUse this only for reviews you already handled on paper before the portal. Reviews due this month are left alone (clear those one-by-one).`)) return;
  for(const x of list){ const emp=EMPLOYEES.find(e=>String(e.id)===String(x.emp.id)); if(emp) await evInsertPrePortal(emp,x.type,x.due); }
  await loadEmployees();
}
window.evMarkPrePortal=evMarkPrePortal; window.evClearBacklog=evClearBacklog;

/* ============================ RECRUITMENT REPORTS (Rhel's KPI workbook, computed live) ============================ */
const RPT_DAY=86400000;
function rptDays(a,b){ const x=new Date(a), y=new Date(b); return (isNaN(x)||isNaN(y))?null:Math.max(0,Math.round((y-x)/RPT_DAY)); }
function rptAvg(arr){ const v=arr.filter(n=>n!=null); return v.length?v.reduce((s,n)=>s+n,0)/v.length:null; }
function rptStatus(actual,target,dir){
  if(actual==null||target==null) return '<span class="note">no data yet</span>';
  const good = dir==="low" ? actual<=target : actual>=target;
  const near = dir==="low" ? actual<=target*1.15 : actual>=target*0.9;
  const cls = good?"active":(near?"probation":"awol");
  const lbl = good?"On target":(near?"Near target":"Below target");
  return `<span class="pill ${cls}">${lbl}</span>`;
}
// Compact recruitment KPI band for the recruiters' dashboard (same maths as the Reports page).
function recruitmentScorecard(){
  const now=new Date(); const mStart=new Date(now.getFullYear(),now.getMonth(),1);
  const inMonth=d=>{ const x=new Date(d); return !isNaN(x)&&x>=mStart&&x<=now; };
  const filled=MANPOWER.filter(o=>o.status==="Filled"), open=MANPOWER.filter(o=>o.status==="Open");
  const aged=open.filter(o=>o.date_posted&&rptDays(o.date_posted,now)>45).length;
  const fillRate=(filled.length+open.length)?filled.length/(filled.length+open.length):null;
  const ttf=rptAvg(filled.map(o=>o.date_posted&&o.updated_at?rptDays(o.date_posted,o.updated_at):null));
  const hiredPh=PREHIRE.filter(p=>p.phase==="HIRED");
  const IS=s=>PREHIRE.filter(p=>(p.interview_status||"")===s).length;
  const attended=IS("Interviewed")+IS("Final interview")+IS("Offered")+IS("Declined")+PREHIRE.filter(p=>p.phase==="HIRED").length, noshow=IS("No-show");
  const attendRate=(attended+noshow)?attended/(attended+noshow):null;
  const cohort=EMPLOYEES.filter(e=>{ if(!e.hire_date) return false; const d=rptDays(e.hire_date,now); return d!=null&&d>=90&&d<=365; });
  const retRate=cohort.length?cohort.filter(e=>(e.status||"").toLowerCase().startsWith("active")).length/cohort.length:null;
  const appsMo=PREHIRE.filter(p=>inMonth(p.created_at)).length, hiredMo=hiredPh.filter(p=>inMonth(p.updated_at)).length;
  const pct=v=>v==null?"—":Math.round(v*100)+"%";
  const cell=(label,val,sub,st)=>`<div class="kpi" style="cursor:pointer;" onclick="go('reports')"><div class="k-l">${label}</div><div class="k-n" style="font-size:22px;">${val}</div><div class="k-s">${sub||""} ${st||""}</div></div>`;
  return `<div style="margin-top:14px;"><div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin:0 2px 8px;">Recruitment scorecard · this month <span style="font-weight:400;text-transform:none;">— tap any tile for the full report</span></div>
    <div class="grid kpis">
      ${cell("Applications",appsMo,"this month")}
      ${cell("Hired",hiredMo,"this month")}
      ${cell("Fill rate",pct(fillRate),"target ≥85%",rptStatus(fillRate,0.85,"high"))}
      ${cell("Interview attendance",pct(attendRate),"target ≥80%",rptStatus(attendRate,0.8,"high"))}
    </div>
    <div class="grid kpis" style="margin-top:13px;">
      ${cell("Time to fill",ttf==null?"—":Math.round(ttf)+"d","target ≤30d",rptStatus(ttf,30,"low"))}
      ${cell("90-day retention",pct(retRate),cohort.length+" in cohort",rptStatus(retRate,0.9,"high"))}
      ${cell("Aging openings",aged,">45 days old",rptStatus(aged,0,"low"))}
      ${cell("Full report","→","open the Reports tab")}
    </div></div>`;
}
/* ===================== ACCESS & ACTIVITY (owners only) ===================== */
const PERSON_BY_EMAIL={ "anj@hassarams.com":"Anj", "sanjay@hassarams.com":"Sanjay", "hr@hassarams.com":"Juvy", "hr2@hassarams.com":"Vina", "hr3@hassarams.com":"Grazel", "hr4@hassarams.com":"Rhel" };
const ROLE_LABEL={ admin:"Full admin", manager:"HR Manager", payroll:"Payroll / HR officer", relations:"HR Relations", recruiter:"Recruiter" };
function whoName(email){ const e=(email||"").toLowerCase(); return PERSON_BY_EMAIL[e]||(e.split("@")[0]||"—"); }
async function renderActivity(){
  const pg=$("#page-activity"); if(!pg||!isAdminUser()) return;
  // Build the role matrix from the live config
  const allEmails=["anj@hassarams.com","sanjay@hassarams.com","hr4@hassarams.com","hr3@hassarams.com","hr@hassarams.com","hr2@hassarams.com"];
  const roleFor=e=>ROLE_BY_EMAIL[e]||"recruiter";
  const seesPay=e=>{const r=roleFor(e);return r==="admin"||r==="payroll";};
  const matrix=allEmails.map(e=>{
    const r=roleFor(e);
    const pages = r==="admin" ? "Everything" :
      (r==="manager" ? "All HR (no Settings)" :
      (r==="payroll" ? "Recruiting + Employees" :
      (r==="relations" ? "Onboarding · Exit · Evaluations · Compliance · Memos · Loans" :
      "Recruiting"+(EXTRA_PAGES_BY_EMAIL[e]?" + "+EXTRA_PAGES_BY_EMAIL[e].join("/"):""))));
    return `<tr>
      <td style="padding:7px 9px;border-bottom:0.5px solid var(--line);"><b>${esc(whoName(e))}</b><div class="esub">${esc(e)}</div></td>
      <td style="padding:7px 9px;border-bottom:0.5px solid var(--line);">${esc(ROLE_LABEL[r]||r)}</td>
      <td style="padding:7px 9px;border-bottom:0.5px solid var(--line);">${pages}</td>
      <td style="padding:7px 9px;border-bottom:0.5px solid var(--line);text-align:center;">${seesPay(e)?'<span class="pill di">Yes</span>':'<span class="note">—</span>'}</td>
    </tr>`;}).join("");
  // Login history (RPC — owners only)
  let loginRows='<tr><td colspan="5" class="psub" style="padding:8px;">Loading…</td></tr>';
  // Activity feed from change_log
  const feed = (CHANGE_LOG||[]).slice(0,60).map(c=>`<div class="task" style="align-items:flex-start;">
      <div class="dot ${/reject|separat|correct|pay/i.test(c.action)?'r':(/add|record|edit/i.test(c.action)?'a':'g')}" style="margin-top:6px;"></div>
      <div style="flex:1;min-width:0;"><div class="tt">${esc(c.action)} — ${esc(c.entity_name||c.entity||"")}${c.detail?` <span style="font-weight:400;color:var(--muted);">· ${esc(c.detail)}</span>`:""}</div>
      <div class="td">${esc(whoName(c.changed_by))} · ${c.created_at?fmtDateTime(c.created_at):""}</div></div>
    </div>`).join("");
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Access &amp; Activity <span class="count-tag">owners only</span></h2>
      <div class="psub">Who has access, who's logging in, and every change made — the accountability trail for the handover.</div>
    </div>
    <div class="panel">
      <h2>Who can access what</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="text-align:left;color:var(--muted);">
        <th style="padding:6px 9px;font-weight:600;">Person</th><th style="padding:6px 9px;font-weight:600;">Role</th><th style="padding:6px 9px;font-weight:600;">Sees</th><th style="padding:6px 9px;font-weight:600;text-align:center;">Salary?</th></tr></thead>
        <tbody>${matrix}</tbody></table>
      <div class="psub" style="margin-top:9px;">🔓 Government IDs (SSS/PhilHealth/Pag-IBIG/TIN) &amp; bank details are <b>viewable by all HR</b> — needed for onboarding &amp; enrolment — but <b>entered/edited by Vina</b> (backup: Grazel; you &amp; Sanjay can override). Everyone else sees them read-only. <b>Salary</b> stays restricted to you, Sanjay &amp; Grazel. Every bank/gov edit is logged below.</div>
    </div>
    <div class="panel">
      <h2>Sign-in history</h2>
      <div class="psub"><b>Last active</b> is the real signal — it updates every time someone opens the portal, even on a saved session. <b>Password sign-in</b> only changes when they re-type their password, so it lags (that's why yours showed an old date while you were logged in).</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="text-align:left;color:var(--muted);">
        <th style="padding:6px 9px;font-weight:600;">Person</th><th style="padding:6px 9px;font-weight:600;">Last active</th><th style="padding:6px 9px;font-weight:600;">Visits</th><th style="padding:6px 9px;font-weight:600;">Password sign-in</th><th style="padding:6px 9px;font-weight:600;">Account created</th></tr></thead>
        <tbody id="loginRows">${loginRows}</tbody></table>
    </div>
    <div class="panel">
      <h2>Activity log <span class="count-tag">${(CHANGE_LOG||[]).length} recorded</span></h2>
      <div class="psub">Every change made in the portal — stores, salary/bank edits, loans, exits, evaluations, ID corrections — with who and when.</div>
      ${feed||'<div class="psub" style="margin-top:8px;">No changes logged yet.</div>'}
    </div>`;
  // fill login history via owner-only RPC
  sb.rpc("login_history").then(({data,error})=>{
    const el=document.getElementById("loginRows"); if(!el) return;
    if(error||!data){ el.innerHTML='<tr><td colspan="5" class="psub" style="padding:8px;">Could not load sign-in history.</td></tr>'; return; }
    const recent=(d)=>d&&((Date.now()-new Date(d))/86400000)<=3;
    el.innerHTML=data.map(u=>`<tr>
      <td style="padding:7px 9px;border-bottom:0.5px solid var(--line);"><b>${esc(whoName(u.email))}</b><div class="esub">${esc(u.email)}</div></td>
      <td style="padding:7px 9px;border-bottom:0.5px solid var(--line);font-weight:600;color:${recent(u.last_active)?'var(--green-dark)':(u.last_active?'inherit':'var(--muted)')};">${u.last_active?fmtDateTime(u.last_active):'<span class="note">not since heartbeat added</span>'}</td>
      <td style="padding:7px 9px;border-bottom:0.5px solid var(--line);color:var(--muted);">${u.visits||'—'}</td>
      <td style="padding:7px 9px;border-bottom:0.5px solid var(--line);color:var(--muted);">${u.last_sign_in?fmtDateTime(u.last_sign_in):'<span class="note">never</span>'}</td>
      <td style="padding:7px 9px;border-bottom:0.5px solid var(--line);color:var(--muted);">${u.created_at?fmtDate(u.created_at):""}</td></tr>`).join("");
  });
}
function fmtDateTime(d){ if(!d) return "—"; const x=new Date(d); if(isNaN(x)) return String(d); return x.toLocaleDateString("en-US",{month:"short",day:"numeric"})+", "+x.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}); }
/* ===================== MATERNITY BENEFITS (RA 11210) ===================== */
let MAT_EDIT=null;
function matDefaultDays(type,solo){ return type==="Miscarriage"?60:(solo?120:105); }
function matMSC(raw){ let a=[]; if(Array.isArray(raw)) a=raw; else if(typeof raw==="string") a=raw.split(/[,\s]+/); return a.map(Number).filter(x=>!isNaN(x)&&x>0); }
// The RCC standard computation for a daily-paid employee.
// DOLE Labor Advisory 01-2019 formula (see the ruling): full pay = monthly rate × maternity months
// (month = 30 days); differential = full pay − SSS benefit − employee contributions; differential is TAXABLE.
function computeMaternity(c){
  const factor=Number(c.pay_factor)||312, dr=Number(c.daily_rate)||0, days=Number(c.leave_days)||0;
  const dpm=factor/12;                             // equivalent working days/month (313→26.08 disers · 305→25.42 office)
  const months=days/30;                            // Art.13 Civil Code: a month = 30 days
  const monthly=dr*factor/12;                       // DOLE footnote 2: equivalent monthly rate = (daily rate × factor)/12
  const fpmb=monthly*months;                        // full pay = monthly × maternity months (normal working days — NOT actual attendance)
  const msc=matMSC(c.msc).map(x=>Math.min(x,20000)).sort((a,b)=>b-a), sum6=msc.slice(0,6).reduce((s,x)=>s+x,0), adsc=sum6/180;  // Regular SSS Program benefit caps each MSC at ₱20,000 (SSS Circular 2020-032; above 20k = WISP)
  const ov=(c.sss_benefit_override!=null&&c.sss_benefit_override!=="")?Number(c.sss_benefit_override):null;
  const sssBenefit=ov!=null?ov:adsc*days;
  const contributions=(Number(c.deduct_sss)||0)+(Number(c.deduct_philhealth)||0)+(Number(c.deduct_pagibig)||0);
  const otherDeduct=(Number(c.deduct_loans)||0)+(Number(c.deduct_advance)||0)+(Number(c.deduct_other)||0);
  const rawDiff=fpmb-sssBenefit-contributions;      // DOLE salary differential (can be ≤ 0 → nothing owed)
  const salaryDifferential=Math.max(0,rawDiff);
  const tax=Number(c.tax_on_differential)||0;       // the differential is taxable income (DOLE §III)
  const employerNet=Math.max(0,salaryDifferential-tax-otherDeduct);
  const net=sssBenefit+employerNet;                 // total the employee receives
  return { dpm,dr,days,months,monthly,fpmb,fullPayDaily:monthly/30,msc,sum6,adsc,sssBenefit,contributions,otherDeduct,rawDiff,salaryDifferential,tax,employerNet,net,override:ov!=null };
}
/* ===================== MERCHANDISER MEETING — ATTENDANCE + REIMBURSEMENT ===================== */
function meetingActive(){ return (MEETING_CFG&&MEETING_CFG.meeting_active)||{}; }
function meetingAllowedIPs(){ const v=MEETING_CFG&&MEETING_CFG.meeting_allowed_ips; return Array.isArray(v)?v:[]; }
function meetingRequireSelfie(){ return (MEETING_CFG&&MEETING_CFG.meeting_require_selfie)===true; }
function mPeso(n){ return "₱"+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
const SBTN="padding:8px 13px;font-size:13px;";
const MSEL="padding:6px 9px;border:1px solid var(--line);border-radius:7px;font-size:13px;background:#fff;";
async function meetingSaveCfg(key,value){ MEETING_CFG[key]=value; await sb.from("system_settings").upsert({ key, value, updated_at:new Date().toISOString() }, { onConflict:"key" }); }
async function reloadMeetings(){
  const [mtg,sysset,mros]=await Promise.all([
    sb.from("meeting_attendance").select("*").order("signed_in_at",{ascending:false}),
    sb.from("system_settings").select("*"),
    sb.from("meeting_roster").select("*")
  ]);
  MEETINGS=(mtg&&mtg.data)||[];
  MEETING_ROSTER=(mros&&mros.data)||[];
  MEETING_CFG={}; ((sysset&&sysset.data)||[]).forEach(r=>{ MEETING_CFG[r.key]=r.value; });
  renderMeetings();
}
let MEETING_VIEW=null; // selected meeting_date to view; null = active/latest

function renderMeetings(){
  const pg=$("#page-meetings"); if(!pg||!canRunMeetings()) return;
  const active=meetingActive(), ips=meetingAllowedIPs(), cfgAllowed=canConfigMeetings();
  const metaByDate={};
  MEETINGS.forEach(r=>{ const k=r.meeting_date||"—"; if(!metaByDate[k]) metaByDate[k]={date:r.meeting_date,label:r.meeting_label,n:0}; metaByDate[k].n++; });
  const meetingList=Object.values(metaByDate).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const viewDate = MEETING_VIEW || (active&&active.date) || (meetingList[0]&&meetingList[0].date) || null;
  const rows=MEETINGS.filter(r=>String(r.meeting_date)===String(viewDate));
  const totT=rows.reduce((s,r)=>s+Number(r.reimb_transport||0),0);
  const totL=rows.reduce((s,r)=>s+Number(r.reimb_lbc||0),0);
  const paid=rows.filter(r=>r.status==="Paid").length, verified=rows.filter(r=>r.status==="Verified").length;

  pg.innerHTML=`
  <div class="panel" style="margin-top:0;">
    <h2>Merchandiser Meeting — Attendance &amp; Reimbursement</h2>
    <div class="psub">QR sign-in on meeting day, IP-locked to the venue Wi-Fi so attendance can't be faked. Each merchandiser fills their transport / LBC reimbursement + bank details on their phone. Vina exports the bank report for Accounting.</div>
    ${cfgAllowed?`
    <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:14px;">
      <div style="flex:1;min-width:260px;border:1px solid var(--line);border-radius:12px;padding:14px;">
        <div class="subhead">Today's meeting</div>
        <div style="font-size:14px;margin:6px 0;">
          ${active&&active.open
            ? `<span class="pill active">OPEN for sign-in</span> <b>${esc(active.label||"Meeting")}</b>${active.date?" · "+fmtDate(active.date):""}`
            : `<span class="pill awol">Closed</span> ${active&&active.label?"<b>"+esc(active.label)+"</b>":""}${active&&active.date?" · "+fmtDate(active.date):""}`}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
          <button class="btn" style="${SBTN}" id="mtgOpen">${active&&active.open?"Change / re-open":"Open a meeting"}</button>
          ${active&&active.open?`<button class="btn ghost" style="${SBTN}" id="mtgClose">Close sign-in</button>`:""}
        </div>
      </div>
      <div style="flex:1;min-width:260px;border:1px solid var(--line);border-radius:12px;padding:14px;">
        <div class="subhead">Anti-scam — venue Wi-Fi lock</div>
        <div style="font-size:14px;margin:6px 0;">
          ${ips.length? `🔒 Locked to <b>${ips.map(esc).join(", ")}</b> — only sign-ins from the venue Wi-Fi count.` : `⚠️ <b>Not locked.</b> Sign-ins are recorded from any network. Lock it once you're on the venue Wi-Fi.`}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
          <button class="btn" style="${SBTN}" id="mtgLockIP">Lock to this Wi-Fi</button>
          ${ips.length?`<button class="btn ghost" style="${SBTN}" id="mtgClearIP">Remove lock</button>`:""}
          <button class="btn ghost" style="${SBTN}" id="mtgSelfie">Selfie: ${meetingRequireSelfie()?"ON":"OFF"}</button>
        </div>
      </div>
    </div>`:""}
    <div style="margin-top:14px;border:1px solid var(--line);border-radius:12px;padding:14px;">
      <div class="subhead">QR code for the meeting</div>
      <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=170x170&margin=6&data=${encodeURIComponent(MEETING_SIGNIN_URL)}" width="150" height="150" style="border:1px solid var(--line);border-radius:12px;background:#fff;" alt="Sign-in QR">
        <div style="font-size:13px;color:var(--mut);max-width:340px;">
          Display or print this at the meeting — merchandisers scan it to sign in.<br>
          <a href="${MEETING_SIGNIN_URL}" target="_blank" style="color:var(--navy);font-weight:600;word-break:break-all;">${MEETING_SIGNIN_URL}</a>
          <div style="margin-top:6px;"><button class="btn ghost" style="${SBTN}" id="mtgCopyLink">Copy link</button></div>
        </div>
      </div>
    </div>
  </div>

  <div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <h2 style="margin:0;">Attendance ${viewDate?"· "+fmtDate(viewDate):""}</h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        ${meetingList.length>1?`<select id="mtgPick" style="${MSEL}">${meetingList.map(m=>`<option value="${esc(m.date)}"${String(m.date)===String(viewDate)?" selected":""}>${esc(m.label||"Meeting")} · ${esc(m.date)} (${m.n})</option>`).join("")}</select>`:""}
        <button class="btn" style="${SBTN}" id="mtgExport">Export bank report (CSV)</button>
      </div>
    </div>
    <div class="grid kpis" style="grid-template-columns:repeat(4,1fr);margin-top:12px;">
      <div class="kpi"><div class="k-l">Attended</div><div class="k-n">${rows.length}</div></div>
      <div class="kpi"><div class="k-l">Transport total</div><div class="k-n" style="font-size:18px;">${mPeso(totT)}</div></div>
      <div class="kpi"><div class="k-l">LBC total</div><div class="k-n" style="font-size:18px;">${mPeso(totL)}</div></div>
      <div class="kpi"><div class="k-l">Verified / Paid</div><div class="k-n" style="font-size:18px;">${verified} / ${paid}</div></div>
    </div>
    ${rows.length?`
    <div style="overflow-x:auto;margin-top:12px;">
    <table><thead><tr>
      <th>Name</th><th>Emp&nbsp;No</th><th>Store</th><th>Signed in</th><th>Venue</th>
      <th>Transport</th><th>LBC</th><th>Ride&nbsp;pass</th><th>Account holder</th><th>Bank</th><th>Account&nbsp;no</th><th>Status</th>
    </tr></thead><tbody>
    ${rows.map(r=>`<tr>
      <td><b>${esc(r.name)}</b></td>
      <td>${esc(r.emp_no||"—")}</td>
      <td>${esc(r.store||"—")}</td>
      <td>${r.signed_in_at?esc(new Date(r.signed_in_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})):"—"}</td>
      <td>${r.ip_ok===true?'<span class="pill active" title="'+esc(r.client_ip||"")+'">on venue ✓</span>':r.ip_ok===false?'<span class="pill awol" title="'+esc(r.client_ip||"")+'">off venue</span>':'<span class="pill probation" title="'+esc(r.client_ip||"")+'">not locked</span>'}</td>
      <td>${mPeso(r.reimb_transport)}</td>
      <td>${mPeso(r.reimb_lbc)}</td>
      <td>${r.ride_pass_url?`<a href="${esc(r.ride_pass_url)}" target="_blank">view</a>`:"—"}</td>
      <td>${esc(r.account_holder||"—")}</td>
      <td>${esc(r.bank_name||"—")}</td>
      <td>${esc(r.bank_account_no||"—")}</td>
      <td><select class="mtg-status" data-id="${r.id}" style="${MSEL}">${["Submitted","Verified","Paid"].map(s=>`<option${r.status===s?" selected":""}>${s}</option>`).join("")}</select></td>
    </tr>`).join("")}
    </tbody></table></div>`
    : `<div class="placeholder" style="margin-top:12px;"><h2>No sign-ins yet${viewDate?" for "+esc(viewDate):""}</h2><p>Open a meeting, display the QR, and merchandiser sign-ins appear here live.</p></div>`}
  </div>
  ${meetingRosterPanel(viewDate,active)}
  ${meetingAbsenteePanel(viewDate,active)}
  ${meetingTrackerPanel()}`;

  const on=(id,ev,fn)=>{ const el=document.getElementById(id); if(el) el.addEventListener(ev,fn); };
  on("mtgCopyLink","click",()=>{ if(navigator.clipboard) navigator.clipboard.writeText(MEETING_SIGNIN_URL); const b=document.getElementById("mtgCopyLink"); if(b){ const t=b.textContent; b.textContent="Copied ✓"; setTimeout(()=>b.textContent=t,1200); } });
  on("mtgPick","change",e=>{ MEETING_VIEW=e.target.value; renderMeetings(); });
  on("mtgExport","click",()=>meetingExport(rows,viewDate));
  on("mtgOpen","click",meetingOpenDialog);
  on("mtgClose","click",async()=>{ const a=meetingActive(); await meetingSaveCfg("meeting_active",{...a,open:false}); reloadMeetings(); });
  on("mtgLockIP","click",meetingLockIP);
  on("mtgClearIP","click",async()=>{ await meetingSaveCfg("meeting_allowed_ips",[]); reloadMeetings(); });
  on("mtgSelfie","click",async()=>{ await meetingSaveCfg("meeting_require_selfie",!meetingRequireSelfie()); reloadMeetings(); });
  $$("#page-meetings .mtg-status").forEach(sel=>sel.addEventListener("change",async e=>{
    const id=e.target.dataset.id, status=e.target.value;
    await sb.from("meeting_attendance").update({status, verified_by:(CURRENT_USER&&CURRENT_USER.email)||null}).eq("id",id);
    const row=MEETINGS.find(x=>String(x.id)===String(id)); if(row) row.status=status;
  }));
}
function meetingOpenDialog(){
  const a=meetingActive();
  const today=new Date().toISOString().slice(0,10);
  const date=prompt("Meeting date (YYYY-MM-DD):", a.date||today); if(date===null) return;
  const label=prompt("Meeting name:", a.label||"Monthly Sales Meeting"); if(label===null) return;
  const d=(date||"").trim()||today, l=(label||"").trim()||"Monthly Sales Meeting";
  // Expected roster is uploaded per meeting (Excel/CSV), not auto-filled from the full active list.
  meetingSaveCfg("meeting_active",{date:d,label:l,open:true}).then(reloadMeetings);
}
async function meetingLockIP(){
  try{
    const anon=window.RCC_CONFIG.SUPABASE_ANON_KEY;
    const r=await fetch(MEETING_FN,{headers:{apikey:anon,Authorization:"Bearer "+anon}});
    const j=await r.json();
    const ip=j&&j.your_ip;
    if(!ip){ alert("Couldn't detect this network's IP — please try again."); return; }
    if(!confirm("Lock sign-in to this Wi-Fi?\n\nDetected venue IP: "+ip+"\n\nOnly people on this exact network will be able to sign in. Do this while you're ON the venue Wi-Fi.")) return;
    await meetingSaveCfg("meeting_allowed_ips",[ip]);
    reloadMeetings();
  }catch(e){ alert("Couldn't reach the sign-in service: "+e.message); }
}
function meetingExport(rows,viewDate){
  const cols=[["Name","name"],["Employee No","emp_no"],["Store","store"],["Account Holder","account_holder"],["Bank","bank_name"],["Account Number","bank_account_no"],["Transport","reimb_transport"],["LBC","reimb_lbc"],["Total","__total"],["Status","status"]];
  const head=cols.map(c=>c[0]).join(",");
  const body=(rows||[]).map(r=>cols.map(c=>{
    let v = c[1]==="__total" ? (Number(r.reimb_transport||0)+Number(r.reimb_lbc||0)) : r[c[1]];
    return `"${(v==null?"":String(v)).replace(/"/g,'""')}"`;
  }).join(",")).join("\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([head+"\n"+body],{type:"text/csv"}));
  a.download="bank-report-"+(viewDate||"meeting")+".csv"; a.click();
}

/* ---- MEETING: expected roster · absentees · graduated notice · regular-attendance tracker ---- */
const MEETING_EXPLAIN_DAYS=5;
const MEETING_NOTED_BY="Anj Genomal"; // merchandisers = retail; Director notes disciplinary notices
function mNorm(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
function mPersonKey(emp_no,name){ return (emp_no?String(emp_no):"")+"|"+mNorm(name); }
// Did this roster person sign in at their meeting? Match on emp_no when both have it, else on name.
function mAttended(row){
  const d=String(row.meeting_date);
  return (MEETINGS||[]).some(a=> String(a.meeting_date)===d && (
    (row.emp_no && a.emp_no && String(row.emp_no)===String(a.emp_no)) || mNorm(row.name)===mNorm(a.name) ));
}
function meetingRosterFor(date){ return (MEETING_ROSTER||[]).filter(r=>String(r.meeting_date)===String(date)); }
// Across every meeting this person was EXPECTED at (up to & incl. `uptoDate`), how many did they miss.
function meetingMissHistory(emp_no,name,uptoDate){
  const key=mPersonKey(emp_no,name); let expected=0,missed=0;
  (MEETING_ROSTER||[]).forEach(r=>{ if(!r.expected) return; if(mPersonKey(r.emp_no,r.name)!==key) return;
    if(uptoDate && String(r.meeting_date)>String(uptoDate)) return;
    expected++; if(!mAttended(r)) missed++; });
  return {expected,missed};
}
// Upload the invite list for ONE meeting from Excel/CSV. Replaces any existing roster for that meeting.
// Looks for a Name column (Employee No / Store optional); enriches from the merchandiser roster by name.
async function meetingUploadRoster(file,date,label){
  const st=document.getElementById("mtgRosterStatus");
  const setSt=(t,bad)=>{ if(st){ st.textContent=t; st.style.color=bad?"#a4322a":"#6b7785"; } };
  if(!date){ alert("Open a meeting first (set its date), then upload the expected list."); return; }
  setSt("Reading "+file.name+"…");
  try{
    await tkLoadSheetJS();
    const wb=window.XLSX.read(new Uint8Array(await file.arrayBuffer()),{type:"array"});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const grid=window.XLSX.utils.sheet_to_json(ws,{header:1,blankrows:false,defval:""}).map(r=>r.map(c=>String(c==null?"":c).trim()));
    // Find the header row (one that mentions "name") within the first few rows.
    let hIdx=-1;
    for(let i=0;i<Math.min(grid.length,6);i++){ if(grid[i].some(c=>/name/i.test(c))){ hIdx=i; break; } }
    let nameCol=0,empCol=-1,storeCol=-1,dataStart=0;
    if(hIdx>=0){ const H=grid[hIdx];
      H.forEach((c,i)=>{ const h=c.toLowerCase();
        if(nameCol===0 && /name/.test(h)) nameCol=i;
        if(empCol<0 && /(emp|employee|id|no\b|number)/.test(h) && !/name/.test(h)) empCol=i;
        if(storeCol<0 && /(store|branch|worksite|outlet|site|account)/.test(h)) storeCol=i;
      });
      dataStart=hIdx+1;
    }
    const seen=new Set(); let matched=0; const rows=[];
    for(let i=dataStart;i<grid.length;i++){ const g=grid[i]||[]; const name=(g[nameCol]||"").trim();
      if(!name || /^name$/i.test(name)) continue;
      let emp=empCol>=0?(g[empCol]||"").trim():""; let store=storeCol>=0?(g[storeCol]||"").trim():"";
      // enrich from the active merchandiser roster by name
      const d=(DISERS||[]).find(x=>mNorm(x.name)===mNorm(name));
      if(d){ matched++; if(!emp) emp=d.emp_no||""; if(!store) store=d.store||""; }
      const key=(emp||"")+"|"+mNorm(name); if(seen.has(key)) continue; seen.add(key);
      rows.push({ meeting_date:date, meeting_label:label||null, diser_id:d?d.id:null, emp_no:emp||null,
        name, store:store||null, position:d?d.position||null:null, hired_by:d?d.hired_by||null:null, expected:true });
    }
    if(!rows.length){ setSt("⚠ No names found — the file needs a column headed \"Name\" (or a single column of names).",true); return; }
    if(!confirm("Load "+rows.length+" expected attendee(s) for "+fmtDate(date)+"?"+(matched<rows.length?"\n\n("+matched+" matched to the merchandiser roster; "+(rows.length-matched)+" by name only.)":"")+"\n\nThis replaces any list already loaded for this meeting.")){ setSt(""); return; }
    // replace-by-meeting: clear this meeting's roster, then insert the uploaded list
    await sb.from("meeting_roster").delete().eq("meeting_date",date);
    const { error } = await sb.from("meeting_roster").insert(rows);
    if(error){ setSt("⚠ "+error.message,true); return; }
    setSt("✓ "+rows.length+" loaded"+(matched<rows.length?" ("+(rows.length-matched)+" by name only)":""));
    await reloadMeetings();
  }catch(e){ setSt("⚠ "+((e&&e.message)||e),true); }
}
window.mtgUploadRosterEl=(el)=>{ const f=el.files&&el.files[0]; if(!f) return; const date=el.dataset.date;
  const a=meetingActive(); const rr=meetingRosterFor(date)[0];
  const label=(a&&a.date===date&&a.label)||(rr&&rr.meeting_label)||"Monthly Merchandiser Meeting";
  meetingUploadRoster(f,date,label); el.value=""; };
async function meetingToggleExpected(id,expected){
  await sb.from("meeting_roster").update({expected}).eq("id",id);
  const r=(MEETING_ROSTER||[]).find(x=>String(x.id)===String(id)); if(r) r.expected=expected;
  renderMeetings();
}
window.mtgToggleExpected=(id,checked)=>meetingToggleExpected(id,!!checked);

// ---- Notice text (reminder = non-disciplinary; NTE = repeat, DOLE twin-notice) ----
function meetingReminderText(row,label,date){
  return `REMINDER — MONTHLY MERCHANDISER MEETING\n\n`
    +`To: ${row.name}${row.store?" · "+row.store:""}\n\n`
    +`Our records show you were not able to attend the ${label||"monthly merchandiser meeting"} held on ${fmtDate(date)}. Attendance at the monthly meeting is part of your responsibilities — important updates, product information, and concerns are discussed there.\n\n`
    +`This is a friendly reminder, not a disciplinary notice. Kindly make sure to attend the next scheduled meeting. If you were absent for a valid reason (illness, emergency, or prior approval), please inform your supervisor or the Merchandising/HR coordinator so it can be properly noted.\n\n`
    +`Thank you for your cooperation.\n\nHuman Resources / Merchandising Department — Roshan Commercial Corporation`;
}
function meetingNteText(row,label,date,hist){
  return `NOTICE TO EXPLAIN — REPEATED ABSENCE FROM MANDATORY MEETINGS\n\n`
    +`To: ${row.name}${row.store?" · "+row.store:""}\n\n`
    +`This notice concerns your attendance at the Company's monthly merchandiser meetings. Based on our records, you have missed ${hist.missed} of the ${hist.expected} meeting(s) you were expected to attend, including the ${label||"monthly meeting"} held on ${fmtDate(date)}.\n\n`
    +`Attendance at these meetings is a reasonable requirement connected to your duties. Repeated absence without a valid reason may constitute a violation of Company policy and a ground for disciplinary action under the Labor Code.\n\n`
    +`In line with your right to due process, you are directed to submit a WRITTEN EXPLANATION within ${MEETING_EXPLAIN_DAYS} calendar days from receipt of this notice, stating why no disciplinary action should be taken against you for the above. If any of these absences were for a valid or justifiable reason (illness, emergency, or approved leave), please state this clearly and attach any supporting documents — these will be duly considered. You may request a conference to be heard and may be assisted by a representative of your choice.\n\n`
    +`This is the first of the twin notices required by due process. It is issued to give you the opportunity to be heard; it is not a finding or a penalty.\n\n`
    +`Prepared by: Human Resources Department\nNoted by: ${MEETING_NOTED_BY} — Management`;
}
// Printable notice on RCC letterhead (kind = 'reminder' | 'nte'). approval = {signer,date,img} stamps the e-sig on NTE.
function meetingPrintNotice(row,label,date,kind,hist,approval){
  const today=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});
  const isNte=kind==="nte";
  const w=window.open("","_blank"); if(!w){ alert("Allow pop-ups to print the notice."); return; }
  const subject=isNte?"NOTICE TO EXPLAIN — REPEATED ABSENCE FROM MANDATORY MEETINGS":"REMINDER — MONTHLY MERCHANDISER MEETING";
  const bodyP = isNte
    ? `<p>This notice concerns your attendance at the Company's monthly merchandiser meetings. Based on our records, you have missed <b>${hist.missed} of the ${hist.expected}</b> meeting(s) you were expected to attend, including the <b>${esc(label||"monthly meeting")}</b> held on ${esc(fmtDate(date))}.</p>
       <p>Attendance at these meetings is a reasonable requirement connected to your duties. Repeated absence without a valid reason may constitute a violation of Company policy and a ground for disciplinary action under the Labor Code.</p>
       <p>In line with your right to due process, you are directed to submit a <b>WRITTEN EXPLANATION within ${MEETING_EXPLAIN_DAYS} calendar days</b> from your receipt of this notice, stating why no disciplinary action should be taken against you for the above.</p>
       <p>If any of these absences were for a valid or justifiable reason (illness, emergency, or approved leave), please state this clearly and attach any supporting documents — these will be duly considered. You may request a conference to be heard, and you may be assisted by a representative of your choice.</p>
       <p>This is the first of the twin notices required by due process. It is issued to give you the opportunity to be heard; it is not a finding or a penalty.</p>`
    : `<p>Our records show you were not able to attend the <b>${esc(label||"monthly merchandiser meeting")}</b> held on ${esc(fmtDate(date))}. Attendance at the monthly meeting is part of your responsibilities — important updates, product information, and concerns are discussed there.</p>
       <p>This is a <b>friendly reminder, not a disciplinary notice</b>. Kindly make sure to attend the next scheduled meeting. If you were absent for a valid reason (illness, emergency, or prior approval), please inform your supervisor or the Merchandising/HR coordinator so it can be properly noted.</p>
       <p>Thank you for your cooperation.</p>`;
  w.document.write(`<!DOCTYPE html><html><head><title>${isNte?"NTE":"Reminder"} — ${esc(row.name)}</title><style>
    body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1F2A37;max-width:760px;margin:24px auto;padding:0 24px;font-size:13.5px;line-height:1.6;}
    .lh{border-bottom:2.5px solid #1B5E20;padding-bottom:8px;margin-bottom:16px;}
    .lh b{font-size:17px;color:#1B5E20;letter-spacing:.4px;} .lh div{font-size:11px;color:#667;}
    .mf{margin:2px 0;} .mf b{display:inline-block;width:90px;}
    .sub{border-top:2px solid #1B5E20;margin:14px 0 16px;padding-top:2px;}
    p{margin:0 0 11px;} .sig{margin-top:26px;} .sigrole{font-weight:700;margin-top:16px;}
    .line{border-bottom:1px solid #333;width:280px;height:26px;margin:4px 0 2px;}
    .ack{font-style:italic;color:#555;font-size:11.5px;margin-top:4px;}
    @media print{ body{margin:0 auto;} }
  </style></head><body>
    <div class="lh"><b>ROSHAN COMMERCIAL CORPORATION</b><div>3rd Floor RCC Center, 104 Shaw Boulevard, Pasig, Manila, 1603 · +632 86386556</div></div>
    <div class="mf">${today}</div>
    <div class="sub"></div>
    <div class="mf"><b>TO</b>: ${esc((row.name||"").toUpperCase())}${row.store?" — "+esc(row.store):""}</div>
    <div class="mf"><b>FROM</b>: HUMAN RESOURCES / MERCHANDISING DEPARTMENT</div>
    <div class="mf"><b>SUBJECT</b>: ${subject}</div>
    <div class="sub"></div>
    ${bodyP}
    <div class="sig">
      <div class="sigrole">Prepared by:</div><div class="line"></div>Human Resources Department
      ${isNte?`<div class="sigrole">Noted by:</div>${(approval&&approval.img)?`<div style="margin:2px 0;"><img src="${approval.img}" style="height:44px;display:block;">${esc(approval.signer||MEETING_NOTED_BY)}<br><span style="color:#667;">Management · e-signed via RCC Portal${approval.date?" on "+new Date(approval.date).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}):""}</span></div>`:`<div class="line"></div>${esc(MEETING_NOTED_BY)}<br><span style="color:#667;">Management</span>`}
      <div class="sigrole">Received by:</div><div class="line"></div>${esc(row.name)}<br><span style="color:#667;">Signature over printed name / Date</span>
      <div class="ack">By signing, I acknowledge receipt of this notice. My signature does not mean I admit the contents.</div>`:""}
    </div>
    <script>window.print();</`+`script></body></html>`);
  w.document.close();
}
// ---- Notice state per absentee (already reminded / NTE pending / NTE signed) ----
function meetingNoticeState(row,date){
  const nte=(SIGNATURES||[]).find(s=>s.doc_type==="meeting_nte"&&s.details&&String(s.details.meeting_date)===String(date)&&(s.subject_name||"")===row.name);
  if(nte) return {kind:"nte",state:nte.status==="signed"?"signed":nte.status==="declined"?"declined":"pending",sig:nte};
  const rem=(MEMOS||[]).find(m=>m.memo_type==="Meeting Reminder"&&String(m.relevant_date)===String(date)&&(m.subject_name||"")===row.name);
  if(rem) return {kind:"reminder",state:"sent",memo:rem};
  return {state:"none"};
}
// Send a (non-disciplinary) reminder: print on letterhead + log to Memos.
async function meetingSendReminder(rosterId){
  const row=(MEETING_ROSTER||[]).find(r=>String(r.id)===String(rosterId)); if(!row) return;
  const label=row.meeting_label||meetingActive().label||"Monthly Merchandiser Meeting";
  meetingPrintNotice(row,label,row.meeting_date,"reminder");
  const ref="MRM-"+String(row.meeting_date).replace(/-/g,"")+"-"+mNorm(row.name).replace(/\s+/g,"").slice(0,8);
  try{ await sb.from("memos").insert({ ref_no:ref, memo_type:"Meeting Reminder", subject_name:row.name,
    title:"Meeting reminder — "+label+" ("+row.meeting_date+")",
    body:"Reminder issued for non-attendance at "+label+" on "+row.meeting_date+". Non-disciplinary.",
    relevant_date:row.meeting_date, status:"Issued", created_by:(CURRENT_USER&&CURRENT_USER.email)||"HR", is_demo:!!row.is_demo });
  }catch(_){}
  try{ const me=await sb.from("memos").select("*").order("created_at",{ascending:false}); MEMOS=(me&&me.data)||MEMOS; renderMemos(); }catch(_){}
  renderMeetings();
}
window.mtgSendReminder=(id)=>meetingSendReminder(id);
// Route a repeat-absence NTE to the Signatures inbox for the Director's sign-off, and log to Memos.
async function meetingSendNte(rosterId){
  const row=(MEETING_ROSTER||[]).find(r=>String(r.id)===String(rosterId)); if(!row) return;
  const label=row.meeting_label||meetingActive().label||"Monthly Merchandiser Meeting";
  const hist=meetingMissHistory(row.emp_no,row.name,row.meeting_date);
  const body=meetingNteText(row,label,row.meeting_date,hist);
  const details={ meeting_date:row.meeting_date, label, employee:row.name, emp_no:row.emp_no||null, store:row.store||null,
    position:row.position||null, expected:hist.expected, missed:hist.missed, noted_by:MEETING_NOTED_BY };
  const { data:sig, error } = await sb.from("signature_requests").insert({ doc_type:"meeting_nte",
    doc_title:"Notice to Explain — Meeting Absence", subject_name:row.name, body,
    from_name:(CURRENT_USER&&CURRENT_USER.email)||"HR", awaiting:"you", with_whom:MEETING_NOTED_BY+" (Noted by)",
    status:"pending", meta:"Meeting absence · "+label+" "+row.meeting_date, details }).select().single();
  if(error){ alert("Couldn't send the NTE: "+error.message); return; }
  const ref="MTGNTE-"+String(row.meeting_date).replace(/-/g,"")+"-"+mNorm(row.name).replace(/\s+/g,"").slice(0,8);
  try{ await sb.from("memos").insert({ ref_no:ref, memo_type:"Notice to Explain", subject_name:row.name,
    title:"NTE — Meeting absence ("+label+", "+row.meeting_date+")",
    body:"NTE for repeated meeting absence: missed "+hist.missed+" of "+hist.expected+" expected meetings. Sent to "+MEETING_NOTED_BY+" for sign-off.",
    relevant_date:row.meeting_date, status:"Issued", signature_request_id:sig.id, created_by:(CURRENT_USER&&CURRENT_USER.email)||"HR", is_demo:!!row.is_demo });
  }catch(_){}
  try{ const [sg,me]=await Promise.all([ sb.from("signature_requests").select("*").order("created_at",{ascending:false}), sb.from("memos").select("*").order("created_at",{ascending:false}) ]);
    SIGNATURES=(sg&&sg.data)||SIGNATURES; MEMOS=(me&&me.data)||MEMOS; renderSignatures(); renderMemos(); }catch(_){}
  renderMeetings();
}
window.mtgSendNte=(id)=>meetingSendNte(id);
// Print an APPROVED meeting NTE with the e-signature stamped on the "Noted by" line.
window.mtgPrintSignedNte=(sigId)=>{
  const s=(SIGNATURES||[]).find(x=>String(x.id)===String(sigId)); if(!s||!s.details) return;
  const d=s.details, row={ name:d.employee, store:d.store, emp_no:d.emp_no };
  meetingPrintNotice(row, d.label, d.meeting_date, "nte", {expected:d.expected,missed:d.missed}, { signer:s.signer_name, date:s.signed_at, img:s.signature_data });
};
// Branded sign-off card for a meeting-absence NTE (mirrors the attendance nteCard).
function meetingNteCard(s){ const d=s.details||{};
  const rw=(k,v)=>`<tr><td style="padding:9px 14px;color:#6B7785;font-size:12.5px;border-bottom:1px solid #eef1f4;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:9px 14px;font-weight:700;font-size:13px;border-bottom:1px solid #eef1f4;">${v}</td></tr>`;
  return `<div style="background:linear-gradient(135deg,#12352a,#1c4b39);margin:-22px -22px 0;padding:15px 20px;border-radius:14px 14px 0 0;color:#fff;">
      <div style="font-weight:800;font-size:15px;letter-spacing:.2px;">RCC Portal <span style="opacity:.72;font-weight:500;font-size:12.5px;">Roshan Commercial Corporation</span></div>
    </div>
    <div style="padding:16px 2px 0;">
      <div style="font-size:10.5px;font-weight:800;letter-spacing:1.6px;color:#6B7785;">NOTICE TO EXPLAIN · MEETING ABSENCE</div>
      <div style="font-size:18px;font-weight:800;color:#12352a;margin:2px 0 3px;">NTE needs your sign-off</div>
      <div class="psub" style="margin-bottom:11px;">Submitted by ${esc(s.from_name||"HR")}${s.created_at?" · "+fmtAgo(s.created_at):""}. Review the record, then approve &amp; e-sign as “Noted by”.</div>
      <table style="width:100%;border:1px solid #e6eaee;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden;">
        ${rw("Merchandiser",esc(d.employee||s.subject_name||"—"))}
        ${d.store?rw("Store",esc(d.store)):""}
        ${rw("Meeting missed",esc((d.label?d.label+" · ":"")+fmtDate(d.meeting_date)))}
        <tr><td style="padding:12px 14px;background:#eaf4ec;font-size:12.5px;font-weight:800;color:#12352a;">MEETINGS MISSED</td><td style="padding:12px 14px;background:#eaf4ec;font-weight:800;font-size:15.5px;color:#12352a;">${d.missed} of ${d.expected} expected</td></tr>
        ${d.noted_by?rw("Noted by",esc(d.noted_by)):""}
      </table>
      <div class="note" style="margin-top:10px;background:#fdeaea;border-color:#f0c9c5;color:#8a2e26;">⚠ Repeat absence — this is the DOLE first notice (Notice to Explain). Confirm the absences were unauthorized (no approved leave / valid reason) before serving.</div>
      <details style="margin:11px 0 2px;"><summary style="cursor:pointer;font-size:12.5px;color:#1E3A5F;font-weight:600;">Read the full notice text</summary>
        <div style="background:#f7f9fb;border:1px solid #E3E8EF;border-radius:10px;padding:12px 14px;margin-top:8px;white-space:pre-wrap;font-size:12.5px;line-height:1.55;max-height:30vh;overflow-y:auto;">${esc(s.body||"")}</div>
      </details>
    </div>`; }

// ---- Panels: expected roster · absentees (graduated notice) · regular-attendance tracker ----
function meetingRosterPanel(viewDate,active){
  const roster=meetingRosterFor(viewDate);
  const expected=roster.filter(r=>r.expected);
  if(!viewDate){ return `<div class="panel"><h2>Expected roster</h2><div class="psub">Open a meeting first — then upload the list of merchandisers who should attend it.</div></div>`; }
  const uploadBtn=(txt,ghost)=>`<label class="btn${ghost?" ghost":""}" style="${SBTN};margin-top:10px;cursor:pointer;display:inline-block;">${txt}<input type="file" accept=".xlsx,.xls,.csv" data-date="${esc(viewDate)}" onchange="mtgUploadRosterEl(this)" style="display:none;"></label>`;
  if(!roster.length){ return `<div class="panel"><h2>Expected roster · ${fmtDate(viewDate)}</h2>
      <div class="psub">Who <b>should</b> attend <b>this</b> meeting. Upload the invite list for this meeting — an Excel/CSV with a <b>Name</b> column (Employee&nbsp;No and Store optional; names are matched to the merchandiser roster automatically). Only these people are counted, and anyone who doesn't sign in shows as absent.</div>
      ${uploadBtn("⬆ Upload expected list (Excel / CSV)")}
      <span id="mtgRosterStatus" class="psub" style="margin-left:10px;"></span></div>`; }
  const sorted=roster.slice().sort((a,b)=>String(a.store||"~").localeCompare(String(b.store||"~"))||String(a.name).localeCompare(String(b.name)));
  return `<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <h2 style="margin:0;">Expected roster · ${fmtDate(viewDate)}</h2>
      <div class="psub" style="margin:0;"><b>${expected.length}</b> expected${roster.length!==expected.length?` · ${roster.length-expected.length} excused`:""} · ${roster.length} on file</div>
    </div>
    <div class="psub">Uploaded invite list for this meeting. Untick anyone not required — they won't be counted as absent. ${uploadBtn("⬆ Replace list (re-upload)",true)} <span id="mtgRosterStatus" class="psub" style="margin-left:6px;"></span></div>
    <div style="overflow-x:auto;margin-top:12px;max-height:340px;overflow-y:auto;">
    <table><thead><tr><th style="width:70px;">Expected</th><th>Name</th><th>Store</th><th>Agency</th><th>Attended?</th></tr></thead><tbody>
    ${sorted.map(r=>{ const att=mAttended(r); return `<tr>
      <td><input type="checkbox" ${r.expected?"checked":""} onchange="mtgToggleExpected('${r.id}',this.checked)" style="width:auto;margin:0;"></td>
      <td><b>${esc(r.name)}</b></td><td>${esc(r.store||"—")}</td><td>${esc(r.hired_by||"—")}</td>
      <td>${att?'<span class="pill active">Present ✓</span>':r.expected?'<span class="pill awol">Absent</span>':'<span class="pill" style="background:#eef1f4;color:#6b7785;">excused</span>'}</td>
    </tr>`; }).join("")}
    </tbody></table></div></div>`;
}
function meetingAbsenteePanel(viewDate,active){
  const roster=meetingRosterFor(viewDate); if(!viewDate||!roster.length) return "";
  const label=(active&&active.date===viewDate&&active.label)||(roster[0]&&roster[0].meeting_label)||"Monthly Merchandiser Meeting";
  const absent=roster.filter(r=>r.expected && !mAttended(r))
    .sort((a,b)=>String(a.store||"~").localeCompare(String(b.store||"~"))||String(a.name).localeCompare(String(b.name)));
  const open=active&&active.open&&active.date===viewDate;
  const firsts=absent.filter(r=>meetingMissHistory(r.emp_no,r.name,viewDate).missed<2 && meetingNoticeState(r,viewDate).state==="none").length;
  const repeats=absent.filter(r=>meetingMissHistory(r.emp_no,r.name,viewDate).missed>=2 && meetingNoticeState(r,viewDate).state==="none").length;
  return `<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <h2 style="margin:0;">Did not attend · ${fmtDate(viewDate)}</h2>
      <div class="psub" style="margin:0;"><b>${absent.length}</b> absent of ${roster.filter(r=>r.expected).length} expected</div>
    </div>
    ${open?`<div class="note" style="margin-top:10px;">Sign-in is still <b>open</b> — close it (top of page) before serving notices, so late sign-ins aren't wrongly flagged absent.</div>`:""}
    ${absent.length?`
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">
      ${firsts?`<button class="btn ghost" style="${SBTN}" onclick="mtgReminderAll('${esc(viewDate)}')">Send reminder to all first-time absentees (${firsts})</button>`:""}
      ${repeats?`<button class="btn" style="${SBTN}" onclick="mtgNteAll('${esc(viewDate)}')">Send NTE to all repeat absentees (${repeats})</button>`:""}
    </div>
    <div style="overflow-x:auto;">
    <table><thead><tr><th>Name</th><th>Store</th><th>Missed</th><th>Notice</th><th style="min-width:230px;">Action</th></tr></thead><tbody>
    ${absent.map(r=>{ const h=meetingMissHistory(r.emp_no,r.name,viewDate); const repeat=h.missed>=2; const st=meetingNoticeState(r,viewDate);
      const badge=repeat?`<span class="pill" style="background:#fdeaea;color:#a4322a;font-weight:700;">${h.missed}× missed</span>`:`<span class="pill" style="background:#fdf0d9;color:#9a6a00;font-weight:700;">1st miss</span>`;
      let action;
      if(st.kind==="nte"){ action = st.state==="signed"
          ? `<span class="pill active">NTE signed ✓</span> <button class="btn ghost" style="${SBTN}" onclick="mtgPrintSignedNte('${st.sig.id}')">Print signed NTE</button>`
          : st.state==="declined" ? `<span class="pill awol">NTE declined</span> <button class="btn ghost" style="${SBTN}" onclick="mtgSendNte('${r.id}')">Re-send</button>`
          : `<span class="pill probation">NTE awaiting sign-off</span>`;
      } else if(st.kind==="reminder"){ action = `<span class="pill active">Reminder sent ✓</span> <button class="btn ghost" style="${SBTN}" onclick="mtgSendReminder('${r.id}')">Reprint</button>${repeat?` <button class="btn" style="${SBTN}" onclick="mtgSendNte('${r.id}')">Escalate to NTE</button>`:""}`;
      } else if(repeat){ action = `<button class="btn" style="${SBTN}" onclick="mtgSendNte('${r.id}')">Send NTE (repeat)</button> <button class="btn ghost" style="${SBTN}" onclick="mtgSendReminder('${r.id}')">Reminder instead</button>`;
      } else { action = `<button class="btn ghost" style="${SBTN}" onclick="mtgSendReminder('${r.id}')">Send reminder</button> <button class="btn ghost" style="${SBTN}" onclick="mtgSendNte('${r.id}')">Escalate to NTE</button>`; }
      return `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.store||"—")}</td><td>${badge}<br><span class="psub" style="margin:0;font-size:11px;">missed ${h.missed} of ${h.expected}</span></td><td>${st.state==="none"?'<span class="psub" style="margin:0;">—</span>':""}</td><td>${action}</td></tr>`;
    }).join("")}
    </tbody></table></div>`
    : `<div class="placeholder" style="margin-top:12px;"><h2>Everyone expected attended 🎉</h2><p>No absentees for this meeting.</p></div>`}
  </div>`;
}
window.mtgReminderAll=async(date)=>{
  const roster=meetingRosterFor(date);
  const list=roster.filter(r=>r.expected && !mAttended(r) && meetingMissHistory(r.emp_no,r.name,date).missed<2 && meetingNoticeState(r,date).state==="none");
  if(!list.length){ alert("No first-time absentees pending a reminder."); return; }
  if(!confirm("Send a reminder to "+list.length+" first-time absentee(s)? Each opens as a printable notice on RCC letterhead.")) return;
  for(const r of list){ await meetingSendReminder(r.id); }
};
window.mtgNteAll=async(date)=>{
  const roster=meetingRosterFor(date);
  const list=roster.filter(r=>r.expected && !mAttended(r) && meetingMissHistory(r.emp_no,r.name,date).missed>=2 && meetingNoticeState(r,date).state==="none");
  if(!list.length){ alert("No repeat absentees pending an NTE."); return; }
  if(!confirm("Send an NTE (repeat absence) to "+list.length+" merchandiser(s)? Each goes to "+MEETING_NOTED_BY+"'s Signatures inbox for sign-off. Only serve after confirming the absences were unauthorized.")) return;
  for(const r of list){ await meetingSendNte(r.id); }
};
let MEETING_TRACK_ALL=false;
window.mtgTrackerToggle=()=>{ MEETING_TRACK_ALL=!MEETING_TRACK_ALL; renderMeetings(); };
function meetingTrackerPanel(){
  const dates=[...new Set((MEETING_ROSTER||[]).filter(r=>r.expected).map(r=>String(r.meeting_date)))].sort();
  if(dates.length<1) return "";
  const people={};
  (MEETING_ROSTER||[]).filter(r=>r.expected).forEach(r=>{ const k=mPersonKey(r.emp_no,r.name);
    if(!people[k]) people[k]={name:r.name,store:r.store,attended:{},expected:new Set()};
    people[k].expected.add(String(r.meeting_date)); if(mAttended(r)) people[k].attended[String(r.meeting_date)]=true; });
  let list=Object.values(people).map(p=>{ const exp=p.expected.size, att=Object.keys(p.attended).length;
    return {...p, exp, att, rate: exp?att/exp:0, missed:exp-att }; });
  list.sort((a,b)=> a.rate-b.rate || b.missed-a.missed || String(a.name).localeCompare(String(b.name)));
  const chronic=list.filter(p=>p.exp>=2 && p.rate<0.5);
  const perfect=list.filter(p=>p.exp>=2 && p.rate===1);
  const shown=MEETING_TRACK_ALL?list:list.slice(0,15);
  const recent=dates.slice(-6);
  const rateColor=r=> r>=0.8?"#1c6b3f":r>=0.5?"#9a6a00":"#a4322a";
  return `<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <h2 style="margin:0;">Regular attendance</h2>
      <div class="psub" style="margin:0;">${dates.length} meeting${dates.length===1?"":"s"} tracked · ${list.length} merchandisers</div>
    </div>
    <div class="psub">Attendance rate across every meeting each person was expected at. ${chronic.length?`<b style="color:#a4322a;">${chronic.length}</b> chronic (below 50%). `:""}${perfect.length?`<b style="color:#1c6b3f;">${perfect.length}</b> perfect attendance.`:""}</div>
    <div style="overflow-x:auto;margin-top:12px;">
    <table><thead><tr><th>Name</th><th>Store</th><th>Rate</th><th>Attended</th><th>Last ${recent.length} meeting${recent.length===1?"":"s"}</th></tr></thead><tbody>
    ${shown.map(p=>`<tr>
      <td><b>${esc(p.name)}</b></td><td>${esc(p.store||"—")}</td>
      <td><b style="color:${rateColor(p.rate)};">${Math.round(p.rate*100)}%</b></td>
      <td>${p.att}/${p.exp}${p.exp>=2&&p.rate<0.5?' <span class="pill" style="background:#fdeaea;color:#a4322a;font-weight:700;">chronic</span>':p.exp>=2&&p.rate===1?' <span class="pill active">perfect</span>':""}</td>
      <td style="white-space:nowrap;">${recent.map(d=>{ const wasExp=p.expected.has(d); if(!wasExp) return '<span title="'+esc(d)+' — not expected" style="color:#c3c9d0;">·</span>'; const a=p.attended[d]; return '<span title="'+esc(d)+'" style="color:'+(a?"#1c6b3f":"#a4322a")+';font-weight:700;">'+(a?"✓":"✗")+'</span>'; }).join(" ")}</td>
    </tr>`).join("")}
    </tbody></table></div>
    ${list.length>15?`<button class="btn ghost" style="${SBTN};margin-top:10px;" onclick="mtgTrackerToggle()">${MEETING_TRACK_ALL?"Show top 15 only":"Show all "+list.length}</button>`:""}
  </div>`;
}

/* ===================== DEMO DATA — safe sandbox (delete only DEMO-marked records) ===================== */
function isDemoText(s){ return /demo/i.test(String(s||"")); }
// "This is demo data" checkbox for create forms — lets entries use realistic names but stay cleanable.
function demoChk(id,val){ return `<label style="display:flex;align-items:center;gap:8px;margin:12px 0 2px;font-size:13px;color:#6b7683;cursor:pointer;"><input type="checkbox" id="${id}"${val?" checked":""} style="width:auto;margin:0;"> This is demo / test data <span style="color:#9aa4b0;">(safe to delete later from Demo Data)</span></label>`; }
function demoChecked(id){ const el=document.getElementById(id); return !!(el&&el.checked); }
function renderDemoData(){
  const pg=$("#page-demodata"); if(!pg||!isAdminUser()) return;
  const SRC=[
    {label:"Employee", table:"employees", rows:EMPLOYEES, name:r=>r.full_name},
    {label:"Pre-hire applicant", table:"prehire", rows:PREHIRE, name:r=>r.full_name},
    {label:"Onboarding case", table:"onboarding_cases", rows:ONBOARDING, name:r=>r.employee_name},
    {label:"Exit clearance", table:"exit_clearance", rows:EXITCASES, name:r=>r.employee_name},
    {label:"Evaluation", table:"evaluations", rows:EVALUATIONS, name:r=>r.employee_name},
    {label:"Loan", table:"loans", rows:LOANS, name:r=>r.applicant_name},
    {label:"Memo", table:"memos", rows:MEMOS, name:r=>[r.subject_name,r.title].filter(Boolean).join(" — ")},
    {label:"Opening", table:"manpower_requests", rows:MANPOWER, name:r=>r.worksite},
    {label:"Meeting sign-in", table:"meeting_attendance", rows:MEETINGS, name:r=>r.name},
    {label:"Meeting roster", table:"meeting_roster", rows:MEETING_ROSTER, name:r=>r.name},
    {label:"Store", table:"branches", rows:BRANCHES, name:r=>r.name},
  ];
  const found=[];
  SRC.forEach(s=>(s.rows||[]).forEach(r=>{ const nm=s.name(r)||""; if(r.is_demo||isDemoText(nm)) found.push({label:s.label, table:s.table, id:r.id, name:nm||"(unnamed)", flagged:!!r.is_demo}); }));
  pg.innerHTML=`
   <div class="panel" style="margin-top:0;">
     <h2>Demo Data <span class="count-tag">${found.length} demo record${found.length===1?'':'s'}</span></h2>
     <div class="psub">A safe sandbox for demos &amp; training. Create entries anywhere with <b>DEMO</b> in the name (e.g. an employee named <i>“DEMO Test Person”</i>), show them off, then remove them here. The delete is <b>locked to demo-marked records only</b> — real data can never be deleted from this screen (enforced in the database, not just the button).</div>
     ${found.length?`
       <div class="actionbar"><button class="btn" id="demoDelAll" style="background:var(--red);border-color:var(--red);color:#fff;">Delete all ${found.length} demo record${found.length===1?'':'s'}</button></div>
       <table><thead><tr><th>Type</th><th>Name</th><th></th></tr></thead><tbody>
       ${found.map(f=>`<tr><td><span class="pill di">${esc(f.label)}</span></td><td><b>${esc(f.name)}</b></td>
         <td style="text-align:right;"><button class="btn ghost" data-demodel="${esc(f.table)}|${esc(String(f.id))}" style="color:var(--red);border-color:#f1c9c5;">Delete</button></td></tr>`).join("")}
       </tbody></table>`
     : `<div class="placeholder" style="margin-top:12px;"><div class="pi"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#1E3A5F" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></div><h2>No demo data</h2><p>Create entries with “DEMO” in the name and they'll appear here, ready to clean up.</p></div>`}
   </div>`;
  $$("#page-demodata [data-demodel]").forEach(b=>b.addEventListener("click",()=>{ const i=b.dataset.demodel.indexOf("|"); demoDelete(b.dataset.demodel.slice(0,i), b.dataset.demodel.slice(i+1)); }));
  const all=$("#demoDelAll"); if(all) all.addEventListener("click",()=>demoDeleteAll(found));
}
async function demoDelete(table,id){
  if(!confirm("Delete this demo record? This can't be undone.")) return;
  const {error}=await sb.rpc("delete_demo_record",{p_table:table,p_id:String(id)});
  if(error){ alert("Could not delete: "+error.message); return; }
  await loadEmployees();
}
async function demoDeleteAll(found){
  if(!confirm(`Delete all ${found.length} demo records? This can't be undone.`)) return;
  let fail=0;
  for(const f of found){ const {error}=await sb.rpc("delete_demo_record",{p_table:f.table,p_id:String(f.id)}); if(error){ fail++; } }
  if(fail) alert(fail+" record(s) couldn't be deleted (they may have linked data). The rest were removed.");
  await loadEmployees();
}

function renderMaternity(){
  const pg=$("#page-maternity"); if(!pg||!canSeePay()) return;
  const M=MATERNITY||[];
  const draft=M.filter(m=>m.status==="Draft").length, awaiting=M.filter(m=>m.status==="Awaiting Sign-off").length, approved=M.filter(m=>m.status==="Approved").length;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Maternity Benefits</h2>
      <div class="psub">RA 11210 · computed per <b>DOLE Labor Advisory 01-2019</b>: full pay (daily rate × working days/month × maternity months — <b>normal working days, not attendance</b>) − SSS benefit − contributions = <b>salary differential</b> (taxable, forms part of 13th-month). Employer pays it only when full pay exceeds the SSS benefit. Salary-restricted — you &amp; Grazel only.</div>
      <div class="actionbar"><button class="btn" id="matNew">+ New maternity claim</button></div>
      <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi"><div class="k-l">Draft</div><div class="k-n">${draft}</div></div>
        <div class="kpi warn"><div class="k-l">Awaiting sign-off</div><div class="k-n">${awaiting}</div></div>
        <div class="kpi"><div class="k-l">Approved</div><div class="k-n">${approved}</div></div>
      </div>
      ${M.length?`<table><thead><tr><th>Employee</th><th>Type</th><th>Days</th><th>Delivery</th><th>Net payable</th><th>Status</th></tr></thead><tbody>
        ${M.map(m=>`<tr class="clickable" data-mid="${esc(m.id)}"><td><b>${esc(m.employee_name)}</b><div class="esub">${esc(m.worksite||"")}</div></td><td>${esc(m.claim_type||"")}${m.solo_parent?" · solo":""}</td><td>${m.leave_days||"—"}</td><td>${m.delivery_date?fmtDate(m.delivery_date):"—"}</td><td>${m.net_payable!=null?peso(m.net_payable):"—"}</td><td><span class="pill ${m.status==="Approved"?"active":(m.status==="Awaiting Sign-off"?"awol":"")}">${esc(m.status||"Draft")}</span></td></tr>`).join("")}
      </tbody></table>`:`<div class="psub" style="margin-top:6px;">No maternity claims yet — click “New maternity claim”.</div>`}
    </div>`;
  const nb=$("#matNew"); if(nb) nb.addEventListener("click",matPickEmployee);
  $$("#page-maternity tr.clickable[data-mid]").forEach(tr=>tr.addEventListener("click",()=>openMaternityForm(MATERNITY.find(m=>String(m.id)===tr.dataset.mid))));
}
function matDraftFromEmployee(e){ const office=/head office|104 shaw|\bH\.?O\.?\b/i.test((e.worksite||"")+" "+(e.department||"")); return { _new:true, employee_id:e.employee_id||null, employee_name:e.full_name, category:e.contract_type||null, worksite:e.worksite||null, hire_date:e.hire_date||null, civil_status:e.civil_status||null, bank_name:e.bank_name||null, bank_account:e.bank_account_number||null, daily_rate:e.daily_rate||null, claim_type:"Live birth", solo_parent:false, leave_days:105, pay_factor:office?288:312, msc:[], status:"Draft" }; }
function matPickEmployee(){
  let m=document.getElementById("matPick"); if(!m){ m=document.createElement("div"); m.id="matPick"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;padding:22px;max-height:82vh;display:flex;flex-direction:column;">
    <h2 style="font-size:17px;color:var(--green-dark);margin-bottom:2px;">New maternity claim</h2>
    <div class="psub">Search the employee — details + hire date fill from her record.</div>
    <input id="matQ" placeholder="Type a name…" autocomplete="off" style="width:100%;padding:10px 12px;border:1px solid #e2e7e4;border-radius:8px;font-size:14px;margin:4px 0 8px;">
    <div id="matHits" style="overflow-y:auto;flex:1;"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn ghost" id="matPickClose">Cancel</button></div>
  </div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("matPickClose").onclick=()=>m.remove();
  const q=document.getElementById("matQ"), hits=document.getElementById("matHits");
  const paint=()=>{ const s=(q.value||"").trim().toLowerCase();
    let list=(EMPLOYEES||[]).slice().sort((a,b)=>(a.full_name||"").localeCompare(b.full_name||""));
    if(s) list=list.filter(e=>(e.full_name||"").toLowerCase().includes(s)||String(e.employee_id||"").includes(s));
    list=list.slice(0,20);
    hits.innerHTML=list.length?list.map(e=>`<div class="task clickable" data-eid="${esc(String(e.id))}" style="cursor:pointer;"><div class="dot ${(e.status||'Active')==='Active'?'g':'r'}"></div><div><div class="tt">${esc(e.full_name)}</div><div class="td">${esc(e.position||"—")} · ${esc(e.worksite||"—")}${e.employee_id?" · "+esc(e.employee_id):""}</div></div></div>`).join(""):`<div class="psub" style="padding:8px 2px;">${s?"No match.":"Start typing…"}</div>`;
    hits.querySelectorAll("[data-eid]").forEach(el=>el.addEventListener("click",()=>{ const e=EMPLOYEES.find(x=>String(x.id)===el.dataset.eid); m.remove(); if(e) openMaternityForm(matDraftFromEmployee(e)); }));
  };
  q.addEventListener("input",paint); paint(); q.focus();
}
function matElig(c){
  const e=(EMPLOYEES||[]).find(x=>(c.employee_id&&x.employee_id===c.employee_id)||x.full_name===c.employee_name)||{};
  const f=[];
  if((e.status||"Active")!=="Active") f.push(["r","Employee is not Active in the roster — confirm status before release."]);
  const reg=e.regularization_date||/regular/i.test(e.contract_type||c.category||"");
  if(!reg) f.push(["a","Not tagged Regular — maternity leave covers all female workers, but confirm her employment status/tenure."]);
  if(c.hire_date){ const mo=(Date.now()-new Date(c.hire_date))/(86400000*30.4);
    if(mo<12) f.push(["a","Hired "+fmtDate(c.hire_date)+" (~"+Math.floor(mo)+" mo ago) — verify ≥3 SSS monthly contributions in the 12 months before the semester of delivery, or SSS may reduce/deny the benefit."]); }
  return f;
}
function openMaternityForm(c){
  if(!c) return; MAT_EDIT=Object.assign({},c);
  const isNew=!!c._new;
  const mf=(id,l,v)=>fld(id,l,v,"number"), df=(id,l,v)=>fld(id,l,v,"date");
  let m=document.getElementById("matModal"); if(!m){ m=document.createElement("div"); m.id="matModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:600px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;position:sticky;top:0;z-index:2;">
      <div style="font-size:20px;font-weight:800;">${esc(c.employee_name||"Maternity claim")}</div>
      <div style="font-size:12.5px;opacity:.9;">${esc(c.worksite||"—")}${c.employee_id?" · "+esc(c.employee_id):""} · ${esc(c.claim_ref||"new claim")} ${c.status?"· "+esc(c.status):""}</div>
    </div>
    <div id="matForm" style="padding:16px 20px 70px;">
      <div class="panel" style="margin-top:0;"><div class="subhead">A · Employee &amp; assignment</div>
        <div class="form-grid">${sel("mat_cat","Category",["Regular","Probationary","Contractual"],c.category||"Regular")}${fld("mat_civil","Civil status",c.civil_status)}</div>
        <div class="form-grid">${df("mat_hire","Date hired (from PayPlus)",c.hire_date)}<div style="margin-bottom:10px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:4px;">Solo parent?</label><label style="font-size:13.5px;display:flex;gap:7px;align-items:center;padding:8px 0;"><input type="checkbox" id="mat_solo" ${c.solo_parent?"checked":""}> Yes — adds 15 days (120 total)</label></div></div>
        <div class="form-grid">${fld("mat_bank","Bank name",c.bank_name)}${fld("mat_acct","Bank account #",c.bank_account)}</div>
      </div>
      <div class="panel"><div class="subhead">B · The maternity event</div>
        <div class="form-grid">${sel("mat_type","Type",["Live birth","Miscarriage"],c.claim_type||"Live birth")}${mf("mat_days","Leave days",c.leave_days||105)}</div>
        <div class="psub" style="margin:-4px 0 8px;">105 live · 120 solo parent · 60 miscarriage — auto-set, editable.</div>
        <div class="form-grid">${df("mat_delivery","Delivery date",c.delivery_date)}${df("mat_mat1","SSS MAT-1 date",c.mat1_date)}</div>
        <div class="form-grid">${df("mat_mat2","SSS MAT-2 date",c.mat2_date)}${df("mat_lstart","Leave start",c.leave_start)}</div>
        <div class="form-grid">${df("mat_lend","Leave end",c.leave_end)}<div></div></div>
      </div>
      <div class="panel"><div class="subhead">C · Full pay <span class="sh-note">DOLE LA 01-2019</span></div>
        <div class="form-grid">${mf("mat_dr","Daily salary rate (₱)",c.daily_rate)}
        <div style="margin-bottom:10px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:4px;">Pay factor</label>
          <select id="mat_factor" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;font-size:13.5px;">
            <option value="312" ${(Number(c.pay_factor)||312)===312?"selected":""}>312 — Retail / diser, daily-paid (26 days/mo)</option>
            <option value="288" ${Number(c.pay_factor)===288?"selected":""}>288 — Head Office, daily-paid (24 days/mo)</option>
            <option value="360" ${Number(c.pay_factor)===360?"selected":""}>360 — Head Office, monthly-paid (30 days/mo)</option>
            <option value="305" ${Number(c.pay_factor)===305?"selected":""}>305 — 6-day, special non-working days unpaid</option>
            <option value="313" ${Number(c.pay_factor)===313?"selected":""}>313 — 6-day week, rest days unpaid</option>
            <option value="261" ${Number(c.pay_factor)===261?"selected":""}>261 — 5-day week</option>
            <option value="253" ${Number(c.pay_factor)===253?"selected":""}>253 — 5-day, special days unpaid</option>
            <option value="365" ${Number(c.pay_factor)===365?"selected":""}>365 — all days paid</option>
          </select></div></div>
        <div class="psub" style="margin:-4px 0 4px;">Full pay = (daily rate × factor ÷ 12) × maternity months (a month = 30 days). The <b>factor</b> = paid days/year for the pay scheme — this is where "no-work-no-pay" enters, uniformly. Per DOLE it uses <b>normal working days, not actual attendance</b>; an individual's absences/late/undertime do NOT reduce it.</div>
      </div>
      <div class="panel"><div class="subhead">D · SSS contribution basis → SSS benefit</div>
        ${fld("mat_source","Source period (12 mos before semester of delivery)",c.source_period)}
        <div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:4px;">Monthly salary credits — paste all 12, comma-separated (system takes the 6 highest)</label>
          <textarea id="mat_msc" rows="2" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;font-size:13.5px;" placeholder="e.g. 14000, 14500, 12500, 13000, 13500, 13500, 11500, 12500, 14000, 11500, 13500, 16500">${esc(matMSC(c.msc).join(", "))}</textarea></div>
        ${mf("mat_sss_benefit_override","OR paste SSS-approved benefit amount (optional — overrides the above)",c.sss_benefit_override)}
      </div>
      <div class="panel"><div class="subhead">E · Contributions during leave <span class="sh-note">deducted from full pay per DOLE</span></div>
        <div class="form-grid">${mf("mat_deduct_sss","SSS employee share",c.deduct_sss)}${mf("mat_deduct_philhealth","PhilHealth share",c.deduct_philhealth)}</div>
        ${mf("mat_deduct_pagibig","Pag-IBIG share",c.deduct_pagibig)}
        <button class="btn ghost" id="mat_estContrib" type="button" style="margin-top:2px;">≈ Estimate at standard rates</button>
        <div class="psub" style="margin:4px 0 2px;">Her contributions for the leave period — DOLE deducts these from full pay. The estimate uses SSS 5% (capped at ₱20k MSC) · PhilHealth 2.5% · Pag-IBIG ₱200/mo × the leave months; <b>payroll confirms the exact figures.</b></div>
      </div>
      <div class="panel"><div class="subhead">F · Tax &amp; other deductions</div>
        ${mf("mat_tax_on_differential","Withholding tax on the salary differential (₱)",c.tax_on_differential)}
        <div class="psub" style="margin:-4px 0 6px;">⚠ The salary differential is <b>taxable income</b> (DOLE §III). The SSS benefit stays tax-free. Payroll computes the tax on the differential.</div>
        <div class="form-grid">${mf("mat_deduct_loans","SSS / Pag-IBIG loan",c.deduct_loans)}${mf("mat_deduct_advance","Company cash advance",c.deduct_advance)}</div>
        ${mf("mat_deduct_other","Other agreed deduction",c.deduct_other)}
        <label style="font-size:13px;display:flex;gap:7px;align-items:center;padding:6px 0;"><input type="checkbox" id="mat_include13" ${c.include_13th===false?"":"checked"}> Include this differential in her <b>&nbsp;13th-month&nbsp;</b> base (DOLE §IV)</label>
      </div>
      <div class="panel" style="border:1.5px solid #bcdcc7;background:var(--green-light);"><div class="subhead">Computation</div>
        <div id="matSummary"></div>
      </div>
      <div id="matElig"></div>
      <div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">Notes</label><textarea id="mat_notes" rows="2" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;font-size:13.5px;">${esc(c.notes||"")}</textarea></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn ghost" id="matCancel">Close</button>
        <button class="btn ghost" id="matPrint">Print form</button>
        <button class="btn" id="matSave" style="margin-left:auto;">${isNew?"Create claim":"Save"}</button>
        ${(!isNew&&c.id&&isAdminUser()&&c.status!=="Approved")?`<button class="btn" id="matApprove" style="background:#1f6b3a;">Approve &amp; release</button>`:""}
      </div>
    </div></div>`;
  m.addEventListener("click",ev=>{ if(ev.target===m) m.remove(); });
  document.getElementById("matCancel").onclick=()=>m.remove();
  document.getElementById("matSave").onclick=saveMaternity;
  document.getElementById("matPrint").onclick=printMaternity;
  const ap=document.getElementById("matApprove"); if(ap) ap.onclick=matApprove;
  // auto leave-days on type/solo change
  const setDays=()=>{ const t=document.getElementById("mat_type").value, solo=document.getElementById("mat_solo").checked; document.getElementById("mat_days").value=matDefaultDays(t,solo); matRecalc(); };
  document.getElementById("mat_type").addEventListener("change",setDays);
  document.getElementById("mat_solo").addEventListener("change",setDays);
  const est=document.getElementById("mat_estContrib"); if(est) est.addEventListener("click",matEstimateContributions);
  document.getElementById("matForm").addEventListener("input",matRecalc);
  matRecalc();
}
// Estimate the employee's contributions for the leave period at standard 2025 rates (payroll confirms exact).
function matEstimateContributions(){
  const c=matCollect(), factor=Number(c.pay_factor)||312, dr=Number(c.daily_rate)||0, days=Number(c.leave_days)||0;
  if(!dr||!days){ alert("Enter the daily rate and leave days first."); return; }
  const monthly=dr*factor/12, months=days/30;
  const sss=Math.round(0.05*Math.min(monthly,20000)*months);
  const phic=Math.round(0.025*monthly*months);
  const hdmf=Math.round(Math.min(monthly*0.02,200)*months);
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=v; };
  set("mat_deduct_sss",sss); set("mat_deduct_philhealth",phic); set("mat_deduct_pagibig",hdmf);
  matRecalc();
}
// Present days CAPPED at the standard days/month (we never add days above a full month — extra days are premium, not base pay),
// then late + undertime minutes netted off as day-equivalents (8h day). Only pulls the average DOWN for absences.
function matAvgFromAttendance(months,cap){
  const m=(months||[]).filter(x=>x.hasData&&Number(x.present)>0);
  if(!m.length) return null;
  const c=Number(cap)||26;
  const perMonth=m.map(x=>{ const lost=(Number(x.lateMinutes||0)+Number(x.undertimeMinutes||0))/480; return Math.max(0,Math.min(Number(x.present||0),c)-lost); });
  return perMonth.reduce((s,x)=>s+x,0)/perMonth.length;
}
function matAttSummaryHtml(months,avg,cap){
  const c=Number(cap)||26;
  const rows=(months||[]).filter(x=>x.hasData).map(x=>{ const p=Number(x.present||0), capped=p>c;
    return `<tr><td>${esc(x.month)}</td><td style="text-align:right;">${p}${capped?` <span style="color:var(--muted);">→${c}</span>`:""}</td><td style="text-align:right;">${x.absent||0}</td><td style="text-align:right;">${Number(x.lateMinutes||0).toFixed(1)}</td><td style="text-align:right;">${Number(x.undertimeMinutes||0).toFixed(1)}</td></tr>`;}).join("");
  return `<table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr style="color:var(--muted);"><th style="text-align:left;">Month</th><th style="text-align:right;">Present</th><th style="text-align:right;">Absent</th><th style="text-align:right;">Late(m)</th><th style="text-align:right;">UT(m)</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="margin-top:6px;font-weight:700;color:var(--green-dark);">Actual avg paid days/month: ${avg!=null?Number(avg).toFixed(2):"—"} <span style="font-weight:400;color:var(--muted);">(present capped at ${c}/mo, net of late + undertime — never above a full month)</span></div>`;
}
async function matPullAttendance(){
  const c=matCollect(); if(!c.employee_id){ alert("This employee has no PayPlus Employee ID on file — can't pull attendance."); return; }
  const del=c.delivery_date?new Date(c.delivery_date):null; if(!del||isNaN(del)){ alert("Set the delivery date first — attendance is pulled from the months before it."); return; }
  const box=document.getElementById("mat_attBox"); box.innerHTML='<div class="psub">Pulling from PayPlus…</div>';
  // 6 completed months before the delivery month
  let ey=del.getFullYear(), em=del.getMonth(); if(em===0){ em=12; ey--; }   // month before delivery (1-12)
  let sy=ey, sm=em-5; while(sm<1){ sm+=12; sy--; }
  try{
    const { data:{ session } } = await sb.auth.getSession();
    const url=`${SUPABASE_URL}/functions/v1/payplus-attendance?emp=${encodeURIComponent(c.employee_id)}&y1=${sy}&m1=${sm}&y2=${ey}&m2=${em}`;
    const r=await fetch(url,{ headers:{ Authorization:`Bearer ${session.access_token}`, apikey:SUPABASE_ANON_KEY } });
    const j=await r.json();
    if(j.error){ box.innerHTML=`<div class="note" style="background:#fdece9;border-color:#e5b4ae;color:#a4322a;">Couldn't pull: ${esc(j.error)}</div>`; return; }
    const avg=matAvgFromAttendance(j.months, c.days_per_month||26);
    if(avg==null){ box.innerHTML='<div class="note" style="background:#fffaf0;border-color:#f0d9a6;">No attendance found in that window — she may have been hired after it, or not enrolled. Use Contractual basis.</div>'; return; }
    MAT_EDIT.attendance=j.months; MAT_EDIT.actual_avg_days=avg;
    box.innerHTML=matAttSummaryHtml(j.months,avg,c.days_per_month||26);
    matRecalc();
  }catch(e){ box.innerHTML=`<div class="note" style="background:#fdece9;border-color:#e5b4ae;color:#a4322a;">Couldn't reach PayPlus: ${esc(String(e&&e.message||e))}</div>`; }
}
function matCollect(){
  const g=id=>{const el=document.getElementById(id);return el?el.value:null;};
  const num=id=>{const el=document.getElementById(id);return el&&el.value.trim()!==""?Number(el.value):0;};
  const c=Object.assign({},MAT_EDIT||{});
  c.category=g("mat_cat"); c.civil_status=g("mat_civil"); c.hire_date=g("mat_hire")||null;
  c.solo_parent=document.getElementById("mat_solo")?document.getElementById("mat_solo").checked:false;
  c.bank_name=g("mat_bank"); c.bank_account=g("mat_acct");
  c.claim_type=g("mat_type"); c.leave_days=num("mat_days");
  c.delivery_date=g("mat_delivery")||null; c.mat1_date=g("mat_mat1")||null; c.mat2_date=g("mat_mat2")||null;
  c.leave_start=g("mat_lstart")||null; c.leave_end=g("mat_lend")||null;
  c.daily_rate=num("mat_dr"); c.pay_factor=Number(g("mat_factor"))||313; c.days_per_month=c.pay_factor/12;
  c.source_period=g("mat_source")||null; c.msc=matMSC(g("mat_msc"));
  const ov=g("mat_sss_benefit_override"); c.sss_benefit_override=(ov&&ov.trim()!=="")?Number(ov):null;
  ["deduct_sss","deduct_philhealth","deduct_pagibig","deduct_loans","deduct_advance","deduct_other"].forEach(k=>c[k]=num("mat_"+k));
  c.tax_on_differential=num("mat_tax_on_differential");
  const inc=document.getElementById("mat_include13"); c.include_13th=inc?inc.checked:true;
  c.notes=g("mat_notes")||null;
  return c;
}
function matRecalc(){
  const c=matCollect(), r=computeMaternity(c), box=document.getElementById("matSummary"); if(!box) return;
  const row=(l,v,strong)=>`<div style="display:flex;justify-content:space-between;padding:3px 0;${strong?'font-weight:700;border-top:1px solid #bcdcc7;margin-top:3px;padding-top:6px;':''}"><span>${l}</span><span>${peso(v)}</span></div>`;
  box.innerHTML=`
    <div style="font-size:11.5px;color:#8a6a14;margin-bottom:4px;">DOLE LA 01-2019 · monthly = ₱${Number(r.dr).toLocaleString()} × factor ${Number(c.pay_factor)||312} ÷ 12 = ₱${Number(r.monthly).toLocaleString(undefined,{maximumFractionDigits:2})} (${r.dpm.toFixed(2)} days/mo · normal working days, not attendance)</div>
    ${row("Full pay (monthly ₱"+Number(r.monthly).toLocaleString(undefined,{maximumFractionDigits:2})+" × "+r.months.toFixed(2)+" mo)",r.fpmb,true)}
    ${row("Less: SSS maternity benefit",-r.sssBenefit)}
    ${row("Less: her SSS/PhilHealth/Pag-IBIG contributions",-r.contributions)}
    <div style="display:flex;justify-content:space-between;padding:6px 0 2px;font-weight:700;border-top:1px solid #bcdcc7;"><span>Salary differential (employer)${r.salaryDifferential>0?"":" — none (SSS+contrib ≥ full pay)"}</span><span>${peso(r.salaryDifferential)}</span></div>
    ${r.salaryDifferential>0?`<div style="font-size:11px;color:#a4322a;margin:1px 0 4px;">⚠ taxable income — withholding tax applies (DOLE §III)</div>`:""}
    ${r.tax>0?row("Less: withholding tax on differential",-r.tax):""}
    ${r.otherDeduct>0?row("Less: loans / advances / other",-r.otherDeduct):""}
    ${row("Employer pays (net)",r.employerNet,true)}
    <div style="height:6px;"></div>
    ${row("+ SSS benefit (tax-free, SSS-funded)",r.sssBenefit)}
    <div style="display:flex;justify-content:space-between;padding:8px 0 2px;font-weight:800;font-size:16px;color:var(--green-dark);border-top:2px solid var(--green-dark);margin-top:5px;"><span>TOTAL TO EMPLOYEE</span><span>${peso(r.net)}</span></div>
    <div style="font-size:11px;color:var(--muted);margin-top:5px;">6 highest MSC ₱${Number(r.sum6).toLocaleString()} ÷ 180 = ADSC ₱${r.adsc.toFixed(2)} × ${r.days} days = SSS ₱${Number(r.sssBenefit).toLocaleString(undefined,{minimumFractionDigits:2})}${r.override?" (overridden)":""}${c.include_13th?" · differential enters 13th-month base (§IV)":""}</div>`;
  const eb=document.getElementById("matElig"); if(eb){ const f=matElig(c);
    eb.innerHTML=f.length?`<div class="panel" style="background:#fffaf0;border:1px solid #f0d9a6;"><div class="subhead">Eligibility checks</div>${f.map(x=>`<div class="task"><div class="dot ${x[0]}"></div><div><div class="td">${esc(x[1])}</div></div></div>`).join("")}</div>`:"";
  }
}
async function saveMaternity(){
  const c=matCollect(), r=computeMaternity(c);
  if(!c.employee_name){ alert("No employee."); return; }
  const btn=document.getElementById("matSave"); btn.disabled=true; btn.textContent="Saving…";
  const payload={ employee_id:c.employee_id, employee_name:c.employee_name, category:c.category, worksite:c.worksite||MAT_EDIT.worksite, hire_date:c.hire_date, civil_status:c.civil_status,
    solo_parent:c.solo_parent, bank_name:c.bank_name, bank_account:c.bank_account, claim_type:c.claim_type, leave_days:c.leave_days,
    delivery_date:c.delivery_date, mat1_date:c.mat1_date, mat2_date:c.mat2_date, leave_start:c.leave_start, leave_end:c.leave_end,
    daily_rate:c.daily_rate, days_per_month:c.days_per_month, pay_factor:c.pay_factor||312, full_pay_basis:"DOLE", source_period:c.source_period, msc:c.msc, sss_benefit_override:c.sss_benefit_override,
    deduct_sss:c.deduct_sss, deduct_philhealth:c.deduct_philhealth, deduct_pagibig:c.deduct_pagibig, deduct_loans:c.deduct_loans, deduct_advance:c.deduct_advance, deduct_other:c.deduct_other,
    tax_on_differential:c.tax_on_differential, include_13th:c.include_13th,
    full_pay_daily:r.fullPayDaily, fpmb:r.fpmb, sss_benefit:r.sssBenefit, salary_differential:r.salaryDifferential, employer_share:r.employerNet, gross_benefit:r.sssBenefit+r.salaryDifferential, net_payable:r.net,
    notes:c.notes, updated_at:new Date().toISOString() };
  let res;
  if(MAT_EDIT._new||!MAT_EDIT.id){ payload.claim_ref="MAT-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+Math.random().toString(36).slice(2,5).toUpperCase(); payload.status="Draft"; payload.created_by=(CURRENT_USER&&CURRENT_USER.email)||"HR"; res=await sb.from("maternity_claims").insert(payload).select().single(); }
  else res=await sb.from("maternity_claims").update(payload).eq("id",MAT_EDIT.id);
  btn.disabled=false; btn.textContent="Save";
  if(res.error){ alert(res.error.message); return; }
  await logChange("maternity",(res.data&&res.data.id)||MAT_EDIT.id,c.employee_name,MAT_EDIT._new?"Claim created":"Claim updated",(c.claim_type||"")+" · "+c.leave_days+" days · net "+peso(r.net));
  const m=document.getElementById("matModal"); if(m) m.remove();
  await loadEmployees();
}
async function matApprove(){
  if(!MAT_EDIT||!MAT_EDIT.id){ alert("Save the claim first."); return; }
  if(!confirm("Approve this maternity claim for release?")) return;
  await sb.from("maternity_claims").update({status:"Approved", approved_at:new Date().toISOString().slice(0,10), updated_at:new Date().toISOString()}).eq("id",MAT_EDIT.id);
  await logChange("maternity",MAT_EDIT.id,MAT_EDIT.employee_name,"Approved",peso(MAT_EDIT.net_payable||0));
  const m=document.getElementById("matModal"); if(m) m.remove();
  await loadEmployees();
}
function printMaternity(){
  const c=matCollect(), r=computeMaternity(c);
  const P=n=>"₱"+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const w=window.open("","_blank"); if(!w){ alert("Allow pop-ups to print."); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>${esc(c.claim_ref||"Maternity")} — ${esc(c.employee_name||"")}</title><style>
    body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1F2A37;max-width:720px;margin:22px auto;padding:0 22px;font-size:13px;line-height:1.5;}
    h1{font-size:17px;text-align:center;margin:0 0 2px;} .sub{text-align:center;color:#5c6b60;font-size:12px;margin-bottom:14px;}
    table{width:100%;border-collapse:collapse;margin:8px 0;} td,th{border:1px solid #d8ddd9;padding:5px 8px;text-align:left;} th{background:#f3f6f4;}
    .n{text-align:right;} .tot{font-weight:700;background:#eef5ef;} .grid{display:flex;gap:24px;} .grid>div{flex:1;}
    .lbl{color:#6a766f;font-size:11px;text-transform:uppercase;} .conf{color:#a4322a;font-size:11px;margin-top:10px;}</style></head><body>
    <h1>MATERNITY BENEFITS CLAIM</h1><div class="sub">Roshan Commercial Corporation · RA 11210 · ${esc(c.claim_ref||"")}</div>
    <div class="grid"><div>
      <div class="lbl">Employee</div><b>${esc(c.employee_name||"")}</b> ${c.employee_id?"· "+esc(c.employee_id):""}<br>
      <div class="lbl" style="margin-top:6px;">Assignment</div>${esc(c.worksite||MAT_EDIT.worksite||"—")} · ${esc(c.category||"—")}<br>
      <div class="lbl" style="margin-top:6px;">Bank</div>${esc(c.bank_name||"—")} ${esc(c.bank_account||"")}
    </div><div>
      <div class="lbl">Type</div>${esc(c.claim_type||"")}${c.solo_parent?" · Solo parent":""} · ${r.days} days<br>
      <div class="lbl" style="margin-top:6px;">Delivery</div>${c.delivery_date?fmtDate(c.delivery_date):"—"}<br>
      <div class="lbl" style="margin-top:6px;">Leave period</div>${c.leave_start?fmtDate(c.leave_start):"—"} to ${c.leave_end?fmtDate(c.leave_end):"—"}<br>
      <div class="lbl" style="margin-top:6px;">Source period</div>${esc(c.source_period||"—")}
    </div></div>
    <table><tr><th colspan="2">Computation · DOLE Labor Advisory No. 01, s. 2019</th></tr>
      <tr><td>Full pay = (₱${Number(r.dr).toLocaleString()} × factor ${Number(c.pay_factor)||312} ÷ 12) × ${r.months.toFixed(2)} months</td><td class="n">${P(r.fpmb)}</td></tr>
      <tr><td>Less: SSS maternity benefit (6 highest MSC ₱${Number(r.sum6).toLocaleString()} ÷ 180 = ₱${r.adsc.toFixed(2)}/day × ${r.days})</td><td class="n">(${P(r.sssBenefit)})</td></tr>
      <tr><td>Less: SSS/PhilHealth/Pag-IBIG contributions during leave</td><td class="n">(${P(r.contributions)})</td></tr>
      <tr class="tot"><td>Salary differential (employer share) — taxable</td><td class="n">${P(r.salaryDifferential)}</td></tr>
      ${r.tax>0?`<tr><td>Less: withholding tax on differential</td><td class="n">(${P(r.tax)})</td></tr>`:""}
      ${r.otherDeduct>0?`<tr><td>Less: loans / advances / other</td><td class="n">(${P(r.otherDeduct)})</td></tr>`:""}
      <tr class="tot"><td>Employer pays (net)</td><td class="n">${P(r.employerNet)}</td></tr>
      <tr><td>Plus: SSS maternity benefit (tax-free, SSS-funded)</td><td class="n">${P(r.sssBenefit)}</td></tr>
      <tr class="tot" style="font-size:15px;"><td>TOTAL TO EMPLOYEE</td><td class="n">${P(r.net)}</td></tr>
    </table>
    <div class="conf">The SSS maternity benefit is tax-exempt; the salary differential is taxable income (DOLE §III) and forms part of the 13th-month base (§IV). Salary data is confidential.</div>
    <div class="grid" style="margin-top:40px;"><div>Prepared by<br><br><b>______________________</b><br><span class="lbl">HR — Compensation &amp; Benefits</span></div>
      <div>Approved by<br><br><b>Anju C. Genomal</b><br><span class="lbl">Director, Admin &amp; Finance</span></div></div>
    </body></html>`);
  w.document.close();
}
function renderReports(){
  const pg=$("#page-reports"); if(!pg) return;
  const now=new Date(); const mStart=new Date(now.getFullYear(),now.getMonth(),1);
  const inMonth=d=>{ const x=new Date(d); return !isNaN(x)&&x>=mStart&&x<=now; };

  // Openings
  const filled=MANPOWER.filter(o=>o.status==="Filled");
  const open=MANPOWER.filter(o=>o.status==="Open");
  const aging=open.map(o=>({o,days:o.date_posted?rptDays(o.date_posted,now):null}));
  const aged=aging.filter(x=>x.days!=null&&x.days>45);
  const fillRate=(filled.length+open.length)?filled.length/(filled.length+open.length):null;
  const ttf=rptAvg(filled.map(o=>o.date_posted&&o.updated_at?rptDays(o.date_posted,o.updated_at):null));

  // Candidates
  const hiredPh=PREHIRE.filter(p=>p.phase==="HIRED");
  const tth=rptAvg(hiredPh.map(p=>p.created_at&&p.updated_at?rptDays(p.created_at,p.updated_at):null));
  const IS=s=>PREHIRE.filter(p=>(p.interview_status||"")===s).length;
  const attended=IS("Interviewed")+IS("Final interview")+IS("Offered")+IS("Declined")+PREHIRE.filter(p=>p.interview_status==="Hired"||p.phase==="HIRED").length;
  const noshow=IS("No-show");
  const attendRate=(attended+noshow)?attended/(attended+noshow):null;
  const accepted=hiredPh.length, declined=IS("Declined");
  const offerRate=(accepted+declined)?accepted/(accepted+declined):null;

  // Retention: hired 90–365 days ago, still active
  const cohort=EMPLOYEES.filter(e=>{ if(!e.hire_date) return false; const d=rptDays(e.hire_date,now); return d!=null&&d>=90&&d<=365; });
  const retained=cohort.filter(e=>(e.status||"").toLowerCase().startsWith("active"));
  const retRate=cohort.length?retained.length/cohort.length:null;

  // This month
  const appsMo=PREHIRE.filter(p=>inMonth(p.created_at)).length;
  const hiredMo=hiredPh.filter(p=>inMonth(p.updated_at)).length;
  const postedMo=MANPOWER.filter(o=>inMonth(o.date_posted)).length;
  const filledMo=filled.filter(o=>inMonth(o.updated_at)).length;

  // Hires by month (last 6) from employees.hire_date, HO/WH vs Retail; separations where end_date known
  const months=[]; for(let i=5;i>=0;i--){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push(d); }
  const mLbl=d=>d.toLocaleDateString("en-US",{month:"short",year:"2-digit"});
  const rowsHires=months.map(d=>{
    const e2=new Date(d.getFullYear(),d.getMonth()+1,0);
    const hs=EMPLOYEES.filter(e=>e.hire_date&&new Date(e.hire_date)>=d&&new Date(e.hire_date)<=e2);
    const ho=hs.filter(e=>e.group_name==="Head Office"||e.group_name==="Warehouse").length;
    const rt=hs.length-ho;
    const seps=EMPLOYEES.filter(e=>e.end_date&&new Date(e.end_date)>=d&&new Date(e.end_date)<=e2).length;
    return `<tr><td><b>${mLbl(d)}</b></td><td>${ho}</td><td>${rt}</td><td>${hs.length}</td><td>${seps||"—"}</td></tr>`;
  }).join("");

  const pct=v=>v==null?"—":(Math.round(v*100)+"%");
  const days=v=>v==null?"—":(Math.round(v)+" days");
  const funnelOrder=["Screened","Invited","Interviewed","No-show","Failed","Final interview","Offered","Declined","Hired"];
  const funnelRow=funnelOrder.map(s=>`<td style="text-align:center;"><div style="font-size:17px;font-weight:800;">${s==="Hired"?hiredPh.length:IS(s)}</div><div style="font-size:10.5px;color:var(--muted);">${s}</div></td>`).join("");

  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Recruitment Reports <span class="count-tag">live — computed from portal data</span></h2>
      <div class="psub">The KPIs from the recruitment workbook, calculated automatically. Targets from the agreed KPI sheet. Data updates as the team works — no manual encoding.</div>
      <table><thead><tr><th>KPI</th><th>Target</th><th>Actual</th><th>Status</th></tr></thead><tbody>
        <tr><td>Open positions (now)</td><td>—</td><td><b>${open.length}</b> req${open.length===1?"":"s"} · ${open.reduce((s,o)=>s+(Number(o.count_needed)||0),0)} heads</td><td><span class="pill di">informational</span></td></tr>
        <tr><td>Open-position aging</td><td>≤ 45 days</td><td>${aged.length} over 45d${aging.length?` · oldest ${Math.max(...aging.map(x=>x.days||0))}d`:""}</td><td>${rptStatus(aged.length,0,"low")}</td></tr>
        <tr><td>Vacancy fill rate (cumulative)</td><td>≥ 85%</td><td>${pct(fillRate)} <span class="note">(${filled.length} filled / ${filled.length+open.length} posted)</span></td><td>${rptStatus(fillRate,0.85,"high")}</td></tr>
        <tr><td>Time to fill (avg, filled reqs)</td><td>≤ 30 days</td><td>${days(ttf)}</td><td>${rptStatus(ttf,30,"low")}</td></tr>
        <tr><td>Time to hire (avg, applicant → hired)</td><td>≤ 14 days</td><td>${days(tth)}</td><td>${rptStatus(tth,14,"low")}</td></tr>
        <tr><td>Interview attendance</td><td>≥ 80%</td><td>${pct(attendRate)} <span class="note">(${noshow} no-show)</span></td><td>${rptStatus(attendRate,0.8,"high")}</td></tr>
        <tr><td>Offer acceptance</td><td>≥ 90%</td><td>${pct(offerRate)} <span class="note">(${accepted} hired · ${declined} declined)</span></td><td>${rptStatus(offerRate,0.9,"high")}</td></tr>
        <tr><td>90-day retention (hired 3–12 mo ago)</td><td>≥ 90%</td><td>${pct(retRate)} <span class="note">(${retained.length}/${cohort.length} still active)</span></td><td>${rptStatus(retRate,0.9,"high")}</td></tr>
      </tbody></table>
      <div class="psub" style="margin-top:8px;">Not computable from portal data (stay manual for now): <b>recruitment cost per hire</b> · <b>applicant response time</b>. Time-to-hire uses the hired date recorded in the pipeline.</div>
    </div>
    <div class="panel">
      <h2>This month <span class="count-tag">${now.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</span></h2>
      <div class="grid kpis" style="grid-template-columns:repeat(4,1fr);">
        <div class="kpi"><div class="k-l">Applications</div><div class="k-n">${appsMo}</div></div>
        <div class="kpi"><div class="k-l">Hired</div><div class="k-n">${hiredMo}</div></div>
        <div class="kpi"><div class="k-l">Openings posted</div><div class="k-n">${postedMo}</div></div>
        <div class="kpi"><div class="k-l">Openings filled</div><div class="k-n">${filledMo}</div></div>
      </div>
    </div>
    <div class="panel">
      <h2>Candidate funnel <span class="count-tag">current pipeline</span></h2>
      <table><tbody><tr>${funnelRow}</tr></tbody></table>
      <div class="psub" style="margin-top:6px;">Set each candidate's funnel stage in Pre-hire → Edit applicant → Recruiting/interview.</div>
    </div>
    <div class="panel">
      <h2>Hires &amp; separations by month <span class="count-tag">last 6 months</span></h2>
      <table><thead><tr><th>Month</th><th>HO / Warehouse</th><th>Retail</th><th>Total hired</th><th>Separations*</th></tr></thead><tbody>${rowsHires}</tbody></table>
      <div class="psub" style="margin-top:6px;">*Separations count only exits recorded with an end date in the portal — PayPlus-side attrition isn't fully captured yet, so treat as a minimum.</div>
    </div>`;
}

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
  // Links now live in one hub (Links to Send) — this just points there, so there's only one place to keep updated.
  return `<div style="background:#eef4ef;border:1px solid var(--line);border-radius:10px;padding:11px 14px;margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
    <div style="flex:1;min-width:190px;font-size:12.5px;color:var(--muted);">Application, agency, loan &amp; candidate-survey links now live in one place.</div>
    <button class="btn ghost" onclick="go('links')" style="flex-shrink:0;">Links to send →</button>
  </div>`;
}
function renderPrehire(){
  const pg=$("#page-prehire"); if(!pg) return;
  const inPipe=PREHIRE.filter(p=>p.phase!=="HIRED"&&p.phase!=="REJECTED"&&p.phase!=="DRAFT"&&p.phase!=="POOLED");  // DRAFT = agency not-yet-submitted; POOLED = talent pool — neither is in RCC's active pipeline
  const drafts=PREHIRE.filter(p=>p.phase==="DRAFT");
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
      ${drafts.length?`<div style="margin-top:10px;padding:9px 12px;background:#fdf6e3;border:1px solid #ecdca6;border-radius:9px;font-size:12.5px;color:#7a5c12;">🟡 <b>${drafts.length}</b> candidate${drafts.length>1?'s':''} saved in agency drafts but <b>not yet submitted to RCC</b> ${(()=>{const bs={};drafts.forEach(d=>{const s=d.hire_source||'Direct';bs[s]=(bs[s]||0)+1;});return '('+Object.entries(bs).map(([s,n])=>esc(s)+' '+n).join(' · ')+')';})()}. They appear in the <b>Agency Draft</b> lane below — the agency must click “Submit to RCC” on their own page before these enter your pipeline.</div>`:""}
      <div class="tabs" id="phTabs" style="margin-top:14px;">
        <div class="tab ${prehireTab==='pipeline'?'active':''}" data-t="pipeline">Pipeline</div>
        <div class="tab ${prehireTab==='pool'?'active':''}" data-t="pool">Talent Pool${(()=>{const n=PREHIRE.filter(p=>p.phase==='POOLED').length;return n?` <span class="count-tag">${n}</span>`:'';})()}</div>
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
  else if(prehireTab==="pool") phBodyPool();
  else phBodyPipeline();
}

function phBodyPipeline(){
  const srcMatch=p=>!prehireSrc || (prehireSrc==="Direct"?(!p.hire_source||p.hire_source==="Direct"):p.hire_source===prehireSrc);
  // DRAFT = agency in-progress submissions (not yet shipped to RCC). Show as the leftmost lane so nothing is hidden.
  const draftPhase={key:"DRAFT",label:"Agency Draft",actor:"agency · not yet submitted"};
  const cols=[draftPhase].concat(PH_PHASES).map(ph=>{
    const cards=PREHIRE.filter(p=>p.phase===ph.key && srcMatch(p));
    if(ph.key==="DRAFT" && cards.length===0) return "";  // hide the draft lane entirely when empty
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

const prioBadge=(p)=>{ const c=p==="High"?"background:#fdecea;color:#c0392b;border:1px solid #f1c9c5;":p==="Medium"?"background:#fdf6e3;color:#8a6d1a;border:1px solid #ecdca6;":"background:#eef1ef;color:#5a6660;border:1px solid #dde3df;"; return `<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;${c}">${esc(p||"—")}</span>`; };
function phBodyPool(){
  const all=PREHIRE.filter(p=>p.phase==="POOLED");
  // filter option lists come from what's actually in the pool
  const positions=[...new Set(all.map(p=>p.position).filter(Boolean))].sort();
  const scales=[...new Set(all.map(p=>p.pool_salary_scale).filter(Boolean))].sort();
  const q=(poolSearch||"").toLowerCase();
  const now=Date.now();
  const yearOf=p=>{ const d=p.pooled_at||p.updated_at; return d?String(new Date(d).getFullYear()):"Undated"; };
  const monthsIn=p=>{ const d=p.pooled_at||p.updated_at; return d?Math.floor((now-new Date(d))/2629800000):null; };
  let list=all.filter(p=>
      (!poolFilterPos   || p.position===poolFilterPos) &&
      (!poolFilterScale || p.pool_salary_scale===poolFilterScale) &&
      (!poolFilterPrio  || (p.pool_priority||"")===poolFilterPrio) &&
      (!q || (p.full_name||"").toLowerCase().includes(q) || (p.position||"").toLowerCase().includes(q) || (p.pool_reason||"").toLowerCase().includes(q)));
  // ranked WITHIN a year: priority High→Low, then most-recently pooled first
  list.sort((a,b)=>{ const ra=POOL_PRIO_RANK[a.pool_priority]??3, rb=POOL_PRIO_RANK[b.pool_priority]??3; if(ra!==rb) return ra-rb; return new Date(b.pooled_at||b.updated_at||0)-new Date(a.pooled_at||a.updated_at||0); });
  // group into annual buckets, most recent year first (Undated last)
  const years=[...new Set(list.map(yearOf))].sort((a,b)=> a==="Undated"?1 : b==="Undated"?-1 : Number(b)-Number(a));
  const curYear=String(new Date(now).getFullYear());
  const selOpt=(cur,arr)=>['<option value="">All</option>'].concat(arr.map(o=>`<option value="${esc(o)}" ${cur===o?'selected':''}>${esc(o)}</option>`)).join("");
  const rowHtml=(c,i)=>`<tr>
          <td style="color:var(--muted);">${i+1}</td>
          <td><b>${esc(c.full_name)}</b><div style="font-size:11px;color:var(--muted);">${esc(c.hire_source||"Direct")}${c.email?` · ${esc(c.email)}`:""}${c.phone?` · ${esc(c.phone)}`:""}</div></td>
          <td>${esc(c.position||"—")}<div style="font-size:11px;color:var(--muted);">${esc(c.worksite||"")}</div></td>
          <td>${esc(c.pool_salary_scale||"—")}</td>
          <td>${prioBadge(c.pool_priority)}</td>
          <td style="font-size:12px;color:var(--muted);white-space:nowrap;">${c.pooled_at?fmtMDY(c.pooled_at):"—"}</td>
          <td style="font-size:12px;color:#3a4540;max-width:220px;">${esc(c.pool_reason||"")}</td>
          <td style="white-space:nowrap;"><button class="btn ghost pool-open" data-id="${c.id}" style="padding:5px 10px;font-size:12px;">Open</button> <button class="btn pool-back" data-id="${c.id}" style="padding:5px 10px;font-size:12px;">↩ To pipeline</button></td>
        </tr>`;
  const yearBlock=(yr)=>{ const rows=list.filter(p=>yearOf(p)===yr); const old=yr!=="Undated"&&yr!==curYear;
    return `<div style="display:flex;align-items:baseline;gap:8px;margin-top:18px;">
        <div style="font-size:15px;font-weight:800;color:var(--ink,#1E3A5F);">${yr==="Undated"?"Undated":"Pooled "+yr}</div>
        <span class="count-tag">${rows.length}</span>${old?`<span style="font-size:11.5px;color:#b7791f;">· earlier year</span>`:""}
      </div>
      <div style="overflow-x:auto;margin-top:6px;">
      <table style="min-width:720px;"><thead><tr><th>#</th><th>Candidate</th><th>Position</th><th>Salary scale</th><th>Priority</th><th>Pooled</th><th>Why kept</th><th></th></tr></thead>
        <tbody>${rows.map(rowHtml).join("")}</tbody></table></div>`; };
  $("#phBody").innerHTML=`
    <div class="panel" style="margin-top:14px;">
      <h2>Talent Pool <span class="count-tag">${all.length}</span></h2>
      <div class="psub">Qualified applicants we liked but didn't proceed with — kept warm for future vacancies and replacements, so we can fill a slot without restarting recruitment. <b>Grouped by the year they were pooled</b>, and within each year ranked by priority (High→Low), newest first. <b>Maintained by Vina &amp; Rhel.</b> Set a candidate's priority &amp; salary scale when you move them here (any candidate → open → <b>Move to Talent Pool</b>).</div>
      ${all.length===0
        ? `<div class="task" style="margin-top:12px;"><div class="dot a"></div><div><div class="tt">The pool is empty</div><div class="td">Open any candidate in the Pipeline (or a Rejected one) and click <b>☆ Move to Talent Pool</b> to add them here with a priority and salary scale.</div></div></div>`
        : `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:12px;">
        <div style="flex:1;min-width:150px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">Position applied for</label>
          <select id="pf_pos" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;">${selOpt(poolFilterPos,positions)}</select></div>
        <div style="flex:1;min-width:150px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">Salary scale</label>
          <select id="pf_scale" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;">${selOpt(poolFilterScale,scales)}</select></div>
        <div style="min-width:130px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">Priority</label>
          <select id="pf_prio" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;">${selOpt(poolFilterPrio,POOL_PRIORITIES)}</select></div>
        <div style="flex:1;min-width:150px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">Search</label>
          <input id="pf_q" value="${esc(poolSearch)}" placeholder="name, position…" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;"></div>
        <button class="btn ghost" id="pf_clear" style="flex-shrink:0;">Clear</button>
        <button class="btn blue" id="pf_export" style="flex-shrink:0;">Export CSV</button>
      </div>
      <div class="psub" style="margin-top:10px;">${list.length} of ${all.length} shown${(poolFilterPos||poolFilterScale||poolFilterPrio||q)?" (filtered)":""} · ${years.length} year${years.length>1?'s':''}.</div>
      ${list.length? years.map(yearBlock).join("") : `<div class="psub" style="margin-top:14px;text-align:center;color:var(--muted);">No candidates match these filters.</div>`}`}
    </div>`;
  const reRender=()=>{ phBodyPool(); };
  const g=id=>document.getElementById(id);
  if(g("pf_pos")) g("pf_pos").addEventListener("change",e=>{ poolFilterPos=e.target.value; reRender(); });
  if(g("pf_scale")) g("pf_scale").addEventListener("change",e=>{ poolFilterScale=e.target.value; reRender(); });
  if(g("pf_prio")) g("pf_prio").addEventListener("change",e=>{ poolFilterPrio=e.target.value; reRender(); });
  if(g("pf_q")) g("pf_q").addEventListener("input",e=>{ poolSearch=e.target.value; const pos=e.target.selectionStart; reRender(); const nq=document.getElementById("pf_q"); if(nq){ nq.focus(); try{nq.setSelectionRange(pos,pos);}catch(_){} } });
  if(g("pf_clear")) g("pf_clear").addEventListener("click",()=>{ poolFilterPos=poolFilterScale=poolFilterPrio=""; poolSearch=""; reRender(); });
  if(g("pf_export")) g("pf_export").addEventListener("click",()=>{
    const cols=[["Year","Year"],["full_name","Candidate"],["position","Position"],["pool_salary_scale","Salary scale"],["pool_priority","Priority"],["pooled_at","Pooled"],["hire_source","Source"],["email","Email"],["phone","Phone"],["worksite","Worksite"],["pool_reason","Why kept"]];
    const rows=list.map((c)=>cols.map(([k])=>{ const val=k==="Year"?yearOf(c):(k==="pooled_at"?(c[k]?fmtMDY(c[k]):""):(c[k]==null?"":c[k])); return `"${String(val).replace(/"/g,'""')}"`; }).join(","));
    const csv=cols.map(c=>c[1]).join(",")+"\n"+rows.join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="talent-pool.csv";a.click();
  });
  $$("#phBody .pool-open").forEach(b=>b.addEventListener("click",()=>openPrehire(PREHIRE.find(p=>String(p.id)===b.dataset.id))));
  $$("#phBody .pool-back").forEach(b=>b.addEventListener("click",()=>returnFromPool(PREHIRE.find(p=>String(p.id)===b.dataset.id))));
}
async function returnFromPool(c){
  if(!c) return;
  if(!confirm(`Return ${c.full_name} to the active pipeline?\n\nThey re-enter at "Applied". Their pool notes stay on record.`)) return;
  await setPhase(c,"APPLIED");
}
// Move a candidate we liked into the Talent Pool (also used to edit an already-pooled candidate's details).
function poolPrehire(c, parentModal){
  if(!c) return;
  let m=document.getElementById("phPoolModal"); if(!m){ m=document.createElement("div"); m.id="phPoolModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:10000;background:rgba(14,50,25,.5);display:flex;align-items:center;justify-content:center;padding:24px;";
  const already=c.phase==="POOLED";
  m.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;padding:22px;">
    <h2 style="font-size:17px;margin-bottom:2px;">${already?"Edit pool details":"☆ Move to Talent Pool"} — ${esc(c.full_name)}</h2>
    <div class="psub">A qualified applicant we're keeping warm for a future vacancy. Set how strongly we want them and the salary scale so HR can filter later.</div>
    <label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin:12px 0 3px;">Priority</label>
    <select id="pl_prio" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:#fff;">${POOL_PRIORITIES.map(p=>`<option ${(c.pool_priority||"Medium")===p?"selected":""}>${p}</option>`).join("")}</select>
    <label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin:10px 0 3px;">Salary scale</label>
    <select id="pl_scale" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:#fff;">${POOL_SALARY_SCALES.map(s=>`<option ${(c.pool_salary_scale||"Not specified")===s?"selected":""}>${esc(s)}</option>`).join("")}</select>
    <label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin:10px 0 3px;">Why we're keeping them (optional)</label>
    <textarea id="pl_reason" rows="2" placeholder="e.g. Strong on merchandising, no slot in her area yet" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;">${esc(c.pool_reason||"")}</textarea>
    <div id="plMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
    <div style="display:flex;gap:10px;margin-top:12px;"><button class="btn ghost" id="plCancel" style="flex:1;">Cancel</button><button class="btn" id="plGo" style="flex:1;">${already?"Save":"Move to pool"}</button></div>
  </div>`;
  m.addEventListener("click",e=>{ if(e.target===m) m.remove(); });
  document.getElementById("plCancel").addEventListener("click",()=>m.remove());
  document.getElementById("plGo").addEventListener("click",async()=>{
    const patch={ pool_priority:v("pl_prio"), pool_salary_scale:v("pl_scale"), pool_reason:v("pl_reason")||null, updated_at:new Date().toISOString() };
    if(!already){ patch.phase="POOLED"; patch.pooled_at=new Date().toISOString(); patch.pooled_by=myEmail()||null; }
    const { error } = await sb.from("prehire").update(patch).eq("id",c.id);
    if(error){ document.getElementById("plMsg").textContent=error.message; return; }
    m.remove(); if(parentModal) parentModal.remove();
    await loadEmployees(); prehireTab="pool"; window.go("prehire");
  });
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
        ${c.phase==="POOLED"
          ? `<span class="pill ag">☆ In Talent Pool${c.pool_priority?` · ${esc(c.pool_priority)}`:""}</span><button class="btn" id="phPoolEdit">Edit pool details</button><button class="btn blue" id="phUnpool">↩ Return to pipeline</button>`
          : `${next?`<button class="btn blue" id="phAdvance">Advance → ${esc(next.label)}</button>`:'<span class="pill active">Pipeline complete</span>'}
             ${c.phase!=="HIRED"?'<button class="btn ghost" id="phPool" title="Keep this candidate warm for a future vacancy">☆ Move to Talent Pool</button>':''}
             ${c.phase!=="REJECTED"?'<button class="btn ghost" id="phReject" style="color:var(--red);border-color:#f1c9c5;">Reject</button>':''}`}
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
  const pool=document.getElementById("phPool"); if(pool) pool.addEventListener("click",()=>poolPrehire(c,m));
  const poolEd=document.getElementById("phPoolEdit"); if(poolEd) poolEd.addEventListener("click",()=>poolPrehire(c,null));
  const unpool=document.getElementById("phUnpool"); if(unpool) unpool.addEventListener("click",()=>{ m.remove(); returnFromPool(c); });
}
function editPrehire(c){
  let m=document.getElementById("phEditModal"); if(!m){ m=document.createElement("div"); m.id="phEditModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.5);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:560px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;"><div style="font-size:20px;font-weight:800;">Edit applicant — ${esc(c.full_name)}</div><div style="font-size:12.5px;opacity:.85;">${esc(c.prehire_id)} · ${esc(phLabel(c.phase))}</div></div>
    <div style="padding:18px 22px;">
      <div class="panel" style="margin-top:0;"><div class="subhead">Identity</div>
        ${fld("pe_full_name","Full name *",c.full_name)}${sel("pe_department","Department",DEPARTMENTS,c.department)}${fld("pe_position","Position",c.position)}${sel("pe_hire_source","Hire source",HIRE_SOURCES,c.hire_source||"Direct")}${(()=>{ const parts=(c.worksite||"").split(" · "); const w1=parts[0]||"", w2=parts[1]||"";
          const opts=[...new Set(["Head Office","Warehouse Solaris",...BRANCHES.map(b=>b.name).sort()])];
          return sel("pe_worksite","Worksite / location",[...new Set([...opts,...(w1?[w1]:[])])],w1)
               + sel("pe_worksite2","2nd store — roving/reliever only (optional)",["",...opts.filter(o=>o!=="Head Office"),...(w2&&!opts.includes(w2)?[w2]:[])],w2); })()}
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
      ${canEditIds()?`<div class="panel"><div class="subhead">Government numbers &amp; bank</div>
        ${fld("pe_sss","SSS",c.sss_number)}${fld("pe_phil","PhilHealth",c.philhealth_number)}${fld("pe_pag","Pag-IBIG",c.pagibig_number)}${fld("pe_tin","TIN",c.tin_number)}${fld("pe_bank","Bank name",c.bank_name)}${fld("pe_acct","Bank account number",c.bank_account_number)}
      </div>`:canSeeIds()?`<div class="panel"><div class="subhead">Government numbers &amp; bank <span class="sh-note">view only — entered by Vina (backup: Grazel)</span></div>
        ${roField("SSS",c.sss_number)}${roField("PhilHealth",c.philhealth_number)}${roField("Pag-IBIG",c.pagibig_number)}${roField("TIN",c.tin_number)}${roField("Bank name",c.bank_name)}${roField("Bank account number",c.bank_account_number)}
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
    const _w2=v("pe_worksite2");
    const p={ full_name:name, department:v("pe_department"), position:v("pe_position"), hire_source:v("pe_hire_source"), worksite:(v("pe_worksite")||"")+(_w2?" · "+_w2:"")||null,
      email:v("pe_email"), phone, date_of_birth:v("pe_dob"), civil_status:v("pe_civil"), permanent_address:v("pe_perm"), current_address:v("pe_curr"),
      emergency_contact_name:v("pe_ecn"), emergency_contact_relation:v("pe_ecr"), emergency_contact_number:v("pe_ecnum"),
      assessment_type:v("pe_atype"), assessment_score:nv("pe_ascore"),
      contract_type:v("pe_ctype"), pay_basis:v("pe_paybasis"), start_date:v("pe_start"), supervisor_name:v("pe_super"),
      hr_officer_notes:v("pe_notes"), sm_acceptance:v("pe_sm"),
      interview_status:v("pe_istatus"), interview_date:v("pe_idate"), interviewer:v("pe_interviewer"), updated_at:new Date().toISOString() };
    if(canEditIds()){ Object.assign(p,{ sss_number:v("pe_sss"), philhealth_number:v("pe_phil"), pagibig_number:v("pe_pag"), tin_number:v("pe_tin"), bank_name:v("pe_bank"), bank_account_number:v("pe_acct") }); }
    if(canSeePay()){ Object.assign(p,{ daily_rate:nv("pe_rate"), daily_allowance:nv("pe_allow") }); }
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
      ${demoChk("np_isdemo",e.is_demo)}
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
      email:v("np_email"), phone:v("np_phone"), is_demo:demoChecked("np_isdemo") };
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
    </div>
    ${(()=>{ // Uniform send-out list — every hire's size + whether the uniform's been issued
      const rows=ONBOARDING.map(c=>{ const ut=ONBTASKS.find(t=>t.case_id===c.id&&t.task_key==="uniform"); return {c, sent:ut&&ut.status==="Done"}; });
      const uTop=c=>c.uniform_size_top||c.uniform_size||"";
      const needSizeFn=c=>!uTop(c)||!c.uniform_size_bottom;
      const pend=rows.filter(r=>!r.sent).length, needSize=rows.filter(r=>needSizeFn(r.c)).length;
      if(!rows.length) return "";
      return `<div class="panel"><h2>Uniform send-out list <span class="count-tag">${pend} to send</span></h2>
        <div class="psub">Every hire's top &amp; bottom size and whether their uniform's gone out. ${needSize?`<b style="color:var(--red);">${needSize} still need a size recorded</b> (open the case → Uniform).`:"All sizes recorded ✓"} Mark "Issue uniform" done in the case once sent.</div>
        <table><thead><tr><th>Hire</th><th>Worksite</th><th>Position</th><th>Top</th><th>Bottom</th><th>Uniform</th></tr></thead><tbody>
        ${rows.sort((a,b)=>(a.sent?1:0)-(b.sent?1:0)).map(r=>`<tr class="clickable" data-uid="${r.c.id}">
          <td><b>${esc(r.c.employee_name)}</b></td><td>${esc(r.c.worksite||"—")}</td><td>${esc(r.c.position||"—")}</td>
          <td>${uTop(r.c)?`<span class="pill di">${esc(uTop(r.c))}</span>`:'<span class="pill awol">no size</span>'}</td>
          <td>${r.c.uniform_size_bottom?`<span class="pill di">${esc(r.c.uniform_size_bottom)}</span>`:'<span class="pill awol">no size</span>'}</td>
          <td>${r.sent?'<span class="pill active">Sent ✓</span>':'<span class="pill probation">To send</span>'}</td></tr>`).join("")}
        </tbody></table></div>`;
    })()}`;
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
  $$("#page-onboarding tr.clickable[data-uid]").forEach(tr=>tr.addEventListener("click",()=>openOnboardingCase(tr.dataset.uid)));
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
    worksite:pre.worksite||null, position:pre.position||null, deployment_date:pre.start_date||null, pay_method:"GCash", status:"In Progress", is_demo:!!pre.is_demo };
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
        <div class="kpi"><div class="k-l">Employee ID</div><div class="k-n" style="font-size:18px;">${c.assigned_employee_id?esc(c.assigned_employee_id):"—"}</div><div class="k-s">PayPlus number${c.assigned_employee_id&&canManageStores()?' · <span id="onbFixId" style="color:var(--red);cursor:pointer;text-decoration:underline;">correct</span>':''}</div></div>
        <div class="kpi"><div class="k-l">Pay method</div><div class="k-n" style="font-size:18px;">${esc(c.pay_method||"GCash")}</div></div>
        <div class="kpi"><div class="k-l">Deployment</div><div class="k-n" style="font-size:18px;">${c.deployment_date?fmtDate(c.deployment_date):"—"}</div></div>
      </div>
      ${!c.assigned_employee_id?`<button class="btn" id="onbAssignId" style="margin-top:12px;">Enter PayPlus Employee ID →</button>`:""}
      <div class="panel" style="margin-top:14px;"><h2>Uniform</h2>
        <div class="psub">Top &amp; bottom sizes drive the send-out list. Mark the "Issue uniform" task done once it's sent.</div>
        <div style="display:flex;gap:12px;">
          <div style="flex:1;">${sel("onb_usize_top","Top size",["","XS","S","M","L","XL","2XL","3XL"],(c.uniform_size_top||c.uniform_size)||"")}</div>
          <div style="flex:1;">${sel("onb_usize_bot","Bottom size",["","XS","S","M","L","XL","2XL","3XL","26","28","30","32","34","36","38","40","42","44","46"],c.uniform_size_bottom||"")}</div>
        </div>
      </div>
      ${issuedItemsPanel(c)}
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
  const uszT=document.getElementById("onb_usize_top"), uszB=document.getElementById("onb_usize_bot");
  const saveUsz=async()=>{ const t=uszT&&uszT.value||null, b=uszB&&uszB.value||null;
    await sb.from("onboarding_cases").update({uniform_size_top:t, uniform_size_bottom:b, uniform_size:t, updated_at:new Date().toISOString()}).eq("id",c.id);
    c.uniform_size_top=t; c.uniform_size_bottom=b; c.uniform_size=t;
    const idx=ONBOARDING.findIndex(x=>x.id===c.id); if(idx>=0){ ONBOARDING[idx].uniform_size_top=t; ONBOARDING[idx].uniform_size_bottom=b; ONBOARDING[idx].uniform_size=t; }
    renderOnboarding(); };
  if(uszT) uszT.addEventListener("change",saveUsz);
  if(uszB) uszB.addEventListener("change",saveUsz);
  wireIssuedItems(c);
  const aid=document.getElementById("onbAssignId"); if(aid) aid.addEventListener("click",()=>assignEmployeeId(c));
  const fid=document.getElementById("onbFixId"); if(fid) fid.addEventListener("click",async()=>{
    fid.textContent="looking up…";
    const pid=await resolvePayPlusId(c.employee_name);
    if(!pid){ fid.textContent="correct"; return; }
    await sb.from("onboarding_cases").update({assigned_employee_id:pid, updated_at:new Date().toISOString()}).eq("id",c.id);
    if(c.prehire_id) await sb.from("prehire").update({assigned_employee_id:pid}).eq("id",c.prehire_id);
    await logChange("onboarding",c.id,c.employee_name,"Edited","Employee ID corrected → "+pid);
    await loadEmployees(); openOnboardingCase(c.id);
  });
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
// ONE ID EVERYWHERE: the portal never invents employee IDs — it PULLS the PayPlus ID (Grazel's mismatch report, 2026-07-01; auto-lookup added per anj: avoid manual errors).
function askPayPlusId(name){
  const raw=prompt("Enter "+name+"'s PayPlus Employee ID (numbers only, e.g. 500020).\n\nGet it from PayPlus after payroll enrolls them — the portal and PayPlus must carry the SAME number.","");
  if(raw===null) return null;
  const pid=raw.trim();
  if(!/^[0-9]{4,8}$/.test(pid)){ alert("That doesn't look like a PayPlus ID (numbers only, e.g. 500020). Enroll them in PayPlus first, then enter the ID it assigns."); return null; }
  return pid;
}
async function lookupPayPlusId(name){
  try{
    const {data:{session}}=await sb.auth.getSession();
    const r=await fetch(window.RCC_CONFIG.SUPABASE_URL+"/functions/v1/payplus-sync?lookup="+encodeURIComponent(name),
      {method:"POST",headers:{Authorization:"Bearer "+(session?session.access_token:window.RCC_CONFIG.SUPABASE_ANON_KEY),apikey:window.RCC_CONFIG.SUPABASE_ANON_KEY}});
    const d=await r.json(); return (d&&d.candidates)||[];
  }catch(e){ return []; }
}
async function resolvePayPlusId(name){
  const c=await lookupPayPlusId(name);
  if(c.length===1){
    if(confirm("Found in PayPlus:\n\n"+c[0].employeeId+" — "+c[0].name+"\n"+(c[0].location||"")+" · "+(c[0].company||"")+"\n\nUse this Employee ID?")) return c[0].employeeId;
    return askPayPlusId(name);
  }
  if(c.length>1){
    const list=c.map((x,i)=>(i+1)+") "+x.employeeId+" — "+x.name+" ("+(x.location||"—")+")").join("\n");
    const pick=prompt("PayPlus matches for "+name+":\n\n"+list+"\n\nType the number to use (or type the Employee ID directly):","1");
    if(pick===null) return null;
    const n=parseInt(pick,10);
    if(n>=1&&n<=c.length) return c[n-1].employeeId;
    if(/^[0-9]{4,8}$/.test(pick.trim())) return pick.trim();
    alert("Didn't recognize that choice — try again."); return null;
  }
  alert("No PayPlus match found for \""+name+"\" — they may not be enrolled in PayPlus yet.\n\nIf payroll already enrolled them, you can type the ID on the next screen.");
  return askPayPlusId(name);
}
async function assignEmployeeId(c){
  const btn=document.getElementById("onbAssignId"); if(btn){ btn.disabled=true; btn.textContent="Looking up PayPlus…"; }
  const data=await resolvePayPlusId(c.employee_name);
  if(btn){ btn.disabled=false; btn.textContent="Enter PayPlus Employee ID →"; }
  if(!data) return;
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
      ${cs===6?`<div class="panel"><h2>Employee ID</h2><div class="psub">Final step — record the <b>PayPlus Employee ID</b> (payroll assigns it on enrollment), then this contract is fully executed.</div></div>`:""}
      <div id="ctMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;">
        ${dn<7&&!c.rejected_at?`<button class="btn" id="ctAdvance">${cs===6?'Enter PayPlus ID & execute':'Advance — '+esc(CONTRACT_STEPS[cs].label)}</button>`:(dn===7?'<span class="pill active">Fully executed ✓</span>':'')}
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
  else if(step===6){ const data=await resolvePayPlusId(c.employee_name||"this employee"); if(!data) return; patch.employee_id_assigned=data; patch.employee_id_assigned_at=now; patch.stage="fully_executed";
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
// Assets recorded as ISSUED at onboarding (HMO handled by its own provider/member fields).
const ISSUED_ASSETS=[["id","Company / Mall ID"],["locker","Locker / cabinet keys"],["handbook","Staff handbook"],["laptop","Laptop / desktop"],["cellphone","Cellphone + charger"],["camera","Camera / devices"],["broadband","Broadband stick"],["vehicle","Company vehicle + keys"],["cards","Business cards"]];
function linkedEmployeeForCase(c){ if(!c||!c.assigned_employee_id) return null; return (EMPLOYEES||[]).find(e=>String(e.employee_id||"")===String(c.assigned_employee_id))||null; }
function issItemChecked(iss,k){ const v=iss&&iss[k]; return !!(v&&(v===true||v.v)); }
// The issued items for an exit case = the linked employee's record (+ HMO synthesised as hmo_card).
function exitIssuedItems(x){ const e=(EMPLOYEES||[]).find(y=>y.id===x.employee_id); const iss=Object.assign({}, (e&&e.issued_items)||{}); if(e&&(e.hmo_member_no||e.hmo_provider)) iss.hmo_card={v:true,note:[e.hmo_provider,e.hmo_member_no].filter(Boolean).join(" · ")}; return iss; }
function exitEmpLink(x){ return "https://agenovi.github.io/rcc-hris-portal/exit.html?token="+(x.emp_link_token||""); }

/* ---- External sign-off links (no-login e-signature for non-portal signers, e.g. the SC in charge) ---- */
const SIGNOFF_BASE="https://agenovi.github.io/rcc-hris-portal/sign-off.html";
function newSignoffToken(){ try{ return (crypto.randomUUID()+crypto.randomUUID()).replace(/-/g,""); }catch(_){ return "t"+Date.now().toString(36)+Math.abs(Math.floor(Math.random()*1e12)).toString(36); } }
function signoffUrl(t){ return SIGNOFF_BASE+"?token="+encodeURIComponent(t||""); }
function exSignoffsFor(x){ return EXT_SIGNOFFS.filter(r=>r.context_type==="exit" && String(r.context_id)===String(x.id)); }
function empIsMerch(e){ const g=(e&&e.group_name)||"", p=((e&&e.position)||"").toLowerCase(); return g==="Retail" || /diser|merchandiser|promo/.test(p); }
// The standard signer for a merchandiser = the SC in charge of their store (derived from the worksite).
function scForExit(x){
  const e=(EMPLOYEES||[]).find(y=>y.id===x.employee_id); if(!e||!empIsMerch(e)) return null;
  const ws=(e.worksite||"").trim().toLowerCase(); if(!ws) return null;
  let b=BRANCHES.find(b=>(b.name||"").trim().toLowerCase()===ws);
  if(!b) b=BRANCHES.find(b=>ws && (b.name||"").trim().toLowerCase() && (ws.includes((b.name||"").trim().toLowerCase())||(b.name||"").trim().toLowerCase().includes(ws)));
  const sc=b&&b.sc; return (sc && sc!=="Unassigned")?{name:sc, role:"SC in charge — "+(b.name||e.worksite)}:null;
}
// The document snapshot the signer reviews + signs (no salary — just the clearance certification).
function exSignoffDoc(x, role){
  const e=(EMPLOYEES||[]).find(y=>y.id===x.employee_id)||{};
  const row=(k,v)=>`<div class="row"><span class="k">${k}</span><span>${esc(v||"—")}</span></div>`;
  return `${row("Employee", x.employee_name)}${row("Position", x.position||e.position)}${row("Store / worksite", e.worksite||x.department)}${row("Last working day", x.last_working_day?fmtDate(x.last_working_day):"—")}${row("Clearance ref", x.clearance_id)}`
    +`<div style="margin-top:12px;line-height:1.55;">By signing below, I confirm that <b>${esc(x.employee_name||"this employee")}</b> has been <b>cleared</b> for their responsibility under <b>${esc(role||"my area")}</b>, and I have no outstanding accountability to raise against them (or I have noted it to HR separately).</div>`;
}
async function exCreateSignoff(x, name, role, deptKey, email){
  const nm=(name||"").trim(); if(!nm) return;
  const token=newSignoffToken();
  const label=(x.employee_name||"")+" — exit clearance"+(role?" · "+role:"");
  const doc=exSignoffDoc(x, role);
  const { error } = await sb.from("external_signoffs").insert({ token, context_type:"exit", context_id:String(x.id), context_label:label, signer_name:nm, signer_role:role||null, signer_email:(email||"").trim()||null, dept_key:deptKey||null, document_html:doc, created_by:myEmail() });
  if(error){ alert(error.message); return; }
  const url=signoffUrl(token);
  try{ await navigator.clipboard.writeText(url); }catch(_){}
  const to=(email||"").trim();
  if(to && confirm("Sign-off link created & copied.\n\nOpen an email to "+nm+" ("+to+") with the link now?")){
    const subject="RCC exit clearance — please sign off ("+(role||"")+")";
    const body="Hi "+nm+",\n\nPlease review and sign off this exit clearance for "+(x.employee_name||"")+" — open your private link (no login, sign with your real signature on your phone):\n\n"+url+"\n\nThank you,\nRCC HR";
    window.location.href="mailto:"+encodeURIComponent(to)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
  } else if(!to){ alert("Sign-off link created & copied — send it to "+nm+" via WhatsApp or email."); }
  await loadEmployees(); openExitCase(x.id);
}
async function exDeleteSignoff(id){ if(!confirm("Remove this sign-off request?")) return; await sb.from("external_signoffs").delete().eq("id",id); await loadEmployees(); }
function viewSignoffSignature(id){
  const r=EXT_SIGNOFFS.find(v=>String(v.id)===String(id)); if(!r) return;
  const w=window.open("","_blank","width=520,height=560");
  w.document.write(`<title>Signature — ${esc(r.signer_name)}</title><body style="font-family:-apple-system,sans-serif;padding:24px;color:#1b2430;">
    <h2 style="color:#0e3219;margin:0 0 4px;">${esc(r.signer_name)}</h2>
    <div style="color:#6b7683;font-size:13px;">${esc(r.signer_role||"")}</div>
    <div style="color:#6b7683;font-size:13px;margin:2px 0 14px;">Signed as: <b>${esc(r.signed_name||"—")}</b> · ${r.signed_at?new Date(r.signed_at).toLocaleString():""} · IP ${esc(r.signer_ip||"—")}</div>
    <img src="${r.signature_data}" style="max-width:100%;border:1px solid #e4e8ef;border-radius:10px;">
    <div style="color:#9aa3ac;font-size:11px;margin-top:12px;">Electronic signature captured under RA 8792. ${esc(r.context_label||"")}</div></body>`);
}
function exSignoffPanelHtml(x){
  const list=exSignoffsFor(x); const sc=scForExit(x);
  const statusPill=r=>r.status==="Signed"?`<span class="pill active">Signed ✓</span>`:(r.status==="Declined"?`<span class="pill closed">Declined</span>`:`<span class="pill awol">Awaiting signature</span>`);
  const rows=list.map(r=>`<div class="task" style="align-items:flex-start;">
      <div class="dot ${r.status==='Signed'?'g':(r.status==='Declined'?'r':'a')}" style="margin-top:5px;"></div>
      <div style="flex:1;min-width:0;"><div class="tt">${esc(r.signer_name)} ${statusPill(r)}</div>
        <div class="td">${esc(r.signer_role||"")}${r.status==='Signed'?` · as ${esc(r.signed_name||"")}${r.signed_at?" · "+fmtDate(r.signed_at):""}`:""}${r.status==='Declined'&&r.decline_reason?` · “${esc(r.decline_reason)}”`:""}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
          ${r.status!=='Signed'?`<button class="btn ghost" data-socopy="${esc(r.token)}" type="button" style="font-size:12px;padding:5px 10px;">🔗 Copy link</button>`:`<button class="btn ghost" data-soview="${r.id}" type="button" style="font-size:12px;padding:5px 10px;">View signature</button>`}
          <button class="btn ghost" data-sodel="${r.id}" type="button" style="font-size:12px;padding:5px 10px;">Remove</button>
        </div></div></div>`).join("");
  return `<div class="panel"><h2>Sign-off links <span class="count-tag">${list.filter(r=>r.status==='Signed').length}/${list.length||0} signed</span></h2>
    <div class="psub">For people who must sign off but <b>aren't portal users</b> (e.g. the SC in charge). Generate a private link → send it (WhatsApp/email) → they open it on their phone, sign with their finger, and it lands back here. No login, no access to anything else.</div>
    ${sc?`<div style="background:#f3f8f4;border:1px solid #cfe6d6;border-radius:9px;padding:10px 12px;margin:10px 0;">
      <div style="font-size:13px;"><b>Standard signer:</b> ${esc(sc.name)} <span class="td">· ${esc(sc.role)}</span></div>
      <button class="btn" id="soAddStd" type="button" style="margin-top:8px;font-size:13px;padding:7px 13px;">+ Create sign-off link for ${esc(sc.name)}</button>
    </div>`:`<div class="psub" style="color:#9a6a00;">No SC-in-charge found for this person's store — add one manually below.</div>`}
    ${rows||`<div class="psub">No sign-off links yet.</div>`}
    <div style="border:1px dashed var(--line);border-radius:9px;padding:11px;margin-top:10px;">
      <div style="font-weight:700;font-size:13px;margin-bottom:6px;">Add another signer <span class="td" style="font-weight:400;">(alternate — subject to approval)</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input id="soName" placeholder="Signer's name" style="flex:1;min-width:150px;padding:8px 10px;border:1px solid var(--line);border-radius:7px;font-size:13.5px;">
        <input id="soRole" placeholder="Their role / what they clear" style="flex:1;min-width:150px;padding:8px 10px;border:1px solid var(--line);border-radius:7px;font-size:13.5px;">
      </div>
      <button class="btn ghost" id="soAddCustom" type="button" style="margin-top:8px;font-size:13px;padding:7px 13px;">+ Create link</button>
    </div>
  </div>`;
}
// Per-department sign-off wiring (merged into each department row).
function wireDeptSignoffs(x, m){
  m.querySelectorAll("[data-sosend]").forEach(b=>b.addEventListener("click",()=>{
    const k=b.dataset.sosend; const nm=((document.getElementById("cbnm_"+k)||{}).value||"").trim();
    const em=((document.getElementById("cbem_"+k)||{}).value||"").trim();
    if(!nm){ const f=document.getElementById("cbnm_"+k); if(f) f.focus(); return; }
    const st=EXIT_STAGES.find(s=>s.key===k);
    exCreateSignoff(x, nm, st?st.label:"Sign-off", k, em);
  }));
  m.querySelectorAll("[data-socopy]").forEach(b=>b.addEventListener("click",async()=>{ const url=signoffUrl(b.dataset.socopy); try{ await navigator.clipboard.writeText(url); b.textContent="✓ Copied"; setTimeout(()=>b.textContent="🔗 Copy link",1600); }catch(_){ prompt("Copy the sign-off link:", url); } }));
  m.querySelectorAll("[data-soview]").forEach(b=>b.addEventListener("click",()=>viewSignoffSignature(b.dataset.soview)));
  m.querySelectorAll("[data-sodel]").forEach(b=>b.addEventListener("click",()=>exDeleteSignoff(b.dataset.sodel)));
}
function issItemNote(iss,k){ const v=iss&&iss[k]; return (v&&typeof v==="object"&&v.note)||""; }
function issuedItemsPanel(c){
  const emp=linkedEmployeeForCase(c);
  if(!emp) return `<div class="panel" style="margin-top:14px;"><h2>Issued to this person</h2><div class="psub">Record what's handed out (HMO, ID, devices…) so the <b>exit clearance knows exactly what to collect back</b> — no guessing later. Enter the PayPlus Employee ID above first, then this attaches to their record.</div></div>`;
  const iss=emp.issued_items||{};
  const row=([k,l])=>`<label style="display:flex;align-items:center;gap:8px;margin:5px 0;font-size:13px;"><input type="checkbox" data-iss="${k}" ${issItemChecked(iss,k)?"checked":""}><span style="width:150px;flex-shrink:0;">${esc(l)}</span><input data-issnote="${k}" value="${esc(issItemNote(iss,k))}" placeholder="detail (optional)" style="flex:1;min-width:0;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:12.5px;"></label>`;
  return `<div class="panel" id="issPanel" data-empid="${emp.id}" style="margin-top:14px;"><h2>Issued to this person</h2>
    <div class="psub">Tick what was handed out — the exit clearance auto-loads this so HR never guesses what to collect back.</div>
    <div style="display:flex;gap:10px;margin:6px 0 10px;">
      <div style="flex:1;"><label style="font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;">HMO provider</label><input id="iss_hmo_prov" value="${esc(emp.hmo_provider||"")}" placeholder="e.g. Maxicare" style="width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:6px;font-size:13px;"></div>
      <div style="flex:1;"><label style="font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;">HMO member no.</label><input id="iss_hmo_no" value="${esc(emp.hmo_member_no||"")}" placeholder="card / member #" style="width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:6px;font-size:13px;"></div>
    </div>
    ${ISSUED_ASSETS.map(row).join("")}
    <div style="margin-top:10px;"><button class="btn" id="issSave">Save issued items</button><span id="issMsg" style="font-size:12.5px;margin-left:10px;"></span></div>
  </div>`;
}
async function wireIssuedItems(c){
  const save=document.getElementById("issSave"); if(!save) return;
  save.addEventListener("click",async()=>{
    const panel=document.getElementById("issPanel"); const empid=panel&&panel.dataset.empid; if(!empid) return;
    const items={};
    document.querySelectorAll('[data-iss]').forEach(cb=>{
      const k=cb.dataset.iss; if(!cb.checked) return;
      const note=((document.querySelector('[data-issnote="'+k+'"]')||{}).value||"").trim();
      items[k]=note?{v:true,note:note}:{v:true};
    });
    const patch={ issued_items:items,
      hmo_provider:(document.getElementById("iss_hmo_prov").value.trim()||null),
      hmo_member_no:(document.getElementById("iss_hmo_no").value.trim()||null),
      updated_at:new Date().toISOString() };
    save.disabled=true; const msg=document.getElementById("issMsg");
    const {error}=await sb.from("employees").update(patch).eq("id",empid);
    save.disabled=false;
    if(error){ msg.style.color="var(--red)"; msg.textContent=error.message; return; }
    msg.style.color="var(--green-dark)"; msg.textContent="✓ Saved — exit clearance will auto-load this";
    const e=(EMPLOYEES||[]).find(x=>x.id===empid); if(e){ e.issued_items=items; e.hmo_provider=patch.hmo_provider; e.hmo_member_no=patch.hmo_member_no; }
  });
}
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
/* ---------- QUITCLAIM / FINAL-PAY breakdown — mirrors HR's Excel computation, line by line ---------- */
const FP_CLAIMS=[
  ["last_payroll","Last payroll","Unpaid salary for the last worked period — state the period."],
  ["thirteenth_month","13th-month pro-rata","Earned 13th month for the year, prorated to the last day."],
  ["leave_incentive","Leave incentive / SIL","Unused Service Incentive Leave converted to cash."],
  ["hmo_reversal","HMO reversal",""],
  ["tax_refund","Tax refund",""],
  ["rebates_incentives","Rebates on incentives",""],
  ["commission","Commission / incentives",""]
];
const FP_DEDUCTIONS=[
  ["breach_of_contract","Breach of contract","⚖ Needs a signed contract clause (liquidated damages) & must not drop net below wage due — flag with counsel if unsure."],
  ["advances_office_loan","Advances / office loan","Outstanding cash advance or office / loan balance."],
  ["other_charges","Other charges",""],
  ["inventory_short","Inventory short","Signed NTE / ATD is the deduct gate — cite the ref #."]
];
const FP_ALL=FP_CLAIMS.concat(FP_DEDUCTIONS);
function fpSum(fp,defs){ return defs.reduce((t,[k])=>t+Number((fp&&fp[k])||0),0); }
function fpClaims(fp){ return fpSum(fp,FP_CLAIMS); }
function fpDeductions(fp){ return fpSum(fp,FP_DEDUCTIONS); }
function fpNet(fp){ return fpClaims(fp)-fpDeductions(fp); }
function hasFinalPay(x){ return !!(x && x.final_pay && typeof x.final_pay==="object"); }
function exitDeductions(x){ if(hasFinalPay(x)) return fpDeductions(x.final_pay); let d=Number(x.uniform_deduction||0); EXIT_STAGES.forEach(s=>{ if(s.c) d+=Number(x[s.c]||0); }); return d; }
function exitPayables(x){ if(hasFinalPay(x)) return fpClaims(x.final_pay); return Number(x.outstanding_salary||0)+Number(x.sil_payment||0)+Number(x.thirteenth_month||0)+Number(x.tax_refund||0)+Number(x.pending_commission||0); }
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
        <td>${x.overall_status==="Complete"?'<span class="pill closed">Separated</span>':(x.separation_status==="Submitted"?'<span class="pill cn">Awaiting approval</span>':'<span class="pill probation">In Progress</span>')+ageTag}</td></tr>`;
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
    overall_status:"In Progress", is_demo:!!emp.is_demo };
  EXIT_STAGES.forEach(s=>{ c[s.s]="Pending"; });
  const { data, error } = await sb.from("exit_clearance").insert(c).select().single();
  if(error){ alert(error.message); return; }
  await loadEmployees(); window.go("exit"); openExitCase(data.id);
}
function exNumField(id,label,val){ return `<div style="margin-bottom:8px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px;">${label}</label><input id="${id}" type="number" step="0.01" value="${val??""}" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;font-size:13.5px;"></div>`; }
// Earned lines that split into Basic salary + Allowance (mirrors Juvelyn's Excel).
const FP_SPLIT=new Set(["last_payroll","thirteenth_month","leave_incentive"]);
// A split line: two boxes side by side (Basic | Allowance) + note; line total shown live.
function fpSplitField(key,label,hint,fp){
  const basic=(fp&&fp[key+"_basic"]!=null)?fp[key+"_basic"]:((fp&&fp[key]!=null)?fp[key]:"");
  const allow=(fp&&fp[key+"_allowance"]!=null)?fp[key+"_allowance"]:"";
  const n=fp&&fp[key+"_note"];
  const box=(sub,idv,val,ph)=>`<div style="flex:1;min-width:0;"><input id="fp_${key}_${sub}" data-fpsplit="${key}" type="number" step="0.01" value="${val??""}" placeholder="${ph}" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;font-size:13.5px;"><div style="font-size:10px;color:#8a948e;text-transform:uppercase;letter-spacing:.3px;margin-top:2px;text-align:center;">${idv}</div></div>`;
  return `<div style="margin-bottom:11px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px;">${label} <span id="fptot_${key}" style="color:var(--green-dark);font-weight:800;"></span></label>
    <div style="display:flex;gap:8px;">${box("basic","Basic salary",basic,"Basic ₱")}${box("allowance","Allowance",allow,"Allowance ₱")}</div>
    <input id="fpn_${key}" value="${esc(n||"")}" placeholder="${esc(hint||"note / remarks (optional)")}" style="width:100%;margin-top:5px;padding:5px 9px;border:1px solid #eef1ee;border-radius:6px;font-size:11.5px;color:#5c6b60;background:#fbfcfb;"></div>`;
}
// One quitclaim line: amount + an optional remarks note (matches the Excel's per-line REMARKS column).
function fpField(key,label,hint,fp){ const v=fp&&fp[key], n=fp&&fp[key+"_note"];
  return `<div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px;">${label}</label>
    <input id="fp_${key}" type="number" step="0.01" value="${v??""}" placeholder="0.00" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;font-size:13.5px;">
    <input id="fpn_${key}" value="${esc(n||"")}" placeholder="${esc(hint||"note / remarks (optional)")}" style="width:100%;margin-top:4px;padding:5px 9px;border:1px solid #eef1ee;border-radius:6px;font-size:11.5px;color:#5c6b60;background:#fbfcfb;"></div>`; }
// Read the quitclaim form back out of the open exit modal.
function collectFinalPay(){ const m=document.getElementById("exModal"); if(!m) return {};
  const num=id=>{ const e=m.querySelector("#fp_"+id); return e&&e.value.trim()!==""?Number(e.value):0; };
  const note=id=>{ const e=m.querySelector("#fpn_"+id); return e?e.value.trim():""; };
  const fp={}; FP_ALL.forEach(([k])=>{
    if(FP_SPLIT.has(k)){ const b=num(k+"_basic"), a=num(k+"_allowance"); fp[k+"_basic"]=b; fp[k+"_allowance"]=a; fp[k]=b+a; }
    else { fp[k]=num(k); }
    const nt=note(k); if(nt) fp[k+"_note"]=nt; });
  const ba=m.querySelector("#fp_bank_account"), pi=m.querySelector("#fp_payment_instruction");
  if(ba) fp.bank_account=ba.value.trim(); if(pi) fp.payment_instruction=pi.value.trim();
  fp.total_claims=fpClaims(fp); fp.total_deductions=fpDeductions(fp); fp.net=fpNet(fp); return fp; }
const qcPill=(s)=>{ const m={"Draft":["probation","Draft"],"Awaiting Sign-off":["awol","Awaiting your sign-off"],"Approved":["active","Approved · signed"],"Declined":["closed","Declined"]}; const p=m[s]; return p?`<span class="pill ${p[0]}">${p[1]}</span>`:""; };
// Plain-text quitclaim the Director sees on the sign screen — the figures travel WITH the signature.
function finalPayBody(x,fp){ const emp=(EMPLOYEES||[]).find(e=>e.id===x.employee_id)||{};
  const money=n=>"PHP "+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const pad=(lbl,amt,note)=>{ const L=("  "+lbl).padEnd(34,".").slice(0,34); return L+" "+money(amt).padStart(15)+(note?"   ("+note+")":""); };
  const line="  "+"-".repeat(48);
  const L=[];
  L.push("QUITCLAIM — FINAL PAY COMPUTATION","");
  L.push("Employee: "+(x.employee_name||"—"));
  L.push("Employee ID: "+(emp.employee_id||"—")+"  ·  "+(x.position||emp.position||"—"));
  if(emp.worksite||x.department) L.push("Branch: "+(emp.worksite||x.department));
  L.push("Date hired: "+(x.hire_date?fmtDate(x.hire_date):"—")+"  ·  Last day: "+(x.last_working_day?fmtDate(x.last_working_day):"—"));
  L.push("Separation: "+(x.separation_type||"—"),"");
  L.push("CLAIMS (owed to employee)");
  FP_CLAIMS.forEach(([k,lbl])=>{
    if(Number(fp[k]||0)===0 && !fp[k+"_note"]) return;
    L.push(pad(lbl,fp[k],fp[k+"_note"]));
    if(FP_SPLIT.has(k) && (fp[k+"_basic"]!=null || fp[k+"_allowance"]!=null)){
      L.push(pad("   • Basic salary",Number(fp[k+"_basic"]||0)));
      L.push(pad("   • Allowance",Number(fp[k+"_allowance"]||0)));
    }
  });
  L.push(line, pad("Total claims",fpClaims(fp)),"");
  L.push("LESS: DEDUCTIONS");
  FP_DEDUCTIONS.forEach(([k,lbl])=>{ if(Number(fp[k]||0)!==0||fp[k+"_note"]) L.push(pad(lbl,fp[k],fp[k+"_note"])); });
  L.push(line, pad("Total deductions",fpDeductions(fp)),"");
  L.push(line.replace(/-/g,"="));
  L.push(("  NET PAID TO EMPLOYEE").padEnd(34," ")+" "+money(fpNet(fp)).padStart(15));
  L.push(line.replace(/-/g,"="),"");
  if(fp.payment_instruction||fp.bank_account) L.push("Payment: "+[fp.payment_instruction,fp.bank_account].filter(Boolean).join("  ·  "));
  const PREP_NAME={ "anj@hassarams.com":"Anju C. Genomal — Director, Admin & Finance", "hr@hassarams.com":"Juvelyn Belvistre — HR Officer", "hr1@hassarams.com":"Vina — Human Resources", "hr3@hassarams.com":"Grazel Lyn Agulto — HR Officer", "hr4@hassarams.com":"Rhel Vinluan — HR Manager" };
  const prepEmail=((CURRENT_USER&&CURRENT_USER.email)||"").toLowerCase();
  L.push("","Prepared by: "+(PREP_NAME[prepEmail]||"Human Resources Department"));
  L.push("Approving: Anju C. Genomal — Director, Admin & Finance");
  L.push("","Your signature below approves this final-pay computation for release (RA 8792).");
  return L.join("\n"); }
function openExitCase(id){
  const x=EXITCASES.find(v=>String(v.id)===String(id)); if(!x) return;
  const t=x.tenure_months; const under6=t!=null&&t<6;
  // Seed the quitclaim form: use the saved breakdown if present, else pre-fill from any legacy final-pay fields so nothing is lost.
  const fp = hasFinalPay(x) ? x.final_pay : {
    last_payroll:x.outstanding_salary||"", thirteenth_month:x.thirteenth_month||"", leave_incentive:x.sil_payment||"",
    tax_refund:x.tax_refund||"", commission:x.pending_commission||"",
    inventory_short:Number(x.finance_inventory_charges||0)||"", advances_office_loan:Number(x.finance_disbursement_charges||0)||""
  };
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
        <div class="psub">Each department clears its items. Enter who cleared it, or <b>send that person a private sign-off link</b> (they upload their real signature on their phone, no login) — signing <b>auto-clears</b> that department.</div>
        ${(()=>{ const emp0=(EMPLOYEES||[]).find(e=>e.id===x.employee_id)||{}; return EXIT_STAGES.map(s=>{
          const by=(x.signoff_by||{})[s.key]||{};
          const so=exSignoffsFor(x).find(r=>String(r.dept_key||"")===s.key);
          const defEmail=s.key==='supervisor'?(emp0.supervisor_email||""):"";
          let signer;
          if(so && so.status==='Signed'){
            signer=`<div style="margin-top:5px;font-size:12px;color:var(--green-dark);font-weight:700;">✓ Signed by ${esc(so.signed_name||so.signer_name)}${so.signed_at?" · "+fmtDate(so.signed_at):""} <button class="btn ghost" data-soview="${so.id}" type="button" style="font-size:11px;padding:3px 8px;margin-left:4px;">View signature</button></div>`;
          } else if(so && so.status==='Declined'){
            signer=`<div style="margin-top:5px;font-size:12px;color:var(--red);">Declined by ${esc(so.signer_name)}${so.decline_reason?` — “${esc(so.decline_reason)}”`:""} <button class="btn ghost" data-sodel="${so.id}" type="button" style="font-size:11px;padding:3px 8px;">Remove</button></div>`;
          } else if(so){
            signer=`<div style="margin-top:5px;font-size:12px;"><span class="pill awol">Awaiting ${esc(so.signer_name)}</span> <button class="btn ghost" data-socopy="${esc(so.token)}" type="button" style="font-size:11px;padding:3px 8px;">🔗 Copy link</button> <button class="btn ghost" data-sodel="${so.id}" type="button" style="font-size:11px;padding:3px 8px;">Remove</button></div>`;
          } else {
            signer=`<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:5px;">
              <input data-signoffby="${s.key}" id="cbnm_${s.key}" value="${esc(by.name||"")}" placeholder="Cleared by / signer name" style="flex:1;min-width:140px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;font-size:12px;">
              <input id="cbem_${s.key}" value="${esc(defEmail)}" placeholder="their email (to send link)" style="flex:1;min-width:140px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;font-size:12px;">
              <button class="btn ghost" data-sosend="${s.key}" type="button" style="font-size:11.5px;padding:5px 10px;white-space:nowrap;">Send sign-off link</button>
              ${by.at?`<span class="td" style="font-size:11px;color:var(--green-dark);">✓ ${fmtDate(by.at)}</span>`:""}
            </div>`;
          }
          return `<div class="task" style="align-items:flex-start;">
            <div class="dot ${x[s.s]==='Cleared'?'g':(x[s.s]==='With Charges'?'r':'a')}" style="margin-top:6px;"></div>
            <div style="flex:1;min-width:0;"><div class="tt">${s.label}</div><div class="td">${s.items||''}</div>${signer}</div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
              <select data-stage="${s.s}" style="padding:5px 8px;border:1px solid var(--line);border-radius:6px;font-size:12px;background:#fff;">${opt(EXIT_STATUSES,x[s.s]||"Pending")}</select>
              ${s.c?`<input data-charge="${s.c}" type="number" step="0.01" placeholder="₱" value="${x[s.c]??""}" style="width:84px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;font-size:12px;">`:''}
            </div>
          </div>`;}).join(""); })()}
      </div>

      <div class="panel"><h2>Property to return</h2>
        <div class="psub">Items marked <b style="color:var(--green-dark);">· on record</b> were auto-loaded from what was issued to this person at onboarding — no more guessing. Tick any others that apply. <b>Uniform is not collected back</b> — its cost is handled by the &lt;6-month rule below. Cash advances / loan balances settle under the Finance sign-offs above.</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px 18px;">
          ${HR_RETURN_ITEMS.map(([k,lbl])=>{const iss=exitIssuedItems(x);const onRec=issItemChecked(iss,k);const note=issItemNote(iss,k);return `<label style="font-size:13px;"><input type="checkbox" data-return="${k}" ${((x.hr_returns&&x.hr_returns[k])||onRec)?"checked":""}> ${esc(lbl)}${onRec?` <span style="color:var(--green-dark);font-size:11px;">· on record${note?" ("+esc(note)+")":""}</span>`:""}</label>`;}).join("")}
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

      <div class="panel"><h2>Final pay — quitclaim computation ${x.quitclaim_status?qcPill(x.quitclaim_status):""}</h2>
        <div class="psub">This is exactly what the Director reviews and signs. Enter each line as on the quitclaim — the net updates live and travels with the signature request, so no one hunts the email later.</div>
        ${x.quitclaim_status==="Awaiting Sign-off"?`<div class="note" style="background:#fffaf0;border-color:#f0c14b;">✉️ Sent to the Director${x.quitclaim_sent_at?" on "+fmtDate(x.quitclaim_sent_at):""} — now in their Signatures inbox, awaiting signature. Editing here and re-sending will replace it.</div>`:""}
        ${x.quitclaim_status==="Approved"?`<div class="note" style="background:var(--green-light);border-color:var(--green);">✓ Approved &amp; e-signed by the Director${x.quitclaim_date?" on "+fmtDate(x.quitclaim_date):""}. Safe to release.</div>`:""}
        <div style="font-weight:800;color:var(--green-dark);font-size:11.5px;letter-spacing:.4px;text-transform:uppercase;margin:10px 0 4px;">Claims — owed to employee</div>
        <div class="form-grid">
          ${FP_CLAIMS.map(([k,l,h])=>FP_SPLIT.has(k)?fpSplitField(k,l,h,fp):fpField(k,l,h,fp)).join("")}
        </div>
        <div style="font-weight:800;color:var(--red);font-size:11.5px;letter-spacing:.4px;text-transform:uppercase;margin:14px 0 4px;">Less: deductions</div>
        <div class="form-grid">
          ${FP_DEDUCTIONS.map(([k,l,h])=>fpField(k,l,h,fp)).join("")}
        </div>
        <div style="font-weight:800;color:#6a766f;font-size:11.5px;letter-spacing:.4px;text-transform:uppercase;margin:14px 0 4px;">How it's paid</div>
        <div class="form-grid">
          <div style="margin-bottom:8px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">Payment instruction</label><input id="fp_payment_instruction" value="${esc((fp&&fp.payment_instruction)||"")}" placeholder="e.g. GCash transfer / cheque / bank" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;font-size:13.5px;"></div>
          <div style="margin-bottom:8px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">Account / reference</label><input id="fp_bank_account" value="${esc((fp&&fp.bank_account)||"")}" placeholder="e.g. GCash 0994 5009 668" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;font-size:13.5px;"></div>
        </div>
        <div id="ex_netbox" style="background:var(--green-light);border-radius:9px;padding:12px 14px;margin-top:8px;font-size:13.5px;"></div>
        <div style="margin-top:10px;">${x.quitclaim_status==="Approved"
          ? `<button class="btn ghost" id="exViewFP">View / print signed quitclaim</button>`
          : `<button class="btn blue" id="exSendFP">${x.quitclaim_status==="Awaiting Sign-off"?"Re-send to Director for sign-off":"Send to Director for sign-off"}</button>`}</div>
      </div>

      <div class="panel"><h2>Closeout</h2>
        <div class="task" style="align-items:center;"><div class="dot ${x.exit_interview_done?'g':'a'}"></div>
          <div style="flex:1;"><div class="tt">Exit interview</div><div class="td">${x.exit_interview_done?(x.exit_interview_by==='employee'?'Submitted by employee ✓'+(x.exit_interview_at?' · '+fmtDate(x.exit_interview_at):''):'Completed ✓'):'6-question RCC exit interview'}</div></div>
          <button class="btn ghost" id="ex_interview_btn" style="flex-shrink:0;">${x.exit_interview_done?'View / edit':'Conduct interview'}</button></div>
        <div style="border:1px solid var(--line);border-radius:9px;padding:11px 13px;margin:8px 0;background:#f7faf8;">
          <div style="font-weight:700;font-size:13.5px;">Let the employee fill it themselves</div>
          <div class="td" style="margin:3px 0 8px;">This is <b>${esc(x.employee_name||"this employee")}'s own private link</b> (unique to them) — they open it on their phone (no login), see the items they must return, and complete the exit interview. It comes straight back here.${x.emp_ack_at?` <span style="color:var(--green-dark);">· Employee acknowledged deliverables ${fmtDate(x.emp_ack_at)}</span>`:""}</div>
          <input id="ex_link_field" readonly value="${esc(exitEmpLink(x))}" onclick="this.select()" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px;font-size:12px;color:#3a463d;background:#fff;margin-bottom:8px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn ghost" id="ex_copy_link" type="button">🔗 Copy link</button>
            <button class="btn ghost" id="ex_email_link" type="button">✉️ Email link to employee</button>
          </div>
        </div>
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
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:6px;">
        <button class="btn" id="exSave">Save</button>
        ${(()=>{
          if(x.overall_status==="Complete") return '<span class="pill closed">Separated</span>'+(x.separation_approved_by?`<span class="td" style="font-size:11.5px;">approved by ${esc(x.separation_approved_by)}${x.separation_approved_at?" · "+fmtDate(x.separation_approved_at):""}</span>`:"");
          const submitted=x.separation_status==="Submitted";
          if(isAdminUser()){
            return (submitted?`<span class="td" style="font-size:11.5px;color:#9a6a00;">Prepared by ${esc(x.separation_submitted_by||"HR")}${x.separation_submitted_at?" · "+fmtDate(x.separation_submitted_at):""} — your approval finalises it.</span> `:"")
              +'<button class="btn blue" id="exComplete">Approve &amp; mark Separated</button>';
          }
          // HR (maker) — cannot separate alone; sends to the final approver (Anju Genomal)
          return submitted
            ? '<span class="pill cn">Awaiting Anju Genomal’s approval</span>'
            : '<button class="btn blue" id="exSubmitSep">Submit separation for approval</button>';
        })()}
        <button class="btn ghost" id="exClose" style="margin-left:auto;">Close</button>
      </div>
    </div></div>`;
  const recompute=()=>{
    const q=collectFinalPay(), c=fpClaims(q), d=fpDeductions(q), n=c-d;
    FP_SPLIT.forEach(k=>{ const el=document.getElementById("fptot_"+k); if(el){ const t=Number(q[k]||0); el.textContent=t?"= "+peso(t):""; } });
    $("#ex_netbox").innerHTML=`Total claims <b>${peso(c)}</b> − Deductions <b>${peso(d)}</b> = <b style="color:var(--green-dark);font-size:16px;">Net to employee ${peso(n)}</b>`
      +(n<0?` <span style="color:var(--red);font-weight:700;">— negative: the employee would owe. Recheck before sending.</span>`:"");
  };
  m.querySelectorAll("input,select").forEach(el=>el.addEventListener("input",recompute));
  recompute();
  $("#exClose").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  $("#exSave").addEventListener("click",()=>saveExitCase(x,m,false));
  wireDeptSignoffs(x, m);
  const cmp=document.getElementById("exComplete"); if(cmp) cmp.addEventListener("click",()=>{ if(confirm("Approve this separation for "+(x.employee_name||"this employee")+"?\n\nTheir status will flip to Separated.")) saveExitCase(x,m,true); });
  const subSep=document.getElementById("exSubmitSep"); if(subSep) subSep.addEventListener("click",()=>{ if(confirm("Submit "+(x.employee_name||"this employee")+"'s separation to Anju Genomal for approval?\n\nThey stay Active until Anju Genomal approves.")) saveExitCase(x,m,"submit"); });
  const sendFP=document.getElementById("exSendFP"); if(sendFP) sendFP.addEventListener("click",()=>sendFinalPayForSignoff(x,m));
  const viewFP=document.getElementById("exViewFP"); if(viewFP) viewFP.addEventListener("click",()=>printQuitclaim(x));
  document.getElementById("ex_interview_btn").addEventListener("click",()=>openExitInterview(x));
  const cpLink=document.getElementById("ex_copy_link");
  if(cpLink) cpLink.addEventListener("click",async()=>{
    const url=exitEmpLink(x);
    try{ await navigator.clipboard.writeText(url); cpLink.textContent="✓ Link copied"; setTimeout(()=>cpLink.textContent="🔗 Copy employee link",1800); }
    catch(_){ prompt("Copy the employee's exit link:", url); }
  });
  const emLink=document.getElementById("ex_email_link");
  if(emLink) emLink.addEventListener("click",()=>{
    const url=exitEmpLink(x);
    const subject="Your RCC exit clearance — "+x.employee_name;
    const body="Hi "+(x.employee_name||"")+",\n\nAs part of your clearance, please open your private exit link below. You'll see the items to return and a short exit interview to complete:\n\n"+url+"\n\nPlease do this on or before your last working day"+(x.last_working_day?" ("+fmtDate(x.last_working_day)+")":"")+".\n\nThank you,\nRCC HR";
    const le=(EMPLOYEES||[]).find(y=>y.id===x.employee_id); const to=(le&&le.email)||"";
    window.location.href="mailto:"+encodeURIComponent(to)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
  });
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
  // per-department "Cleared by" — record the name + auto-stamp the date on first entry
  const prevBy=x.signoff_by||{}; const by={};
  m.querySelectorAll("[data-signoffby]").forEach(el=>{ const k=el.dataset.signoffby; const nm=el.value.trim();
    if(nm){ by[k]={ name:nm, at:(prevBy[k]&&prevBy[k].at)||new Date().toISOString() }; } });
  o.signoff_by=by;
  if(o.last_working_day) o.tenure_months=monthsBetween(x.hire_date,o.last_working_day);
  o.final_pay=collectFinalPay();   // the quitclaim breakdown is now the source of truth for payables/deductions/net
  return o;
}
// mode: false = plain save · 'submit' = HR sends the separation for the Director's approval ·
//       true / 'approve' = Director approves → status flips to Separated (Director only).
async function saveExitCase(x,modal,mode){
  const complete=(mode===true||mode==="approve");
  const submit=(mode==="submit");
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
  const now=new Date().toISOString();
  o.total_payable=exitPayables(o); o.total_deductions=exitDeductions(o); o.net_payable=exitNet(o); o.updated_at=now;
  if(complete){
    // Second-approver gate: only the Director (admin) can finalise a separation.
    if(!isAdminUser()){ document.getElementById("exMsg").textContent="Only the Director can approve a separation. Use “Submit separation for approval”."; return; }
    o.overall_status="Complete"; o.completion_date=now;
    o.separation_status="Approved"; o.separation_approved_by=(CURRENT_USER&&CURRENT_USER.email)||"Director"; o.separation_approved_at=now;
  }
  if(submit){ o.separation_status="Submitted"; o.separation_submitted_by=(CURRENT_USER&&CURRENT_USER.email)||"HR"; o.separation_submitted_at=now; }
  const { error } = await sb.from("exit_clearance").update(o).eq("id",x.id);
  if(error){ document.getElementById("exMsg").textContent=error.message; return; }
  if(complete && x.employee_id){
    const er=o.separation_type==="AWOL"?"AWOL":(o.separation_type==="Termination"?"Terminated":(o.separation_type==="End of Contract"?"End of Contract":(o.separation_type==="Retirement"?"Retired":"Resigned")));
    await sb.from("employees").update({status:"Separated", end_date:o.last_working_day, end_reason:er}).eq("id",x.employee_id);
    await logChange("exit",x.id,x.employee_name,"Separated (approved by Director)",er+" · last day "+(o.last_working_day||"—")+" · net pay "+peso(o.net_payable||0)+" · prepared by "+(x.separation_submitted_by||"—"));
  }
  if(submit){ await logChange("exit",x.id,x.employee_name,"Separation submitted for approval","by "+((CURRENT_USER&&CURRENT_USER.email)||"HR")); }
  if(modal) modal.remove();
  await loadEmployees(); window.go("exit");
}

/* ---------- SEND THE QUITCLAIM TO THE DIRECTOR'S SIGNATURES INBOX ----------
   Persists the breakdown on the exit case, then drops one "claim" item into the
   Director's sign-this inbox with the FULL figures in its body — so review + sign
   happen in one place and the separate email request goes away. */
async function sendFinalPayForSignoff(x,modal){
  const msg=document.getElementById("exMsg");
  const fp=collectFinalPay();
  if(fpClaims(fp)<=0 && fpDeductions(fp)<=0){ if(msg) msg.textContent="Enter the final-pay figures first."; return; }
  const net=fpNet(fp);
  if(net<0 && !confirm("The net is negative — the employee would owe money. Send anyway?")) return;
  if(Number(fp.breach_of_contract||0)>0 && !confirm("A ₱"+Number(fp.breach_of_contract).toLocaleString()+" breach-of-contract deduction is included.\n\nUnder DOLE this needs a signed contractual basis (liquidated-damages clause) and must not drop net below the wage due. Send for the Director to review?")) return;
  const btn=document.getElementById("exSendFP"); if(btn){ btn.disabled=true; btn.textContent="Sending…"; }
  const sender=(CURRENT_USER&&CURRENT_USER.email)||"HR";
  // 1) save the breakdown + status on the exit case
  const patch={ final_pay:fp, total_payable:fpClaims(fp), total_deductions:fpDeductions(fp), net_payable:net,
    quitclaim_status:"Awaiting Sign-off", quitclaim_sent_at:new Date().toISOString(), quitclaim_sent_by:sender, updated_at:new Date().toISOString() };
  const e1=(await sb.from("exit_clearance").update(patch).eq("id",x.id)).error;
  if(e1){ if(msg) msg.textContent=e1.message; if(btn){ btn.disabled=false; btn.textContent="Send to Director for sign-off"; } return; }
  // 2) supersede any earlier pending request for this case, then create a fresh one
  if(x.quitclaim_signature_id) await sb.from("signature_requests").update({status:"superseded",updated_at:new Date().toISOString()}).eq("id",x.quitclaim_signature_id).eq("status","pending");
  const emp=(EMPLOYEES||[]).find(e=>e.id===x.employee_id)||{};
  const details={ employee:x.employee_name, employee_id:emp.employee_id||"", position:x.position||emp.position||"",
    branch:emp.worksite||x.department||"", last_day:x.last_working_day||"", separation:x.separation_type||"",
    claims:fpClaims(fp), deductions:fpDeductions(fp), net:net, fp:fp, prepared_by:hrDisplayName(sender),
    payment:[fp.payment_instruction,fp.bank_account].filter(Boolean).join(" · "), clearance_id:x.clearance_id };
  const { data:sig, error:e2 } = await sb.from("signature_requests").insert({
    doc_type:"claim", doc_title:"Quitclaim — Final Pay Computation", subject_name:x.employee_name,
    body:finalPayBody(x,fp), from_name:sender, amount:net, meta:x.clearance_id, details,
    awaiting:"you", with_whom:"Anj Genomal (Director)", signer_email:"anj@hassarams.com", status:"pending" }).select().single();
  if(e2){ if(msg) msg.textContent=e2.message; if(btn){ btn.disabled=false; btn.textContent="Send to Director for sign-off"; } return; }
  await sb.from("exit_clearance").update({quitclaim_signature_id:sig.id}).eq("id",x.id);
  // Email the Director the branded approval card (Supabase → Resend → their inbox). Best-effort: never block the sign-off.
  try{ const {data:{session}}=await sb.auth.getSession();
    fetch(`${SUPABASE_URL}/functions/v1/notify-signoff`,{ method:"POST",
      headers:{ apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${(session&&session.access_token)||SUPABASE_ANON_KEY}`, "Content-Type":"application/json" },
      body:JSON.stringify({ signature_id:sig.id }) }); }catch(_){}
  await logChange("exit",x.id,x.employee_name,"Final pay sent for sign-off","Net "+peso(net)+" · emailed to Director");
  if(modal) modal.remove();
  await loadEmployees(); window.go("signatures");
}
// Print/PDF the approved quitclaim on RCC letterhead-style layout (for the employee's signed copy).
function printQuitclaim(x){
  const fp=hasFinalPay(x)?x.final_pay:collectFinalPay();
  const w=window.open("","_blank"); if(!w){ alert("Allow pop-ups to print the quitclaim."); return; }
  const emp=(EMPLOYEES||[]).find(e=>e.id===x.employee_id)||{};
  const P=n=>"₱"+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const rowsC=FP_CLAIMS.filter(([k])=>Number(fp[k]||0)!==0||fp[k+"_note"]).map(([k,l])=>`<tr><td>${esc(l)}</td><td class="n">${P(fp[k])}</td><td class="rm">${esc(fp[k+"_note"]||"")}</td></tr>`).join("");
  const rowsD=FP_DEDUCTIONS.filter(([k])=>Number(fp[k]||0)!==0||fp[k+"_note"]).map(([k,l])=>`<tr><td>${esc(l)}</td><td class="n">${P(fp[k])}</td><td class="rm">${esc(fp[k+"_note"]||"")}</td></tr>`).join("");
  w.document.write(`<!DOCTYPE html><html><head><title>Quitclaim — ${esc(x.employee_name)}</title><style>
    body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1F2A37;max-width:720px;margin:24px auto;padding:0 24px;font-size:13px;}
    .lh{text-align:center;border-bottom:2.5px solid #1E3A5F;padding-bottom:8px;margin-bottom:14px;}
    .lh b{font-size:17px;color:#1E3A5F;} .lh div{font-size:11px;color:#667;}
    h2{text-align:center;font-size:15px;margin:10px 0 6px;} h3{font-size:12px;color:#1E3A5F;margin:14px 0 4px;}
    table{width:100%;border-collapse:collapse;} td,th{border:1px solid #ccd;padding:5px 8px;} td.n{text-align:right;white-space:nowrap;} td.rm{color:#667;font-size:11px;}
    .tot td{font-weight:800;background:#f4f7fb;} .net td{font-weight:800;background:#eaf4ec;font-size:14px;}
    .meta td{border:none;padding:2px 4px;font-size:12px;} .sig{margin-top:34px;display:flex;justify-content:space-between;gap:30px;} .sig div{flex:1;text-align:center;} .sl{border-top:1px solid #333;margin-top:34px;padding-top:4px;font-size:11.5px;}
  </style></head><body>
    <div class="lh"><b>ROSHAN COMMERCIAL CORPORATION</b><div>104 Shaw Boulevard, Pasig City</div></div>
    <h2>QUITCLAIM — FINAL PAY COMPUTATION</h2>
    <table><tr class="meta"><td><b>Employee:</b> ${esc(x.employee_name)}</td><td><b>ID:</b> ${esc(emp.employee_id||"—")}</td></tr>
      <tr class="meta"><td><b>Position:</b> ${esc(x.position||emp.position||"—")}</td><td><b>Branch:</b> ${esc(emp.worksite||x.department||"—")}</td></tr>
      <tr class="meta"><td><b>Date hired:</b> ${x.hire_date?fmtDate(x.hire_date):"—"}</td><td><b>Last day:</b> ${x.last_working_day?fmtDate(x.last_working_day):"—"}</td></tr>
      <tr class="meta"><td><b>Separation:</b> ${esc(x.separation_type||"—")}</td><td><b>Status:</b> ${esc(x.quitclaim_status||"—")}</td></tr></table>
    <h3>Claims — owed to employee</h3>
    <table>${rowsC||'<tr><td colspan="3">—</td></tr>'}<tr class="tot"><td>Total claims</td><td class="n">${P(fpClaims(fp))}</td><td></td></tr></table>
    <h3>Less: deductions</h3>
    <table>${rowsD||'<tr><td colspan="3">—</td></tr>'}<tr class="tot"><td>Total deductions</td><td class="n">${P(fpDeductions(fp))}</td><td></td></tr></table>
    <table style="margin-top:8px;"><tr class="net"><td>NET PAID TO EMPLOYEE</td><td class="n">${P(fpNet(fp))}</td></tr></table>
    ${(fp.payment_instruction||fp.bank_account)?`<div style="margin-top:8px;font-size:12px;"><b>Payment:</b> ${esc([fp.payment_instruction,fp.bank_account].filter(Boolean).join(" · "))}</div>`:""}
    <div class="sig"><div><div class="sl">Juvelyn M. Belvistre<br><span style="color:#667;">HR Officer — Prepared by</span></div></div>
      <div><div class="sl">Anju Genomal<br><span style="color:#667;">Director, Admin &amp; Finance — Approved${x.quitclaim_date?" "+fmtDate(x.quitclaim_date):""}</span></div></div></div>
    <div class="sig"><div><div class="sl">${esc(x.employee_name)}<br><span style="color:#667;">Received &amp; conforme / Date</span></div></div></div>
    <script>window.print();</`+`script></body></html>`);
  w.document.close();
}
window.sendFinalPayForSignoff=sendFinalPayForSignoff; window.printQuitclaim=printQuitclaim;

init();
