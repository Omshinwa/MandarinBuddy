const mongoose = require('mongoose');

// Written and owned by v2. Declared here so mongoose actually returns it on
// reads — a word's level is derived from srs.intervalDays (see ../levels.js),
// which means every read needs it.
const srsSchema = new mongoose.Schema({
    due: String,          // ISO timestamp; v2 compares these lexicographically
    intervalDays: Number,
    ease: Number,
    lapses: Number,
    suspended: Boolean,   // set on leeches, which drop out of rotation
  }, { _id: false });

const wordSchema = new mongoose.Schema({
    id: Number,
    chinese: String,
    pinyin: String,
    def_english: String,
    comments: String,
    learn_writing: Boolean,
    srs: srsSchema,
    // Per-direction mastery, v2's business entirely. Kept as Mixed so it
    // survives a round trip through here untouched.
    facets: mongoose.Schema.Types.Mixed,
  }, { timestamps: true });

const progressSchema = new mongoose.Schema({
    lastPlayed: Number,  // days since Jan 1, 2022
    currentDay: Number,
    currentStep: Number
  }, { timestamps: true });

const Word = mongoose.model('Word', wordSchema);
const Progress = mongoose.model('Progress', progressSchema);

module.exports = { Word, Progress };
