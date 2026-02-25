// x402 — type definitions for the "exact" scheme on EVM (Base Mainnet)
// Spec: https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md

export interface PaymentRequirement {
  scheme: 'exact';
  network: string;           // "eip155:8453" = Base Mainnet
  maxAmountRequired: string; // "10000" = $0.01 USDC (6 decimals)
  resource: string;          // the endpoint URL being paid for
  description: string;
  mimeType: string;
  payTo: string;             // receiver wallet address
  maxTimeoutSeconds: number;
  asset: string;             // token contract (USDC on Base)
  extra: {
    name: string;            // "USDC"
    version: string;         // "2"
  };
}

// Sent by server in X-PAYMENT-REQUIRED header (base64 JSON) on 402 response
export interface PaymentRequired {
  x402Version: 2;
  accepts: PaymentRequirement[];
  error: string;
}

// EIP-3009 authorization (transferWithAuthorization)
export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

// Sent by client in X-PAYMENT header (base64 JSON) on retry
export interface PaymentPayload {
  x402Version: 2;
  scheme: 'exact';
  network: string;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepted: PaymentRequirement;
  payload: {
    signature: string;
    authorization: Eip3009Authorization;
  };
}

export interface FacilitatorVerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface FacilitatorSettleResponse {
  success: boolean;
  txHash?: string;
  error?: string;
}
