import { useEffect, useRef, useState } from "react";

const WINDOW_SECONDS = 10;
const SAMPLE_INTERVAL_MS = 100;

export default function TelemetryCharts({ telemetry }) {
  const [history, setHistory] = useState([]);
  const latestTelemetry = useRef(telemetry);

  // Keep the latest incoming WebSocket data available to the sampler.
  useEffect(() => {
    latestTelemetry.current = telemetry;
  }, [telemetry]);

  // Sample the incoming data and retain only the latest 10 seconds.
  useEffect(() => {
    const timer = setInterval(() => {
      const data = latestTelemetry.current;

      if (!data) return;

      const now = performance.now();

      const sample = {
        time: now,
        v: Number(data.v) || 0,
        omega: Number(data.omega) || 0,
        ax: Number(data.imu?.ax) || 0,
        ay: Number(data.imu?.ay) || 0,
        az: Number(data.imu?.az) || 0,
      };

      setHistory((previous) => {
        return [
          ...previous.filter(
            (point) => now - point.time <= WINDOW_SECONDS * 1000
          ),
          sample,
        ];
      });
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  return (
    <section
      style={{
        background: "rgba(12, 20, 32, 0.96)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: 12,
        padding: 14,
        width: "min(440px, calc(100vw - 60px))",
        boxSizing: "border-box",
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontSize: 11,
            color: "#9caec3",
            letterSpacing: 1,
          }}
        >
          LIVE WEBSOCKET TELEMETRY
        </div>

        <strong style={{ fontSize: 16 }}>
          Real-Time Flight Charts
        </strong>

        <div style={{ fontSize: 11, color: "#aab8cb", marginTop: 4 }}>
          Rolling {WINDOW_SECONDS}-second window · SVG rendering
        </div>
      </div>

      <Chart
        title="Linear Velocity"
        unit="m/s"
        data={history}
        keys={[{ key: "v", color: "#60a5fa" }]}
      />

      <Chart
        title="Angular Velocity"
        unit="rad/s"
        data={history}
        keys={[{ key: "omega", color: "#fbbf24" }]}
      />

      <Chart
        title="IMU Acceleration"
        unit="m/s²"
        data={history}
        keys={[
          { key: "ax", color: "#f87171" },
          { key: "ay", color: "#4ade80" },
          { key: "az", color: "#c084fc" },
        ]}
      />

      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          fontSize: 11,
          color: "#cbd5e1",
          marginTop: 10,
        }}
      >
        {[
          ["ax", "#f87171"],
          ["ay", "#4ade80"],
          ["az", "#c084fc"],
        ].map(([label, color]) => (
          <span key={label}>
            <span style={{ color }}>●</span> {label}
          </span>
        ))}
      </div>
    </section>
  );
}

function Chart({ title, unit, data, keys }) {
  const width = 400;
  const height = 105;
  const padding = { left: 35, right: 8, top: 10, bottom: 20 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const values = data.flatMap((point) =>
    keys.map(({ key }) => point[key])
  );

  let min = values.length ? Math.min(...values) : -1;
  let max = values.length ? Math.max(...values) : 1;

  if (min === max) {
    min -= 1;
    max += 1;
  }

  const range = max - min;
  min -= range * 0.1;
  max += range * 0.1;

  function getX(index) {
    if (data.length <= 1) return padding.left;

    return (
      padding.left +
      (index / (data.length - 1)) * plotWidth
    );
  }

  function getY(value) {
    return (
      padding.top +
      ((max - value) / (max - min)) * plotHeight
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          marginBottom: 4,
        }}
      >
        <strong>{title}</strong>
        <span style={{ color: "#9caec3" }}>{unit}</span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title} over the last ${WINDOW_SECONDS} seconds`}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          background: "#101722",
          borderRadius: 8,
        }}
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = padding.top + fraction * plotHeight;
          const value = max - fraction * (max - min);

          return (
            <g key={fraction}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#344153"
                strokeDasharray="3 3"
              />

              <text
                x={padding.left - 5}
                y={y + 3}
                textAnchor="end"
                fill="#8292a7"
                fontSize="9"
              >
                {value.toFixed(1)}
              </text>
            </g>
          );
        })}

        {keys.map(({ key, color }) => {
          const points = data
            .map(
              (point, index) =>
                `${getX(index)},${getY(point[key])}`
            )
            .join(" ");

          return (
            <polyline
              key={key}
              points={points}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        <text
          x={padding.left}
          y={height - 5}
          fill="#8292a7"
          fontSize="9"
        >
          -10 s
        </text>

        <text
          x={width - padding.right}
          y={height - 5}
          fill="#8292a7"
          fontSize="9"
          textAnchor="end"
        >
          Now
        </text>
      </svg>
    </div>
  );
}