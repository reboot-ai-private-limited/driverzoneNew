/**
 * `react-native-razorpay` ships no types of its own. Declared narrowly to exactly the shape this
 * app actually calls — `key` and `order_id` from `SelectPaymentMethodResponse`
 * (`public_key`/`client_token`), everything else optional checkout dressing.
 *
 * `open()` resolves with the three fields Razorpay hands back on success and rejects with
 * `{ code, description }` on a cancelled or failed checkout — README-documented, not guessed.
 * NEITHER SIDE IS TRUSTED FOR CONFIRMATION: `apps/api/src/modules/payments/infrastructure/
 * razorpay.gateway.ts`'s own comment is explicit that only the server-verified webhook confirms a
 * payment. A resolved `open()` here means only "the checkout flow finished without the user
 * backing out" — it is a cue to refetch the booking sooner, never proof of payment on its own.
 */
declare module 'react-native-razorpay' {
  export interface RazorpayCheckoutOptions {
    key: string;
    /** Paise, matching `SelectPaymentMethodResponse.amount.amount_paise`. */
    amount: number;
    currency?: string;
    name: string;
    description?: string;
    order_id: string;
    image?: string;
    prefill?: {
      email?: string;
      contact?: string;
      name?: string;
    };
    theme?: {
      color?: string;
    };
  }

  export interface RazorpaySuccessResult {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }

  export interface RazorpayFailureResult {
    code: number;
    description: string;
  }

  interface RazorpayCheckout {
    open(options: RazorpayCheckoutOptions): Promise<RazorpaySuccessResult>;
  }

  const instance: RazorpayCheckout;
  export default instance;
}
