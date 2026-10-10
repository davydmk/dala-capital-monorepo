/**
 * Перевод токена с кошелька админа на любой токен-счёт. Нужен, чтобы
 * проверять пополнение и погашение вживую.
 *
 *   node scripts/send-usdc.mjs <токен-счёт> <сумма в микроединицах> [минт]
 *
 * Без третьего аргумента берётся devnet-USDC: тестовые USDC приходят с
 * faucet.circle.com на кошелёк админа, а отсюда расходятся. С минтом источник
 * считается как ATA админа для этого минта — так же, как ассоциированный счёт
 * выводит кошелёк.
 *
 * Инструкцию собираем руками: отдельная библиотека ради одного перевода не нужна.
 */
import { readFileSync } from 'node:fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

const TOKEN_PROGRAM = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);
const TOKEN_2022_PROGRAM = new PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);
/** USDC devnet: минт по умолчанию и готовый счёт админа под него. */
const DEFAULT_SOURCE = new PublicKey(
  '8zJBcW63B41ySYKUkS3awu2wqxKbDdoYrRpduKmMHaDy',
);

const [destination, amount, mint] = process.argv.slice(2);
if (!destination || !amount) {
  console.error(
    'Укажите токен-счёт получателя и сумму в микроединицах, минт — по желанию',
  );
  process.exit(1);
}

const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync('.secrets/devnet/admin.json', 'utf8'))),
);

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

/** Какой токен-программе принадлежит минт: от неё зависит и ATA, и перевод. */
let tokenProgram = TOKEN_PROGRAM;
let source = DEFAULT_SOURCE;
if (mint) {
  const mintKey = new PublicKey(mint);
  const info = await connection.getAccountInfo(mintKey);
  if (!info) {
    console.error('Минта нет в сети:', mint);
    process.exit(1);
  }
  tokenProgram = info.owner.equals(TOKEN_2022_PROGRAM)
    ? TOKEN_2022_PROGRAM
    : TOKEN_PROGRAM;
  [source] = PublicKey.findProgramAddressSync(
    [admin.publicKey.toBuffer(), tokenProgram.toBuffer(), mintKey.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  );
  const balance = await connection
    .getTokenAccountBalance(source)
    .catch(() => null);
  if (!balance) {
    console.error('У админа нет счёта по этому минту:', source.toBase58());
    process.exit(1);
  }
  console.log(
    `источник: ${source.toBase58()} · остаток ${balance.value.uiAmountString}`,
  );
}

const data = Buffer.alloc(9);
data.writeUInt8(3, 0); // Transfer
data.writeBigUInt64LE(BigInt(amount), 1);

const signature = await connection.sendTransaction(
  new Transaction().add(
    new TransactionInstruction({
      programId: tokenProgram,
      keys: [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(destination), isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    }),
  ),
  [admin],
);
await connection.confirmTransaction(signature, 'confirmed');
console.log('подпись:', signature);
