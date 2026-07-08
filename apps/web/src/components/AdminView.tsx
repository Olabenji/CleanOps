import type {
  AdminMasterData,
  CustomerLedgerItem,
  CustomerOnboardingInput,
  CustomerType,
  StaffLoginProvisionInput,
  StaffOnboardingInput,
  StaffOnboardingResult,
  TruckOnboardingInput,
  TruckStatus,
  UserRole
} from "@cleanops/shared";
import { Truck, Users, WalletCards } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import AdminModal from "./AdminModal";
import {
  filterAdminCustomers,
  filterAdminStaff,
  filterAdminTrucks,
  type CustomerAdminFilters,
  type StaffAdminFilters,
  type TruckAdminFilters
} from "../lib/adminFilters";

type AdminSection = "staff" | "trucks" | "customers";
type AdminModalKind = "staff" | "truck" | "customer";

const adminSections: Array<{ id: AdminSection; label: string }> = [
  { id: "staff", label: "Drivers & Staff" },
  { id: "trucks", label: "Trucks" },
  { id: "customers", label: "Customers" }
];

const adminStaffRoles: UserRole[] = ["driver", "collection_agent", "operations_supervisor"];
const staffRolesWithLogin = new Set<UserRole>(adminStaffRoles);
const adminCustomerTypes: CustomerType[] = ["residential", "small_business", "restaurant", "estate"];
const adminTruckStatuses: TruckStatus[] = ["operational", "standby", "workshop"];

function suggestStaffLoginEmail(fullName: string) {
  const slug = fullName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  return slug ? `${slug}@cleanops.local` : "";
}

function formatKobo(amountKobo: number) {
  return `₦${(amountKobo / 100).toLocaleString("en-NG")}`;
}

function AdminFilterToolbar({
  children,
  resultCount,
  totalCount
}: {
  children: ReactNode;
  resultCount: number;
  totalCount: number;
}) {
  return (
    <div className="admin-toolbar">
      <div className="admin-toolbar-filters">{children}</div>
      <span className="admin-result-count">
        Showing {resultCount} of {totalCount}
      </span>
    </div>
  );
}

export default function AdminView({
  adminData,
  onOnboardCustomer,
  onOnboardStaff,
  onOnboardTruck,
  onProvisionStaffLogin,
  onRequestStaffPasswordReset,
  onSetCustomerServiceStatus,
  onSetStaffActive,
  onSetTruckActive
}: {
  adminData: AdminMasterData;
  onOnboardCustomer: (input: CustomerOnboardingInput) => Promise<void>;
  onOnboardStaff: (input: StaffOnboardingInput) => Promise<StaffOnboardingResult>;
  onOnboardTruck: (input: TruckOnboardingInput) => Promise<void>;
  onProvisionStaffLogin: (input: StaffLoginProvisionInput) => Promise<StaffOnboardingResult>;
  onRequestStaffPasswordReset: (staffId: string) => Promise<{ sent: true; loginEmail: string; staffName: string }>;
  onSetCustomerServiceStatus: (customerId: string, serviceStatus: CustomerLedgerItem["serviceStatus"]) => Promise<void>;
  onSetStaffActive: (staffId: string, active: boolean) => Promise<void>;
  onSetTruckActive: (truckId: string, active: boolean) => Promise<void>;
}) {
  const defaultZoneId = adminData.zones[0]?.id ?? "";
  const [activeAdminSection, setActiveAdminSection] = useState<AdminSection>("staff");
  const [activeModal, setActiveModal] = useState<AdminModalKind | null>(null);
  const [staffForm, setStaffForm] = useState({
    fullName: "",
    monthlySalaryNaira: "",
    phone: "",
    role: "driver" as UserRole,
    loginEmail: "",
    provisionLogin: true
  });
  const [staffCredentials, setStaffCredentials] = useState<StaffOnboardingResult | null>(null);
  const [provisionStaffId, setProvisionStaffId] = useState<string | null>(null);
  const [provisionEmail, setProvisionEmail] = useState("");
  const [provisionFormError, setProvisionFormError] = useState<string | null>(null);
  const [staffLoginActionErrors, setStaffLoginActionErrors] = useState<Record<string, string>>({});
  const [truckForm, setTruckForm] = useState({
    make: "",
    model: "",
    registrationNumber: "",
    status: "operational" as TruckStatus,
    year: "",
    zoneId: defaultZoneId
  });
  const [customerForm, setCustomerForm] = useState({
    address: "",
    customerType: "residential" as CustomerType,
    displayName: "",
    monthlyRateNaira: "",
    phone: "",
    serviceStatus: "active" as CustomerLedgerItem["serviceStatus"],
    zoneId: defaultZoneId
  });
  const [staffFilters, setStaffFilters] = useState<StaffAdminFilters>({
    query: "",
    role: "",
    active: ""
  });
  const [truckFilters, setTruckFilters] = useState<TruckAdminFilters>({
    query: "",
    zoneId: "",
    status: "",
    active: ""
  });
  const [customerFilters, setCustomerFilters] = useState<CustomerAdminFilters>({
    query: "",
    zoneId: "",
    customerType: "",
    serviceStatus: ""
  });
  const [staffFormError, setStaffFormError] = useState<string | null>(null);
  const [truckFormError, setTruckFormError] = useState<string | null>(null);
  const [customerFormError, setCustomerFormError] = useState<string | null>(null);
  const [staffStatusErrors, setStaffStatusErrors] = useState<Record<string, string>>({});
  const [truckStatusErrors, setTruckStatusErrors] = useState<Record<string, string>>({});
  const [customerStatusErrors, setCustomerStatusErrors] = useState<Record<string, string>>({});

  const filteredStaff = useMemo(
    () => filterAdminStaff(adminData.staff, staffFilters),
    [adminData.staff, staffFilters]
  );
  const filteredTrucks = useMemo(
    () => filterAdminTrucks(adminData.trucks, truckFilters),
    [adminData.trucks, truckFilters]
  );
  const filteredCustomers = useMemo(
    () => filterAdminCustomers(adminData.customers, customerFilters),
    [adminData.customers, customerFilters]
  );

  useEffect(() => {
    if (!defaultZoneId) {
      return;
    }

    setTruckForm((current) => ({ ...current, zoneId: current.zoneId || defaultZoneId }));
    setCustomerForm((current) => ({ ...current, zoneId: current.zoneId || defaultZoneId }));
  }, [defaultZoneId]);

  function openModal(kind: AdminModalKind) {
    setActiveModal(kind);
    setStaffFormError(null);
    setTruckFormError(null);
    setCustomerFormError(null);
  }

  function closeModal() {
    setActiveModal(null);
  }

  async function submitStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStaffFormError(null);

    try {
      const result = await onOnboardStaff({
        fullName: staffForm.fullName,
        monthlySalaryKobo: Math.round(Number(staffForm.monthlySalaryNaira || 0) * 100),
        phone: staffForm.phone,
        role: staffForm.role,
        loginEmail: staffForm.provisionLogin ? staffForm.loginEmail : undefined,
        provisionLogin: staffForm.provisionLogin
      });
      setStaffForm({
        fullName: "",
        monthlySalaryNaira: "",
        phone: "",
        role: "driver",
        loginEmail: "",
        provisionLogin: true
      });
      closeModal();
      if (result.loginProvisioned && result.temporaryPassword && result.loginEmail) {
        setStaffCredentials(result);
      }
    } catch (error) {
      setStaffFormError(error instanceof Error ? error.message : "Unable to onboard staff member");
    }
  }

  async function submitProvisionLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provisionStaffId) {
      return;
    }

    setProvisionFormError(null);

    try {
      const result = await onProvisionStaffLogin({
        staffId: provisionStaffId,
        loginEmail: provisionEmail
      });
      setProvisionStaffId(null);
      setProvisionEmail("");
      if (result.loginProvisioned && result.temporaryPassword && result.loginEmail) {
        setStaffCredentials(result);
      }
    } catch (error) {
      setProvisionFormError(error instanceof Error ? error.message : "Unable to create staff login");
    }
  }

  async function handlePasswordReset(staffId: string) {
    setStaffLoginActionErrors((current) => {
      const next = { ...current };
      delete next[staffId];
      return next;
    });

    try {
      await onRequestStaffPasswordReset(staffId);
    } catch (error) {
      setStaffLoginActionErrors((current) => ({
        ...current,
        [staffId]: error instanceof Error ? error.message : "Unable to send password reset email"
      }));
    }
  }

  function openProvisionLogin(staffId: string, fullName: string) {
    setProvisionStaffId(staffId);
    setProvisionEmail(suggestStaffLoginEmail(fullName));
    setProvisionFormError(null);
  }

  async function submitTruck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTruckFormError(null);

    try {
      await onOnboardTruck({
        make: truckForm.make || undefined,
        model: truckForm.model || undefined,
        registrationNumber: truckForm.registrationNumber,
        status: truckForm.status,
        year: truckForm.year ? Number(truckForm.year) : undefined,
        zoneId: truckForm.zoneId
      });
      setTruckForm({
        make: "",
        model: "",
        registrationNumber: "",
        status: "operational",
        year: "",
        zoneId: defaultZoneId
      });
      closeModal();
    } catch (error) {
      setTruckFormError(error instanceof Error ? error.message : "Unable to onboard truck");
    }
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCustomerFormError(null);

    try {
      await onOnboardCustomer({
        address: customerForm.address,
        customerType: customerForm.customerType,
        displayName: customerForm.displayName,
        monthlyRateKobo: Math.round(Number(customerForm.monthlyRateNaira || 0) * 100),
        phone: customerForm.phone || undefined,
        serviceStatus: customerForm.serviceStatus,
        zoneId: customerForm.zoneId
      });
      setCustomerForm({
        address: "",
        customerType: "residential",
        displayName: "",
        monthlyRateNaira: "",
        phone: "",
        serviceStatus: "active",
        zoneId: defaultZoneId
      });
      closeModal();
    } catch (error) {
      setCustomerFormError(error instanceof Error ? error.message : "Unable to onboard customer");
    }
  }

  async function toggleCustomerStatus(customerId: string, nextStatus: CustomerLedgerItem["serviceStatus"]) {
    setCustomerStatusErrors((current) => {
      const next = { ...current };
      delete next[customerId];
      return next;
    });

    try {
      await onSetCustomerServiceStatus(customerId, nextStatus);
    } catch (error) {
      setCustomerStatusErrors((current) => ({
        ...current,
        [customerId]: error instanceof Error ? error.message : "Unable to update customer status"
      }));
    }
  }

  async function toggleStaffActive(staffId: string, active: boolean) {
    setStaffStatusErrors((current) => {
      const next = { ...current };
      delete next[staffId];
      return next;
    });

    try {
      await onSetStaffActive(staffId, active);
    } catch (error) {
      setStaffStatusErrors((current) => ({
        ...current,
        [staffId]: error instanceof Error ? error.message : "Unable to update staff status"
      }));
    }
  }

  async function toggleTruckActive(truckId: string, active: boolean) {
    setTruckStatusErrors((current) => {
      const next = { ...current };
      delete next[truckId];
      return next;
    });

    try {
      await onSetTruckActive(truckId, active);
    } catch (error) {
      setTruckStatusErrors((current) => ({
        ...current,
        [truckId]: error instanceof Error ? error.message : "Unable to update truck status"
      }));
    }
  }

  return (
    <section className="admin-workflow">
      <header className="admin-workflow-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Master data</h2>
          <p className="panel-subtitle">
            Manage staff, fleet, and customer records. Pick a section below to onboard or update records.
          </p>
        </div>
      </header>

      <nav aria-label="Admin sections" className="admin-tabs">
        {adminSections.map((section) => (
          <button
            className={activeAdminSection === section.id ? "active" : ""}
            key={section.id}
            onClick={() => setActiveAdminSection(section.id)}
            type="button"
          >
            {section.label}
          </button>
        ))}
      </nav>

      {activeAdminSection === "staff" ? (
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Drivers & Staff</p>
              <h2>Field workers</h2>
              <p className="panel-subtitle">Onboard field workers and deactivate records without losing history.</p>
            </div>
            <div className="panel-header-actions">
              <button className="primary-button" onClick={() => openModal("staff")} type="button">
                Add staff
              </button>
              <Users aria-hidden="true" />
            </div>
          </div>

          <AdminFilterToolbar resultCount={filteredStaff.length} totalCount={adminData.staff.length}>
            <label>
              Search
              <input
                onChange={(event) => setStaffFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="Name, phone, or role"
                type="search"
                value={staffFilters.query}
              />
            </label>
            <label>
              Role
              <select
                onChange={(event) => setStaffFilters((current) => ({ ...current, role: event.target.value }))}
                value={staffFilters.role}
              >
                <option value="">All roles</option>
                {adminStaffRoles.map((role) => (
                  <option key={role} value={role}>
                    {role.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Record status
              <select
                onChange={(event) => setStaffFilters((current) => ({ ...current, active: event.target.value }))}
                value={staffFilters.active}
              >
                <option value="">All records</option>
                <option value="active">Active only</option>
                <option value="inactive">Inactive only</option>
              </select>
            </label>
          </AdminFilterToolbar>

          <div className="admin-list">
            {filteredStaff.length === 0 ? (
              <p className="admin-empty">No staff match the current filters.</p>
            ) : (
              filteredStaff.map((staff) => (
                <div className="admin-row" key={staff.id}>
                  <div>
                    <strong>{staff.fullName}</strong>
                    <span>
                      {staff.phone} · {staff.role.replace("_", " ")} · {formatKobo(staff.monthlySalaryKobo)}
                    </span>
                    <small>
                      {staff.hasLoginProfile
                        ? staff.loginEmail
                          ? `Login: ${staff.loginEmail}`
                          : "Login linked"
                        : "No login profile yet"}
                    </small>
                    {staffLoginActionErrors[staff.id] ? (
                      <p className="inline-error">{staffLoginActionErrors[staff.id]}</p>
                    ) : null}
                    {staffStatusErrors[staff.id] ? <p className="inline-error">{staffStatusErrors[staff.id]}</p> : null}
                  </div>
                  <span className={`pill ${staff.active ? "" : "danger"}`}>{staff.active ? "active" : "inactive"}</span>
                  <div className="button-row admin-row-actions">
                    {!staff.hasLoginProfile && staffRolesWithLogin.has(staff.role) ? (
                      <button onClick={() => openProvisionLogin(staff.id, staff.fullName)} type="button">
                        Create login
                      </button>
                    ) : null}
                    {staff.hasLoginProfile ? (
                      <button onClick={() => void handlePasswordReset(staff.id)} type="button">
                        Send reset email
                      </button>
                    ) : null}
                    <button onClick={() => void toggleStaffActive(staff.id, !staff.active)} type="button">
                      {staff.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      ) : null}

      {activeAdminSection === "trucks" ? (
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Trucks</p>
              <h2>Fleet registry</h2>
              <p className="panel-subtitle">Register fleet assets and bind them to operating zones.</p>
            </div>
            <div className="panel-header-actions">
              <button className="primary-button" onClick={() => openModal("truck")} type="button">
                Add truck
              </button>
              <Truck aria-hidden="true" />
            </div>
          </div>

          <AdminFilterToolbar resultCount={filteredTrucks.length} totalCount={adminData.trucks.length}>
            <label>
              Search
              <input
                onChange={(event) => setTruckFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="Registration, make, model, zone"
                type="search"
                value={truckFilters.query}
              />
            </label>
            <label>
              Zone
              <select
                onChange={(event) => setTruckFilters((current) => ({ ...current, zoneId: event.target.value }))}
                value={truckFilters.zoneId}
              >
                <option value="">All zones</option>
                {adminData.zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fleet status
              <select
                onChange={(event) => setTruckFilters((current) => ({ ...current, status: event.target.value }))}
                value={truckFilters.status}
              >
                <option value="">All fleet statuses</option>
                {adminTruckStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Record status
              <select
                onChange={(event) => setTruckFilters((current) => ({ ...current, active: event.target.value }))}
                value={truckFilters.active}
              >
                <option value="">All records</option>
                <option value="active">Active only</option>
                <option value="inactive">Inactive only</option>
              </select>
            </label>
          </AdminFilterToolbar>

          <div className="admin-list">
            {filteredTrucks.length === 0 ? (
              <p className="admin-empty">No trucks match the current filters.</p>
            ) : (
              filteredTrucks.map((truck) => (
                <div className="admin-row" key={truck.id}>
                  <div>
                    <strong>{truck.registrationNumber}</strong>
                    <span>
                      {truck.zoneName ?? "No zone"} · {truck.status} ·{" "}
                      {[truck.make, truck.model, truck.year].filter(Boolean).join(" ") || "No vehicle details"}
                    </span>
                    {truckStatusErrors[truck.id] ? <p className="inline-error">{truckStatusErrors[truck.id]}</p> : null}
                  </div>
                  <span className={`pill ${truck.active ? "" : "danger"}`}>{truck.active ? "active" : "inactive"}</span>
                  <button onClick={() => void toggleTruckActive(truck.id, !truck.active)} type="button">
                    {truck.active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              ))
            )}
          </div>
        </article>
      ) : null}

      {activeAdminSection === "customers" ? (
        <article className="panel panel-wide">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Customers</p>
              <h2>Customer accounts</h2>
              <p className="panel-subtitle">Create customer accounts used by billing, route planning, and stop lists.</p>
            </div>
            <div className="panel-header-actions">
              <button className="primary-button" onClick={() => openModal("customer")} type="button">
                Add customer
              </button>
              <WalletCards aria-hidden="true" />
            </div>
          </div>

          <AdminFilterToolbar resultCount={filteredCustomers.length} totalCount={adminData.customers.length}>
            <label>
              Search
              <input
                onChange={(event) => setCustomerFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="Name, phone, or address"
                type="search"
                value={customerFilters.query}
              />
            </label>
            <label>
              Zone
              <select
                onChange={(event) => setCustomerFilters((current) => ({ ...current, zoneId: event.target.value }))}
                value={customerFilters.zoneId}
              >
                <option value="">All zones</option>
                {adminData.zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select
                onChange={(event) =>
                  setCustomerFilters((current) => ({ ...current, customerType: event.target.value }))
                }
                value={customerFilters.customerType}
              >
                <option value="">All types</option>
                {adminCustomerTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Service status
              <select
                onChange={(event) =>
                  setCustomerFilters((current) => ({ ...current, serviceStatus: event.target.value }))
                }
                value={customerFilters.serviceStatus}
              >
                <option value="">All service statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </label>
          </AdminFilterToolbar>

          <div className="admin-list">
            {filteredCustomers.length === 0 ? (
              <p className="admin-empty">No customers match the current filters.</p>
            ) : (
              filteredCustomers.map((customer) => (
                <div className="admin-row" key={customer.id}>
                  <div>
                    <strong>{customer.displayName}</strong>
                    <span>
                      {customer.zoneName} · {customer.address} · {formatKobo(customer.monthlyRateKobo)}
                    </span>
                    <small>
                      {customer.phone ?? "No phone"} · {customer.customerType.replace("_", " ")}
                    </small>
                    {customerStatusErrors[customer.id] ? (
                      <p className="inline-error">{customerStatusErrors[customer.id]}</p>
                    ) : null}
                  </div>
                  <span className={`pill ${customer.serviceStatus === "suspended" ? "danger" : ""}`}>
                    {customer.serviceStatus}
                  </span>
                  <button
                    onClick={() =>
                      void toggleCustomerStatus(
                        customer.id,
                        customer.serviceStatus === "active" ? "suspended" : "active"
                      )
                    }
                    type="button"
                  >
                    {customer.serviceStatus === "active" ? "Suspend" : "Reactivate"}
                  </button>
                </div>
              ))
            )}
          </div>
        </article>
      ) : null}

      <AdminModal
        onClose={closeModal}
        open={activeModal === "staff"}
        subtitle="Create a staff record for drivers, collection agents, or supervisors."
        title="Add staff"
      >
        <form className="entry-card admin-form admin-modal-form" onSubmit={(event) => void submitStaff(event)}>
          <label>
            Full name
            <input
              onChange={(event) =>
                setStaffForm((current) => {
                  const fullName = event.target.value;
                  return {
                    ...current,
                    fullName,
                    loginEmail:
                      current.loginEmail && current.loginEmail !== suggestStaffLoginEmail(current.fullName)
                        ? current.loginEmail
                        : suggestStaffLoginEmail(fullName)
                  };
                })
              }
              required
              value={staffForm.fullName}
            />
          </label>
          <label>
            Phone
            <input
              onChange={(event) => setStaffForm((current) => ({ ...current, phone: event.target.value }))}
              required
              value={staffForm.phone}
            />
          </label>
          <label>
            Role
            <select
              onChange={(event) => {
                const role = event.target.value as UserRole;
                setStaffForm((current) => ({
                  ...current,
                  role,
                  provisionLogin: staffRolesWithLogin.has(role)
                }));
              }}
              value={staffForm.role}
            >
              {adminStaffRoles.map((role) => (
                <option key={role} value={role}>
                  {role.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Monthly salary (naira)
            <input
              min="0"
              onChange={(event) => setStaffForm((current) => ({ ...current, monthlySalaryNaira: event.target.value }))}
              type="number"
              value={staffForm.monthlySalaryNaira}
            />
          </label>
          {staffRolesWithLogin.has(staffForm.role) ? (
            <>
              <label className="checkbox-row">
                <input
                  checked={staffForm.provisionLogin}
                  onChange={(event) =>
                    setStaffForm((current) => ({ ...current, provisionLogin: event.target.checked }))
                  }
                  type="checkbox"
                />
                Create mobile/web login now
              </label>
              {staffForm.provisionLogin ? (
                <label>
                  Login email
                  <input
                    onChange={(event) => setStaffForm((current) => ({ ...current, loginEmail: event.target.value }))}
                    placeholder="name@cleanops.local"
                    required
                    type="email"
                    value={staffForm.loginEmail}
                  />
                </label>
              ) : null}
            </>
          ) : null}
          {staffFormError ? <p className="inline-error">{staffFormError}</p> : null}
          <div className="button-row">
            <button className="primary-button" type="submit">
              Add staff
            </button>
          </div>
        </form>
      </AdminModal>

      <AdminModal
        onClose={closeModal}
        open={activeModal === "truck"}
        subtitle="Register a fleet asset and assign it to an operating zone."
        title="Add truck"
      >
        <form className="entry-card admin-form admin-modal-form" onSubmit={(event) => void submitTruck(event)}>
          <label>
            Zone
            <select
              onChange={(event) => setTruckForm((current) => ({ ...current, zoneId: event.target.value }))}
              required
              value={truckForm.zoneId}
            >
              <option value="">Select zone</option>
              {adminData.zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Registration
            <input
              onChange={(event) => setTruckForm((current) => ({ ...current, registrationNumber: event.target.value }))}
              required
              value={truckForm.registrationNumber}
            />
          </label>
          <label>
            Make
            <input
              onChange={(event) => setTruckForm((current) => ({ ...current, make: event.target.value }))}
              value={truckForm.make}
            />
          </label>
          <label>
            Model
            <input
              onChange={(event) => setTruckForm((current) => ({ ...current, model: event.target.value }))}
              value={truckForm.model}
            />
          </label>
          <label>
            Year
            <input
              onChange={(event) => setTruckForm((current) => ({ ...current, year: event.target.value }))}
              type="number"
              value={truckForm.year}
            />
          </label>
          <label>
            Status
            <select
              onChange={(event) => setTruckForm((current) => ({ ...current, status: event.target.value as TruckStatus }))}
              value={truckForm.status}
            >
              {adminTruckStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          {truckFormError ? <p className="inline-error">{truckFormError}</p> : null}
          <div className="button-row">
            <button className="primary-button" type="submit">
              Add truck
            </button>
          </div>
        </form>
      </AdminModal>

      <AdminModal
        onClose={closeModal}
        open={activeModal === "customer"}
        subtitle="Create a customer account for billing, route planning, and collections."
        title="Add customer"
      >
        <form
          className="entry-card admin-form customer-admin-form admin-modal-form"
          onSubmit={(event) => void submitCustomer(event)}
        >
          <label>
            Zone
            <select
              onChange={(event) => setCustomerForm((current) => ({ ...current, zoneId: event.target.value }))}
              required
              value={customerForm.zoneId}
            >
              <option value="">Select zone</option>
              {adminData.zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Customer name
            <input
              onChange={(event) => setCustomerForm((current) => ({ ...current, displayName: event.target.value }))}
              required
              value={customerForm.displayName}
            />
          </label>
          <label>
            Phone
            <input
              onChange={(event) => setCustomerForm((current) => ({ ...current, phone: event.target.value }))}
              value={customerForm.phone}
            />
          </label>
          <label>
            Address
            <input
              onChange={(event) => setCustomerForm((current) => ({ ...current, address: event.target.value }))}
              required
              value={customerForm.address}
            />
          </label>
          <label>
            Type
            <select
              onChange={(event) =>
                setCustomerForm((current) => ({ ...current, customerType: event.target.value as CustomerType }))
              }
              value={customerForm.customerType}
            >
              {adminCustomerTypes.map((type) => (
                <option key={type} value={type}>
                  {type.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Monthly rate (naira)
            <input
              min="0"
              onChange={(event) => setCustomerForm((current) => ({ ...current, monthlyRateNaira: event.target.value }))}
              required
              type="number"
              value={customerForm.monthlyRateNaira}
            />
          </label>
          <label>
            Service status
            <select
              onChange={(event) =>
                setCustomerForm((current) => ({
                  ...current,
                  serviceStatus: event.target.value as CustomerLedgerItem["serviceStatus"]
                }))
              }
              value={customerForm.serviceStatus}
            >
              <option value="active">active</option>
              <option value="suspended">suspended</option>
            </select>
          </label>
          {customerFormError ? <p className="inline-error">{customerFormError}</p> : null}
          <div className="button-row">
            <button className="primary-button" type="submit">
              Add customer
            </button>
          </div>
        </form>
      </AdminModal>

      <AdminModal
        onClose={() => setStaffCredentials(null)}
        open={Boolean(staffCredentials)}
        subtitle="Share these credentials securely with the staff member. The temporary password is shown once."
        title="Staff login created"
      >
        {staffCredentials ? (
          <div className="entry-card admin-credentials-card">
            <p>
              <strong>Email:</strong> {staffCredentials.loginEmail}
            </p>
            <p>
              <strong>Temporary password:</strong> {staffCredentials.temporaryPassword}
            </p>
            <p className="panel-subtitle">
              Staff can sign in on mobile immediately. Use Send reset email later if they need a self-service password
              change.
            </p>
            <div className="button-row">
              <button
                className="primary-button"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `Email: ${staffCredentials.loginEmail}\nTemporary password: ${staffCredentials.temporaryPassword}`
                  )
                }
                type="button"
              >
                Copy credentials
              </button>
            </div>
          </div>
        ) : null}
      </AdminModal>

      <AdminModal
        onClose={() => {
          setProvisionStaffId(null);
          setProvisionEmail("");
          setProvisionFormError(null);
        }}
        open={Boolean(provisionStaffId)}
        subtitle="Create a Supabase Auth login and link it to this staff record."
        title="Create staff login"
      >
        <form className="entry-card admin-form admin-modal-form" onSubmit={(event) => void submitProvisionLogin(event)}>
          <label>
            Login email
            <input
              onChange={(event) => setProvisionEmail(event.target.value)}
              placeholder="name@cleanops.local"
              required
              type="email"
              value={provisionEmail}
            />
          </label>
          {provisionFormError ? <p className="inline-error">{provisionFormError}</p> : null}
          <div className="button-row">
            <button className="primary-button" type="submit">
              Create login
            </button>
          </div>
        </form>
      </AdminModal>
    </section>
  );
}
