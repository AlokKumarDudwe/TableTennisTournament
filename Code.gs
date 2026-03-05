// ═══════════════════════════════════════════════════════
//  TABLE TENNIS TOURNAMENT — Google Apps Script Backend
//  Copy ALL of this into your Apps Script editor
// ═══════════════════════════════════════════════════════

const DATA_SHEET = 'TT_Data';

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(DATA_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DATA_SHEET);
    sh.getRange('A1').setValue(JSON.stringify(defaultDB()));
  }
  return sh;
}

function defaultDB() {
  return {
    settings: {
      name:'Table Tennis Tournament 2025',
      startDate:'',endDate:'',venue:'',city:'',
      org:'',email:'',mpg:4,fmt:'Best of 5',msg:'',gf:''
    },
    noms:[],
    groups:{M45:{},M45P:{},F45:{},F45P:{}},
    schedule:[],results:[],archive:[],nid:1
  };
}

function readDB() {
  try {
    const raw = getSheet().getRange('A1').getValue();
    return JSON.parse(raw) || defaultDB();
  } catch(e) { return defaultDB(); }
}

function writeDB(data) {
  getSheet().getRange('A1').setValue(JSON.stringify(data));
}

// ── MAIN API ENTRY POINTS ──────────────────────────────

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'get';
    let result;
    if      (action === 'get')      result = readDB();
    else if (action === 'syncForm') result = syncFormResponses();
    else if (action === 'ping')     result = { ok:true, ts:new Date().toISOString() };
    else                            result = { error:'Unknown action: '+action };
    return out(result);
  } catch(err) {
    return out({ error: err.toString() });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    writeDB(data);
    return out({ ok:true });
  } catch(err) {
    return out({ error: err.toString() });
  }
}

function out(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GOOGLE FORM SYNC ───────────────────────────────────

function syncFormResponses() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();

  // Find the Form Responses sheet
  const formSh = sheets.find(s =>
    s.getName().toLowerCase().includes('form response') ||
    s.getName().toLowerCase().includes('respostas')
  );
  if (!formSh) {
    return { ok:false, msg:'No Google Form response sheet found. Open your Google Form → Responses → Link to Sheets.' };
  }

  const db   = readDB();
  const rows = formSh.getDataRange().getValues();
  if (rows.length < 2) return { ok:true, synced:0, msg:'No responses yet.' };

  const hdrs     = rows[0].map(h => h.toString().toLowerCase());
  const cpfIdx   = hdrs.findIndex(h => h.includes('cpf'));
  const nameIdx  = hdrs.findIndex(h => h.includes('name') || h.includes('nome'));
  const ageIdx   = hdrs.findIndex(h => h.includes('age')  || h.includes('idade'));
  const genderIdx= hdrs.findIndex(h => h.includes('gender')|| h.includes('sexo'));

  if ([cpfIdx,nameIdx,ageIdx,genderIdx].some(i => i < 0)) {
    return { ok:false, msg:'Could not detect columns. Headers found: ' + hdrs.join(', ') };
  }

  const existingCPFs = new Set(db.noms.map(n => n.cpf.replace(/\D/g,'')));
  let synced = 0, skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row    = rows[i];
    const rawCPF = String(row[cpfIdx]||'').replace(/\D/g,'');
    if (rawCPF.length !== 11 || existingCPFs.has(rawCPF)) { skipped++; continue; }

    const name   = String(row[nameIdx]||'').trim();
    const age    = parseInt(String(row[ageIdx]||'0')) || 0;
    const gender = String(row[genderIdx]||'').trim();
    if (!name || !age) { skipped++; continue; }

    const gL  = gender.toLowerCase();
    const male= gL.includes('male')||gL==='m'||gL.includes('masc');
    const cat = male ? (age>=45?'M45P':'M45') : (age>=45?'F45P':'F45');
    const cpfFmt = rawCPF.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

    db.noms.push({ id:db.nid||1, cpf:cpfFmt, name, age, gender, cat,
      status:'pending', ts:new Date().toISOString(), source:'google_form' });
    db.nid = (db.nid||1)+1;
    existingCPFs.add(rawCPF);
    synced++;
  }

  writeDB(db);
  return { ok:true, synced, skipped, total:rows.length-1 };
}
