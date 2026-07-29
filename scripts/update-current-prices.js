// ==================================================================
// data/current-prices.js を株探(kabutan.jp)の現在値で更新するスクリプト。
// .github/workflows/update-current-prices.yml から実行される想定。
// 依存パッケージなし（Node 18+ の組み込み fetch のみ使用）。
// ==================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'current-prices.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function sleep(ms){
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// data/<year>/<month>.js から銘柄コードを重複なく収集する
function collectCodes(){
  const codes = [];
  const seen = new Set();
  for(const year of fs.readdirSync(DATA_DIR, {withFileTypes:true})){
    if(!year.isDirectory()) continue;
    const yearDir = path.join(DATA_DIR, year.name);
    for(const file of fs.readdirSync(yearDir)){
      if(!file.endsWith('.js')) continue;
      const text = fs.readFileSync(path.join(yearDir, file), 'utf8');
      for(const m of text.matchAll(/code:"([^"]+)"/g)){
        if(!seen.has(m[1])){
          seen.add(m[1]);
          codes.push(m[1]);
        }
      }
    }
  }
  return codes;
}

// 既存の current-prices.js を読み、取得に失敗した銘柄のフォールバック値として使う
function loadExisting(){
  if(!fs.existsSync(OUTPUT_FILE)) return {};
  const text = fs.readFileSync(OUTPUT_FILE, 'utf8');
  const m = text.match(/var CURRENT_PRICES = (\{[\s\S]*?\});/);
  if(!m) return {};
  try{
    return JSON.parse(m[1]);
  }catch(e){
    return {};
  }
}

async function fetchPrice(code){
  const res = await fetch(`https://kabutan.jp/stock/?code=${code}`, {
    headers: {'User-Agent': UA}
  });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/class="kabuka">([\d,.]+)円/);
  if(!m) throw new Error('price not found');
  return m[1];
}

function nowJstIso(){
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 19) + '+09:00';
}

async function main(){
  const codes = collectCodes();
  const prices = loadExisting();
  let updated = 0, failed = 0;

  for(const code of codes){
    try{
      const price = await fetchPrice(code);
      prices[code] = price;
      updated++;
    }catch(e){
      failed++;
      console.error(`[skip] ${code}: ${e.message}`);
    }
    await sleep(400);
  }

  const lines = codes
    .filter((code) => prices[code] !== undefined)
    .map((code) => `  "${code}": "${prices[code]}"`);
  const body = [
    '// ==================================================================',
    '// 現在値（現物株価）データ',
    '// 東証取引時間中（平日9:00-11:30, 12:30-15:30 JST）は',
    '// .github/workflows/update-current-prices.yml が15分おきに',
    '// scripts/update-current-prices.js を実行し、株探(kabutan.jp)から',
    '// 取得した現在値でこのファイルを自動更新・pushする。',
    '// 手動で編集しても次回の自動更新で上書きされる。',
    '// ==================================================================',
    `var CURRENT_PRICES = {\n${lines.join(',\n')}\n};`,
    `var CURRENT_PRICES_UPDATED_AT = "${nowJstIso()}";`,
    ''
  ].join('\n');

  fs.writeFileSync(OUTPUT_FILE, body);
  console.log(`updated ${updated}/${codes.length} codes (${failed} failed)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
