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
    const response = await fetch('http://localhost:11434/api/tags', { timeout: 3000 });
    if (response.ok) {
      const data = await response.json();
      const hasModels = data.models && data.models.length > 0;
      res.json({ 
        running: true, 
        message: hasModels ? '✅ Server Ready - Processing Available' : '⏳ Loading models...',
        models: data.models
      });
    } else {
      res.json({ running: false, message: '⏳ Server initializing AI model... (4-5 min on first deploy)' });
    }
  } catch (err) {
    res.json({ 
      running: false, 
      message: '⏳ Server initializing AI model... Installing & downloading (4-5 min first time)' 
    });
  }
});

// Auto-download and setup Ollama
app.post('/api/ollama/auto-setup', async (req, res) => {
  try {
    const platform = os.platform();
    const downloadDir = path.join(__dirname, 'downloads');
    
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    // Step 1: Check if Ollama is already running
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (response.ok) {
        return res.json({ success: true, status: 'Ollama already running', step: 'pulling' });
      }
    } catch (err) {
      // Not running, continue with install
    }

    // Step 2: Check if Ollama command exists
    try {
      await execAsync('ollama --version');
      // Ollama is installed but not running, try to start it
      exec('start ollama serve', { shell: true }, (error) => {
        if (error) console.error('Failed to start Ollama:', error);
      });
      return res.json({ success: true, status: 'Starting Ollama...', step: 'starting' });
    } catch (err) {
      // Ollama not installed
    }

    // Step 3: Download installer
    if (platform === 'win32') {
      const installerUrl = 'https://ollama.ai/download/OllamaSetup.exe';
      const installerPath = path.join(downloadDir, 'OllamaSetup.exe');

      return res.json({
        success: true,
        status: 'Ready to download',
        downloadUrl: installerUrl,
        installerPath,
        instructions: `1. Download will start
        2. Run the installer
        3. Ollama will start automatically
        4. Come back here and click "Connect Local Model" again`,
        step: 'download'
      });
    } else if (platform === 'darwin') {
      return res.json({
        success: true,
        status: 'Download Ollama for Mac',
        downloadUrl: 'https://ollama.ai/download/Ollama-darwin.zip',
        instructions: `Download and run the macOS installer, then try again.`,
        step: 'download'
      });
    } else {
      return res.json({
        success: true,
        status: 'Download Ollama for Linux',
        downloadUrl: 'https://ollama.ai',
        instructions: `Visit https://ollama.ai to download Linux version`,
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
    // Try to detect if ollama command exists
    try {
      await execAsync('ollama --version');
    } catch (err) {
      return res.status(400).json({ 
        success: false, 
        error: 'Ollama not installed. Click auto-setup button to download.',
        needsManualInstall: true
      });
    }

    // Pull model
    res.json({ success: true, status: 'Pulling mistral model...' });
    
    // Execute in background
    exec('ollama pull mistral', (error, stdout, stderr) => {
      if (error) console.error('Ollama pull error:', error);
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json();
    res.json({ response: data.response });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-initialize Ollama on startup
async function initializeOllama() {
  console.log('🔄 Checking Ollama status...');
  
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    if (response.ok) {
      console.log('✅ Ollama is already running');
      return;
    }
  } catch (err) {
    console.log('⏳ Ollama not running, checking installation...');
  }

  try {
    // Check if ollama command exists
    await execAsync('which ollama');
    console.log('📍 Ollama found, starting...');
  } catch (err) {
    // Ollama not installed, install it on Linux/macOS
    if (process.platform === 'linux' || process.platform === 'darwin') {
      console.log('📥 Ollama not installed. Installing...');
      try {
        await execAsync('curl -fsSL https://ollama.ai/install.sh | sh');
        console.log('✅ Ollama installed');
      } catch (installErr) {
        console.log('⚠️ Install attempt:', installErr.message);
        // Try alternate method
        try {
          await execAsync('apt-get update && apt-get install -y ollama');
          console.log('✅ Ollama installed via apt');
        } catch (aptErr) {
          console.log('⚠️ APT install:', aptErr.message);
        }
      }
    }
  }

  // Start Ollama service
  try {
    if (process.platform === 'linux' || process.platform === 'darwin') {
      console.log('🚀 Starting Ollama service...');
      exec('nohup ollama serve > /tmp/ollama.log 2>&1 &');
      console.log('⏳ Waiting for Ollama to initialize (5 seconds)...');
      await new Promise(r => setTimeout(r, 5000));
      
      console.log('📦 Pulling Mistral model (this may take a few minutes)...');
      exec('ollama pull mistral', (err, stdout, stderr) => {
        if (err) {
          console.log('ℹ️ Model pull in progress or error:', err.message);
        } else {
          console.log('✅ Mistral model ready');
        }
      });
    }
  } catch (err) {
    console.log('ℹ️ Ollama start note:', err.message);
  }
}

// Initialize Ollama
initializeOllama();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Uploads folder: ${uploadDir}`);
});
