import type {
  ProposeRouteTruckHandoffInput,
  RouteDetail,
  RoutePlanningOptions,
  RouteReassignmentKind,
  RouteTruckHandoff,
  RouteTruckHandoffReason,
  RouteTruckHandoffSourceOutcome
} from "@cleanops/shared";
import { routeReassignmentKinds, routeTruckHandoffReasons } from "@cleanops/shared";
import { useEffect, useMemo, useState } from "react";

const reasonLabels: Record<RouteTruckHandoffReason, string> = {
  breakdown: "Truck breakdown",
  dumpsite_delay: "Dumpsite delay",
  unable_to_start: "Unable to start",
  cross_route_support: "Cross-route support",
  driver_sick: "Driver called in sick",
  driver_unavailable: "Driver unable to continue",
  other: "Other"
};

const kindLabels: Record<RouteReassignmentKind, string> = {
  driver: "Driver cover",
  truck: "Truck swap",
  both: "Truck + driver"
};

const statusLabels: Record<RouteTruckHandoff["status"], string> = {
  awaiting_confirmation: "Awaiting confirmation",
  confirmed: "Confirmed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  expired: "Expired"
};

const reasonsForKind: Record<RouteReassignmentKind, RouteTruckHandoffReason[]> = {
  driver: ["driver_sick", "driver_unavailable", "unable_to_start", "other"],
  truck: ["breakdown", "dumpsite_delay", "unable_to_start", "cross_route_support", "other"],
  both: [...routeTruckHandoffReasons]
};

export default function TruckHandoffPanel({
  routes,
  selectedRoute,
  planningOptions,
  handoffs,
  onPropose,
  onCancel
}: {
  routes: RouteDetail[];
  selectedRoute: RouteDetail;
  planningOptions: RoutePlanningOptions;
  handoffs: RouteTruckHandoff[];
  onPropose: (input: ProposeRouteTruckHandoffInput) => Promise<void>;
  onCancel: (handoffId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [changeKind, setChangeKind] = useState<RouteReassignmentKind>("driver");
  const [toTruckId, setToTruckId] = useState("");
  const [toDriverId, setToDriverId] = useState("");
  const [reason, setReason] = useState<RouteTruckHandoffReason>("driver_sick");
  const [notes, setNotes] = useState("");
  const [sourceOutcome, setSourceOutcome] = useState<RouteTruckHandoffSourceOutcome>("leave_unassigned");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const routeHandoffs = useMemo(
    () => handoffs.filter((handoff) => handoff.routeId === selectedRoute.id),
    [handoffs, selectedRoute.id]
  );
  const pendingHandoff = routeHandoffs.find((handoff) => handoff.status === "awaiting_confirmation");
  const canReassign =
    selectedRoute.status === "scheduled" || selectedRoute.status === "in_progress";

  const occupyingRoute = useMemo(() => {
    if (!toTruckId || changeKind === "driver") {
      return null;
    }

    return (
      routes.find(
        (route) =>
          route.id !== selectedRoute.id &&
          route.truckId === toTruckId &&
          route.status !== "completed" &&
          route.status !== "cancelled"
      ) ?? null
    );
  }, [routes, selectedRoute.id, toTruckId, changeKind]);

  const replacementTrucks = useMemo(() => {
    return [...planningOptions.trucks].sort((a, b) => {
      const aStandby = a.helper?.toLowerCase().includes("standby") ? 0 : 1;
      const bStandby = b.helper?.toLowerCase().includes("standby") ? 0 : 1;
      if (aStandby !== bStandby) {
        return aStandby - bStandby;
      }
      return a.label.localeCompare(b.label);
    });
  }, [planningOptions.trucks]);

  const availableDrivers = useMemo(() => {
    const busyDriverIds = new Set(
      routes
        .filter(
          (route) =>
            route.id !== selectedRoute.id &&
            route.status !== "completed" &&
            route.status !== "cancelled" &&
            route.driverId
        )
        .map((route) => route.driverId as string)
    );

    return planningOptions.drivers.filter((driver) => {
      if (changeKind !== "truck" && driver.id === selectedRoute.driverId) {
        return false;
      }
      return !busyDriverIds.has(driver.id) || driver.id === selectedRoute.driverId;
    });
  }, [planningOptions.drivers, routes, selectedRoute.id, selectedRoute.driverId, changeKind]);

  useEffect(() => {
    setToDriverId(changeKind === "truck" ? selectedRoute.driverId ?? "" : "");
    setToTruckId(changeKind === "driver" ? selectedRoute.truckId ?? "" : "");
    setReason(reasonsForKind[changeKind][0]);
    setNotes("");
    setError(null);
  }, [changeKind, selectedRoute.id, selectedRoute.driverId, selectedRoute.truckId]);

  useEffect(() => {
    setOpen(false);
    setChangeKind("driver");
    setError(null);
  }, [selectedRoute.id]);

  async function submit() {
    if (!toDriverId) {
      setError("Choose the driver who will take this route.");
      return;
    }

    if (changeKind !== "driver" && !toTruckId) {
      setError("Choose a replacement truck.");
      return;
    }

    if (changeKind === "driver" && !selectedRoute.truckId) {
      setError("This route has no truck — use Truck + driver reassignment.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await onPropose({
        routeId: selectedRoute.id,
        changeKind,
        toTruckId: changeKind === "driver" ? selectedRoute.truckId ?? undefined : toTruckId,
        toDriverId,
        reason,
        notes: notes.trim() || undefined,
        sourceRouteId: occupyingRoute?.id,
        sourceOutcome: occupyingRoute ? sourceOutcome : undefined
      });
      setOpen(false);
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to propose reassignment.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!canReassign) {
    return null;
  }

  function summarize(handoff: RouteTruckHandoff) {
    const kind = handoff.changeKind ?? "both";
    if (kind === "driver") {
      return `${handoff.fromDriverName ?? "Unassigned"} → ${handoff.toDriverName} · same truck ${handoff.toTruckRegistration}`;
    }
    if (kind === "truck") {
      return `${handoff.fromTruckRegistration ?? "No truck"} → ${handoff.toTruckRegistration} · driver ${handoff.toDriverName}`;
    }
    return `${handoff.fromTruckRegistration ?? "—"} → ${handoff.toTruckRegistration} · ${handoff.fromDriverName ?? "—"} → ${handoff.toDriverName}`;
  }

  return (
    <div className="planner-panel handoff-panel">
      <div>
        <h3>Route reassignment</h3>
        <p>
          Cover a sick or unavailable driver, swap a broken truck, or change both. Drivers confirm before the route
          assignment updates — one pending reassignment per route.
        </p>
      </div>

      {pendingHandoff ? (
        <div className="handoff-pending-card">
          <strong>
            {statusLabels[pendingHandoff.status]} · {kindLabels[pendingHandoff.changeKind ?? "both"]}
          </strong>
          <span>{summarize(pendingHandoff)}</span>
          <span>
            Reason: {reasonLabels[pendingHandoff.reason]}
            {pendingHandoff.requiresOutgoingConfirmation
              ? ` · Incoming ${pendingHandoff.incomingConfirmed ? "confirmed" : "pending"}, outgoing ${
                  pendingHandoff.outgoingConfirmed ? "confirmed" : "pending"
                }`
              : ` · Incoming ${pendingHandoff.incomingConfirmed ? "confirmed" : "pending"}`}
          </span>
          <span>Expires {new Date(pendingHandoff.expiresAt).toLocaleTimeString()}</span>
          <button
            disabled={submitting}
            onClick={() => {
              void (async () => {
                setSubmitting(true);
                setError(null);
                try {
                  await onCancel(pendingHandoff.id);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Unable to cancel reassignment.");
                } finally {
                  setSubmitting(false);
                }
              })();
            }}
            type="button"
          >
            Cancel reassignment
          </button>
        </div>
      ) : (
        <>
          <button className="secondary-button" onClick={() => setOpen((current) => !current)} type="button">
            {open ? "Hide reassignment form" : "Start reassignment"}
          </button>

          {open ? (
            <div className="planner-grid handoff-form">
              <fieldset className="reassignment-kind-field">
                <legend>What needs to change?</legend>
                <div className="reassignment-kind-row">
                  {routeReassignmentKinds.map((kind) => (
                    <button
                      className={changeKind === kind ? "kind-chip active" : "kind-chip"}
                      key={kind}
                      onClick={() => setChangeKind(kind)}
                      type="button"
                    >
                      {kindLabels[kind]}
                    </button>
                  ))}
                </div>
              </fieldset>

              {changeKind !== "driver" ? (
                <label>
                  {changeKind === "truck" ? "Replacement truck" : "Truck after reassignment"}
                  <select onChange={(event) => setToTruckId(event.target.value)} value={toTruckId}>
                    <option value="">Select truck</option>
                    {replacementTrucks
                      .filter((truck) => truck.id !== selectedRoute.truckId)
                      .map((truck) => (
                        <option key={truck.id} value={truck.id}>
                          {truck.label}
                          {truck.helper ? ` — ${truck.helper}` : ""}
                        </option>
                      ))}
                  </select>
                </label>
              ) : (
                <p className="panel-subtitle">
                  Truck stays <strong>{selectedRoute.truckRegistration}</strong>. Only the driver changes.
                </p>
              )}

              <label>
                {changeKind === "truck" ? "Driver after swap (can stay the same)" : "Cover / incoming driver"}
                <select onChange={(event) => setToDriverId(event.target.value)} value={toDriverId}>
                  <option value="">Select driver</option>
                  {(changeKind === "truck"
                    ? planningOptions.drivers
                    : availableDrivers
                  ).map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.label}
                      {driver.id === selectedRoute.driverId ? " (current)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Reason
                <select
                  onChange={(event) => setReason(event.target.value as RouteTruckHandoffReason)}
                  value={reason}
                >
                  {reasonsForKind[changeKind].map((value) => (
                    <option key={value} value={value}>
                      {reasonLabels[value]}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Notes (optional)
                <input
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={
                    changeKind === "driver"
                      ? "Called in sick, family emergency..."
                      : "Stuck at Olusosun, axle issue..."
                  }
                  type="text"
                  value={notes}
                />
              </label>

              {occupyingRoute ? (
                <div className="handoff-borrow-note">
                  <p>
                    <strong>{replacementTrucks.find((truck) => truck.id === toTruckId)?.label}</strong> is on{" "}
                    <strong>{occupyingRoute.zoneName}</strong> ({occupyingRoute.status.replace("_", " ")}). Borrowing
                    requires a source-route outcome.
                  </p>
                  <label>
                    Source route outcome
                    <select
                      onChange={(event) =>
                        setSourceOutcome(event.target.value as RouteTruckHandoffSourceOutcome)
                      }
                      value={sourceOutcome}
                    >
                      <option value="leave_unassigned">Leave source route without a truck</option>
                      <option value="cancel_route">Cancel source route</option>
                    </select>
                  </label>
                </div>
              ) : null}

              {error ? <p className="inline-error">{error}</p> : null}

              <button
                className="primary-button"
                disabled={submitting}
                onClick={() => void submit()}
                type="button"
              >
                {submitting ? "Submitting..." : "Send for driver confirmation"}
              </button>
            </div>
          ) : null}
        </>
      )}

      {routeHandoffs.length > 0 ? (
        <div className="handoff-history">
          <h4>Reassignment history</h4>
          {routeHandoffs.slice(0, 5).map((handoff) => (
            <div className="ledger-row" key={handoff.id}>
              <div>
                <strong>
                  {statusLabels[handoff.status]} · {kindLabels[handoff.changeKind ?? "both"]}
                </strong>
                <span>
                  {summarize(handoff)} · {reasonLabels[handoff.reason]}
                </span>
              </div>
              <span>{new Date(handoff.createdAt).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      ) : null}

      {error && pendingHandoff ? <p className="inline-error">{error}</p> : null}
    </div>
  );
}
