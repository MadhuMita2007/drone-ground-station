
import { useCallback, useEffect, useRef, useState } from "react";

const DB_NAME = "skycontrol-flight-data";
const STORE_NAME = "flights";
const REPLAY_EVENT = "skycontrol-telemetry-update";
const SAMPLE_INTERVAL = 500;

function openFlightDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not supported by this browser."));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Could not open flight database."));
  });
}

async function saveFlight(flight) {
  const db = await openFlightDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).add(flight);

    request.onsuccess = () => {
      flight.id = request.result;
    };

    transaction.oncomplete = () => {
      db.close();
      resolve(flight);
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Could not save flight."));
    };

    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Flight save was cancelled."));
    };
  });
}

async function loadFlights() {
  const db = await openFlightDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => {
      const flights = request.result || [];
      flights.sort((a, b) => b.createdAt - a.createdAt);
      resolve(flights);
    };

    request.onerror = () => {
      reject(request.error || new Error("Could not load saved flights."));
    };

    transaction.oncomplete = () => db.close();

    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Loading flights was cancelled."));
    };
  });
}

function publishReplay(samples, index) {
  window.__SKYCONTROL_REPLAYING__ = true;

  window.dispatchEvent(
    new CustomEvent(REPLAY_EVENT, {
      detail: {
        mode: "replay",
        samples,
        position: index,
      },
    })
  );
}

function publishLiveMode() {
  window.__SKYCONTROL_REPLAYING__ = false;

  window.dispatchEvent(
    new CustomEvent(REPLAY_EVENT, {
      detail: { mode: "live" },
    })
  );
}

function getNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export default function FlightRecorder({
  telemetry = {},
  dronePosition = { x: 50, y: 50 },
  flightCommand = { roll: 0, pitch: 0 },
}) {
  const [recording, setRecording] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [flights, setFlights] = useState([]);
  const [activeFlight, setActiveFlight] = useState(null);
  const [position, setPosition] = useState(0);
  const [sampleCount, setSampleCount] = useState(0);
  const [message, setMessage] = useState("Ready to record.");

  const samplesRef = useRef([]);
  const latestDataRef = useRef({
    telemetry,
    dronePosition,
    flightCommand,
  });

  const recordingStartRef = useRef(0);
  const lastSampleRef = useRef(0);
  const recordingTimerRef = useRef(null);
  const replayTimerRef = useRef(null);
  const replayIndexRef = useRef(0);
  const mountedRef = useRef(true);

  // Keep the latest telemetry and controls available to the recording timer.
  useEffect(() => {
    latestDataRef.current = {
      telemetry,
      dronePosition,
      flightCommand,
    };
  }, [telemetry, dronePosition, flightCommand]);

  const refreshFlights = useCallback(async () => {
    try {
      const savedFlights = await loadFlights();

      if (mountedRef.current) {
        setFlights(savedFlights);
      }
    } catch (error) {
      console.error("Could not load saved flights:", error);

      if (mountedRef.current) {
        setMessage(`Database error: ${error.message}`);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refreshFlights();

    return () => {
      mountedRef.current = false;
      clearInterval(recordingTimerRef.current);
      clearInterval(replayTimerRef.current);
    };
  }, [refreshFlights]);

  // Capture telemetry every 500 ms while recording.
  useEffect(() => {
    if (!recording) {
      clearInterval(recordingTimerRef.current);
      return undefined;
    }

    recordingTimerRef.current = setInterval(() => {
      const now = Date.now();

      if (now - lastSampleRef.current < SAMPLE_INTERVAL) {
        return;
      }

      lastSampleRef.current = now;

      const {
        telemetry: currentTelemetry,
        dronePosition: currentPosition,
        flightCommand: currentCommand,
      } = latestDataRef.current;

      const elapsed = (now - recordingStartRef.current) / 1000;

      const x = getNumber(currentPosition?.x, 50);
      const y = getNumber(currentPosition?.y, 50);
      const v = getNumber(
        currentTelemetry?.v ?? currentTelemetry?.speed,
        0
      );

      const sample = {
        elapsed: Number(elapsed.toFixed(2)),

        // Preserve the original telemetry for future replay features.
        telemetry: { ...currentTelemetry },

        altitude: Number(
          getNumber(currentTelemetry?.altitude, 0).toFixed(2)
        ),

        speed: Number(v.toFixed(2)),

        battery: Number(
          getNumber(currentTelemetry?.battery, 0).toFixed(2)
        ),

        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),

        theta: Number(
          getNumber(currentTelemetry?.theta, 0).toFixed(4)
        ),

        v: Number(v.toFixed(3)),

        omega: Number(
          getNumber(currentTelemetry?.omega, 0).toFixed(3)
        ),

        imu: {
          ...(currentTelemetry?.imu ?? {}),
        },

        roll: Number(
          getNumber(currentCommand?.roll, 0).toFixed(3)
        ),

        pitch: Number(
          getNumber(currentCommand?.pitch, 0).toFixed(3)
        ),
      };

      samplesRef.current.push(sample);

      if (mountedRef.current) {
        setSampleCount(samplesRef.current.length);
      }
    }, 100);

    return () => {
      clearInterval(recordingTimerRef.current);
    };
  }, [recording]);

  const startRecording = () => {
    clearInterval(recordingTimerRef.current);
    clearInterval(replayTimerRef.current);

    publishLiveMode();

    samplesRef.current = [];
    recordingStartRef.current = Date.now();
    lastSampleRef.current = 0;
    replayIndexRef.current = 0;

    setSampleCount(0);
    setPosition(0);
    setActiveFlight(null);
    setReplaying(false);
    setRecording(true);
    setMessage("Recording live telemetry...");
  };

  const stopRecording = async () => {
    clearInterval(recordingTimerRef.current);
    setRecording(false);

    if (samplesRef.current.length === 0) {
      setMessage("No samples recorded. Start the telemetry stream and try again.");
      return;
    }

    const duration = samplesRef.current[
      samplesRef.current.length - 1
    ].elapsed;

    const flight = {
      name: `Flight ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      duration,
      sampleCount: samplesRef.current.length,
      samples: [...samplesRef.current],
    };

    try {
      const savedFlight = await saveFlight(flight);

      if (!mountedRef.current) return;

      setActiveFlight(savedFlight);
      setPosition(0);
      setMessage(
        `Saved ${savedFlight.samples.length} samples successfully.`
      );

      await refreshFlights();
    } catch (error) {
      console.error("Could not save flight:", error);

      if (mountedRef.current) {
        setMessage(`Could not save flight: ${error.message}`);
      }
    }
  };

  const replayFlight = (flight) => {
    if (!flight?.samples?.length) {
      setMessage("This flight has no recorded samples.");
      return;
    }

    clearInterval(recordingTimerRef.current);
    clearInterval(replayTimerRef.current);

    setRecording(false);
    setActiveFlight(flight);
    setPosition(0);
    setReplaying(true);
    setMessage(`Replaying: ${flight.name}`);

    replayIndexRef.current = 0;
    publishReplay(flight.samples, 0);

    replayTimerRef.current = setInterval(() => {
      const nextIndex = replayIndexRef.current + 1;

      if (nextIndex >= flight.samples.length) {
        clearInterval(replayTimerRef.current);

        replayIndexRef.current = flight.samples.length - 1;

        if (mountedRef.current) {
          setReplaying(false);
          setPosition(replayIndexRef.current);
          setMessage("Replay complete.");
        }

        publishReplay(flight.samples, replayIndexRef.current);
        return;
      }

      replayIndexRef.current = nextIndex;

      if (mountedRef.current) {
        setPosition(nextIndex);
      }

      publishReplay(flight.samples, nextIndex);
    }, SAMPLE_INTERVAL);
  };

  const pauseReplay = () => {
    clearInterval(replayTimerRef.current);
    setReplaying(false);
    setMessage("Replay paused.");
  };

  const resumeReplay = () => {
    if (!activeFlight?.samples?.length) return;

    clearInterval(replayTimerRef.current);

    const samples = activeFlight.samples;

    if (position >= samples.length - 1) {
      setPosition(0);
      replayIndexRef.current = 0;
      publishReplay(samples, 0);
    } else {
      replayIndexRef.current = position;
      publishReplay(samples, position);
    }

    setReplaying(true);
    setMessage("Replaying flight...");

    replayTimerRef.current = setInterval(() => {
      const nextIndex = replayIndexRef.current + 1;

      if (nextIndex >= samples.length) {
        clearInterval(replayTimerRef.current);

        replayIndexRef.current = samples.length - 1;

        if (mountedRef.current) {
          setReplaying(false);
          setPosition(replayIndexRef.current);
          setMessage("Replay complete.");
        }

        publishReplay(samples, replayIndexRef.current);
        return;
      }

      replayIndexRef.current = nextIndex;

      if (mountedRef.current) {
        setPosition(nextIndex);
      }

      publishReplay(samples, nextIndex);
    }, SAMPLE_INTERVAL);
  };

  const seekReplay = (value) => {
    const samples = activeFlight?.samples;

    if (!samples?.length) return;

    const nextPosition = Math.max(
      0,
      Math.min(samples.length - 1, Number(value))
    );

    clearInterval(replayTimerRef.current);
    replayIndexRef.current = nextPosition;
    setPosition(nextPosition);
    setReplaying(false);
    setMessage("Timeline adjusted. Press Play to continue.");

    publishReplay(samples, nextPosition);
  };

  const returnToLive = () => {
    clearInterval(replayTimerRef.current);

    setReplaying(false);
    setActiveFlight(null);
    setPosition(0);
    setMessage("Live telemetry mode.");

    publishLiveMode();
  };

  const currentSample = activeFlight?.samples?.[position];

  const panelStyle = {
    background: "rgba(13, 20, 34, 0.96)",
    color: "#e8eef8",
    border: "1px solid #34445d",
    borderRadius: 12,
    padding: 14,
    fontFamily: "Arial, sans-serif",
    fontSize: 13,
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
  };

  const buttonStyle = {
    border: "1px solid #465875",
    borderRadius: 7,
    padding: "8px 10px",
    color: "#f3f6fc",
    background: "#23334c",
    cursor: "pointer",
    fontSize: 12,
  };

  const primaryButtonStyle = {
    ...buttonStyle,
    background: "#167d63",
    borderColor: "#22a786",
  };

  const disabledButtonStyle = {
    ...buttonStyle,
    opacity: 0.45,
    cursor: "not-allowed",
  };

  return (
    <section style={panelStyle}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <strong style={{ fontSize: 15 }}>Flight Recorder</strong>

        <span
          style={{
            color: recording ? "#ff7373" : replaying ? "#76c8ff" : "#9eacc2",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {recording ? "● RECORDING" : replaying ? "▶ REPLAYING" : "● READY"}
        </span>
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 12,
        }}
      >
        {!recording ? (
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={startRecording}
          >
            ● Start Recording
          </button>
        ) : (
          <button
            type="button"
            style={{
              ...buttonStyle,
              background: "#8f2937",
              borderColor: "#d84c60",
            }}
            onClick={stopRecording}
          >
            ■ Stop & Save
          </button>
        )}

        <button
          type="button"
          style={buttonStyle}
          onClick={returnToLive}
          disabled={!activeFlight && !replaying}
        >
          Live Mode
        </button>
      </div>

      <div style={{ color: "#bac6d8", marginBottom: 8 }}>
        Samples captured: <strong>{sampleCount}</strong>
      </div>

      <div style={{ color: "#bac6d8", marginBottom: 12 }}>
        {message}
      </div>

      {activeFlight?.samples?.length > 0 && (
        <div
          style={{
            borderTop: "1px solid #34445d",
            paddingTop: 12,
            marginTop: 8,
          }}
        >
          <strong style={{ display: "block", marginBottom: 8 }}>
            Replay Timeline
          </strong>

          <input
            type="range"
            min="0"
            max={Math.max(0, activeFlight.samples.length - 1)}
            value={Math.min(position, activeFlight.samples.length - 1)}
            onChange={(event) => seekReplay(event.target.value)}
            style={{ width: "100%", cursor: "pointer" }}
            aria-label="Flight replay timeline"
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: "#bac6d8",
              fontSize: 11,
              marginTop: 4,
            }}
          >
            <span>
              {currentSample?.elapsed?.toFixed(1) ?? "0.0"} s
            </span>
            <span>
              {activeFlight.duration?.toFixed(1) ?? "0.0"} s total
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 10,
            }}
          >
            {!replaying ? (
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={resumeReplay}
              >
                ▶ Play / Resume
              </button>
            ) : (
              <button
                type="button"
                style={buttonStyle}
                onClick={pauseReplay}
              >
                ❚❚ Pause
              </button>
            )}
          </div>

          {currentSample && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                marginTop: 12,
              }}
            >
              <div>
                <div style={{ color: "#8fa2bd" }}>Velocity</div>
                <strong>
                  {getNumber(currentSample.v ?? currentSample.speed).toFixed(2)}
                </strong>
              </div>

              <div>
                <div style={{ color: "#8fa2bd" }}>Battery</div>
                <strong>
                  {getNumber(currentSample.battery).toFixed(1)}%
                </strong>
              </div>

              <div>
                <div style={{ color: "#8fa2bd" }}>Position X</div>
                <strong>{getNumber(currentSample.x).toFixed(2)}</strong>
              </div>

              <div>
                <div style={{ color: "#8fa2bd" }}>Position Y</div>
                <strong>{getNumber(currentSample.y).toFixed(2)}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      <div
        style={{
          borderTop: "1px solid #34445d",
          paddingTop: 12,
          marginTop: 14,
        }}
      >
        <strong style={{ display: "block", marginBottom: 8 }}>
          Saved Flights ({flights.length})
        </strong>

        {flights.length === 0 ? (
          <div style={{ color: "#8fa2bd" }}>
            No saved flights yet. Record a flight and stop it to save.
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              maxHeight: 180,
              overflowY: "auto",
            }}
          >
            {flights.map((flight) => (
              <div
                key={flight.id ?? `${flight.createdAt}-${flight.name}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  background: "#18253a",
                  borderRadius: 8,
                  padding: 9,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {flight.name}
                  </div>

                  <div
                    style={{
                      color: "#8fa2bd",
                      fontSize: 11,
                      marginTop: 3,
                    }}
                  >
                    {flight.samples?.length ?? flight.sampleCount ?? 0} samples
                    {" · "}
                    {getNumber(flight.duration).toFixed(1)} s
                  </div>
                </div>

                <button
                  type="button"
                  style={buttonStyle}
                  onClick={() => replayFlight(flight)}
                  disabled={recording}
                  title="Replay this saved flight"
                >
                  ▶ Replay
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
