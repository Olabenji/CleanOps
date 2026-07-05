import { useEffect, useState } from "react";
import type { OperatorAgentCollectionAgent, OperatorAgentCollectionsSnapshot, PaymentChannel } from "@cleanops/shared";
import { getOperatorAgentCollections } from "../data/operatorWorkflowService";

const channelLabels: Record<PaymentChannel, string> = {
  agent_cash: "Agent cash",
  bank_transfer: "Bank transfer",
  moniepoint: "Moniepoint",
  opay: "OPay",
  palmpay: "PalmPay",
  paystack: "Paystack"
};

function formatKobo(amountKobo: number) {
  return new Intl.NumberFormat("en-NG", {
    currency: "NGN",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(amountKobo / 100);
}

function formatPaymentDate(paidAt: string) {
  return new Date(paidAt).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export default function AgentCollectionsView({ collectionDate }: { collectionDate: string }) {
  const [snapshot, setSnapshot] = useState<OperatorAgentCollectionsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const nextSnapshot = await getOperatorAgentCollections(collectionDate);
        if (cancelled) {
          return;
        }

        setSnapshot(nextSnapshot);
        setSelectedAgentId((current) => {
          if (current && nextSnapshot.agents.some((agent) => agent.agentStaffId === current)) {
            return current;
          }

          return nextSnapshot.agents[0]?.agentStaffId ?? null;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load agent collections");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [collectionDate]);

  const selectedAgent: OperatorAgentCollectionAgent | undefined = snapshot?.agents.find(
    (agent) => agent.agentStaffId === selectedAgentId
  );

  if (loading) {
    return (
      <section className="workflow-grid payment-workflow">
        <article className="panel">
          <p>Loading agent collections…</p>
        </article>
      </section>
    );
  }

  if (error) {
    return (
      <section className="workflow-grid payment-workflow">
        <article className="panel">
          <p className="inline-error">{error}</p>
        </article>
      </section>
    );
  }

  if (!snapshot) {
    return null;
  }

  return (
    <section className="workflow-grid payment-workflow">
      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Field collections</p>
            <h2>Agent reconciliation</h2>
            <p className="panel-subtitle">
              {formatKobo(snapshot.totalCollectedKobo)} collected · {snapshot.paymentCount} payment
              {snapshot.paymentCount === 1 ? "" : "s"} on {collectionDate}
            </p>
          </div>
        </div>

        {snapshot.agents.length === 0 ? (
          <p>No collection agents are configured for this operator.</p>
        ) : (
          <div className="stack-list">
            {snapshot.agents.map((agent) => (
              <button
                className={`route-selector ${selectedAgentId === agent.agentStaffId ? "active" : ""}`}
                key={agent.agentStaffId}
                onClick={() => setSelectedAgentId(agent.agentStaffId)}
                type="button"
              >
                <strong>{agent.agentName}</strong>
                <span>
                  {formatKobo(agent.totalCollectedKobo)} · {agent.paymentCount} payment
                  {agent.paymentCount === 1 ? "" : "s"}
                </span>
                {agent.paymentCount === 0 ? <span className="pill">No collections today</span> : null}
              </button>
            ))}
          </div>
        )}
      </article>

      <article className="panel payment-detail-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Agent detail</p>
            <h2>{selectedAgent?.agentName ?? "No agent selected"}</h2>
            {selectedAgent ? (
              <p className="panel-subtitle">
                {formatKobo(selectedAgent.totalCollectedKobo)} collected on {collectionDate}
              </p>
            ) : null}
          </div>
        </div>

        {selectedAgent ? (
          selectedAgent.payments.length === 0 ? (
            <p>No field payments recorded for this agent on {collectionDate}.</p>
          ) : (
            <div className="table-like payment-history">
              <h3>Payments collected</h3>
              {selectedAgent.payments.map((payment) => (
                <div className="ledger-row" key={payment.paymentId}>
                  <div>
                    <strong>{payment.customerName}</strong>
                    <span>{formatPaymentDate(payment.paidAt)}</span>
                    {payment.receiptReference ? (
                      <span className="suspension-note">Ref: {payment.receiptReference}</span>
                    ) : null}
                  </div>
                  <span>{channelLabels[payment.channel]}</span>
                  <strong>{formatKobo(payment.amountKobo)}</strong>
                </div>
              ))}
            </div>
          )
        ) : (
          <p>Select an agent to review their collections.</p>
        )}
      </article>
    </section>
  );
}
