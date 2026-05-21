export const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  availability TEXT NOT NULL, -- JSON string
  session_duration INTEGER DEFAULT 60,
  logo_url TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  meeting_type TEXT NOT NULL,
  location TEXT,
  school_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  session_duration INTEGER NOT NULL,
  calendar_event_id TEXT,
  meet_link TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (school_id) REFERENCES schools (id)
);

CREATE TABLE IF NOT EXISTS meeting_types (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  session_duration INTEGER,
  availability TEXT, -- JSON string
  is_builtin INTEGER DEFAULT 0,
  requires_school INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY,
  google_meet_duration INTEGER DEFAULT 60,
  custom_location_duration INTEGER DEFAULT 60,
  walk_time_buffer INTEGER DEFAULT 5,
  theme_color TEXT DEFAULT '#4f46e5',
  business_name TEXT,
  business_description TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id INTEGER PRIMARY KEY,
  tokens TEXT NOT NULL, -- Encrypted JSON string
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS drive_times (
  user_id INTEGER NOT NULL,
  from_school_id TEXT NOT NULL,
  to_school_id TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  PRIMARY KEY (user_id, from_school_id, to_school_id),
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (from_school_id) REFERENCES schools (id),
  FOREIGN KEY (to_school_id) REFERENCES schools (id)
);

CREATE TABLE IF NOT EXISTS calendar_config (
  user_id INTEGER PRIMARY KEY,
  check_calendars TEXT NOT NULL, -- JSON string array
  booking_calendar TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS logo (
  user_id INTEGER PRIMARY KEY,
  data_url TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);
`;
