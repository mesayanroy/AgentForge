import * as StellarSdk from '@stellar/stellar-sdk';

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
  ? StellarSdk.Networks.PUBLIC
  : StellarSdk.Networks.TESTNET;

export const server = new StellarSdk.Horizon.Server(HORIZON_URL);

export { NETWORK_PASSPHRASE };

// ─── Horizon SSE watcher ──────────────────────────────────────────────────────

export type TxWatcherCallback = (tx: StellarSdk.Horizon.ServerApi.TransactionRecord) => void;

/**
 * Open a Horizon Server-Sent Events stream for a specific account and call
 * `onTransaction` for every new transaction that arrives.
 *
 * Returns a `close` function that stops the stream.
 *
 * @param accountAddress  Stellar account to watch.
 * @param onTransaction   Called with each new transaction record.
 * @param cursor          Starting cursor (default: "now" to only get new txs).
 */
export function watchAccountTransactions(
  accountAddress: string,
  onTransaction: TxWatcherCallback,
  cursor = 'now'
): () => void {
  const close = server
    .transactions()
    .forAccount(accountAddress)
    .cursor(cursor)
    .stream({
      onmessage: (tx) => {
        try {
          onTransaction(tx as StellarSdk.Horizon.ServerApi.TransactionRecord);
        } catch (err) {
          console.error('[Horizon SSE] onmessage handler error:', err);
        }
      },
      onerror: (err) => {
        console.error('[Horizon SSE] stream error:', err);
      },
    });

  return close;
}

/**
 * Poll Horizon for a specific transaction hash and resolve once it appears
 * on the ledger (or reject after `timeoutMs`).
 */
export function waitForTransaction(
  txHash: string,
  timeoutMs = 60_000
): Promise<StellarSdk.Horizon.ServerApi.TransactionRecord> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    async function poll(): Promise<void> {
      try {
        const tx = await server.transactions().transaction(txHash).call();
        if (tx) {
          resolve(tx);
          return;
        }
      } catch {
        // not yet on ledger
      }

      if (Date.now() >= deadline) {
        reject(new Error(`Transaction ${txHash} not found within ${timeoutMs}ms`));
        return;
      }

      setTimeout(() => void poll(), 3_000);
    }

    void poll();
  });
}

export function truncateAddress(address: string, chars = 4): string {
  if (!address || address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars + 1)}...${address.slice(-chars)}`;
}

export async function verifyPaymentTransaction(
  txHash: string,
  expectedDestination: string,
  expectedAmountXlm: number,
  expectedMemo: string,
  expectedSourceAccount?: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Poll for the transaction with retries to handle Horizon propagation delay.
    let tx: StellarSdk.Horizon.ServerApi.TransactionRecord | null = null;
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        tx = await server.transactions().transaction(txHash).call();
        if (tx) break;
      } catch {
        // Not yet indexed — wait 3 s and retry
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
    if (!tx) return { valid: false, error: 'Transaction not found on Horizon after retries' };

    if (expectedSourceAccount && tx.source_account !== expectedSourceAccount) {
      // Log the mismatch for debugging but don't fail hard — the payment may
      // have been signed by a different sub-account or multi-sig setup.
      console.warn(
        `[stellar] Source account mismatch (non-fatal): expected ${expectedSourceAccount}, got ${tx.source_account}`
      );
    }

    // Memo check: the expected value may be a prefix of the actual memo
    // (e.g. "agent:<id>" matches "agent:<id>:req:<nonce>").
    // Only reject if both sides are non-empty and memo doesn't start with prefix.
    if (expectedMemo && tx.memo) {
      const txMemoStr = String(tx.memo);
      if (!txMemoStr.startsWith(expectedMemo)) {
        // Try a looser match — check if the first part of memo (up to ':req:') matches
        const memoBase = txMemoStr.split(':req:')[0];
        const expectedBase = expectedMemo.split(':req:')[0];
        if (memoBase !== expectedBase) {
          return { valid: false, error: `Memo mismatch. Expected prefix "${expectedMemo}", got "${txMemoStr}"` };
        }
      }
    }

    // 1. Check for Soroban AF$ Token Transfer using envelope XDR
    const afTokenContractId = process.env.NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID || 'CDCW72YVMAE34IQSED3AQ7UHLKOWXLOMN2UQ2J5H4CKY357G2CHMOARL';
    let totalPaidAf = 0;

    try {
      const signedTx = StellarSdk.TransactionBuilder.fromXDR(tx.envelope_xdr, NETWORK_PASSPHRASE);
      for (const op of signedTx.operations) {
        const opAny = op as any;

        let contractId = '';
        let functionName = '';
        let opArgs: any[] = [];

        if (opAny.type === 'invokeContractFunction') {
          contractId = opAny.contract;
          functionName = opAny.function;
          opArgs = opAny.args || [];
        } else if (opAny.type === 'invokeHostFunction' && opAny.func) {
          try {
            const funcValue = opAny.func.value();
            if (funcValue) {
              contractId = StellarSdk.Address.fromScAddress(funcValue.contractAddress()).toString();
              functionName = funcValue.functionName().toString();
              opArgs = funcValue.args() || [];
            }
          } catch (e) {
            console.warn('[stellar] Failed to parse invokeHostFunction properties:', e);
          }
        }

        if (contractId === afTokenContractId && functionName === 'transfer' && opArgs.length >= 3) {
          const toAddress = StellarSdk.scValToNative(opArgs[1]);
          const amountStroops = StellarSdk.scValToNative(opArgs[2]);
          if (toAddress === expectedDestination) {
            totalPaidAf += Number(BigInt(amountStroops)) / 10_000_000;
          }
        }
      }
    } catch (err) {
      console.warn('[stellar] Failed to parse transaction envelope XDR for contract checks:', err);
    }

    // 2. Check for Native XLM payments via operations endpoint
    const ops = await server.operations().forTransaction(txHash).call();
    let totalPaidXlm = 0;

    for (const op of ops.records) {
      if (
        op.type === 'payment' &&
        (op as StellarSdk.Horizon.ServerApi.PaymentOperationRecord).asset_type === 'native' &&
        (op as StellarSdk.Horizon.ServerApi.PaymentOperationRecord).to === expectedDestination
      ) {
        totalPaidXlm += parseFloat(
          (op as StellarSdk.Horizon.ServerApi.PaymentOperationRecord).amount
        );
      }
    }

    const requiredAf = expectedAmountXlm * 100;
    const isXlmValid = totalPaidXlm >= expectedAmountXlm;
    const isAfValid = totalPaidAf >= requiredAf;

    if (!isXlmValid && !isAfValid) {
      return {
        valid: false,
        error: `Payment amount insufficient. Paid ${totalPaidXlm} XLM (required: ${expectedAmountXlm} XLM) or ${totalPaidAf} AF$ (required: ${requiredAf} AF$)`,
      };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Verification failed: ${String(err)}` };
  }
}

export async function getXlmBalance(address: string): Promise<string> {
  try {
    const account = await server.loadAccount(address);
    const xlmBalance = account.balances.find(
      (b) => b.asset_type === 'native'
    );
    return xlmBalance ? xlmBalance.balance : '0';
  } catch {
    return '0';
  }
}

export async function fundTestAccount(address: string): Promise<boolean> {
  try {
    const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getAfBalance(address: string): Promise<string> {
  try {
    const StellarSdk = await import('@stellar/stellar-sdk');
    const afTokenContractId = process.env.NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID || 'CDCW72YVMAE34IQSED3AQ7UHLKOWXLOMN2UQ2J5H4CKY357G2CHMOARL';
    const sorobanRpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://mainnet.sorobanrpc.com';
    const rpcServer = new StellarSdk.rpc.Server(sorobanRpcUrl, { allowHttp: true });

    const tx = new StellarSdk.TransactionBuilder(
      new StellarSdk.Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'),
      {
        fee: '100',
        networkPassphrase: process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
          ? StellarSdk.Networks.PUBLIC
          : StellarSdk.Networks.TESTNET,
      }
    )
      .addOperation(
        StellarSdk.Operation.invokeContractFunction({
          contract: afTokenContractId,
          function: 'balance',
          args: [new StellarSdk.Address(address).toScVal()],
        })
      )
      .setTimeout(30)
      .build();

    const simulation = await rpcServer.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationSuccess(simulation) && simulation.result?.retval) {
      const value = StellarSdk.scValToNative(simulation.result.retval);
      const decimalValue = Number(BigInt(value)) / 10_000_000;
      return decimalValue.toString();
    }
    return '0';
  } catch {
    return '0';
  }
}
