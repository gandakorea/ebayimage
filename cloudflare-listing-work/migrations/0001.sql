CREATE TABLE IF NOT EXISTS work_batches (date TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS work_batch_history (date TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, deleted INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(date, version));
CREATE TRIGGER IF NOT EXISTS batch_insert_history AFTER INSERT ON work_batches BEGIN INSERT INTO work_batch_history VALUES(NEW.date,NEW.version,NEW.body,NEW.deleted,NEW.updated_at); END;
CREATE TRIGGER IF NOT EXISTS batch_update_history AFTER UPDATE ON work_batches BEGIN INSERT INTO work_batch_history VALUES(NEW.date,NEW.version,NEW.body,NEW.deleted,NEW.updated_at); END;
CREATE TABLE IF NOT EXISTS login_attempts (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL);
