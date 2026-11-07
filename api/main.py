import pathlib
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
OUT = pathlib.Path(__file__).resolve().parents[1] / "out"
app = FastAPI(title="Pulse-Echo API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])
@app.get("/health")
def health(): return {"status": "ok"}
@app.websocket("/ws/sensors")
async def sensors(ws: WebSocket):
    await ws.accept()
    try:
        while True: await ws.receive_text()
    except Exception: pass
app.mount("/data", StaticFiles(directory=OUT), name="data")
