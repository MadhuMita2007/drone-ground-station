import { WebSocketServer } from "ws";

const PORT = 8080;
const RATE = 50;

const server = new WebSocketServer({ port: PORT });

let x = 50;
let y = 50;
let theta = 0;
let v = 0;
let omega = 0;
let battery = 100;

const clients = new Set();
let startTime = Date.now();

server.on("connection", (socket) => {
  clients.add(socket);

  console.log("Ground station client connected");

  socket.on("message", (message) => {
    try {
      const command = JSON.parse(message.toString());

      // Accept simulated velocity commands.
      if (Number.isFinite(command.v)) {
        v = Math.max(-1, Math.min(1, command.v));
      }

      if (Number.isFinite(command.omega)) {
        omega = Math.max(-2, Math.min(2, command.omega));
      }
    } catch {
      console.log("Invalid command received");
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
    v = 0;
    omega = 0;
    console.log("Ground station client disconnected");
  });
});

setInterval(() => {
  const elapsed = (Date.now() - startTime) / 1000;
  const dt = 1 / RATE;

  theta += omega * dt;

  // Keep heading between -PI and PI.
  theta = Math.atan2(Math.sin(theta), Math.cos(theta));

  // Simulate movement in local map coordinates.
  x += Math.cos(theta) * v * dt;
  y += Math.sin(theta) * v * dt;

  x = Math.max(5, Math.min(95, x));
  y = Math.max(5, Math.min(95, y));

  battery = Math.max(0, battery - 0.0002 * dt);

  const telemetry = {
    t: elapsed,
    x,
    y,
    theta,
    v,
    omega,
    battery,
    imu: {
      ax: 0,
      ay: 0,
      az: 9.81,
    },
    status: battery <= 15 ? "LOW_BATTERY" : "OK",
  };

  const message = JSON.stringify(telemetry);

  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}, 1000 / RATE);

server.on("listening", () => {
  console.log(`WebSocket telemetry server running on ws://localhost:${PORT}`);
  console.log(`Telemetry rate: ${RATE} Hz`);
});