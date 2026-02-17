const sqlite3 = require('sqlite3').verbose();

// Create database with OPEN_READWRITE | OPEN_CREATE flags to create if doesn't exist
const db = new sqlite3.Database('./placements.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    process.exit(1); // Exit if can't connect to database
  }
  console.log('Connected to the placements database.');
});

function ensureColumn(tableName, columnName, alterSql) {
  db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
    if (err) {
      console.error(`Error checking ${tableName} schema:`, err.message);
      return;
    }

    const hasColumn = columns.some((col) => col.name === columnName);
    if (!hasColumn) {
      db.run(alterSql, (alterErr) => {
        if (alterErr) {
          console.error(`Error altering ${tableName} (${columnName}):`, alterErr.message);
        } else {
          console.log(`Added ${columnName} column to ${tableName} table`);
        }
      });
    }
  });
}

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'student',
    is_verified INTEGER DEFAULT 0,
    verification_code TEXT,
    code_expiry TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating users table:', err.message);
    } else {
      console.log('Users table ready.');
      ensureColumn('users', 'verification_code', "ALTER TABLE users ADD COLUMN verification_code TEXT");
      ensureColumn('users', 'code_expiry', "ALTER TABLE users ADD COLUMN code_expiry TEXT");
      ensureColumn('users', 'role', "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'student'");
      ensureColumn('users', 'created_at', "ALTER TABLE users ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP");
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    resume_path TEXT,
    branch TEXT,
    cgpa REAL,
    backlog_count INTEGER DEFAULT 0,
    batch_year INTEGER,
    skills TEXT,
    profile_views INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`, (err) => {
    if (err) {
      console.error('Error creating profiles table:', err.message);
    } else {
      console.log('Profiles table ready.');
      ensureColumn('profiles', 'branch', 'ALTER TABLE profiles ADD COLUMN branch TEXT');
      ensureColumn('profiles', 'cgpa', 'ALTER TABLE profiles ADD COLUMN cgpa REAL');
      ensureColumn('profiles', 'backlog_count', 'ALTER TABLE profiles ADD COLUMN backlog_count INTEGER DEFAULT 0');
      ensureColumn('profiles', 'batch_year', 'ALTER TABLE profiles ADD COLUMN batch_year INTEGER');
      ensureColumn('profiles', 'skills', 'ALTER TABLE profiles ADD COLUMN skills TEXT');
      ensureColumn('profiles', 'profile_views', 'ALTER TABLE profiles ADD COLUMN profile_views INTEGER DEFAULT 0');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS drives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    role_title TEXT NOT NULL,
    job_type TEXT DEFAULT 'Full-time',
    location TEXT,
    package_lpa REAL,
    eligibility_cgpa REAL DEFAULT 0,
    eligibility_backlogs INTEGER DEFAULT 99,
    eligible_branches TEXT,
    batch_year INTEGER,
    deadline TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'published',
    created_by_type TEXT DEFAULT 'admin',
    created_by_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating drives table:', err.message);
    } else {
      console.log('Drives table ready.');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    drive_id INTEGER,
    company_name TEXT NOT NULL,
    application_date TEXT NOT NULL,
    status TEXT DEFAULT 'Applied',
    current_round TEXT DEFAULT 'Application Submitted',
    notes TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (drive_id) REFERENCES drives (id),
    UNIQUE(user_id, drive_id)
  )`, (err) => {
    if (err) {
      console.error('Error creating applications table:', err.message);
    } else {
      console.log('Applications table ready.');
      ensureColumn('applications', 'user_id', 'ALTER TABLE applications ADD COLUMN user_id INTEGER');
      ensureColumn('applications', 'drive_id', 'ALTER TABLE applications ADD COLUMN drive_id INTEGER');
      ensureColumn('applications', 'status', "ALTER TABLE applications ADD COLUMN status TEXT DEFAULT 'Applied'");
      ensureColumn('applications', 'current_round', "ALTER TABLE applications ADD COLUMN current_round TEXT DEFAULT 'Application Submitted'");
      ensureColumn('applications', 'notes', 'ALTER TABLE applications ADD COLUMN notes TEXT');
      ensureColumn('applications', 'updated_at', "ALTER TABLE applications ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP");
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS application_round_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    round_name TEXT NOT NULL,
    status TEXT NOT NULL,
    remarks TEXT,
    updated_by_type TEXT DEFAULT 'admin',
    updated_by_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES applications (id)
  )`, (err) => {
    if (err) {
      console.error('Error creating application_round_events table:', err.message);
    } else {
      console.log('Application round events table ready.');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS success_stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    student_name TEXT,
    company_name TEXT NOT NULL,
    story TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`, (err) => {
    if (err) {
      console.error('Error creating success_stories table:', err.message);
    } else {
      console.log('Success stories table ready.');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating admin_users table:', err.message);
    } else {
      console.log('Admin users table ready.');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS recruiters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    phone TEXT,
    is_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating recruiters table:', err.message);
    } else {
      console.log('Recruiters table ready.');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT DEFAULT 'normal',
    scheduled_at TEXT,
    expires_at TEXT,
    is_published INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating announcements table:', err.message);
    } else {
      console.log('Announcements table ready.');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS interview_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    slot_time TEXT NOT NULL,
    venue TEXT,
    meeting_link TEXT,
    status TEXT DEFAULT 'scheduled',
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (drive_id) REFERENCES drives (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`, (err) => {
    if (err) {
      console.error('Error creating interview_slots table:', err.message);
    } else {
      console.log('Interview slots table ready.');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS offer_letters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    company_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    uploaded_by INTEGER,
    acceptance_status TEXT DEFAULT 'pending',
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (drive_id) REFERENCES drives (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`, (err) => {
    if (err) {
      console.error('Error creating offer_letters table:', err.message);
    } else {
      console.log('Offer letters table ready.');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS student_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    verification_status TEXT DEFAULT 'pending',
    verification_notes TEXT,
    verified_by INTEGER,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    verified_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`, (err) => {
    if (err) {
      console.error('Error creating student_documents table:', err.message);
    } else {
      console.log('Student documents table ready.');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS helpdesk_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'open',
    assigned_to INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`, (err) => {
    if (err) {
      console.error('Error creating helpdesk_tickets table:', err.message);
    } else {
      console.log('Helpdesk tickets table ready.');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS mentors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    company TEXT,
    expertise TEXT,
    availability TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating mentors table:', err.message);
    } else {
      console.log('Mentors table ready.');
      db.get('SELECT COUNT(*) AS count FROM mentors', (countErr, row) => {
        if (countErr) {
          console.error('Error checking mentors count:', countErr.message);
          return;
        }

        if (row && row.count === 0) {
          const seedMentors = db.prepare(
            'INSERT INTO mentors (name, email, company, expertise, availability) VALUES (?, ?, ?, ?, ?)'
          );
          seedMentors.run('Aditi Sharma', 'aditi.mentor@example.com', 'Infosys', 'DSA, System Design', 'Weekends');
          seedMentors.run('Rohit Verma', 'rohit.mentor@example.com', 'TCS', 'Aptitude, HR Interview', 'Weekdays 7-9 PM');
          seedMentors.run('Neha Gupta', 'neha.mentor@example.com', 'Accenture', 'Resume Review, Communication', 'Saturday 4-6 PM');
          seedMentors.finalize();
          console.log('Sample mentors inserted.');
        }
      });
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS mentor_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mentor_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    session_time TEXT NOT NULL,
    status TEXT DEFAULT 'requested',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mentor_id) REFERENCES mentors (id),
    FOREIGN KEY (student_id) REFERENCES users (id)
  )`, (err) => {
    if (err) {
      console.error('Error creating mentor_sessions table:', err.message);
    } else {
      console.log('Mentor sessions table ready.');
    }
  });

  db.run('CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_applications_drive_id ON applications(drive_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_drives_deadline ON drives(deadline)');
  db.run('CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(is_published)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tickets_status ON helpdesk_tickets(status)');
});

module.exports = db;