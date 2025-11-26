const express = require("express");
const crypto = require("crypto");
const app = express();
app.use(express.json());

const storage = {}; // store raw codes and passwords

// ---- CREATE RAW LINK ----
app.post("/api/create", (req, res) => {
    const { code } = req.body;

    if (!code) return res.status(400).json({ error: "No code provided" });

    const id = crypto.randomBytes(8).toString("hex");
    const password = crypto.randomBytes(3).toString("hex"); // random 6 char password

    storage[id] = { code, password };

    res.json({
        url: `/api/raw/${id}`,
        password: password
    });
});

// ---- RAW LINK ENDPOINT ----
app.get("/api/raw/:id", (req, res) => {
    const { id } = req.params;

    if (!storage[id]) return res.status(404).send("Not found");

    const header = req.headers["x-access"];
    const pass = req.headers["x-pass"]; // password header

    // Only requests WITH header AND correct password get real code
    if (header === "allowed" && pass === storage[id].password) {
        res.type("text/plain");
        return res.send(storage[id].code);
    }

    // Normal browser view
    res.type("text/plain");
    res.send("ANO SKID PA?");
});

app.use(express.static(".")); // serve index.html

app.listen(3000, () => console.log("Server running on port 3000"));
