# PME innDex Tools

Internal tooling hub for RAMS and Safe Start analysis. Runs as a lightweight local server so the whole team shares one database.

---

## What's included

| Tool | Description |
|---|---|
| **RAMS Analyser** | Matches RAMS sign-up records from Excel workbooks against site attendance files. |
| **Safe Start Analyser** | Parses Safe Start PDFs and compares attendees against an innDex time-management export. |
| **Records** | Browse, search and filter all previously saved analysis results from both tools. |

---

## One-time setup (on the host machine)

### 1 — Install Node.js
Download and install from **https://nodejs.org** (LTS version recommended).  
Accept all defaults during installation.

### 2 — Install dependencies
Open a terminal / command prompt in this folder and run:

```
npm install
```

This downloads Express and the SQLite driver (~5 MB). Only needed once.

### 3 — Start the server

```
node server.js
```

You will see output like:

```
  innDex Tools running on port 3000
  Local:   http://localhost:3000
  Network: http://192.168.1.45:3000
```

The server is now running. Keep this terminal open while the team is using the tools.

---

## Daily use

### On the host machine
Just run `node server.js` from this folder.

### On any team member's computer
Open a browser and go to:

```
http://[server-ip]:3000
```

Replace `[server-ip]` with the IP address shown in the terminal output (e.g. `192.168.1.45`).  
The server must be on the same network (office LAN / Wi-Fi) as the users.

---

## Using the tools

### RAMS Analyser
1. Upload site people Excel files and RAMS report Excel workbooks.
2. Optionally fill in the **Project / site tag** field — this label is stored with every record.
3. Click **Process files** to run the analysis.
4. Review results and quality checks.
5. Click **Save to Database** to persist the results. A green banner will confirm how many records were new, updated, or skipped (duplicates).
6. The existing **Export workbook** button still works as before.

### Safe Start Analyser
1. Upload an attendance Excel file and Safe Start PDFs.
2. Click **Process files** to run the analysis.
3. Click **Save to Database** to save Safe Start headers and the full attendee register.
4. The existing **Export workbook** and **Export quality checks** buttons still work.

### Records view
- Select **Records** in the left sidebar.
- Use the three sub-tabs: **RAMS Sign-ups**, **Safe Starts**, **Safe Start Register**.
- Type in the filter boxes and press **Search** (or press Enter).
- Pagination appears automatically for large result sets.

---

## Deduplication logic

When saving, the server checks for existing records using a unique key per table:

| Table | Unique key |
|---|---|
| RAMS sign-ups | Person name + RAMS title + Revision + Briefing date/time |
| Safe Starts | Safe Start No + Date + Project |
| Safe Start Register | Safe Start No + Date + Project + Person name |

- If the incoming record is **new** → it is inserted.
- If the record already exists and the **new version is equally or more complete** (more filled-in fields) → it is updated.
- If the record already exists and the incoming version is **less complete** → it is skipped, preserving the richer data.

---

## Database location

The database is a single file: `db/innDex.db`

This file is created automatically on first run. It can be backed up by simply copying the file.

---

## Changing the port

Set the `PORT` environment variable before starting:

```
PORT=8080 node server.js
```

Or on Windows:

```
set PORT=8080 && node server.js
```

---

## Starting automatically on Windows (optional)

To have the server start on boot without a terminal window:

1. Install **pm2**: `npm install -g pm2`
2. Start with pm2: `pm2 start server.js --name inndex-tools`
3. Save: `pm2 save`
4. Set startup: `pm2 startup`

---

## Folder structure

```
PME innDex Tools/
├── server.js          ← Express server + API + DB logic
├── package.json
├── README.md
├── db/
│   └── innDex.db      ← SQLite database (auto-created)
└── public/
    ├── index.html     ← Hub page (sidebar + Records view)
    ├── rams_analyser.html
    └── safe_start_analyser.html
```
