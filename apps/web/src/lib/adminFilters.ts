import type { AdminCustomer, AdminStaff, AdminTruck } from "@cleanops/shared";

function matchesQuery(query: string, values: Array<string | null | undefined>) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  return values.some((value) => (value ?? "").toLowerCase().includes(normalized));
}

export type StaffAdminFilters = {
  query: string;
  role: string;
  active: string;
};

export type TruckAdminFilters = {
  query: string;
  zoneId: string;
  status: string;
  active: string;
};

export type CustomerAdminFilters = {
  query: string;
  zoneId: string;
  customerType: string;
  serviceStatus: string;
};

export function filterAdminStaff(staff: AdminStaff[], filters: StaffAdminFilters) {
  return staff.filter((member) => {
    if (filters.role && member.role !== filters.role) {
      return false;
    }

    if (filters.active === "active" && !member.active) {
      return false;
    }

    if (filters.active === "inactive" && member.active) {
      return false;
    }

    return matchesQuery(filters.query, [member.fullName, member.phone, member.role.replace("_", " ")]);
  });
}

export function filterAdminTrucks(trucks: AdminTruck[], filters: TruckAdminFilters) {
  return trucks.filter((truck) => {
    if (filters.zoneId && truck.zoneId !== filters.zoneId) {
      return false;
    }

    if (filters.status && truck.status !== filters.status) {
      return false;
    }

    if (filters.active === "active" && !truck.active) {
      return false;
    }

    if (filters.active === "inactive" && truck.active) {
      return false;
    }

    return matchesQuery(filters.query, [
      truck.registrationNumber,
      truck.zoneName,
      truck.make,
      truck.model,
      truck.year?.toString(),
      truck.status
    ]);
  });
}

export function filterAdminCustomers(customers: AdminCustomer[], filters: CustomerAdminFilters) {
  return customers.filter((customer) => {
    if (filters.zoneId && customer.zoneId !== filters.zoneId) {
      return false;
    }

    if (filters.customerType && customer.customerType !== filters.customerType) {
      return false;
    }

    if (filters.serviceStatus && customer.serviceStatus !== filters.serviceStatus) {
      return false;
    }

    return matchesQuery(filters.query, [
      customer.displayName,
      customer.phone,
      customer.address,
      customer.zoneName,
      customer.customerType.replace("_", " ")
    ]);
  });
}
