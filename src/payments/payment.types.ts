import type { PaymentProvider } from '../../generated/prisma/client';

export type PaymentProviderName = PaymentProvider;

export type PaymentProviderContext = {
  provider: PaymentProviderName;
};
