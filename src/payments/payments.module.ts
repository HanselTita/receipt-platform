import { Module } from '@nestjs/common';

import { PaymentProviderRegistry } from './payment-provider.registry';

@Module({
  providers: [PaymentProviderRegistry],

  exports: [PaymentProviderRegistry],
})
export class PaymentsModule {}
