const mongoose = require('mongoose');

const wordSchema = new mongoose.Schema({
    id: Number,
    chinese: String,
    pinyin: String,
    def_english: String,
    comments: String,
    learn_writing: Boolean,
    level_id: Number,
  }, { timestamps: true });

const progressSchema = new mongoose.Schema({
    lastPlayed: Number,  // days since Jan 1, 2022
    currentDay: Number,
    currentStep: Number
  }, { timestamps: true });

const Word = mongoose.model('Word', wordSchema);
const Progress = mongoose.model('Progress', progressSchema);

module.exports = { Word, Progress };