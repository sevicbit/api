const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());

/* ---- DATABASE IN MEMORY ---- */
const raws = {}; 
// structure: raws[id] = { code: "..." }

/* ---- API: CREATE RAW ---- */
app.post("/api/create", (req, res) => {
    const { code } = req.body;
    if (!code) return res.json({ error: "No code provided." });

    const id = crypto.randomBytes(8).toString("hex"); // random API
    raws[id] = { code };

    res.json({
        url: `/raw/${id}`
    });
});

/* ---- SERVE RAW ---- */
app.get("/raw/:id", (req, res) => {
    const id = req.params.id;

    if (!raws[id]) return res.status(404).send("Invalid raw id.");

    // Detect if Roblox HttpGet is requesting
    const ua = req.headers["user-agent"] || "";

    const isRoblox =
        ua.includes("Roblox") ||
        ua.includes("HttpService") ||
        ua.includes("Game") ||
        ua === ""; 

    if (isRoblox) {
        // return REAL CODE for loadstring(game:HttpGet(...))
        res.setHeader("Content-Type", "text/plain");
        return res.send(raws[id].code);
    }

    // User visited in browser → BLOCK
    res.setHeader("Content-Type", "text/plain");
    res.send("ANO SKID PA?");
});

/* ---- SERVER START ---- */
app.listen(3000, () => {
    console.log("Server running on port 3000");
});
