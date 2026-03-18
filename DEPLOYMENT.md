# 🚀 Deployment Guide - Sofer SaaS

## **Railway.app Deployment**

### **Prerequisites**
- Railway account (free tier available)
- GitHub repository with this code
- Database (optional, for future features)

---

## **One-Click Deployment Steps**

### **1. Push Code to GitHub**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/sofer-saas.git
git push -u origin main
```

### **2. Deploy on Railway**
1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Select your `sofer-saas` repository
5. Railway automatically detects Node.js project

### **3. Configuration**
Railway will automatically:
- Install dependencies via `npm install`
- Build frontend via `npm run build`
- Start server via `npm run start:prod`
- Initialize Ollama in background (`setup.sh`)

### **4. Environment Variables** (if needed)
In Railway dashboard:
- `NODE_ENV` = `production`
- `PORT` = `3000` (Railway assigns automatically)

---

## **What Happens on Deploy**

### **Timeline:**
1. **0-2 min**: Container starts, npm installs dependencies
2. **2-5 min**: Frontend builds (Vite)
3. **5-10 min**: Server starts, Ollama initializes
4. **10-30 min**: First deployment pulls Mistral model (~4.5GB)
5. **30+ min**: App ready and fully operational

### **Log you'll see:**
```
🔄 Checking Ollama status...
⏳ Ollama not running, starting...
⏳ Waiting for Ollama to initialize...
📦 Pulling Mistral model...
✅ Mistral model ready
Server running on http://localhost:3000
```

---

## **Accessing Your App**

- **URL**: `https://your-app-name.railway.app`
- **Features**: 
  - ✅ Automatically uses server-side Ollama
  - ✅ No local setup needed
  - ✅ Users just upload documents
  - ✅ Shows "🟢 Server Ready" when initialized

---

## **Cost Estimates (Railway Free Tier)**

| Resource | Monthly Free | Cost if Over |
|----------|-------------|-------------|
| Compute (512 MB RAM) | $5 credit | $0.000463/min |
| Storage (5 GB) | Included | $0.001/GB |
| Network | Included | $0.01/GB out |

**Typical monthly usage**: ~$5-10 with model caching

---

## **Troubleshooting**

### **Ollama not initializing**
- Check logs: Click "Logs" in Railway dashboard
- Wait 5-10 minutes on first deploy
- Redeploy if stuck: `railway up`

### **Slow document processing**
- First model download takes time
- Subsequent requests are faster (model cached)
- Processing: ~30s-2min per document

### **Out of memory**
- Railway free tier: 512MB RAM
- Model needs ~4GB
- Available after compilation, should work

---

## **Custom Domain**

1. In Railway dashboard: Settings → Custom Domain
2. Add your domain (e.g., `docs.yourbusiness.com`)
3. Point CNAME to Railway's provided DNS
4. Wait 5-10 minutes for SSL cert

---

## **Production Checklist**

- [ ] Code pushed to GitHub
- [ ] Railway project created
- [ ] Deployment completed (check logs)
- [ ] Test at `https://your-app.railway.app`
- [ ] Upload test document
- [ ] Get ETA display  ✓
- [ ] Check results in table
- [ ] Custom domain configured (optional)

---

## **Local Testing Before Deploy**

```bash
# Build frontend
npm run build

# Test production build locally
NODE_ENV=production npm run start:prod

# Open browser to http://localhost:3001
```

---

## **Need Help?**

- Railway Docs: https://docs.railway.app
- Ollama Docs: https://ollama.ai
- Check server logs in Railway dashboard
