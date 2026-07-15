const mongoose = require('mongoose');
const express = require('express');

// Load environment variables
const dotenv = require('dotenv');
dotenv.config();

const { Word, Progress } = require('./models/words');

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
    const words = await Word.find({ level_id: level }).sort({ updatedAt: -1 });
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

// Handle overwrite endpoint - update words in MongoDB
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

    const result = await Word.updateOne(
      { chinese: cleanChinese, level_id: oldLevelNum },
      { $set: { level_id: newLevelNum } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send('Word not found');
    }

    if (result.modifiedCount === 0) {
      return res.status(200).send('No change');
    }

    res.send('OK');
  } catch (err) {
    console.error('Error in /update_word:', err);
    res.status(500).send(err.message);
  }
});

// Handle overwrite endpoint - update words in MongoDB
app.post('/overwrite', async (req, res) => {
  try {
    const { niveau, data } = req.body;

    if (!niveau || typeof data !== 'string') {
      return res.status(400).send('Missing or invalid niveau/data');
    }
    
    // Extract level from niveau (current/dataN)
    const match = niveau.match(/current\/data(\d+)/);
    if (!match) {
      return res.status(400).send('Invalid niveau format');
    }
    
    const level = parseInt(match[1]);
    
    // Parse the data string into word objects
    const words = data
      .split(/\r?\n/)
      .filter(line => line.trim())
      .map(line => {
        const [chinese, english, pinyin, ...comments] = line.split('@');
        const rawChinese = (chinese ?? '').trim();
        const hasDotPrefix = rawChinese.startsWith('.');
        const chineseText = hasDotPrefix ? rawChinese.replace(/^\.\s*/, '') : rawChinese;
        return {
          chinese: chineseText,
          def_english: english?.trim(),
          pinyin: pinyin?.trim(),
          comments: comments.length ? comments.join('@').trim() : undefined,
          level_id: level,
          learn_writing: hasDotPrefix
        };
      })
      .filter(word => word.chinese);

    // Remove all words for this level and insert new ones
    await Word.deleteMany({ level_id: level });
    if (words.length > 0) {
      await Word.insertMany(words);
    }
    
    res.send('OK');
  } catch (err) {
    console.error('Error in /overwrite:', err);
    res.status(500).send(err.message);
  }
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
