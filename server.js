const express    = require("express");
const mongoose   = require("mongoose");
const cors       = require("cors");
require("dotenv").config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

// ─── Connect to MongoDB ───────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => { console.error("MongoDB connection error:", err); process.exit(1); });

// ─── Schema ───────────────────────────────────────────────────────────────────
const participantSchema = new mongoose.Schema({
  studentId: { type: String, required: true, unique: true },

  // Per-mode results — null until that mode is completed
  number: {
    loginTimeMs: Number,
    errorCount:  Number,
    completedAt: Date,
  },
  emoji: {
    loginTimeMs: Number,
    errorCount:  Number,
    completedAt: Date,
  },
  mixed: {
    loginTimeMs: Number,
    errorCount:  Number,
    completedAt: Date,
  },

  // Survey answers — null until submitted
  survey: {
    usedEmojiInputBefore: Boolean,
    intuitiveness:        Number,   // 1–5
    ageRange:             String,
    submittedAt:          Date,
  },

  createdAt: { type: Date, default: Date.now },
});

const Participant = mongoose.model("Participant", participantSchema);

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/result  — save one mode result
// Body: { studentId, mode, loginTimeMs, errorCount }
app.post("/api/result", async (req, res) => {
  const { studentId, mode, loginTimeMs, errorCount } = req.body;

  if (!studentId || !mode || loginTimeMs == null || errorCount == null) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (!["number", "emoji", "mixed"].includes(mode)) {
    return res.status(400).json({ error: "Invalid mode" });
  }

  try {
    const update = {
      [mode]: { loginTimeMs, errorCount, completedAt: new Date() },
    };

    const participant = await Participant.findOneAndUpdate(
      { studentId },
      { $set: update },
      { upsert: true, new: true }
    );

    res.json({ ok: true, participant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/survey  — save survey answers
// Body: { studentId, usedEmojiInputBefore, intuitiveness, ageRange }
app.post("/api/survey", async (req, res) => {
  const { studentId, usedEmojiInputBefore, intuitiveness, ageRange } = req.body;

  if (!studentId || usedEmojiInputBefore == null || !intuitiveness || !ageRange) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const participant = await Participant.findOneAndUpdate(
      { studentId },
      {
        $set: {
          survey: {
            usedEmojiInputBefore,
            intuitiveness,
            ageRange,
            submittedAt: new Date(),
          },
        },
      },
      { upsert: true, new: true }
    );

    res.json({ ok: true, participant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/stats  — aggregated results for analysis
app.get("/api/stats", async (req, res) => {
  try {
    const stats = await Participant.aggregate([
      {
        $group: {
          _id: null,
          // Number mode
          avgNumberTime:   { $avg: "$number.loginTimeMs" },
          avgNumberErrors: { $avg: "$number.errorCount" },
          // Emoji mode
          avgEmojiTime:    { $avg: "$emoji.loginTimeMs" },
          avgEmojiErrors:  { $avg: "$emoji.errorCount" },
          // Mixed mode
          avgMixedTime:    { $avg: "$mixed.loginTimeMs" },
          avgMixedErrors:  { $avg: "$mixed.errorCount" },
          // Totals
          totalParticipants: { $sum: 1 },
          // Survey
          avgIntuitiveness: { $avg: "$survey.intuitiveness" },
        },
      },
    ]);

    // Per-participant data for median calculation
    const all = await Participant.find(
      {},
      { studentId: 0, __v: 0 }
    ).lean();

    res.json({ summary: stats[0] || {}, participants: all });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));