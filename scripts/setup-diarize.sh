#!/usr/bin/env bash
# Setup script for speaker diarization (pyannote-audio + torch)
#
# What it does:
#   1. Installs Python 3.11 via Homebrew if needed
#   2. Creates a venv at data/diarize-venv/
#   3. Installs pyannote.audio and torch (with MPS for Apple Silicon)
#   4. Prompts for HuggingFace token and stores in .env
#   5. Pre-downloads the pyannote model
#   6. Sets DIARIZE_ENABLED=true in .env

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_ROOT/data/diarize-venv"
ENV_FILE="$PROJECT_ROOT/.env"

echo "=== NanoClaw Speaker Diarization Setup ==="
echo ""

# --- Step 1: Ensure Python 3.10+ ---
PYTHON_BIN=""

# Check for Homebrew Python 3.11+
for ver in python@3.13 python@3.12 python@3.11; do
  if brew list "$ver" &>/dev/null; then
    PYTHON_BIN="$(brew --prefix "$ver")/bin/python3"
    break
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "Python 3.11+ not found. Installing via Homebrew..."
  brew install python@3.11
  PYTHON_BIN="$(brew --prefix python@3.11)/bin/python3"
fi

PY_VERSION=$("$PYTHON_BIN" --version 2>&1)
echo "Using $PY_VERSION at $PYTHON_BIN"
echo ""

# --- Step 2: Create venv ---
if [ -d "$VENV_DIR" ]; then
  echo "Existing venv found at $VENV_DIR"
  read -rp "Recreate it? (y/N) " answer
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    rm -rf "$VENV_DIR"
  else
    echo "Keeping existing venv."
  fi
fi

if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtual environment at $VENV_DIR..."
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

VENV_PYTHON="$VENV_DIR/bin/python"
echo ""

# --- Step 3: Install dependencies ---
echo "Installing pyannote.audio and torch (this may take a few minutes)..."
"$VENV_PYTHON" -m pip install --upgrade pip --quiet
"$VENV_PYTHON" -m pip install pyannote.audio torch torchaudio --quiet
echo "Dependencies installed."
echo ""

# --- Step 4: HuggingFace token ---
# Check if already set in .env
EXISTING_TOKEN=""
if [ -f "$ENV_FILE" ]; then
  EXISTING_TOKEN=$(grep -oP '(?<=^HF_TOKEN=).*' "$ENV_FILE" 2>/dev/null || true)
fi

if [ -n "$EXISTING_TOKEN" ]; then
  echo "HuggingFace token already set in .env"
else
  echo "pyannote requires a HuggingFace token."
  echo "1. Go to https://huggingface.co/pyannote/speaker-diarization-3.1"
  echo "2. Accept the license agreement"
  echo "3. Create a token at https://huggingface.co/settings/tokens"
  echo ""
  read -rp "Enter your HuggingFace token: " HF_TOKEN

  if [ -z "$HF_TOKEN" ]; then
    echo "No token provided. You'll need to set HF_TOKEN in .env manually."
  else
    if [ -f "$ENV_FILE" ]; then
      # Append if not already present
      if ! grep -q "^HF_TOKEN=" "$ENV_FILE"; then
        echo "HF_TOKEN=$HF_TOKEN" >> "$ENV_FILE"
      fi
    else
      echo "HF_TOKEN=$HF_TOKEN" > "$ENV_FILE"
    fi
    echo "Token saved to .env"
  fi
fi
echo ""

# --- Step 5: Pre-download model ---
echo "Pre-downloading pyannote model (first run only)..."
HF_TOKEN_VAL="${EXISTING_TOKEN:-${HF_TOKEN:-}}"
if [ -n "$HF_TOKEN_VAL" ]; then
  HF_TOKEN="$HF_TOKEN_VAL" "$VENV_PYTHON" -c "
from pyannote.audio import Pipeline
Pipeline.from_pretrained('pyannote/speaker-diarization-3.1', use_auth_token='$HF_TOKEN_VAL')
print('Model downloaded successfully.')
" || echo "Model pre-download failed. It will download on first use."
else
  echo "Skipping model download (no token). It will download on first use."
fi
echo ""

# --- Step 6: Enable diarization ---
if [ -f "$ENV_FILE" ]; then
  if grep -q "^DIARIZE_ENABLED=" "$ENV_FILE"; then
    sed -i '' 's/^DIARIZE_ENABLED=.*/DIARIZE_ENABLED=true/' "$ENV_FILE"
  else
    echo "DIARIZE_ENABLED=true" >> "$ENV_FILE"
  fi
else
  echo "DIARIZE_ENABLED=true" > "$ENV_FILE"
fi

echo "=== Setup Complete ==="
echo ""
echo "Diarization is now enabled. Restart NanoClaw to activate:"
echo "  launchctl kickstart -k gui/\$(id -u)/com.nanoclaw"
echo ""
echo "Audio files longer than 60 seconds will get speaker labels."
echo "Adjust with DIARIZE_MIN_DURATION in .env (default: 60 seconds)."
