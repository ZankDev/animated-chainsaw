# 📄 Sofer SaaS - Smart Document Processor

Automated invoice/receipt data extraction with AI. **No local setup needed** - everything runs on your server!

## ✨ Features

- ✅ **Drag & Drop Upload** - PDFs, images (JPG, PNG, WebP)
- ✅ **AI Extraction** - Uses on-server Ollama model (free & private)
- ✅ **Data Fields**: Date, Supplier, Amount, Reference, Description
- ✅ **USD→ILS Conversion** - Automatic with monthly rates
- ✅ **Duplicate Detection** - Flagged with yellow badge
- ✅ **ETA Display** - "כמה זמן נשאר" (Time remaining in Hebrew)
- ✅ **Real-time Progress** - Processing status with bar
- ✅ **CSV Export** - Direct Excel paste or download
- ✅ **Hebrew RTL UI** - Full right-to-left support

---

## 🚀 Quick Start

### **Local Development**
```bash
npm install
npm run dev:all

# Frontend: http://localhost:5173
# Backend: http://localhost:3001
```

### **Deploy to Railway** (Recommended)
See [DEPLOYMENT.md](DEPLOYMENT.md) for complete guide.

1. Push code to GitHub
2. Connect to Railway
3. Deploy (automatic)
4. Ollama downloads model automatically (~10-30 min first time)

---

## 🎯 Usage

1. **Upload documents** - Drag/drop or click button
2. **Wait for initialization** - 🟢 Server Ready indicator lights up
3. **Click ▶️ Start** - Processing begins
4. **Watch ETA** - See "⏱️ כמה זמן נשאר" countdown
5. **Export** - Results appear in table, download as CSV

---

## 🔧 Technology Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| AI Model | Ollama (Mistral 7B) |
| Storage | Local filesystem |
| Hosting | Railway.app |

---

## 📊 Processing

```
Input: PDF/Image → Ollama (on-server) → JSON extraction → 
→ Duplicate check → USD→ILS conversion → Table display → CSV export
```

**Speed**: ~30s-2 min per document (depends on server)
**Model**: Mistral 7B (~4.5 GB)
**Cost**: Free (self-hosted Ollama)

---

## 🎨 UI Features

### Header
- Model status indicator (🟢 Ready / 🔴 Offline)
- Optional Claude API input (for alternative AI)
- Auto-setup button (if on-premise Ollama not ready)

### Drop Zone
- Drag files anywhere
- Accepts: PDF, JPG, PNG, GIF, WebP up to browser limits
- Recursive folder support

### Stats Bar
- Total files, completed, processing count
- Real-time progress bar with percentage
- ⏱️ ETA countdown in Hebrew

### Results Table
- Sortable/scrollable columns
- File name, status, extracted fields
- ILS conversion with exchange rate
- Error messages on failure

---

## 🌍 Deployment Options

### **Railway (Recommended)**
- Free tier: $5 monthly credit
- Automatic Ollama setup
- Just push code, it deploys!
- Best for: SaaS platforms

### **Self-Hosted (Docker)**
```bash
docker-compose up
```

### **Vercel + API Backend**
- Frontend on Vercel
- Backend on Railway/Heroku
- More complex setup

---

## 📝 API Endpoints

```
POST /api/upload           # Upload file
GET  /api/files            # List uploaded files
DELETE /api/files/:file    # Delete file
GET  /api/ollama/status    # Check if model ready
POST /api/ollama/setup     # Initialize Ollama
POST /api/ollama/chat      # Process with Ollama
```

---

## 🛠️ Configuration

### Environment Variables
```bash
PORT=3001                    # Server port
NODE_ENV=production          # production/development
OLLAMA_HOST=http://localhost:11434
```

See `.env.example` for all options.

---

## 📱 Browser Support

- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Mobile browsers

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "🔴 Offline" persists | Wait 10 min on first deploy; check server logs |
| Slow processing | Normal - first model download cached, subsequent faster |
| Upload fails | Check file type (PDF/JPG/PNG/GIF/WebP) and browser storage |
| Out of memory (Railway) | Restart container or upgrade to paid plan |

---

## 📞 Support

- Check [DEPLOYMENT.md](DEPLOYMENT.md) for deployment help
- Review logs in Railway/hosting dashboard
- Ollama docs: https://ollama.ai

---

## 📄 License

MIT

---

## 🎯 Next Steps

- [ ] Local development works ✓
- [ ] Deploy to Railway
- [ ] Add database for history
- [ ] Add user authentication
- [ ] Add email notifications
- [ ] Mobile app

---

**Built with ❤️ for Israeli businesses**
