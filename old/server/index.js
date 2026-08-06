const mongoose = require('mongoose');
const express = require('express');

// Load environment variables
const dotenv = require('dotenv');
dotenv.config();

const { Word, Progress } = require('./models/words');
const {
  MIN_LEVEL,
  MAX_LEVEL,
  dueAfter,
  intervalForLevel,
  intervalQueryForLevel,
  levelForInterval,
} = require('./levels');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const path = require('path');

// MongoDB endpoints to replace file operations
app.get('/jour.txt', async (req, res) => {
  try {
    const progress = await Progress.findOne();
    if (progress) {
      res.send(`${progress.lastPlayed}@${progress.currentDay}@${progress.currentStep}`);
    } else {
      res.send('0@0@0');
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/data/current/data:level.txt', async (req, res) => {
  try {
    const level = parseInt(req.params.level);
    if (!Number.isFinite(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
      return res.status(400).send('Invalid level');
    }
    // A level is an interval window now, not a stored field. Leeches are
    // suspended in v2 and out of rotation there, so they stay out here too.
    const words = await Word.find({
      'srs.intervalDays': intervalQueryForLevel(level),
      'srs.suspended': { $ne: true },
    }).sort({ updatedAt: -1 });
    // Format words as expected by client: chinese@english@pinyin@example
    const formatted = words.map(w => {
      const chinese = w.learn_writing ? `.${w.chinese}` : w.chinese;
      return [chinese, w.def_english, w.pinyin, w.comments]
        .filter(Boolean)
        .join(' @ ');
    }).join('\n');
    res.send(formatted);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Handle LIRE endpoint - Removed as part of cleanup
// Client now uses /data/current/data:level.txt directly

// Move a word up a level (success) or back to level 1 (give up). There is no
// level field to write anymore, so this snaps the SRS interval to the target
// level's octave instead — which is what the level meant all along.
app.post('/update_word', async (req, res) => {
  try {
    const { cn_word, old_level, new_level } = req.body;
    if (typeof cn_word !== 'string' || cn_word.trim().length === 0) {
      return res.status(400).send('Invalid cn_word');
    }

    const oldLevelNum = Number(old_level);
    const newLevelNum = Number(new_level);

    if (!Number.isFinite(oldLevelNum) || !Number.isFinite(newLevelNum)) {
      return res.status(400).send('Invalid old_level/new_level');
    }

    // Clean up the word: trim whitespace and remove dot prefix if present
    // The client receives " word @ ..." so the split results in " word " (with whitespace)
    // Also "learn_writing" words have a dot prefix in the UI/Client but not in DB
    let cleanChinese = cn_word.trim();
    if (cleanChinese.startsWith('.')) {
      cleanChinese = cleanChinese.substring(1);
    }

    const word = await Word.findOne({ chinese: cleanChinese });
    if (!word) {
      return res.status(404).send('Word not found');
    }

    // The client's old_level is whichever bucket it loaded the word from, and
    // that can be stale — v2 reviews the same words behind our back. So take the
    // client's two numbers as a direction only, and step from where the word
    // actually is right now.
    const currentLevel = levelForInterval(word.srs && word.srs.intervalDays);
    const targetLevel = newLevelNum > oldLevelNum
      ? Math.min(MAX_LEVEL, currentLevel + 1)
      : MIN_LEVEL;
    const intervalDays = intervalForLevel(targetLevel);

    await Word.updateOne(
      { _id: word._id },
      { $set: { 'srs.intervalDays': intervalDays, 'srs.due': dueAfter(intervalDays) } }
    );

    res.send(String(targetLevel));
  } catch (err) {
    console.error('Error in /update_word:', err);
    res.status(500).send(err.message);
  }
});

// Bulk level overwrite is retired — it always worked by deleting every word in
// a level and re-inserting the textarea, which would now throw away the srs and
// facets state v2 maintains. And with levels derived from the interval, "every
// word in level N" isn't a stable set to replace in the first place.
//
// Reading a level still works (GET /data/current/dataN.txt), so the editor page
// remains a viewer. Saving is refused here without touching the database.
app.post('/overwrite', (req, res) => {
  res
    .status(410)
    .send('Saving is disabled: levels are derived from SRS intervals now, so this page is read-only. Edit words in the v2 app.');
});

// Handle overwrite2 endpoint - update progress
app.post('/overwrite2', async (req, res) => {
  try {
    const { lastplayed, jour, step } = req.body;
    
    // Update or create progress
    await Progress.findOneAndUpdate(
      {}, // update first doc since we only track one progress
      { 
        lastPlayed: Number(lastplayed), 
        currentDay: Number(jour), 
        currentStep: Number(step) 
      },
      { upsert: true, new: true }
    );
    
    res.send('OK');
  } catch (err) {
    console.error('Error in /overwrite2:', err);
    res.status(500).send(err.message);
  }
});

// Backup endpoint - save backup copy in MongoDB
app.post('/backup', async (req, res) => {
  try {
    const levels = req.body.array;
    // We can skip actual backup since MongoDB has versioning
    // But we'll keep the endpoint to maintain compatibility
    res.send('OK');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Serve static files from client folder (after API routes)
app.use(express.static(path.join(__dirname, '../client')));

const port = 5001;

// API endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// Connect to MongoDB
const MONGO_URI = process.env.ATLAS_URI;

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Connection error:', err));
