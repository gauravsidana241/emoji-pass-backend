const express    = require("express");
const mongoose   = require("mongoose");
const cors       = require("cors");
const bcrypt     = require("bcryptjs");
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
  passwords: {
    number: { type: String, default: null },
    emoji:  { type: String, default: null },
    mixed:  { type: String, default: null },
  },
  number: { loginTimeMs: Number, errorCount: Number, completedAt: Date },
  emoji:  { loginTimeMs: Number, errorCount: Number, completedAt: Date },
  mixed:  { loginTimeMs: Number, errorCount: Number, completedAt: Date },
  survey: {
    usedEmojiInputBefore: Boolean,
    intuitiveness:        Number,
    ageRange:             String,
    submittedAt:          Date,
  },
  createdAt: { type: Date, default: Date.now },
});

const Participant = mongoose.model("Participant", participantSchema);

// ─── GET /api/participant/:studentId ─────────────────────────────────────────
// Returns which modes the user has registered for and completed
app.get("/api/participant/:studentId", async (req, res) => {
  try {
    const participant = await Participant.findOne(
      { studentId: req.params.studentId },
      { passwords: 1, number: 1, emoji: 1, mixed: 1, survey: 1 }
    ).lean();

    if (!participant) return res.status(404).json({ error: "Not found" });

    res.json({
      registered: {
        number: !!participant.passwords?.number,
        emoji:  !!participant.passwords?.emoji,
        mixed:  !!participant.passwords?.mixed,
      },
      completed: {
        number: !!participant.number?.completedAt,
        emoji:  !!participant.emoji?.completedAt,
        mixed:  !!participant.mixed?.completedAt,
      },
      surveyDone: !!participant.survey?.submittedAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── POST /api/register ───────────────────────────────────────────────────────
app.post("/api/register", async (req, res) => {
  const { studentId, mode, password } = req.body;
  if (!studentId || !mode || !password) return res.status(400).json({ error: "Missing fields" });

  try {
    const participant = await Participant.findOne({ studentId });
    if (participant?.passwords?.[mode]) {
      return res.status(409).json({ error: "Already registered for this mode" });
    }

    const hashed = await bcrypt.hash(password, 10);
    await Participant.findOneAndUpdate(
      { studentId },
      { $set: { [`passwords.${mode}`]: hashed } },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── POST /api/login ──────────────────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { studentId, mode, password } = req.body;
  if (!studentId || !mode || !password) return res.status(400).json({ error: "Missing fields" });

  try {
    const participant = await Participant.findOne({ studentId });
    if (!participant?.passwords?.[mode]) {
      return res.status(404).json({ error: "Not registered for this mode" });
    }

    const match = await bcrypt.compare(password, participant.passwords[mode]);
    if (!match) return res.status(401).json({ error: "Incorrect password" });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── POST /api/result ─────────────────────────────────────────────────────────
app.post("/api/result", async (req, res) => {
  const { studentId, mode, loginTimeMs, errorCount } = req.body;
  if (!studentId || !mode || loginTimeMs == null || errorCount == null) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    await Participant.findOneAndUpdate(
      { studentId },
      { $set: { [mode]: { loginTimeMs, errorCount, completedAt: new Date() } } },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── POST /api/survey ─────────────────────────────────────────────────────────
app.post("/api/survey", async (req, res) => {
  const { studentId, usedEmojiInputBefore, intuitiveness, ageRange } = req.body;
  if (!studentId || usedEmojiInputBefore == null || !intuitiveness || !ageRange) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    await Participant.findOneAndUpdate(
      { studentId },
      { $set: { survey: { usedEmojiInputBefore, intuitiveness, ageRange, submittedAt: new Date() } } },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── GET /api/stats ───────────────────────────────────────────────────────────
app.get("/api/stats", async (req, res) => {
  try {
    const stats = await Participant.aggregate([
      {
        $group: {
          _id: null,
          avgNumberTime:     { $avg: "$number.loginTimeMs" },
          avgNumberErrors:   { $avg: "$number.errorCount" },
          avgEmojiTime:      { $avg: "$emoji.loginTimeMs" },
          avgEmojiErrors:    { $avg: "$emoji.errorCount" },
          avgMixedTime:      { $avg: "$mixed.loginTimeMs" },
          avgMixedErrors:    { $avg: "$mixed.errorCount" },
          totalParticipants: { $sum: 1 },
          avgIntuitiveness:  { $avg: "$survey.intuitiveness" },
        },
      },
    ]);

    const all = await Participant.find({}, { passwords: 0, __v: 0 }).lean();
    res.json({ summary: stats[0] || {}, participants: all });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));