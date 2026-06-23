const path = require("path");
const XLSX = require("xlsx");

const DEFAULT_QUESTION_ROWS = [6, 7, 8, 9, 12, 13, 14, 15, 18, 19, 20, 21];
const DEFAULT_SECTIONS = {
  6: "DECISION MAKING",
  12: "CONVERSATION PATTERNS",
  18: "LEADER SIGNALS",
};

function parseOptions(optionsStr) {
  if (!optionsStr) return [];
  return String(optionsStr)
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAnswerText(value) {
  if (!value) return "";
  return String(value)
    .replace(/^[A-Da-d]\.?\s*/, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/["'`,.;:!?()\[\]{}]/g, " ")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function readScoreRules(workbook, scoreSheetName) {
  const ws = workbook.Sheets[scoreSheetName];
  if (!ws) return new Map();

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const rulesByDiagRow = new Map();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const answerText = row[5];
    const score = row[6];
    const diagRow = row[7];
    if (!answerText || score === undefined || score === null || !diagRow) continue;

    const key = Number(diagRow);
    if (!rulesByDiagRow.has(key)) rulesByDiagRow.set(key, new Map());
    rulesByDiagRow.get(key).set(normalizeAnswerText(answerText), Number(score));
  }

  return rulesByDiagRow;
}

exports.getQuestions = (req, res) => {
  try {
    const filePath =
      process.env.QUESTIONS_FILE_PATH ||
      path.join(process.cwd(), "Leadership_Reset_Diagnostic_NR.xlsx");
    const sheetName = process.env.QUESTIONS_SHEET_NAME || "Diagnostic";
    const scoreSheetName = process.env.SCORE_SHEET_NAME || "Scores";

    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      return res.status(400).json({
        message: `Sheet '${sheetName}' not found in file ${filePath}`,
      });
    }

    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    const scoreRules = readScoreRules(workbook, scoreSheetName);

    const questions = DEFAULT_QUESTION_ROWS.map((rowIdx) => {
      const row = data[rowIdx] || [];
      const answerCellRef = `D${rowIdx + 1}`;
      const scoreCellRef = `E${rowIdx + 1}`;

      const answerCell = worksheet[answerCellRef];
      const scoreCell = worksheet[scoreCellRef];
      const options = parseOptions(row[2]);
      const optionScoreMap = {};

      const rulesForRow = scoreRules.get(rowIdx + 1) || new Map();
      options.forEach((opt) => {
        const key = normalizeAnswerText(opt);
        optionScoreMap[opt] = rulesForRow.has(key) ? rulesForRow.get(key) : null;
      });

      return {
        rowIndex: rowIdx,
        number: row[0],
        question: row[1] || "",
        options,
        optionScoreMap,
        answer: answerCell ? String(answerCell.v) : "",
        score: scoreCell ? String(scoreCell.v ?? "") : "",
        weight: row[5] ?? "",
        section: DEFAULT_SECTIONS[rowIdx] || null,
      };
    });

    return res.json(questions);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Failed to read questions file",
      details: error.message,
    });
  }
};