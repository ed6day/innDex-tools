const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure db directory exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'innDex.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name           TEXT NOT NULL,
    project_code           TEXT NOT NULL UNIQUE,
    inndex_id              TEXT NOT NULL,
    inndex_project_name    TEXT NOT NULL,
    created_at             TEXT DEFAULT (datetime('now')),
    updated_at             TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rams_signups (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    person_name             TEXT,
    person_name_key         TEXT,
    matched_site_name       TEXT,
    match_method            TEXT,
    job_role                TEXT,
    employer                TEXT,
    attendance_source_type  TEXT,
    attendance_date         TEXT,
    rams_title              TEXT,
    rams_title_key          TEXT,
    document_number         TEXT,
    revision                TEXT,
    revision_key            TEXT,
    briefed_by              TEXT,
    briefing_date_time      TEXT,
    review_status           TEXT,
    source_file             TEXT,
    project_tag             TEXT,
    completeness_score      INTEGER DEFAULT 0,
    created_at              TEXT    DEFAULT (datetime('now')),
    updated_at              TEXT    DEFAULT (datetime('now')),
    UNIQUE(person_name_key, rams_title_key, revision_key, briefing_date_time)
  );

  CREATE TABLE IF NOT EXISTS safe_starts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    safe_start_no       TEXT,
    date                TEXT,
    time                TEXT,
    project             TEXT,
    project_key         TEXT,
    employer            TEXT,
    submitted_by        TEXT,
    discussion_points   TEXT,
    outcomes            TEXT,
    attendee_count      INTEGER,
    confidence          TEXT,
    notes               TEXT,
    source_file         TEXT,
    completeness_score  INTEGER DEFAULT 0,
    created_at          TEXT    DEFAULT (datetime('now')),
    updated_at          TEXT    DEFAULT (datetime('now')),
    UNIQUE(safe_start_no, date, project_key)
  );

  CREATE TABLE IF NOT EXISTS safe_start_register (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    safe_start_no       TEXT,
    date                TEXT,
    project             TEXT,
    project_key         TEXT,
    person_name         TEXT,
    person_name_key     TEXT,
    employer            TEXT,
    matched_to_excel    TEXT,
    completeness_score  INTEGER DEFAULT 0,
    created_at          TEXT    DEFAULT (datetime('now')),
    updated_at          TEXT    DEFAULT (datetime('now')),
    UNIQUE(safe_start_no, date, project_key, person_name_key)
  );

  CREATE TABLE IF NOT EXISTS rams_register (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    document_number        TEXT,
    document_number_key   TEXT,
    rams_title              TEXT,
    rams_title_key         TEXT,
    revision                TEXT,
    revision_key           TEXT,
    company                 TEXT,
    uploaded_by             TEXT,
    uploaded_date           TEXT,
    status                  TEXT,
    archived                TEXT,
    approved_by             TEXT,
    approved_by_date       TEXT,
    people_signed_up       INTEGER,
    number_of_briefings    INTEGER,
    date_first_briefed     TEXT,
    date_last_briefed      TEXT,
    referenced_from_files  TEXT,
    doc_key                 TEXT NOT NULL UNIQUE,

    project_id              INTEGER,
    project_name            TEXT,
    project_code            TEXT,
    inndex_id               TEXT,
    inndex_project_name    TEXT,

    completeness_score      INTEGER DEFAULT 0,
    created_at              TEXT    DEFAULT (datetime('now')),
    updated_at              TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS safe_start_attendance (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    date                    TEXT,
    project                 TEXT,
    project_key             TEXT,
    name                    TEXT,
    name_key                TEXT,
    company                 TEXT,
    job_role                TEXT,
    in_time                 TEXT,
    out_time                TEXT,
    safe_start_count       INTEGER,
    matched_safe_start_nos TEXT,
    matched_employers      TEXT,
    match_method            TEXT,
    inn_dex_id              TEXT,

    attendance_key          TEXT NOT NULL UNIQUE,

    project_id              INTEGER,
    project_name            TEXT,
    project_code            TEXT,
    inndex_id               TEXT,
    inndex_project_name    TEXT,

    completeness_score      INTEGER DEFAULT 0,
    created_at              TEXT    DEFAULT (datetime('now')),
    updated_at              TEXT    DEFAULT (datetime('now'))
  );
`);

function ensureColumn(tableName, columnName, columnType) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!cols.some(c => c.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}

['project_id', 'project_name', 'project_code', 'inndex_id', 'inndex_project_name'].forEach(col => {
  ensureColumn('rams_signups', col, col === 'project_id' ? 'INTEGER' : 'TEXT');
  ensureColumn('safe_starts', col, col === 'project_id' ? 'INTEGER' : 'TEXT');
  ensureColumn('safe_start_register', col, col === 'project_id' ? 'INTEGER' : 'TEXT');
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeCompleteness(obj) {
  return Object.values(obj).filter(v => v !== null && v !== undefined && v !== '').length;
}

function parseFlexibleDate(textValue) {
  const text = String(textValue || '').trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = text.match(/(\d{1,2})[\/\-](\d{1,2}|[A-Za-z]{3})[\/\-](\d{2,4})/);
  if (!m) return null;
  let day = Number(m[1]);
  let month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (Number.isNaN(month)) {
    const map = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    month = map[String(m[2]).slice(0, 3).toLowerCase()];
  }
  if (!day || !month || !year) return null;
  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [
    headers.map(esc).join(','),
    ...rows.map(r => headers.map(h => esc(r[h])).join(','))
  ].join('\n');
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Serve top-level homepage and keep the existing hub available at /hub.
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/hub', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── RAMS endpoints ───────────────────────────────────────────────────────────

const stmtRamsSelect = db.prepare(
  'SELECT id, completeness_score FROM rams_signups WHERE person_name_key=? AND rams_title_key=? AND revision_key=? AND briefing_date_time=?'
);
const stmtRamsInsert = db.prepare(`
  INSERT INTO rams_signups
    (person_name, person_name_key, matched_site_name, match_method, job_role, employer,
     attendance_source_type, attendance_date, rams_title, rams_title_key, document_number,
     revision, revision_key, briefed_by, briefing_date_time, review_status, source_file,
     project_tag, project_id, project_name, project_code, inndex_id, inndex_project_name, completeness_score)
  VALUES
    (@person_name,@person_name_key,@matched_site_name,@match_method,@job_role,@employer,
     @attendance_source_type,@attendance_date,@rams_title,@rams_title_key,@document_number,
     @revision,@revision_key,@briefed_by,@briefing_date_time,@review_status,@source_file,
     @project_tag,@project_id,@project_name,@project_code,@inndex_id,@inndex_project_name,@completeness_score)
`);
const stmtRamsUpdate = db.prepare(`
  UPDATE rams_signups SET
    person_name=@person_name, matched_site_name=@matched_site_name, match_method=@match_method,
    job_role=@job_role, employer=@employer, attendance_source_type=@attendance_source_type,
    attendance_date=@attendance_date, rams_title=@rams_title, document_number=@document_number,
    revision=@revision, briefed_by=@briefed_by, review_status=@review_status,
    source_file=@source_file, project_tag=@project_tag,
    project_id=@project_id, project_name=@project_name, project_code=@project_code,
    inndex_id=@inndex_id, inndex_project_name=@inndex_project_name,
    completeness_score=@completeness_score, updated_at=datetime('now')
  WHERE id=@id
`);

const stmtRamsRegisterSelect = db.prepare(
  'SELECT id, completeness_score FROM rams_register WHERE doc_key=?'
);
const stmtRamsRegisterInsert = db.prepare(`
  INSERT INTO rams_register
    (document_number, document_number_key, rams_title, rams_title_key, revision, revision_key,
     company, uploaded_by, uploaded_date, status, archived, approved_by, approved_by_date,
     people_signed_up, number_of_briefings, date_first_briefed, date_last_briefed, referenced_from_files,
     doc_key,
     project_id, project_name, project_code, inndex_id, inndex_project_name,
     completeness_score)
  VALUES
    (@document_number,@document_number_key,@rams_title,@rams_title_key,@revision,@revision_key,
     @company,@uploaded_by,@uploaded_date,@status,@archived,@approved_by,@approved_by_date,
     @people_signed_up,@number_of_briefings,@date_first_briefed,@date_last_briefed,@referenced_from_files,
     @doc_key,
     @project_id,@project_name,@project_code,@inndex_id,@inndex_project_name,
     @completeness_score)
`);
const stmtRamsRegisterUpdate = db.prepare(`
  UPDATE rams_register SET
    document_number=@document_number, document_number_key=@document_number_key, rams_title=@rams_title,
    rams_title_key=@rams_title_key, revision=@revision, revision_key=@revision_key,
    company=@company, uploaded_by=@uploaded_by, uploaded_date=@uploaded_date, status=@status, archived=@archived,
    approved_by=@approved_by, approved_by_date=@approved_by_date,
    people_signed_up=@people_signed_up, number_of_briefings=@number_of_briefings,
    date_first_briefed=@date_first_briefed, date_last_briefed=@date_last_briefed,
    referenced_from_files=@referenced_from_files,
    project_id=@project_id, project_name=@project_name, project_code=@project_code,
    inndex_id=@inndex_id, inndex_project_name=@inndex_project_name,
    completeness_score=@completeness_score, updated_at=datetime('now')
  WHERE id=@id
`);

app.post('/api/rams/save', (req, res) => {
  try {
    const { records = [], registerRows = [], projectTag = '', project = null } = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ error: 'records must be an array' });
    if (!Array.isArray(registerRows)) return res.status(400).json({ error: 'registerRows must be an array' });

    let inserted = 0, updated = 0, skipped = 0;
    let regInserted = 0, regUpdated = 0, regSkipped = 0;

    const upsertAll = db.transaction(() => {
      for (const r of records) {
        const personNameKey   = normalizeKey(r['Person Name']       || '');
        const ramsTitleKey    = normalizeKey(r['RAMS Title']         || r['Document Number'] || '');
        const revisionKey     = normalizeKey(r['Revision']           || '');
        const briefingDT      = String(r['Briefing Date Time']       || '').trim().toLowerCase();

        if (!personNameKey || !ramsTitleKey) { skipped++; continue; }

        const data = {
          person_name:            r['Person Name']             || '',
          person_name_key:        personNameKey,
          matched_site_name:      r['Matched Site Name']       || '',
          match_method:           r['Match Method']            || '',
          job_role:               r['Job Role']                || '',
          employer:               r['Employer']                || '',
          attendance_source_type: r['Attendance Source Type']  || '',
          attendance_date:        r['Attendance Date']         || '',
          rams_title:             r['RAMS Title']              || '',
          rams_title_key:         ramsTitleKey,
          document_number:        r['Document Number']         || '',
          revision:               r['Revision']                || '',
          revision_key:           revisionKey,
          briefed_by:             r['Briefed By']              || '',
          briefing_date_time:     briefingDT,
          // Review status is derived at query/export time using the selected cutoff date.
          review_status:          '',
          source_file:            r['Source File']             || '',
          project_tag:            projectTag,
          project_id:             project?.id ?? null,
          project_name:           project?.project_name || '',
          project_code:           project?.project_code || '',
          inndex_id:              project?.inndex_id || '',
          inndex_project_name:    project?.inndex_project_name || '',
          completeness_score:     0,
        };
        data.completeness_score = computeCompleteness(data);

        const existing = stmtRamsSelect.get(personNameKey, ramsTitleKey, revisionKey, briefingDT);
        if (!existing) {
          stmtRamsInsert.run(data);
          inserted++;
        } else if (data.completeness_score >= existing.completeness_score) {
          stmtRamsUpdate.run({ ...data, id: existing.id });
          updated++;
        } else {
          skipped++;
        }
      }

      for (const r of registerRows) {
        const documentNumber = r['Document Number'] || r.document_number || '';
        const ramsTitle = r['RAMS Title'] || r.rams_title || '';
        const revision = r['Revision'] || r.revision || '';

        const revisionKey = normalizeKey(revision);
        const documentKeyBase = normalizeKey(documentNumber || ramsTitle);
        const docKey = `${documentKeyBase}::${revisionKey}`;
        if (!documentKeyBase || !docKey) { regSkipped++; continue; }

        const data = {
          document_number: documentNumber || '',
          document_number_key: documentKeyBase,
          rams_title: ramsTitle || '',
          rams_title_key: normalizeKey(ramsTitle),
          revision: revision || '',
          revision_key: revisionKey,

          company: r['Company'] || r.company || '',
          uploaded_by: r['Uploaded By'] || r.uploaded_by || '',
          uploaded_date: r['Uploaded Date'] || r.uploaded_date || '',
          status: r['Status'] || r.status || '',
          archived: r['Archived'] || r.archived || '',
          approved_by: r['Approved By'] || r.approved_by || '',
          approved_by_date: r['Approved By Date'] || r.approved_by_date || '',

          people_signed_up: Number(r['People Signed Up']) || 0,
          number_of_briefings: Number(r['Number of Briefings']) || 0,
          date_first_briefed: r['Date First Briefed'] || r.date_first_briefed || '',
          date_last_briefed: r['Date Last Briefed'] || r.date_last_briefed || '',
          referenced_from_files: r['Referenced From Files'] || r.referenced_from_files || '',

          doc_key: docKey,

          project_id: project?.id ?? null,
          project_name: project?.project_name || '',
          project_code: project?.project_code || '',
          inndex_id: project?.inndex_id || '',
          inndex_project_name: project?.inndex_project_name || '',

          completeness_score: 0,
        };

        data.completeness_score = computeCompleteness(data);

        const existing = stmtRamsRegisterSelect.get(docKey);
        if (!existing) {
          stmtRamsRegisterInsert.run(data);
          regInserted++;
        } else if (data.completeness_score >= existing.completeness_score) {
          stmtRamsRegisterUpdate.run({ ...data, id: existing.id });
          regUpdated++;
        } else {
          regSkipped++;
        }
      }
    });

    upsertAll();
    res.json({
      inserted, updated, skipped, total: records.length,
      register: { inserted: regInserted, updated: regUpdated, skipped: regSkipped, total: registerRows.length }
    });
  } catch (err) {
    console.error('RAMS save error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rams/records', (req, res) => {
  try {
    const {
      view = 'signups',
      project,
      person,
      rams,
      q,
      revision,
      page = 1,
      pageSize = 100,
      reviewDate = '',
      reviewStatus = ''
    } = req.query;

    const conditions = [];
    const params = [];

    const table = view === 'register' ? 'rams_register' : 'rams_signups';

    if (project) {
      // Hub “project” filter (if used): match stored metadata or document title.
      if (view === 'register') {
        conditions.push("(project_name LIKE ? OR project_code LIKE ? OR rams_title LIKE ? OR document_number LIKE ?)");
        params.push(`%${project}%`, `%${project}%`, `%${project}%`, `%${project}%`);
      } else {
        conditions.push("(project_tag LIKE ? OR project_name LIKE ? OR project_code LIKE ? OR rams_title LIKE ? OR document_number LIKE ?)");
        params.push(`%${project}%`, `%${project}%`, `%${project}%`, `%${project}%`, `%${project}%`);
      }
    }

    if (person && view === 'signups') {
      conditions.push("person_name LIKE ?");
      params.push(`%${person}%`);
    }

    if (rams) {
      conditions.push("rams_title LIKE ?");
      params.push(`%${rams}%`);
    }

    const search = String(q || '').trim();
    if (search) {
      if (view === 'register') {
        conditions.push(
          "(document_number LIKE ? OR rams_title LIKE ? OR revision LIKE ? OR company LIKE ? OR uploaded_by LIKE ? OR status LIKE ? OR approved_by LIKE ?)"
        );
        params.push(
          `%${search}%`,
          `%${search}%`,
          `%${search}%`,
          `%${search}%`,
          `%${search}%`,
          `%${search}%`,
          `%${search}%`
        );
      } else {
        conditions.push(
          "(person_name LIKE ? OR matched_site_name LIKE ? OR job_role LIKE ? OR employer LIKE ? OR attendance_source_type LIKE ? OR attendance_date LIKE ? OR rams_title LIKE ? OR document_number LIKE ? OR revision LIKE ?)"
        );
        params.push(
          `%${search}%`,
          `%${search}%`,
          `%${search}%`,
          `%${search}%`,
          `%${search}%`,
          `%${search}%`,
          `%${search}%`,
          `%${search}%`,
          `%${search}%`
        );
      }
    }

    const revisionFilter = String(revision || '').trim();
    if (revisionFilter) {
      conditions.push("revision LIKE ?");
      params.push(`%${revisionFilter}%`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const allRows = db.prepare(`SELECT * FROM ${table} ${where} ORDER BY updated_at DESC`).all(...params);
    const cutoff = parseFlexibleDate(reviewDate);

    const withStatus = allRows.map(r => {
      let status = 'In date';

      if (view === 'signups') {
        const briefing = parseFlexibleDate(r.briefing_date_time);
        if (briefing && cutoff) {
          // Compare dates (ignoring time component) for stable “expired vs in-date” behaviour.
          briefing.setHours(0, 0, 0, 0);
          const c = new Date(cutoff);
          c.setHours(0, 0, 0, 0);
          status = briefing < c ? 'Expired' : 'In date';
        }
        return { ...r, review_status: status };
      }

      // rams_register
      const isArchivedRow = /yes/i.test(String(r.archived || '')) || /archived/i.test(String(r.status || ''));
      if (!cutoff || isArchivedRow) {
        status = 'In date';
        return { ...r, review_status: status };
      }

      const cutoffEnd = new Date(cutoff);
      cutoffEnd.setHours(23, 59, 59, 999);

      const dateFields = [
        { key: 'uploaded_date', needsApproved: false, value: r.uploaded_date },
        { key: 'approved_by_date', needsApproved: false, value: r.approved_by_date },
        { key: 'date_first_briefed', needsApproved: true, value: r.date_first_briefed },
        { key: 'date_last_briefed', needsApproved: true, value: r.date_last_briefed },
      ];

      let expired = false;
      for (const f of dateFields) {
        if (f.needsApproved && !String(r.approved_by_date || '').trim()) continue;
        const dt = parseFlexibleDate(f.value);
        if (dt && dt < cutoffEnd) { expired = true; break; }
      }

      status = expired ? 'Expired' : 'In date';
      return { ...r, review_status: status };
    });

    const filteredByStatus =
      reviewStatus === 'expired' ? withStatus.filter(r => r.review_status === 'Expired') :
      reviewStatus === 'in' ? withStatus.filter(r => r.review_status === 'In date') :
      withStatus;

    const total = filteredByStatus.length;
    const offset = (Number(page) - 1) * Number(pageSize);
    const rows = filteredByStatus.slice(offset, offset + Number(pageSize));

    res.json({ rows, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (err) {
    console.error('RAMS records error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Safe Start endpoints ─────────────────────────────────────────────────────

const stmtSSSelect = db.prepare(
  'SELECT id, completeness_score FROM safe_starts WHERE safe_start_no=? AND date=? AND project_key=?'
);
const stmtSSInsert = db.prepare(`
  INSERT INTO safe_starts
    (safe_start_no, date, time, project, project_key, employer, submitted_by,
     discussion_points, outcomes, attendee_count, confidence, notes, source_file,
     project_id, project_name, project_code, inndex_id, inndex_project_name, completeness_score)
  VALUES
    (@safe_start_no,@date,@time,@project,@project_key,@employer,@submitted_by,
     @discussion_points,@outcomes,@attendee_count,@confidence,@notes,@source_file,
     @project_id,@project_name,@project_code,@inndex_id,@inndex_project_name,@completeness_score)
`);
const stmtSSUpdate = db.prepare(`
  UPDATE safe_starts SET
    time=@time, project=@project, employer=@employer, submitted_by=@submitted_by,
    discussion_points=@discussion_points, outcomes=@outcomes, attendee_count=@attendee_count,
    confidence=@confidence, notes=@notes, source_file=@source_file,
    project_id=@project_id, project_name=@project_name, project_code=@project_code,
    inndex_id=@inndex_id, inndex_project_name=@inndex_project_name,
    completeness_score=@completeness_score, updated_at=datetime('now')
  WHERE id=@id
`);

const stmtRegSelect = db.prepare(
  'SELECT id, completeness_score FROM safe_start_register WHERE safe_start_no=? AND date=? AND project_key=? AND person_name_key=?'
);
const stmtRegInsert = db.prepare(`
  INSERT INTO safe_start_register
    (safe_start_no, date, project, project_key, person_name, person_name_key, employer, matched_to_excel,
     project_id, project_name, project_code, inndex_id, inndex_project_name, completeness_score)
  VALUES
    (@safe_start_no,@date,@project,@project_key,@person_name,@person_name_key,@employer,@matched_to_excel,
     @project_id,@project_name,@project_code,@inndex_id,@inndex_project_name,@completeness_score)
`);
const stmtRegUpdate = db.prepare(`
  UPDATE safe_start_register SET
    project=@project, person_name=@person_name, employer=@employer,
    matched_to_excel=@matched_to_excel, completeness_score=@completeness_score,
    project_id=@project_id, project_name=@project_name, project_code=@project_code,
    inndex_id=@inndex_id, inndex_project_name=@inndex_project_name,
    updated_at=datetime('now')
  WHERE id=@id
`);

const stmtAttendanceSelect = db.prepare(
  'SELECT id, completeness_score FROM safe_start_attendance WHERE attendance_key=?'
);
const stmtAttendanceInsert = db.prepare(`
  INSERT INTO safe_start_attendance
    (date, project, project_key, name, name_key, company, job_role,
     in_time, out_time, safe_start_count, matched_safe_start_nos, matched_employers,
     match_method, inn_dex_id, attendance_key,
     project_id, project_name, project_code, inndex_id, inndex_project_name,
     completeness_score)
  VALUES
    (@date,@project,@project_key,@name,@name_key,@company,@job_role,
     @in_time,@out_time,@safe_start_count,@matched_safe_start_nos,@matched_employers,
     @match_method,@inn_dex_id,@attendance_key,
     @project_id,@project_name,@project_code,@inndex_id,@inndex_project_name,
     @completeness_score)
`);
const stmtAttendanceUpdate = db.prepare(`
  UPDATE safe_start_attendance SET
    project=@project, project_key=@project_key, name=@name, name_key=@name_key, company=@company, job_role=@job_role,
    in_time=@in_time, out_time=@out_time, safe_start_count=@safe_start_count,
    matched_safe_start_nos=@matched_safe_start_nos, matched_employers=@matched_employers,
    match_method=@match_method, inn_dex_id=@inn_dex_id,
    project_id=@project_id, project_name=@project_name, project_code=@project_code,
    inndex_id=@inndex_id, inndex_project_name=@inndex_project_name,
    completeness_score=@completeness_score, updated_at=datetime('now')
  WHERE id=@id
`);

function slugProject(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\(#.*?\)/g, '')
    .replace(/^\d+\s*-\s*/, '')
    .replace(/\s*:\s*.*$/, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

app.post('/api/safestart/save', (req, res) => {
  try {
    const { safeStarts = [], registerRows = [], attendanceComparison = [], project = null } = req.body;
    let ssInserted = 0, ssUpdated = 0, ssSkipped = 0;
    let regInserted = 0, regUpdated = 0, regSkipped = 0;
    let attInserted = 0, attUpdated = 0, attSkipped = 0;

    const upsertAll = db.transaction(() => {
      for (const s of safeStarts) {
        const no         = String(s.SafeStartNo || s.safe_start_no || '').trim();
        const date       = String(s.Date || s.date || '').trim();
        const projectKey = slugProject(s.Project || s.project || '');
        if (!date) { ssSkipped++; continue; }

        const data = {
          safe_start_no:      no,
          date,
          time:               s.Time             || '',
          project:            s.Project          || s.project || '',
          project_key:        projectKey,
          employer:           s.Employer         || '',
          submitted_by:       s.SubmittedBy      || '',
          discussion_points:  s.DiscussionPoints || '',
          outcomes:           s.Outcomes         || '',
          attendee_count:     Number(s.AttendeeCount) || 0,
          confidence:         s.Confidence       || '',
          notes:              Array.isArray(s.Notes) ? s.Notes.join(' | ') : (s.Notes || ''),
          source_file:        s.File             || s.source_file || '',
          project_id:         project?.id ?? null,
          project_name:       project?.project_name || '',
          project_code:       project?.project_code || '',
          inndex_id:          project?.inndex_id || '',
          inndex_project_name: project?.inndex_project_name || '',
          completeness_score: 0,
        };
        data.completeness_score = computeCompleteness(data);

        const existing = stmtSSSelect.get(no, date, projectKey);
        if (!existing) {
          stmtSSInsert.run(data);
          ssInserted++;
        } else if (data.completeness_score >= existing.completeness_score) {
          stmtSSUpdate.run({ ...data, id: existing.id });
          ssUpdated++;
        } else {
          ssSkipped++;
        }
      }

      for (const a of attendanceComparison) {
        const date = String(a.Date || a.date || '').trim();
        if (!date) { attSkipped++; continue; }

        const projectValue = String(a.Project || a.project || '');
        const projectKey = slugProject(projectValue);
        const name = String(a.Name || a.name || '');
        const nameKey = normalizeKey(a.NormalisedName || a.name_key || name || '');
        const inTime = String(a.InTime || a.in_time || '');
        const outTime = String(a.OutTime || a.out_time || '');

        const attendanceKey = `${date}::${projectKey}::${nameKey}::${inTime}::${outTime}`;
        if (!projectKey || !nameKey || !attendanceKey) { attSkipped++; continue; }

        const data = {
          date,
          project: projectValue,
          project_key: projectKey,
          name,
          name_key: nameKey,
          company: String(a.Company || a.company || ''),
          job_role: String(a.JobRole || a.job_role || ''),
          in_time: inTime,
          out_time: outTime,
          safe_start_count: Number(a.SafeStartCount || a.safe_start_count) || 0,
          matched_safe_start_nos: Array.isArray(a.MatchedSafeStartNos) ? a.MatchedSafeStartNos.join(', ') : String(a.MatchedSafeStartNos || ''),
          matched_employers: Array.isArray(a.MatchedEmployers) ? a.MatchedEmployers.join(', ') : String(a.MatchedEmployers || ''),
          match_method: String(a.MatchMethod || a.match_method || ''),
          inn_dex_id: String(a.InnDexID || a.inn_dex_id || ''),

          attendance_key: attendanceKey,

          project_id: project?.id ?? null,
          project_name: project?.project_name || '',
          project_code: project?.project_code || '',
          inndex_id: project?.inndex_id || '',
          inndex_project_name: project?.inndex_project_name || '',

          completeness_score: 0,
        };

        data.completeness_score = computeCompleteness(data);

        const existing = stmtAttendanceSelect.get(attendanceKey);
        if (!existing) {
          stmtAttendanceInsert.run(data);
          attInserted++;
        } else if (data.completeness_score >= existing.completeness_score) {
          stmtAttendanceUpdate.run({ ...data, id: existing.id });
          attUpdated++;
        } else {
          attSkipped++;
        }
      }

      for (const r of registerRows) {
        const no         = String(r.SafeStartNo || r.safe_start_no || '').trim();
        const date       = String(r.Date || r.date || '').trim();
        const projectValue = String(r.Project || r.project || '');
        const projectKey = slugProject(projectValue);
        const personKey  = normalizeKey(r.Name || r.person_name || '');
        if (!date || !personKey) { regSkipped++; continue; }

        const data = {
          safe_start_no:      no,
          date,
          project: projectValue,
          project_key:        projectKey,
          person_name:        r.Name             || r.person_name || '',
          person_name_key:    personKey,
          employer:           r.Employer         || '',
          matched_to_excel:   r.MatchedToExcel   || r.matched_to_excel || '',
          project_id:         project?.id ?? null,
          project_name:       project?.project_name || '',
          project_code:       project?.project_code || '',
          inndex_id:          project?.inndex_id || '',
          inndex_project_name: project?.inndex_project_name || '',
          completeness_score: 0,
        };
        data.completeness_score = computeCompleteness(data);

        const existing = stmtRegSelect.get(no, date, projectKey, personKey);
        if (!existing) {
          stmtRegInsert.run(data);
          regInserted++;
        } else if (data.completeness_score >= existing.completeness_score) {
          stmtRegUpdate.run({ ...data, id: existing.id });
          regUpdated++;
        } else {
          regSkipped++;
        }
      }
    });

    upsertAll();
    res.json({
      safeStarts:   { inserted: ssInserted,  updated: ssUpdated,  skipped: ssSkipped  },
      register:     { inserted: regInserted, updated: regUpdated, skipped: regSkipped },
      attendance:   { inserted: attInserted, updated: attUpdated, skipped: attSkipped },
    });
  } catch (err) {
    console.error('Safe Start save error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/safestart/records', (req, res) => {
  try {
    const { project, person, date, from, to, page = 1, pageSize = 100, view = 'safestarts', zeroOnly = '' } = req.query;
    const conditions = [];
    const params = [];

    const projectKey = project ? slugProject(project) : '';

    if (view === 'attendance') {
      if (projectKey) { conditions.push("project_key = ?"); params.push(projectKey); }
      if (date) { conditions.push("date = ?"); params.push(date); }
      if (from) { conditions.push("date >= ?"); params.push(from); }
      if (to) { conditions.push("date <= ?"); params.push(to); }
      if (String(zeroOnly) === '1' || String(zeroOnly).toLowerCase() === 'true') {
        conditions.push("safe_start_count = 0");
      }

      const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      const offset = (Number(page) - 1) * Number(pageSize);
      const rows   = db.prepare(`SELECT * FROM safe_start_attendance ${where} ORDER BY date DESC, project ASC LIMIT ? OFFSET ?`).all(...params, Number(pageSize), offset);
      const total  = db.prepare(`SELECT COUNT(*) as n FROM safe_start_attendance ${where}`).get(...params).n;
      return res.json({ rows, total, page: Number(page), pageSize: Number(pageSize) });
    }

    if (view === 'register') {
      if (projectKey) { conditions.push("project_key = ?"); params.push(projectKey); }
      if (person) { conditions.push("person_name LIKE ?"); params.push(`%${person}%`); }
      if (date) { conditions.push("date = ?"); params.push(date); }
      if (from) { conditions.push("date >= ?"); params.push(from); }
      if (to) { conditions.push("date <= ?"); params.push(to); }

      const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      const offset = (Number(page) - 1) * Number(pageSize);
      const rows   = db.prepare(`SELECT * FROM safe_start_register ${where} ORDER BY date DESC, project ASC LIMIT ? OFFSET ?`).all(...params, Number(pageSize), offset);
      const total  = db.prepare(`SELECT COUNT(*) as n FROM safe_start_register ${where}`).get(...params).n;
      return res.json({ rows, total, page: Number(page), pageSize: Number(pageSize) });
    }

    // default: safe starts header table
    if (projectKey) { conditions.push("project_key = ?"); params.push(projectKey); }
    if (date) { conditions.push("date = ?"); params.push(date); }
    if (from) { conditions.push("date >= ?"); params.push(from); }
    if (to) { conditions.push("date <= ?"); params.push(to); }

    const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (Number(page) - 1) * Number(pageSize);
    const rows   = db.prepare(`SELECT * FROM safe_starts ${where} ORDER BY date DESC, project ASC LIMIT ? OFFSET ?`).all(...params, Number(pageSize), offset);
    const total  = db.prepare(`SELECT COUNT(*) as n FROM safe_starts ${where}`).get(...params).n;
    res.json({ rows, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (err) {
    console.error('Safe Start records error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── DB stats endpoint ────────────────────────────────────────────────────────

app.get('/api/stats', (_req, res) => {
  try {
    const ramsCount = db.prepare('SELECT COUNT(*) as n FROM rams_signups').get().n;
    const ramsRegisterCount = db.prepare('SELECT COUNT(*) as n FROM rams_register').get().n;
    const ssCount   = db.prepare('SELECT COUNT(*) as n FROM safe_starts').get().n;
    const attendanceCount = db.prepare('SELECT COUNT(*) as n FROM safe_start_attendance').get().n;
    const regCount  = db.prepare('SELECT COUNT(*) as n FROM safe_start_register').get().n;
    const ramsLast  = db.prepare("SELECT MAX(updated_at) as t FROM rams_signups").get().t;
    const ramsRegLast = db.prepare("SELECT MAX(updated_at) as t FROM rams_register").get().t;
    const ssLast    = db.prepare("SELECT MAX(updated_at) as t FROM safe_starts").get().t;
    const attendanceLast = db.prepare("SELECT MAX(updated_at) as t FROM safe_start_attendance").get().t;
    const projectCount = db.prepare('SELECT COUNT(*) as n FROM projects').get().n;
    res.json({
      ramsSignups: ramsCount,
      ramsRegister: ramsRegisterCount,
      safeStarts: ssCount,
      safeStartAttendance: attendanceCount,
      safeStartRegister: regCount,
      projects: projectCount,
      ramsLastUpdated: ramsLast,
      ramsRegisterLastUpdated: ramsRegLast,
      ssLastUpdated: ssLast,
      safeStartAttendanceLastUpdated: attendanceLast
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper lists for hub dropdowns ──────────────────────────────────────

app.get('/api/safestart/dates', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT date FROM safe_starts WHERE date IS NOT NULL AND TRIM(date)!=''
      UNION
      SELECT DISTINCT date FROM safe_start_register WHERE date IS NOT NULL AND TRIM(date)!=''
      UNION
      SELECT DISTINCT date FROM safe_start_attendance WHERE date IS NOT NULL AND TRIM(date)!=''
      ORDER BY date DESC
    `).all();
    res.json({ dates: rows.map(r => r.date) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rams/revisions', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT revision FROM rams_signups WHERE revision IS NOT NULL AND TRIM(revision)!=''
      UNION
      SELECT DISTINCT revision FROM rams_register WHERE revision IS NOT NULL AND TRIM(revision)!=''
      ORDER BY revision ASC
    `).all();
    res.json({ revisions: rows.map(r => r.revision) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Projects endpoints ───────────────────────────────────────────────────────

app.get('/api/projects', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM projects ORDER BY project_name ASC').all();
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', (req, res) => {
  try {
    const { project_name, project_code, inndex_id, inndex_project_name } = req.body || {};
    if (!project_name || !project_code || !inndex_id || !inndex_project_name) {
      return res.status(400).json({ error: 'All project fields are required.' });
    }
    const stmt = db.prepare(`
      INSERT INTO projects (project_name, project_code, inndex_id, inndex_project_name)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(String(project_name).trim(), String(project_code).trim(), String(inndex_id).trim(), String(inndex_project_name).trim());
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
    res.json({ row });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(400).json({ error: 'Project code must be unique.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── Report export endpoint ───────────────────────────────────────────────────

app.get('/api/reports/export', (req, res) => {
  try {
    const { dataset = 'rams', format = 'csv' } = req.query;
    let rows = [];
    if (dataset === 'rams') {
      const q = String(req.query.q || '').trim();
      const revision = String(req.query.revision || '').trim();
      const project = String(req.query.project || '').trim();
      const reviewDate = String(req.query.reviewDate || '').trim();
      const reviewStatus = String(req.query.reviewStatus || '').trim();
      const conditions = [];
      const params = [];
      if (project) { conditions.push('(project_tag LIKE ? OR project_name LIKE ? OR project_code LIKE ?)'); params.push(`%${project}%`, `%${project}%`, `%${project}%`); }
      if (q) {
        conditions.push("(person_name LIKE ? OR matched_site_name LIKE ? OR job_role LIKE ? OR employer LIKE ? OR attendance_source_type LIKE ? OR attendance_date LIKE ? OR rams_title LIKE ? OR document_number LIKE ? OR revision LIKE ?)");
        params.push(...Array(9).fill(`%${q}%`));
      }
      if (revision) { conditions.push('revision LIKE ?'); params.push(`%${revision}%`); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const base = db.prepare(`SELECT * FROM rams_signups ${where} ORDER BY updated_at DESC`).all(...params);
      const cutoff = parseFlexibleDate(reviewDate);
      rows = base.map(r => {
        let status = 'Unknown';
        const briefing = parseFlexibleDate(r.briefing_date_time);
        if (briefing && cutoff) {
          briefing.setHours(0, 0, 0, 0);
          const c = new Date(cutoff);
          c.setHours(0, 0, 0, 0);
          status = briefing < c ? 'Expired' : 'In date';
        }
        return { ...r, computed_review_status: status };
      });
      if (reviewStatus === 'expired') rows = rows.filter(r => r.computed_review_status === 'Expired');
      if (reviewStatus === 'in') rows = rows.filter(r => r.computed_review_status === 'In date');
    } else if (dataset === 'rams_register') {
      const q = String(req.query.q || '').trim();
      const revision = String(req.query.revision || '').trim();
      const project = String(req.query.project || '').trim();
      const reviewDate = String(req.query.reviewDate || '').trim();
      const reviewStatus = String(req.query.reviewStatus || '').trim();

      const conditions = [];
      const params = [];

      if (project) {
        conditions.push("(project_name LIKE ? OR project_code LIKE ? OR inndex_id LIKE ?)");
        params.push(`%${project}%`, `%${project}%`, `%${project}%`);
      }
      if (q) {
        conditions.push("(document_number LIKE ? OR rams_title LIKE ? OR revision LIKE ? OR company LIKE ? OR uploaded_by LIKE ? OR status LIKE ? OR approved_by LIKE ?)");
        params.push(...Array(7).fill(`%${q}%`));
      }
      if (revision) { conditions.push('revision LIKE ?'); params.push(`%${revision}%`); }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const base = db.prepare(`SELECT * FROM rams_register ${where} ORDER BY updated_at DESC`).all(...params);

      const cutoff = parseFlexibleDate(reviewDate);
      rows = base.map(r => {
        const isArchivedRow = /yes/i.test(String(r.archived || '')) || /archived/i.test(String(r.status || ''));
        let status = 'In date';
        if (cutoff && !isArchivedRow) {
          const cutoffEnd = new Date(cutoff);
          cutoffEnd.setHours(23, 59, 59, 999);
          const dateFields = [
            { value: r.uploaded_date, needsApproved: false },
            { value: r.approved_by_date, needsApproved: false },
            { value: r.date_first_briefed, needsApproved: true },
            { value: r.date_last_briefed, needsApproved: true },
          ];
          let expired = false;
          for (const f of dateFields) {
            if (f.needsApproved && !String(r.approved_by_date || '').trim()) continue;
            const dt = parseFlexibleDate(f.value);
            if (dt && dt < cutoffEnd) { expired = true; break; }
          }
          status = expired ? 'Expired' : 'In date';
        }
        return { ...r, computed_review_status: status };
      });

      if (reviewStatus === 'expired') rows = rows.filter(r => r.computed_review_status === 'Expired');
      if (reviewStatus === 'in') rows = rows.filter(r => r.computed_review_status === 'In date');
    } else if (dataset === 'safe_starts') {
      const project = String(req.query.project || '').trim();
      const date = String(req.query.date || '').trim();
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      const conditions = [];
      const params = [];
      if (project) { conditions.push('project_key = ?'); params.push(slugProject(project)); }
      if (date) { conditions.push('date = ?'); params.push(date); }
      if (from) { conditions.push('date >= ?'); params.push(from); }
      if (to) { conditions.push('date <= ?'); params.push(to); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      rows = db.prepare(`SELECT * FROM safe_starts ${where} ORDER BY date DESC, project ASC`).all(...params);
    } else if (dataset === 'safe_start_register') {
      const project = String(req.query.project || '').trim();
      const date = String(req.query.date || '').trim();
      const person = String(req.query.person || '').trim();
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      const conditions = [];
      const params = [];
      if (project) { conditions.push('project_key = ?'); params.push(slugProject(project)); }
      if (person) { conditions.push('person_name LIKE ?'); params.push(`%${person}%`); }
      if (date) { conditions.push('date = ?'); params.push(date); }
      if (from) { conditions.push('date >= ?'); params.push(from); }
      if (to) { conditions.push('date <= ?'); params.push(to); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      rows = db.prepare(`SELECT * FROM safe_start_register ${where} ORDER BY date DESC, project ASC`).all(...params);
    } else if (dataset === 'safe_start_attendance') {
      const project = String(req.query.project || '').trim();
      const date = String(req.query.date || '').trim();
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      const zeroOnly = String(req.query.zeroOnly || '').trim();

      const conditions = [];
      const params = [];

      if (project) { conditions.push('project_key = ?'); params.push(slugProject(project)); }
      if (date) { conditions.push('date = ?'); params.push(date); }
      if (from) { conditions.push('date >= ?'); params.push(from); }
      if (to) { conditions.push('date <= ?'); params.push(to); }
      if (zeroOnly === '1' || zeroOnly.toLowerCase() === 'true') conditions.push('safe_start_count = 0');

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      rows = db.prepare(`SELECT * FROM safe_start_attendance ${where} ORDER BY date DESC, project ASC`).all(...params);
    } else {
      return res.status(400).json({ error: 'Unsupported dataset.' });
    }

    // Map DB fields to analyser-style CSV columns.
    if (dataset === 'rams') {
      rows = rows.map(r => ({
        'Person Name': r.person_name,
        'Matched Site Name': r.matched_site_name,
        'Match Method': r.match_method,
        'Job Role': r.job_role,
        'Employer': r.employer,
        'Attendance Source Type': r.attendance_source_type,
        'Attendance Date': r.attendance_date,
        'RAMS Title': r.rams_title,
        'Document Number': r.document_number,
        'Revision': r.revision,
        'Briefed By': r.briefed_by,
        'Briefing Date Time': r.briefing_date_time,
        'Review Status': r.computed_review_status,
        'Source File': r.source_file,
      }));
    } else if (dataset === 'rams_register') {
      rows = rows.map(r => ({
        'Document Number': r.document_number,
        'RAMS Title': r.rams_title,
        'Revision': r.revision,
        'Company': r.company,
        'Uploaded By': r.uploaded_by,
        'Uploaded Date': r.uploaded_date,
        'Status': r.status,
        'Archived': r.archived,
        'Approved By': r.approved_by,
        'Approved By Date': r.approved_by_date,
        'People Signed Up': r.people_signed_up,
        'Number of Briefings': r.number_of_briefings,
        'Date First Briefed': r.date_first_briefed,
        'Date Last Briefed': r.date_last_briefed,
        'Referenced From Files': r.referenced_from_files,
      }));
    } else if (dataset === 'safe_starts') {
      rows = rows.map(r => ({
        'File Name': r.source_file,
        'Safe Start No': r.safe_start_no,
        'Date': r.date,
        'Time': r.time,
        'Project': r.project,
        'Employer': r.employer,
        'Submitted By': r.submitted_by,
        'Attendee Count': r.attendee_count,
        'Confidence': r.confidence,
        'Notes': r.notes,
      }));
    } else if (dataset === 'safe_start_register') {
      rows = rows.map(r => ({
        'Date': r.date,
        'Project': r.project,
        'Safe Start No': r.safe_start_no,
        'Name': r.person_name,
        'Employer': r.employer,
        'Matched to Excel': r.matched_to_excel,
      }));
    } else if (dataset === 'safe_start_attendance') {
      rows = rows.map(r => ({
        'Date': r.date,
        'Project': r.project,
        'Name': r.name,
        'Company': r.company,
        'Job Role': r.job_role,
        'In Time': r.in_time,
        'Out Time': r.out_time,
        'Safe Starts Completed': r.safe_start_count,
        'Match Method': r.match_method,
      }));
    }

    if (format !== 'csv') return res.status(400).json({ error: 'Only csv format is supported.' });
    const csv = toCsv(rows);
    const filename = `${dataset}-report-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  console.log(`\n  innDex Tools running on port ${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  Network: http://${ip}:${PORT}`));
  console.log('');
});
