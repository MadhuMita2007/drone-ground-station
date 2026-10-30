
import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Popup,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Sample starting point until real GPS data is connected
const DEMO_CENTER = [13.0827, 80.2707];

function getCoordinates(point) {
  if (!point) return DEMO_CENTER;

  // Real GPS coordinates, when available
  const lat = point.latitude ?? point.lat;
  const lng = point.longitude ?? point.lng ?? point.lon;

  if (
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng)) &&
    lat !== undefined &&
    lng !== undefined
  ) {
    return [Number(lat), Number(lng)];
  }

  // Temporary conversion for the existing x/y simulation
  if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
    return [
      DEMO_CENTER[0] + (50 - point.y) * 0.00015,
      DEMO_CENTER[1] + (point.x - 50) * 0.00015,
    ];
  }

  return DEMO_CENTER;
}

function FollowDrone({ position }) {
  const map = useMap();

  useEffect(() => {
    map.panTo(getCoordinates(position), { animate: true });
  }, [map, position]);

  return null;
}

export default function DroneMap({
  position = { latitude: DEMO_CENTER[0], longitude: DEMO_CENTER[1] },
  trail = [],
}) {
  const droneCoordinates = getCoordinates(position);

  const routeCoordinates = trail.map(getCoordinates);

  // Include the current position at the end of the route
  if (
    routeCoordinates.length === 0 ||
    routeCoordinates[routeCoordinates.length - 1][0] !== droneCoordinates[0] ||
    routeCoordinates[routeCoordinates.length - 1][1] !== droneCoordinates[1]
  ) {
    routeCoordinates.push(droneCoordinates);
  }

  const startCoordinates =
    routeCoordinates.length > 0
      ? routeCoordinates[0]
      : droneCoordinates;

  return (
    <div
     style={{
  width: "100%",
  height: "100vh",
  borderRadius: 0,
  overflow: "hidden",
  position: "relative",
}}
    >
      <MapContainer
        center={droneCoordinates}
        zoom={17}
        scrollWheelZoom={true}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FollowDrone position={position} />

        {routeCoordinates.length > 1 && (
          <Polyline
            positions={routeCoordinates}
            pathOptions={{
              color: "#00a86b",
              weight: 5,
              opacity: 0.9,
            }}
          />
        )}

        <CircleMarker
          center={startCoordinates}
          radius={7}
          pathOptions={{
            color: "#ffffff",
            fillColor: "#16a34a",
            fillOpacity: 1,
          }}
        >
          <Popup>Flight starting point</Popup>
        </CircleMarker>

        <CircleMarker
          center={droneCoordinates}
          radius={9}
          pathOptions={{
            color: "#ffffff",
            weight: 3,
            fillColor: "#2563eb",
            fillOpacity: 1,
          }}
        >
          <Popup>
            <strong>Drone position</strong>
            <br />
            Latitude: {droneCoordinates[0].toFixed(6)}
            <br />
            Longitude: {droneCoordinates[1].toFixed(6)}
          </Popup>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}
