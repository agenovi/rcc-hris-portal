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
const fmtDate=(d)=>{ if(!d) return "—"; const x=new Date(d+"T00:00:00"); return isNaN(x)?d:x.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}); };

let EMPLOYEES=[];
let BRANCHES=[];
let DISERS=[];
let PREHIRE=[];
let ONBOARDING=[];
let ONBTASKS=[];
let EXITCASES=[];
let CONTRACTS=[];
let PHDOCS=[];
let CURRENT_USER=null;
const DEFAULT_PH_DOCS=[["nbi","NBI / Police Clearance",true],["birth","PSA Birth Certificate",false],["sss","SSS (E-1 / number)",false],["philhealth","PhilHealth",false],["pagibig","Pag-IBIG (MID)",false],["tin","TIN / BIR 1902",false],["photo","2×2 ID Photos",false],["diploma","Diploma / TOR",false],["medical","Medical / Health Certificate",false]];
let empFilter="All";
let scFilter="All";
let prehireTab="pipeline";
let landed=false;

/* ---------- AUTH ---------- */
async function init(){
  const { data:{session} } = await sb.auth.getSession();
  if(session) showApp(session.user); else $("#login").style.display="flex";
  sb.auth.onAuthStateChange((_e,s)=>{ if(!s){ location.reload(); } });
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
    <button id="signOut" style="background:rgba(255,255,255,.14);color:#fff;border:none;padding:6px 10px;border-radius:7px;font-size:11.5px;font-weight:600;cursor:pointer;">Sign out</button>`;
  $("#signOut").addEventListener("click", async ()=>{ await sb.auth.signOut(); });
}

/* ---------- DATA ---------- */
async function loadEmployees(){
  const [emp, br, di, ph, oc, ot, ex, ct, pd] = await Promise.all([
    sb.from("employees").select("*").order("full_name"),
    sb.from("branches").select("*").order("name"),
    sb.from("disers").select("*").order("name"),
    sb.from("prehire").select("*").order("created_at"),
    sb.from("onboarding_cases").select("*").order("created_at"),
    sb.from("onboarding_tasks").select("*").order("sort_order"),
    sb.from("exit_clearance").select("*").order("created_at"),
    sb.from("contracts").select("*").order("created_at"),
    sb.from("prehire_documents").select("*")
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
  renderDashboard();
  renderEmployeesPage();
  renderBranchesPage();
  renderManning();
  renderPrehire();
  renderOnboarding();
  renderExit();
  renderContracts();
  renderLoans();
  wireGlobalSearch();
  if(!landed){ landed=true; if(typeof window.go==="function") window.go("dashboard"); }
}
/* ---------- LOANS — embeds anj's preferred RCC Loan Portal (loans.html) ---------- */
function renderLoans(){
  const pg=$("#page-loans"); if(!pg||pg.dataset.loaded) return;
  pg.dataset.loaded="1";
  pg.innerHTML=`<iframe title="RCC Employee Loan Portal" src="https://agenovi.github.io/rcc-hris-portal/loans.html"
    style="width:100%;height:calc(100vh - 96px);border:1px solid var(--line);border-radius:12px;display:block;background:#fff;"></iframe>`;
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
  // composition
  const byGroup={"Head Office":ho,"Warehouse":wh,"Retail":rt};
  const byDept={}; A.filter(e=>e.group_name==="Head Office").forEach(e=>{const d=e.department||"—";byDept[d]=(byDept[d]||0)+1;});
  const byArea={}; open.forEach(b=>{const a=b.area||"—";byArea[a]=(byArea[a]||0)+1;});
  const bySC={}; SCs.forEach(s=>bySC[s]=open.filter(b=>b.sc===s).length);
  const bySource={}; A.forEach(e=>{const s=e.hire_source||"Direct";bySource[s]=(bySource[s]||0)+1;});
  // merchandiser pay (Manning Sheet) — Total = Basic + recorded allowances (COLA/SOLA/SA/LA)
  const actDi=DISERS.filter(d=>(d.status||'').toLowerCase().startsWith('active'));
  const rates=actDi.filter(d=>d.total_rate).map(d=>Number(d.total_rate));
  const basics=actDi.filter(d=>d.basic_rate).map(d=>Number(d.basic_rate));
  const allowVals=actDi.filter(d=>d.total_rate&&d.basic_rate&&Number(d.total_rate)>Number(d.basic_rate)).map(d=>Number(d.total_rate)-Number(d.basic_rate));
  const avgRate=rates.length?Math.round(rates.reduce((a,b)=>a+b,0)/rates.length):0;
  const avgBasic=basics.length?Math.round(basics.reduce((a,b)=>a+b,0)/basics.length):0;
  const avgAllow=allowVals.length?Math.round(allowVals.reduce((a,b)=>a+b,0)/allowVals.length):0;
  const withAllow=allowVals.length;
  const minRate=rates.length?Math.min(...rates):0, maxRate=rates.length?Math.max(...rates):0;
  // tenure
  const ten=A.map(e=>tenureYears(e.hire_date)).filter(x=>x!=null);
  const avgTen=ten.length?(ten.reduce((a,b)=>a+b,0)/ten.length).toFixed(1):"—";
  const concession=open.filter(b=>b.category==="CN").length, coOp=open.filter(b=>b.category==="CO").length;
  const agJellon=A.filter(e=>e.hire_source==="Jell-on").length, agMG=A.filter(e=>e.hire_source==="M&G").length, agency=agJellon+agMG;
  const awol=EMPLOYEES.filter(e=>e.status==="AWOL").length;
  const phPipe=PREHIRE.filter(p=>!["COMPLETE","REJECTED"].includes(p.phase)).length;
  const phReady=PREHIRE.filter(p=>["READY_FOR_CONTRACT","CONTRACT_PIPELINE"].includes(p.phase)).length;
  const onbOpen=ONBOARDING.filter(c=>c.status!=="Complete").length;
  const onbTasksOpen=ONBTASKS.filter(t=>t.status!=="Done").length;
  const exitOpen=EXITCASES.filter(x=>x.overall_status!=="Complete").length;
  // "Waiting on others" — items sent out / stuck with someone else (real data)
  const waiting=[];
  PREHIRE.filter(p=>p.phase==="CONTRACT_PIPELINE").slice(0,2).forEach(p=>waiting.push({t:"Contract — "+p.full_name, d:"In the signature pipeline", go:"prehire"}));
  PREHIRE.filter(p=>p.phase==="OFFER_EXTENDED").slice(0,2).forEach(p=>waiting.push({t:"Offer — "+p.full_name, d:"Awaiting candidate acceptance", go:"prehire"}));
  EXITCASES.filter(x=>x.overall_status!=="Complete").slice(0,2).forEach(x=>{const pend=EXIT_STAGES.filter(s=>x[s.s]==="Pending").length; waiting.push({t:"Exit sign-off — "+x.employee_name, d:pend+" department(s) still to clear", go:"exit"});});
  ONBOARDING.filter(c=>c.status!=="Complete").slice(0,2).forEach(c=>{const op=tasksFor(c.id).filter(t=>t.status!=="Done").length; waiting.push({t:"Onboarding — "+c.employee_name, d:op+" task(s) outstanding", go:"onboarding"});});

  const pg=$("#page-dashboard");
  pg.innerHTML=`
    <div class="hello">
      <div class="hd">${new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}).toUpperCase()}</div>
      <div class="hh">${greet}, <span>${esc(nm)}.</span></div>
      <div class="hsub">Your whole workforce, live from the database — ${A.length} active people across ${open.length} stores.</div>
    </div>
    <div class="grid kpis">
      <div class="kpi"><div class="k-l">Active Employees</div><div class="k-n">${A.length}</div><div class="k-break"><span>HO+WH<b>${ho+wh}</b></span><span>Retail<b>${rt}</b></span></div></div>
      <div class="kpi"><div class="k-l">Agency Merchandisers</div><div class="k-n">${agency}</div><div class="k-break"><span>Jell-on<b>${agJellon}</b></span><span>M&amp;G<b>${agMG}</b></span></div></div>
      <div class="kpi warn"><div class="k-l">On Probation</div><div class="k-n">${prob}</div><div class="k-s">regularization reviews ahead</div></div>
      <div class="kpi ${awol?'alert':''}"><div class="k-l">AWOL Cases</div><div class="k-n">${awol}</div><div class="k-s">${awol?'NTE / due process':'none open'}</div></div>
    </div>
    <div class="grid kpis" style="margin-top:13px;">
      <div class="kpi" style="cursor:pointer;" onclick="go('prehire')"><div class="k-l">Pre-hire in Pipeline</div><div class="k-n">${phPipe}</div><div class="k-s">${phReady} ready for contract</div></div>
      <div class="kpi" style="cursor:pointer;" onclick="go('onboarding')"><div class="k-l">Onboarding in Progress</div><div class="k-n">${onbOpen}</div><div class="k-s">${onbTasksOpen} open tasks</div></div>
      <div class="kpi warn" style="cursor:pointer;" onclick="go('manning')"><div class="k-l">Headcount Gap (partial)</div><div class="k-n">${merchDef}</div><div class="k-s">approved ${totAHC} vs ${totCHC} on file · full via PayPlus</div></div>
      <div class="kpi" style="cursor:pointer;" onclick="go('exit')"><div class="k-l">Exit Clearances Open</div><div class="k-n">${exitOpen}</div><div class="k-s">offboarding in progress</div></div>
    </div>

    <div class="two-col">
      <div class="panel" style="margin-top:0;">
        <h2>Your pending tasks <span class="count-tag">live · click to act</span></h2>
        <div class="psub">Computed from your data — most actionable first</div>
        ${phReady?`<div class="task" style="cursor:pointer;" onclick="go('prehire')"><div class="dot r"></div><div><div class="tt">${phReady} candidate(s) ready for contract / onboarding</div><div class="td">Move them into an onboarding case</div></div><div class="due r">hiring</div></div>`:''}
        ${onbTasksOpen?`<div class="task" style="cursor:pointer;" onclick="go('onboarding')"><div class="dot a"></div><div><div class="tt">${onbTasksOpen} open onboarding task(s)</div><div class="td">${onbOpen} case(s) in progress — bank, uniform, gov forms, Employee ID</div></div><div class="due a">onboarding</div></div>`:''}
        ${exitOpen?`<div class="task" style="cursor:pointer;" onclick="go('exit')"><div class="dot a"></div><div><div class="tt">${exitOpen} exit clearance(s) in progress</div><div class="td">Department sign-offs &amp; final-pay computation</div></div><div class="due a">offboarding</div></div>`:''}
        <div class="task" style="cursor:pointer;" onclick="go('employees')"><div class="dot a"></div><div><div class="tt">${prob} employees on probation</div><div class="td">3rd / 5th-month evaluations &amp; regularization reviews</div></div><div class="due a">review</div></div>
        <div class="task" style="cursor:pointer;" onclick="go('manning')"><div class="dot a"></div><div><div class="tt">Merchandiser headcount gap to verify</div><div class="td">${totAHC} approved vs ${totCHC} confirmed on file (partial — full count via PayPlus) · ${SCs.length} SCs</div></div><div class="due a">staffing</div></div>
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
          <div class="team-row"><div class="tn">Merchandiser staffing</div><span class="mini ok">${totCHC}/${totAHC} confirmed</span><span class="mini ${merchDef?'bad':'ok'}">gap ${merchDef} (partial)</span></div>
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
        <h2>Merchandiser pay <span class="count-tag">daily</span></h2>
        <div class="psub">Basic + allowances across ${rates.length} merchandisers (from the Manning Sheet)</div>
        <div class="grid kpis" style="grid-template-columns:repeat(3,1fr);">
          <div class="kpi"><div class="k-l">Avg Basic</div><div class="k-n">₱${avgBasic.toLocaleString()}</div></div>
          <div class="kpi"><div class="k-l">Avg Allowance</div><div class="k-n">₱${avgAllow.toLocaleString()}</div><div class="k-s">where recorded (${withAllow})</div></div>
          <div class="kpi"><div class="k-l">Avg Total (all-in)</div><div class="k-n">₱${avgRate.toLocaleString()}</div><div class="k-s">₱${minRate.toLocaleString()}–₱${maxRate.toLocaleString()}</div></div>
        </div>
        <div class="task" style="margin-top:10px;"><div class="dot a"></div><div><div class="tt">Most allowances aren't in the Manning Sheet yet</div><div class="td">Only ${withAllow} of ${rates.length} have an allowance recorded here — the complete COLA/SOLA/SA/LA figures come from <b>PayPlus</b> once connected.</div></div></div>
      </div>
    </div>`;
}
/* legacy KPI-only updater (unused, kept for safety) */
function renderDashboardKPIs(){
  const A=EMPLOYEES.filter(isActive);
  const ho=A.filter(e=>e.group_name==="Head Office").length;
  const wh=A.filter(e=>e.group_name==="Warehouse").length;
  const rt=A.filter(e=>e.group_name==="Retail").length;
  const ag=A.filter(e=>e.hire_source&&e.hire_source!=="Direct").length;
  const prob=A.filter(e=>e.contract_type==="Probationary").length;
  const sep=EMPLOYEES.filter(e=>e.status==="Separated").length;
  const grids=$$("#page-dashboard .kpis");
  if(grids[0]) grids[0].innerHTML=`
    <div class="kpi"><div class="k-l">Total Employees</div><div class="k-n">${A.length}</div><div class="k-s">Head Office ${ho} · Warehouse ${wh} · Retail ${rt}</div></div>
    <div class="kpi"><div class="k-l">Agency Merchandisers</div><div class="k-n">${ag}</div><div class="k-break"><span>Jell-on<b>${A.filter(e=>e.hire_source==="Jell-on").length}</b></span><span>M&amp;G<b>${A.filter(e=>e.hire_source==="M&G").length}</b></span></div></div>
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
  const ag=A.filter(e=>e.hire_source&&e.hire_source!=="Direct").length;
  const prob=A.filter(e=>e.contract_type==="Probationary").length;
  const panel=$("#page-employees .panel"); if(!panel) return;
  panel.innerHTML=`
    <h2>Employee Master</h2>
    <div class="psub">${EMPLOYEES.length} records · ${A.length} active · click any row to open the record</div>
    <div class="actionbar">
      <button class="btn" id="addEmp">+ Add Employee</button>
      <button class="btn blue" id="exportEmp">Export CSV</button>
    </div>
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
      <thead><tr><th>Name</th><th>Job Title</th><th>Department</th><th>Worksite</th><th>Type</th><th>Status</th></tr></thead>
      <tbody id="empRows"></tbody>
    </table>
    <div id="empCount" style="font-size:12px;color:var(--muted);margin-top:10px;"></div>`;
  $("#addEmp").addEventListener("click",()=>openForm(null));
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
        <button class="btn" id="recEdit" style="margin-left:6px;">Edit</button>
      </div>
      ${sec(1,"Identity &amp; Status",
        f("PayPlus ID",e.employee_id,TAGHR)+f("Group",e.group_name,TAGAUTO)+f("Hire Source",e.hire_source,TAGAUTO)+(e.agency_name?f("Agency",e.agency_name,TAGAUTO):"")+f("Status",e.status,TAGHR))}
      ${sec(2,"Personal Details",
        f("Email",e.email,TAGEMP)+f("Mobile",e.phone,TAGEMP)+f("Date of Birth",e.date_of_birth?fmtDate(e.date_of_birth):"",TAGEMP)+f("Gender",e.gender,TAGEMP)+f("Civil Status",e.civil_status,TAGEMP)+f("Permanent Address",e.permanent_address,TAGEMP)+f("Current Address",e.current_address,TAGEMP))}
      ${sec(3,"Emergency Contact",
        f("Name",e.emergency_contact_name,TAGEMP)+f("Relationship",e.emergency_contact_relation,TAGEMP)+f("Contact Number",e.emergency_contact_number,TAGEMP))}
      ${sec(4,"Government Numbers",
        f("SSS",e.sss_number,TAGHR)+f("PhilHealth",e.philhealth_number,TAGHR)+f("Pag-IBIG",e.pagibig_number,TAGHR)+f("TIN",e.tin_number,TAGHR))}
      ${sec(5,"Bank",
        f("Bank Name",e.bank_name,TAGAUTO)+f("Account Number",e.bank_account_number,TAGHR))}
      ${sec(6,"Placement",
        f("Department",e.department,TAGHR)+f("Position",e.position,TAGHR)+f("Worksite",e.worksite,TAGHR)+f("Supervisor",e.supervisor_name,TAGHR)+f("Approver 2",e.approver2_name||e.approver2_email,TAGAUTO))}
      ${sec(7,"Employment Terms, Pay &amp; Dates",
        f("Contract Type",e.contract_type,TAGHR)+f("Daily Rate",e.daily_rate?("₱"+Number(e.daily_rate).toLocaleString()):"",TAGHR)+f("Daily Allowance",e.daily_allowance?("₱"+Number(e.daily_allowance).toLocaleString()):"",TAGHR)+f("Hire Date",e.hire_date?fmtDate(e.hire_date):"",TAGHR)+f("Regularization Date",e.regularization_date?fmtDate(e.regularization_date):"",TAGHR)+f("End Date",e.end_date?fmtDate(e.end_date):"",TAGHR)+f("End Reason",e.end_reason,TAGHR))}
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
        ${here.length? `<table><thead><tr><th>Name</th><th>Type</th><th>Position</th><th>Daily Rate</th><th>Status</th></tr></thead>
          <tbody>${here.map(d=>`<tr><td><b>${esc(d.name)}</b><div style="font-size:11px;color:var(--muted);">${esc(d.emp_no||"")}</div></td>
            <td>${esc(d.diser_type||"—")}</td><td>${esc(d.position||"—")}</td>
            <td>${d.total_rate?("₱"+Number(d.total_rate).toLocaleString()):"—"}</td>
            <td><span class="pill ${(d.status||'').includes('Probation')?'probation':'active'}">${esc(d.status||"—")}</span></td></tr>`).join("")}</tbody></table>`
          : `<div class="placeholder" style="padding:30px;"><p>No current merchandiser placement on file for this store.<br>Live placement comes through the PayPlus connection.</p></div>`}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px;"><button class="btn ghost" id="storeClose">Close</button></div>
    </div></div>`;
  document.getElementById("storeClose").addEventListener("click",()=>m.remove());
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
function renderManning(){
  const pg=$("#page-manning"); if(!pg) return;
  const open=BRANCHES.filter(b=>b.status==="Open");
  const SCs=[...new Set(open.map(b=>b.sc).filter(x=>x&&x!=='Unassigned'))].sort();
  const totAHC=open.reduce((s,b)=>s+b.ahc_stationary+b.ahc_reliever,0);
  const totCHC=open.reduce((s,b)=>s+chcFor(b.name),0);
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
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
      <div class="panel">
        ${fld("f_sss_number","SSS",e.sss_number)}${fld("f_philhealth_number","PhilHealth",e.philhealth_number)}
        ${fld("f_pagibig_number","Pag-IBIG",e.pagibig_number)}${fld("f_tin_number","TIN",e.tin_number)}
        ${fld("f_bank_name","Bank name",e.bank_name)}${fld("f_bank_account_number","Bank account number",e.bank_account_number)}
      </div>
      <div class="panel">
        ${fld("f_worksite","Worksite",e.worksite)}${fld("f_supervisor_name","Supervisor",e.supervisor_name)}${fld("f_approver2_name","Approver 2",e.approver2_name)}
        ${sel("f_contract_type","Contract type",CONTRACT_TYPES,e.contract_type)}
        ${fld("f_daily_rate","Daily rate (₱)",e.daily_rate,"number")}${fld("f_daily_allowance","Daily allowance (₱)",e.daily_allowance,"number")}
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
  dept.addEventListener("change",()=>{ const g=deriveGroup(dept.value); document.getElementById("f_group_name").value=g; const b=document.getElementById("f_bank_name"); if(!b.value) b.value=deriveBank(g); });
  document.getElementById("fCancel").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  document.getElementById("fSave").addEventListener("click",()=>saveEmployee(isNew?null:e.id,m));
}
const v=(id)=>{ const x=document.getElementById(id).value.trim(); return x===""?null:x; };
const nv=(id)=>{ const x=document.getElementById(id).value.trim(); return x===""?null:Number(x); };
async function saveEmployee(id,modal){
  const msg=document.getElementById("fMsg"), btn=document.getElementById("fSave");
  let phone=v("f_phone"); if(phone) phone=phone.replace(/[\s-]/g,"");
  const p={ full_name:v("f_full_name"), department:v("f_department"), group_name:v("f_group_name")||deriveGroup(document.getElementById("f_department").value)||null,
    position:v("f_position"), hire_source:v("f_hire_source"), status:v("f_status")||"Active", employee_id:v("f_employee_id"), agency_name:v("f_agency_name"),
    email:v("f_email"), phone, date_of_birth:v("f_date_of_birth"), gender:v("f_gender"), civil_status:v("f_civil_status"),
    permanent_address:v("f_permanent_address"), current_address:v("f_current_address"),
    emergency_contact_name:v("f_emergency_contact_name"), emergency_contact_relation:v("f_emergency_contact_relation"), emergency_contact_number:v("f_emergency_contact_number"),
    sss_number:v("f_sss_number"), philhealth_number:v("f_philhealth_number"), pagibig_number:v("f_pagibig_number"), tin_number:v("f_tin_number"),
    bank_name:v("f_bank_name"), bank_account_number:v("f_bank_account_number"), worksite:v("f_worksite"), supervisor_name:v("f_supervisor_name"), approver2_name:v("f_approver2_name"),
    contract_type:v("f_contract_type"), daily_rate:nv("f_daily_rate"), daily_allowance:nv("f_daily_allowance"),
    hire_date:v("f_hire_date"), regularization_date:v("f_regularization_date"), end_date:v("f_end_date"), end_reason:v("f_end_reason"),
    notes:v("f_notes"), updated_at:new Date().toISOString() };
  if(!p.full_name){ msg.textContent="Full name is required."; return; }
  btn.disabled=true; btn.textContent="Saving…";
  const res=id? await sb.from("employees").update(p).eq("id",id) : await sb.from("employees").insert(p);
  btn.disabled=false; btn.textContent=id?"Save changes":"Create";
  if(res.error){ msg.textContent=res.error.message; return; }
  modal.remove(); await loadEmployees();
}

/* ============================ PRE-HIRE MODULE ============================ */
const PH_PHASES=[
  {key:"APPLICATION",label:"Applied",actor:"Recruiter"},
  {key:"ASSESSMENT_SENT",label:"Assessment Sent",actor:"Recruiter"},
  {key:"ASSESSMENT_COMPLETE",label:"Assessed",actor:"Recruiter"},
  {key:"OFFER_EXTENDED",label:"Offer Extended",actor:"HR Officer"},
  {key:"COLLECTING_DOCS",label:"Collecting Docs",actor:"Candidate + HR"},
  {key:"READY_FOR_CONTRACT",label:"Ready for Contract",actor:"Juvelyn sign-off"},
  {key:"CONTRACT_PIPELINE",label:"→ Contracts",actor:"Contracts module"},
  {key:"ONBOARDING",label:"Onboarding",actor:"HR + PayPlus"},
  {key:"COMPLETE",label:"Complete",actor:"— becomes Employee"}
];
const phLabel=(k)=> (PH_PHASES.find(p=>p.key===k)||{}).label || (k==="REJECTED"?"Rejected":k);
const srcPill=(s)=> s&&s!=="Direct" ? `<span class="pill ag">${esc(s)}</span>` : `<span class="pill di">Direct</span>`;

function renderPrehire(){
  const pg=$("#page-prehire"); if(!pg) return;
  const inPipe=PREHIRE.filter(p=>p.phase!=="COMPLETE"&&p.phase!=="REJECTED");
  const docs=PREHIRE.filter(p=>p.phase==="COLLECTING_DOCS").length;
  const ready=PREHIRE.filter(p=>p.phase==="READY_FOR_CONTRACT").length;
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
      <div class="grid kpis" style="grid-template-columns:repeat(4,1fr);">
        <div class="kpi"><div class="k-l">In Pipeline</div><div class="k-n">${inPipe.length}</div>
          <div class="k-break"><span>Direct<b>${bySrc("Direct")}</b></span><span>Jell-on<b>${bySrc("Jell-on")}</b></span><span>M&amp;G<b>${bySrc("M&G")}</b></span></div></div>
        <div class="kpi warn"><div class="k-l">Collecting Docs</div><div class="k-n">${docs}</div><div class="k-s">awaiting uploads</div></div>
        <div class="kpi"><div class="k-l">Ready for Contract</div><div class="k-n">${ready}</div><div class="k-s">Juvelyn signed off</div></div>
        <div class="kpi ${rejected?'':''}"><div class="k-l">Rejected</div><div class="k-n">${rejected}</div><div class="k-s">pipeline closed</div></div>
      </div>
      <div class="tabs" id="phTabs" style="margin-top:14px;">
        <div class="tab ${prehireTab==='pipeline'?'active':''}" data-t="pipeline">Pipeline</div>
        <div class="tab ${prehireTab==='arch'?'active':''}" data-t="arch">How it works (Architecture)</div>
        <div class="tab ${prehireTab==='data'?'active':''}" data-t="data">Data model</div>
      </div>
      <div id="phBody"></div>
    </div>`;
  $("#phNew").addEventListener("click",newPrehire);
  $("#phExport").addEventListener("click",()=>{
    const cols=["prehire_id","full_name","phase","position","department","hire_source","worksite","contract_type","daily_rate","email"];
    const csv=cols.join(",")+"\n"+PREHIRE.map(p=>cols.map(c=>`"${(p[c]==null?"":String(p[c])).replace(/"/g,'""')}"`).join(",")).join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="prehire.csv";a.click();
  });
  $$("#phTabs .tab").forEach(t=>t.addEventListener("click",()=>{ prehireTab=t.dataset.t; renderPrehire(); }));
  if(prehireTab==="arch") phBodyArch();
  else if(prehireTab==="data") phBodyData();
  else phBodyPipeline();
}

function phBodyPipeline(){
  const cols=PH_PHASES.map(ph=>{
    const cards=PREHIRE.filter(p=>p.phase===ph.key);
    return `<div class="col"><div class="col-h">${ph.label}<span>${cards.length} · ${esc(ph.actor)}</span></div>
      ${cards.map(c=>`<div class="ccard clickable" data-id="${c.id}" ${ph.key==="READY_FOR_CONTRACT"?'style="border-color:#bcdcc7;background:var(--green-light);"':''}>
        <div class="cn">${esc(c.full_name)}</div>
        <div class="cd">${esc(c.position||"—")} · ${esc(c.hire_source||"Direct")}${c.daily_rate?` · ₱${Number(c.daily_rate).toLocaleString()}/day`:""}${c.assessment_score!=null?` · exam ${c.assessment_score}`:""}${c.sm_acceptance&&c.sm_acceptance!=="NA"?` · SM ${esc(c.sm_acceptance)}`:""}</div></div>`).join("")
       || `<div style="font-size:11.5px;color:var(--muted);padding:6px 2px;">—</div>`}
    </div>`;
  }).join("");
  const rej=PREHIRE.filter(p=>p.phase==="REJECTED");
  $("#phBody").innerHTML=`
    <div class="psub" style="margin-top:12px;">Nine stages, left → right. Click any card to open the candidate and advance the stage.</div>
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
}

function phBodyArch(){
  const stages=[
    ["1 · Application","Recruiter / applicant","Candidate applies (direct link or agency submission). Core identity captured.","full_name, email, phone, position, department, hire_source, resume_url","Auto-create pre-hire record; per-candidate Drive folder provisioned"],
    ["2 · Assessment Sent","Recruiter","Aptitude/skills test sent to the candidate.","assessment_type, assessment_sent_date","Assessment link emailed automatically"],
    ["3 · Assessed","Recruiter","Result recorded; pass/fail gate.","assessment_score, assessment_passed → assessments table","Auto-score; fail can auto-reject"],
    ["4 · Offer Extended","HR Officer","Position, rate and terms offered.","contract_type, daily_rate, daily_allowance, start_date, supervisor","Offer letter generated"],
    ["5 · Collecting Docs","Candidate + HR","Candidate uploads the 6 required documents; HR verifies each.","prehire_documents (one row per doc: status PENDING/RECEIVED/REJECTED)","Upload reminders; completeness check"],
    ["6 · Ready for Contract","Juvelyn (sign-off)","Final HR review and sign-off. Gov numbers + bank confirmed.","hr_officer_notes, juvelyn_notes, juvelyn_review_date, sss/philhealth/pagibig/tin, bank","Sign-off unlocks contract generation"],
    ["7 · → Contracts","Contracts module","Employment contract generated and routed for e-signature.","contract_id (links to Contracts 7-stage pipeline)","Contract auto-generated from pre-hire data"],
    ["8 · Onboarding","HR + PayPlus","PayPlus setup, Employee ID issued, uniform, orientation.","payplus_setup, assigned_employee_id, uniform_issued, orientation_complete","PayPlus ID sync; onboarding checklist"],
    ["9 · Complete","System","Pre-hire closes — the record becomes a full Employee.","assigned_employee_id → creates employees row","Promotes pre-hire → employees automatically"]
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
    ["Identity & Stage","prehire_id, phase (9 stages + Rejected), full_name, email, phone, date_of_birth, civil_status, permanent_address, current_address, emergency_contact_name / _relation / _number, hire_source, worksite"],
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
          + `<div class="efield"><div class="el">Daily rate (offered)</div><div class="ev">${c.daily_rate?("₱"+Number(c.daily_rate).toLocaleString()):'<span class="note">—</span>'} <span class="note">— may change at the contract stage</span></div><div class="em"></div></div>`
          + phRow("Daily allowance",c.daily_allowance?("₱"+Number(c.daily_allowance).toLocaleString()):"")+phRow("Target start date",c.start_date?fmtDate(c.start_date):"")+phRow("Supervisor",c.supervisor_name)+phRow("Approver 2",c.approver2_email))}
      </div>
      <div class="panel">
        ${sec(6,"Government Numbers", phRow("SSS",c.sss_number)+phRow("PhilHealth",c.philhealth_number)+phRow("Pag-IBIG",c.pagibig_number)+phRow("TIN",c.tin_number))}
      </div>
      <div class="panel">
        ${sec(7,"Bank", phRow("Bank name",c.bank_name)+phRow("Account number",c.bank_account_number))}
      </div>
      <div class="panel">
        ${sec(8,"Review, Gates &amp; Onboarding", phRow("HR officer notes",c.hr_officer_notes)+phRow("Juvelyn sign-off",c.juvelyn_review_date?"Signed":"")+phRow("SM acceptance (hard gate)",c.sm_acceptance)+phRow("Contract ID",c.contract_id)+phRow("PayPlus setup",c.payplus_setup?"Done":"")+phRow("Assigned Employee ID",c.assigned_employee_id))}
      </div>
      <div class="panel"><h2>Required Documents <span class="count-tag">${phDocsReceived(c)}/${DEFAULT_PH_DOCS.length}</span></h2>
        <div class="psub">NBI / police clearance may be <b>"to follow"</b>; the rest are needed to close onboarding. Tap to mark received.</div>
        ${phDocsRows(c)}
      </div>
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
  if(next) $("#phAdvance").addEventListener("click",()=>setPhase(c,next.key,m));
  const rej=document.getElementById("phReject"); if(rej) rej.addEventListener("click",()=>{ const reason=prompt("Rejection reason?"); if(reason!=null) setPhase(c,"REJECTED",m,{rejection_reason:reason}); });
}
function editPrehire(c){
  let m=document.getElementById("phEditModal"); if(!m){ m=document.createElement("div"); m.id="phEditModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(14,50,25,.5);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:560px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;"><div style="font-size:20px;font-weight:800;">Edit applicant — ${esc(c.full_name)}</div><div style="font-size:12.5px;opacity:.85;">${esc(c.prehire_id)} · ${esc(phLabel(c.phase))}</div></div>
    <div style="padding:18px 22px;">
      <div class="panel" style="margin-top:0;"><div class="subhead">Identity</div>
        ${fld("pe_full_name","Full name *",c.full_name)}${sel("pe_department","Department",DEPARTMENTS,c.department)}${fld("pe_position","Position",c.position)}${sel("pe_hire_source","Hire source",HIRE_SOURCES,c.hire_source||"Direct")}${fld("pe_worksite","Worksite (if store)",c.worksite)}
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
        ${sel("pe_ctype","Contract type",CONTRACT_TYPES,c.contract_type)}${fld("pe_rate","Daily rate offered (₱)",c.daily_rate,"number")}${fld("pe_allow","Daily allowance (₱)",c.daily_allowance,"number")}${fld("pe_start","Target start date",c.start_date,"date")}${fld("pe_super","Supervisor",c.supervisor_name)}
      </div>
      <div class="panel"><div class="subhead">Government numbers &amp; bank</div>
        ${fld("pe_sss","SSS",c.sss_number)}${fld("pe_phil","PhilHealth",c.philhealth_number)}${fld("pe_pag","Pag-IBIG",c.pagibig_number)}${fld("pe_tin","TIN",c.tin_number)}${fld("pe_bank","Bank name",c.bank_name)}${fld("pe_acct","Bank account number",c.bank_account_number)}
      </div>
      <div class="panel"><div class="subhead">HR notes &amp; gate</div>
        <div style="margin-bottom:8px;"><label style="display:block;font-size:11px;font-weight:700;color:#6a766f;text-transform:uppercase;margin-bottom:3px;">HR officer notes</label><textarea id="pe_notes" rows="2" style="width:100%;padding:8px 10px;border:1px solid #e2e7e4;border-radius:7px;">${esc(c.hr_officer_notes||"")}</textarea></div>
        ${sel("pe_sm","SM / Retail-ops acceptance",["Pending","Accepted","Rejected","NA"],c.sm_acceptance)}
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
      contract_type:v("pe_ctype"), daily_rate:nv("pe_rate"), daily_allowance:nv("pe_allow"), start_date:v("pe_start"), supervisor_name:v("pe_super"),
      sss_number:v("pe_sss"), philhealth_number:v("pe_phil"), pagibig_number:v("pe_pag"), tin_number:v("pe_tin"), bank_name:v("pe_bank"), bank_account_number:v("pe_acct"),
      hr_officer_notes:v("pe_notes"), sm_acceptance:v("pe_sm"), updated_at:new Date().toISOString() };
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
function newPrehire(){
  const e={};
  let m=document.getElementById("phModal"); if(!m){ m=document.createElement("div"); m.id="phModal"; document.body.appendChild(m); }
  m.style.cssText="position:fixed;inset:0;z-index:9998;background:rgba(14,50,25,.45);display:flex;justify-content:flex-end;";
  m.innerHTML=`<div style="background:#f1f4f2;width:100%;max-width:520px;height:100%;overflow-y:auto;box-shadow:-6px 0 30px rgba(0,0,0,.18);">
    <div style="background:linear-gradient(135deg,#0f1f33,#1E3A5F);color:#fff;padding:18px 22px;"><div style="font-size:20px;font-weight:800;">New Application</div><div style="font-size:12.5px;opacity:.85;">Enters the pipeline at “Applied”.</div></div>
    <div style="padding:18px 22px;"><div class="panel" style="margin-top:0;">
      ${fld("np_full_name","Full name *",e.full_name)}
      ${sel("np_department","Department",DEPARTMENTS,e.department)}
      ${fld("np_position","Position",e.position)}
      ${sel("np_hire_source","Hire source",HIRE_SOURCES,"Direct")}
      ${fld("np_worksite","Worksite (if store)",e.worksite)}
      ${fld("np_email","Email",e.email,"email")}
      ${fld("np_phone","Phone",e.phone)}
      ${sel("np_contract_type","Contract type",CONTRACT_TYPES,"Probationary")}
      ${fld("np_daily_rate","Daily rate (₱)",e.daily_rate,"number")}
      <div id="npMsg" style="font-size:13px;color:#a4322a;margin:6px 0;"></div>
      <div style="display:flex;gap:10px;"><button class="btn ghost" id="npCancel" style="flex:1;">Cancel</button><button class="btn" id="npSave" style="flex:1;">Create</button></div>
    </div></div></div>`;
  $("#npCancel").addEventListener("click",()=>m.remove());
  m.addEventListener("click",(ev)=>{ if(ev.target===m) m.remove(); });
  $("#npSave").addEventListener("click",async()=>{
    const fullname=document.getElementById("np_full_name").value.trim();
    if(!fullname){ document.getElementById("npMsg").textContent="Full name is required."; return; }
    const stamp=new Date().toISOString().slice(0,10).replace(/-/g,"");
    const rnd=Math.abs(fullname.split("").reduce((a,ch)=>a*31+ch.charCodeAt(0),7))%1000;
    const payload={ prehire_id:"PH-"+stamp+"-"+String(rnd).padStart(3,"0"), phase:"APPLICATION", full_name:fullname,
      department:v("np_department"), position:v("np_position"), hire_source:v("np_hire_source"), worksite:v("np_worksite"),
      email:v("np_email"), phone:v("np_phone"), contract_type:v("np_contract_type"), daily_rate:nv("np_daily_rate") };
    const { error } = await sb.from("prehire").insert(payload);
    if(error){ document.getElementById("npMsg").textContent=error.message; return; }
    m.remove(); await loadEmployees(); window.go("prehire");
  });
}

/* ============================ ONBOARDING MODULE ============================ */
function tasksFor(caseId){ return ONBTASKS.filter(t=>t.case_id===caseId).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)); }
function caseProgress(caseId){ const ts=tasksFor(caseId); const done=ts.filter(t=>t.status==="Done").length; return {done, total:ts.length}; }
function defaultOnbTasks(c){
  const bank=(c.group_name==="Retail")?"Union Bank":"China Bank";
  return [
    {task_key:"schedule",label:"Set onboarding schedule (Day 1 plan)",owner_role:"HR",sort_order:1},
    {task_key:"bank",label:"Process bank account — "+bank,owner_role:"HR / Finance",sort_order:2},
    {task_key:"uniform",label:"Issue / send uniform (capture deduction authorization)",owner_role:"HR / Admin",sort_order:3},
    {task_key:"gov_forms",label:"Government registration (SSS R-1A · PhilHealth · Pag-IBIG · BIR 1902)",owner_role:"HR",sort_order:4},
    {task_key:"payplus",label:"Encode in PayPlus",owner_role:"Payroll",sort_order:5},
    {task_key:"employee_id",label:"Assign Employee ID",owner_role:"HR",sort_order:6},
    {task_key:"orientation",label:"Orientation / product training",owner_role:"HR / Supervisor",sort_order:7}
  ];
}
function renderOnboarding(){
  const pg=$("#page-onboarding"); if(!pg) return;
  const active=ONBOARDING.filter(c=>c.status!=="Complete");
  const done=ONBOARDING.filter(c=>c.status==="Complete").length;
  const pendingTasks=ONBTASKS.filter(t=>t.status!=="Done").length;
  pg.innerHTML=`
    <div class="panel" style="margin-top:0;">
      <h2>Onboarding Tasks</h2>
      <div class="psub">After a contract is signed, each hire becomes an onboarding case — schedule, bank, uniform, government forms, PayPlus, Employee ID, orientation. Auto-flows from Pre-hire.</div>
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
  const eligible=PREHIRE.filter(p=>["READY_FOR_CONTRACT","CONTRACT_PIPELINE","ONBOARDING"].includes(p.phase)&&!has.has(p.id));
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
  if(pre.phase!=="ONBOARDING") await sb.from("prehire").update({phase:"ONBOARDING"}).eq("id",pre.id);
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
        <div class="psub">Tap a task to mark it done. Bank auto-set to ${c.group_name==="Retail"?"Union Bank":"China Bank"} by group.</div>
        ${ts.map(t=>`<div class="task clickable" data-tid="${t.id}" style="cursor:pointer;">
          <div class="dot ${t.status==="Done"?"g":"a"}"></div>
          <div style="flex:1;"><div class="tt">${esc(t.label)}</div><div class="td">${esc(t.owner_role||"")}${t.is_mandatory?"":" · optional"}</div></div>
          <div class="due ${t.status==="Done"?"g":"a"}">${t.status==="Done"?"✓ Done":"Pending"}</div></div>`).join("")}
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
  if(c.prehire_id) await sb.from("prehire").update({phase:"COMPLETE", assigned_employee_id:c.assigned_employee_id}).eq("id",c.prehire_id);
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
  const eligible=PREHIRE.filter(p=>["READY_FOR_CONTRACT","CONTRACT_PIPELINE"].includes(p.phase)&&!has.has(p.id));
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
  if(pre.phase!=="CONTRACT_PIPELINE") await sb.from("prehire").update({phase:"CONTRACT_PIPELINE", contract_id:data.contract_id}).eq("id",pre.id);
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
const HR_RETURN_ITEMS=[["id","Company ID"],["hmo_card","HMO / Health card"],["locker","Locker key"],["uniform","Uniform"],["handbook","Staff handbook"]];
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
      return `<tr class="clickable" data-id="${x.id}"><td><b>${esc(x.employee_name)}</b><div class="esub">${esc(x.position||"")}</div></td>
        <td>${x.last_working_day?fmtDate(x.last_working_day):"—"}${t!=null?` · ${t} mo`:""}</td>
        <td>${esc(x.separation_type||"—")}</td>
        <td><div class="barrow"><div class="bartrack"><div class="bar${dn===8?'':' def'}" style="width:${Math.round(dn/8*100)}%"></div></div><span style="font-size:11.5px;color:var(--muted);">${dn}/8</span></div></td>
        <td><b>${peso(exitNet(x))}</b></td>
        <td>${x.overall_status==="Complete"?'<span class="pill closed">Separated</span>':'<span class="pill probation">In Progress</span>'}</td></tr>`;
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

      <div class="panel"><h2>Items returned to HR</h2>
        <div class="psub">Company property surrendered by the leaving employee</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px 18px;">
          ${HR_RETURN_ITEMS.map(([k,lbl])=>`<label style="font-size:13px;"><input type="checkbox" data-return="${k}" ${(x.hr_returns&&x.hr_returns[k])?"checked":""}> ${esc(lbl)}</label>`).join("")}
        </div>
      </div>

      ${under6?`<div class="madv"><div class="madv-h">⚖️ Uniform deduction — tenure under 6 months</div>
        <div style="font-size:12.5px;color:#5c4720;">Per RCC policy the uniform cost is recoverable, but a deduction from final pay is lawful <b>only with the employee's signed authorization</b> (the employment-contract clause, Art. 113) and never below minimum wage.</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;align-items:center;">
          <label style="font-size:12.5px;"><input type="checkbox" id="ex_uniform_returned" ${x.uniform_returned?"checked":""}> Uniform returned in good condition</label>
          <label style="font-size:12.5px;"><input type="checkbox" id="ex_uniform_auth" ${x.uniform_auth_on_file?"checked":""}> Signed authorization on file (contract clause)</label>
        </div>
        ${exNumField("ex_uniform_deduction","Uniform deduction (₱)",x.uniform_deduction)}
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
        <label style="display:block;font-size:13px;margin:8px 0;"><input type="checkbox" id="ex_hmo" ${x.hmo_cancelled?"checked":""}> HMO / insurance cancellation queued (advise sent to provider)</label>
        <label style="display:block;font-size:13px;margin:5px 0;"><input type="checkbox" id="ex_coe" ${x.coe_issued?"checked":""}> Certificate of Employment issued <span style="color:var(--muted);">(DOLE: within 3 days of request)</span></label>
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
    uniform_returned:!!(m.querySelector("#ex_uniform_returned")&&m.querySelector("#ex_uniform_returned").checked),
    uniform_auth_on_file:!!(m.querySelector("#ex_uniform_auth")&&m.querySelector("#ex_uniform_auth").checked),
    hmo_cancelled:m.querySelector("#ex_hmo").checked, coe_issued:m.querySelector("#ex_coe").checked };
  const ret={}; m.querySelectorAll("[data-return]").forEach(el=>{ ret[el.dataset.return]=el.checked; });
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
