'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { create } = require('./public/quiz-score.js');

const bankPath = process.env.QUIZ_BANK || path.join(__dirname, 'data', '03_questions.json');
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
const quiz = create(bank);

module.exports = {
  ...quiz,
  questions: quiz.questions,
  version: quiz.version,
  bankPath
};
