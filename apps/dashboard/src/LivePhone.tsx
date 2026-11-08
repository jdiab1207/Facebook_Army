import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getAdminToken } from "./api";

export type DeviceMode = "mobile" | "desktop";

type Props = {
  accountId: string;
  startLogin?: boolean;
  active: boolean;
  deviceMode?: DeviceMode;
  className?: string;
  large?: boolean;
};

export default function LivePhone({
  accountId,
  startLogin = false,
  active,
  deviceMode = "mobile",
  className = "",
  large = false,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "error" | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const [viewSize, setViewSize] = useState({ w: 390, h: 844 });
  const dragging = useRef(false);

  useEffect(() => {
    if (!active) {
      wsRef.current?.close();
      wsRef.current = null;
      setStatus("idle");
      return;
    }

    const token = encodeURIComponent(getAdminToken());
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const login = startLogin ? "&login=1" : "";
    const mode = `&mode=${deviceMode}`;
    const url = `${proto}://${window.location.host}/ws/session/${accountId}?token=${token}${login}${mode}`;

    setStatus("connecting");
    setError(null);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type: string;
          data?: string;
          message?: string;
          vw?: number;
          vh?: number;
        };
        if (msg.type === "frame" && msg.data && imgRef.current) {
          imgRef.current.src = `data:image/jpeg;base64,${msg.data}`;
          setStatus("live");
        } else if (msg.type === "ready") {
          if (msg.vw && msg.vh) setViewSize({ w: msg.vw, h: msg.vh });
          setStatus("live");
        } else if (msg.type === "error") {
          setStatus("error");
          setError(msg.message || "Stream error");
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setError("WebSocket connection failed");
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
        setStatus((s) => (s === "error" ? s : "idle"));
      }
    };

    return () => {
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [accountId, active, startLogin, deviceMode]);

  const send = (payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    ws.send(
      JSON.stringify({
        ...payload,
        displayW: rect?.width || viewSize.w,
        displayH: rect?.height || viewSize.h,
      })
    );
  };

  const point = (e: ReactPointerEvent, kind: string) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    send({ type: "pointer", kind, x, y });
  };

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        send({ type: "type", text: e.key });
      } else {
        send({ type: "key", kind: "press", key: e.key });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  return (
    <div
      className={`phone-bezel ${large ? "large" : ""} ${deviceMode} ${className}`.trim()}
    >
      {deviceMode === "mobile" ? <div className="phone-notch" /> : <div className="desktop-bar" />}
      <div
        className="phone-screen live"
        ref={wrapRef}
        tabIndex={0}
        onPointerDown={(e) => {
          dragging.current = true;
          wrapRef.current?.setPointerCapture(e.pointerId);
          point(e, "down");
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          point(e, "move");
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          point(e, "up");
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onWheel={(e) => {
          e.preventDefault();
          const rect = wrapRef.current?.getBoundingClientRect();
          if (!rect) return;
          send({
            type: "wheel",
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            deltaX: e.deltaX,
            deltaY: e.deltaY,
          });
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <img ref={imgRef} alt="Live session" draggable={false} />
        {status !== "live" && (
          <div className="screen-empty">
            {status === "connecting" && "Connecting live session…"}
            {status === "error" && (error || "Stream error")}
            {status === "idle" && "Session idle"}
          </div>
        )}
        <div className={`live-badge ${status}`}>{status}</div>
      </div>
    </div>
  );
}
