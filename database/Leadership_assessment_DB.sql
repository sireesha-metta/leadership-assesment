CREATE DATABASE  IF NOT EXISTS `leadership_assesment` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */;
USE `leadership_assesment`;
-- MySQL dump 10.13  Distrib 8.0.42, for Win64 (x86_64)
--
-- Host: gateway01.ap-southeast-1.prod.alicloud.tidbcloud.com    Database: leadership_assesment
-- ------------------------------------------------------
-- Server version	8.0.11-TiDB-v8.5.3-serverless

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `respondent` (Canonical Source of Truth)
--

DROP TABLE IF EXISTS `respondent`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `respondent` (
  `id` int NOT NULL AUTO_INCREMENT,
  `firstname` varchar(512) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `lastname` varchar(512) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `mobile` varchar(512) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `email` varchar(512) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `role` enum('Admin','Leadership','Respondent') COLLATE utf8mb4_0900_ai_ci DEFAULT 'Respondent',
  `status` enum('Active','Inactive') COLLATE utf8mb4_0900_ai_ci DEFAULT 'Active',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `email_hash` char(64) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `mobile_hash` char(64) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `email` (`email`),
  KEY `idx_respondent_email_hash` (`email_hash`),
  KEY `idx_respondent_mobile_hash` (`mobile_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci AUTO_INCREMENT=210005;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `assessment_drafts`
--

DROP TABLE IF EXISTS `assessment_drafts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `assessment_drafts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `respondent_id` int NOT NULL,
  `assessment_type` varchar(100) COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'leadership_reset',
  `answered_count` int NOT NULL DEFAULT '0',
  `draft_payload` json NOT NULL,
  `reminder_sent_at` datetime DEFAULT NULL,
  `reminder_attempts` int NOT NULL DEFAULT '0',
  `reminder_last_error` varchar(500) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_assessment_drafts_user_type` (`respondent_id`,`assessment_type`),
  CONSTRAINT `fk_drafts_respondent` FOREIGN KEY (`respondent_id`) REFERENCES `respondent` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci AUTO_INCREMENT=2159721;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `assessment_submissions`
--

DROP TABLE IF EXISTS `assessment_submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `assessment_submissions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `respondent_id` int NOT NULL,
  `assessment_type` varchar(80) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `total_score` decimal(12,2) NOT NULL DEFAULT '0',
  `total_weighted_score` decimal(12,2) NOT NULL DEFAULT '0',
  `submission_payload` longtext COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` varchar(20) COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'Active',
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_submission_once` (`respondent_id`,`assessment_type`),
  KEY `idx_submission_created_at` (`created_at`),
  CONSTRAINT `fk_submissions_respondent` FOREIGN KEY (`respondent_id`) REFERENCES `respondent` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci AUTO_INCREMENT=120001;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `file_upload_history`
--

DROP TABLE IF EXISTS `file_upload_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `file_upload_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `file_name` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `original_file_name` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `uploaded_by` int NOT NULL,
  `uploaded_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `file_path` varchar(500) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `file_size` bigint DEFAULT NULL,
  `status` enum('Active','Archived') COLLATE utf8mb4_0900_ai_ci DEFAULT 'Active',
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  CONSTRAINT `fk_file_upload_respondent` FOREIGN KEY (`uploaded_by`) REFERENCES `respondent` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci AUTO_INCREMENT=90001;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
