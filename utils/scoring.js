/**
 * Tab 3 Scoring Engine for Leadership Reset Diagnostic
 * 
 * Category Max Ceilings:
 * - Decision Making (Q1-Q4): 28 pts
 * - Conversation Patterns (Q5-Q8): 28 pts
 * - Leader Signals (Q9-Q12): 35 pts
 * - Overall Ceiling: 91 pts
 */

const CATEGORY_MAXES = {
  "Decision Making": 28,
  "Conversation Patterns": 28,
  "Leader Signals": 35,
};

const CATEGORY_PRIORITY = {
  "Decision Making": 1,
  "Conversation Patterns": 2,
  "Leader Signals": 3,
};

const ACTION_GRID = {
  Green: {
    "Decision Making": "Maintain open decision channels and ensure diverse voices continue leading discussions early.",
    "Conversation Patterns": "Sustain psychological safety so team members freely challenge initial proposals in meetings.",
    "Leader Signals": "Keep holding back early signals to allow uninhibited exploration of ideas from subject matter experts.",
  },
  Amber: {
    "Decision Making": "Establish structured turn-taking to prevent senior or dominant voices from steering choices prematurely.",
    "Conversation Patterns": "Actively invite pushback during meetings to surface unspoken concerns before decisions close.",
    "Leader Signals": "Intentionally pause before stating your own view so knowledgeable team members speak up first.",
  },
  Red: {
    "Decision Making": "Re-evaluate decision velocity and explicitly assign rotation for who leads topic discussions.",
    "Conversation Patterns": "Address off-limits topics and corridor talk by building dedicated psychological safety protocols.",
    "Leader Signals": "Systematically hold back early leadership signals to break team convergence habits.",
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

  questionResponses.forEach((q) => {
    const section = q.section ? q.section.toUpperCase() : "";
    const wScore = Number(q.weightedScore || 0);

    if (section.includes("DECISION")) {
      dmScore += wScore;
    } else if (section.includes("CONVERSATION")) {
      cpScore += wScore;
    } else if (section.includes("LEADER")) {
      lsScore += wScore;
    } else {
      // Fallback by row index if section string missing
      const rIdx = Number(q.rowIndex);
      if (rIdx >= 6 && rIdx <= 9) dmScore += wScore;
      else if (rIdx >= 12 && rIdx <= 15) cpScore += wScore;
      else if (rIdx >= 18 && rIdx <= 21) lsScore += wScore;
    }
  });

  const dmPct = Number((dmScore / CATEGORY_MAXES["Decision Making"]).toFixed(4));
  const cpPct = Number((cpScore / CATEGORY_MAXES["Conversation Patterns"]).toFixed(4));
  const lsPct = Number((lsScore / CATEGORY_MAXES["Leader Signals"]).toFixed(4));

  const totalWeighted = dmScore + cpScore + lsScore;
  const overallPct = Number((totalWeighted / 91).toFixed(4));

  let zone = "Red";
  if (overallPct >= 0.75) {
    zone = "Green";
  } else if (overallPct >= 0.50) {
    zone = "Amber";
  }

  // Sort categories by percentage ascending (lowest first)
  const categories = [
    { name: "Decision Making", pct: dmPct, score: dmScore, max: 28, priority: 1 },
    { name: "Conversation Patterns", pct: cpPct, score: cpScore, max: 28, priority: 2 },
    { name: "Leader Signals", pct: lsPct, score: lsScore, max: 35, priority: 3 },
  ];

  categories.sort((a, b) => {
    if (a.pct !== b.pct) {
      return a.pct - b.pct;
    }
    // Tie-break rule: lower priority number chosen first (Decision Making > Conversation Patterns > Leader Signals)
    return a.priority - b.priority;
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
