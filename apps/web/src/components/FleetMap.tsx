import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";

export type FleetMapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  kind: "site" | "truck";
  title: string;
  subtitle?: string;
};

type DisplayMarker = FleetMapMarker & {
  displayLat: number;
  displayLng: number;
  offset: boolean;
};

const COORD_GROUP_PRECISION = 5;
/** ~35–40 m ring so stacked pins stay readable at city zoom. */
const OFFSET_DEG = 0.00038;

function groupKey(lat: number, lng: number) {
  return `${lat.toFixed(COORD_GROUP_PRECISION)},${lng.toFixed(COORD_GROUP_PRECISION)}`;
}

/** Spread markers that share (near-)identical coordinates onto a small ring. */
export function offsetOverlappingMarkers(markers: FleetMapMarker[]): DisplayMarker[] {
  const groups = new Map<string, FleetMapMarker[]>();
  for (const marker of markers) {
    const key = groupKey(marker.latitude, marker.longitude);
    const list = groups.get(key) ?? [];
    list.push(marker);
    groups.set(key, list);
  }

  const display: DisplayMarker[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      const only = group[0];
      display.push({
        ...only,
        displayLat: only.latitude,
        displayLng: only.longitude,
        offset: false
      });
      continue;
    }

    const radius = OFFSET_DEG * Math.max(1, Math.sqrt(group.length));
    group.forEach((marker, index) => {
      const angle = (2 * Math.PI * index) / group.length - Math.PI / 2;
      const cosLat = Math.cos((marker.latitude * Math.PI) / 180) || 1;
      display.push({
        ...marker,
        displayLat: marker.latitude + radius * Math.cos(angle),
        displayLng: marker.longitude + (radius * Math.sin(angle)) / cosLat,
        offset: true
      });
    });
  }
  return display;
}

function markerIcon(kind: "site" | "truck") {
  const label = kind === "site" ? "Tip" : "Truck";
  return L.divIcon({
    className: `fleet-map-marker fleet-map-marker--${kind}`,
    html: `<span class="fleet-map-marker-pin" title="${label}"><span class="fleet-map-marker-dot"></span></span>`,
    iconSize: [22, 28],
    iconAnchor: [11, 26],
    popupAnchor: [0, -22]
  });
}

export default function FleetMap({ markers }: { markers: FleetMapMarker[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const displayMarkers = useMemo(() => offsetOverlappingMarkers(markers), [markers]);
  const overlapCount = useMemo(
    () => displayMarkers.filter((marker) => marker.offset).length,
    [displayMarkers]
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      attributionControl: true
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const onResize = () => {
      map.invalidateSize();
    };
    window.addEventListener("resize", onResize);
    const resizeTimer = window.setTimeout(onResize, 80);

    return () => {
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) {
      return;
    }

    layer.clearLayers();

    if (displayMarkers.length === 0) {
      map.setView([6.5244, 3.3792], 11);
      return;
    }

    const bounds = L.latLngBounds([]);
    for (const marker of displayMarkers) {
      const leafletMarker = L.marker([marker.displayLat, marker.displayLng], {
        icon: markerIcon(marker.kind),
        title: marker.title,
        riseOnHover: true
      });
      const kindLabel = marker.kind === "site" ? "Tip site" : "Started truck";
      const offsetNote = marker.offset
        ? `<p class="fleet-map-popup-note">Offset slightly — shared coordinates with another pin</p>`
        : "";
      leafletMarker.bindPopup(
        `<div class="fleet-map-popup"><strong>${escapeHtml(marker.title)}</strong>` +
          `<p>${escapeHtml(kindLabel)}</p>` +
          (marker.subtitle ? `<p>${escapeHtml(marker.subtitle)}</p>` : "") +
          offsetNote +
          `</div>`
      );
      leafletMarker.addTo(layer);
      bounds.extend([marker.displayLat, marker.displayLng]);
    }

    map.invalidateSize();
    if (displayMarkers.length === 1) {
      map.setView([displayMarkers[0].displayLat, displayMarkers[0].displayLng], 14);
    } else {
      map.fitBounds(bounds.pad(0.18), { maxZoom: 15 });
    }
  }, [displayMarkers]);

  const siteCount = markers.filter((m) => m.kind === "site").length;
  const truckCount = markers.filter((m) => m.kind === "truck").length;

  return (
    <div className="fleet-map-wrap">
      <div className="fleet-map-frame" ref={containerRef} role="img" aria-label="Fleet sites and started trucks map" />
      <div className="fleet-map-legend" aria-hidden="true">
        <span className="fleet-map-legend-item fleet-map-legend-item--site">
          <span className="fleet-map-legend-swatch" /> Tip sites ({siteCount})
        </span>
        <span className="fleet-map-legend-item fleet-map-legend-item--truck">
          <span className="fleet-map-legend-swatch" /> Started trucks ({truckCount})
        </span>
      </div>
      {overlapCount > 0 ? (
        <p className="muted coverage-footnote fleet-map-overlap-note">
          {overlapCount} pin{overlapCount === 1 ? "" : "s"} share the same coordinates and are spread
          slightly so each stays visible (common when a truck is mapped to a tip site).
        </p>
      ) : null}
    </div>
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
