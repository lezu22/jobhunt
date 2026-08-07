import sys
from pathlib import Path

# Make the backend package root importable when running pytest from anywhere
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
