/**
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║       Soroban Deployment Helper — Professional Agent Deployment Library    ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 *
 * This module provides server-side utilities for interacting with the AgentValidator
 * and AgentRegistry contracts deployed on Stellar Soroban. It handles:
 *
 * - Transaction building for contract invocations
 * - Fee calculation and validation
 * - Signature hash generation from Freighter wallet signatures
 * - Database persistence after on-chain confirmation
 * - Event subscription and monitoring
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// ═════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT & CONFIGURATION
// ═════════════════════════════════════════════════════════════════════════════

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

const VALIDATOR_CONTRACT_ID = process.env.NEXT_PUBLIC_SOROBAN_VALIDATOR_ID || '';
const REGISTRY_CONTRACT_ID = process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID || '';

// ═════════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═════════════════════════════════════════════════════════════════════════════

export interface DeploymentRequest {
  deployer_wallet: string;
  agent_id: string;
  metadata_hash: string;
  price_stroops: number;
}

export interface DeploymentConfirmation {
  deployer_wallet: string;
  agent_id: string;
  signature_hash: string; // SHA-256 of signed confirmation
  signed_tx?: string; // Optional: full signed transaction XDR
}

export interface DeploymentStatus {
  status: 'pending' | 'confirmed' | 'failed' | 'skipped';
  agent_id: string;
  deployer_wallet: string;
  contract_id?: string;
  fee_stroops?: number;
  timestamp: number;
  message?: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// SUPABASE DATABASE HELPER
// ═════════════════════════════════════════════════════════════════════════════

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// STELLAR TRANSACTION BUILDER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * **buildValidationTransaction**: Construct an unsigned Soroban transaction
 * that calls AgentValidator.validate_wallet + request_deploy.
 *
 * The transaction is returned as XDR to be signed by the user's Freighter wallet.
 */
export async function buildValidationTransaction(
  deployerWallet: string,
  agentId: string,
  metadataHash: string,
  priceStroops: number
): Promise<{
  xdr: string;
  validationFee: number;
  networkPassphrase: string;
}> {
  const server = new StellarSdk.Horizon.Server(HORIZON_URL);

  // Load deployer account for current sequence number
  let account: StellarSdk.Horizon.AccountResponse;
  try {
    account = await server.loadAccount(deployerWallet);
  } catch (error) {
    throw new Error(`Failed to load account ${deployerWallet}: ${error}`);
  }

  const operation = StellarSdk.Operation.invokeContractFunction({
    contract: VALIDATOR_CONTRACT_ID,
    function: 'request_deploy',
    args: [
      new StellarSdk.Address(deployerWallet).toScVal(),
      StellarSdk.xdr.ScVal.scvSymbol(agentId.slice(0, 32)),
      StellarSdk.xdr.ScVal.scvSymbol(metadataHash.slice(0, 32)),
      StellarSdk.nativeToScVal(BigInt(priceStroops), { type: 'i128' }),
    ],
  });

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: {
      minTime: Math.floor(Date.now() / 1000),
      maxTime: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    },
  })
    .addOperation(operation)
    .build();

  return {
    xdr: tx.toXDR(),
    validationFee: 50_000_000, // 5 XLM in stroops (from contract config)
    networkPassphrase: NETWORK_PASSPHRASE,
  };
}

/**
 * **buildConfirmationTransaction**: Construct Soroban TX for confirm_deploy
 * after user has signed with Freighter.
 */
export async function buildConfirmationTransaction(
  deployerWallet: string,
  agentId: string,
  signatureHash: string // SHA-256 of signed confirmation
): Promise<{
  xdr: string;
  networkPassphrase: string;
}> {
  const server = new StellarSdk.Horizon.Server(HORIZON_URL);

  let account: StellarSdk.Horizon.AccountResponse;
  try {
    account = await server.loadAccount(deployerWallet);
  } catch (error) {
    throw new Error(`Failed to load account: ${error}`);
  }

  // Convert signature hash (hex string) to BytesN<32>
  const buffer = Buffer.from(signatureHash, 'hex');
  if (buffer.length !== 32) {
    throw new Error('Signature hash must be exactly 32 bytes (SHA-256)');
  }

  const operation = StellarSdk.Operation.invokeContractFunction({
    contract: VALIDATOR_CONTRACT_ID,
    function: 'confirm_deploy',
    args: [
      new StellarSdk.Address(deployerWallet).toScVal(),
      StellarSdk.xdr.ScVal.scvSymbol(agentId.slice(0, 32)),
      StellarSdk.xdr.ScVal.scvBytes(buffer),
    ],
  });

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: {
      minTime: Math.floor(Date.now() / 1000),
      maxTime: Math.floor(Date.now() / 1000) + 3600,
    },
  })
    .addOperation(operation)
    .build();

  return {
    xdr: tx.toXDR(),
    networkPassphrase: NETWORK_PASSPHRASE,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// DATABASE OPERATIONS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * **persistDeploymentToDatabase**: After on-chain confirmation, store agent
 * metadata in Supabase for discovery and management.
 */
export async function persistDeploymentToDatabase(
  deployerWallet: string,
  agentId: string,
  metadataHash: string,
  priceXlm: number,
  feeStroops: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseAdmin();

    // Insert or update agent record
    const { error } = await supabase
      .from('agents')
      .upsert({
        owner_wallet: deployerWallet,
        agent_id: agentId,
        metadata_hash: metadataHash,
        price_xlm: priceXlm,
        validation_fee_stroops: feeStroops,
        is_active: true,
        deployed_at: new Date().toISOString(),
        contract_validator_id: VALIDATOR_CONTRACT_ID,
        contract_registry_id: REGISTRY_CONTRACT_ID,
      })
      .select();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * **getDeploymentStatus**: Query deployment status from database.
 */
export async function getDeploymentStatus(agentId: string): Promise<DeploymentStatus | null> {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    if (error) {
      console.error('Deployment status query error:', error);
      return null;
    }

    return {
      status: data.is_active ? 'confirmed' : 'failed',
      agent_id: data.agent_id,
      deployer_wallet: data.owner_wallet,
      contract_id: VALIDATOR_CONTRACT_ID,
      fee_stroops: data.validation_fee_stroops,
      timestamp: new Date(data.deployed_at).getTime(),
    };
  } catch (error) {
    console.error('Deployment status error:', error);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// VALIDATION & SECURITY
// ═════════════════════════════════════════════════════════════════════════════

/**
 * **validateWalletAddress**: Ensure wallet is a valid Stellar address.
 */
export function validateWalletAddress(address: string): boolean {
  try {
    StellarSdk.Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * **validateAgentId**: Agent IDs must be valid Soroban symbols (alphanumeric, max 32 chars).
 */
export function validateAgentId(agentId: string): boolean {
  const symbolRegex = /^[a-zA-Z0-9_]{1,32}$/;
  return symbolRegex.test(agentId);
}

/**
 * **calculateSignatureHash**: Generate SHA-256 from a message.
 * In production, this is signed by Freighter and we use the signature hash.
 */
export function calculateSignatureHash(message: string): string {
  return crypto.createHash('sha256').update(message).digest('hex');
}

// ═════════════════════════════════════════════════════════════════════════════
// LOGGING & MONITORING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * **logDeploymentEvent**: Log deployment events for auditing.
 */
export async function logDeploymentEvent(
  event: string,
  agentId: string,
  deployerWallet: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();

    await supabase
      .from('deployment_events')
      .insert({
        event,
        agent_id: agentId,
        deployer_wallet: deployerWallet,
        metadata,
        timestamp: new Date().toISOString(),
      });
  } catch (error) {
    console.error('Failed to log deployment event:', error);
  }
}
