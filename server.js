const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('./database.js');
require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const app = express();
const port = 3000;

// Serve static files from the root directory
app.use(express.static(__dirname));
app.use(express.urlencoded({ extended: true }));

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

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

// Route to handle resume uploads
app.post('/upload', upload.single('resume'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }
  res.send(`File uploaded successfully: ${req.file.path}`);
});

// Route to handle drive applications
app.post('/apply', (req, res) => {
  const { company_name } = req.body;
  const application_date = new Date().toISOString();

  const sql = `INSERT INTO applications (company_name, application_date) VALUES (?, ?)`;
  db.run(sql, [company_name, application_date], (err) => {
    if (err) {
      console.error(err.message);
      return res.status(500).send('Error saving application.');
    }
    res.redirect('/applySuccess.html');
  });
});

// Chatbot route
app.use(express.json());
app.post('/chatbot', async (req, res) => {
  const userMessage = req.body.message;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro"});
    const result = await model.generateContent(userMessage);
    const response = await result.response;
    const text = response.text();
    res.json({ response: text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ response: 'Error generating response from AI.' });
  }
});


app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
