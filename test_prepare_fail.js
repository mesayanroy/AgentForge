const { rpc, TransactionBuilder, Account, Networks, Operation, Address, Keypair, nativeToScVal } = require('stellar-sdk');

const sorobanRpcUrl = 'https://mainnet.sorobanrpc.com';
const rpcServer = new rpc.Server(sorobanRpcUrl);
const agentWalletId = 'CBRPSAFRX2JAXLF3CYTQCETJRQAYCKCBBR24O4UVUVLF3X6Q4D7KVQSZ';

async function main() {
  const secretKey = 'SBPJDMW7CAHWOWL2F2JXXZPD5O4FKAGRUXJTULR3MIYXBNUERO22QRJJ';
  const keypair = Keypair.fromSecret(secretKey);
  const userAddress = keypair.publicKey();
  const payeeAddress = 'GARN7A6OJKPR3HAPVIKM6GRUD7KMEHYQ76VJJCO4AAKQ6ETEKFQPQ24T';
  const amountStroops = 1000000;
  
  const server = new rpc.Server(sorobanRpcUrl);
  // We need a dummy loaded account sequence
  const account = new Account(userAddress, '269829224427159588');

  const args = [
    new Address(userAddress).toScVal(),
    new Address('CDCW72YVMAE34IQSED3AQ7UHLKOWXLOMN2UQ2J5H4CKY357G2CHMOARL').toScVal(),
    new Address(payeeAddress).toScVal(),
    nativeToScVal(BigInt(amountStroops), { type: 'i128' }),
  ];

  const tx = new TransactionBuilder(account, {
    fee: '500000',
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: agentWalletId,
        function: 'withdraw', // non-existent
        args,
      })
    )
    .setTimeout(60)
    .build();

  console.log('Running prepareTransaction...');
  try {
    const prepared = await rpcServer.prepareTransaction(tx);
    console.log('Prepared success');
  } catch (e) {
    console.error('PREPARE ERROR:', e);
  }
}

main().catch(console.error);
