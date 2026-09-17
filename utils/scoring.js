
const CATEGORY_MAXES = {
  "Decision Making": 28,
  "Conversation Patterns": 28,
  "Leader Signals": 35,
};

const ACTION_GRID = {
  Green: {
    "Decision Making": "Next time a decision is being made, notice who speaks first — try waiting until at least two others have spoken before you weigh in.",
    "Conversation Patterns": "Pick one meeting this week and watch who challenges. If it's usually the same one or two people, invite a specific quieter voice to respond first.",
    "Leader Signals": "Before your next big decision, hold back your own view a beat longer than usual and see whether the room's thinking shifts.",
  },
  Amber: {
    "Decision Making": "In your next leadership meeting, deliberately vary who speaks first on the agenda — rotate it away from the usual senior voice.",
    "Conversation Patterns": "After your next meeting, ask one person directly: \"was there anything you didn't say in there that you'd say to me privately?\"",
    "Leader Signals": "Run your next complex decision with a round where everyone states their view in writing before you share yours.",
  },
  Red: {
    "Decision Making": "For your next three decisions, ask the most junior or newest voice in the room to speak first, before anyone senior weighs in.",
    "Conversation Patterns": "Name it directly in your next meeting: \"I want to hear disagreement today — if something feels risky to say, say it anyway.\"",
    "Leader Signals": "Before your next meeting, write down your own view and put it aside. Don't share it until everyone else has spoken.",
  },
};

const ZONE_SUMMARIES = {
  Green: "Your leadership dynamic demonstrates strong alignment, distributed challenge, and high psychological safety.",
  Amber: "Your team operates with moderate alignment, but unvoiced perspectives or leader signaling may be hindering full potential.",
  Red: "Significant decision friction or unvoiced risks are present. Structural changes in room dynamics are recommended.",
};

function computeTab3Scoring(questionResponses = []) {
  let dmScore = 0;
  let cpScore = 0;
  let lsScore = 0;

  questionResponses.forEach((q, idx) => {
    const section = String(q.section || "").toUpperCase();
    const rIdx = Number(q.rowIndex);
    const wScore = Number(q.weightedScore || 0);

    if (section.includes("DECISION") || (rIdx >= 6 && rIdx <= 9) || (idx < 4 && rIdx < 12)) {
      dmScore += wScore;
    } else if (section.includes("CONVERSATION") || (rIdx >= 12 && rIdx <= 15) || (idx >= 4 && idx < 8)) {
      cpScore += wScore;
    } else if (section.includes("LEADER") || (rIdx >= 18 && rIdx <= 21) || idx >= 8) {
      lsScore += wScore;
    }
  });

  const dmPct = Number((dmScore / CATEGORY_MAXES["Decision Making"]).toFixed(4));
  const cpPct = Number((cpScore / CATEGORY_MAXES["Conversation Patterns"]).toFixed(4));
  const lsPct = Number((lsScore / CATEGORY_MAXES["Leader Signals"]).toFixed(4));

  const totalWeighted = dmScore + cpScore + lsScore;
  const overallPct = Number((totalWeighted / 91).toFixed(4));

  // Zone thresholds per spec (raw score out of 91):
  // Green: >= 68 (75%), Amber: 46-67 (50-74%), Red: <= 45 (<50%)
  let zone = "Red";
  if (totalWeighted >= 68) {
    zone = "Green";
  } else if (totalWeighted >= 46) {
    zone = "Amber";
  }

  // Sort categories by percentage ascending (lowest first).
  // Tie-break rule per spec: default to whichever comes LATER in
  // Decision Making -> Conversation Patterns -> Leader Signals,
  // since Leader Signals carries the highest question weights.
  const categories = [
    { name: "Decision Making", pct: dmPct, score: dmScore, max: 28, priority: 1 },
    { name: "Conversation Patterns", pct: cpPct, score: cpScore, max: 28, priority: 2 },
    { name: "Leader Signals", pct: lsPct, score: lsScore, max: 35, priority: 3 },
  ];

  categories.sort((a, b) => {
    if (a.pct !== b.pct) {
      return a.pct - b.pct;
    }
    // Later theme wins ties
    return b.priority - a.priority;
  });

  const weakest = categories[0];
  const secondWeakest = categories[1];
  const strongest = categories[2];

  const actionOnScreen = ACTION_GRID[zone]?.[weakest.name] || "";
  const actionPdfSecond = ACTION_GRID[zone]?.[secondWeakest.name] || "";
  const zoneSummary = ZONE_SUMMARIES[zone] || "";

  return {
    rawTotal: totalWeighted,
    overallPct,
    overallPctDisplay: Math.round(overallPct * 100),
    zone,
    zoneSummary,
    categoryScores: {
      "Decision Making": { raw: dmScore, max: 28, pct: dmPct, pctDisplay: Math.round(dmPct * 100) },
      "Conversation Patterns": { raw: cpScore, max: 28, pct: cpPct, pctDisplay: Math.round(cpPct * 100) },
      "Leader Signals": { raw: lsScore, max: 35, pct: lsPct, pctDisplay: Math.round(lsPct * 100) },
    },
    weakestCategory: weakest.name,
    secondWeakestCategory: secondWeakest.name,
    strongestCategory: strongest.name,
    actions: {
      onScreen: actionOnScreen,
      pdfAction1: actionOnScreen,
      pdfAction2: actionPdfSecond,
    },
  };
}

module.exports = {
  computeTab3Scoring,
  CATEGORY_MAXES,
  ACTION_GRID,
};
