import { Injectable, NotImplementedException } from '@nestjs/common';

import type { PaymentProvider } from '../../generated/prisma/client';

import type { PaymentProviderAdapter } from './payment-provider.interface';

@Injectable()
export class PaymentProviderRegistry {
  private readonly providers = new Map<
    PaymentProvider,
    PaymentProviderAdapter
  >();

  register(provider: PaymentProvider, adapter: PaymentProviderAdapter): void {
    this.providers.set(provider, adapter);
  }

  get(provider: PaymentProvider): PaymentProviderAdapter {
    const adapter = this.providers.get(provider);

    if (!adapter) {
      throw new NotImplementedException(
        `Payment provider ${provider} is not configured.`,
      );
    }

    return adapter;
  }
}
