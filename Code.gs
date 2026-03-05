// ═══════════════════════════════════════════════════════
// TABLE TENNIS TOURNAMENT — Google Apps Script Backend v2
// Server handles ALL data mutations atomically
// ═══════════════════════════════════════════════════════

const SHEET_NAME = 'TT_Data';

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange('A1').setValue(JSON.stringify(defaultDB()));
  }
  return sh;
}

function defaultDB() {
  return {
    settings: {
      name: 'Table Tennis Tournament 2025',
      startDate: '', endDate: '', venue: '', city: '',
      mpg: 4, fmt: 'Best of 5', msg: '', gf: '', scriptURL: ''
    },
    noms: [],
    groups: { M45: {}, M45P: {}, F45: {}, F45P: {} },
    schedule: [], results: [], nid: 1
  };
}

function readDB() {
  try {
    const raw = getSheet().getRange('A1').getValue();
    const db = JSON.parse(raw);
    return db || defaultDB();
  } catch(e) {
    return defaultDB();
  }
}

function writeDB(db) {
  getSheet().getRange('A1').setValue(JSON.stringify(db));
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET ──────────────────────────────────────────────
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'get';
    if (action === 'get')      return respond(readDB());
    if (action === 'ping')     return respond({ ok: true, ts: new Date().toISOString() });
    if (action === 'syncForm') return respond(syncFormResponses());
    return respond({ error: 'Unknown action' });
  } catch(err) {
    return respond({ error: err.toString() });
  }
}

// ── POST — all mutations go through here ─────────────
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const action = req.action;
    const db = readDB();
    let result = { ok: true };

    if (action === 'addNom') {
      // Check duplicate CPF
      const cpfClean = req.nom.cpf.replace(/\D/g, '');
      const exists = db.noms.some(n => n.cpf.replace(/\D/g, '') === cpfClean);
      if (exists) return respond({ ok: false, error: 'CPF already registered' });
      req.nom.id = db.nid++;
      db.noms.push(req.nom);
    }
    else if (action === 'updateNomStatus') {
      const n = db.noms.find(x => x.id === req.id);
      if (n) n.status = req.status;
    }
    else if (action === 'deleteNom') {
      db.noms = db.noms.filter(x => x.id !== req.id);
    }
    else if (action === 'addPlayerDirect') {
      const cpfClean = req.nom.cpf.replace(/\D/g, '');
      const exists = db.noms.some(n => n.cpf.replace(/\D/g, '') === cpfClean);
      if (exists) return respond({ ok: false, error: 'CPF already registered' });
      req.nom.id = db.nid++;
      db.noms.push(req.nom);
    }
    else if (action === 'saveGroups') {
      db.groups = req.groups;
    }
    else if (action === 'addMatch') {
      req.match.id = db.nid++;
      db.schedule.push(req.match);
      result.id = req.match.id;
    }
    else if (action === 'updateMatch') {
      db.schedule = db.schedule.map(x => x.id === req.match.id ? req.match : x);
    }
    else if (action === 'deleteMatch') {
      db.schedule = db.schedule.filter(x => x.id !== req.id);
    }
    else if (action === 'addResult') {
      req.result.id = db.nid++;
      db.results.push(req.result);
      result.id = req.result.id;
    }
    else if (action === 'updateResult') {
      db.results = db.results.map(x => x.id === req.result.id ? req.result : x);
    }
    else if (action === 'deleteResult') {
      db.results = db.results.filter(x => x.id !== req.id);
    }
    else if (action === 'saveSettings') {
      db.settings = { ...db.settings, ...req.settings };
    }
    else if (action === 'clearMatches') {
      db.schedule = []; db.results = [];
    }
    else if (action === 'clearGroups') {
      db.groups = { M45: {}, M45P: {}, F45: {}, F45P: {} };
    }
    else if (action === 'clearAll') {
      const url = db.settings.scriptURL;
      const fresh = defaultDB();
      fresh.settings.scriptURL = url;
      writeDB(fresh);
      return respond({ ok: true });
    }
    else {
      return respond({ ok: false, error: 'Unknown action: ' + action });
    }

    writeDB(db);
    return respond(result);
  } catch(err) {
    return respond({ ok: false, error: err.toString() });
  }
}

// ── GOOGLE FORM SYNC ──────────────────────────────────
function syncFormResponses() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const formSh = sheets.find(s =>
    s.getName().toLowerCase().includes('form response') ||
    s.getName().toLowerCase().includes('respostas')
  );
  if (!formSh) return { ok: false, msg: 'No Form Responses sheet found. Link your Google Form to this spreadsheet first.' };

  const db = readDB();
  const rows = formSh.getDataRange().getValues();
  if (rows.length < 2) return { ok: true, synced: 0, msg: 'No responses yet.' };

  const hdrs = rows[0].map(h => h.toString().toLowerCase());
  const cpfIdx    = hdrs.findIndex(h => h.includes('cpf'));
  const nameIdx   = hdrs.findIndex(h => h.includes('name') || h.includes('nome'));
  const ageIdx    = hdrs.findIndex(h => h.includes('age')  || h.includes('idade'));
  const genderIdx = hdrs.findIndex(h => h.includes('gender') || h.includes('sexo'));

  if ([cpfIdx, nameIdx, ageIdx, genderIdx].some(i => i < 0)) {
    return { ok: false, msg: 'Columns not found. Headers: ' + hdrs.join(', ') };
  }

  const existingCPFs = new Set(db.noms.map(n => n.cpf.replace(/\D/g, '')));
  let synced = 0, skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawCPF = String(row[cpfIdx] || '').replace(/\D/g, '');
    if (!rawCPF || existingCPFs.has(rawCPF)) { skipped++; continue; }

    const name   = String(row[nameIdx] || '').trim();
    const age    = parseInt(String(row[ageIdx] || '0')) || 0;
    const gender = String(row[genderIdx] || '').trim();
    if (!name || !age) { skipped++; continue; }

    const male = gender.toLowerCase().startsWith('m');
    const cat  = male ? (age >= 45 ? 'M45P' : 'M45') : (age >= 45 ? 'F45P' : 'F45');

    db.noms.push({
      id: db.nid++, cpf: rawCPF, name, age, gender, cat,
      status: 'pending', ts: new Date().toISOString(), source: 'google_form'
    });
    existingCPFs.add(rawCPF);
    synced++;
  }

  writeDB(db);
  return { ok: true, synced, skipped };
}
