const { Horizon, rpc, TransactionBuilder, Account, Networks, Operation, Address, scValToNative } = require('stellar-sdk');

const horizonUrl = 'https://horizon.stellar.org';
const sorobanRpcUrl = 'https://mainnet.sorobanrpc.com';
const server = new Horizon.Server(horizonUrl);
const rpcServer = new rpc.Server(sorobanRpcUrl);

const agentWalletId = 'CBRPSAFRX2JAXLF3CYTQCETJRQAYCKCBBR24O4UVUVLF3X6Q4D7KVQSZ';
const afTokenContractId = 'CDCW72YVMAE34IQSED3AQ7UHLKOWXLOMN2UQ2J5H4CKY357G2CHMOARL';

async function getAfBalance(address) {
  try {
    const tx = new TransactionBuilder(
      new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'),
      {
        fee: '100',
        networkPassphrase: Networks.PUBLIC,
      }
    )
      .addOperation(
        Operation.invokeContractFunction({
          contract: afTokenContractId,
          function: 'balance',
          args: [new Address(address).toScVal()],
        })
      )
      .setTimeout(30)
      .build();

    const simulation = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(simulation) && simulation.result?.retval) {
      const value = scValToNative(simulation.result.retval);
      return Number(value) / 10_000_000;
    }
    return 0;
  } catch (e) {
    console.error('Balance check error:', e);
    return 0;
  }
}

async function main() {
  console.log('Querying balances for Agent Wallet:', agentWalletId);
  
  // 1. Get XLM balance
  let xlmBal = '0.0000';
  try {
    const acc = await server.loadAccount(agentWalletId);
    const native = acc.balances.find(b => b.asset_type === 'native');
    if (native) xlmBal = native.balance;
  } catch (e) {
    console.log('Account not found on Horizon (0 XLM or unfunded)');
  }
  
  // 2. Get AF$ balance
  const afBal = await getAfBalance(agentWalletId);
  
  console.log('Agent Wallet XLM Balance:', xlmBal);
  console.log('Agent Wallet AF$ Balance:', afBal);
}

main().catch(console.error);
