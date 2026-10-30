# Drone Ground Station

A web-based Drone Ground Station built with React and Vite for visualizing simulated drone telemetry, monitoring flight parameters, viewing drone movement on a map, and recording and replaying flight data.

## Features

- **Live Telemetry:** Displays drone flight information received through a WebSocket connection.
- **Flight Metrics:** Monitors telemetry such as speed, battery level, and other available flight parameters.
- **Telemetry Charts:** Visualizes flight data, including velocity, angular velocity, and IMU readings.
- **Drone Map:** Displays the drone's simulated position and movement trail.
- **Flight Recording:** Records flight telemetry and saves flight sessions in the browser using IndexedDB.
- **Flight Replay:** Allows recorded flights to be replayed and navigated using a timeline.
- **Flight Controls:** Provides keyboard-free on-screen controls for sending simulated movement commands.
- **Simulated Telemetry Server:** Generates telemetry data for testing the ground station without a physical drone.

## Technologies Used

- React
- Vite
- JavaScript
- WebSocket
- Leaflet and React Leaflet
- SVG for telemetry visualizations
- IndexedDB for browser-based flight recording
- Node.js for the simulated telemetry server

## Prerequisites

Install the following software before running the project:

- Node.js and npm
- Git (optional, for cloning the repository)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/MadhuMita2007/drone-ground-station.git
```

### 2. Navigate to the project directory

```bash
cd drone-ground-station
```

### 3. Install dependencies

```bash
npm install
```

If the WebSocket server dependency is missing, install it with:

```bash
npm install ws
```

## Running the Project

The application has two parts: the React frontend and the simulated WebSocket server.

### 1. Start the simulated telemetry server

Open a terminal in the project directory and run:

```bash
node server.js
```

Keep this terminal running.

### 2. Start the frontend

Open a **second terminal** in the same project directory and run:

```bash
npm run dev
```

Open the local URL printed in the terminal, usually:

```text
http://localhost:5173
```

If port 5173 is already in use, Vite may display a different port. Open the URL shown in your terminal.

## How It Works

1. The simulated server generates drone telemetry.
2. The frontend connects to the server using WebSocket.
3. Incoming telemetry updates the flight metrics, charts, and drone map.
4. Flight sessions can be recorded and stored in the browser.
5. Recorded sessions can be replayed using the flight recorder controls.
6. On-screen controls send movement commands to the simulated server.

## Important Notes

- This project currently uses simulated telemetry; it is not a connection to a physical drone.
- The WebSocket server must be running for live telemetry and movement commands to work.
- Recorded flight data is stored locally in the browser and may not be available in another browser or on another device.
- This is a local development setup. The frontend and WebSocket server are not automatically hosted online by GitHub.

## Running Checks

To build the frontend for production:

```bash
npm run build
```

To run the project's lint checks:

```bash
npm run lint
```

## Repository

GitHub: https://github.com/MadhuMita2007/drone-ground-station