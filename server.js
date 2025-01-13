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
        `, (err) => {
            if (err) console.error("Error creating table:", err.message);
            else console.log("Table created or already exists.");
        });
    }
});

function parseOCRText(ocrText) {
    const lines = ocrText.split('\n').map((line) => line.trim()).filter(Boolean);

    if (/^member\s*name\s*lv\.\d/i.test(lines[0])) {
        lines.shift();
    }

    const regex = /^([\w\sА-Яа-яёЁ'.-]+)\s+(\d+)(?:\(\+\d*\))?\s+(\d+)(?:\(\+\d*\))?\s+(\d+)(?:\(\+\d*\))?\s+(\d+)(?:\(\+\d*\))?\s+(\d+)(?:\(\+\d*\))?\s+(\d+)(?:\(\+\d*\))?$/;

    const structuredData = [];
    lines.forEach((line) => {
        const match = regex.exec(line);
        if (match) {
            structuredData.push({
                member_name: match[1].trim(),
                lv1: parseInt(match[2], 10),
                lv2: parseInt(match[3], 10),
                lv3: parseInt(match[4], 10),
                lv4: parseInt(match[5], 10),
                lv5: parseInt(match[6], 10),
                lv6: parseInt(match[7], 10),
            });
        }
    });

    console.log("Parsed Member Names:", structuredData.map((data) => data.member_name));
    return structuredData;
}

// Endpoint to extract text from OCR
app.post('/extract-text', (req, res) => {
    const { ocrText } = req.body;
    const structuredData = parseOCRText(ocrText);

    if (structuredData.length === 0) {
        return res.status(400).send("No valid OCR data found.");
    }

    res.json(structuredData);
});

// Endpoint to save manually reviewed data to the database
app.post('/save-manual-data', (req, res) => {
    const { data } = req.body;

    if (!data || data.length === 0) {
        return res.status(400).send("No data provided.");
    }

    const insertStmt = db.prepare(`
        INSERT INTO weekly_snapshots (member_name, lv1, lv2, lv3, lv4, lv5, lv6, week_number, month, year)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    data.forEach((entry) => {
        if (!entry.year || !entry.month) {
            return res.status(400).send("Invalid time period data.");
        }
        insertStmt.run(
            entry.member_name,
            entry.lv1,
            entry.lv2,
            entry.lv3,
            entry.lv4,
            entry.lv5,
            entry.lv6,
            entry.week || null,
            entry.month,
            entry.year
        );
    });

    insertStmt.finalize((err) => {
        if (err) {
            console.error("Error saving data:", err.message);
            return res.status(500).send("Error saving data.");
        }
        res.send("Data saved successfully!");
    });
});

// Endpoint to fetch all weekly snapshots with optional status filter
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

// Endpoint to rename member (update all historical entries)
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

// Endpoint to fetch unique member names for the admin table
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

// Endpoint to retire member (flag member as "retired")
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

// Endpoint to update member status
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

// Endpoint to fetch difference report based on two selected periods
app.get('/report', (req, res) => {
    const { year1, month1, week1, year2, month2, week2 } = req.query;

    console.log("Request Parameters:", { year1, month1, week1, year2, month2, week2 });

    const query = `
        SELECT member_name, SUM(lv1) AS lv1, SUM(lv2) AS lv2, SUM(lv3) AS lv3, SUM(lv4) AS lv4,
               SUM(lv5) AS lv5, SUM(lv6) AS lv6, year, month, COALESCE(week_number, 'all') AS week_number
        FROM weekly_snapshots
        WHERE (year = ? AND month = ? AND (week_number IS NULL OR ? IS NOT NULL))
           OR (year = ? AND month = ? AND (week_number IS NULL OR ? IS NOT NULL))
        GROUP BY member_name, year, month
    `;

    const params = [
        year1, month1, week1 ? parseInt(week1, 10) : null,
        year2, month2, week2 ? parseInt(week2, 10) : null
    ];

    console.log("Query Parameters:", params);

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Database Error:', err);
            return res.status(500).send('Error fetching report data.');
        }

        console.log("Fetched Data Rows:", rows);

        const report = {};
        rows.forEach((entry) => {
            const key = `${entry.year}-${entry.month}-${entry.week_number}`;
            if (!report[entry.member_name]) report[entry.member_name] = { period1: {}, period2: {} };

            if (key === `${year1}-${month1}-${week1 || 'all'}`) {
                report[entry.member_name].period1 = entry;
            } else {
                report[entry.member_name].period2 = entry;
            }
        });

        const analysis = Object.entries(report).map(([member_name, data]) => {
            const lv5Diff = ((data.period2.lv5 || 0) - (data.period1.lv5 || 0));
            const lv6Diff = ((data.period2.lv6 || 0) - (data.period1.lv6 || 0));
            const totalDifference = lv5Diff + lv6Diff;

            return {
                member_name,
                lv5Diff,
                lv6Diff,
                totalDifference
            };
        });

        console.log("Final Analysis Data:", analysis);
        res.json(analysis);
    });
});



// Endpoint to fetch distinct periods (week, month, year) for dropdown
app.get('/available-periods', (req, res) => {
    const query = `
        SELECT DISTINCT week_number, month, year
        FROM weekly_snapshots
        ORDER BY year DESC, month DESC, week_number DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            res.status(500).send('Error fetching available periods.');
        } else {
            res.json(rows);
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
