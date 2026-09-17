-- ============================================================================
-- CLOUD DATABASE MIGRATION SCRIPT: RESPONDENT DATA NORMALIZATION
-- Target Databases: MySQL 8.0+, TiDB Cloud / Serverless, AWS RDS / Aurora
-- Description: Establishes `respondent` as the single source of truth.
--              Harmonizes column types (resolves Error 3780), drops redundant
--              columns, cleans JSON payloads, and enforces foreign keys.
-- ============================================================================

USE `leadership_assesment`;

-- Temporarily disable foreign key checks & safe update mode
SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_SAFE_UPDATES = @@SQL_SAFE_UPDATES, SQL_SAFE_UPDATES = 0;

-- ----------------------------------------------------------------------------
-- STEP 1: Ensure Respondent Security & Search Hash Columns Exist
-- ----------------------------------------------------------------------------
SET @col_exist_email_hash := (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'respondent' 
      AND COLUMN_NAME = 'email_hash'
);
SET @sql_add_email_hash := IF(@col_exist_email_hash = 0,
    'ALTER TABLE `respondent` ADD COLUMN `email_hash` CHAR(64) NULL AFTER `updated_at`, ADD INDEX `idx_respondent_email_hash` (`email_hash`)',
    'SELECT "respondent.email_hash already exists" AS status'
);
PREPARE stmt FROM @sql_add_email_hash;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exist_mobile_hash := (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'respondent' 
      AND COLUMN_NAME = 'mobile_hash'
);
SET @sql_add_mobile_hash := IF(@col_exist_mobile_hash = 0,
    'ALTER TABLE `respondent` ADD COLUMN `mobile_hash` CHAR(64) NULL AFTER `email_hash`, ADD INDEX `idx_respondent_mobile_hash` (`mobile_hash`)',
    'SELECT "respondent.mobile_hash already exists" AS status'
);
PREPARE stmt FROM @sql_add_mobile_hash;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ----------------------------------------------------------------------------
-- STEP 2: Harmonize Column Data Types (Fixes MySQL Error Code 3780)
-- ----------------------------------------------------------------------------
-- In MySQL 8.0+, FK columns must match the exact data type and signedness of respondent.id (INT signed).
ALTER TABLE `assessment_drafts` 
  MODIFY COLUMN `respondent_id` INT NOT NULL;

ALTER TABLE `assessment_submissions` 
  MODIFY COLUMN `respondent_id` INT NOT NULL;

SET @table_exist_file_upload := (
    SELECT COUNT(*) FROM information_schema.TABLES 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'file_upload_history'
);
SET @sql_modify_upload := IF(@table_exist_file_upload > 0,
    'ALTER TABLE `file_upload_history` MODIFY COLUMN `uploaded_by` INT NOT NULL',
    'SELECT "file_upload_history does not exist" AS status'
);
PREPARE stmt FROM @sql_modify_upload;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ----------------------------------------------------------------------------
-- STEP 3: Reconcile Missing or Invalid respondent_id in assessment_submissions
-- ----------------------------------------------------------------------------
SET @col_exist_sub_email := (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'assessment_submissions' 
      AND COLUMN_NAME = 'email'
);

SET @sql_reconcile_sub := IF(@col_exist_sub_email > 0,
    'UPDATE `assessment_submissions` s
     JOIN `respondent` r ON (s.email = r.email OR s.email = r.email_hash)
     SET s.respondent_id = r.id
     WHERE (s.respondent_id IS NULL OR s.respondent_id = 0 OR s.respondent_id NOT IN (SELECT id FROM respondent))
       AND s.email IS NOT NULL',
    'SELECT "No email column to reconcile in assessment_submissions" AS status'
);
PREPARE stmt FROM @sql_reconcile_sub;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Remove any orphan drafts whose respondent_id does not exist in respondent table
DELETE FROM `assessment_drafts` 
WHERE `respondent_id` NOT IN (SELECT `id` FROM `respondent`);

-- ----------------------------------------------------------------------------
-- STEP 4: Clean Redundant Identity Attributes from JSON Payloads
-- ----------------------------------------------------------------------------

-- 4A: Clean assessment_drafts.draft_payload
UPDATE `assessment_drafts`
SET `draft_payload` = JSON_REMOVE(
    `draft_payload`,
    '$.respondent_name',
    '$.respondentName',
    '$.name',
    '$.email',
    '$.mobile',
    '$.user_name',
    '$.user_email'
)
WHERE `draft_payload` IS NOT NULL
  AND (
    JSON_EXTRACT(`draft_payload`, '$.respondent_name') IS NOT NULL
    OR JSON_EXTRACT(`draft_payload`, '$.respondentName') IS NOT NULL
    OR JSON_EXTRACT(`draft_payload`, '$.name') IS NOT NULL
    OR JSON_EXTRACT(`draft_payload`, '$.email') IS NOT NULL
    OR JSON_EXTRACT(`draft_payload`, '$.mobile') IS NOT NULL
  );

-- 4B: Clean assessment_submissions.submission_payload
UPDATE `assessment_submissions`
SET `submission_payload` = JSON_REMOVE(
    CAST(`submission_payload` AS JSON),
    '$.respondent_name',
    '$.respondentName',
    '$.name',
    '$.email',
    '$.mobile',
    '$.user_name',
    '$.user_email',
    '$.bookingDetails.name',
    '$.bookingDetails.email',
    '$.bookingDetails.mobile',
    '$.bookingDetails.respondent_name',
    '$.bookingDetails.respondentName'
)
WHERE `submission_payload` IS NOT NULL
  AND `submission_payload` != ''
  AND JSON_VALID(`submission_payload`) = 1
  AND (
    JSON_EXTRACT(`submission_payload`, '$.respondent_name') IS NOT NULL
    OR JSON_EXTRACT(`submission_payload`, '$.respondentName') IS NOT NULL
    OR JSON_EXTRACT(`submission_payload`, '$.name') IS NOT NULL
    OR JSON_EXTRACT(`submission_payload`, '$.email') IS NOT NULL
    OR JSON_EXTRACT(`submission_payload`, '$.mobile') IS NOT NULL
    OR JSON_EXTRACT(`submission_payload`, '$.bookingDetails.name') IS NOT NULL
    OR JSON_EXTRACT(`submission_payload`, '$.bookingDetails.email') IS NOT NULL
  );

-- ----------------------------------------------------------------------------
-- STEP 5: Drop Redundant Identity Columns
-- ----------------------------------------------------------------------------

-- 5A: assessment_drafts -> Drop respondent_name
SET @col_exist_draft_name := (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'assessment_drafts' 
      AND COLUMN_NAME = 'respondent_name'
);
SET @sql_drop_draft_name := IF(@col_exist_draft_name > 0,
    'ALTER TABLE `assessment_drafts` DROP COLUMN `respondent_name`',
    'SELECT "assessment_drafts.respondent_name already dropped" AS status'
);
PREPARE stmt FROM @sql_drop_draft_name;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5B: assessment_submissions -> Drop respondent_name
SET @col_exist_sub_name := (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'assessment_submissions' 
      AND COLUMN_NAME = 'respondent_name'
);
SET @sql_drop_sub_name := IF(@col_exist_sub_name > 0,
    'ALTER TABLE `assessment_submissions` DROP COLUMN `respondent_name`',
    'SELECT "assessment_submissions.respondent_name already dropped" AS status'
);
PREPARE stmt FROM @sql_drop_sub_name;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5C: assessment_submissions -> Drop email
SET @col_exist_sub_email := (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'assessment_submissions' 
      AND COLUMN_NAME = 'email'
);
SET @sql_drop_sub_email := IF(@col_exist_sub_email > 0,
    'ALTER TABLE `assessment_submissions` DROP COLUMN `email`',
    'SELECT "assessment_submissions.email already dropped" AS status'
);
PREPARE stmt FROM @sql_drop_sub_email;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5D: assessment_submissions -> Drop mobile (if present)
SET @col_exist_sub_mobile := (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'assessment_submissions' 
      AND COLUMN_NAME = 'mobile'
);
SET @sql_drop_sub_mobile := IF(@col_exist_sub_mobile > 0,
    'ALTER TABLE `assessment_submissions` DROP COLUMN `mobile`',
    'SELECT "assessment_submissions.mobile already dropped or not present" AS status'
);
PREPARE stmt FROM @sql_drop_sub_mobile;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5E: file_upload_history -> Drop uploaded_by_name (if table exists)
SET @col_exist_upload_name := (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'file_upload_history' 
      AND COLUMN_NAME = 'uploaded_by_name'
);
SET @sql_drop_upload_name := IF(@table_exist_file_upload > 0 AND @col_exist_upload_name > 0,
    'ALTER TABLE `file_upload_history` DROP COLUMN `uploaded_by_name`',
    'SELECT "file_upload_history.uploaded_by_name already dropped or table does not exist" AS status'
);
PREPARE stmt FROM @sql_drop_upload_name;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ----------------------------------------------------------------------------
-- STEP 6: Add Foreign Key Constraints (Safe and Compatible)
-- ----------------------------------------------------------------------------

-- Ensure foreign key from assessment_drafts -> respondent
SET @fk_exist_drafts := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'assessment_drafts' 
      AND CONSTRAINT_NAME = 'fk_drafts_respondent'
);
SET @sql_fk_drafts := IF(@fk_exist_drafts = 0,
    'ALTER TABLE `assessment_drafts` ADD CONSTRAINT `fk_drafts_respondent` FOREIGN KEY (`respondent_id`) REFERENCES `respondent` (`id`)',
    'SELECT "fk_drafts_respondent already exists" AS status'
);
PREPARE stmt FROM @sql_fk_drafts;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Ensure foreign key from assessment_submissions -> respondent
SET @fk_exist_subs := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'assessment_submissions' 
      AND CONSTRAINT_NAME = 'fk_submissions_respondent'
);
SET @sql_fk_subs := IF(@fk_exist_subs = 0,
    'ALTER TABLE `assessment_submissions` ADD CONSTRAINT `fk_submissions_respondent` FOREIGN KEY (`respondent_id`) REFERENCES `respondent` (`id`)',
    'SELECT "fk_submissions_respondent already exists" AS status'
);
PREPARE stmt FROM @sql_fk_subs;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Ensure foreign key from file_upload_history -> respondent (if table exists)
SET @fk_exist_uploads := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'file_upload_history' 
      AND CONSTRAINT_NAME = 'fk_file_upload_respondent'
);
SET @sql_fk_uploads := IF(@table_exist_file_upload > 0 AND @fk_exist_uploads = 0,
    'ALTER TABLE `file_upload_history` ADD CONSTRAINT `fk_file_upload_respondent` FOREIGN KEY (`uploaded_by`) REFERENCES `respondent` (`id`)',
    'SELECT "fk_file_upload_respondent already exists or table does not exist" AS status'
);
PREPARE stmt FROM @sql_fk_uploads;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Restore foreign key checks & safe updates
SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;
SET SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES;

-- ----------------------------------------------------------------------------
-- STEP 7: Verification Audit Queries
-- ----------------------------------------------------------------------------

-- Audit 1: Verify all tables and column existence
SELECT 
    TABLE_NAME, 
    COLUMN_NAME, 
    DATA_TYPE, 
    IS_NULLABLE 
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'assessment_drafts' AND COLUMN_NAME IN ('id', 'respondent_id', 'respondent_name'))
    OR (TABLE_NAME = 'assessment_submissions' AND COLUMN_NAME IN ('id', 'respondent_id', 'respondent_name', 'email', 'mobile'))
    OR (TABLE_NAME = 'file_upload_history' AND COLUMN_NAME IN ('id', 'uploaded_by', 'uploaded_by_name'))
    OR (TABLE_NAME = 'respondent' AND COLUMN_NAME IN ('id', 'email_hash', 'mobile_hash'))
  )
ORDER BY TABLE_NAME, COLUMN_NAME;

-- Audit 2: Check for any orphan drafts (Must return 0)
SELECT 
    COUNT(*) AS orphan_draft_count
FROM `assessment_drafts` d
LEFT JOIN `respondent` r ON r.id = d.respondent_id
WHERE r.id IS NULL;

-- Audit 3: Check for any orphan submissions (Must return 0)
SELECT 
    COUNT(*) AS orphan_submission_count
FROM `assessment_submissions` s
LEFT JOIN `respondent` r ON r.id = s.respondent_id
WHERE r.id IS NULL;

-- Audit 4: Sample joined data verification
SELECT 
    s.id AS submission_id,
    s.respondent_id,
    s.assessment_type,
    s.total_score,
    r.status AS respondent_status,
    s.created_at
FROM `assessment_submissions` s
INNER JOIN `respondent` r ON r.id = s.respondent_id
LIMIT 5;

SELECT 'CLOUD MIGRATION COMPLETED SUCCESSFULLY!' AS result;
