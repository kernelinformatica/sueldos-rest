-- Migration: create global audit table
CREATE TABLE IF NOT EXISTS `auditoria_global` (
  `audit_id` BIGINT NOT NULL AUTO_INCREMENT,
  `empresa_id` INT(11) DEFAULT NULL,
  `usuario_id` INT(11) DEFAULT NULL,
  `table_name` VARCHAR(128) NOT NULL,
  `pk_name` VARCHAR(128) NOT NULL,
  `pk_value` VARCHAR(255) NOT NULL,
  `action` ENUM('create','update','delete') NOT NULL,
  `old_values` JSON DEFAULT NULL,
  `new_values` JSON DEFAULT NULL,
  `reason` VARCHAR(250) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`audit_id`),
  KEY `idx_audit_empresa` (`empresa_id`),
  KEY `idx_audit_table` (`table_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish_ci;
