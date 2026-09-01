import { useCallback, useEffect, useRef, useState } from "react";
import { Brush, Check, ChevronDown, CloudDownload, Download, Eraser, Eye, ImagePlus, LoaderCircle, Lock, Maximize2, MousePointer2, Redo2, ScanSearch, ShieldCheck, Trash2, Undo2, Upload } from "lucide-react";
import { CENSOR_PRESETS, CUSTOM_CLASS_OPTIONS, DEFAULT_CUSTOM_CLASS_IDS, filterDetections, summarizeDetections, type CensorEffect, type CensorLevel } from "./lib/censor";
import { detectNudity } from "./lib/erax";
import { downloadHqSam2, forEachMaskRunRectangle, formatModelBytes, getHqSam2Status, isTauriRuntime, mergeRefinedMasks, refineWithHqSam2, type HqSam2Segment, type HqSam2Status } from "./lib/hqsam2";
import "./editor.css";
import "./settings.css";

export type Point = { x: number; y: number };
export type MaskRect = { id: string; x: number; y: number; width: number; height: number; label?: string; score?: number; classId?: number };
export type Stroke = { id: string; points: Point[]; size: number; erase: boolean };
export type EditorState = { rects: MaskRect[]; strokes: Stroke[]; segments?: HqSam2Segment[] };
type Tool = "select" | "brush" | "eraser";
type Drag = { kind: "move" | "resize" | "stroke"; start: Point; base: EditorState; rect?: MaskRect; handle?: string; strokeId?: string };
type EffectSettings = { effect: CensorEffect; blur: number; mosaic: number };

export const EMPTY_EDITOR: EditorState = { rects: [], strokes: [] };
const clone = (value: EditorState): EditorState => structuredClone(value);
const uid = () => crypto.randomUUID();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function drawMask(ctx: CanvasRenderingContext2D, editor: EditorState) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.globalCompositeOperation = "source-over";
  editor.rects.forEach((rect) => ctx.fillRect(rect.x, rect.y, rect.width, rect.height));
  editor.segments?.forEach((segment) => {
    forEachMaskRunRectangle(segment.width, segment.runs, (x, y, length) => ctx.fillRect(x, y, length, 1));
  });
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
    if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function renderCensored(
  target: CanvasRenderingContext2D,
  image: CanvasImageSource,
  mask: HTMLCanvasElement,
  settings: EffectSettings,
  previewOpacity = 1,
) {
  const { width, height } = target.canvas;
  target.clearRect(0, 0, width, height);
  target.globalAlpha = 1;
  target.drawImage(image, 0, 0, width, height);

  const effectCanvas = makeCanvas(width, height);
  const effectCtx = effectCanvas.getContext("2d")!;
  if (settings.effect === "white") {
    effectCtx.fillStyle = "#fff";
    effectCtx.fillRect(0, 0, width, height);
  } else if (settings.effect === "blur") {
    const strength = Math.max(1, settings.blur);
    effectCtx.filter = `blur(${strength}px)`;
    effectCtx.drawImage(image, -strength * 2, -strength * 2, width + strength * 4, height + strength * 4);
    effectCtx.filter = "none";
  } else {
    const block = Math.max(2, settings.mosaic);
    const tiny = makeCanvas(Math.max(1, Math.ceil(width / block)), Math.max(1, Math.ceil(height / block)));
    const tinyCtx = tiny.getContext("2d")!;
    tinyCtx.imageSmoothingEnabled = false;
    tinyCtx.drawImage(image, 0, 0, tiny.width, tiny.height);
    effectCtx.imageSmoothingEnabled = false;
    effectCtx.drawImage(tiny, 0, 0, tiny.width, tiny.height, 0, 0, width, height);
  }
  effectCtx.globalCompositeOperation = "destination-in";
  effectCtx.drawImage(mask, 0, 0);
  target.save();
  target.globalAlpha = previewOpacity;
  target.drawImage(effectCanvas, 0, 0);
  target.restore();
}

export function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
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
  const [sensitivity, setSensitivity] = useState(0.25);
  const [level, setLevel] = useState<CensorLevel>("major");
  const [customIds, setCustomIds] = useState<number[]>(DEFAULT_CUSTOM_CLASS_IDS);
  const [effect, setEffect] = useState<CensorEffect>("white");
  const [blurStrength, setBlurStrength] = useState(18);
  const [mosaicSize, setMosaicSize] = useState(18);
  const [correctionView, setCorrectionView] = useState(false);
  const [desktopRuntime] = useState(isTauriRuntime);
  const [hqSam2, setHqSam2] = useState<HqSam2Status>({ installed: false, downloading: false, bytes: 0 });
  const [hqSam2Progress, setHqSam2Progress] = useState(0);
  const [refining, setRefining] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const commit = useCallback((next: EditorState) => {
    setPast((items) => [...items.slice(-59), clone(editorRef.current)]);
    setFuture([]);
    setEditor(next);
  }, []);

  useEffect(() => { if (desktopRuntime) getHqSam2Status().then(setHqSam2).catch(console.error); }, [desktopRuntime]);

  const installHqSam2 = async () => {
    setHqSam2((current) => ({ ...current, downloading: true }));
    setMessage("HQ-SAM 2 모델을 다운로드하고 있습니다. 앱을 종료하지 마세요.");
    try {
      const status = await downloadHqSam2(({ received, total }) => {
        setHqSam2Progress(total ? received / total : 0);
        setHqSam2((current) => ({ ...current, bytes: received, downloading: true }));
      });
      setHqSam2(status);
      setHqSam2Progress(1);
      setMessage(`HQ-SAM 2 모델 설치 완료 · ${formatModelBytes(status.bytes)}`);
    } catch (error) {
      console.error(error);
      setHqSam2((current) => ({ ...current, downloading: false }));
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const refineContours = async () => {
    const boxes = editorRef.current.rects;
    if (!image || !hqSam2.installed || !boxes.length || refining) return;
    setRefining(true);
    setMessage(`HQ-SAM 2가 ${boxes.length}개 영역의 윤곽을 계산하고 있습니다…`);
    try {
      const source = makeCanvas(image.naturalWidth, image.naturalHeight);
      source.getContext("2d")!.drawImage(image, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => source.toBlob((value) => value ? resolve(value) : reject(new Error("이미지를 변환할 수 없습니다.")), "image/png"));
      const result = await refineWithHqSam2(new Uint8Array(await blob.arrayBuffer()), boxes);
      const merged = mergeRefinedMasks(boxes, result.segments);
      commit({ rects: merged.rects, strokes: editorRef.current.strokes, segments: [...(editorRef.current.segments ?? []), ...merged.segments] });
      setSelectedId(null);
      setMessage(`HQ-SAM 2 윤곽 마스크 ${result.segments.length}개 생성 완료${merged.rects.length ? ` · 실패 ${merged.rects.length}개는 사각형 유지` : ""} · ${result.device.toUpperCase()}`);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setRefining(false); }
  };

  const effectSettings: EffectSettings = { effect, blur: blurStrength, mosaic: mosaicSize };

  const loadFile = useCallback((file?: File) => {
    if (!file || !file.type.startsWith("image/")) { setMessage("JPG, PNG 또는 WebP 사진을 선택해 주세요."); return; }
    const url = URL.createObjectURL(file);
    const loaded = new Image();
    loaded.onload = () => {
      setImage((previous) => { if (previous?.src.startsWith("blob:")) URL.revokeObjectURL(previous.src); return loaded; });
      setFileName(file.name);
      setEditor(EMPTY_EDITOR);
      setPast([]);
      setFuture([]);
      setSelectedId(null);
      setMessage(`${loaded.naturalWidth.toLocaleString()} × ${loaded.naturalHeight.toLocaleString()} · 브라우저 메모리에만 로드됨`);
    };
    loaded.onerror = () => { URL.revokeObjectURL(url); setMessage("사진을 읽을 수 없습니다."); };
    loaded.src = url;
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const mask = makeCanvas(canvas.width, canvas.height);
    drawMask(mask.getContext("2d")!, editor);
    renderCensored(canvas.getContext("2d")!, image, mask, effectSettings, correctionView ? 0.5 : 1);
    const selected = editor.rects.find((rect) => rect.id === selectedId);
    if (selected && tool === "select") {
      const ctx = canvas.getContext("2d")!;
      const line = Math.max(2, canvas.width / 700);
      const handle = Math.max(8, canvas.width / 110);
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#7c3aed";
      ctx.lineWidth = line;
      ctx.setLineDash([line * 4, line * 3]);
      ctx.strokeRect(selected.x, selected.y, selected.width, selected.height);
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff";
      [[selected.x, selected.y], [selected.x + selected.width, selected.y], [selected.x, selected.y + selected.height], [selected.x + selected.width, selected.y + selected.height]].forEach(([x, y]) => {
        ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
        ctx.strokeRect(x - handle / 2, y - handle / 2, handle, handle);
      });
      ctx.restore();
    }
  }, [blurStrength, correctionView, editor, effect, image, mosaicSize, selectedId, tool]);
  useEffect(render, [render]);

  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((items) => [clone(editorRef.current), ...items].slice(0, 60));
    setPast((items) => items.slice(0, -1));
    setEditor(past[past.length - 1]);
    setSelectedId(null);
  }, [past]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((items) => [...items.slice(-59), clone(editorRef.current)]);
    setFuture((items) => items.slice(1));
    setEditor(future[0]);
    setSelectedId(null);
  }, [future]);
  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit({ ...editorRef.current, rects: editorRef.current.rects.filter((rect) => rect.id !== selectedId) });
    setSelectedId(null);
  }, [commit, selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) { event.preventDefault(); removeSelected(); }
      if (!event.ctrlKey && !event.metaKey) {
        if (event.key.toLowerCase() === "v") setTool("select");
        if (event.key.toLowerCase() === "b") setTool("brush");
        if (event.key.toLowerCase() === "e") setTool("eraser");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redo, removeSelected, selectedId, undo]);

  const runDetection = async () => {
    if (!image || analyzing) return;
    setAnalyzing(true);
    setModelProgress(0);
    setMessage("EraX Small 모델을 준비하고 있습니다…");
    try {
      const rawDetections = await detectNudity(image, sensitivity, setModelProgress);
      const detections = filterDetections(rawDetections, level, customIds);
      console.info("[EraX] 사용자 검열 설정", { level, selectedIds: level === "custom" ? customIds : CENSOR_PRESETS[level], before: rawDetections.length, after: detections.length });
      const rects = detections.map((item) => {
        const padding = Math.max(8, Math.min(item.width, item.height) * 0.08);
        const x = clamp(item.x - padding, 0, image.naturalWidth);
        const y = clamp(item.y - padding, 0, image.naturalHeight);
        return { id: uid(), x, y, width: Math.min(image.naturalWidth - x, item.width + padding * 2), height: Math.min(image.naturalHeight - y, item.height + padding * 2), label: item.label, score: item.score, classId: item.id };
      });
      const summary = summarizeDetections(rawDetections);
      if (!rects.length) {
        commit({ ...editorRef.current, rects: [...editorRef.current.rects] });
        setMessage(`${rawDetections.length}개 탐지됨(${summary || "분류 없음"}). 현재 검열 범위에는 해당 부위가 없습니다. 검열 수준을 넓히거나 직접 설정을 확인하세요.`);
      } else if (desktopRuntime && hqSam2.installed) {
        setMessage(`EraX 탐지 완료 · HQ-SAM 2가 ${rects.length}개 영역의 윤곽을 정밀화하고 있습니다…`);
        try {
          const source = makeCanvas(image.naturalWidth, image.naturalHeight);
          source.getContext("2d")!.drawImage(image, 0, 0);
          const blob = await new Promise<Blob>((resolve, reject) => source.toBlob((value) => value ? resolve(value) : reject(new Error("이미지를 변환할 수 없습니다.")), "image/png"));
          const result = await refineWithHqSam2(new Uint8Array(await blob.arrayBuffer()), rects);
          const merged = mergeRefinedMasks(rects, result.segments);
          commit({
            rects: [...editorRef.current.rects, ...merged.rects],
            strokes: editorRef.current.strokes,
            segments: [...(editorRef.current.segments ?? []), ...merged.segments],
          });
          setMessage(`${rawDetections.length}개 탐지 · 윤곽 마스크 ${result.segments.length}개 생성${merged.rects.length ? ` · 실패 ${merged.rects.length}개는 사각형 유지` : ""} · ${result.device.toUpperCase()}`);
        } catch (error) {
          console.error("[HQ-SAM 2] 정밀화 실패, EraX 사각형을 유지합니다.", error);
          commit({ ...editorRef.current, rects: [...editorRef.current.rects, ...rects] });
          setMessage(`${rawDetections.length}개 탐지 · HQ-SAM 2 정밀화 실패로 ${rects.length}개 영역을 사각형으로 유지했습니다.`);
        }
      } else {
        commit({ ...editorRef.current, rects: [...editorRef.current.rects, ...rects] });
        setMessage(`${rawDetections.length}개 탐지 중 검열 대상 ${rects.length}개를 생성했습니다. 탐지 결과: ${summary}`);
      }
    } catch (error) {
      console.error(error);
      setMessage("AI 분석에 실패했습니다. ONNX Runtime 지원 여부와 모델 파일을 확인해 주세요.");
    } finally { setAnalyzing(false); }
  };

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const bounds = canvas.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) * canvas.width / bounds.width, 0, canvas.width), y: clamp((event.clientY - bounds.top) * canvas.height / bounds.height, 0, canvas.height) };
  };
  const hitRect = (point: Point) => [...editorRef.current.rects].reverse().find((rect) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height);
  const hitHandle = (point: Point, rect: MaskRect) => {
    const radius = Math.max(14, (image?.naturalWidth ?? 1000) / 70);
    return [["nw", rect.x, rect.y], ["ne", rect.x + rect.width, rect.y], ["sw", rect.x, rect.y + rect.height], ["se", rect.x + rect.width, rect.y + rect.height]].find((item) => Math.abs(point.x - Number(item[1])) <= radius && Math.abs(point.y - Number(item[2])) <= radius)?.[0] as string | undefined;
  };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    const base = clone(editorRef.current);
    if (tool !== "select") {
      const stroke: Stroke = { id: uid(), points: [point], size: brushSize * image.naturalWidth / 1000, erase: tool === "eraser" };
      setEditor({ ...base, strokes: [...base.strokes, stroke] });
      dragRef.current = { kind: "stroke", start: point, base, strokeId: stroke.id };
      return;
    }
    const current = editorRef.current.rects.find((rect) => rect.id === selectedId);
    const handle = current ? hitHandle(point, current) : undefined;
    const rect = handle ? current : hitRect(point);
    if (!rect) { setSelectedId(null); return; }
    setSelectedId(rect.id);
    dragRef.current = { kind: handle ? "resize" : "move", start: point, base, rect: { ...rect }, handle };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || !image) return;
    const point = pointFromEvent(event);
    if (drag.kind === "stroke") {
      setEditor((current) => ({ ...current, strokes: current.strokes.map((stroke) => stroke.id === drag.strokeId ? { ...stroke, points: [...stroke.points, point] } : stroke) }));
      return;
    }
    const source = drag.rect!;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    const next = { ...source };
    if (drag.kind === "move") {
      next.x = clamp(source.x + dx, 0, image.naturalWidth - source.width);
      next.y = clamp(source.y + dy, 0, image.naturalHeight - source.height);
    } else {
      const min = Math.max(12, image.naturalWidth / 100);
      if (drag.handle?.includes("e")) next.width = clamp(source.width + dx, min, image.naturalWidth - source.x);
      if (drag.handle?.includes("s")) next.height = clamp(source.height + dy, min, image.naturalHeight - source.y);
      if (drag.handle?.includes("w")) { next.x = clamp(source.x + dx, 0, source.x + source.width - min); next.width = source.width + source.x - next.x; }
      if (drag.handle?.includes("n")) { next.y = clamp(source.y + dy, 0, source.y + source.height - min); next.height = source.height + source.y - next.y; }
    }
    setEditor({ ...drag.base, rects: drag.base.rects.map((rect) => rect.id === source.id ? next : rect) });
  };
  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    setPast((items) => [...items.slice(-59), drag.base]);
    setFuture([]);
    dragRef.current = null;
  };

  const exportImage = () => {
    if (!image) return;
    const output = makeCanvas(image.naturalWidth, image.naturalHeight);
    const mask = makeCanvas(output.width, output.height);
    drawMask(mask.getContext("2d")!, editorRef.current);
    renderCensored(output.getContext("2d")!, image, mask, effectSettings, 1);
    output.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${fileName.replace(/\.[^.]+$/, "") || "censored"}-censored.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }, "image/png");
  };

  const chooseTool = (next: Tool) => { setTool(next); if (next !== "select") setSelectedId(null); };
  const toggleCustom = (id: number) => setCustomIds((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><ShieldCheck size={19} /></div><span>Veil</span><span className="brand-tag">LOCAL AI</span></div>
      <div className="history-controls"><button className="icon-button" onClick={undo} disabled={!past.length} title="실행 취소"><Undo2 /></button><button className="icon-button" onClick={redo} disabled={!future.length} title="다시 실행"><Redo2 /></button></div>
      <div className="top-actions"><div className="privacy-pill"><Lock size={14} />이미지는 기기를 떠나지 않아요</div><button className="export-button" onClick={exportImage} disabled={!image}><Download size={17} /> 원본 해상도로 저장</button></div>
    </header>
    <main className="workspace">
      <aside className="sidebar">
        <section><div className="section-label">사진</div><button className="upload-button" onClick={() => fileRef.current?.click()}><Upload size={18} /> 사진 불러오기</button><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => loadFile(e.target.files?.[0])} /></section>

        <section>
          <div className="section-label">AI 자동 검열</div>
          <div className="ai-card">
            <div className="ai-card-title"><div className="ai-icon"><ScanSearch size={18} /></div><div><strong>EraX Small</strong><small>브라우저 내 ONNX 로컬 추론</small></div></div>
            <div className="setting-row"><span>최소 신뢰도</span><strong>{Math.round(sensitivity * 100)}%</strong></div>
            <input className="full-range" aria-label="최소 탐지 신뢰도" type="range" min="0.1" max="0.8" step="0.05" value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} />
            <p>이 값은 탐지 개수만 조절합니다. 낮추면 오탐이 늘 수 있으며, 아래 검열 수준에서 실제 검열 부위를 선택합니다.</p>
            <button className="analyze-button" onClick={runDetection} disabled={!image || analyzing}>{analyzing ? <LoaderCircle className="spin" size={17} /> : <ScanSearch size={17} />}{analyzing ? `분석 중 ${Math.round(modelProgress * 100)}%` : "AI 검열 실행"}</button>
          </div>
          {desktopRuntime && <div className="ai-card hq-card">
            <div className="ai-card-title"><div className="ai-icon"><CloudDownload size={18} /></div><div><strong>HQ-SAM 2</strong><small>탐지 사각형을 윤곽 마스크로 정밀화</small></div></div>
            <p>{hqSam2.installed ? `모델 설치됨 · ${formatModelBytes(hqSam2.bytes)}` : "선택 설치 모델입니다. 공식 체크포인트를 앱 데이터 폴더에 저장합니다."}</p>
            {hqSam2.downloading && <progress className="model-download-progress" max="1" value={hqSam2Progress} />}
            <button className="analyze-button secondary" onClick={installHqSam2} disabled={hqSam2.installed || hqSam2.downloading}>
              {hqSam2.downloading ? <LoaderCircle className="spin" size={17} /> : hqSam2.installed ? <Check size={17} /> : <CloudDownload size={17} />}
              {hqSam2.downloading ? `다운로드 중 ${hqSam2Progress ? `${Math.round(hqSam2Progress * 100)}%` : `· ${formatModelBytes(hqSam2.bytes)}`}` : hqSam2.installed ? "설치 완료" : "HQ-SAM 2 다운로드"}
            </button>
            {hqSam2.installed && <button className="analyze-button contour-button" onClick={refineContours} disabled={!image || !editor.rects.length || refining}>
              {refining ? <LoaderCircle className="spin" size={17} /> : <ScanSearch size={17} />}
              {refining ? "윤곽 계산 중" : "탐지 영역 윤곽 정밀화"}
            </button>}
          </div>}
        </section>

        <section>
          <div className="section-label">검열 수준</div>
          <div className="segmented levels">
            {[{ id: "genitals", label: "성기만" }, { id: "major", label: "주요 노출부" }, { id: "all", label: "전체 노출부" }, { id: "custom", label: "직접 설정" }].map((item) => <button key={item.id} className={level === item.id ? "selected" : ""} onClick={() => setLevel(item.id as CensorLevel)}>{item.label}</button>)}
          </div>
          {level === "custom" && <div className="check-grid">{CUSTOM_CLASS_OPTIONS.map((item) => <label key={item.id}><input type="checkbox" checked={customIds.includes(item.id)} onChange={() => toggleCustom(item.id)} /><span>{item.label}</span></label>)}</div>}
        </section>

        <section>
          <div className="section-label">검열 방식</div>
          <div className="segmented effects">
            {[{ id: "white", label: "흰칠" }, { id: "blur", label: "블러" }, { id: "mosaic", label: "모자이크" }].map((item) => <button key={item.id} className={effect === item.id ? "selected" : ""} onClick={() => setEffect(item.id as CensorEffect)}>{item.label}</button>)}
          </div>
          {effect === "blur" && <div className="effect-control"><div className="setting-row"><span>블러 강도</span><strong>{blurStrength}px</strong></div><input className="full-range" aria-label="블러 강도" type="range" min="4" max="50" value={blurStrength} onChange={(e) => setBlurStrength(Number(e.target.value))} /></div>}
          {effect === "mosaic" && <div className="effect-control"><div className="setting-row"><span>블록 크기</span><strong>{mosaicSize}px</strong></div><input className="full-range" aria-label="모자이크 블록 크기" type="range" min="4" max="60" value={mosaicSize} onChange={(e) => setMosaicSize(Number(e.target.value))} /></div>}
          <label className="toggle-row"><span><Eye size={15} /><span><strong>보정 보기</strong><small>편집 화면에서 효과를 50%로 표시</small></span></span><input type="checkbox" checked={correctionView} onChange={(e) => setCorrectionView(e.target.checked)} /><i /></label>
        </section>

        <section><div className="section-label">편집 도구</div><div className="tool-list">
          <button className={tool === "select" ? "tool active" : "tool"} onClick={() => chooseTool("select")}><MousePointer2 /><span><strong>선택 및 이동</strong><small>사각형 조정·삭제</small></span><kbd>V</kbd></button>
          <button className={tool === "brush" ? "tool active" : "tool"} onClick={() => chooseTool("brush")}><Brush /><span><strong>마스크 브러시</strong><small>선택한 검열 효과 추가</small></span><kbd>B</kbd></button>
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
