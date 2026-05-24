#!/bin/bash
echo "⚡ Starting OutageX AI..."

# Check API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
  if [ -f .env ]; then
    export $(cat .env | xargs)
  else
    echo "❌ ERROR: ANTHROPIC_API_KEY not set."
    echo "   Copy .env.example to .env and add your API key."
    echo "   Get a free key at: https://console.anthropic.com"
    exit 1
  fi
fi

# Start backend
echo "🔧 Starting backend on http://127.0.0.1:8000 ..."
cd backend
pip install -r requirements.txt -q
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# Wait for backend to boot
sleep 3

# Start frontend
echo "🎨 Starting frontend on http://localhost:5173 ..."
cd frontend
npm install -q
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ OutageX AI is running!"
echo "   Frontend → http://localhost:5173"
echo "   Backend  → http://127.0.0.1:8000"
echo ""
echo "Press Ctrl+C to stop both servers."

# Wait and cleanup
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'" EXIT
wait
