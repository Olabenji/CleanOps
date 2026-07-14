import type {
  AdminCustomer,
  AdminMasterData,
  AdminStaff,
  AdminTruck,
  CustomerLedgerItem,
  CustomerOnboardingInput,
  CustomerType,
  CustomerUpdateInput,
  StaffLoginProvisionInput,
  StaffOnboardingInput,
  StaffOnboardingResult,
  StaffUpdateInput,
  TruckOnboardingInput,
  TruckStatus,
  TruckUpdateInput,
  UserRole
} from "@cleanops/shared";
import { ISO_WEEKDAY_LABELS, formatCollectionFrequency } from "@cleanops/shared";
import { Truck, Users, WalletCards } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import AdminModal from "./AdminModal";
import LicenceUploadDialog from "./LicenceUploadDialog";
import {
  filterAdminCustomers,
  filterAdminStaff,
  filterAdminTrucks,
  type CustomerAdminFilters,
  type StaffAdminFilters,
  type TruckAdminFilters
} from "../lib/adminFilters";
import { uploadDriverLicenceDocument } from "../data/profileService";

const WEEKDAY_OPTIONS = ISO_WEEKDAY_LABELS.map((label, index) => ({
  value: index + 1,
  label
}));

function defaultPreferredWeekdays(customerType: CustomerType): number[] {
  return customerType === "restaurant" ? [1, 3, 5] : [1];
}

function defaultCollectionsPerWeek(customerType: CustomerType): number {
  return customerType === "restaurant" ? 3 : 1;
}

type AdminSection = "staff" | "trucks" | "customers";
type AdminModalKind = "staff" | "truck" | "customer";

const adminSections: Array<{ id: AdminSection; label: string }> = [
  { id: "staff", label: "Drivers & Staff" },
  { id: "trucks", label: "Trucks" },
  { id: "customers", label: "Customers" }
];

const adminStaffRoles: UserRole[] = ["driver", "loader", "collection_agent", "operations_supervisor"];
const staffRolesWithLogin = new Set<UserRole>(["driver", "collection_agent", "operations_supervisor"]);
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

function formatLicenceExpiry(isoDate: string | null | undefined) {
  if (!isoDate) {
    return null;
  }

  const parsed = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }

  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function licenceExpiryTone(isoDate: string | null | undefined) {
  if (!isoDate) {
    return "muted";
  }

  const expiry = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) {
    return "danger";
  }

  if (daysLeft <= 60) {
    return "warn";
  }

  return "ok";
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
  operatorId,
  onOnboardCustomer,
  onOnboardStaff,
  onOnboardTruck,
  onProvisionStaffLogin,
  onRequestStaffPasswordReset,
  onSetCustomerServiceStatus,
  onSetStaffActive,
  onSetTruckActive,
  onUpdateCustomer,
  onUpdateStaff,
  onUpdateTruck
}: {
  adminData: AdminMasterData;
  operatorId: string | null;
  onOnboardCustomer: (input: CustomerOnboardingInput) => Promise<void>;
  onOnboardStaff: (input: StaffOnboardingInput) => Promise<StaffOnboardingResult>;
  onOnboardTruck: (input: TruckOnboardingInput) => Promise<void>;
  onProvisionStaffLogin: (input: StaffLoginProvisionInput) => Promise<StaffOnboardingResult>;
  onRequestStaffPasswordReset: (staffId: string) => Promise<{ sent: true; loginEmail: string; staffName: string }>;
  onSetCustomerServiceStatus: (customerId: string, serviceStatus: CustomerLedgerItem["serviceStatus"]) => Promise<void>;
  onSetStaffActive: (staffId: string, active: boolean) => Promise<void>;
  onSetTruckActive: (truckId: string, active: boolean) => Promise<void>;
  onUpdateCustomer: (input: CustomerUpdateInput) => Promise<void>;
  onUpdateStaff: (input: StaffUpdateInput) => Promise<void>;
  onUpdateTruck: (input: TruckUpdateInput) => Promise<void>;
}) {
  const defaultZoneId = adminData.zones[0]?.id ?? "";
  const [activeAdminSection, setActiveAdminSection] = useState<AdminSection>("staff");
  const [activeModal, setActiveModal] = useState<AdminModalKind | null>(null);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editingTruckId, setEditingTruckId] = useState<string | null>(null);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [licencePreviewUrl, setLicencePreviewUrl] = useState<string | null>(null);
  const [licenceUploadStaff, setLicenceUploadStaff] = useState<AdminStaff | null>(null);
  const [licenceUploadError, setLicenceUploadError] = useState<string | null>(null);
  const [staffForm, setStaffForm] = useState({
    fullName: "",
    monthlySalaryNaira: "",
    phone: "",
    role: "driver" as UserRole,
    loginEmail: "",
    provisionLogin: true,
    licenceExpiresOn: "",
    licenceImageUrl: ""
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
    zoneId: ""
  });
  const [customerForm, setCustomerForm] = useState({
    address: "",
    customerType: "residential" as CustomerType,
    displayName: "",
    monthlyRateNaira: "",
    phone: "",
    serviceStatus: "active" as CustomerLedgerItem["serviceStatus"],
    zoneId: defaultZoneId,
    collectionsPerWeek: 1,
    preferredWeekdays: [1] as number[],
    frequencyNotes: ""
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

  function openCreateModal(kind: AdminModalKind) {
    setEditingStaffId(null);
    setEditingTruckId(null);
    setEditingCustomerId(null);
    setStaffFormError(null);
    setTruckFormError(null);
    setCustomerFormError(null);

    if (kind === "staff") {
      setStaffForm({
        fullName: "",
        monthlySalaryNaira: "",
        phone: "",
        role: "driver",
        loginEmail: "",
        provisionLogin: true,
        licenceExpiresOn: "",
        licenceImageUrl: "/driver-licences/placeholder.svg"
      });
    }

    if (kind === "truck") {
      setTruckForm({
        make: "",
        model: "",
        registrationNumber: "",
        status: "operational",
        year: "",
        zoneId: ""
      });
    }

    if (kind === "customer") {
      setCustomerForm({
        address: "",
        customerType: "residential",
        displayName: "",
        monthlyRateNaira: "",
        phone: "",
        serviceStatus: "active",
        zoneId: defaultZoneId,
        collectionsPerWeek: 1,
        preferredWeekdays: [1],
        frequencyNotes: ""
      });
    }

    setActiveModal(kind);
  }

  function openEditStaff(staff: AdminStaff) {
    setEditingStaffId(staff.id);
    setEditingTruckId(null);
    setEditingCustomerId(null);
    setStaffFormError(null);
    setStaffForm({
      fullName: staff.fullName,
      monthlySalaryNaira: String(staff.monthlySalaryKobo / 100),
      phone: staff.phone,
      role: staff.role,
      loginEmail: staff.loginEmail ?? "",
      provisionLogin: false,
      licenceExpiresOn: staff.licenceExpiresOn?.slice(0, 10) ?? "",
      licenceImageUrl: staff.licenceImageUrl ?? ""
    });
    setActiveModal("staff");
  }

  function openEditTruck(truck: AdminTruck) {
    setEditingTruckId(truck.id);
    setEditingStaffId(null);
    setEditingCustomerId(null);
    setTruckFormError(null);
    setTruckForm({
      make: truck.make ?? "",
      model: truck.model ?? "",
      registrationNumber: truck.registrationNumber,
      status: truck.status,
      year: truck.year ? String(truck.year) : "",
      zoneId: truck.zoneId ?? ""
    });
    setActiveModal("truck");
  }

  function openEditCustomer(customer: AdminCustomer) {
    setEditingCustomerId(customer.id);
    setEditingStaffId(null);
    setEditingTruckId(null);
    setCustomerFormError(null);
    setCustomerForm({
      address: customer.address,
      customerType: customer.customerType,
      displayName: customer.displayName,
      monthlyRateNaira: String(customer.monthlyRateKobo / 100),
      phone: customer.phone ?? "",
      serviceStatus: customer.serviceStatus,
      zoneId: customer.zoneId,
      collectionsPerWeek: customer.collectionsPerWeek,
      preferredWeekdays: [...customer.preferredWeekdays],
      frequencyNotes: customer.frequencyNotes ?? ""
    });
    setActiveModal("customer");
  }

  function closeModal() {
    setActiveModal(null);
    setEditingStaffId(null);
    setEditingTruckId(null);
    setEditingCustomerId(null);
  }

  async function submitStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStaffFormError(null);

    try {
      if (editingStaffId) {
        await onUpdateStaff({
          staffId: editingStaffId,
          fullName: staffForm.fullName,
          monthlySalaryKobo: Math.round(Number(staffForm.monthlySalaryNaira || 0) * 100),
          phone: staffForm.phone,
          role: staffForm.role,
          licenceExpiresOn: staffForm.role === "driver" ? staffForm.licenceExpiresOn || null : null,
          licenceImageUrl: staffForm.role === "driver" ? staffForm.licenceImageUrl || null : null
        });
        closeModal();
        return;
      }

      const result = await onOnboardStaff({
        fullName: staffForm.fullName,
        monthlySalaryKobo: Math.round(Number(staffForm.monthlySalaryNaira || 0) * 100),
        phone: staffForm.phone,
        role: staffForm.role,
        loginEmail: staffForm.provisionLogin ? staffForm.loginEmail : undefined,
        provisionLogin: staffForm.provisionLogin,
        licenceExpiresOn: staffForm.role === "driver" ? staffForm.licenceExpiresOn || null : null,
        licenceImageUrl: staffForm.role === "driver" ? staffForm.licenceImageUrl || null : null
      });
      setStaffForm({
        fullName: "",
        monthlySalaryNaira: "",
        phone: "",
        role: "driver",
        loginEmail: "",
        provisionLogin: true,
        licenceExpiresOn: "",
        licenceImageUrl: "/driver-licences/placeholder.svg"
      });
      closeModal();
      if (result.loginProvisioned && result.temporaryPassword && result.loginEmail) {
        setStaffCredentials(result);
      }
    } catch (error) {
      setStaffFormError(
        error instanceof Error
          ? error.message
          : editingStaffId
            ? "Unable to update staff member"
            : "Unable to onboard staff member"
      );
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
      if (editingTruckId) {
        await onUpdateTruck({
          truckId: editingTruckId,
          make: truckForm.make || undefined,
          model: truckForm.model || undefined,
          registrationNumber: truckForm.registrationNumber,
          status: truckForm.status,
          year: truckForm.year ? Number(truckForm.year) : null,
          zoneId: truckForm.zoneId || null
        });
        closeModal();
        return;
      }

      await onOnboardTruck({
        make: truckForm.make || undefined,
        model: truckForm.model || undefined,
        registrationNumber: truckForm.registrationNumber,
        status: truckForm.status,
        year: truckForm.year ? Number(truckForm.year) : undefined,
        zoneId: truckForm.zoneId || null
      });
      setTruckForm({
        make: "",
        model: "",
        registrationNumber: "",
        status: "operational",
        year: "",
        zoneId: ""
      });
      closeModal();
    } catch (error) {
      setTruckFormError(
        error instanceof Error
          ? error.message
          : editingTruckId
            ? "Unable to update truck"
            : "Unable to onboard truck"
      );
    }
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCustomerFormError(null);

    try {
      if (editingCustomerId) {
        await onUpdateCustomer({
          customerId: editingCustomerId,
          address: customerForm.address,
          customerType: customerForm.customerType,
          displayName: customerForm.displayName,
          monthlyRateKobo: Math.round(Number(customerForm.monthlyRateNaira || 0) * 100),
          phone: customerForm.phone || undefined,
          zoneId: customerForm.zoneId,
          collectionsPerWeek: customerForm.collectionsPerWeek,
          preferredWeekdays: customerForm.preferredWeekdays,
          frequencyNotes: customerForm.frequencyNotes || null
        });
        closeModal();
        return;
      }

      await onOnboardCustomer({
        address: customerForm.address,
        customerType: customerForm.customerType,
        displayName: customerForm.displayName,
        monthlyRateKobo: Math.round(Number(customerForm.monthlyRateNaira || 0) * 100),
        phone: customerForm.phone || undefined,
        serviceStatus: customerForm.serviceStatus,
        zoneId: customerForm.zoneId,
        collectionsPerWeek: customerForm.collectionsPerWeek,
        preferredWeekdays: customerForm.preferredWeekdays,
        frequencyNotes: customerForm.frequencyNotes || null
      });
      setCustomerForm({
        address: "",
        customerType: "residential",
        displayName: "",
        monthlyRateNaira: "",
        phone: "",
        serviceStatus: "active",
        zoneId: defaultZoneId,
        collectionsPerWeek: 1,
        preferredWeekdays: [1],
        frequencyNotes: ""
      });
      closeModal();
    } catch (error) {
      setCustomerFormError(
        error instanceof Error
          ? error.message
          : editingCustomerId
            ? "Unable to update customer"
            : "Unable to onboard customer"
      );
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
              <button className="primary-button" onClick={() => openCreateModal("staff")} type="button">
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
                  <div className="admin-row-main">
                    {staff.role === "driver" && staff.licenceImageUrl ? (
                      <button
                        className="licence-thumb-button"
                        onClick={() => setLicencePreviewUrl(staff.licenceImageUrl ?? null)}
                        type="button"
                        title="View driver licence"
                      >
                        <img alt="" className="licence-thumb" src={staff.licenceImageUrl} />
                      </button>
                    ) : null}
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
                      {staff.role === "driver" ? (
                        <small className={`licence-expiry licence-expiry-${licenceExpiryTone(staff.licenceExpiresOn)}`}>
                          Licence expires {formatLicenceExpiry(staff.licenceExpiresOn) ?? "not set"}
                        </small>
                      ) : null}
                      {staffLoginActionErrors[staff.id] ? (
                        <p className="inline-error">{staffLoginActionErrors[staff.id]}</p>
                      ) : null}
                      {staffStatusErrors[staff.id] ? <p className="inline-error">{staffStatusErrors[staff.id]}</p> : null}
                    </div>
                  </div>
                  <span className={`pill ${staff.active ? "" : "danger"}`}>{staff.active ? "active" : "inactive"}</span>
                  <div className="button-row admin-row-actions">
                    <button onClick={() => openEditStaff(staff)} type="button">
                      Edit
                    </button>
                    {!staff.hasLoginProfile && staffRolesWithLogin.has(staff.role) ? (
                      <button onClick={() => openProvisionLogin(staff.id, staff.fullName)} type="button">
                        Create login
                      </button>
                    ) : null}
                    {staff.role === "driver" ? (
                      <button
                        onClick={() => {
                          setLicenceUploadError(null);
                          setLicenceUploadStaff(staff);
                        }}
                        type="button"
                      >
                        Upload licence
                      </button>
                    ) : null}
                    {staff.hasLoginProfile ? (
                      <button onClick={() => void handlePasswordReset(staff.id)} type="button">
                        Send reset email
                      </button>
                    ) : null}
                    <button
                      className={staff.active ? "danger-outline" : undefined}
                      onClick={() => void toggleStaffActive(staff.id, !staff.active)}
                      type="button"
                    >
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
              <button className="primary-button" onClick={() => openCreateModal("truck")} type="button">
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
                  <div className="admin-row-copy">
                    <strong>{truck.registrationNumber}</strong>
                    <span>
                      {truck.zoneName ?? "No zone"} · {truck.status} ·{" "}
                      {[truck.make, truck.model, truck.year].filter(Boolean).join(" ") || "No vehicle details"}
                    </span>
                    {truckStatusErrors[truck.id] ? <p className="inline-error">{truckStatusErrors[truck.id]}</p> : null}
                  </div>
                  <span className={`pill ${truck.active ? "" : "danger"}`}>{truck.active ? "active" : "inactive"}</span>
                  <div className="button-row admin-row-actions">
                    <button onClick={() => openEditTruck(truck)} type="button">
                      Edit
                    </button>
                    <button
                      className={truck.active ? "danger-outline" : undefined}
                      onClick={() => void toggleTruckActive(truck.id, !truck.active)}
                      type="button"
                    >
                      {truck.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
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
              <button className="primary-button" onClick={() => openCreateModal("customer")} type="button">
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
                  <div className="admin-row-copy">
                    <strong>{customer.displayName}</strong>
                    <span>
                      {customer.zoneName} · {customer.address} · {formatKobo(customer.monthlyRateKobo)}
                    </span>
                    <small>
                      {customer.phone ?? "No phone"} · {customer.customerType.replace("_", " ")} ·{" "}
                      {formatCollectionFrequency(customer.collectionsPerWeek, customer.preferredWeekdays)}
                    </small>
                    {customerStatusErrors[customer.id] ? (
                      <p className="inline-error">{customerStatusErrors[customer.id]}</p>
                    ) : null}
                  </div>
                  <span className={`pill ${customer.serviceStatus === "suspended" ? "danger" : ""}`}>
                    {customer.serviceStatus}
                  </span>
                  <div className="button-row admin-row-actions">
                    <button onClick={() => openEditCustomer(customer)} type="button">
                      Edit
                    </button>
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
                </div>
              ))
            )}
          </div>
        </article>
      ) : null}

      <AdminModal
        onClose={closeModal}
        open={activeModal === "staff"}
        subtitle={
          editingStaffId
            ? "Update name, phone, role, or salary. Login email stays on Create login / Send reset email."
            : "Create a staff record for drivers, loaders, collection agents, or supervisors."
        }
        title={editingStaffId ? "Edit staff" : "Add staff"}
      >
        <form className="entry-card admin-form admin-modal-form" onSubmit={(event) => void submitStaff(event)}>
          <label>
            Full name
            <input
              onChange={(event) =>
                setStaffForm((current) => {
                  const fullName = event.target.value;
                  if (editingStaffId) {
                    return { ...current, fullName };
                  }
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
                  provisionLogin: editingStaffId ? false : staffRolesWithLogin.has(role)
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
          {staffForm.role === "driver" ? (
            <>
              <label>
                Licence expiry
                <input
                  onChange={(event) =>
                    setStaffForm((current) => ({ ...current, licenceExpiresOn: event.target.value }))
                  }
                  required
                  type="date"
                  value={staffForm.licenceExpiresOn}
                />
              </label>
              {editingStaffId ? (
                <p className="panel-subtitle">
                  Use <strong>Upload licence</strong> on the staff row to attach a photo or PDF. Current card:{" "}
                  {staffForm.licenceImageUrl || "none"}
                </p>
              ) : (
                <p className="panel-subtitle">
                  New drivers start with a placeholder card. After create, use Upload licence on the row to attach the
                  real document.
                </p>
              )}
              {staffForm.licenceImageUrl ? (
                <button
                  className="licence-preview-inline"
                  onClick={() => setLicencePreviewUrl(staffForm.licenceImageUrl)}
                  type="button"
                >
                  <img alt="Driver licence preview" src={staffForm.licenceImageUrl} />
                  <span>Preview licence card</span>
                </button>
              ) : null}
            </>
          ) : null}
          {!editingStaffId && staffRolesWithLogin.has(staffForm.role) ? (
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
              {editingStaffId ? "Save staff" : "Add staff"}
            </button>
          </div>
        </form>
      </AdminModal>

      <AdminModal
        onClose={closeModal}
        open={activeModal === "truck"}
        subtitle={
          editingTruckId
            ? "Update registration, home zone, vehicle details, or fleet status."
            : "Register a fleet asset. Home zone is optional — trucks can cover any route."
        }
        title={editingTruckId ? "Edit truck" : "Add truck"}
      >
        <form className="entry-card admin-form admin-modal-form" onSubmit={(event) => void submitTruck(event)}>
          <label>
            Home zone (optional)
            <select
              onChange={(event) => setTruckForm((current) => ({ ...current, zoneId: event.target.value }))}
              value={truckForm.zoneId}
            >
              <option value="">No home zone</option>
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
              {editingTruckId ? "Save truck" : "Add truck"}
            </button>
          </div>
        </form>
      </AdminModal>

      <AdminModal
        onClose={closeModal}
        open={activeModal === "customer"}
        subtitle={
          editingCustomerId
            ? "Update account details. Moving zone drops this customer from other-zone scheduled stops and templates."
            : "Create a customer account for billing, route planning, and collections."
        }
        title={editingCustomerId ? "Edit customer" : "Add customer"}
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
              onChange={(event) => {
                const customerType = event.target.value as CustomerType;
                setCustomerForm((current) => ({
                  ...current,
                  customerType,
                  collectionsPerWeek: editingCustomerId
                    ? current.collectionsPerWeek
                    : defaultCollectionsPerWeek(customerType),
                  preferredWeekdays: editingCustomerId
                    ? current.preferredWeekdays
                    : defaultPreferredWeekdays(customerType)
                }));
              }}
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
            Collections per week
            <input
              max="7"
              min="1"
              onChange={(event) =>
                setCustomerForm((current) => ({
                  ...current,
                  collectionsPerWeek: Math.min(7, Math.max(1, Number(event.target.value) || 1))
                }))
              }
              required
              type="number"
              value={customerForm.collectionsPerWeek}
            />
          </label>
          <fieldset className="weekday-fieldset">
            <legend>Preferred weekdays</legend>
            <p className="panel-subtitle">
              Residential floor: 1×/week. Commercial frequency is agreed after site evaluation.
            </p>
            <div className="weekday-checkboxes">
              {WEEKDAY_OPTIONS.map((day) => {
                const checked = customerForm.preferredWeekdays.includes(day.value);
                return (
                  <label className="weekday-option" key={day.value}>
                    <input
                      checked={checked}
                      onChange={() =>
                        setCustomerForm((current) => {
                          const preferredWeekdays = checked
                            ? current.preferredWeekdays.filter((value) => value !== day.value)
                            : [...current.preferredWeekdays, day.value].sort((a, b) => a - b);
                          return {
                            ...current,
                            preferredWeekdays:
                              preferredWeekdays.length > 0 ? preferredWeekdays : current.preferredWeekdays
                          };
                        })
                      }
                      type="checkbox"
                    />
                    {day.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label>
            Frequency notes
            <input
              onChange={(event) => setCustomerForm((current) => ({ ...current, frequencyNotes: event.target.value }))}
              placeholder="Optional site-evaluation notes"
              value={customerForm.frequencyNotes}
            />
          </label>
          {!editingCustomerId ? (
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
          ) : (
            <p className="panel-subtitle">Use Suspend / Reactivate on the list to change service status.</p>
          )}
          {customerFormError ? <p className="inline-error">{customerFormError}</p> : null}
          <div className="button-row">
            <button className="primary-button" type="submit">
              {editingCustomerId ? "Save customer" : "Add customer"}
            </button>
          </div>
        </form>
      </AdminModal>

      <LicenceUploadDialog
        driverName={licenceUploadStaff?.fullName ?? "Driver"}
        initialExpiresOn={licenceUploadStaff?.licenceExpiresOn?.slice(0, 10) ?? ""}
        initialImageUrl={licenceUploadStaff?.licenceImageUrl ?? null}
        onClose={() => setLicenceUploadStaff(null)}
        onUpload={async ({ licenceExpiresOn, file }) => {
          if (!licenceUploadStaff) {
            throw new Error("No driver selected for licence upload.");
          }

          if (!operatorId) {
            throw new Error("Operator context is required to upload licence documents.");
          }

          setLicenceUploadError(null);
          const publicUrl = await uploadDriverLicenceDocument({
            operatorId,
            staffId: licenceUploadStaff.id,
            file
          });
          await onUpdateStaff({
            staffId: licenceUploadStaff.id,
            fullName: licenceUploadStaff.fullName,
            phone: licenceUploadStaff.phone,
            role: licenceUploadStaff.role,
            monthlySalaryKobo: licenceUploadStaff.monthlySalaryKobo,
            licenceExpiresOn,
            licenceImageUrl: publicUrl
          });
        }}
        open={Boolean(licenceUploadStaff)}
      />
      {licenceUploadError ? <p className="inline-error">{licenceUploadError}</p> : null}

      <AdminModal
        onClose={() => setLicencePreviewUrl(null)}
        open={Boolean(licencePreviewUrl)}
        subtitle="Pilot mock card or uploaded document."
        title="Driver licence"
      >
        {licencePreviewUrl ? (
          <div className="licence-preview-card">
            <img alt="Driver licence" src={licencePreviewUrl} />
          </div>
        ) : null}
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
