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

/*
 * ============================================================
 * PAYUNIT INITIALIZE RESPONSE
 * ============================================================
 */

type PayUnitInitializeResponse = {
  status?: string;
  statusCode?: number;
  message?: string;

  data?: {
    redirect?: string;
  };
};

/*
 * ============================================================
 * PAYUNIT STATUS RESPONSE
 * ============================================================
 */

type PayUnitTransactionStatus =
  | 'INITIATE'
  | 'INITIATED'
  | 'PENDING'
  | 'PROCESSING'
  | 'FAILED'
  | 'CANCELLED'
  | 'CANCELED'
  | 'SUCCESS';

type PayUnitStatusResponse = {
  status?: string;

  statusCode?: number;

  message?: string;

  data?: {
    transaction_amount?: number | string;

    transaction_status?: PayUnitTransactionStatus | string;

    transaction_id?: string;

    transaction_currency?: string;

    transaction_gateway?: string | null;

    purchaseRef?: string | null;

    notify_url?: string | null;

    callback_url?: string | null;

    message?: string | null;
  } | null;
};

@Injectable()
export class PayUnitProvider implements PaymentProviderAdapter {
  private readonly baseUrl = 'https://gateway.payunit.net';

  constructor(private readonly configService: ConfigService) {}

  /*
   * ============================================================
   * INITIALIZE PAYMENT
   * ============================================================
   */

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

            /*
             * This is SwiftReceipt's own transaction ID.
             *
             * PayUnit uses this same value later when querying
             * /paymentstatus/:transactionID.
             */
            transaction_id: input.reference,

            total_amount: amount,

            items: [
              {
                price_description: {
                  unit_amount: amount,
                },

                product_description: {
                  name: input.description,

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
      console.error('PayUnit initialization network error', {
        reference: input.reference,
        message:
          error instanceof Error ? error.message : 'Unknown network error',
      });

      throw new BadGatewayException('Unable to connect to PayUnit.');
    }

    const responseBody =
      await this.readJsonResponse<PayUnitInitializeResponse>(response);

    if (
      !response.ok ||
      responseBody?.status?.trim().toUpperCase() !== 'SUCCESS'
    ) {
      console.error('PayUnit initialization failed', {
        reference: input.reference,
        status: responseBody?.status ?? null,
        statusCode: responseBody?.statusCode ?? null,
        message: responseBody?.message ?? null,
      });

      throw new BadGatewayException(
        responseBody?.message || 'Unable to initialize PayUnit payment.',
      );
    }

    const checkoutUrl = responseBody.data?.redirect;

    if (!checkoutUrl) {
      console.error(
        'PayUnit initialization response contained no redirect URL:',
        responseBody,
      );

      throw new BadGatewayException('PayUnit did not return a checkout URL.');
    }

    return {
      checkoutUrl,

      /*
       * SwiftReceipt's reference is also PayUnit's transaction ID
       * because we supplied it as transaction_id at initialization.
       */
      providerReference: input.reference,

      providerTransactionId: null,
    };
  }

  /*
   * ============================================================
   * VERIFY PAYMENT
   * ============================================================
   */

  async verifyPayment(
    input: VerifyPaymentInput,
  ): Promise<VerifiedPaymentResult> {
    const credentials = this.getCredentials();
    /*
     * PayUnit's payment-status endpoint expects the transaction_id
     * supplied when the payment was initialized.
     *
     * In SwiftReceipt that is input.reference.
     */
    const transactionId = input.reference;

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
      console.error('PayUnit verification network error', {
        transactionId,
        message:
          error instanceof Error ? error.message : 'Unknown network error',
      });

      throw new BadGatewayException('Unable to verify payment with PayUnit.');
    }

    const responseBody =
      await this.readJsonResponse<PayUnitStatusResponse>(response);

    /*
     * Keep this log while integration/KYC testing is ongoing.
     *
     * It will show us the exact PayUnit payload without exposing
     * your API credentials.
     */
    console.log('PayUnit verification response', {
      transactionId,
      requestStatus: responseBody?.status ?? null,
      transactionStatus: responseBody?.data?.transaction_status ?? null,
    });
    /*
     * HTTP-level failure means PayUnit could not process the
     * verification request itself.
     */
    if (!response.ok) {
      console.error('PayUnit status HTTP failure', {
        transactionId,
        httpStatus: response.status,
        providerStatus: responseBody?.status ?? null,
        providerStatusCode: responseBody?.statusCode ?? null,
        message: responseBody?.message ?? null,
      });
      throw new BadGatewayException(
        responseBody?.message ||
          `PayUnit payment verification failed with HTTP ${response.status}.`,
      );
    }

    /*
     * PayUnit normally returns:
     *
     * {
     *   status: "SUCCESS",
     *   statusCode: 200,
     *   message: "...",
     *   data: {
     *     transaction_status: "PENDING|FAILED|CANCELLED|SUCCESS",
     *     ...
     *   }
     * }
     *
     * Top-level SUCCESS means the status request itself succeeded.
     * It does NOT mean the customer payment succeeded.
     */
    const requestStatus = responseBody?.status?.trim().toUpperCase();

    if (requestStatus && requestStatus !== 'SUCCESS') {
      console.error('PayUnit status request rejected:', responseBody);

      throw new BadGatewayException(
        responseBody?.message ||
          'PayUnit rejected the payment verification request.',
      );
    }

    /*
     * Important:
     *
     * A successful PayUnit API request can still return no usable
     * transaction data, particularly while a transaction/application
     * is not fully available for processing.
     *
     * Do not convert the top-level message "Request Successful"
     * into an exception.
     *
     * Treat this as unresolved/PROCESSING instead.
     */
    if (!responseBody?.data) {
      console.warn(
        'PayUnit payment-status request succeeded but returned no transaction data:',
        responseBody,
      );

      return {
        successful: false,

        amount: '0',

        currency: '',

        providerTransactionId: input.providerTransactionId ?? null,

        providerReference: input.providerReference ?? input.reference,

        rawStatus: 'PENDING',
      };
    }

    const data = responseBody.data;

    const rawStatus =
      data.transaction_status?.trim().toUpperCase() ?? 'PENDING';

    /*
     * PayUnit transaction success must be determined exclusively
     * from data.transaction_status.
     */
    const successful = rawStatus === 'SUCCESS';

    const amount =
      data.transaction_amount !== undefined && data.transaction_amount !== null
        ? String(data.transaction_amount)
        : '0';

    const currency = data.transaction_currency?.trim().toUpperCase() ?? '';

    return {
      successful,

      amount,

      currency,

      /*
       * PayUnit documents transaction_id as the merchant's
       * transaction identifier. Preserve it when returned.
       */
      providerTransactionId:
        data.transaction_id ?? input.providerTransactionId ?? null,

      providerReference:
        data.purchaseRef ?? input.providerReference ?? input.reference,

      rawStatus,
    };
  }

  /*
   * ============================================================
   * READ JSON RESPONSE
   * ============================================================
   */

  private async readJsonResponse<T>(
    response: Response,
  ): Promise<T | undefined> {
    try {
      return (await response.json()) as T;
    } catch (error) {
      console.error('PayUnit returned a non-JSON response:', error);

      return undefined;
    }
  }

  /*
   * ============================================================
   * CREDENTIALS
   * ============================================================
   */

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

  /*
   * ============================================================
   * REQUIRED CONFIG
   * ============================================================
   */

  private getRequiredConfig(name: string): string {
    const value = this.configService.get<string>(name);

    if (!value) {
      throw new InternalServerErrorException(`${name} is not configured.`);
    }

    return value;
  }
}
