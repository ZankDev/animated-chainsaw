#!/bin/bash

echo "🚀 Setting up Sofer SaaS on Railway..."

# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    echo "📥 Installing Ollama..."
    curl -fsSL https://ollama.ai/install.sh | sh
fi

echo "✅ Ollama installed!"

# Add Ollama to PATH for this session
export PATH=$PATH:/bin

# Start Ollama in background
echo "🔄 Starting Ollama service..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to start
echo "⏳ Waiting for Ollama to initialize..."
sleep 10

# Pull the model
echo "📦 Downloading Mistral model (this may take 5-10 minutes)..."
ollama pull mistral

echo "✅ Model ready!"
echo "🎉 Setup complete!"

exit 0
