const { rpc, TransactionBuilder, Account, Networks, Operation } = require('stellar-sdk');

const sorobanRpcUrl = 'https://mainnet.sorobanrpc.com';
const rpcServer = new rpc.Server(sorobanRpcUrl);
const agentWalletId = 'CBRPSAFRX2JAXLF3CYTQCETJRQAYCKCBBR24O4UVUVLF3X6Q4D7KVQSZ';

async function main() {
  const tx = new TransactionBuilder(
    new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'),
    {
      fee: '100',
      networkPassphrase: Networks.PUBLIC,
    }
  )
    .addOperation(
      Operation.invokeContractFunction({
        contract: agentWalletId,
        function: 'state',
        args: [],
      })
    )
    .setTimeout(30)
    .build();

  try {
    const sim = await rpcServer.simulateTransaction(tx);
    console.log('Simulation success:', rpc.Api.isSimulationSuccess(sim));
    if (rpc.Api.isSimulationSuccess(sim)) {
      console.log('Return value:', sim.result.retval);
    } else {
      console.log('Error details:', sim.error);
    }
  } catch (e) {
    console.error('RPC Error:', e);
  }
}

main().catch(console.error);
