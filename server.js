const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./db/ocr-data.db', (err) => {
    if (err) {
        console.error("Error opening database: " + err.message);
    } else {
        db.run(`
            CREATE TABLE IF NOT EXISTS weekly_snapshots (
                snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_name TEXT,
                lv1 INTEGER,
                lv2 INTEGER,
                lv3 INTEGER,
                lv4 INTEGER,
                lv5 INTEGER,
                lv6 INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
});

function parseOCRText(ocrText) {
    const regex = /^(.+?)\s+(\d+)\(\+\d*\)\s+(\d+)\(\+\d*\)\s+(\d+)\(\+\d*\)\s+(\d+)\(\+\d*\)\s+(\d+)\(\+\d*\)\s+(\d+)\(\+\d*\)$/gm;

    const matches = [...ocrText.matchAll(regex)];
    const structuredData = matches.map((match) => ({
        member_name: match[1].trim(),
        lv1: parseInt(match[2], 10),
        lv2: parseInt(match[3], 10),
        lv3: parseInt(match[4], 10),
        lv4: parseInt(match[5], 10),
        lv5: parseInt(match[6], 10),
        lv6: parseInt(match[7], 10),
    }));

    console.log("Parsed Data:", structuredData);
    return structuredData;
}

app.post('/extract-text', (req, res) => {
    const { ocrText } = req.body;
    const structuredData = parseOCRText(ocrText);

    if (structuredData.length === 0) {
        return res.status(400).send("No valid OCR data found.");
    }

    res.json(structuredData);
});

app.post('/save-manual-data', (req, res) => {
    const { data } = req.body;

    const insertStmt = db.prepare(`
        INSERT INTO weekly_snapshots (member_name, lv1, lv2, lv3, lv4, lv5, lv6)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    data.forEach((entry) => {
        insertStmt.run(
            entry.member_name,
            entry.lv1,
            entry.lv2,
            entry.lv3,
            entry.lv4,
            entry.lv5,
            entry.lv6
        );
    });

    insertStmt.finalize();
    res.send("Data saved successfully!");
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
