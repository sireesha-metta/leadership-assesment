const ExcelJS = require("exceljs");

async function generateRespondentsExcel(respondents) {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "Leadership Assessment";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Respondents");

 worksheet.columns = [
  { header: "ID", key: "id", width: 10 },
  { header: "First Name", key: "firstname", width: 20 },
  { header: "Last Name", key: "lastname", width: 20 },
  { header: "Email", key: "email", width: 35 },
  { header: "Role", key: "role", width: 15 },
  { header: "Status", key: "status", width: 15 },
  { header: "Created At", key: "created_at", width: 22 },
];

  // Header Styling
  worksheet.getRow(1).font = {
    bold: true,
    color: { argb: "FFFFFFFF" },
  };

  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "1F4E78" },
  };

  worksheet.getRow(1).alignment = {
    vertical: "middle",
    horizontal: "center",
  };

 respondents.forEach((item) => {
  worksheet.addRow({
    id: item.id,
    firstname: item.firstname,
    lastname: item.lastname,
    email: item.email,
    role: item.role,
    status: item.status,
    created_at: item.created_at,
  });
});

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
  });

  return await workbook.xlsx.writeBuffer();
}

async function generateSubmissionsExcel(submissions) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Submissions");

  worksheet.columns = [
    { header: "Submission ID", key: "submission_id", width: 14 },
    { header: "Respondent ID", key: "respondent_id", width: 18 },
    { header: "Respondent Name", key: "respondent_name", width: 30 },
    { header: "Email", key: "email", width: 35 },
    { header: "Assessment Type", key: "assessment_type", width: 22 },
    { header: "Total Score", key: "total_score", width: 15 },
    { header: "Weighted Score", key: "total_weighted_score", width: 18 },
    { header: "Submitted At", key: "submitted_at", width: 22 },
    { header: "Created At", key: "created_at", width: 22 },
    { header: "Q#", key: "question_no", width: 8 },
    { header: "Question", key: "question", width: 60 },
    { header: "Answer", key: "answer", width: 60 },
    { header: "Score", key: "score", width: 10 },
    { header: "Weight", key: "weight", width: 10 },
    { header: "Weighted Score", key: "weighted_score", width: 16 },
  ];

  // Header style
  worksheet.getRow(1).font = {
    bold: true,
    color: { argb: "FFFFFFFF" },
  };

  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "1F4E78" },
  };

  submissions.forEach((item) => {
    let payload = {};

    if (typeof item.submission_payload === "string") {
      try {
        payload = JSON.parse(item.submission_payload || "{}");
      } catch {
        payload = {};
      }
    } else if (item.submission_payload && typeof item.submission_payload === "object") {
      payload = item.submission_payload;
    }

    const responses = Array.isArray(payload.questionResponses) ? payload.questionResponses : [];

    const summaryRow = {
      submission_id: item.id,
      respondent_id: item.respondent_id,
      respondent_name: item.respondent_name,
      email: item.email,
      assessment_type: item.assessment_type,
      total_score: item.total_score,
      total_weighted_score: item.total_weighted_score,
      submitted_at: item.submitted_at,
      created_at: item.created_at,
    };

    if (responses.length === 0) {
      worksheet.addRow(summaryRow);
      return;
    }

    responses.forEach((response, index) => {
      worksheet.addRow({
        ...summaryRow,
        question_no: response?.number || response?.qNo || index + 1,
        question: response?.question || "",
        answer: response?.answer || "",
        score: response?.score ?? "",
        weight: response?.weight ?? "",
        weighted_score: response?.weightedScore ?? "",
      });
    });
    worksheet.addRow({});
  });

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

module.exports = {
  generateRespondentsExcel,generateSubmissionsExcel
};