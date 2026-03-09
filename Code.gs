// ═══════════════════════════════════════════════════════
// TABLE TENNIS TOURNAMENT — Google Apps Script Backend v3
// Uses GET-only requests to avoid CORS issues
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
    noms: [], groups: { A: {}, B: {}, C: {}, D: {} },
    schedule: [], results: [], nid: 1
  };
}

function readDB() {
  try {
    const raw = getSheet().getRange('A1').getValue();
    return JSON.parse(raw) || defaultDB();
  } catch(e) { return defaultDB(); }
}

function writeDB(db) {
  getSheet().getRange('A1').setValue(JSON.stringify(db));
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── ALL REQUESTS ARE GET ──────────────────────────────
// This avoids CORS preflight issues entirely
function doGet(e) {
  try {
    const p = e.parameter || {};
    const action = p.action || 'get';

    // Read-only actions
    if (action === 'get')      return respond(readDB());
    if (action === 'ping')     return respond({ ok: true, ts: new Date().toISOString() });
    if (action === 'syncForm') return respond(syncFormResponses());

    // Write actions — payload is base64-encoded JSON in 'data' param
    const db = readDB();
    let req = {};
    if (p.data) {
      try { req = JSON.parse(Utilities.newBlob(Utilities.base64Decode(p.data)).getDataAsString()); }
      catch(e) { return respond({ ok: false, error: 'Bad payload: ' + e.toString() }); }
    }

    if (action === 'addNom') {
      const cpfClean = (req.cpf || '').replace(/\D/g, '');
      if (!cpfClean) return respond({ ok: false, error: 'Invalid ID number' });
      const cat = req.cat || '';
      // Cat A: CPF must be unique (employee registers themselves)
      // Cat B/C/D: CPF + participantName must be unique (same employee can register multiple wards)
      let exists;
      if (cat === 'A') {
        exists = db.noms.some(n => n.cat === 'A' && n.cpf.replace(/\D/g,'') === cpfClean);
        if (exists) return respond({ ok: false, error: 'This employee CPF is already registered in Category A' });
      } else {
        const partName = (req.partName || req.name || '').trim().toLowerCase();
        exists = db.noms.some(n =>
          n.cat === cat &&
          n.cpf.replace(/\D/g,'') === cpfClean &&
          (n.partName || n.name || '').trim().toLowerCase() === partName
        );
        if (exists) return respond({ ok: false, error: 'This ward/participant is already registered' });
      }
      req.id = db.nid++;
      db.noms.push(req);
    }
    else if (action === 'addPlayerDirect') {
      const cpfClean = (req.cpf || '').replace(/\D/g, '');
      const cat = req.cat || '';
      let exists;
      if (cat === 'A') {
        exists = db.noms.some(n => n.cat === 'A' && n.cpf.replace(/\D/g,'') === cpfClean);
      } else {
        const partName = (req.partName || req.name || '').trim().toLowerCase();
        exists = db.noms.some(n =>
          n.cat === cat &&
          n.cpf.replace(/\D/g,'') === cpfClean &&
          (n.partName || n.name || '').trim().toLowerCase() === partName
        );
      }
      if (exists) return respond({ ok: false, error: 'Already registered' });
      req.id = db.nid++;
      db.noms.push(req);
    }
    else if (action === 'updateNomStatus') {
      const n = db.noms.find(x => x.id === Number(req.id));
      if (n) n.status = req.status;
    }
    else if (action === 'deleteNom') {
      db.noms = db.noms.filter(x => x.id !== Number(req.id));
    }
    else if (action === 'saveGroups') {
      db.groups = req.groups;
    }
    else if (action === 'addMatch') {
      req.id = db.nid++;
      db.schedule.push(req);
    }
    else if (action === 'updateMatch') {
      db.schedule = db.schedule.map(x => x.id === Number(req.id) ? req : x);
    }
    else if (action === 'deleteMatch') {
      db.schedule = db.schedule.filter(x => x.id !== Number(req.id));
    }
    else if (action === 'addResult') {
      req.id = db.nid++;
      db.results.push(req);
    }
    else if (action === 'updateResult') {
      db.results = db.results.map(x => x.id === Number(req.id) ? req : x);
    }
    else if (action === 'deleteResult') {
      db.results = db.results.filter(x => x.id !== Number(req.id));
    }
    else if (action === 'saveSettings') {
      db.settings = { ...db.settings, ...req };
    }
    else if (action === 'clearMatches') {
      db.schedule = []; db.results = [];
    }
    else if (action === 'saveSchedule') {
      db.schedule = req.schedule || [];
    }
    else if (action === 'saveBracket') {
      if(!db.brackets) db.brackets={};
      db.brackets[req.cat]=req.bracket;
    }
    else if (action === 'saveTeams') {
      db.teams = req.teams || [];
    }
    else if (action === 'clearGroups') {
      db.groups = { A:{}, B:{}, C:{}, D:{} };
      db.brackets = {};
      db.teams = [];
    }
    else if (action === 'clearAll') {
      const url = db.settings.scriptURL;
      const fresh = defaultDB();
      fresh.settings.scriptURL = url;
      writeDB(fresh);
      return respond({ ok: true });
    }
    else if (action === 'recoverNoms') {
      // Recover local noms to server without overwriting existing
      const incoming = req.noms || [];
      const existingCPFs = new Set(db.noms.map(n => n.cpf.replace(/\D/g,'')));
      for (const nom of incoming) {
        const c = nom.cpf.replace(/\D/g,'');
        if (!existingCPFs.has(c)) {
          nom.id = db.nid++;
          db.noms.push(nom);
          existingCPFs.add(c);
        }
      }
    }
    else {
      return respond({ ok: false, error: 'Unknown action: ' + action });
    }

    writeDB(db);
    return respond({ ok: true });

  } catch(err) {
    return respond({ ok: false, error: err.toString() });
  }
}

// POST not used but kept for compatibility
function doPost(e) {
  return respond({ ok: false, error: 'Use GET requests only' });
}

// ── GOOGLE FORM SYNC ──────────────────────────────────
function syncFormResponses() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const formSh = ss.getSheets().find(s =>
    s.getName().toLowerCase().includes('form response') ||
    s.getName().toLowerCase().includes('respostas')
  );
  if (!formSh) return { ok: false, msg: 'No Form Responses sheet found.' };

  const db = readDB();
  const rows = formSh.getDataRange().getValues();
  if (rows.length < 2) return { ok: true, synced: 0 };

  const hdrs = rows[0].map(h => h.toString().toLowerCase());
  const cpfIdx    = hdrs.findIndex(h => h.includes('cpf'));
  const nameIdx   = hdrs.findIndex(h => h.includes('name') || h.includes('nome'));
  const ageIdx    = hdrs.findIndex(h => h.includes('age')  || h.includes('idade'));
  const genderIdx = hdrs.findIndex(h => h.includes('gender') || h.includes('sexo'));

  if ([cpfIdx, nameIdx, ageIdx, genderIdx].some(i => i < 0))
    return { ok: false, msg: 'Columns not detected. Headers: ' + hdrs.join(', ') };

  const existingCPFs = new Set(db.noms.map(n => n.cpf.replace(/\D/g,'')));
  let synced = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawCPF = String(row[cpfIdx]||'').replace(/\D/g,'');
    if (!rawCPF || existingCPFs.has(rawCPF)) continue;
    const name   = String(row[nameIdx]||'').trim();
    const age    = parseInt(String(row[ageIdx]||'0'))||0;
    const gender = String(row[genderIdx]||'').trim();
    if (!name || !age) continue;
    const male = gender.toLowerCase().startsWith('m');
    const cat  = male ? (age>=45?'M45P':'M45') : (age>=45?'F45P':'F45');
    db.noms.push({ id:db.nid++, cpf:rawCPF, name, age, gender, cat,
      status:'pending', ts:new Date().toISOString(), source:'form' });
    existingCPFs.add(rawCPF);
    synced++;
  }
  writeDB(db);
  return { ok: true, synced };
}
