# 📋 Deploy Checklist - Sofer SaaS to Railway

## Pre-Deployment ✓

- [ ] Code is on GitHub (push all changes)
- [ ] `.env` is NOT committed (use `.env.example` instead)
- [ ] `setup.sh` is executable (`chmod +x setup.sh`)
- [ ] All npm scripts work locally (`npm run dev:all`)
- [ ] Frontend builds without errors (`npm run build`)

---

## Railway Setup

### Step 1: Create Railway Account
- [ ] Go to https://railway.app
- [ ] Sign up (GitHub recommended for easy deploys)

### Step 2: Create New Project
- [ ] Click "New Project"
- [ ] Select "Deploy from GitHub repo"
- [ ] Authorize Railway to access GitHub
- [ ] Select your `sofer-saas` repository

### Step 3: Configuration
Railway auto-detects Node.js project.

**No manual setup needed!** ✨

Environment variables (add if needed):
```
NODE_ENV = production
PORT = (auto)
ANTHROPIC_API_KEY = (optional, if using Claude)
```

### Step 4: Deploy
- [ ] Click "Deploy"
- [ ] Wait for build to complete (~5 min)
- [ ] Refer to logs: click project → Logs tab

---

## Monitoring First Deploy

### Timeline
```
⏱️ 0-2 min    → Installing npm packages
⏱️ 2-5 min    → Building React frontend
⏱️ 5-10 min   → Server starting, Ollama initializing
⏱️ 10-30 min  → Ollama pulling Mistral model (~4.5 GB)
✅ 30+ min    → App ready!
```

### What to look for in logs

✅ **Success indicators:**
```
🔄 Checking Ollama status...
⏳ Ollama not running, starting...
📦 Pulling Mistral model...
✅ Mistral model ready
Server running on http://localhost:3001
```

❌ **Error indicators:**
```
ERROR: npm install failed
ERROR: Vite build failed
ERROR: Ollama not found
ERROR: ENOSPC (disk full)
```

---

## Testing After Deploy

### 1. Check Logs
- [ ] Open Railway dashboard
- [ ] Click on your project
- [ ] View "Logs" tab
- [ ] Look for ✅ "Model ready" message

### 2. Open App
- [ ] Get URL from Railway (top of dashboard, usually `your-app.railway.app`)
- [ ] Open in browser
- [ ] Should load immediately

### 3. Quick Test Upload
- [ ] Drag & drop a test PDF/image
- [ ] Check status badge shows 🟢 Ready
- [ ] Click ▶️ Start
- [ ] Verify processing starts
- [ ] Watch ETA countdown ⏱️

### 4. Check Results
- [ ] Processing completes
- [ ] See results in table
- [ ] Status shows ✅ Done
- [ ] Can export CSV

---

## Troubleshooting

### 🔴 "Server Offline" for 30+ min

**Cause**: Model still downloading (first time only)

**Fix**: 
- [ ] Wait more (model is ~4.5 GB)
- [ ] Check logs for `ollama pull mistral`
- [ ] If stuck, restart: Dashboard → Settings → Restart

### ❌ "Build Failed"

**Check logs for**:
- [ ] `npm install` errors → Check `package.json`
- [ ] `npm run build` errors → Check React code
- [ ] Shell script errors → Check `setup.sh` format

**Fix**: 
- [ ] Fix error locally: `npm run build`
- [ ] Commit & push to GitHub
- [ ] Railway redeploys automatically

### 💾 "Out of Storage"

**If on free tier**:
- [ ] Clear old deployments: Railway Dashboard → Deployments → Delete old ones
- [ ] Upgrade to paid ($5-10/mo)

---

## Production Checklist

- [ ] App loads at your Railway domain
- [ ] Status shows 🟢 Server Ready
- [ ] Can upload documents
- [ ] ETA displays correctly ⏱️
- [ ] Results extract correctly
- [ ] CSV export works
- [ ] No errors in logs
- [ ] (Optional) Set custom domain

---

## Custom Domain

1. [ ] Own a domain (e.g., docs.yourbusiness.com)
2. [ ] In Railway Dashboard:
   - Settings → Custom Domain
   - Add your domain
3. [ ] Update DNS:
   - CNAME: your-domain.com → railway.app subdomain
   - (Railway shows exact value)
4. [ ] SSL auto-enables (takes 5-10 min)

---

## Maintenance

### Monitor Logs Weekly
- [ ] Check for errors
- [ ] Watch for slow processing (early sign of issues)
- [ ] Note model usage

### Update Code
```bash
git commit -am "Feature or fix"
git push origin main
# Railway auto-deploys!
```

### Restart if Needed
- Dashboard → Settings → Restart container

---

## Success! 🎉

Your app is now live! Users can access at:
```
https://your-app-name.railway.app
```

No more local setup needed - Ollama runs on your server automatically!

---

**Questions?** See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed guide
