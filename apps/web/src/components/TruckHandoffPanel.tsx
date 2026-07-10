import type {
  ProposeRouteTruckHandoffInput,
  RouteDetail,
  RoutePlanningOptions,
  RouteTruckHandoff,
  RouteTruckHandoffReason,
  RouteTruckHandoffSourceOutcome
} from "@cleanops/shared";
import { routeTruckHandoffReasons } from "@cleanops/shared";
import { useEffect, useMemo, useState } from "react";

const reasonLabels: Record<RouteTruckHandoffReason, string> = {
  breakdown: "Breakdown",
  dumpsite_delay: "Dumpsite delay",
  unable_to_start: "Unable to start",
  cross_route_support: "Cross-route support",
  other: "Other"
};

const statusLabels: Record<RouteTruckHandoff["status"], string> = {
  awaiting_confirmation: "Awaiting confirmation",
  confirmed: "Confirmed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  expired: "Expired"
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
  const [toTruckId, setToTruckId] = useState("");
  const [toDriverId, setToDriverId] = useState(selectedRoute.driverId ?? "");
  const [reason, setReason] = useState<RouteTruckHandoffReason>("breakdown");
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
    if (!toTruckId) {
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
  }, [routes, selectedRoute.id, toTruckId]);

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

  useEffect(() => {
    setToDriverId(selectedRoute.driverId ?? "");
    setToTruckId("");
    setNotes("");
    setError(null);
    setOpen(false);
  }, [selectedRoute.id, selectedRoute.driverId]);

  async function submit() {
    if (!toTruckId || !toDriverId) {
      setError("Choose a replacement truck and driver.");
      return;
    }

    if (toTruckId === selectedRoute.truckId) {
      setError("Choose a different truck than the one currently assigned.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await onPropose({
        routeId: selectedRoute.id,
        toTruckId,
        toDriverId,
        reason,
        notes: notes.trim() || undefined,
        sourceRouteId: occupyingRoute?.id,
        sourceOutcome: occupyingRoute ? sourceOutcome : undefined
      });
      setOpen(false);
      setToTruckId("");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to propose truck handoff.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!canReassign) {
    return null;
  }

  return (
    <div className="planner-panel handoff-panel">
      <div>
        <h3>Truck reassignment</h3>
        <p>
          Propose a takeover for breakdowns, dumpsite delays, or trucks that cannot start. Drivers must confirm before
          the assignment changes.
        </p>
      </div>

      {pendingHandoff ? (
        <div className="handoff-pending-card">
          <strong>{statusLabels[pendingHandoff.status]}</strong>
          <span>
            {pendingHandoff.fromTruckRegistration ?? "No truck"} → {pendingHandoff.toTruckRegistration}
            {" · "}
            {pendingHandoff.toDriverName}
          </span>
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
                  setError(err instanceof Error ? err.message : "Unable to cancel handoff.");
                } finally {
                  setSubmitting(false);
                }
              })();
            }}
            type="button"
          >
            Cancel handoff
          </button>
        </div>
      ) : (
        <>
          <button className="secondary-button" onClick={() => setOpen((current) => !current)} type="button">
            {open ? "Hide reassignment form" : "Reassign truck"}
          </button>

          {open ? (
            <div className="planner-grid handoff-form">
              <label>
                Replacement truck
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

              <label>
                Driver after handoff
                <select onChange={(event) => setToDriverId(event.target.value)} value={toDriverId}>
                  <option value="">Select driver</option>
                  {planningOptions.drivers.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.label}
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
                  {routeTruckHandoffReasons.map((value) => (
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
                  placeholder="Stuck at Olusosun, axle issue..."
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
          <h4>Handoff history</h4>
          {routeHandoffs.slice(0, 5).map((handoff) => (
            <div className="ledger-row" key={handoff.id}>
              <div>
                <strong>{statusLabels[handoff.status]}</strong>
                <span>
                  {handoff.fromTruckRegistration ?? "—"} → {handoff.toTruckRegistration} ·{" "}
                  {reasonLabels[handoff.reason]}
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
