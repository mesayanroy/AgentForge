const { Address, nativeToScVal, xdr } = require('stellar-sdk');

try {
  const userAddress = 'GCK5L4DAV67YSSYKFWRCELY2BDODO5UURWD42QM7HR4ORQWSORMS3JHE';
  const payeeAddress = 'GARN7A6OJKPR3HAPVIKM6GRUD7KMEHYQ76VJJCO4AAKQ6ETEKFQPQ24T';
  const amountStroops = 1000000;

  console.log('Testing Address.toScVal...');
  const addrVal = new Address(userAddress).toScVal();
  console.log('Address.toScVal Success!');

  console.log('Testing nativeToScVal for BigInt i128...');
  const amountVal = nativeToScVal(BigInt(amountStroops), { type: 'i128' });
  console.log('nativeToScVal Success!');

  const args = [
    new Address(userAddress).toScVal(),
    new Address(payeeAddress).toScVal(),
    amountVal
  ];
  console.log('All args successfully built:', args.length);
} catch (e) {
  console.error('ERROR:', e);
}
