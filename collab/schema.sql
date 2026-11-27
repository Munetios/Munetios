-- Munetios real-time collaboration for OmniWrite documents and spreadsheets.
-- The browser encrypts content with AES-GCM. The server retains a key only
-- when the owner enables link access and provides the key.

CREATE TABLE IF NOT EXISTS munetios_collab_documents (
  id CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  owner_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('document', 'spreadsheet') NOT NULL,
  link_access ENUM('off', 'view', 'suggest', 'edit') NOT NULL DEFAULT 'off',
  locked TINYINT(1) NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  iv CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX collab_owner (owner_id),
  CONSTRAINT collab_documents_owner FOREIGN KEY (owner_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS munetios_collab_link_keys (
  document_id CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  content_key CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  CONSTRAINT collab_link_keys_document FOREIGN KEY (document_id) REFERENCES munetios_collab_documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS munetios_collab_invitation_keys (
  document_id CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  content_key CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  CONSTRAINT collab_invitation_keys_document FOREIGN KEY (document_id) REFERENCES munetios_collab_documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Roles: edit (Editor), suggest (Suggest), view (View only). The owner is implied by owner_id.
CREATE TABLE IF NOT EXISTS munetios_collab_members (
  document_id CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  role ENUM('edit', 'suggest', 'view') NOT NULL,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (document_id, account_id),
  INDEX collab_member_account (account_id),
  CONSTRAINT collab_members_document FOREIGN KEY (document_id) REFERENCES munetios_collab_documents(id) ON DELETE CASCADE,
  CONSTRAINT collab_members_account FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- One open suggestion per person and document, replaced while they keep editing.
-- (Comments here must not contain semicolons: the schema is split on them.)
CREATE TABLE IF NOT EXISTS munetios_collab_suggestions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  document_id CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id BIGINT UNSIGNED NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  base_version BIGINT UNSIGNED NOT NULL,
  iv CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('open', 'accepted', 'rejected') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX collab_suggestions_open (document_id, status),
  CONSTRAINT collab_suggestions_document FOREIGN KEY (document_id) REFERENCES munetios_collab_documents(id) ON DELETE CASCADE,
  CONSTRAINT collab_suggestions_account FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Ciphertext is split into 256 KiB parts so large documents work with the
-- 1 MiB max_allowed_packet default. owner_key is "d:<document id>" or "s:<suggestion id>".
CREATE TABLE IF NOT EXISTS munetios_collab_parts (
  owner_key VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  part_index INT UNSIGNED NOT NULL,
  data MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (owner_key, part_index)
) ENGINE=InnoDB;

-- Reports for documents and spreadsheets shared with anyone who has the link.
-- Reports have no foreign keys, so they remain after a document or account is deleted.
-- review_key is set only when the reporter chose to let reviewers open the content.
CREATE TABLE IF NOT EXISTS munetios_collab_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  document_id CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_kind ENUM('document', 'spreadsheet') NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  reporter_id BIGINT UNSIGNED NULL,
  reporter_ip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason ENUM('spam', 'harassment', 'hate', 'violence', 'sexual', 'illegal', 'phishing', 'privacy', 'copyright', 'other') NOT NULL,
  details TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  review_key CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status ENUM('open', 'reviewing', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX collab_reports_document (document_id),
  INDEX collab_reports_queue (status, created_at)
) ENGINE=InnoDB;

-- Comments on shared documents and spreadsheets. The text, anchor, and guest name are
-- encrypted in the browser with the link key. Signed-in authors are linked by account_id.
-- Guests (no account) keep a random token in their browser, and token_hash lets them delete their own comments.
CREATE TABLE IF NOT EXISTS munetios_collab_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  document_id CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id BIGINT UNSIGNED NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  iv CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ciphertext MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX collab_comments_document (document_id, id),
  CONSTRAINT collab_comments_document FOREIGN KEY (document_id) REFERENCES munetios_collab_documents(id) ON DELETE CASCADE,
  CONSTRAINT collab_comments_account FOREIGN KEY (account_id) REFERENCES munetios_accounts(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Threads: a reply has a row with parent_id (its thread). A thread has a row once it is resolved or reopened.
-- Kept in its own table so existing installs never need ALTER permission.
CREATE TABLE IF NOT EXISTS munetios_collab_comment_threads (
  comment_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  parent_id BIGINT UNSIGNED NULL,
  resolved TINYINT(1) NOT NULL DEFAULT 0,
  resolved_at TIMESTAMP NULL DEFAULT NULL,
  INDEX collab_comment_threads_parent (parent_id),
  CONSTRAINT collab_comment_threads_comment FOREIGN KEY (comment_id) REFERENCES munetios_collab_comments(id) ON DELETE CASCADE,
  CONSTRAINT collab_comment_threads_parent FOREIGN KEY (parent_id) REFERENCES munetios_collab_comments(id) ON DELETE CASCADE
) ENGINE=InnoDB;
