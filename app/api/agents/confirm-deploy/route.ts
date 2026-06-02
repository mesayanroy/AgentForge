import { NextRequest, NextResponse } from 'next/server';
import * as StellarSdk from '@stellar/stellar-sdk';
import crypto from 'node:crypto';
import {
  persistDeploymentToDatabase,
  logDeploymentEvent,
  validateWalletAddress,
  validateAgentId,
  buildConfirmationTransaction,
} from '@/lib/soroban-deployment';

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;
const VALIDATOR_CONTRACT_ID = process.env.NEXT_PUBLIC_SOROBAN_VALIDATOR_ID || '';

/**
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║            POST /api/agents/confirm-deploy                                ║
 * ║                                                                            ║
 * ║  Final deployment step: User signs confirm_deploy in Freighter wallet     ║
 * ║  which triggers inter-contract call to AgentRegistry.register_agent       ║
 * ║                                                                            ║
 * ║  STEP 3 of deployment flow:                                               ║
 * ║    1. User already signed request_deploy (contains fee info)             ║
 * ║    2. This endpoint builds confirm_deploy with signature proof           ║
 * ║    3. After on-chain execution, agent is stored in database              ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      signed_request_tx_xdr?: string; // Previous request_deploy txn XDR
      signed_tx_xdr?: string; // Backward-compatible alias
      deployer_wallet: string;
      agent_id: string;
      price_xlm: number;
      metadata_hash: string;
      validation_message?: string; // Message that was signed by deployer
      confirmation_message?: string; // Backward-compatible alias
    };

    const signedRequestTxXdr = body.signed_request_tx_xdr || body.signed_tx_xdr || '';
    const validationMessage = body.validation_message || body.confirmation_message || '';
    const { deployer_wallet, agent_id, price_xlm, metadata_hash } = body;

    // ─ Validate input ────────────────────────────────────────────────────
    if (!signedRequestTxXdr || !deployer_wallet || !agent_id || !validationMessage) {
      return NextResponse.json(
        { error: 'Missing required fields: signed_request_tx_xdr, deployer_wallet, agent_id, validation_message' },
        { status: 400 }
      );
    }

    if (!validateWalletAddress(deployer_wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    if (!validateAgentId(agent_id)) {
      return NextResponse.json(
        { error: 'Invalid agent_id (alphanumeric + underscore, max 32 chars)' },
        { status: 400 }
      );
    }

    await logDeploymentEvent('confirm_deploy_requested', agent_id, deployer_wallet, {
      price_xlm,
      metadata_hash,
    });

    const server = new StellarSdk.Horizon.Server(HORIZON_URL);

    // ─ Submit the previous request_deploy transaction if configured ──────
    if (VALIDATOR_CONTRACT_ID) {
      try {
        const tx = StellarSdk.TransactionBuilder.fromXDR(
          signedRequestTxXdr,
          NETWORK_PASSPHRASE
        ) as StellarSdk.Transaction;
        await server.submitTransaction(tx);
        console.log(`[confirm-deploy] request_deploy tx submitted: ${agent_id}`);
      } catch (submitErr) {
        const errMsg = submitErr instanceof Error ? submitErr.message : String(submitErr);
        console.warn(`[confirm-deploy] Request TX submission warning (may already be confirmed): ${errMsg}`);
        // Don't fail here — transaction may already be on-chain
      }

      // Brief wait for Horizon to index the submitted transaction
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // ─ Compute signature_hash (SHA-256 of validation message) ───────────
    // This proves the deployer acknowledged the confirmation terms
    const sigHashBytes = crypto
      .createHash('sha256')
      .update(validationMessage, 'utf8')
      .digest();
    const sigHashHex = sigHashBytes.toString('hex');

    let responseData: {
      status: string;
      agent_id: string;
      deployer_wallet: string;
      signature_hash: string;
      message: string;
      confirm_tx_xdr?: string;
      network_passphrase?: string;
      next_step?: string;
    } = {
      status: 'pending_confirm_signature',
      agent_id,
      deployer_wallet,
      signature_hash: sigHashHex,
      message: 'Sign the confirm_deploy transaction to finalize agent registration on Soroban.',
    };

    // ─ Dev mode: skip on-chain confirmation ──────────────────────────────
    if (!VALIDATOR_CONTRACT_ID) {
      console.warn('[confirm-deploy] NEXT_PUBLIC_SOROBAN_VALIDATOR_ID not set — dev mode');

      // Persist to database immediately in dev mode
      await persistDeploymentToDatabase(
        deployer_wallet,
        agent_id,
        metadata_hash,
        price_xlm,
        50_000_000 // 5 XLM fee
      );

      await logDeploymentEvent('confirm_deploy_dev_mode', agent_id, deployer_wallet, {
        signature_hash: sigHashHex,
      });

      return NextResponse.json({
        status: 'confirmed_dev_mode',
        signature_hash: sigHashHex,
        message:
          'Dev mode: Agent deployed locally (NEXT_PUBLIC_SOROBAN_VALIDATOR_ID not configured)',
      });
    }

    // ─ Build confirm_deploy transaction (for user to sign) ──────────────
    try {
      const { xdr: confirmTxXdr } = await buildConfirmationTransaction(
        deployer_wallet,
        agent_id,
        sigHashHex
      );

      responseData = {
        ...responseData,
        confirm_tx_xdr: confirmTxXdr,
        network_passphrase: NETWORK_PASSPHRASE,
        next_step: 'Sign confirm_tx_xdr in your Freighter wallet, then submit via /api/agents/submit-confirmation',
      };
    } catch (txErr) {
      const errMsg = txErr instanceof Error ? txErr.message : String(txErr);
      console.error('[confirm-deploy] TX building error:', errMsg);

      await logDeploymentEvent('confirm_deploy_error', agent_id, deployer_wallet, {
        error: errMsg,
      });

      return NextResponse.json(
        {
          error: 'Failed to build confirmation transaction',
          details: errMsg,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(responseData);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[confirm-deploy] Unexpected error:', errMsg);

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: errMsg,
      },
      { status: 500 }
    );
  }
}
