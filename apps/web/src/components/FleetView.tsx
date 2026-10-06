import type {
  DumpsiteSite,
  FleetBoardPhase,
  FleetDumpsiteRunItem,
  FleetTruckItem,
  FleetTruckMapPosition,
  FleetTruckMapSource,
  OperatorFleetSnapshot,
  RecordMaintenanceEventInput,
  TruckStatus,
  UpsertDumpsiteSiteInput
} from "@cleanops/shared";
import { CalendarDays, ExternalLink, Fuel, MapPin, Plus, RefreshCw, Truck, Wrench } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import {
  demoLagosCoordsForId,
  isInNigeria,
  readFleetDemoLagosPreference,
  resolveFleetDemoLagos,
  writeFleetDemoLagosPreference,
  type LatLng
} from "../lib/fleetDemoLagos";
import FleetMap, { type FleetMapMarker } from "./FleetMap";

type TruckFilter = "all" | TruckStatus | "inactive";
type DumpsiteFilter = "all" | FleetBoardPhase;

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatTime(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatNgn(amountKobo: number) {
  return `NGN ${(amountKobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function truckStatusClass(status: TruckStatus, active: boolean) {
  if (!active) {
    return "pill danger";
  }
  if (status === "workshop") {
    return "pill warn";
  }
  if (status === "standby") {
    return "pill";
  }
  return "pill";
}

function phaseClass(phase: FleetBoardPhase) {
  if (phase === "cleared") {
    return "pill";
  }
  if (phase === "arrived") {
    return "pill warn";
  }
  return "pill";
}

function phaseLabel(phase: FleetBoardPhase) {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function mapSourceLabel(source: FleetTruckMapSource | null | undefined) {
  switch (source) {
    case "live_gps":
      return "Live GPS";
    case "last_stop_gps":
      return "Last stop GPS";
    case "dumpsite":
      return "At dumpsite";
    case "planned_stop":
      return "Route stop";
    case "route_centroid":
      return "Route area";
    default:
      return "Location unknown";
  }
}

export default function FleetView({
  fleet,
  operationDate,
  onRefresh,
  onRecordMaintenance,
  onUpsertDumpsiteSite,
  refreshing,
  saving
}: {
  fleet: OperatorFleetSnapshot | null;
  operationDate: string;
  onRefresh: () => void;
  onRecordMaintenance: (input: RecordMaintenanceEventInput) => Promise<void>;
  onUpsertDumpsiteSite: (input: UpsertDumpsiteSiteInput) => Promise<void>;
  refreshing?: boolean;
  saving?: boolean;
}) {
  const [truckFilter, setTruckFilter] = useState<TruckFilter>("all");
  const [dumpsiteFilter, setDumpsiteFilter] = useState<DumpsiteFilter>("all");
  const [maintenanceForm, setMaintenanceForm] = useState({
    truckId: "",
    eventDate: operationDate,
    workDone: "",
    workshopName: "",
    costNaira: ""
  });
  const [siteForm, setSiteForm] = useState({
    siteId: "" as string,
    name: "",
    address: "",
    latitude: "",
    longitude: "",
    dailyCapacityTonnes: "",
    notes: "",
    active: true
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [demoLagosPreference, setDemoLagosPreference] = useState<boolean | null>(() =>
    readFleetDemoLagosPreference()
  );

  const demoLagos = useMemo(
    () => resolveFleetDemoLagos(demoLagosPreference),
    [demoLagosPreference]
  );

  const metrics = fleet?.metrics;
  const trucks = fleet?.trucks ?? [];
  const dumpsiteRuns = fleet?.dumpsiteRuns ?? [];
  const fuelLogs = fleet?.fuelLogs ?? [];
  const maintenanceEvents = fleet?.maintenanceEvents ?? [];
  const dumpsiteSites = fleet?.dumpsiteSites ?? [];
  const activeTruckPositions = fleet?.activeTruckPositions ?? [];

  const filteredTrucks = useMemo(() => {
    switch (truckFilter) {
      case "operational":
      case "standby":
      case "workshop":
        return trucks.filter((truck) => truck.active && truck.status === truckFilter);
      case "inactive":
        return trucks.filter((truck) => !truck.active);
      case "all":
      default:
        return trucks;
    }
  }, [truckFilter, trucks]);

  const filteredDumpsite = useMemo(() => {
    if (dumpsiteFilter === "all") {
      return dumpsiteRuns;
    }
    return dumpsiteRuns.filter((run) => run.phase === dumpsiteFilter);
  }, [dumpsiteFilter, dumpsiteRuns]);

  /** Tip anchors used for demo jitter (Nigeria tip coords only). */
  const tipAnchors = useMemo((): LatLng[] => {
    return dumpsiteSites
      .filter((site) => site.active && site.latitude != null && site.longitude != null)
      .map((site) => ({
        latitude: Number(site.latitude),
        longitude: Number(site.longitude)
      }))
      .filter((coords) => isInNigeria(coords.latitude, coords.longitude));
  }, [dumpsiteSites]);

  const displayTruckPositions = useMemo(() => {
    return activeTruckPositions.map((truck) => {
      if (!demoLagos.enabled) {
        return {
          truck,
          latitude: truck.latitude ?? null,
          longitude: truck.longitude ?? null,
          demo: false as const
        };
      }

      // Demo mode: always use stable Lagos dummies (ignore AU / device GPS / dumpsite stack).
      const demo = demoLagosCoordsForId(truck.truckId, tipAnchors);
      return {
        truck,
        latitude: demo.latitude,
        longitude: demo.longitude,
        demo: true as const
      };
    });
  }, [activeTruckPositions, demoLagos.enabled, tipAnchors]);

  const mappedDisplayTrucks = useMemo(
    () =>
      displayTruckPositions.filter(
        (
          row
        ): row is {
          truck: FleetTruckMapPosition;
          latitude: number;
          longitude: number;
          demo: boolean;
        } => row.latitude != null && row.longitude != null
      ),
    [displayTruckPositions]
  );

  const mapMarkers = useMemo((): FleetMapMarker[] => {
    const sites: FleetMapMarker[] = dumpsiteSites
      .filter((site) => site.active)
      .flatMap((site) => {
        const hasCoords = site.latitude != null && site.longitude != null;
        if (hasCoords && isInNigeria(Number(site.latitude), Number(site.longitude))) {
          return [
            {
              id: `site-${site.id}`,
              latitude: Number(site.latitude),
              longitude: Number(site.longitude),
              kind: "site" as const,
              title: site.name,
              subtitle: site.address ?? undefined
            }
          ];
        }
        if (demoLagos.enabled && (!hasCoords || !isInNigeria(Number(site.latitude), Number(site.longitude)))) {
          const demo = demoLagosCoordsForId(`site-${site.id}`);
          return [
            {
              id: `site-${site.id}`,
              latitude: demo.latitude,
              longitude: demo.longitude,
              kind: "site" as const,
              title: site.name,
              subtitle: site.address
                ? `${site.address} · Lagos demo pin`
                : "Lagos demo pin (no tip coords)",
              demo: true
            }
          ];
        }
        if (hasCoords) {
          return [
            {
              id: `site-${site.id}`,
              latitude: Number(site.latitude),
              longitude: Number(site.longitude),
              kind: "site" as const,
              title: site.name,
              subtitle: site.address ?? undefined
            }
          ];
        }
        return [];
      });

    const trucksOnMap: FleetMapMarker[] = mappedDisplayTrucks.map((row) => ({
      id: `truck-${row.truck.routeId}`,
      latitude: row.latitude,
      longitude: row.longitude,
      kind: "truck" as const,
      title: row.truck.registrationNumber,
      subtitle: row.demo
        ? `${row.truck.zoneName} · Lagos demo location`
        : `${row.truck.zoneName} · ${mapSourceLabel(row.truck.source)}${
            row.truck.label ? ` · ${row.truck.label}` : ""
          }`,
      demo: row.demo
    }));
    return [...sites, ...trucksOnMap];
  }, [demoLagos.enabled, dumpsiteSites, mappedDisplayTrucks, tipAnchors]);

  const siteProximityPairs = useMemo(() => {
    const withCoords = mapMarkers.filter((marker) => marker.kind === "site");
    const pairs: Array<{ from: string; to: string; km: number }> = [];
    for (let i = 0; i < withCoords.length; i += 1) {
      for (let j = i + 1; j < withCoords.length; j += 1) {
        const a = withCoords[i];
        const b = withCoords[j];
        pairs.push({
          from: a.title,
          to: b.title,
          km: haversineKm(a.latitude, a.longitude, b.latitude, b.longitude)
        });
      }
    }
    return pairs.sort((a, b) => a.km - b.km);
  }, [mapMarkers]);

  const truckSiteProximity = useMemo(() => {
    const sites = mapMarkers.filter((marker) => marker.kind === "site");
    return mappedDisplayTrucks
      .map((row) => {
        let nearest: { name: string; km: number } | null = null;
        for (const site of sites) {
          const km = haversineKm(row.latitude, row.longitude, site.latitude, site.longitude);
          if (!nearest || km < nearest.km) {
            nearest = { name: site.title, km };
          }
        }
        return { truck: row.truck, nearest, latitude: row.latitude, longitude: row.longitude, demo: row.demo };
      })
      .sort((a, b) => (a.nearest?.km ?? Number.POSITIVE_INFINITY) - (b.nearest?.km ?? Number.POSITIVE_INFINITY));
  }, [mapMarkers, mappedDisplayTrucks]);

  function handleDemoLagosToggle(enabled: boolean) {
    if (demoLagos.forcedByEnv) {
      return;
    }
    writeFleetDemoLagosPreference(enabled);
    setDemoLagosPreference(enabled);
  }

  async function handleMaintenanceSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!maintenanceForm.truckId || !maintenanceForm.workDone.trim()) {
      setFormError("Select a truck and describe the work done.");
      return;
    }
    const costNaira = Number(maintenanceForm.costNaira.replace(/,/g, ""));
    try {
      await onRecordMaintenance({
        truckId: maintenanceForm.truckId,
        eventDate: maintenanceForm.eventDate || operationDate,
        workDone: maintenanceForm.workDone.trim(),
        workshopName: maintenanceForm.workshopName.trim() || null,
        costKobo: Number.isFinite(costNaira) ? Math.round(costNaira * 100) : 0
      });
      setMaintenanceForm({
        truckId: "",
        eventDate: operationDate,
        workDone: "",
        workshopName: "",
        costNaira: ""
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to record maintenance");
    }
  }

  async function handleSiteSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!siteForm.name.trim()) {
      setFormError("Dumpsite name is required.");
      return;
    }
    try {
      await onUpsertDumpsiteSite({
        siteId: siteForm.siteId || null,
        name: siteForm.name.trim(),
        address: siteForm.address.trim() || null,
        latitude: siteForm.latitude ? Number(siteForm.latitude) : null,
        longitude: siteForm.longitude ? Number(siteForm.longitude) : null,
        dailyCapacityTonnes: siteForm.dailyCapacityTonnes
          ? Number(siteForm.dailyCapacityTonnes)
          : null,
        notes: siteForm.notes.trim() || null,
        active: siteForm.active
      });
      setSiteForm({
        siteId: "",
        name: "",
        address: "",
        latitude: "",
        longitude: "",
        dailyCapacityTonnes: "",
        notes: "",
        active: true
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to save dumpsite site");
    }
  }

  function editSite(site: DumpsiteSite) {
    setSiteForm({
      siteId: site.id,
      name: site.name,
      address: site.address ?? "",
      latitude: site.latitude != null ? String(site.latitude) : "",
      longitude: site.longitude != null ? String(site.longitude) : "",
      dailyCapacityTonnes:
        site.dailyCapacityTonnes != null ? String(site.dailyCapacityTonnes) : "",
      notes: site.notes ?? "",
      active: site.active
    });
  }

  return (
    <section className="panel-stack">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Fleet</p>
          <h2>Trucks, fuel, dumpsite &amp; maintenance</h2>
          <p className="panel-subtitle">
            Live truck status, day fuel/dumpsite activity, site registry, and month maintenance for{" "}
            {formatDate(operationDate)}.
          </p>
        </div>
        <button className="secondary-button" disabled={refreshing} onClick={onRefresh} type="button">
          <RefreshCw aria-hidden="true" size={16} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {formError ? <p className="notice error">{formError}</p> : null}

      <div className="metric-grid">
        <article className="metric-card">
          <Truck aria-hidden="true" size={20} />
          <p className="eyebrow">Trucks</p>
          <strong>{metrics?.trucksTotal ?? 0}</strong>
          <span className="metric-helper">
            {metrics?.trucksOperational ?? 0} operational · {metrics?.trucksStandby ?? 0} standby ·{" "}
            {metrics?.trucksWorkshop ?? 0} workshop
            {(metrics?.trucksStartedToday ?? 0) > 0
              ? ` · ${metrics?.trucksMappedToday ?? 0}/${metrics?.trucksStartedToday ?? 0} on map${
                  (metrics?.trucksLiveGpsToday ?? 0) > 0
                    ? ` · ${metrics?.trucksLiveGpsToday} live`
                    : ""
                }`
              : ""}
          </span>
        </article>
        <article className="metric-card">
          <Fuel aria-hidden="true" size={20} />
          <p className="eyebrow">Fuel today</p>
          <strong>{(metrics?.fuelLitresToday ?? 0).toLocaleString("en-NG")} L</strong>
          <span className="metric-helper">{formatNgn(metrics?.fuelSpendKoboToday ?? 0)} spent</span>
        </article>
        <article className="metric-card">
          <MapPin aria-hidden="true" size={20} />
          <p className="eyebrow">Dumpsite</p>
          <strong>{metrics?.dumpsiteInProgress ?? 0}</strong>
          <span className="metric-helper">
            {metrics?.dumpsiteClearedToday ?? 0} cleared · {metrics?.dumpsiteSitesActive ?? 0} sites
          </span>
        </article>
        <article className="metric-card">
          <Wrench aria-hidden="true" size={20} />
          <p className="eyebrow">Maintenance (month)</p>
          <strong>{metrics?.maintenanceEventsThisMonth ?? 0}</strong>
          <span className="metric-helper">
            {formatNgn(metrics?.maintenanceSpendKoboThisMonth ?? 0)} spent
          </span>
        </article>
      </div>

      <div className="coverage-filter-row">
        {(
          [
            ["all", "All trucks"],
            ["operational", "Operational"],
            ["standby", "Standby"],
            ["workshop", "Workshop"],
            ["inactive", "Inactive"]
          ] as const
        ).map(([id, label]) => (
          <button
            className={truckFilter === id ? "chip-button active" : "chip-button"}
            key={id}
            onClick={() => setTruckFilter(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {filteredTrucks.length === 0 ? (
        <article className="empty-panel">
          <Truck aria-hidden="true" size={22} />
          <div>
            <strong>No trucks in this filter</strong>
            <p>Onboard trucks in Admin or switch the status filter.</p>
          </div>
        </article>
      ) : (
        <div className="table-like coverage-list">
          {filteredTrucks.map((truck) => (
            <TruckRow key={truck.id} truck={truck} />
          ))}
        </div>
      )}

      <header className="panel-header">
        <div>
          <p className="eyebrow">Dumpsite</p>
          <h3>Day runs</h3>
        </div>
      </header>

      <div className="coverage-filter-row">
        {(
          [
            ["all", "All phases"],
            ["departed", "Departed"],
            ["arrived", "Arrived"],
            ["cleared", "Cleared"]
          ] as const
        ).map(([id, label]) => (
          <button
            className={dumpsiteFilter === id ? "chip-button active" : "chip-button"}
            key={id}
            onClick={() => setDumpsiteFilter(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {filteredDumpsite.length === 0 ? (
        <article className="empty-panel">
          <MapPin aria-hidden="true" size={22} />
          <div>
            <strong>No dumpsite runs for this day</strong>
            <p>Drivers record depart / arrive / clear on mobile; Refresh after a run starts.</p>
          </div>
        </article>
      ) : (
        <div className="table-like coverage-list">
          {filteredDumpsite.map((run) => (
            <DumpsiteRow key={run.id} run={run} />
          ))}
        </div>
      )}

      <header className="panel-header">
        <div>
          <p className="eyebrow">Fuel</p>
          <h3>Logs today</h3>
        </div>
      </header>

      {fuelLogs.length === 0 ? (
        <article className="empty-panel">
          <Fuel aria-hidden="true" size={22} />
          <div>
            <strong>No fuel logs for this day</strong>
            <p>Driver fuel entries for the selected ops date appear here.</p>
          </div>
        </article>
      ) : (
        <div className="table-like coverage-list">
          {fuelLogs.map((log) => (
            <article className="stack-row coverage-row" key={log.id}>
              <div>
                <div className="coverage-row-head">
                  <strong>{log.truckRegistration}</strong>
                </div>
                <p>
                  {log.driverName} · {log.stationName}
                </p>
              </div>
              <div>
                <p className="eyebrow">Litres</p>
                <strong>{log.litres.toLocaleString("en-NG")}</strong>
                <p>{formatNgn(log.costKobo)}</p>
              </div>
              <div>
                <p className="eyebrow">Logged</p>
                <strong>{formatTime(log.loggedAt)}</strong>
              </div>
            </article>
          ))}
        </div>
      )}

      <header className="panel-header">
        <div>
          <p className="eyebrow">Maintenance</p>
          <h3>Calendar month</h3>
          <p className="panel-subtitle">Events for the month of the selected ops date.</p>
        </div>
        <CalendarDays aria-hidden="true" />
      </header>

      <form className="entry-card admin-form" onSubmit={(event) => void handleMaintenanceSubmit(event)}>
        <label>
          Truck
          <select
            required
            value={maintenanceForm.truckId}
            onChange={(event) =>
              setMaintenanceForm((current) => ({ ...current, truckId: event.target.value }))
            }
          >
            <option value="">Select truck</option>
            {trucks
              .filter((truck) => truck.active)
              .map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.registrationNumber}
                </option>
              ))}
          </select>
        </label>
        <label>
          Event date
          <input
            required
            type="date"
            value={maintenanceForm.eventDate}
            onChange={(event) =>
              setMaintenanceForm((current) => ({ ...current, eventDate: event.target.value }))
            }
          />
        </label>
        <label className="admin-form-full">
          Work done
          <input
            required
            value={maintenanceForm.workDone}
            onChange={(event) =>
              setMaintenanceForm((current) => ({ ...current, workDone: event.target.value }))
            }
            placeholder="Brake pads, oil change…"
          />
        </label>
        <label>
          Workshop
          <input
            value={maintenanceForm.workshopName}
            onChange={(event) =>
              setMaintenanceForm((current) => ({ ...current, workshopName: event.target.value }))
            }
            placeholder="Optional"
          />
        </label>
        <label>
          Cost (NGN)
          <input
            inputMode="decimal"
            value={maintenanceForm.costNaira}
            onChange={(event) =>
              setMaintenanceForm((current) => ({ ...current, costNaira: event.target.value }))
            }
            placeholder="0"
          />
        </label>
        <button className="primary-button" disabled={saving} type="submit">
          <Plus aria-hidden="true" size={16} />
          {saving ? "Saving..." : "Record maintenance"}
        </button>
      </form>

      {maintenanceEvents.length === 0 ? (
        <article className="empty-panel">
          <Wrench aria-hidden="true" size={22} />
          <div>
            <strong>No maintenance events this month</strong>
            <p>Record workshop visits to keep reserve remaining accurate.</p>
          </div>
        </article>
      ) : (
        <div className="table-like coverage-list">
          {maintenanceEvents.map((eventItem) => (
            <article className="stack-row coverage-row" key={eventItem.id}>
              <div>
                <div className="coverage-row-head">
                  <strong>{eventItem.truckRegistration}</strong>
                </div>
                <p>{eventItem.workDone}</p>
              </div>
              <div>
                <p className="eyebrow">Date</p>
                <strong>{formatDate(eventItem.eventDate)}</strong>
                <p>{eventItem.workshopName || "Workshop unset"}</p>
              </div>
              <div>
                <p className="eyebrow">Cost</p>
                <strong>{formatNgn(eventItem.costKobo)}</strong>
              </div>
            </article>
          ))}
        </div>
      )}

      <header className="panel-header">
        <div>
          <p className="eyebrow">Dumpsite registry</p>
          <h3>Sites &amp; proximity</h3>
          <p className="panel-subtitle">
            Interactive map: green tip sites and amber started trucks. Production pins use last stop
            GPS → dumpsite → planned stop (not continuous tracking). Use Lagos demo pins when
            developing from outside Nigeria so AU device GPS does not pull trucks off the map.
          </p>
        </div>
        <MapPin aria-hidden="true" />
      </header>

      <label className="checkbox-row fleet-demo-lagos-toggle">
        <input
          checked={demoLagos.enabled}
          disabled={demoLagos.forcedByEnv}
          onChange={(event) => handleDemoLagosToggle(event.target.checked)}
          type="checkbox"
        />
        <span>
          Use Lagos demo locations
          {demoLagos.forcedByEnv
            ? " (locked by VITE_FLEET_DEMO_LAGOS_PINS)"
            : demoLagos.enabled
              ? " — stable dummy coords near tip sites; ignores AU / missing GPS"
              : " — show real snapshot GPS when available"}
        </span>
      </label>

      {mapMarkers.length > 0 ? (
        <FleetMap demoMode={demoLagos.enabled} markers={mapMarkers} />
      ) : (
        <article className="empty-panel">
          <MapPin aria-hidden="true" size={22} />
          <div>
            <strong>No map pins yet</strong>
            <p>
              Add latitude/longitude on a tip site, or start a ward route. With Lagos demo mode on,
              started trucks appear on the Lagos map even without stop GPS.
            </p>
          </div>
        </article>
      )}

      {activeTruckPositions.length > 0 ? (
        <div className="table-like coverage-list fleet-truck-map-list">
          {activeTruckPositions.map((truck) => {
            const proximity = truckSiteProximity.find((row) => row.truck.truckId === truck.truckId);
            const display = displayTruckPositions.find((row) => row.truck.routeId === truck.routeId);
            const mapped = display?.latitude != null && display?.longitude != null;
            return (
              <article className="stack-row coverage-row" key={truck.routeId}>
                <div>
                  <div className="coverage-row-head">
                    <strong>{truck.registrationNumber}</strong>
                    <span className={display?.demo ? "pill warn" : mapped ? "pill" : "pill warn"}>
                      {display?.demo ? "Lagos demo" : mapSourceLabel(truck.source)}
                    </span>
                  </div>
                  <p>
                    {truck.zoneName} · started {formatTime(truck.startedAt)} ·{" "}
                    {truck.completedStops}/{truck.totalStops} stops
                  </p>
                  <p className="muted">
                    {display?.demo
                      ? "Demo pin in Lagos (device GPS ignored for map display)"
                      : truck.label
                        ? mapped
                          ? `Pin near ${truck.label}`
                          : truck.label
                        : mapped
                          ? "Mapped from route data"
                          : "No GPS or planned stop coordinates yet"}
                  </p>
                </div>
                <div>
                  <p className="eyebrow">Nearest tip</p>
                  <strong>
                    {proximity?.nearest
                      ? `${proximity.nearest.name} · ${proximity.nearest.km.toFixed(1)} km`
                      : "—"}
                  </strong>
                  <p>
                    {mapped
                      ? `${Number(display?.latitude).toFixed(4)}, ${Number(display?.longitude).toFixed(4)}`
                      : "Not on map"}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="muted coverage-footnote">
          No started ward trucks today. When drivers start a route, proximity appears here.
        </p>
      )}

      {truckSiteProximity.length > 0 || siteProximityPairs.length > 0 ? (
        <p className="muted coverage-footnote">
          {truckSiteProximity.length > 0
            ? `Truck→site: ${truckSiteProximity
                .slice(0, 3)
                .map(({ truck, nearest }) =>
                  nearest
                    ? `${truck.registrationNumber} → ${nearest.name} (${nearest.km.toFixed(1)} km)`
                    : `${truck.registrationNumber} (no tip coords)`
                )
                .join(" · ")}`
            : null}
          {truckSiteProximity.length > 0 && siteProximityPairs.length > 0 ? " · " : null}
          {siteProximityPairs.length > 0
            ? `Sites: ${siteProximityPairs
                .slice(0, 2)
                .map((pair) => `${pair.from} ↔ ${pair.to} (${pair.km.toFixed(1)} km)`)
                .join(" · ")}`
            : null}
        </p>
      ) : null}

      <form className="entry-card admin-form" onSubmit={(event) => void handleSiteSubmit(event)}>
        <label>
          Site name
          <input
            required
            value={siteForm.name}
            onChange={(event) => setSiteForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Olusosun landfill"
          />
        </label>
        <label>
          Address
          <input
            value={siteForm.address}
            onChange={(event) => setSiteForm((current) => ({ ...current, address: event.target.value }))}
            placeholder="Ojota, Lagos"
          />
        </label>
        <label>
          Latitude
          <input
            inputMode="decimal"
            value={siteForm.latitude}
            onChange={(event) => setSiteForm((current) => ({ ...current, latitude: event.target.value }))}
            placeholder="6.5912"
          />
        </label>
        <label>
          Longitude
          <input
            inputMode="decimal"
            value={siteForm.longitude}
            onChange={(event) => setSiteForm((current) => ({ ...current, longitude: event.target.value }))}
            placeholder="3.3792"
          />
        </label>
        <label>
          Daily capacity (t)
          <input
            inputMode="decimal"
            value={siteForm.dailyCapacityTonnes}
            onChange={(event) =>
              setSiteForm((current) => ({ ...current, dailyCapacityTonnes: event.target.value }))
            }
          />
        </label>
        <label>
          Notes
          <input
            value={siteForm.notes}
            onChange={(event) => setSiteForm((current) => ({ ...current, notes: event.target.value }))}
          />
        </label>
        <label className="checkbox-row admin-form-full">
          <input
            checked={siteForm.active}
            onChange={(event) => setSiteForm((current) => ({ ...current, active: event.target.checked }))}
            type="checkbox"
          />
          Active
        </label>
        <button className="primary-button" disabled={saving} type="submit">
          <Plus aria-hidden="true" size={16} />
          {saving ? "Saving..." : siteForm.siteId ? "Update site" : "Add site"}
        </button>
      </form>

      {dumpsiteSites.length === 0 ? (
        <article className="empty-panel">
          <MapPin aria-hidden="true" size={22} />
          <div>
            <strong>No dumpsite sites</strong>
            <p>Add tip sites so drivers and operators share the same registry names.</p>
          </div>
        </article>
      ) : (
        <div className="table-like coverage-list">
          {dumpsiteSites.map((site) => (
            <article className="stack-row coverage-row" key={site.id}>
              <div>
                <div className="coverage-row-head">
                  <strong>{site.name}</strong>
                  <span className={site.active ? "pill" : "pill danger"}>
                    {site.active ? "active" : "inactive"}
                  </span>
                </div>
                <p>{site.address || "Address unset"}</p>
              </div>
              <div>
                <p className="eyebrow">Capacity</p>
                <strong>
                  {site.dailyCapacityTonnes != null
                    ? `${site.dailyCapacityTonnes.toLocaleString("en-NG")} t/day`
                    : "—"}
                </strong>
                <p>
                  {site.latitude != null && site.longitude != null
                    ? `${site.latitude}, ${site.longitude}`
                    : "No coordinates"}
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button className="secondary-button" onClick={() => editSite(site)} type="button">
                  Edit
                </button>
                {site.latitude != null && site.longitude != null ? (
                  <a
                    className="secondary-button"
                    href={`https://www.openstreetmap.org/?mlat=${site.latitude}&mlon=${site.longitude}#map=14/${site.latitude}/${site.longitude}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink aria-hidden="true" size={14} />
                    Map
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="muted coverage-footnote">
        <Truck aria-hidden="true" size={14} /> Truck CRUD remains in Admin. Started trucks prefer{" "}
        <strong>live driver GPS</strong> (fresh ≤15 min), then stop proofs, tip sites, or planned
        stops. Click a pin for source detail; stacked locations are spread slightly. Use Lagos demo
        mode when testing from outside Nigeria.
      </p>
    </section>
  );
}

function TruckRow({ truck }: { truck: FleetTruckItem }) {
  return (
    <article className="stack-row coverage-row">
      <div>
        <div className="coverage-row-head">
          <strong>{truck.registrationNumber}</strong>
          <span className={truckStatusClass(truck.status, truck.active)}>
            {truck.active ? truck.status : "inactive"}
          </span>
        </div>
        <p>{truck.zoneName}</p>
      </div>
      <div>
        <p className="eyebrow">Reserve remaining</p>
        <strong>{formatNgn(truck.reserveRemainingKobo)}</strong>
        <p>Monthly maintenance reserve</p>
      </div>
    </article>
  );
}

function DumpsiteRow({ run }: { run: FleetDumpsiteRunItem }) {
  return (
    <article className="stack-row coverage-row">
      <div>
        <div className="coverage-row-head">
          <strong>
            {run.zoneName} · {run.truckRegistration}
          </strong>
          <span className={phaseClass(run.phase)}>{phaseLabel(run.phase)}</span>
        </div>
        <p>{run.driverName}</p>
      </div>
      <div>
        <p className="eyebrow">Times</p>
        <strong>
          {formatTime(run.departedAt)} → {formatTime(run.arrivedAt)} → {formatTime(run.clearedAt)}
        </strong>
        <p>
          {run.dumpsiteSiteName || "Site unset"}
          {run.docketNumber ? ` · #${run.docketNumber}` : ""}
        </p>
      </div>
      <div>
        <p className="eyebrow">Ticket</p>
        <strong>
          {run.weighbridgeTonnes != null
            ? `${run.weighbridgeTonnes.toLocaleString("en-NG")} t`
            : "—"}
        </strong>
        <p>{formatNgn(run.tippingFeeKobo)}</p>
      </div>
    </article>
  );
}
