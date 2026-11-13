export type PageId =
  | 'home'
  | 'repairs'
  | 'clients'
  | 'repuestos'
  | 'inventory'
  | 'agenda'
  | 'suppliers'
  | 'sales'
  | 'purchases'
  | 'reports';

export type RepairStatus =
  | 'recibido'
  | 'diagnostico'
  | 'espera_repuesto'
  | 'en_progreso'
  | 'listo'
  | 'entregado';

export type PriorityLevel = 'alta' | 'media' | 'baja';

export type DeviceType =
  | 'Celular'
  | 'Tablet'
  | 'Notebook'
  | 'Parlante'
  | 'PC de escritorio'
  | 'Consola / joystick'
  | 'Smartwatch'
  | 'Auriculares'
  | 'Otros equipos';

export interface WorkshopProfile {
  id: string;
  ownerId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role: string;
  brandName: string;
  subtitle?: string;
  businessPhone?: string;
  businessAddress?: string;
  wordColors?: string[];
  logoDataUrl?: string;
  logoScale?: number;
  logoTransparent?: boolean;
  receiptTerms?: string;
  trackingBaseUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClientRecord {
  id: string;
  ownerId: string;
  name: string;
  phone?: string;
  dni?: string;
  email?: string;
  address?: string;
  notes?: string;
  createdAt: number;
}

export interface RepairRecord {
  id: string;
  ownerId: string;
  code: string;
  trackingCode: string;
  clientId?: string;
  clientName: string;
  clientPhone?: string;
  clientDni?: string;
  clientEmail?: string;
  clientAddress?: string;
  deviceType: string;
  deviceIcon?: string;
  brand: string;
  model: string;
  color?: string;
  capacity?: string;
  imei?: string;
  problem: string;
  priority: string;
  status: string;
  progress: number;
  dateIn: string;
  dateEst?: string;
  price: number;
  deposit: number;
  paidAmount?: number;
  paymentStatus?: string;
  partIds?: string[];
  partNames?: string[];
  accessories?: string[];
  consoleAccessories?: Record<string, string>;
  physicalCheck?: Record<string, string>;
  functionalCheck?: Record<string, string>;
  securityType?: string;
  securityPin?: string;
  securityPattern?: number[];
  notes?: string;
  workDetail?: string;
  checkoutState?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PublicTicketRecord {
  id: string;
  ownerId: string;
  repairId: string;
  trackingCode: string;
  repairCode: string;
  businessName: string;
  businessPhone?: string;
  deviceType: string;
  brand: string;
  model: string;
  status: string;
  progress: number;
  dateIn: string;
  dateEst?: string;
  problemSummary: string;
  workDetail?: string;
  price: number;
  deposit: number;
  updatedAt: number;
}

export interface ProductRecord {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  metaDescription?: string;
  productType: string;
  imageDataUrl?: string;
  category: string;
  subcategory?: string;
  brand?: string;
  supplierId?: string;
  supplierName?: string;
  sku?: string;
  barcode?: string;
  location?: string;
  internalCode?: string;
  cost: number;
  marginMode: string;
  margin: number;
  vat: number;
  rounding: number;
  netPrice: number;
  price: number;
  trackStock: boolean;
  allowNoStock: boolean;
  usesSerial: boolean;
  stock: number;
  minStock: number;
  reorderCap?: number;
  weight?: number;
  height?: number;
  width?: number;
  depth?: number;
  createdAt: number;
}

export interface TaskRecord {
  id: string;
  ownerId: string;
  title: string;
  taskType: string;
  priority: string;
  assignee?: string;
  dueDate?: string;
  status: string;
  notes?: string;
  createdAt: number;
}

export interface SupplierRecord {
  id: string;
  ownerId: string;
  name: string;
  category: string;
  contact?: string;
  phone?: string;
  email?: string;
  leadTime?: string;
  balance: number;
  createdAt: number;
}

export interface SaleRecord {
  id: string;
  ownerId: string;
  clientId?: string;
  clientName: string;
  invoice: string;
  productId?: string;
  productName?: string;
  quantity?: number;
  amount: number;
  status: string;
  dueDate?: string;
  createdAt: number;
}

export interface PurchaseRecord {
  id: string;
  ownerId: string;
  supplierId?: string;
  supplierName: string;
  invoice: string;
  amount: number;
  status: string;
  dueDate?: string;
  createdAt: number;
}
