const { computeTab3Scoring } = require("./scoring");

console.log("=== RUNNING TAB 3 SCORING ENGINE TESTS ===");

// Test Case 1: Minimum Scores
const minResponses = [
  { section: "DECISION MAKING", weightedScore: 2 },
  { section: "DECISION MAKING", weightedScore: 2 },
  { section: "DECISION MAKING", weightedScore: 1 },
  { section: "DECISION MAKING", weightedScore: 2 },
  { section: "CONVERSATION PATTERNS", weightedScore: 2 },
  { section: "CONVERSATION PATTERNS", weightedScore: 2 },
  { section: "CONVERSATION PATTERNS", weightedScore: 1 },
  { section: "CONVERSATION PATTERNS", weightedScore: 2 },
  { section: "LEADER SIGNALS", weightedScore: 3 },
  { section: "LEADER SIGNALS", weightedScore: 3 },
  { section: "LEADER SIGNALS", weightedScore: 2 },
  { section: "LEADER SIGNALS", weightedScore: 1 },
];

const res1 = computeTab3Scoring(minResponses);
console.log("\n--- TEST 1: Low Score Case ---");
console.log("Overall Total:", res1.rawTotal, "/ 91");
console.log("Overall Pct:", res1.overallPctDisplay, "%");
console.log("Zone:", res1.zone);
console.log("Weakest Category:", res1.weakestCategory);
console.log("Second Weakest:", res1.secondWeakestCategory);
console.log("On-Screen Action:", res1.actions.onScreen);

// Test Case 2: Maximum Scores
const maxResponses = [
  { section: "DECISION MAKING", weightedScore: 8 },
  { section: "DECISION MAKING", weightedScore: 8 },
  { section: "DECISION MAKING", weightedScore: 4 },
  { section: "DECISION MAKING", weightedScore: 8 }, // 28
  { section: "CONVERSATION PATTERNS", weightedScore: 8 },
  { section: "CONVERSATION PATTERNS", weightedScore: 8 },
  { section: "CONVERSATION PATTERNS", weightedScore: 4 },
  { section: "CONVERSATION PATTERNS", weightedScore: 8 }, // 28
  { section: "LEADER SIGNALS", weightedScore: 12 },
  { section: "LEADER SIGNALS", weightedScore: 12 },
  { section: "LEADER SIGNALS", weightedScore: 8 },
  { section: "LEADER SIGNALS", weightedScore: 3 }, // 35
];

const res2 = computeTab3Scoring(maxResponses);
console.log("\n--- TEST 2: Max Score Case ---");
console.log("Overall Total:", res2.rawTotal, "/ 91");
console.log("Overall Pct:", res2.overallPctDisplay, "%");
console.log("Zone:", res2.zone);
console.log("Category Pcts:", res2.categoryScores);

// Test Case 3: Tie-Break Test (Decision Making vs Conversation Patterns equal Pct)
const tieResponses = [
  { section: "DECISION MAKING", weightedScore: 14 }, // 14/28 = 50%
  { section: "CONVERSATION PATTERNS", weightedScore: 14 }, // 14/28 = 50%
  { section: "LEADER SIGNALS", weightedScore: 28 }, // 28/35 = 80%
];

const res3 = computeTab3Scoring(tieResponses);
console.log("\n--- TEST 3: Tie-Break Priority Test ---");
console.log("DM Pct:", res3.categoryScores["Decision Making"].pctDisplay, "%");
console.log("CP Pct:", res3.categoryScores["Conversation Patterns"].pctDisplay, "%");
console.log("LS Pct:", res3.categoryScores["Leader Signals"].pctDisplay, "%");
console.log("Weakest Category (Should be Decision Making due to tie priority):", res3.weakestCategory);
console.log("Second Weakest Category (Should be Conversation Patterns):", res3.secondWeakestCategory);

if (res3.weakestCategory === "Decision Making" && res3.secondWeakestCategory === "Conversation Patterns") {
  console.log("\n✅ TIE-BREAK RULE PASSED SUCCESSFULLY!");
} else {
  console.log("\n❌ TIE-BREAK RULE FAILED!");
}
