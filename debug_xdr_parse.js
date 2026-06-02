const { Horizon, TransactionBuilder, Networks, scValToNative } = require('@stellar/stellar-sdk');

const horizonUrl = 'https://horizon.stellar.org';
const server = new Horizon.Server(horizonUrl);
const txHash = 'c0a0b05a5ad2cd538d442e3a47d9e3a3e576af1636dc694038277360447e0709';

async function main() {
  const tx = await server.transactions().transaction(txHash).call();
  console.log('Envelope XDR:', tx.envelope_xdr);
  
  const signedTx = TransactionBuilder.fromXDR(tx.envelope_xdr, Networks.PUBLIC);
  console.log('Operations count:', signedTx.operations.length);
  
  for (let i = 0; i < signedTx.operations.length; i++) {
    const op = signedTx.operations[i];
    console.log(`Operation ${i} type:`, op.type);
    console.log(`Operation ${i} keys:`, Object.keys(op));
    console.log(`Operation ${i} full:`, JSON.stringify(op, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  }
}

main().catch(console.error);
