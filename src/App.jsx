import { useCallback, useEffect, useRef, useState } from "react";
import DroneMap from "./components/DroneMap";
import TelemetryCharts from "./components/TelemetryCharts";
import FlightRecorder from "./components/FlightRecorder";

const WS_URL = "ws://localhost:8080";
const REPLAY_EVENT = "skycontrol-telemetry-update";
const MAX_TRAIL_POINTS = 500;
const COMMAND_INTERVAL = 50;

const INITIAL_TELEMETRY = {
  t: 0,
  x: 50,
  y: 50,
  theta: 0,
  v: 0,
  omega: 0,
  battery: 100,
  imu: {
    ax: 0,
    ay: 0,
    az: 9.81,
  },
  status: "CONNECTING",
};

const INITIAL_POSITION = { x: 50, y: 50 };

export default function App() {
  const [telemetry, setTelemetry] = useState(INITIAL_TELEMETRY);
  const [trail, setTrail] = useState([]);
  const [connected, setConnected] = useState(false);
  const [connectionMessage, setConnectionMessage] =
    useState("Connecting to drone...");
  const [packetCount, setPacketCount] = useState(0);
  const [latency, setLatency] = useState(null);
  const [autoPilot, setAutoPilot] = useState(false);
  const [followDrone, setFollowDrone] = useState(true);
  const [replayMode, setReplayMode] = useState(false);
  const [showCharts, setShowCharts] = useState(true);
  const [showRecorder, setShowRecorder] = useState(true);

  const socketRef = useRef(null);
  const commandRef = useRef({ v: 0, omega: 0 });
  const autoPilotRef = useRef(false);
  const mountedRef = useRef(false);
  const replayModeRef = useRef(false);

  const reconnectTimerRef = useRef(null);
  const reconnectDelayRef = useRef(1000);
  const lastMessageTimeRef = useRef(null);
  const connectionStartRef = useRef(null);

  const latestTelemetryRef = useRef(INITIAL_TELEMETRY);
  const latestPositionRef = useRef(INITIAL_POSITION);

  // Keep refs synchronized with the latest state.
  useEffect(() => {
    latestTelemetryRef.current = telemetry;
  }, [telemetry]);

  useEffect(() => {
    latestPositionRef.current = {
      x: telemetry.x ?? 50,
      y: telemetry.y ?? 50,
    };
  }, [telemetry.x, telemetry.y]);

  useEffect(() => {
    autoPilotRef.current = autoPilot;
  }, [autoPilot]);

  const stopCommands = useCallback(() => {
    commandRef.current = { v: 0, omega: 0 };
  }, []);

  // Handle recording replay events from FlightRecorder.jsx.
  useEffect(() => {
    function handleReplayUpdate(event) {
      const detail = event.detail;

      if (!detail) return;

      if (detail.mode === "live") {
        replayModeRef.current = false;
        setReplayMode(false);
        return;
      }

      if (
        detail.mode !== "replay" ||
        !Array.isArray(detail.samples)
      ) {
        return;
      }

      const index = Number(detail.position ?? 0);
      const sample = detail.samples[index];

      if (!sample) return;

      replayModeRef.current = true;
      setReplayMode(true);
      setAutoPilot(false);
      stopCommands();

      const x = Number(sample.x);
      const y = Number(sample.y);

      const savedTelemetry = sample.telemetry ?? {};

      const nextTelemetry = {
        ...INITIAL_TELEMETRY,
        ...savedTelemetry,

        t: Number(sample.elapsed ?? savedTelemetry.t ?? 0),
        x: Number.isFinite(x) ? x : 50,
        y: Number.isFinite(y) ? y : 50,

        theta: Number(
          sample.theta ?? savedTelemetry.theta ?? 0
        ),

        v: Number(
          sample.v ?? savedTelemetry.v ?? sample.speed ?? 0
        ),

        omega: Number(
          sample.omega ?? savedTelemetry.omega ?? 0
        ),

        battery: Number(
          sample.battery ??
            savedTelemetry.battery ??
            latestTelemetryRef.current.battery
        ),

        imu: sample.imu ?? savedTelemetry.imu ?? {
          ax: 0,
          ay: 0,
          az: 9.81,
        },

        status: savedTelemetry.status ?? "REPLAY",
      };

      latestTelemetryRef.current = nextTelemetry;
      latestPositionRef.current = {
        x: nextTelemetry.x,
        y: nextTelemetry.y,
      };

      setTelemetry(nextTelemetry);

      const replayTrail = detail.samples
        .slice(0, index + 1)
        .map((item) => ({
          x: Number(item.x),
          y: Number(item.y),
        }))
        .filter(
          (point) =>
            Number.isFinite(point.x) &&
            Number.isFinite(point.y)
        )
        .slice(-MAX_TRAIL_POINTS);

      setTrail(replayTrail);
    }

    window.addEventListener(REPLAY_EVENT, handleReplayUpdate);

    return () => {
      window.removeEventListener(
        REPLAY_EVENT,
        handleReplayUpdate
      );
    };
  }, [stopCommands]);

  // Connect to the WebSocket telemetry server.
  useEffect(() => {
    mountedRef.current = true;

    function connectWebSocket() {
      if (!mountedRef.current) return;

      setConnectionMessage("Connecting to drone...");

      let socket;

      try {
        socket = new WebSocket(WS_URL);
        socketRef.current = socket;
      } catch (error) {
        console.error("WebSocket creation failed:", error);

        setConnected(false);
        setConnectionMessage("Connection failed");
        scheduleReconnect();

        return;
      }

      socket.onopen = () => {
        if (!mountedRef.current) {
          socket.close();
          return;
        }

        setConnected(true);
        setConnectionMessage("Connected to telemetry server");
        reconnectDelayRef.current = 1000;
        connectionStartRef.current = Date.now();
        lastMessageTimeRef.current = null;

        console.log("Connected to", WS_URL);
      };

      socket.onmessage = (event) => {
        if (!mountedRef.current) return;

        // Ignore live packets while replaying a saved flight.
        if (replayModeRef.current) return;

        try {
          const data = JSON.parse(event.data);

          const now = performance.now();

          if (lastMessageTimeRef.current !== null) {
            const interval =
              now - lastMessageTimeRef.current;

            // Approximate inter-packet interval, not true network RTT.
            setLatency(Math.round(interval));
          }

          lastMessageTimeRef.current = now;

          const nextTelemetry = {
            ...INITIAL_TELEMETRY,
            ...data,

            x: Number(data.x ?? 50),
            y: Number(data.y ?? 50),
            theta: Number(data.theta ?? 0),
            v: Number(data.v ?? 0),
            omega: Number(data.omega ?? 0),
            battery: Number(data.battery ?? 100),

            imu: {
              ax: Number(data.imu?.ax ?? 0),
              ay: Number(data.imu?.ay ?? 0),
              az: Number(data.imu?.az ?? 9.81),
            },

            status: data.status ?? "OK",
          };

          latestTelemetryRef.current = nextTelemetry;
          latestPositionRef.current = {
            x: nextTelemetry.x,
            y: nextTelemetry.y,
          };

          setTelemetry(nextTelemetry);

          setTrail((previousTrail) => {
            const lastPoint =
              previousTrail[previousTrail.length - 1];

            // Avoid adding duplicate points when position has not changed.
            if (
              lastPoint &&
              lastPoint.x === nextTelemetry.x &&
              lastPoint.y === nextTelemetry.y
            ) {
              return previousTrail;
            }

            return [
              ...previousTrail,
              {
                x: nextTelemetry.x,
                y: nextTelemetry.y,
              },
            ].slice(-MAX_TRAIL_POINTS);
          });

          setPacketCount((count) => count + 1);
        } catch (error) {
          console.error(
            "Could not parse telemetry message:",
            error
          );
        }
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);

        setConnected(false);
        setConnectionMessage("Connection error");
      };

      socket.onclose = () => {
        if (!mountedRef.current) return;

        setConnected(false);
        setConnectionMessage("Disconnected — reconnecting...");

        // Stop sending movement commands after disconnection.
        stopCommands();

        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      if (!mountedRef.current) return;

      clearTimeout(reconnectTimerRef.current);

      const delay = reconnectDelayRef.current;

      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connectWebSocket();
        }
      }, delay);

      reconnectDelayRef.current = Math.min(
        delay * 2,
        10000
      );
    }

    connectWebSocket();

    return () => {
      mountedRef.current = false;

      clearTimeout(reconnectTimerRef.current);

      const socket = socketRef.current;
      socketRef.current = null;

      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;

        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close();
        }
      }
    };
  }, [stopCommands]);

  // Send {v, omega} commands to the backend at approximately 20 Hz.
  useEffect(() => {
    const commandTimer = setInterval(() => {
      const socket = socketRef.current;

      if (
        !socket ||
        socket.readyState !== WebSocket.OPEN ||
        replayModeRef.current
      ) {
        return;
      }

      let command = commandRef.current;

      // Simple demo autopilot: periodically change direction.
      if (autoPilotRef.current) {
        const seconds = Date.now() / 1000;

        command = {
          v: 0.4,
          omega: Math.sin(seconds * 0.5) * 0.6,
        };

        commandRef.current = command;
      }

      const safeCommand = {
        v: Math.max(-1, Math.min(1, Number(command.v) || 0)),
        omega: Math.max(
          -2,
          Math.min(2, Number(command.omega) || 0)
        ),
      };

      try {
        socket.send(JSON.stringify(safeCommand));
      } catch (error) {
        console.error("Could not send command:", error);
        stopCommands();
      }
    }, COMMAND_INTERVAL);

    return () => clearInterval(commandTimer);
  }, [stopCommands]);

  // Set movement commands from the on-screen controls.
  const setMovement = (v, omega) => {
    if (!connected || replayModeRef.current) return;

    commandRef.current = {
      v: Math.max(-1, Math.min(1, v)),
      omega: Math.max(-2, Math.min(2, omega)),
    };
  };

  const stopDrone = () => {
    setAutoPilot(false);
    autoPilotRef.current = false;
    stopCommands();
  };

  const toggleAutoPilot = () => {
    if (!connected || replayModeRef.current) return;

    const nextValue = !autoPilot;

    setAutoPilot(nextValue);
    autoPilotRef.current = nextValue;

    if (!nextValue) {
      stopCommands();
    }
  };

  const currentPosition = {
    x: Number(telemetry.x ?? 50),
    y: Number(telemetry.y ?? 50),
  };

  const isLowBattery = Number(telemetry.battery) <= 15;

  const cardStyle = {
    background: "rgba(13, 20, 34, 0.96)",
    color: "#e8eef8",
    border: "1px solid #34445d",
    borderRadius: 12,
    padding: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
    fontFamily: "Arial, sans-serif",
  };

  const controlButtonStyle = {
    background: "#23334c",
    color: "#f3f6fc",
    border: "1px solid #465875",
    borderRadius: 8,
    minWidth: 52,
    minHeight: 42,
    cursor: connected && !replayMode ? "pointer" : "not-allowed",
    fontSize: 16,
    opacity: connected && !replayMode ? 1 : 0.5,
    touchAction: "none",
    userSelect: "none",
  };

  const actionButtonStyle = {
    ...controlButtonStyle,
    minHeight: 34,
    minWidth: "auto",
    padding: "7px 10px",
    fontSize: 12,
    touchAction: "auto",
  };

  const metricStyle = {
    background: "#18253a",
    borderRadius: 8,
    padding: 9,
    minWidth: 0,
  };

  const metricLabelStyle = {
    color: "#8fa2bd",
    fontSize: 11,
    marginBottom: 4,
  };

  const metricValueStyle = {
    fontSize: 17,
    fontWeight: 700,
    overflowWrap: "anywhere",
  };

  return (
    <main
      style={{
        width: "100%",
        height: "100vh",
        minHeight: 600,
        overflow: "hidden",
        position: "relative",
        background: "#0b1220",
        color: "#e8eef8",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {/* Full-screen map */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
        }}
      >
        <DroneMap
          position={currentPosition}
          trail={trail}
          followDrone={followDrone}
        />
      </div>

      {/* Top status bar */}
      <header
        style={{
          ...cardStyle,
          position: "absolute",
          zIndex: 1000,
          top: 12,
          left: 12,
          right: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>
            SKYCONTROL
          </div>

          <div style={{ color: "#8fa2bd", fontSize: 11 }}>
            Drone Ground Station · Simulation
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span
            style={{
              background: connected ? "#123f34" : "#4a2530",
              color: connected ? "#62e6b5" : "#ff8998",
              borderRadius: 20,
              padding: "7px 10px",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {connected ? "● CONNECTED" : "● OFFLINE"}
          </span>

          {replayMode && (
            <span
              style={{
                background: "#173a58",
                color: "#8ed3ff",
                borderRadius: 20,
                padding: "7px 10px",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              REPLAY MODE
            </span>
          )}

          <span
            style={{
              color: "#b8c6d9",
              fontSize: 11,
            }}
          >
            {connectionMessage}
          </span>
        </div>
      </header>

      {/* Telemetry panel */}
      <section
        style={{
          ...cardStyle,
          position: "absolute",
          zIndex: 1000,
          top: 100,
          left: 12,
          width: "min(260px, calc(100vw - 48px))",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <strong>Live Telemetry</strong>

          <span
            style={{
              color: isLowBattery ? "#ff7373" : "#62e6b5",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {telemetry.status ?? "UNKNOWN"}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          <div style={metricStyle}>
            <div style={metricLabelStyle}>Velocity</div>
            <div style={metricValueStyle}>
              {Number(telemetry.v ?? 0).toFixed(2)}
            </div>
            <div style={metricLabelStyle}>m/s (simulated)</div>
          </div>

          <div style={metricStyle}>
            <div style={metricLabelStyle}>Angular velocity</div>
            <div style={metricValueStyle}>
              {Number(telemetry.omega ?? 0).toFixed(2)}
            </div>
            <div style={metricLabelStyle}>rad/s</div>
          </div>

          <div style={metricStyle}>
            <div style={metricLabelStyle}>Heading</div>
            <div style={metricValueStyle}>
              {(
                (Number(telemetry.theta ?? 0) * 180) /
                Math.PI
              ).toFixed(1)}
              °
            </div>
          </div>

          <div style={metricStyle}>
            <div style={metricLabelStyle}>Battery</div>
            <div
              style={{
                ...metricValueStyle,
                color: isLowBattery ? "#ff7373" : "#62e6b5",
              }}
            >
              {Number(telemetry.battery ?? 0).toFixed(1)}%
            </div>
          </div>

          <div style={metricStyle}>
            <div style={metricLabelStyle}>Position X</div>
            <div style={metricValueStyle}>
              {Number(telemetry.x ?? 0).toFixed(2)}
            </div>
          </div>

          <div style={metricStyle}>
            <div style={metricLabelStyle}>Position Y</div>
            <div style={metricValueStyle}>
              {Number(telemetry.y ?? 0).toFixed(2)}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 10,
            paddingTop: 9,
            borderTop: "1px solid #34445d",
            color: "#bac6d8",
            fontSize: 11,
            lineHeight: 1.8,
          }}
        >
          <div>
            IMU ax: {Number(telemetry.imu?.ax ?? 0).toFixed(2)}
          </div>
          <div>
            IMU ay: {Number(telemetry.imu?.ay ?? 0).toFixed(2)}
          </div>
          <div>
            IMU az: {Number(telemetry.imu?.az ?? 0).toFixed(2)}
          </div>
          <div>Packets received: {packetCount}</div>
          <div>
            Inter-packet interval:{" "}
            {latency === null ? "Waiting..." : `${latency} ms`}
          </div>
        </div>

        <div
          style={{
            marginTop: 8,
            color: "#8194ae",
            fontSize: 10,
          }}
        >
          The interval above measures time between received messages; it is
          not a network round-trip latency measurement.
        </div>
      </section>

      {/* Movement controls */}
      <section
        style={{
          ...cardStyle,
          position: "absolute",
          zIndex: 1000,
          left: 12,
          bottom: 16,
          width: 200,
        }}
      >
        <strong style={{ display: "block", marginBottom: 10 }}>
          Flight Controls
        </strong>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 6,
            justifyItems: "stretch",
          }}
        >
          <div />

          <button
            type="button"
            style={controlButtonStyle}
            disabled={!connected || replayMode}
            onPointerDown={(event) => {
              event.preventDefault();
              setMovement(0.6, 0);
            }}
            onPointerUp={stopCommands}
            onPointerLeave={stopCommands}
            onPointerCancel={stopCommands}
            aria-label="Move forward"
            title="Move forward"
          >
            ▲
          </button>

          <div />

          <button
            type="button"
            style={controlButtonStyle}
            disabled={!connected || replayMode}
            onPointerDown={(event) => {
              event.preventDefault();
              setMovement(0, 1);
            }}
            onPointerUp={stopCommands}
            onPointerLeave={stopCommands}
            onPointerCancel={stopCommands}
            aria-label="Turn left"
            title="Turn left"
          >
            ◀
          </button>

          <button
            type="button"
            style={{
              ...controlButtonStyle,
              background: "#8f2937",
              borderColor: "#d84c60",
            }}
            onClick={stopDrone}
            aria-label="Stop drone"
            title="Stop drone"
          >
            ■
          </button>

          <button
            type="button"
            style={controlButtonStyle}
            disabled={!connected || replayMode}
            onPointerDown={(event) => {
              event.preventDefault();
              setMovement(0, -1);
            }}
            onPointerUp={stopCommands}
            onPointerLeave={stopCommands}
            onPointerCancel={stopCommands}
            aria-label="Turn right"
            title="Turn right"
          >
            ▶
          </button>

          <div />

          <button
            type="button"
            style={controlButtonStyle}
            disabled={!connected || replayMode}
            onPointerDown={(event) => {
              event.preventDefault();
              setMovement(-0.4, 0);
            }}
            onPointerUp={stopCommands}
            onPointerLeave={stopCommands}
            onPointerCancel={stopCommands}
            aria-label="Move backward"
            title="Move backward"
          >
            ▼
          </button>

          <div />
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 10,
          }}
        >
          <button
            type="button"
            style={{
              ...actionButtonStyle,
              background: autoPilot ? "#8f2937" : "#167d63",
            }}
            disabled={!connected || replayMode}
            onClick={toggleAutoPilot}
          >
            {autoPilot ? "Stop Autopilot" : "Start Autopilot"}
          </button>

          <button
            type="button"
            style={actionButtonStyle}
            onClick={() => setFollowDrone((value) => !value)}
          >
            {followDrone ? "Unlock Map" : "Follow Drone"}
          </button>
        </div>

        <div
          style={{
            color: "#8fa2bd",
            fontSize: 10,
            marginTop: 8,
            lineHeight: 1.5,
          }}
        >
          Controls send velocity commands to the simulated server.
        </div>
      </section>

      {/* Charts toggle and telemetry charts */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 100,
          right: 12,
          width: "min(350px, calc(100vw - 48px))",
          maxHeight: "calc(100vh - 120px)",
          overflowY: "auto",
        }}
      >
        <button
          type="button"
          style={{
            ...actionButtonStyle,
            ...cardStyle,
            marginBottom: 8,
            cursor: "pointer",
          }}
          onClick={() => setShowCharts((value) => !value)}
        >
          {showCharts ? "Hide Telemetry Charts" : "Show Telemetry Charts"}
        </button>

        {showCharts && (
          <TelemetryCharts telemetry={telemetry} />
        )}
      </div>

      {/* Flight recorder panel */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          right: 12,
          bottom: 16,
          width: "min(350px, calc(100vw - 48px))",
          maxHeight: "45vh",
          overflowY: "auto",
        }}
      >
        <button
          type="button"
          style={{
            ...actionButtonStyle,
            ...cardStyle,
            marginBottom: 8,
            cursor: "pointer",
          }}
          onClick={() => setShowRecorder((value) => !value)}
        >
          {showRecorder ? "Hide Flight Recorder" : "Show Flight Recorder"}
        </button>

        {showRecorder && (
          <FlightRecorder
            telemetry={telemetry}
            dronePosition={currentPosition}
            flightCommand={{
              roll: commandRef.current.v,
              pitch: commandRef.current.omega,
            }}
          />
        )}
      </div>
    </main>
  );
}