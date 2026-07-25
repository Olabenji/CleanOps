import type { DriverStopAction, RouteDetail, RouteStopStatus } from "@cleanops/shared";
import { getOperationDate } from "@cleanops/shared";

export const pilotDriver = {
  fullName: "Adewale Johnson",
  phone: "+2348000000201",
  truckRegistration: "LAG-001-PSP"
};

export const pilotDriverRoute: RouteDetail = {
  id: "00000000-0000-4000-8000-000000000501",
  zoneName: "Ward A",
  truckRegistration: "LAG-001-PSP",
  driverName: pilotDriver.fullName,
  status: "in_progress",
  completedStops: 2,
  totalStops: 5,
  delayed: false,
  scheduledDate: getOperationDate(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  stops: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      customerName: "Mrs. Folake Adebayo",
      address: "14 Akinwunmi Street, Surulere",
      stopSequence: 1,
      status: "completed",
      completedAt: new Date().toISOString(),
      notes: null,
      skipReason: null,
      serviceStatus: "active"
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      customerName: "Mr. Tunde Lawal",
      address: "16 Akinwunmi Street, Surulere",
      stopSequence: 2,
      status: "completed",
      completedAt: new Date().toISOString(),
      notes: null,
      skipReason: null,
      serviceStatus: "active"
    },
    {
      id: "10000000-0000-4000-8000-000000000003",
      customerName: "Tasty Bites Eatery",
      address: "22 Market Road, Surulere",
      stopSequence: 3,
      status: "pending",
      completedAt: null,
      notes: null,
      skipReason: null,
      serviceStatus: "active"
    },
    {
      id: "10000000-0000-4000-8000-000000000004",
      customerName: "Blue Gate Mini Mart",
      address: "25 Market Road, Surulere",
      stopSequence: 4,
      status: "pending",
      completedAt: null,
      notes: null,
      skipReason: null,
      serviceStatus: "suspended"
    },
    {
      id: "10000000-0000-4000-8000-000000000005",
      customerName: "Block C Residents Association",
      address: "Block C Estate, Surulere",
      stopSequence: 5,
      status: "pending",
      completedAt: null,
      notes: null,
      skipReason: null,
      serviceStatus: "active"
    }
  ]
};

export function createStopAction(
  routeId: string,
  stopId: string,
  status: RouteStopStatus,
  note?: string,
  skipReason?: string,
  proof?: {
    latitude?: number | null;
    longitude?: number | null;
    proofPhotoPath?: string | null;
    localPhotoUri?: string;
  }
): DriverStopAction {
  return {
    id: `${Date.now()}-${stopId}`,
    routeId,
    stopId,
    status,
    note: note?.trim() || undefined,
    skipReason: skipReason?.trim() || undefined,
    latitude: proof?.latitude ?? null,
    longitude: proof?.longitude ?? null,
    proofPhotoPath: proof?.proofPhotoPath ?? null,
    localPhotoUri: proof?.localPhotoUri,
    queuedAt: new Date().toISOString(),
    syncedAt: null
  };
}
