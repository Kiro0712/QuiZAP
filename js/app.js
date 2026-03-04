// 追加科目（データ未登録のため空）
const LOGIC_DATA = {};
const BIO_DATA = {};

const SUBJECT_DEFAULTS = {
  "公共": DEFAULT_DATA,
  "保健": HEALTH_DATA,
  "論理・表現Ⅰ": LOGIC_DATA,
  "生物基礎": BIO_DATA,
};

/* =========================
   2) アプリ本体
   ========================= */
const LS_KEY = "koukyou_quiz_v1";

// 問題データをHTML側で更新しても、localStorageに古いdataが残っていると反映されないため、版（バージョン）を持たせて不一致ならDEFAULT_DATAを採用する
const DATA_VERSION = 4;

const state = {
  subject: "公共",
  dataBySubject: null,
  statsBySubject: null,
  mistakesBySubject: null,
  sectionBySubject: null,

  data: null,
  section: null,
  mode: "flash",
  order: [], // [{section, index}, ...]
  idx: -1,
  current: null,
  revealed: false,
  stats: {seen:0, ok:0, ng:0, streak:0},
  mistakes: new Set(),
  reviewMode: false
};

const el = (id)=>document.getElementById(id);

function normalize(s){
  return (s??"")
    .toString()
    .trim()
    .replace(/\s+/g,"")
    .replace(/[‐-‒–—―ー]/g,"-")
    .replace(/[・]/g,"･")
    .replace(/[（）()]/g,"");
}

function qid(section, i){ return section + "::" + i; }

function hasChapterData(data){
  return !!data && Object.keys(data).length > 0;
}

function pickAvailableSubject(preferred = "公共"){
  if(hasChapterData(SUBJECT_DEFAULTS[preferred])) return preferred;
  const found = Object.keys(SUBJECT_DEFAULTS).find(subj => hasChapterData(SUBJECT_DEFAULTS[subj]));
  return found || "公共";
}

function escapeHTML(str){
  return (str??"").toString()
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/\"/g,"&quot;")
    .replace(/'/g,"&#39;");
}

// 選択肢行（ア：/イ：/ウ：...）が同一行に並んでいる場合も分割
function splitChoiceRun(line){
  const s = (line??"").trim();
  if(!/^[ア-ン]：/.test(s)) return [s];
  const parts = s.split(/(?=[ア-ン]：)/g).map(x=>x.trim()).filter(Boolean);
  return parts.length ? parts : [s];
}

function formatQuestionHTML(rawQ){
  // ここは「SyntaxErrorを起こさない」ことを最優先にして、
  // 正規表現リテラルが行途中で壊れないよう “必ず1行の式” で完結させる。
  // - \r\n / \r を \n に統一
  // - 文字として入っている "\\n"（バックスラッシュ+n）も実改行へ
  const q = (rawQ ?? "").toString()
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n");

  const lines = q.split("\n");
  const out = [];
  if(lines.length === 0) return "";

  // 1行目：本文
  out.push(escapeHTML(lines[0]));

  // 2行目以降：選択肢・補足（必ず改行して表示）
  for(let i=1;i<lines.length;i++){
    const l = lines[i];
    const chunks = splitChoiceRun(l);
    for(const chunk of chunks){
      const t = (chunk ?? "").trim();
      if(!t) continue;
      if(/^[ア-ン]：/.test(t)){
        out.push(`<br><span class="choiceLine">${escapeHTML(t)}</span>`);
      }else{
        out.push(`<br>${escapeHTML(t)}`);
      }
    }
  }

  return out.join("");
}

function buildSectionOptions(){
  const sel = el("sectionSel");
  if(!sel) return;
  sel.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "__ALL__";
  allOpt.textContent = "全章";
  sel.appendChild(allOpt);

  const keys = Object.keys(state.data || {});
  keys.forEach(name=>{
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  if(state.section === "__ALL__"){
    sel.value = "__ALL__";
  }else if(keys.includes(state.section)){
    sel.value = state.section;
  }else{
    state.section = "__ALL__";
    sel.value = "__ALL__";
  }
}

function makeOrder(fromMistakes=false){
  let pool = [];

  if(state.section === "__ALL__"){
    Object.keys(state.data).forEach(sec=>{
      (state.data[sec] || []).forEach((_,i)=>{
        pool.push({section:sec, index:i});
      });
    });
  }else{
    (state.data[state.section] || []).forEach((_,i)=>{
      pool.push({section:state.section, index:i});
    });
  }

  if(fromMistakes){
    pool = pool.filter(p=> state.mistakes.has(qid(p.section,p.index)));
  }

  // shuffle (常にシャッフル状態)
  for(let i=pool.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }

  state.order = pool;
  state.idx = -1;
  updateNavButtons();
}

function currentItem(){
  const entry = state.order[state.idx];
  if(!entry) return null;

  const items = state.data[entry.section] || [];
  const it = items[entry.index];
  if(!it) return null;

  return { ...it, _i:entry.index, _section:entry.section, _id: qid(entry.section,entry.index) };
}

function updateNavButtons(){
  const btnPrev = el("btnPrev");
  const btnNext = el("btnNext");
  const btnReview = el("btnReviewMistakes");

  const total = state.order.length;
  const atStart = state.idx <= 0;
  const atEnd = total === 0 ? true : state.idx >= total - 1;

  if(btnPrev) btnPrev.style.display = atStart ? "none" : "inline-block";
  if(btnNext) btnNext.style.display = atEnd ? "none" : "inline-block";

  if(btnReview){
    if(state.mode === "input" && atEnd && total > 0){
      btnReview.style.display = "inline-block";
    }else if(state.mode === "input"){
      btnReview.style.display = "none";
    }
  }
}

function setModeUI(){
  const isInput = state.mode === "input";

  const statsRow = el("statsRow");
  const sepTop = el("sepStatsTop");
  const sepBottom = el("sepStatsBottom");

  if(statsRow){
    const show = isInput;
    statsRow.style.display = show ? "flex" : "none";
    if(sepTop) sepTop.style.display = show ? "block" : "none";
    if(sepBottom) sepBottom.style.display = show ? "block" : "none";
  }

  const btnShow = el("btnShow");
  const btnReview = el("btnReviewMistakes");
  const btnReset = el("btnResetStats");

  if(state.mode === "flash"){
    if(btnShow) btnShow.style.display = "inline-block";
    if(btnReview) btnReview.style.display = "none";
    if(btnReset) btnReset.style.display = "none";
  }else{
    if(btnShow) btnShow.style.display = "none";
    if(btnReset) btnReset.style.display = "inline-block";
  }

  el("inputArea").style.display = isInput ? "block" : "none";
  el("ansInput").value = "";
  el("hintLine").textContent = isInput
    ? "Enterでも判定します / わからなければ「わからない」をクリック・タップ"
    : "";
}

function showAnswer(){
  if(!state.current) return;
  state.revealed = true;
  el("answerBox").style.display = "block";
  el("answerBox").innerHTML =
    `<div class="muted small">答え</div>
     <div style="font-size:18px;margin-top:4px"><b>${escapeHTML((state.current.a||[])[0] || "")}</b></div>
     ${(state.current.a||[]).length>1 ? `<div class="muted small" style="margin-top:6px">別解：${(state.current.a||[]).slice(1).map(escapeHTML).join(" / ")}</div>` : ""}`;
}

function hideAnswer(){
  state.revealed = false;
  el("answerBox").style.display = "none";
  el("answerBox").textContent = "";
}

function renderCurrent(){
  const total = state.order.length;
  const pos = total ? (state.idx + 1) : 0;
  const label = state.section === "__ALL__" ? "全章" : state.section;

  el("metaPill").textContent = `選択中：${label} - ${pos} / ${total}${state.reviewMode ? "（間違い復習）" : ""}`;

  el("qText").innerHTML = formatQuestionHTML(state.current?.q || "");

  const dl = el("diffLine");
  if(dl) dl.textContent = state.current?.d ? `難易度：${state.current.d}` : "";

  updateNavButtons();
}

function nextQuestion(){
  if(state.order.length === 0){
    el("qText").textContent = "この章に問題がありません。";
    const dl = el("diffLine");
    if(dl) dl.textContent = "";
    const label0 = state.section === "__ALL__" ? "全章" : state.section;
    el("metaPill").textContent = `選択中：${label0} - 0 / 0${state.reviewMode ? "（間違い復習）" : ""}`;
    hideAnswer();
    setModeUI();
    state.idx = 0;
    updateNavButtons();
    return;
  }

  if(state.idx < state.order.length - 1){
    state.idx += 1;
  }else{
    state.idx = state.order.length - 1;
  }

  state.current = currentItem();
  state.revealed = false;
  hideAnswer();
  setModeUI();
  renderCurrent();
  el("ansInput").focus();
}

function prevQuestion(){
  if(state.order.length === 0) return;
  if(state.idx <= 0){
    state.idx = 0;
  }else{
    state.idx -= 1;
  }

  state.current = currentItem();
  state.revealed = false;
  hideAnswer();
  setModeUI();
  renderCurrent();
}

function judge(){
  if(!state.current) return;
  const user = normalize(el("ansInput").value);
  const answers = (state.current.a || []).map(normalize);
  const ok = answers.includes(user);

  state.stats.seen += 1;
  if(ok){
    state.stats.ok += 1;
    state.stats.streak += 1;
    state.mistakes.delete(state.current._id);
    el("hintLine").innerHTML = `<span class="ok"><b>○ 正解！</b></span>　次へどうぞ。`;
  }else{
    state.stats.ng += 1;
    state.stats.streak = 0;
    state.mistakes.add(state.current._id);
    el("hintLine").innerHTML = `<span class="ng"><b>× ちがう</b></span>　答えを表示します。`;
    showAnswer();
  }
  renderStats();
  save();
  updateNavButtons();
}

function giveUp(){
  if(!state.current) return;
  state.stats.seen += 1;
  state.stats.ng += 1;
  state.stats.streak = 0;
  state.mistakes.add(state.current._id);
  renderStats();
  showAnswer();
  el("hintLine").innerHTML = `<span class="ng"><b>×</b></span>　復習リストに入れました。`;
  save();
  updateNavButtons();
}

function renderStats(){
  const {seen, ok} = state.stats;
  const rate = seen ? Math.round(ok/seen*100) : 0;

  const summaryEl = el("statSummary");
  if(summaryEl){
    summaryEl.innerHTML = `<span class="statNum">${seen}</span>問目、<span class="statNum">${ok}</span>問正解！（<span class="statNum">${rate}</span>％）`;
  }
}

function renderSearch(keyword){
  const kw = (keyword ?? "").trim();
  const box = el("searchList");
  box.innerHTML = "";

  if(!kw){
    box.innerHTML = `<div class="muted small">検索すると一致した問題・答えがここに出ます。</div>`;
    return;
  }

  const pool = [];
  if(state.section === "__ALL__"){
    Object.keys(state.data).forEach(sec=>{
      (state.data[sec] || []).forEach((it, idx)=>pool.push({it, section:sec, index:idx}));
    });
  }else{
    (state.data[state.section] || []).forEach((it, idx)=>pool.push({it, section:state.section, index:idx}));
  }

  const hit = [];
  pool.forEach(({it, section, index})=>{
    const qText = it.q || "";
    const aText = (it.a || []).join(" / ");
    const hay = qText + "\n" + aText;

    if(hay.includes(kw)) hit.push({it, section, index});
  });

  if(hit.length===0){
    box.innerHTML = `<div class="muted small">見つかりませんでした。</div>`;
    return;
  }

  hit.slice(0,50).forEach(({it, section, index})=>{
    const div = document.createElement("div");
    div.className="item";
    const id = qid(section, index);

    const qHit = (it.q || "").includes(kw);
    const aHit = (it.a || []).some(x => (x || "").includes(kw));
    const where = qHit && aHit ? "（問題＋答え）" : qHit ? "（問題）" : "（答え）";

    div.innerHTML =
      `<b>${escapeHTML(it.q || "")} <span class="small muted">${where}</span></b>` +
      `<div class="small muted">答え：${escapeHTML((it.a||[])[0] || "")} ${state.mistakes.has(id) ? " / ミス済" : ""}</div>` +
      (it.d ? `<div class="small muted">難易度：${escapeHTML(it.d)}</div>` : "");

    div.onclick = ()=>{
      state.reviewMode = false;
      state.order = [{section, index}];
      state.idx = -1;
      nextQuestion();
    };

    box.appendChild(div);
  });
}

let _pendingSaved = null;

function openSubjectModal(){
  const m = el("subjectModal");
  if(!m) return;
  m.style.display = "flex";
  m.setAttribute("aria-hidden","false");
}

function closeSubjectModal(){
  const m = el("subjectModal");
  if(!m) return;
  m.style.display = "none";
  m.setAttribute("aria-hidden","true");
}

function pickSubjectFromModal(subj){
  // データが無い科目は現状選択不可（ボタンdisabled）
  state.subject = subj;
  el("subjectSel").value = subj;

  const saved = _pendingSaved || {};
  saved.subject = subj;
  saved.subjectChosen = true;
  localStorage.setItem(LS_KEY, JSON.stringify(saved));

  closeSubjectModal();
  loadCore(saved);
}

function load(){
  const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
  _pendingSaved = saved;

  // 初回：科目未選択ならモーダルを表示して待つ
  if(!saved || !saved.subjectChosen){
    openSubjectModal();
    return;
  }

  loadCore(saved);
}

function loadCore(saved){
  const baseDataBySubject = {
    "公共": SUBJECT_DEFAULTS["公共"],
    "保健": SUBJECT_DEFAULTS["保健"],
    "論理・表現Ⅰ": SUBJECT_DEFAULTS["論理・表現Ⅰ"],
    "生物基礎": SUBJECT_DEFAULTS["生物基礎"],
  };

  const hasCurrent = saved && saved.dataVersion === DATA_VERSION;
  state.dataBySubject = { ...baseDataBySubject };
  state.statsBySubject = hasCurrent && saved.statsBySubject ? saved.statsBySubject : {};
  state.mistakesBySubject = hasCurrent && saved.mistakesBySubject ? saved.mistakesBySubject : {};
  state.sectionBySubject = hasCurrent && saved.sectionBySubject ? saved.sectionBySubject : {};

  const savedSubject = saved && saved.subject ? saved.subject : null;
  if(savedSubject && hasChapterData(state.dataBySubject[savedSubject])){
    state.subject = savedSubject;
  }else{
    state.subject = pickAvailableSubject("公共");
  }
  el("subjectSel").value = state.subject;

  state.data = state.dataBySubject[state.subject] || {};
  state.section = state.sectionBySubject[state.subject] || "__ALL__";
  state.mode = (saved && saved.mode) ? saved.mode : "flash";

  state.stats = state.statsBySubject[state.subject] || {seen:0, ok:0, ng:0, streak:0};
  state.mistakes = new Set(state.mistakesBySubject[state.subject] || []);

  state.reviewMode = false;
  buildSectionOptions();
  el("modeSel").value = state.mode;

  makeOrder(false);
  renderStats();
  renderSearch("");
  nextQuestion();

  save();
  updateNavButtons();
  setModeUI();
  maybeRunTests();
}

function save(){
  state.statsBySubject[state.subject] = state.stats;
  state.mistakesBySubject[state.subject] = Array.from(state.mistakes);
  state.sectionBySubject[state.subject] = state.section;

  localStorage.setItem(LS_KEY, JSON.stringify({
    subjectChosen: true,
    dataVersion: DATA_VERSION,
    subject: state.subject,
    statsBySubject: state.statsBySubject,
    mistakesBySubject: state.mistakesBySubject,
    sectionBySubject: state.sectionBySubject,
    mode: state.mode
  }));
}

function resetStats(){
  // 期待動作：この科目の「出題数/正解数/正解率/連続正解」と「ミス記録」をすべて0/空に戻す
  if(!confirm("進捗（正解/不正解/連続正解/ミス）をリセットします。よろしいですか？")) return;

  state.stats = {seen:0, ok:0, ng:0, streak:0};
  state.mistakes = new Set();
  state.reviewMode = false;

  // 画面反映
  renderStats();
  hideAnswer();
  el("hintLine").textContent = "";

  // 出題順を作り直して最初の問題へ
  makeOrder(false);
  state.idx = -1;
  nextQuestion();

  // 科目単位で保存
  state.statsBySubject[state.subject] = state.stats;
  state.mistakesBySubject[state.subject] = [];

  save();
  updateNavButtons();
}

function startReviewMistakes(){
  state.reviewMode = true;
  makeOrder(true);
  if(state.order.length===0){
    alert("この章には間違えている問題がありません。");
    state.reviewMode = false;
    makeOrder(false);
    return;
  }
  nextQuestion();
}

function wire(){
  // 初回モーダルのボタン
  const modal = el("subjectModal");
  if(modal){
    modal.querySelectorAll("button[data-subject]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const subj = btn.getAttribute("data-subject");
        if(!subj) return;
        if(btn.disabled) return;
        pickSubjectFromModal(subj);
      });
    });
  }

  el("sectionSel").addEventListener("change", ()=>{
    state.section = el("sectionSel").value;
    state.reviewMode = false;
    makeOrder(false);
    hideAnswer();
    renderSearch(el("searchBox").value);
    save();
    nextQuestion();
  });

  el("modeSel").addEventListener("change", ()=>{
    state.mode = el("modeSel").value;
    setModeUI();
    updateNavButtons();
    save();
  });

  el("btnNext").onclick = ()=>nextQuestion();
  el("btnPrev").onclick = ()=>prevQuestion();
  el("btnShow").onclick = ()=> state.revealed ? hideAnswer() : showAnswer();
  el("btnJudge").onclick = ()=>judge();
  el("btnGiveUp").onclick = ()=>giveUp();
  el("btnResetStats").onclick = ()=>resetStats();
  el("btnReviewMistakes").onclick = ()=>startReviewMistakes();
  el("searchBox").addEventListener("input", (e)=>renderSearch(e.target.value));

  // 科目切替
  el("subjectSel").addEventListener("change", ()=>{
    save();

    state.subject = el("subjectSel").value;
    state.data = state.dataBySubject[state.subject] || SUBJECT_DEFAULTS[state.subject] || {};
    if(!hasChapterData(state.data)){
      state.subject = pickAvailableSubject("公共");
      el("subjectSel").value = state.subject;
      state.data = state.dataBySubject[state.subject] || SUBJECT_DEFAULTS[state.subject] || {};
    }
    state.section = state.sectionBySubject[state.subject] || "__ALL__";
    state.stats = state.statsBySubject[state.subject] || {seen:0, ok:0, ng:0, streak:0};
    state.mistakes = new Set(state.mistakesBySubject[state.subject] || []);

    state.reviewMode = false;
    buildSectionOptions();

    makeOrder(false);
    renderStats();
    renderSearch("");
    nextQuestion();
    setModeUI();
    updateNavButtons();
    save();
  });

  el("ansInput").addEventListener("keydown", (e)=>{
    if(e.key === "Enter"){ judge(); }
  });
}

// -------------------------
// テスト（?test=1 で実行）
// -------------------------
function assert(cond, msg){
  if(!cond) throw new Error("TEST FAILED: " + msg);
}

function maybeRunTests(){
  if(!location.search.includes("test=1")) return;
  console.log("[tests] start");

  assert(!!el("subjectModal"), "subjectModal exists");
  assert(!!el("subjectSel"), "subjectSel exists");
  assert(!!el("sectionSel"), "sectionSel exists");
  assert(!!el("qText"), "qText exists");

  assert(!!SUBJECT_DEFAULTS["公共"], "has 公共");
  assert(!!SUBJECT_DEFAULTS["保健"], "has 保健");
  assert(!!SUBJECT_DEFAULTS["論理・表現Ⅰ"], "has 論理・表現Ⅰ");
  assert(!!SUBJECT_DEFAULTS["生物基礎"], "has 生物基礎");

  assert(Array.isArray(HEALTH_DATA["9 喫煙と健康"]) && HEALTH_DATA["9 喫煙と健康"].length > 0, "health chapter 9 exists");
  assert(Array.isArray(HEALTH_DATA["10 飲酒と健康"]) && HEALTH_DATA["10 飲酒と健康"].length > 0, "health chapter 10 exists");

  // 選択肢の改行がデータに入っている
  assert(HEALTH_DATA["9 喫煙と健康"][7].q.includes("\n"), "health multiline uses \\n");

  // フォーマッタが選択肢を choiceLine にする
  const html = formatQuestionHTML(HEALTH_DATA["9 喫煙と健康"][7].q);
  assert(html.includes("choiceLine"), "formatter adds choiceLine");
  assert(html.includes("ア："), "formatter keeps choices");

  // 全章で order が作れる
  state.subject = "公共";
  state.data = SUBJECT_DEFAULTS["公共"];
  state.section = "__ALL__";
  makeOrder(false);
  assert(Array.isArray(state.order) && state.order.length > 0, "order built for __ALL__");

  console.log("[tests] OK");
}

wire();
load();

