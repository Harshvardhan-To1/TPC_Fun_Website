const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database.js');
const bcrypt = require('bcrypt');
const session = require('express-session');
require('dotenv').config({ quiet: true });
const Groq = require('groq-sdk');
const nodemailer = require('nodemailer');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const app = express();
const port = 3000;

// Ensure upload directories exist for all modules
['uploads', 'uploads/documents', 'uploads/offers'].forEach((dirPath) => {
  const absolutePath = path.join(__dirname, dirPath);
  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(absolutePath, { recursive: true });
  }
});

// Email transporter configuration
const transporter = nodemailer.createTransport({
  service: 'gmail', // or 'outlook', 'yahoo', etc.
  auth: {
    user: process.env.EMAIL_USER, // Your email
    pass: process.env.EMAIL_PASSWORD // Your email password or app password
  }
});

// Verify email configuration on startup
transporter.verify((error, success) => {
  if (error) {
    console.error('Email configuration error:', error);
    console.log('Email sending will not work. Please check your .env file.');
  } else {
    console.log('Email server is ready to send messages');
  }
});

// Serve static files from the root directory
app.use(express.static(__dirname));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Improved session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Set up storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage: storage });

const documentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/documents/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const documentUpload = multer({ storage: documentStorage });

const offerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/offers/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const offerUpload = multer({ storage: offerStorage });

// Helper function to send HTML error pages
function sendErrorPage(res, statusCode, message) {
  res.status(statusCode).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Error</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 600px;
          margin: 50px auto;
          padding: 20px;
          text-align: center;
        }
        .error-box {
          background-color: #ffe6e6;
          border: 1px solid #ff4444;
          border-radius: 5px;
          padding: 20px;
          margin: 20px 0;
        }
        .error-box h2 {
          color: #cc0000;
          margin-top: 0;
        }
        .error-box p {
          color: #333;
        }
        a {
          display: inline-block;
          margin-top: 20px;
          padding: 10px 20px;
          background-color: #007bff;
          color: white;
          text-decoration: none;
          border-radius: 4px;
        }
        a:hover {
          background-color: #0056b3;
        }
      </style>
    </head>
    <body>
      <div class="error-box">
        <h2>Error</h2>
        <p>${message}</p>
      </div>
      <a href="javascript:history.back()">Go Back</a>
    </body>
    </html>
  `);
}

// Helper function to generate 6-digit verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper function to send verification email
async function sendVerificationEmail(email, code, username) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Verify Your Email - Placement Portal',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .code-box { background: white; border: 2px dashed #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
          .code { font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 5px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✉️ Email Verification</h1>
          </div>
          <div class="content">
            <h2>Hello ${username}!</h2>
            <p>Thank you for signing up for the Placement Portal. Please use the verification code below to complete your registration:</p>
            <div class="code-box">
              <div class="code">${code}</div>
            </div>
            <p>This code will expire in <strong>10 minutes</strong>.</p>
            <p>If you didn't create an account with us, please ignore this email.</p>
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              <p><strong>Need help?</strong> Contact our support team.</p>
            </div>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
            <p>&copy; 2024 Placement Portal. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Verification email sent to:', email);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

function dbGetAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAllAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function dbRunAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Route to handle resume uploads
app.post('/upload', upload.single('resume'), (req, res) => {
  if (!req.file) {
    return sendErrorPage(res, 400, 'No file uploaded.');
  }
  res.send(`File uploaded successfully: ${req.file.path}`);
});

// Route to handle drive applications
app.post('/apply', (req, res) => {
  const { company_name, drive_id } = req.body;
  const applicationDate = new Date().toISOString();

  const insertApplication = (resolvedCompanyName, resolvedDriveId = null) => {
    const insertSql = `
      INSERT INTO applications (
        user_id,
        drive_id,
        company_name,
        application_date,
        status,
        current_round,
        updated_at
      ) VALUES (?, ?, ?, ?, 'Applied', 'Application Submitted', ?)
    `;

    const runInsert = () => {
      db.run(
        insertSql,
        [req.session.userId || null, resolvedDriveId, resolvedCompanyName, applicationDate, applicationDate],
        (err) => {
          if (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
              return sendErrorPage(res, 400, 'You have already applied to this drive.');
            }
            console.error('Application insert error:', err.message);
            return sendErrorPage(res, 500, 'Error saving application.');
          }
          return res.redirect('/applySuccess.html');
        }
      );
    };

    if (req.session.userId && resolvedDriveId) {
      db.get(
        'SELECT id FROM applications WHERE user_id = ? AND drive_id = ?',
        [req.session.userId, resolvedDriveId],
        (dupErr, existingApplication) => {
          if (dupErr) {
            console.error('Duplicate check failed:', dupErr.message);
            return sendErrorPage(res, 500, 'Could not verify duplicate application.');
          }
          if (existingApplication) {
            return sendErrorPage(res, 400, 'You have already applied to this drive.');
          }
          return runInsert();
        }
      );
      return;
    }

    runInsert();
  };

  if (drive_id) {
    const driveSql = `SELECT id, company_name FROM drives WHERE id = ? AND status = 'published'`;
    db.get(driveSql, [drive_id], (driveErr, drive) => {
      if (driveErr) {
        console.error('Drive lookup error:', driveErr.message);
        return sendErrorPage(res, 500, 'Error fetching drive.');
      }
      if (!drive) {
        return sendErrorPage(res, 404, 'Drive not found or not published.');
      }
      return insertApplication(drive.company_name, drive.id);
    });
    return;
  }

  if (!company_name) {
    return sendErrorPage(res, 400, 'Drive/company details are required.');
  }

  return insertApplication(company_name, null);
});

// Original non-streaming chatbot route (kept for backward compatibility)
app.post('/chatbot', async (req, res) => {
  const userMessage = req.body.message;
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a helpful career assistant for Placemate, a placement portal. Help students with interview preparation, resume tips, career guidance, and placement-related queries. Be concise, friendly, and professional."
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 1024
    });
    const text = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
    res.json({ response: text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ response: 'Error generating response from AI.' });
  }
});

// NEW: Streaming chatbot route using Server-Sent Events (SSE) with Groq
app.post('/chatbot/stream', async (req, res) => {
  const userMessage = req.body.message;
  
  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for nginx
  
  try {
    // Use Groq streaming
    const stream = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a helpful career assistant for Placemate, a placement portal. Help students with interview preparation, resume tips, career guidance, and placement-related queries. Be concise, friendly, and professional."
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 1024,
      stream: true
    });
    
    // Stream each chunk as it arrives
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        // Send the chunk as an SSE event
        res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
      }
    }
    
    // Send completion signal
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    
  } catch (error) {
    console.error('Streaming error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Error generating response from AI.' })}\n\n`);
    res.end();
  }
});

// Redirect /signup GET requests to signup.html
app.get('/signup', (req, res) => {
  res.redirect('/signup.html');
});

// UPDATED: Signup route with verification code
app.post('/signup', async (req, res) => {
  const { username, password, email } = req.body;
  console.log('Signup attempt:', { username, email, passwordLength: password?.length });

  // Validate input
  if (!username || !password || !email) {
    return sendErrorPage(res, 400, 'Username, email and password are required.');
  }
  if (username.length < 3) {
    return sendErrorPage(res, 400, 'Username must be at least 3 characters long.');
  }
  if (password.length < 6) {
    return sendErrorPage(res, 400, 'Password must be at least 6 characters long.');
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return sendErrorPage(res, 400, 'Please provide a valid email address.');
  }

  try {
    // Check if user already exists
    const checkSql = `SELECT * FROM users WHERE username = ? OR email = ?`;
    db.get(checkSql, [username, email], async (err, existingUser) => {
      if (err) {
        console.error('Database error checking user:', err.message);
        return sendErrorPage(res, 500, 'Database error. Please try again.');
      }
      if (existingUser) {
        return sendErrorPage(res, 400, 'Username or email already exists. Please choose another.');
      }

      try {
        // Hash password and create user
        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationCode = generateVerificationCode();
        const codeExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

        const insertSql = `INSERT INTO users (username, password, email, verification_code, code_expiry, is_verified) VALUES (?, ?, ?, ?, ?, 0)`;
        
        db.run(insertSql, [username, hashedPassword, email, verificationCode, codeExpiry], async function(err) {
          if (err) {
            console.error('Error creating user:', err.message);
            return sendErrorPage(res, 500, 'Error creating user. Please try again.');
          }
          
          console.log('User created with ID:', this.lastID);
          
          // Send verification email
          const emailSent = await sendVerificationEmail(email, verificationCode, username);
          
          if (!emailSent) {
            console.error('Failed to send verification email');
            // Still allow signup but show warning
          }

          // Store user info in session for verification page
          req.session.pendingUserId = this.lastID;
          req.session.pendingUsername = username;
          req.session.pendingEmail = email;
          
          // Create empty profile for new user
          const profileSql = `INSERT INTO profiles (user_id, full_name, email, phone, resume_path) VALUES (?, '', ?, '', '')`;
          db.run(profileSql, [this.lastID, email], (profileErr) => {
            if (profileErr) {
              console.error('Error creating profile:', profileErr.message);
            } else {
              console.log('Profile created for user:', this.lastID);
            }
          });

          // Save session and redirect to verification page
          req.session.save((err) => {
            if (err) {
              console.error('Session save error:', err);
              return sendErrorPage(res, 500, 'Error during signup.');
            }
            res.redirect('/verify-email.html');
          });
        });
      } catch (hashError) {
        console.error('Password hashing error:', hashError);
        return sendErrorPage(res, 500, 'Error processing password. Please try again.');
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    return sendErrorPage(res, 500, 'An unexpected error occurred. Please try again.');
  }
});

// NEW: Email verification page
app.get('/verify-email.html', (req, res) => {
  if (!req.session.pendingUserId) {
    return res.redirect('/signup.html');
  }
  res.sendFile(path.join(__dirname, 'verify-email.html'));
});

// NEW: Get verification session info
app.get('/verification-info', (req, res) => {
  if (!req.session.pendingUserId) {
    return res.status(400).json({ error: 'No pending verification' });
  }
  res.json({
    email: req.session.pendingEmail,
    username: req.session.pendingUsername
  });
});

// NEW: Verify code endpoint
app.post('/verify-code', (req, res) => {
  const { code } = req.body;
  
  if (!req.session.pendingUserId) {
    return res.status(400).json({ success: false, message: 'No pending verification found. Please sign up again.' });
  }

  const sql = `SELECT * FROM users WHERE id = ?`;
  db.get(sql, [req.session.pendingUserId], (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ success: false, message: 'Database error.' });
    }

    if (!user) {
      return res.status(400).json({ success: false, message: 'User not found.' });
    }

    // Check if code has expired
    const now = new Date();
    const expiry = new Date(user.code_expiry);
    
    if (now > expiry) {
      return res.status(400).json({ success: false, message: 'Verification code has expired. Please request a new one.' });
    }

    // Check if code matches
    if (user.verification_code !== code) {
      return res.status(400).json({ success: false, message: 'Invalid verification code. Please try again.' });
    }

    // Update user as verified
    const updateSql = `UPDATE users SET is_verified = 1, verification_code = NULL, code_expiry = NULL WHERE id = ?`;
    db.run(updateSql, [user.id], (err) => {
      if (err) {
        console.error('Error updating verification status:', err);
        return res.status(500).json({ success: false, message: 'Error verifying code.' });
      }

      // Clear pending session data
      delete req.session.pendingUserId;
      delete req.session.pendingUsername;
      delete req.session.pendingEmail;

      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
        }
        res.json({ success: true, message: 'Email verified successfully!' });
      });
    });
  });
});

// NEW: Resend verification code
app.post('/resend-code', async (req, res) => {
  if (!req.session.pendingUserId) {
    return res.status(400).json({ success: false, message: 'No pending verification found.' });
  }

  const sql = `SELECT * FROM users WHERE id = ?`;
  db.get(sql, [req.session.pendingUserId], async (err, user) => {
    if (err || !user) {
      return res.status(500).json({ success: false, message: 'Error fetching user data.' });
    }

    // Generate new code
    const newCode = generateVerificationCode();
    const newExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Update database
    const updateSql = `UPDATE users SET verification_code = ?, code_expiry = ? WHERE id = ?`;
    db.run(updateSql, [newCode, newExpiry, user.id], async (err) => {
      if (err) {
        console.error('Error updating verification code:', err);
        return res.status(500).json({ success: false, message: 'Error generating new code.' });
      }

      // Send new email
      const emailSent = await sendVerificationEmail(user.email, newCode, user.username);
      
      if (emailSent) {
        res.json({ success: true, message: 'New verification code sent to your email.' });
      } else {
        res.status(500).json({ success: false, message: 'Error sending email. Please try again.' });
      }
    });
  });
});

// Redirect /signin GET requests to signin.html
app.get('/signin', (req, res) => {
  res.redirect('/signin.html');
});

// UPDATED: Signin route with verification check
app.post('/signin', (req, res) => {
  const { username, password } = req.body;
  console.log('Signin attempt:', { username });

  // Validate input
  if (!username || !password) {
    return sendErrorPage(res, 400, 'Username and password are required.');
  }

  const sql = `SELECT * FROM users WHERE username = ? OR email = ?`;
  db.get(sql, [username, username], async (err, user) => {
    if (err) {
      console.error('Database error during signin:', err.message);
      return sendErrorPage(res, 500, 'Error signing in. Please try again.');
    }

    if (!user) {
      console.log('User not found:', username);
      return sendErrorPage(res, 401, 'Invalid username or password.');
    }

    // Check if email is verified
    if (user.is_verified === 0) {
      // Store user info in session and redirect to verification
      req.session.pendingUserId = user.id;
      req.session.pendingUsername = user.username;
      req.session.pendingEmail = user.email;
      
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
        }
        return res.redirect('/verify-email.html?message=Please verify your email before signing in.');
      });
      return;
    }

    try {
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        req.session.userId = user.id;
        req.session.username = user.username;
        
        console.log('Login successful for user:', username);
        
        // Save session before redirecting
        req.session.save((err) => {
          if (err) {
            console.error('Session save error:', err);
            return sendErrorPage(res, 500, 'Error during signin.');
          }
          res.redirect('/profile.html');
        });
      } else {
        console.log('Invalid password for user:', username);
        return sendErrorPage(res, 401, 'Invalid username or password.');
      }
    } catch (error) {
      console.error('Password comparison error:', error);
      return sendErrorPage(res, 500, 'Error during signin.');
    }
  });
});

// Profile data route
app.get('/profile-data', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const sql = `SELECT * FROM profiles WHERE user_id = ?`;
  db.get(sql, [req.session.userId], (err, profile) => {
    if (err) {
      console.error('Error fetching profile:', err.message);
      return res.status(500).json({ error: 'Error fetching profile.' });
    }

    // Return empty profile if none exists
    if (!profile) {
      return res.json({
        full_name: '',
        email: '',
        phone: '',
        resume_path: ''
      });
    }
    res.json(profile);
  });
});

// Update profile route
app.post('/update-profile', upload.single('resume'), (req, res) => {
  if (!req.session.userId) {
    return sendErrorPage(res, 401, 'Not authenticated. Please sign in.');
  }

  const { full_name, email, phone } = req.body;
  
  // Check if existing profile exists
  const sql = `SELECT * FROM profiles WHERE user_id = ?`;
  db.get(sql, [req.session.userId], (err, profile) => {
    if (err) {
      console.error('Error fetching profile:', err.message);
      return sendErrorPage(res, 500, 'Error updating profile.');
    }

    if (profile) {
      // Update existing profile - only update resume if new file uploaded
      let updateSql, params;
      
      if (req.file) {
        updateSql = `UPDATE profiles SET full_name = ?, email = ?, phone = ?, resume_path = ? WHERE user_id = ?`;
        params = [full_name, email, phone, req.file.path, req.session.userId];
      } else {
        // Keep existing resume
        updateSql = `UPDATE profiles SET full_name = ?, email = ?, phone = ? WHERE user_id = ?`;
        params = [full_name, email, phone, req.session.userId];
      }

      db.run(updateSql, params, (err) => {
        if (err) {
          console.error('Error updating profile:', err.message);
          return sendErrorPage(res, 500, 'Error updating profile.');
        }
        res.redirect('/profile.html');
      });
    } else {
      // Create new profile
      const resume_path = req.file ? req.file.path : '';
      const insertSql = `INSERT INTO profiles (user_id, full_name, email, phone, resume_path) VALUES (?, ?, ?, ?, ?)`;
      db.run(insertSql, [req.session.userId, full_name, email, phone, resume_path], (err) => {
        if (err) {
          console.error('Error creating profile:', err.message);
          return sendErrorPage(res, 500, 'Error creating profile.');
        }
        res.redirect('/profile.html');
      });
    }
  });
});

// Middleware to protect routes
const protectedRoute = (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/signin.html');
  }
  next();
};

const protectedApiRoute = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
};

const adminRoute = (req, res, next) => {
  if (!req.session.adminId) {
    return res.redirect('/adminLogin.html');
  }
  next();
};

const adminApiRoute = (req, res, next) => {
  if (!req.session.adminId) {
    return res.status(401).json({ error: 'Admin authentication required.' });
  }
  next();
};

const recruiterRoute = (req, res, next) => {
  if (!req.session.recruiterId) {
    return res.redirect('/recruiterLogin.html');
  }
  next();
};

const recruiterApiRoute = (req, res, next) => {
  if (!req.session.recruiterId) {
    return res.status(401).json({ error: 'Recruiter authentication required.' });
  }
  next();
};

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.redirect('/profile.html');
    }
    res.clearCookie('connect.sid');
    res.redirect('/signin.html');
  });
});

// Serve profile.html from root directory
app.get('/profile.html', protectedRoute, (req, res) => {
  res.sendFile(path.join(__dirname, 'profile.html'));
});

// Serve successStories.html
app.get('/success-stories-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'successStories.html'));
});

// Get all success stories
app.get('/api/success-stories', (req, res) => {
  const sql = `SELECT * FROM success_stories ORDER BY created_at DESC`;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching stories:', err.message);
      return res.status(500).json({ error: 'Error fetching stories' });
    }
    res.json(rows);
  });
});

// Post a success story
app.post('/success-stories', protectedRoute, (req, res) => {
  const { company_name, story } = req.body;
  const user_id = req.session.userId;

  if (!company_name || !story) {
    return res.status(400).json({ error: 'Company name and story are required.' });
  }

  // Get user's full name from profiles to store as student_name
  db.get('SELECT full_name FROM profiles WHERE user_id = ?', [user_id], (err, profile) => {
    if (err) {
      console.error('Error fetching profile:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Default to username if profile name is not set
    let student_name = req.session.username;
    if (profile && profile.full_name) {
      student_name = profile.full_name;
    }

    const sql = `INSERT INTO success_stories (user_id, student_name, company_name, story) VALUES (?, ?, ?, ?)`;
    db.run(sql, [user_id, student_name, company_name, story], function(err) {
      if (err) {
        console.error('Error saving story:', err.message);
        return res.status(500).json({ error: 'Error saving story.' });
      }
      res.json({ message: 'Story added successfully', id: this.lastID });
    });
  });
});

// Check authentication status
app.get('/auth-status', (req, res) => {
  res.json({ 
    authenticated: !!req.session.userId,
    username: req.session.username || null
  });
});

// Extended auth context for role-aware UI
app.get('/auth-context', (req, res) => {
  res.json({
    student: {
      authenticated: !!req.session.userId,
      id: req.session.userId || null,
      username: req.session.username || null
    },
    admin: {
      authenticated: !!req.session.adminId,
      id: req.session.adminId || null,
      username: req.session.adminUsername || null,
      role: req.session.adminRole || null
    },
    recruiter: {
      authenticated: !!req.session.recruiterId,
      id: req.session.recruiterId || null,
      company_name: req.session.recruiterCompany || null
    }
  });
});

// Protected module pages
app.get('/admin/dashboard', adminRoute, (req, res) => {
  res.sendFile(path.join(__dirname, 'adminDashboard.html'));
});

app.get('/recruiter/dashboard', recruiterRoute, (req, res) => {
  res.sendFile(path.join(__dirname, 'recruiterDashboard.html'));
});

app.get('/student/drives', protectedRoute, (req, res) => {
  res.sendFile(path.join(__dirname, 'drives.html'));
});

app.get('/student/my-applications', protectedRoute, (req, res) => {
  res.sendFile(path.join(__dirname, 'myApplications.html'));
});

app.get('/student/documents', protectedRoute, (req, res) => {
  res.sendFile(path.join(__dirname, 'studentDocuments.html'));
});

app.get('/student/helpdesk', protectedRoute, (req, res) => {
  res.sendFile(path.join(__dirname, 'helpdesk.html'));
});

// ------------------------------
// Admin auth
// ------------------------------
app.post('/admin/signup', async (req, res) => {
  const { username, email, password, role } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    const existingAdmin = await dbGetAsync(
      'SELECT id FROM admin_users WHERE username = ? OR email = ?',
      [username, email]
    );
    if (existingAdmin) {
      return res.status(400).json({ error: 'Admin user already exists with this username/email.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await dbRunAsync(
      'INSERT INTO admin_users (username, email, password, role) VALUES (?, ?, ?, ?)',
      [username, email, hashedPassword, role || 'admin']
    );

    req.session.adminId = result.lastID;
    req.session.adminUsername = username;
    req.session.adminRole = role || 'admin';
    req.session.save((err) => {
      if (err) {
        console.error('Admin signup session save error:', err);
      }
      res.json({ success: true, message: 'Admin account created.', adminId: result.lastID });
    });
  } catch (error) {
    console.error('Admin signup error:', error);
    res.status(500).json({ error: 'Failed to create admin account.' });
  }
});

app.post('/admin/signin', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username/email and password are required.' });
  }

  try {
    const admin = await dbGetAsync(
      'SELECT * FROM admin_users WHERE username = ? OR email = ?',
      [username, username]
    );

    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    req.session.adminId = admin.id;
    req.session.adminUsername = admin.username;
    req.session.adminRole = admin.role;
    req.session.save((err) => {
      if (err) {
        console.error('Admin signin session save error:', err);
      }
      res.json({ success: true, message: 'Admin signed in successfully.' });
    });
  } catch (error) {
    console.error('Admin signin error:', error);
    res.status(500).json({ error: 'Failed to sign in admin.' });
  }
});

app.get('/admin/auth-status', (req, res) => {
  res.json({
    authenticated: !!req.session.adminId,
    username: req.session.adminUsername || null,
    role: req.session.adminRole || null
  });
});

app.get('/admin/logout', (req, res) => {
  delete req.session.adminId;
  delete req.session.adminUsername;
  delete req.session.adminRole;
  req.session.save((err) => {
    if (err) {
      console.error('Admin logout session save error:', err);
    }
    res.redirect('/adminLogin.html');
  });
});

// ------------------------------
// Recruiter auth
// ------------------------------
app.post('/recruiter/signup', async (req, res) => {
  const { company_name, contact_name, email, password, phone } = req.body;

  if (!company_name || !contact_name || !email || !password) {
    return res.status(400).json({ error: 'Company, contact name, email and password are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    const existingRecruiter = await dbGetAsync('SELECT id FROM recruiters WHERE email = ?', [email]);
    if (existingRecruiter) {
      return res.status(400).json({ error: 'Recruiter already registered with this email.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await dbRunAsync(
      'INSERT INTO recruiters (company_name, contact_name, email, password, phone, is_verified) VALUES (?, ?, ?, ?, ?, 1)',
      [company_name, contact_name, email, hashedPassword, phone || '']
    );

    req.session.recruiterId = result.lastID;
    req.session.recruiterCompany = company_name;
    req.session.save((err) => {
      if (err) {
        console.error('Recruiter signup session save error:', err);
      }
      res.json({ success: true, message: 'Recruiter account created.' });
    });
  } catch (error) {
    console.error('Recruiter signup error:', error);
    res.status(500).json({ error: 'Failed to create recruiter account.' });
  }
});

app.post('/recruiter/signin', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const recruiter = await dbGetAsync('SELECT * FROM recruiters WHERE email = ?', [email]);
    if (!recruiter) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const isMatch = await bcrypt.compare(password, recruiter.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    req.session.recruiterId = recruiter.id;
    req.session.recruiterCompany = recruiter.company_name;
    req.session.save((err) => {
      if (err) {
        console.error('Recruiter signin session save error:', err);
      }
      res.json({ success: true, message: 'Recruiter signed in successfully.' });
    });
  } catch (error) {
    console.error('Recruiter signin error:', error);
    res.status(500).json({ error: 'Failed to sign in recruiter.' });
  }
});

app.get('/recruiter/auth-status', (req, res) => {
  res.json({
    authenticated: !!req.session.recruiterId,
    recruiterId: req.session.recruiterId || null,
    company_name: req.session.recruiterCompany || null
  });
});

app.get('/recruiter/logout', (req, res) => {
  delete req.session.recruiterId;
  delete req.session.recruiterCompany;
  req.session.save((err) => {
    if (err) {
      console.error('Recruiter logout session save error:', err);
    }
    res.redirect('/recruiterLogin.html');
  });
});

// ------------------------------
// Public and student APIs
// ------------------------------
app.get('/api/drives', async (req, res) => {
  const { search, job_type, branch, batch_year } = req.query;
  const params = [];

  let sql = `
    SELECT *
    FROM drives
    WHERE status = 'published'
      AND datetime(deadline) >= datetime('now')
  `;

  if (search) {
    sql += ' AND (company_name LIKE ? OR role_title LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  if (job_type) {
    sql += ' AND job_type = ?';
    params.push(job_type);
  }

  if (branch) {
    sql += " AND (eligible_branches IS NULL OR eligible_branches = '' OR LOWER(eligible_branches) LIKE LOWER(?))";
    params.push(`%${branch}%`);
  }

  if (batch_year) {
    sql += ' AND (batch_year IS NULL OR batch_year = ?)';
    params.push(batch_year);
  }

  sql += ' ORDER BY datetime(deadline) ASC';

  try {
    const drives = await dbAllAsync(sql, params);
    res.json(drives);
  } catch (error) {
    console.error('Error fetching drives:', error);
    res.status(500).json({ error: 'Failed to fetch drives.' });
  }
});

app.get('/api/my-applications', protectedApiRoute, async (req, res) => {
  try {
    const applications = await dbAllAsync(
      `
      SELECT
        a.*,
        d.role_title,
        d.job_type,
        d.location,
        d.package_lpa,
        d.deadline
      FROM applications a
      LEFT JOIN drives d ON d.id = a.drive_id
      WHERE a.user_id = ?
      ORDER BY datetime(a.application_date) DESC
      `,
      [req.session.userId]
    );
    res.json(applications);
  } catch (error) {
    console.error('Error fetching my applications:', error);
    res.status(500).json({ error: 'Failed to fetch applications.' });
  }
});

app.get('/api/applications/:applicationId/events', protectedApiRoute, async (req, res) => {
  const { applicationId } = req.params;

  try {
    const appRecord = await dbGetAsync(
      'SELECT id FROM applications WHERE id = ? AND user_id = ?',
      [applicationId, req.session.userId]
    );
    if (!appRecord) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    const events = await dbAllAsync(
      'SELECT * FROM application_round_events WHERE application_id = ? ORDER BY datetime(created_at) DESC',
      [applicationId]
    );
    res.json(events);
  } catch (error) {
    console.error('Error fetching application events:', error);
    res.status(500).json({ error: 'Failed to fetch events.' });
  }
});

app.get('/api/announcements', async (req, res) => {
  const nowIso = new Date().toISOString();
  try {
    const announcements = await dbAllAsync(
      `
      SELECT *
      FROM announcements
      WHERE is_published = 1
        AND (scheduled_at IS NULL OR scheduled_at <= ?)
        AND (expires_at IS NULL OR expires_at >= ?)
      ORDER BY
        CASE priority
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          ELSE 3
        END,
        datetime(created_at) DESC
      `,
      [nowIso, nowIso]
    );
    res.json(announcements);
  } catch (error) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ error: 'Failed to fetch announcements.' });
  }
});

app.get('/api/mentors', async (req, res) => {
  try {
    const mentors = await dbAllAsync('SELECT * FROM mentors ORDER BY datetime(created_at) DESC');
    res.json(mentors);
  } catch (error) {
    console.error('Error fetching mentors:', error);
    res.status(500).json({ error: 'Failed to fetch mentors.' });
  }
});

app.post('/api/mentor-sessions', protectedApiRoute, async (req, res) => {
  const { mentor_id, session_time, notes } = req.body;
  if (!mentor_id || !session_time) {
    return res.status(400).json({ error: 'mentor_id and session_time are required.' });
  }

  try {
    await dbRunAsync(
      'INSERT INTO mentor_sessions (mentor_id, student_id, session_time, notes) VALUES (?, ?, ?, ?)',
      [mentor_id, req.session.userId, session_time, notes || '']
    );
    res.json({ success: true, message: 'Mentor session request submitted.' });
  } catch (error) {
    console.error('Error creating mentor session:', error);
    res.status(500).json({ error: 'Failed to request mentor session.' });
  }
});

app.post('/api/student/documents', protectedApiRoute, documentUpload.single('document'), async (req, res) => {
  const { doc_type } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'Document file is required.' });
  }

  if (!doc_type) {
    return res.status(400).json({ error: 'doc_type is required.' });
  }

  try {
    await dbRunAsync(
      'INSERT INTO student_documents (user_id, doc_type, file_path) VALUES (?, ?, ?)',
      [req.session.userId, doc_type, req.file.path]
    );
    res.json({ success: true, message: 'Document uploaded successfully.' });
  } catch (error) {
    console.error('Error uploading student document:', error);
    res.status(500).json({ error: 'Failed to upload document.' });
  }
});

app.get('/api/student/documents', protectedApiRoute, async (req, res) => {
  try {
    const docs = await dbAllAsync(
      'SELECT * FROM student_documents WHERE user_id = ? ORDER BY datetime(uploaded_at) DESC',
      [req.session.userId]
    );
    res.json(docs);
  } catch (error) {
    console.error('Error fetching student documents:', error);
    res.status(500).json({ error: 'Failed to fetch documents.' });
  }
});

app.get('/api/student/offers', protectedApiRoute, async (req, res) => {
  try {
    const offers = await dbAllAsync(
      `
      SELECT o.*, d.role_title
      FROM offer_letters o
      LEFT JOIN drives d ON d.id = o.drive_id
      WHERE o.user_id = ?
      ORDER BY datetime(o.uploaded_at) DESC
      `,
      [req.session.userId]
    );
    res.json(offers);
  } catch (error) {
    console.error('Error fetching student offers:', error);
    res.status(500).json({ error: 'Failed to fetch offers.' });
  }
});

app.put('/api/student/offers/:offerId/acceptance', protectedApiRoute, async (req, res) => {
  const { offerId } = req.params;
  const { acceptance_status } = req.body;

  if (!['accepted', 'declined', 'pending'].includes(acceptance_status)) {
    return res.status(400).json({ error: 'Invalid acceptance_status.' });
  }

  try {
    const result = await dbRunAsync(
      'UPDATE offer_letters SET acceptance_status = ? WHERE id = ? AND user_id = ?',
      [acceptance_status, offerId, req.session.userId]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Offer not found.' });
    }
    res.json({ success: true, message: 'Offer response updated.' });
  } catch (error) {
    console.error('Error updating offer acceptance:', error);
    res.status(500).json({ error: 'Failed to update offer response.' });
  }
});

app.post('/api/tickets', protectedApiRoute, async (req, res) => {
  const { subject, description, priority } = req.body;

  if (!subject || !description) {
    return res.status(400).json({ error: 'subject and description are required.' });
  }

  try {
    await dbRunAsync(
      'INSERT INTO helpdesk_tickets (user_id, subject, description, priority, status, updated_at) VALUES (?, ?, ?, ?, "open", ?)',
      [req.session.userId, subject, description, priority || 'medium', new Date().toISOString()]
    );
    res.json({ success: true, message: 'Ticket raised successfully.' });
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ error: 'Failed to create ticket.' });
  }
});

app.get('/api/tickets', protectedApiRoute, async (req, res) => {
  try {
    const tickets = await dbAllAsync(
      'SELECT * FROM helpdesk_tickets WHERE user_id = ? ORDER BY datetime(created_at) DESC',
      [req.session.userId]
    );
    res.json(tickets);
  } catch (error) {
    console.error('Error fetching user tickets:', error);
    res.status(500).json({ error: 'Failed to fetch tickets.' });
  }
});

// ------------------------------
// Admin APIs
// ------------------------------
app.get('/api/admin/stats', adminApiRoute, async (req, res) => {
  try {
    const [students, drives, applications, shortlisted, selected, openTickets] = await Promise.all([
      dbGetAsync("SELECT COUNT(*) AS count FROM users WHERE role = 'student' OR role IS NULL"),
      dbGetAsync('SELECT COUNT(*) AS count FROM drives'),
      dbGetAsync('SELECT COUNT(*) AS count FROM applications WHERE user_id IS NOT NULL'),
      dbGetAsync("SELECT COUNT(*) AS count FROM applications WHERE status = 'Shortlisted'"),
      dbGetAsync("SELECT COUNT(*) AS count FROM applications WHERE status = 'Selected'"),
      dbGetAsync("SELECT COUNT(*) AS count FROM helpdesk_tickets WHERE status != 'resolved'")
    ]);

    res.json({
      students: students?.count || 0,
      drives: drives?.count || 0,
      applications: applications?.count || 0,
      shortlisted: shortlisted?.count || 0,
      selected: selected?.count || 0,
      openTickets: openTickets?.count || 0
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ error: 'Failed to fetch admin stats.' });
  }
});

app.get('/api/admin/analytics', adminApiRoute, async (req, res) => {
  try {
    const [monthlyApplications, statusBreakdown, branchBreakdown] = await Promise.all([
      dbAllAsync(`
        SELECT strftime('%Y-%m', application_date) AS month, COUNT(*) AS total
        FROM applications
        WHERE user_id IS NOT NULL
        GROUP BY strftime('%Y-%m', application_date)
        ORDER BY month DESC
        LIMIT 12
      `),
      dbAllAsync(`
        SELECT status, COUNT(*) AS total
        FROM applications
        WHERE user_id IS NOT NULL
        GROUP BY status
      `),
      dbAllAsync(`
        SELECT COALESCE(p.branch, 'Not Set') AS branch, COUNT(a.id) AS total
        FROM users u
        LEFT JOIN profiles p ON p.user_id = u.id
        LEFT JOIN applications a ON a.user_id = u.id
        WHERE u.role = 'student' OR u.role IS NULL
        GROUP BY COALESCE(p.branch, 'Not Set')
        ORDER BY total DESC
      `)
    ]);

    res.json({ monthlyApplications, statusBreakdown, branchBreakdown });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics.' });
  }
});

app.get('/api/admin/drives', adminApiRoute, async (req, res) => {
  try {
    const drives = await dbAllAsync('SELECT * FROM drives ORDER BY datetime(created_at) DESC');
    res.json(drives);
  } catch (error) {
    console.error('Error fetching admin drives:', error);
    res.status(500).json({ error: 'Failed to fetch drives.' });
  }
});

app.post('/api/admin/drives', adminApiRoute, async (req, res) => {
  const {
    company_name,
    role_title,
    job_type,
    location,
    package_lpa,
    eligibility_cgpa,
    eligibility_backlogs,
    eligible_branches,
    batch_year,
    deadline,
    description,
    status
  } = req.body;

  if (!company_name || !role_title || !deadline) {
    return res.status(400).json({ error: 'company_name, role_title and deadline are required.' });
  }

  try {
    const result = await dbRunAsync(
      `
      INSERT INTO drives (
        company_name, role_title, job_type, location, package_lpa,
        eligibility_cgpa, eligibility_backlogs, eligible_branches,
        batch_year, deadline, description, status, created_by_type, created_by_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?)
      `,
      [
        company_name,
        role_title,
        job_type || 'Full-time',
        location || '',
        package_lpa || null,
        eligibility_cgpa || 0,
        eligibility_backlogs ?? 99,
        eligible_branches || '',
        batch_year || null,
        deadline,
        description || '',
        status || 'published',
        req.session.adminId,
        new Date().toISOString()
      ]
    );

    res.json({ success: true, driveId: result.lastID });
  } catch (error) {
    console.error('Error creating drive:', error);
    res.status(500).json({ error: 'Failed to create drive.' });
  }
});

app.put('/api/admin/drives/:driveId', adminApiRoute, async (req, res) => {
  const { driveId } = req.params;
  const {
    company_name,
    role_title,
    job_type,
    location,
    package_lpa,
    eligibility_cgpa,
    eligibility_backlogs,
    eligible_branches,
    batch_year,
    deadline,
    description,
    status
  } = req.body;

  try {
    const result = await dbRunAsync(
      `
      UPDATE drives
      SET company_name = ?, role_title = ?, job_type = ?, location = ?, package_lpa = ?,
          eligibility_cgpa = ?, eligibility_backlogs = ?, eligible_branches = ?,
          batch_year = ?, deadline = ?, description = ?, status = ?, updated_at = ?
      WHERE id = ?
      `,
      [
        company_name,
        role_title,
        job_type,
        location,
        package_lpa || null,
        eligibility_cgpa || 0,
        eligibility_backlogs ?? 99,
        eligible_branches || '',
        batch_year || null,
        deadline,
        description || '',
        status || 'published',
        new Date().toISOString(),
        driveId
      ]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Drive not found.' });
    }
    res.json({ success: true, message: 'Drive updated.' });
  } catch (error) {
    console.error('Error updating drive:', error);
    res.status(500).json({ error: 'Failed to update drive.' });
  }
});

app.delete('/api/admin/drives/:driveId', adminApiRoute, async (req, res) => {
  const { driveId } = req.params;
  try {
    const result = await dbRunAsync('DELETE FROM drives WHERE id = ?', [driveId]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Drive not found.' });
    }
    res.json({ success: true, message: 'Drive deleted.' });
  } catch (error) {
    console.error('Error deleting drive:', error);
    res.status(500).json({ error: 'Failed to delete drive.' });
  }
});

app.get('/api/admin/applications', adminApiRoute, async (req, res) => {
  try {
    const applications = await dbAllAsync(
      `
      SELECT
        a.*,
        u.username,
        u.email AS user_email,
        d.company_name AS drive_company_name,
        d.role_title
      FROM applications a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN drives d ON d.id = a.drive_id
      WHERE a.user_id IS NOT NULL
      ORDER BY datetime(a.application_date) DESC
      `
    );
    res.json(applications);
  } catch (error) {
    console.error('Error fetching admin applications:', error);
    res.status(500).json({ error: 'Failed to fetch applications.' });
  }
});

app.post('/api/admin/applications/:applicationId/round-update', adminApiRoute, async (req, res) => {
  const { applicationId } = req.params;
  const { round_name, status, remarks } = req.body;

  if (!round_name || !status) {
    return res.status(400).json({ error: 'round_name and status are required.' });
  }

  try {
    const appRecord = await dbGetAsync('SELECT id FROM applications WHERE id = ?', [applicationId]);
    if (!appRecord) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    const now = new Date().toISOString();
    await dbRunAsync(
      'UPDATE applications SET status = ?, current_round = ?, notes = ?, updated_at = ? WHERE id = ?',
      [status, round_name, remarks || '', now, applicationId]
    );

    await dbRunAsync(
      `
      INSERT INTO application_round_events
      (application_id, round_name, status, remarks, updated_by_type, updated_by_id)
      VALUES (?, ?, ?, ?, 'admin', ?)
      `,
      [applicationId, round_name, status, remarks || '', req.session.adminId]
    );

    res.json({ success: true, message: 'Round update saved.' });
  } catch (error) {
    console.error('Error updating application round:', error);
    res.status(500).json({ error: 'Failed to update round status.' });
  }
});

app.get('/api/admin/announcements', adminApiRoute, async (req, res) => {
  try {
    const announcements = await dbAllAsync(
      'SELECT * FROM announcements ORDER BY datetime(created_at) DESC'
    );
    res.json(announcements);
  } catch (error) {
    console.error('Error fetching admin announcements:', error);
    res.status(500).json({ error: 'Failed to fetch announcements.' });
  }
});

app.post('/api/admin/announcements', adminApiRoute, async (req, res) => {
  const { title, content, priority, scheduled_at, expires_at, is_published } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required.' });
  }

  try {
    const result = await dbRunAsync(
      `
      INSERT INTO announcements (title, content, priority, scheduled_at, expires_at, is_published, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        title,
        content,
        priority || 'normal',
        scheduled_at || null,
        expires_at || null,
        is_published ? 1 : 0,
        req.session.adminId
      ]
    );
    res.json({ success: true, announcementId: result.lastID });
  } catch (error) {
    console.error('Error creating announcement:', error);
    res.status(500).json({ error: 'Failed to create announcement.' });
  }
});

app.put('/api/admin/announcements/:announcementId/publish', adminApiRoute, async (req, res) => {
  const { announcementId } = req.params;
  const { is_published } = req.body;

  try {
    const result = await dbRunAsync(
      'UPDATE announcements SET is_published = ? WHERE id = ?',
      [is_published ? 1 : 0, announcementId]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Announcement not found.' });
    }
    res.json({ success: true, message: 'Announcement publish state updated.' });
  } catch (error) {
    console.error('Error updating announcement publish status:', error);
    res.status(500).json({ error: 'Failed to update announcement.' });
  }
});

app.get('/api/admin/interview-slots', adminApiRoute, async (req, res) => {
  try {
    const slots = await dbAllAsync(
      `
      SELECT
        s.*,
        u.username,
        u.email AS user_email,
        d.company_name,
        d.role_title
      FROM interview_slots s
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN drives d ON d.id = s.drive_id
      ORDER BY datetime(s.slot_time) ASC
      `
    );
    res.json(slots);
  } catch (error) {
    console.error('Error fetching interview slots:', error);
    res.status(500).json({ error: 'Failed to fetch interview slots.' });
  }
});

app.post('/api/admin/interview-slots', adminApiRoute, async (req, res) => {
  const { drive_id, user_id, slot_time, venue, meeting_link } = req.body;

  if (!drive_id || !user_id || !slot_time) {
    return res.status(400).json({ error: 'drive_id, user_id and slot_time are required.' });
  }

  try {
    await dbRunAsync(
      `
      INSERT INTO interview_slots (drive_id, user_id, slot_time, venue, meeting_link, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [drive_id, user_id, slot_time, venue || '', meeting_link || '', req.session.adminId]
    );
    res.json({ success: true, message: 'Interview slot scheduled.' });
  } catch (error) {
    console.error('Error scheduling interview slot:', error);
    res.status(500).json({ error: 'Failed to schedule interview slot.' });
  }
});

app.get('/api/admin/documents', adminApiRoute, async (req, res) => {
  try {
    const documents = await dbAllAsync(
      `
      SELECT d.*, u.username, u.email
      FROM student_documents d
      LEFT JOIN users u ON u.id = d.user_id
      ORDER BY datetime(d.uploaded_at) DESC
      `
    );
    res.json(documents);
  } catch (error) {
    console.error('Error fetching documents for verification:', error);
    res.status(500).json({ error: 'Failed to fetch documents.' });
  }
});

app.put('/api/admin/documents/:documentId/verify', adminApiRoute, async (req, res) => {
  const { documentId } = req.params;
  const { verification_status, verification_notes } = req.body;

  if (!['approved', 'rejected', 'pending'].includes(verification_status)) {
    return res.status(400).json({ error: 'Invalid verification_status.' });
  }

  try {
    const result = await dbRunAsync(
      `
      UPDATE student_documents
      SET verification_status = ?, verification_notes = ?, verified_by = ?, verified_at = ?
      WHERE id = ?
      `,
      [verification_status, verification_notes || '', req.session.adminId, new Date().toISOString(), documentId]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    res.json({ success: true, message: 'Document verification updated.' });
  } catch (error) {
    console.error('Error verifying document:', error);
    res.status(500).json({ error: 'Failed to verify document.' });
  }
});

app.get('/api/admin/tickets', adminApiRoute, async (req, res) => {
  try {
    const tickets = await dbAllAsync(
      `
      SELECT t.*, u.username, u.email
      FROM helpdesk_tickets t
      LEFT JOIN users u ON u.id = t.user_id
      ORDER BY
        CASE t.status
          WHEN 'open' THEN 1
          WHEN 'in_progress' THEN 2
          ELSE 3
        END,
        datetime(t.created_at) DESC
      `
    );
    res.json(tickets);
  } catch (error) {
    console.error('Error fetching admin tickets:', error);
    res.status(500).json({ error: 'Failed to fetch tickets.' });
  }
});

app.put('/api/admin/tickets/:ticketId', adminApiRoute, async (req, res) => {
  const { ticketId } = req.params;
  const { status, assigned_to, priority } = req.body;

  try {
    const result = await dbRunAsync(
      'UPDATE helpdesk_tickets SET status = ?, assigned_to = ?, priority = ?, updated_at = ? WHERE id = ?',
      [status || 'open', assigned_to || null, priority || 'medium', new Date().toISOString(), ticketId]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }
    res.json({ success: true, message: 'Ticket updated.' });
  } catch (error) {
    console.error('Error updating ticket:', error);
    res.status(500).json({ error: 'Failed to update ticket.' });
  }
});

app.post('/api/admin/offer-letters', adminApiRoute, offerUpload.single('offer_letter'), async (req, res) => {
  const { drive_id, user_id, company_name } = req.body;
  if (!req.file) {
    return res.status(400).json({ error: 'Offer letter file is required.' });
  }
  if (!drive_id || !user_id) {
    return res.status(400).json({ error: 'drive_id and user_id are required.' });
  }

  try {
    let finalCompanyName = company_name;
    if (!finalCompanyName) {
      const drive = await dbGetAsync('SELECT company_name FROM drives WHERE id = ?', [drive_id]);
      finalCompanyName = drive?.company_name || 'Unknown Company';
    }

    await dbRunAsync(
      `
      INSERT INTO offer_letters (drive_id, user_id, company_name, file_path, uploaded_by)
      VALUES (?, ?, ?, ?, ?)
      `,
      [drive_id, user_id, finalCompanyName, req.file.path, req.session.adminId]
    );
    res.json({ success: true, message: 'Offer letter uploaded.' });
  } catch (error) {
    console.error('Error uploading offer letter:', error);
    res.status(500).json({ error: 'Failed to upload offer letter.' });
  }
});

app.get('/api/admin/offer-letters', adminApiRoute, async (req, res) => {
  try {
    const offers = await dbAllAsync(
      `
      SELECT o.*, u.username, u.email, d.role_title
      FROM offer_letters o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN drives d ON d.id = o.drive_id
      ORDER BY datetime(o.uploaded_at) DESC
      `
    );
    res.json(offers);
  } catch (error) {
    console.error('Error fetching offer letters:', error);
    res.status(500).json({ error: 'Failed to fetch offer letters.' });
  }
});

app.get('/api/admin/reports/applications.csv', adminApiRoute, async (req, res) => {
  const escapeCsvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  try {
    const rows = await dbAllAsync(
      `
      SELECT
        a.id,
        u.username,
        u.email,
        a.company_name,
        d.role_title,
        a.status,
        a.current_round,
        a.application_date,
        a.updated_at
      FROM applications a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN drives d ON d.id = a.drive_id
      WHERE a.user_id IS NOT NULL
      ORDER BY datetime(a.application_date) DESC
      `
    );

    const header = [
      'Application ID',
      'Student Username',
      'Student Email',
      'Company',
      'Role',
      'Status',
      'Current Round',
      'Applied At',
      'Updated At'
    ];
    const csvLines = [header.map(escapeCsvCell).join(',')];

    rows.forEach((row) => {
      csvLines.push(
        [
          row.id,
          row.username,
          row.email,
          row.company_name,
          row.role_title,
          row.status,
          row.current_round,
          row.application_date,
          row.updated_at
        ].map(escapeCsvCell).join(',')
      );
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="applications-report.csv"');
    res.send(csvLines.join('\n'));
  } catch (error) {
    console.error('Error generating applications CSV report:', error);
    res.status(500).json({ error: 'Failed to generate applications report.' });
  }
});

// ------------------------------
// Recruiter APIs
// ------------------------------
app.get('/api/recruiter/drives', recruiterApiRoute, async (req, res) => {
  try {
    const drives = await dbAllAsync(
      `
      SELECT *
      FROM drives
      WHERE created_by_type = 'recruiter' AND created_by_id = ?
      ORDER BY datetime(created_at) DESC
      `,
      [req.session.recruiterId]
    );
    res.json(drives);
  } catch (error) {
    console.error('Error fetching recruiter drives:', error);
    res.status(500).json({ error: 'Failed to fetch recruiter drives.' });
  }
});

app.post('/api/recruiter/drives', recruiterApiRoute, async (req, res) => {
  const {
    role_title,
    job_type,
    location,
    package_lpa,
    eligibility_cgpa,
    eligibility_backlogs,
    eligible_branches,
    batch_year,
    deadline,
    description
  } = req.body;

  if (!role_title || !deadline) {
    return res.status(400).json({ error: 'role_title and deadline are required.' });
  }

  try {
    await dbRunAsync(
      `
      INSERT INTO drives (
        company_name, role_title, job_type, location, package_lpa,
        eligibility_cgpa, eligibility_backlogs, eligible_branches,
        batch_year, deadline, description, status, created_by_type, created_by_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', 'recruiter', ?, ?)
      `,
      [
        req.session.recruiterCompany,
        role_title,
        job_type || 'Full-time',
        location || '',
        package_lpa || null,
        eligibility_cgpa || 0,
        eligibility_backlogs ?? 99,
        eligible_branches || '',
        batch_year || null,
        deadline,
        description || '',
        req.session.recruiterId,
        new Date().toISOString()
      ]
    );

    res.json({ success: true, message: 'Drive submitted for admin approval.' });
  } catch (error) {
    console.error('Error creating recruiter drive:', error);
    res.status(500).json({ error: 'Failed to create recruiter drive.' });
  }
});

app.get('/api/recruiter/applications', recruiterApiRoute, async (req, res) => {
  try {
    const applications = await dbAllAsync(
      `
      SELECT
        a.*,
        u.username,
        u.email AS user_email,
        d.company_name,
        d.role_title
      FROM applications a
      INNER JOIN drives d ON d.id = a.drive_id
      LEFT JOIN users u ON u.id = a.user_id
      WHERE d.created_by_type = 'recruiter' AND d.created_by_id = ?
      ORDER BY datetime(a.application_date) DESC
      `,
      [req.session.recruiterId]
    );
    res.json(applications);
  } catch (error) {
    console.error('Error fetching recruiter applications:', error);
    res.status(500).json({ error: 'Failed to fetch recruiter applications.' });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log('Upload directories initialized and ready.');
});