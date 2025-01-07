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
                week_number INTEGER,
                month INTEGER,
                year INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'active'
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
    const { data } = req.body;  // Data array containing member data with week, month, and year

    const insertStmt = db.prepare(`
        INSERT INTO weekly_snapshots (member_name, lv1, lv2, lv3, lv4, lv5, lv6, week_number, month, year)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    data.forEach((entry) => {
        insertStmt.run(
            entry.member_name,
            entry.lv1,
            entry.lv2,
            entry.lv3,
            entry.lv4,
            entry.lv5,
            entry.lv6,
            entry.week || null,  // Handle optional week
            entry.month || null,
            entry.year || null
        );
    });

    insertStmt.finalize();
    res.send("Data saved successfully!");
});
app.get('/fetch-weekly-snapshots', (req, res) => {
    const { status } = req.query;

    let query = 'SELECT * FROM weekly_snapshots';
    const params = [];

    if (status && status !== 'all') {
        query += ' WHERE status = ?';
        params.push(status);
    }

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).send("Error fetching data");
        } else {
            res.json(rows);
        }
    });
});


// Rename member (update all historical entries)
app.post('/rename-member', (req, res) => {
    const { selectedMembers, newName } = req.body;
    if (!selectedMembers || selectedMembers.length !== 1 || !newName) {
        return res.status(400).send('Invalid request.');
    }
    db.run(`UPDATE weekly_snapshots SET member_name = ? WHERE member_name = ?`, [newName, selectedMembers[0]], (err) => {
        if (err) return res.status(500).send('Error renaming member.');
        res.send('Member renamed successfully.');
    });
});
app.get('/fetch-unique-members', (req, res) => {
    const query = `
        SELECT DISTINCT member_name, status FROM weekly_snapshots ORDER BY member_name ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            res.status(500).send("Error fetching unique member names");
        } else {
            res.json(rows);
        }
    });
});

// Retire member (flag or remove all entries for a member)
app.post('/retire-member', (req, res) => {
    const { selectedMembers } = req.body;

    if (!selectedMembers || selectedMembers.length === 0) {
        return res.status(400).send('Invalid request.');
    }

    const placeholders = selectedMembers.map(() => '?').join(', ');
    const query = `DELETE FROM weekly_snapshots WHERE member_name IN (${placeholders})`;

    db.run(query, selectedMembers, (err) => {
        if (err) {
            res.status(500).send('Error retiring members.');
        } else {
            res.send('Members retired successfully.');
        }
    });
});
app.post('/update-member-status', (req, res) => {
    const { selectedMembers, newStatus } = req.body;
    if (!selectedMembers || selectedMembers.length !== 1 || !newStatus) {
        return res.status(400).send('Invalid request.');
    }
    db.run(`UPDATE weekly_snapshots SET status = ? WHERE member_name = ?`, [newStatus, selectedMembers[0]], (err) => {
        if (err) return res.status(500).send('Error updating status.');
        res.send('Member status updated successfully.');
    });
});


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
