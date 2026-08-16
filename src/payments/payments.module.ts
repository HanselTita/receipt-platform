import { Module, OnModuleInit } from '@nestjs/common';

import { PaymentProviderRegistry } from './payment-provider.registry';
import { PayUnitProvider } from './payunit/payunit.provider';

@Module({
  providers: [PaymentProviderRegistry, PayUnitProvider],

  exports: [PaymentProviderRegistry],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly payUnitProvider: PayUnitProvider,
  ) {}

  onModuleInit(): void {
    this.paymentProviderRegistry.register('PAYUNIT', this.payUnitProvider);
  }
}
