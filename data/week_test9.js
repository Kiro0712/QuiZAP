// 朝学習テスト⑨
const WEEK_TEST9_ITEMS = [
    
];

const LABELS = ["ア", "イ", "ウ"];

function uniq(arr){
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function answersOf(item){
  return uniq([item.en].concat(item.alt || []));
}

function toCharTokens(text){
  const compact = (text || "").toString().replace(/\s+/g, "");
  return compact.split("").join(" / ");
}

function withOptionalHint(base, item){
  if(item.h) return {...base, h:item.h};
  return base;
}

function buildCharSortQuestion(item){
  const q =
    `次の文字を並び替えて正しい英語の表現にせよ。\n` +
    `${item.ja}`;

  return withOptionalHint({
    q,
    d: item.d,
    a: answersOf(item),
  }, item);
}

function buildInputQuestion(item){
  const q =
    `次の日本語に合う英語を書け。\n` +
    `${item.ja}`;

  return withOptionalHint({
    q,
    d: item.d,
    a: answersOf(item),
  }, item);
}

function buildChoiceQuestion(item, idx, items){
  const len = items.length;
  const d1 = items[(idx + 11) % len].en;
  const d2 = items[(idx + 23) % len].en;

  let options = [item.en, d1, d2];
  let correct = "ア";

  if(idx % 3 === 1){
    options = [d1, item.en, d2];
    correct = "イ";
  }else if(idx % 3 === 2){
    options = [d1, d2, item.en];
    correct = "ウ";
  }

  const q =
    `次の意味に当てはまる語を選べ。\n` +
    `${item.ja}\n` +
    `${LABELS[0]}：${options[0]}\n` +
    `${LABELS[1]}：${options[1]}\n` +
    `${LABELS[2]}：${options[2]}`;

  return withOptionalHint({
    q,
    d: item.d,
    a: uniq([correct].concat(answersOf(item))),
  }, item);
}

const WEEK_TEST8_DATA = {
  "3択から選ぶ": WEEK_TEST9_ITEMS.map((item, idx, arr)=>buildChoiceQuestion(item, idx, arr)),
  "文字並び替え": WEEK_TEST9_ITEMS.map(buildCharSortQuestion),
  "文字入力": WEEK_TEST9_ITEMS.map(buildInputQuestion),
};

if (typeof LOGIC_DATA !== "undefined" && LOGIC_DATA && typeof LOGIC_DATA === "object") {
  Object.assign(LOGIC_DATA, WEEK_TEST8_DATA);
}
