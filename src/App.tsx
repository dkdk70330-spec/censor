import { useCallback, useEffect, useRef, useState } from "react";
import { Brush, Check, ChevronDown, Download, Eraser, ImagePlus, LoaderCircle, Lock, Maximize2, MousePointer2, Redo2, ScanSearch, ShieldCheck, Trash2, Undo2, Upload } from "lucide-react";
import { detectNudity } from "./lib/nudenet";
import "./editor.css";

type Point = { x: number; y: number };
type MaskRect = { id: string; x: number; y: number; width: number; height: number; label?: string; score?: number };
type Stroke = { id: string; points: Point[]; size: number; erase: boolean };
type EditorState = { rects: MaskRect[]; strokes: Stroke[] };
type Tool = "select" | "brush" | "eraser";
type Drag = { kind: "move" | "resize" | "stroke"; start: Point; base: EditorState; rect?: MaskRect; handle?: string; strokeId?: string };
const EMPTY: EditorState = { rects: [], strokes: [] };
const clone = (value: EditorState): EditorState => structuredClone(value);
const uid = () => crypto.randomUUID();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function drawMask(ctx: CanvasRenderingContext2D, editor: EditorState) {
  ctx.save();
  ctx.fillStyle = "#fff";
  editor.rects.forEach((rect) => ctx.fillRect(rect.x, rect.y, rect.width, rect.height));
  editor.strokes.forEach((stroke) => {
    if (!stroke.points.length) return;
    ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
    ctx.strokeStyle = ctx.fillStyle = "#fff";
    ctx.lineWidth = stroke.size;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.stroke();
    if (stroke.points.length === 1) { ctx.beginPath(); ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2); ctx.fill(); }
  });
  ctx.restore();
}

export function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [editor, setEditor] = useState<EditorState>(EMPTY);
  const [past, setPast] = useState<EditorState[]>([]);
  const [future, setFuture] = useState<EditorState[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(42);
  const [zoom, setZoom] = useState(100);
  const [analyzing, setAnalyzing] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [message, setMessage] = useState("사진을 불러오면 AI 검열을 시작할 수 있어요.");
  const [dragOver, setDragOver] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const commit = useCallback((next: EditorState) => {
    setPast((items) => [...items.slice(-59), clone(editorRef.current)]);
    setFuture([]); setEditor(next);
  }, []);

  const loadFile = useCallback((file?: File) => {
    if (!file || !file.type.startsWith("image/")) { setMessage("JPG, PNG 또는 WebP 사진을 선택해 주세요."); return; }
    const url = URL.createObjectURL(file);
    const loaded = new Image();
    loaded.onload = () => {
      setImage((previous) => { if (previous?.src.startsWith("blob:")) URL.revokeObjectURL(previous.src); return loaded; });
      setFileName(file.name); setEditor(EMPTY); setPast([]); setFuture([]); setSelectedId(null);
      setMessage(`${loaded.naturalWidth.toLocaleString()} × ${loaded.naturalHeight.toLocaleString()} · 브라우저 메모리에만 로드됨`);
    };
    loaded.onerror = () => { URL.revokeObjectURL(url); setMessage("사진을 읽을 수 없습니다."); };
    loaded.src = url;
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const mask = document.createElement("canvas"); mask.width = canvas.width; mask.height = canvas.height;
    drawMask(mask.getContext("2d")!, editor); ctx.drawImage(mask, 0, 0);
    const selected = editor.rects.find((rect) => rect.id === selectedId);
    if (selected && tool === "select") {
      const line = Math.max(2, canvas.width / 700), handle = Math.max(8, canvas.width / 110);
      ctx.save(); ctx.strokeStyle = "#7c3aed"; ctx.lineWidth = line; ctx.setLineDash([line * 4, line * 3]);
      ctx.strokeRect(selected.x, selected.y, selected.width, selected.height); ctx.setLineDash([]); ctx.fillStyle = "#fff";
      [[selected.x, selected.y], [selected.x + selected.width, selected.y], [selected.x, selected.y + selected.height], [selected.x + selected.width, selected.y + selected.height]].forEach(([x, y]) => { ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle); ctx.strokeRect(x - handle / 2, y - handle / 2, handle, handle); });
      ctx.restore();
    }
  }, [editor, image, selectedId, tool]);
  useEffect(render, [render]);

  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((items) => [clone(editorRef.current), ...items].slice(0, 60));
    setPast((items) => items.slice(0, -1)); setEditor(past[past.length - 1]); setSelectedId(null);
  }, [past]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((items) => [...items.slice(-59), clone(editorRef.current)]);
    setFuture((items) => items.slice(1)); setEditor(future[0]); setSelectedId(null);
  }, [future]);
  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit({ ...editorRef.current, rects: editorRef.current.rects.filter((rect) => rect.id !== selectedId) }); setSelectedId(null);
  }, [commit, selectedId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) { event.preventDefault(); removeSelected(); }
      if (!event.ctrlKey && !event.metaKey) { if (event.key.toLowerCase() === "v") setTool("select"); if (event.key.toLowerCase() === "b") setTool("brush"); if (event.key.toLowerCase() === "e") setTool("eraser"); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [redo, removeSelected, selectedId, undo]);

  const runDetection = async () => {
    if (!image || analyzing) return;
    setAnalyzing(true); setModelProgress(0); setMessage("NudeNet 모델을 준비하고 있습니다…");
    try {
      const detections = await detectNudity(image, .38, setModelProgress);
      const rects = detections.map((item) => {
        const padding = Math.max(8, Math.min(item.width, item.height) * .08), x = clamp(item.x - padding, 0, image.naturalWidth), y = clamp(item.y - padding, 0, image.naturalHeight);
        return { id: uid(), x, y, width: Math.min(image.naturalWidth - x, item.width + padding * 2), height: Math.min(image.naturalHeight - y, item.height + padding * 2), label: item.label, score: item.score };
      });
      commit({ ...editorRef.current, rects: [...editorRef.current.rects, ...rects] });
      setMessage(rects.length ? `${rects.length}개의 검열 영역을 생성했습니다. 사각형을 선택해 조정하세요.` : "노출 영역을 찾지 못했습니다. 브러시로 직접 검열할 수 있어요.");
    } catch (error) { console.error(error); setMessage("AI 분석에 실패했습니다. WebGL 지원 여부와 모델 파일을 확인해 주세요."); }
    finally { setAnalyzing(false); }
  };

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!, bounds = canvas.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) * canvas.width / bounds.width, 0, canvas.width), y: clamp((event.clientY - bounds.top) * canvas.height / bounds.height, 0, canvas.height) };
  };
  const hitRect = (point: Point) => [...editorRef.current.rects].reverse().find((rect) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height);
  const hitHandle = (point: Point, rect: MaskRect) => {
    const radius = Math.max(14, (image?.naturalWidth ?? 1000) / 70);
    return [["nw", rect.x, rect.y], ["ne", rect.x + rect.width, rect.y], ["sw", rect.x, rect.y + rect.height], ["se", rect.x + rect.width, rect.y + rect.height]].find((item) => Math.abs(point.x - Number(item[1])) <= radius && Math.abs(point.y - Number(item[2])) <= radius)?.[0] as string | undefined;
  };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image) return; event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event), base = clone(editorRef.current);
    if (tool !== "select") {
      const stroke: Stroke = { id: uid(), points: [point], size: brushSize * image.naturalWidth / 1000, erase: tool === "eraser" };
      setEditor({ ...base, strokes: [...base.strokes, stroke] }); dragRef.current = { kind: "stroke", start: point, base, strokeId: stroke.id }; return;
    }
    const current = editorRef.current.rects.find((rect) => rect.id === selectedId), handle = current ? hitHandle(point, current) : undefined, rect = handle ? current : hitRect(point);
    if (!rect) { setSelectedId(null); return; }
    setSelectedId(rect.id); dragRef.current = { kind: handle ? "resize" : "move", start: point, base, rect: { ...rect }, handle };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current; if (!drag || !image) return;
    const point = pointFromEvent(event);
    if (drag.kind === "stroke") { setEditor((current) => ({ ...current, strokes: current.strokes.map((stroke) => stroke.id === drag.strokeId ? { ...stroke, points: [...stroke.points, point] } : stroke) })); return; }
    const source = drag.rect!, dx = point.x - drag.start.x, dy = point.y - drag.start.y, next = { ...source };
    if (drag.kind === "move") { next.x = clamp(source.x + dx, 0, image.naturalWidth - source.width); next.y = clamp(source.y + dy, 0, image.naturalHeight - source.height); }
    else {
      const min = Math.max(12, image.naturalWidth / 100);
      if (drag.handle?.includes("e")) next.width = clamp(source.width + dx, min, image.naturalWidth - source.x);
      if (drag.handle?.includes("s")) next.height = clamp(source.height + dy, min, image.naturalHeight - source.y);
      if (drag.handle?.includes("w")) { next.x = clamp(source.x + dx, 0, source.x + source.width - min); next.width = source.width + source.x - next.x; }
      if (drag.handle?.includes("n")) { next.y = clamp(source.y + dy, 0, source.y + source.height - min); next.height = source.height + source.y - next.y; }
    }
    setEditor({ ...drag.base, rects: drag.base.rects.map((rect) => rect.id === source.id ? next : rect) });
  };
  const onPointerUp = () => { const drag = dragRef.current; if (!drag) return; setPast((items) => [...items.slice(-59), drag.base]); setFuture([]); dragRef.current = null; };

  const exportImage = () => {
    if (!image) return;
    const output = document.createElement("canvas"); output.width = image.naturalWidth; output.height = image.naturalHeight;
    const ctx = output.getContext("2d")!; ctx.drawImage(image, 0, 0);
    const mask = document.createElement("canvas"); mask.width = output.width; mask.height = output.height; drawMask(mask.getContext("2d")!, editorRef.current); ctx.drawImage(mask, 0, 0);
    output.toBlob((blob) => { if (!blob) return; const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${fileName.replace(/\.[^.]+$/, "") || "censored"}-censored.png`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }, "image/png");
  };
  const chooseTool = (next: Tool) => { setTool(next); if (next !== "select") setSelectedId(null); };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><ShieldCheck size={19} /></div><span>Veil</span><span className="brand-tag">LOCAL AI</span></div>
      <div className="history-controls"><button className="icon-button" onClick={undo} disabled={!past.length} title="실행 취소"><Undo2 /></button><button className="icon-button" onClick={redo} disabled={!future.length} title="다시 실행"><Redo2 /></button></div>
      <div className="top-actions"><div className="privacy-pill"><Lock size={14} />이미지는 기기를 떠나지 않아요</div><button className="export-button" onClick={exportImage} disabled={!image}><Download size={17} /> 원본 해상도로 저장</button></div>
    </header>
    <main className="workspace">
      <aside className="sidebar">
        <section><div className="section-label">사진</div><button className="upload-button" onClick={() => fileRef.current?.click()}><Upload size={18} /> 사진 불러오기</button><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => loadFile(e.target.files?.[0])} /></section>
        <section><div className="section-label">AI 자동 검열</div><div className="ai-card"><div className="ai-card-title"><div className="ai-icon"><ScanSearch size={18} /></div><div><strong>NudeNet TFJS</strong><small>브라우저 내 로컬 추론</small></div></div><button className="analyze-button" onClick={runDetection} disabled={!image || analyzing}>{analyzing ? <LoaderCircle className="spin" size={17} /> : <ScanSearch size={17} />}{analyzing ? `분석 중 ${Math.round(modelProgress * 100)}%` : "AI 검열 실행"}</button><p>노출 가능성이 높은 영역에 편집 가능한 흰색 사각형을 생성합니다.</p></div></section>
        <section><div className="section-label">편집 도구</div><div className="tool-list">
          <button className={tool === "select" ? "tool active" : "tool"} onClick={() => chooseTool("select")}><MousePointer2 /><span><strong>선택 및 이동</strong><small>사각형 조정·삭제</small></span><kbd>V</kbd></button>
          <button className={tool === "brush" ? "tool active" : "tool"} onClick={() => chooseTool("brush")}><Brush /><span><strong>흰색 브러시</strong><small>검열 마스크 추가</small></span><kbd>B</kbd></button>
          <button className={tool === "eraser" ? "tool active" : "tool"} onClick={() => chooseTool("eraser")}><Eraser /><span><strong>마스크 지우개</strong><small>원본은 지우지 않음</small></span><kbd>E</kbd></button>
        </div>{(tool === "brush" || tool === "eraser") && <div className="brush-control"><div><span>크기</span><strong>{brushSize}px</strong></div><input type="range" min="8" max="120" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} /></div>}{selectedId && <button className="delete-button" onClick={removeSelected}><Trash2 size={16} /> 선택 영역 삭제</button>}</section>
        <div className="local-card"><div className="local-check"><Check size={15} /></div><div><strong>100% 로컬 처리</strong><p>사진과 분석 결과는 서버로 전송되거나 저장되지 않습니다.</p></div></div>
      </aside>
      <section className="canvas-area" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files[0]); }}>
        {!image ? <button className={dragOver ? "drop-zone dragging" : "drop-zone"} onClick={() => fileRef.current?.click()}><div className="drop-icon"><ImagePlus size={28} /></div><h1>검열할 사진을 불러오세요</h1><p>여기로 끌어다 놓거나 클릭해서 선택하세요</p><span>JPG · PNG · WEBP</span></button> : <div className="canvas-scroll"><div className={`canvas-frame tool-${tool}`} style={{ width: `${zoom}%` }}><canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} /></div></div>}
        <div className="statusbar"><span className="status-message"><span className="status-dot" />{message}</span>{image && <div className="zoom-control"><Maximize2 size={14} /><button onClick={() => setZoom((z) => clamp(z - 10, 30, 200))}>−</button><span>{zoom}%</span><button onClick={() => setZoom((z) => clamp(z + 10, 30, 200))}>+</button><ChevronDown size={13} /></div>}</div>
      </section>
    </main>
  </div>;
}
