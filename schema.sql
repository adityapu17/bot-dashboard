-- Bot status table
CREATE TABLE IF NOT EXISTS bot_status (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    last_update INTEGER NOT NULL,
    details TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_bot_status_name ON bot_status(name);
CREATE INDEX IF NOT EXISTS idx_bot_status_last_update ON bot_status(last_update);

CREATE TABLE IF NOT EXISTS bot_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (bot_id) REFERENCES bot_status(id)
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_bot_id ON bot_logs(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_logs_timestamp ON bot_logs(timestamp);

-- Active cron jobs per bot
CREATE TABLE IF NOT EXISTS bot_jobs (
    bot_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    name TEXT NOT NULL,
    schedule TEXT,
    enabled INTEGER DEFAULT 1,
    state TEXT,
    last_status TEXT,
    last_run_at INTEGER,
    next_run_at INTEGER,
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    PRIMARY KEY (bot_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_jobs_bot_id ON bot_jobs(bot_id);
