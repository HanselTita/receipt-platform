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
  } | null;
};

/*
 * ============================================================
 * PAYUNIT CHECKOUT STATUS
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

type PayUnitCheckoutTransaction = {
  id?: number;

  transaction_id?: string;

  card_payment_url?: string | null;

  amount?: number | string;

  currency?: string;

  mode?: string;

  username?: string;

  message?: string | null;

  status?: PayUnitTransactionStatus | string;

  updated_at?: string;

  created_at?: string;

  deleted_at?: string | null;
};

type PayUnitStatusResponse = {
  status?: string;

  statusCode?: number;

  message?: string;

  data?: {
    id?: number;

    /*
     * PayUnit-generated checkout identifier.
     *
     * Example:
     * PU_payment_8da2310b-a9d5-4c9c-836e-9cc13b718939
     */
    checkout_id?: string;

    /*
     * SwiftReceipt's merchant transaction ID supplied during
     * checkout initialization.
     */
    transaction_id?: string;

    mode?: string;

    checkout_mode?: string;

    status?: PayUnitTransactionStatus | string;

    phone_number_collection?: boolean;

    address_collection?: boolean;

    notify_url?: string | null;

    checkout_card_redirect_url?: string | null;

    cancel_url?: string | null;

    success_url?: string | null;

    total_amount?: number | string;

    currency?: string;

    updated_at?: string;

    transaction?: PayUnitCheckoutTransaction | null;
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

            /*
             * This is the checkout mode.
             * It is different from the test/live HTTP header.
             */
            mode: 'payment',

            /*
             * SwiftReceipt's own unique payment reference.
             *
             * Example:
             * SWRMU0YAA11CA6F507E
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

                  /*
                   * PayUnit requires an HTTPS image URL.
                   *
                   * Replace this later with a permanent
                   * SwiftReceipt product/logo image.
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
      console.error('PayUnit initialization network error', {
        reference: input.reference,

        message:
          error instanceof Error ? error.message : 'Unknown network error',
      });

      throw new BadGatewayException('Unable to connect to PayUnit.');
    }

    const responseBody =
      await this.readJsonResponse<PayUnitInitializeResponse>(response);

    /*
     * PayUnit should return a successful top-level status
     * when checkout creation succeeds.
     */
    if (
      !response.ok ||
      responseBody?.status?.trim().toUpperCase() !== 'SUCCESS'
    ) {
      console.error('PayUnit initialization failed', {
        reference: input.reference,

        httpStatus: response.status,

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

    /*
     * ============================================================
     * EXTRACT PAYUNIT CHECKOUT ID
     * ============================================================
     *
     * PayUnit Checkout initialization returns a redirect URL such as:
     *
     * https://.../PU_payment_ea7159f0-1075-4c48-ac5a-7c92f60cac0c
     *
     * The final path segment is the checkout ID required by:
     *
     * GET /api/gateway/checkout/status/{checkout_ID}
     *
     * We must save this value in providerTransactionId.
     */

    const checkoutId = this.extractCheckoutId(checkoutUrl);

    if (!checkoutId) {
      console.error('Unable to determine PayUnit checkout ID', {
        reference: input.reference,

        checkoutUrl,
      });

      throw new BadGatewayException(
        'PayUnit returned an invalid checkout identifier.',
      );
    }

    console.log('PayUnit checkout initialized', {
      reference: input.reference,

      checkoutId,
    });

    return {
      checkoutUrl,

      /*
       * providerReference remains SwiftReceipt's merchant reference.
       */
      providerReference: input.reference,

      /*
       * IMPORTANT:
       *
       * providerTransactionId stores PayUnit's generated
       * PU_payment_... checkout ID.
       */
      providerTransactionId: checkoutId,
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
     * Checkout Status does NOT expect SwiftReceipt's
     * SWR... reference in the URL.
     *
     * It expects PayUnit's generated checkout ID:
     *
     * PU_payment_...
     */
    const checkoutId = input.providerTransactionId?.trim();

    if (!checkoutId) {
      console.error('Cannot verify PayUnit checkout: checkout ID missing', {
        reference: input.reference,

        providerReference: input.providerReference ?? null,
      });

      throw new BadGatewayException(
        'PayUnit checkout ID is missing for this payment.',
      );
    }

    if (!checkoutId.startsWith('PU_')) {
      console.error('Invalid PayUnit checkout ID', {
        reference: input.reference,
        checkoutId,
      });

      throw new BadGatewayException(
        'Stored PayUnit checkout identifier is invalid.',
      );
    }

    let response: Response;

    try {
      response = await fetch(
        `${this.baseUrl}/api/gateway/checkout/status/${encodeURIComponent(
          checkoutId,
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
        reference: input.reference,

        checkoutId,

        message:
          error instanceof Error ? error.message : 'Unknown network error',
      });

      throw new BadGatewayException('Unable to verify payment with PayUnit.');
    }

    const responseBody =
      await this.readJsonResponse<PayUnitStatusResponse>(response);

    /*
     * Keep this while PayUnit integration is being tested.
     *
     * No credentials are written to the log.
     */
    console.log('PayUnit verification response', {
      reference: input.reference,

      checkoutId,

      requestStatus: responseBody?.status ?? null,

      checkoutStatus: responseBody?.data?.status ?? null,

      transactionStatus: responseBody?.data?.transaction?.status ?? null,

      returnedCheckoutId: responseBody?.data?.checkout_id ?? null,

      returnedTransactionId: responseBody?.data?.transaction_id ?? null,
    });

    /*
     * HTTP-level error means PayUnit could not complete
     * the status request.
     */
    if (!response.ok) {
      console.error('PayUnit checkout status HTTP failure', {
        reference: input.reference,

        checkoutId,

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
     * PayUnit's top-level status tells us whether the API request
     * itself succeeded.
     *
     * It does NOT necessarily mean the customer payment succeeded.
     */
    const requestStatus = responseBody?.status?.trim().toUpperCase();

    if (requestStatus && requestStatus !== 'SUCCESS') {
      console.error('PayUnit checkout status request rejected', {
        reference: input.reference,

        checkoutId,

        responseBody,
      });

      throw new BadGatewayException(
        responseBody?.message ||
          'PayUnit rejected the payment verification request.',
      );
    }

    /*
     * If PayUnit returns no checkout data, do not mark the
     * subscription successful.
     *
     * Keep it unresolved.
     */
    if (!responseBody?.data) {
      console.warn(
        'PayUnit checkout status succeeded but returned no checkout data',
        {
          reference: input.reference,

          checkoutId,
        },
      );

      return {
        successful: false,

        amount: '0',

        currency: '',

        providerTransactionId: checkoutId,

        providerReference: input.providerReference ?? input.reference,

        rawStatus: 'PENDING',
      };
    }

    const data = responseBody.data;

    /*
     * ============================================================
     * PAYMENT STATUS
     * ============================================================
     *
     * Checkout API returns payment state in data.status.
     *
     * The nested transaction may also contain a status.
     *
     * Prefer checkout status because we are querying the
     * Checkout Status API.
     */
    const checkoutStatus = data.status?.trim().toUpperCase();

    const nestedTransactionStatus = data.transaction?.status
      ?.trim()
      .toUpperCase();

    const rawStatus = checkoutStatus ?? nestedTransactionStatus ?? 'PENDING';

    /*
     * Never infer success from:
     *
     * responseBody.status === SUCCESS
     *
     * That only tells us that the API request succeeded.
     *
     * Customer payment success comes from the checkout itself.
     */
    const successful = rawStatus === 'SUCCESS';

    /*
     * ============================================================
     * AMOUNT
     * ============================================================
     */

    const amount =
      data.total_amount !== undefined && data.total_amount !== null
        ? String(data.total_amount)
        : data.transaction?.amount !== undefined &&
            data.transaction?.amount !== null
          ? String(data.transaction.amount)
          : '0';

    /*
     * ============================================================
     * CURRENCY
     * ============================================================
     */

    const currency =
      data.currency?.trim().toUpperCase() ??
      data.transaction?.currency?.trim().toUpperCase() ??
      '';

    /*
     * ============================================================
     * IDENTIFIERS
     * ============================================================
     */

    const returnedCheckoutId = data.checkout_id?.trim() || checkoutId;

    /*
     * PayUnit data.transaction_id is the merchant transaction ID
     * supplied when initialization was performed.
     *
     * That should correspond to SwiftReceipt's payment reference.
     */
    const providerReference =
      data.transaction_id?.trim() || input.providerReference || input.reference;

    return {
      successful,

      amount,

      currency,

      /*
       * Always preserve PayUnit's PU_payment_... checkout ID.
       */
      providerTransactionId: returnedCheckoutId,

      /*
       * Preserve SwiftReceipt merchant transaction reference.
       */
      providerReference,

      rawStatus,
    };
  }

  /*
   * ============================================================
   * EXTRACT CHECKOUT ID
   * ============================================================
   */

  private extractCheckoutId(checkoutUrl: string): string | null {
    /*
     * First try proper URL parsing.
     */
    try {
      const parsedUrl = new URL(checkoutUrl);

      const pathParts = parsedUrl.pathname
        .split('/')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

      const candidate = pathParts[pathParts.length - 1];

      if (candidate?.startsWith('PU_')) {
        return candidate;
      }
    } catch (error) {
      console.warn('Unable to parse PayUnit checkout URL normally', {
        checkoutUrl,

        message:
          error instanceof Error ? error.message : 'Unknown URL parsing error',
      });
    }

    /*
     * Fallback:
     *
     * Search the URL directly for a PU_payment_ identifier.
     *
     * This protects us if PayUnit slightly changes the checkout
     * URL structure while keeping the checkout identifier.
     */
    const match = checkoutUrl.match(/PU_[A-Za-z0-9_-]+/);

    return match?.[0] ?? null;
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
      console.error('PayUnit returned a non-JSON response', {
        httpStatus: response.status,

        message:
          error instanceof Error ? error.message : 'Unknown JSON parsing error',
      });

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

    const mode = this.configService
      .get<string>('PAYUNIT_MODE', 'test')
      .trim()
      .toLowerCase();

    if (mode !== 'test' && mode !== 'live') {
      throw new InternalServerErrorException(
        'PAYUNIT_MODE must be either "test" or "live".',
      );
    }

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

    if (!value?.trim()) {
      throw new InternalServerErrorException(`${name} is not configured.`);
    }

    return value.trim();
  }
}
