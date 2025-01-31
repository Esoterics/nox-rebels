const express = require("express");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// RU monitoring constants
const FREE_TIER_RU_LIMIT = 1000;
const RU_MONITORING_INTERVAL = 60000; // 1 minute
let currentRUConsumption = 0;
let lastResetTime = Date.now();

// Ensure the correct endpoint format in .env (without https://)
const mongoUri = `mongodb://${process.env.COSMOS_DATABASE}:${process.env.COSMOS_KEY}@${process.env.COSMOS_ENDPOINT}/?ssl=true&retryWrites=false&maxIdleTimeMS=120000`;

const client = new MongoClient(mongoUri);

let database, collection;

async function initializeMongoDB() {
    try {
        console.log("🔄 Connecting to Cosmos DB (MongoDB API)...");
        console.log("🔹 COSMOS_ENDPOINT:", process.env.COSMOS_ENDPOINT);
        console.log("🔹 COSMOS_DATABASE:", process.env.COSMOS_DATABASE);
        console.log("🔹 COSMOS_CONTAINER:", process.env.COSMOS_CONTAINER);

        await client.connect();
        database = client.db(process.env.COSMOS_DATABASE);
        collection = database.collection(process.env.COSMOS_CONTAINER);

        console.log(`✅ Connected to database '${process.env.COSMOS_DATABASE}' and collection '${process.env.COSMOS_CONTAINER}'.`);
    } catch (error) {
        console.error("❌ Error initializing MongoDB:", error);
        process.exit(1);
    }
}

// Start MongoDB Connection
initializeMongoDB();

// Function to Parse OCR Text
function parseOCRText(ocrText) {
    let lines = ocrText.split("\n").map((line) => line.trim()).filter(Boolean);

    if (/^member\s*name\s*lv\.\d/i.test(lines[0])) {
        lines.shift();
    }

    lines = lines.map((line) =>
        line.replace(/\s+/g, " ").replace(/\(\+\d+\)/g, "").replace(/Te\)/g, "0").trim()
    );

    console.log("Processed OCR Lines:", lines);

    const structuredData = [];

    lines.forEach((line) => {
        const regex = /^([\w\sА-Яа-яёЁ'.-]+?)\s*(?:\|\s*)?(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/;
        const match = regex.exec(line);

        if (match) {
            structuredData.push({
                id: `${match[1].trim()}_${Date.now()}`,
                member_name: match[1].trim(),
                lv1: parseInt(match[2], 10),
                lv2: parseInt(match[3], 10),
                lv3: parseInt(match[4], 10),
                lv4: parseInt(match[5], 10),
                lv5: parseInt(match[6], 10),
                lv6: parseInt(match[7], 10),
                timestamp: new Date(),
                status: "active",
            });
        } else {
            console.log("❌ No match for:", line);
        }
    });

    return structuredData;
}

// Endpoint to Extract Text (OCR)
app.post("/extract-text", async (req, res) => {
    const { ocrText } = req.body;
    const structuredData = parseOCRText(ocrText);

    if (structuredData.length === 0) {
        return res.status(400).send("No valid OCR data found.");
    }

    res.json(structuredData);
});

// Endpoint to Save Manually Reviewed Data
app.post("/save-manual-data", async (req, res) => {
    const { data } = req.body;

    if (!Array.isArray(data) || data.length === 0) {
        return res.status(400).send("Invalid data format.");
    }

    try {
        const result = await collection.insertMany(data);
        res.json({
            message: "Data saved successfully!",
            itemsSaved: result.insertedCount,
        });
    } catch (error) {
        console.error("❌ Error saving to MongoDB:", error);
        res.status(500).send("Error saving data.");
    }
});

// Endpoint to Get RU Usage Stats (for reference)
app.get("/ru-stats", (req, res) => {
    res.json({
        currentRUConsumption,
        limit: FREE_TIER_RU_LIMIT,
        lastResetTime: new Date(lastResetTime).toISOString(),
        nextResetIn: RU_MONITORING_INTERVAL - (Date.now() - lastResetTime),
        utilizationPercentage: (currentRUConsumption / FREE_TIER_RU_LIMIT) * 100,
    });
});

// Start Server
initializeMongoDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });
});

// Debug Logging
console.log("COSMOS_ENDPOINT:", process.env.COSMOS_ENDPOINT);
console.log("COSMOS_KEY:", process.env.COSMOS_KEY ? "✅ Key Loaded" : "❌ Key Missing");
console.log("COSMOS_DATABASE:", process.env.COSMOS_DATABASE);
console.log("COSMOS_CONTAINER:", process.env.COSMOS_CONTAINER);
