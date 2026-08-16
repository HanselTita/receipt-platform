import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  InitializePaymentInput,
  InitializePaymentResult,
  PaymentProviderAdapter,
  VerifiedPaymentResult,
  VerifyPaymentInput,
} from '../payment-provider.interface';

type PayUnitInitializeResponse = {
  status?: string;
  statusCode?: number;
  message?: string;

  data?: {
    redirect?: string;
  };
};

type PayUnitStatusResponse = {
  status?: string;
  statusCode?: number;
  message?: string;

  data?: {
    transaction_amount?: number | string;
    transaction_status?: 'PENDING' | 'FAILED' | 'CANCELLED' | 'SUCCESS';

    transaction_id?: string;

    transaction_currency?: string;

    transaction_gateway?: string | null;

    purchaseRef?: string | null;
  };
};

@Injectable()
export class PayUnitProvider implements PaymentProviderAdapter {
  private readonly baseUrl = 'https://gateway.payunit.net';

  constructor(private readonly configService: ConfigService) {}

  async initializePayment(
    input: InitializePaymentInput,
  ): Promise<InitializePaymentResult> {
    const credentials = this.getCredentials();

    const successUrl = this.getRequiredConfig('PAYUNIT_SUCCESS_URL');

    const cancelUrl = this.getRequiredConfig('PAYUNIT_CANCEL_URL');

    const notifyUrl = this.getRequiredConfig('PAYUNIT_NOTIFY_URL');

    const amount = Number(input.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new InternalServerErrorException('Invalid payment amount.');
    }

    let response: Response;

    try {
      response = await fetch(
        `${this.baseUrl}/api/gateway/checkout/initialize`,
        {
          method: 'POST',

          headers: {
            Authorization: credentials.authorization,

            'x-api-key': credentials.applicationToken,

            mode: credentials.mode,

            Accept: 'application/json',

            'Content-Type': 'application/json',
          },

          body: JSON.stringify({
            cancel_url: cancelUrl,

            success_url: successUrl,

            notify_url: notifyUrl,

            currency: input.currency,

            mode: 'payment',

            transaction_id: input.reference,

            total_amount: amount,

            items: [
              {
                price_description: {
                  unit_amount: amount,
                },

                product_description: {
                  name: input.description,

                  /*
                   * PayUnit's checkout schema expects an image_url.
                   *
                   * Replace this later with SwiftReceipt's public
                   * logo URL.
                   */
                  image_url: 'https://via.placeholder.com/512',

                  about_product: input.description,
                },

                quantity: 1,
              },
            ],

            meta: {
              phone_number_collection: true,

              address_collection: false,
            },
          }),
        },
      );
    } catch (error) {
      console.error('PayUnit initialization network error:', error);

      throw new BadGatewayException('Unable to connect to PayUnit.');
    }

    let responseBody: PayUnitInitializeResponse | undefined;

    try {
      responseBody = (await response.json()) as PayUnitInitializeResponse;
    } catch {
      responseBody = undefined;
    }

    if (!response.ok || responseBody?.status !== 'SUCCESS') {
      console.error('PayUnit initialization failed:', responseBody);

      throw new BadGatewayException(
        responseBody?.message || 'Unable to initialize PayUnit payment.',
      );
    }

    const checkoutUrl = responseBody.data?.redirect;

    if (!checkoutUrl) {
      throw new BadGatewayException('PayUnit did not return a checkout URL.');
    }

    return {
      checkoutUrl,

      providerReference: input.reference,

      providerTransactionId: null,
    };
  }

  async verifyPayment(
    input: VerifyPaymentInput,
  ): Promise<VerifiedPaymentResult> {
    const credentials = this.getCredentials();

    const transactionId = input.providerReference ?? input.reference;

    let response: Response;

    try {
      response = await fetch(
        `${this.baseUrl}/api/gateway/paymentstatus/${encodeURIComponent(
          transactionId,
        )}`,
        {
          method: 'GET',

          headers: {
            Authorization: credentials.authorization,

            'x-api-key': credentials.applicationToken,

            mode: credentials.mode,

            Accept: 'application/json',

            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      console.error('PayUnit verification network error:', error);

      throw new BadGatewayException('Unable to verify payment with PayUnit.');
    }

    let responseBody: PayUnitStatusResponse | undefined;

    try {
      responseBody = (await response.json()) as PayUnitStatusResponse;
    } catch {
      responseBody = undefined;
    }

    if (!response.ok || !responseBody?.data) {
      console.error('PayUnit verification failed:', responseBody);

      throw new BadGatewayException(
        responseBody?.message || 'Unable to verify PayUnit payment.',
      );
    }

    const status = responseBody.data.transaction_status;

    return {
      successful: status === 'SUCCESS',

      amount: String(responseBody.data.transaction_amount ?? '0'),

      currency: responseBody.data.transaction_currency ?? '',

      providerTransactionId: responseBody.data.transaction_id ?? null,

      providerReference: input.reference,

      rawStatus: status ?? null,
    };
  }

  private getCredentials() {
    const apiUser = this.getRequiredConfig('PAYUNIT_API_USER');

    const apiPassword = this.getRequiredConfig('PAYUNIT_API_PASSWORD');

    const applicationToken = this.getRequiredConfig(
      'PAYUNIT_APPLICATION_TOKEN',
    );

    const mode = this.configService.get<string>('PAYUNIT_MODE', 'test');

    const encodedCredentials = Buffer.from(
      `${apiUser}:${apiPassword}`,
    ).toString('base64');

    return {
      authorization: `Basic ${encodedCredentials}`,

      applicationToken,

      mode,
    };
  }

  private getRequiredConfig(name: string): string {
    const value = this.configService.get<string>(name);

    if (!value) {
      throw new InternalServerErrorException(`${name} is not configured.`);
    }

    return value;
  }
}
