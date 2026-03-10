import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const api = axios.create({
  baseURL: process.env.API_BASE_URL,
});

export interface CreateFeedbackPayload {
  customerName?: string;
  staffId?: number;
  locationId: number;
  qrCodeToken?: string;
  foundWhatWanted: boolean;
  gotEnoughInfo: boolean;
  staffRating: number;
  telegramChatId?: string;
  additionalComments?: string;
}

export const submitFeedback = (payload: CreateFeedbackPayload) => {
  return api.post('/feedbacks', payload);
};

export interface QrCodeValidationResult {
  isValid: boolean;
  qrCode?: {
    id: number;
    locationId: number;
    staffId?: number;
    type: 'location' | 'staff';
    location?: {
      id: number;
      name: string;
      address?: string;
    };
    staff?: {
      id: number;
      name: string;
      position: string;
    };
  };
}

export const validateQrCode = (token: string): Promise<{ data: QrCodeValidationResult }> => {
  return api.get(`/qrcodes/validate/${token}`);
};

export interface StaffMember {
  id: number;
  name: string;
  position: string;
  locationId: number;
}

export const getStaffByLocation = (locationId: number): Promise<{ data: StaffMember[] }> => {
  return api.get(`/qrcodes/location/${locationId}/staff`);
};

export interface Customer {
  id: number;
  telegramChatId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phoneNumber?: string;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface CreateCustomerPayload {
  telegramChatId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phoneNumber?: string;
}

export const findOrCreateCustomer = (payload: CreateCustomerPayload): Promise<{ data: Customer }> => {
  return api.post('/customers/find-or-create', payload);
};

export const checkUser = (telegramChatId: string): Promise<{ data: Customer | null }> => {
  return api.get(`/customers/check-user/${telegramChatId}`);
};