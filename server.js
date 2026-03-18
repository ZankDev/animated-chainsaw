import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import https from 'https';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve built frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
}

// File storage setup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp'];
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// Routes

// Upload file
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (req.file) {
    res.json({ 
      success: true, 
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } else {
    res.status(400).json({ success: false, error: 'No file uploaded' });
  }
});

// Get all files
app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(uploadDir).map(filename => {
      const filepath = path.join(uploadDir, filename);
      const stat = fs.statSync(filepath);
      return {
        filename,
        originalName: filename.split('-').slice(1).join('-'),
        size: stat.size,
        uploadedAt: stat.birthtime
      };
    });
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download/serve file
app.get('/api/files/:filename', (req, res) => {
  const filepath = path.join(uploadDir, req.params.filename);
  if (fs.existsSync(filepath)) {
    res.download(filepath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Delete file
app.delete('/api/files/:filename', (req, res) => {
  const filepath = path.join(uploadDir, req.params.filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Check if Ollama is running
app.get('/api/ollama/status', async (req, res) => {
  try {
    const response = await fetch('http://localhost:11434/api/tags', { timeout: 2000 });
    if (response.ok) {
      const data = await response.json();
      const hasModels = data.models && data.models.length > 0;
      res.json({ 
        running: true, 
        message: hasModels ? '✅ Server Ready - Processing Available' : '⏳ Loading models...',
        models: data.models
      });
    } else {
      res.json({ 
        running: false, 
        message: '⏳ Ollama initializing... (deployed on Railway - running separately)' 
      });
    }
  } catch (err) {
    res.json({ 
      running: false, 
      message: '📍 Ollama not available. Deploy on Railway? Set up Ollama separately (local machine or cloud service).'
    });
  }
});

// Auto-download and setup Ollama
app.post('/api/ollama/auto-setup', async (req, res) => {
  try {
    const platform = os.platform();

    // Check if Ollama is already running
    try {
      const response = await fetch('http://localhost:11434/api/tags', { timeout: 2000 });
      if (response.ok) {
        return res.json({ success: true, status: 'Ollama already running', step: 'pulling' });
      }
    } catch (err) {
      // Not running
    }

    // For Railway deployment, provide instructions
    if (process.env.RAILWAY_ENVIRONMENT_NAME) {
      return res.json({
        success: true,
        status: 'Running on Railway - Ollama setup required',
        instructions: `
        Railway containers don't support Ollama installation. 
        
        Options:
        1. Run Ollama on your local machine and connect remotely
        2. Use a separate Ollama deployment (Docker, cloud service)
        3. Use Ollama cloud service (https://ollama.ai)
        
        After setting up Ollama, the app will automatically detect it.
        `,
        step: 'external-setup'
      });
    }

    // For local development (non-Railway)
    if (platform === 'win32') {
      return res.json({
        success: true,
        status: 'Download Ollama for Windows',
        downloadUrl: 'https://ollama.ai/download/OllamaSetup.exe',
        instructions: `1. Download OllamaSetup.exe
        2. Run the installer
        3. Ollama will start automatically
        4. Come back and the app will detect it`,
        step: 'download'
      });
    } else if (platform === 'darwin') {
      return res.json({
        success: true,
        status: 'Download Ollama for Mac',
        downloadUrl: 'https://ollama.ai/download/Ollama-darwin.zip',
        instructions: `1. Download and extract
        2. Run the app
        3. Ollama will start automatically`,
        step: 'download'
      });
    } else {
      return res.json({
        success: true,
        status: 'Download Ollama for Linux',
        downloadUrl: 'https://ollama.ai',
        instructions: `Visit https://ollama.ai for Linux installation instructions`,
        step: 'download'
      });
    }

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Setup Ollama (pull model after manual installation)
app.post('/api/ollama/setup', async (req, res) => {
  try {
    // Check if Ollama is running
    const checkResponse = await fetch('http://localhost:11434/api/tags', { timeout: 2000 });
    if (!checkResponse.ok) {
      return res.status(503).json({ 
        success: false, 
        error: 'Ollama not running',
        message: 'Please start Ollama first. Use the auto-setup button for instructions.'
      });
    }

    // Ollama is running, pull the model
    res.json({ success: true, status: 'Pulling mistral model...' });
    
    // Execute in background
    exec('ollama pull mistral', (error, stdout, stderr) => {
      if (error) console.log('Model pull in progress:', error.message);
      else console.log('✅ Model pulled successfully');
    });

  } catch (err) {
    res.status(503).json({ 
      success: false, 
      error: 'Ollama not available',
      message: 'Could not connect to Ollama. Please ensure it\'s installed and running.' 
    });
  }
});

// Proxy to Ollama for chat
app.post('/api/ollama/chat', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mistral',
        prompt: req.body.prompt,
        stream: false
      }),
      timeout: 5000
    });

    if (!response.ok) {
      return res.status(503).json({ 
        error: 'Ollama not available', 
        message: 'Please set up Ollama first. See status endpoint for instructions.' 
      });
    }

    const data = await response.json();
    res.json({ response: data.response });
  } catch (err) {
    res.status(503).json({ 
      error: 'Ollama not available', 
      message: 'Ollama service is not running. Please set up and start Ollama.' 
    });
  }
});

// Auto-initialize Ollama on startup (optional)
async function initializeOllama() {
  console.log('🔄 Checking Ollama status...');
  
  try {
    const response = await fetch('http://localhost:11434/api/tags', { timeout: 3000 });
    if (response.ok) {
      console.log('✅ Ollama is already running');
      return;
    }
  } catch (err) {
    console.log('ℹ️ Ollama not available (this is optional). App will work without it.');
    console.log('ℹ️ To use AI features, set up Ollama separately (local or cloud service).');
  }
}

// Initialize Ollama check (non-blocking)
initializeOllama().catch(err => {
  console.log('ℹ️ Ollama initialization skipped:', err.message);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Uploads folder: ${uploadDir}`);
});
