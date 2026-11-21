CREATE TABLE IF NOT EXISTS munetios_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL UNIQUE,
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS munetios_google_identities (
  account_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  subject VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS munetios_verified_recovery (
  account_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  INDEX munetios_recovery_by_email (email),
  FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS munetios_retired_addresses (
  email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL PRIMARY KEY,
  account_id BIGINT UNSIGNED NULL,
  FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS munetios_password_resets (
  email VARCHAR(254) NOT NULL PRIMARY KEY,
  code_hash CHAR(64) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  sent_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS munetios_mail_aliases (
  account_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  address VARCHAR(254) NOT NULL UNIQUE,
  FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS munetios_email_codes (
  email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL PRIMARY KEY,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  sent_at DATETIME NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS munetios_mailboxes (
  account_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  CONSTRAINT mailbox_account FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS munetios_mail_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  direction ENUM('inbox', 'sent') NOT NULL,
  message_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender VARCHAR(254) NOT NULL,
  recipient VARCHAR(254) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY mail_deduplication (account_id, direction, message_key),
  KEY mail_folder (account_id, direction, id),
  CONSTRAINT mail_message_account FOREIGN KEY (account_id) REFERENCES munetios_mailboxes(account_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS munetios_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX sessions_expiry (expires_at),
  CONSTRAINT sessions_account FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- End-to-end encryption: the data key is wrapped in the browser with a key
-- derived from the password. The server only ever stores the wrapped form.
CREATE TABLE IF NOT EXISTS munetios_mail_html (
  message_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  html MEDIUMTEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES munetios_mail_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS munetios_account_keys (
  account_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  kdf_salt CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  wrap_iv CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  wrapped_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sync_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT keys_account FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS munetios_profiles (
  account_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  display_name VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT profiles_account FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS munetios_profile_pictures (
  account_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  picture MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pictures_account FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Coarse device label for the "Signed-in devices" list (for example "Chrome on Windows").
CREATE TABLE IF NOT EXISTS munetios_session_devices (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  device VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  CONSTRAINT devices_session FOREIGN KEY (token_hash) REFERENCES munetios_sessions(token_hash) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Synced items are encrypted in the browser (AES-GCM). The server sees only
-- the item key, a version, and ciphertext.
CREATE TABLE IF NOT EXISTS munetios_sync_items (
  account_id BIGINT UNSIGNED NOT NULL,
  item_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  iv CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ciphertext LONGTEXT CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, item_key),
  INDEX sync_version (account_id, version),
  CONSTRAINT sync_account FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS munetios_account_security (
  account_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  totp_secret VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
  totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
  last_counter BIGINT NOT NULL DEFAULT -1,
  setup_expires DATETIME NULL,
  recovery_email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  CONSTRAINT security_account FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Small database packets preserve compatibility with low max_allowed_packet settings.
-- The complete ciphertext is reconstructed only by Express, never decrypted here.
CREATE TABLE IF NOT EXISTS munetios_sync_item_chunks (
  account_id BIGINT UNSIGNED NOT NULL,
  item_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  part_index INT UNSIGNED NOT NULL,
  ciphertext MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (account_id, item_key, part_index),
  CONSTRAINT sync_chunks_item FOREIGN KEY (account_id, item_key) REFERENCES munetios_sync_items(account_id, item_key) ON DELETE CASCADE
) ENGINE=InnoDB;
