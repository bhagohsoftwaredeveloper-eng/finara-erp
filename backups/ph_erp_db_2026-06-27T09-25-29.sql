-- MySQL dump 10.13  Distrib 9.4.0, for Win64 (x86_64)
--
-- Host: localhost    Database: ph_erp_db
-- ------------------------------------------------------
-- Server version	9.4.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `_prisma_migrations`
--

DROP TABLE IF EXISTS `_prisma_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `_prisma_migrations` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `checksum` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `finished_at` datetime(3) DEFAULT NULL,
  `migration_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `logs` text COLLATE utf8mb4_unicode_ci,
  `rolled_back_at` datetime(3) DEFAULT NULL,
  `started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `applied_steps_count` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `_prisma_migrations`
--

LOCK TABLES `_prisma_migrations` WRITE;
/*!40000 ALTER TABLE `_prisma_migrations` DISABLE KEYS */;
INSERT INTO `_prisma_migrations` VALUES ('05347389-fb60-4056-9fc5-982b099283d2','6d5bf43af1bdff862e26f9f799a30eb9a62c02b08bda6831a446267477371d3e','2026-06-27 08:45:13.901','20260627084513_add_audit_trail_and_auth_hardening',NULL,NULL,'2026-06-27 08:45:13.818',1),('28aa4a5c-51b9-4e87-bccf-171201c30f5c','8a6e3365a99721ec2275b1e76743795f80b1a260fcd89ea1d17a99e694687535','2026-06-27 08:55:30.118','20260627085529_phase3_5_attachments_po_assets_bank_budget_recurring',NULL,NULL,'2026-06-27 08:55:29.637',1),('3d3eb5ee-44cd-489a-a9b0-afd68df729ed','a6f88b1e492189d28b00b53415c3bcb670dabf99dfe8db4b97bb782fa2f2b8f5','2026-06-25 02:46:38.936','20260625000003_add_daily_remittance',NULL,NULL,'2026-06-25 02:46:38.847',1),('4f1d9c0f-4e87-403e-9b7b-fba076a17e83','bad667cd66f2c9b251b8aff3bfc2f920bcdc33b5c8c59627a6c2cf1606658796','2026-06-25 01:50:33.801','20260625000001_add_inventory',NULL,NULL,'2026-06-25 01:50:33.491',1),('5629c641-45d1-4af6-a05c-92dfb3a877cc','fb2eef0d99fca7aef094f6af58a9e914ab1176cea0aa91a8b52a8b71e198a351','2026-06-25 02:30:30.090','20260625000002_add_remittance',NULL,NULL,'2026-06-25 02:30:29.878',1),('857a29dd-18c6-4135-9965-8ef6e7993803','1396e5cffc1a8dd334244e5ad998c8cf923754646d1fbc3d429926f7aa6d5f59','2026-06-25 03:03:18.640','20260625000004_add_expense_voucher',NULL,NULL,'2026-06-25 03:03:18.491',1),('d6f7b04e-5599-4867-8a04-da3dd4d38c55','704961acf3d5d7d0fe6c6295fdafdee4a4cd6878fcded928a55633407f4c2f7b','2026-06-25 01:50:33.490','20260624123252_add_custom_reports',NULL,NULL,'2026-06-25 01:50:33.442',1),('e9318b49-5047-4053-8280-0a10e9182dcf','1132ede0f3477502cc8d6fd7396d36019d07a4b184a81bf1d9a59841d2befc7d','2026-06-25 01:50:33.441','20260623031531_init',NULL,NULL,'2026-06-25 01:50:32.555',1);
/*!40000 ALTER TABLE `_prisma_migrations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `accounts`
--

DROP TABLE IF EXISTS `accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accountCode` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `accountName` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `accountType` enum('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `normalBalance` enum('DEBIT','CREDIT') COLLATE utf8mb4_unicode_ci NOT NULL,
  `parentId` int DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `description` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `accounts_accountCode_key` (`accountCode`),
  KEY `accounts_accountCode_idx` (`accountCode`),
  KEY `accounts_accountType_idx` (`accountType`),
  KEY `accounts_parentId_fkey` (`parentId`),
  CONSTRAINT `accounts_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `accounts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=186 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `accounts`
--

LOCK TABLES `accounts` WRITE;
/*!40000 ALTER TABLE `accounts` DISABLE KEYS */;
INSERT INTO `accounts` VALUES (1,'1000','Current Assets','ASSET','DEBIT',NULL,1,NULL,'2026-06-25 02:03:13.194','2026-06-25 02:09:09.939'),(2,'1010','Cash on Hand','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.201','2026-06-25 02:09:09.943'),(3,'1011','Petty Cash Fund','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.203','2026-06-25 02:09:09.944'),(4,'1020','Cash in Bank — BDO Checking','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.206','2026-06-25 02:09:09.946'),(5,'1021','Cash in Bank — BDO Savings','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.208','2026-06-25 02:09:09.948'),(6,'1022','Cash in Bank — BPI Checking','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.210','2026-06-25 02:09:09.950'),(7,'1023','Cash in Bank — Metrobank','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.212','2026-06-25 02:09:09.952'),(8,'1024','Cash in Bank — UnionBank (GCash)','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.214','2026-06-25 02:09:09.955'),(9,'1100','Accounts Receivable — Trade','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.216','2026-06-25 02:09:09.959'),(10,'1101','Allowance for Doubtful Accounts','ASSET','CREDIT',1,1,NULL,'2026-06-25 02:03:13.218','2026-06-25 02:09:09.962'),(11,'1102','Advances to Clients','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.221','2026-06-25 02:09:09.965'),(12,'1103','Notes Receivable','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.223','2026-06-25 02:09:09.968'),(13,'1104','Advances to Officers & Employees','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.225','2026-06-25 02:09:09.971'),(14,'1105','Dividends Receivable','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.227','2026-06-25 02:09:09.974'),(15,'1200','Inventories','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.229','2026-06-25 02:09:09.976'),(16,'1210','Merchandise Inventory — Retail','ASSET','DEBIT',15,1,NULL,'2026-06-25 02:03:13.230','2026-06-25 02:09:09.978'),(17,'1220','Advertising Materials Inventory','ASSET','DEBIT',15,1,NULL,'2026-06-25 02:03:13.232','2026-06-25 02:09:09.981'),(18,'1230','Production Supplies Inventory','ASSET','DEBIT',15,1,NULL,'2026-06-25 02:03:13.233','2026-06-25 02:09:09.983'),(19,'1240','Office Supplies Inventory','ASSET','DEBIT',15,1,NULL,'2026-06-25 02:03:13.235','2026-06-25 02:09:09.986'),(20,'1250','Goods in Transit','ASSET','DEBIT',15,1,NULL,'2026-06-25 02:03:13.238','2026-06-25 02:09:09.987'),(21,'1300','Prepaid Expenses','ASSET','DEBIT',1,1,NULL,'2026-06-25 02:03:13.240','2026-06-25 02:09:09.989'),(22,'1310','Prepaid Rent','ASSET','DEBIT',21,1,NULL,'2026-06-25 02:03:13.245','2026-06-25 02:09:09.991'),(23,'1320','Prepaid Insurance','ASSET','DEBIT',21,1,NULL,'2026-06-25 02:03:13.248','2026-06-25 02:09:09.993'),(24,'1330','Input VAT','ASSET','DEBIT',21,1,NULL,'2026-06-25 02:03:13.250','2026-06-25 02:09:09.996'),(25,'1340','Creditable Withholding Tax (CWT)','ASSET','DEBIT',21,1,NULL,'2026-06-25 02:03:13.252','2026-06-25 02:09:09.997'),(26,'1350','Prepaid Income Tax','ASSET','DEBIT',21,1,NULL,'2026-06-25 02:03:13.253','2026-06-25 02:09:09.999'),(27,'1360','Other Prepaid Expenses','ASSET','DEBIT',21,1,NULL,'2026-06-25 02:03:13.255','2026-06-25 02:09:10.001'),(28,'1500','Non-Current Assets','ASSET','DEBIT',NULL,1,NULL,'2026-06-25 02:03:13.256','2026-06-25 02:09:10.003'),(29,'1510','Property, Plant & Equipment','ASSET','DEBIT',28,1,NULL,'2026-06-25 02:03:13.258','2026-06-25 02:09:10.005'),(30,'1511','Land','ASSET','DEBIT',29,1,NULL,'2026-06-25 02:03:13.260','2026-06-25 02:09:10.007'),(31,'1512','Building','ASSET','DEBIT',29,1,NULL,'2026-06-25 02:03:13.261','2026-06-25 02:09:10.009'),(32,'1513','Office Furniture & Fixtures','ASSET','DEBIT',29,1,NULL,'2026-06-25 02:03:13.263','2026-06-25 02:09:10.011'),(33,'1514','Computer Equipment & Peripherals','ASSET','DEBIT',29,1,NULL,'2026-06-25 02:03:13.265','2026-06-25 02:09:10.013'),(34,'1515','Production & Studio Equipment','ASSET','DEBIT',29,1,NULL,'2026-06-25 02:03:13.268','2026-06-25 02:09:10.015'),(35,'1516','Transportation Equipment','ASSET','DEBIT',29,1,NULL,'2026-06-25 02:03:13.269','2026-06-25 02:09:10.017'),(36,'1517','Leasehold Improvements','ASSET','DEBIT',29,1,NULL,'2026-06-25 02:03:13.272','2026-06-25 02:09:10.019'),(37,'1518','Display & Retail Fixtures','ASSET','DEBIT',29,1,NULL,'2026-06-25 02:03:13.275','2026-06-25 02:09:10.021'),(38,'1520','Accumulated Depreciation','ASSET','CREDIT',28,1,NULL,'2026-06-25 02:03:13.280','2026-06-25 02:09:10.023'),(39,'1521','Accum Depr — Building','ASSET','CREDIT',38,1,NULL,'2026-06-25 02:03:13.285','2026-06-25 02:09:10.025'),(40,'1522','Accum Depr — Office Furniture','ASSET','CREDIT',38,1,NULL,'2026-06-25 02:03:13.286','2026-06-25 02:09:10.027'),(41,'1523','Accum Depr — Computer Equipment','ASSET','CREDIT',38,1,NULL,'2026-06-25 02:03:13.288','2026-06-25 02:09:10.028'),(42,'1524','Accum Depr — Production Equipment','ASSET','CREDIT',38,1,NULL,'2026-06-25 02:03:13.291','2026-06-25 02:09:10.030'),(43,'1525','Accum Depr — Transportation','ASSET','CREDIT',38,1,NULL,'2026-06-25 02:03:13.293','2026-06-25 02:09:10.032'),(44,'1526','Accum Depr — Leasehold Improvements','ASSET','CREDIT',38,1,NULL,'2026-06-25 02:03:13.294','2026-06-25 02:09:10.034'),(45,'1527','Accum Depr — Display Fixtures','ASSET','CREDIT',38,1,NULL,'2026-06-25 02:03:13.296','2026-06-25 02:09:10.036'),(46,'1530','Intangible Assets','ASSET','DEBIT',28,1,NULL,'2026-06-25 02:03:13.298','2026-06-25 02:09:10.038'),(47,'1531','Software & Licenses','ASSET','DEBIT',46,1,NULL,'2026-06-25 02:03:13.300','2026-06-25 02:09:10.040'),(48,'1532','Brand Assets & Trademarks','ASSET','DEBIT',46,1,NULL,'2026-06-25 02:03:13.302','2026-06-25 02:09:10.043'),(49,'1533','Website Development Costs','ASSET','DEBIT',46,1,NULL,'2026-06-25 02:03:13.304','2026-06-25 02:09:10.045'),(50,'1534','Accum Amortization — Intangibles','ASSET','CREDIT',46,1,NULL,'2026-06-25 02:03:13.306','2026-06-25 02:09:10.047'),(51,'1540','Security Deposits','ASSET','DEBIT',28,1,NULL,'2026-06-25 02:03:13.308','2026-06-25 02:09:10.049'),(52,'1550','Long-term Investments','ASSET','DEBIT',28,1,NULL,'2026-06-25 02:03:13.310','2026-06-25 02:09:10.051'),(53,'2000','Current Liabilities','LIABILITY','CREDIT',NULL,1,NULL,'2026-06-25 02:03:13.312','2026-06-25 02:09:10.052'),(54,'2010','Accounts Payable — Trade','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.314','2026-06-25 02:09:10.054'),(55,'2011','Accounts Payable — Media Suppliers','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.317','2026-06-25 02:09:10.056'),(56,'2012','Accounts Payable — Production','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.321','2026-06-25 02:09:10.058'),(57,'2020','Accrued Expenses','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.326','2026-06-25 02:09:10.060'),(58,'2021','Accrued Salaries & Wages','LIABILITY','CREDIT',57,1,NULL,'2026-06-25 02:03:13.330','2026-06-25 02:09:10.062'),(59,'2022','Accrued Rent','LIABILITY','CREDIT',57,1,NULL,'2026-06-25 02:03:13.333','2026-06-25 02:09:10.064'),(60,'2023','Accrued Utilities','LIABILITY','CREDIT',57,1,NULL,'2026-06-25 02:03:13.335','2026-06-25 02:09:10.066'),(61,'2024','Accrued Professional Fees','LIABILITY','CREDIT',57,1,NULL,'2026-06-25 02:03:13.336','2026-06-25 02:09:10.068'),(62,'2030','Output VAT Payable','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.338','2026-06-25 02:09:10.069'),(63,'2040','Withholding Tax — Compensation (1601-C)','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.340','2026-06-25 02:09:10.071'),(64,'2041','Withholding Tax — Expanded (1601-EQ)','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.341','2026-06-25 02:09:10.074'),(65,'2042','Withholding Tax — Final','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.344','2026-06-25 02:09:10.076'),(66,'2050','SSS Contributions Payable','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.345','2026-06-25 02:09:10.077'),(67,'2060','PhilHealth Contributions Payable','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.347','2026-06-25 02:09:10.079'),(68,'2070','Pag-IBIG Contributions Payable','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.348','2026-06-25 02:09:10.081'),(69,'2080','Income Tax Payable','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.350','2026-06-25 02:09:10.083'),(70,'2090','Customer Deposits & Advances','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.351','2026-06-25 02:09:10.084'),(71,'2091','Deferred Revenue — Retainers','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.353','2026-06-25 02:09:10.086'),(72,'2100','Short-term Notes Payable','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.355','2026-06-25 02:09:10.088'),(73,'2110','Current Portion — Long-term Debt','LIABILITY','CREDIT',53,1,NULL,'2026-06-25 02:03:13.356','2026-06-25 02:09:10.091'),(74,'2500','Non-Current Liabilities','LIABILITY','CREDIT',NULL,1,NULL,'2026-06-25 02:03:13.358','2026-06-25 02:09:10.092'),(75,'2510','Loans Payable — Long Term','LIABILITY','CREDIT',74,1,NULL,'2026-06-25 02:03:13.361','2026-06-25 02:09:10.094'),(76,'2520','Finance Lease Obligations','LIABILITY','CREDIT',74,1,NULL,'2026-06-25 02:03:13.365','2026-06-25 02:09:10.096'),(77,'2530','Retirement Benefit Obligation','LIABILITY','CREDIT',74,1,NULL,'2026-06-25 02:03:13.369','2026-06-25 02:09:10.098'),(78,'3000','Equity','EQUITY','CREDIT',NULL,1,NULL,'2026-06-25 02:03:13.372','2026-06-25 02:09:10.100'),(79,'3010','Share Capital / Owner\'s Capital','EQUITY','CREDIT',78,1,NULL,'2026-06-25 02:03:13.374','2026-06-25 02:09:10.101'),(80,'3020','Additional Paid-in Capital','EQUITY','CREDIT',78,1,NULL,'2026-06-25 02:03:13.376','2026-06-25 02:09:10.103'),(81,'3030','Retained Earnings','EQUITY','CREDIT',78,1,NULL,'2026-06-25 02:03:13.378','2026-06-25 02:09:10.105'),(82,'3040','Current Year Earnings','EQUITY','CREDIT',78,1,NULL,'2026-06-25 02:03:13.380','2026-06-25 02:09:10.107'),(83,'3050','Owner\'s Drawings','EQUITY','DEBIT',78,1,NULL,'2026-06-25 02:03:13.381','2026-06-25 02:09:10.109'),(84,'3060','Treasury Stock','EQUITY','DEBIT',78,1,NULL,'2026-06-25 02:03:13.383','2026-06-25 02:09:10.110'),(85,'4000','Revenue','REVENUE','CREDIT',NULL,1,NULL,'2026-06-25 02:03:13.385','2026-06-25 02:09:10.112'),(86,'4100','Advertising Services Revenue','REVENUE','CREDIT',85,1,NULL,'2026-06-25 02:03:13.387','2026-06-25 02:09:10.114'),(87,'4110','Creative Services','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.388','2026-06-25 02:09:10.116'),(88,'4120','Media Planning & Buying','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.390','2026-06-25 02:09:10.118'),(89,'4130','Digital Marketing Services','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.392','2026-06-25 02:09:10.119'),(90,'4131','Social Media Management','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.393','2026-06-25 02:09:10.122'),(91,'4132','SEO / SEM Services','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.395','2026-06-25 02:09:10.124'),(92,'4133','Email Marketing','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.397','2026-06-25 02:09:10.126'),(93,'4140','Print & Publication Advertising','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.400','2026-06-25 02:09:10.128'),(94,'4150','Outdoor / Billboard Advertising','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.403','2026-06-25 02:09:10.129'),(95,'4160','Events & Activations','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.407','2026-06-25 02:09:10.131'),(96,'4170','Production Services','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.410','2026-06-25 02:09:10.133'),(97,'4171','Video Production','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.411','2026-06-25 02:09:10.134'),(98,'4172','Photography Services','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.413','2026-06-25 02:09:10.136'),(99,'4173','Graphic Design','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.415','2026-06-25 02:09:10.139'),(100,'4180','Strategy & Brand Consultancy','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.416','2026-06-25 02:09:10.140'),(101,'4190','Agency Retainer Fees','REVENUE','CREDIT',86,1,NULL,'2026-06-25 02:03:13.418','2026-06-25 02:09:10.142'),(102,'4200','Retail Sales Revenue','REVENUE','CREDIT',85,1,NULL,'2026-06-25 02:03:13.420','2026-06-25 02:09:10.144'),(103,'4210','Merchandise Sales — Walk-in','REVENUE','CREDIT',102,1,NULL,'2026-06-25 02:03:13.422','2026-06-25 02:09:10.145'),(104,'4220','Online / E-commerce Sales','REVENUE','CREDIT',102,1,NULL,'2026-06-25 02:03:13.424','2026-06-25 02:09:10.147'),(105,'4230','Wholesale / Trade Sales','REVENUE','CREDIT',102,1,NULL,'2026-06-25 02:03:13.427','2026-06-25 02:09:10.149'),(106,'4240','Sales Discounts','REVENUE','DEBIT',102,1,NULL,'2026-06-25 02:03:13.429','2026-06-25 02:09:10.150'),(107,'4250','Sales Returns & Allowances','REVENUE','DEBIT',102,1,NULL,'2026-06-25 02:03:13.431','2026-06-25 02:09:10.152'),(108,'4300','Other Income','REVENUE','CREDIT',85,1,NULL,'2026-06-25 02:03:13.433','2026-06-25 02:09:10.154'),(109,'4310','Interest Income','REVENUE','CREDIT',108,1,NULL,'2026-06-25 02:03:13.435','2026-06-25 02:09:10.156'),(110,'4320','Rental Income','REVENUE','CREDIT',108,1,NULL,'2026-06-25 02:03:13.437','2026-06-25 02:09:10.158'),(111,'4330','Gain on Sale of Assets','REVENUE','CREDIT',108,1,NULL,'2026-06-25 02:03:13.439','2026-06-25 02:09:10.159'),(112,'4340','Foreign Exchange Gain','REVENUE','CREDIT',108,1,NULL,'2026-06-25 02:03:13.442','2026-06-25 02:09:10.161'),(113,'4350','Miscellaneous Income','REVENUE','CREDIT',108,1,NULL,'2026-06-25 02:03:13.445','2026-06-25 02:09:10.163'),(114,'5000','Cost of Sales','EXPENSE','DEBIT',NULL,1,NULL,'2026-06-25 02:03:13.449','2026-06-25 02:09:10.165'),(115,'5010','Cost of Goods Sold — Retail','EXPENSE','DEBIT',114,1,NULL,'2026-06-25 02:03:13.454','2026-06-25 02:09:10.167'),(116,'5011','Merchandise Purchase Cost','EXPENSE','DEBIT',115,1,NULL,'2026-06-25 02:03:13.457','2026-06-25 02:09:10.168'),(117,'5012','Freight-in / Landed Cost','EXPENSE','DEBIT',115,1,NULL,'2026-06-25 02:03:13.459','2026-06-25 02:09:10.170'),(118,'5013','Purchase Discounts','EXPENSE','CREDIT',115,1,NULL,'2026-06-25 02:03:13.461','2026-06-25 02:09:10.172'),(119,'5014','Purchase Returns & Allowances','EXPENSE','CREDIT',115,1,NULL,'2026-06-25 02:03:13.463','2026-06-25 02:09:10.173'),(120,'5020','Direct Advertising Production Costs','EXPENSE','DEBIT',114,1,NULL,'2026-06-25 02:03:13.465','2026-06-25 02:09:10.175'),(121,'5021','Advertising Materials Cost','EXPENSE','DEBIT',120,1,NULL,'2026-06-25 02:03:13.467','2026-06-25 02:09:10.176'),(122,'5022','Media Placement Costs','EXPENSE','DEBIT',120,1,NULL,'2026-06-25 02:03:13.468','2026-06-25 02:09:10.178'),(123,'5023','Direct Labor — Production','EXPENSE','DEBIT',120,1,NULL,'2026-06-25 02:03:13.470','2026-06-25 02:09:10.180'),(124,'5024','Subcontractor & Freelance Costs','EXPENSE','DEBIT',120,1,NULL,'2026-06-25 02:03:13.472','2026-06-25 02:09:10.182'),(125,'5025','Talent & Modeling Fees','EXPENSE','DEBIT',120,1,NULL,'2026-06-25 02:03:13.474','2026-06-25 02:09:10.184'),(126,'5026','Production Equipment Rental','EXPENSE','DEBIT',120,1,NULL,'2026-06-25 02:03:13.476','2026-06-25 02:09:10.185'),(127,'5027','Studio Rental','EXPENSE','DEBIT',120,1,NULL,'2026-06-25 02:03:13.477','2026-06-25 02:09:10.188'),(128,'5028','Photography & Videography','EXPENSE','DEBIT',120,1,NULL,'2026-06-25 02:03:13.479','2026-06-25 02:09:10.190'),(129,'5029','Printing & Reproduction Costs','EXPENSE','DEBIT',120,1,NULL,'2026-06-25 02:03:13.480','2026-06-25 02:09:10.192'),(130,'6000','Operating Expenses','EXPENSE','DEBIT',NULL,1,NULL,'2026-06-25 02:03:13.482','2026-06-25 02:09:10.194'),(131,'6100','Personnel Costs','EXPENSE','DEBIT',130,1,NULL,'2026-06-25 02:03:13.483','2026-06-25 02:09:10.195'),(132,'6110','Salaries and Wages','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.485','2026-06-25 02:09:10.197'),(133,'6111','Overtime Pay','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.486','2026-06-25 02:09:10.199'),(134,'6112','Holiday Pay','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.488','2026-06-25 02:09:10.201'),(135,'6113','Night Differential Pay','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.489','2026-06-25 02:09:10.202'),(136,'6120','SSS — Employer Share','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.491','2026-06-25 02:09:10.204'),(137,'6130','PhilHealth — Employer Share','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.493','2026-06-25 02:09:10.205'),(138,'6140','Pag-IBIG — Employer Share','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.494','2026-06-25 02:09:10.207'),(139,'6150','13th Month Pay','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.496','2026-06-25 02:09:10.209'),(140,'6151','Performance Bonus','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.497','2026-06-25 02:09:10.210'),(141,'6160','Employee Benefits & Allowances','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.499','2026-06-25 02:09:10.212'),(142,'6161','Rice Allowance','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.501','2026-06-25 02:09:10.214'),(143,'6162','Medical & HMO Benefits','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.503','2026-06-25 02:09:10.215'),(144,'6163','Transportation Allowance','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.505','2026-06-25 02:09:10.217'),(145,'6170','Recruitment & Training Costs','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.507','2026-06-25 02:09:10.218'),(146,'6180','Retirement Benefit Expense','EXPENSE','DEBIT',131,1,NULL,'2026-06-25 02:03:13.509','2026-06-25 02:09:10.220'),(147,'6200','Occupancy Costs','EXPENSE','DEBIT',130,1,NULL,'2026-06-25 02:03:13.512','2026-06-25 02:09:10.222'),(148,'6210','Rent Expense','EXPENSE','DEBIT',147,1,NULL,'2026-06-25 02:03:13.515','2026-06-25 02:09:10.223'),(149,'6220','Electricity Expense','EXPENSE','DEBIT',147,1,NULL,'2026-06-25 02:03:13.518','2026-06-25 02:09:10.225'),(150,'6230','Water & Sewerage Expense','EXPENSE','DEBIT',147,1,NULL,'2026-06-25 02:03:13.520','2026-06-25 02:09:10.226'),(151,'6240','Building Repairs & Maintenance','EXPENSE','DEBIT',147,1,NULL,'2026-06-25 02:03:13.522','2026-06-25 02:09:10.228'),(152,'6250','Janitorial & Security Services','EXPENSE','DEBIT',147,1,NULL,'2026-06-25 02:03:13.523','2026-06-25 02:09:10.230'),(153,'6300','Administrative Expenses','EXPENSE','DEBIT',130,1,NULL,'2026-06-25 02:03:13.525','2026-06-25 02:09:10.232'),(154,'6310','Internet & Telecommunications','EXPENSE','DEBIT',153,1,NULL,'2026-06-25 02:03:13.526','2026-06-25 02:09:10.234'),(155,'6311','Mobile & Data Plans','EXPENSE','DEBIT',153,1,NULL,'2026-06-25 02:03:13.528','2026-06-25 02:09:10.235'),(156,'6320','Office Supplies Expense','EXPENSE','DEBIT',153,1,NULL,'2026-06-25 02:03:13.529','2026-06-25 02:09:10.237'),(157,'6330','Postage & Delivery Expense','EXPENSE','DEBIT',153,1,NULL,'2026-06-25 02:03:13.531','2026-06-25 02:09:10.239'),(158,'6340','Depreciation Expense','EXPENSE','DEBIT',153,1,NULL,'2026-06-25 02:03:13.533','2026-06-25 02:09:10.240'),(159,'6341','Amortization Expense','EXPENSE','DEBIT',153,1,NULL,'2026-06-25 02:03:13.535','2026-06-25 02:09:10.242'),(160,'6350','Insurance Expense','EXPENSE','DEBIT',153,1,NULL,'2026-06-25 02:03:13.537','2026-06-25 02:09:10.244'),(161,'6360','Bank Charges & Service Fees','EXPENSE','DEBIT',153,1,NULL,'2026-06-25 02:03:13.539','2026-06-25 02:09:10.245'),(162,'6370','Licenses, Permits & Registration','EXPENSE','DEBIT',153,1,NULL,'2026-06-25 02:03:13.540','2026-06-25 02:09:10.247'),(163,'6380','Subscriptions & Memberships','EXPENSE','DEBIT',153,1,NULL,'2026-06-25 02:03:13.542','2026-06-25 02:09:10.249'),(164,'6390','Miscellaneous Expense','EXPENSE','DEBIT',153,1,NULL,'2026-06-25 02:03:13.544','2026-06-25 02:09:10.251'),(165,'6400','Professional & Legal Fees','EXPENSE','DEBIT',130,1,NULL,'2026-06-25 02:03:13.545','2026-06-25 02:09:10.252'),(166,'6410','Audit & Accounting Fees','EXPENSE','DEBIT',165,1,NULL,'2026-06-25 02:03:13.547','2026-06-25 02:09:10.254'),(167,'6420','Legal Fees','EXPENSE','DEBIT',165,1,NULL,'2026-06-25 02:03:13.548','2026-06-25 02:09:10.255'),(168,'6430','Management Consultancy Fees','EXPENSE','DEBIT',165,1,NULL,'2026-06-25 02:03:13.550','2026-06-25 02:09:10.257'),(169,'6440','IT & Technical Services','EXPENSE','DEBIT',165,1,NULL,'2026-06-25 02:03:13.551','2026-06-25 02:09:10.259'),(170,'6500','Sales & Marketing Expenses','EXPENSE','DEBIT',130,1,NULL,'2026-06-25 02:03:13.553','2026-06-25 02:09:10.262'),(171,'6510','Representation & Entertainment','EXPENSE','DEBIT',170,1,NULL,'2026-06-25 02:03:13.556','2026-06-25 02:09:10.265'),(172,'6520','Transportation & Travel','EXPENSE','DEBIT',170,1,NULL,'2026-06-25 02:03:13.557','2026-06-25 02:09:10.267'),(173,'6521','Airfare & Accommodation','EXPENSE','DEBIT',170,1,NULL,'2026-06-25 02:03:13.559','2026-06-25 02:09:10.269'),(174,'6530','Marketing & Promotions (Internal)','EXPENSE','DEBIT',170,1,NULL,'2026-06-25 02:03:13.561','2026-06-25 02:09:10.271'),(175,'6531','Social Media Advertising Spend','EXPENSE','DEBIT',170,1,NULL,'2026-06-25 02:03:13.562','2026-06-25 02:09:10.273'),(176,'6532','Trade Show & Exhibit Costs','EXPENSE','DEBIT',170,1,NULL,'2026-06-25 02:03:13.564','2026-06-25 02:09:10.276'),(177,'6540','Sales Commissions Expense','EXPENSE','DEBIT',170,1,NULL,'2026-06-25 02:03:13.566','2026-06-25 02:09:10.278'),(178,'6550','Bad Debts Expense','EXPENSE','DEBIT',170,1,NULL,'2026-06-25 02:03:13.569','2026-06-25 02:09:10.280'),(179,'6600','Finance Costs','EXPENSE','DEBIT',130,1,NULL,'2026-06-25 02:03:13.571','2026-06-25 02:09:10.282'),(180,'6610','Interest Expense','EXPENSE','DEBIT',179,1,NULL,'2026-06-25 02:03:13.573','2026-06-25 02:09:10.284'),(181,'6620','Foreign Exchange Loss','EXPENSE','DEBIT',179,1,NULL,'2026-06-25 02:03:13.577','2026-06-25 02:09:10.286'),(182,'6630','Loss on Sale of Assets','EXPENSE','DEBIT',179,1,NULL,'2026-06-25 02:03:13.583','2026-06-25 02:09:10.288'),(183,'6900','Income Tax Expense','EXPENSE','DEBIT',NULL,1,NULL,'2026-06-25 02:03:13.588','2026-06-25 02:09:10.290'),(184,'6910','Current Tax Expense','EXPENSE','DEBIT',183,1,NULL,'2026-06-25 02:03:13.590','2026-06-25 02:09:10.292'),(185,'6920','Deferred Tax Expense','EXPENSE','DEBIT',183,1,NULL,'2026-06-25 02:03:13.592','2026-06-25 02:09:10.294');
/*!40000 ALTER TABLE `accounts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `attachments`
--

DROP TABLE IF EXISTS `attachments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attachments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entity` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entityId` int NOT NULL,
  `fileName` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `originalName` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mimeType` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `size` int NOT NULL,
  `uploadedBy` int DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `attachments_entity_entityId_idx` (`entity`,`entityId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `attachments`
--

LOCK TABLES `attachments` WRITE;
/*!40000 ALTER TABLE `attachments` DISABLE KEYS */;
/*!40000 ALTER TABLE `attachments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int DEFAULT NULL,
  `userEmail` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entityId` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `summary` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `changes` json DEFAULT NULL,
  `ipAddress` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `userAgent` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `audit_logs_entity_entityId_idx` (`entity`,`entityId`),
  KEY `audit_logs_userId_idx` (`userId`),
  KEY `audit_logs_action_idx` (`action`),
  KEY `audit_logs_createdAt_idx` (`createdAt`),
  CONSTRAINT `audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` VALUES (1,2,'admin@ph-erp.com','PASSWORD_RESET_REQUEST','User','2','Password reset requested',NULL,'::1','curl/8.17.0','2026-06-27 08:47:51.640'),(2,2,'admin@ph-erp.com','LOGIN_FAILED','User','2','Failed login attempt 1/5',NULL,'::1','curl/8.17.0','2026-06-27 08:47:51.985'),(3,2,'admin@ph-erp.com','LOGIN_FAILED','User','2','Failed login attempt 2/5',NULL,'::1','curl/8.17.0','2026-06-27 08:48:19.136'),(4,2,'admin@ph-erp.com','LOGIN_FAILED','User','2','Failed login attempt 3/5',NULL,'::1','curl/8.17.0','2026-06-27 08:48:33.471'),(5,1,'marinella@ph-erp.com','CREATE','FixedAsset','1','Created asset FA-00001 — Test Laptop',NULL,'::1','curl/8.17.0','2026-06-27 09:17:19.316'),(6,1,'marinella@ph-erp.com','DEPRECIATE','FixedAsset','1','Recorded depreciation 5000 for FA-00001 (2026-01)',NULL,'::1','curl/8.17.0','2026-06-27 09:17:19.549');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bank_accounts`
--

DROP TABLE IF EXISTS `bank_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bank_accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bankName` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountNumber` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `glAccountId` int DEFAULT NULL,
  `currentBalance` decimal(15,2) NOT NULL DEFAULT '0.00',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bank_accounts`
--

LOCK TABLES `bank_accounts` WRITE;
/*!40000 ALTER TABLE `bank_accounts` DISABLE KEYS */;
/*!40000 ALTER TABLE `bank_accounts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bank_reconciliations`
--

DROP TABLE IF EXISTS `bank_reconciliations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bank_reconciliations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bankAccountId` int NOT NULL,
  `statementDate` date NOT NULL,
  `statementBalance` decimal(15,2) NOT NULL,
  `reconciledBalance` decimal(15,2) NOT NULL DEFAULT '0.00',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdBy` int DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `bank_reconciliations_bankAccountId_idx` (`bankAccountId`),
  CONSTRAINT `bank_reconciliations_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `bank_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bank_reconciliations`
--

LOCK TABLES `bank_reconciliations` WRITE;
/*!40000 ALTER TABLE `bank_reconciliations` DISABLE KEYS */;
/*!40000 ALTER TABLE `bank_reconciliations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bank_transactions`
--

DROP TABLE IF EXISTS `bank_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bank_transactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bankAccountId` int NOT NULL,
  `reconciliationId` int DEFAULT NULL,
  `txnDate` date NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount` decimal(15,2) NOT NULL,
  `type` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `isReconciled` tinyint(1) NOT NULL DEFAULT '0',
  `journalEntryId` int DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `bank_transactions_bankAccountId_idx` (`bankAccountId`),
  KEY `bank_transactions_reconciliationId_idx` (`reconciliationId`),
  CONSTRAINT `bank_transactions_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `bank_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `bank_transactions_reconciliationId_fkey` FOREIGN KEY (`reconciliationId`) REFERENCES `bank_reconciliations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bank_transactions`
--

LOCK TABLES `bank_transactions` WRITE;
/*!40000 ALTER TABLE `bank_transactions` DISABLE KEYS */;
/*!40000 ALTER TABLE `bank_transactions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bill_lines`
--

DROP TABLE IF EXISTS `bill_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bill_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `billId` int NOT NULL,
  `accountId` int NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(10,3) NOT NULL DEFAULT '1.000',
  `unitPrice` decimal(15,2) NOT NULL DEFAULT '0.00',
  `amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `vatCode` enum('VAT','EXEMPT','ZERO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'VAT',
  PRIMARY KEY (`id`),
  KEY `bill_lines_billId_idx` (`billId`),
  KEY `bill_lines_accountId_fkey` (`accountId`),
  CONSTRAINT `bill_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `bill_lines_billId_fkey` FOREIGN KEY (`billId`) REFERENCES `bills` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bill_lines`
--

LOCK TABLES `bill_lines` WRITE;
/*!40000 ALTER TABLE `bill_lines` DISABLE KEYS */;
/*!40000 ALTER TABLE `bill_lines` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bills`
--

DROP TABLE IF EXISTS `bills`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bills` (
  `id` int NOT NULL AUTO_INCREMENT,
  `billNo` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `vendorId` int NOT NULL,
  `billDate` date NOT NULL,
  `dueDate` date NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `subtotal` decimal(15,2) NOT NULL DEFAULT '0.00',
  `vatAmount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `totalAmount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `paidAmount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `status` enum('OPEN','PARTIAL','PAID','OVERDUE','VOID') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bills_billNo_key` (`billNo`),
  KEY `bills_vendorId_idx` (`vendorId`),
  KEY `bills_status_idx` (`status`),
  KEY `bills_dueDate_idx` (`dueDate`),
  CONSTRAINT `bills_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendors` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bills`
--

LOCK TABLES `bills` WRITE;
/*!40000 ALTER TABLE `bills` DISABLE KEYS */;
/*!40000 ALTER TABLE `bills` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `budget_lines`
--

DROP TABLE IF EXISTS `budget_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `budget_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `budgetId` int NOT NULL,
  `accountId` int NOT NULL,
  `annualAmount` decimal(15,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `budget_lines_budgetId_accountId_key` (`budgetId`,`accountId`),
  CONSTRAINT `budget_lines_budgetId_fkey` FOREIGN KEY (`budgetId`) REFERENCES `budgets` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `budget_lines`
--

LOCK TABLES `budget_lines` WRITE;
/*!40000 ALTER TABLE `budget_lines` DISABLE KEYS */;
/*!40000 ALTER TABLE `budget_lines` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `budgets`
--

DROP TABLE IF EXISTS `budgets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `budgets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fiscalYear` int NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdBy` int DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `budgets_name_fiscalYear_key` (`name`,`fiscalYear`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `budgets`
--

LOCK TABLES `budgets` WRITE;
/*!40000 ALTER TABLE `budgets` DISABLE KEYS */;
/*!40000 ALTER TABLE `budgets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `custom_reports`
--

DROP TABLE IF EXISTS `custom_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `custom_reports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `reportType` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `config` json NOT NULL,
  `createdBy` int NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `custom_reports_createdBy_idx` (`createdBy`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `custom_reports`
--

LOCK TABLES `custom_reports` WRITE;
/*!40000 ALTER TABLE `custom_reports` DISABLE KEYS */;
/*!40000 ALTER TABLE `custom_reports` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `customers`
--

DROP TABLE IF EXISTS `customers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customerCode` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tin` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `contactName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `customers_customerCode_key` (`customerCode`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customers`
--

LOCK TABLES `customers` WRITE;
/*!40000 ALTER TABLE `customers` DISABLE KEYS */;
INSERT INTO `customers` VALUES (1,'CUS-001','XYZ Corporation','987-654-321-000','BGC, Taguig, Metro Manila','Maria Santos','xyz@client.com','02-9876-5432',1,'2026-06-25 02:03:13.600','2026-06-25 02:03:13.600'),(2,'CUS-002','Sunrise Retail Group Inc.','876-543-210-000','Alabang, Muntinlupa City','Jose Mendoza','jose@sunrise.com','02-8888-1234',1,'2026-06-25 02:03:13.602','2026-06-25 02:03:13.602');
/*!40000 ALTER TABLE `customers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `daily_remittance_items`
--

DROP TABLE IF EXISTS `daily_remittance_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_remittance_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dailyRemittanceId` int NOT NULL,
  `category` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `meta` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `daily_remittance_items_dailyRemittanceId_idx` (`dailyRemittanceId`),
  KEY `daily_remittance_items_category_idx` (`category`),
  CONSTRAINT `daily_remittance_items_dailyRemittanceId_fkey` FOREIGN KEY (`dailyRemittanceId`) REFERENCES `daily_remittances` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `daily_remittance_items`
--

LOCK TABLES `daily_remittance_items` WRITE;
/*!40000 ALTER TABLE `daily_remittance_items` DISABLE KEYS */;
INSERT INTO `daily_remittance_items` VALUES (3,1,'EXPENSE','EV-000001','[CASH ADVANCE] Joshua Mercado — CA ',2000.00,'{\"type\":\"CASH_ADVANCE\",\"payee\":\"Joshua Mercado\",\"category\":\"MISCELLANEOUS\",\"status\":\"PAID\",\"requestedBy\":\"Beulah Dev\"}'),(4,1,'DISBURSEMENT','EV-000001','Paid — Joshua Mercado (EV-000001)',2000.00,'{\"type\":\"CASH_ADVANCE\",\"payee\":\"Joshua Mercado\",\"category\":\"MISCELLANEOUS\",\"paidBy\":\"Beulah Dev\"}');
/*!40000 ALTER TABLE `daily_remittance_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `daily_remittances`
--

DROP TABLE IF EXISTS `daily_remittances`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_remittances` (
  `id` int NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `totalSales` decimal(15,2) NOT NULL DEFAULT '0.00',
  `cashReceived` decimal(15,2) NOT NULL DEFAULT '0.00',
  `totalExpenses` decimal(15,2) NOT NULL DEFAULT '0.00',
  `cashDisbursed` decimal(15,2) NOT NULL DEFAULT '0.00',
  `netCash` decimal(15,2) NOT NULL DEFAULT '0.00',
  `vatCollected` decimal(15,2) NOT NULL DEFAULT '0.00',
  `status` enum('DRAFT','SUBMITTED','APPROVED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  `preparedBy` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approvedBy` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `daily_remittances_date_key` (`date`),
  KEY `daily_remittances_status_idx` (`status`),
  KEY `daily_remittances_date_idx` (`date`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `daily_remittances`
--

LOCK TABLES `daily_remittances` WRITE;
/*!40000 ALTER TABLE `daily_remittances` DISABLE KEYS */;
INSERT INTO `daily_remittances` VALUES (1,'2026-06-25',0.00,0.00,2000.00,2000.00,-2000.00,0.00,'APPROVED','Beulah Dev','Beulah Dev','','2026-06-25 03:14:50.192','2026-06-25 03:14:55.621');
/*!40000 ALTER TABLE `daily_remittances` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `depreciation_entries`
--

DROP TABLE IF EXISTS `depreciation_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `depreciation_entries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `assetId` int NOT NULL,
  `periodDate` date NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `bookValueAfter` decimal(15,2) NOT NULL,
  `journalEntryId` int DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `depreciation_entries_assetId_periodDate_key` (`assetId`,`periodDate`),
  CONSTRAINT `depreciation_entries_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `fixed_assets` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `depreciation_entries`
--

LOCK TABLES `depreciation_entries` WRITE;
/*!40000 ALTER TABLE `depreciation_entries` DISABLE KEYS */;
/*!40000 ALTER TABLE `depreciation_entries` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `employees`
--

DROP TABLE IF EXISTS `employees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employees` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employeeNo` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `firstName` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lastName` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `middleName` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `position` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tin` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sssNo` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `philhealthNo` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pagibigNo` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hireDate` date NOT NULL,
  `employmentType` enum('REGULAR','PROBATIONARY','CONTRACTUAL','PART_TIME') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'REGULAR',
  `payFrequency` enum('WEEKLY','SEMI_MONTHLY','MONTHLY') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SEMI_MONTHLY',
  `basicSalary` decimal(15,2) NOT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employees_employeeNo_key` (`employeeNo`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `employees`
--

LOCK TABLES `employees` WRITE;
/*!40000 ALTER TABLE `employees` DISABLE KEYS */;
INSERT INTO `employees` VALUES (1,'EMP-001','Juan','dela Cruz','B.','Accountant','Finance & Accounting','111-222-333-000','33-1234567-8','01-234567890-1','1234-5678-9012','2022-01-15','REGULAR','SEMI_MONTHLY',35000.00,1,'2026-06-25 02:03:13.605','2026-06-25 02:03:13.605'),(2,'EMP-002','Anna','Reyes','C.','Creative Director','Creative','222-333-444-000','33-9876543-2','01-987654321-0','9876-5432-1098','2021-06-01','REGULAR','SEMI_MONTHLY',55000.00,1,'2026-06-25 02:03:13.608','2026-06-25 02:03:13.608');
/*!40000 ALTER TABLE `employees` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `expense_voucher_items`
--

DROP TABLE IF EXISTS `expense_voucher_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expense_voucher_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `voucherId` int NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `accountId` int DEFAULT NULL,
  `amount` decimal(15,2) NOT NULL,
  `receiptNo` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `expense_voucher_items_voucherId_idx` (`voucherId`),
  KEY `expense_voucher_items_accountId_fkey` (`accountId`),
  CONSTRAINT `expense_voucher_items_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `expense_voucher_items_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `expense_vouchers` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `expense_voucher_items`
--

LOCK TABLES `expense_voucher_items` WRITE;
/*!40000 ALTER TABLE `expense_voucher_items` DISABLE KEYS */;
INSERT INTO `expense_voucher_items` VALUES (1,1,'Cash Advanced Joshua',164,2000.00,NULL),(2,2,'Ruler',123,199.97,NULL);
/*!40000 ALTER TABLE `expense_voucher_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `expense_vouchers`
--

DROP TABLE IF EXISTS `expense_vouchers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expense_vouchers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `voucherNo` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` enum('PETTY_CASH','REIMBURSEMENT','DIRECT_PAYMENT','CASH_ADVANCE','LIQUIDATION') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PETTY_CASH',
  `date` date NOT NULL,
  `payee` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `purpose` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `totalAmount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `receiptNo` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('DRAFT','SUBMITTED','APPROVED','PAID','REJECTED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  `requestedBy` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approvedBy` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `paidDate` date DEFAULT NULL,
  `paidBy` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rejectedReason` text COLLATE utf8mb4_unicode_ci,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `expense_vouchers_voucherNo_key` (`voucherNo`),
  KEY `expense_vouchers_date_idx` (`date`),
  KEY `expense_vouchers_status_idx` (`status`),
  KEY `expense_vouchers_type_idx` (`type`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `expense_vouchers`
--

LOCK TABLES `expense_vouchers` WRITE;
/*!40000 ALTER TABLE `expense_vouchers` DISABLE KEYS */;
INSERT INTO `expense_vouchers` VALUES (1,'EV-000001','CASH_ADVANCE','2026-06-25','Joshua Mercado','MISCELLANEOUS','CA ',2000.00,'','PAID','Beulah Dev','Beulah Dev','2026-06-25','Beulah Dev',NULL,'','2026-06-25 03:11:33.299','2026-06-25 03:12:34.732'),(2,'EV-000002','DIRECT_PAYMENT','2026-06-25','Cyd Liquit','UTILITIES','Palit Ruler',199.97,'','PAID','Beulah Dev','Beulah Dev','2026-06-25','Beulah Dev',NULL,'','2026-06-25 03:18:41.965','2026-06-25 03:19:35.396');
/*!40000 ALTER TABLE `expense_vouchers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `fixed_assets`
--

DROP TABLE IF EXISTS `fixed_assets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fixed_assets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `assetCode` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `acquisitionDate` date NOT NULL,
  `cost` decimal(15,2) NOT NULL,
  `salvageValue` decimal(15,2) NOT NULL DEFAULT '0.00',
  `usefulLifeMonths` int NOT NULL,
  `method` enum('STRAIGHT_LINE','DECLINING_BALANCE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'STRAIGHT_LINE',
  `decliningRate` decimal(7,4) DEFAULT NULL,
  `accumulatedDepreciation` decimal(15,2) NOT NULL DEFAULT '0.00',
  `bookValue` decimal(15,2) NOT NULL,
  `status` enum('ACTIVE','FULLY_DEPRECIATED','DISPOSED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
  `assetAccountId` int DEFAULT NULL,
  `depreciationExpenseAccountId` int DEFAULT NULL,
  `accumulatedDepreciationAccountId` int DEFAULT NULL,
  `disposalDate` date DEFAULT NULL,
  `disposalAmount` decimal(15,2) DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fixed_assets_assetCode_key` (`assetCode`),
  KEY `fixed_assets_status_idx` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `fixed_assets`
--

LOCK TABLES `fixed_assets` WRITE;
/*!40000 ALTER TABLE `fixed_assets` DISABLE KEYS */;
/*!40000 ALTER TABLE `fixed_assets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inventory_categories`
--

DROP TABLE IF EXISTS `inventory_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` enum('PRODUCT','MATERIAL','SUPPLY','ASSET') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PRODUCT',
  `description` text COLLATE utf8mb4_unicode_ci,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inventory_categories`
--

LOCK TABLES `inventory_categories` WRITE;
/*!40000 ALTER TABLE `inventory_categories` DISABLE KEYS */;
INSERT INTO `inventory_categories` VALUES (1,'Retail Products','PRODUCT','Merchandise for direct retail sale',1,'2026-06-25 02:03:13.612','2026-06-25 02:03:13.612'),(2,'Advertising Materials','MATERIAL','Printed ads, banners, collaterals, flyers',1,'2026-06-25 02:03:13.615','2026-06-25 02:03:13.615'),(3,'Production Supplies','SUPPLY','Raw materials and consumables used in production',1,'2026-06-25 02:03:13.617','2026-06-25 02:03:13.617'),(4,'Office Supplies','SUPPLY','General office consumables',1,'2026-06-25 02:03:13.619','2026-06-25 02:03:13.619'),(5,'Promotional Assets','ASSET','Display units, booth equipment, demo assets',1,'2026-06-25 02:03:13.621','2026-06-25 02:03:13.621'),(6,'Digital Assets','ASSET','Licensed digital media, stock footage, templates',1,'2026-06-25 02:03:13.624','2026-06-25 02:03:13.624');
/*!40000 ALTER TABLE `inventory_categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inventory_items`
--

DROP TABLE IF EXISTS `inventory_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sku` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `categoryId` int DEFAULT NULL,
  `unit` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pcs',
  `costPrice` decimal(15,2) NOT NULL DEFAULT '0.00',
  `sellingPrice` decimal(15,2) NOT NULL DEFAULT '0.00',
  `currentStock` decimal(12,3) NOT NULL DEFAULT '0.000',
  `reorderLevel` decimal(12,3) NOT NULL DEFAULT '0.000',
  `warehouseLocation` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `inventoryAccountId` int DEFAULT NULL,
  `cogsAccountId` int DEFAULT NULL,
  `revenueAccountId` int DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inventory_items_sku_key` (`sku`),
  KEY `inventory_items_sku_idx` (`sku`),
  KEY `inventory_items_categoryId_idx` (`categoryId`),
  KEY `inventory_items_inventoryAccountId_fkey` (`inventoryAccountId`),
  KEY `inventory_items_cogsAccountId_fkey` (`cogsAccountId`),
  KEY `inventory_items_revenueAccountId_fkey` (`revenueAccountId`),
  CONSTRAINT `inventory_items_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `inventory_categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_items_cogsAccountId_fkey` FOREIGN KEY (`cogsAccountId`) REFERENCES `accounts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_items_inventoryAccountId_fkey` FOREIGN KEY (`inventoryAccountId`) REFERENCES `accounts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_items_revenueAccountId_fkey` FOREIGN KEY (`revenueAccountId`) REFERENCES `accounts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inventory_items`
--

LOCK TABLES `inventory_items` WRITE;
/*!40000 ALTER TABLE `inventory_items` DISABLE KEYS */;
/*!40000 ALTER TABLE `inventory_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inventory_transactions`
--

DROP TABLE IF EXISTS `inventory_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_transactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `txnNo` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `itemId` int NOT NULL,
  `type` enum('IN','OUT','ADJUSTMENT','RETURN_IN','RETURN_OUT') COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(12,3) NOT NULL,
  `unitCost` decimal(15,2) NOT NULL DEFAULT '0.00',
  `totalCost` decimal(15,2) NOT NULL DEFAULT '0.00',
  `runningStock` decimal(12,3) NOT NULL DEFAULT '0.000',
  `reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `txnDate` date NOT NULL,
  `createdBy` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `inventory_transactions_txnNo_key` (`txnNo`),
  KEY `inventory_transactions_itemId_idx` (`itemId`),
  KEY `inventory_transactions_txnDate_idx` (`txnDate`),
  KEY `inventory_transactions_type_idx` (`type`),
  CONSTRAINT `inventory_transactions_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inventory_transactions`
--

LOCK TABLES `inventory_transactions` WRITE;
/*!40000 ALTER TABLE `inventory_transactions` DISABLE KEYS */;
/*!40000 ALTER TABLE `inventory_transactions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `invoice_lines`
--

DROP TABLE IF EXISTS `invoice_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invoice_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `invoiceId` int NOT NULL,
  `accountId` int NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(10,3) NOT NULL DEFAULT '1.000',
  `unitPrice` decimal(15,2) NOT NULL DEFAULT '0.00',
  `amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `vatCode` enum('VAT','EXEMPT','ZERO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'VAT',
  PRIMARY KEY (`id`),
  KEY `invoice_lines_invoiceId_idx` (`invoiceId`),
  KEY `invoice_lines_accountId_fkey` (`accountId`),
  CONSTRAINT `invoice_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `invoice_lines_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `invoice_lines`
--

LOCK TABLES `invoice_lines` WRITE;
/*!40000 ALTER TABLE `invoice_lines` DISABLE KEYS */;
/*!40000 ALTER TABLE `invoice_lines` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `invoices`
--

DROP TABLE IF EXISTS `invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invoices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `invoiceNo` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customerId` int NOT NULL,
  `invoiceDate` date NOT NULL,
  `dueDate` date NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `subtotal` decimal(15,2) NOT NULL DEFAULT '0.00',
  `vatAmount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `totalAmount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `paidAmount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `status` enum('OPEN','PARTIAL','PAID','OVERDUE','VOID') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `invoices_invoiceNo_key` (`invoiceNo`),
  KEY `invoices_customerId_idx` (`customerId`),
  KEY `invoices_status_idx` (`status`),
  KEY `invoices_dueDate_idx` (`dueDate`),
  CONSTRAINT `invoices_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `invoices`
--

LOCK TABLES `invoices` WRITE;
/*!40000 ALTER TABLE `invoices` DISABLE KEYS */;
/*!40000 ALTER TABLE `invoices` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `journal_entries`
--

DROP TABLE IF EXISTS `journal_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `journal_entries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entryNo` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entryDate` date NOT NULL,
  `reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('DRAFT','POSTED','VOIDED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  `createdBy` int NOT NULL,
  `postedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `journal_entries_entryNo_key` (`entryNo`),
  KEY `journal_entries_entryDate_idx` (`entryDate`),
  KEY `journal_entries_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `journal_entries`
--

LOCK TABLES `journal_entries` WRITE;
/*!40000 ALTER TABLE `journal_entries` DISABLE KEYS */;
/*!40000 ALTER TABLE `journal_entries` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `journal_lines`
--

DROP TABLE IF EXISTS `journal_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `journal_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entryId` int NOT NULL,
  `accountId` int NOT NULL,
  `debit` decimal(15,2) NOT NULL DEFAULT '0.00',
  `credit` decimal(15,2) NOT NULL DEFAULT '0.00',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lineOrder` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `journal_lines_entryId_idx` (`entryId`),
  KEY `journal_lines_accountId_idx` (`accountId`),
  CONSTRAINT `journal_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `journal_lines_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `journal_entries` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `journal_lines`
--

LOCK TABLES `journal_lines` WRITE;
/*!40000 ALTER TABLE `journal_lines` DISABLE KEYS */;
/*!40000 ALTER TABLE `journal_lines` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payments_ap`
--

DROP TABLE IF EXISTS `payments_ap`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payments_ap` (
  `id` int NOT NULL AUTO_INCREMENT,
  `paymentNo` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `billId` int NOT NULL,
  `paymentDate` date NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `paymentMethod` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `payments_ap_paymentNo_key` (`paymentNo`),
  KEY `payments_ap_billId_idx` (`billId`),
  CONSTRAINT `payments_ap_billId_fkey` FOREIGN KEY (`billId`) REFERENCES `bills` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payments_ap`
--

LOCK TABLES `payments_ap` WRITE;
/*!40000 ALTER TABLE `payments_ap` DISABLE KEYS */;
/*!40000 ALTER TABLE `payments_ap` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payments_ar`
--

DROP TABLE IF EXISTS `payments_ar`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payments_ar` (
  `id` int NOT NULL AUTO_INCREMENT,
  `paymentNo` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `invoiceId` int NOT NULL,
  `paymentDate` date NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `paymentMethod` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `payments_ar_paymentNo_key` (`paymentNo`),
  KEY `payments_ar_invoiceId_idx` (`invoiceId`),
  CONSTRAINT `payments_ar_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payments_ar`
--

LOCK TABLES `payments_ar` WRITE;
/*!40000 ALTER TABLE `payments_ar` DISABLE KEYS */;
/*!40000 ALTER TABLE `payments_ar` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payroll_items`
--

DROP TABLE IF EXISTS `payroll_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `periodId` int NOT NULL,
  `employeeId` int NOT NULL,
  `basicPay` decimal(15,2) NOT NULL,
  `allowances` decimal(15,2) NOT NULL DEFAULT '0.00',
  `overtimePay` decimal(15,2) NOT NULL DEFAULT '0.00',
  `grossPay` decimal(15,2) NOT NULL,
  `sssEmployee` decimal(15,2) NOT NULL DEFAULT '0.00',
  `sssEmployer` decimal(15,2) NOT NULL DEFAULT '0.00',
  `philhealthEe` decimal(15,2) NOT NULL DEFAULT '0.00',
  `philhealthEr` decimal(15,2) NOT NULL DEFAULT '0.00',
  `pagibigEe` decimal(15,2) NOT NULL DEFAULT '0.00',
  `pagibigEr` decimal(15,2) NOT NULL DEFAULT '0.00',
  `withholdingTax` decimal(15,2) NOT NULL DEFAULT '0.00',
  `totalDeductions` decimal(15,2) NOT NULL,
  `netPay` decimal(15,2) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `payroll_items_periodId_employeeId_key` (`periodId`,`employeeId`),
  KEY `payroll_items_periodId_idx` (`periodId`),
  KEY `payroll_items_employeeId_idx` (`employeeId`),
  CONSTRAINT `payroll_items_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `payroll_items_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `payroll_periods` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payroll_items`
--

LOCK TABLES `payroll_items` WRITE;
/*!40000 ALTER TABLE `payroll_items` DISABLE KEYS */;
/*!40000 ALTER TABLE `payroll_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payroll_periods`
--

DROP TABLE IF EXISTS `payroll_periods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_periods` (
  `id` int NOT NULL AUTO_INCREMENT,
  `periodName` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `startDate` date NOT NULL,
  `endDate` date NOT NULL,
  `payDate` date NOT NULL,
  `status` enum('OPEN','COMPUTED','APPROVED','PAID') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `payroll_periods_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payroll_periods`
--

LOCK TABLES `payroll_periods` WRITE;
/*!40000 ALTER TABLE `payroll_periods` DISABLE KEYS */;
/*!40000 ALTER TABLE `payroll_periods` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `purchase_order_lines`
--

DROP TABLE IF EXISTS `purchase_order_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_order_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `poId` int NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(15,2) NOT NULL,
  `unitPrice` decimal(15,2) NOT NULL,
  `receivedQty` decimal(15,2) NOT NULL DEFAULT '0.00',
  `amount` decimal(15,2) NOT NULL,
  `accountId` int DEFAULT NULL,
  `lineOrder` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `purchase_order_lines_poId_idx` (`poId`),
  CONSTRAINT `purchase_order_lines_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_order_lines`
--

LOCK TABLES `purchase_order_lines` WRITE;
/*!40000 ALTER TABLE `purchase_order_lines` DISABLE KEYS */;
/*!40000 ALTER TABLE `purchase_order_lines` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `purchase_orders`
--

DROP TABLE IF EXISTS `purchase_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `poNumber` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `vendorId` int NOT NULL,
  `orderDate` date NOT NULL,
  `expectedDate` date DEFAULT NULL,
  `status` enum('DRAFT','SENT','PARTIAL','RECEIVED','BILLED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `subtotal` decimal(15,2) NOT NULL DEFAULT '0.00',
  `taxAmount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `total` decimal(15,2) NOT NULL DEFAULT '0.00',
  `billId` int DEFAULT NULL,
  `createdBy` int DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `purchase_orders_poNumber_key` (`poNumber`),
  KEY `purchase_orders_vendorId_idx` (`vendorId`),
  KEY `purchase_orders_status_idx` (`status`),
  CONSTRAINT `purchase_orders_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendors` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_orders`
--

LOCK TABLES `purchase_orders` WRITE;
/*!40000 ALTER TABLE `purchase_orders` DISABLE KEYS */;
/*!40000 ALTER TABLE `purchase_orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `recurring_templates`
--

DROP TABLE IF EXISTS `recurring_templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recurring_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'JOURNAL',
  `frequency` enum('WEEKLY','MONTHLY','QUARTERLY','ANNUALLY') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MONTHLY',
  `startDate` date NOT NULL,
  `endDate` date DEFAULT NULL,
  `nextRunDate` date NOT NULL,
  `lastRunDate` datetime(3) DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reference` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payload` json NOT NULL,
  `createdBy` int DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `recurring_templates_isActive_nextRunDate_idx` (`isActive`,`nextRunDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `recurring_templates`
--

LOCK TABLES `recurring_templates` WRITE;
/*!40000 ALTER TABLE `recurring_templates` DISABLE KEYS */;
/*!40000 ALTER TABLE `recurring_templates` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `remittance_details`
--

DROP TABLE IF EXISTS `remittance_details`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `remittance_details` (
  `id` int NOT NULL AUTO_INCREMENT,
  `remittancePeriodId` int NOT NULL,
  `employeeId` int NOT NULL,
  `employeeShare` decimal(15,2) NOT NULL DEFAULT '0.00',
  `employerShare` decimal(15,2) NOT NULL DEFAULT '0.00',
  `totalContribution` decimal(15,2) NOT NULL DEFAULT '0.00',
  `grossCompensation` decimal(15,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `remittance_details_remittancePeriodId_employeeId_key` (`remittancePeriodId`,`employeeId`),
  KEY `remittance_details_remittancePeriodId_idx` (`remittancePeriodId`),
  KEY `remittance_details_employeeId_idx` (`employeeId`),
  CONSTRAINT `remittance_details_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `remittance_details_remittancePeriodId_fkey` FOREIGN KEY (`remittancePeriodId`) REFERENCES `remittance_periods` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `remittance_details`
--

LOCK TABLES `remittance_details` WRITE;
/*!40000 ALTER TABLE `remittance_details` DISABLE KEYS */;
/*!40000 ALTER TABLE `remittance_details` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `remittance_periods`
--

DROP TABLE IF EXISTS `remittance_periods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `remittance_periods` (
  `id` int NOT NULL AUTO_INCREMENT,
  `type` enum('SSS','PHILHEALTH','PAGIBIG','BIR_1601C') COLLATE utf8mb4_unicode_ci NOT NULL,
  `periodMonth` int NOT NULL,
  `periodYear` int NOT NULL,
  `dueDate` date NOT NULL,
  `totalEmployeeShare` decimal(15,2) NOT NULL DEFAULT '0.00',
  `totalEmployerShare` decimal(15,2) NOT NULL DEFAULT '0.00',
  `totalAmount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `status` enum('DRAFT','FILED','PAID','OVERDUE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  `referenceNo` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `filedDate` date DEFAULT NULL,
  `paidDate` date DEFAULT NULL,
  `paidAmount` decimal(15,2) DEFAULT NULL,
  `penalty` decimal(15,2) NOT NULL DEFAULT '0.00',
  `isManual` tinyint(1) NOT NULL DEFAULT '0',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `remittance_periods_type_periodMonth_periodYear_key` (`type`,`periodMonth`,`periodYear`),
  KEY `remittance_periods_status_idx` (`status`),
  KEY `remittance_periods_dueDate_idx` (`dueDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `remittance_periods`
--

LOCK TABLES `remittance_periods` WRITE;
/*!40000 ALTER TABLE `remittance_periods` DISABLE KEYS */;
/*!40000 ALTER TABLE `remittance_periods` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `system_settings`
--

DROP TABLE IF EXISTS `system_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `system_settings_key_key` (`key`)
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `system_settings`
--

LOCK TABLES `system_settings` WRITE;
/*!40000 ALTER TABLE `system_settings` DISABLE KEYS */;
INSERT INTO `system_settings` VALUES (1,'companyCity','Tagum City','2026-06-25 02:23:06.947'),(2,'companyProvince','Davao','2026-06-25 02:23:06.947'),(3,'companyLogo','data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgcm9sZT0iaW1nIj4KICA8dGl0bGU+RmluYXJhIEljb248L3RpdGxlPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iIzFlM2E4YSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiMxZDRlZDgiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSIxMjAiIGhlaWdodD0iMTIwIiByeD0iMjQiIGZpbGw9InVybCgjZykiLz4KICA8cmVjdCB4PSIyMiIgeT0iNzgiIHdpZHRoPSIyMCIgaGVpZ2h0PSIyNiIgcng9IjQiIGZpbGw9IndoaXRlIi8+CiAgPHJlY3QgeD0iNTAiIHk9IjU4IiB3aWR0aD0iMjAiIGhlaWdodD0iNDYiIHJ4PSI0IiBmaWxsPSJ3aGl0ZSIvPgogIDxyZWN0IHg9Ijc4IiB5PSIzMiIgd2lkdGg9IjIwIiBoZWlnaHQ9IjcyIiByeD0iNCIgZmlsbD0id2hpdGUiLz4KICA8cG9seWxpbmUgcG9pbnRzPSIzMiw3OCA2MCw1OCA4OCwzMiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1vcGFjaXR5PSIwLjM1IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KICA8Y2lyY2xlIGN4PSI4OCIgY3k9IjMyIiByPSI2IiBmaWxsPSIjNjBhNWZhIi8+CiAgPGNpcmNsZSBjeD0iODgiIGN5PSIzMiIgcj0iMyIgZmlsbD0id2hpdGUiLz4KPC9zdmc+Cg==','2026-06-25 02:23:06.947'),(4,'dateFormat','MM/DD/YYYY','2026-06-25 02:23:06.948'),(5,'currency','PHP','2026-06-25 02:23:06.947'),(6,'sssErRate','9.5','2026-06-25 02:23:06.948'),(7,'companyEmail','bhagohsoftwaredeveloper@gmail.com','2026-06-25 02:23:06.947'),(8,'birFormType','2550M','2026-06-25 02:23:06.947'),(9,'vatRegistered','false','2026-06-25 02:23:06.947'),(10,'fiscalYearStart','01','2026-06-25 02:23:06.947'),(11,'invoicePrefix','INV','2026-06-25 02:23:06.949'),(12,'vatRegDate','','2026-06-25 02:23:06.947'),(13,'companyWebsite','https://rebphil.com/','2026-06-25 02:23:06.947'),(14,'jeNextNo','1000','2026-06-25 02:23:06.950'),(15,'billPrefix','BILL','2026-06-25 02:23:06.949'),(16,'companyZip','8100','2026-06-25 02:23:06.947'),(17,'systemTimezone','Asia/Manila','2026-06-25 02:23:06.950'),(18,'invoiceNextNo','1000','2026-06-25 02:23:06.949'),(19,'taxExemptionCode','ME','2026-06-25 02:23:06.949'),(20,'payrollCutoff1','15','2026-06-25 02:23:06.948'),(21,'decimalPlaces','2','2026-06-25 02:23:06.950'),(22,'paymentPrefix','PAY','2026-06-25 02:23:06.950'),(23,'showCentsInReports','true','2026-06-25 02:23:06.950'),(24,'philhealthRate','5','2026-06-25 02:23:06.949'),(25,'auditTrail','true','2026-06-25 02:23:06.950'),(26,'enforceStrongPwd','true','2026-06-25 02:23:06.950'),(27,'pagibigErRate','2','2026-06-25 02:23:06.949'),(28,'accountingMethod','ACCRUAL','2026-06-25 02:23:06.947'),(29,'companyName','Finara Accounting ERP','2026-06-25 02:23:06.947'),(30,'jePrefix','JE','2026-06-25 02:23:06.950'),(31,'rdoCode','','2026-06-25 02:23:06.947'),(32,'sessionTimeout','480','2026-06-25 02:23:06.950'),(33,'companyAddress','Lot 1 Blk 1, Maximo Village','2026-06-25 02:23:06.947'),(34,'companyPhone','','2026-06-25 02:23:06.947'),(35,'companyTin','','2026-06-25 02:23:06.947'),(36,'payrollCutoff2','30','2026-06-25 02:23:06.948'),(37,'billNextNo','1000','2026-06-25 02:23:06.949');
/*!40000 ALTER TABLE `system_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `firstName` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lastName` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('ADMIN','MANAGER','ACCOUNTANT','VIEWER') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACCOUNTANT',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `lastLoginAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `failedLoginAttempts` int NOT NULL DEFAULT '0',
  `lockedUntil` datetime(3) DEFAULT NULL,
  `resetToken` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resetTokenExpiry` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_key` (`email`),
  KEY `users_email_idx` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'marinella@ph-erp.com','$2a$12$43nVJpU5M1MV9d7xTANhme2W7JypO0MQv6KtNLikaO4rQiInTeTQW','Marinella','Antipuesto','ADMIN',1,NULL,'2026-06-25 02:00:05.888','2026-06-25 02:00:05.888',0,NULL,NULL,NULL),(2,'admin@ph-erp.com','$2a$12$XfbsiIaZHulTo6Y.eJvatOKUZUExVtHAiNW64kBLNw4omtp0W3AE6','Beulah','Dev','ADMIN',1,'2026-06-25 02:10:47.906','2026-06-25 02:00:41.664','2026-06-27 08:50:44.380',0,NULL,'e4f410dd92d144c036bbe4c56bd02921fa501bd585a4674b48f996418f8a1157','2026-06-27 09:47:51.634'),(3,'manager@ph-erp.com','$2a$12$sy2v.n5WSFd/udKKPf3IWeCf5pgK2uUaSY6yeAfTbiiUi03FYB9Pq','Junah Marie','Cristobal','MANAGER',1,'2026-06-25 03:16:26.393','2026-06-25 03:16:08.784','2026-06-25 03:16:26.394',0,NULL,NULL,NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `vendors`
--

DROP TABLE IF EXISTS `vendors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `vendorCode` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tin` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `contactName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `vendors_vendorCode_key` (`vendorCode`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `vendors`
--

LOCK TABLES `vendors` WRITE;
/*!40000 ALTER TABLE `vendors` DISABLE KEYS */;
INSERT INTO `vendors` VALUES (1,'VEN-001','ABC Office Supplies Inc.','123-456-789-000','Makati City, Metro Manila','Juan Cruz','abc@supplier.com','02-1234-5678',1,'2026-06-25 02:03:13.594','2026-06-25 02:03:13.594'),(2,'VEN-002','MediaMax Philippines Corp.','234-567-890-000','Ortigas Center, Pasig City','Maria Reyes','media@mediamax.com.ph','02-8765-4321',1,'2026-06-25 02:03:13.598','2026-06-25 02:03:13.598');
/*!40000 ALTER TABLE `vendors` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'ph_erp_db'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-27 17:25:29
