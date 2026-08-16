export type InitializePaymentInput = {
  reference: string;
  amount: string;
  currency: string;

  customer: {
    email: string;
    name: string;
    phone?: string | null;
  };

  description: string;

  metadata?: Record<string, string>;
};

export type InitializePaymentResult = {
  providerTransactionId?: string | null;
  providerReference?: string | null;
  checkoutUrl: string;
};

export type VerifyPaymentInput = {
  reference: string;
  providerTransactionId?: string | null;
  providerReference?: string | null;
};

export type VerifiedPaymentResult = {
  successful: boolean;

  amount: string;
  currency: string;

  providerTransactionId?: string | null;
  providerReference?: string | null;

  rawStatus?: string | null;
};

export interface PaymentProviderAdapter {
  initializePayment(
    input: InitializePaymentInput,
  ): Promise<InitializePaymentResult>;

  verifyPayment(input: VerifyPaymentInput): Promise<VerifiedPaymentResult>;
}
